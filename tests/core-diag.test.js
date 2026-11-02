'use strict';
// Diagnostics: event journal (OGX.log.rec / wrap, capture of page, errors, network, game messages, clicks), redaction,
// ring buffer caps, self-learning alerts on synthetic DOM/API drift, exports (TXT header/summary/lines, 6 MB cap, JSONL,
// snapshots, learning report), popup panel and side-panel mount.
//   node tests/core-diag.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const T = require('./lib');
const { assert } = T;
const { coreExt, ROOT } = require('./core-ext');

function nodeLib() {
  const sb = { console, Date, Math, JSON, URL, URLSearchParams, setTimeout, clearTimeout, TextEncoder };
  sb.self = sb;
  vm.createContext(sb);
  for (const f of ['shared/core/21-diaglib.js', 'shared/popup/diag-panel.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
  return sb;
}

const MODULES = {
  thrower: `OGX.module({ name: 'thrower', title: 'Бросатель', settings: { level: { type: 'int', default: 3, label: 'Уровень' } }, init(ctx) {
      setTimeout(() => { throw new Error('boom-uncaught'); }, 30);
      setTimeout(() => { Promise.reject(new Error('boom-rejection')); }, 40);
      throw new Error('boom-init');
    } });`,
  quiet: `OGX.module({ name: 'quiet', init() {} });`,
};

const J = (x) => JSON.parse(JSON.stringify(x)); // objects from the vm realm -> plain objects
const evq = (env, page, q) => env.evalOgx(page, async (qq) => { await OGX.diag.flush(); const st = await OGX.diag.store(); return (await st.query(qq || {})).events; }, q || {});

// ------------------------------------------------------------------ pure library (node)
T.test('lib: redaction, schema, path normalisation, response kind', async () => {
  const L = nodeLib().OGXDiagLib;
  L.addSecret('Xq2mZ8vR4kL0pT6yB1nW9cE3sH7jD5fA2gU8iO4e');
  const r = L.redact({ password: 'hunter2', _token: 'abc', email: 'x@y.zz', nested: { 'X-CSRF-TOKEN': 'q', newAjaxToken: 'n', note: 'write to john.doe@mail.example.org', ok: 5 },
    url: '/ajax/x?_token=Xq2mZ8vR4kL0pT6yB1nW9cE3sH7jD5fA2gU8iO4e&galaxy=1', text: 'token Xq2mZ8vR4kL0pT6yB1nW9cE3sH7jD5fA2gU8iO4e here', n: NaN, long: 'a'.repeat(900) });
  assert.equal(r.password, '<redacted>');
  assert.equal(r._token, '<redacted>');
  assert.equal(r.email, '<redacted>');
  assert.equal(r.nested['X-CSRF-TOKEN'], '<redacted>');
  assert.equal(r.nested.newAjaxToken, '<redacted>');
  assert.equal(r.nested.note, 'write to <email>');
  assert.equal(r.nested.ok, 5);
  assert.ok(!JSON.stringify(r).includes('Xq2mZ8vR4kL0pT6yB1nW9cE3sH7jD5fA2gU8iO4e'), JSON.stringify(r));
  assert.match(r.url, /_token=<(redacted|csrf)>&galaxy=1/);
  assert.equal(r.n, 'NaN');
  assert.ok(r.long.length < 600 && r.long.endsWith('…(900)'));
  assert.deepEqual(J(L.formSummary('_token=abc&galaxy=1&am202=5&password=p&email=a%40b.cc')), { _token: '<redacted>', galaxy: '1', am202: '5', password: '<redacted>', email: '<redacted>' });
  assert.deepEqual(J(L.formSummary('text=hello&subject=s&empfaenger=Bob&galaxy=1')), { text: '<redacted>', subject: '<redacted>', empfaenger: '<redacted>', galaxy: '1' }, 'free text masked');
  assert.equal(L.redactUrl('http://h/ajax/messages?tab=2&_token=zz&csrf_token=1'), '/ajax/messages?tab=2&_token=<redacted>&csrf_token=<redacted>');
  assert.equal(L.normalizePath('/ajax/messages/123/'), '/ajax/messages/:id');
  assert.equal(L.normalizePath('http://h:1/ajax/galaxy?x=1'), '/ajax/galaxy');
  assert.deepEqual(J(L.jsonSchema({ success: true, errors: [{ message: 'm', error: 1 }], data: { '123': { a: 1 } }, newAjaxToken: 't' })),
    ['data', 'data.#', 'data.#.a', 'errors', 'errors[].error', 'errors[].message', 'newAjaxToken', 'success']);
  assert.deepEqual(J(L.safeFields({ success: false, errors: [{ message: 'Not enough ships', error: 140019 }], newAjaxToken: 'secret', big: { x: 1 } })),
    { success: false, newAjaxToken: '<redacted>', errors: ['Not enough ships'] });
  assert.equal(L.responseKind(200, { success: true }), 'ok');
  assert.equal(L.responseKind(200, { success: false }), 'err');
  assert.equal(L.responseKind(200, { status: 'failure' }), 'err');
  assert.equal(L.responseKind(500, null), 'err');
  // GALAXYZ fleetAjax (specs/galaxyz/fixtures/fleet-upstream-fleetAjax-*.json): 600 sent, 6xx refused with its own shape
  assert.equal(L.responseKind(200, { slots: 2, ships: { 210: 99 }, code: 600, mess: 'Send 3 Spy Probe to 2:70:9 ...' }), 'ok');
  assert.equal(L.responseKind(200, { slots: 13, code: 612, mess: 'Fault, not enough fleet Slots' }), 'refused:612');
  assert.equal(L.responseKind(200, { code: '601', mess: 'x' }), 'refused:601');
  assert.equal(L.responseKind(200, { code: 0, mess: 'x' }), 'ok');
  assert.equal(L.responseKind(200, { code: 612, success: false }), 'refused:612');
  // only alerts that mean something is wrong count as L errors
  const t0 = Date.now();
  assert.deepEqual(L.errorCounters(['api-new', 'api-key-new', 'ship-speed', 'event-style', 'implausible', 'tokens-gone', 'selector-miss', 'api-key-lost'].map((k) => ({ t: t0, s: 'L', k })), t0).L, 4);
  // the page hook's copy of jsonSchema must give the same result
  const hook = fs.readFileSync(path.join(ROOT, 'shared/main/page-hook.js'), 'utf8');
  const lib = fs.readFileSync(path.join(ROOT, 'shared/core/21-diaglib.js'), 'utf8');
  const body = (src, re) => { const m = re.exec(src); assert.ok(m, 'jsonSchema body'); return m[1].replace(/\s+/g, ' '); };
  assert.equal(body(hook, /function jsonSchema\(json, maxDepth = 3, max = 200\) \{([\s\S]*?)\n  \}\n/), body(lib, /L\.jsonSchema = function \(json, maxDepth = 3, max = 200\) \{([\s\S]*?)\n  \};\n/));
  // popup CSS file = OGXDiagPanel.CSS
  const sb = nodeLib();
  const css = fs.readFileSync(path.join(ROOT, 'shared/popup/diag-panel.css'), 'utf8');
  assert.ok(css.endsWith(sb.OGXDiagPanel.CSS), 'diag-panel.css matches OGXDiagPanel.CSS');
});

T.test('lib: TXT export format, summary, 6 MB cap keeps the newest events and says what was cut', async () => {
  const L = nodeLib().OGXDiagLib;
  const t0 = new Date(2026, 9, 30, 1, 2, 3, 45).getTime();
  const events = [
    { id: 1, t: t0, s: 'S', k: 'page', w: 'overview', p: 'overview', tab: 'ab12', d: { path: '/overview' } },
    { id: 2, t: t0 + 10, s: 'N', k: 'req', w: 'POST /ajax/galaxy', p: 'overview', tab: 'ab12', d: { st: 200, ms: 120, by: 'page' } },
    { id: 3, t: t0 + 20, s: 'N', k: 'req', w: 'POST /ajax/galaxy', p: 'overview', tab: 'ab12', d: { st: 500, ms: 80, by: 'ogx', err: 'http 500' } },
    { id: 4, t: t0 + 30, s: 'G', k: 'fadeBox', w: 'Not enough ships', p: 'fleet', tab: 'ab12', d: { failed: true } },
    { id: 5, t: t0 + 40, s: 'S', k: 'error', w: 'spy', p: 'fleet', tab: 'cd34', d: { msg: 'spy failed: TypeError: x is undefined' } },
    { id: 6, t: t0 + 50, s: 'L', k: 'selector-miss', w: 'fleet: селектор «#continue» не найден', p: 'fleet', tab: 'cd34', d: { key: 'sel-miss:fleet:#continue' } },
    { id: 7, t: t0 + 60, s: 'U', k: 'click', w: 'Отправить', p: 'fleet', tab: 'cd34' },
    { id: 8, t: t0 + 70, s: 'B', k: 'api', w: 'sendFleet', p: 'fleet', tab: 'cd34', d: { ms: 90, ok: false } },
  ];
  const ctx = { ext: 'live', extName: 'OgameX Live', extVersion: '0.1.0', coreVersion: '0.1.0', host: 'ogx.example:8080', playerId: 108, playerClass: 'miner',
    server: { economySpeed: 8, fleetSpeedWar: 2 }, modules: [{ name: 'planetbar', enabled: true, active: true, settings: { prodDisplay: 'hour' } }, { name: 'timeline', enabled: false }], ua: 'TestUA/1' };
  const r = L.buildTxt({ ctx, events, exportKind: 'за сегодня', now: t0 + 100 });
  const lines = r.text.split('\n');
  assert.match(lines[0], /^=== OGX журнал для разбора/);
  assert.ok(r.text.includes('Расширение: OgameX Live 0.1.0'));
  assert.ok(r.text.includes('Браузер: TestUA/1'));
  assert.ok(r.text.includes('Сервер: ogx.example:8080'));
  assert.ok(r.text.includes('Игрок: id 108  класс miner'));
  assert.ok(r.text.includes('Настройки сервера: {"economySpeed":8,"fleetSpeedWar":2}'));
  assert.ok(r.text.includes('  + planetbar (активен') && r.text.includes('  - timeline'));
  assert.ok(r.text.includes('Ошибки за 10 мин: U=0 B=1 S=1 N=1 G=1 L=1'), r.text);
  const sumAt = lines.indexOf('=== SUMMARY ===');
  const evAt = lines.indexOf('=== EVENTS ===');
  assert.ok(sumAt > 0 && evAt > sumAt);
  const summary = lines.slice(sumAt, evAt).join('\n');
  assert.match(summary, /\[N\] 2: req×2/);
  assert.match(summary, /POST \/ajax\/galaxy {2}n=2 avg=100ms err=1 ogx=1/);
  assert.match(summary, /1× fadeBox: Not enough ships/);
  assert.match(summary, /1× \[S\] error: spy — spy failed: TypeError/);
  assert.match(summary, /selector-miss: fleet: селектор/);
  const evLines = lines.slice(evAt + 1).filter(Boolean);
  assert.equal(evLines[0], '--- 2026-10-30 ---');
  assert.equal(evLines[1], '01:02:03.045 [S] page: overview {"path":"/overview","pg":"overview","tb":"ab12"}');
  assert.equal(evLines[2], '01:02:03.055 [N] req: POST /ajax/galaxy {"st":200,"ms":120,"by":"page"}');
  assert.equal(evLines[4], '01:02:03.075 [G] fadeBox: Not enough ships {"failed":true,"pg":"fleet"}');
  assert.equal(evLines[7], '01:02:03.105 [U] click: Отправить');
  for (const l of evLines.slice(1)) assert.match(l, /^\d\d:\d\d:\d\d\.\d{3} \[[USBNGL]\] [\w-]+: /);
  assert.equal(r.included, 8);
  assert.equal(r.maxId, 8);
  // cap: 20 000 events of ~600 bytes (> 11 MB) -> at most 6 MB, the newest kept, header says what was cut
  const big = [];
  for (let i = 1; i <= 20000; i++) big.push({ id: i, t: t0 + i * 1000, s: 'N', k: 'req', w: 'GET /ajax/fleet/eventbox/fetch', p: 'overview', tab: 't', d: { st: 200, pad: 'х'.repeat(280) } });
  const c = L.buildTxt({ ctx, events: big, cut: 7, exportKind: 'JSONL', now: t0 + 30000000 });
  assert.ok(L.utf8Len(c.text) <= 6 * 1024 * 1024, 'size ' + L.utf8Len(c.text));
  assert.ok(c.included > 5000 && c.included < 20000, 'included ' + c.included);
  assert.ok(c.text.includes(`ОБРЕЗАНО: ${20000 - c.included + 7} старых событий`), c.text.slice(0, 2000));
  assert.ok(c.text.trimEnd().endsWith(L.eventLine(big[19999], big[19998])), 'newest event is the last line');
  // JSONL
  const j = L.buildJsonl({ ctx, events });
  const jl = j.text.trim().split('\n').map((x) => JSON.parse(x));
  assert.equal(jl[0]._header.format, 'ogx-diag-jsonl');
  assert.equal(jl.length, 9);
  assert.deepEqual(jl[8], events[7]);
});

T.test('lib: learning report and snapshots HTML', async () => {
  const L = nodeLib().OGXDiagLib;
  const st = { v: 1, t0: Date.now() - 1000, apiTotal: 12, pages: { fleet: { visits: 10, lastT: Date.now(), tokens: { '#continue': [9, 1, 1, 9], '#new': [2, 0, 9, 10] }, sels: { '#continue': [10, 7, 3], '#cutty': [10, 0, 10], '#sendall': [3, 0, 3] } } },
    api: { 'POST /ajax/galaxy': { n: 12, first: Date.now(), last: Date.now(), kinds: { ok: { n: 12, keys: { success: 12, system: 11 } } } } }, alerts: {}, alertLog: [{ t: Date.now(), key: 'k', kind: 'selector-miss', what: 'fleet: x' }] };
  const rep = L.learnReport(st, { host: 'h:1' });
  assert.ok(rep.includes('=== СТРАНИЦЫ ===') && rep.includes('--- fleet: визитов 10'));
  assert.ok(rep.includes('70%  7/10  streak=3  #continue'));
  // never-found selectors (other engine's markup) are one compact line, not 0% rows that drown the useful ones
  assert.ok(!/0%\s+0\/\d+\s+streak=\d+\s+#cutty/.test(rep), rep);
  assert.ok(rep.includes('ни разу не найдены на этой странице (проверки чужой разметки, не поломка): 2 — #cutty, #sendall'), rep);
  assert.ok(rep.includes('POST /ajax/galaxy: ответов 12') && rep.includes('success, system 92%'));
  assert.ok(rep.includes('selector-miss: fleet: x'));
  const h = L.buildSnapshotsHtml({ ctx: { host: 'h:1' }, snaps: [{ id: 3, t: Date.now(), page: 'fleet', reason: 'learn: a', url: '/fleet', size: 40, html: '<html><body><template>x</template><p>hi</p></body></html>' }] });
  assert.ok(h.text.includes('<!-- ===== OGX SNAPSHOT #3 '));
  assert.ok(h.text.includes('<template id="snap-3">'));
  assert.ok(h.text.includes('<template>x<\\/template><p>hi</p>'), 'nested template end escaped');
});

/** Events of a real exported journal (TXT lines "HH:MM:SS.mmm [K] kind: what {json}") -> store events. */
function journalEvents(file, day = new Date(2026, 9, 31)) {
  const out = [];
  let p = null; let tab = null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^(\d\d):(\d\d):(\d\d)\.(\d{3}) \[([USBNGL])\] ([^:]+): (.*)$/.exec(line);
    if (!m) continue;
    let w = m[7]; let d;
    const j = w.indexOf(' {');
    if (w.startsWith('{')) { try { d = JSON.parse(w); w = ''; } catch (e) { /* text */ } }
    else if (j >= 0) { try { d = JSON.parse(w.slice(j + 1)); w = w.slice(0, j); } catch (e) { d = undefined; } }
    if (d && d.pg !== undefined) { p = d.pg; delete d.pg; }
    if (d && d.tb !== undefined) { tab = d.tb; delete d.tb; }
    if (d && !Object.keys(d).length) d = undefined;
    const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), +m[1], +m[2], +m[3], +m[4]).getTime();
    const ev = { id: out.length + 1, t, s: m[5], k: m[6], w, p, tab };
    if (d !== undefined) ev.d = d;
    out.push(ev);
  }
  return out;
}

