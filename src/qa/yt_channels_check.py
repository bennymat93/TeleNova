# -*- coding: utf-8 -*-
"""Which official Israeli YouTube channels (docs/RESEARCH-il-channels.md, section 5b) are live right now?
Run it at different hours: a channel belongs in the TV list only when it is on the air around the clock.
Appends one line per run to qa/yt_channels_log.tsv (time + the live ones), prints a table."""
import importlib.util, io, os, sys, time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('ytlive', os.path.join(HERE, '..', 'plugin.video.nova', 'resources', 'lib', 'ytlive.py'))
yt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(yt)
CH = [('democratv', 'UC-NrL-C9NpTC_pDhg6LIbTQ'), ('arutz7', 'UCdURFUatW3GUF_0k1F0tcxA'), ('kikar', 'UCKK1JzwJzAVVJToQ4ezjDtg'),
      ('kolchai', 'UChXGHfE7Vng3I3aiRx4AcQw'), ('meir', 'UCEAZVyOtukIOH4BJ3gHKdng'), ('sport5', 'UCyXf5cz6E9IIL40aivg7tOw'),
      ('one', 'UCgbHJENV6UgIZl1Rp_GXCfw'), ('ynet', 'UCpSSzrovhI4fA2PQNItecUA'), ('israelhayom', 'UCYNmQ9W-0CYoW8a4thzxB0g'),
      ('iltv', 'UCuxgEyMeaks7HS5gAw6Tt7w'), ('tv7', 'UCGs-yDFkfHDbeQcApWkTtxg'), ('103fm', 'UCW4jrUdKsLeZ42v0oonhMXA'),
      ('haifa', 'UCJ-V9m95R09ktR_9JxUwK-w'), ('ashams', 'UCvMx64fPK5o8LslP2XD3xAQ'), ('knesset', 'UC4elaDPpw25TipG2U33paLA'),
      ('kotel', 'UCvcdHbNAQvbe2GuIDLhlwaw'), ('birdcams', 'UCzbydNAcB7jeJGssRFb_dCA')]
live = []
for name, cid in CH:
    vid = yt.find(cid)
    if vid:
        live.append(name)
    print('%-12s %s' % (name, vid or '-'))
stamp = time.strftime('%Y-%m-%d %a %H:%M')
with io.open(os.path.join(HERE, 'yt_channels_log.tsv'), 'a', encoding='utf-8') as f:
    f.write(u'%s\t%s\n' % (stamp, ','.join(live)))
print('%s: %d of %d live' % (stamp, len(live), len(CH)))
