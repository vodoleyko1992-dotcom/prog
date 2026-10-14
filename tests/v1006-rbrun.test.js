'use strict';
// 10.0.6 (игрок 13.10 02:02: «создай кнопочку, чтобы можно было смотреть, что выпало в результате серии РБ, после нового запуска
// серии данные собираются снова»): modules/rbrun.js — учёт наград и дропа с РБ/эпиков за серию (rt.rbRun), сброс при запуске
// режима из меню, кнопка «📦 Серия РБ» в окне бота, смерти только пока идёт режим
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), J = x => JSON.parse(JSON.stringify(x));
const LOOT_RE = /^(.+?)\s*×\s*(\d+)$/, SPECIAL_RE = /^Випа\S*\s+(.+?)\s*\+\s*(\d+)$/i;
function make({ rt = {}, cfg = {} } = {}) {
  const recs = [], ctx = { Date, Math, Object, String, Number, Array, Set, JSON, console };
  ctx.globalThis = ctx; vm.runInNewContext(read('modules/rbrun.js'), ctx);
  const env = { rt, cfg, LOOT_RE, SPECIAL_RE, rec: (...a) => recs.push(a.join(' ')), setRt: p => { Object.assign(env.rt, p); return Promise.resolve(); } };
  return { R: ctx.L2V7Factories.rbrun(env), env, recs };
}
(async () => {
  // 1. вещи из журнала победы: предметы ×N, «Випало … +N», FA отдельно; EXP/SP/аден/квест — не вещи
  const { R, env, recs } = make({ cfg: { rbHuntMode: true }, rt: { rbRun: { t0: 1000, mode: 'tour' } } });   // меню записало только t0/mode
  assert.deepEqual(J(R.parseItems(['EXP +704393', 'SP +371706', 'аден +269184', 'Spellbook: Blaze ×1', 'Fast Aden ×2', 'Випало Coin of Luck +1', '★ Квест: Орфен 1 / 1', 'Blue Wolf Helmet Design ×3'])),
    { 'Spellbook: Blaze': 1, 'Fast Aden': 2, 'Coin of Luck': 1, 'Blue Wolf Helmet Design': 3 });
  await R.kill({ id: 'l2dop_rb_1', name: 'Rahha', lvl: 65, adena: 269184, exp: 704393, sp: 371706, lines: ['аден +269184', 'Spellbook: Blaze ×1', 'Fast Aden ×2'], fightS: 120 });
  await R.kill({ id: 'l2dop_rb_1', name: 'Rahha', lvl: 65, adena: 100000, exp: 50000, lines: ['Spellbook: Blaze ×1', 'Mithril Ore ×4'] });
  await R.kill({ id: 'l2dop_rb_29014', name: 'Орфен', lvl: 50, adena: 1, exp: 2, lines: [], epic: true });
  const r = env.rt.rbRun;
  assert.equal(r.t0, 1000, 'запуск серии из меню сохранён'); assert.equal(r.mode, 'tour');
  assert.equal(r.kills, 3); assert.equal(r.adena, 369185); assert.equal(r.exp, 754395); assert.equal(r.sp, 371706); assert.equal(r.fa, 2);
  assert.deepEqual(J(r.items), { 'Spellbook: Blaze': 2, 'Mithril Ore': 4 }, 'FA не в вещах, вещи суммируются');
  assert.equal(r.bosses.length, 3); assert.equal(r.bosses[2].ep, 1); assert.equal(r.bosses[0].s, 120);
  assert.match(recs[0], /📦 Rahha \(65\): аден \+269\s184 · EXP \+704\s393 · FA \+2 · Spellbook: Blaze ×1/);
  assert.match(recs[2], /вещей не выпало/);
  // 2. смерть считается только пока идёт режим РБ/эпиков
  assert.equal(await R.death(), true); assert.equal(env.rt.rbRun.deaths, 1);
  env.cfg.rbHuntMode = false; assert.equal(await R.death(), false); assert.equal(env.rt.rbRun.deaths, 1, 'режим выключен — смерть не в серию');
  // 3. сводка: убитые по именам с ×N, вещи по убыванию, строки для окна
  const S = R.summary(); assert.deepEqual(J(S.bosses), ['Rahha (65) ×2', 'Орфен (50)']); assert.deepEqual(J(S.items), [['Mithril Ore', 4], ['Spellbook: Blaze', 2]]); assert.equal(S.nItems, 6);
  const Lw = R.lines(true); assert.equal(Lw.length, 4);
  assert.match(Lw[0], /\(тур РБ, режим выключен\) · РБ убито 3 · смертей 1/); assert.match(Lw[1], /аден \+369\s185 · EXP \+754\s395 · SP \+371\s706 · 💎 FA \+2/);
  assert.match(Lw[2], /убиты: Rahha \(65\) ×2, Орфен \(50\)/); assert.match(Lw[3], /выпало \(6 шт\.\): Mithril Ore ×4, Spellbook: Blaze ×2/);
  // 4. новая серия обнуляет всё; без серии бой с РБ сам её начинает
  await R.start('manual', 'кнопка'); assert.equal(env.rt.rbRun.kills, 0); assert.deepEqual(J(env.rt.rbRun.items), {}); assert.equal(env.rt.rbRun.mode, 'manual');
  assert.match(recs.at(-1), /📦 новая серия \(вручную, кнопка\)/);
  { const m = make({ cfg: { epicMode: true } }); assert.match(m.R.lines(false)[0], /серия РБ ещё не начиналась/);
    await m.R.kill({ name: 'Core', lvl: 50, adena: 5, exp: 6, lines: ['Ring of Core ×1'] }); assert.equal(m.env.rt.rbRun.mode, 'epic'); assert.equal(m.env.rt.rbRun.kills, 1); }
  // 5. узкое окно — не больше 12 видов вещей, «… ещё N видов»; предел видов 80
  { const m = make({ rt: { rbRun: { t0: 1, mode: 'one' } } });
    await m.R.kill({ name: 'X', lines: Array.from({ length: 90 }, (_, i) => `Item${i} ×${i + 1}`) });
    assert.equal(Object.keys(m.env.rt.rbRun.items).length, 80); assert.match(m.R.lines(false)[3], /… ещё 68 видов/); assert.ok(!/… ещё/.test(m.R.lines(true)[3])); }
  // 6. проводка: манифест, геттеры, бой → kill, смерть → death, меню запускает серию, кнопка в окне бота
  const content = read('content.js'), combat = read('modules/combat.js'), popup = read('popup.js'), surv = read('modules/survival.js'), daily = read('modules/dailies.js');
  assert.ok(JSON.parse(read('manifest.json')).content_scripts.some(c => c.js.includes('modules/rbrun.js') && c.js.indexOf('modules/rbrun.js') < c.js.indexOf('content.js')));
  assert.ok(/L2V7Modules\.rbrun = L2V7Factories\.rbrun\(\{ get cfg\(\)[\s\S]{0,400}get LOOT_RE\(\)[^\n]*get SPECIAL_RE\(\)/.test(content), 'регистрация модуля rbrun с геттерами');
  for (const m of ['combat', 'survival', 'dailies']) assert.ok(new RegExp(`L2V7Modules\\.${m} = L2V7Factories\\.${m}\\(\\{ get \\w+\\(\\) \\{ return [^}]+\\}, get rbRun\\(\\) \\{ return L2V7Modules\\.rbrun; \\}`).test(content), m + ': геттер rbRun');
  assert.ok(/await env\.rbRun\?\.kill\(\{ id: ctx\.rb\.id, name: ctx\.name, [^\n]*adena, exp, sp: pick\([^\n]*lines: env\.newLines\(ctx\.logStart \|\| \[\], env\.logLines\(\)\), epic: !!env\.epicById\?\.\(ctx\.rb\.id\), fightS \}\)/.test(combat), 'combat: /await env\.rbRun\?\.kill\(\{ id: ctx\.rb\.id, nam');
  assert.ok(combat.indexOf('env.rbRun?.kill(') > combat.indexOf("rbKills: (env.rt.rbKills || 0) + 1"), 'учёт после записи убийства РБ');
  assert.ok(/env\.rec\('B', 'смерть', `смертей за 30 мин: \$\{deaths\.length\}`\);\n  try \{ await env\.rbRun\?\.death\(\); \}/.test(surv), 'surv: /env\.rec\(\'B\', \'смерть\', `смертей за 30 мин: \$\{');
  // 10.0.14: вход вынесен в enterDetour, который продолжает сохранённый дейлик после Stop; режим и старт серии остаются связаны.
  assert.ok(/async function enterDetour[\s\S]*rbHuntMode: true, fishMode: false, epicMode: false, catMode: false \}\);[\s\S]*if \(key === 'dailyRb' && sameDetour\(key, D, kick\)\) try \{ await env\.rbRun\?\.start\('daily'/.test(daily), 'daily: enterDetour включает тур РБ и запускает серию после проверки текущего задания');
  assert.ok(/m === 'rb'\) await activateMode\(\{ \.\.\.leaveEpic, rbRun: \{ t0: now, mode: 'tour' \}/.test(popup), 'popup: /m === \'rb\'\) await activateMode\(\{ \.\.\.leaveEp');
  assert.ok(/m === 'epic'\) await activateMode\(\{ \.\.\.leaveHunt, rbRun: \{ t0: now, mode: 'epic' \}/.test(popup), 'popup: /m === \'epic\'\) await activateMode\(\{ \.\.\.leave');
  assert.ok(/rbOne: one, \.\.\.\(tour \? \{\} : \{ rbRun: \{ t0: now, mode: 'one' \}/.test(popup), '«один РБ»: новая серия только если тур не шёл');
  assert.ok(!/m === 'farm'\) await activateMode\(\{[^\n]*rbRun/.test(popup) && !/\$\('start'\)\.onclick[\s\S]{0,600}rbRun/.test(popup), '«▶ Старт» и другие режимы серию не трогают');
  assert.ok(/data-rbrun="toggle"/.test(content), 'content: /data-rbrun="toggle"/'); assert.ok(/data-rbrun="reset"/.test(content), 'content: /data-rbrun="reset"/'); assert.ok(/#l2bot-ind \.b \.bt\{pointer-events:auto/.test(content), 'content: /#l2bot-ind \.b \.bt\{pointer-events:auto/');
  assert.ok(content.indexOf("L2V7Modules.rbrun.lines(wide, now)") < content.indexOf("const ep = epicRespTxt(wide, now); L.push(ep || '— 🏛 маммон —');"), 'блок серии — перед «Респ эпиков»');
  // 7. фон: команда rbRunSet пишет только rbRun и только со страницы игры (кнопка «↺ Новая серия» работает и без замка вкладки)
  { const store = { rt: { char: 'Warlock', zoneStat: { a: 1 }, rbRun: { t0: 5, kills: 3 } } }, L = [];
    const ev = () => ({ addListener: f => L.push(f) });
    const chrome = new Proxy({
      runtime: { onMessage: { addListener: f => L.push(f) }, getURL: p => 'chrome-extension://x/' + p, getManifest: () => ({ version: '1' }), onInstalled: ev(), onStartup: ev(), id: 'x' },
      storage: { local: { get: async k => Object.fromEntries([].concat(k || Object.keys(store)).map(x => [x, store[x]])), set: async v => Object.assign(store, v), remove: async () => {} }, onChanged: ev(), session: { get: async () => ({}), set: async () => {} } },
      alarms: { create() {}, clear: async () => {}, get: async () => null, onAlarm: ev() }, tabs: { onRemoved: ev(), onUpdated: ev(), query: async () => [], get: async () => ({}) }
    }, { get: (o, k) => k in o ? o[k] : new Proxy({}, { get: (_, kk) => kk.startsWith('on') ? ev() : async () => {} }) });
    const bctx = { chrome, console, setTimeout, clearTimeout, setInterval, clearInterval, URL, indexedDB: undefined, self: {}, fetch: async () => ({ ok: false }) };
    bctx.globalThis = bctx; vm.createContext(bctx); try { vm.runInContext(read('background.js'), bctx); } catch (e) {}
    const send = (m, s) => new Promise(res => { let done = false; for (const f of L) { const ret = f(m, s, x => { done = true; res(x); }); if (ret === true || done) return; } res(undefined); });
    const fresh = { t0: 77, mode: 'manual', kills: 0, items: {}, bosses: [] };
    assert.ok(!(await send({ cmd: 'rbRunSet', rbRun: fresh }, { url: 'https://evil.example/x', tab: { id: 1 } }))?.ok, 'чужая страница не пишет');
    assert.ok(!(await send({ cmd: 'rbRunSet', rbRun: [] }, { url: 'https://l2wap.com/map.html', tab: { id: 1 } }))?.ok, 'мусор не пишется');
    assert.ok((await send({ cmd: 'rbRunSet', rbRun: fresh }, { url: 'https://l2wap.com/battle.html', tab: { id: 1 } }))?.ok, 'страница игры обнуляет серию');
    assert.equal(store.rt.rbRun.t0, 77); assert.equal(store.rt.rbRun.kills, 0); assert.deepEqual(store.rt.zoneStat, { a: 1 }, 'прочая память не тронута'); }
  assert.ok(/cmd: 'rbRunSet', rbRun: r/.test(content) && /async function rbRunReset\(\)/.test(content), 'кнопка «↺ Новая серия» шлёт команду в фон');
  console.log('PASS: 10.0.6 «📦 Серия РБ» — rewards and drop per RB series: parse, accumulate, FA apart, deaths only in RB mode, summary lines, reset on mode start/button, wiring');
})().catch(e => { console.error('FAIL:', e.stack || e.message); process.exit(1); });
