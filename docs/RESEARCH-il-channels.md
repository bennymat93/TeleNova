# Research: free official Israeli live streams not yet in the build

Checked on **2026-11-13, 01:10-01:35 UTC (03:10-03:35 Israel time, Friday night)**.
Method: plain HTTP GETs (browser User-Agent) of broadcaster pages, playlists and YouTube pages; a few JS-rendered pages (kan.org.il, knesset.gov.il, emess.co.il, radio.sport5.co.il) were opened in a browser only to read which stream URLs the page itself references. Nothing was downloaded, no logins, no sign-ups.

Important limits of this check:

- It ran in the middle of the Israeli night. Anything that is only live during the day (news studios, radio studio cams on YouTube, Knesset sittings) could not pass the live check and is therefore in "Unverified", not because it is bad but because it was not live.
- All requests came from this machine's own connection, so geo-blocking for viewers abroad could not be tested.
- "Verified" for HLS means: HTTP 200, body starts with `#EXTM3U`, and (where noted) the variant playlist listed media segments.

## 1. HLS video streams on the broadcaster's own site (verified live)

| English name | Hebrew / native name | Category | Stream URL | Proof page | Verified | Notes |
|---|---|---|---|---|---|---|
| Radio Lev HaMedina 91FM - studio video | רדיו לב המדינה 91FM - שידור וידאו | music/radio video | `https://cdn.cybercdn.live/Lev_Hamedina/Video/playlist.m3u8` | https://www.91fm.co.il/video-translation/ (the page's `<video><source>` is exactly this URL; linked from the home page as "LIVE STREAM / שידור וידאו") | 2026-11-13 01:20 and 01:32 UTC: 200, `#EXTM3U`, 1 variant 1920x1080 (avc1+aac, ~2.2 Mbps); variant playlist listed 6 segments | No Referer needed. Same CDN (cybercdn.live) as other Israeli radio stations. Mizrahi / Mediterranean music station. |
| Kol Chai Music - clip channel | קול חי מיוזיק - ערוץ הקליפים | music/radio video (Haredi) | `https://media.kcm.fm/rtmp-server/live/musiclip.m3u8` | https://www.emess.co.il/video/ (Kol Chai group's site; the page's player loads this URL from media.kcm.fm, the group's media host; poster path on emess.co.il is `/rtmp-server/live/musiclip.m3u8/...`) | 2026-11-13 01:31-01:33 UTC: 200, `#EXTM3U`, 5 variants 240p-720p (up to 2.6 Mbps); 720p and 480p variant playlists returned segments | No Referer needed. One variant request returned 404 once and 200 seconds later, and the variant playlist started at `MEDIA-SEQUENCE:0` - the stream may be started on demand, so the first seconds can fail; retry. Haredi music videos. |
| Musawa Channel | قناة مساواة | Arabic | `https://pbc.furrera.ps/musawahd/index.m3u8` | https://musawachannel.com/live (inline script: `hls.loadSource('https://pbc.furrera.ps/musawahd/index.m3u8')`) | 2026-11-13 01:32 UTC: 200, `#EXTM3U`, 3 variants 360p/720p/1080p (up to 4.7 Mbps); 360p variant listed 4 segments | No Referer needed. Run by the Palestinian Broadcasting Corporation for Arab citizens of Israel - it is the channel's own stream, but it is not an Israeli broadcaster; decide whether it belongs next to Hala / Ma'an. The page also has an `http://htvpalsat.mada.ps:8888/musawa/index.m3u8` fallback (plain http with port - not recommended). |

## 2. Official audio-only HLS streams (verified live, no picture)

Not television, listed because they are the broadcaster's own open streams and may fit a radio section.

