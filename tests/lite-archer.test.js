'use strict';
// Lite 1.5 (21.10, тред «Упрошенка под Дестра», John: «это дестр, есть сабкласс Лука, хотим бота и Луку научить»,
// «отдельный профиль на дестра, отдельный профиль на лука»): лучник — свой класс и профиль настроек; выстрелы игра шлёт
// именем (power_shot, double_shot, stun_shot — тред «Изучение лука», /mnt/project-files/lite/archer-study.md); лук без стрел
// не стреляет — бот считает стрелы в сумке и ждёт новые, если они кончились.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const L = require('../lite/logic.js');
const plain = x => JSON.parse(JSON.stringify(x));

// Слоты героя из разбора лука (21.10): основной Storm Screamer, Spectral Master, Титан, активен Phantom Ranger 48.
const SLOTS = [{ slot: 0, prof: 'dark_elf_storm_screamer', lvl: 78 }, { slot: 1, prof: 'dark_elf_spectral_master', lvl: 76 },
  { slot: 2, prof: 'orc_titan', lvl: 77 }, { slot: 3, prof: 'dark_elf_phantom_ranger', lvl: 48 }];

test('лучники: 2-я и 3-я профессии трёх рас; кинжальщики, 1-я профессия и Дестр — не лук', () => {
  for (const p of ['dark_elf_phantom_ranger', 'dark_elf_ghost_sentinel', 'human_hawkeye', 'human_sagittarius', 'elf_silver_ranger',
    'elf_moonlight_sentinel', 'Phantom Ranger', 'HAWKEYE']) { assert.equal(L.isArcher(p), true, p); assert.equal(L.clsKind(p), 'archer', p); }
  for (const p of ['dark_elf_assassin', 'human_rogue', 'elf_scout', 'dark_elf_abyss_walker', 'human_treasure_hunter', 'elf_plains_walker',
    'dark_elf_storm_screamer', 'orc_titan', '', null]) assert.equal(L.isArcher(p), false, String(p));
  assert.equal(L.clsKind('orc_titan'), 'destr'); assert.equal(L.clsKind('dwarf_bounty_hunter'), null);
});

test('класс героя: активен Phantom Ranger — ведём (профиль лука); активен основной маг — подсказка про Титана и лука', () => {
  const pr = L.heroClass('dark_elf_phantom_ranger', SLOTS, 3);
  assert.equal(pr.ok, true); assert.equal(pr.kind, 'archer'); assert.equal(pr.name, 'Dark Elf Phantom Ranger');
  assert.deepEqual(pr.alts, [{ slot: 2, name: 'Orc Titan', lvl: 77, kind: 'destr' }]);
  const mage = L.heroClass('dark_elf_storm_screamer', SLOTS, 0);
  assert.equal(mage.ok, false); assert.equal(mage.kind, null);
  assert.deepEqual(mage.alts.map(a => [a.slot, a.kind]), [[2, 'destr'], [3, 'archer']]);
  assert.deepEqual(mage.alt, mage.alts[0]);
  assert.equal(L.heroClass('orc_titan', SLOTS, 2).kind, 'destr');
});

test('выстрелы под именем игры — известные удары; бафф Soul of Sagittarius платит HP; дебаффы и приёмы кинжала у лука не жмутся', () => {
  const info = a => L.skillInfo(a, '');
  assert.deepEqual([info('power_shot').id, info('double_shot').id, info('stun_shot').id, info('soul_of_sagittarius').id], [56, 19, 101, 303]);
  for (const a of ['power_shot', 'double_shot', 'stun_shot']) { assert.equal(info(a).type, 'attack', a); assert.equal(L.skillUse(info(a), null, 'archer').on, true, a); }
  const soul = info('soul_of_sagittarius');
  assert.equal(soul.type, 'buff'); assert.ok(soul.hp > 0, 'цена HP'); assert.equal(L.skillUse(soul, null, 'archer').on, true);
  for (const a of ['l2_77', 'l2_91']) assert.equal(L.skillUse(info(a), null, 'archer').on, true, 'аура ' + a);
  for (const a of ['l2_122', 'l2_115', 'l2_2', 'l2_129', 'vicious_stance', 'l2_105']) assert.equal(L.skillUse(info(a), null, 'archer').on, false, a);
  // приёмы кинжала/меча: у лука по умолчанию нет (сервер их с луком не примет), у Дестра Power Strike — да; выстрелы у Дестра — нет
  for (const a of ['mortal_blow', 'l2_223', 'backstab', 'power_strike']) assert.equal(L.skillUse(info(a), null, 'archer').on, false, a);
  assert.equal(L.skillUse(info('l2_3'), null, 'destr').on, true);
  assert.equal(L.skillUse(info('power_shot'), null, 'destr').on, false);
  assert.equal(L.skillUse(info('mortal_blow'), { on: true }, 'archer').on, true, 'игрок включил сам');
  // имя игры, которого нет в таблице приёмов, — незнакомый скилл (по умолчанию выключен); служебные имена объекта — не скиллы
  assert.equal(info('switch_target').known, true);
  assert.equal(info('constructor').id, null); assert.equal(info('__proto__').known, false);
  // Rapid Shot — бафф, хотя и «_shot»
  assert.equal(info('rapid_shot').type, 'buff');
});

