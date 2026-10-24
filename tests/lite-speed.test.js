'use strict';
// Lite 1.8 (24.10, тред «Упрошенка под Дестра», John: «добавь раздел со скоростью работы бота»): раздел «⚡ Скорость» —
// пауза между действиями в игре (как «Скорость» основного бота 20.53, actionPace), реакция между кругами бота, «Быстрый удар»
// и замер скорости с Старта (rt.spd: ход каждые N с, ходов в минуту, моб каждые N с, мобов в час).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const L = require('../lite/logic.js');
const bot = read('lite/bot.js'), pj = read('lite/popup.js'), html = read('lite/popup.html');

test('настройки скорости — общие для всех профилей (наверху lite.cfg), по умолчанию без паузы и прежняя реакция 60–140 мс', () => {
  assert.deepEqual(L.G_KEYS, ['delayMs', 'reactMin', 'reactMax']);
  assert.deepEqual(L.DEF_G, { delayMs: 0, reactMin: 60, reactMax: 140 });
  for (const k of L.KINDS) { const c = L.profCfg({}, k); assert.equal(c.delayMs, 0, k); assert.equal(c.reactMin, 60, k); assert.equal(c.reactMax, 140, k); }
  let raw = L.profPatch({ on: true }, 'archer', { delayMs: 1500 });
  assert.equal(raw.delayMs, 1500, 'наверх, не в профиль'); assert.deepEqual(raw.p, {});
  raw = L.profPatch(raw, 'mage', { reactMin: 200, fastTurn: false });
  for (const k of L.KINDS) { assert.equal(L.profCfg(raw, k).delayMs, 1500, k); assert.equal(L.profCfg(raw, k).reactMin, 200, k); }
  assert.equal(L.profCfg(raw, 'mage').fastTurn, false); assert.equal(L.profCfg(raw, 'destr').fastTurn, true, '«Быстрый удар» — у каждого профиля свой');
  assert.ok(!L.PROF_KEYS.some(k => L.G_KEYS.includes(k)));
  // в профиле те же имена (старые экспорты, ручная правка) — не действуют
  assert.equal(L.profCfg({ p: { destr: { delayMs: 999 } } }, 'destr').delayMs, 0);
});

test('пауза и реакция — в границах: пауза 0–5 с шагом 0,1 с, реакция 0–3 с, «от» не больше «до»', () => {
  assert.deepEqual(L.paceCfg({}), { delay: 0, lo: 60, hi: 140 });
  assert.deepEqual(L.paceCfg(null), { delay: 0, lo: 60, hi: 140 });
  assert.equal(L.paceCfg({ delayMs: 1234 }).delay, 1200);
  assert.equal(L.paceCfg({ delayMs: 1250 }).delay, 1300);
  assert.equal(L.paceCfg({ delayMs: 99999 }).delay, 5000);
  assert.equal(L.paceCfg({ delayMs: -5 }).delay, 0);
  assert.equal(L.paceCfg({ delayMs: 'abc' }).delay, 0);
  assert.deepEqual(L.paceCfg({ reactMin: 500, reactMax: 100 }), { delay: 0, lo: 100, hi: 500 });
  assert.deepEqual(L.paceCfg({ reactMin: -1, reactMax: 9000 }), { delay: 0, lo: 0, hi: 3000 });
});

