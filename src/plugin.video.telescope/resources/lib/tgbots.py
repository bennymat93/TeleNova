# -*- coding: utf-8 -*-
"""3.3.3: talking to Telegram bots that hand out files only when asked.

A search in Telegram finds what is already lying in the account's chats. A "request" bot has nothing lying there:
it answers a typed title with a list of buttons, a button with a file, or with a link to a second ("file store")
bot that sends the file after /start <code>. ask() does what a person does in that chat, in order:

  1. writes the title (after /start when the bot was never opened),
  2. reads every answer - also answers the bot EDITS in place (result pages),
  3. takes video files as they arrive,
  4. presses the buttons whose text fits the wanted title best (rank()), follows t.me/<bot>?start=<code> links and
     t.me/<channel>/<message> links, a few of each,
  5. notes "join this channel first" demands instead of guessing (joins them only when the user allowed it),
  6. stops when the bot went quiet, or at the time limit.

All coroutines here run on the Telegram loop of tgclient.TG. Nothing in this module knows about Kodi.
"""
import asyncio
import re
import time

VIDEO_EXT = re.compile(r'\.(mkv|mp4|avi|m4v|webm|ts|mov|wmv|mpg|mpeg|flv)$', re.I)

# bots that are tools of Telegram itself / of chat management - never asked for films
SYSTEM_BOTS = set('''botfather spambot stickers gif vid pic bing wiki imdb youtube bold telegram notoscam premiumbot
donate wallet like vote gamee replies channel_bot groupanonymousbot discussbot botsupport stars verifybot
quizbot pollbot storebot gmailbot ifttt combot rose missrose_bot shieldy_bot grouphelpbot controllerbot
livegrambot manybot chatgpt cryptobot durov username_bot fragment tonkeeper jobs_bot'''.split())

_NAV = re.compile(u'^[\\W_]*(?:next|prev|previous|back|close|cancel|page|pages|more|menu|home|help|about|settings|'
                  u'language|share|donate|report|start|search|'
                  u'הבא|הקודם|חזרה|סגור|'
                  u'ביטול|עוד|תפריט|עזרה|'
                  u'שתף|דווח|'
                  u'далее|назад|закрыть|'
                  u'отмена|ещё|меню|'
                  u'помощь)[\\W_]*$', re.I | re.U)
_PAGE = re.compile(r'^[\W_]*\d+\s*(?:/|of)\s*\d+[\W_]*$', re.I | re.U)
_NEXT = re.compile(u'next|הבא|עוד|далее|ещё|'
                   u'➡|»|›|>>|⏩|▶', re.I | re.U)
_JOIN = re.compile(u'join|subscribe|הצטרף|להצטרף|'
                   u'הצטרפו|מנוי|'
                   u'подпис|вступ', re.I | re.U)
_RETRY = re.compile(u'try again|retry|joined|i.?ve joined|refresh|check|נסה שוב|'
                    u'הצטרפתי|בדוק|רענן|'
                    u'провер|подписался|'
                    u'ещё раз|✅|\U0001f504', re.I | re.U)
_URL = re.compile(r'(?:https?://|tg://)[^\s<>"\')\]]+|(?<![\w/@.])t\.me/[^\s<>"\')\]]+', re.I)


def ref(value):
    """A chat reference from a setting / URL parameter: numeric id -> int, anything else -> user name without '@'."""
    text = str(value).strip()
    if re.match(r'^-?\d+$', text):
        return int(text)
    text = re.sub(r'^(?:https?://)?(?:t\.me/|telegram\.me/)', '', text, flags=re.I)
    return text.lstrip('@').split('/')[0].split('?')[0]


