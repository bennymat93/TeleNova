# -*- coding: utf-8 -*-
"""Metadata: TMDB (preferred, multilingual) with a key-less Cinemeta fallback."""
TMDB ='https://api.themoviedb.org/3'
IMG = 'https://image.tmdb.org/t/p/'
CINEMETA = 'https://v3-cinemeta.strem.io'


class Meta(object):
    def __init__(self, tmdb_key='', language='en-US', cache=None, include_adult=False, log=None):
        self.key = (tmdb_key or '').strip()
        self.language = language
        self.cache = cache
        self.adult = include_adult
        self.log = log or (lambda m: None)
        import requests     # 3.3: loaded with the first catalogue, not with every menu
        self.s = requests.Session()
        self.s.headers['User-Agent'] = 'Kodi TeleScope'
        if len(self.key) > 40:
            self.s.headers['Authorization'] = 'Bearer ' + self.key

    @property
    def has_tmdb(self):
        return bool(self.key)

    # ------------------------------------------------------------------ http
    def _get(self, url, params=None, ttl=6 * 3600):
        params = dict(params or {})
        ck = 'http:%s?%s' % (url, '&'.join('%s=%s' % kv for kv in sorted(params.items())))
        if self.cache:
            hit = self.cache.get(ck)
            if hit is not None:
                return hit
        if url.startswith(TMDB) and len(self.key) <= 40:
            params['api_key'] = self.key
        import requests
        try:
            r = self.s.get(url, params=params, timeout=15)
            if r.status_code == 404:
                return {}
            r.raise_for_status()
        except requests.RequestException as exc:
            # 3.3: the exception text carries the whole URL (api_key=...): it is shown / logged without the key
            from .common import scrub
            raise IOError(scrub(exc))
        data = r.json()
        if self.cache and ttl:
            self.cache.set(ck, data, ttl)
        return data

    def tmdb(self, path, ttl=6 * 3600, **params):
        params.setdefault('language', self.language)
        return self._get(TMDB + path, params, ttl)

    # ------------------------------------------------------------------ normalizers
    def _norm(self, it, kind):
        if kind == 'tv':
            title = it.get('name') or it.get('original_name') or ''
            orig = it.get('original_name') or title
            date = it.get('first_air_date') or ''
        else:
            title = it.get('title') or it.get('original_title') or ''
            orig = it.get('original_title') or title
            date = it.get('release_date') or ''
        return {
            'id': 'tmdb:%s' % it.get('id'), 'tmdb': it.get('id'), 'type': kind,
            'title': title, 'original_title': orig, 'year': int(date[:4]) if date[:4].isdigit() else None,
            'premiered': date, 'plot': it.get('overview') or '',
            'poster': IMG + 'w500' + it['poster_path'] if it.get('poster_path') else None,
            'fanart': IMG + 'w1280' + it['backdrop_path'] if it.get('backdrop_path') else None,
            'rating': it.get('vote_average') or 0, 'votes': it.get('vote_count') or 0,
            'original_language': it.get('original_language') or '',
        }

    def _cm_norm(self, it, kind):
        year = None
        ri = str(it.get('releaseInfo') or it.get('year') or '')
        if ri[:4].isdigit():
            year = int(ri[:4])
        return {
            'id': 'imdb:%s' % it.get('imdb_id', it.get('id')), 'imdb': it.get('imdb_id', it.get('id')),
            'tmdb': None, 'type': kind, 'title': it.get('name') or '', 'original_title': it.get('name') or '',
            'year': year, 'premiered': '', 'plot': it.get('description') or '', 'poster': it.get('poster'),
            'fanart': it.get('background'), 'rating': float(it.get('imdbRating') or 0), 'votes': 0,
            'original_language': '',
        }

    # ------------------------------------------------------------------ lists
    def listing(self, kind, category, page=1, **filters):
        """category: trending|popular|top_rated|now_playing|upcoming|airing_today|on_the_air|discover"""
        if not self.has_tmdb:
            return self._cm_list(kind, page, filters.get('genre_name'))
        if category == 'trending':
            data = self.tmdb('/trending/%s/week' % kind, page=page)
        elif category == 'discover':
            params = {'page': page, 'sort_by': filters.get('sort_by', 'popularity.desc'),
                      'include_adult': 'true' if self.adult else 'false', 'vote_count.gte': filters.get('min_votes', 20)}
            for k in ('with_genres', 'with_original_language', 'with_origin_country', 'without_genres'):
                if filters.get(k):
                    params[k] = filters[k]
            date_key = 'primary_release_date' if kind == 'movie' else 'first_air_date'
            if filters.get('year'):
                params['%s.gte' % date_key] = '%s-01-01' % filters['year']
                params['%s.lte' % date_key] = '%s-12-31' % filters['year']
            if filters.get('max_year'):
                params['%s.lte' % date_key] = '%s-12-31' % filters['max_year']
            data = self.tmdb('/discover/%s' % kind, **params)
        else:
            data = self.tmdb('/%s/%s' % (kind, category), page=page)
        items = [self._norm(it, kind) for it in data.get('results', [])]
        return items, int(data.get('total_pages') or 1)

    def search(self, kind, query, page=1, year=None):
        if not self.has_tmdb:
            return self._cm_search(kind, query)
        params = {'query': query, 'page': page, 'include_adult': 'true' if self.adult else 'false'}
        if year:
            params['year' if kind == 'movie' else 'first_air_date_year'] = year
        data = self.tmdb('/search/%s' % kind, ttl=3600, **params)
        return [self._norm(it, kind) for it in data.get('results', [])], int(data.get('total_pages') or 1)

    def genres(self, kind):
        if not self.has_tmdb:
            names = ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family',
                     'Fantasy', 'History', 'Horror', 'Mystery', 'Romance', 'Sci-Fi', 'Thriller', 'War', 'Western']
            return [{'id': n, 'name': n} for n in names]
        return self.tmdb('/genre/%s/list' % kind, ttl=7 * 86400).get('genres', [])

    # ------------------------------------------------------------------ details
    def details(self, kind, ident):
        """ident: tmdb id (int/str) or 'imdb:tt..' -> normalized dict with aliases & runtime."""
        if str(ident).startswith('imdb:') or not self.has_tmdb:
            imdb = str(ident).replace('imdb:', '')
            if self.has_tmdb:
                found = self._get(TMDB + '/find/%s' % imdb, {'external_source': 'imdb_id', 'language': self.language})
                res = found.get('%s_results' % kind) or []
                if res:
                    return self.details(kind, res[0]['id'])
            return self._cm_details(kind, imdb)
        path = '/%s/%s' % (kind, ident)
        alt = 'alternative_titles,translations,external_ids'
        d = self.tmdb(path, ttl=86400, append_to_response=alt)
        if not d:
            return None
        item = self._norm(d, kind)
        item['genres'] = [g['name'] for g in d.get('genres', [])]
        item['imdb'] = (d.get('external_ids') or {}).get('imdb_id') or d.get('imdb_id')
        item['countries'] = [c.get('name') for c in d.get('production_countries', [])]
        if kind == 'movie':
            item['runtime'] = d.get('runtime') or 0
        else:
            rt = d.get('episode_run_time') or []
            item['runtime'] = rt[0] if rt else 0
            item['seasons'] = [{'season': s['season_number'], 'name': s.get('name'), 'episodes': s.get('episode_count'),
                                'poster': IMG + 'w500' + s['poster_path'] if s.get('poster_path') else None,
                                'air_date': s.get('air_date')}
                               for s in d.get('seasons', [])]
            item['total_seasons'] = d.get('number_of_seasons') or len(item['seasons'])
        names = [item['title'], item['original_title']]
        for tr in (d.get('translations') or {}).get('translations', []):
            if tr.get('iso_639_1') in ('he', 'ru', 'en', 'uk'):
                nm = (tr.get('data') or {}).get('title') or (tr.get('data') or {}).get('name')
                if nm:
                    names.append(nm)
        alts = d.get('alternative_titles') or {}
        for a in alts.get('titles', alts.get('results', [])):
            if a.get('iso_3166_1') in ('IL', 'RU', 'US', 'GB', 'UA', 'BY', 'KZ'):
                names.append(a.get('title'))
        item['aliases'] = _uniq(names)
        return item

    def season(self, tmdb_id, season):
        if not self.has_tmdb:
            return []
        d = self.tmdb('/tv/%s/season/%s' % (tmdb_id, season), ttl=12 * 3600)
        eps = []
        for e in d.get('episodes', []):
            eps.append({'season': e.get('season_number'), 'episode': e.get('episode_number'),
                        'title': e.get('name') or '', 'plot': e.get('overview') or '',
                        'thumb': IMG + 'w780' + e['still_path'] if e.get('still_path') else None,
                        'premiered': e.get('air_date') or '', 'runtime': e.get('runtime') or 0,
                        'rating': e.get('vote_average') or 0})
        return eps

    # ------------------------------------------------------------------ cinemeta fallback
    def _cm_type(self, kind):
        return 'series' if kind == 'tv' else 'movie'

    def _cm_list(self, kind, page, genre=None):
        skip = (int(page) - 1) * 100
        extra = []
        if genre:
            extra.append('genre=%s' % genre)
        if skip:
            extra.append('skip=%d' % skip)
        url = '%s/catalog/%s/top%s.json' % (CINEMETA, self._cm_type(kind), ('/' + '&'.join(extra)) if extra else '')
        data = self._get(url)
        return [self._cm_norm(m, kind) for m in data.get('metas', [])], int(page) + 1

    def _cm_search(self, kind, query):
        url = '%s/catalog/%s/top/search=%s.json' % (CINEMETA, self._cm_type(kind), __import__('urllib.parse').parse.quote(query))
        data = self._get(url, ttl=3600)
        return [self._cm_norm(m, kind) for m in data.get('metas', [])], 1

    def _cm_details(self, kind, imdb):
        data = self._get('%s/meta/%s/%s.json' % (CINEMETA, self._cm_type(kind), imdb), ttl=86400).get('meta') or {}
        if not data:
            return None
        item = self._cm_norm(data, kind)
        item['genres'] = data.get('genres') or []
        rt = str(data.get('runtime') or '')
        digits = ''.join(ch for ch in rt if ch.isdigit())
        item['runtime'] = int(digits) if digits else 0
        if kind == 'tv':
            eps = {}
            for v in data.get('videos', []):
                s, e = v.get('season'), v.get('episode') or v.get('number')
                if s is None or e is None:
                    continue
                eps.setdefault(int(s), []).append({
                    'season': int(s), 'episode': int(e), 'title': v.get('name') or v.get('title') or '',
                    'plot': v.get('overview') or v.get('description') or '', 'thumb': v.get('thumbnail'),
                    'premiered': (v.get('released') or '')[:10], 'runtime': 0, 'rating': 0})
            item['_episodes'] = eps
            item['seasons'] = [{'season': s, 'name': 'Season %d' % s, 'episodes': len(v), 'poster': item['poster'],
                                'air_date': ''} for s, v in sorted(eps.items())]
            item['total_seasons'] = len([s for s in eps if s > 0])
        item['aliases'] = _uniq([item['title']])
        return item


def _uniq(names):
    seen, out = set(), []
    for n in names:
        if not n:
            continue
        k = n.strip().lower()
        if k and k not in seen:
            seen.add(k)
            out.append(n.strip())
    return out