test('замер скорости: промежутки между ходами одного боя, от победы до победы, мобы в час', () => {
  let S = L.speedNote(null, { act: 1000 }, 1000);
  assert.equal(S.t0, 1000); assert.equal(S.acts, 1); assert.equal(S.gapN, 0);
  S = L.speedNote(S, { act: 1800 }, 1800); S = L.speedNote(S, { act: 2400 }, 2400);
  assert.equal(S.gapN, 2); assert.equal(S.gapSum, 1400);
  S = L.speedNote(S, { win: 2500 }, 2500);
  S = L.speedNote(S, { act: 9000 }, 9000);
  assert.equal(S.gapN, 2, 'первый ход нового боя — не «между ходами»');
  S = L.speedNote(S, { act: 30000 }, 30000);
  assert.equal(S.gapN, 2, 'пауза больше 10 с — не промежуток хода');
  S = L.speedNote(S, { win: 32500 }, 32500);
  assert.equal(S.cycN, 1); assert.equal(S.cycSum, 30000);
  S = L.speedNote(S, { kills: 3 }, 33000); S = L.speedNote(S, { kills: 0 }, 33000); S = L.speedNote(S, { kills: -2 }, 33000);
  assert.equal(S.kills, 3);
  const r = L.speedStats(S, 1000 + 4 * 60000);
  assert.equal(r.min, 4); assert.equal(r.acts, 5); assert.equal(r.wins, 2); assert.equal(r.gap, 0.7); assert.equal(r.cyc, 30);
  assert.equal(r.apm, 1); assert.equal(r.kph, 45);
  // мало данных — без «ходов в минуту» (меньше 30 с) и «мобов в час» (меньше 2 мин)
  const e = L.speedStats({ t0: 1000, acts: 3, kills: 1 }, 1000 + 20000);
  assert.equal(e.apm, null); assert.equal(e.kph, null); assert.equal(e.gap, null); assert.equal(e.cyc, null);
  assert.deepEqual(L.speedStats(null, 5), { min: 0, acts: 0, kills: 0, wins: 0, apm: null, gap: null, cyc: null, kph: null });
  // Старт пишет {t0} — замер начинается с него
  assert.equal(L.speedNote({ t0: 500 }, { act: 900 }, 900).t0, 500);
});

test('бот, настоящая пауза: следующее действие — не раньше паузы после прошлого; 0 — сразу; Стоп обрывает ожидание', async () => {
  let now = 10000, slept = 0;
  const ctx = { L, cfg: { delayMs: 1000, on: true }, Date: { now: () => now }, Math, status() {}, progress() {}, statusLog: [],
    alive: () => ctx.cfg.on, sleep: async ms => { slept += ms; now += ms; } };
  vm.createContext(ctx);
  const a = bot.indexOf('  let paceT = 0;'), b = bot.indexOf('  // Замер скорости (rt.spd)', a);
  vm.runInContext(bot.slice(a, b) + ';globalThis.P = { pace, paced, get t() { return paceT; } };', ctx);
  assert.equal(await ctx.P.pace(1), true); assert.equal(slept, 0, 'первое действие — без ожидания');
  ctx.P.paced(); now += 300;
  assert.equal(await ctx.P.pace(1), true); assert.equal(slept, 700, 'ждали остаток паузы');
  ctx.P.paced(); ctx.cfg.delayMs = 0; slept = 0;
  assert.equal(await ctx.P.pace(1), true); assert.equal(slept, 0, '0 — без паузы');
  ctx.cfg.delayMs = 3000; ctx.P.paced(); ctx.cfg.on = false;
  assert.equal(await ctx.P.pace(1), false, 'Стоп во время паузы — действие не делаем');
});

