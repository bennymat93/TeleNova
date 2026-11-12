# -*- coding: utf-8 -*-
"""Telethon (MTProto) wrapper living inside the Kodi service.

A dedicated asyncio loop runs in a background thread; the HTTP proxy / RPC threads submit
coroutines with run()/submit().  Everything Telegram-specific is kept here so that the rest
of the add-on can be tested with a fake client.
"""
import asyncio
import collections
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
        return True

    async def reconnect(self):
        """3.3: called by the service's watchdog when the client is found disconnected."""
        if not self.client.is_connected():
            await self.client.connect()
        if self.me is None and await self.client.is_user_authorized():
            self.me = await self.client.get_me()
        return True

    def stop(self):
        if self.loop and self.client:
            try:
                self.run(self.client.disconnect(), 10)
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

    async def send_code(self, phone):
        phone = re.sub(r'[^\d+]', '', phone)
        sent = await self.client.send_code_request(phone)
        self._login = {'phone': phone, 'hash': sent.phone_code_hash}
        return {'sent': True, 'type': type(sent.type).__name__}

    async def sign_in(self, code):
        from telethon.errors import SessionPasswordNeededError
        try:
            self.me = await self.client.sign_in(self._login['phone'], code.strip(),
                                                phone_code_hash=self._login['hash'])
            return {'ok': True}
        except SessionPasswordNeededError:
            return {'ok': False, 'password': True}

    async def sign_in_password(self, password):
        self.me = await self.client.sign_in(password=password)
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
            return {'ok': False, 'password': True}

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
    def _pace_init(self):
        if not hasattr(self, '_cap'):
            self._cap_max = self.parallel * 2
            self._cap = self._cap_max
            self._running = 0
            self._gate = 0.0
            self._clean = 0
            self.floods = 0

    def _flood(self, seconds):
        self._pace_init()
        self.floods += 1
        self._gate = max(self._gate, time.time() + seconds + 0.5)
        self._clean = 0
        new = max(2, self._cap // 2)
        if new != self._cap or seconds >= 3:
            getattr(self, 'info', self.log)('Telegram asked to wait %ss (flood limit): %d -> %d requests side by side' % (
                seconds, self._cap, new))
        self._cap = new

    async def _read_part(self, msg, offset, size, took=None):
        self._pace_init()
        while self._running >= self._cap or time.time() < self._gate:
            await asyncio.sleep(0.05)
        self._running += 1
        try:
            return await self._read_part_now(msg, offset, size, took)
        finally:
            self._running -= 1

    async def _read_part_now(self, msg, offset, size, took=None):
        from telethon import errors
        async with self._dl_sem:
            t0 = time.time()
            try:
                async for data in self.client.iter_download(msg.media, offset=offset, request_size=size,
                                                            chunk_size=size, limit=1):
                    self._clean += 1
                    if self._clean >= 40 and self._cap < self._cap_max:
                        self._cap += 1
                        self._clean = 0
                    return bytes(data)
            except errors.FloodWaitError as exc:
                self._flood(int(getattr(exc, 'seconds', 5) or 5))
                raise
            finally:
                if took is not None:      # 3.3: seconds of the download itself (no queueing for the semaphore)
                    took.append(time.time() - t0)
        return b''

    async def read_head(self, chat_id, msg_id, size=131072, timed=False):
        """First bytes of a file (link test): one small request, cheap even with slow crypto.
        3.3: timed=True returns (data, seconds the download itself took)."""
        from telethon import errors
        took = []
        msg = await self.get_message(chat_id, msg_id)
        try:
            data = await self._read_part(msg, 0, size, took)
        except errors.FileReferenceExpiredError:
            msg = await self.get_message(chat_id, msg_id, refresh=True)
            del took[:]
            data = await self._read_part(msg, 0, size, took)
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
                if size and base + PART >= size:
                    return await self._read_part(msg, base, PART)
                parts = await asyncio.gather(self._read_part(msg, base, PART),
                                             self._read_part(msg, base + PART, PART))
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
