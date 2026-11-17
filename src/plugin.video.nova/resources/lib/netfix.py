# -*- coding: utf-8 -*-
"""4.2.4: reaching a web API from networks that cannot (car boxes on a phone's hotspot, some mobile carriers).

Seen on a CarPlay AI box: every TMDb request failed with "ConnectionError ... Max retries exceeded"
(api.themoviedb.org could not be resolved / reached) while the rest worked. Two ways round it:
  1. the same API under its other official name (api.tmdb.org);
  2. the network's own DNS fails: the address is asked from Cloudflare / Google over HTTPS (by IP, so no DNS
     is needed for that either) and Python's resolver is told the answer for that host name only.
No Kodi module here (tested outside Kodi)."""
import json
import socket
import threading
import time

DOH = ('https://1.1.1.1/dns-query?name=%s&type=A', 'https://8.8.8.8/resolve?name=%s&type=A')
_MAP = {}                       # host -> [ip, ...] answered over HTTPS
_LOCK = threading.Lock()
_ORIG = socket.getaddrinfo
_INSTALLED = [False]


def _getaddrinfo(host, port, *a, **kw):
    ips = _MAP.get(host)
    if ips:
        out = []
        for ip in ips:
            try:
                out.extend(_ORIG(ip, port, *a, **kw))
            except OSError:
                pass
        if out:
            return out
    return _ORIG(host, port, *a, **kw)


def doh_resolve(host, get, timeout=6):
    """host -> [IPv4] from DNS over HTTPS; get(url, headers, timeout) -> text"""
    for tmpl in DOH:
        try:
            data = json.loads(get(tmpl % host, {'accept': 'application/dns-json'}, timeout))
            ips = [a['data'] for a in data.get('Answer') or [] if a.get('type') == 1 and a.get('data')]
            if ips:
                return ips
        except Exception:
            continue
    return []


def pin(host, ips):
    """Python's resolver answers `ips` for `host` from now on (this process)"""
    with _LOCK:
        _MAP[host] = list(ips)
        if not _INSTALLED[0]:
            socket.getaddrinfo = _getaddrinfo
            _INSTALLED[0] = True


def is_net_error(exc):
    """a failure to reach the server at all (not an HTTP answer such as 401 / 404)"""
    if getattr(exc, 'response', None) is not None:      # requests' HTTPError: the server did answer
        return False
    name = type(exc).__name__
    return name in ('ConnectionError', 'ConnectTimeout', 'NewConnectionError', 'MaxRetryError', 'gaierror',
                    'SSLError', 'ReadTimeout', 'Timeout', 'ConnectionRefusedError', 'ConnectionResetError')         or isinstance(exc, (socket.timeout, socket.gaierror, ConnectionError))


class Failover(object):
    """call(fn) with fn(base) for each base until one reaches the server; the one that worked is tried first
    next time. After every name failed, the names are resolved over HTTPS and tried once more."""

    def __init__(self, bases, get, log=None):
        self.bases = list(bases)
        self.get = get
        self.log = log or (lambda m: None)
        self.good = 0
        self.doh_tried = 0.0

    def call(self, fn):
        order = [self.good] + [i for i in range(len(self.bases)) if i != self.good]
        last = None
        for i in order:
            try:
                out = fn(self.bases[i])
                if i != self.good:
                    self.log('reached %s instead of %s' % (self.bases[i], self.bases[self.good]))
                    self.good = i
                return out
            except Exception as e:
                if not is_net_error(e):
                    raise
                last = e
        if time.time() - self.doh_tried > 300:          # at most every 5 minutes
            self.doh_tried = time.time()
            pinned = False
            for b in self.bases:
                host = b.split('//', 1)[-1].split('/', 1)[0]
                ips = doh_resolve(host, self.get)
                if ips:
                    pin(host, ips)
                    pinned = True
            if pinned:
                self.log('network DNS failed: TMDb addresses taken over HTTPS')
                for i in order:
                    try:
                        out = fn(self.bases[i])
                        self.good = i
                        return out
                    except Exception as e:
                        if not is_net_error(e):
                            raise
                        last = e
        raise last
