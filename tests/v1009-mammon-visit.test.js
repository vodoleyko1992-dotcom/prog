'use strict';
// 10.0.9 (игрок 13.10 07:22, скрин: «где отметил красным, добавь кнопку — открыть Маммона/прийти к Маммону — на выбор торговец или кузнец»):
// кнопки «🛒 Торговец Маммона» / «⚒ Кузнец Маммона» справа от «🐉 Респ эпиков» в окне бота. Бот работает → rt.mmGoReq {kind:'visit', npc}
// через фон (mmGoSet, без замка), модуль Маммона: телепорт за адену → страница NPC → пауза. Бот стоит → сразу страница телепорта к NPC
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const src = read('modules/mammon.js');
const mk = ({ rt = {}, cfg = {}, path: pn = '/map.html', near = false, cost = '500 000' } = {}) => {
  const recs = [], fired = [], paused = [], loc = { pathname: pn, href: '' };
  const sb = { console, Date, Math, JSON, Object, Number, String, Array, Set, Map, RegExp, location: loc, document: { querySelectorAll: () => [] } };
  sb.globalThis = sb; vm.runInNewContext(src, sb);
  const els = { '#mammon-loc-teleport-btn': { disabled: false }, '#mammon-loc-cost': { textContent: cost } };
  const env = { rt: { zone: 'z1', ...rt }, cfg: { mmTpMax: 500000, ...cfg }, recs, fired,
    setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.join(' ')), setStatus: () => {}, sleep: async () => {}, waitX: async fn => fn(),
    fire: el => { fired.push(el); loc.pathname = '/map.html'; }, $q: s => els[s] || null, isBattle: () => false, isFishing: () => false, fishState: () => null, fishNow: () => false,
    autonomyMode: () => 'hunt', tvtSoon: () => false, heroNick: () => 'Warlock', invQty: () => null, ITEMS: {}, FARM: { res: {} }, pauseBot: async m => { paused.push(m); },
    gameGet: async (u) => ({ ok: near, status: near ? 200 : 403, json: async () => ({ items: [], character: { worldX: 0, worldY: 0 } }) }) };
  return { env, M: sb.L2V7Factories.mammon(env), loc, fired, recs, paused };
};
const now = Date.now();
(async () => {
  // 1. команда «к кузнецу»: без заказа и вещи-цели всё равно летим; задача visit, домой не возвращаемся (кончится паузой)
  { const { env, M, recs } = mk({ rt: { mmGoReq: { kind: 'visit', npc: 'smith', t: now } } });
    const g = M.goReq(); assert.equal(g.kind, 'smith'); assert.equal(g.visit, true); assert.equal(g.cmd, true); assert.match(g.why, /прийти к кузнецу Маммона/);
    assert.equal(await M.mmStep(), true); assert.equal(env.rt.mmJob.kind, 'smith'); assert.equal(env.rt.mmJob.visit, true); assert.equal(env.rt.mmJob.step, 'go');
    assert.equal(env.rt.mmJob.home, null, 'после визита — пауза, домой не летим'); assert.equal(env.rt.mmGoReq, null, 'команда потреблена');
    assert.match(recs.join('\n'), /иду к кузнецу: по кнопке: прийти к кузнецу Маммона/); }
  // 2. «к торговцу» → шаг go: NPC не рядом → страница телепорта → кнопка (за адену) → act
  { const { env, M, loc, fired } = mk({ rt: { mmGoReq: { kind: 'visit', npc: 'order', t: now } } });
    await M.mmStep(); assert.equal(env.rt.mmJob.kind, 'order');
    await M.mmStep(); assert.equal(loc.href, '/mammon-merchant-loc.html', 'телепорт к торговцу');
    loc.pathname = '/mammon-merchant-loc.html'; await M.mmStep(); assert.equal(fired.length, 1); assert.equal(env.rt.mmJob.step, 'act'); }
  // 3. шаг act у визита: открыть страницу NPC, затем пауза с подсказкой «▶ Продолжить», задача закрыта, запись в mmLog
  { const { env, M, loc, paused } = mk({ rt: { mmJob: { kind: 'smith', visit: true, cmd: true, step: 'act', home: null, t: now } } });
    await M.mmStep(); assert.equal(loc.href, '/mammon-blacksmith.html', 'страница кузнеца'); assert.equal(paused.length, 0);
    loc.pathname = '/mammon-blacksmith.html'; await M.mmStep();
    assert.equal(env.rt.mmJob, null); assert.equal(paused.length, 1); assert.match(paused[0], /пришёл к кузнецу Маммона .*▶ Продолжить/);
    assert.equal(env.rt.mmLog[0].kind, 'visit'); assert.equal(env.rt.mmLog[0].id, 'smith'); }
  // 4. телепорт за Coin of Luck — не летим (правило: CoL бот не тратит), устаревшая команда — отбой с причиной
  { const { env, M, loc } = mk({ rt: { mmJob: { kind: 'order', visit: true, cmd: true, step: 'go', home: null, t: now } }, path: '/mammon-merchant-loc.html', cost: '1 Coin of Luck' });
    await M.mmStep(); assert.equal(env.rt.mmJob, null); assert.match(env.rt.mmLog[0].why, /Coin of Luck/); assert.equal(loc.href, '/map.html'); }
  { const { env, M, recs } = mk({ rt: { mmGoReq: { kind: 'visit', npc: 'smith', t: now - 31 * 60000 } } });
    assert.equal(await M.mmStep(), false); assert.equal(env.rt.mmGoReq, null); assert.match(env.rt.mmGoSay.why, /устарела/); assert.match(recs.join('\n'), /кнопка «прийти к кузнецу сейчас»: команда устарела/); }
  // 5. проводка: окно бота (кнопки справа от «Респ эпиков», кликабельны, блок есть и без эпиков), фон mmGoSet только с l2wap.com, геттер pauseBot, меню
  const c = read('content.js'), bg = read('background.js'), pp = read('popup.js');
  assert.match(c, /L2V7Modules\.mammon = L2V7Factories\.mammon\(\{ get \$q\(\) \{ return \$q; \}, get pauseBot\(\) \{ return pauseBot; \}/, 'mammon: геттер pauseBot');
  assert.match(c, /data-mmgo="order"[^\n]*🛒 Торговец Маммона<\/button><button type="button" class="bt" data-mmgo="smith"[^\n]*⚒ Кузнец Маммона<\/button>/, 'две кнопки рядом');
  assert.match(c, /<div class="e"><div class="et"><b>🐉 Респ эпиков<\/b>[^\n]*<div class="mm">\$\{mmGoBtns\(\)\}<\/div><\/div>/, 'кнопки в блоке «Респ эпиков»');
  assert.match(c, /if \(t === '— 🏛 маммон —'\) return `<div class="e"><div class="mm">\$\{mmGoBtns\(\)\}<\/div><\/div>`/, 'без эпиков — только кнопки');
  assert.match(c, /#l2bot-ind \.e\{display:flex;gap:10px;align-items:flex-start\}/); assert.match(c, /#l2bot-ind \.e \.mm \.bt\{pointer-events:auto;cursor:pointer/, 'кнопки кликабельны в окне pointer-events:none');
  assert.match(c, /if \(!on\) \{ rec\('B', 'Маммон', [^\n]*location\.href = MM_LOC\[npc\]; return; \}/, 'бот стоит → страница телепорта сразу');
  assert.match(c, /chrome\.runtime\.sendMessage\(\{ cmd: 'mmGoSet', mmGoReq: req \}\)/, 'команда через фон'); assert.match(c, /else await setRt\(\{ mmGoReq: req, mmGoSay: null \}\)/, 'запасной путь — setRt');
  assert.match(bg, /m\?\.cmd === 'mmGoSet'[\s\S]{0,400}R\.kind !== 'visit' \|\| !\['order', 'smith'\]\.includes\(R\.npc\)/, 'фон: только visit order|smith');
  assert.match(bg, /mmGoReq: \{ kind: 'visit', npc: R\.npc, t: \+R\.t \}, mmGoSay: null, _src: 'menu'/, 'фон пишет только этот ключ');
  assert.match(pp, /rt\.mmGoReq\.kind === 'visit' \? `прийти к \$\{rt\.mmGoReq\.npc === 'smith' \? 'кузнецу' : 'торговцу'\} Маммона`/, 'меню показывает команду');
  console.log('PASS: 10.0.9 «🛒 Торговец Маммона» / «⚒ Кузнец Маммона» in the bot window — running bot: one-shot visit (teleport for adena → NPC page → pause), stopped bot: teleport page at once; CoL teleport refused, stale command dropped');
})().catch(e => { console.error(e); process.exit(1); });
