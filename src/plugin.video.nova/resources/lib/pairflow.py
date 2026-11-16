# -*- coding: utf-8 -*-
"""4.2: the two sides of "send my setup to another device", on top of pairing.py. No Kodi module here: the screens
(ui), the Telegram engine (eng) and the settings store (host) are passed in, so the whole exchange is tested with two
threads on one machine (src/qa/t_pairing.py).

  ui:   status(text_key, **kw)            a line of progress
        confirm_code(code, peer) -> bool  both screens show the same 6 digits; True = the viewer confirmed
        ask_password(hint) -> str|None    Telegram two-step password (configured device only)
        cancelled() -> bool
  eng:  authorized() -> bool              this device's Telegram engine is logged in
        wait_ready(seconds) -> bool       (new device) engine connected after the new API id / hash
        qr_token() -> str                 (new device) a fresh login token (base64url, from tg://login?token=)
        qr_wait(seconds) -> 'ok' | 'wait' | 'password' | error text
        sign_in_password(pw) -> 'ok' | error text
        accept_token(token) -> 'ok' | error text      (configured device) approve the new device's token
  host: export_bundle() -> dict           every syncable setting / file of this device (no Telegram session)
        apply_bundle(dict) -> int         number of values written

Result of both runs: {'ok': bool, 'reason': str, 'peer': name, 'login': 'ok' | 'skipped' | 'failed: ...',
                      'applied': n}
"""
import time

from . import pairing

WAIT_SENDER = 600          # the new device waits ten minutes for a sender
CONFIRM_WAIT = 300         # the other side may take five minutes to press OK
LOGIN_WAIT = 150
TOKEN_TRIES = 3
PROGRESS_EVERY = 3          # seconds between progress reports while the setup is applied
ACK_WAIT = 120
PASSWORD_TRIES = 3
HANDSHAKE_WAIT = 15         # an unknown connection has 15 s for the handshake


def _fail(reason, **kw):
    out = {'ok': False, 'reason': reason, 'peer': '', 'login': 'skipped', 'applied': 0}
    out.update(kw)
    return out


def _agree(ch, ui):
    """both viewers confirm the same code; each side sends its answer before it reads the other one (no dead lock).
    A viewer who said "no" does not wait for the answer of the other side (review 16/11)."""
    ch.cancelled = ui.cancelled
    ok = bool(ui.confirm_code(ch.code, ch.peer_name))
    ch.send({'t': 'confirm', 'ok': ok})
    if not ok:
        # read the other side's answer before closing: closing with it still unread makes Windows reset the
        # connection, and the other screen would say "connection closed" instead of "cancelled" (seen 17/11)
        try:
            ch.recv(3)
        except pairing.PairError:
            pass
        return False
    ui.status('waiting_peer_confirm')
    other = ch.recv(CONFIRM_WAIT)
    if other.get('t') != 'confirm':
        raise pairing.PairError('protocol')
    return bool(other.get('ok'))


def _accept_sender(lst, ui, name, wait):
    """review 16/11: the first connection is not trusted to be the sender. A port scan, a stray device or an
    attacker who read the port from the beacon fails the handshake (short limit), and the device keeps listening
    for the real sender until the time is up. -> Channel, or None"""
    until = time.time() + wait
    while time.time() < until and not ui.cancelled():
        conn = lst.accept(until, ui.cancelled)
        if conn is None:
            return None
        try:
            return pairing.receiver_handshake(conn, name, timeout=HANDSHAKE_WAIT, cancelled=ui.cancelled)
        except pairing.PairError as e:
            if str(e) == 'cancelled':
                conn.close()
                return None
            try:
                conn.close()
            except OSError:
                pass
            ui.status('listening', address=lst.address, port=lst.port, name=name)
    return None


def run_receiver(ui, eng, host, name, listener=None, wait=WAIT_SENDER):
    """the NEW device"""
    lst = listener or pairing.Listener(name)
    ch = None
    applied = None
    try:
        ui.status('listening', address=lst.address, port=lst.port, name=name)
        ch = _accept_sender(lst, ui, name, wait)
        if ch is None:
            return _fail('cancelled' if ui.cancelled() else 'timeout')
        lst.close()                                     # a sender passed the handshake: nobody else now
        if not _agree(ch, ui):
            return _fail('cancelled', peer=ch.peer_name)
        ui.status('receiving')
        msg = ch.recv(120)
        if msg.get('t') != 'bundle' or not isinstance(msg.get('data'), dict):
            raise pairing.PairError('protocol')
        last = [0.0]

        def progress(done, total):
            # live test 17/11: 131 settings took ~4 min on an emulator; the configured device waits as long as
            # this keeps coming, and both screens show how far it is
            if time.time() - last[0] >= PROGRESS_EVERY:
                last[0] = time.time()
                ch.send({'t': 'progress', 'done': done, 'total': total})
                ui.status('applying', done=done, total=total)
        applied = host.apply_bundle(msg['data'], progress)
        ch.send({'t': 'applied', 'n': applied})
        login = 'skipped'
        if msg.get('login'):
            try:
                login = _receiver_login(ch, ui, eng)
            except pairing.PairError:
                raise
            except Exception as e:                      # review 16/11: an engine error is a login failure; the
                login = 'failed: %s' % type(e).__name__  # setup itself has arrived
        try:
            ch.send({'t': 'done', 'login': login})
        except pairing.PairError:
            pass
        return {'ok': True, 'reason': '', 'peer': ch.peer_name, 'login': login, 'applied': applied}
    except pairing.PairError as e:
        if applied is not None:                         # the setup arrived; only the login part broke off
            return {'ok': True, 'reason': '', 'peer': ch.peer_name if ch else '', 'login': 'failed: %s' % e,
                    'applied': applied}
        return _fail(str(e), peer=ch.peer_name if ch else '')
    finally:
        lst.close()
        if ch:
            ch.close()