| English name | Hebrew name | Category | Stream URL | Proof page | Verified | Notes |
|---|---|---|---|---|---|---|
| Kan Reshet Bet | כאן רשת ב | public / news radio | `https://kancdn.medonecdn.net/livehls/oil/kancdn-live/live/radio/kan_reshet_bet/live.livx/playlist.m3u8?renditions&fmp4` | https://www.kan.org.il/live/ (URL appears in the page source) | 2026-11-13 01:27 UTC: 200, `#EXTM3U`, AAC 192 kbps audio rendition | The query string is required: without `?renditions&fmp4` the server answers 200 with an empty playlist (only the `#EXTM3U` line). fMP4 audio. Redirects to a Bezeq/redge CDN node - probably Israel-only. kan.org.il itself sits behind a Cloudflare check for non-browser clients, the CDN does not. |
| Kan Gimel | כאן גימל | music radio | same pattern, name `radio/kan_gimel` | same | same check, 200 + audio rendition | same |
| Kan 88 | כאן 88 | music radio | same pattern, name `radio/kan_88` | same | same; media playlist listed 8 segments | same |
| Kan Tarbut | כאן תרבות | public radio | same pattern, name `radio/kan_tarbut` | same | same check | same |
| Kan Reka | כאן רק"ע | Russian (and other immigrant languages) | same pattern, name `radio/kan_reka` | same | same check | same |
| Kan Kol HaMusica | כאן קול המוסיקה | music radio (classical) | same pattern, name `radio/kan_kol_hamuzika` | same | same check | same |
| Kan Moreshet | כאן מורשת | religion | same pattern, name `radio/kan_moreshet` | same | same check | same |
| Makan Radio | راديو مكان | Arabic | same pattern, name `radio/radio_makan` | same | same check | same |
| Radio Sport 5 (Radio 5) | רדיו ספורט 5 | sport | `https://rgelive.akamaized.net/hls/live/2043150/radio5/playlist.m3u8` | https://radio.sport5.co.il/home (the page's `<video>` source) | 2026-11-13 01:27 and 01:33 UTC: 200, `#EXTM3U`, one AAC ~105 kbps rendition, 10 segments | Audio only despite the `<video>` tag. No Referer needed. |

Also seen on kan.org.il/live (already in the build, listed only so the names are on record): `kan11`, `kan11_subs`, `kan_edu`, `makan` under `.../kancdn-live/live/<name>/live.livx/playlist.m3u8`. Guessed names (`kan23`, `kanedu`, `kan88`, `kanb`, `knesset`, `kids` and others) all returned 404.

## 3. YouTube permanent 24/7 live (verified live)

| English name | Hebrew name | Category | YouTube channel id | Proof page | Verified | Notes |
|---|---|---|---|---|---|---|
| Western Wall live cameras (Western Wall Heritage Foundation) | מצלמות הכותל המערבי (הקרן למורשת הכותל המערבי) | religion | `UCvcdHbNAQvbe2GuIDLhlwaw` | https://thekotel.org/he/ (official site, links `youtube.com/channel/UCvcdHbNAQvbe2GuIDLhlwaw`) | 2026-11-13 01:17 UTC: `/channel/<id>/live` resolved to video `LMHUcDktP-w`, `"isLiveNow":true`, owned by this channel. Three streams live at once, all started 2026-07-22 (running ~4 months): `LMHUcDktP-w` "Main Plaza Live Cam", `gJsZdfSyPrM` "The Western Wall", `Y3v2WGY-SDc` (third camera) | Permanent. Embedding allowed. Video ids change whenever the foundation restarts a stream, so resolve through the channel's `/live` (gives the main plaza camera) rather than hard-coding ids. The cameras are normally switched off on Shabbat and holidays - expect a blank/placeholder from Friday evening to Saturday night. |

## 4. Occasional-only (verified live)

None. Nothing that broadcasts only part of the day was live at 03:30 Israel time, so nothing qualifies for this table today. See the candidates in section 5.

## 5. Unverified (not in the main tables)

### 5a. Live now, but ownership not proven from the organisation's own website

| English name | Hebrew name | Category | YouTube channel id | What was seen | Why not in the main table |
|---|---|---|---|---|---|
| Charter Group Birdcams (Israeli wildlife nest cameras) | ציפורים אונליין - קבוצת צ'רטר | other (nature) | `UCzbydNAcB7jeJGssRFb_dCA` | 2026-11-13 01:27 UTC: `/live` -> `H_0LhmLuegA` `isLiveNow:true` ("6 Live Birdcams, One Stream"); at least 4 more cameras live, some since 2024-02 (barn owl, little owl, fruit bats). 254K subscribers, embeddable | The channel is clearly the project's own, but I did not find an organisation website linking to this channel id (birds.org.il and yardbirds.org.il did not). Probably fine; needs one proof link. |
| Rabbi Amnon Yitzhak - non-stop streams | הערוץ של הרב אמנון יצחק | religion | `UC4bag6Sil4ZIoXWDRsb6IfQ` | 2026-11-13 01:27 UTC: `/live` -> `dpG8h13mVZs` `isLiveNow:true` (started 2026-03-06); two more non-stop streams live since 2026-01-11 (`vfPTu-eepV0`, `gEZsCRbLSus`) | Only 6.5K subscribers; could be a fan channel. `shofar-tv.com` no longer belongs to the organisation (serves unrelated spam), so no official proof was found. |

### 5b. Official channel confirmed, but NOT live at check time (night) - recheck in the daytime

"Linked" = the channel is linked from the organisation's own website (fetched today). "Handle only" = found by its YouTube handle, link from the website not confirmed.

