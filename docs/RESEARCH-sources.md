# Finding, checking and verifying links - research and shortlist

Free and open tools first; anything paid is listed at the end as a question for the owner. [V] = verified in source or
by a live request during the research, [I] = inference or secondary source.

## Findings

**Real-Debrid now refuses some cached files.** Since about May 2026 unrestricting can answer `infringing_file` [I,
ElfHosted blog; no official statement]. The engine must treat it as a dead link, drop it and remember the hash.

**Stremio-protocol sources** (`GET {base}/{config}/stream/{movie|series}/{tt[:s:e]}.json`)

| Add-on | Licence | "Cached at RD" today | Public instance |
|---|---|---|---|
| Torrentio | Apache-2.0 | its own shared availability cache, updated on resolves [V] | torrentio.strem.fun [V] - already used |
| StremThru | MIT | crowd-sourced magnet cache; `GET /v0/store/torz/check?hash=..&sid=tt..` with the store token returns per-file lists [V docs] | stremthru.13377001.xyz, stremthru.elfhosted.com [V]; self-hostable |
| Comet | GPL-3.0 | delegates to StremThru [V] | comet.elfhosted.com [V] |
| MediaFusion | MIT | not established | mediafusion.elfhosted.com [V]; config must be made on its page |
| AIOStreams | AGPL-3.0 | aggregator only | aiostreams.elfhosted.com [V] |
| Zilean, Jackettio, Knightcrawler | - | stale (2024-2025) | skip |

*Privacy: a StremThru cache check sends the Real-Debrid token to that instance. Self-hosting avoids it.*

**AIOStreams' de-duplication is worth copying** [V, `packages/core/src/streams/deduplicator.ts`]: keys are the
normalised file name, the info-hash + file index, and a "smart" key of size bucketed in 10 % steps; groups are merged
when they share any key. Applied here it collapses the Telegram copy and the Real-Debrid copy of one release.

**Release-name parsers**: PTT (MIT) is the most accurate but needs the compiled `regex` module; RTN needs compiled
wheels throughout; guessit (LGPL) and PTN (MIT) are pure Python. PTT knows Cyrillic season / episode words and no
Hebrew ones - the engine's own Hebrew patterns stay. Recommendation: port PTT's season / episode / range / pack
patterns to the standard `re`.

**Certain identification beyond the name**
- OpenSubtitles "moviehash" (file size + sums of the first and last 64 KB - two ranged reads) looked up at
  `api.opensubtitles.com/api/v1/subtitles?moviehash=` returns the IMDb id, season and episode of a file, and proves a
  synced subtitle exists. Needs a free API key. Misses will be common for re-encoded Telegram uploads [I].
- Runtime against TMDb: reject below 60 % of the runtime (sample, trailer); for episodes compare with that
  episode's runtime (catches wrong and double episodes). The duration is already read from the file header.
- Container title tags: cheap extra evidence, often junk.

**Link health**: MP4 - the `moov` box must be reachable (head, else tail); MKV - the Cues must exist (a file without
them seeks slowly: rank lower); throughput - time a 2-4 MB read from the middle of the file and require 1.5x the
bitrate; fake / sample rules (size against duration and resolution); Real-Debrid torrents holding only archives are
skipped; Dolby Vision profile 5, TrueHD / DTS-HD and AV1 flagged per device.

**Hebrew**
- Wizdom works without a key [V]: `wizdom.xyz/api/search?action=by_id&imdb=tt..[&season=&episode=]` lists the
  release names that have a Hebrew subtitle; `wizdom.xyz/api/releases/tt..` also gives the Hebrew title. A source whose
  release group and type match a Wizdom entry has a synced Hebrew subtitle - a ranking signal.
- Wikidata gives the Hebrew label and spelling variants for an IMDb id, keyless [V]:
  `SELECT ?heLabel ?heAlt WHERE { ?item wdt:P345 "tt0111161". OPTIONAL { ?item rdfs:label ?heLabel FILTER(LANG(?heLabel)="he") } OPTIONAL { ?item skos:altLabel ?heAlt FILTER(LANG(?heAlt)="he") } }`
  at `query.wikidata.org/sparql` - more search aliases next to TMDb's translations.
- Ktuvit needs the user's own account; SubDL a free key; OpenSubtitles a free key.

**Telegram side**: page `messages.searchGlobal` with `offset_rate` / `next_rate`; de-duplicate by `document.id` (stable
across forwards); resolve `t.me/c/<id>/<msg>` links found in captions; keep a local index of the user's channels;
MediaFusion's junk gate (empty title, hash-like names, no release evidence) [V, `telegram_title.rs`].

## Shortlist by gain / effort

| # | Addition | Cost | Status |
|---|---|---|---|
| 1 | Real-Debrid `infringing_file` = dead link, remembered | small | open |
| 2 | Wizdom release list as "has a synced Hebrew subtitle" ranking signal + Hebrew title | small, free, no key | open |
| 3 | Wikidata Hebrew labels and variants as search aliases | small, free | open |
| 4 | Runtime gate against TMDb (per episode) + sample / fake rules | small | partly (film length check exists) |
| 5 | Paged global search + de-duplication by document id | medium | deep in-chat search done in 4.0.0 |
| 6 | StremThru file-level cache check | medium | needs the owner's decision (privacy) |
| 7 | OpenSubtitles moviehash for certain identification | medium | needs a free key |
| 8 | PTT episode / pack patterns in `re` + junk-name gate | medium | open |
| 9 | Tail probe (moov / Cues), mid-file throughput, DV / passthrough flags | medium | head probe + speed exist |
| 10 | Union de-duplication with size buckets across Telegram / RD / Stremio | medium | open |

## Questions for the owner

- **TorBox Essential, 3 USD a month** (Pro 10 USD adds Usenet): a second resolver with a real cache-check API - no
  false "cached" entries, and a fallback for titles Real-Debrid now refuses. The free tier is not useful for streaming.
- **StremThru**: use a public instance (the Real-Debrid token is sent to it) or not at all / self-host.
- **OpenSubtitles**: a free account and API key (enables the certain identification and one more Hebrew source).
- **Ktuvit**: needs your own account credentials - skip unless you want it.
