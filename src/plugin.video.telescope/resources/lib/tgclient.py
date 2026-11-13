# -*- coding: utf-8 -*-
"""Telethon (MTProto) wrapper living inside the Kodi service.

A dedicated asyncio loop runs in a background thread; the HTTP proxy / RPC threads submit
coroutines with run()/submit().  Everything Telegram-specific is kept here so that the rest
of the add-on can be tested with a fake client.
"""
import asyncio
import collections
import json
import re
import threading
import time

PART = 512 * 1024    # Telethon's MAX_CHUNK_SIZE per upload.getFile request
CHUNK = 1024 * 1024  # upload.getFile: limit divisible by 4K, 1MB % limit == 0, no 1MB boundary crossing


class TGError(Exception):
    pass


class _Virtual(object):
    """Looks like a message to _to_cand() / read_chunk(): a document handed out by an inline bot."""
    virtual = True

    def __init__(self, vid, chat, document, file, text):
        self.id = vid
        self.chat = chat
        self.chat_id = chat.id
        self.media = document
        self.file = file
        self.message = text
        self.date = getattr(document, 'date', None)
        self.video = document if (getattr(document, 'mime_type', '') or '').startswith('video/') else None


class TG(object):
    def __init__(self, api_id, api_hash, session_path, log, parallel=4):
        self.api_id = int(api_id)
        self.api_hash = api_hash
        self.session_path = session_path
        self.log = log
        self.parallel = max(1, int(parallel))
        self.loop = None
        self.client = None
        self.thread = None
        self._ready = threading.Event()
        self._login = {}
        self._qr = None
        self._docs = collections.OrderedDict()   # (chat_id, msg_id) -> message
        self._dl_sem = None
        self._search_sem = None
        self.me = None
        self._virtual = collections.OrderedDict()   # 3.3.3: files of inline bots (no message exists for them)
        self._virtual_seq = 0
        self._bot_locks = {}

    # ------------------------------------------------------------------ lifecycle
    def start(self, timeout=60):
        self.thread = threading.Thread(target=self._run_loop, name='telescope-tg', daemon=True)
        self.thread.start()
        if not self._ready.wait(30):
            raise TGError('Telegram loop did not start')
        self.run(self._connect(), timeout)

    def _run_loop(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        self._dl_sem = asyncio.Semaphore(self.parallel * 2)
        self._search_sem = asyncio.Semaphore(5)
        self._ready.set()
        self.loop.run_forever()

    async def _connect(self):
        from telethon import TelegramClient
        # 3.3: connection_retries=None = retry forever (Telethon 1.x). With 5 retries the client gave up after a
        # longer outage and stayed disconnected until Kodi was restarted
        self.client = TelegramClient(self.session_path, self.api_id, self.api_hash,
                                     device_model='Kodi', system_version='TeleScope', app_version='1.0',
                                     connection_retries=None, retry_delay=2, auto_reconnect=True,
                                     request_retries=2, flood_sleep_threshold=0)   # 3.3.1: every flood wait reaches our own gate (_flood)
        await self.client.connect()
        if await self.client.is_user_authorized():
            self.me = await self.client.get_me()
        if not getattr(self, '_lag_task', None):
            self._lag_task = asyncio.ensure_future(self._lag_watch())
        return True

    async def reconnect(self):
        """3.3: called by the service's watchdog when the client is found disconnected."""
        if not self.client.is_connected():
            await self.client.connect()
        if self.me is None and await self.client.is_user_authorized():
            self.me = await self.client.get_me()
        return True

    def stop(self, timeout=10):
        if self.loop and self.client:
            try:
                self.run(self.client.disconnect(), timeout)
            except Exception:
                pass
        if self.loop:
            self.loop.call_soon_threadsafe(self.loop.stop)

    def run(self, coro, timeout=60):
        if not self.loop:
            raise TGError('not started')
        fut = asyncio.run_coroutine_threadsafe(coro, self.loop)
        try:
            return fut.result(timeout)
        except Exception:
            fut.cancel()
            raise

    def submit(self, coro):
        return asyncio.run_coroutine_threadsafe(coro, self.loop)

    # ------------------------------------------------------------------ auth
    async def status(self):
        ok = bool(self.client and self.client.is_connected())
        auth = bool(ok and await self.client.is_user_authorized())
        if auth and not self.me:
            self.me = await self.client.get_me()
        me = None
        if auth and self.me:
            me = {'name': ' '.join(x for x in [self.me.first_name, self.me.last_name] if x),
                  'username': self.me.username, 'premium': bool(getattr(self.me, 'premium', False))}
        return {'connected': ok, 'authorized': auth, 'me': me}

    # ------------------------------------------------------------------ 4.0.4: the setup kept in the account
    # One small file per device in the account's own "Saved Messages": every device logged in to the same account
    # sees it. Nothing is sent to any chat but the account's own.
    CLOUD_TAG = '#TeleNovaSetup'

    async def cloud_list(self, limit=30):
        out = []
        async for m in self.client.iter_messages('me', search=self.CLOUD_TAG, limit=limit):
            if not m.file or not (m.message or '').startswith(self.CLOUD_TAG):
                continue
            note = {}
            try:
                note = json.loads((m.message or '')[len(self.CLOUD_TAG):].strip() or '{}')
            except ValueError:
                pass
            out.append({'id': m.id, 'date': int(m.date.timestamp()) if m.date else 0, 'size': m.file.size or 0,
                        'name': m.file.name or '', 'note': note if isinstance(note, dict) else {}})
        out.sort(key=lambda x: -x['date'])
        return out

    async def cloud_put(self, name, data, note):
        """uploads the file, then removes the older files of the same device (note['device'])"""
        import io
        buf = io.BytesIO(data)
        buf.name = name
        caption = '%s %s' % (self.CLOUD_TAG, json.dumps(note, ensure_ascii=False, sort_keys=True))
        msg = await self.client.send_file('me', buf, caption=caption[:1000], force_document=True, silent=True)
        old = [x['id'] for x in await self.cloud_list() if x['id'] != msg.id
               and (x['note'].get('device') == note.get('device'))]
        if old:
            await self.client.delete_messages('me', old)
        return {'id': msg.id, 'date': int(msg.date.timestamp()) if msg.date else int(time.time()), 'removed': len(old)}

    async def cloud_get(self, msg_id, limit=64 * 1024 * 1024):
        m = await self.client.get_messages('me', ids=int(msg_id))
        if not m or not m.file or not (m.message or '').startswith(self.CLOUD_TAG):
            raise TGError('no such setup file')
        if (m.file.size or 0) > limit:
            raise TGError('setup file too large')
        return await self.client.download_media(m, bytes)

    async def cloud_delete(self, ids):
        own = set(x['id'] for x in await self.cloud_list(100))
        ids = [int(i) for i in ids if int(i) in own]         # only setup files, never another message
        if ids:
            await self.client.delete_messages('me', ids)
        return len(ids)

    # 4.0.6: the login by phone, see tgauth.py. Every step answers with a dict - {'error': reason, ...} instead of
    # an exception - so the screen can let the viewer type again without asking Telegram for another code.
    def _auth(self):
        from . import tgauth
        if getattr(self, '_login_state', None) is None:
            self._login_state = tgauth.LoginState()
        return self._login_state

    async def _password_hint(self):
        try:
            from telethon import functions
            pw = await self.client(functions.account.GetPasswordRequest())
            return getattr(pw, 'hint', '') or ''
        except Exception:
            return ''

    async def send_code(self, phone, again=False):
        from . import tgauth
        st = self._auth()
        number = tgauth.normalize_phone(phone)
        if not number:
            return {'sent': False, 'error': 'phone_invalid'}
        if st.reusable(number) and not again:
            return dict(st.info, sent=True, reused=True, phone=number)
        if st.flood_left():
            return {'sent': False, 'error': 'flood', 'wait': st.flood_left()}
        try:
            sent = await self.client.send_code_request(number)
        except Exception as exc:
            info = tgauth.error_info(exc)
            if info['error'] == 'flood':
                st.flood(info.get('wait'))
            self.log('login: code request refused: %s' % info['detail'])
            return dict(info, sent=False)
        st.remember(number, sent.phone_code_hash, tgauth.sent_info(sent))
        self._login = {'phone': number, 'hash': sent.phone_code_hash}
        return dict(st.info, sent=True, phone=number)

    async def resend_code(self):
        """the next way Telegram offers for the same login (usually SMS after the in-app code)"""
        from . import tgauth
        st = self._auth()
        if not st.hash:
            return {'sent': False, 'error': 'code_expired'}
        if not st.can_resend():
            return {'sent': False, 'error': 'too_early' if st.info.get('next') else 'no_more_ways',
                    'wait': max(0, int((st.info.get('timeout') or 0) - (time.time() - st.sent_at)))}
        try:
            from telethon import functions
            sent = await self.client(functions.auth.ResendCodeRequest(st.phone, st.hash))
        except Exception as exc:
            info = tgauth.error_info(exc)
            if info['error'] == 'flood':
                st.flood(info.get('wait'))
            self.log('login: resend refused: %s' % info['detail'])
            return dict(info, sent=False)
        st.remember(st.phone, sent.phone_code_hash, tgauth.sent_info(sent))
        self._login = {'phone': st.phone, 'hash': sent.phone_code_hash}
        return dict(st.info, sent=True, phone=st.phone)

    async def sign_in(self, code):
        from . import tgauth
        st = self._auth()
        code = re.sub(r'\D', '', code or '')
        if not st.hash:
            return {'ok': False, 'error': 'code_expired'}
        if not code:
            return {'ok': False, 'error': 'code_invalid'}
        try:
            self.me = await self.client.sign_in(st.phone, code, phone_code_hash=st.hash)
        except Exception as exc:
            info = tgauth.error_info(exc)
            if info['error'] == 'password_needed':
                return {'ok': False, 'password': True, 'hint': await self._password_hint()}
            if info['error'] == 'code_expired':
                st.forget()
            if info['error'] == 'flood':
                st.flood(info.get('wait'))
            self.log('login: code refused: %s' % info['detail'])
            return dict(info, ok=False)
        st.forget()
        return {'ok': True}

    async def sign_in_password(self, password):
        from . import tgauth
        try:
            self.me = await self.client.sign_in(password=password)
        except Exception as exc:
            info = tgauth.error_info(exc)
            self.log('login: password refused: %s' % info['detail'])
            if info['error'] == 'password_invalid':
                info['hint'] = await self._password_hint()
            return dict(info, ok=False)
        self._auth().forget()
        return {'ok': True}

    async def qr_start(self):
        self._qr = await self.client.qr_login()
        return {'url': self._qr.url, 'expires': self._qr.expires.timestamp() if self._qr.expires else 0}

    async def qr_wait(self, timeout=5):
        from telethon.errors import SessionPasswordNeededError
        if not self._qr:
            return {'ok': False}
        try:
            self.me = await self._qr.wait(timeout)
            self._qr = None
            return {'ok': True}
        except asyncio.TimeoutError:
            if self._qr.expires and self._qr.expires.timestamp() < time.time() + 2:
                await self._qr.recreate()
                return {'ok': False, 'url': self._qr.url}
            return {'ok': False}
        except SessionPasswordNeededError:
            self._qr = None
            return {'ok': False, 'password': True, 'hint': await self._password_hint()}

    async def logout(self):
        await self.client.log_out()
        self.me = None
        await self.client.connect()
        return True

    # ------------------------------------------------------------------ helpers
    def _remember(self, msg):
        key = (msg.chat_id, msg.id)
        self._docs[key] = msg
        self._docs.move_to_end(key)
        while len(self._docs) > 500:           # 3.3: whole Message objects - 3000 of them is a lot on a 1 GB box
            self._docs.popitem(last=False)

    def _to_cand(self, msg):
        f = msg.file
        if f is None:
            return None
        chat = msg.chat
        title = ''
        if chat is not None:
            title = getattr(chat, 'title', None) or ' '.join(
                x for x in [getattr(chat, 'first_name', ''), getattr(chat, 'last_name', '')] if x)
        mime = f.mime_type or ''
        name = f.name or ''
        if not name and mime.startswith('video/'):
            name = 'video_%d.%s' % (msg.id, (f.ext or '.mp4').lstrip('.'))
        doc = getattr(msg.media, 'document', None)
        if doc is None and hasattr(msg.media, 'mime_type') and hasattr(msg.media, 'access_hash'):
            doc = msg.media                    # 3.3.3: a virtual message carries the document itself
        if not getattr(msg, 'virtual', False):
            self._remember(msg)
        if chat is None:
            kind = ''
        elif getattr(chat, 'bot', False):
            kind = 'bot'
        elif getattr(chat, 'broadcast', False):
            kind = 'channel'
        elif hasattr(chat, 'title'):
            kind = 'group'
        else:
            kind = 'user'
        return {
            'chat_kind': kind,
            'chat_id': msg.chat_id, 'msg_id': msg.id, 'file': name, 'size': f.size or 0, 'mime': mime,
            'duration': int(f.duration or 0) if getattr(f, 'duration', None) else 0,
            'width': getattr(f, 'width', 0) or 0, 'height': getattr(f, 'height', 0) or 0,
            'caption': msg.message or '', 'chat_title': title,
            'chat_username': getattr(chat, 'username', None) if chat is not None else None,
            'date': int(msg.date.timestamp()) if msg.date else 0,
            'doc_id': getattr(doc, 'id', None), 'is_video_attr': msg.video is not None,
        }

    # ------------------------------------------------------------------ search / browse
    async def search(self, query, limit=100, chats=None, kinds=None):
        """One unfiltered request per query (the way Telemedia searches): Telegram answers faster and is far
        less likely to rate-limit than with two filtered searches per query. Non-media hits are dropped here."""
        out = []

        async def one(entity, lim):
            async with self._search_sem:
                try:
                    async for msg in self.client.iter_messages(entity, search=query, limit=lim):
                        if msg.file is None:
                            continue
                        c = self._to_cand(msg)
                        if c:
                            out.append(c)
                except Exception as exc:
                    self.log('search %r in %s failed: %s' % (query, entity, exc))

        jobs = [one(None, limit)]
        # 3.3.3: `chats` may hold ids of joined chats (bot chats included) and @names of public channels the
        # account never joined - Telegram searches inside a public channel without a membership
        for chat in chats or []:
            jobs.append(one(self.ref(chat), max(20, limit // 3)))
        await asyncio.gather(*jobs)
        return out

    async def search_in(self, chat, query, limit=100):
        """3.3.5: the files of ONE chat that match the text. Inside a chat Telegram's search is complete; the search
        over all chats returns the newest hits only."""
        out = []
        async with self._search_sem:
            async for msg in self.client.iter_messages(self.ref(chat), search=query, limit=limit):
                if msg.file is None:
                    continue
                c = self._to_cand(msg)
                if c:
                    out.append(c)
        return out

    async def dialogs(self, limit=300, bots=True):
        """Channels, groups and - 3.3.3 - bots. A bot chat is where "request" bots leave their files; it used to be
        filtered out, so those files could be searched but never browsed and the bot could not be chosen."""
        res = []
        async for d in self.client.iter_dialogs(limit=limit):
            ent = d.entity
            is_bot = bool(d.is_user and getattr(ent, 'bot', False))
            if not (d.is_channel or d.is_group or (bots and is_bot)):
                continue
            if is_bot and getattr(ent, 'deleted', False):
                continue
            kind = 'bot' if is_bot else ('channel' if (d.is_channel and not d.is_group) else 'group')
            res.append({'id': d.id, 'title': d.name, 'username': getattr(ent, 'username', None),
                        'channel': kind == 'channel', 'kind': kind, 'unread': d.unread_count,
                        'inline': bool(getattr(ent, 'bot_inline_placeholder', None)) if is_bot else False,
                        'members': getattr(ent, 'participants_count', None)})
        return res

    async def chat_videos(self, chat_id, offset_id=0, limit=50, query=None):
        from telethon.tl import types
        out, last = [], 0
        chat_id = self.ref(chat_id)                # 3.3.3: also the @name of a public channel that was not joined
        async for msg in self.client.iter_messages(chat_id, limit=limit, offset_id=offset_id, search=query or None,
                                                   filter=types.InputMessagesFilterVideo()):
            c = self._to_cand(msg)
            last = msg.id
            if c:
                out.append(c)
        if len(out) < limit // 2:  # many channels post mkv as plain documents
            async for msg in self.client.iter_messages(chat_id, limit=limit, offset_id=offset_id,
                                                       search=query or None,
                                                       filter=types.InputMessagesFilterDocument()):
                c = self._to_cand(msg)
                if c and (c['mime'].startswith('video/') or re.search(r'\.(mkv|mp4|avi|m4v|webm|ts)$', c['file'], re.I)):
                    if not any(x['msg_id'] == c['msg_id'] for x in out):
                        out.append(c)
                last = min(last or msg.id, msg.id)
        out.sort(key=lambda c: c['msg_id'], reverse=True)
        return {'items': out, 'next': last if len(out) >= limit // 2 else 0}

    async def join(self, link):
        from telethon.tl.functions.channels import JoinChannelRequest
        from telethon.tl.functions.messages import ImportChatInviteRequest
        link = link.strip()
        m = re.search(r'(?:joinchat/|/\+|^\+)([\w-]+)', link)
        if m:
            await self.client(ImportChatInviteRequest(m.group(1)))
        else:
            name = re.sub(r'^(?:https?://)?(?:t\.me/|telegram\.me/)?@?', '', link).split('/')[0]
            await self.client(JoinChannelRequest(name))
        return True

    async def leave(self, chat_id):
        await self.client.delete_dialog(chat_id)
        return True

    @staticmethod
    def ref(value):
        from .tgbots import ref
        return ref(value)

    @staticmethod
    def _found_row(ent, mine, hits):
        """One search hit (channel / group / bot) as a plain row, or None for what must never be offered."""
        from telethon import utils
        if getattr(ent, 'scam', False) or getattr(ent, 'fake', False) or getattr(ent, 'deleted', False):
            return None
        if getattr(ent, 'restricted', False) and getattr(ent, 'restriction_reason', None):
            return None
        is_bot = bool(getattr(ent, 'bot', False))
        if not is_bot and not hasattr(ent, 'title'):
            return None                                            # a person
        try:
            pid = utils.get_peer_id(ent)
        except Exception:
            pid = getattr(ent, 'id', 0)
        if is_bot:
            title = ' '.join(x for x in [getattr(ent, 'first_name', ''), getattr(ent, 'last_name', '')] if x)
            kind, joined = 'bot', pid in mine
            members = getattr(ent, 'bot_active_users', None)
        else:
            title = getattr(ent, 'title', '') or ''
            kind = 'channel' if getattr(ent, 'broadcast', False) else 'group'
            joined = (pid in mine) or (hasattr(ent, 'left') and not getattr(ent, 'left', True))
            members = getattr(ent, 'participants_count', None)
        return {'id': pid, 'title': title, 'username': getattr(ent, 'username', None), 'kind': kind,
                'channel': kind == 'channel', 'members': members, 'joined': bool(joined),
                'verified': bool(getattr(ent, 'verified', False)), 'hits': hits,
                'inline': bool(getattr(ent, 'bot_inline_placeholder', None)) if is_bot else False}

    async def discover(self, query, limit=40):
        """Public channels, groups and bots for a text. 3.3.3: several wordings at once (a list of queries), bots
        are returned too (they were dropped), scam / fake / restricted chats never are, every row says whether the
        account is already in it, and the rows come ranked: found by more wordings first, then by audience."""
        from telethon import utils
        from telethon.tl.functions.contacts import SearchRequest
        queries = [query] if not isinstance(query, (list, tuple)) else list(query)
        queries = [q for q in queries if q and len(q.strip()) >= 2][:5]

        async def one(q):
            async with self._search_sem:
                try:
                    return await self.client(SearchRequest(q=q, limit=limit))
                except Exception as exc:
                    self.log('discover %r failed: %s' % (q, exc))
                    return None
        rows = {}
        for res in await asyncio.gather(*[one(q) for q in queries]):
            if res is None:
                continue
            mine = set()
            for peer in getattr(res, 'my_results', None) or []:
                try:
                    mine.add(utils.get_peer_id(peer))
                except Exception:
                    pass
            for ent in list(getattr(res, 'chats', None) or []) + list(getattr(res, 'users', None) or []):
                row = self._found_row(ent, mine, 1)
                if row is None:
                    continue
                if row['id'] in rows:
                    rows[row['id']]['hits'] += 1
                    rows[row['id']]['joined'] = rows[row['id']]['joined'] or row['joined']
                else:
                    rows[row['id']] = row
        out = list(rows.values())
        out.sort(key=lambda r: (r['joined'], -r['hits'], -(r['members'] or 0), not r['username']))
        return out

    async def similar(self, chats, limit=60):
        """3.3.3: channels Telegram itself recommends next to the given ones ("similar channels"). Channels that
        several of the user's channels point to come first."""
        from telethon.tl.functions.channels import GetChannelRecommendationsRequest
        rows = {}
        for chat in list(chats)[:8]:
            try:
                res = await self.client(GetChannelRecommendationsRequest(
                    channel=await self.client.get_input_entity(self.ref(chat))))
            except Exception as exc:
                self.log('similar %s failed: %s' % (chat, exc))
                continue
            for ent in getattr(res, 'chats', None) or []:
                row = self._found_row(ent, (), 1)
                if row is None or row['joined']:
                    continue
                if row['id'] in rows:
                    rows[row['id']]['hits'] += 1
                else:
                    rows[row['id']] = row
            await asyncio.sleep(0.2)
        out = sorted(rows.values(), key=lambda r: (-r['hits'], -(r['members'] or 0)))
        return out[:limit]

    # ------------------------------------------------------------------ bots (3.3.3)
    def bot_lock(self, bot_id):
        """One conversation at a time with one bot - two requests in the same chat would read each other's answers."""
        lock = self._bot_locks.get(bot_id)
        if lock is None:
            lock = self._bot_locks[bot_id] = asyncio.Lock()
        return lock

    def virtual(self, chat, document, text=''):
        """A file that exists without a message (the answer of an inline bot)."""
        try:
            from telethon.tl.custom.file import File
            self._virtual_seq += 1
            m = _Virtual(1900000000 + self._virtual_seq, chat, document, File(document), text)
        except Exception as exc:
            self.log('virtual file failed: %r' % exc)
            return None
        self._virtual[(m.chat_id, m.id)] = m
        while len(self._virtual) > 300:
            self._virtual.popitem(last=False)
        return m

    async def bot_ask(self, bot, queries, timeout=14.0, clicks=5, rank=None, autojoin=False, inline=True):
        from . import tgbots
        if not isinstance(queries, (list, tuple)):
            queries = [queries]
        jobs = [tgbots.ask_many(self, bot, list(queries), timeout, clicks, rank, autojoin)]
        if inline:
            jobs.append(tgbots.inline(self, bot, queries[0], timeout=min(6.0, timeout)))
        got = await asyncio.gather(*jobs)
        res = got[0]
        if len(got) > 1 and got[1]:
            known = set(c.get('doc_id') for c in res['files'])
            res['files'] += [c for c in got[1] if c.get('doc_id') not in known]
            res['inline'] = len(got[1])
        return res

    async def bots_with_videos(self, ids):
        from . import tgbots
        return await tgbots.with_videos(self, ids)

    # ------------------------------------------------------------------ files
    async def get_message(self, chat_id, msg_id, refresh=False):
        key = (int(chat_id), int(msg_id))
        if key in self._virtual:
            if refresh:
                raise TGError('inline file expired - search again')
            return self._virtual[key]
        if not refresh and key in self._docs:
            return self._docs[key]
        msg = await self.client.get_messages(int(chat_id), ids=int(msg_id))
        if not msg or not msg.file:
            raise TGError('message not found')
        self._remember(msg)
        return msg

    async def file_info(self, chat_id, msg_id):
        msg = await self.get_message(chat_id, msg_id)
        return self._to_cand(msg)

    # ---- 3.3.1: pacing. Telegram answers too many file requests at once with FLOOD_WAIT (seconds to tens of
    # seconds). Eight requests were always sent side by side; every one that hit the limit slept by itself while
    # the others kept asking - and kept the limit alive, so the picture froze again every few seconds. Now a
    # flood wait closes one shared gate for everybody, and the number of requests sent side by side is halved
    # (never below 2) and grows back by one for every 40 parts that came through cleanly.
    #
    # 3.3.5, measured against a real (non-Premium) account:
    #   * a part of a file that nobody read lately arrives at about 4.3 MB/s, however it is asked for: 2.2 MB/s with
    #     one request at a time, 3.8 with two, 4.2 with four, 4.3 with eight or twelve - on ONE connection. More
    #     connections add nothing.
    #   * parts that were read a moment ago (the player opening a file reads its start, its end and its start again;
    #     a jump back) arrive at 7-9 MB/s - and THAT is what Telegram answers with FLOOD_WAIT: the account is held to
    #     an average rate, and every wait is 1-3 s without a single byte.
    #   * requests that were cancelled after a seek are still answered by the server. They were not counted, so the
    #     real load right after the player opened a file or jumped was twice the counted one.
    # So: (1) one counter of what is really on the wire - a cancelled request keeps its slot until its answer came,
    # and in the queue in front of it a cancelled request costs nothing; (2) the part a player is blocked on jumps
    # that queue; (3) after a flood wait the engine paces itself: it keeps to three quarters of the rate that was
    # refused and feels its way up again slowly, so the stream runs evenly instead of fast - stop - fast.
    def _pace_init(self):
        if not hasattr(self, '_cap'):
            # 4 on the wire reach the full speed; more only makes every single answer slower (they share the same
            # stream), which is felt as a longer wait after a jump
            self._cap_max = max(3, min(8, self.parallel))
            self._cap = self._cap_max
            self._ceiling = self._cap_max
            self._ceiling_at = 0.0
            self._running = 0
            self._gate = 0.0
            self._gate_timer = None
            self._clean = 0
            self._seq = 0
            self._waitq = []              # [priority, sequence, future, chunk key, bytes]
            self._urgent = set()          # chunk keys a player is blocked on right now
            # bytes/s we allow ourselves (0 = no limit). A non-Premium account starts at the rate such accounts are
            # allowed over time: without it the very first seconds of a film (data Telegram has "warm" comes at
            # 7-9 MB/s) ran into a flood wait - a 2-3 s freeze right after the picture appeared.
            premium = bool(getattr(getattr(self, 'me', None), 'premium', False))
            self._rate = float(getattr(self, 'rate_hint', 0) or (0 if premium else self.RATE_FIRST))
            self._dropped = set()         # chunk keys given up after a seek before their parts were queued
            self._low = set()             # chunk keys of connections the player left behind: served last
            self._rate_at = time.time()
            self._tokens = 0.0
            self._tok_at = time.time()
            self._rate_timer = None
            self._recent = collections.deque(maxlen=96)                # (time, bytes) of the answers
            self.floods = 0

    RATE_MIN = 3.0 * 1048576             # a 1080p film needs 1-2 MB/s; slower than this helps nobody
    RATE_FIRST = 4.5 * 1048576            # measured: what a non-Premium account gets over time
    HEDGE_AFTER = 3.0                     # s without an answer for the chunk a player waits for -> asked twice
    RATE_FREE = 12 * 1048576              # paced above this = no pacing

    def sustained_rate(self):
        """bytes per second the account is being served over time; 0 = not limited (Premium, nothing refused yet)"""
        self._pace_init()
        if self._rate:
            return max(self._rate, self.RATE_MIN)
        premium = bool(getattr(getattr(self, 'me', None), 'premium', False))
        return 0 if premium else self.RATE_FIRST

    def pace_info(self):
        self._pace_init()
        return {'on_wire': self._running, 'waiting': len(self._waitq), 'urgent': len(self._urgent),
                'limit': self._cap, 'rate_mb': round(self._rate / 1048576.0, 2), 'floods': self.floods,
                'asked_twice': getattr(self, 'hedges', 0)}

    def _recent_rate(self, window=4.0):
        if not self._recent:
            return 0.0
        end = self._recent[-1][0]                 # up to the last answer: a closed gate is not "slow"
        rows = [r for r in self._recent if end - r[0] <= window]
        if len(rows) < 3:
            return 0.0
        return sum(r[1] for r in rows[1:]) / max(0.3, end - rows[0][0])

    def _flood(self, seconds):
        self._pace_init()
        self.floods += 1
        now = time.time()
        burst = now < self._gate                  # the gate is already closed: the same burst answers again
        self._gate = max(self._gate, now + seconds + 0.5)
        self._clean = 0
        old = self._cap
        if not burst:
            seen = self._recent_rate()
            at_floor = bool(self._rate) and self._rate <= self.RATE_MIN + 1
            new = 0.75 * seen if seen else (0.75 * self._rate if self._rate else 3.0 * 1048576)
            if self._rate:
                new = min(new, 0.85 * self._rate)
            else:
                new = min(new, self.RATE_FIRST)   # the first refusal: straight to what such accounts are allowed
            self._rate = max(self.RATE_MIN, new)
            self._rate_at = now
            self._tokens = 0.0
            self._tok_at = self._gate
            if at_floor:
                # the pace is what answers a flood wait; fewer requests side by side only make every answer
                # slower. They are cut only when even a slow pace is refused.
                self._ceiling = max(3, self._cap - 1)
                self._cap = self._ceiling
            getattr(self, 'info', self.log)(
                'Telegram asked to wait %ss (flood limit) at %.1f MB/s: paced to %.1f MB/s, %d -> %d requests side by side' % (
                    seconds, seen / 1048576.0, self._rate / 1048576.0, old, self._cap))
            hook = getattr(self, 'on_rate', None)
            if hook:
                try:
                    hook(self._rate)
                except Exception:
                    pass
        self._ceiling_at = now

    def _pump(self):
        """hands free slots to the waiting requests: a part somebody is blocked on first, then by arrival"""
        now = time.time()
        loop = getattr(self, 'loop', None) or asyncio.get_event_loop()
        if now < self._gate:
            if self._gate_timer is None:
                self._gate_timer = loop.call_later(self._gate - now + 0.02, self._gate_open)
            return
        if self._rate:
            self._tokens = min(2 * 1048576.0, self._tokens + max(0.0, now - self._tok_at) * self._rate)
            self._tok_at = now
        while self._waitq:
            item = min(self._waitq, key=lambda it: (0 if it[3] in self._urgent else (3 if it[3] in self._low else it[0]),
                                                    it[1]))
            urgent = item[3] in self._urgent
            # the chunk a player is blocked on may go out next to a full wire (two extra requests are far below
            # what Telegram refuses): it must not wait for read-ahead of a position the player has left
            # ... and a link test is a 128 KB sample: a dozen of them next to each other is nothing (they used to
            # queue four at a time - 6 s for 13 links)
            small = item[0] >= 2 and 0 < item[4] <= 131072
            if self._running >= self._cap + (2 if urgent else (6 if small else 0)):
                break
            if self._rate and self._tokens <= 0.0:
                # the budget of this moment is spent: continue when it is back. (No borrowing for the waited-for
                # chunk: a player that reads without a pause always waits for one, the debt never ended and the
                # read-ahead got nothing - one chunk at a time, 1.5 MB/s. The budget holds 2 MB, enough for the
                # chunk after a jump to leave at once; being first in the queue is its whole privilege.)
                if self._rate_timer is None:
                    self._rate_timer = loop.call_later(max(0.02, -self._tokens / self._rate + 0.01), self._rate_open)
                break
            self._waitq.remove(item)
            if item[2].done():
                continue
            self._running += 1
            if self._rate:
                self._tokens -= item[4]
            item[2].set_result(True)

    def _gate_open(self):
        self._gate_timer = None
        self._pump()

    def _rate_open(self):
        self._rate_timer = None
        self._pump()

    def bump(self, key, on=True):
        """called from the HTTP threads: a player waits for this chunk (on) / no longer does (off)"""
        if not self.loop:
            return

        def apply():
            self._pace_init()
            if on:
                self._urgent.add(key)
                self._low.discard(key)
                self._pump()
            else:
                self._urgent.discard(key)
        try:
            self.loop.call_soon_threadsafe(apply)
        except RuntimeError:
            pass

    def lower(self, key):
        """called from the HTTP threads: this chunk is for a connection the player has left behind (after a jump it
        keeps the old one open and goes on reading it slowly). It is fetched after everything the live picture
        needs - three connections used to share the stream equally and the picture got a third of it."""
        if not self.loop:
            return

        def apply():
            self._pace_init()
            if len(self._low) > 400:
                self._low.clear()
            self._low.add(key)
        try:
            self.loop.call_soon_threadsafe(apply)
        except RuntimeError:
            pass

    def drop(self, key):
        """called from the HTTP threads after a seek: the parts of this chunk that still WAIT are given up. What is
        already on the wire is left to finish - Telegram sends it anyway, and the chunk then lands in the cache
        (a player that opens a file reads the start, the end and the start again)."""
        if not self.loop:
            return

        def apply():
            self._pace_init()
            self._dropped.add(key)        # ... and parts of it that are queued a moment later are refused as well
            if len(self._dropped) > 400:
                self._dropped.clear()
            for item in [it for it in self._waitq if it[3] == key]:
                item[2].cancel()
        try:
            self.loop.call_soon_threadsafe(apply)
        except RuntimeError:
            pass

    async def _slot(self, prio, key, size=0):
        self._pace_init()
        if key is not None and key in self._dropped and key not in self._urgent:
            raise asyncio.CancelledError()
        self._seq += 1
        fut = asyncio.get_event_loop().create_future()
        item = [prio, self._seq, fut, key, size]
        self._waitq.append(item)
        self._pump()
        try:
            await fut
        except asyncio.CancelledError:
            if item in self._waitq:
                self._waitq.remove(item)          # never sent: costs nothing
            elif fut.done() and not fut.cancelled():
                self._running -= 1                # the slot had just been granted
                self._tokens += size
                self._pump()
            raise

    async def _read_part(self, msg, offset, size, took=None, prio=1, key=None):
        await self._slot(prio, key, size)
        # from here on the request is on the wire: if the caller is cancelled (a seek) the request still runs to its
        # end in the background and keeps its slot until then - that is what Telegram counts
        task = self._spawn(self._on_wire(msg, offset, size, took))
        if key is None:
            return await asyncio.shield(task)
        # the chunk of a player: now and then Telegram takes many seconds for one answer (measured: 7 s and 15 s
        # for a single part while the neighbours took 0.4 s). If a player is blocked on it, the same part is asked
        # for a second time and whichever answer comes first is used.
        done, _ = await asyncio.wait({task}, timeout=self.HEDGE_AFTER)
        if done:
            return task.result()
        if key not in self._urgent:
            return await asyncio.shield(task)
        self.hedges = getattr(self, 'hedges', 0) + 1
        getattr(self, 'info', self.log)('no answer for %.0fs for the part the player waits for (chunk %s): asked again' % (
            self.HEDGE_AFTER, key[2]))
        self._running += 1
        second = self._spawn(self._on_wire(msg, offset, size, None))
        pending = {task, second}
        last_exc = None
        while pending:
            done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
            for d in done:
                if d.cancelled():
                    continue
                if d.exception() is None:
                    return d.result()
                last_exc = d.exception()
        if last_exc is not None:
            raise last_exc
        raise asyncio.CancelledError()

    def _spawn(self, coro):
        """A request on the wire runs as its own task. The loop keeps only a weak reference to a task: once the
        caller was cancelled (a seek, a link test that ran out of time) nothing held it any more, Python could
        throw it away half-way ("Task was destroyed but it is pending") and its slot was given back from whatever
        thread did the cleaning. The engine holds it until it is done."""
        if not hasattr(self, '_tasks'):
            self._tasks = set()
        task = asyncio.ensure_future(coro)
        self._tasks.add(task)

        def done(t):
            self._tasks.discard(t)
            t.cancelled() or t.exception()
        task.add_done_callback(done)
        return task

    async def _lag_watch(self):
        """3.3.5: this loop shares Kodi's Python lock with every other add-on. When one of them keeps it for seconds
        the stream stands still although Telegram answers - the log then says so, instead of leaving a mystery."""
        told = 0.0
        while True:
            t = time.time()
            await asyncio.sleep(0.5)
            lag = time.time() - t - 0.5
            if lag > 1.5 and time.time() - told > 10:
                told = time.time()
                getattr(self, 'info', self.log)('the engine was held up for %.1fs (Kodi or another add-on kept Python busy)' % lag)

    async def _on_wire(self, msg, offset, size, took):
        t0 = time.time()
        try:
            data = await self._read_part_now(msg, offset, size, took)
            now = time.time()
            if now - t0 > 4 and size > 131072:        # (a link test of a file nobody opened lately is often slow)
                getattr(self, 'info', self.log)('slow answer from Telegram: %.1fs for one part at %d MB (%d on the wire, %d waiting)' % (
                    now - t0, offset // 1048576, self._running, len(self._waitq)))
            self._recent.append((now, len(data or b'')))
            if self._rate and now - self._rate_at > 10:
                # 10 s without a flood wait: a little faster is tried; far above anything Telegram refused the
                # pacing is switched off again
                self._rate += 262144
                self._rate_at = now
                if self._rate >= self.RATE_FREE:
                    self._rate = 0.0
            return data
        finally:
            self._running -= 1
            self._pump()
    async def _read_part_now(self, msg, offset, size, took=None):
        from telethon import errors
        t0 = time.time()
        try:
            async for data in self.client.iter_download(msg.media, offset=offset, request_size=size,
                                                        chunk_size=size, limit=1):
                self._clean += 1
                if self._clean >= 60:
                    self._clean = 0
                    if self._ceiling < self._cap_max and time.time() - self._ceiling_at > 900:
                        self._ceiling += 1        # a quarter of an hour without a flood wait: one more is tried
                        self._ceiling_at = time.time()
                    if self._cap < self._ceiling:
                        self._cap += 1
                return bytes(data)
        except errors.FloodWaitError as exc:
            self._flood(int(getattr(exc, 'seconds', 5) or 5))
            raise
        finally:
            if took is not None:      # 3.3: seconds of the download itself (no queueing)
                took.append(time.time() - t0)
        return b''

    async def read_head(self, chat_id, msg_id, size=131072, timed=False):
        """First bytes of a file (link test): one small request, cheap even with slow crypto.
        3.3: timed=True returns (data, seconds the download itself took)."""
        from telethon import errors
        took = []
        msg = await self.get_message(chat_id, msg_id)
        try:
            data = await self._read_part(msg, 0, size, took, prio=2)
        except errors.FileReferenceExpiredError:
            msg = await self.get_message(chat_id, msg_id, refresh=True)
            del took[:]
            data = await self._read_part(msg, 0, size, took, prio=2)
        except errors.FloodWaitError as exc:
            if exc.seconds > 8:
                raise
            del took[:]                    # 3.3.5: a short flood wait is not a dead link - once more behind the gate
            data = await self._read_part(msg, 0, size, took, prio=2)
        return (data, took[-1] if took else 0.0) if timed else data

    async def read_chunk(self, chat_id, msg_id, index, chunk=CHUNK):
        """Download chunk #index (1 MiB aligned) as two concurrent 512 KiB requests (Telethon clamps
        request_size to 512 KiB).  Retries reference expiry, flood waits and transient errors."""
        from telethon import errors
        attempt = 0
        refresh = False
        while True:
            attempt += 1
            msg = await self.get_message(chat_id, msg_id, refresh=refresh)
            try:
                base = index * chunk
                size = (msg.file.size if msg.file else 0) or 0
                if size and base >= size:
                    return b''
                key = (int(chat_id), int(msg_id), int(index))
                if attempt == 1:
                    self._pace_init()
                    self._dropped.discard(key)     # a new request for this chunk: an older "given up" is void
                if size and base + PART >= size:
                    return await self._read_part(msg, base, PART, key=key)
                parts = await asyncio.gather(self._read_part(msg, base, PART, key=key),
                                             self._read_part(msg, base + PART, PART, key=key))
                if len(parts[0]) < PART:   # end of file reached inside the first half
                    return parts[0]
                return parts[0] + parts[1]
            except errors.FileReferenceExpiredError:
                refresh = True
            except errors.FloodWaitError as exc:
                if exc.seconds > 60 or attempt > 3:
                    raise
                # 3.3.1: the shared gate (see _flood) already holds every request back for exc.seconds - no
                # extra sleep here, the retry simply queues at the gate with the others
                pass
            except (ConnectionError, asyncio.TimeoutError, OSError) as exc:
                if attempt > 3:
                    raise
                self.log('chunk %s retry: %s' % (index, exc))
                await asyncio.sleep(0.5 * attempt)
            if attempt > 4:
                raise TGError('chunk %d failed' % index)