| English name | Hebrew name | Category | YouTube channel id | Officialness | Result at 01:15-01:30 UTC |
|---|---|---|---|---|---|
| DemocraTV | דמוקרטTV | news | `UC-NrL-C9NpTC_pDhg6LIbTQ` | Linked from democratv.org | not live |
| Arutz Sheva / Channel 7 | ערוץ 7 | news | `UCdURFUatW3GUF_0k1F0tcxA` | Linked from inn.co.il | not live (`/live` points at an old finished broadcast) |
| Kikar HaShabbat | כיכר השבת | news (Haredi) | `UCKK1JzwJzAVVJToQ4ezjDtg` | Linked from kikar.co.il (@kikarhashabat) | not live |
| Kol Chai | קול חי | music/radio video | `UChXGHfE7Vng3I3aiRx4AcQw` | Linked from emess.co.il (@kolchai) | not live |
| Kol Barama | קול ברמה | music/radio video | not resolved (site links `youtube.com/user/channelkolbarama`) | Linked from kol-barama.co.il | not checked for live; the site's own player is audio only |
| Meir TV (Machon Meir) | ערוץ מאיר | religion | `UCEAZVyOtukIOH4BJ3gHKdng` | Linked from meirtv.com | not live |
| Sport 5 | ערוץ הספורט | sport | `UCyXf5cz6E9IIL40aivg7tOw` | Linked from sport5.co.il | not live |
| ONE | ONE | sport | `UCgbHJENV6UgIZl1Rp_GXCfw` | Linked from one.co.il | not live |
| ynet | ynet | news | `UCpSSzrovhI4fA2PQNItecUA` | Linked from ynet.co.il | not live (`/live` points at a 2020 video) |
| Israel Hayom | ישראל היום | news | `UCYNmQ9W-0CYoW8a4thzxB0g` | Linked from israelhayom.co.il | not live |
| ILTV Israel News | - | news (English) | `UCuxgEyMeaks7HS5gAw6Tt7w` | Linked from iltv.tv (@IsraelEnglishNews) | not live |
| TV7 Israel News | - | news (English, Christian) | `UCGs-yDFkfHDbeQcApWkTtxg` | Linked from tv7israelnews.com | not live |
| 103FM | 103FM | music/radio video | `UCW4jrUdKsLeZ42v0oonhMXA` | Linked from 103fm.maariv.co.il | not live |
| Radio Haifa 107.5 | רדיו חיפה | music/radio video | `UCJ-V9m95R09ktR_9JxUwK-w` | Linked from 1075.fm | not live |
| Radio Lev HaMedina 91FM | רדיו לב המדינה | music/radio video | `UC_52fbT-HnNOuKTaqQEApCA` | Linked from 91fm.co.il | not live (use the HLS stream in section 1 instead) |
| A-Shams Radio | راديو الشمس | Arabic | `UCvMx64fPK5o8LslP2XD3xAQ` | Linked from ashams.com | not live |
| Musawa | قناة مساواة | Arabic | `UCwJbDUmIxc-JX8PX53ek2Zg` | Linked from musawachannel.com | not live (use the HLS stream in section 1 instead) |
| The Knesset | הכנסת | public | `UC4elaDPpw25TipG2U33paLA` | Linked from main.knesset.gov.il (`youtube.com/user/knesset`) | not live |
| Kan 11 | כאן 11 | public | `UCKqFqiCe1dCUxRe0_YNZ6gg` | Handle only (@kan11) | not live - so there is no permanent 24/7 Kan stream on YouTube |
| Kan Educational | כאן חינוכית | kids | `UC_fUfLFo31WTFZPxgr1EcLA` | Handle only (@kankids), 1.01M subscribers | not live |
| Kan Gimel | כאן גימל | music/radio video | `UCmXvXsUJ8ivNZ23qQfkxhnQ` | Handle only (@kangimel) | not live |
| Galei Tzahal | גלצ | public / news radio | `UCDqXTwewuU7YkmrpCousIIg` | Handle only (@glzradio) | not live |
| N12 News | החדשות 12 | news | `UCZH1ZFHSLSZEh_Ek2L-vrgA` | Handle only (@N12News) | not live |
| Government Press Office | לשכת העיתונות הממשלתית | public | `UCVrkzYVH_ptjxelKbA-CnuQ` | Handle only (@GPOIsrael) | not live |
| Prime Minister's Office | משרד ראש הממשלה | public | `UC4XJnRPZjXhgvVMhXKNSJvQ` | Handle only (@IsraeliPM) | not live |
| Hop! Channel | ערוץ הופ! | kids | `UClZXqxeY540_Epab3WDHFGw` | Handle only (@HopChannel), 689K subscribers | not live (and the linear channel is a pay channel) |
| 770Live (Chabad) | 770 לייב | religion | `UCxtw7Wsb6Dn1FEybL-WC1Gg` | Handle only, 1.7K subscribers | not live |
| TBN Israel | - | religion (Christian) | `UC73H5p3GP8b5N1f3hozIXyQ` | Handle only | not live |
| Best Radio Israel | Лучшее радио | Russian | `UCR76rvzLnocnj-07t0-dV8w` | Handle only | not live |
| Radio Tel Aviv, ECO 99FM, Radio Darom, Galey Israel | רדיו תל אביב, אקו 99, רדיו דרום, גלי ישראל | music/radio video | `UC1kPvMAI7yXbdTQnZT6_KJg`, `UC3qgk1PLPuxn0t3_yH1DpRg`, `UCdIl3Hie3OVudYxMHhpsSqQ`, `UCwD2ks-MsngzKvgb28zUpUQ` | Handle only; these may not be the stations' real channels (names are bare handles) | not live |

