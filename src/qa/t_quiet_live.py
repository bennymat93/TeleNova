# -*- coding: utf-8 -*-
"""Live, read only: how many chats does the engine see (main list / archive), and are the bot chats it talks to
muted? Counts and yes/no only - no names. The mute state is read with a temporary copy of the session, removed at
the end (the engine's own connection is not used for it and nothing is changed in Telegram).
   python t_quiet_live.py"""
import asyncio, os, re, shutil, sys, tempfile, time

AD = os.path.join(os.environ['APPDATA'], 'Kodi', 'userdata', 'addon_data', 'plugin.video.telescope')
sys.path.insert(0, os.path.join(AD, 'lib'))
import tg_rpc

rows = tg_rpc.call('dialogs', timeout=120, limit=0)['result']
kinds = {}
for r in rows:
    k = (r.get('kind'), bool(r.get('archived')))
    kinds[k] = kinds.get(k, 0) + 1
print('chats the engine sees: %d' % len(rows))
for kind in ('channel', 'group', 'bot'):
    print('  %-8s main list %3d | archive %3d' % (kind, kinds.get((kind, False), 0), kinds.get((kind, True), 0)))
bots = [b for b in tg_rpc.call('bot_list', timeout=90)['result'] if (b.get('stats') or {}).get('asked')]
print('bots the engine has asked: %d' % len(bots))

tmp = tempfile.mkdtemp(prefix='tn_quiet_')
sess = os.path.join(tmp, 'x.session')


async def main():
    from telethon import TelegramClient
    from telethon.tl import functions, types
    s = open(os.path.join(AD, 'settings.xml'), encoding='utf-8').read()
    api_id = int(re.search(r'id="api_id"[^>]*>([^<]+)<', s).group(1))
    api_hash = re.search(r'id="api_hash"[^>]*>([^<]+)<', s).group(1).strip()
    shutil.copyfile(os.path.join(AD, 'telegram.session'), sess)
    c = TelegramClient(sess, api_id, api_hash, device_model='Kodi', system_version='TeleScope', app_version='1.0')
    await c.connect()
    now, muted, unread = time.time(), 0, 0
    for b in bots:
        try:
            peer = await c.get_input_entity(b['id'])
            st = await c(functions.account.GetNotifySettingsRequest(peer=types.InputNotifyPeer(peer)))
            mu = getattr(st, 'mute_until', None)
            ts = mu.timestamp() if hasattr(mu, 'timestamp') else (mu or 0)
            muted += ts > now
        except Exception as e:
            print('  one bot could not be read: %s' % type(e).__name__)
    print('of them muted in Telegram: %d of %d' % (muted, len(bots)))
    await c.disconnect()

try:
    asyncio.run(asyncio.wait_for(main(), 90))
except BaseException as e:
    print('ended: %s %s' % (type(e).__name__, str(e)[:120]))
finally:
    shutil.rmtree(tmp, ignore_errors=True)
