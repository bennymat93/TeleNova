'use strict';
// TeleNova web, WP-2: the TeleScope screens (plan rows 24, 25, 30, 32) on the browser's own Telegram session.
// #/telegram                      root: Movies, TV, Hebrew, Russian, Kids, Chiko Media, Telegram (chats), search, Account
// #/telegram/v=chats[&n=100]      dialogs (pinned here first)          #/telegram/v=chat&c=<id|@name>[&q=..][&o=offset]
// #/telegram/v=find&q=..          free Telegram file search           #/telegram/v=ai&q=..  Gemini -> titles
// #/telegram/v=discover[&p=i|&q=] channel discovery (presets of router.py DISCOVER_PRESETS)   #/telegram/v=chiko
// Join (t.me link / @name / invite), leave (asks twice), pin (this browser: TN.put('tg_pins'); synced later by WP-0).
(function (TN) {
  if (!TN) return;
  TN.i18n.add({
    he: {tgm_title: 'טלגרם', tgm_movies: 'סרטים', tgm_tv: 'סדרות', tgm_heb: 'תוכן ישראלי', tgm_rus: 'תוכן רוסי', tgm_kids: 'ילדים',
      tgm_chiko: "צ'יקו מדיה", tgm_chats: 'הצ\'אטים שלי', tgm_find: 'חיפוש קבצים בטלגרם', tgm_ai: 'חיפוש חכם (AI)', tgm_account: 'חשבון',
      tgm_discover: 'גילוי ערוצים', tgm_join: 'הצטרפות בקישור', tgm_join_ph: 't.me/... או @שם', tgm_joined: 'הצטרפת.', tgm_leave: 'עזיבה',
      tgm_leave_q: 'בטוח? לחצו שוב', tgm_left: 'עזבת.', tgm_pin: 'הצמדה', tgm_unpin: 'ביטול הצמדה', tgm_more: 'עוד', tgm_none: 'לא נמצא כלום.',
      tgm_in_chat: 'חיפוש בצ\'אט', tgm_go: 'חיפוש', tgm_login: 'כניסה לטלגרם', tgm_need_login: 'צריך להתחבר לטלגרם בדפדפן הזה.',
      tgm_busy: 'מחפש... %s/%s', tgm_err: 'שגיאה: %s', tgm_open: 'פתיחה', tgm_p0: 'בוטים לסרטים', tgm_p1: 'ערוצים בעברית', tgm_p2: 'ערוצים ברוסית',
      tgm_p3: 'ערוצים באנגלית', tgm_p4: 'ילדים ומדובבים', tgm_member: 'כבר בפנים', tgm_videos: 'סרטונים', tgm_similar: 'ערוצים דומים',
      tgm_chiko_none: 'לא נמצאו ערוצים של צ\'יקו מדיה בחשבון. אפשר להצטרף אליהם דרך "גילוי ערוצים".'},
    en: {tgm_title: 'Telegram', tgm_movies: 'Movies', tgm_tv: 'TV shows', tgm_heb: 'Israeli', tgm_rus: 'Russian', tgm_kids: 'Kids',
      tgm_chiko: 'Chiko Media', tgm_chats: 'My chats', tgm_find: 'Search Telegram files', tgm_ai: 'Smart search (AI)', tgm_account: 'Account',
      tgm_discover: 'Discover channels', tgm_join: 'Join by link', tgm_join_ph: 't.me/... or @name', tgm_joined: 'Joined.', tgm_leave: 'Leave',
      tgm_leave_q: 'Sure? Press again', tgm_left: 'Left.', tgm_pin: 'Pin', tgm_unpin: 'Unpin', tgm_more: 'More', tgm_none: 'Nothing found.',
      tgm_in_chat: 'Search in chat', tgm_go: 'Search', tgm_login: 'Telegram sign-in', tgm_need_login: 'Sign in to Telegram in this browser first.',
      tgm_busy: 'Searching... %s/%s', tgm_err: 'Error: %s', tgm_open: 'Open', tgm_p0: 'Movie bots', tgm_p1: 'Hebrew channels', tgm_p2: 'Russian channels',
      tgm_p3: 'English channels', tgm_p4: 'Kids and dubbed', tgm_member: 'Joined', tgm_videos: 'Videos', tgm_similar: 'Similar channels',
      tgm_chiko_none: 'No Chiko Media chats in the account. Join them through "Discover channels".'},
    ru: {tgm_title: 'Telegram', tgm_movies: 'Фильмы', tgm_tv: 'Сериалы', tgm_heb: 'Израильское', tgm_rus: 'Русское', tgm_kids: 'Детям',
      tgm_chiko: 'Chiko Media', tgm_chats: 'Мои чаты', tgm_find: 'Поиск файлов в Telegram', tgm_ai: 'Умный поиск (AI)', tgm_account: 'Аккаунт',
      tgm_discover: 'Поиск каналов', tgm_join: 'Вступить по ссылке', tgm_join_ph: 't.me/... или @имя', tgm_joined: 'Вы вступили.', tgm_leave: 'Выйти',
      tgm_leave_q: 'Точно? Нажмите ещё раз', tgm_left: 'Вы вышли.', tgm_pin: 'Закрепить', tgm_unpin: 'Открепить', tgm_more: 'Ещё', tgm_none: 'Ничего не найдено.',
      tgm_in_chat: 'Поиск в чате', tgm_go: 'Искать', tgm_login: 'Вход в Telegram', tgm_need_login: 'Сначала войдите в Telegram в этом браузере.',
      tgm_busy: 'Поиск... %s/%s', tgm_err: 'Ошибка: %s', tgm_open: 'Открыть', tgm_p0: 'Боты с фильмами', tgm_p1: 'Каналы на иврите', tgm_p2: 'Русские каналы',
      tgm_p3: 'Английские каналы', tgm_p4: 'Детское и дубляж', tgm_member: 'Вы участник', tgm_videos: 'Видео', tgm_similar: 'Похожие каналы',
      tgm_chiko_none: 'В аккаунте нет чатов Chiko Media. Вступите в них через «Поиск каналов».'},
  });
  const t = TN.t, esc = TN.esc;
  // router.py DISCOVER_PRESETS
  const PRESETS = [['tgm_p0', ['movies bot', 'filter bot', 'סרטים בוט', 'series bot', 'фильмы бот']],
    ['tgm_p1', ['סרטים', 'סדרות', 'סרטים וסדרות', 'תרגום מובנה', 'מדובב']],
    ['tgm_p2', ['фильмы', 'сериалы', 'кино', 'новинки кино']],
    ['tgm_p3', ['movies', 'series', 'tv shows', 'movies hd', 'cinema']],
    ['tgm_p4', ['סרטי ילדים', 'מדובבים', 'мультфильмы', 'cartoons', 'kids movies']]];
  const CHIKO_TAG = /צ['׳’`]?יקו|chiko|chico/iu;
  const chikoKeywords = () => String((TN.settings.synced() || {}).chiko_keywords || "צ'יקו,ציקו,chiko,chico").split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const L = (p) => TN.link('telegram', p);

  // pins (this browser; the synced field needs syncdoc.js + syncdoc.py from WP-0)
  const pins = () => { const p = TN.get('tg_pins', []); return Array.isArray(p) ? p : []; };
  const isPinned = (id) => pins().some((p) => p.id === String(id));
  function togglePin(d) {
    const list = pins().filter((p) => p.id !== String(d.id));
    if (list.length === pins().length) list.unshift({id: String(d.id), title: d.title || '', username: d.username || ''});
    TN.put('tg_pins', list.slice(0, 50));
  }
  // join link -> {invite} | {name} (tgclient.py join)
  function parseJoin(link) {
    link = String(link || '').trim();
    const m = /(?:joinchat\/|\/\+|^\+)([\w-]+)/.exec(link);
    if (m) return {invite: m[1]};
    const name = link.replace(/^(?:https?:\/\/)?(?:t\.me\/|telegram\.me\/)?@?/i, '').split(/[/?#]/)[0];
    return /^[A-Za-z][\w]{3,31}$/.test(name) ? {name} : null;
  }

  async function ready() {
    const TG = await TN.tg();
    const S = await TN.provider('tgsearch');
    const c = await TG.client();        // rejects with TG_NO_LOGIN / TG_OTHER_TAB / TG_LOGIN_RUNNING / TG_OFFLINE
    return {TG, S, c, Api: self.GramJS.Api};
  }
  function needLogin(e) {
    const v = TN.view(), box = document.createElement('div');
    box.className = 'panel';
    const msg = /TG_NO_LOGIN/.test(String(e && e.message)) ? t('tgm_need_login') : t('tgm_err', String((e && e.message) || e));
    box.innerHTML = `<p class="msg">${esc(msg)}</p>`;
    box.append(TN.button('btn', t('tgm_login'), () => TN.go('#/tglogin')));
    v.append(box);
  }
  function grid(title, n) { return TN.section(title, n); }
  function tile(g, icon, label, href) {
    const a = document.createElement('a');
    a.className = 'card'; a.href = href;
    a.innerHTML = `<div class="tgm-ic" aria-hidden="true">${icon}</div><div class="t">${esc(label)}</div>`;
    g.append(a);
  }
  function fileRow(list, r, S) {
    const b = document.createElement('button');
    b.className = 'hrow';
    b.innerHTML = `<span class="t" dir="auto">${esc(r.file || '')}</span><small dir="auto">${esc(S.rowSub(r))}</small>`;
    b.onclick = () => S.play(r);
    list.append(b);
  }
  function searchBox(ph, value, go) {
    const f = document.createElement('form');
    f.className = 'tgm-form';
    f.innerHTML = `<input type="search" dir="auto" placeholder="${esc(ph)}" value="${esc(value || '')}"><button class="btn" type="submit">${esc(t('tgm_go'))}</button>`;
    f.onsubmit = (e) => { e.preventDefault(); const q = f.firstChild.value.trim(); if (q) go(q); };
    TN.view().append(f);
    return f;
  }
  function style() {
    if (document.getElementById('tgm-style')) return;
    const s = document.createElement('style');
    s.id = 'tgm-style';
    s.textContent = '.tgm-ic{font-size:2.2rem;text-align:center;padding:18px 0}.tgm-form{display:flex;gap:8px;margin:8px 0 16px}' +
      '.tgm-form input{flex:1;min-width:0}.tgm-acts{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}.tgm-list .hrow{display:flex;flex-direction:column;' +
      'align-items:flex-start;text-align:start;width:100%}.tgm-list small{opacity:.75}';
    document.head.append(s);
  }

  // ------------------------------------------------------------ screens
  async function root() {
    TN.page('telegram', t('tgm_title'));
    const g = grid('');
    const cat = (m, extra, title) => '#/catalog/' + new URLSearchParams(Object.assign({m, v: 'list', name: title, path: '/discover/' + m, sort_by: 'popularity.desc'}, extra));
    tile(g, '🎬', t('tgm_movies'), '#/movies');
    tile(g, '📺', t('tgm_tv'), '#/tv');
    tile(g, '🇮🇱', t('tgm_heb'), cat('movie', {with_original_language: 'he'}, t('tgm_heb')));
    tile(g, '🇷🇺', t('tgm_rus'), cat('movie', {with_original_language: 'ru'}, t('tgm_rus')));
    tile(g, '🧸', t('tgm_kids'), cat('movie', {with_genres: '16'}, t('tgm_kids')));
    tile(g, '🎞', t('tgm_chiko'), L({v: 'chiko'}));
    tile(g, '✈', t('tgm_chats'), L({v: 'chats'}));
    tile(g, '🔍', t('tgm_find'), L({v: 'find'}));
    tile(g, '✨', t('tgm_ai'), L({v: 'ai'}));
    tile(g, '🧭', t('tgm_discover'), L({v: 'discover'}));
    tile(g, '👤', t('tgm_account'), '#/tglogin');
  }

  async function chats(p, ctx) {
    TN.page('telegram', t('tgm_chats'));
    let R;
    try { R = await ready(); } catch (e) { return needLogin(e); }
    if (!ctx.current()) return;
    const acts = document.createElement('div');
    acts.className = 'tgm-acts';
    TN.view().append(acts);
    joinForm(acts, R);
    const n = Math.min(500, parseInt(p.n, 10) || 100);
    const ds = await R.c.getDialogs({limit: n});
    if (!ctx.current()) return;
    const list = (ds || []).filter((d) => d.entity && !(d.entity.className === 'User' && d.entity.self));
    R.S.rememberEntities(list.map((d) => d.entity));
    list.sort((a, b) => (isPinned(R.S.entityId(b.entity)) - isPinned(R.S.entityId(a.entity))));
    const g = grid(t('tgm_chats'), list.length);
    for (const d of list) {
      const id = R.S.entityId(d.entity);
      const sub = [d.isChannel && !d.isGroup ? '📢' : d.isGroup ? '👥' : d.entity.bot ? '🤖' : '👤', isPinned(id) ? '📌' : '',
        d.unreadCount ? String(d.unreadCount) : ''].filter(Boolean).join(' ');
      g.append(TN.card('', d.title || '', sub, () => TN.go(L({v: 'chat', c: id})), 'wide'));
    }
    if ((ds || []).length >= n && n < 500) TN.view().append(TN.button('btn ghost', t('tgm_more'), () => TN.go(L({v: 'chats', n: n + 100}))));
  }

  function joinForm(box, R) {
    const f = document.createElement('form');
    f.className = 'tgm-form';
    f.innerHTML = `<input dir="ltr" placeholder="${esc(t('tgm_join_ph'))}" aria-label="${esc(t('tgm_join'))}"><button class="btn" type="submit">${esc(t('tgm_join'))}</button><span class="hint" role="status"></span>`;
    f.onsubmit = async (e) => {
      e.preventDefault();
      const j = parseJoin(f.firstChild.value), st = f.lastChild;
      if (!j) { st.textContent = t('tgm_err', '?'); return; }
      try { await join(R, j); st.textContent = t('tgm_joined'); } catch (err) { st.textContent = t('tgm_err', err.errorMessage || err.message); }
    };
    box.append(f);
  }
  async function join(R, j) {
    const {c, Api} = R;
    const res = j.invite ? await c.invoke(new Api.messages.ImportChatInvite({hash: j.invite}))
      : await c.invoke(new Api.channels.JoinChannel({channel: j.name}));
    if (TN.settings.get('telegram_quiet', true)) {            // the engine's quiet mode: mute + archive what was joined
      for (const ch of (res && res.chats) || []) {
        try {
          const peer = await c.getInputEntity(ch);
          await c.invoke(new Api.account.UpdateNotifySettings({peer: new Api.InputNotifyPeer({peer}), settings: new Api.InputPeerNotifySettings({muteUntil: 2147483647})}));
          await c.invoke(new Api.folders.EditPeerFolders({folderPeers: [new Api.InputFolderPeer({peer, folderId: 1})]}));
        } catch (e) {}
      }
    }
    return res;
  }
  async function leave(R, ent) {
    const {c, Api} = R;
    if ((ent.className || '').startsWith('Channel')) return c.invoke(new Api.channels.LeaveChannel({channel: ent}));
    if ((ent.className || '').startsWith('Chat')) return c.invoke(new Api.messages.DeleteChatUser({chatId: ent.id, userId: new Api.InputUserSelf()}));
    return c.invoke(new Api.messages.DeleteHistory({peer: ent, maxId: 0, justClear: false, revoke: false}));
  }

  async function chat(p, ctx) {
    TN.page('telegram', '…');
    let R;
    try { R = await ready(); } catch (e) { return needLogin(e); }
    const ref = String(p.c || '');
    let res;
    try { res = await R.S.chatVideos(ref, {offsetId: parseInt(p.o, 10) || 0, limit: 50, q: p.q || ''}); } catch (e) {
      if (ctx.current()) TN.view().append(Object.assign(document.createElement('p'), {className: 'msg', textContent: t('tgm_err', e.errorMessage || e.message)}));
      return;
    }
    if (!ctx.current()) return;
    const ent = res.chat, title = ent.title || [ent.firstName, ent.lastName].filter(Boolean).join(' ') || ref;
    TN.view().querySelector('h1').textContent = title;
    const id = R.S.entityId(ent);
    const acts = document.createElement('div');
    acts.className = 'tgm-acts';
    const pinB = TN.button('btn ghost', t(isPinned(id) ? 'tgm_unpin' : 'tgm_pin'), () => {
      togglePin({id, title, username: ent.username}); pinB.textContent = t(isPinned(id) ? 'tgm_unpin' : 'tgm_pin');
    });
    acts.append(pinB);
    if (ent.left && ent.username) acts.append(TN.button('btn', t('tgm_join'), async (ev) => { try { await join(R, {name: ent.username}); ev.target.textContent = t('tgm_joined'); } catch (e) { ev.target.textContent = t('tgm_err', e.errorMessage || e.message); } }));
    else {
      let armed = false;
      const lb = TN.button('btn ghost', t('tgm_leave'), async () => {
        if (!armed) { armed = true; lb.textContent = t('tgm_leave_q'); return; }
        try { await leave(R, ent); TN.put('tg_pins', pins().filter((x) => x.id !== id)); lb.textContent = t('tgm_left'); lb.disabled = true; } catch (e) { lb.textContent = t('tgm_err', e.errorMessage || e.message); }
      });
      acts.append(lb);
    }
    if ((ent.className || '') === 'Channel' && ent.broadcast) acts.append(TN.button('btn ghost', t('tgm_similar'), () => TN.go(L({v: 'discover', similar: id}))));
    TN.view().append(acts);
    searchBox(t('tgm_in_chat'), p.q, (q) => TN.go(L({v: 'chat', c: ref, q})));
    const list = document.createElement('div');
    list.className = 'hlist tgm-list';
    TN.view().append(Object.assign(document.createElement('h2'), {textContent: t('tgm_videos') + ' ' + res.items.length}), list);
    for (const r of res.items) fileRow(list, r, R.S);
    if (!res.items.length) list.append(Object.assign(document.createElement('p'), {className: 'hint', textContent: t('tgm_none')}));
    if (res.next) TN.view().append(TN.button('btn ghost', t('tgm_more'), () => TN.go(L(Object.assign({}, p, {o: res.next})))));
  }

  async function find(p, ctx) {
    TN.page('telegram', t('tgm_find'));
    searchBox(t('tgm_find'), p.q, (q) => TN.go(L({v: 'find', q})));
    if (!p.q) return;
    let R;
    try { R = await ready(); } catch (e) { return needLogin(e); }
    const st = Object.assign(document.createElement('p'), {className: 'hint', textContent: '…'});
    TN.view().append(st);
    try { TN.store.addSearch(p.q); } catch (e) {}
    const rows = await R.S.free(p.q, {limit: 80});
    if (!ctx.current()) return;
    st.textContent = rows.length ? '' : t('tgm_none');
    const list = document.createElement('div');
    list.className = 'hlist tgm-list';
    TN.view().append(list);
    for (const r of rows) fileRow(list, r, R.S);
  }

  async function ai(p, ctx) {
    TN.page('telegram', t('tgm_ai'));
    searchBox(t('tgm_ai'), p.q, (q) => TN.go(L({v: 'ai', q})));
    if (!p.q) return;
    const S = await TN.provider('tgsearch');
    const st = Object.assign(document.createElement('p'), {className: 'hint', textContent: '…'});
    TN.view().append(st);
    let items;
    try { items = await S.aiTitles(p.q); } catch (e) { st.textContent = String(e.message || e); return; }
    if (!ctx.current()) return;
    st.textContent = items.length ? '' : t('tgm_none');
    const g = grid(t('tgm_ai'), items.length);
    for (const it of items) {
      g.append(TN.card('', it.title, [it.year, it.type === 'tv' ? t('tgm_tv') : t('tgm_movies')].filter(Boolean).join(' · '), async () => {
        if (TN.hasTmdbKey()) {
          try {
            const r = await TN.tmdb('/search/' + it.type, Object.assign({query: it.title}, it.year ? {[it.type === 'tv' ? 'first_air_date_year' : 'year']: it.year} : {}));
            const hit = (r.results || [])[0];
            if (hit) return TN.openTitle(it.type, hit.id);
          } catch (e) {}
        }
        TN.go(L({v: 'find', q: it.title + (it.year && it.type === 'movie' ? ' ' + it.year : '')}));
      }));
    }
  }

  async function discover(p, ctx) {
    TN.page('telegram', t('tgm_discover'));
    if (p.p === undefined && !p.q && !p.similar) {
      searchBox(t('tgm_discover'), '', (q) => TN.go(L({v: 'discover', q})));
      const g = grid('');
      PRESETS.forEach(([k], i) => tile(g, '🧭', t(k), L({v: 'discover', p: i})));
      return;
    }
    let R;
    try { R = await ready(); } catch (e) { return needLogin(e); }
    const {c, Api} = R;
    const found = new Map();
    const add = (ch) => { if (ch && (ch.username || !ch.left) && !found.has(R.S.entityId(ch))) found.set(R.S.entityId(ch), ch); };
    try {
      if (p.similar) {
        const r = await c.invoke(new Api.channels.GetChannelRecommendations({channel: R.S.peer(p.similar) || await c.getEntity(p.similar)}));
        (r.chats || []).forEach(add);
      } else {
        const qs = p.q ? [p.q].concat(/bot/i.test(p.q) ? [] : [p.q + ' bot']) : PRESETS[Math.max(0, Math.min(PRESETS.length - 1, parseInt(p.p, 10) || 0))][1];
        for (const q of qs) {
          const r = await c.invoke(new Api.contacts.Search({q, limit: 30}));
          (r.chats || []).forEach(add);
          (r.users || []).filter((u) => u.bot).forEach(add);
          if (!ctx.current()) return;
        }
      }
    } catch (e) { TN.view().append(Object.assign(document.createElement('p'), {className: 'msg', textContent: t('tgm_err', e.errorMessage || e.message)})); }
    if (!ctx.current()) return;
    R.S.rememberEntities([...found.values()]);
    const rows = [...found.values()].sort((a, b) => (b.participantsCount || 0) - (a.participantsCount || 0));
    const g = grid(t('tgm_discover'), rows.length);
    for (const ch of rows) {
      const kind = ch.bot ? '🤖' : ch.broadcast ? '📢' : '👥';
      const sub = [kind, ch.participantsCount ? ch.participantsCount.toLocaleString() : '', ch.left === false ? t('tgm_member') : '', ch.username ? '@' + ch.username : ''].filter(Boolean).join(' · ');
      g.append(TN.card('', ch.title || ch.firstName || ch.username || '', sub, () => {
        if (ch.bot) window.open('https://t.me/' + encodeURIComponent(ch.username), '_blank', 'noopener');
        else TN.go(L({v: 'chat', c: ch.username ? '@' + ch.username : R.S.entityId(ch)}));
      }, 'wide'));
    }
    if (!rows.length) TN.empty(g, t('tgm_none'));
  }

  async function chiko(p, ctx) {
    TN.page('telegram', t('tgm_chiko'));
    let R;
    try { R = await ready(); } catch (e) { return needLogin(e); }
    const kws = chikoKeywords();
    const ds = await R.c.getDialogs({limit: 400});
    if (!ctx.current()) return;
    const hit = (ds || []).filter((d) => { const ti = String(d.title || '').toLowerCase(); return kws.some((k) => ti.includes(k)) || CHIKO_TAG.test(d.title || ''); });
    R.S.rememberEntities(hit.map((d) => d.entity));
    const g = grid(t('tgm_chiko'), hit.length);
    for (const d of hit) g.append(TN.card('', d.title || '', '', () => TN.go(L({v: 'chat', c: R.S.entityId(d.entity)})), 'wide'));
    if (!hit.length) TN.empty(g, t('tgm_chiko_none'));
  }

  const VIEWS = {chats, chat, find, ai, discover, chiko};
  TN.registerPage('telegram', async (arg, ctx) => {
    style();
    const p = TN.params(arg);
    const fn = VIEWS[p.v];
    return fn ? fn(p, ctx) : root(p, ctx);
  });
  // for tests: the pure parts
  self.TNTelegram = {parseJoin, PRESETS, chikoKeywords};
})(self.TN);