def tme(url):
    """What a Telegram link asks for:
    ('start', bot, code) | ('msg', channel, message id) | ('join', link) | None for anything outside Telegram."""
    url = (url or '').strip()
    m = re.match(r'^tg://resolve\?(.+)$', url, re.I)
    if m:
        q = dict(x.split('=', 1) for x in m.group(1).split('&') if '=' in x)
        if q.get('domain') and q.get('start'):
            return ('start', q['domain'], q['start'])
        if q.get('domain') and (q.get('post') or '').isdigit():
            return ('msg', q['domain'], int(q['post']))
        return ('join', 'https://t.me/' + q['domain']) if q.get('domain') else None
    m = re.match(r'^(?:https?://)?(?:www\.)?(?:t|telegram)\.me/(.+)$', url, re.I)
    if not m:
        return None
    path, _, query = m.group(1).partition('?')
    parts = [x for x in path.split('/') if x]
    if not parts:
        return None
    args = dict(x.split('=', 1) for x in query.split('&') if '=' in x)
    if parts[0].startswith('+') or parts[0] == 'joinchat':
        return ('join', 'https://t.me/' + '/'.join(parts[:2]))
    if parts[0] == 'c' and len(parts) >= 3 and parts[1].isdigit() and parts[-1].isdigit():
        return ('msg', int('-100' + parts[1]), int(parts[-1]))
    if parts[0] in ('s', 'share', 'addstickers', 'proxy', 'socks', 'iv', 'addlist', 'boost', 'login', 'setlanguage'):
        return None
    if not re.match(r'^[A-Za-z][\w]{3,31}$', parts[0]):
        return None
    if args.get('start'):
        return ('start', parts[0], args['start'])
    if len(parts) >= 2 and parts[-1].isdigit():
        return ('msg', parts[0], int(parts[-1]))
    if len(parts) == 1 and not args:
        return ('join', 'https://t.me/' + parts[0])
    return None


def is_video(msg):
    f = getattr(msg, 'file', None)
    if f is None:
        return False
    mime = (f.mime_type or '').lower()
    return mime.startswith('video/') or bool(VIDEO_EXT.search(f.name or '')) or getattr(msg, 'video', None) is not None


def is_system_bot(username):
    return (username or '').lower() in SYSTEM_BOTS


def _default_rank(query):
    words = set(w for w in re.findall(r'\w+', (query or '').lower(), re.U) if len(w) > 1)

    def rank(text):
        got = set(re.findall(r'\w+', (text or '').lower(), re.U))
        if not words:
            return 0.0
        return len(words & got) / float(len(words))
    return rank


