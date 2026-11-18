# -*- coding: utf-8 -*-
"""5.0: how much is each link recommended, 0-100 %, and in which order are the links shown.

One number per link, made of what was really checked - the list is sorted by it, best first:

  right file   30   how sure the match with the asked film / episode is (name, year, season / episode, length,
                    the file's own header). A doubtful match can never be "recommended" (capped at 45).
  works        25   the link was opened and data really arrived (25); a cached Real-Debrid file (22); not tested
                    yet (10, and the whole number is capped at 60 - an untested link is never above a tested one).
  plays now    25   what the source delivered in the test and what this connection gives right now (sampled
                    several times - linkspeed.py) against what the file needs per second. Twice the need = full
                    points; just enough = half; less than needed = 5 at most, falling to none.
  Hebrew       12   Hebrew sound or a Hebrew subtitle inside the file (12), a Hebrew subtitle made for this very
                    release exists (10), Hebrew in the name (8), none known (3 - one can still be found).
  picture       8   2160p / 1080p / 720p / lower, as far as the device can show it.

  A file the connection cannot carry (heavy) or the device cannot show loses 35 more and is capped at 35.

Tiers: 85+ highly recommended, 70+ recommended, 50+ fair, below - less recommended.
No Kodi module is imported here (tested outside Kodi: qa/t_recommend.py)."""

TIERS = ((85, 'top'), (70, 'good'), (50, 'fair'), (0, 'low'))
COLOR = {'top': 'FF3DDC84', 'good': 'FFB6E36B', 'fair': 'FFFFC857', 'low': 'FF9AA3B2'}
TEXT = {
    'he': {'top': u'מומלץ מאוד', 'good': u'מומלץ', 'fair': u'סביר', 'low': u'פחות מומלץ', 'head': u'דירוג המלצה',
           'match': u'התאמה לכותר', 'works': u'תקינות הקישור', 'speed': u'ניגון חלק בחיבור הנוכחי', 'he': u'עברית',
           'pic': u'איכות תמונה', 'tested': u'נבדק ועובד', 'cached': u'שמור ב-Real-Debrid', 'untested': u'לא נבדק עדיין',
           'heavy': u'כבד מדי לחיבור הנוכחי', 'device': u'המכשיר לא יציג אותו כראוי', 'doubt': u'ההתאמה לכותר לא ודאית'},
    'en': {'top': 'Highly recommended', 'good': 'Recommended', 'fair': 'Fair', 'low': 'Less recommended', 'head': 'Recommendation',
           'match': 'Right file', 'works': 'Link works', 'speed': 'Smooth on this connection', 'he': 'Hebrew',
           'pic': 'Picture', 'tested': 'tested, works', 'cached': 'cached on Real-Debrid', 'untested': 'not tested yet',
           'heavy': 'too heavy for this connection now', 'device': 'this device cannot show it properly', 'doubt': 'the match is not certain'},
    'ru': {'top': u'Очень рекомендуем', 'good': u'Рекомендуем', 'fair': u'Нормально', 'low': u'Менее рекомендуем', 'head': u'Рейтинг',
           'match': u'Тот самый файл', 'works': u'Ссылка работает', 'speed': u'Без остановок на этом соединении', 'he': u'Иврит',
           'pic': u'Картинка', 'tested': u'проверено, работает', 'cached': u'в кэше Real-Debrid', 'untested': u'ещё не проверено',
           'heavy': u'слишком тяжёлый для соединения сейчас', 'device': u'устройство не покажет его как следует', 'doubt': u'совпадение не точное'},
}
SHARE = 0.75            # the part of the connection a film may use (the same as linkspeed.SHARE)


def tier(pct):
    for floor, name in TIERS:
        if pct >= floor:
            return name
    return 'low'


def _need(c, runtime):
    dur = c.get('duration') or runtime
    size = c.get('size')
    return (size / float(dur)) if dur and size else 0


def _speed_points(c, link, runtime):
    need = _need(c, runtime)
    src = c.get('speed') or 0                       # bytes per second the source gave in the link test
    line = link * SHARE if link else 0              # ... and what this connection can spare now
    have = min(x for x in (src, line) if x) if (src or line) else 0
    if not need or not have:
        pts = 15.0 if c.get('probe') == 'ok' else 12.0      # nothing to compare: neither praised nor punished
    else:
        r = have / need
        pts = 25.0 if r >= 2 else 12.5 + 12.5 * (r - 1) if r >= 1 else max(0.0, 5.0 * (r - 0.6) / 0.4)
    if c.get('smooth') is False:
        pts = min(pts, 8.0)
    return round(pts, 1)


