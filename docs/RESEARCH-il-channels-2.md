# Research 2: legal Israeli live streams - wide search, live verification, logos, guide

Checked on **2026-11-16, 18:08-18:45 UTC (20:08-20:45 Israel time, Monday, prime time)** from an Israeli connection.
Machine-readable result: `docs/il_channels_candidates.json` (54 entries). Earlier report: `docs/RESEARCH-il-channels.md`.

## Method

- Pages: plain HTTP GET with a browser User-Agent; pages behind a bot check (kan.org.il, main.knesset.gov.il,
  13tv.co.il, tv10.co.il, 102fm.co.il, eco99fm, 103fm) were opened in a browser only to read the page source /
  the stream URL the player requests. No logins, no sign-ups, nothing downloaded or run.
- Stream check (every "passed" below): (a) master playlist 200 + `#EXTM3U`, variants recorded; (b) best variant's
  media playlist lists segments, no `#EXT-X-ENDLIST`; (c) newest segment fetched in full, delivery speed =
  bytes*8/seconds divided by the variant's declared bitrate, must be >= 1.5; (d) media playlist fetched again
  25 s later, media sequence / last segment must have moved. No stream showed `#EXT-X-KEY` (no DRM anywhere).
- Abroad is **untested** for everything (Kan / Channel 14 / Kalkala 10 sit on Israeli redge CDN nodes).
- The picture itself was never looked at - "passed" is a transport check.

## Result in one paragraph

The open web has almost nothing left that is not already in the build. Two new entries passed (Musawa, and a
Mount Hermon camera that needs a small resolver). The useful output of this round is elsewhere: **official direct
URLs for 9 channels that the build plays only through Idan+** (Reshet 13 and its subtitled feed, Kan Educational,
Kan 11 subtitled, Knesset Channel, Kalkala 10, Channel 16, Kabbalah 66, Kabbalah Russian), all direct URLs already
in `livefail.py` still pass, and a logo + guide audit of every channel.

## 1. New, verified

| Channel | Category | URL | Variants | Speed | Proof | Caveats |
|---|---|---|---|---|---|---|
| Musawa (قناة مساواة) | arabic | `https://pbc.furrera.ps/musawahd/index.m3u8` | 1080p 4.7 / 720p 2.1 / 360p 1.1 Mbps | 5.7x | https://musawachannel.com/live (inline `hls.loadSource`) | Passed 3 times today, with and without Referer - no headers needed; the 403 of the earlier recheck did not reproduce. Palestinian Broadcasting Corporation channel for Arab citizens of Israel, not an Israeli broadcaster. No guide. |
| Mount Hermon - lower station camera | camera | `https://s173.ipcamlive.com/streams/<streamid>/stream.m3u8` | one rendition, ~0.93 Mbps, no audio | 5.2x | https://skihermon.co.il/ (iframe `g2.ipcamlive.com/player/player.php?alias=tahton`) | Not a fixed URL: resolve with `GET https://g2.ipcamlive.com/player/getcamerastreamstate.php?alias=tahton` -> `details.streamavailable`, `details.address`, `details.streamid`. Checked after dark. Upper camera (`alias=elion`) was offline. No logo (site logo is SVG / AVIF). |

## 2. Official direct URLs for channels the build plays only through Idan+ (all passed today)

