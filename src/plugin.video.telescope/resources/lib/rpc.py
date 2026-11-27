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


START_WAIT = 75         # seconds a call waits for an engine that says it is still starting
START_PAUSE = 2.0


def call(method, timeout=90, **params):
    """6.5.1: three different endings instead of one "service not running, restart Kodi":
    RPCError('service_starting') - the engine answers but is still starting / restarting after START_WAIT seconds
    RPCError('timeout')          - the engine took the call and did not answer within `timeout`
    RPCError('service_down')     - nothing answers on the port (three tries)"""
    import requests         # 3.3: loaded on first use - a static menu makes no request
    last = None
    attempt = 0
    began = time.time()
    while attempt < 3:
        try:
            base, secret = _endpoint()
            r = requests.post(base + '/rpc', json={'method': method, 'params': params, 'secret': secret},
                              timeout=timeout)
            try:
                data = r.json()
            except ValueError:
                data = None
            if not isinstance(data, dict):          # 6.1.7: something else answers on the port - as if down
                raise RPCError('service_down')
            if 'error' in data:
                if 'service_starting' in str(data['error']):
                    raise RPCError('service_starting')  # 3.3: still connecting - repeated below
                raise RPCError(common.scrub(data['error']))
            return data.get('result')
        except (requests.ConnectionError, requests.Timeout, RPCError) as exc:
            last = exc
            if isinstance(exc, RPCError) and str(exc) == 'service_starting':
                if time.time() - began >= START_WAIT:
                    raise
                time.sleep(START_PAUSE)    # the engine is alive: asked again, not counted as a failed try
                continue
            if isinstance(exc, RPCError) and str(exc) != 'service_down':
                raise
            if isinstance(exc, requests.Timeout) and not isinstance(exc, requests.ConnectionError):
                # 3.3: a read timeout already took the caller's whole timeout - not repeated
                common.log('rpc %s: no answer in %s s' % (method, timeout))
                raise RPCError('timeout')
            attempt += 1
            if attempt < 3:
                time.sleep(float(attempt))  # service may still be starting
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