def _hebrew_points(c):
    if c.get('he_audio_inside') or c.get('he_sub_inside'):
        return 12.0
    if c.get('he_sub_synced'):
        return 10.0
    langs = [str(x).lower() for x in (c.get('langs') or [])]
    if any(x in ('he', 'heb', 'hebrew', 'iw') for x in langs):
        return 8.0
    return 3.0


def _picture_points(c):
    try:
        q = int(str(c.get('quality') or 0).lower().replace('p', '') or 0)
    except ValueError:
        q = 0
    return 8.0 if q >= 2160 else 7.5 if q >= 1080 else 5.5 if q >= 720 else 3.0 if q >= 480 else 2.0 if q else 4.0


def rate(c, link=0, runtime=0):
    """c: a public source row (sources.Finder._public). -> {'pct': 0-100, 'tier', 'parts': {...}, 'flags': [...]}"""
    flags = []
    match = c.get('match') or 0
    if not match:                                   # sources that carry no "title 0.xx" line (exact id matches)
        match = 60 if c.get('loose') else 85
    right = 30.0 * min(100, match) / 100.0
    probe = c.get('probe') or 'untested'
    if probe == 'ok':
        works = 25.0
        flags.append('tested')
    elif c.get('rd_cached') or probe == 'rd':
        works = 22.0
        flags.append('cached')
    else:
        works = 10.0
        flags.append('untested')
    speed = _speed_points(c, link, runtime)
    he = _hebrew_points(c)
    pic = _picture_points(c)
    total = right + works + speed + he + pic
    cap = 100.0
    if 'untested' in flags:
        cap = min(cap, 60.0)
    if c.get('loose') or match < 60:
        cap = min(cap, 45.0)
        flags.append('doubt')
    if c.get('heavy'):
        total -= 35
        cap = min(cap, 35.0)
        flags.append('heavy')
    if c.get('device_warn'):
        total -= 35
        cap = min(cap, 35.0)
        flags.append('device')
    pct = int(round(max(0.0, min(cap, total))))
    return {'pct': pct, 'tier': tier(pct), 'flags': flags,
            'parts': {'match': round(right, 1), 'works': works, 'speed': speed, 'he': he, 'pic': pic}}


def rank(rows, link=0, runtime=0):
    """adds 'rec' (0-100), 'rec_tier', 'rec_parts', 'rec_flags' to every row and returns them best first.
    Equal numbers keep the order they came in (the engine's own ranking)."""
    for i, c in enumerate(rows):
        r = rate(c, link, runtime)
        c['rec'], c['rec_tier'], c['rec_parts'], c['rec_flags'] = r['pct'], r['tier'], r['parts'], r['flags']
        c['_i'] = i
    rows = sorted(rows, key=lambda c: (-c['rec'], c['_i']))
    for c in rows:
        del c['_i']
    return rows


def words(lang):
    lang = (lang or 'en').lower()[:2]
    return TEXT.get('he' if lang == 'iw' else lang, TEXT['en'])


def badge(c, lang='en'):
    """the tag at the start of a row in Kodi: a coloured '92% Highly recommended' ('' when the row has no number)"""
    if c.get('rec') is None:
        return ''
    t = c.get('rec_tier') or tier(c['rec'])
    return u'[COLOR %s][B]%d%%[/B] %s[/COLOR]' % (COLOR[t], c['rec'], words(lang)[t])


def details(c, lang='en'):
    """lines for the link's details window"""
    if c.get('rec') is None:
        return []
    w, p = words(lang), c.get('rec_parts') or {}
    out = [u'%s: %d%% - %s' % (w['head'], c['rec'], w[c.get('rec_tier') or tier(c['rec'])])]
    for key, top in (('match', 30), ('works', 25), ('speed', 25), ('he', 12), ('pic', 8)):
        if key in p:
            out.append(u'   %s: %d / %d' % (w[key], int(round(p[key])), top))
    notes = [w[f] for f in c.get('rec_flags') or [] if f in w]
    if notes:
        out.append(u'   ' + u' · '.join(notes))
    return out