T.test('lib: one-file export «Выгрузить логи» on the live journal: every key event kept, routine trimmed, compact snapshots, settings, bot', async () => {
  const L = nodeLib().OGXDiagLib;
  const events = journalEvents(path.join(ROOT, 'fixtures/diag/live-journal-2026-10-31.txt'));
  assert.ok(events.length > 2900, 'live events ' + events.length);
  const key = events.filter((e) => L.isKeyEvent(e));
  assert.ok(key.length > 600 && key.some((e) => e.s === 'U') && key.some((e) => e.s === 'L'), 'key events in the live sample: ' + key.length);
  const now = events[events.length - 1].t + 1000;
  const html = '<!doctype html>\n<html><head><style>.a{color:red}\n.b{}</style></head><body>\n\n   <div   class="x">   <svg><path d="M0 0"/></svg>\n<!-- comment -->  <span>15</span></div>\n</body></html>';
  const snaps = [
    { id: 1, t: now - 3 * 86400000, page: 'galaxy', reason: 'learn: old', url: '/g', html },
    { id: 2, t: now - 5000, page: 'buildings', reason: 'learn: tokens-gone:buildings:.x', url: '/b', html },
    { id: 3, t: now - 4000, page: 'buildings', reason: 'learn: tokens-gone:buildings:.x', url: '/b', html },
    { id: 4, t: now - 3000, page: 'overview', reason: 'manual', url: '/o', html: html + 'x'.repeat(4 * 1024 * 1024) },
  ];
  const ctx = { ext: 'suite', extName: 'OgameX Suite', extVersion: '0.3.2', coreVersion: '0.2.0', host: 'ogamex.eu', playerId: 4377, engine: 'galaxyz', universe: 'Aeternum',
    server: { engine: 'galaxyz', fleetSpeed: 7 }, modules: [{ name: 'infinity/flights', enabled: true, active: true, settings: { titleAlert: true } }], core: { tickMs: 1000 } };
  const extras = { settings: { 'ogamex.eu|4377|settings': { flights: { titleAlert: true }, core: { password: 'hunter2' } } }, bot: { 'ogamex.eu|4377|bot.decisions': [{ t: 1, act: 'wait' }] } };
  const learn = { t0: 1, apiTotal: 3, pages: { galaxy: { visits: 20, lastT: now, tokens: { '#OvfleetEvents': [19, 3, 1, 17], '.ownattack': [2, 0, 12, 20], '#galaxy': [19, 3, 1, 17] }, sels: {} } }, api: {}, alertLog: [] };
  const maxBytes = 300 * 1024;
  const r = L.buildFull({ ctx, events, learn, snaps, extras, now, maxBytes });
  const text = r.text;
  const lines = text.split('\n');
  assert.match(lines[0], /^=== OGX полная выгрузка для разбора/);
  assert.ok(text.includes('Расширение: OgameX Suite 0.3.2 (ядро 0.2.0)') && text.includes('Сервер: ogamex.eu') && text.includes('  + infinity/flights (активен'), text.slice(0, 1500));
  assert.match(text, /Состав: журнал \d+ из \d+ событий за сегодня \(не вошли \d+ рядовых/);
  for (const sec of ['=== НАСТРОЙКИ (все, JSON) ===', '=== БОТ (решения и состояние, JSON) ===', '=== ОТЧЁТ САМООБУЧЕНИЯ ===', '=== SUMMARY (журнал за сегодня целиком) ===', '=== EVENTS ===', '=== СНИМКИ СТРАНИЦ ===', '=== КОНЕЦ ВЫГРУЗКИ ===']) assert.ok(lines.includes(sec), sec);
  assert.ok(text.includes('"titleAlert":true') && !text.includes('hunter2') && text.includes('bot.decisions'), 'settings JSON redacted, bot data');
  // the summary counts the whole day, the journal part fits its budget
  assert.ok(text.includes(`flights×${events.filter((e) => e.k === 'flights').length}`), 'summary over all events');
  assert.ok(L.utf8Len(text) <= maxBytes + 64 * 1024, 'size ' + L.utf8Len(text));
  // secrets never leave in the file: session cookies, token query values, emails, registered CSRF token, core settings keys
  {
    L.addSecret('csrfLiveToken0123456789');
    const sec = [{ id: 1, t: now - 100, s: 'S', k: 'error', a: 'x', d: { msg: 'Cookie: PHPSESSID=abc123secret; 2Moons=def456secret; x_session=zzz999 csrfLiveToken0123456789 ?token=qqq777 john@example.com' } }];
    const r2 = L.buildFull({ ctx: Object.assign({}, ctx, { core: { apiToken: 'tok-777-secret', tickMs: 1000 } }), events: sec, now, maxBytes });
    for (const bad of ['abc123secret', 'def456secret', 'zzz999', 'csrfLiveToken0123456789', 'qqq777', 'john@example.com', 'tok-777-secret']) assert.ok(!r2.text.includes(bad), 'leaked ' + bad);
    assert.ok(r2.text.includes('"tickMs":1000'), 'core settings still listed');
    // a huge learn report cannot blow the file past its cap
    const bigLearn = { t0: 1, pages: {}, api: {}, alertLog: [] };
    for (let i = 0; i < 3000; i++) bigLearn.pages['p' + i] = { visits: 5, lastT: now, tokens: Object.fromEntries(Array.from({ length: 30 }, (_, k) => ['.tok' + i + '_' + k + 'x'.repeat(40), [5, 4, 9, 1]])), sels: {} };
    const r3 = L.buildFull({ ctx, events, learn: bigLearn, now, maxBytes });
    assert.ok(L.utf8Len(r3.text) <= maxBytes + 128 * 1024, 'capped ' + L.utf8Len(r3.text));
  }
  const evPart = text.slice(text.indexOf('=== EVENTS ===\n'), text.indexOf('\n=== СНИМКИ СТРАНИЦ ==='));
  // every user action, page/session line, game message, learning alert and error is in the file
  let prev = null;
  for (const e of key) { assert.ok(evPart.includes(L.fmtTime(e.t) + ' [' + e.s + '] ' + e.k + ':'), 'key event kept: ' + L.eventLine(e, prev)); prev = e; }
  assert.ok(r.info.dropped > 0 && r.info.events + r.info.dropped === events.length, JSON.stringify(r.info));
  assert.match(evPart, /… пропущено рядовых событий: \d+ …/);
  // the newest routine events are kept
  const lastB = events.filter((e) => !L.isKeyEvent(e)).pop();
  assert.ok(evPart.includes(L.fmtTime(lastB.t) + ' [B] ' + lastB.k + ':'), 'newest routine event kept');
  // snapshots: newest per page+reason, today only, compact, the huge one skipped for the byte budget only if needed
  assert.ok(text.includes('----- СНИМОК #3 ') && !text.includes('----- СНИМОК #2 ') && !text.includes('----- СНИМОК #1 '), 'one per page+reason, today');
  const sn = text.slice(text.indexOf('----- СНИМОК #3 '), text.indexOf('----- КОНЕЦ СНИМКА #3'));
  assert.ok(sn.includes('<style></style>') && sn.includes('<svg></svg>') && !sn.includes('<!-- comment -->') && !/\n\s*\n/.test(sn) && sn.includes('<span>15</span>'), sn);
  // learning report inside: volatile event-box / mission tokens are not reported as drift
  const rep = text.slice(text.indexOf('=== ОТЧЁТ САМООБУЧЕНИЯ ==='), text.indexOf('=== SUMMARY'));
  assert.ok(rep.includes('#galaxy×3') && !rep.includes('#OvfleetEvents') && !rep.includes('.ownattack'), rep);
  // compact HTML, volatile tokens
  assert.equal(L.compactHtml('<p>\n\n   a   b</p><style>x{}</style>'), '<p>\na b</p><style></style>');
  for (const t of ['#OvfleetEvents', '#OvfleetContent', '#eventboxLoading', '#fleettime_#', '.OvfleetButton', '.OvfleetEvents_', '[data-fleet-end-time]', '[data-fleet-time]', '[data-hide]',
    '.ownattack', '.owndeploy', '.ownexpo', '.ownharvest', '.owntransport', '.ownespionage', '.t_Tooltip', '.t_ContentContainer', '.bi-building-fill-up', '.buildingIco', '.new-msg-count', '.allFleetsEvent', '.res_current_warn',
    // queue / officer / galaxy-row state of normal play (parsers-learn-8)
    '#progressbar', '#progressbars', '#time', '#time#', '#Countdown', '.timer', '.ui-progressbar', '.ui-widget', '.ui-widget-content', '.ui-corner-all', '.ui-progressbar-value',
    '[data-cancel-message]', '.slide-up', '.commander', '.glows', '.action', '.allytag', '.debris', '.galaxy-short', '.galaxy-username', '.galaxy-username-inactive',
    '.microplanet#', '.moon', '.planetname#', '.playername', '.spacer##']) assert.ok(L.isVolatileToken(t), t);
  for (const t of ['#planet', '.technology', '[data-technology]', '.galaxy-alliance', '.infobox', '.construction-queue-item', '.build-icon', 'meta:csrf-token', '#galaxy',
    '#timer-box', '.moonlink', '.ogx-test-new', '.actions', '[data-status]']) assert.ok(!L.isVolatileToken(t), t);
  // no bot data -> an explicit line
  assert.ok(L.buildFull({ ctx, events: events.slice(0, 5), now }).text.includes('нет данных бота'));
});

T.test('lib: learn alert lists survive redaction; JSONL cap counts the real header; allow-list header; popup backend context', async () => {
  const sb = nodeLib();
  const L = sb.OGXDiagLib;
  // the markup token list of tokens-gone/new alerts is not a secret (plural 'tokens'); real tokens still are
  const r = J(L.redact({ page: 'overview', tokens: ['#moon', '.hightlightPlanet'], visits: 9, token: 'a', _token: 'b', newAjaxToken: 'c', remember_token: 'd', csrfTokens: 'e' }));
  assert.deepEqual(r.tokens, ['#moon', '.hightlightPlanet']);
  for (const k of ['token', '_token', 'newAjaxToken', 'remember_token', 'csrfTokens']) assert.equal(r[k], '<redacted>', k);
  // JSONL: a large header (suite: 17 modules with settings) must not push the file over the cap
  const ctx = { extName: 'OgameX Suite', host: 'h:1', ua: 'x'.repeat(300), modules: Array.from({ length: 17 }, (_, i) => ({ name: 'infinity/mod' + i, enabled: true, active: true, settings: { a: 'y'.repeat(200), b: i } })) };
  const events = Array.from({ length: 60000 }, (_, i) => ({ id: i + 1, t: 1e12 + i, s: 'N', k: 'req', w: 'GET /ajax/fleet/eventbox/fetch', p: 'overview', tab: 'ab12', d: { st: 200, ms: 5, by: 'page' } }));
  const maxBytes = 6291456;
  const head = L.utf8Len(JSON.stringify({ _header: ctx }));
  assert.ok(head > 4096, 'header is larger than the old fixed reserve: ' + head);
  const j = L.buildJsonl({ ctx, events, maxBytes });
  assert.ok(L.utf8Len(j.text) <= maxBytes, 'jsonl ' + L.utf8Len(j.text) + ' <= ' + maxBytes);
  assert.ok(j.included > 0 && j.dropped > 0 && j.included + j.dropped === events.length);
  assert.equal(JSON.parse(j.text.split('\n')[0])._header.cut, j.dropped);
  // allow-list helper = loader rules
  assert.equal(L.hostInList('localhost:8080', ['localhost']), true);
  assert.equal(L.hostInList('a.ogx.org', ['*.ogx.org']), true);
  assert.equal(L.hostInList('ogx.org:81', ['ogx.org:80']), false);
  assert.equal(L.hostInList('h:1', []), false);
  const lines = L.headerLines({ host: 'h:1', allowHosts: ['ogx.example.org'], globalOff: ['planetbar'], modules: [{ name: 'live/planetbar', enabled: false, globalOff: true }] }, []);
  assert.ok(lines.some((l) => l.startsWith('Серверы (allow-list): ogx.example.org') && l.includes('h:1 не в списке')), lines.join('\n'));
  assert.ok(lines.includes('Выключено глобально (попап): planetbar'), lines.join('\n'));
  assert.ok(lines.includes('  - live/planetbar (выключен в попапе)'), lines.join('\n'));
  assert.ok(L.headerLines({ allowHosts: [] }, []).includes('Серверы (allow-list): список пуст — работает на всех игровых страницах (GALAXYZ/2Moons и OgameX)'));
  // popup backend: the popup's own switches are read now, not from the (possibly stale) diag.ctx
  const store = { 'h:1|7|diag.ctx': { t: 1e12, host: 'h:1', modules: [{ name: 'live/planetbar', enabled: true }, { name: 'infinity/panel', enabled: true }] },
    '*|*|suite.hosts': ['ogx.example.org'], '*|*|suite.modules': { planetbar: false, panel: true } };
  sb.chrome = { storage: { local: { get: (k, cb) => cb(store) } }, runtime: { getManifest: () => ({ name: 'OgameX Suite', version: '9.9.9' }) } };
  const c = J(await sb.OGXDiagPanel.extensionBackend().context());
  assert.deepEqual(c.allowHosts, ['ogx.example.org']);
  assert.deepEqual(c.globalOff, ['planetbar']);
  assert.deepEqual(c.modules.map((m) => m.name + ':' + m.enabled), ['live/planetbar:false', 'infinity/panel:true']);
  assert.match(c.ctxNote, /может быть устаревшим/);
  const noCtx = J(await (() => { delete store['h:1|7|diag.ctx']; return sb.OGXDiagPanel.extensionBackend().context(); })());
  assert.match(noCtx.ctxNote, /ни разу/);
});

T.test('popup export: the stored bot data of every bot module (botcore.*, botfarm.*, botbuild.*, bot.*) is in extras, other hosts / modules not', async () => {
  const sb = nodeLib();
  const store = {
    'ogamex.eu|123|botcore.status': { leader: true }, 'ogamex.eu|123|botcore.journal': ['line'], 'ogamex.eu|123|botfarm.targets': { a: 1 },
    'ogamex.eu|123|botbuild.plan': { p: 1 }, 'ogamex.eu|123|botsave.saves': {}, 'ogamex.eu|123|botdebris.plans': [], 'ogamex.eu|123|botexpo.state': {},
    'ogamex.eu|123|bot.legacy': 1, 'ogamex.eu|123|settings': { botcore: { master: false } }, 'ogamex.eu|123|spy.reports': { items: {} },
    'other.host|9|botcore.status': { leader: false },
  };
  sb.chrome = { storage: { local: { get: (k, cb) => cb(store) } }, runtime: { getManifest: () => ({ name: 'OgameX Suite', version: '9.9.9' }) } };
  const x = J(await sb.OGXDiagPanel.extensionBackend().extras('ogamex.eu'));
  assert.deepEqual(Object.keys(x.bot).sort(), ['ogamex.eu|123|bot.legacy', 'ogamex.eu|123|botbuild.plan', 'ogamex.eu|123|botcore.journal', 'ogamex.eu|123|botcore.status',
    'ogamex.eu|123|botdebris.plans', 'ogamex.eu|123|botexpo.state', 'ogamex.eu|123|botfarm.targets', 'ogamex.eu|123|botsave.saves']);
  assert.deepEqual(Object.keys(x.settings), ['ogamex.eu|123|settings']);
});

// ------------------------------------------------------------------ in the browser
T.test('journal: page, ready, module-init failure with stack, uncaught + rejection, wrap, api actions; redaction in events', async () => {
  const env = await T.launch({ ext: coreExt({ modules: MODULES }), scenario: 'vega' });
  const page = await env.open('/overview');
  await page.waitForTimeout(300);
  const r = await env.evalOgx(page, async () => {
    const tok = OGX.http.csrf();
    OGX.log.rec('U', 'click', 'Кнопка ' + tok, { password: 'hunter2', email: 'me@example.org', note: 'mail me: john@x.org', url: '/x?_token=abc&ok=1', token: tok });
    const w = OGX.log.wrap('probe', async (x) => ({ success: false, x }), 'doThing');
    await w(5);
    await OGX.log.wrap('probe', async () => ({ success: false, message: 'на планете нет шпионских зондов' }), 'refuse')();
    const thrower = OGX.log.wrap('probe', () => { throw new Error('wrapped-fail'); }, 'explode');
    let rethrown = false;
    try { thrower(); } catch (e) { rethrown = e.message === 'wrapped-fail'; }
    const sync = OGX.log.wrap('probe', (a, b) => a + b, 'add')(2, 3);
    await OGX.api.sendFleet({ galaxy: 1, system: 42, position: 9, type: 1, mission: 3, ships: { 202: 1 }, cargo: { metal: 10 } });
    await OGX.diag.flush();
    return { rethrown, sync, tok, kind: (await OGX.diag.store()).kind };
  });
  assert.equal(r.rethrown, true);
  assert.equal(r.sync, 5);
  assert.equal(r.kind, env.mode === 'extension' ? 'bg' : 'idb', 'extension: background store; inject: page-origin IndexedDB');
  const evs = await evq(env, page);
  const find = (s, k, w) => evs.filter((e) => e.s === s && e.k === k && (w === undefined || (w instanceof RegExp ? w.test(e.w) : e.w === w)));
  // page + ready
  assert.ok(find('S', 'page', 'overview').length >= 1);   // the harness probe visited /overview too (IndexedDB is not wiped)
  const ready = find('S', 'ready', 'overview').pop();
  assert.ok(ready && ready.d.modules && 'thrower' in ready.d.modules && 'quiet' in ready.d.modules, JSON.stringify(ready));
  assert.equal(find('S', 'page').pop().d.player, 108);
  // module init failure with stack
  const mf = find('S', 'module-init-fail', 'thrower')[0];
  assert.ok(mf && mf.d.error.message === 'boom-init' && /thrower/.test(mf.d.error.stack), JSON.stringify(mf));
  assert.ok(find('S', 'error', 'thrower').some((e) => /boom-init/.test(e.d.msg)));
  // uncaught error and unhandled rejection from our module file
  assert.ok(find('S', 'uncaught').some((e) => /boom-uncaught/.test(e.d.msg) && e.d.stack), JSON.stringify(evs.filter((e) => e.s === 'S').map((e) => e.k + ':' + e.w)));
  assert.ok(find('S', 'rejection').some((e) => /boom-rejection/.test(e.d.msg)));
  // wrap
  const dt = find('B', 'probe', 'doThing')[0];
  assert.ok(dt && dt.d.ok === false && Number.isFinite(dt.d.ms), JSON.stringify(dt));
  assert.equal(dt.d.err, 'отказ', 'a refusal without a message is not journaled as "undefined"');
  assert.equal(find('B', 'probe', 'refuse')[0].d.err, 'на планете нет шпионских зондов', 'a refusal journals its message');
  assert.ok(find('B', 'probe', 'explode')[0].d.err === 'wrapped-fail');
  assert.ok(find('S', 'error', 'probe:explode').length === 1);
  assert.equal(find('B', 'probe', 'add')[0].d.r, 5);
  // core action helper recorded as B + its request as N (by ogx), form redacted
  assert.ok(find('B', 'api', 'sendFleet').length === 1);
  const sf = find('N', 'req', 'POST /ajax/fleet/dispatch/send-fleet')[0];
  assert.ok(sf, JSON.stringify(evs.filter((e) => e.s === 'N')));
  assert.equal(sf.d.by, 'ogx');
  assert.equal(sf.d.st, 200);
  assert.equal(sf.d.f._token, '<redacted>');
  assert.equal(sf.d.f.am202, '1');
  assert.ok(sf.d.r && sf.d.r.success === true, JSON.stringify(sf.d));
  // redaction of the U event
  const u = find('U', 'click')[0];
  assert.equal(u.w, 'Кнопка <csrf>');
  assert.equal(u.d.password, '<redacted>');
  assert.equal(u.d.email, '<redacted>');
  assert.equal(u.d.token, '<redacted>');
  assert.equal(u.d.note, 'mail me: <email>');
  assert.equal(u.d.url, '/x?_token=<redacted>&ok=1');
  assert.ok(!JSON.stringify(evs).includes(r.tok), 'the CSRF token never reaches the journal');
  // every event carries page, ext and tab
  assert.ok(evs.every((e) => e.x === 'live' && e.tab && e.id > 0 && e.t > 0));
});

T.test('journal: game network (fetch + XHR via the page hook), game messages, clicks in our UI, toggles', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega' });
  const page = await env.open('/overview');
  await page.evaluate(async () => {
    const tok = document.querySelector('meta[name="csrf-token"]').content;
    await fetch('/ajax/fleet/eventbox/fetch', { headers: { 'X-Requested-With': 'XMLHttpRequest' } }).then((r) => r.text());
    await new Promise((res) => {
      const x = new XMLHttpRequest();
      x.open('POST', '/ajax/galaxy');
      x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
      x.onloadend = res;
      x.send('galaxy=1&system=42&_token=' + tok);
    });
    await fetch('/ajax/messages/987654?tab=2&_token=' + tok).then((r) => r.text()).catch(() => null);
    document.getElementById('fadeBoxStyle').className = 'failed';
    document.getElementById('fadeBoxContent').innerHTML = 'Not enough deuterium! <b>x</b>';
  });
  await env.evalOgx(page, () => {
    const b = OGX.dom.h('button', { class: 'ogx-btn ogx-l-probe-go', id: 'ogx-probe-btn', title: 'Пуск' }, 'Пуск');
    const c = OGX.dom.h('input', { type: 'checkbox', class: 'ogx-l-probe-chk', id: 'ogx-probe-chk', name: 'probe.flag' });
    const t = OGX.dom.h('input', { type: 'text', class: 'ogx-l-probe-note', id: 'ogx-probe-note', name: 'note' });
    document.body.append(b, c, t);
    return true;
  });
  await page.click('#ogx-probe-btn');
  await page.click('#ogx-probe-chk');
  await page.fill('#ogx-probe-note', 'secret note');
  await page.focus('#ogx-probe-btn');   // blur -> change
  await page.click('#planetList');    // a game element: not recorded
  await page.waitForTimeout(400);
  const evs = await evq(env, page);
  const n = evs.filter((e) => e.s === 'N');
  const eb = n.find((e) => e.w === 'GET /ajax/fleet/eventbox/fetch');
  assert.ok(eb && eb.d.by === 'page' && eb.d.st === 200 && eb.d.sz > 0 && Number.isFinite(eb.d.ms), JSON.stringify(n));
  const gx = n.find((e) => e.w === 'POST /ajax/galaxy');
  assert.ok(gx && gx.d.f && gx.d.f._token === '<redacted>' && gx.d.f.system === '42', JSON.stringify(gx));
  const msg = n.find((e) => e.w === 'GET /ajax/messages/:id');
  assert.ok(msg && /_token=<redacted>/.test(msg.d.q) && /tab=2/.test(msg.d.q), JSON.stringify(msg));
  const g = evs.find((e) => e.s === 'G' && e.k === 'fadeBox');
  assert.ok(g && g.w === 'Not enough deuterium! x' && g.d.failed === true, JSON.stringify(evs.filter((e) => e.s === 'G')));
  const clicks = evs.filter((e) => e.s === 'U');
  assert.deepEqual(clicks.map((e) => e.k + ':' + e.w), ['click:Пуск', 'change:probe.flag', 'change:note'], JSON.stringify(clicks));
  assert.equal(clicks[0].d.mod, 'live/probe');
  assert.equal(clicks[1].d.v, true);
  assert.equal(clicks[2].d.len, 11);
  assert.ok(!JSON.stringify(evs).includes('secret note'));
  // the API schema of the game's requests is learned
  const api = await env.evalOgx(page, () => Object.keys(OGX.learn.state().api).sort());
  assert.ok(api.includes('GET /ajax/fleet/eventbox/fetch') && api.includes('POST /ajax/galaxy'), api.join(', '));
  // toggles
  const t = await env.evalOgx(page, async () => {
    await OGX.settings.set('diag.network', false);
    await fetch('/ajax/fleet/eventbox/fetch').then((r) => r.text());
    await OGX.http.get('/ajax/fleet/eventbox/fetch');
    const a = OGX.log.rec('B', 'x', 'still on');
    await OGX.settings.set('diag.journal', false);
    const b = OGX.log.rec('B', 'x', 'off');
    await OGX.settings.set('diag.journal', true);
    await OGX.settings.set('diag.network', true);
    return { a: !!a, b };
  });
  assert.deepEqual(t, { a: true, b: null });
  const after = await evq(env, page, { sinceId: evs[evs.length - 1].id });
  assert.equal(after.filter((e) => e.s === 'N').length, 0, JSON.stringify(after));
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('journal: requests the game sends before boot are kept (page hook queue); notify boxes are errors only with the game error head', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega', gameJs: true });
  let page = await env.open('/galaxy');
  await page.waitForTimeout(1500);
  page = await env.open('/fleet');
  await page.waitForTimeout(1500);
  const evs = await evq(env, page);
  const byPage = (w, p) => evs.find((e) => e.s === 'N' && e.w === w && e.d.by === 'page' && (!p || e.p === p));
  const served = env.server.requests.map((r) => r.method + ' ' + r.path);
  for (const [w, p] of [['POST /ajax/galaxy', 'galaxy'], ['GET /ajax/fleet/templates', 'fleet'], ['POST /ajax/fleet/dispatch/check-target', 'fleet']]) {
    if (!served.includes(w)) continue; // the game's JS did not send it in this fixture
    assert.ok(byPage(w, p), w + ' journaled: ' + JSON.stringify(evs.filter((e) => e.s === 'N').map((e) => e.p + ' ' + e.w + ' ' + e.d.by)));
  }
  assert.ok(served.includes('POST /ajax/galaxy') && byPage('POST /ajax/galaxy', 'galaxy'), 'first galaxy request of the page');
  const api = await env.evalOgx(page, () => Object.keys(OGX.learn.state().api));
  // (state of the current page; inject mode does not keep the galaxy page's unsaved state)
  assert.ok(served.includes('GET /ajax/fleet/templates') && api.includes('GET /ajax/fleet/templates'), 'learned from a pre-boot request: ' + api.join(', '));
  // errorBoxNotify: success dialogs (logout, jump gate) are not errors; the game's error head is
  const heads = await env.evalOgx(page, () => OGX.diag._errorHeads());
  assert.ok(heads.includes('error') && heads.includes('erreur'), heads.join(','));
  for (const [head, text] of [['Ok', 'You have been logged out'], ['Error', 'Not enough resources']]) {
    await page.evaluate(([h, t]) => {
      if (typeof errorBoxNotify === 'function') errorBoxNotify(h, t, 'Ok');
      else { document.getElementById('errorBoxNotifyHead').textContent = h; document.getElementById('errorBoxNotifyContent').textContent = t; }
    }, [head, text]);
    await page.waitForTimeout(300);
  }
  const g = (await evq(env, page)).filter((e) => e.s === 'G' && e.k === 'notify');
  const ok = g.find((e) => e.w === 'You have been logged out');
  const bad = g.find((e) => e.w === 'Not enough resources');
  assert.ok(ok && ok.d.head === 'Ok' && !ok.d.failed, JSON.stringify(g));
  assert.ok(bad && bad.d.head === 'Error' && bad.d.failed === true, JSON.stringify(g));
  assert.deepEqual(env.ogxErrors(), []);
}, { timeout: 120000 });

T.test('learning: switching between planet and moon (and a fleet page without ships) raises no alerts', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega', gameJs: true });
  const seq = [];
  for (let i = 0; i < 7; i++) seq.push('/overview?cp=1', '/fleet?cp=1');
  for (let i = 0; i < 3; i++) seq.push('/overview?cp=5', '/fleet?cp=5');
  let page;
  for (const p of seq) {
    page = await env.open(p);
    await env.evalOgx(page, async () => { OGX.learn.endVisit(); await OGX.learn.save({ flush: true }); await OGX.diag.flush(); return true; });
  }
  const keys = await env.evalOgx(page, () => Object.keys(OGX.learn.state().pages).sort());
  assert.ok(keys.includes('overview') && keys.includes('overview:moon') && keys.some((k) => /^fleet:moon/.test(k)), keys.join(','));
  const ls = (await evq(env, page)).filter((e) => e.s === 'L').map((e) => e.k + ': ' + e.w);
  assert.deepEqual(ls, [], 'no learning alerts for planet/moon switching');
  assert.deepEqual(env.ogxErrors(), []);
}, { timeout: 180000 });

