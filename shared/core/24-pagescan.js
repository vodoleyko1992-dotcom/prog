/* shared/core/24-pagescan.js — «Скан страниц»: walks the game pages of every planet and moon and saves them as one ZIP
 * for a bug report / port (GALAXYZ only). Owner: core. Same logic as the standalone ogamex-addons/pagescan/ogx-pagescan.user.js.
 *   OGX.pagescan.run(opts)  -> Promise<state>   opts { planets, details, discover, messages } (booleans)
 *   OGX.pagescan.stop()     stops after the current request; what is collected can still be downloaded
 *   OGX.pagescan.zip()      -> Promise<Blob>    OGX.pagescan.download() saves ogx-pagescan-<uni>-<stamp>.zip
 *   OGX.pagescan.addPanelTab(panel)            tab «Скан страниц» in the «Логи» group (suite/hub.js)
 * Safety: GET only through OGX.http (same origin, journaled), 0.3–0.6 s between requests, never fleetStep*, vote, donatebis,
 * relocate, logout, messages (unless asked: listing a category marks its messages read) or a link with an action-like key.
 * The whole scan runs inside OGX.http.withPlanet (cross-tab lock 'cp', the planet is restored at the end) and pauses the bot
 * (OGX.bot.pause('scan')) while it runs, resuming it only if the scan paused it. */
