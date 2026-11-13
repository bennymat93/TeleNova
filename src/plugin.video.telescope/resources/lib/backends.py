# -*- coding: utf-8 -*-
"""Additional source back-ends (all produce candidates in the same dict shape as tgclient):

* TelemediaBridge - re-uses an installed & logged-in Telemedia add-on (plugin.video.telemedia).
  Telemedia's service exposes its TDLib client on http://127.0.0.1:<port>/ :
    POST {"type": "td_send", "info": "<TDLib JSON request>"}  -> TDLib JSON response
    GET  /<tdlib file_id>  (Range)                            -> file bytes
  So TeleScope can search the user's Telegram and play files without a second login.
* StremioServers - any Stremio-protocol Telegram streaming server the user is entitled to
  (manifest URL in settings): /stream/<movie|series>/<imdb[:s:e]>.json
"""
import itertools
import json
import re
import threading
import time

import requests

_extra = itertools.count(int(time.time()) % 100000)
VIDEO_RX = re.compile(r'\.(mkv|mp4|avi|m4v|webm|ts|mov|wmv|mpg|mpeg|flv)$', re.I)


class TelemediaBridge(object):
    ADDON = 'plugin.video.telemedia'

    def __init__(self, log, port=None, timeout=15):
        self.log = log
        self.port = port
        self.timeout = timeout
        self._chat_titles = {}
        self._lock = threading.Lock()
        self._sem = threading.Semaphore(2)
        self.s = requests.Session()

    # ------------------------------------------------------------------ plumbing
    def _port(self):
        if self.port:
            return str(self.port)
        try:
            import xbmc
            import xbmcaddon
            if not xbmc.getCondVisibility('System.HasAddon(%s)' % self.ADDON):
                return ''               # not installed: asking for it writes an EXCEPTION line into Kodi's log
            return xbmcaddon.Addon(self.ADDON).getSetting('port') or ''
        except Exception:
            return ''

    @property
    def base(self):
        p = self._port()
        return 'http://127.0.0.1:%s/' % p if p else None

    def td(self, req, timeout=None):
        if not self.base:
            raise IOError('telemedia not installed')
        req = dict(req)
        req['@extra'] = next(_extra)
        with self._sem:
            r = self.s.post(self.base, json={'type': 'td_send', 'info': json.dumps(req)},
                            timeout=timeout or self.timeout)
        data = r.json()
        if isinstance(data, dict) and data.get('@type') == 'error':
            raise IOError('TDLib error %s: %s' % (data.get('code'), data.get('message')))
        return data

    def available(self):
        try:
            me = self.td({'@type': 'getMe'}, timeout=3)
            return isinstance(me, dict) and me.get('@type') == 'user'
        except Exception:
            return False

    def chat_title(self, chat_id):
        with self._lock:
            if chat_id in self._chat_titles:
                return self._chat_titles[chat_id]
        try:
            title = self.td({'@type': 'getChat', 'chat_id': chat_id}).get('title') or ''
        except Exception:
            title = ''
        with self._lock:
            self._chat_titles[chat_id] = title
        return title

    def stream_url(self, file_id):
        return '%s%d' % (self.base, int(file_id))

    # ------------------------------------------------------------------ conversion
    def to_cand(self, m):
        c = m.get('content') or {}
        t = c.get('@type')
        if t == 'messageVideo':
            v = c.get('video') or {}
            f = v.get('video') or {}
            name, mime, dur = v.get('file_name') or '', v.get('mime_type') or 'video/mp4', v.get('duration') or 0
            w, h, is_video = v.get('width') or 0, v.get('height') or 0, True
        elif t == 'messageDocument':
            d = c.get('document') or {}
            f = d.get('document') or {}
            name, mime, dur, w, h, is_video = d.get('file_name') or '', d.get('mime_type') or '', 0, 0, 0, False
            if not (mime.startswith('video/') or VIDEO_RX.search(name)):
                return None
        else:
            return None
        if not f.get('id'):
            return None
        chat_id = m.get('chat_id')
        if not name:
            name = 'video_%s.mp4' % m.get('id')
        return {
            'chat_id': chat_id, 'msg_id': m.get('id'), 'file': name, 'size': f.get('size') or f.get('expected_size') or 0,
            'mime': mime, 'duration': dur, 'width': w, 'height': h,
            'caption': ((c.get('caption') or {}).get('text') or ''), 'chat_title': self.chat_title(chat_id),
            'date': m.get('date') or 0, 'doc_id': 'tm:%s' % ((f.get('remote') or {}).get('unique_id') or f.get('id')),
            'is_video_attr': is_video, 'backend': 'telemedia', 'url': self.stream_url(f['id']),
        }

    def _convert(self, data):
        out = []
        for m in (data or {}).get('messages') or []:
            try:
                cand = self.to_cand(m)
            except Exception:
                cand = None
            if cand:
                out.append(cand)
        return out

    # ------------------------------------------------------------------ search
    def search(self, query, limit=100, chats=None):
        out = []
        for flt in ('searchMessagesFilterVideo', 'searchMessagesFilterDocument'):
            req = {'@type': 'searchMessages', 'query': query, 'limit': min(100, limit), 'offset': '',
                   'offset_date': 0, 'offset_chat_id': 0, 'offset_message_id': 0,
                   'filter': {'@type': flt}, 'min_date': 0, 'max_date': 0}
            try:
                out += self._convert(self.td(req))
            except Exception as exc:
                self.log('telemedia searchMessages failed: %s' % exc)
        for chat in chats or []:
            out += self.chat_messages(chat, query=query, limit=max(20, limit // 3))
        return out

    def chat_messages(self, chat_id, query='', from_message_id=0, limit=50):
        out = []
        for flt in ('searchMessagesFilterVideo', 'searchMessagesFilterDocument'):
            req = {'@type': 'searchChatMessages', 'chat_id': int(chat_id), 'query': query or '',
                   'from_message_id': int(from_message_id or 0), 'offset': 0, 'limit': min(100, limit),
                   'filter': {'@type': flt}, 'message_thread_id': 0}
            try:
                out += self._convert(self.td(req))
            except Exception as exc:
                self.log('telemedia searchChatMessages failed: %s' % exc)
        return out

    def find_chats(self, keywords):
        ids = []
        for kw in keywords:
            for method in ('searchChats', 'searchChatsOnServer'):
                try:
                    res = self.td({'@type': method, 'query': kw, 'limit': 50})
                except Exception:
                    continue
                for cid in res.get('chat_ids') or []:
                    if cid not in ids:
                        ids.append(cid)
        return [{'id': cid, 'title': self.chat_title(cid)} for cid in ids]


class StremioServers(object):
    """Stremio-protocol Telegram streaming servers configured by the user."""

    def __init__(self, urls, log, timeout=20):
        self.bases = []
        for u in urls or []:
            u = u.strip()
            if not u.startswith('http'):
                continue
            u = re.sub(r'/manifest\.json.*$', '', u).rstrip('/')
            self.bases.append(u)
        self.log = log
        self.timeout = timeout
        self.s = requests.Session()
        self.s.headers['User-Agent'] = 'Kodi TeleScope'

    @property
    def enabled(self):
        return bool(self.bases)

    def _one(self, base, kind, sid):
        url = '%s/stream/%s/%s.json' % (base, kind, sid)
        try:
            data = self.s.get(url, timeout=self.timeout).json()
        except Exception as exc:
            self.log('stremio server %s failed: %s' % (base, exc))
            return []
        out = []
        host = re.sub(r'^https?://', '', base).split('/')[0]
        for i, st in enumerate(data.get('streams') or []):
            link = st.get('url')
            if not link or not link.startswith('http'):
                continue
            hints = st.get('behaviorHints') or {}
            text = '\n'.join(x for x in [st.get('title') or '', st.get('description') or '', st.get('name') or ''] if x)
            fname = hints.get('filename') or (st.get('title') or st.get('name') or 'video').split('\n')[0]
            size = hints.get('videoSize') or 0
            if not size:
                m = re.search(r'(\d+(?:\.\d+)?)\s*(GB|MB)', text, re.I)
                if m:
                    size = float(m.group(1)) * (1024 ** 3 if m.group(2).upper() == 'GB' else 1024 ** 2)
            if not re.search(r'\.[a-z0-9]{2,4}$', fname):
                fname += '.mkv'
            out.append({
                'chat_id': 0, 'msg_id': i, 'file': fname, 'size': int(size), 'mime': 'video/x-matroska',
                'duration': 0, 'width': 0, 'height': 0, 'caption': text, 'chat_title': host,
                'date': 0, 'doc_id': 'st:%s' % link, 'is_video_attr': True, 'backend': 'stremio',
                'url': link, 'trusted_id': True,
            })
        return out

    def streams(self, kind, imdb, season=None, episode=None):
        if not imdb or not self.bases:
            return []
        if kind == 'episode':
            sid, skind = '%s:%s:%s' % (imdb, int(season), int(episode)), 'series'
        else:
            sid, skind = imdb, 'movie'
        out = []
        threads, results = [], {}

        def run(b):
            results[b] = self._one(b, skind, sid)
        for b in self.bases:
            t = threading.Thread(target=run, args=(b,), daemon=True)
            t.start()
            threads.append(t)
        for t in threads:
            t.join(self.timeout + 2)
        for b in self.bases:
            out += results.get(b) or []
        return out