| Channel (key) | URL | Variants | Where it comes from |
|---|---|---|---|
| Reshet 13 (`reshet13`) | `https://d198ztbnlup2iq.cloudfront.net/out/v1/850e31c0e6fa4d94a44d6ccd63e4b400/index.m3u8` | 720p 1.14 Mbps max | requested by the player on https://13tv.co.il/live/ (browser network log) |
| Reshet 13 subtitled (`reshet13c`) | `https://reshet.g-mana.live/media/4607e158-e4d4-4e18-9160-3dc3ea9bc677/mainManifest.m3u8` | 720p 1.73 Mbps | same page, `__NEXT_DATA__` -> `liveSources.desktop.live_with_subs`. That it is the hard-of-hearing feed is read from the field name only - look at it once. (`live_no_subs` on dsk76kvc9kie6.cloudfront.net: 403 to a plain GET.) |
| Kan Educational (`kanedu`) | `https://kancdn.medonecdn.net/livehls/oil/kancdn-live/live/kan_edu/live.livx/playlist.m3u8` | 1080p 5.7 Mbps | kan.org.il/live, kankids.org.il/kids-live |
| Kan 11 subtitled (`kan11c`) | `.../live/kan11_subs/live.livx/playlist.m3u8` (same pattern) | 1080p | kan.org.il/live |
| Knesset Channel (`knesset`) | `https://knesetn.gostreaming.tv/Knesset/index.m3u8` | 720p 1.56 Mbps | Knesset site resource `broadcastLobby_KnessetChannelLivePath` |
| Knesset Channel, 2nd source | `https://kneset.gostreaming.tv/p2-kneset/_definst_/myStream/playlist.m3u8` | 720p 1.31 Mbps | HTML of https://www.knesset.tv/live/ |
| Kalkala 10 (`kalkala10`) | `https://r.il.cdn-redge.media/livehls/oil/calcala-live/live/channel10/live.livx/playlist.m3u8` | 1080p 4.9 Mbps | page source of https://tv10.co.il/ |
| Channel 16 (`ch16`) | `https://ch16israel-cdn.encoders.immergo.tv/2/streamPlaylist.m3u8` | one rendition ~5.7 Mbps | immergo account `ch16israel` (same as the site's logo host); URL not visible in the site's static HTML - ownership inferred |
| Kabbalah 66 (`kab66`) | `https://edge2.il.kab.tv/live/tv66-heb-high/playlist.m3u8` | 504p 1.1 Mbps | page source of https://www.kab.co.il/ |
| Kabbalah Russian (`kabru`) | `https://edge3.uk.kab.tv/live/tvrus-rus-high/playlist.m3u8` | 504p 0.57 Mbps | page source of https://www.kabbalah.info/rus/tv/ |

Also seen: Hidabroot's page now loads `https://htv-live.cybercdn.live/HidabrootIL/Live97/playlist.m3u8` (passed; the
`cdn.cybercdn.live` URL in the build also still passes) - a ready second source.

## 3. Direct URLs already in `livefail.py` - all pass

| Key | Best variant | Speed | Note |
|---|---|---|---|
| kan11 | 1080p 5.7 Mbps | 4.0x | |
| makan33 | 1080p 5.7 Mbps | 2.2x | lowest margin of all, still above 1.5 |
| now14 | 540p 1.9 Mbps | 66x | 540p is the best the broadcaster offers |
| ch9 | 1080p 4.9 Mbps | 44x | |
| hidabroot | 720p 1.1 Mbps | 12.8x | see second host above |
| i24he / i24en / i24fr / i24ar | 1080p 5.6 Mbps | 22-59x | |
| lev91 | 1080p 2.2 Mbps | 8.4x | |
| kolchaimusic | 720p 2.6 Mbps | 5.9x | playlist holds 2 segments, sequence was 17-22: started on demand, first seconds can fail |

**No existing channel is broken.** Not tested here (no official direct URL found, they play only through Idan+ /
YouTube): Keshet 12 (+subtitled), Channel 24, Keshet's six web channels, Knesset subtitled, 100FM Radius video,
Pervoe Radio video, Western Wall (YouTube). They are in the JSON as `existing-ok` with `url` empty,
`advancing: false` and notes starting with `UNTESTED`.