### 5c. Not reachable / not found

| Candidate | What happened |
|---|---|
| Knesset plenum and committee live streams (knesset.gov.il) | The broadcast pages only exposed recorded sittings (`https://video.knesset.gov.il/KnsVod/_definst_/mp4:vod/PLM/PlmSession_<id>.mp4/playlist.m3u8`); no live URL is present when nothing is sitting. The site answers non-browser clients with HTTP 247 (bot check), so a Kodi add-on could not scrape it directly anyway. Recheck during a sitting (Mon-Wed). |
| Galei Tzahal / Galgalatz studio video on glz.co.il | No video stream reference found on the site or its player API. |
| Shopping Channel 21 | No working official site found (21tv.co.il does not resolve; shoppingil.co.il is an unrelated Google event site). |
| Orot TV | orot.tv timed out. |
| Galey Israel, Radio Jerusalem, Radio Darom 97fm.co.il, Radio Nas | Sites did not resolve under the guessed domains (radiodarom.co.il works but is audio only). |
| Iton TV, Now 14 YouTube handle, Jerusalem Post, IDF Spokesperson, Channel 13 News | Guessed YouTube handles returned 404; not pursued. |
| Walla, Maariv | No live player found on the home pages. |
| Channel 98 community TV, municipal live cams, university channels | Not investigated in depth - no official always-on stream found. |

## 6. Rejected (with reason)

| Candidate | Reason |
|---|---|
| ILTV stream on iltv.tv (`https://stream.mux.com/<id>.m3u8?token=...`) | Signed, expiring token in the URL - cannot be stored in a channel list. |
| Radio sites: 103FM, Kol Rega 96FM, Kol Barama, Radio Darom, A-Shams, ECO 99FM, Radio Haifa, Radio Tzafon 104.5, 90FM | Their own players are audio only (e.g. `https://cdn.cybercdn.live/<station>/Live_Audio/...`, `https://cdna.streamgates.net/Ashams/Live/icecast.audio`); guessed video paths on cybercdn.live returned 404. No official video stream. (102FM's site threw a client-side error and showed nothing.) |
| Kabbalah channel in other languages (`edge3.uk.kab.tv/live/tv66-<lang>-high`) | eng/spa/ger/ita/fre/tur/ukr/ara all 404. |
| "ערוץ 10" on YouTube (`UCMw0hN39IPLXbHDknSLM04A`, live since 2026-11-05, 10K subscribers) | Owner not identified; most likely the economic channel Kalkala 10, which is already in the build. |
| EarthCam "Western Wall" (YouTube) | Third party, not an Israeli body; the Western Wall Heritage Foundation's own cameras are in section 3. |
| YouTube handle `@idf` (`UCwvbiJEOraaER7z1DYWy1VA`) | Not the army - a 157-subscriber gaming channel. |
| YouTube handles `@kann`, `@kanNews`, `@kan88`, `@TheKnesset`, `@ch14`, `@91fm` | Unrelated channels that merely hold those handles. |
| Everything in the public iptv-org Israel / Hebrew playlists that is not already in the build | Third-party restreams (stream.mcquack.net, bare IP addresses with ports) or pay channels (HOT, yes, kids and sport pay channels). Used only as a lead list; nothing taken from it. |
| Daystar "Jerusalem 24/7", Mt. of Olives Prayer Bridge cams and similar | Foreign organisations, not Israeli broadcasters. |
| Musawa fallback `http://htvpalsat.mada.ps:8888/musawa/index.m3u8` | Plain http on a port, different host; the https URL in section 1 is the one the page actually loads. |

## Counts

| Table | Entries |
|---|---|
| 1. HLS video (verified) | 3 |
| 2. HLS audio-only (verified) | 9 |
| 3. YouTube 24/7 (verified) | 1 channel, 3 simultaneous camera streams |
| 4. Occasional-only (verified) | 0 |
| 5a. Live but ownership unproven | 2 |
| 5b. Official but not live at check time | 30 rows |
| 5c. Not reachable / not found | 8 rows |
| 6. Rejected | 11 rows |