T.test('store: ring buffer caps (IndexedDB and localStorage), snapshot cap, queries', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega' });
  const page = await env.open('/overview');
  const r = await env.evalOgx(page, async () => {
    const L = OGXDiagLib;
    const out = {};
    for (const forceLocal of [false, true]) {
      const s = await L.openStore({ name: 'ogx-test-ring-' + forceLocal, cap: 50, slack: 0, lsCap: 50, snapCap: 3, forceLocal });
      await s.clear();
      for (let b = 0; b < 3; b++) {
        const batch = [];
        for (let i = 0; i < 40; i++) batch.push({ t: 1000 + b * 40 + i, s: 'S', k: 'x', w: 'e' + (b * 40 + i + 1) });
        await s.put(batch);
      }
      const st = await s.stats();
      const last = await s.query({ last: 5 });
      const since = await s.query({ sinceId: st.maxId - 3 });
      const byT = await s.query({ sinceT: 1110 });
      const small = await s.query({ maxBytes: 300 });
      for (let i = 0; i < 5; i++) await s.putSnap({ t: i, page: 'p', reason: 'r' + i, html: '<p>' + i + '</p>' });
      const snaps = await s.snaps({});
      await s.setMeta('lastExportId', 77);
      out[forceLocal ? 'ls' : 'idb'] = { kind: s.kind, events: st.events, first: (await s.query({})).events[0].w, last: last.events.map((e) => e.w), since: since.events.length,
        byT: byT.events.map((e) => e.w), small: [small.events.length, small.cut], snaps: snaps.snaps.map((x) => x.reason), meta: await s.getMeta('lastExportId'), stats: (await s.stats()).lastExportId };
    }
    return out;
  });
  for (const k of ['idb', 'ls']) {
    const x = r[k];
    assert.equal(x.events, 50, k);
    assert.equal(x.first, 'e71', k);
    assert.deepEqual(x.last, ['e116', 'e117', 'e118', 'e119', 'e120'], k);
    assert.equal(x.since, 3, k);
    assert.deepEqual(x.byT, ['e111', 'e112', 'e113', 'e114', 'e115', 'e116', 'e117', 'e118', 'e119', 'e120'], k);
    assert.ok(x.small[0] >= 1 && x.small[0] < 10 && x.small[1] === 50 - x.small[0], k + ' ' + x.small);
    assert.deepEqual(x.snaps, ['r2', 'r3', 'r4'], k);
    assert.equal(x.meta, 77);
    assert.equal(x.stats, 77);
  }
  assert.equal(r.idb.kind, 'idb');
  assert.equal(r.ls.kind, 'localStorage');
});

