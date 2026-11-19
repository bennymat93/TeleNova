'use strict';
// The result window of every backup / restore / transfer (owner, 2026-11-19): when one ends, a window says in one
// line what happened; "Details" opens a full, ordered account of it; after a failure it also lists the steps that
// fix it. Used by backup.js and gdrive.js:  await TN.loadScript('result.js'); TNResult({...}).
//   {ok, op, file, items: [..names], where, extra: [[label, value], ...], error: Error|string, code}
//   op: 'full_make' | 'full_restore' | 'zip_make' | 'zip_restore' | 'cfg_export' | 'cfg_import' | 'move_send' |
//       'move_take' | 'drive_backup'
// No token, password or address is ever shown: only names, counts and the short error code.
(function (root) {
  if (root.TNResult) return;
  const TX = {
    he: {
      ok: 'הפעולה הושלמה', bad: 'הפעולה נכשלה', details: 'פרטים מלאים', hide: 'הסתרת הפרטים', close: 'סגירה',
      what: 'מה בוצע', when: 'מתי', file: 'קובץ', where: 'איפה', items: 'מה נכלל', reason: 'מה קרה', code: 'קוד שגיאה', fix: 'איך מתקנים',
      op_full_make: 'גיבוי מלא (קובץ אחד מוגן בסיסמה)', op_full_restore: 'שחזור מגיבוי מלא', op_zip_make: 'גיבוי רשימות (zip)',
      op_zip_restore: 'שחזור רשימות מקובץ zip', op_cfg_export: 'ייצוא הגדרות', op_cfg_import: 'ייבוא הגדרות',
      op_move_send: 'העברת ההגדרות למכשיר אחר - הכנת קוד', op_move_take: 'קבלת ההגדרות ממכשיר אחר', op_drive_backup: 'גיבוי ל-Google Drive',
      s_full_make: 'הגיבוי נשמר בקובץ אחד. גיבוי חדש מחליף את הקודם.', s_full_restore: 'ההגדרות, המפתחות והחשבונות שוחזרו.',
      s_zip_make: 'קובץ הגיבוי נשמר.', s_zip_restore: 'הרשימות שוחזרו.', s_cfg_export: 'קובץ ההגדרות נשמר.', s_cfg_import: 'ההגדרות יובאו.',
      s_move_send: 'הקוד מוכן. סרקו אותו במכשיר השני והקלידו שם את 6 הספרות.', s_move_take: 'ההגדרות הועברו למכשיר הזה.',
      s_drive_backup: 'הגיבוי עלה ל-Google Drive.',
      where_down: 'בתיקיית ההורדות של המכשיר (באפליקציית האייפון: קבצים > BN Stream > Backups)', none: 'לא נמצאו פריטים',
      f_wrong_password: ['הקלידו בדיוק את הסיסמה שבחרתם כשיצרתם את הגיבוי (אותיות גדולות/קטנות, שפת המקלדת).',
        'נסו שוב. אין הגבלה על מספר הניסיונות.', 'אם הסיסמה נשכחה - אי אפשר לפתוח את הקובץ. צרו גיבוי חדש במכשיר שבו ההגדרות קיימות.'],
      f_password_required: ['הקלידו את סיסמת הגיבוי בשדה הסיסמה, ורק אחר כך בחרו את הקובץ.'],
      f_not_a_config_file: ['בחרו את הקובץ BN_Stream_backup.tncfg (לא קובץ אחר).', 'אם הקובץ הועבר דרך הודעה או מייל - ייתכן שנחתך. העבירו אותו שוב, עדיף דרך קבצים / Drive.',
        'אם הגיבוי נוצר בגרסה חדשה יותר - עדכנו את האתר: עוד > אודות > עדכון.'],
      f_pass_short: ['בחרו סיסמה ארוכה יותר (לפחות 6 תווים) והקלידו אותה פעמיים.'],
      f_no_webcrypto: ['פתחו את BN Stream בדפדפן מעודכן או באפליקציה, בכתובת https (לא מקובץ מקומי).'],
      f_drop_gone: ['הקוד פג תוקף או כבר נוצל. במכשיר השני: גיבוי ושחזור > העברה למכשיר אחר > הצגת קוד חדש.', 'סרקו את הקוד החדש תוך 10 דקות.'],
      f_big: ['הקובץ גדול מדי. ודאו שבחרתם את קובץ הגיבוי של BN Stream ולא קובץ אחר.'],
      f_need_tg: ['חברו קודם את טלגרם: חשבונות ושירותים > טלגרם > חיבור.'],
      f_drive: ['ודאו שאתם מחוברים ל-Google Drive (מסך Google Drive > כניסה).', 'אם מופיע redirect_uri_mismatch - הוסיפו ב-Google Cloud Console את שתי הכתובות שמוצגות במסך Google Drive.',
        'נסו שוב. אם הכניסה פגה (שעה) - התחברו מחדש.'],
      f_net: ['בדקו שיש חיבור לאינטרנט.', 'רעננו את הדף (משיכה למטה באפליקציה) ונסו שוב.',
        'אם זה חוזר: עוד > מצב המערכת - צלמו את המסך ושלחו אותו.']
    },
    en: {
      ok: 'Done', bad: 'It did not work', details: 'Full details', hide: 'Hide details', close: 'Close',
      what: 'What was done', when: 'When', file: 'File', where: 'Where', items: 'Included', reason: 'What happened', code: 'Error code', fix: 'How to fix it',
      op_full_make: 'Full backup (one password-protected file)', op_full_restore: 'Restore from a full backup', op_zip_make: 'Lists backup (zip)',
      op_zip_restore: 'Restore lists from a zip file', op_cfg_export: 'Export settings', op_cfg_import: 'Import settings',
      op_move_send: 'Move the setup to another device - code', op_move_take: 'Receive the setup from another device', op_drive_backup: 'Backup to Google Drive',
      s_full_make: 'The backup was saved as one file. A new backup replaces the old one.', s_full_restore: 'Settings, keys and accounts were restored.',
      s_zip_make: 'The backup file was saved.', s_zip_restore: 'The lists were restored.', s_cfg_export: 'The settings file was saved.', s_cfg_import: 'The settings were imported.',
      s_move_send: 'The code is ready. Scan it on the other device and type the 6 digits there.', s_move_take: 'The setup was moved to this device.',
      s_drive_backup: 'The backup is on Google Drive.',
      where_down: "In the device's downloads (in the iPhone app: Files > BN Stream > Backups)", none: 'Nothing found',
      f_wrong_password: ['Type exactly the password chosen when the backup was made (capital letters, keyboard language).',
        'Try again - there is no limit on tries.', 'If the password is forgotten the file cannot be opened: make a new backup on the device that has the settings.'],
      f_password_required: ['Type the backup password in the password field first, then choose the file.'],
      f_not_a_config_file: ['Choose the file BN_Stream_backup.tncfg (not another file).', 'A file sent by message or mail may arrive cut - send it again, better by Files / Drive.',
        'If the backup was made by a newer version, update the site: More > About > Update.'],
      f_pass_short: ['Choose a longer password (6 characters or more) and type it twice.'],
      f_no_webcrypto: ['Open BN Stream in an up-to-date browser or in the app, on https (not from a local file).'],
      f_drop_gone: ['The code expired or was already used. On the other device: Backup > Move to another device > show a new code.', 'Scan the new code within 10 minutes.'],
      f_big: ['The file is too big. Check that you chose the BN Stream backup file and not another file.'],
      f_need_tg: ['Connect Telegram first: Accounts & services > Telegram > Connect.'],
      f_drive: ['Check that you are signed in to Google Drive (Google Drive page > sign in).', 'On redirect_uri_mismatch: add the two addresses shown on the Google Drive page in the Google Cloud Console.',
        'Try again; a sign-in lasts one hour - sign in again if it expired.'],
      f_net: ['Check the internet connection.', 'Reload the page (pull down in the app) and try again.', 'If it keeps happening: More > Status - take a screenshot and send it.']
    },
    ru: {
      ok: 'Готово', bad: 'Не получилось', details: 'Подробно', hide: 'Скрыть', close: 'Закрыть',
      what: 'Что сделано', when: 'Когда', file: 'Файл', where: 'Где', items: 'Что вошло', reason: 'Что случилось', code: 'Код ошибки', fix: 'Как исправить',
      op_full_make: 'Полная копия (один файл с паролем)', op_full_restore: 'Восстановление из полной копии', op_zip_make: 'Копия списков (zip)',
      op_zip_restore: 'Восстановление списков из zip', op_cfg_export: 'Экспорт настроек', op_cfg_import: 'Импорт настроек',
      op_move_send: 'Перенос на другое устройство - код', op_move_take: 'Приём настроек с другого устройства', op_drive_backup: 'Копия в Google Drive',
      s_full_make: 'Копия сохранена одним файлом. Новая копия заменяет старую.', s_full_restore: 'Настройки, ключи и аккаунты восстановлены.',
      s_zip_make: 'Файл копии сохранён.', s_zip_restore: 'Списки восстановлены.', s_cfg_export: 'Файл настроек сохранён.', s_cfg_import: 'Настройки импортированы.',
      s_move_send: 'Код готов. Отсканируйте его на другом устройстве и введите там 6 цифр.', s_move_take: 'Настройки перенесены на это устройство.',
      s_drive_backup: 'Копия загружена в Google Drive.',
      where_down: 'В загрузках устройства (в приложении iPhone: Файлы > BN Stream > Backups)', none: 'Ничего',
      f_wrong_password: ['Введите точно тот пароль, что был выбран при создании копии (регистр, язык клавиатуры).', 'Попробуйте ещё раз - число попыток не ограничено.',
        'Если пароль забыт, файл не открыть: сделайте новую копию на устройстве с настройками.'],
      f_password_required: ['Сначала введите пароль копии, затем выберите файл.'],
      f_not_a_config_file: ['Выберите файл BN_Stream_backup.tncfg.', 'Файл из сообщения или почты мог прийти обрезанным - отправьте его снова через Файлы / Drive.',
        'Если копия сделана новой версией - обновите сайт: Ещё > О программе > Обновить.'],
      f_pass_short: ['Выберите пароль длиннее (от 6 символов) и введите его дважды.'],
      f_no_webcrypto: ['Откройте BN Stream в обновлённом браузере или в приложении, по https.'],
      f_drop_gone: ['Код истёк или уже использован. На другом устройстве покажите новый код.', 'Отсканируйте новый код в течение 10 минут.'],
      f_big: ['Файл слишком большой. Проверьте, что выбран файл копии BN Stream.'],
      f_need_tg: ['Сначала подключите Telegram: Аккаунты и сервисы > Telegram.'],
      f_drive: ['Проверьте вход в Google Drive.', 'При redirect_uri_mismatch добавьте в Google Cloud Console два адреса со страницы Google Drive.', 'Попробуйте снова; вход действует час.'],
      f_net: ['Проверьте интернет.', 'Обновите страницу и попробуйте снова.', 'Если повторяется: Ещё > Состояние - сделайте снимок экрана и отправьте его.']
    }
  };
  const tx = () => TX[(root.TN && TN.lang && TN.lang()) || 'he'] || TX.en;
  const fixFor = (code, op) => {
    const T = tx();
    if (code === 'wrong_password') return T.f_wrong_password;
    if (code === 'password_required') return T.f_password_required;
    if (code === 'not_a_config_file' || code === 'unsupported_version' || code === 'damaged' || code === 'bad_file') return T.f_not_a_config_file;
    if (code === 'pass_short') return T.f_pass_short;
    if (code === 'no_webcrypto') return T.f_no_webcrypto;
    if (code === 'drop_gone') return T.f_drop_gone;
    if (code === 'big') return T.f_big;
    if (code === 'need_tg') return T.f_need_tg;
    if (op === 'drive_backup') return T.f_drive;
    return T.f_net;
  };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  // a short, safe reason: our own message or the error's code - never an address (it may carry a token)
  const reasonOf = (e) => String((e && (e.message || e.code)) || e || '').replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim().slice(0, 160);

  function TNResult(o) {
    o = o || {};
    const T = tx(), ok = !!o.ok;
    const code = o.code || (o.error && o.error.code) || '';
    const box = el('div', 'tnres');
    box.setAttribute('dir', 'auto');
    const head = el('div', 'tnres-head');
    head.append(el('span', 'tnres-mark ' + (ok ? 'ok' : 'bad'), ok ? '✓' : '!'), el('h2', '', ok ? T.ok : T.bad));
    const short = o.short || (ok ? T['s_' + o.op] : reasonOf(o.error)) || '';
    box.append(head, el('p', 'tnres-short', short));
    if (!ok) {
      const steps = fixFor(code, o.op);
      if (steps && steps.length) { box.append(el('p', 'tnres-fix1', T.fix + ': ' + steps[0])); }
    }
    const more = el('div', 'tnres-more');
    more.hidden = true;
    const dl = el('dl', 'facts');
    const row = (k, v) => { if (v == null || v === '') return; dl.append(el('dt', '', k), el('dd', '', String(v))); };
    row(T.what, T['op_' + o.op] || o.op || '');
    row(T.when, new Date().toLocaleString());
    row(T.file, o.file);
    row(T.where, o.where === 'down' ? T.where_down : o.where);
    if (o.items) row(T.items, o.items.length ? o.items.join(', ') : T.none);
    for (const [k, v] of (o.extra || [])) row(k, v);
    if (!ok) { row(T.reason, reasonOf(o.error)); row(T.code, code); }
    more.append(dl);
    if (!ok) {
      const steps = fixFor(code, o.op);
      more.append(el('h3', '', T.fix));
      const ol = el('ol', 'tnres-steps');
      for (const s of steps) ol.append(el('li', '', s));
      more.append(ol);
    }
    const acts = el('div', 'tnres-acts');
    const det = TN.button('btn ghost', T.details, () => { more.hidden = !more.hidden; det.textContent = more.hidden ? T.details : T.hide; });
    acts.append(det, TN.button('btn', T.close, () => TN.closeModal()));
    box.append(acts, more);
    if (!document.getElementById('tnres-css')) {
      const st = el('style');
      st.id = 'tnres-css';
      st.textContent = '.tnres{padding:4px 2px}.tnres-head{display:flex;align-items:center;gap:10px}.tnres-head h2{margin:0;font-size:var(--fs-4)}' +
        '.tnres-mark{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;font-weight:800;flex:none}' +
        '.tnres-mark.ok{background:var(--ok);color:#06200f}.tnres-mark.bad{background:var(--danger);color:#2a0705}' +
        '.tnres-short{margin:12px 0 4px;font-size:var(--fs-3)}.tnres-fix1{margin:4px 0;color:var(--text2)}' +
        '.tnres-acts{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 4px}.tnres-more h3{margin:14px 0 6px;font-size:var(--fs-3)}' +
        '.tnres-steps{margin:0;padding-inline-start:22px}.tnres-steps li{margin:4px 0}.tnres .facts{margin-top:12px}';
      document.head.append(st);
    }
    TN.modal(box, {size: 's'});
  }
  root.TNResult = TNResult;
})(self);
