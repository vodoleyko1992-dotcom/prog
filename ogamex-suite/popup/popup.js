/* ogamex-suite/popup/popup.js — popup and options page of «OgameX Suite». Owner: integration.
 * Top card «Эта вкладка» (popup only): asks the active tab's content script {type:'ogx:suite:status'} (suite/00-suite.js)
 *       and says whether it was detected as a GALAXYZ / OgameX game page, and why not. ?tabId=<id> picks another tab (tests).
 * Tabs: «Модули» (Live / Infinity / Бот: global on/off per module, '*|*|suite.modules'),
 *       «Серверы» (optional host allow-list, '*|*|suite.hosts'; empty = every OgameX server, detected automatically),
 *       «Логи» (shared «Логи для разбора» panel, shared/popup/diag-panel.js, reads the background IndexedDB).
 * Needs suite/00-suite.js (OGX.suite: sections, titles) loaded first. Changes apply on the next game page load. */
(function () {
  'use strict';
  const S = window.OGX && window.OGX.suite;
  const area = (typeof browser !== 'undefined' && browser.storage && browser.storage.local) ? browser.storage.local
    : (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) ? chrome.storage.local : null;
  const rt = (typeof browser !== 'undefined' && browser.runtime) ? browser.runtime : (typeof chrome !== 'undefined' ? chrome.runtime : null);
  const KEY_MODS = '*|*|' + (S ? S.GLOBAL_KEYS.modules : 'suite.modules');
  const KEY_HOSTS = '*|*|' + (S ? S.GLOBAL_KEYS.hosts : 'suite.hosts');
  const TAB_KEY = 'ogx-suite-popup-tab';

  function get(keys) {
    return new Promise((resolve) => {
      if (!area) { resolve({}); return; }
      try {
        const r = area.get(keys, (v) => resolve(v || {}));
        if (r && typeof r.then === 'function') r.then((v) => resolve(v || {}), () => resolve({}));
      } catch (e) { resolve({}); }
    });
  }
  function set(obj) {
    return new Promise((resolve) => {
      if (!area) { resolve(); return; }
      try {
        const r = area.set(obj, () => resolve());
        if (r && typeof r.then === 'function') r.then(() => resolve(), () => resolve());
      } catch (e) { resolve(); }
    });
  }
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'checked' || k === 'disabled' || k === 'hidden') e[k] = !!v;
      else e.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    if (tag === 'button' && !attrs.type) e.type = 'button';
    return e;
  }
  function manifest() { try { return rt.getManifest(); } catch (e) { return {}; } }

  const app = document.getElementById('ogx-suite-app');
  if (!app) return;
  if (!S) { app.textContent = 'Ошибка: suite/00-suite.js не загружен.'; return; }

  const state = { mods: {}, hosts: [], known: [] };
  const status = el('div', { class: 'sx-status', role: 'status' });
  let statusTimer = null;
  function say(text) {
    status.textContent = text;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { status.textContent = ''; }, 4000);
  }

  // ------------------------------------------------------------------ «Эта вкладка»
  const tabsApi = (typeof browser !== 'undefined' && browser.tabs) ? browser.tabs : (typeof chrome !== 'undefined' ? chrome.tabs : null);
  const tabCard = el('section', { class: 'sx-tabstatus', 'data-ogx-tabstatus': 'wait' },
    el('div', { class: 'sx-ts-title' }, 'Эта вкладка'), el('div', { class: 'sx-ts-text' }, 'Проверяю…'));
  function call(fn, ...args) {
    return new Promise((resolve) => {
      try {
        const r = fn(...args, (v) => { const err = rt && rt.lastError; resolve(err ? undefined : v); });
        if (r && typeof r.then === 'function') r.then(resolve, () => resolve(undefined));
      } catch (e) { resolve(undefined); }
    });
  }
  /** Russian explanation of OGX.page.detect().reason (05-page.js); the raw reason is shown below it. */
  function whyNot(st) {
    const r = String(st.reason || '');
    if (/gameforge/i.test(r)) return 'Официальные серверы Gameforge не поддерживаются.';
    if (/path is not \/game\.php/.test(r)) return 'Адрес страницы не …/game.php: это сайт или страница входа, а не сама игра.';
    if (/no serverTime/.test(r)) return 'Нет часов сервера (serverTime): страница входа или ошибки.';
    if (/no #planetSelector/.test(r)) return st.popup ? 'Всплывающее окно игры: расширение работает только на полных страницах.' : 'Неполная страница игры: нет выбора планеты (#planetSelector).';
    if (/without generator/.test(r)) return 'Адрес game.php, но нет meta generator «GALAXYZ» / «2Moons»: другой движок или страница не догрузилась.';
    if (/^ogamex:/.test(r)) return 'Похоже на сервер OgameX, но страница не распознана.';
    if (r === 'not a game page') return 'На странице нет признаков игры GALAXYZ (ogamex.eu) или OgameX.';
    return 'Страница не распознана.';
  }
  function showTab(state, lines, raw) {
    tabCard.dataset.ogxTabstatus = state;
    const text = tabCard.querySelector('.sx-ts-text');
    text.textContent = '';
    for (const l of lines) text.appendChild(el('div', null, l));
    if (raw) text.appendChild(el('code', { class: 'sx-ts-raw', title: 'Причина из OGX.page.detect()' }, raw));
  }
  async function checkTab() {
    if (!tabsApi || !tabsApi.sendMessage) { showTab('none', ['Нет доступа к вкладкам браузера.']); return; }
    let id = null;
    const m = /[?&]tabId=(\d+)/.exec(location.search);
    if (m) id = +m[1];
    else {
      const list = await call(tabsApi.query.bind(tabsApi), { active: true, currentWindow: true });
      id = list && list[0] ? list[0].id : null;
    }
    if (id === null) { showTab('none', ['Активная вкладка не найдена.']); return; }
    const st = await call(tabsApi.sendMessage.bind(tabsApi), id, { type: 'ogx:suite:status' });
    if (!st || typeof st !== 'object') {
      showTab('none', ['Расширение не запущено на этой вкладке.',
        'Это служебная страница браузера, либо вкладка открыта до установки или обновления расширения: обновите её (F5).']);
      return;
    }
    const where = [st.generator || (st.engine === 'ogamex' ? 'OgameX' + (st.version ? ' ' + st.version : '') : st.engine), st.host, st.universe].filter(Boolean).join(' · ');
    if (!st.ok) { showTab('no', ['Не распознана как страница игры. ' + whyNot(st), st.host ? 'Сайт: ' + st.host : ''].filter(Boolean), st.reason); return; }
    const pageLine = 'Страница: ' + (st.page || st.name || '?') + (st.mode ? ' (' + st.mode + ')' : '') + (st.info ? ', сообщение игры' : '');
    if (st.active) {
      const lines = ['Страница игры распознана: ' + where + '.', pageLine + ' · модулей работает: ' + Math.max(0, (st.modules || []).filter((n) => n !== 'suite').length) + '.'];
      if (st.errors) lines.push('Ошибок расширения на странице: ' + st.errors + '. Выгрузите «Логи» для разбора.');
      showTab(st.errors ? 'warn' : 'ok', lines);
    } else if (st.allowHosts && st.allowHosts.length && st.mark !== 'boot') {
      showTab('gated', ['Страница игры распознана (' + where + '), но сервер не в списке на вкладке «Серверы» — расширение на ней выключено.']);
    } else if (st.mark === 'boot') {
      showTab('wait', ['Страница игры распознана (' + where + '), расширение запускается…']);
      setTimeout(checkTab, 800);
    } else {
      showTab('warn', ['Страница игры распознана (' + where + '), но расширение не запустилось.', 'Обновите страницу; если повторится — выгрузите «Логи» для разбора.']);
    }
  }

  // ------------------------------------------------------------------ «Модули»
  const modsPane = el('div', { class: 'sx-pane', 'data-pane': 'modules' });
  function renderModules() {
    modsPane.textContent = '';
    for (const sec of (S.displayOrder || S.order)) {
      const def = S.sections[sec];
      const names = def.modules || [];
      const head = el('div', { class: 'sx-sec-head' },
        el('span', { class: 'sx-sec-title' }, def.label + (def.dev ? ' (в разработке)' : '')));
      if (names.length) {
        const allOn = names.every((n) => state.mods[n] !== false);
        head.appendChild(el('label', { class: 'sx-sec-all', title: 'Включить или выключить весь раздел' },
          el('input', { type: 'checkbox', checked: allOn, 'data-ogx-act': 'popup:section', 'data-section': sec,
            onchange: (ev) => { for (const n of names) state.mods[n] = ev.target.checked; save('mods'); renderModules(); } }),
          ' все'));
      }
      const box = el('section', { class: 'sx-sec', 'data-section': sec, title: def.title || '' }, head);
      if (!names.length) {
        box.appendChild(el('div', { class: 'sx-muted' }, def.dev
          ? 'Полная автоматизация: автопостройка, автоисследования, экспедиции, фарм с автошпионажем, сбор обломков, флитсейв. Появится в этом же расширении.'
          : 'Нет модулей.'));
      }
      for (const n of names) {
        box.appendChild(el('label', { class: 'sx-mod' },
          el('input', { type: 'checkbox', checked: state.mods[n] !== false, 'data-ogx-act': 'popup:module', 'data-module': n,
            onchange: (ev) => { state.mods[n] = ev.target.checked; save('mods'); renderModules(); } }),
          el('span', { class: 'sx-mod-title' }, (S.titles && S.titles[n]) || n),
          el('span', { class: 'sx-mod-name' }, n)));
      }
      modsPane.appendChild(box);
    }
    modsPane.appendChild(el('div', { class: 'sx-muted sx-foot' },
      'Переключатели действуют на всех серверах и аккаунтах и применяются при следующей загрузке страницы игры. ' +
      'Для отдельного аккаунта модули можно выключить в самой игре: «OgameX Suite» → Live (список модулей «OgameX Live») или Infinity → «Настройки».'));
  }

  // ------------------------------------------------------------------ «Серверы»
  const hostsPane = el('div', { class: 'sx-pane', 'data-pane': 'hosts', hidden: true });
  function normHost(s) { return String(s || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, ''); }
  function renderHosts() {
    hostsPane.textContent = '';
    const input = el('input', { type: 'text', class: 'sx-input', placeholder: 'ogamex.eu, localhost:8080, *.example.org', 'data-ogx-act': 'popup:host-input',
      onkeydown: (ev) => { if (ev.key === 'Enter') add(input.value); } });
    function add(v) {
      const h = normHost(v);
      if (!h) return;
      if (!/^(\*\.)?[a-z0-9.-]+(:\d+)?$|^\[[0-9a-f:]+\](:\d+)?$/.test(h)) { say('Некорректный адрес: ' + v); return; }
      if (!state.hosts.includes(h)) state.hosts.push(h);
      save('hosts'); renderHosts();
    }
    hostsPane.appendChild(el('div', { class: 'sx-muted' },
      'Список пуст — расширение работает на любом сервере GALAXYZ / 2Moons (ogamex.eu) и OgameX: страницы игры распознаются автоматически, на остальных сайтах оно ничего не делает. ' +
      'Укажите адреса, чтобы включать его только на них (ogamex.eu работает всегда).'));
    hostsPane.appendChild(el('div', { class: 'sx-row' }, input,
      el('button', { class: 'sx-btn sx-btn-primary', 'data-ogx-act': 'popup:host-add', onclick: () => add(input.value) }, 'Добавить')));
    const list = el('ul', { class: 'sx-hosts' });
    if (!state.hosts.length) list.appendChild(el('li', { class: 'sx-muted' }, 'Все серверы игры'));
    for (const h of state.hosts) {
      list.appendChild(el('li', { 'data-host': h }, el('span', null, h),
        el('button', { class: 'sx-btn sx-btn-small', title: 'Удалить', 'data-ogx-act': 'popup:host-remove',
          onclick: () => { state.hosts = state.hosts.filter((x) => x !== h); save('hosts'); renderHosts(); } }, '×')));
    }
    hostsPane.appendChild(list);
    const known = state.known.filter((h) => !state.hosts.includes(h));
    if (known.length) {
      hostsPane.appendChild(el('div', { class: 'sx-muted' }, 'Серверы, где расширение уже работало:'));
      hostsPane.appendChild(el('div', { class: 'sx-chips' }, known.map((h) => el('button', { class: 'sx-chip', 'data-ogx-act': 'popup:host-known', title: 'Добавить в список', onclick: () => add(h) }, '+ ' + h))));
    }
  }

  // ------------------------------------------------------------------ «Логи»
  const logsPane = el('div', { class: 'sx-pane', 'data-pane': 'logs', hidden: true });
  const holder = document.getElementById('ogx-suite-logs-holder');
  if (holder) { holder.hidden = false; logsPane.appendChild(holder); }

  // Popup changes go to the same journal (extension IndexedDB 'ogx-diag') as U events, so an export shows them.
  let journalP = null;
  function journal(what, d) {
    try {
      const L = self.OGXDiagLib;
      if (!L || !L.openStore) return;
      if (!journalP) { journalP = L.openStore({ name: 'ogx-diag' }); journalP.catch(() => { journalP = null; }); }
      const ev = { t: Date.now(), s: 'U', k: 'popup', w: what, p: 'popup', x: 'suite', tab: 'popup', d: L.redact(d, { maxStr: 120 }) };
      journalP.then((st) => st.put([ev])).catch(() => { /* never break the popup */ });
    } catch (e) { /* ignore */ }
  }
  async function save(what) {
    if (what === 'mods') {
      const off = {};
      for (const [k, v] of Object.entries(state.mods)) if (v === false) off[k] = false;
      await set({ [KEY_MODS]: off });
      journal('modules', { globalOff: Object.keys(off) });
      say('Сохранено. Перезагрузите страницу игры.');
    } else {
      await set({ [KEY_HOSTS]: state.hosts.slice() });
      journal('hosts', { allowHosts: state.hosts.slice() });
      say(state.hosts.length ? 'Сохранено: только ' + state.hosts.join(', ') : 'Сохранено: все серверы игры');
    }
  }

  // ------------------------------------------------------------------ shell
  const mf = manifest();
  const tabs = [
    { id: 'modules', label: 'Модули', pane: modsPane },
    { id: 'hosts', label: 'Серверы', pane: hostsPane },
    { id: 'logs', label: 'Логи', pane: logsPane },
  ];
  const tabBar = el('div', { class: 'sx-tabs', role: 'tablist' });
  function select(id) {
    for (const t of tabs) {
      const on = t.id === id;
      t.btn.classList.toggle('sx-active', on);
      t.btn.setAttribute('aria-selected', on ? 'true' : 'false');
      t.pane.hidden = !on;
    }
    try { localStorage.setItem(TAB_KEY, id); } catch (e) { /* ignore */ }
  }
  for (const t of tabs) { t.btn = el('button', { class: 'sx-tab', role: 'tab', 'data-tab': t.id, 'data-ogx-act': 'popup:tab-' + t.id, onclick: () => select(t.id) }, t.label); tabBar.appendChild(t.btn); }
  app.appendChild(el('header', { class: 'sx-head' },
    el('div', { class: 'sx-logo', 'aria-hidden': 'true' }, '✦'),
    el('div', null, el('div', { class: 'sx-title' }, 'OgameX Suite'),
      el('div', { class: 'sx-ver' }, 'версия ' + (mf.version_name || mf.version || '?') + ' · Live + Infinity + Бот'))));
  const isOptions = document.body.classList.contains('ogx-options');
  if (!isOptions) app.appendChild(tabCard);
  app.appendChild(tabBar);
  for (const t of tabs) app.appendChild(t.pane);
  app.appendChild(status);
  let first = 'modules';
  try { const v = localStorage.getItem(TAB_KEY); if (tabs.some((t) => t.id === v)) first = v; } catch (e) { /* ignore */ }
  try { const m = /[?&]tab=(\w+)/.exec(location.search); if (m && tabs.some((t) => t.id === m[1])) first = m[1]; } catch (e) { /* ignore */ }

  (async () => {
    const all = await get(null);
    const mods = all[KEY_MODS];
    if (mods && typeof mods === 'object') for (const [k, v] of Object.entries(mods)) if (v === false) state.mods[k] = false;
    state.hosts = Array.isArray(all[KEY_HOSTS]) ? all[KEY_HOSTS].map(normHost).filter(Boolean) : [];
    const known = new Set();
    for (const k of Object.keys(all)) { const m = /^([^|*][^|]*)\|[^|]+\|/.exec(k); if (m) known.add(m[1]); }
    state.known = Array.from(known).sort();
    renderModules();
    renderHosts();
    select(first);
    document.body.dataset.ready = '1';
  })();
  if (!isOptions) checkTab();
})();