T.test('learning: tokens/selectors/API drift and implausible values raise deduplicated L-alerts with a sanitized snapshot', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega' });
  const page = await env.open('/overview');
  const r = await env.evalOgx(page, async () => {
    const out = { steps: [] };
    const keys = (list) => list.map((a) => a.kind + '|' + a.key);
    // synthetic page visits
    for (let i = 0; i < 6; i++) out.steps.push(keys(OGX.learn._applyVisit({ page: 'tpage', tokens: ['#a', '#b', '.c', '[data-x]'], sels: { '#a .item': true, '#b': true } })));
    for (let i = 0; i < 4; i++) out.steps.push(keys(OGX.learn._applyVisit({ page: 'tpage', tokens: ['#b', '.c', '[data-x]', '#new-thing'], sels: { '#a .item': false, '#b': true } })));
    // API
    const ok = (extra) => Object.assign({ success: true, system: { planets: [{ id: 1 }] } }, extra || {});
    OGX.learn.state().apiTotal = Math.max(OGX.learn.state().apiTotal, 0);
    for (let i = 0; i < 30; i++) OGX.learn.api('POST /t/ep', { status: 200, json: ok() });
    const before = OGX.diag.recent({ s: 'L' }).length;
    OGX.learn.api('POST /t/ep', { status: 200, json: { success: true } });
    OGX.learn.api('POST /t/ep', { status: 200, json: ok({ fresh: 1 }) });
    OGX.learn.api('POST /t/ep', { status: 200, json: { success: true } });       // deduplicated
    OGX.learn.api('POST /t/ep', { status: 200, json: { success: false, errors: [{ message: 'x' }] } }); // other kind: learned, no alert
    OGX.learn.api('GET /t/brand-new', { status: 200, json: { a: 1 } });
    out.apiAlerts = OGX.diag.recent({ s: 'L' }).slice(before).map((e) => e.k + '|' + e.d.key);
    // implausible values
    out.v1 = OGX.learn.value('probe.metal', NaN);
    out.v2 = OGX.learn.check('probe.res', { metal: { amount: -5, perHour: -3 }, energy: -50 });
    out.v3 = OGX.learn.check('probe.ok', { metal: { amount: 5, perHour: -3 }, energy: -50, tempMin: -40 });
    // page=resources rows: consumers print negative metal/crystal/deuterium/energy per producer (real: fusion plant -242000 deuterium)
    out.v4 = OGX.learn.implausible({ rows: [{ metal: 938100934, crystal: 0, deuterium: 0, energy: -14214 }, { deuterium: -242000 }], metal: { amount: 1 } });
    out.v5 = OGX.learn.implausible({ rows: [{ deuterium: NaN }] });
    out.v6 = OGX.learn.implausible({ metal: { amount: -1 } }, { allowNegative: /amount$/ });
    out.v7 = OGX.learn.implausible({ metal: { amount: -1 } });
    out.parseOk = OGX.learn.check('parse.ok', OGX.parse.inlineResources(document));
    await new Promise((res) => setTimeout(res, 300));
    out.all = OGX.diag.recent({ s: 'L' }).map((e) => e.k + '|' + e.w);
    // real page: selectors queried through the core DOM helpers are counted, tokens learned, state persisted
    OGX.dom.$('#planetList');
    OGX.dom.$$('#definitely-missing-thing .x');
    OGX.dom.$('#ogx-own-element');                    // ours: ignored
    OGX.dom.$('.smallplanet', new DOMParser().parseFromString('<p></p>', 'text/html'));   // fetched doc: ignored
    OGX.learn.endVisit();
    const st = OGX.learn.state();
    out.ov = { visits: st.pages.overview.visits, sels: st.pages.overview.sels, tok: st.pages.overview.tokens['#planetList'], meta: st.pages.overview.tokens['meta:ogame-version'], ntok: Object.keys(st.pages.overview.tokens).length };
    await OGX.learn.save({ flush: true });
    await OGX.storage.flush();
    await OGX.diag.flush();
    const s = await OGX.diag.store();
    out.snaps = (await s.snaps({})).snaps.map((x) => ({ reason: x.reason, page: x.page, html: x.html }));
    out.tok = OGX.http.csrf();
    return out;
  });
  const flat = r.steps.map((s) => s.join(','));
  assert.deepEqual(flat.slice(0, 7), ['', '', '', '', '', '', ''], 'nothing during the baseline and on the first miss');
  assert.match(flat[7], /tokens-gone\|tokens-gone:tpage:#a/);
  assert.match(flat[7], /tokens-new\|tokens-new:tpage:#new-thing/);
  assert.match(flat[8], /^selector-miss\|sel-miss:tpage:#a \.item$/);
  assert.equal(flat[9], '', 'deduplicated afterwards');
  assert.deepEqual(r.apiAlerts, ['api-key-lost|api-lost:POST /t/ep:ok:system,system.planets', 'api-key-new|api-gain:POST /t/ep:ok:fresh', 'api-new|api-new:GET /t/brand-new']);
  assert.equal(r.v1, false);
  assert.equal(r.v2, false);
  assert.equal(r.v3, true, 'negative production/energy/temperature are plausible');
  assert.deepEqual(r.v4, [], 'per-producer rows are signed');
  assert.deepEqual(r.v5, [{ path: 'rows[0].deuterium', value: 'NaN' }], 'NaN in a row is still implausible');
  assert.deepEqual([r.v6, r.v7], [[], [{ path: 'metal.amount', value: -1 }]], 'allowNegative per check');
  assert.equal(r.parseOk, true, 'fixture resources are plausible');
  assert.ok(r.all.some((x) => /^implausible\|probe\.metal: /.test(x)));
  assert.ok(r.all.some((x) => /^implausible\|probe\.res: .*metal\.amount=-5/.test(x)));
  assert.ok(!r.all.some((x) => /parse\.|snapshot\./.test(x)), 'no false alerts from the core parsers on the fixture: ' + r.all.join('\n'));
  // real page learning
  assert.equal(r.ov.visits, 1);
  assert.deepEqual(r.ov.sels['#planetList'], [1, 1, 0]);
  assert.deepEqual(r.ov.sels['#definitely-missing-thing .x'], [1, 0, 1]);
  assert.ok(!Object.keys(r.ov.sels).some((k) => /ogx|smallplanet/.test(k)), Object.keys(r.ov.sels).join(', '));
  assert.ok(r.ov.tok && r.ov.tok[0] === 1 && r.ov.meta, JSON.stringify(r.ov.tok));
  assert.ok(r.ov.ntok > 50, 'tokens ' + r.ov.ntok);
  const stored = await env.get('diag.learn', { scope: 'server' });
  assert.ok(stored && stored.pages.tpage.visits === 10 && stored.pages.overview, 'learning state persisted per host (server scope)');
  // a sanitized snapshot was stored with the first alert batch (then throttled)
  assert.ok(r.snaps.length >= 1, 'snapshots ' + r.snaps.length);
  const sn = r.snaps[0];
  assert.match(sn.reason, /^learn: tokens-gone:tpage/);
  assert.equal(sn.page, 'overview');
  assert.ok(sn.html.startsWith('<!doctype html>') && sn.html.includes('id="planetList"'));
  assert.ok(!sn.html.includes(r.tok), 'no CSRF token in the snapshot');
  assert.ok(sn.html.includes('name="csrf-token" content="&lt;csrf&gt;"') || sn.html.includes('name="csrf-token" content="<csrf>"'), sn.html.slice(0, 600));
  assert.ok(!/<script[^>]*>[^<]+<\/script>/.test(sn.html), 'inline scripts emptied: ' + (/<script[^>]*>[^<]+<\/script>/.exec(sn.html) || [''])[0].slice(0, 300));
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('learning: GALAXYZ endpoints — known game pages raise no api-new (and api-new takes no snapshot), fleetAjax refusals are no key loss', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega' });
  const page = await env.open('/overview');
  const r = await env.evalOgx(page, async () => {
    const out = {};
    const recent = () => OGX.diag.recent({ s: 'L' }).map((e) => e.k + '|' + e.d.key);
    out.known = ['GET /Aeternum/game.php?page=galaxy', 'POST /Aeternum/game.php?page=fleetStep2', 'GET /Aeternum/game.php?page=techtree', 'POST /Aeternum/game.php?page=fleetAjax',
      'GET /Aeternum/game.php?page=messages&mode=view', 'GET /Aeternum/index.php', 'GET /Aeternum/game.php?page=foo', 'GET /t/brand-new', 'POST /Aeternum/game.php?page=fleetAjax&x'].map((ep) => OGX.learn._knownEndpoint(ep));
    // past newEndpointAfter (30) observations: a game page never seen before is no new endpoint, a page outside the set is (no snapshot)
    for (let i = 0; i < 31; i++) OGX.learn.api('GET /Aeternum/game.php?page=overview', { status: 200, keys: null });
    let n = recent().length;
    for (const ep of ['GET /Aeternum/game.php?page=galaxy', 'POST /Aeternum/game.php?page=fleetStep2', 'GET /Aeternum/game.php?page=techtree', 'GET /Aeternum/index.php']) OGX.learn.api(ep, { status: 200, keys: null });
    out.knownAlerts = recent().slice(n);
    OGX.learn.api('GET /Aeternum/game.php?page=foo', { status: 200, keys: null });
    out.unknownAlerts = recent().slice(n);
    await OGX.diag.flush();
    out.snapsAfterNew = (await (await OGX.diag.store()).snaps({})).snaps.map((x) => x.reason);
    // fleetAjax: 6 sends (code 600, with ships), then 2 refusals (612, no ships) -> no key loss; a code 600 WITHOUT ships is one
    const spyOk = { slots: 2, ships: { 210: 99 }, code: 600, mess: 'Send 3 Spy Probe to 2:70:9 ...' };
    const noslots = { slots: 13, code: 612, mess: 'Fault, not enough fleet Slots' };
    const ep = 'POST /Aeternum/game.php?page=fleetAjax';
    n = recent().length;
    for (let i = 0; i < 6; i++) OGX.learn.api(ep, { status: 200, json: spyOk });
    OGX.learn.api(ep, { status: 200, json: noslots });
    OGX.learn.api(ep, { status: 200, json: noslots });
    out.refusedAlerts = recent().slice(n);
    OGX.learn.api(ep, { status: 200, json: { slots: 2, code: 600, mess: 'ok' } });
    out.lostAlerts = recent().slice(n);
    out.epKinds = Object.keys(OGX.learn.state().api[ep].kinds).sort();
    // past newEndpointKnownAfter (300): a method never seen on a known page is reported once (no snapshot either)
    OGX.learn.state().apiTotal = 300;
    n = recent().length;
    OGX.learn.api('POST /Aeternum/game.php?page=galaxy', { status: 200, keys: null });
    OGX.learn.api('POST /Aeternum/game.php?page=galaxy', { status: 200, keys: null });
    out.lateAlerts = recent().slice(n);
    await OGX.diag.flush();
    out.snaps = (await (await OGX.diag.store()).snaps({})).snaps.map((x) => x.reason);
    return out;
  });
  assert.deepEqual(r.known, [true, true, true, true, true, true, false, false, false]);
  assert.deepEqual(r.knownAlerts, []);
  assert.deepEqual(r.unknownAlerts, ['api-new|api-new:GET /Aeternum/game.php?page=foo']);
  assert.deepEqual(r.snapsAfterNew, [], 'api-new makes no snapshot');
  assert.deepEqual(r.lateAlerts, ['api-new|api-new:POST /Aeternum/game.php?page=galaxy']);
  assert.deepEqual(r.refusedAlerts, [], 'a refusal is its own response kind');
  assert.deepEqual(r.lostAlerts, ['api-key-lost|api-lost:POST /Aeternum/game.php?page=fleetAjax:ok:ships,ships.#']);
  assert.deepEqual(r.epKinds, ['ok', 'refused:612']);
  assert.deepEqual(r.snaps.map((x) => x.replace(/:.*$/, '')), ['learn'], 'one snapshot, for the key loss');
  assert.match(r.snaps[0], /^learn: api-lost:/);
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('learning: the state is written at most once per saveMs (not every 5 s per request); an alert soon, but not sooner than saveMs after the last write', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega' });
  const page = await env.open('/overview');
  const r = await env.evalOgx(page, async () => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const L = OGX.learn;
    if (L.config.saveMs !== 60000 || L.config.alertSaveMs !== 5000) throw new Error('defaults');
    Object.assign(L.config, { saveMs: 1500, alertSaveMs: 200 });
    await L.save({ flush: true });
    const writes = [];
    const orig = OGX.storage.set;
    OGX.storage.set = function (k, ...rest) { if (k === 'diag.learn') writes.push(Date.now()); return orig.call(this, k, ...rest); };
    L.api('GET /Aeternum/game.php?page=overview', { status: 200, keys: null });
    await L.save({ flush: true });                    // explicit write: the 60 s window starts now
    const tS = Date.now();
    for (let i = 0; i < 100; i++) L.api('GET /Aeternum/game.php?page=overview', { status: 200, keys: null });
    await sleep(700);
    const after700 = writes.length;
    L.alert('ogx-test-alert', 'проверка', { kind: 'drift' });   // urgent, but the window since the last write is not over
    await sleep(500);
    const afterAlert = writes.length;
    await sleep(900);
    const at2100 = writes.length;
    const firstGap = writes[1] ? writes[1] - tS : null;
    await sleep(1700);                                // window over, nothing dirty: no write
    const idle = writes.length;
    L.alert('ogx-test-alert-2', 'проверка 2', { kind: 'drift' });
    await sleep(600);
    const urgent = writes.length;
    OGX.storage.set = orig;
    Object.assign(L.config, { saveMs: 60000, alertSaveMs: 5000 });
    return { after700, afterAlert, at2100, firstGap, idle, urgent };
  });
  assert.equal(r.after700, 1, 'only the explicit write: 100 counted requests wait for the window');
  assert.equal(r.afterAlert, 1, 'an alert does not write sooner than saveMs after the last write');
  assert.equal(r.at2100, 2, 'one write for requests + alert');
  assert.ok(r.firstGap >= 1400, 'gap ' + r.firstGap);
  assert.equal(r.idle, 2, 'nothing changed: no write');
  assert.equal(r.urgent, 3, 'an alert after a quiet window is written within alertSaveMs');
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('learning: the fleet event box, mission/tooltip classes and queue icons are volatile: no tokens-new / tokens-gone (live alerts of 2026-10-31)', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega' });
  const page = await env.open('/overview');
  await page.waitForTimeout(200);
  const r = await env.evalOgx(page, () => {
    const keys = (list) => list.map((a) => a.kind + '|' + a.key);
    const base = ['#planet', '.technology', '[data-technology]', '.smallplanet'];
    // tokens of the live tokens-new / tokens-gone alerts of ogamex.eu (log-today 2026-10-31)
    const box = ['#OvfleetContent', '#OvfleetEvents', '#fleettime_#', '[data-fleet-end-time]', '[data-fleet-time]', '[data-hide]', '.OvfleetButton', '.OvfleetEvents_', '.fleet_static_time',
      '.textForBlind', '.allFleetsEvent', '.return', '.fleets', '.ownattack', '.owndeploy', '.ownexpo', '.ownharvest', '.t_Tooltip', '.t_Content', '.bi-building-fill-up', '.buildingIco', '.bi', '.new-msg-count', '#eventboxLoading'];
    const out = [];
    // an older state that learned them as stable
    OGX.learn._applyVisit({ page: 'vpage', tokens: base, sels: {} });
    const st = OGX.learn.state().pages.vpage;
    for (const t of box) st.tokens[t] = [50, 0, 1, 1];
    st.visits = 50;
    for (let i = 0; i < 8; i++) out.push(...keys(OGX.learn._applyVisit({ page: 'vpage', tokens: base, sels: {} })));             // box gone
    for (let i = 0; i < 8; i++) out.push(...keys(OGX.learn._applyVisit({ page: 'vpage', tokens: base.concat(box), sels: {} }))); // box back
    for (let i = 0; i < 3; i++) out.push(...keys(OGX.learn._applyVisit({ page: 'vpage', tokens: base.concat(['.brand-new-layout']), sels: {} })));
    // the live document: volatile markup is not even collected
    const d = document.createElement('div');
    d.innerHTML = '<div id="OvfleetEvents"><span class="ownattack t_Tooltip OvfleetButton" data-fleet-time="1"></span><i class="bi bi-building-fill-up buildingIco"></i></div><div id="realThing" class="keepme"></div>';
    document.body.appendChild(d);
    const toks = OGX.learn.tokens(document);
    d.remove();
    return { alerts: out, left: Object.keys(st.tokens).filter((t) => box.includes(t)), toks: toks.filter((t) => box.includes(t) || /realThing|keepme/.test(t)) };
  });
  assert.deepEqual(r.alerts.filter((a) => !/brand-new-layout/.test(a)), [], 'no alerts for volatile tokens: ' + r.alerts.join(', '));
  assert.deepEqual(r.left, [], 'volatile tokens learned before are dropped from the state');
  assert.deepEqual(r.toks.sort(), ['#realThing', '.keepme']);
});

T.test('learning: no alerts on normal pages; selector miss streak across real visits survives navigation', async () => {
  const env = await T.launch({ ext: coreExt({ modules: { probe: `OGX.module({ name: 'probe', init() { OGX.dom.$('#planetList'); OGX.dom.$('#ogame-probe-target'); } });` } }), scenario: 'vega' });
  for (const p of ['/overview', '/fleet', '/galaxy', '/messages', '/fleet/movement', '/overview']) await env.open(p);
  const page = await env.open('/overview');
  // tighten the thresholds for the test, then make the target disappear on later visits
  await env.evalOgx(page, async () => { OGX.learn.endVisit(); await OGX.learn.save({ flush: true }); return true; });
  const st = await env.get('diag.learn', { scope: 'server' });
  // inject mode: the harness' storage shim does not survive an unload, so only the explicit save of the last page lands
  if (env.mode === 'extension') assert.ok(st.pages.overview.visits >= 2 && st.pages.fleet && st.pages.galaxy && st.pages.messages && st.pages.movement, Object.keys(st.pages).join(','));
  else assert.ok(st.pages.overview.visits >= 1, Object.keys(st.pages).join(','));
  assert.deepEqual(st.pages.overview.sels['#planetList'], [st.pages.overview.visits, st.pages.overview.visits, 0]);
  const ls = await env.evalOgx(page, async () => { await OGX.diag.flush(); return (await (await OGX.diag.store()).query({})).events.filter((e) => e.s === 'L').map((e) => e.k + ': ' + e.w); });
  assert.deepEqual(ls, [], 'no learning alerts on unchanged fixture pages');
  const leaves = await env.evalOgx(page, async () => { await OGX.diag.flush(); return (await (await OGX.diag.store()).query({})).events.filter((e) => e.s === 'S' && (e.k === 'page' || e.k === 'leave')).map((e) => e.k + ':' + e.w); });
  // (the harness probe adds one /overview visit before the test)
  assert.deepEqual(leaves.filter((x) => x.startsWith('page:')).slice(-7), ['overview', 'fleet', 'galaxy', 'messages', 'movement', 'overview', 'overview'].map((x) => 'page:' + x), leaves.join(','));
  if (env.mode === 'extension') assert.ok(leaves.filter((x) => x.startsWith('leave:')).length >= 6, 'pagehide events reach the journal: ' + leaves.join(','));
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('export: TXT/JSONL/snapshots/learning from the page; "new since last export"; side panel mount; popup panel', async () => {
  const ext = coreExt({ modules: MODULES });
  const env = await T.launch({ ext, scenario: 'vega', settings: { 'thrower.level': 4 } });
  const page = await env.open('/overview');
  await page.waitForTimeout(200);
  const r = await env.evalOgx(page, async () => {
    OGX.log.rec('B', 'probe', 'first');
    await OGX.diag.snapshot('manual test', { force: true });
    const a = await OGX.diag.export('new');
    OGX.log.rec('B', 'probe', 'second');
    OGX.log.rec('G', 'fadeBox', 'Fleet sent', { failed: false });
    const b = await OGX.diag.export('new');
    const today = await OGX.diag.export('today');
    const last = await OGX.diag.export('last', { n: 3 });
    const jsonl = await OGX.diag.export('jsonl');
    const snaps = await OGX.diag.export('snaps');
    const learnRep = await OGX.diag.export('learn');
    // per-tick wraps are quiet: one event per result change, the count of identical calls rides on the next change
    const tick = OGX.log.wrap('probe', (n) => ({ n, title: n > 0 }), 'alert');
    for (let i = 0; i < 20; i++) tick(0);
    tick(2); tick(2); tick(0);
    const render = OGX.log.wrap('probe', (reason) => ({ reason, rows: 6 }), 'render');
    render('init'); render('update'); render('update');
    const act = OGX.log.wrap('probe', () => ({ ok: true }), 'send');
    act(); act();
    const quiet = OGX.diag.recent({ k: 'probe' }).filter((e) => e.w === 'alert' || e.w === 'render' || e.w === 'send').map((e) => e.w + ':' + JSON.stringify(e.d.r) + (e.d.same ? ' same=' + e.d.same : ''));
    // network: the URL as requested (cp) and the redirect target are journaled
    OGX.diag._ogxNet({ method: 'GET', url: location.origin + '/game.php?page=buildings&cp=254103', finalUrl: location.origin + '/game.php?page=buildings', status: 200, ms: 5 });
    OGX.diag._ogxNet({ method: 'POST', url: location.origin + '/game.php?page=buildings', status: 200, ms: 5, body: 'cmd=insert&building=1&cp=254104' });
    const net = OGX.diag.recent({ s: 'N' }).slice(-2).map((e) => ({ w: e.w, cp: e.d.cp, to: e.d.to || null }));
    // private texts never reach the journal: messages/notes/ticket/settings keep field names only; free-text keys are masked anywhere
    OGX.diag._pageNet({ method: 'POST', url: location.origin + '/game.php?page=messages&mode=write', status: 200, ms: 5, body: 'id=4366&subject=hi+there&text=my+secret+plan&empfaenger=Bob' });
    OGX.diag._ogxNet({ method: 'POST', url: location.origin + '/game.php?page=notes', status: 200, ms: 5, body: 'mode=insert&text=note+text&title=t' });
    OGX.diag._pageNet({ method: 'POST', url: location.origin + '/game.php', status: 200, ms: 5, body: 'page=ticket&mode=send&message=help+me' });
    OGX.diag._pageNet({ method: 'POST', url: location.origin + '/game.php?page=settings', status: 200, ms: 5, body: 'timezone=Asia%2FVladivostok&dpath=x' });
    OGX.diag._pageNet({ method: 'POST', url: location.origin + '/game.php?page=unknownpage', status: 200, ms: 5, body: 'foo=private+words' });
    OGX.diag._pageNet({ method: 'POST', url: location.origin + '/game.php?page=fleetStep1', status: 200, ms: 5, body: 'galaxy=1&system=2&planet=3&ship210=1100' });
    OGX.diag._ogxNet({ method: 'POST', url: location.origin + '/game.php?page=planetlayer', status: 200, ms: 5, body: 'name=Base&text=hello&cp=1' });
    const priv = OGX.diag.recent({ s: 'N' }).slice(-7).map((e) => ({ w: e.w, f: e.d.f || null, fk: e.d.fk || null }));
    const full = await OGX.diag.export('full');
    return { a, b, today: today.info, last: last.text, lastInfo: last.info, jsonl: jsonl.text, snaps: snaps.text, snapsName: snaps.filename, learn: learnRep.text, learnName: learnRep.filename, quiet, net, priv, full };
  });
  assert.deepEqual(r.quiet, ['alert:{"n":0,"title":false}', 'alert:{"n":2,"title":true} same=19', 'alert:{"n":0,"title":false} same=1', 'render:{"reason":"init","rows":6}', 'send:{"ok":true}', 'send:{"ok":true}'], r.quiet.join('\n'));
  assert.deepEqual(r.net, [{ w: 'GET /game.php?page=buildings', cp: 254103, to: '/game.php?page=buildings' }, { w: 'POST /game.php?page=buildings', cp: 254104, to: null }]);
  assert.deepEqual(r.priv, [
    { w: 'POST /game.php?page=messages&mode=write', f: null, fk: ['id', 'subject', 'text', 'empfaenger'] },
    { w: 'POST /game.php?page=notes&mode=insert', f: null, fk: ['mode', 'text', 'title'] },
    { w: 'POST /game.php?page=ticket&mode=send', f: null, fk: ['page', 'mode', 'message'] },
    { w: 'POST /game.php?page=settings', f: null, fk: ['timezone', 'dpath'] },
    { w: 'POST /game.php?page=unknownpage', f: null, fk: ['foo'] },
    { w: 'POST /game.php?page=fleetStep1', f: { galaxy: '1', system: '2', planet: '3', ship210: '1100' }, fk: null },
    { w: 'POST /game.php?page=planetlayer', f: { name: 'Base', text: '<redacted>', cp: '1' }, fk: null }]);
  assert.ok(!JSON.stringify(r.full.text).includes('secret plan') && !r.full.text.includes('my+secret') && !r.full.text.includes('help me') && !r.full.text.includes('private words'), 'no private text in the export');
  assert.match(r.full.filename, /^ogx-live-logs-.*-\d{8}-\d{6}\.txt$/);
  assert.match(r.full.text, /^=== OGX полная выгрузка для разбора/);
  for (const sec of ['=== НАСТРОЙКИ (все, JSON) ===', '=== ОТЧЁТ САМООБУЧЕНИЯ ===', '=== EVENTS ===', '=== СНИМКИ СТРАНИЦ ===']) assert.ok(r.full.text.includes(sec), sec);
  assert.ok(r.full.text.includes('"thrower":{"level":4}') || r.full.text.includes('"level":4'), 'module settings in the JSON block');
  assert.ok(r.full.text.includes('[S] snapshot: manual test') && r.full.text.includes('----- СНИМОК #') && r.full.text.includes('причина=manual test'), 'journal + snapshot');
  assert.ok(r.full.info.events > 5 && r.full.info.snaps >= 1, JSON.stringify(r.full.info));
  const host = env.host;
  assert.match(r.a.filename, new RegExp('^ogx-live-log-new-' + host.replace(/[^a-z0-9.-]/gi, '_').replace(/\./g, '\\.') + '-\\d{8}-\\d{6}\\.txt$'));
  assert.ok(r.a.text.includes('Сервер: ' + host));
  assert.ok(r.a.text.includes('Игрок: id 108'));
  assert.ok(r.a.text.includes('Расширение: OgameX Live'));
  assert.ok(/  \+ thrower \(активен на странице overview\) \{"level":4\}/.test(r.a.text), r.a.text.slice(0, 1500));
  assert.ok(/Ошибки за 10 мин: U=0 B=\d+ S=[1-9]\d* /.test(r.a.text));
  assert.ok(r.a.text.includes('[B] probe: first'));
  assert.ok(r.a.text.includes('[S] module-init-fail: thrower'));
  assert.ok(r.a.text.includes('[S] snapshot: manual test'));
  assert.ok(r.a.info.events > 3);
  assert.ok(r.b.info.events >= 2 && r.b.info.events <= 4, 'only new events: ' + r.b.info.events);
  assert.ok(r.b.text.includes('[B] probe: second') && r.b.text.includes('[G] fadeBox: Fleet sent') && !r.b.text.includes('[B] probe: first'));
  assert.ok(r.b.text.includes('вид: новое с прошлой выгрузки'));
  assert.ok(r.today.events >= r.a.info.events + 2);
  assert.equal(r.lastInfo.events, 3);
  assert.equal(r.last.split('=== EVENTS ===\n')[1].split('\n').filter((l) => /^\d\d:/.test(l)).length, 3);
  const jl = r.jsonl.trim().split('\n').map((x) => JSON.parse(x));
  assert.equal(jl[0]._header.host, host);
  assert.ok(jl.slice(1).every((e) => e.id && e.s && e.k));
  assert.ok(r.snaps.includes('<!-- ===== OGX SNAPSHOT #') && r.snaps.includes('reason=manual test') && /\.html$/.test(r.snapsName));
  assert.ok(r.learn.includes('=== СТРАНИЦЫ ===') && /learn/.test(r.learnName));

  // side panel mount (page backend) + a real download
  await env.evalOgx(page, () => { const d = OGX.dom.h('div', { id: 'ogx-test-diag' }); document.body.appendChild(d); OGX.diag.mountPanel(d); return true; });
  await page.waitForSelector('#ogx-test-diag .ogx-diag-btn');
  const labels = await page.$$eval('#ogx-test-diag .ogx-diag-btn', (els) => els.map((e) => e.textContent));
  for (const l of ['Выгрузить логи', 'Новое с прошлой выгрузки', 'За сегодня', 'Последние N', 'JSONL', 'Снимки страниц (HTML)', 'Отчёт самообучения', 'Очистить']) assert.ok(labels.includes(l), l + ' in ' + labels.join(' | '));
  assert.equal(labels[0], 'Выгрузить логи', 'the one-file export is the first button');
  assert.ok(await page.$eval('#ogx-test-diag [data-ogx-act="diag:full"]', (e) => e.getBoundingClientRect().height > 0), 'visible without opening «Ещё»');
  assert.ok(await page.$eval('#ogx-test-diag [data-ogx-act="diag:today"]', (e) => !!e.closest('details.ogx-diag-more') && !e.closest('details.ogx-diag-more').open), 'the old exports are under «Ещё»');
  assert.ok(await page.$$eval('#ogx-test-diag .ogx-diag-settings input[type="checkbox"]', (e) => e.length) >= 4, 'diag toggles shown');
  const [dlFull] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#ogx-test-diag [data-ogx-act="diag:full"]')]);
  assert.match(dlFull.suggestedFilename(), /^ogx-live-logs-/);
  assert.ok(fs.readFileSync(await dlFull.path(), 'utf8').startsWith('=== OGX полная выгрузка для разбора'));
  await page.waitForFunction(() => /Сохранено:.*МБ/.test((document.querySelector('#ogx-test-diag .ogx-diag-status') || {}).textContent || ''));
  // with the bot section loaded the export carries its live status, queue, recent actions and journal
  const botEx = await env.evalOgx(page, async () => {
    const had = OGX.bot;
    OGX.bot = { status: () => ({ state: 'off', master: false, dryRun: true, queue: [{ id: 'q1', type: 'fleet', module: 'botsave', prio: 1, state: 'queued' }] }),
      recentActions: () => [{ id: 'a1', ok: true }], recentLines: () => [{ module: 'botcore', event: 'state', what: 'Бот выключен' }] };
    try { return (await OGX.diag.extras()).bot; } finally { OGX.bot = had; }
  });
  assert.equal(botEx.status.state, 'off');
  assert.equal(botEx.status.queue, undefined, 'queue is its own key');
  assert.deepEqual(botEx.queue.map((e) => e.id), ['q1']);
  assert.deepEqual(botEx.recentActions.map((e) => e.id), ['a1']);
  assert.equal(botEx.journal[0].what, 'Бот выключен');
  await page.click('#ogx-test-diag .ogx-diag-more > summary');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#ogx-test-diag [data-ogx-act="diag:today"]')]);
  const txt = fs.readFileSync(await dl.path(), 'utf8');
  assert.match(dl.suggestedFilename(), /^ogx-live-log-today-/);
  assert.ok(txt.startsWith('=== OGX журнал для разбора'));
  await page.waitForFunction(() => /Сохранено:/.test((document.querySelector('#ogx-test-diag .ogx-diag-status') || {}).textContent || ''));

  // clear
  const cleared = await env.evalOgx(page, async () => { const b = OGX.diag.backend(); await b.clear(); return (await b.stats()).events; });
  assert.ok(cleared <= 1, 'cleared ' + cleared);

  // popup (extension pages only): reads the background IndexedDB directly and the published context
  if (env.mode === 'extension') {
    await env.evalOgx(page, async () => { OGX.log.rec('B', 'probe', 'for-popup'); await OGX.diag.flush(); await OGX.diag.publishContext(); await OGX.storage.flush(); return true; });
    const id = T.extensionId(ext.dir);
    const pop = await env.page(true);
    await pop.goto(`chrome-extension://${id}/popup/popup.html`);
    await pop.waitForSelector('#ogx-diag-panel .ogx-diag-btn');
    await pop.waitForFunction(() => /Событий: \d+/.test(document.querySelector('.ogx-diag-stats').textContent));
    await pop.click('.ogx-diag-more > summary');
    const [d2] = await Promise.all([pop.waitForEvent('download', { timeout: 10000 }), pop.click('[data-ogx-act="diag:new"]')]);
    const t2 = fs.readFileSync(await d2.path(), 'utf8');
    assert.ok(t2.includes('Сервер: ' + host), t2.slice(0, 800));
    assert.ok(t2.includes('Расширение: OGX core test (live) 0.1.0'));
    assert.ok(t2.includes('[B] probe: for-popup'));
    assert.ok(t2.includes('хранилище журнала: extension IndexedDB'));
    const [d3] = await Promise.all([pop.waitForEvent('download', { timeout: 10000 }), pop.click('[data-ogx-act="diag:learn"]')]);
    assert.ok(fs.readFileSync(await d3.path(), 'utf8').includes('Сервер: ' + host));
    const [d1] = await Promise.all([pop.waitForEvent('download', { timeout: 15000 }), pop.click('[data-ogx-act="diag:full"]')]);
    const t1 = fs.readFileSync(await d1.path(), 'utf8');
    assert.ok(t1.startsWith('=== OGX полная выгрузка для разбора') && t1.includes('Сервер: ' + host) && t1.includes('=== НАСТРОЙКИ (все, JSON) ==='), t1.slice(0, 800));
    assert.ok(t1.includes('[B] probe: for-popup'), 'popup full export has the journal');
  }
});

T.test('safety: nothing is journaled or stored on non-OgameX pages', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega' });
  const page = await env.open('/not-ogame', { waitReady: false });
  await page.evaluate(() => fetch('/not-ogame').then((r) => r.text()));
  await page.waitForTimeout(500);
  const r = await env.evalOgx(page, () => ({ inited: OGX.diag.isInited(), learn: OGX.learn.isActive(), recent: OGX.diag.recent().length }));
  assert.deepEqual(r, { inited: false, learn: false, recent: 0 });
  const dbs = await page.evaluate(async () => (indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : []));
  assert.deepEqual(dbs.filter((n) => /ogx/.test(n)), []);
});