test('ход лучника: бафф → Double Shot → Stun Shot → Power Shot → атака; HP мало — бафф за HP не жмём', () => {
  const sk = (a, extra = {}) => ({ ...L.skillUse(L.skillInfo(a, ''), null, 'archer'), action: a, ready: true, ...extra });
  const me = { hp: 4000, maxHp: 5000, mp: 900, maxMp: 1000 }, mob = { hp: 9000, maxHp: 10000 };
  const bar = () => [sk('attack'), sk('power_shot', { i: 1 }), sk('double_shot', { i: 0 }), sk('stun_shot', { i: 2 }), sk('soul_of_sagittarius'), sk('l2_122'), sk('vicious_stance', { active: false })];
  let slots = bar();
  assert.equal(L.planTurn(slots, me, mob, { now: 1e6 }).slot.action, 'soul_of_sagittarius');
  slots.find(s => s.action === 'soul_of_sagittarius').active = true;
  const order = [];
  for (let n = 0; n < 4; n++) { const p = L.planTurn(slots, me, mob, { now: 1e6 }); order.push(p.slot.action); p.slot.ready = p.slot.type === 'basic'; }
  assert.deepEqual(order, ['double_shot', 'stun_shot', 'power_shot', 'attack']);
  // HP 12 %: цена HP бафф (185–364) не по карману — не жмём, бьём
  slots = bar();
  assert.equal(L.planTurn(slots, { hp: 600, maxHp: 5000, mp: 900, maxMp: 1000 }, mob, { now: 1e6 }).slot.action, 'double_shot');
});

test('профили: настройки 1.4 — профиль Дестра, у лука свои; запись из меню — в профиль, on — общий', () => {
  const old = { on: true, zone: 'giran_harbor', zoneName: 'Гавань Гірана', killLimit: 7, tvt: false, skills: { l2_190: { on: false, type: 'attack' } }, hpPot: 40 };
  const d = L.profCfg(old, 'destr'), a = L.profCfg(old, 'archer');
  assert.equal(d.kind, 'destr'); assert.equal(d.zone, 'giran_harbor'); assert.equal(d.killLimit, 7); assert.equal(d.tvt, false); assert.equal(d.hpPot, 40);
  assert.deepEqual(d.skills, old.skills); assert.equal(d.on, true);
  assert.deepEqual({ ...a, kind: undefined, on: undefined }, { ...L.DEF_PROF, kind: undefined, on: undefined }, 'лук — с умолчаний');
  assert.equal(a.on, true, 'Старт общий');
  assert.equal(L.profCfg(old, 'нечто').kind, 'destr');
  let raw = L.profPatch(old, 'archer', { killLimit: 3, skills: { power_shot: { on: false, type: 'attack' } } });
  raw = L.profPatch(raw, 'destr', { killLimit: 4 });
  raw = L.profPatch(raw, 'archer', { on: false });
  assert.equal(raw.on, false); assert.equal(raw.killLimit, 7, 'старое поле Дестра не трогаем');
  assert.deepEqual(raw.p, { archer: { killLimit: 3, skills: { power_shot: { on: false, type: 'attack' } } }, destr: { killLimit: 4 } });
  assert.equal(L.profCfg(raw, 'destr').killLimit, 4, 'p.destr важнее старого поля'); assert.equal(L.profCfg(raw, 'destr').zone, 'giran_harbor');
  assert.equal(L.profCfg(raw, 'archer').killLimit, 3); assert.equal(L.profCfg(raw, 'archer').zone, '');
  assert.deepEqual(L.profPatch({}, 'archer', { p: { x: 1 }, kind: 'destr' }), { p: {} }, 'служебные поля не пишем');
});

