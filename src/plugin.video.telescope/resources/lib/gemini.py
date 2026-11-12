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
# 3.3.5: the light model first. Measured with a free key: gemini-flash-latest and the numbered full Flash models
# did not answer within 40 s or said 503 "high demand", the Flash-Lite models answered in 1-4 s - and the questions
# asked here (names of a title, "is this file that episode") do not need the big model.
FALLBACK_MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest']
_BAD = {}                     # model -> time until which it is not asked again (shared by every Gemini object)


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
                return ('preview' not in n, 'lite' in n, n.endswith('latest'), nums[0])   # 3.3.5: the light ones first
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
        # 3.3.5: one time budget for the whole call. A model that does not answer (time-out, 429, 5xx) is left alone
        # for ten minutes and the next one is asked with the time that is left; the model that answered is kept.
        deadline = time.time() + (timeout or self.timeout)
        tried, last = [], None
        queue = self._order()
        while queue and len(tried) < 4:
            model = queue.pop(0)
            left = deadline - time.time()
            if left < 0.8:
                break
            tried.append(model)
            url = '%s/models/%s:generateContent' % (BASE, model)
            try:
                r = self.session.post(url, json=body, timeout=(min(5, left), left))
            except requests.RequestException as exc:
                last = _scrub(exc)
                _BAD[model] = time.time() + 600
                continue
            if r.status_code in (404, 400) and ('not found' in r.text.lower() or 'not supported' in r.text.lower()
                                                or 'no longer available' in r.text.lower()):
                _BAD[model] = time.time() + 86400
                nxt = self._discover()
                if nxt and nxt not in tried and nxt not in queue:
                    queue.insert(0, nxt)
                last = 'model %s unavailable' % model
                continue
            if r.status_code == 429 or r.status_code >= 500:
                last = 'HTTP %s' % r.status_code
                _BAD[model] = time.time() + (120 if r.status_code == 429 else 600)
                continue
            if r.status_code != 200:
                raise GeminiError('HTTP %s: %s' % (r.status_code, r.text[:200]))
            if model != self.model:
                self.log('Gemini: %s answers, used from now on' % model)
                self.model = model
            return self._extract_json(r.json())
        raise GeminiError('no model answered (%s): %s' % (', '.join(tried) or 'none tried', last or 'out of time'))

    def _order(self):
        """the models to ask, best first: the working one, then the fall-backs; resting ones only if nothing else"""
        names = [self.model] + [m for m in FALLBACK_MODELS if m != self.model]
        now = time.time()
        ok = [m for m in names if _BAD.get(m, 0) <= now]
        return ok or names[:1]

    def healthy(self):
        now = time.time()
        return any(_BAD.get(m, 0) <= now for m in [self.model] + FALLBACK_MODELS)

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
