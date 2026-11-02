// ==UserScript==
// @name         OgameX Page Scan (автоскан страниц в HTML)
// @namespace    ogx-suite
// @version      1.1.0
// @description  Обходит страницы игры (GALAXYZ / 2Moons, game.php?page=...) по всем планетам и лунам и выгружает их одним ZIP по кнопке. Личное (почта аккаунта, заметки, тикеты, друзья, User-Agent) в архив не попадает.
// @match        https://ogamex.eu/*/game.php*
// @match        http://ogamex.eu/*/game.php*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
//
// Как пользоваться без Tampermonkey: откройте любую страницу игры, нажмите F12 → Console,
// вставьте весь этот файл и нажмите Enter. Справа внизу появится панель «Скан страниц».
//
// Безопасность: только GET-запросы на чтение, пауза 0.3–0.6 с между запросами,
// никаких форм, отправок флота, построек, покупок, голосований и выхода из игры.
// Приватность (1.1.0): страницы notes, ticket, buddyList, GiveBonus, satinal не открываются вовсе (ни из списка, ни по
// ссылкам); в каждой сохранённой странице пустеют value полей e-mail/пароля и все textarea, любые адреса e-mail заменяются
// на <email>; в log.txt вместо User-Agent — только семейство и версия браузера. Панель перечисляет, что попадёт в архив.
(function () {
  'use strict';
  if (window.__ogxPageScan) { window.__ogxPageScan.show(); return; }

  const VERSION = '1.1.0';
  const BASE = location.href.replace(/[?#].*$/, '');           // .../Aeternum/game.php
  const UNI = (location.pathname.split('/').filter(Boolean)[0] || 'uni');

  // Страницы, которые сохраняются для каждой планеты и луны (cp=<id>).
  const PER_PLANET = [
    ['overview', 'page=overview'],
    ['buildings', 'page=buildings'],
    ['resources', 'page=resources'],
    ['research', 'page=research'],
    ['shipyard-fleet', 'page=shipyard&mode=fleet'],
    ['shipyard-defense', 'page=shipyard&mode=defense'],
    ['fleetTable', 'page=fleetTable'],
    ['galaxy', 'page=galaxy'],
    ['transport', 'page=transport'],
  ];
  // Общие страницы аккаунта: один раз. settings нужна (число зондов и прочие настройки игры) — её поля e-mail/пароля
  // пустеют (scrub ниже). Личные страницы и страницы с неизвестными побочными эффектами GET не открываются: PRIVATE.
  const GLOBAL = [
    'imperium', 'techtree', 'premium', 'ressprem', 'officier', 'trader', 'fleetDealer',
    'statistics', 'alliance', 'search', 'records', 'battleHall', 'banList',
    'rules', 'questions', 'settings', 'tournament', 'battleSimulator',
  ];
  // Никогда: заметки, тикеты поддержки, список друзей (личное); GiveBonus (ваучер) и satinal (покупка) — GET с
  // неизвестным побочным действием, в upstream 2Moons их нет.
  const PRIVATE = ['notes', 'ticket', 'buddyList', 'GiveBonus', 'satinal'];
  // Категории почты (Message.getMessages(N)). Открытие списка помечает письма прочитанными.
  const MSG_CATS = [[0, 'spy'], [1, 'player'], [2, 'alliance'], [3, 'combat'], [4, 'system'],
    [5, 'transport'], [15, 'expedition'], [50, 'game'], [99, 'construction'], [100, 'all'], [999, 'outbox']];
  // Детали объектов (JSON) и с какой страницы брать их id.
  const DETAILS = [
    ['buildings', 'TechnologyDetailsAjax'],
    ['research', 'ResearchDetailsAjax'],
    ['shipyard-fleet', 'ShipDetailsAjax'],
    ['shipyard-defense', 'ShipDetailsAjax'],
  ];
  // Никогда не открывать: действия, выход, POST-шаги флота, внешние переходы.
  const DENY_PAGES = /^(logout|vote|donatebis|relocate|fleetStep\d*|fleetAjax|messages|.*Ajax|buildingAjax|sendFleet|admin|changelog|disclamer|notes|ticket|buddyList|GiveBonus|satinal|chat)$/i;
  const DENY_WORDS = /(cmd|action|delete|del|cancel|abort|destroy|insert|send|buy|sell|build|deconstruct|deleteid|token|confirm|accept|decline|kick|leave|logout|vote|exchange|use|activate|recall|retreat)/i;
  const SAFE_KEYS = new Set(['page', 'cp', 'mode', 'galaxy', 'system', 'range', 'type', 'who', 'site', 'tab']);
  const SAFE_MODES = /^(fleet|defense|view|info|stats|overview|memberList|list)?$/i;

  const S = {
    running: false, stop: false, files: [], log: [], done: 0, total: 0,
    seen: new Set(), startCp: null, startedAt: null, zipBlob: null,
  };

  // ---------- UI ----------
  const css = `
#ogx-ps{position:fixed;right:12px;bottom:12px;z-index:2147483647;width:300px;background:#11161c;color:#d7dde4;
 border:1px solid #3a4756;border-radius:6px;font:12px/1.4 Arial,sans-serif;box-shadow:0 4px 16px #000a}
#ogx-ps header{display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:#1b232c;border-radius:6px 6px 0 0;font-weight:bold}
#ogx-ps header button{background:none;border:0;color:#9aa;cursor:pointer;font-size:14px}
#ogx-ps .b{padding:8px}
#ogx-ps label{display:block;margin:2px 0;cursor:pointer}
#ogx-ps .row{display:flex;gap:6px;margin-top:8px}
#ogx-ps .row button{flex:1;padding:6px;border:1px solid #4b5a6b;background:#22303d;color:#e6edf3;border-radius:4px;cursor:pointer}
#ogx-ps .row button:disabled{opacity:.45;cursor:default}
#ogx-ps .bar{height:6px;background:#26313c;border-radius:3px;margin-top:8px;overflow:hidden}
#ogx-ps .bar i{display:block;height:100%;width:0;background:#4caf50}
#ogx-ps .st{margin-top:6px;min-height:32px;color:#aab7c4;word-break:break-all}
#ogx-ps .pv{margin-top:6px;padding-top:6px;border-top:1px solid #26313c;color:#8a98a6;font-size:11px;line-height:1.35}
#ogx-ps-tab{position:fixed;right:12px;bottom:12px;z-index:2147483647;padding:6px 10px;background:#22303d;color:#e6edf3;
 border:1px solid #4b5a6b;border-radius:4px;cursor:pointer;font:12px Arial,sans-serif;display:none}`;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  const box = document.createElement('div'); box.id = 'ogx-ps';
  box.innerHTML = `<header><span>Скан страниц ${VERSION}</span><button title="Свернуть" data-x>✕</button></header>
<div class="b">
 <label><input type="checkbox" data-o="planets" checked> Все планеты и луны</label>
 <label><input type="checkbox" data-o="details" checked> Детали построек/исследований/кораблей (JSON)</label>
 <label><input type="checkbox" data-o="discover" checked> Искать новые страницы по ссылкам</label>
 <label><input type="checkbox" data-o="messages"> Почта по категориям <span style="color:#e0a050">(пометит письма прочитанными)</span></label>
 <div class="row"><button data-go>Начать скан</button><button data-stop disabled>Стоп</button></div>
 <div class="row"><button data-dl disabled>Скачать ZIP</button></div>
 <div class="bar"><i></i></div><div class="st">Остановите бота Suite на время скана: скан переключает планеты.</div>
 <div class="pv">В архив попадут: страницы игры по планетам и лунам, общие страницы (без заметок, тикетов, списка друзей и ваучеров),
 детали построек/кораблей, index.json и log.txt. Вырезается: e-mail, значения полей почты и пароля, все textarea, User-Agent.
 Почта — только по галочке выше.</div>
</div>`;
  document.body.appendChild(box);
  const tab = document.createElement('div'); tab.id = 'ogx-ps-tab'; tab.textContent = 'Скан страниц';
  document.body.appendChild(tab);
  const $ = (s) => box.querySelector(s);
  const opt = (k) => $(`[data-o="${k}"]`).checked;
  const status = (t) => { $('.st').textContent = t; };
  const progress = () => { $('.bar i').style.width = (S.total ? Math.min(100, 100 * S.done / S.total) : 0) + '%'; };
  $('[data-x]').onclick = () => { box.style.display = 'none'; tab.style.display = 'block'; };
  tab.onclick = () => { box.style.display = ''; tab.style.display = 'none'; };
  $('[data-go]').onclick = () => run().catch((e) => { log('FATAL ' + (e && e.stack || e)); status('Ошибка: ' + e); finish(); });
  $('[data-stop]').onclick = () => { S.stop = true; status('Останавливаю…'); };
  $('[data-dl]').onclick = download;

  // ---------- helpers ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pause = () => sleep(300 + Math.random() * 300);
  const ts = () => new Date().toISOString();
  function log(m) { S.log.push(ts() + ' ' + m); }
  const safeName = (s) => String(s).replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'x';

  // ---------- приватность: вырезается из каждой сохранённой страницы ----------
  const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
  const MAILPASS = /(?:name|id)=["']?[^"'>\s]*(?:mail|pass)[^"'>\s]*/i;
  function scrub(text) {
    let t = String(text);
    // поля e-mail / пароля: value="" (в любом порядке атрибутов)
    t = t.replace(/<input\b[^>]*>/gi, (tag) => (MAILPASS.test(tag) ? tag.replace(/\bvalue=(["'])[^"']*\1/i, 'value=$1$1').replace(/\bvalue=(?!["'])[^\s>]+/i, 'value=""') : tag));
    // textarea (заметки, подписи, тексты писем) — пустые
    t = t.replace(/(<textarea\b[^>]*>)[\s\S]*?(<\/textarea>)/gi, '$1$2');
    // любые адреса e-mail в тексте и атрибутах
    t = t.replace(EMAIL_RE, '<email>');
    return t;
  }
  function browserFamily() {
    const ua = navigator.userAgent || '';
    const m = /(Firefox|Edg|OPR|YaBrowser|Chrome|Safari)\/(\d+)/.exec(ua);
    return m ? m[1] + ' ' + m[2] : 'unknown';
  }

  function isLoggedOut(text, url) {
    if (/index\.php/i.test(url) && !/game\.php/i.test(url)) return true;
    return !/game\.php\?page=/i.test(text) && /type=["']?password/i.test(text);
  }

  async function get(query, path, kind) {
    if (S.stop) return null;
    const url = BASE + '?' + query;
    S.seen.add(query);
    S.seen.add(query.replace(/&cp=\d+/, ''));
    if (/^page=shipyard&mode=fleet/.test(query)) S.seen.add('page=shipyard');
    let text = '', st = 0, finalUrl = url;
    try {
      const r = await fetch(url, { method: 'GET', credentials: 'include', cache: 'no-store',
        headers: kind === 'ajax' ? { 'X-Requested-With': 'XMLHttpRequest' } : {} });
      st = r.status; finalUrl = r.url; text = await r.text();
    } catch (e) { log(`ERR ${query} ${e}`); S.done++; progress(); await pause(); return null; }
    S.done++; progress();
    if (kind !== 'ajax' && isLoggedOut(text, finalUrl)) {
      log(`LOGGED-OUT at ${query} → ${finalUrl}`); S.stop = true;
      status('Похоже, сессия закончилась (страница входа). Скан остановлен, собранное можно скачать.');
      return null;
    }
    const head = kind === 'ajax' ? '' : `<!-- ogx-pagescan ${VERSION} url=${url} final=${finalUrl} status=${st} time=${ts()} scrubbed=email,mail/pass-values,textarea -->\n`;
    S.files.push({ name: path, data: head + scrub(text) });
    log(`${st} ${query} → ${path} (${text.length} chars)`);
    status(`${S.done}/${S.total}: ${path}`);
    await pause();
    return text;
  }

  function parse(html) { return new DOMParser().parseFromString(html, 'text/html'); }

  function planetsFrom(doc) {
    const out = [];
    doc.querySelectorAll('#planetSelector option').forEach((o) => {
      const id = (o.value || '').match(/\d+/); if (!id) return;
      out.push({ id: id[0], name: o.textContent.trim(), selected: o.selected || o.hasAttribute('selected') });
    });
    return out;
  }

  function discoverLinks(html) {
    const found = [];
    const re = /game\.php\?([^"'<>\s#]+)/g; let m;
    const txt = html.replace(/&amp;/g, '&');
    while ((m = re.exec(txt))) {
      const q = m[1];
      let p; try { p = new URLSearchParams(q); } catch (e) { continue; }
      const page = p.get('page'); if (!page || DENY_PAGES.test(page)) continue;
      let ok = true;
      for (const [k, v] of p) {
        if (!SAFE_KEYS.has(k) || DENY_WORDS.test(k)) { ok = false; break; }
        if (k === 'mode' && !SAFE_MODES.test(v)) { ok = false; break; }
        if (k !== 'page' && !/^[\w.-]*$/.test(v)) { ok = false; break; }
      }
      if (!ok) continue;
      if (page === 'galaxy' && (p.has('galaxy') || p.has('system'))) continue; // чужие системы не обходим
      p.delete('cp');
      const norm = p.toString();
      if (!S.seen.has(norm)) found.push(norm);
    }
    return [...new Set(found)];
  }

  // ---------- main ----------
  async function run() {
    if (S.running) return;
    Object.assign(S, { running: true, stop: false, files: [], log: [], done: 0, total: 0, seen: new Set(), zipBlob: null, startedAt: ts() });
    $('[data-go]').disabled = true; $('[data-stop]').disabled = false; $('[data-dl]').disabled = true;
    log(`ogx-pagescan ${VERSION} start ${location.href} browser=${browserFamily()}`);

    let planets = planetsFrom(document);
    if (!planets.length) {
      const t = await get('page=overview', '00-start-overview.html');
      if (t) planets = planetsFrom(parse(t));
    }
    const cur = planets.find((p) => p.selected) || planets[0];
    S.startCp = cur ? cur.id : null;
    if (!opt('planets')) planets = cur ? [cur] : [];
    log('planets: ' + JSON.stringify(planets));

    const htmlByKind = {};
    const extra = [];
    S.total = planets.length * PER_PLANET.length + GLOBAL.length + (opt('messages') ? MSG_CATS.length + 1 : 0);
    progress();

    // 1) по планетам и лунам
    for (const pl of planets) {
      if (S.stop) break;
      const dir = `p${pl.id}-${safeName(pl.name)}`;
      for (const [name, q] of PER_PLANET) {
        if (S.stop) break;
        const t = await get(`${q}&cp=${pl.id}`, `${dir}/${name}.html`);
        if (t) {
          if (!htmlByKind[name]) htmlByKind[name] = [];
          htmlByKind[name].push(t);
          if (opt('discover')) extra.push(...discoverLinks(t));
        }
      }
    }
    // 2) общие страницы (на стартовой планете)
    const cpQ = S.startCp ? `&cp=${S.startCp}` : '';
    for (const g of GLOBAL) {
      if (S.stop) break;
      const t = await get(`page=${g}${cpQ}`, `00-global/${g}.html`);
      S.seen.add(`page=${g}`);
      if (t && opt('discover')) extra.push(...discoverLinks(t));
    }
    // 3) почта
    if (opt('messages') && !S.stop) {
      await get(`page=messages${cpQ}`, `messages/00-messages.html`);
      for (const [c, n] of MSG_CATS) {
        if (S.stop) break;
        await get(`page=messages&mode=view&messcat=${c}&site=1&ajax=1`, `messages/cat-${c}-${n}.html`, 'ajax');
      }
    }
    // 4) детали объектов
    if (opt('details') && !S.stop) {
      const jobs = [];
      const have = new Set();
      for (const [kind, ajax] of DETAILS) {
        for (const t of htmlByKind[kind] || []) {
          (t.match(/data-technology="(\d+)"/g) || []).forEach((s) => {
            const id = s.match(/\d+/)[0]; const key = ajax + id;
            if (!have.has(key)) { have.add(key); jobs.push([ajax, id]); }
          });
        }
      }
      S.total += jobs.length; progress();
      for (const [ajax, id] of jobs) {
        if (S.stop) break;
        await get(`page=${ajax}&technology=${id}${cpQ}`, `details/${ajax}-${id}.json`, 'ajax');
      }
    }
    // 5) новые страницы по ссылкам (до 60)
    if (opt('discover') && !S.stop) {
      const todo = [...new Set(extra)].filter((q) => !S.seen.has(q)).slice(0, 60);
      S.total += todo.length; progress();
      for (const q of todo) {
        if (S.stop) break;
        if (S.seen.has(q)) { S.done++; continue; }
        await get(`${q}${cpQ}`, `01-discovered/${safeName(q.replace(/^page=/, ''))}.html`);
      }
    }
    // вернуть исходную планету
    if (S.startCp) {
      const wasStop = S.stop; S.stop = false;
      try { await fetch(`${BASE}?page=overview&cp=${S.startCp}`, { credentials: 'include' }); log('restored cp=' + S.startCp); } catch (e) { log('restore cp failed ' + e); }
      S.stop = wasStop;
    }
    finish();
  }

  function finish() {
    const index = {
      tool: 'ogx-pagescan', version: VERSION, universe: UNI, base: BASE, startedAt: S.startedAt, finishedAt: ts(),
      stopped: S.stop, startCp: S.startCp, files: S.files.map((f) => ({ name: f.name, chars: f.data.length })),
      options: { planets: opt('planets'), details: opt('details'), discover: opt('discover'), messages: opt('messages') },
      privacy: { excludedPages: PRIVATE.slice(), scrubbed: ['email addresses', 'values of mail/password inputs', 'textarea contents', 'user agent'] },
    };
    S.files.push({ name: 'index.json', data: JSON.stringify(index, null, 1) });
    S.files.push({ name: 'log.txt', data: S.log.join('\n') + '\n' });
    S.running = false;
    $('[data-go]').disabled = false; $('[data-stop]').disabled = true;
    $('[data-dl]').disabled = S.files.length === 0;
    progress();
    status(`${S.stop ? 'Остановлено' : 'Готово'}: ${S.files.length - 2} страниц. Нажмите «Скачать ZIP».`);
  }

  async function download() {
    status('Упаковываю ZIP…');
    try {
      const blob = await makeZip(S.files);
      const d = new Date(); const p = (n) => String(n).padStart(2, '0');
      const name = `ogx-pagescan-${UNI}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.zip`;
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      status(`Скачан ${name} (${(blob.size / 1048576).toFixed(1)} МБ). Пришлите этот файл Claude.`);
    } catch (e) { status('Не удалось собрать ZIP: ' + e); }
  }

  // ---------- минимальный ZIP (deflate через CompressionStream, иначе без сжатия) ----------
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  async function deflate(u8) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const cs = new CompressionStream('deflate-raw');
      const buf = await new Response(new Blob([u8]).stream().pipeThrough(cs)).arrayBuffer();
      return new Uint8Array(buf);
    } catch (e) { return null; }
  }
  async function makeZip(files) {
    const enc = new TextEncoder(); const parts = []; const central = []; let offset = 0;
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const f of files) {
      const name = enc.encode(f.name); const raw = enc.encode(f.data); const crc = crc32(raw);
      const def = await deflate(raw); const useDef = def && def.length < raw.length;
      const body = useDef ? def : raw; const method = useDef ? 8 : 0;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, method, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, body.length, true); lh.setUint32(22, raw.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(lh, name, body);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, method, true); ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, body.length, true); ch.setUint32(24, raw.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(ch, name);
      offset += 30 + name.length + body.length;
    }
    const cdSize = central.reduce((s, x) => s + (x.byteLength), 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  }

  window.__ogxPageScan = { show: () => { box.style.display = ''; tab.style.display = 'none'; }, state: S, run };
})();
