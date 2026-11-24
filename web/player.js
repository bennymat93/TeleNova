'use strict';
// TeleNova web (package player): the player. An immersive overlay of its own (class prefix pl-) over the whole window:
// no native controls, the same buttons and keys as the BN player of the Kodi build (V20), for mouse, touch, keyboard
// and TV remotes.
//
// Service 'player': open(o) -> Promise<{video, close}>
//   o.url     an https (or blob:) media address; HLS (.m3u8 / mpegurl mime) goes through hls.js wherever it works
//   o.tg      a tgsearch row / {peer, msg} / {message}: played through tgplay (the service worker stream)
//   o.title, o.sub (second line: S01E02 / year), o.poster, o.mime
//   o.live    a live stream (a channel): no seek bar, no resume point, a LIVE chip; an HLS live list is noticed by itself
//   o.resumeKey   the history key the position belongs to. Resume points are kept as {t, d, at} under
//                 TN.put('player_resume'); app.js carries them inside the user's history entries as Kodi's
//                 'progress': {t, d} (syncdoc with_progress / progress_points), so they cross devices. A video
//                 watched to 95 % keeps a finished point (t = d): that is the "watched" mark other devices see.
//   o.history     the history entry, written when the picture really starts (not when the overlay opens); fields the
//                 caller leaves empty (play address, plot, fanart) are kept from the entry that is already there
//   o.meta        {type, id (TMDb), imdb, title, year, season, episode, release, embeddedHe} for the subtitle search
//   o.subs        [{label, lang, vtt | fetchVtt()}] subtitles that came with the video
//   o.next        async () => next request or null (series): "Next episode" button, card and countdown
//   o.back        () => the list of links ("Another link");  o.alt () => play the next link;  o.autoAlt: do that by itself
// Also: close(), resumeOf(key), saveResume(key, pos, dur), watched(key), vlcLink(url), kodiLink(url), clock(s).
//
// Subtitles go through subs.js (service 'subs'): the automatic flow at the start (track inside the file -> best human
// subtitle in the viewer's language -> AI), the picker, the timing offset (remembered per video), the appearance.
// Keys: Space / K play-pause · Left / Right 10 s (holding speeds up) · Up / Down volume (TV: show the controls) ·
// F full screen · M mute · C subtitles on / off · S subtitle list · A audio · N next · P picture in picture ·
// < > speed · G / H subtitle earlier / later · 0-9 jump · Escape / Back: close the menu, then leave. TV media keys too.
// Nothing here logs or shows an address unless the viewer asks to copy it (an address can carry a token in its path).
// Syntax: ES2019 only (TV browsers).
(function (G) {
  // ------------------------------------------------------------ pure helpers (also tested in node: t_player.js)
  const pad2 = (n) => String(n).padStart(2, '0');
  function clock(s) {
    s = Math.max(0, Math.floor(Number(s) || 0));
    const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    return (h ? h + ':' + pad2(m) : m) + ':' + pad2(s % 60);
  }
  const RES_MIN = 30, DONE = 0.95, RES_MAX = 300;
  // the point to resume from, or null (nothing yet, too close to the start, or watched to the end)
  function resumePoint(all, key) {
    const r = key && all && all[key];
    return r && r.t > RES_MIN && (!r.d || r.t < r.d * DONE) ? r : null;
  }
  const isWatched = (all, key) => { const r = key && all && all[key]; return !!(r && r.d > 0 && r.t >= r.d * DONE); };
  // the table after the position pos of dur seconds was reached at time now (ms). Returns the same object, changed.
  function nextResume(all, key, pos, dur, now) {
    all = all || {};
    if (!key || !(pos >= 0)) return all;
    dur = Number(dur) > 0 && isFinite(dur) ? Number(dur) : 0;
    if (dur && pos >= dur * DONE) all[key] = {t: Math.round(dur), d: Math.round(dur), at: now};       // watched
    else if (pos > RES_MIN) all[key] = {t: Math.round(pos), d: Math.round(dur), at: now};
    const keys = Object.keys(all);
    if (keys.length > RES_MAX) keys.sort((a, b) => (all[a].at || 0) - (all[b].at || 0)).slice(0, keys.length - RES_MAX).forEach((k) => delete all[k]);
    return all;
  }
  // seconds one more press of Left / Right moves, by how long the key is held (presses in a row)
  const seekStep = (n) => (n >= 24 ? 60 : n >= 12 ? 30 : n >= 5 ? 20 : 10);
  const isHlsUrl = (url, mime) => /\.m3u8(\?|#|$)/i.test(String(url || '')) || /mpegurl/i.test(String(mime || ''));
  // 'http' (a real address another player can open) | 'blob' | 'tg' (this page's own Telegram stream) | ''
  function linkKind(url) {
    const u = String(url || '');
    if (/^blob:/i.test(u)) return 'blob';
    if (/\/tgstream\/[A-Za-z0-9_-]{8,64}$/.test(u)) return 'tg';
    return /^https?:\/\//i.test(u) ? 'http' : '';
  }
  const isAndroid = (ua) => /Android/i.test(String(ua || ''));
  // an address that hands a media link to an app. Android: an intent for that app; elsewhere VLC's own scheme.
  function intentLink(url, pkg) {
    const m = /^(https?):\/\/(.+)$/i.exec(String(url || ''));
    return m ? 'intent://' + m[2] + '#Intent;scheme=' + m[1].toLowerCase() + ';type=video/*;package=' + pkg + ';end' : '';
  }
  function vlcLink(url, ua) {
    if (linkKind(url) !== 'http') return '';
    return isAndroid(ua) ? intentLink(url, 'org.videolan.vlc') : 'vlc://' + url;
  }
  // Kodi opens a link by itself only on Android (its "open with" intent); elsewhere '' (the card explains the other ways)
  function kodiLink(url, ua) { return linkKind(url) === 'http' && isAndroid(ua) ? intentLink(url, 'org.xbmc.kodi') : ''; }
  function m3uText(url, title) { return '#EXTM3U\n#EXTINF:-1,' + String(title || 'video').replace(/[\r\n]+/g, ' ') + '\n' + url + '\n'; }
  // shift every cue of a VTT text by sec seconds (kept for callers of the first player)
  function shiftVtt(vtt, sec) {
    if (!sec) return vtt;
    const fmt = (x) => { x = Math.max(0, x); const h = Math.floor(x / 3600), m = Math.floor(x / 60) % 60, s = x % 60;
      return pad2(h) + ':' + pad2(m) + ':' + s.toFixed(3).padStart(6, '0'); };
    return String(vtt).replace(/(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})/g, (all, h, m, s, ms) => fmt((+h || 0) * 3600 + +m * 60 + +s + +ms / 1000 + sec));
  }
  // what went wrong, from what is known: {code (MediaError), hls ('network' | 'media'), probe ({ok, verdict} of the
  // link test), started} -> {kind: 'codec' | 'network' | 'dead' | 'unknown', why: '' | 'video' | 'audio' | 'container'}
  function errorKind(x) {
    x = x || {};
    const p = x.probe;
    if (p && p.ok === false) return {kind: 'dead', why: ''};
    if (p && p.verdict && p.verdict.play === 'no') return {kind: 'codec', why: p.verdict.why || ''};
    if (x.hls === 'network' || x.code === 2) return {kind: 'network', why: ''};
    if (x.hls === 'media' || x.code === 3) return {kind: 'codec', why: ''};
    if (x.code === 4) return {kind: p && p.ok === true ? 'codec' : 'unknown', why: ''};
    return {kind: 'unknown', why: ''};
  }
  // a key press -> the name of what the player does ('' = not ours). e = {key, code, keyCode, ctrlKey, altKey, metaKey}
  // c = {tv, typing (focus in a text field), panel (a menu is open), ctl (focus on a button), seek (focus on the bar), card}
  const TV_KEYS = {415: 'play', 19: 'pause', 413: 'stop', 417: 'fwd', 412: 'rew', 179: 'toggle', 10252: 'toggle', 176: 'next', 177: 'prev',
    10233: 'next', 10232: 'prev', 418: 'next', 419: 'prev', 427: 'next', 428: 'prev', 457: 'show', 10009: 'back', 461: 'back', 27: 'back'};
  const NAMED = {Escape: 'back', BrowserBack: 'back', GoBack: 'back', MediaPlayPause: 'toggle', MediaPlay: 'play', MediaPause: 'pause', MediaStop: 'stop',
    MediaFastForward: 'fwd', MediaRewind: 'rew', MediaTrackNext: 'next', MediaTrackPrevious: 'prev', Info: 'show', Home: 'jump0', End: 'jumpEnd',
    ChannelUp: 'next', ChannelDown: 'prev'};
  const OLD_KEY = {Left: 'ArrowLeft', Right: 'ArrowRight', Up: 'ArrowUp', Down: 'ArrowDown', Esc: 'Escape', Spacebar: ' '};
  const CODE_KEY = {37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown', 13: 'Enter', 32: ' ', 8: 'Backspace', 9: 'Tab'};
  const LETTER = {k: 'toggle', j: 'rew', l: 'fwd', f: 'fullscreen', m: 'mute', c: 'subsToggle', s: 'subsPanel', a: 'audioPanel', n: 'next', p: 'pip',
    g: 'subEarlier', h: 'subLater', i: 'show'};
  function keyAction(e, c) {
    c = c || {};
    if (!e || e.ctrlKey || e.altKey || e.metaKey) return '';
    const code = String(e.code || '');
    let key = String(e.key || '');
    key = OLD_KEY[key] || key || CODE_KEY[e.keyCode] || '';      // old TV browsers: no .key, or 'Left' / 'Esc'
    const named = NAMED[key] || (key.length !== 1 && TV_KEYS[e.keyCode]) || '';
    if (c.typing) return named === 'back' ? 'back' : '';
    if (named) return named;
    if (key === 'Backspace') return c.tv ? 'back' : '';
    const arrow = {ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down'}[key];
    if (arrow) {
      if (c.panel) return 'panel' + arrow;
      if (c.card || c.ctl) return 'focus' + arrow;
      if (arrow === 'Left') return 'rew';
      if (arrow === 'Right') return 'fwd';
      if (c.seek) return 'focus' + arrow;
      return c.tv ? 'show' : (arrow === 'Up' ? 'volUp' : 'volDown');
    }
    if (key === 'Enter' || key === ' ' || code === 'Space') return c.ctl || c.panel || c.card ? '' : 'toggle';      // a focused button gets its own press
    if (c.panel) return '';
    if (key === '<' || key === ',') return 'slower';
    if (key === '>' || key === '.') return 'faster';
    if (/^[0-9]$/.test(key)) return 'jump' + key;
    const m = /^Key([A-Z])$/.exec(code);                 // the letter by its place on the keyboard (a Hebrew or Russian layout)
    const letter = m ? m[1].toLowerCase() : (/^[a-zA-Z]$/.test(key) ? key.toLowerCase() : '');
    return LETTER[letter] || '';
  }
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  function stepSpeed(rate, dir) {
    let i = SPEEDS.indexOf(rate);
    if (i < 0) i = SPEEDS.indexOf(1);
    return SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + dir))];
  }
  const pure = {clock, resumePoint, isWatched, nextResume, seekStep, isHlsUrl, linkKind, vlcLink, kodiLink, intentLink, m3uText, shiftVtt, errorKind,
    keyAction, stepSpeed, SPEEDS};
  if (typeof module === 'object' && module.exports) { module.exports = pure; return; }
  const TN = G.TN;
  if (!TN) return;

  // ------------------------------------------------------------ texts
  TN.i18n.add({
    he: {pl_play: 'נגן', pl_pause: 'השהה', pl_rew: '10 שניות אחורה', pl_fwd: '10 שניות קדימה', pl_next: 'הפרק הבא', pl_mute: 'השתק', pl_unmute: 'הפעל קול',
      pl_volume: 'עוצמת קול', pl_subs: 'כתוביות', pl_audio: 'שמע', pl_settings: 'הגדרות ניגון', pl_pip: 'תמונה בתוך תמונה', pl_full: 'מסך מלא',
      pl_unfull: 'יציאה ממסך מלא', pl_cast: 'נגן במסך אחר', pl_back: 'חזרה', pl_other: 'קישור אחר', pl_seek: 'מיקום בסרט', pl_live: 'שידור חי',
      pl_loading: 'טוען...', pl_resume: 'ממשיך מ-%s', pl_continue: 'המשך', pl_start: 'מההתחלה', pl_tap: 'לחצו כדי להתחיל לנגן',
      pl_fail: 'הדפדפן לא מצליח לנגן את הקובץ הזה.', pl_err_codec: 'הדפדפן לא יודע לפענח את הקובץ הזה.', pl_why_video: 'קידוד התמונה: %s',
      pl_why_audio: 'קידוד הקול: %s', pl_why_container: 'סוג הקובץ: %s', pl_err_net: 'החיבור למקור נותק.', pl_err_dead: 'הקישור כבר לא עונה.',
      pl_nopicture: 'רק הקול מתנגן: הדפדפן לא תומך בקידוד התמונה הזה (%s).', pl_nosound: 'אין קול: הדפדפן לא תומך בקידוד הקול הזה (%s).',
      pl_compat: 'הדפדפן לא מנגן את הקובץ הזה – עובר לנגן המובנה…', pl_compat_on: 'מתנגן בנגן המובנה (MKV / HEVC / AC3 / DTS)',
      pl_slow_down: 'החיבור איטי – עוברים לאיכות נמוכה יותר כדי שהניגון לא ייעצר',
      pl_ai_now: 'תרגום AI עכשיו', pl_ai_wait: 'מכין תרגום AI…', pl_ai_none: 'תרגום AI לא זמין כרגע: שרת התרגום (המחשב בבית) לא ענה, ואין כתובית לתרגם ממנה. ודאו שהמחשב דולק, או חפשו כתובית.',
      pl_keep: 'להמשיך לצפות', pl_retry: 'נסה שוב', pl_next_link: 'הקישור הבא', pl_next_try: 'הקישור לא עבד, מנסה את הבא...',
      pl_elsewhere: 'פתיחה בנגן אחר', pl_copy: 'העתק קישור', pl_copied: 'הקישור הועתק', pl_copy_manual: 'סמנו והעתיקו את הקישור:',
      pl_vlc: 'פתח ב-VLC', pl_kodi: 'פתח ב-Kodi', pl_m3u: 'קובץ רשימת ניגון (.m3u)', pl_share: 'שיתוף לאפליקציה',
      pl_kodi_how: 'ב-Kodi: העתיקו את הקישור והדביקו אותו ב"Play URL" של ממשק הדפדפן של Kodi, או שתפו אותו לאפליקציית Kore / Yatse. כותר מהקטלוג ממשיך ב-BN Stream שב-Kodi מאותה נקודה (נקודת ההמשך מסונכרנת).',
      pl_vlc_how: 'אם VLC לא נפתח: העתיקו את הקישור ובחרו ב-VLC "פתח זרם רשת", או פתחו את קובץ רשימת הניגון.',
      pl_tg_open: 'פתח בטלגרם', pl_tg_dl: 'הורד ונגן כאן', pl_tg_save: 'שמור למכשיר', pl_tg_progress: 'מוריד מטלגרם... %s%', pl_tg_big: 'הקובץ גדול מדי להורדה כאן (%s).',
      pl_tg_saved: 'הקובץ נשמר. פתחו אותו ב-VLC או ב-Kodi.', pl_tg_login: 'התחברות לטלגרם', pl_subs_inside_no: 'בקובץ יש כנראה כתוביות עברית מובנות, אבל הדפדפן לא יודע להציג כתוביות שבתוך קובץ MKV. בחרו כתוביות מהרשת, או פתחו את הקובץ בנגן אחר (הגדרות ניגון).', pl_speed: 'מהירות', pl_normal: 'רגילה', pl_quality: 'איכות', pl_auto: 'אוטומטי', pl_fit: 'תמונה', pl_fit_contain: 'כל התמונה',
      pl_fit_cover: 'מילוי המסך', pl_autonext: 'נגן את הפרק הבא אוטומטית', pl_track: 'רצועה %s',
      pl_audio_none: 'הדפדפן לא מציג את רצועות השמע של הקובץ הזה. כדי לבחור שפה פתחו אותו בנגן אחר.', pl_audio_one: 'בקובץ הזה רצועת שמע אחת.',
      pl_subs_off: 'ללא כתוביות', pl_subs_find: 'חפש שוב', pl_subs_searching: 'מחפש כתוביות...', pl_subs_none: 'לא נמצאו כתוביות', pl_subs_file: 'מקובץ במכשיר',
      pl_subs_inside: 'בתוך הקובץ', pl_subs_online: 'נמצאו ברשת', pl_subs_given: 'הגיעו עם הסרטון', pl_offset: 'תזמון', pl_offset_val: '%s שנ׳', pl_reset: 'איפוס',
      pl_look: 'מראה', pl_subs_settings: 'הגדרות כתוביות, מפתחות וחשבונות', pl_subs_loading: 'טוען את הכתוביות...', pl_subs_failed: 'הטעינה נכשלה: %s',
      pl_subs_on: 'כתוביות: %s', pl_subs_need_id: 'חיפוש אוטומטי דורש כותר מהקטלוג.', pl_next_in: 'הפרק הבא בעוד %s', pl_next_now: 'נגן עכשיו', pl_cancel: 'ביטול',
      pl_ended: 'הסתיים', pl_replay: 'צפה שוב', pl_close: 'סגור', pl_menu_back: 'חזרה לתפריט', pl_earlier: 'מוקדם יותר', pl_later: 'מאוחר יותר',
      pl_keys: 'מקשים: רווח נגן / השהה · ← → 10 שניות · ↑ ↓ עוצמה · F מסך מלא · M השתק · C כתוביות · N הבא · Esc חזרה'},
    en: {pl_play: 'Play', pl_pause: 'Pause', pl_rew: '10 seconds back', pl_fwd: '10 seconds forward', pl_next: 'Next episode', pl_mute: 'Mute', pl_unmute: 'Sound on',
      pl_volume: 'Volume', pl_subs: 'Subtitles', pl_audio: 'Audio', pl_settings: 'Playback settings', pl_pip: 'Picture in picture', pl_full: 'Full screen',
      pl_unfull: 'Exit full screen', pl_cast: 'Play on another screen', pl_back: 'Back', pl_other: 'Another link', pl_seek: 'Position', pl_live: 'LIVE',
      pl_loading: 'Loading...', pl_resume: 'Resuming from %s', pl_continue: 'Continue', pl_start: 'From the start', pl_tap: 'Press to start playing',
      pl_fail: 'This browser cannot play this file.', pl_err_codec: 'This browser cannot decode this file.', pl_why_video: 'Picture format: %s',
      pl_why_audio: 'Sound format: %s', pl_why_container: 'File type: %s', pl_err_net: 'The connection to the source was lost.', pl_err_dead: 'The link does not answer any more.',
      pl_nopicture: 'Only the sound plays: this browser does not support this picture format (%s).', pl_nosound: 'No sound: this browser does not support this sound format (%s).',
      pl_compat: 'The browser cannot play this file - switching to the built-in engine…', pl_compat_on: 'Playing with the built-in engine (MKV / HEVC / AC3 / DTS)',
      pl_slow_down: 'Slow connection - switching to a lower quality so playback does not stop',
      pl_ai_now: 'AI translation now', pl_ai_wait: 'Preparing the AI translation…', pl_ai_none: 'AI translation is not available now: the translation server (the PC at home) did not answer, and there is no subtitle to translate from. Check that the PC is on, or search for a subtitle.',
      pl_keep: 'Keep watching', pl_retry: 'Try again', pl_next_link: 'Next link', pl_next_try: 'That link did not work, trying the next one...',
      pl_elsewhere: 'Open in another player', pl_copy: 'Copy link', pl_copied: 'Link copied', pl_copy_manual: 'Select and copy the link:',
      pl_vlc: 'Open in VLC', pl_kodi: 'Open in Kodi', pl_m3u: 'Playlist file (.m3u)', pl_share: 'Share to an app',
      pl_kodi_how: 'In Kodi: copy the link and paste it into "Play URL" of Kodi\'s web interface, or share it to the Kore / Yatse app. A title from the catalogue continues in BN Stream on Kodi from the same point (the resume point is synced).',
      pl_vlc_how: 'If VLC does not open: copy the link and choose "Open Network Stream" in VLC, or open the playlist file.',
      pl_tg_open: 'Open in Telegram', pl_tg_dl: 'Download and play here', pl_tg_save: 'Save to device', pl_tg_progress: 'Downloading from Telegram... %s%', pl_tg_big: 'The file is too large to download here (%s).',
      pl_tg_saved: 'The file was saved. Open it in VLC or Kodi.', pl_tg_login: 'Connect Telegram', pl_subs_inside_no: 'This file probably has Hebrew subtitles inside, but a browser cannot show subtitles that are inside an MKV file. Choose subtitles found online, or open the file in another player (playback settings).', pl_speed: 'Speed', pl_normal: 'Normal', pl_quality: 'Quality', pl_auto: 'Automatic', pl_fit: 'Picture', pl_fit_contain: 'Whole picture',
      pl_fit_cover: 'Fill the screen', pl_autonext: 'Play the next episode automatically', pl_track: 'Track %s',
      pl_audio_none: 'This browser does not show the sound tracks of this file. To choose a language, open it in another player.', pl_audio_one: 'This file has one sound track.',
      pl_subs_off: 'No subtitles', pl_subs_find: 'Search again', pl_subs_searching: 'Looking for subtitles...', pl_subs_none: 'No subtitles found', pl_subs_file: 'From a file on this device',
      pl_subs_inside: 'Inside the file', pl_subs_online: 'Found online', pl_subs_given: 'Came with the video', pl_offset: 'Timing', pl_offset_val: '%s s', pl_reset: 'Reset',
      pl_look: 'Appearance', pl_subs_settings: 'Subtitle settings, keys and accounts', pl_subs_loading: 'Loading the subtitles...', pl_subs_failed: 'Could not load: %s',
      pl_subs_on: 'Subtitles: %s', pl_subs_need_id: 'The automatic search needs a title from the catalogue.', pl_next_in: 'Next episode in %s', pl_next_now: 'Play now', pl_cancel: 'Cancel',
      pl_ended: 'Finished', pl_replay: 'Watch again', pl_close: 'Close', pl_menu_back: 'Back to the menu', pl_earlier: 'Earlier', pl_later: 'Later',
      pl_keys: 'Keys: Space play / pause · ← → 10 s · ↑ ↓ volume · F full screen · M mute · C subtitles · N next · Esc back'},
    ru: {pl_play: 'Воспроизвести', pl_pause: 'Пауза', pl_rew: 'На 10 секунд назад', pl_fwd: 'На 10 секунд вперёд', pl_next: 'Следующая серия', pl_mute: 'Выключить звук', pl_unmute: 'Включить звук',
      pl_volume: 'Громкость', pl_subs: 'Субтитры', pl_audio: 'Звук', pl_settings: 'Настройки воспроизведения', pl_pip: 'Картинка в картинке', pl_full: 'Во весь экран',
      pl_unfull: 'Выйти из полного экрана', pl_cast: 'Смотреть на другом экране', pl_back: 'Назад', pl_other: 'Другая ссылка', pl_seek: 'Позиция', pl_live: 'ЭФИР',
      pl_loading: 'Загрузка...', pl_resume: 'Продолжаем с %s', pl_continue: 'Продолжить', pl_start: 'С начала', pl_tap: 'Нажмите, чтобы начать',
      pl_fail: 'Браузер не может воспроизвести этот файл.', pl_err_codec: 'Браузер не умеет декодировать этот файл.', pl_why_video: 'Формат изображения: %s',
      pl_why_audio: 'Формат звука: %s', pl_why_container: 'Тип файла: %s', pl_err_net: 'Соединение с источником потеряно.', pl_err_dead: 'Ссылка больше не отвечает.',
      pl_nopicture: 'Играет только звук: браузер не поддерживает этот формат изображения (%s).', pl_nosound: 'Нет звука: браузер не поддерживает этот формат звука (%s).',
      pl_compat: 'Браузер не воспроизводит этот файл - включается встроенный плеер…', pl_compat_on: 'Воспроизводит встроенный плеер (MKV / HEVC / AC3 / DTS)',
      pl_slow_down: 'Медленное соединение - качество снижено, чтобы воспроизведение не прерывалось',
      pl_ai_now: 'Перевод ИИ сейчас', pl_ai_wait: 'Готовлю перевод ИИ…', pl_ai_none: 'Перевод ИИ сейчас недоступен: сервер перевода (домашний ПК) не ответил, и нет субтитров для перевода. Проверьте, что ПК включён, или найдите субтитры.',
      pl_keep: 'Смотреть дальше', pl_retry: 'Повторить', pl_next_link: 'Следующая ссылка', pl_next_try: 'Ссылка не сработала, пробуем следующую...',
      pl_elsewhere: 'Открыть в другом плеере', pl_copy: 'Скопировать ссылку', pl_copied: 'Ссылка скопирована', pl_copy_manual: 'Выделите и скопируйте ссылку:',
      pl_vlc: 'Открыть в VLC', pl_kodi: 'Открыть в Kodi', pl_m3u: 'Файл плейлиста (.m3u)', pl_share: 'Поделиться с приложением',
      pl_kodi_how: 'В Kodi: скопируйте ссылку и вставьте её в «Play URL» веб-интерфейса Kodi или отправьте в приложение Kore / Yatse. Фильм из каталога продолжится в BN Stream на Kodi с того же места (точка продолжения синхронизируется).',
      pl_vlc_how: 'Если VLC не открылся: скопируйте ссылку и выберите в VLC «Открыть URL», либо откройте файл плейлиста.',
      pl_tg_open: 'Открыть в Telegram', pl_tg_dl: 'Скачать и смотреть здесь', pl_tg_save: 'Сохранить на устройство', pl_tg_progress: 'Скачиваем из Telegram... %s%', pl_tg_big: 'Файл слишком большой для скачивания здесь (%s).',
      pl_tg_saved: 'Файл сохранён. Откройте его в VLC или Kodi.', pl_tg_login: 'Подключить Telegram', pl_subs_inside_no: 'В файле, вероятно, есть встроенные субтитры на иврите, но браузер не умеет показывать субтитры внутри MKV. Выберите субтитры из сети или откройте файл в другом плеере (настройки воспроизведения).', pl_speed: 'Скорость', pl_normal: 'Обычная', pl_quality: 'Качество', pl_auto: 'Авто', pl_fit: 'Изображение', pl_fit_contain: 'Весь кадр',
      pl_fit_cover: 'Заполнить экран', pl_autonext: 'Включать следующую серию автоматически', pl_track: 'Дорожка %s',
      pl_audio_none: 'Браузер не показывает звуковые дорожки этого файла. Чтобы выбрать язык, откройте его в другом плеере.', pl_audio_one: 'В этом файле одна звуковая дорожка.',
      pl_subs_off: 'Без субтитров', pl_subs_find: 'Искать снова', pl_subs_searching: 'Ищем субтитры...', pl_subs_none: 'Субтитры не найдены', pl_subs_file: 'Из файла на устройстве',
      pl_subs_inside: 'Внутри файла', pl_subs_online: 'Найдено в сети', pl_subs_given: 'Вместе с видео', pl_offset: 'Синхронизация', pl_offset_val: '%s с', pl_reset: 'Сброс',
      pl_look: 'Вид', pl_subs_settings: 'Настройки субтитров, ключи и аккаунты', pl_subs_loading: 'Загружаем субтитры...', pl_subs_failed: 'Не удалось загрузить: %s',
      pl_subs_on: 'Субтитры: %s', pl_subs_need_id: 'Для автопоиска нужен фильм из каталога.', pl_next_in: 'Следующая серия через %s', pl_next_now: 'Включить сейчас', pl_cancel: 'Отмена',
      pl_ended: 'Конец', pl_replay: 'Смотреть снова', pl_close: 'Закрыть', pl_menu_back: 'Назад в меню', pl_earlier: 'Раньше', pl_later: 'Позже',
      pl_keys: 'Клавиши: Пробел пуск / пауза · ← → 10 с · ↑ ↓ громкость · F полный экран · M звук · C субтитры · N далее · Esc назад'},
  });
  const t = TN.t, esc = TN.esc;
  const RES = 'player_resume';
  const HLS_SRC = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js';
  const HLS_SRI = 'sha384-w6Gb3fXHb5e1LUYa/hYA5Q41bEDglN5ZPCG7Jvnoo8/X90oGnlPqBlBJCe38mEMm';      // the pin index.html uses
  const doc = document, html = doc.documentElement;
  const isTv = () => html.classList.contains('tv') || html.getAttribute('data-shell') === 'tv';
  const isPhone = () => html.getAttribute('data-shell') === 'phone' || html.classList.contains('phone') ||
    (Math.min(G.innerWidth, G.innerHeight) < 520 && G.matchMedia && G.matchMedia('(pointer:coarse)').matches);
  const UA = navigator.userAgent || '';
  const isIphone = /iPhone|iPod/.test(UA);

  function saveResume(key, pos, dur) {
    if (!key || !(pos >= 0)) return;
    TN.put(RES, nextResume(TN.get(RES, {}) || {}, key, pos, dur, Date.now()));
  }
  const resumeOf = (key) => resumePoint(TN.get(RES, {}) || {}, key);
  const watched = (key) => isWatched(TN.get(RES, {}) || {}, key);
  const sizeText = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : Math.max(1, Math.round(b / 1048576)) + ' MB');

  // ------------------------------------------------------------ look
  const ICON = {
    play: 'M8 5v14l11-7z', pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
    rew: 'M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z', fwd: 'M12 5V1l5 5-5 5V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z',
    next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
    vol: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z',
    mute: 'M3 9v6h4l5 5V4L7 9H3zm12 .4L16.4 8l2.1 2.1L20.6 8 22 9.4l-2.1 2.1 2.1 2.1-1.4 1.4-2.1-2.1-2.1 2.1-1.4-1.4 2.1-2.1z',
    subs: 'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm1 6v2h6v-2H5zm8 0v2h6v-2h-6zm-8 4v2h10v-2H5zm12 0v2h2v-2h-2z',
    audio: 'M12 3a9 9 0 0 0-9 9v6a2 2 0 0 0 2 2h3v-7H5v-1a7 7 0 0 1 14 0v1h-3v7h3a2 2 0 0 0 2-2v-6a9 9 0 0 0-9-9z',
    gear: 'M3 6h10v2H3zm14 0h4v2h-4zm-4-2h2v6h-2zM3 16h4v2H3zm8 0h10v2H11zm-4-2h2v6H7z',
    pip: 'M3 5h18v14H3V5zm2 2v10h14V7H5zm7 4h6v5h-6v-5z',
    full: 'M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm14 0h2v6h-6v-2h4v-4z',
    unfull: 'M8 4h2v6H4V8h4V4zm6 0h2v4h4v2h-6V4zM4 14h6v6H8v-4H4v-2zm10 0h6v2h-4v4h-2v-6z',
    back: 'M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20v-2z',
    cast: 'M3 18v3h3a3 3 0 0 0-3-3zm0-4v2a5 5 0 0 1 5 5h2a7 7 0 0 0-7-7zm0-4v2a9 9 0 0 1 9 9h2A11 11 0 0 0 3 10zm18-7H3a2 2 0 0 0-2 2v3h2V5h18v14h-7v2h7a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z',
    list: 'M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4z',
  };
  const ico = (n) => `<svg class="pl-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${ICON[n]}"/>` +
    (n === 'rew' || n === 'fwd' ? '<text x="12" y="16.4" text-anchor="middle" font-size="6.5" font-weight="700" font-family="Arial,sans-serif">10</text>' : '') + '</svg>';
  function style() {
    if (doc.getElementById('pl-style')) return;
    const s = doc.createElement('style');
    s.id = 'pl-style';
    s.textContent = [
      '.pl-root{position:fixed;top:0;left:0;right:0;bottom:0;z-index:60;background:#000;color:#fff;font:16px/1.4 system-ui,-apple-system,"Segoe UI",Arial,sans-serif;overflow:hidden;outline:0;user-select:none;-webkit-user-select:none;touch-action:manipulation;-webkit-tap-highlight-color:transparent}',
      '.pl-root *{box-sizing:border-box}.pl-root [hidden]{display:none!important}',
      '.pl-video{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;background:#000}.pl-root.pl-cover .pl-video{object-fit:cover}',
      '.pl-tap{position:absolute;top:0;left:0;right:0;bottom:0}',
      '.pl-root.pl-idle{cursor:none}.pl-root.pl-idle .pl-top,.pl-root.pl-idle .pl-bottom{opacity:0;pointer-events:none;visibility:hidden}',
      '.pl-top,.pl-bottom{position:absolute;left:0;right:0;transition:opacity .15s,visibility .15s;opacity:1;visibility:visible}',
      '.pl-top{top:0;display:flex;gap:12px;align-items:center;padding:12px 16px;padding-top:calc(12px + env(safe-area-inset-top,0px));padding-left:calc(16px + env(safe-area-inset-left,0px));padding-right:calc(16px + env(safe-area-inset-right,0px));background:linear-gradient(#000c,#0000)}',
      '.pl-titles{flex:1;min-width:0;display:flex;flex-direction:column;text-align:start}.pl-titles b{font-size:1.15em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}',
      '.pl-titles span{opacity:.8;font-size:.9em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.pl-live{background:#d32f2f;border-radius:6px;padding:2px 10px;font-size:.8em;font-weight:700;letter-spacing:.05em}.pl-clock{opacity:.85;font-variant-numeric:tabular-nums}',
      '.pl-bottom{bottom:0;padding:28px 16px 10px;padding-bottom:calc(10px + env(safe-area-inset-bottom,0px));padding-left:calc(16px + env(safe-area-inset-left,0px));padding-right:calc(16px + env(safe-area-inset-right,0px));background:linear-gradient(#0000,#000d)}',
      '.pl-status{min-height:1.4em;font-size:.9em;opacity:.9;text-align:center;margin-bottom:4px;text-shadow:0 0 4px #000}',
      '.pl-seekrow{display:flex;align-items:center;gap:12px;font-variant-numeric:tabular-nums;font-size:.9em}',
      '.pl-seek{position:relative;flex:1;height:28px;cursor:pointer;outline:0;touch-action:none}',
      '.pl-seek::before{content:"";position:absolute;left:0;right:0;top:11px;height:6px;border-radius:3px;background:#fff3}',
      '.pl-buf,.pl-pos{position:absolute;left:0;top:11px;height:6px;border-radius:3px;width:0}.pl-buf{background:#fff6}.pl-pos{background:var(--accent,#4da3ff)}',
      '.pl-knob{position:absolute;top:6px;width:16px;height:16px;margin-left:-8px;border-radius:50%;background:#fff;left:0;box-shadow:0 0 4px #000}',
      '.pl-seek:focus-visible::before,.pl-seek.pl-kb::before{outline:3px solid var(--accent,#4da3ff);outline-offset:3px}',
      '.pl-bubble{position:absolute;bottom:30px;transform:translateX(-50%);background:#000d;border-radius:6px;padding:2px 8px;font-size:.85em;white-space:nowrap;pointer-events:none}',
      '.pl-row{display:flex;align-items:center;gap:6px;margin-top:4px}.pl-gap{flex:1}',
      '.pl-btn{appearance:none;-webkit-appearance:none;border:0;background:transparent;color:#fff;min-width:44px;height:44px;border-radius:10px;padding:0 10px;display:inline-flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;font:inherit;text-decoration:none;flex:none}',
      '.pl-btn:hover{background:#fff2}.pl-btn:focus-visible,.pl-prow:focus-visible,.pl-chip:focus-visible,.pl-cbtn:focus-visible{outline:3px solid var(--accent,#4da3ff);outline-offset:2px}',
      '.pl-btn[aria-pressed="true"]{color:var(--accent,#4da3ff)}.pl-ico{width:26px;height:26px;fill:currentColor;flex:none}.pl-ico text{fill:currentColor}',
      '.pl-root[dir=rtl] .pl-back .pl-ico{transform:scaleX(-1)}.pl-btn.pl-txt span{font-size:.9em;max-width:11em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.pl-vol{width:90px;accent-color:var(--accent,#4da3ff);height:28px}',
      '.pl-big{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:92px;height:92px;border-radius:50%;border:0;background:#000a;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center}',
      '.pl-big .pl-ico{width:52px;height:52px}.pl-big:focus-visible{outline:3px solid var(--accent,#4da3ff);outline-offset:3px}',
      '.pl-big+.pl-bigtxt{position:absolute;top:calc(50% + 62px);left:0;right:0;text-align:center;text-shadow:0 0 6px #000}',
      '.pl-spin{position:absolute;top:50%;left:50%;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;border:5px solid #fff3;border-top-color:#fff;animation:pl-spin .9s linear infinite;pointer-events:none}',
      '@keyframes pl-spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.pl-spin{animation-duration:3s}}',
      '.pl-flash{position:absolute;top:22%;left:50%;transform:translateX(-50%);background:#000b;border-radius:10px;padding:8px 16px;font-size:1.1em;pointer-events:none;opacity:0;transition:opacity .15s;max-width:86%;text-align:center}.pl-flash.pl-show{opacity:1}',
      '.pl-card{position:absolute;left:50%;bottom:26%;transform:translateX(-50%);background:rgba(18,20,28,.96);border-radius:14px;padding:16px 18px;max-width:min(560px,92%);width:max-content;text-align:center;box-shadow:0 10px 40px #000a;max-height:64%;overflow:auto;user-select:text;-webkit-user-select:text}',
      '.pl-card p{margin:0 0 6px}.pl-card p:empty{display:none}.pl-note{margin-top:8px}.pl-card small{display:block;opacity:.8;margin:0 0 8px}.pl-cbtns{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:10px}',
      '.pl-cbtn{appearance:none;-webkit-appearance:none;border:1px solid #fff5;background:transparent;color:#fff;border-radius:10px;min-height:44px;padding:8px 16px;font:inherit;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}',
      '.pl-cbtn.pl-pri{background:var(--accent,#4da3ff);border-color:transparent;color:#000;font-weight:600}.pl-card input{width:100%;min-height:40px;background:#000;color:#fff;border:1px solid #fff5;border-radius:8px;padding:6px 10px;font:inherit;margin-top:8px}',
      '.pl-panel{position:absolute;top:0;bottom:0;width:min(380px,100%);background:rgba(16,18,26,.97);display:flex;flex-direction:column;box-shadow:0 0 40px #000a;text-align:start;user-select:text;-webkit-user-select:text}',
      '.pl-root[dir=ltr] .pl-panel{right:0}.pl-root[dir=rtl] .pl-panel{left:0}',
      '.pl-phead{display:flex;align-items:center;gap:8px;padding:12px 14px;padding-top:calc(12px + env(safe-area-inset-top,0px));border-bottom:1px solid #fff2}.pl-phead h3{flex:1;margin:0;font-size:1.1em}',
      '.pl-pbody{flex:1;overflow:auto;padding:8px 10px calc(14px + env(safe-area-inset-bottom,0px));-webkit-overflow-scrolling:touch}',
      '.pl-pbody h4{margin:14px 6px 4px;font-size:.85em;opacity:.7;font-weight:600}.pl-pmsg{margin:8px 6px;font-size:.92em;opacity:.9}',
      '.pl-prow{appearance:none;-webkit-appearance:none;display:flex;align-items:center;gap:10px;width:100%;min-height:46px;border:0;border-radius:10px;background:transparent;color:#fff;font:inherit;text-align:start;padding:8px 10px;cursor:pointer;text-decoration:none}',
      '.pl-prow:hover{background:#fff1}.pl-prow::before{content:"";flex:none;width:18px;height:18px;border-radius:50%;border:2px solid #fff8}',
      '.pl-prow[aria-checked="true"]::before{border-color:var(--accent,#4da3ff);background:radial-gradient(var(--accent,#4da3ff) 45%,transparent 50%)}',
      '.pl-prow.pl-act::before{display:none}.pl-prow.pl-sw::before{border-radius:5px}.pl-prow.pl-sw[aria-checked="true"]::before{background:var(--accent,#4da3ff)}',
      '.pl-prow span{flex:1;min-width:0;overflow-wrap:anywhere}.pl-tag{flex:none!important;font-size:.72em;border:1px solid #fff6;border-radius:5px;padding:0 6px;text-transform:uppercase}',
      '.pl-line{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:4px 6px}.pl-line>b{flex:1 1 100%;font-weight:500;font-size:.92em}',
      '.pl-chip{appearance:none;-webkit-appearance:none;border:1px solid #fff5;background:transparent;color:#fff;border-radius:999px;min-height:40px;min-width:44px;padding:4px 14px;font:inherit;cursor:pointer}',
      '.pl-chip[aria-checked="true"],.pl-chip[aria-pressed="true"]{background:var(--accent,#4da3ff);color:#000;border-color:transparent}',
      '.pl-val{min-width:5.5em;text-align:center;font-variant-numeric:tabular-nums}',
      '@media (max-width:600px){.pl-root{font-size:15px}.pl-panel{top:auto;width:100%;max-height:72%;border-radius:16px 16px 0 0}.pl-vol{display:none}.pl-btn{min-width:40px;padding:0 6px}.pl-row{gap:2px}.pl-btn.pl-txt span{display:none}.pl-card{bottom:18%}}',
      'html.tv .pl-root,html[data-shell=tv] .pl-root{font-size:24px}html.tv .pl-btn,html[data-shell=tv] .pl-btn{min-width:64px;height:64px}html.tv .pl-ico,html[data-shell=tv] .pl-ico{width:36px;height:36px}',
      'html.tv .pl-vol,html[data-shell=tv] .pl-vol,html.tv .pl-mute,html[data-shell=tv] .pl-mute{display:none}html.tv .pl-panel,html[data-shell=tv] .pl-panel{width:min(560px,100%)}',
      'html.tv .pl-prow,html[data-shell=tv] .pl-prow{min-height:64px}html.tv .pl-top,html.tv .pl-bottom,html[data-shell=tv] .pl-top,html[data-shell=tv] .pl-bottom{padding-left:5vw;padding-right:5vw}html.tv .pl-bottom,html[data-shell=tv] .pl-bottom{padding-bottom:5vh}html.tv .pl-top,html[data-shell=tv] .pl-top{padding-top:5vh}',
      '.pl-root .subs-set{padding:4px 6px}',
    ].join('');
    doc.head.append(s);
  }
  function el(tag, cls, text) { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(cls, icon, label, on, text) {
    const b = el('button', 'pl-btn ' + cls);
    b.type = 'button';
    b.innerHTML = (icon ? ico(icon) : '') + (text ? `<span>${esc(text)}</span>` : '');
    b.setAttribute('aria-label', label); b.title = label;
    b.addEventListener('click', (e) => { e.stopPropagation(); on(e); });
    return b;
  }

  // ------------------------------------------------------------ one session at a time
  let session = null, seq = 0, popping = 0, popWait = [];
  const ourState = (s) => !!(s && history.state && history.state.tnPlayer === s.id);
  G.addEventListener('popstate', () => {
    if (popping > 0) { popping--; const w = popWait; popWait = []; w.forEach((f) => f()); return; }
    const s = session;
    if (!s || ourState(s)) return;
    // the browser's / phone's Back while the player is open: first the menu, then the player
    if (s.panelOpen && s.panelOpen()) { s.closePanel(); try { history.pushState({tnPlayer: s.id}, ''); } catch (e) { /* no history */ } return; }
    end(true);
  });
  // closes the player. keepState: the history entry of the player is not taken back (the caller reuses or already left it)
  function end(keepState) {
    const s = session;
    if (!s) return false;
    session = null;
    const mine = ourState(s);
    try { if (s.v && s.v.duration && isFinite(s.v.duration) && !s.live) saveResume(s.key, s.pos(), s.v.duration); } catch (e) { /* no position */ }
    (s.cleanup || []).slice().reverse().forEach((f) => { try { f(); } catch (e) { /* the rest still runs */ } });
    try { if (s.hls) s.hls.destroy(); } catch (e) { /* gone */ }
    try { s.v.pause(); s.v.removeAttribute('src'); s.v.load(); } catch (e) { /* gone */ }
    try { const fe = doc.fullscreenElement || doc.webkitFullscreenElement; if (fe && s.root.contains(fe) || fe === s.root) (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc); } catch (e) { /* not full screen */ }
    try { s.root.remove(); } catch (e) { /* gone */ }
    try { if (s.opener && doc.body.contains(s.opener)) s.opener.focus({preventScroll: true}); } catch (e) { /* no opener */ }
    if (mine && !keepState) { popping++; try { history.back(); } catch (e) { popping--; } }
    return mine;
  }
  // close, and run fn once the history entry of the player is really gone (a sheet opened by fn may add its own)
  function leave(fn) {
    const had = end(false);
    if (!fn) return;
    if (!had || !popping) { fn(); return; }
    let done = false;
    const go = () => { if (!done) { done = true; fn(); } };
    popWait.push(go);
    setTimeout(go, 400);
  }
  if (TN.on) TN.on('route', (ctx) => { if (session && !(ctx && ctx.keep)) end(true); });

  async function ensureHls() {
    if (G.Hls) return G.Hls;
    try { await TN.loadScript(HLS_SRC, HLS_SRI); } catch (e) { /* native HLS, where there is one */ }
    return G.Hls || null;
  }

  // ------------------------------------------------------------ open
  async function open(o) {
    o = o || {};
    const reuse = end(true);
    style();
    try { if (TN.stopRadio) TN.stopRadio(); } catch (e) { /* no radio */ }
    const id = ++seq, tv = isTv();
    const root = el('div', 'pl-root');
    root.id = 'pl-root'; root.tabIndex = -1;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', o.title || 'Player');
    root.dir = TN.rtl() ? 'rtl' : 'ltr';
    const v = el('video', 'pl-video');
    v.playsInline = true; v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); v.setAttribute('x-webkit-airplay', 'allow');
    v.preload = 'auto';
    const poster = o.poster ? TN.httpsOnly(o.poster) : '';
    if (poster) v.poster = poster;
    const tap = el('div', 'pl-tap'), spin = el('div', 'pl-spin'), flashEl = el('div', 'pl-flash');
    flashEl.setAttribute('aria-hidden', 'true');
    const big = el('button', 'pl-big'); big.type = 'button'; big.innerHTML = ico('play'); big.setAttribute('aria-label', t('pl_play')); big.hidden = true;
    const bigTxt = el('div', 'pl-bigtxt', t('pl_tap')); bigTxt.hidden = true;
    const top = el('div', 'pl-top'), bottom = el('div', 'pl-bottom'), card = el('div', 'pl-card'), panel = el('div', 'pl-panel');
    card.hidden = true; panel.hidden = true; card.setAttribute('role', 'alertdialog'); panel.setAttribute('role', 'dialog');
    bottom.dir = 'ltr';
    const s = {id, o, root, v, key: o.resumeKey || '', live: !!o.live, hls: null, cleanup: [], opener: doc.activeElement, url: '', started: false, failed: false,
      extra: (o.subs || []).slice(), found: null, subsErr: '', subsBusy: '', nextReq: null, nextOff: false, seekTo: null, seekN: 0, seekAt: 0, tgh: null, tgp: null, sniff: null};
    session = s;
    s.pos = () => (s.seekTo != null ? s.seekTo : v.currentTime || 0);
    const alive = () => session === s;
    const on = (target, type, fn, opt) => { target.addEventListener(type, fn, opt); s.cleanup.push(() => target.removeEventListener(type, fn, opt)); };

    // ---------- top bar
    const backB = btn('pl-back', 'back', t('pl_back'), () => leave());
    const titles = el('div', 'pl-titles');
    const tB = el('b', '', o.title || ''); tB.dir = 'auto';
    const tS = el('span', '', o.sub || ''); tS.dir = 'auto'; tS.hidden = !o.sub;
    titles.append(tB, tS);
    const liveChip = el('span', 'pl-live', t('pl_live')); liveChip.hidden = !s.live;
    const clockEl = el('span', 'pl-clock'); clockEl.hidden = !tv;
    top.append(backB, titles, liveChip, clockEl);
    if (tv) {
      const tick = () => { const d = new Date(); clockEl.textContent = pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
      tick(); const ti = setInterval(tick, 20000); s.cleanup.push(() => clearInterval(ti));
    }

    // ---------- bottom bar
    const status = el('div', 'pl-status'); status.setAttribute('role', 'status'); status.dir = 'auto';
    const seekRow = el('div', 'pl-seekrow'), cur = el('span', 'pl-cur', '0:00'), dur = el('span', 'pl-dur', '0:00');
    const seek = el('div', 'pl-seek'), buf = el('div', 'pl-buf'), posEl = el('div', 'pl-pos'), knob = el('div', 'pl-knob'), bubble = el('div', 'pl-bubble');
    seek.tabIndex = 0; seek.setAttribute('role', 'slider'); seek.setAttribute('aria-label', t('pl_seek')); seek.setAttribute('aria-valuemin', '0');
    bubble.hidden = true;
    seek.append(buf, posEl, knob, bubble);
    seekRow.append(cur, seek, dur);
    const row = el('div', 'pl-row');
    const playB = btn('pl-play', 'play', t('pl_play'), () => toggle());
    const rewB = btn('pl-rew', 'rew', t('pl_rew'), () => nudge(-1));
    const fwdB = btn('pl-fwd', 'fwd', t('pl_fwd'), () => nudge(1));
    const nextB = btn('pl-next pl-txt', 'next', t('pl_next'), () => goNext(), t('pl_next')); nextB.hidden = true;
    const muteB = btn('pl-mute', 'vol', t('pl_mute'), () => setMuted(!v.muted));
    const vol = el('input', 'pl-vol'); vol.type = 'range'; vol.min = '0'; vol.max = '1'; vol.step = '0.05'; vol.setAttribute('aria-label', t('pl_volume'));
    const otherB = btn('pl-other pl-txt', 'list', t('pl_other'), () => { const b = o.back; leave(() => b()); }, t('pl_other')); otherB.hidden = !o.back;
    const subsB = btn('pl-subs', 'subs', t('pl_subs'), () => togglePanel('subs'));
    const audioB = btn('pl-audio', 'audio', t('pl_audio'), () => togglePanel('audio'));
    const gearB = btn('pl-gear', 'gear', t('pl_settings'), () => togglePanel('gear'));
    const castB = btn('pl-cast', 'cast', t('pl_cast'), () => cast()); castB.hidden = true;
    const pipB = btn('pl-pip', 'pip', t('pl_pip'), () => pip());
    const fullB = btn('pl-full', 'full', t('pl_full'), () => fullscreen());
    row.append(playB, rewB, fwdB, nextB, muteB, vol, el('span', 'pl-gap'), otherB, subsB, audioB, gearB, castB, pipB, fullB);
    bottom.append(status, seekRow, row);
    root.append(v, tap, spin, big, bigTxt, flashEl, top, bottom, card, panel);
    doc.body.append(root);
    try { if (reuse) history.replaceState({tnPlayer: id}, ''); else history.pushState({tnPlayer: id}, ''); } catch (e) { /* no history API */ }
    root.focus({preventScroll: true});

    const say = (x) => { status.textContent = x || ''; };
    let flashT = 0;
    function flash(x) { flashEl.textContent = x; flashEl.classList.add('pl-show'); clearTimeout(flashT); flashT = setTimeout(() => flashEl.classList.remove('pl-show'), 1100); }
    s.cleanup.push(() => clearTimeout(flashT));
    const canFull = !!(root.requestFullscreen || root.webkitRequestFullscreen || v.webkitEnterFullscreen);
    fullB.hidden = !canFull;
    const canPip = !!((doc.pictureInPictureEnabled && v.requestPictureInPicture) || (v.webkitSupportsPresentationMode && typeof v.webkitSetPresentationMode === 'function'));
    pipB.hidden = !canPip;

    // ---------- showing and hiding the controls
    let idleT = 0;
    const busy = () => v.paused || !panel.hidden || !card.hidden || s.failed || s.dragging;
    function poke() {
      root.classList.remove('pl-idle');
      clearTimeout(idleT);
      idleT = setTimeout(() => { if (alive() && !busy()) { if (bottom.contains(doc.activeElement) || top.contains(doc.activeElement)) root.focus({preventScroll: true}); root.classList.add('pl-idle'); } }, tv ? 5000 : 3000);
    }
    s.cleanup.push(() => clearTimeout(idleT));
    const hidden = () => root.classList.contains('pl-idle');
    on(root, 'mousemove', poke); on(root, 'focusin', poke);

    // ---------- play / pause / seek / volume
    function toggle() { if (s.failed) return; if (v.paused || v.ended) play(); else v.pause(); poke(); }
    function play() {
      const p = v.play();
      if (p && p.catch) p.catch((e) => { if (alive() && e && e.name === 'NotAllowedError') { big.hidden = false; bigTxt.hidden = false; spin.hidden = true; big.focus({preventScroll: true}); } });
    }
    big.addEventListener('click', (e) => { e.stopPropagation(); big.hidden = true; bigTxt.hidden = true; play(); root.focus({preventScroll: true}); });
    const total = () => (isFinite(v.duration) && v.duration > 0 ? v.duration : 0);
    function seekTo(x, quiet) {
      const d = total();
      if (!d || s.live) return;
      s.seekTo = Math.max(0, Math.min(d - 0.5, x));
      draw();
      clearTimeout(s.seekT);
      s.seekT = setTimeout(() => { if (!alive() || s.seekTo == null) return; const to = s.seekTo; s.seekTo = null; try { v.currentTime = to; } catch (e) { /* not seekable yet */ } }, quiet ? 0 : 260);
    }
    s.cleanup.push(() => clearTimeout(s.seekT));
    function nudge(dir) {
      if (s.live || !total()) return;
      const now = Date.now();
      s.seekN = now - s.seekAt < 450 && s.seekDir === dir ? s.seekN + 1 : 0;
      s.seekAt = now; s.seekDir = dir;
      const step = seekStep(s.seekN);
      seekTo(s.pos() + dir * step);
      flash((dir > 0 ? '+' : '−') + step + ' · ' + clock(s.pos()));
      poke();
    }
    const volSaved = TN.get('player_vol', null) || {};
    try { v.volume = volSaved.v >= 0 && volSaved.v <= 1 ? volSaved.v : 1; v.muted = !!volSaved.m; } catch (e) { /* fixed volume (iOS) */ }
    function drawVol() {
      const m = v.muted || v.volume === 0;
      muteB.innerHTML = ico(m ? 'mute' : 'vol');
      muteB.setAttribute('aria-label', t(m ? 'pl_unmute' : 'pl_mute')); muteB.title = t(m ? 'pl_unmute' : 'pl_mute');
      vol.value = String(v.muted ? 0 : v.volume);
    }
    function setMuted(m) { v.muted = m; if (!m && v.volume === 0) v.volume = 0.5; TN.put('player_vol', {v: v.volume, m: v.muted}); drawVol(); flash(t(m ? 'pl_mute' : 'pl_unmute')); }
    function setVol(x) { x = Math.max(0, Math.min(1, x)); try { v.volume = x; v.muted = false; } catch (e) { /* fixed */ } TN.put('player_vol', {v: v.volume, m: v.muted}); drawVol(); flash(t('pl_volume') + ' ' + Math.round(v.volume * 100) + '%'); }
    vol.addEventListener('input', () => setVol(Number(vol.value)));
    vol.addEventListener('click', (e) => e.stopPropagation());
    on(v, 'volumechange', drawVol);
    drawVol();

    // ---------- the picture of the state
    function draw() {
      const d = total(), p = s.pos();
      const live = s.live || (v.duration === Infinity);
      seekRow.hidden = live; rewB.hidden = live; fwdB.hidden = live; liveChip.hidden = !live;
      if (live) return;
      const f = d ? Math.max(0, Math.min(1, p / d)) : 0;
      posEl.style.width = (f * 100) + '%'; knob.style.left = (f * 100) + '%';
      let be = 0;
      try { for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= p + 1 && v.buffered.end(i) > be) be = v.buffered.end(i); } catch (e) { /* no ranges */ }
      buf.style.width = (d ? Math.min(1, be / d) * 100 : 0) + '%';
      cur.textContent = clock(p); dur.textContent = clock(d);
      seek.setAttribute('aria-valuemax', String(Math.round(d))); seek.setAttribute('aria-valuenow', String(Math.round(p))); seek.setAttribute('aria-valuetext', clock(p) + ' / ' + clock(d));
    }
    function drawPlay() {
      const pl = !v.paused && !v.ended;
      playB.innerHTML = ico(pl ? 'pause' : 'play');
      playB.setAttribute('aria-label', t(pl ? 'pl_pause' : 'pl_play')); playB.title = t(pl ? 'pl_pause' : 'pl_play');
    }
    // the seek bar: mouse, touch, pen
    const fracAt = (x) => { const r = seek.getBoundingClientRect(); return r.width ? Math.max(0, Math.min(1, (x - r.left) / r.width)) : 0; };
    function dragMove(x) { const f = fracAt(x), d = total(); s.seekTo = f * d; bubble.hidden = false; bubble.style.left = (f * 100) + '%'; bubble.textContent = clock(f * d); draw(); }
    function dragEnd() { if (!s.dragging) return; s.dragging = false; bubble.hidden = true; if (s.seekTo != null) seekTo(s.seekTo, true); poke(); }
    if (G.PointerEvent) {
      seek.addEventListener('pointerdown', (e) => { if (!total()) return; s.dragging = true; try { seek.setPointerCapture(e.pointerId); } catch (er) { /* old browser */ } dragMove(e.clientX); e.preventDefault(); });
      seek.addEventListener('pointermove', (e) => { if (s.dragging) dragMove(e.clientX); else if (e.pointerType === 'mouse' && total()) { const f = fracAt(e.clientX); bubble.hidden = false; bubble.style.left = (f * 100) + '%'; bubble.textContent = clock(f * total()); } });
      seek.addEventListener('pointerup', dragEnd); seek.addEventListener('pointercancel', dragEnd);
      seek.addEventListener('pointerleave', () => { if (!s.dragging) bubble.hidden = true; });
    } else {
      seek.addEventListener('mousedown', (e) => { if (!total()) return; s.dragging = true; dragMove(e.clientX); });
      on(doc, 'mousemove', (e) => { if (s.dragging) dragMove(e.clientX); });
      on(doc, 'mouseup', dragEnd);
      seek.addEventListener('touchstart', (e) => { if (!total()) return; s.dragging = true; dragMove(e.touches[0].clientX); }, {passive: true});
      seek.addEventListener('touchmove', (e) => { if (s.dragging) dragMove(e.touches[0].clientX); }, {passive: true});
      seek.addEventListener('touchend', dragEnd);
    }
    seek.addEventListener('click', (e) => e.stopPropagation());

    // taps on the picture: mouse = play / pause (double = full screen); touch = show / hide, double tap on a side = 10 s
    let lastTap = 0, tapT = 0, lastType = 'mouse';
    if (G.PointerEvent) tap.addEventListener('pointerdown', (e) => { lastType = e.pointerType || 'mouse'; });
    else tap.addEventListener('touchstart', () => { lastType = 'touch'; }, {passive: true});
    tap.addEventListener('click', (e) => {
      if (!panel.hidden) { closePanel(); return; }
      if (lastType === 'mouse') { toggle(); return; }
      const now = Date.now(), r = root.getBoundingClientRect(), f = (e.clientX - r.left) / Math.max(1, r.width);
      if (now - lastTap < 320) {
        clearTimeout(tapT); lastTap = 0;
        if (f < 0.35) nudge(-1); else if (f > 0.65) nudge(1); else toggle();
        return;
      }
      lastTap = now;
      const was = hidden();
      tapT = setTimeout(() => { if (!alive()) return; if (was) poke(); else if (!busy()) root.classList.add('pl-idle'); else poke(); }, 330);
    });
    tap.addEventListener('dblclick', () => { if (lastType === 'mouse') fullscreen(); });
    s.cleanup.push(() => clearTimeout(tapT));

    // ---------- full screen, picture in picture, another screen
    const fsEl = () => doc.fullscreenElement || doc.webkitFullscreenElement || null;
    function fullscreen() {
      try {
        if (fsEl()) { (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc); return; }
        const req = root.requestFullscreen || root.webkitRequestFullscreen;
        if (req && !isIphone) {
          const p = req.call(root);
          const lock = () => { try { if (isPhone() && screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); } catch (e) { /* not supported */ } };
          if (p && p.then) p.then(lock, () => {}); else lock();
        } else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();       // iPhone: the system player
      } catch (e) { /* refused */ }
    }
    const onFs = () => { const f = !!fsEl(); fullB.innerHTML = ico(f ? 'unfull' : 'full'); fullB.setAttribute('aria-label', t(f ? 'pl_unfull' : 'pl_full')); fullB.title = t(f ? 'pl_unfull' : 'pl_full'); };
    on(doc, 'fullscreenchange', onFs); on(doc, 'webkitfullscreenchange', onFs);
    function pip() {
      try {
        if (doc.pictureInPictureElement) { doc.exitPictureInPicture(); return; }
        if (v.requestPictureInPicture) { const p = v.requestPictureInPicture(); if (p && p.catch) p.catch(() => {}); } else if (v.webkitSetPresentationMode) v.webkitSetPresentationMode(v.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
      } catch (e) { /* refused */ }
    }
    // AirPlay (Safari) / Remote Playback (Chromium: Cast): the button shows only when a screen is there
    function cast() {
      try {
        if (v.webkitShowPlaybackTargetPicker) v.webkitShowPlaybackTargetPicker();
        else if (v.remote && v.remote.prompt) v.remote.prompt().catch(() => {});
      } catch (e) { /* refused */ }
    }
    if (G.WebKitPlaybackTargetAvailabilityEvent) on(v, 'webkitplaybacktargetavailabilitychanged', (e) => { castB.hidden = e.availability !== 'available'; });
    else if (v.remote && v.remote.watchAvailability) {
      v.remote.watchAvailability((ok) => { if (alive()) castB.hidden = !ok || linkKind(s.url) !== 'http'; }).catch(() => {});
    }

    // ---------- cards (resume, autoplay, error, next episode)
    let cardT = 0;
    function hideCard() { clearTimeout(cardT); clearInterval(s.countT); if (card.hidden) return; const had = card.contains(doc.activeElement); card.hidden = true; card.innerHTML = ''; s.cardKind = ''; if (had) root.focus({preventScroll: true}); poke(); }
    // c = {kind, text, sub, buttons: [{label, pri, act, href, download, keep}], ms (hide by itself), extra (element)}
    function showCard(c) {
      hideCard();
      card.innerHTML = '';
      s.cardKind = c.kind || '';
      const p = el('p', '', c.text || ''); p.dir = 'auto'; card.append(p);
      if (c.sub) { const sm = el('small', '', c.sub); sm.dir = 'auto'; card.append(sm); }
      if (c.extra) card.append(c.extra);
      const bs = el('div', 'pl-cbtns');
      let first = null;
      (c.buttons || []).forEach((b) => {
        if (!b) return;
        const e = el(b.href ? 'a' : 'button', 'pl-cbtn' + (b.pri ? ' pl-pri' : ''), b.label);
        if (b.href) { e.href = b.href; if (b.download) e.download = b.download; else { e.target = '_blank'; e.rel = 'noopener noreferrer'; } } else e.type = 'button';
        e.addEventListener('click', (ev) => { ev.stopPropagation(); if (!b.href) ev.preventDefault(); if (!b.keep) hideCard(); if (b.act) b.act(e); });
        bs.append(e);
        if (b.pri && !first) first = e;
      });
      card.append(bs);
      card.hidden = false;
      const f = first || bs.querySelector('.pl-cbtn');
      if (f) f.focus({preventScroll: true});
      if (c.ms) cardT = setTimeout(() => { if (alive() && s.cardKind === c.kind) hideCard(); }, c.ms);
      poke();
    }
    s.cleanup.push(() => { clearTimeout(cardT); clearInterval(s.countT); });
    // an explanation (and maybe a field) added to the card that is showing; a card of its own when none is
    function cardNote(text, extra) {
      if (card.hidden) showCard({kind: 'note', text: '', buttons: [{label: t('pl_copy'), act: copyLink, keep: true}, {label: t('pl_close'), pri: true}]});
      let n = card.querySelector('.pl-note');
      if (!n) { n = el('div', 'pl-note'); card.insertBefore(n, card.querySelector('.pl-cbtns')); }
      n.innerHTML = '';
      const sm = el('small', '', text); sm.dir = 'auto';
      n.append(sm);
      if (extra) n.append(extra);
    }
    card.addEventListener('click', (e) => e.stopPropagation());

    // ---------- other players: copy link, VLC, Kodi, share (only for a real address)
    function copyLink(anchor) {
      const u = s.url;
      const manual = () => {
        const inp = el('input'); inp.readOnly = true; inp.value = u; inp.dir = 'ltr'; inp.setAttribute('aria-label', t('pl_copy_manual'));
        cardNote(t('pl_copy_manual'), inp);
        inp.focus(); inp.select();
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(u).then(() => flash(t('pl_copied')), manual); else manual();
      return anchor;
    }
    function elsewhereButtons() {
      if (linkKind(s.url) !== 'http') return [];
      const u = s.url, out = [{label: t('pl_copy'), act: copyLink, keep: true}];
      const vl = vlcLink(u, UA), kd = kodiLink(u, UA);
      if (vl) out.push({label: t('pl_vlc'), href: vl, keep: true, act: () => flash(t('pl_vlc_how'))});
      if (kd) out.push({label: t('pl_kodi'), href: kd, keep: true});
      else out.push({label: t('pl_kodi'), keep: true, act: () => cardNote(t('pl_kodi_how'))});
      let m3u = '';
      try { m3u = URL.createObjectURL(new Blob([m3uText(u, o.title)], {type: 'audio/x-mpegurl'})); s.cleanup.push(() => URL.revokeObjectURL(m3u)); } catch (e) { m3u = ''; }
      if (m3u && !isAndroid(UA) && !/iPhone|iPad|iPod/.test(UA)) out.push({label: t('pl_m3u'), href: m3u, download: String(o.title || 'video').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) + '.m3u', keep: true});
      if (navigator.share) out.push({label: t('pl_share'), act: share, keep: true});
      return out;
    }
    function share() { try { navigator.share({title: o.title || '', url: s.url}).catch(() => {}); } catch (e) { /* refused */ } }
    // Telegram files: open in Telegram, save to the device (then VLC / Kodi), download into memory and play here
    function tgButtons(why) {
      if (!s.tgp) return [];
      const out = [], link = (s.tgh && s.tgh.tgLink) || '';
      const ref = s.tgh ? {key: s.tgh.key} : tgRef();
      if (why === 'nosw' || why === 'open') out.push({label: t('pl_tg_dl'), keep: true, act: async () => {
        hideCard(); spin.hidden = false;
        const ctl = G.AbortController ? new AbortController() : null;
        s.cleanup.push(() => ctl && ctl.abort());
        try {
          const f = await s.tgp.fallback(ref, {signal: ctl && ctl.signal, onProgress: (p) => { if (alive()) say(t('pl_tg_progress', p)); }});
          if (!alive()) { if (f.revoke) f.revoke(); return; }
          if (f.kind === 'blob') { s.cleanup.push(f.revoke); say(''); s.failed = false; start(f.url, s.tgh ? s.tgh.mime : ''); }
          else { spin.hidden = true; say(''); showCard({kind: 'error', text: t('pl_tg_big', sizeText(f.size || 0)), buttons: [f.url ? {label: t('pl_tg_open'), href: f.url, pri: true, keep: true} : null, {label: t('pl_close'), act: () => leave()}]}); }
        } catch (e) { if (alive()) { spin.hidden = true; say(''); fail('tg', {text: s.tgp.errorText ? s.tgp.errorText(e) : t('pl_fail')}); } }
      }});
      if (s.tgp.save) out.push({label: t('pl_tg_save'), keep: true, act: async () => {
        const ctl = G.AbortController ? new AbortController() : null;
        s.cleanup.push(() => ctl && ctl.abort());
        try {
          await s.tgp.save(ref, {signal: ctl && ctl.signal, onProgress: (p) => { if (alive()) say(t('pl_tg_progress', p)); }});
          if (alive()) { say(''); flash(t('pl_tg_saved')); }
        } catch (e) {
          if (!alive() || (e && e.name === 'AbortError')) return;
          say('');
          if (e && e.code === 'TGPLAY_TOO_BIG') flash(t('pl_tg_big', sizeText(e.size || 0))); else flash(s.tgp.errorText ? s.tgp.errorText(e) : t('pl_fail'));
        }
      }});
      if (link) out.push({label: t('pl_tg_open'), href: link, keep: true});
      if (why === 'login') return [{label: t('pl_tg_login'), pri: true, act: () => leave(() => TN.go('tglogin'))}];
      return out;
    }
    const tgRef = () => { const x = o.tg || {}; return x.message ? {message: x.message} : x.peer ? x : {peer: x.chat_username || x.chat_id, msg: x.msg_id}; };

    // ---------- errors
    const CODEC_NAME = {hevc: 'HEVC (H.265)', av1: 'AV1', mpeg4: 'MPEG-4 (XviD / DivX)', mpeg2: 'MPEG-2', h264: 'H.264', vp9: 'VP9', ac3: 'AC3', eac3: 'E-AC3', dts: 'DTS', truehd: 'TrueHD',
      avi: 'AVI', flv: 'FLV', ts: 'MPEG-TS', mkv: 'MKV'};
    function whyText(why) {
      const sn = s.sniff || {};
      if (why === 'video') return t('pl_why_video', CODEC_NAME[sn.video] || sn.video || '?');
      if (why === 'audio') return t('pl_why_audio', (sn.audio || []).map((a) => CODEC_NAME[a] || a).join(' + ') || '?');
      if (why === 'container') return t('pl_why_container', CODEC_NAME[sn.container] || sn.container || '?');
      return '';
    }
    async function diagnose() {                       // -> the result of the link test for what plays now (or null)
      try {
        const src = await TN.provider('sources').catch(() => null);
        if (!src || !src.sniff) return null;
        if (s.tgp && s.tgh && s.tgp.probe) {
          const p = await s.tgp.probe({key: s.tgh.key});
          const sn = src.sniff(p.head);
          return {ok: true, sniff: sn, verdict: src.verdict(sn, (m) => !!v.canPlayType(m))};
        }
        if (linkKind(s.url) === 'http' && src.probeUrl && !isHlsUrl(s.url, o.mime)) return await src.probeUrl(s.url);
      } catch (e) { /* unknown */ }
      return null;
    }
    // 5.1: what the browser cannot decode (MKV / AVI / TS, HEVC, AC3 / E-AC3 / DTS) plays through compat.js - once per
    // source, from the position reached; the <video> element then answers for that engine, so everything else stays
    function dropCompat() { if (s.compat) { const h = s.compat; s.compat = null; try { h.detach(); } catch (e) { /* gone */ } } }
    s.cleanup.push(dropCompat);
    async function tryCompat(at) {
      if (s.compatTried || !alive()) return false;
      s.compatTried = true;
      const url = s.url;
      if (!url || isHlsUrl(url, s.mime)) return false;
      try {
        const cp = await TN.provider('compat').catch(() => null);
        if (!cp || !cp.supported() || !alive() || s.url !== url) return false;
        hideCard(); spin.hidden = false; say(t('pl_compat'));
        const h = await cp.attach(v, new URL(url, location.href).href, {at: at > 0 ? at : 0, live: s.live, langs: [TN.lang()]});
        if (!alive() || s.url !== url) { h.detach(); return true; }
        s.compat = h; s.failed = false;
        say(''); spin.hidden = true; flash(t('pl_compat_on'));
        return true;
      } catch (e) { say(''); return false; }
    }
    // kind: 'media' (the <video> / hls.js gave up: looked into first) | 'tg' | 'login' | 'nosw' | 'open'
    async function fail(kind, info) {
      if (!alive() || s.failed) return;
      s.failed = true;
      info = info || {};
      spin.hidden = true; big.hidden = true; bigTxt.hidden = true;
      const at = s.pos();
      try { v.pause(); } catch (e) { /* nothing plays */ }
      let text = info.text || t('pl_fail'), sub = '';
      if (kind === 'media') {
        say(t('pl_loading'));
        const probe = await diagnose();
        if (!alive()) return;
        say('');
        if (probe && probe.sniff) s.sniff = probe.sniff;
        const k = errorKind({code: info.code, hls: info.hls, probe});
        if ((k.kind === 'codec' || info.code === 4) && k.kind !== 'dead' && k.kind !== 'network' && !s.compatTried && (await tryCompat(at))) return;
        if (!alive()) return;
        text = t(k.kind === 'dead' ? 'pl_err_dead' : k.kind === 'network' ? 'pl_err_net' : k.kind === 'codec' ? 'pl_err_codec' : 'pl_fail');
        sub = whyText(k.why);
        // a Real-Debrid / cached link that failed before anything played: the next link by itself (router.play, 3 tries)
        if (!s.started && o.autoAlt && o.alt) { flash(t('pl_next_try')); const a = o.alt; setTimeout(() => { if (alive()) leave(() => a()); }, 900); return; }
      }
      const buttons = [];
      if (kind === 'media' || kind === 'tg') buttons.push({label: t('pl_retry'), pri: !o.alt, act: () => { s.failed = false; hideCard(); if (s.tgh || !o.tg) start(s.url, s.mime, at); else openTg(); }});
      if (o.alt) buttons.push({label: t('pl_next_link'), pri: true, act: () => { const a = o.alt; leave(() => a()); }});
      if (o.back) buttons.push({label: t('pl_other'), pri: !o.alt && kind !== 'media' && kind !== 'tg', act: () => { const b = o.back; leave(() => b()); }});
      tgButtons(kind).forEach((b) => buttons.push(b));
      elsewhereButtons().forEach((b) => buttons.push(b));
      buttons.push({label: t('pl_close'), act: () => leave()});
      showCard({kind: 'error', text, sub, buttons});
    }
    // it plays, but half of it: no picture (HEVC in a browser without it) or no sound (AC3 / DTS)
    let softDone = false;
    function softCheck() {
      if (softDone || !alive() || s.failed || v.paused || !(v.currentTime > 4) || s.live) return;
      const audioOnly = /^audio\//.test(s.mime || '');
      let kind = '';
      if (!audioOnly && v.videoWidth === 0 && v.readyState >= 2) kind = 'nopicture';
      else if (!v.muted && v.volume > 0 && ((typeof v.webkitAudioDecodedByteCount === 'number' && v.webkitAudioDecodedByteCount === 0 && v.webkitVideoDecodedByteCount > 0) || v.mozHasAudio === false) && !s.hls) kind = 'nosound';
      if (v.currentTime > 12) softDone = true;
      if (!kind) return;
      softDone = true;
      const softCard = () => diagnose().then((probe) => {
        if (!alive() || s.failed) return;
        if (probe && probe.sniff) s.sniff = probe.sniff;
        const sn = s.sniff || {};
        if (kind === 'nosound' && !(sn.audio && sn.audio.length)) return;       // a silent file, or nothing is known: no false alarm
        const name = kind === 'nopicture' ? (CODEC_NAME[sn.video] || sn.video || '?') : ((sn.audio || []).map((a) => CODEC_NAME[a] || a).join(' + ') || '?');
        const buttons = [{label: t('pl_keep'), pri: true}];
        if (o.alt) buttons.push({label: t('pl_next_link'), act: () => { const a = o.alt; leave(() => a()); }});
        if (o.back) buttons.push({label: t('pl_other'), act: () => { const b = o.back; leave(() => b()); }});
        tgButtons('soft').forEach((b) => buttons.push(b));
        elsewhereButtons().forEach((b) => buttons.push(b));
        showCard({kind: 'soft', text: t(kind === 'nopicture' ? 'pl_nopicture' : 'pl_nosound', name), buttons});
      });
      // half a film (no picture / no sound) is not playing it: the built-in engine first, the notice only if it cannot
      if (!s.compatTried && !s.hls && !s.live) tryCompat(v.currentTime).then((ok) => { if (!ok && alive()) softCard(); }); else softCard();
    }

    // ---------- the source
    function start(url, mime, at) {
      if (!alive()) return;
      s.url = url; s.mime = mime || '';
      s.failed = false; softDone = false;
      dropCompat();
      if (url !== s.compatUrl) { s.compatTried = false; s.compatUrl = url; }
      if (s.hls) { try { s.hls.destroy(); } catch (e) { /* gone */ } s.hls = null; }
      spin.hidden = false;
      const begin = () => { if (at > 0) { const set = () => { try { v.currentTime = at; } catch (e) { /* later */ } }; if (v.readyState >= 1) set(); else v.addEventListener('loadedmetadata', set, {once: true}); } play(); };
      if (isHlsUrl(url, mime)) {
        ensureHls().then((Hls) => {
          if (!alive() || s.url !== url) return;
          if (Hls && Hls.isSupported()) {
            // 5.1, weak connections: start from what this device's line gave last time (1 Mbit/s when nothing is known,
            // never the top level first), go up carefully and down quickly, hold a long buffer, and keep asking for a
            // segment that did not arrive instead of giving up on the film
            let lastBw = 0;
            try { lastBw = Number(TN.get('net_bw', 0)) || 0; } catch (e) { /* no saved value */ }
            const h = new Hls({enableWorker: true, capLevelToPlayerSize: true, startLevel: -1,
              abrEwmaDefaultEstimate: Math.max(300000, Math.min(lastBw || 1000000, 8000000)), abrBandWidthFactor: 0.8, abrBandWidthUpFactor: 0.6,
              maxBufferLength: 60, maxMaxBufferLength: 180, backBufferLength: 30, maxBufferHole: 0.5, nudgeMaxRetry: 12,
              fragLoadingMaxRetry: 8, fragLoadingRetryDelay: 800, fragLoadingMaxRetryTimeout: 16000,
              manifestLoadingMaxRetry: 6, manifestLoadingRetryDelay: 800, levelLoadingMaxRetry: 6, levelLoadingRetryDelay: 800});
            s.hls = h;
            let netTries = 0, mediaTries = 0, stalls = [];
            const keepBw = () => { try { const b = Math.round(h.bandwidthEstimate || 0); if (b > 50000) TN.put('net_bw', b); } catch (e) { /* not kept */ } };
            h.on(Hls.Events.FRAG_BUFFERED, () => { if ((h._tnN = (h._tnN || 0) + 1) % 5 === 0) keepBw(); });
            h.on(Hls.Events.ERROR, (ev, d) => {
              if (!alive()) return;
              // the picture stopped to wait three times within a minute: one level lower for the rest of this video
              // (a lower picture that keeps playing is better than a sharp one that stops)
              if (d && !d.fatal && d.details === 'bufferStalledError') {
                const now = Date.now();
                stalls = stalls.filter((x) => now - x < 60000); stalls.push(now);
                if (stalls.length >= 3 && h.levels && h.levels.length > 1 && h.autoLevelEnabled) {
                  const cur = h.currentLevel >= 0 ? h.currentLevel : h.loadLevel;
                  if (cur > 0) { h.autoLevelCapping = cur - 1; stalls = []; flash(t('pl_slow_down')); }
                }
                return;
              }
              if (!d || !d.fatal) return;
              // a dropped connection: asked again after 1, 2, 4 ... seconds (six times) before the error card
              if (d.type === Hls.ErrorTypes.NETWORK_ERROR && netTries < 6) {
                const wait = Math.min(16000, 1000 * Math.pow(2, netTries++));
                spin.hidden = false;
                setTimeout(() => { if (alive() && s.hls === h) { try { h.startLoad(); } catch (e) { fail('media', {hls: 'network'}); } } }, wait);
                return;
              }
              if (d.type === Hls.ErrorTypes.MEDIA_ERROR && mediaTries++ < 2) { try { h.recoverMediaError(); return; } catch (e) { /* give up */ } }
              fail('media', {hls: d.type === Hls.ErrorTypes.NETWORK_ERROR ? 'network' : 'media'});
            });
            h.on(Hls.Events.MANIFEST_PARSED, () => { if (alive()) begin(); });
            h.on(Hls.Events.LEVEL_LOADED, (ev, d) => { if (d && d.details && d.details.live && !s.live) { s.live = true; draw(); } });
            h.loadSource(url);
            h.attachMedia(v);
          } else { v.src = url; begin(); }                 // Safari / iOS / TVs with their own HLS
        });
      } else { v.src = url; begin(); }
    }
    async function openTg() {
      say(t('pl_loading')); spin.hidden = false;
      const tgp = await TN.provider('tgplay').catch(() => null);
      if (!alive()) return;
      if (!tgp) { fail('open'); return; }
      s.tgp = tgp;
      try {
        const h = await tgp.open(tgRef(), {onEvent: (ev) => {
          if (!alive() || !ev) return;
          if (ev.type === 'flood' || ev.type === 'error') { say(ev.text || ''); poke(); } else if (ev.type === 'read' && status.textContent && !s.subsBusy) say('');
        }});
        if (!alive()) { tgp.close(h.key); return; }
        s.tgh = h;
        s.cleanup.push(() => tgp.close(h.key));
        say('');
        start(h.url, h.mime);
      } catch (e) {
        if (!alive()) return;
        say('');
        const code = String((e && (e.code || e.message)) || '');
        fail(/TGPLAY_NO_SW/.test(code) ? 'nosw' : /TG_NO_LOGIN|AUTH_KEY|SESSION_REVOKED/.test(code) ? 'login' : 'tg', {text: tgp.errorText ? tgp.errorText(e) : t('pl_fail')});
      }
    }

    // ---------- media events
    const rp = s.live ? null : resumeOf(s.key);
    let lastSave = 0, lastMs = 0, noted = false;
    on(v, 'loadedmetadata', () => {
      if (!alive()) return;
      say(''); draw();
      if (rp && !s.resumed && total() && rp.t < total() * DONE) {
        s.resumed = true;
        try { v.currentTime = rp.t; } catch (e) { /* not seekable */ }
        showCard({kind: 'resume', text: t('pl_resume', clock(rp.t)), ms: 8000, buttons: [{label: t('pl_continue'), pri: true}, {label: t('pl_start'), act: () => { seekTo(0, true); }}]});
      }
      initSubs();
    });
    on(v, 'durationchange', draw); on(v, 'progress', draw);
    on(v, 'timeupdate', () => {
      if (!alive()) return;
      if (!s.dragging && s.seekTo == null) draw();
      const now = Date.now(), d = total();
      if (d && !s.live && now - lastSave > 5000 && s.started) { lastSave = now; saveResume(s.key, v.currentTime, d); }
      if (now - lastMs > 4000) { lastMs = now; mediaPos(); }
      softCheck();
      if (d && s.nextReq && !s.nextOff && !s.nextShown && d - v.currentTime <= 30 && d > 120 && card.hidden) {
        s.nextShown = true;
        showCard({kind: 'next', text: t('pl_next'), ms: 12000, buttons: [{label: t('pl_next_now'), pri: true, act: goNext}, {label: t('pl_cancel'), act: () => { s.nextOff = true; }}]});
      }
    });
    on(v, 'playing', () => {
      if (!alive()) return;
      spin.hidden = true; big.hidden = true; bigTxt.hidden = true; s.started = true;
      drawPlay(); poke(); wake(true); mediaMeta();
      if (!noted) { noted = true; noteHistory(); }
    });
    on(v, 'play', drawPlay);
    on(v, 'pause', () => { if (!alive()) return; drawPlay(); poke(); wake(false); if (total() && !s.live && s.started) saveResume(s.key, v.currentTime, total()); });
    on(v, 'waiting', () => { if (alive() && !s.failed) spin.hidden = false; });
    on(v, 'seeking', () => { if (alive() && !s.failed) spin.hidden = false; });
    on(v, 'seeked', () => { if (alive() && !v.paused && v.readyState >= 3) spin.hidden = true; });
    on(v, 'canplay', () => { if (alive()) spin.hidden = true; });
    on(v, 'error', () => { if (alive() && !s.hls && v.error) fail('media', {code: v.error.code}); });
    on(v, 'ended', () => {
      if (!alive()) return;
      drawPlay(); wake(false);
      if (total()) saveResume(s.key, total(), total());
      const autoNext = TN.settings.get('player_autonext', true) !== false;
      if (s.nextReq && !s.nextOff && autoNext) {
        let n = 10;
        const text = () => t('pl_next_in', n);
        showCard({kind: 'count', text: text(), buttons: [{label: t('pl_next_now'), pri: true, act: goNext}, {label: t('pl_cancel'), act: () => { s.nextOff = true; endCard(); }}]});
        s.countT = setInterval(() => { if (!alive() || s.cardKind !== 'count') { clearInterval(s.countT); return; } n--; const p = card.querySelector('p'); if (p) p.textContent = text(); if (n <= 0) { clearInterval(s.countT); goNext(); } }, 1000);
      } else endCard();
    });
    function endCard() {
      showCard({kind: 'end', text: t('pl_ended'), buttons: [s.nextReq ? {label: t('pl_next'), pri: true, act: goNext} : null,
        {label: t('pl_replay'), pri: !s.nextReq, act: () => { seekTo(0, true); play(); }}, o.back ? {label: t('pl_other'), act: () => { const b = o.back; leave(() => b()); }} : null,
        {label: t('pl_close'), act: () => leave()}]});
    }
    // leaving the page or hiding the tab: the position is kept
    const keepPos = () => { if (alive() && total() && !s.live && s.started) saveResume(s.key, v.currentTime, total()); };
    on(G, 'pagehide', keepPos);
    on(doc, 'visibilitychange', () => { if (doc.visibilityState === 'hidden') keepPos(); else if (!v.paused) wake(true); });

    // ---------- history (written when the picture starts; what Kodi wrote for the same key is kept)
    function noteHistory() {
      const h = o.history;
      if (!h || !h.key) return;
      try {
        const old = ((TN.store && TN.store.history && TN.store.history()) || []).find((x) => x && x.key === h.key) || {};
        TN.noteHistory({key: h.key, label: h.label || old.label || o.title || '', play: h.play || old.play || '', plot: h.plot || old.plot || '',
          thumb: h.thumb || old.thumb || '', fanart: h.fanart || old.fanart || ''});
      } catch (e) { /* the list is not the player's problem */ }
    }

    // ---------- lock screen / headset / remote media keys, screen stays on
    function mediaMeta() {
      const ms = navigator.mediaSession;
      if (!ms || !G.MediaMetadata) return;
      try {
        ms.metadata = new G.MediaMetadata({title: o.title || '', artist: o.sub || '', album: 'BN Stream', artwork: poster ? [{src: poster}] : []});
        const set = (a, f) => { try { ms.setActionHandler(a, f); } catch (e) { /* this browser has no such action */ } };
        set('play', () => play()); set('pause', () => v.pause()); set('stop', () => leave());
        set('seekbackward', s.live ? null : () => nudge(-1)); set('seekforward', s.live ? null : () => nudge(1));
        set('seekto', s.live ? null : (d) => { if (d && d.seekTime >= 0) seekTo(d.seekTime, true); });
        set('nexttrack', s.nextReq ? () => goNext() : null);
        set('previoustrack', s.live ? null : () => seekTo(0, true));
      } catch (e) { /* no media session */ }
    }
    function mediaPos() {
      const ms = navigator.mediaSession;
      try { if (ms && ms.setPositionState && total() && !s.live) ms.setPositionState({duration: total(), playbackRate: v.playbackRate || 1, position: Math.min(total(), Math.max(0, v.currentTime))}); } catch (e) { /* bad state */ }
    }
    s.cleanup.push(() => {
      const ms = navigator.mediaSession;
      if (!ms) return;
      try { ms.metadata = null; ['play', 'pause', 'stop', 'seekbackward', 'seekforward', 'seekto', 'nexttrack', 'previoustrack'].forEach((a) => { try { ms.setActionHandler(a, null); } catch (e) { /* none */ } }); } catch (e) { /* none */ }
    });
    let lock = null;
    function wake(want) {
      try {
        if (want && !lock && navigator.wakeLock && doc.visibilityState === 'visible') navigator.wakeLock.request('screen').then((l) => { if (!alive() || v.paused) { l.release().catch(() => {}); return; } lock = l; l.addEventListener('release', () => { if (lock === l) lock = null; }); }, () => {});
        else if (!want && lock) { lock.release().catch(() => {}); lock = null; }
      } catch (e) { /* not supported */ }
    }
    s.cleanup.push(() => wake(false));

    // ---------- next episode
    if (o.next) Promise.resolve().then(o.next).then((n) => { if (alive() && n) { s.nextReq = n; nextB.hidden = false; mediaMeta(); } }).catch(() => {});
    async function goNext() {
      const n = s.nextReq;
      if (!n) return;
      const src = await TN.provider('sources').catch(() => null);
      leave(() => { if (src) src.open(n); });
    }

    // ---------- subtitles (through subs.js)
    let S = null;
    const subQuery = () => {
      const m = o.meta || {};
      return {type: m.type || (m.season != null ? 'tv' : 'movie'), imdb: m.imdb || '', tmdb: m.id || m.tmdb || '', title: m.title || o.title || '', year: m.year || '',
        season: m.season, episode: m.episode, release: m.release || o.release || '', url: linkKind(s.url) === 'http' ? s.url : '', position: v.currentTime || 0};
    };
    const hasId = () => { const m = o.meta || {}; return !!(m.imdb || m.id || m.tmdb); };
    async function subsSvc() { if (!S) S = await TN.provider('subs').catch(() => null); return S; }
    async function attachGiven(x) {
      const sv = await subsSvc();
      if (!sv) return;
      if (x.vtt == null) x.vtt = await x.fetchVtt();
      if (alive()) sv.attach(v, String(x.vtt), {label: x.label || 'sub', lang: x.lang || '', key: s.key, source: x.source || 'given'});
    }
    async function initSubs() {
      if (s.subsInit) return;
      s.subsInit = true;
      const sv = await subsSvc();
      if (!sv || !alive()) return;
      s.cleanup.push(() => { try { sv.detach(v); } catch (e) { /* gone */ } });
      if (!sv.autoOn || !sv.autoOn()) return;
      try {
        if (s.extra.length) { await attachGiven(s.extra[0]); s.lastPick = s.extra[0]; if (alive()) flash(t('pl_subs_on', s.extra[0].label || '')); return; }
        const emb = await sv.auto(v, subQuery(), {hls: s.hls, embeddedOnly: true});
        if (emb) { if (alive()) flash(t('pl_subs_on', emb.label)); return; }
        if (!hasId()) return;
        s.subsBusy = t('pl_subs_searching'); say(s.subsBusy);
        const errors = {};
        s.found = await sv.find(subQuery(), {errors});
        s.subsErr = Object.keys(errors).map((k) => errors[k]).filter(Boolean).join(' · ');
        if (!alive()) return;
        const got = await sv.auto(v, subQuery(), {hls: s.hls, key: s.key, list: s.found, alive, say: (x) => { if (alive()) { s.subsBusy = x; say(x); } }});
        if (!alive()) return;
        s.subsBusy = ''; say('');
        if (got) { s.lastPick = got; flash(t('pl_subs_on', got.label || '')); }
      } catch (e) { if (alive()) { s.subsBusy = ''; say(''); } }
      if (alive() && s.panelKind === 'subs') redraw();
    }
    function subsOn() { return !!(S && (S.current(v) || S.embedded(v, s.hls).some((x) => x.on))); }
    async function subsToggle() {
      const sv = await subsSvc();
      if (!sv || !alive()) return;
      if (subsOn()) { sv.off(v, s.hls); flash(t('pl_subs_off')); if (s.panelKind === 'subs') redraw(); return; }
      // on again: what was showing, else a track of the file, else the best one found, else the list
      if (s.lastPick) { pickSub(s.lastPick); return; }
      const emb = sv.embedded(v, s.hls), want = sv.prefLang ? sv.prefLang() : TN.lang();
      if (emb.length) { pickSub(emb.find((x) => x.lang === want) || emb[0]); return; }
      if (s.found && s.found.length) { pickSub(s.found[0]); return; }
      openPanel('subs');
    }
    async function pickSub(x) {
      const sv = await subsSvc();
      if (!sv || !alive()) return;
      s.subsBusy = t('pl_subs_loading'); say(s.subsBusy); if (s.panelKind === 'subs') redraw();
      try {
        if (x.embedded) x.select();
        else {
          const vtt = x.vtt != null ? x.vtt : await x.fetchVtt();
          if (!alive()) return;
          sv.attach(v, String(vtt), {label: x.label || 'sub', lang: x.lang || '', key: s.key, source: x.source || ''});
        }
        s.lastPick = x; s.subsBusy = ''; say(''); flash(t('pl_subs_on', x.label || ''));
      } catch (e) {
        if (!alive()) return;
        s.subsBusy = ''; say('');
        flash(t('pl_subs_failed', String((e && e.message) || '').replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '').slice(0, 80)));
      }
      if (alive() && s.panelKind === 'subs') redraw();
    }
    // 5.2: "AI translation now" - one press at any moment of any video. In order: an AI subtitle the search offers
    // (the owner's subtitle server, or Gemini over the best English subtitle); else the subtitle that is on now,
    // translated into the viewer's language; else one clear line that says what is missing.
    async function aiNow() {
      // the sound of the video may be read by aisubs.js: iOS lets a page start audio work only inside the tap itself
      try { if (!G.__tnAiCtx && (G.AudioContext || G.webkitAudioContext)) G.__tnAiCtx = new (G.AudioContext || G.webkitAudioContext)(); if (G.__tnAiCtx.state === 'suspended') G.__tnAiCtx.resume(); } catch (e) { /* no Web Audio */ }
      const sv = await subsSvc();
      if (!sv || !alive()) return;
      s.subsBusy = t('pl_ai_wait'); say(s.subsBusy); if (s.panelKind === 'subs') redraw();
      if (!s.found && hasId()) { const errors = {}; try { s.found = await sv.find(subQuery(), {errors}); } catch (e) { s.found = []; } }
      if (!alive()) return;
      let ai = (s.found || []).filter((x) => x.source === 'subsrv').concat((s.found || []).filter((x) => x.source === 'subs_ai'));
      // 5.2.2: the owner's AI server listens to the video itself - any video with a public address, catalogue title or
      // not, from the place the viewer is at
      if (!ai.some((x) => x.source === 'subsrv') && /^https:\/\//i.test(String(s.url || '')) && !/^blob:/.test(s.url)) {
        try {
          const srv = await TN.provider('subsrv');
          const more = srv && srv.find ? await srv.find(Object.assign({}, subQuery(), {url: s.url, title: o.title || '', position: v.currentTime || 0})) : [];
          ai = more.concat(ai);
        } catch (e) { /* the other ways below */ }
      }
      if (!alive()) return;
      if (ai.length) { await pickSub(ai[0]); return; }
      const cur = s.lastPick && !s.lastPick.embedded ? s.lastPick : (s.found || []).concat(s.extra || []).find((x) => !x.embedded && x.source !== 'subs_ai');
      const want = sv.prefLang ? sv.prefLang() : TN.lang();
      if (cur && sv.translate && cur.lang !== want) {
        try {
          const src = cur.vtt != null ? cur.vtt : await cur.fetchVtt();
          const vtt = await sv.translate(String(src), want, {onProgress: (pc) => { if (alive()) { s.subsBusy = t('pl_ai_wait') + ' ' + pc + '%'; say(s.subsBusy); } }});
          if (!alive()) return;
          sv.attach(v, String(vtt), {label: t('pl_ai_now'), lang: want, key: s.key, source: 'subs_ai'});
          s.subsBusy = ''; say(''); flash(t('pl_subs_on', t('pl_ai_now')));
          if (s.panelKind === 'subs') redraw();
          return;
        } catch (e) { /* the line below says what is missing */ }
      }
      if (!alive()) return;
      // 6.1: AI from the SOUND of the video (aisubs.js): Gemini hears and translates - live TV included, no PC
      if (!s.aiAudio) {
        try {
          if (!G.TNAISubs) await TN.loadScript('aisubs.js');
          const run = await G.TNAISubs.start({video: v, hls: s.hls || null, url: s.url, live: !!s.live, compat: !!s.compat,
            lang: sv.prefLang ? sv.prefLang() : TN.lang(), title: o.title || ''},
            (kind, text) => { if (!alive()) return; if (kind === 'on' || kind === 'wait') { s.subsBusy = ''; say(''); } if (text && kind !== 'on') flash(text); });
          if (!alive()) { run.stop(); return; }
          s.aiAudio = run; s.cleanup.push(() => { if (s.aiAudio) { s.aiAudio.stop(); s.aiAudio = null; } });
          s.subsBusy = ''; say('');
          if (s.panelKind === 'subs') redraw();
          return;
        } catch (e) { if (e && (e.code === 'nokey' || e.code === 'cannot')) { s.subsBusy = ''; say(''); if (s.panelKind === 'subs') redraw(); return; } }
      }
      s.subsBusy = ''; say(''); flash(t('pl_ai_none'));
      if (s.panelKind === 'subs') redraw();
    }
    async function searchSubs() {
      const sv = await subsSvc();
      if (!sv || !alive()) return;
      s.subsBusy = t('pl_subs_searching'); if (s.panelKind === 'subs') redraw();
      const errors = {};
      try { s.found = await sv.find(subQuery(), {errors}); } catch (e) { s.found = []; }
      s.subsErr = Object.keys(errors).map((k) => errors[k]).filter(Boolean).join(' · ');
      s.subsBusy = '';
      if (alive() && s.panelKind === 'subs') redraw();
    }
    function nudgeSub(d) {
      if (!S || !S.current(v)) { flash(t('pl_subs_off')); return; }
      const o2 = S.setOffset(v, d === 0 ? 0 : S.offset(v) + d);
      flash(t('pl_offset') + ' ' + t('pl_offset_val', (o2 > 0 ? '+' : '') + o2.toFixed(1)));
      if (s.panelKind === 'subs') redraw();
    }

    // ---------- the side panel (subtitles, audio, playback settings)
    const prow = (label, checked, act, cls) => {
      const b = el('button', 'pl-prow' + (cls ? ' ' + cls : ''));
      b.type = 'button';
      const sp = el('span', '', label); sp.dir = 'auto'; b.append(sp);
      if (checked != null) { b.setAttribute('role', cls === 'pl-sw' ? 'switch' : 'radio'); b.setAttribute('aria-checked', checked ? 'true' : 'false'); }
      b.addEventListener('click', (e) => { e.stopPropagation(); act(b); });
      return b;
    };
    const chip = (label, checked, act, aria) => {
      const b = el('button', 'pl-chip', label);
      b.type = 'button';
      if (checked != null) b.setAttribute('aria-checked', checked ? 'true' : 'false');
      if (aria) b.setAttribute('aria-label', aria);
      b.addEventListener('click', (e) => { e.stopPropagation(); act(b); });
      return b;
    };
    const heading = (x) => el('h4', '', x);
    const PANELS = {
      subs: {title: () => t('pl_subs'), draw(body) {
        if (!S) { body.append(el('p', 'pl-pmsg', t('pl_loading'))); subsSvc().then(() => { if (alive() && s.panelKind === 'subs') redraw(); }); return; }
        const curS = S.current(v), emb = S.embedded(v, s.hls);
        const anyOn = !!curS || emb.some((x) => x.on);
        body.append(prow(t('pl_subs_off'), !anyOn, () => { S.off(v, s.hls); redraw(); }));
        if (s.subsBusy) body.append(el('p', 'pl-pmsg', s.subsBusy));
        const item = (x, onNow) => {
          const b = prow(x.label || '?', onNow, () => pickSub(x));
          if (x.lang) { const tg = el('span', 'pl-tag', x.lang); b.append(tg); }
          return b;
        };
        if (emb.length) { body.append(heading(t('pl_subs_inside'))); emb.forEach((x) => body.append(item(x, x.on))); }
        else if ((o.meta && o.meta.embeddedHe) || (s.sniff && s.sniff.subs && s.sniff.he)) body.append(el('p', 'pl-pmsg', t('pl_subs_inside_no')));
        if (s.extra.length) { body.append(heading(t('pl_subs_given'))); s.extra.forEach((x) => body.append(item(x, !!curS && curS.label === (x.label || 'sub')))); }
        if (s.found && s.found.length) { body.append(heading(t('pl_subs_online'))); s.found.slice(0, 40).forEach((x) => body.append(item(x, !!curS && curS.label === x.label))); }
        else if (s.found && !s.subsBusy) body.append(el('p', 'pl-pmsg', t('pl_subs_none') + (s.subsErr ? ' · ' + s.subsErr : '')));
        else if (!s.found && !s.subsBusy && !hasId()) body.append(el('p', 'pl-pmsg', t('pl_subs_need_id')));
        if (s.found && s.found.length && s.subsErr) body.append(el('p', 'pl-pmsg', s.subsErr));
        body.append(prow(t('pl_subs_find'), null, () => searchSubs(), 'pl-act'));
        body.append(prow('✦ ' + t('pl_ai_now'), null, () => aiNow(), 'pl-act'));
        const fileIn = el('input'); fileIn.type = 'file'; fileIn.accept = '.srt,.vtt,.ass,.ssa,.sub,.txt,.zip'; fileIn.hidden = true;
        fileIn.addEventListener('change', async () => {
          const f = fileIn.files && fileIn.files[0];
          if (!f) return;
          try { const x = await S.fromFile(f); s.extra.push(x); pickSub(x); } catch (e) { flash(t('pl_subs_failed', String((e && e.message) || '').slice(0, 60))); }
        });
        body.append(fileIn, prow(t('pl_subs_file'), null, () => fileIn.click(), 'pl-act'));
        if (curS) {
          const line = el('div', 'pl-line pl-prowset');
          line.append(el('b', '', t('pl_offset')));
          const off = S.offset(v);
          line.append(chip('−0.5', null, () => nudgeSub(-0.5), t('pl_earlier') + ' 0.5'), chip('−0.1', null, () => nudgeSub(-0.1), t('pl_earlier') + ' 0.1'));
          const val = el('span', 'pl-val', t('pl_offset_val', (off > 0 ? '+' : '') + off.toFixed(1)));
          line.append(val, chip('+0.1', null, () => nudgeSub(0.1), t('pl_later') + ' 0.1'), chip('+0.5', null, () => nudgeSub(0.5), t('pl_later') + ' 0.5'), chip(t('pl_reset'), null, () => nudgeSub(0)));
          body.append(line);
        }
        if (S.styleOptions) {
          body.append(heading(t('pl_look')));
          const so = S.styleOptions(), st = S.style();
          ['size', 'color', 'bg'].forEach((k) => {
            const line = el('div', 'pl-line pl-prowset');
            so[k].forEach((pair) => line.append(chip(pair[1], st[k] === pair[0], () => { const x = {}; x[k] = pair[0]; S.setStyle(x); redraw(); })));
            body.append(line);
          });
        }
        if (S.settingsPanel) body.append(prow(t('pl_subs_settings'), null, () => openPanel('subset'), 'pl-act'));
        if (!s.found && !s.subsBusy && hasId() && !s.searchedOnce) { s.searchedOnce = true; searchSubs(); }
      }},
      subset: {title: () => t('pl_subs'), draw(body) {
        body.append(prow(t('pl_menu_back'), null, () => openPanel('subs'), 'pl-act'));
        const box = el('div');
        body.append(box);
        if (S && S.settingsPanel) S.settingsPanel(box, {compact: true});
      }},
      audio: {title: () => t('pl_audio'), draw(body) {
        const list = audioTracks();
        if (list.length > 1) list.forEach((a) => body.append(prow(a.label, a.on, () => { a.pick(); flash(a.label); setTimeout(() => { if (alive() && s.panelKind === 'audio') redraw(); }, 150); })));
        else {
          const sn = s.sniff, many = !!(sn && sn.audio && sn.audio.length > 1);
          body.append(el('p', 'pl-pmsg', list.length === 1 && !many ? t('pl_audio_one') : t('pl_audio_none')));
          addElsewhere(body);
        }
      }},
      gear: {title: () => t('pl_settings'), draw(body) {
        body.append(heading(t('pl_speed')));
        const line = el('div', 'pl-line pl-prowset');
        SPEEDS.forEach((r) => line.append(chip(r === 1 ? t('pl_normal') : r + '×', v.playbackRate === r, () => { setRate(r); redraw(); })));
        body.append(line);
        if (s.hls && s.hls.levels && s.hls.levels.length > 1) {
          body.append(heading(t('pl_quality')));
          body.append(prow(t('pl_auto'), s.hls.autoLevelEnabled, () => { s.hls.currentLevel = -1; redraw(); }));
          s.hls.levels.map((l, i) => ({l, i})).sort((a, b) => (b.l.height || 0) - (a.l.height || 0)).forEach((x) =>
            body.append(prow(x.l.height ? x.l.height + 'p' : Math.round((x.l.bitrate || 0) / 1000) + ' kbit', !s.hls.autoLevelEnabled && s.hls.currentLevel === x.i, () => { s.hls.currentLevel = x.i; setTimeout(() => { if (alive() && s.panelKind === 'gear') redraw(); }, 100); })));
        }
        body.append(heading(t('pl_fit')));
        const cover = root.classList.contains('pl-cover');
        body.append(prow(t('pl_fit_contain'), !cover, () => { root.classList.remove('pl-cover'); redraw(); }), prow(t('pl_fit_cover'), cover, () => { root.classList.add('pl-cover'); redraw(); }));
        if (o.next) {
          const an = TN.settings.get('player_autonext', true) !== false;
          body.append(prow(t('pl_autonext'), an, () => { TN.settings.set('player_autonext', !an); redraw(); }, 'pl-sw'));
        }
        if (linkKind(s.url) === 'http' || s.tgp) { body.append(heading(t('pl_elsewhere'))); addElsewhere(body); }
        if (v.videoWidth) body.append(el('p', 'pl-pmsg', v.videoWidth + ' × ' + v.videoHeight));
        if (!tv && !isPhone()) body.append(el('p', 'pl-pmsg', t('pl_keys')));
      }},
    };
    function addElsewhere(body) {
      elsewhereButtons().concat(tgButtons('soft')).forEach((b) => {
        const r = el(b.href ? 'a' : 'button', 'pl-prow pl-act');
        if (b.href) { r.href = b.href; if (b.download) r.download = b.download; else { r.target = '_blank'; r.rel = 'noopener noreferrer'; } } else r.type = 'button';
        r.append(el('span', '', b.label));
        r.addEventListener('click', (e) => { e.stopPropagation(); if (!b.href) e.preventDefault(); if (b.act) { closePanel(); b.act(r); } });
        body.append(r);
      });
    }
    function audioTracks() {
      if (s.compat) return s.compat.audios().map((a, i) => ({label: a.title || a.lang || t('pl_track', i + 1), on: a.on, pick: () => { s.compat.selectAudio(a.id); }}));
      if (s.hls && s.hls.audioTracks && s.hls.audioTracks.length) {
        return s.hls.audioTracks.map((a, i) => ({label: a.name || a.lang || t('pl_track', i + 1), on: s.hls.audioTrack === i, pick: () => { s.hls.audioTrack = i; }}));
      }
      const at = v.audioTracks;
      if (at && at.length) {
        const out = [];
        for (let i = 0; i < at.length; i++) out.push({label: at[i].label || at[i].language || t('pl_track', i + 1), on: !!at[i].enabled, pick: () => { for (let j = 0; j < at.length; j++) at[j].enabled = j === i; }});
        return out;
      }
      return [];
    }
    function setRate(r) { try { v.playbackRate = r; } catch (e) { /* refused */ } flash(t('pl_speed') + ' ' + r + '×'); }
    function redraw() {
      const P = PANELS[s.panelKind];
      if (!P || panel.hidden) return;
      const body = panel.querySelector('.pl-pbody');
      const foc = body && body.contains(doc.activeElement) ? focusables(body).indexOf(doc.activeElement) : -1;
      const sc = body ? body.scrollTop : 0;
      body.innerHTML = '';
      P.draw(body);
      body.scrollTop = sc;
      if (foc >= 0) { const list = focusables(body); const f = list[Math.min(foc, list.length - 1)]; if (f) f.focus({preventScroll: true}); }
    }
    function openPanel(kind) {
      const P = PANELS[kind];
      if (!P) return;
      hideCard();
      s.panelKind = kind;
      panel.innerHTML = '';
      const head = el('div', 'pl-phead'), h = el('h3', '', P.title());
      const x = btn('pl-pclose', 'back', t('pl_close'), () => closePanel());
      head.append(x, h);
      const body = el('div', 'pl-pbody');
      panel.append(head, body);
      panel.setAttribute('aria-label', P.title());
      panel.hidden = false;
      P.draw(body);
      const f = body.querySelector('[aria-checked="true"]') || focusables(body)[0] || x;
      if (f) f.focus({preventScroll: true});
      poke();
    }
    function closePanel() {
      if (panel.hidden) return;
      const kind = s.panelKind;
      panel.hidden = true; panel.innerHTML = ''; s.panelKind = '';
      const back = {subs: subsB, subset: subsB, audio: audioB, gear: gearB}[kind];
      if (back && !hidden()) back.focus({preventScroll: true}); else root.focus({preventScroll: true});
      poke();
    }
    function togglePanel(kind) { if (!panel.hidden && (s.panelKind === kind || (kind === 'subs' && s.panelKind === 'subset'))) closePanel(); else openPanel(kind); }
    s.panelOpen = () => !panel.hidden; s.closePanel = closePanel;
    panel.addEventListener('click', (e) => e.stopPropagation());

    // ---------- keys and focus
    const visible = (e) => !!(e.offsetWidth || e.offsetHeight) && !e.disabled;
    const focusables = (scope) => Array.prototype.filter.call(scope.querySelectorAll('button,a[href],input:not([type=hidden]):not([hidden]),select,[tabindex="0"]'), visible);
    function moveIn(list, d) { const i = list.indexOf(doc.activeElement); const n = list[Math.max(0, Math.min(list.length - 1, (i < 0 ? 0 : i + d)))]; if (n) { n.focus({preventScroll: true}); if (n.scrollIntoView) n.scrollIntoView({block: 'nearest'}); } }
    // the panel: Up / Down by rows, Left / Right inside a row of chips
    function panelMove(dir) {
      const a = doc.activeElement, all = focusables(panel);
      if (!all.length) return;
      if (!panel.contains(a)) { all[0].focus(); return; }
      const rowOf = (e) => e.closest('.pl-prowset,.subs-set-line,.pl-phead') || e;
      if (dir === 'Left' || dir === 'Right') {
        if (a.tagName === 'INPUT' || a.tagName === 'SELECT') return false;
        const mates = all.filter((e) => rowOf(e) === rowOf(a));
        if (mates.length < 2) return;
        const rtlRow = getComputedStyle(rowOf(a)).direction === 'rtl';
        moveIn(mates, (dir === 'Right') !== rtlRow ? 1 : -1);
        return;
      }
      if (a.tagName === 'SELECT') return false;
      const rows = [];
      all.forEach((e) => { const r = rowOf(e); if (!rows.length || rows[rows.length - 1].r !== r) rows.push({r, first: e}); });
      const i = rows.findIndex((x) => x.r === rowOf(a));
      const n = rows[Math.max(0, Math.min(rows.length - 1, i + (dir === 'Down' ? 1 : -1)))];
      if (n) { n.first.focus({preventScroll: true}); n.first.scrollIntoView({block: 'nearest'}); }
    }
    // the controls: top bar / seek bar / button row
    function chromeMove(dir) {
      const a = doc.activeElement;
      if (!card.hidden) { const list = focusables(card); moveIn(list, dir === 'Right' || dir === 'Down' ? 1 : -1); return; }
      const levels = [focusables(top), seekRow.hidden ? [] : [seek], focusables(row)].filter((l) => l.length);
      let li = levels.findIndex((l) => l.includes(a));
      if (li < 0) { (levels[levels.length - 1][0] || root).focus({preventScroll: true}); return; }
      if (dir === 'Left' || dir === 'Right') { moveIn(levels[li], dir === 'Right' ? 1 : -1); return; }
      li = Math.max(0, Math.min(levels.length - 1, li + (dir === 'Down' ? 1 : -1)));
      const l = levels[li];
      if (!l.includes(a)) (l === levels[levels.length - 1] && l.includes(playB) ? playB : l[0]).focus({preventScroll: true});
    }
    function onKey(e) {
      if (!alive()) return;
      const a = doc.activeElement, tag = a && a.tagName;
      const typing = !!a && root.contains(a) && ((tag === 'INPUT' && !/^(checkbox|radio|range|file|button|submit)$/.test(a.type)) || tag === 'TEXTAREA');
      if (a && !root.contains(a) && a !== doc.body && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')) return;   // some other field of the page
      const inPanel = !panel.hidden;
      const ctl = !!a && a !== root && (top.contains(a) || row.contains(a) || a === big);
      const act = keyAction(e, {tv, typing, panel: inPanel, ctl, seek: a === seek, card: !card.hidden && card.contains(a)});
      // any key ends the next-episode countdown (Enter on its button still plays)
      if (s.cardKind === 'count' && !(e.key === 'Enter' && card.contains(a)) && act !== 'back') { s.nextOff = true; clearInterval(s.countT); endCard(); e.preventDefault(); e.stopImmediatePropagation(); return; }
      const wasHidden = hidden();
      if (!act) {
        // keys the player leaves to the focused control still must not reach the page under the overlay
        if (e.key !== 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) e.stopImmediatePropagation(); else if (e.key === 'Tab') trapTab(e);
        if (e.key === 'Enter' || e.key === ' ') poke();
        return;
      }
      e.stopImmediatePropagation();
      if (act === 'back') {
        e.preventDefault();
        if (inPanel) { if (s.panelKind === 'subset') openPanel('subs'); else closePanel(); return; }
        if (s.cardKind && s.cardKind !== 'error' && s.cardKind !== 'end') { hideCard(); return; }
        if (tv && !wasHidden && !v.paused && !s.failed && s.cardKind !== 'end') { root.focus({preventScroll: true}); root.classList.add('pl-idle'); return; }
        leave();
        return;
      }
      if (/^panel/.test(act)) { if (panelMove(act.slice(5)) !== false) e.preventDefault(); return; }
      e.preventDefault();
      if (/^focus/.test(act)) { if (wasHidden) { poke(); return; } chromeMove(act.slice(5)); poke(); return; }
      switch (act) {
        case 'toggle': if (!big.hidden) big.click(); else toggle(); break;
        case 'play': play(); break;
        case 'pause': v.pause(); break;
        case 'stop': leave(); return;
        case 'rew': nudge(-1); break;
        case 'fwd': nudge(1); break;
        case 'next': if (s.nextReq) goNext(); break;
        case 'prev': seekTo(0, true); break;
        case 'volUp': setVol(v.volume + 0.05); break;
        case 'volDown': setVol(v.volume - 0.05); break;
        case 'mute': setMuted(!v.muted); break;
        case 'fullscreen': if (canFull) fullscreen(); break;
        case 'pip': if (canPip) pip(); break;
        case 'subsToggle': subsToggle(); break;
        case 'subsPanel': togglePanel('subs'); break;
        case 'audioPanel': togglePanel('audio'); break;
        case 'slower': setRate(stepSpeed(v.playbackRate, -1)); break;
        case 'faster': setRate(stepSpeed(v.playbackRate, 1)); break;
        case 'subEarlier': nudgeSub(-0.1); break;
        case 'subLater': nudgeSub(0.1); break;
        case 'jumpEnd': seekTo(total() - 5, true); break;
        case 'show': poke(); if (wasHidden || a === root || a === doc.body) (seekRow.hidden ? playB : seek).focus({preventScroll: true}); break;
        default: if (/^jump\d$/.test(act) && total()) seekTo(total() * Number(act.slice(4)) / 10, true);
      }
      poke();
    }
    function trapTab(e) {                               // Tab stays inside the overlay
      const scope = !panel.hidden ? panel : !card.hidden ? card : root;
      const list = focusables(scope).filter((x) => !hidden() || !(top.contains(x) || bottom.contains(x)));
      if (!list.length) { e.preventDefault(); return; }
      const i = list.indexOf(doc.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); list[list.length - 1].focus(); } else if (!e.shiftKey && (i < 0 || i === list.length - 1)) { e.preventDefault(); list[0].focus(); }
      poke();
    }
    on(G, 'keydown', onKey, true);
    // the keyup / keypress of the same keys must not reach the page's own handlers either
    const eat = (e) => { if (alive()) e.stopImmediatePropagation(); };
    on(G, 'keyup', eat, true); on(G, 'keypress', eat, true);
    // focus never falls through to the page under the overlay
    on(doc, 'focusin', (e) => { if (alive() && e.target && e.target !== doc.body && !root.contains(e.target)) root.focus({preventScroll: true}); });

    // ---------- go
    say(t('pl_loading'));
    poke();
    if (o.tg) openTg();
    else if (o.url) start(o.url, o.mime || '');
    else fail('open');
    return {video: v, close: () => { if (session === s) end(false); }};
  }

  TN.registerProvider('player', Object.assign({kinds: ['service'], label: 'Player', open, close: () => end(false), resumeOf, saveResume, watched,
    playing: () => !!session}, pure, {vlcLink: (u) => vlcLink(u, UA), kodiLink: (u) => kodiLink(u, UA)}));
})(typeof self !== 'undefined' ? self : globalThis);
