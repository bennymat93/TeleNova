# -*- coding: utf-8 -*-
"""4.0.6: the Telegram login by phone - number, code, two-step password - against a stand-in Telegram.
The point: a mistake never costs another code request (Telegram blocks a number after a few)."""
import asyncio, io, os, sys, types

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'plugin.video.telescope'))
for name in ('xbmc', 'xbmcaddon', 'xbmcgui', 'xbmcplugin', 'xbmcvfs'):
    sys.modules.setdefault(name, types.ModuleType(name))
from resources.lib import tgauth, tgclient  # noqa: E402

bad = []


def check(cond, what):
    if not cond:
        bad.append(what)


# ---- phone numbers
N = tgauth.normalize_phone
check(N('054-123 4567') == '+972541234567', 'local Israeli number')
check(N('+972 54 123 4567') == '+972541234567' and N('00972541234567') == '+972541234567', 'international forms')
check(N('541234567') == '+972541234567', 'without the leading zero')
check(N('+1 (212) 555-0100') == '+12125550100', 'another country keeps its code')
check(N('') == '' and N('12') == '' and N('abc') == '' and N('+' + '9' * 20) == '', 'not a number')

# ---- errors by class name
class FloodWaitError(Exception):
    def __init__(self, seconds):
        self.seconds = seconds


class PhoneCodeInvalidError(Exception):
    pass


class PhoneCodeExpiredError(Exception):
    pass


class SessionPasswordNeededError(Exception):
    pass


class PasswordHashInvalidError(Exception):
    pass


class PhoneNumberInvalidError(Exception):
    pass


E = tgauth.error_info
check(E(FloodWaitError(3600)) == {'error': 'flood', 'wait': 3600, 'detail': 'FloodWaitError'}, 'flood with its time')
check(E(PhoneCodeInvalidError())['error'] == 'code_invalid' and E(PhoneCodeExpiredError())['error'] == 'code_expired', 'code errors')
check(E(SessionPasswordNeededError())['error'] == 'password_needed' and E(PasswordHashInvalidError())['error'] == 'password_invalid', 'password errors')
check(E(asyncio.TimeoutError())['error'] == 'network' and E(ConnectionResetError())['error'] == 'network', 'network')
check(E(ValueError('x')) == {'error': 'other', 'detail': 'ValueError'}, 'unknown error keeps its name')
W = tgauth.wait_text
check(W(40, 'en') == '40 seconds' and W(600, 'en') == '10 minutes' and W(7300, 'en') == '2 hours' and u'דקות' in W(600), 'waiting time in words')


# ---- the engine's steps against a stand-in client
class SentApp(object):
    length = 5


class SentSms(object):
    length = 5


class Sent(object):
    def __init__(self, h, t, nxt=None, timeout=0):
        self.phone_code_hash, self.type, self.next_type, self.timeout = h, t, nxt, timeout


class Client(object):
    def __init__(self):
        self.code_requests, self.sign_ins, self.fail_send = [], [], None
        self.right_code, self.right_password, self.needs_password = '12345', 'secret', True

    async def send_code_request(self, phone):
        if self.fail_send:
            raise self.fail_send
        self.code_requests.append(phone)
        return Sent('HASH%d' % len(self.code_requests), SentApp(), SentSms(), 0)

    async def sign_in(self, phone=None, code=None, phone_code_hash=None, password=None):
        self.sign_ins.append((phone, code, phone_code_hash, bool(password)))
        if password is not None:
            if password != self.right_password:
                raise PasswordHashInvalidError()
            return 'ME'
        if code == '00000':
            raise PhoneCodeExpiredError()
        if code != self.right_code:
            raise PhoneCodeInvalidError()
        if self.needs_password:
            raise SessionPasswordNeededError()
        return 'ME'


def make():
    tg = tgclient.TG.__new__(tgclient.TG)
    tg.client, tg.me, tg._login, tg._login_state = Client(), None, None, None
    tg.log = lambda m: logs.append(m)

    async def hint():
        return 'my dog'
    tg._password_hint = hint
    return tg


logs = []
run = asyncio.get_event_loop_policy().new_event_loop().run_until_complete

tg = make()
r = run(tg.send_code('054-123 4567'))
check(r.get('sent') and r['via'] == 'app' and r['next'] == 'sms' and r['phone'] == '+972541234567' and r['length'] == 5, 'code sent to the app: %r' % r)
r2 = run(tg.send_code('0541234567'))
check(r2.get('reused') and len(tg.client.code_requests) == 1, 'asking again for the same number does not ask Telegram again')
for wrong in ('11111', '22222', '33 3 33'):
    check(run(tg.sign_in(wrong)) == {'ok': False, 'error': 'code_invalid', 'detail': 'PhoneCodeInvalidError'}, 'wrong code is told apart')
