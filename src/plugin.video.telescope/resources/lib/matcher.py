# -*- coding: utf-8 -*-
"""Decides whether a Telegram file is *exactly* the requested movie / episode and scores it.

Hard rules (never relaxed):
  * episodes: season and episode must match exactly (multi-episode files only if the range
    contains the requested episode); season packs / archives / trailers are rejected
  * movies: files carrying an episode marker are rejected; |year diff| <= 1;
    duration must fit the TMDB runtime when both are known
Everything that passes is graded: verdict 'accept' (confident), 'maybe' (needs AI or relaxed
mode) or 'reject'.
"""
import re
from difflib import SequenceMatcher

from .parser import normalize, VIDEO_EXT

_ROMAN = {'ii': '2', 'iii': '3', 'iv': '4', 'v': '5', 'vi': '6', 'vii': '7', 'viii': '8', 'ix': '9', 'x': '10'}
_STOPWORDS = {'the', 'a', 'an', 'of', 'and', 'le', 'la', 'il', 'der', 'die', 'das'}


def _tokens(text):
    out = []
    for t in normalize(text).split():
        t = _ROMAN.get(t, t)
        out.append(t)
    return out


def _numbers(tokens):
    return set(t for t in tokens if t.isdigit())


def title_similarity(candidate, alias):
    """0..1 similarity between a parsed candidate title and one alias."""
    ct, at = _tokens(candidate), _tokens(alias)
    if not ct or not at:
        return 0.0
    cn, an = ' '.join(ct), ' '.join(at)
    if cn == an:
        return 1.0
    cset = set(t for t in ct if t not in _STOPWORDS)
    aset = set(t for t in at if t not in _STOPWORDS)
    if not aset:
        aset = set(at)
    # sequel / numbering guard: "Toy Story 2" must not match "Toy Story"
    num_c, num_a = _numbers(ct), _numbers(at)
    if num_c != num_a and (num_c - num_a or num_a - num_c):
        extra = (num_c - num_a) | (num_a - num_c)
        # years inside titles are handled elsewhere; small numbers are sequels/parts
        if any(len(n) <= 2 for n in extra):
            return min(0.45, SequenceMatcher(None, cn, an).ratio())
    ratio = SequenceMatcher(None, cn, an).ratio()
    if aset <= cset:
        extra = len(cset - aset)
        cover = 0.97 - 0.06 * extra
        ratio = max(ratio, cover)
    elif cset <= aset and len(cset) >= max(1, len(aset) - 1) and len(aset) >= 3:
        ratio = max(ratio, 0.86)  # candidate dropped one word of a long title
    return ratio


def best_title_score(texts, aliases):
    best, best_alias = 0.0, ''
    for text in texts:
        if not text:
            continue
        for alias in aliases:
            sc = title_similarity(text, alias)
            if sc > best:
                best, best_alias = sc, alias
    return best, best_alias


def contains_alias(text, aliases):
    """True when a (reasonably long) alias appears as a whole phrase inside free text."""
    nt = ' ' + ' '.join(_tokens(text)) + ' '
    for alias in aliases:
        na = ' '.join(_tokens(alias))
        if len(na) >= 4 and (' ' + na + ' ') in nt:
            return True
    return False


def is_video_file(cand):
    ext = (cand.get('ext') or '').lower()
    mime = (cand.get('mime') or '').lower()
    if mime.startswith('video/') or ext in VIDEO_EXT:
        return True
    return bool(cand.get('is_video_attr'))


def caption_trailer(p, size, duration):
    """3.3: a trailer word in the CAPTION counts only for a short (< 10 min) or small (< 150 MB) file."""
    if not p.get('trailer_caption'):
        return False
    return bool((duration and duration < 600) or (size and size < 150 * 1024 * 1024))


