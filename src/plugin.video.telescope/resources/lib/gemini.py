# -*- coding: utf-8 -*-
"""Google Gemini helper (REST, no SDK) - title alias expansion, match verification, AI search.

Uses generateContent with JSON output.  The model defaults to the hot-swapped alias
``gemini-flash-latest``; on 404 we discover an available Flash model through models.list.
No sampling parameters are sent (deprecated for Gemini 3.6+).
"""
import json
import re
import time

import requests

BASE = 'https://generativelanguage.googleapis.com/v1beta'
FALLBACK_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3.5-flash', 'gemini-2.5-flash']


class GeminiError(Exception):
    pass


class Gemini(object):
    def __init__(self, api_key, model='', timeout=25, log=None):
        self.key = (api_key or '').strip()
        self.model = (model or '').strip() or FALLBACK_MODELS[0]
        self.timeout = timeout
        self.log = log or (lambda m: None)
        self._discovered = False
        self.session = requests.Session()
        if self.key:
            # 3.3: the key travels in a header - in the query string it ended up in every error text / kodi.log
            self.session.headers['x-goog-api-key'] = self.key

    @property
    def enabled(self):
        return bool(self.key)

    # ------------------------------------------------------------------ transport
    def _discover(self):
        if self._discovered:
            return None
        self._discovered = True
        try:
            r = self.session.get(BASE + '/models', params={'pageSize': 200}, timeout=self.timeout)
            r.raise_for_status()
            names = []
            for m in r.json().get('models', []):
                if 'generateContent' not in (m.get('supportedGenerationMethods') or []):
                    continue
                n = m.get('name', '').replace('models/', '')
                if 'flash' in n and not re.search(r'tts|image|live|audio|embed|robotics|omni|computer', n):
                    names.append(n)

            def rank(n):
                nums = [float(x) for x in re.findall(r'(\d+(?:\.\d+)?)', n)[:1]] or [0]
                return (n.endswith('latest'), 'preview' not in n, 'lite' not in n, nums[0])
            names.sort(key=rank, reverse=True)
            return names[0] if names else None
        except Exception as exc:
            self.log('Gemini model discovery failed: %s' % _scrub(exc))
            return None

    def generate(self, prompt, system=None, schema_hint=True, max_tokens=4096, timeout=None):
        if not self.key:
            raise GeminiError('no api key')
        body = {
            'contents': [{'role': 'user', 'parts': [{'text': prompt}]}],
            'generationConfig': {'responseMimeType': 'application/json', 'maxOutputTokens': max_tokens},
        }
        if system:
            body['systemInstruction'] = {'parts': [{'text': system}]}
        tried = []
        model = self.model
        for _ in range(3):
            tried.append(model)
            url = '%s/models/%s:generateContent' % (BASE, model)
            try:
                r = self.session.post(url, json=body, timeout=timeout or self.timeout)
            except requests.RequestException as exc:
                raise GeminiError(_scrub(exc))
            if r.status_code in (404, 400) and ('not found' in r.text.lower() or 'not supported' in r.text.lower()):
                nxt = self._discover()
                if not nxt or nxt in tried:
                    nxt = next((m for m in FALLBACK_MODELS if m not in tried), None)
                if not nxt:
                    break
                self.log('Gemini model %s unavailable, switching to %s' % (model, nxt))
                model = self.model = nxt
                continue
            if r.status_code == 429:
                time.sleep(1.5)
                continue
            if r.status_code != 200:
                raise GeminiError('HTTP %s: %s' % (r.status_code, r.text[:200]))
            return self._extract_json(r.json())
        raise GeminiError('no usable model (%s)' % ', '.join(tried))

    @staticmethod
    def _extract_json(resp):
        try:
            parts = resp['candidates'][0]['content']['parts']
        except (KeyError, IndexError, TypeError):
            raise GeminiError('empty response')
        text = ''.join(p.get('text', '') for p in parts if not p.get('thought'))
        return parse_json_text(text)

    # ------------------------------------------------------------------ tasks
    def aliases(self, title, original_title, year, kind, known=None, timeout=None):
        prompt = (
            'You help find video files in Hebrew, Russian and English Telegram channels.\n'
            'Title: %s\nOriginal title: %s\nYear: %s\nType: %s\nKnown names: %s\n\n'
            'Return JSON {"he": [..], "ru": [..], "en": [..], "other": [..]} with the names this %s is '
            'actually known by in Israel (Hebrew script), in Russia/CIS (Cyrillic) and in English, '
            'including common official translations and the transliterations used by uploaders. '
            'Max 4 per language, no explanations, no year inside names. If unsure, return empty lists.'
        ) % (title, original_title, year or '', kind, ', '.join(known or [])[:600], kind)
        data = self.generate(prompt, max_tokens=1024, timeout=timeout)
        out = []
        if isinstance(data, dict):
            for key in ('he', 'ru', 'en', 'other'):
                for name in data.get(key) or []:
                    if isinstance(name, str) and 1 < len(name) < 120:
                        out.append(name.strip())
        return out

    def verify(self, target, candidates, timeout=None):
        """candidates: list of dict(id, file, caption, chat, duration_min, size_mb).
        Returns {id: {'match': bool, 'confidence': float, 'audio': str, 'subs': str}}."""
        if not candidates:
            return {}
        what = target['title']
        if target['kind'] == 'episode':
            what += ' season %s episode %s' % (target['season'], target['episode'])
        else:
            what += ' (%s)' % (target.get('year') or '')
        prompt = (
            'Decide which Telegram video files are EXACTLY the requested %s.\n'
            'Requested: %s\nAlso known as: %s\nExpected runtime: %s minutes\n'
            'Rules: a different movie of a franchise/sequel/remake/year is NOT a match; for series the '
            'season AND episode must be the requested ones (Hebrew "עונה X פרק Y", Russian "X сезон Y серия" '
            'count); trailers, samples, extras, recaps and season packs are NOT matches.\n'
            'Files (JSON): %s\n\n'
            'Return JSON {"results": [{"id": <id>, "match": true/false, "confidence": 0..1, '
            '"audio": "he|ru|en|other|unknown", "subs": "he|ru|en|none|unknown"}]} covering every id.'
        ) % (target['kind'], what, ', '.join(target.get('aliases', [])[:12]), target.get('runtime') or 'unknown',
             json.dumps(candidates, ensure_ascii=False))
        data = self.generate(prompt, max_tokens=4096, timeout=timeout)
        out = {}
        rows = data.get('results') if isinstance(data, dict) else data
        for row in rows or []:
            try:
                out[str(row['id'])] = {
                    'match': bool(row.get('match')),
                    'confidence': float(row.get('confidence') or 0),
                    'audio': str(row.get('audio') or ''),
                    'subs': str(row.get('subs') or ''),
                }
            except (KeyError, TypeError, ValueError):
                continue
        return out

    def smart_search(self, text):
        prompt = (
            'The user of a movie/TV app typed (any language): "%s".\n'
            'Identify up to 8 real movies or TV series that best fit. Return JSON '
            '{"items": [{"title": english title, "year": number|null, "type": "movie"|"tv"}]}'
        ) % text.replace('"', "'")
        data = self.generate(prompt, max_tokens=1024)
        items = data.get('items') if isinstance(data, dict) else data
        res = []
        for it in items or []:
            if isinstance(it, dict) and it.get('title'):
                res.append({'title': it['title'], 'year': it.get('year'),
                            'type': 'tv' if it.get('type') == 'tv' else 'movie'})
        return res

    def test(self):
        data = self.generate('Return JSON {"ok": true}', max_tokens=64)
        return bool(isinstance(data, dict) and data.get('ok'))


def _scrub(text):
    """3.3: no key may survive in an error text (common.scrub; loaded late so this module works without Kodi)."""
    try:
        from .common import scrub
        return scrub(text)
    except Exception:
        return re.sub(r'(api_key|key|token|secret)=[^&\s\'"]+', r'\1=***', str(text), flags=re.I)


def parse_json_text(text):
    text = (text or '').strip()
    if text.startswith('```'):
        text = re.sub(r'^```(?:json)?\s*|\s*```$', '', text)
    try:
        return json.loads(text)
    except ValueError:
        m = re.search(r'(\{.*\}|\[.*\])', text, re.S)
        if m:
            try:
                return json.loads(m.group(1))
            except ValueError:
                pass
    raise GeminiError('invalid JSON from model')