check(run(tg.sign_in('')) == {'ok': False, 'error': 'code_invalid'}, 'an empty code never reaches Telegram')
check(len(tg.client.code_requests) == 1, 'three wrong codes cost no new code request')
r = run(tg.sign_in(' 12345 '))
check(r == {'ok': False, 'password': True, 'hint': 'my dog'}, 'right code: the two-step password is asked, with its hint: %r' % r)
check(tg.client.sign_ins[-1][:3] == ('+972541234567', '12345', 'HASH1'), 'the code goes with the number and hash it was sent for')
r = run(tg.sign_in_password('nope'))
check(r.get('ok') is False and r['error'] == 'password_invalid' and r.get('hint') == 'my dog', 'wrong password: typed again')
check(run(tg.sign_in_password('secret')) == {'ok': True} and tg.me == 'ME', 'right password: connected')
check(len(tg.client.code_requests) == 1, 'the whole login used ONE code request')

tg = make()
tg.client.needs_password = False
run(tg.send_code('+972541234567'))
check(run(tg.sign_in('12345')) == {'ok': True} and tg.me == 'ME', 'an account without two-step verification connects after the code')
check(run(tg.sign_in('12345'))['error'] == 'code_expired', 'a used code is not sent twice')

tg = make()
run(tg.send_code('+972541234567'))
r = run(tg.sign_in('00000'))
check(r['error'] == 'code_expired', 'expired code')
run(tg.send_code('+972541234567'))
check(len(tg.client.code_requests) == 2, 'only an expired code leads to a new request')

tg = make()
tg.client.fail_send = FloodWaitError(7200)
r = run(tg.send_code('+972541234567'))
check(r == {'sent': False, 'error': 'flood', 'wait': 7200, 'detail': 'FloodWaitError'}, 'flood is reported with its time: %r' % r)
tg.client.fail_send = None
r = run(tg.send_code('+972541234567'))
check(r.get('error') == 'flood' and 7190 <= r['wait'] <= 7200 and tg.client.code_requests == [], 'while blocked, Telegram is not asked again')
check(run(make().send_code('12')) == {'sent': False, 'error': 'phone_invalid'}, 'a bad number never reaches Telegram')
tg = make()
tg.client.fail_send = PhoneNumberInvalidError()
check(run(tg.send_code('+972541234567'))['error'] == 'phone_invalid', 'a number Telegram refuses')
check(run(make().resend_code())['error'] == 'code_expired', 'nothing to resend before a code was asked for')

# ---- the state object
clock = [1000.0]
st = tgauth.LoginState(now=lambda: clock[0])
st.remember('+1', 'H', {'via': 'app', 'next': 'sms', 'timeout': 60})
check(st.reusable('+1') and not st.reusable('+2') and not st.can_resend(), 'fresh code')
clock[0] += 61
check(st.can_resend(), 'SMS can be asked for after the timeout')
clock[0] += 600
check(not st.reusable('+1'), 'after ten minutes a new code is needed')
st.flood(120)
check(st.flood_left() == 120, 'flood countdown')
clock[0] += 130
check(st.flood_left() == 0, 'flood over')
st.remember('+1', 'H', {'via': 'sms', 'next': ''})
check(not st.can_resend(), 'no other way offered')

# ---- the texts of the screen
src = io.open(os.path.join(HERE, '..', 'plugin.video.telescope', 'resources', 'lib', 'router.py'), encoding='utf-8').read()
start = src.index('LOGIN_TEXT = {')
texts = {}
exec(compile(src[start:src.index('\n}\n', start) + 3], 'texts', 'exec'), texts)
T = texts['LOGIN_TEXT']
for k, v in T.items():
    check(len(v) == 3 and all(v), 'text %s in three languages' % k)
    check(len(set(x.count('%s') for x in v)) == 1, 'text %s: same placeholders in every language' % k)
for need in ('flood', 'code_invalid', 'code_expired', 'password_invalid', 'phone_invalid', 'phone_banned', 'via_app', 'via_sms',
             'via_call', 'via_email', 'via_other', 'network', 'api_invalid', 'phone_unknown', 'no_more_ways', 'too_early'):
    check(need in T, 'a text for ' + need)
check(not any('secret' in line or '12345' in line for line in logs), 'no code or password in the log')

for b in bad:
    print('FAIL', b)
print('TGAUTH TESTS OK' if not bad else 'TGAUTH TESTS: %d problems' % len(bad))
sys.exit(1 if bad else 0)
