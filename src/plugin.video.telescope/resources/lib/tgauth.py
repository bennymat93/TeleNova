# -*- coding: utf-8 -*-
"""4.0.6: the Telegram login by phone number, step by step: number -> code (it arrives in the Telegram app of
another device, or by SMS) -> two-step verification password -> connected.

What was wrong before: every mistake (a mistyped code, a wrong password, a number without the country code) ended
the login with a raw error, and the next try asked Telegram for a NEW code. Telegram limits code requests per
number, so after a few tries it answered "flood wait" for hours and the login could not be finished at all.
Now a code is asked for once and stays valid for its whole life: a wrong code or password is simply typed again.

Pure helpers (no Kodi, no Telethon import): the errors are recognised by their class names, so the same code is
tested with stand-in exceptions."""
import re
import time

CODE_LIFE = 600                # a login code is good for about 10 minutes; within it the same code is reused


def normalize_phone(text, default_cc='972'):
    """'054-123 4567' -> '+972541234567'; '+1 (212) 555-0100' -> '+12125550100'; '' when it cannot be a number"""
    raw = (text or '').strip()
    digits = re.sub(r'\D', '', raw)
    if raw.startswith('+'):
        pass
    elif digits.startswith('00'):
        digits = digits[2:]
    elif digits.startswith('0'):
        digits = default_cc + digits[1:]          # a local number: the country code replaces the leading zero
    elif len(digits) <= 9:
        digits = default_cc + digits
    if not 8 <= len(digits) <= 15:
        return ''
    return '+' + digits


def sent_info(sent):
    """auth.SentCode -> where the code went: {'via': 'app'|'sms'|'call'|'email'|'other', 'length', 'next', 'timeout'}"""
    def kind(obj):
        name = type(obj).__name__.lower() if obj is not None else ''
        for key, via in (('app', 'app'), ('sms', 'sms'), ('flashcall', 'call'), ('missedcall', 'call'), ('call', 'call'),
                         ('email', 'email'), ('fragment', 'other')):
            if key in name:
                return via
        return 'other' if name else ''
    t = getattr(sent, 'type', None)
    return {'via': kind(t) or 'other', 'length': int(getattr(t, 'length', 0) or 0),
            'next': kind(getattr(sent, 'next_type', None)), 'timeout': int(getattr(sent, 'timeout', 0) or 0)}


# Telethon error class name -> our reason
_REASONS = (
    ('FloodWait', 'flood'), ('PhoneNumberFlood', 'flood'), ('PhonePasswordFlood', 'flood'), ('FloodError', 'flood'),
    ('PhoneNumberInvalid', 'phone_invalid'), ('PhoneNumberBanned', 'phone_banned'),
    ('PhoneNumberUnoccupied', 'phone_unknown'), ('PhoneCodeInvalid', 'code_invalid'), ('PhoneCodeEmpty', 'code_invalid'),
    ('PhoneCodeExpired', 'code_expired'), ('PhoneCodeHashEmpty', 'code_expired'),
    ('SessionPasswordNeeded', 'password_needed'), ('PasswordHashInvalid', 'password_invalid'),
    ('ApiIdInvalid', 'api_invalid'), ('ApiIdPublishedFlood', 'api_invalid'), ('SendCodeUnavailable', 'no_more_ways'),
    ('AuthRestart', 'restart'), ('TimeoutError', 'network'), ('ConnectionError', 'network'), ('OSError', 'network'),
)


def error_info(exc):
    """-> {'error': reason, 'wait': seconds (flood), 'detail': short text}. Unknown errors keep their class name."""
    names = [c.__name__ for c in type(exc).__mro__]
    reason = ''
    for part, r in _REASONS:
        if any(part in n for n in names):
            reason = r
            break
    out = {'error': reason or 'other', 'detail': type(exc).__name__}
    if reason == 'flood':
        out['wait'] = int(getattr(exc, 'seconds', 0) or 0)
    return out


class LoginState(object):
    """What the engine remembers between the steps of one login."""

    def __init__(self, now=time.time):
        self._now = now
        self.phone = self.hash = ''
        self.sent_at = 0
        self.info = {}
        self.flood_until = 0

    def remember(self, phone, code_hash, info):
        self.phone, self.hash, self.info, self.sent_at = phone, code_hash, dict(info or {}), self._now()

    def reusable(self, phone):
        """the code asked for this number a moment ago is still good: no second request to Telegram"""
        return bool(self.hash and phone == self.phone and self._now() - self.sent_at < CODE_LIFE)

    def forget(self):
        self.hash, self.sent_at = '', 0

    def flood(self, seconds):
        self.flood_until = self._now() + max(0, int(seconds or 0))

    def flood_left(self):
        return max(0, int(self.flood_until - self._now()))

    def can_resend(self):
        """Telegram allows another way of delivery (SMS / call) only after `timeout` seconds"""
        if not self.hash or not self.info.get('next'):
            return False
        return self._now() - self.sent_at >= (self.info.get('timeout') or 0)


def wait_text(seconds, lang='he'):
    """90 -> '2 דקות'; 7300 -> '2 שעות'"""
    s = max(0, int(seconds or 0))
    if not s:                      # Telegram did not say for how long (PHONE_NUMBER_FLOOD): usually up to a day
        return {'he': u'כמה שעות', 'ru': u'несколько часов'}.get(lang, 'a few hours')
    if s < 90:
        n, unit = max(1, s), {'he': u'שניות', 'ru': u'сек.'}.get(lang, 'seconds')
    elif s < 5400:
        n, unit = (s + 59) // 60, {'he': u'דקות', 'ru': u'мин.'}.get(lang, 'minutes')
    else:
        n, unit = (s + 1800) // 3600, {'he': u'שעות', 'ru': u'ч.'}.get(lang, 'hours')
    return '%d %s' % (n, unit)