window.OGX = window.OGX || {};
(function (OGX) {
  'use strict';
  const S = (OGX.pagescan = OGX.pagescan || {});
  const NAME = 'pagescan';
  const PER_PLANET = [
    ['overview', 'page=overview'], ['buildings', 'page=buildings'], ['resources', 'page=resources'], ['research', 'page=research'],
    ['shipyard-fleet', 'page=shipyard&mode=fleet'], ['shipyard-defense', 'page=shipyard&mode=defense'], ['fleetTable', 'page=fleetTable'],
    ['galaxy', 'page=galaxy'], ['transport', 'page=transport'],
  ];
  const GLOBAL = ['imperium', 'techtree', 'premium', 'ressprem', 'officier', 'trader', 'fleetDealer', 'statistics', 'alliance', 'buddyList',
    'search', 'records', 'battleHall', 'banList', 'rules', 'questions', 'notes', 'settings', 'tournament', 'satinal', 'battleSimulator',
    'ticket', 'GiveBonus'];
  const MSG_CATS = [[0, 'spy'], [1, 'player'], [2, 'alliance'], [3, 'combat'], [4, 'system'], [5, 'transport'], [15, 'expedition'],
    [50, 'game'], [99, 'construction'], [100, 'all'], [999, 'outbox']];
  const DETAILS = [['buildings', 'TechnologyDetailsAjax'], ['research', 'ResearchDetailsAjax'], ['shipyard-fleet', 'ShipDetailsAjax'], ['shipyard-defense', 'ShipDetailsAjax']];
  const DENY_PAGES = /^(logout|vote|donatebis|relocate|fleetStep\d*|fleetAjax|messages|.*Ajax|sendFleet|admin|changelog|disclamer)$/i;
  const SAFE_KEYS = new Set(['page', 'cp', 'mode', 'galaxy', 'system', 'range', 'type', 'who', 'site', 'tab']);
  const SAFE_MODES = /^(fleet|defense|view|info|stats|overview|memberList|list)?$/i;
  const MAX_DISCOVER = 60;
  S.DEFAULTS = { planets: true, details: true, discover: true, messages: false };

  const st = { running: false, stop: false, files: [], log: [], done: 0, total: 0, seen: new Set(), startCp: null, startedAt: null, finishedAt: null, note: '' };
  const listeners = new Set();
  S.state = () => ({ running: st.running, stopped: st.stop, done: st.done, total: st.total, files: st.files.length, note: st.note, finishedAt: st.finishedAt });
  S.onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const emit = () => { for (const fn of listeners) { try { fn(S.state()); } catch (e) { /* ignore */ } } };
  const rec = (what, data) => { try { OGX.log.rec('U', NAME, what, data); } catch (e) { /* journal off */ } };
  const sleep = (ms) => (OGX.util && OGX.util.sleep ? OGX.util.sleep(ms) : new Promise((r) => setTimeout(r, ms)));
  const iso = () => new Date().toISOString();
  const say = (t) => { st.note = t; emit(); };
  const safeName = (s) => String(s).replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'x';
  S._pauseMs = () => 300 + Math.random() * 300;
  const universe = () => { try { return location.pathname.split('/').filter(Boolean)[0] || 'uni'; } catch (e) { return 'uni'; } };

  S.planetsFrom = function (doc) {
    const out = [];
    doc.querySelectorAll('#planetSelector option').forEach((o) => {
      const id = String(o.value || '').match(/\d+/); if (!id) return;
      out.push({ id: id[0], name: (o.textContent || '').trim(), selected: !!(o.selected || o.hasAttribute('selected')) });
    });
    return out;
  };

  /** Safe game.php links of a page, normalized without cp (exported for tests). */
  S.discoverLinks = function (html, seen = new Set()) {
    const found = [];
    const re = /game\.php\?([^"'<>\s#]+)/g; let m;
    const txt = String(html || '').replace(/&amp;/g, '&');
    while ((m = re.exec(txt))) {
      let p; try { p = new URLSearchParams(m[1]); } catch (e) { continue; }
      const page = p.get('page'); if (!page || DENY_PAGES.test(page)) continue;
      let ok = true;
      for (const [k, v] of p) {
        if (!SAFE_KEYS.has(k)) { ok = false; break; }
        if (k === 'mode' && !SAFE_MODES.test(v)) { ok = false; break; }
        if (k !== 'page' && !/^[\w.-]*$/.test(v)) { ok = false; break; }
      }
      if (!ok) continue;
      if (page === 'galaxy' && (p.has('galaxy') || p.has('system'))) continue;
      p.delete('cp');
      const norm = p.toString();
      if (!seen.has(norm)) found.push(norm);
    }
    return [...new Set(found)];
  };

  async function get(query, file, { ajax = false, cp } = {}) {
    if (st.stop) return null;
    st.seen.add(query); st.seen.add(query.replace(/&cp=\d+/, ''));
    if (/^page=shipyard&mode=fleet/.test(query)) st.seen.add('page=shipyard');
    const r = await OGX.http.get('game.php?' + query, { expect: 'text', cp, timeout: 30000 });
    st.done++;
    if (r.loggedOut) {
      st.stop = true; st.log.push(`${iso()} LOGGED-OUT at ${query}`);
      say('Сессия закончилась (страница входа). Скан остановлен, собранное можно скачать.');
      return null;
    }
    const text = r.text !== undefined ? r.text : r.json !== undefined ? JSON.stringify(r.json) : '';
    const reqUrl = r.reqUrl || r.url;
    const head = ajax ? '' : `<!-- ogx-pagescan url=${reqUrl} final=${r.url} status=${r.status} time=${iso()} -->\n`;
    if (text || r.ok) st.files.push({ name: file, data: head + text });
    st.log.push(`${iso()} ${r.status}${r.error ? ' ' + r.error : ''} ${query}${cp ? '&cp=' + cp : ''} -> ${file} (${text.length} chars)`);
    say(`${st.done}/${st.total}: ${file}`);
    await sleep(S._pauseMs());
    return r.ok ? text : null;
  }

  S.run = async function (opts = {}) {
    if (st.running) return S.state();
    const o = Object.assign({}, S.DEFAULTS, opts);
    Object.assign(st, { running: true, stop: false, files: [], log: [], done: 0, total: 0, seen: new Set(), startCp: null, startedAt: iso(), finishedAt: null });
    st.log.push(`${iso()} ogx-pagescan (Suite ${OGX.version || ''}) start ${location.href} opts=${JSON.stringify(o)}`);
    rec('start', o);
    say('Готовлю скан…');
    let pausedBot = false;
    try {
      const bs = OGX.bot && OGX.bot.status ? OGX.bot.status() : null;
      if (bs && bs.master && bs.state !== 'paused' && bs.state !== 'stopped' && bs.state !== 'off' && OGX.bot.pause) { await OGX.bot.pause('scan'); pausedBot = true; }
    } catch (e) { st.log.push('bot pause failed ' + e); }
    try {
      let planets = S.planetsFrom(document);
      if (!planets.length) {
        const r = await OGX.http.get('game.php?page=overview', { expect: 'text' });
        if (r.ok && r.text) planets = S.planetsFrom(new DOMParser().parseFromString(r.text, 'text/html'));
      }
      const cur = planets.find((p) => p.selected) || planets[0] || null;
      st.startCp = cur ? cur.id : null;
      if (!o.planets) planets = cur ? [cur] : [];
      st.log.push('planets: ' + JSON.stringify(planets));
      st.total = planets.length * PER_PLANET.length + GLOBAL.length + (o.messages ? MSG_CATS.length + 1 : 0);
      const body = async () => {
        const byKind = {}; const extra = [];
        for (const pl of planets) {
          if (st.stop) break;
          const dir = `p${pl.id}-${safeName(pl.name)}`;
          for (const [name, q] of PER_PLANET) {
            if (st.stop) break;
            const t = await get(q, `${dir}/${name}.html`, { cp: pl.id });
            if (t) { (byKind[name] = byKind[name] || []).push(t); if (o.discover) extra.push(...S.discoverLinks(t, st.seen)); }
          }
        }
        const cp = st.startCp || undefined;
        for (const g of GLOBAL) {
          if (st.stop) break;
          const t = await get(`page=${g}`, `00-global/${g}.html`, { cp });
          if (t && o.discover) extra.push(...S.discoverLinks(t, st.seen));
        }
        if (o.messages && !st.stop) {
          await get('page=messages', 'messages/00-messages.html', { cp });
          for (const [c, n] of MSG_CATS) { if (st.stop) break; await get(`page=messages&mode=view&messcat=${c}&site=1&ajax=1`, `messages/cat-${c}-${n}.html`, { ajax: true }); }
        }
        if (o.details && !st.stop) {
          const jobs = []; const have = new Set();
          for (const [kind, ajax] of DETAILS) {
            for (const t of byKind[kind] || []) {
              for (const s of t.match(/data-technology="(\d+)"/g) || []) {
                const id = s.match(/\d+/)[0];
                if (!have.has(ajax + id)) { have.add(ajax + id); jobs.push([ajax, id]); }
              }
            }
          }
          st.total += jobs.length; emit();
          for (const [ajax, id] of jobs) { if (st.stop) break; await get(`page=${ajax}&technology=${id}`, `details/${ajax}-${id}.json`, { ajax: true, cp }); }
        }
        if (o.discover && !st.stop) {
          const todo = [...new Set(extra)].filter((q) => !st.seen.has(q)).slice(0, MAX_DISCOVER);
          st.total += todo.length; emit();
          for (const q of todo) {
            if (st.stop) break;
            if (st.seen.has(q)) { st.done++; continue; }
            await get(q, `01-discovered/${safeName(q.replace(/^page=/, ''))}.html`, { cp });
          }
        }
      };
      if (st.startCp && OGX.http.withPlanet) await OGX.http.withPlanet(st.startCp, body, { restoreTo: st.startCp, lockWaitMs: 120000 });
      else await body();
    } catch (e) {
      st.log.push(`${iso()} FATAL ${e && e.stack || e}`);
      say('Ошибка скана: ' + (e && e.message || e));
    } finally {
      if (pausedBot) { try { await OGX.bot.resume(); } catch (e) { st.log.push('bot resume failed ' + e); } }
      st.finishedAt = iso();
      st.running = false;
      const pages = st.files.length;
      rec('done', { pages, requests: st.done, stopped: st.stop, pausedBot });
      if (!/Сессия|Ошибка/.test(st.note)) say(`${st.stop ? 'Остановлено' : 'Готово'}: ${pages} страниц. Нажмите «Скачать ZIP».`);
    }
    return S.state();
  };
  S.stop = () => { if (st.running) { st.stop = true; say('Останавливаю…'); } };

  // ------------------------------------------------------------------ ZIP (deflate-raw via CompressionStream, else stored)
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  async function deflate(u8) {
    if (typeof CompressionStream === 'undefined') return null;
    try { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()); } catch (e) { return null; }
  }
  S.makeZip = async function (files) {
    const enc = new TextEncoder(); const parts = []; const central = []; let offset = 0;
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const f of files) {
      const name = enc.encode(f.name); const raw = enc.encode(f.data); const crc = crc32(raw);
      const def = await deflate(raw); const useDef = !!def && def.length < raw.length;
      const body = useDef ? def : raw; const method = useDef ? 8 : 0;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, method, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true); lh.setUint32(18, body.length, true);
      lh.setUint32(22, raw.length, true); lh.setUint16(26, name.length, true);
      parts.push(lh, name, body);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, method, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, body.length, true);
      ch.setUint32(24, raw.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(ch, name);
      offset += 30 + name.length + body.length;
    }
    const cdSize = central.reduce((s, x) => s + x.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  };
  S.zip = function () {
    const index = { tool: 'ogx-pagescan', suite: OGX.version || null, universe: universe(), startedAt: st.startedAt, finishedAt: st.finishedAt,
      stopped: st.stop, startCp: st.startCp, files: st.files.map((f) => ({ name: f.name, chars: f.data.length })) };
    return S.makeZip([...st.files, { name: 'index.json', data: JSON.stringify(index, null, 1) }, { name: 'log.txt', data: st.log.join('\n') + '\n' }]);
  };
  S.download = async function () {
    const blob = await S.zip();
    const d = new Date(); const p = (n) => String(n).padStart(2, '0');
    const name = `ogx-pagescan-${universe()}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.zip`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.style.display = 'none';
    (document.body || document.documentElement).appendChild(a); a.click();
    setTimeout(() => { try { URL.revokeObjectURL(url); a.remove(); } catch (e) { /* ignore */ } }, 60000);
    rec('download', { name, bytes: blob.size });
    return { name, bytes: blob.size };
  };

  // ------------------------------------------------------------------ panel tab «Скан страниц» (group «Логи»)
  S.render = function (c) {
    const h = OGX.dom.h;
    const opts = Object.assign({}, S.DEFAULTS);
    const box = (k, label, warn) => h('label', { class: 'ogx-pagescan-opt', style: 'display:block;margin:3px 0;cursor:pointer' },
      h('input', { type: 'checkbox', 'data-ogx-pagescan': k, checked: opts[k] ? true : null, onChange: (ev) => { opts[k] = !!ev.target.checked; } }),
      ' ' + label, warn ? h('span', { style: 'color:#e0a050' }, ' ' + warn) : null);
    const status = h('div', { class: 'ogx-pagescan-status', style: 'margin-top:8px;min-height:2.6em;word-break:break-all' });
    const bar = h('i', { style: 'display:block;height:100%;width:0;background:#4caf50' });
    const go = h('button', { type: 'button', class: 'ogx-btn ogx-btn-primary', 'data-ogx-act': 'pagescan:start', onClick: () => { S.run(opts); } }, 'Начать скан');
    const stop = h('button', { type: 'button', class: 'ogx-btn', 'data-ogx-act': 'pagescan:stop', onClick: () => S.stop() }, 'Стоп');
    const dl = h('button', { type: 'button', class: 'ogx-btn', 'data-ogx-act': 'pagescan:download', onClick: async () => {
      dl.disabled = true; status.textContent = 'Упаковываю ZIP…';
      try { const r = await S.download(); status.textContent = `Скачан ${r.name} (${(r.bytes / 1048576).toFixed(1)} МБ). Пришлите этот файл Claude.`; } catch (e) { status.textContent = 'Не удалось собрать ZIP: ' + (e && e.message || e); }
      dl.disabled = false;
    } }, 'Скачать ZIP');
    let root = null; let off = null;
    const paint = (s) => {
      if (root && !root.isConnected) { if (off) off(); return; }
      go.disabled = s.running; stop.disabled = !s.running; dl.disabled = s.running || !s.files;
      bar.style.width = (s.total ? Math.min(100, 100 * s.done / s.total) : 0) + '%';
      if (s.note) status.textContent = s.note;
    };
    c.textContent = '';
    c.appendChild(root = h('div', { class: 'ogx-pagescan ogx-root' },
      h('div', { style: 'font-weight:bold;margin-bottom:4px' }, 'Скан страниц игры'),
      h('div', { style: 'opacity:.8;margin-bottom:6px' }, 'Обходит страницы всех планет и лун и сохраняет их одним ZIP для разбора. Только чтение, пауза 0.3–0.6 с, около 150 запросов. Бот на время скана ставится на паузу и потом продолжает.'),
      box('planets', 'Все планеты и луны'), box('details', 'Детали построек, исследований и кораблей (JSON)'),
      box('discover', 'Искать новые страницы по ссылкам'), box('messages', 'Почта по категориям', '(пометит письма прочитанными)'),
      h('div', { style: 'display:flex;gap:6px;margin-top:8px' }, go, stop, dl),
      h('div', { style: 'height:6px;background:#26313c;border-radius:3px;margin-top:8px;overflow:hidden' }, bar),
      status));
    off = S.onChange(paint);
    paint(S.state());
    if (!S.state().note) status.textContent = 'Нажмите «Начать скан», дождитесь «Готово» и нажмите «Скачать ZIP».';
    return { dispose: off };
  };
  S.addPanelTab = function (panel, { order = 910 } = {}) {
    if (!panel || !panel.addTab) return null;
    return panel.addTab({ id: 'pagescan', label: 'Скан страниц', order, render: (c) => S.render(c) });
  };
})(window.OGX);