From the free playlists: Hala TV (`stream.panet.com/edge/halaTV`, also in panet.com's page source), Ma'an TV and
Shelanu TV passed. Reshet's comedy / reality / vacation channels: the cloudfront URLs in the iptv-org list passed,
but I could not prove them on 13tv.co.il - keep Idan+.

## 4. Rejected

| Candidate | Reason |
|---|---|
| Knesset plenum / committee rooms | Nothing live at check time (plenum over, `CommitteesLive` empty). API the page uses: `https://knesset.gov.il/WebSiteApi/knessetapi/KnessetMainLobby/GetKnessetLobbyBroadcastcurrent` -> `PlenumStatus[0].IsPlenumActive`, `CommitteesLive[].Stream_PublishedUrl`. During a plenum sitting the page plays the Knesset Channel stream - there is no separate plenum feed. Site answers scripts with HTTP 247. Recheck Mon/Tue 16:00, Wed 11:00 for committee rooms. |
| Israel Hayom live slot (`gw2.l7cdn.com/ih/live/public/slot1_israelhayom-live3`) | In the home page data but 404 - an event slot, not a channel. |
| ILTV (`stream.mux.com/<id>.m3u8?token=...`) | Token is reproducible (fresh with every GET of iltv.tv) but the playlist is VOD (`#EXT-X-ENDLIST`) - the latest programme, not a live channel. |
| Kol Chai Music digital channels (`live.kcm.fm/<nn>/hls.m3u8`, 30+) | Official and live, audio only. |
| 770 Live | Works (Cloudflare Stream, 720p) but it is in Brooklyn, not Israel. |
| Radio Tel Aviv 102FM video | `https://www.102fm.co.il/api/getLivestream` -> `{"isLive":false}`. Recheck by day. |
| Mount Hermon upper camera | offline. |
| Kan radio (8 stations) | audio only; kan.org.il/live has exactly 4 video streams, all in the build. |
| Walla, ynet, Maariv, Globes home, mako home | VOD clips only, no live channel reference. (Calcalist and the Globes TV page answered 403 - not read.) |
| 103FM, ECO 99FM, Kol Rega, Radio Darom, Galei Israel, Kol Barama, Radio Eilat, Radio Haifa, 90FM, Radio Sport 5 | audio only or YouTube. |
| Daystar, METV, GOD TV, TBN Israel | foreign broadcasters / YouTube only / 403. |
| The Israeli Network | pay channel abroad. |

## 5. Searched, nothing found (do not repeat)

- **Kan**: kan.org.il/live (browser) - no digital-only video channel, no radio studio camera.
- **News sites**: walla.co.il, ynet.co.il (+ynetnews), maariv.co.il, israelhayom.co.il, globes.co.il (403 to scripts),
  calcalist.co.il (403), themarker, haaretz, bizportal, ice.co.il, inn.co.il, israelnationalnews.com, jpost.com,
  jns.org, kikar.co.il, srugim.co.il (own VOD only), 0404, mivzaklive, jdn, vesty, democratv.org.
- **Sport**: sport5.co.il, one.co.il, sport1.maariv - no free live stream in the page.
- **Religion**: emess.co.il / 93fm (VOD + the clip channel already in the build), kol-barama, meirtv.com (YouTube),
  shofar.tv (+/live: nothing), breslev.co.il (VOD), moreshet-maran.com (weekly lesson, no channel), chabad.co.il,
  chabad.info, col.org.il, orhachaim.co.il (YouTube), kabtv.co.il; orot.tv timed out again; chabad.org and
  yeshiva.org.il 403; arutz2000 / dvarmalchut do not resolve.
- **Arabic**: panet.com (Hala only), kul-alarab.com / alarab.com (VOD), ashams.com (YouTube), bokra.net, arab48.com.
- **Russian**: iton.tv (YouTube playlist), 891fm.co.il (audio), israelplus.tv (Vimeo promo); bestradio.fm and
  9tv.co.il 403.
- **English**: iltv.tv (VOD), tv7israelnews.com (YouTube), jns.org (YouTube).
- **Cameras / nature**: thekotel.org (YouTube only), birds.org.il live-cameras page (no stream in HTML),
  natureisrael.org (YouTube), agamon-hula.co.il, parks.org.il, kkl.org.il, teva.org.il, safari.co.il, eilat.city
  (Vimeo loop), gosurf.co.il; coralworld.co.il has a broken certificate; jerusalemzoo.org 403.
- **Public bodies**: tel-aviv.gov.il, haifa.muni.il (jerusalem.muni.il 403), supreme.court.gov.il (YouTube),
  mod.gov.il (YouTube), ims.gov.il (YouTube), iroads.co.il, iaa.gov.il, oref.org.il, gov.il (403), idf.il (bot check).
- **Universities / culture**: openu.ac.il, technion.ac.il, tau.ac.il, haifa.ac.il, weizmann / davidson.org.il,
  yadvashem.org - no live channel. Channel 98: no official site found.
- Web search for municipal council / court / camera streams returned only third-party aggregators and old news.

## 6. Logos

Verified = HTTP 200, `image/png` or `image/jpeg`, > 2 KB, dimensions read from the file. URLs are in the JSON.

| Channel | Host | Size | Remark |
|---|---|---|---|
| Kan 11 (+subtitled) | Wikimedia Commons (PNG thumb of SVG) | 960x372 | |
| Keshet 12 (+subtitled) | Wikimedia Commons | 960x936 | |
| Reshet 13 (+subtitled) | Wikimedia Commons | 492x610 | |
| Now 14 | Wikimedia Commons | 581x581 | c14.co.il also has a 1024x1024 PNG |
| Kan Educational | Wikimedia Commons | 960x148 | wide wordmark |
| Channel 24 | Wikimedia Commons | 305x277 | |
| Makan 33 | Wikimedia Commons | 600x336 | |
| Channel 9 | Wikimedia Commons | 460x492 | |
| i24NEWS x4 | Wikimedia Commons | 960x960 | |
| Knesset (+subtitled) | knesset.tv | 531x200 | |
| Kalkala 10 | tv10.co.il | 1281x327 | wide |
| Channel 16 | its immergo account | 861x702 | |
| Kabbalah 66 / Russian | kab.co.il / kabbalah.info | 270x270 / 180x180 | |
| 100FM Radius, Pervoe 89.1 | stations' own CDN | 200x200 / 270x270 | |
| Shelanu, Western Wall, Kol Chai Music | own sites | 512x512 / 574x574 / 1075x1024 | |
| Lev HaMedina, Musawa | own sites | 365x83 / 427x78 | wide wordmarks |
| Reshet comedy | Reshet's Kaltura image host | 288x153 JPEG | |

Problems:
- **Hidabroot, Hala TV**: no usable broadcaster-hosted file (Hidabroot's share logo is 404, Panet's Hala logo is
  54x30); verified copies exist only on imgur (512x98, 261x202).
- **Reshet reality / vacation, Keshet food**: only small third-party copies (220x132, 132x132, 512x219).
- **No logo found**: Eretz Nehederet, Savri Maranan, Keshet comedy / drama / music channels, Ma'an TV
  (site 403), Mount Hermon (SVG / AVIF only).
- Wikimedia rate-limits bursts (429 after ~40 quick requests) - fetch logos once and cache them.

## 7. Guide (EPG)

How the build works today (`epg.py`, `iptv.py`): one source, `epgshare01.online/epgshare01/epg_ripper_IL1.xml.gz`;
channels are matched by normalised name / `IL_ALIASES`, and the guide's id becomes the tvg-id. I ran the build's
own `epg.match` against today's IL1 file:

| Channel | IL1 id the build gets | Programmes starting today |
|---|---|---|
| Kan 11 | `כאן.11.il` | 19 |
| Keshet 12 | `ערוץ.12.שידור.חי.il` | 25 |
| Reshet 13 | `רשת.il` | 26 |
| Now 14 | `ערוץ.14.HD.il` | 17 |
| Kan Educational | `כאן.חינוכית.il` | 47 |
| Channel 24 | `מוסיקה.24.il` | 30 |
| Makan 33 | `מכאן.il` | 22 |
| Knesset | `ערוץ.הכנסת.il` | 17 |
| Channel 9 | `ערוץ.9.il` | 22 |
| Hidabroot | `ערוץ.הידברות.il` | 17 |
| i24 Hebrew / English / French / Arabic | `עברית.i24.il`, `i24NEWS.ENGLISH.il`, `i24NEWS.FRENCH.il`, `i24NEWS.ARABIC.il` | 20-22 |
| Vacation / Reality (Reshet) | `ערוץ.הנופש.il`, `ערוץ.הריאליטי.il` | 40 / 19 |

Guide problems found:
- **Kalkala 10 gets no guide** although IL1 has `ערוץ.הכלכלה.il` with today's programmes (12): the names
  "Kalkala 10" / "כלכלה 10" do not match "ערוץ הכלכלה". An alias fixes it.
- **The four subtitled channels get no guide** (names like "Kan 11 - subtitled" match nothing). They show the same
  programmes as their parents; the JSON gives the parent's id.
- **Reshet comedy**: IL1 has `ערוץ.הקומדיות.הקלאסיות.il` (44 today), probably this channel - not confirmed, left empty.
- **None found anywhere**: Channel 16, Kabbalah 66 / Russian, Keshet's six web channels, Hala, Ma'an, Shelanu,
  Musawa, radio video channels, cameras.

Other sources checked:
- `open-epg.com/files/israel1.xml`, `israel2.xml`, `israel3.xml`: fetched, have today for the same main channels
  (israel3 mirrors IL1's ids with a `.il` suffix in names; israel2 adds "ערוץ 14 - כבדי שמיעה"). Nothing the
  build lacks; in israel1 Knesset and i24 Hebrew were empty today. `israelpremium1.xml` is empty.
- `epg.pw/xmltv/epg_IL.xml`: 404.
- iptv-org/epg grabbers for Israel: `freetv.tv` (Kan 11, Keshet 12, Reshet 13, Now 14, Kan Educational, Makan,
  Knesset), `mako.co.il`, `9tv.co.il`, `i24news.tv`, `yes.co.il` (ids without xmltv mapping). iptv-org publishes
  no ready-made XML - these are grabber configs only.
- Broadcasters' own: mako `https://www.mako.co.il/AjaxPage?jspName=EPGResponse.jsp` (JSON, today present);
  i24 `https://api.i24news.tv/v2/he/schedules` (JSON, fetched; en / fr / ar by the same pattern, not fetched);
  9tv `.../BroadcastSchedule/getBrodcastSchedule?date=...` (site 403 to scripts, not fetched); Knesset
  `.../KnessetMainLobby/GetKnessetChannelBroadcastPlan` (exists in the site script, not parsed). Kan, Reshet,
  Channel 14 and Hidabroot schedule pages were not probed.

## 8. Could not determine

- Whether anything plays abroad.
- Knesset committee-room streams (none in session) and 102FM's video (off) - both need a daytime check.
- Picture content: nothing was watched, so "Reshet 13 with subs", the Hermon camera's picture quality and
  resolution, and Channel 16's resolution are unconfirmed.
- Page proof for Channel 16, Shelanu, Ma'an and Reshet's three web channels (JS sites / 403).
- Sites that refused scripts and were not opened in a browser: globes, calcalist, 9tv, maannews, god.tv,
  chabad.org, bestradio.fm, jerusalem.muni.il, gov.il.

## Appendix: YouTube only (not verified, not proposed)

Official channels whose live output exists only on YouTube, as seen linked from their own sites today or in the
earlier report: Western Wall cameras (thekotel.org), Meir TV, 103FM studio, Radio Haifa 107.5, A-Shams,
DemocraTV, Arutz Sheva, Kikar HaShabbat, TBN Israel, TV7 Israel News, JNS TV, Iton TV, Jerusalem Post,
Israel National News, Mivzak Live, Walla, ynet, Israel Hayom, Sport 5, ONE, 100FM Radius, Lev HaMedina,
Musawa, Or HaChaim, Supreme Court (`UCEPK9oBG9fVgjY8YNo8eZOQ`), Israel Meteorological Service, Ministry of
Defense, Netivei Israel, SPNI nature cameras (natureisrael.org), Charter Group bird cameras, the Knesset.