class _Talk(object):
    """One request to one bot (and to the file-store bots it sends us to)."""

    def __init__(self, tg, query, rank, clicks, autojoin, res):
        self.tg = tg
        self.client = tg.client
        self.query = query
        self.rank = rank or _default_rank(query)
        self.left = int(clicks)
        self.autojoin = autojoin
        self.res = res
        self.watch = {}          # peer id -> [entity, newest message id already read]
        self.seen = {}           # (peer id, message id) -> signature (bots edit their answers)
        self.actions = []        # [priority, order, kind, payload, label]
        self.done = set()
        self.order = 0
        self.retry = None        # the "I joined - try again" button of a bot that demands a channel
        self.files = {}
        self.joined = False
        self._joins, self._content = [], False

    # ---------------------------------------------------------------- reading
    @staticmethod
    def _sig(m):
        rows = getattr(m, 'buttons', None) or []
        return (getattr(m, 'edit_date', None), len(getattr(m, 'message', '') or ''),
                tuple(getattr(b, 'text', '') for row in rows for b in row))

    async def poll(self):
        fresh = 0
        for pid, slot in list(self.watch.items()):
            ent, floor = slot
            try:
                msgs = await self.client.get_messages(ent, min_id=floor, limit=40)
            except Exception as exc:
                self.tg.log('bot poll failed: %s' % exc)
                continue
            for m in sorted(msgs or [], key=lambda x: x.id):
                if getattr(m, 'out', False):
                    continue
                sig = self._sig(m)
                if self.seen.get((pid, m.id)) == sig:
                    continue
                self.seen[(pid, m.id)] = sig
                fresh += 1
                try:
                    self.handle(m)
                except Exception as exc:
                    self.tg.log('bot answer skipped: %r' % exc)
        return fresh

    def add_file(self, m):
        if not is_video(m):
            return False
        c = self.tg._to_cand(m)
        if not c:
            return False
        key = c.get('doc_id') or (c['chat_id'], c['msg_id'])
        if key not in self.files:
            c['via_bot'] = (self.res.get('bot') or {}).get('username') or (self.res.get('bot') or {}).get('title') or ''
            c['chat_kind'] = 'bot'
            self.files[key] = c
            self.res['files'].append(c)
        return True

    def handle(self, m):
        self.res['answered'] = True
        text = getattr(m, 'message', '') or ''
        has_file = self.add_file(m)
        self._joins, self._content = [], False
        try:
            self._handle(m, text, has_file)
        finally:
            # "Join our channel" next to a download button is an advert; alone in an answer it is a demand
            if not has_file and not self._content:
                for link in self._joins:
                    if link not in self.res['join']:
                        self.res['join'].append(link)

    def _handle(self, m, text, has_file):
        base = self.rank(text[:300]) if text else 0.0
        callbacks = []
        for row in getattr(m, 'buttons', None) or []:
            for b in row:
                label = getattr(b, 'text', '') or ''
                link = getattr(b, 'url', None)
                data = getattr(b, 'data', None)
                if link:
                    self.link(link, label, text, has_file, base)
                elif data is not None:
                    callbacks.append((label, data))
        for label, data in callbacks:
            if _RETRY.search(label) and self.res['join']:
                self.retry = (m, data)
                continue
            if _PAGE.match(label):
                continue
            if _NAV.match(label):
                if _NEXT.search(label):
                    self.push(-0.5, 'click', (m, data), label)
                continue
            r = self.rank(label)
            if r is None:                        # the button names another episode / another film
                continue
            if r < 0.5 and base is not None and base >= 0.6 and len(callbacks) <= 4:
                r = 0.5                          # the title is in the text, the buttons only say "720p" / "Download"
            self.push(r if r >= 0.5 else r - 1.0, 'click', (m, data), label)
        if has_file:
            return
        try:
            pairs = m.get_entities_text() or []
        except Exception:
            pairs = []
        found = set()
        for ent, inner in pairs:
            link = getattr(ent, 'url', None) or (inner if type(ent).__name__ == 'MessageEntityUrl' else None)
            if link:
                found.add(link)
                self.link(link, inner if getattr(ent, 'url', None) else '', text, has_file, base)
        for link in _URL.findall(text):
            if link not in found:
                self.link(link, '', text, has_file, base)

    def link(self, url, label, text, has_file, base):
        what = tme(url)
        if not what:
            return
        r = self.rank(label) if label else base
        if label and r is not None and r < 0.5 and base is not None and base >= 0.6:
            r = base
        if what[0] == 'join':
            # a bare channel link under a file is an advert; in an answer WITHOUT a file that talks about joining
            # it is the bot's "subscribe first" demand
            if not has_file and (_JOIN.search(label or '') or _JOIN.search(text or '')):
                self._joins.append(what[1])
            return
        if r is None:
            return
        self.push(r if r >= 0.5 else r - 1.0, what[0], what[1:], label or url)

    def push(self, prio, kind, payload, label):
        key = (kind, payload[1] if kind == 'click' else payload)
        if key in self.done:
            return
        for a in self.actions:
            if (a[2], a[3][1] if a[2] == 'click' else a[3]) == key:
                return
        self.order += 1
        if prio >= 0.5:
            self._content = True
        self.actions.append([prio, self.order, kind, payload, label])

    # ---------------------------------------------------------------- acting
    def next_action(self, allow_weak):
        if not self.actions or self.left <= 0:
            return None
        self.actions.sort(key=lambda a: (-a[0], a[1]))
        best = self.actions[0]
        if best[0] < 0.5 and not allow_weak:
            return None
        self.actions.pop(0)
        return best

    async def act(self, action):
        prio, _, kind, payload, label = action
        self.done.add((kind, payload[1] if kind == 'click' else payload))
        self.left -= 1
        self.res['clicked'] += 1
        try:
            if kind == 'click':
                m, data = payload
                ans = await asyncio.wait_for(m.click(data=data), 8)
                link = getattr(ans, 'url', None)
                note = getattr(ans, 'message', None)
                if note:
                    self.res['notes'].append(note[:200])
                    if _JOIN.search(note):
                        self.res['needs_join'] = True
                if link:
                    self.link(link, label, '', False, max(prio, 0.5))
            elif kind == 'start':
                await self.start(payload[0], payload[1])
            elif kind == 'msg':
                m = await self.client.get_messages(payload[0], ids=payload[1])
                if m is not None:
                    self.add_file(m)
        except asyncio.TimeoutError:
            pass
        except Exception as exc:
            self.tg.log('bot action %s failed: %r' % (kind, exc))

    async def start(self, bot, code):
        from telethon.tl.functions.messages import StartBotRequest
        ent = await self.client.get_entity(ref(bot))
        if not getattr(ent, 'bot', False):
            return
        if ent.id not in self.watch:
            last = await self.client.get_messages(ent, limit=1)
            self.watch[ent.id] = [ent, last[0].id if last else 0]
        await self.client(StartBotRequest(bot=ent, peer=ent, start_param=code))
        self.last_start = (bot, code)

    async def join_all(self):
        ok = 0
        for link in self.res['join'][:3]:
            try:
                await self.tg.join(link)
                ok += 1
            except Exception as exc:
                self.tg.log('bot join %s failed: %r' % (link, exc))
        self.joined = True
        self.res['joined'] = ok
        return ok