def _receiver_login(ch, ui, eng):
    """the new device: a fresh login token to the configured device, which approves it with its own (logged-in)
    session and answers with a verdict; then Telegram finishes the new device's login (two-step password if set)"""
    ui.status('login_prepare')
    last = [time.time()]

    def tick():
        # live test 17/11: the configured device gave up after 150 s of silence while this engine got ready
        if time.time() - last[0] >= PROGRESS_EVERY:
            last[0] = time.time()
            ch.send({'t': 'progress', 'stage': 'login_prepare'})
    if not eng.wait_ready(180, tick):                   # a new device downloads its Telegram parts first
        ch.send({'t': 'token', 'error': 'engine_not_ready'})
        return 'failed: engine_not_ready'
    verdict = {}
    for attempt in range(TOKEN_TRIES):                 # a token lives ~30 s: a fresh one when it was refused
        token = eng.qr_token()
        if not token:
            ch.send({'t': 'token', 'error': 'no_token'})
            return 'failed: no_token'
        ch.send({'t': 'token', 'token': token, 'last': attempt == TOKEN_TRIES - 1})
        verdict = ch.recv(LOGIN_WAIT)
        if verdict.get('t') != 'verdict':
            raise pairing.PairError('protocol')
        if verdict.get('ok'):
            break
    else:
        return 'failed: %s' % (verdict.get('error') or 'refused')
    ui.status('login_wait')
    end = time.time() + LOGIN_WAIT
    while time.time() < end:
        if ui.cancelled():
            return 'failed: cancelled'
        state = eng.qr_check()                           # the token is accepted: Telegram finishes the login
        if state == 'wait':
            state = eng.qr_wait(3)
        if state == 'ok':
            return 'ok'
        if state == 'password':
            return _receiver_password(ch, eng)
        if state != 'wait':
            return 'failed: %s' % state
    return 'failed: timeout'


def _receiver_password(ch, eng):
    """two-step verification: the password is typed on the configured device. After a wrong one the engine stays
    at the password step (its QR login is over), so the password is asked again HERE - going back to the QR wait
    would never ask again (review 16/11)"""
    for _ in range(PASSWORD_TRIES):
        ch.send({'t': 'need_password'})
        pw = ch.recv(CONFIRM_WAIT)
        if pw.get('t') != 'password' or not pw.get('password'):
            return 'failed: no_password'
        res = eng.sign_in_password(pw['password'])
        ch.send({'t': 'password_result', 'ok': res == 'ok', 'error': '' if res == 'ok' else res})
        if res == 'ok':
            return 'ok'
    return 'failed: wrong_password'


def run_sender(ui, eng, host, name, target, connect=pairing.connect):
    """the CONFIGURED device; target = (host, port)"""
    ch = None
    try:
        ui.status('connecting', host=target[0], port=target[1])
        try:
            sock = connect(target[0], target[1])
        except OSError:
            return _fail('unreachable')
        ch = pairing.sender_handshake(sock, name, timeout=HANDSHAKE_WAIT, cancelled=ui.cancelled)
        if not _agree(ch, ui):
            return _fail('cancelled', peer=ch.peer_name)
        ui.status('sending')
        login = eng.authorized()
        ch.send({'t': 'bundle', 'data': host.export_bundle(), 'login': login})
        while True:
            ack = ch.recv(ACK_WAIT)                      # silence for ACK_WAIT ends it; progress keeps it alive
            if ack.get('t') != 'progress':
                break
            ui.status('applying_peer', done=ack.get('done', 0), total=ack.get('total', 0))
        if ack.get('t') != 'applied':
            raise pairing.PairError('protocol')
        result = 'skipped'
        if login:
            result = _sender_login(ch, ui, eng)
        done = getattr(ch, 'pending_done', None)
        if done is None:
            try:
                done = ch.recv(LOGIN_WAIT)
            except pairing.PairError:
                done = {}                                # the setup itself arrived (acknowledged above)
        if done.get('t') == 'done':
            result = done.get('login') or result
        return {'ok': True, 'reason': '', 'peer': ch.peer_name, 'login': result, 'applied': int(ack.get('n') or 0)}
    except pairing.PairError as e:
        return _fail(str(e), peer=ch.peer_name if ch else '')
    finally:
        if ch:
            ch.close()


def _sender_login(ch, ui, eng):
    """the configured device: approves each token the new device sends and answers with a verdict"""
    ui.status('login_approve')
    while True:
        msg = ch.recv(LOGIN_WAIT)
        t = msg.get('t')
        if t == 'token':
            if msg.get('error'):
                return 'failed: %s' % msg['error']
            res = eng.accept_token(str(msg.get('token') or ''))
            ch.send({'t': 'verdict', 'ok': res == 'ok', 'error': '' if res == 'ok' else res})
            if res != 'ok' and msg.get('last'):
                return 'failed: %s' % res
            continue
        if t == 'progress':                              # the new device's engine is getting ready
            ui.status('login_approve')
            continue
        if t == 'need_password':
            pw = ui.ask_password('telegram_2fa')
            ch.send({'t': 'password', 'password': pw or ''})
            if not pw:
                return 'failed: no_password'
            continue
        if t == 'password_result':
            if msg.get('ok'):
                return 'ok'
            continue                                     # the new device asks again (need_password) or gives up
        if t == 'done':
            ch.pending_done = msg
            return msg.get('login') or 'failed'
        raise pairing.PairError('protocol')