test('бот: пауза — перед каждым действием в игре, потерянный клик паузу не тратит; реакция — пауза круга', () => {
  const pr = bot.slice(bot.indexOf('  async function press('), bot.indexOf('  // ---------- бой'));
  assert.ok(pr.indexOf('await pace(g)') < pr.indexOf('await gameIdle(1500, g)'), 'сначала пауза, потом свободная игра и новый план (still)');
  assert.match(pr, /const pt0 = paceT;\n\s+if \(!fire\(s\.b, g\)\) \{ fastMark\(''\); return false; \}\n\s+paced\(\);/);
  assert.match(pr, /pressWhy = 'lost'; paceT = pt0;/);
  assert.match(pr, /pressWhy = 'ok'; spdNote\(\{ act: t0 \}\);/);
  // выбор моба на карте, «Охотиться дальше», бой из списка Ashen и следующий из списка, телепорт, запись на TvT, баффер, «в город»
  assert.match(bot, /if \(!\(await pace\(g\)\) \|\| !fire\(m\.a, g\)\) return;\n\s+paced\(\);/);
  assert.match(bot, /if \(!\(await pace\(g\)\)\) return;\n\s+await gameIdle\(\);\n\s+if \(!alive\(g\) \|\| !fire\(hunt, g\)\) return;\n\s+paced\(\);/);
  assert.match(bot, /if \(!\(await pace\(g\)\) \|\| !fire\(pick\.btn, g\)\) return;\n\s+paced\(\);/);
  assert.match(bot, /if \(!\(await pace\(g\)\)\) return; paced\(\); await go\('\/battle\.html\?spawnId='/);
  assert.match(bot, /if \(!\(await pace\(g\)\)\) return;\n\s+await gameIdle\(\);\n\s+if \(!fire\(btn, g\)\) return;\n\s+paced\(\);/);
  assert.match(bot, /if \(!\(await pace\(g\)\)\) return true;\n\s+await gameIdle\(\);\n\s+if \(!fire\(b, g\)\) return true;\n\s+paced\(\);\n\s+log\(`TvT: регистрация отправлена/);
  assert.match(bot, /await pace\(g\); if \(fire\(b, g\)\) paced\(\);/);
  assert.match(bot, /if \(!alive\(g\) \|\| !\(await pace\(g\)\)\) return;\n\s+if \(fire\(rb, g\)\) paced\(\);/);
  assert.match(bot, /await pace\(g\); await gameIdle\(\); if \(fire\(btn, g\)\) paced\(\);/);
  // замер: победа — один раз на экран победы; мобы — по счётчику игры; Старт и команда меню — замер с нуля
  assert.match(bot, /const wk = spawnId\(\) \+ '\|' \+ lastActOk;\n\s+if \(wk !== winKey\) \{ winKey = wk; spdNote\(\{ win: Date\.now\(\) \}\); \}/);
  assert.match(bot, /if \(r\.add > 0\) \{ progress\(\); spdNote\(\{ kills: r\.add \}\);/);
  assert.match(bot, /spd: \{ t0: Date\.now\(\) \}, spotBad: \{\} \}\);/);
  assert.match(bot, /\} else if \(c\.type === 'spdReset'\) \{\s+\/\/[^\n]*\n\s+setRt\(\{ cmdDone: c\.id, spd: \{ t0: Date\.now\(\) \} \}\);/);
  assert.match(bot, /const spdNote = ev => \{ if \(owner && cfg\.on\) setRt\(\{ spd: L\.speedNote\(rt\.spd, ev, Date\.now\(\)\) \}\); \};/);
});

test('меню: раздел «⚡ Скорость» — ползунок паузы, реакция, «Быстрый удар» (переехал из «Ещё»), замер и сброс', () => {
  const sec = html.slice(html.indexOf('<section id="speedBox">'), html.indexOf('</section>', html.indexOf('<section id="speedBox">')));
  for (const id of ['delayMs', 'delayVal', 'reactMin', 'reactMax', 'fastTurn', 'spdStat', 'spdReset']) assert.match(sec, new RegExp(`id="${id}"`), id);
  assert.match(sec, /<input id="delayMs" type="range" min="0" max="5000" step="100">/);
  const more = html.slice(html.indexOf('<details>'), html.indexOf('</details>'));
  assert.doesNotMatch(more, /fastTurn/, '«Быстрый удар» — в «Скорости»');
  assert.ok(html.indexOf('id="speedBox"') > html.indexOf('id="skills"') && html.indexOf('id="speedBox"') < html.indexOf('<details>'));
  assert.match(pj, /\$\('delayMs'\)\.onchange = e => save\(\{ delayMs: L\.paceCfg\(\{ delayMs: e\.target\.value \}\)\.delay \}\);/);
  assert.match(pj, /\$\('reactMin'\)\.onchange = e => save\(\{ reactMin: clampNum\(e\.target\.value, 0, 3000, 60\) \}\);/);
  assert.match(pj, /\$\('reactMax'\)\.onchange = e => save\(\{ reactMax: clampNum\(e\.target\.value, 0, 3000, 140\) \}\);/);
  assert.match(pj, /\$\('spdReset'\)\.onclick = \(\) => save\(\{\}, 'spdReset'\);/);
  assert.match(pj, /const S = L\.speedStats\(rt\.spd, Date\.now\(\)\)/);
  assert.match(pj, /setInterval\(\(\) => \{ paintStatus\(\); paintSpeed\(false\); \}, 5000\);/);
  assert.match(html, /Пауза и реакция — общие для всех профилей/);
});