async def ask(tg, bot, query, timeout=14.0, clicks=5, rank=None, autojoin=False):
    """Ask one bot for `query`. -> {'files': [candidates], 'join': [links the bot demands], 'notes': [...],
    'answered': bool, 'clicked': n, 'bot': {...}, 'took': seconds}. Never raises for a bot that misbehaves."""
    from telethon import errors
    t0 = time.time()
    res = {'files': [], 'join': [], 'notes': [], 'answered': False, 'clicked': 0, 'bot': None, 'took': 0.0,
           'error': None}
    client = tg.client
    try:
        ent = await client.get_entity(ref(bot))
    except Exception as exc:
        res['error'] = 'bot_not_found: %s' % type(exc).__name__
        return res
    if not getattr(ent, 'bot', False):
        res['error'] = 'not_a_bot'
        return res
    res['bot'] = {'id': ent.id, 'username': getattr(ent, 'username', None),
                  'title': getattr(ent, 'first_name', '') or getattr(ent, 'username', '') or ''}
    deadline = t0 + float(timeout)
    async with tg.bot_lock(ent.id):
        talk = _Talk(tg, query, rank, clicks, autojoin, res)
        try:
            last = await client.get_messages(ent, limit=1)
            if not last:                          # never opened: a bot answers nobody before /start
                first = await client.send_message(ent, '/start')
                talk.watch[ent.id] = [ent, first.id]
                until = time.time() + 3.0
                while time.time() < until and not await talk.poll():
                    await asyncio.sleep(0.4)
                talk.actions = []                 # the welcome menu is not an answer to the request
                talk.res['answered'] = False
            sent = await client.send_message(ent, query)
            talk.watch[ent.id] = [ent, sent.id]
        except errors.FloodWaitError as exc:
            res['error'] = 'flood_wait_%s' % getattr(exc, 'seconds', 0)
            return res
        except Exception as exc:                  # YouBlockedUserError, UserIsBlockedError, PeerFloodError ...
            res['error'] = type(exc).__name__
            return res
        mark = time.time()                        # the last moment something happened
        while time.time() < deadline:
            await asyncio.sleep(0.5)
            if await talk.poll():
                mark = time.time()
            now = time.time()
            idle = now - mark
            if res['join'] and autojoin and not talk.joined:
                if await talk.join_all():
                    if talk.retry:
                        talk.push(1.0, 'click', talk.retry, 'retry')
                    elif getattr(talk, 'last_start', None):
                        talk.done.discard(('start', talk.last_start))
                        talk.push(1.0, 'start', talk.last_start, 'retry')
                    else:
                        try:
                            again = await client.send_message(ent, query)
                            talk.watch[ent.id][1] = again.id
                        except Exception:
                            pass
                    mark = time.time()
                continue
            action = talk.next_action(allow_weak=not res['files'] and res['answered'] and idle >= 1.0)
            if action is not None:
                await talk.act(action)
                mark = time.time()
                continue
            if not res['answered']:
                if idle >= 7.0:                   # a dead bot
                    res['error'] = 'no_answer'
                    break
            elif idle >= (2.0 if res['files'] else 4.5):
                break
    res['took'] = round(time.time() - t0, 2)
    return res


