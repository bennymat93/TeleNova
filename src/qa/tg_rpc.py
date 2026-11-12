# -*- coding: utf-8 -*-
"""Talk to the Telegram engine's own RPC port of the running Kodi (not Kodi's JSON-RPC).
   python tg_rpc.py status
   python tg_rpc.py raw_search query=matrix limit=5
Values that look like JSON are parsed. Keys / phone numbers are masked in the output."""
import json, os, re, sys, urllib.request

PORT_FILE = os.path.join(os.environ['APPDATA'], 'Kodi', 'userdata', 'addon_data', 'plugin.video.telescope', 'port.json')


def call(method, timeout=90, **params):
    info = json.load(open(PORT_FILE, encoding='utf-8'))
    body = json.dumps({'method': method, 'params': params, 'secret': info.get('secret')}).encode('utf-8')
    req = urllib.request.Request('http://127.0.0.1:%d/rpc' % info['port'], body, {'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read().decode('utf-8'))


def stream_url(chat_id, msg_id, name='video.mkv'):
    import hashlib, hmac
    from urllib.parse import quote
    info = json.load(open(PORT_FILE, encoding='utf-8'))
    tok = hmac.new((info.get('secret') or '').encode(), ('%d:%d' % (int(chat_id), int(msg_id))).encode(), hashlib.sha256).hexdigest()[:16]
    return 'http://127.0.0.1:%d/stream/%d/%d/%s/%s' % (info['port'], int(chat_id), int(msg_id), tok, quote(name.replace('/', '_')[-120:]))


def mask(o):
    if isinstance(o, dict):
        return {k: ('***' if re.search(r'(?i)phone|token|secret|hash|key|username|first_name|last_name|^name$|^me$', k) and v else mask(v)) for k, v in o.items()}
    if isinstance(o, list):
        return [mask(x) for x in o]
    return o


if __name__ == '__main__':
    kw = {}
    for a in sys.argv[2:]:
        k, v = a.split('=', 1)
        try:
            v = json.loads(v)
        except ValueError:
            pass
        kw[k] = v
    out = json.dumps(mask(call(sys.argv[1], **kw)), ensure_ascii=False, indent=1)
    sys.stdout.buffer.write(out[:6000].encode('utf-8'))