test('профили: смена Дестр ↔ лук меняет место охоты, счётчик, панель; выбранное в меню место важнее запомненного', () => {
  const rt = { zone: { id: 'giran_harbor', name: 'Гавань' }, k: { name: 'X', kills: 7, lastK: 1000, rev: 9 }, limitNoted: 5, bar: [{ a: 'l2_190', n: 'Fatal Strike' }],
    barCls: 'orc_titan', goZone: 'z', tpTry: [1], zoneBlockT: 9 };
  assert.equal(L.rtKind(rt), 'destr', 'память до 1.5 — Дестр');
  assert.equal(L.profSwap(rt, 'destr', {}), null);
  const a = { ...rt, ...L.profSwap(rt, 'archer', L.profCfg({}, 'archer')) };
  assert.equal(a.kind, 'archer'); assert.equal(a.zone, null, 'место лука — где он стоит'); assert.equal(a.k.kills, 0); assert.equal(a.k.lastK, null); assert.equal(a.k.name, 'X');
  assert.deepEqual(a.bar, []); assert.equal(a.barCls, ''); assert.equal(a.goZone, ''); assert.deepEqual(a.tpTry, []); assert.equal(a.zoneBlockT, 0);
  assert.deepEqual(a.by, { destr: { zone: rt.zone, kills: 7, limitNoted: 5, bar: rt.bar, barCls: 'orc_titan' } });
  assert.deepEqual(L.profRt(a, 'destr'), a.by.destr); assert.equal(L.profRt(a, 'archer').kills, 0);
  // лук набил 3, запомнил своё место — назад к Дестру: всё Дестра на месте, лук — в by
  const a2 = { ...a, zone: { id: 'cruma', name: 'Крума' }, k: { ...a.k, kills: 3 }, bar: [{ a: 'double_shot', n: 'Double Shot' }], barCls: 'dark_elf_phantom_ranger' };
  const d = { ...a2, ...L.profSwap(a2, 'destr', L.profCfg({}, 'destr')) };
  assert.equal(d.kind, 'destr'); assert.deepEqual(d.zone, rt.zone); assert.equal(d.k.kills, 7); assert.deepEqual(d.bar, rt.bar); assert.equal(d.limitNoted, 5);
  assert.deepEqual(Object.keys(d.by), ['archer'], 'активный профиль в by не держим');
  assert.equal(d.by.archer.kills, 3); assert.equal(d.by.archer.zone.id, 'cruma');
  // пока лук спал, в меню ему выбрали другое место — берём выбранное
  const back = L.profSwap(d, 'archer', L.profCfg({ p: { archer: { zone: 'forge', zoneName: 'Кузня' } } }, 'archer'));
  assert.deepEqual(back.zone, { id: 'forge', name: 'Кузня' }); assert.equal(back.k.kills, 3);
  assert.deepEqual(L.profSwap(d, 'archer', L.profCfg({ p: { archer: { zone: 'cruma' } } }, 'archer')).zone, { id: 'cruma', name: 'Крума' }, 'то же место — запомненное');
  assert.equal(JSON.stringify(back).includes('undefined'), false);
});

test('hook: стрелы в сумке по номерам предметов; без сумки — нет данных; строка для меню', async () => {
  const posts = [], routes = {};
  const fetch = async u => new Response(JSON.stringify(routes[new URL(u, 'https://l2wap.com').pathname]), { status: 200, headers: { 'content-type': 'application/json' } });
  const window = { fetch, postMessage: d => posts.push(d) };
  const box = { window, location: new URL('https://l2wap.com/map.html'), document: { documentElement: { dataset: {} } },
    XMLHttpRequest: function () {}, URL, Response, Headers, Date, console, Promise, JSON };
  box.XMLHttpRequest.prototype = { open() {}, send() {} };
  vm.createContext(box); vm.runInContext(read('lite/hook.js'), box);
  const last = () => plain(posts.filter(x => x.__l2lite === 'end').pop().ch);
  routes['/character'] = { character: { name: 'PR', l2Profession: 'dark_elf_phantom_ranger', inventory: { eq: { l1: { itemId: 286 } },
    stacks: [{ itemId: 1342, qty: 221 }, { itemId: 1344, qty: 497 }, { itemId: 728, qty: 269 }, { itemId: 1342, qty: 4 }, { itemId: 17, qty: 0 }] } } };
  await window.fetch('/character'); await new Promise(r => setTimeout(r, 5));
  assert.deepEqual(last().arrows, { 1342: 225, 1344: 497 });
  routes['/character'] = { character: { name: 'PR', inventory: { stacks: [{ itemId: 728, qty: 1 }] } } };
  await window.fetch('/character'); await new Promise(r => setTimeout(r, 5));
  assert.deepEqual(last().arrows, {}, 'сумка есть, стрел нет');
  routes['/character'] = { character: { name: 'PR' } };
  await window.fetch('/character'); await new Promise(r => setTimeout(r, 5));
  assert.equal(last().arrows, undefined, 'сумки нет в ответе — не знаем');
  assert.equal(L.arrowsText({ 1344: 497, 1342: 221 }), 'Fine Steel (C) 221 · Mithril (A) 497');
  assert.equal(L.arrowsText({ 1342: 0 }), ''); assert.equal(L.arrowsText(null), ''); assert.equal(L.arrowsText({ 999: 3 }), '#999 3');
});