async def ask_many(tg, bot, queries, timeout=14.0, clicks=5, rank=None, autojoin=False):
    """The first wording that brings files wins; a second wording is tried only with time to spare."""
    t0 = time.time()
    res = None
    for q in queries[:2]:
        left = timeout - (time.time() - t0)
        if left < 5:
            break
        one = await ask(tg, bot, q, left, clicks, rank, autojoin)
        if res is None:
            res = one
        else:
            one['join'] = list(dict.fromkeys(res['join'] + one['join']))
            one['notes'] = res['notes'] + one['notes']
            one['clicked'] += res['clicked']
            one['answered'] = one['answered'] or res['answered']
            res = one
        if res['files'] or res['error'] in ('bot_not_found', 'not_a_bot') or res['join']:
            break
    if res is not None:
        res['took'] = round(time.time() - t0, 2)
    return res or {'files': [], 'join': [], 'notes': [], 'answered': False, 'clicked': 0, 'bot': None,
                   'took': 0.0, 'error': 'no_time'}


async def inline(tg, bot, query, limit=20, timeout=6.0):
    """Inline bots answer '@bot title' with ready files. They are registered as virtual messages, so the stream
    proxy plays them like any other file - nothing is sent to any chat."""
    out = []
    try:
        ent = await tg.client.get_entity(ref(bot))
        if not getattr(ent, 'bot', False) or not getattr(ent, 'bot_inline_placeholder', None):
            return out
        results = await asyncio.wait_for(tg.client.inline_query(ent, query), timeout)
    except Exception as exc:
        tg.log('inline %s failed: %r' % (bot, exc))
        return out
    for r in list(results or [])[:limit]:
        doc = getattr(r, 'document', None)
        if doc is None or not hasattr(doc, 'mime_type'):
            continue
        text = ' '.join(x for x in [getattr(r, 'title', '') or '', getattr(r, 'description', '') or ''] if x)
        m = tg.virtual(ent, doc, text)
        if m is not None and is_video(m):
            c = tg._to_cand(m)
            if c:
                c['via_bot'] = getattr(ent, 'username', '') or ''
                c['chat_kind'] = 'bot'
                out.append(c)
    return out


async def with_videos(tg, ids, limit=30):
    """Which of these bot chats already hold a video? (= bots that have sent the user films before)"""
    from telethon.tl import types
    good = []
    for cid in list(ids)[:limit]:
        try:
            msgs = await tg.client.get_messages(cid, limit=1, filter=types.InputMessagesFilterVideo())
            if not msgs:
                docs = await tg.client.get_messages(cid, limit=5, filter=types.InputMessagesFilterDocument())
                msgs = [m for m in docs or [] if is_video(m)]
            if msgs:
                good.append(cid)
        except Exception as exc:
            tg.log('bot scan %s failed: %r' % (cid, exc))
        await asyncio.sleep(0.15)
    return good
