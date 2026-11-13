# -*- coding: utf-8 -*-
"""4.0.6: the permanent live broadcast of an official YouTube channel as a TV channel.

Many Israeli broadcasters and public bodies run their channel as a 24-hour live broadcast on their own YouTube
channel. The address of such a broadcast changes whenever it is restarted, so the channel list keeps the CHANNEL
("yt:UC..." or "yt:@handle") and the video is looked up when the viewer opens it: YouTube's own
/channel/<id>/live page names the video that is live right now. No API key is needed.
Pure functions (parse) + one request (find); played through the YouTube add-on the build ships."""
import json
import re

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
_ID = re.compile(r'^UC[0-9A-Za-z_-]{22}$')
_HANDLE = re.compile(r'^@[0-9A-Za-z_.\-]{3,40}$')
_VIDEO = re.compile(r'^[0-9A-Za-z_-]{11}$')


def page_url(ref):
    """'UC...' / '@handle' -> the address of the channel's "live now" page, or None for anything else"""
    ref = (ref or '').strip()
    if _ID.match(ref):
        return 'https://www.youtube.com/channel/%s/live' % ref
    if _HANDLE.match(ref):
        return 'https://www.youtube.com/%s/live' % ref
    return None


def parse(html, channel_id=None):
    """-> the id of the video that is live now on that page, or None (no broadcast, an upcoming one, another
    channel's video). The page of a channel that is not live is the channel's ordinary page: it names no video."""
    if not html:
        return None
    m = re.search(r'<link rel="canonical" href="https://www\.youtube\.com/watch\?v=([0-9A-Za-z_-]{11})"', html)
    if not m:
        return None
    vid = m.group(1)
    if not re.search(r'"isLive(?:Now)?"\s*:\s*true', html):
        return None                                  # a premiere that has not started, a finished broadcast
    if '"isUpcoming":true' in html and '"isLiveNow":true' not in html:
        return None
    if channel_id and _ID.match(channel_id):
        owner = re.search(r'"channelId"\s*:\s*"(UC[0-9A-Za-z_-]{22})"', html)
        if owner and owner.group(1) != channel_id:
            return None
    return vid if _VIDEO.match(vid) else None


def find(ref, http=None, timeout=6):
    """-> video id of the channel's live broadcast or None; never raises"""
    url = page_url(ref)
    if not url:
        return None
    try:
        if http is None:
            import requests as http
        r = http.get(url, timeout=timeout, headers={'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.8'},
                     cookies={'CONSENT': 'YES+cb', 'SOCS': 'CAI'})
        if r.status_code != 200:
            return None
        return parse(r.text, ref if _ID.match(ref) else None)
    except Exception:
        return None


def play_url(video_id):
    return 'plugin://plugin.video.youtube/play/?video_id=%s' % video_id if _VIDEO.match(video_id or '') else None
