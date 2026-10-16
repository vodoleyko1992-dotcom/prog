'use strict';
// 10.0.17: контекст настоящего fire включает PvP guard; в этом сценарии герой не погибал.
// 10.0.2 (письмо крафтеру): браузерный смоук с НАСТОЯЩИМ mail-compose.js игры (берётся с l2wap.com при запуске; нет сети — пропуск).
// Партия ушла → модуль mammon открывает «Нове повідомлення», вводит ник крафтера и текст задания, жмёт «Надіслати» — игра шлёт
// POST /game/mail/send {recipientName: 'Skye', text} ровно один раз; длинное задание — несколько писем, каждое ≤ 1000 знаков (maxlength поля)
const { chromium } = require(process.env.PLAYWRIGHT_NODE || '/opt/node-tools/node_modules/playwright');
const assert = require('node:assert/strict'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const L2STUB = `window.L2 = { tr: (k, f) => f, token: () => 'x', authFetch: (u, o) => fetch(u, o), playerMessageOr: (j, f, d) => (j && (j.messageUk || j.error)) || f || d,
  applyPageI18n() {}, mountL2Nav() {}, resyncCharacterWhenRequired: async () => null };`;
const MC_BODY = `<p class="err" id="mail-compose-err" hidden></p><main id="mail-compose-content"><form class="l2-mail-form" id="mail-compose-form">
<input id="mail-compose-to" name="to" type="text" maxlength="64"><textarea id="mail-compose-text" name="text" maxlength="1000"></textarea>
<button type="submit" id="mail-compose-submit">Надіслати</button></form><p id="mail-compose-success" hidden></p><p id="mail-compose-thread-link" hidden><a id="mail-compose-thread-anchor"></a></p></main>`;
async function gameJs(f) { try { const r = await fetch('https://l2wap.com/' + f); return r.ok ? await r.text() : null; } catch (e) { return null; } }
const ENV = `
  const contentSrc = window.__content, fireSrc = contentSrc.slice(contentSrc.indexOf('function fire(el) {'), contentSrc.indexOf('\\n}\\n', contentSrc.indexOf('function fire(el) {')) + 3);
  const fire = (0, eval)('(function(){ const on = true, tabOwner = true, abHold = () => false, L2V7Modules = { pvp: { pending: () => false } }; return ' + fireSrc.replace('function fire', 'function') + '; })()');
  (0, eval)(window.__mammon);
  const rt = window.__rt, recs = [];
  const env = { rt, cfg: { mmGoalItem: 920018, mmGoalLvl: 1, mmCrafter: 'Skye' }, setRt: async p => { Object.assign(rt, p); await window.__report(JSON.stringify({ rt, recs })); }, rec: (...a) => recs.push(a.join(' ')), setStatus() {},
    sleep: ms => new Promise(r => setTimeout(r, Math.min(ms, 400))), waitX: async (fn, ms = 5000, st = 100) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise(r => setTimeout(r, st)); } },
    fire, $q: s => document.querySelector(s), isBattle: () => false, isFishing: () => false, fishState: () => null, fishNow: () => false, autonomyMode: () => 'hunt', tvtSoon: () => false,
    heroNick: () => 'Warlock', invQty: () => 0, invRefresh: async () => ({}), ITEMS: {}, FARM: { res: {} }, gameGet: p => fetch(p) };
  const M = globalThis.L2V7Factories.mammon(env);
  for (let i = 0; i < 6 && rt.mmJob; i++) await M.sendStep(rt.mmJob);`;
(async () => {
  const mc = await gameJs('mail-compose.js');
  if (!mc) { console.log('SKIP: game JS (mail-compose.js) unavailable — no network'); return; }
  const b = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const p = await b.newPage(); const errors = [], sends = []; p.on('pageerror', e => errors.push(String(e)));
  let last = null; await p.exposeFunction('__report', s => { last = JSON.parse(s); });
  await p.route('**/*', async r => {
    const u = new URL(r.request().url()), json = o => r.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/game/mail/send') { sends.push(JSON.parse(r.request().postData() || '{}')); return json({ ok: true, messageId: sends.length, duplicate: false }); }
    if (u.pathname === '/map.html') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><p>map</p>' });
    if (u.pathname === '/mail-compose.html') return r.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><meta charset="utf-8"></head><body>${MC_BODY}<script>${L2STUB}</script><script>${mc}</script></body></html>` });
    return json({});
  });
  // модуль перезагружает страницу (location.href) между письмами и в конце уходит на карту — гоняем шаги, пока задание не кончится
  const drive = async rt0 => {
    let rt = rt0;
    for (let k = 0; k < 8 && rt.mmJob; k++) {
      if (!/mail-compose/.test(p.url())) await p.goto('https://l2wap.com/mail-compose.html');
      await p.waitForSelector('#mail-compose-form'); await p.waitForTimeout(150);
      await p.evaluate(([c, m, r]) => { window.__content = c; window.__mammon = m; window.__rt = r; }, [read('content.js'), read('modules/mammon.js'), rt]);
      last = null;
      await p.evaluate(ENV0 => new Function(`return (async () => { ${ENV0} })()`)(), ENV).catch(e => { if (!/context was destroyed|navigation/i.test(e.message)) throw e; });
      await p.waitForTimeout(300);
      if (last) rt = last.rt;
    }
    return rt;
  };
  const note = { goal: 'Belt Lv.0 → 1', part: false, craft: [['Steel', 3]], ret: [['Steel', 3]] };
  const job = { kind: 'send', to: 'Skye', step: 'act', t: Date.now(), items: [], done: [['Iron Ore', 15, 8], ['Varnish', 15, 9]], note };
  const R = await drive({ mmJob: job });
  assert.equal(sends.length, 1, JSON.stringify(sends)); assert.equal(sends[0].recipientName, 'Skye'); assert.ok(sends[0].clientMessageId);
  assert.match(sends[0].text, /^Привет! Отправил ресурсы на крафт \(Belt Lv\.0 → 1\): Iron Ore ×15, Varnish ×15\.\nСкрафти, пожалуйста, и верни почтой на Warlock: Steel ×3\.\nСпасибо!$/);
  assert.equal(R.mmJob, null); assert.match(R.mmLog[0].why, /письмо с заданием отправил/);
  console.log('PASS browser: «Нове повідомлення» (real mail-compose.js) — nick and task typed, «Надіслати» → one POST /game/mail/send to Skye, batch closed');
  // длинное задание — несколько писем по ≤ 1000 знаков, все дошли
  sends.length = 0;
  const many = Array.from({ length: 70 }, (_, i) => [`Very Long Material Name Number ${i}`, 1000 + i]);
  const R2 = await drive({ mmJob: { ...job, note: { ...note, craft: many, ret: many } } });
  assert.ok(sends.length >= 2, 'letters: ' + sends.length); assert.ok(sends.every(s => s.text.length <= 1000 && s.recipientName === 'Skye'));
  for (const [n] of many) assert.ok(sends.some(s => s.text.includes(n)), n);
  assert.equal(R2.mmJob, null);
  console.log(`PASS browser: long task split into ${sends.length} letters ≤ 1000 chars, each sent once`);
  assert.deepEqual(errors, []);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
