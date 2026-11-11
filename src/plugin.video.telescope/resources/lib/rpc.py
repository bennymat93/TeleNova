# -*- coding: utf-8 -*-
"""Plugin-side client for the service's JSON-RPC endpoint."""
import time

from . import common


class RPCError(Exception):
    pass


def _endpoint():
    info = common.read_json(common.PORT_FILE, {}) or {}
    if not info.get('port'):
        raise RPCError('service_down')
    return 'http://127.0.0.1:%d' % info['port'], info.get('secret')


def call(method, timeout=90, **params):
    import requests         # 3.3: loaded on first use - a static menu makes no request
    last = None
    for attempt in range(3):
        try:
            base, secret = _endpoint()
            r = requests.post(base + '/rpc', json={'method': method, 'params': params, 'secret': secret},
                              timeout=timeout)
            data = r.json()
            if 'error' in data:
                if 'service_starting' in str(data['error']):
                    raise RPCError('service_down')      # 3.3: still connecting - repeated below
                raise RPCError(common.scrub(data['error']))
            return data.get('result')
        except (requests.ConnectionError, requests.Timeout, RPCError) as exc:
            last = exc
            if isinstance(exc, RPCError) and str(exc) != 'service_down':
                raise
            if isinstance(exc, requests.Timeout) and not isinstance(exc, requests.ConnectionError):
                break                  # 3.3: a read timeout already took the caller's whole timeout - not repeated
            time.sleep(1.0 + attempt)  # service may still be starting
    if isinstance(last, RPCError):
        raise last
    # 3.3: a dead port (stale port.json, service still starting) is "service down", not a raw urllib3 error
    common.log('rpc %s failed: %s' % (method, common.scrub(last)))
    raise RPCError('service_down')


def stream_token(secret, chat_id, msg_id):
    """3.3: stream URLs carry an HMAC of chat/message made with the service secret (the same code runs in the
    service to check it), so only the plugin can build a playable URL."""
    import hashlib
    import hmac
    return hmac.new((secret or '').encode('utf-8'), ('%d:%d' % (int(chat_id), int(msg_id))).encode('utf-8'),
                    hashlib.sha256).hexdigest()[:16]


def stream_url(chat_id, msg_id, filename=''):
    base, secret = _endpoint()
    try:
        from urllib.parse import quote
    except ImportError:  # pragma: no cover
        from urllib import quote
    safe = quote((filename or 'video.mkv').replace('/', '_')[-120:])
    return '%s/stream/%d/%d/%s/%s' % (base, int(chat_id), int(msg_id), stream_token(secret, chat_id, msg_id), safe)
