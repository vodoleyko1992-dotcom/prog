'use strict';
// 10.0.7 (игрок 13.10 03:16, скрин Warlock 67 против Tomb Guard 75: «бот пытается бить моба больше чем на 5 лвл старше»): верхний предел
// «до героя +» по умолчанию +5 (было 99, у игрока 20); цепочка «Охотиться дальше» подсунула моба выше предела — не бьём, на карту
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const content = read('content.js'), combat = read('modules/combat.js'), popup = read('popup.js');
// 1. умолчания и миграция: +5 в ядре и меню; у кого было шире (20, 99) — один раз сводится к +5
assert.match(content, /lvlMin: 1, lvlMax: 99, lvlAbove: 5, lvlBelow: 5,/, 'core default −5…+5');
assert.match(popup, /lvlMin: 1, lvlMax: 99, lvlAbove: 5, lvlBelow: 5,/, 'menu default −5…+5');
assert.match(content, /once\('lvlTop1007', \(\) => \{ if \(!\(\+C\('lvlAbove'\) <= 5\)\) cf\.lvlAbove = 5; \}\);/, 'migration');
assert.ok(content.indexOf("once('lvlTopMig'") < content.indexOf("once('lvlTop1007'"), 'new migration runs after the old «no cap» one');
assert.match(read('popup.html'), /По умолчанию \+5: мобов выше героя больше чем на N ур\. бот не выбирает/);
// 1б (игрок 03:19 «в базе выстави вот так»): окно −5…+5 и для источников ресурса/Маммона — умолчания, базовый профиль, миграция
assert.match(content, /farmLvlBelow: 5, farmLvlAbove: 5,/); assert.match(content, /farmWin = L => \(\{ lo: L - \(cfg\.farmLvlBelow \?\? 5\)/);
assert.match(content, /once\('win1007', \(\) => Object\.assign\(cf, \{ lvlBelow: 5, farmLvlBelow: 5, farmLvlAbove: 5 \}\)\);/);
{ const bc = JSON.parse(read('base-profile.json')).cfg; assert.deepEqual([bc.lvlBelow, bc.lvlAbove, bc.farmLvlBelow, bc.farmLvlAbove], [5, 5, 5, 5], 'base profile −5…+5'); }
// 2. mobfarm: моб +6 при пределе +5 — не кандидат; ★ квест — до +10; предел 99 — без ограничения
const mf = read('modules/mobfarm.js'), recs = [];
const menv = { cfg: { priority: '[квест]\n[чемп]\n[все]', searchChamp: true, searchQuest: true, lvlBelow: 3, lvlAbove: 5, lvlMin: 1, lvlMax: 99 },
  rt: { spawns: { a: ['Tomb Guard', 75], b: ['Frost Buffalo', 70], q: ['Requiem Lord', 76], c: ['Lost Yeti', 74] }, lvl: 67 }, PAGE_SIZE: 15,
  champs: { judge: () => ({ ok: true, lim: 100 }) }, cancelRisk: () => null,
  NET_SPAWNS: { t: Date.now(), kind: { a: 'mob', b: 'mob', q: 'mob', c: 'champion' }, tier: { c: 'red' }, hp: { c: 100000 }, exp: { c: 200000 } },
  heroLvl: () => 67, isRaidId: () => false, isBoss: () => false, isQuestName: n => /requiem/i.test(n),
  campActive: () => false, campChampOpen: () => false, campChampMin: () => 0, campMobOpen: () => [], farmRules: () => [], recipeRules: () => [],
  rec: (...a) => recs.push(a.join(' | ')), setRt: async p => Object.assign(menv.rt, p) };
const ctxm = { console, Date, Math, JSON, Object, Number, String, Array, Set, Map, RegExp, Promise, CSS: { escape: s => s }, document: { querySelectorAll: () => [] } }; ctxm.globalThis = ctxm;
vm.runInNewContext(mf, ctxm); const M = ctxm.L2V7Factories.mobfarm(menv);
const pick = () => Array.from(M.candidates(M.parseRules(), { ids: ['a', 'b', 'q', 'c'], quest: ['Requiem Lord'] }, menv.NET_SPAWNS.kind, 99), x => x.id).sort();
assert.deepEqual(pick(), ['b', 'q'], 'Tomb Guard +8 and red champion +7 skipped, +3 mob and ★ quest +9 kept');
menv.cfg.lvlAbove = 99; assert.deepEqual(pick(), ['a', 'b', 'c', 'q'], '99 — no cap, as before');
menv.cfg.lvlAbove = 8; assert.deepEqual(pick(), ['a', 'b', 'c', 'q'], 'player widened to +8 — Tomb Guard allowed');
// 3. combat: моб из цепочки выше предела — «не бью, на карту» (нетронутый бой, не РБ, не ★ квест, не источник ресурса, не чемпион главы)
assert.match(combat, /const hl = env\.heroLvl\(\) \|\| env\.rt\.lvl \|\| 0, up = env\.cfg\.lvlAbove \?\? 5, lv = rbLvl \|\| ctx\.lvl \|\| 0, farmT = !!nm && \(env\.farmRules\?\.\(\) \|\| \[\]\)\.some\(x => x\.farm && x\.name === nm\);/);
assert.match(combat, /if \(!isRb && hl && lv && up < 99 && lv > hl \+ up && !ctx\.questKill && !farmT && !\(ctx\.champ && env\.campActive\(\) && env\.campChampOpen\(\)\)\n\s+&& mob0 && mob0\.cur >= mob0\.max \* 0\.98 && !extraMobs\(\)\.some\(x => x\.cur > 0\)\) \{/);
assert.match(combat, /выше героя на \$\{lv - hl\} \(предел \+\$\{up\}\) — не бью, на карту`\); await env\.setRt\(\{ target: null \}\); return env\.toMap\(\);/);
assert.ok(combat.indexOf('выше героя на ${lv - hl}') < combat.indexOf('ctx.hp0 = mob0?.cur || 0; ctx.hp0T = Date.now(); ctx.hp0N = nm;'), 'guard before the fight starts');
assert.match(content, /L2V7Modules\.combat = L2V7Factories\.combat\(\{ get champs\(\) \{ return L2V7Modules\.champs; \}, get rbRun\(\) \{ return L2V7Modules\.rbrun; \}, get farmRules\(\) \{ return farmRules; \},/, 'combat: геттер farmRules');
console.log('PASS: 10.0.7 upper level cap — default +5 (migration from 99/20), candidates and chain fights above hero + N skipped (★ quest, resource source, chapter champion, RB excepted), 99 = no cap');