test('бот: профиль по классу (profSync), стрелы кончились — охота стоит, выход из боя; меню — вкладки профилей', () => {
  const bot = read('lite/bot.js'), pj = read('lite/popup.js'), html = read('lite/popup.html');
  // класс из каждого ответа → профиль; смена — память в by, текущее действие бросаем
  assert.match(bot, /slots: Array\.isArray\(slots\) \? slots : null, t: Date\.now\(\) \};\n\s+profSync\(\);/);
  assert.match(bot, /setRt\(L\.profSwap\(rt, k, cfg\)\);\n\s+gen\+\+;/);
  assert.match(bot, /RAW = ch\[K_CFG\]\.newValue \|\| \{\}; cfg = L\.profCfg\(RAW, kindNow\(\)\); onCfg\(prev\);/);
  assert.match(bot, /L\.skillUse\(L\.skillInfo\(action, title\), \(cfg\.skills \|\| \{\}\)\[skillKey\(action, title\)\], cfg\.kind\)/);
  // стрелы: охота стоит (TvT нет), в бою — выход, отказ сервера из-за стрел — пауза до новых стрел
  assert.match(bot, /if \(limitDone\(\)\) return 'limit';\n\s+if \(arrowsOut\(\)\) return 'arrows';/);
  assert.match(bot, /if \(arrowsOut\(\)\) \{ arrowWait\(\); progress\(\); await sleep\(3000\); return; \}/);
  assert.match(bot, /if \(arrowsOut\(\)\) \{ arrowWait\(\); sess\.set\('l2lite\.left'/);
  assert.match(bot, /if \(!tvt && cfg\.kind === 'archer' && \/arrow\|стріл\|стрел\/i\.test\(end\.err \|\| ''\)\)/);
  assert.ok(bot.indexOf("if (arrowsOut()) return 'arrows';") < bot.indexOf("if (TVT_ACT) return 'tvt';"));
  assert.match(bot, /if \(n > 0 && n < ARROW_LOW && !rt\.arrowLow\) \{ setRt\(\{ arrowLow: 1 \}\);/, '«мало стрел» — один раз');
  // Старт: заново запоминаем места спящих профилей и снимаем «нет стрел»; сброс — счётчик профиля из меню
  assert.match(bot, /\[k, \{ \.\.\.\(v \|\| \{\}\), zone: null, limitNoted: 0 \}\]/);
  assert.match(bot, /const k = L\.KINDS\.includes\(c\.kind\) \? c\.kind : kind;/);
  // меню: вкладки, запись в профиль из вкладки, команда с профилем
  assert.match(html, /<div id="profs" class="profs" role="tablist"[^>]*>\s*<button type="button" role="tab" data-kind="destr">⚔ Дестр<i><\/i><\/button>\s*<button type="button" role="tab" data-kind="archer">🏹 Лук<i><\/i><\/button>/);
  assert.match(pj, /RAW = L\.profPatch\(cur, kind, patch\); syncCfg\(\);/);
  // профиль берётся до чтения хранилища: правка поля, потерявшего фокус от клика по вкладке, — в тот профиль, где её сделали
  assert.match(pj, /async function save\(patch, cmd\) \{\n\s+const kind = kindView\(\);/);
  assert.match(pj, /\[K_CMD\]: \{ id: cmdId\(\), type: cmd, kind, t: Date\.now\(\) \}/);
  assert.match(pj, /pick = b\.dataset\.kind === kindAct\(\) \? null : b\.dataset\.kind;/);
  assert.match(html, /<div id="arw" class="dim" hidden><\/div>/);
});