def evaluate(cand, target, strict=True):
    """cand: dict with parsed fields + duration/size/mime/caption/chat_title.
    target: dict(kind='movie'|'episode', aliases=[...], year, season, episode, runtime (minutes),
                 total_seasons)
    Returns (verdict, score, reasons list)."""
    reasons = []
    p = cand['parsed']
    if p.get('is_archive') or not is_video_file(cand):
        return 'reject', 0, ['not a video']
    if p.get('is_trailer'):
        return 'reject', 0, ['trailer/sample']
    size = cand.get('size') or 0
    duration = cand.get('duration') or 0
    if caption_trailer(p, size, duration):
        return 'reject', 0, ['trailer/sample']
    if size and size < 15 * 1024 * 1024:
        return 'reject', 0, ['too small']

    aliases = target.get('aliases') or []
    texts = list(p.get('titles') or [])
    tscore, _ = best_title_score(texts, aliases)
    caption_hit = contains_alias(cand.get('caption', ''), aliases) or contains_alias(p.get('name', ''), aliases)
    chat_hit = contains_alias(cand.get('chat_title', ''), aliases)
    if caption_hit:
        tscore = max(tscore, 0.88)
    if chat_hit and tscore < 0.8:
        tscore = max(tscore, 0.8 if target['kind'] == 'episode' else tscore)
    reasons.append('title %.2f' % tscore)

    verdict = 'accept'
    score = tscore * 50.0
    runtime = (target.get('runtime') or 0) * 60

    if target['kind'] == 'movie':
        if p.get('episode') is not None and p.get('season') is not None:
            return 'reject', 0, ['episode file']
        # 3.3: "Movie.2019.COMPLETE.BluRay" is a movie: the pack word counts only next to a parsed season
        if p.get('season_pack') and p.get('season_hint') is not None:
            return 'reject', 0, ['season pack']
        ty, py = target.get('year'), p.get('year')
        if ty and py:
            diff = abs(int(ty) - int(py))
            if diff > 1:
                return 'reject', 0, ['year %s != %s' % (py, ty)]
            score += 10 if diff == 0 else 2
        elif ty:
            verdict = 'maybe'
            reasons.append('no year')
        if runtime and duration:
            tol = max(10 * 60, 0.15 * runtime)
            if abs(duration - runtime) > tol:
                return 'reject', 0, ['duration %d vs %d' % (duration // 60, runtime // 60)]
            score += 10 if abs(duration - runtime) < 0.06 * runtime else 4
            if verdict == 'maybe' and tscore >= 0.9:
                verdict = 'accept'  # year missing but runtime fits perfectly
        elif duration and duration < 40 * 60:
            return 'reject', 0, ['too short for a movie']
    else:
        s_req, e_req = int(target['season']), int(target['episode'])
        if p.get('season_pack') and p.get('episode') is None:
            return 'reject', 0, ['season pack']
        ep = p.get('episode')
        if ep is None:
            return 'reject', 0, ['no episode marker']
        ep_end = p.get('episode_end')
        if ep_end:
            if not (ep <= e_req <= ep_end):
                return 'reject', 0, ['episode range %d-%d' % (ep, ep_end)]
            score -= 8
            reasons.append('multi-episode')
        elif ep != e_req:
            return 'reject', 0, ['episode %s != %s' % (ep, e_req)]
        season = p.get('season')
        if season is None:
            season = p.get('season_hint')
        if season is None:
            season = p.get('chat_season')
        if season is None:
            if s_req == 1 and (target.get('total_seasons') or 1) == 1:
                reasons.append('season implied')
            else:
                verdict = 'maybe'
                reasons.append('season unknown')
        elif int(season) != s_req:
            return 'reject', 0, ['season %s != %s' % (season, s_req)]
        else:
            score += 10
        if runtime and duration:
            tol = max(6 * 60, 0.35 * runtime)
            if abs(duration - runtime) > tol and duration < runtime:
                verdict = 'maybe' if verdict == 'accept' else verdict
                reasons.append('short episode')

    threshold = 0.82 if strict else 0.72
    if tscore < 0.55:
        return 'reject', 0, reasons + ['title mismatch']
    if tscore < threshold:
        verdict = 'maybe'

    # quality / source / language preference
    q = p.get('quality') or 0
    score += {2160: 12, 1080: 10, 720: 6, 480: 2}.get(q, 3)
    if p.get('source') == 'cam':
        score -= 30
        reasons.append('CAM')
    if p.get('hdr'):
        score += 1
    return verdict, round(score, 2), reasons


def language_bonus(langs, pref):
    """pref: 'any' | 'he' | 'ru' | 'en'."""
    langs = set(langs or [])
    if pref == 'he':
        if langs & {'he_sub', 'he_dub'}:
            return 15
        if 'he_text' in langs:
            return 6
    elif pref == 'ru':
        if 'ru_audio' in langs:
            return 15
        if langs & {'ru_sub', 'ru_text'}:
            return 6
    elif pref == 'en':
        if 'en' in langs or not (langs & {'he_dub', 'ru_audio'}):
            return 5
    return 0


def episode_label(season, episode):
    return 'S%02dE%02d' % (int(season), int(episode))


def clean_query(text):
    text = re.sub(r'[:!?.,"\'()\[\]]', ' ', text or '')
    return re.sub(r'\s+', ' ', text).strip()
