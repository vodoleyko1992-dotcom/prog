'use strict';
// 10.0 скорость цепочки и боя (лог 12.10 10:51–12:02, Warlock 63: 1,82 с на моба, из них ≈0,9 с — ожидания бота) + правки аудита боя
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const content = read('content.js'), combat = read('modules/combat.js'), mobfarm = read('modules/mobfarm.js'), fl = read('modules/fightlab.js'), surv = read('modules/survival.js');

// 1. анализатор боя: хвост delta не попадает второй раз в следующий полный лог
{ let NOW = 1e6; const ctx = { Date: { now: () => NOW }, Math, Object, String, Number, Array, Set, JSON, console, URLSearchParams }; ctx.globalThis = ctx;
  vm.runInNewContext(fl, ctx);
  const env = { rt: {}, cfg: {}, rec: () => {}, fmtT: s => s + ' с', setRt: p => (Object.assign(env.rt, p), Promise.resolve()), actName: a => a, mobTitle: () => '', isChamp: () => false, isBoss: () => false };
  const F = ctx.L2V7Factories.fightlab(env);
  const net = (action, bt) => F.onNet('/game/battle/action', { status: 200, req: { action, battleSpawnId: 'dense_1' }, res: {}, bt: { log: [], ...bt } });
  F.onNet('/game/battle/start', { status: 200, req: {}, res: {}, bt: { log: [], spawn: 'dense_1', mob: 9000, mobMax: 9000, hp: 5000, mp: 4000, name: 'Banshee', lvl: 63, seq: 1 } });
  NOW += 1000; assert.equal(net('l2_1274', { full: true, seq: 2, mob: 8900, log: ['Енергетична блискавка 100'] }).own, 100);
  NOW += 1000; assert.equal(net('l2_1274', { seq: 3, mob: 8700, log: ['Енергетична блискавка 200'] }).own, 200);
  NOW += 1000; assert.equal(net('l2_1274', { full: true, seq: 4, mob: 8400, log: ['Енергетична блискавка 100', 'Енергетична блискавка 200', 'Енергетична блискавка 300'] }).own, 300, 'delta tail not counted twice'); }

// 2. исходник: цепочка без ожидания записи, опрос 50 мс, «Охотиться дальше» в полёте — до 15 с; после боя на странице боя — 40 мс
assert.match(mobfarm, /env\.setRt\(\{ via: 'chain' \}\);\n\s*const href = location\.href, t0 = Date\.now\(\);/);
assert.match(mobfarm, /let ok = await env\.waitFor\(started, 8000, 50\);/);
assert.match(mobfarm, /net\.huntT >= t0 && !\(\(net\.huntDoneT \|\| 0\) >= net\.huntT\)\) ok = await env\.waitFor\(started, 7000, 50\)/);
assert.match(content, /if \(p === '\/game\/battle\/hunt-continue'\) ACT_NET\.huntT = Date\.now\(\);/);
assert.match(content, /if \(path === '\/game\/battle\/hunt-continue'\) ACT_NET\.huntDoneT = Date\.now\(\);/);
assert.match(content, /await sleep\(isBattle\(\) \? 40 : 200\);/);
assert.match(combat, /mobHp\(\) \? 'fight' : null, 10000, 50\);/);
// 3. бой: потерянный клик — 0,7 с (не 3 с); отказ сервера — без ожидания по экрану; дебафф — по строке журнала, не 0,5 с
assert.match(combat, /ctx\.lastLost = lost && !lockLost;/);
assert.match(combat, /ctx\.block\[a\.key\] = Date\.now\(\) \+ \(ctx\.lastLost \? 700 : a\.key === 'attack' \? 1000 : 3000\);/);
assert.match(combat, /let done = lost \|\| refused \? false :/);
assert.ok(!/ctx\.seq\.push\('✦'\);\n\s*await env\.sleep\(500\);/.test(combat), 'no fixed 0.5 s after a debuff');
// 4. анализатор видит слоты настоящей разметки (data-slot-cd на внутреннем span), память боя дописывается при уходе со страницы
assert.match(content, /document\.querySelector\(`\[data-slot-cd="\$\{a\}"\]`\)\?\.closest\('\.l2-battle-hotbar-slot'\)/);
assert.match(content, /addEventListener\('pagehide', \(\) => \{\n\s*try \{\n\s*try \{ if \(tabOwner\) L2V7Modules\.fightlab\?\.flush\?\.\(\); \} catch \(e\) \{\}/);
// 5. MP: экономия только без банки (банка на откате — не повод); бафф кота без резерва 25 %; HUD без HP — без TypeError на РБ
assert.match(combat, /potOk = !!\(potB && env\.qty\(potB\) !== 0\);/);
assert.match(combat, /potOk = !!potB && env\.qty\(potB\) !== 0;/);
assert.match(combat, /if \(ctx\.rb && me\) \{/);
// 6. «не пробиваю» при HP < 60 % — сначала выход из боя, потом баффер; смерть от РБ — spawnId из адреса
assert.match(combat, /if \(leave\) \{ env\.fire\(leave\); await env\.waitFor\(\(\) => !env\.isBattle\(\) \|\| null, 4000, 100\); \}\n\s*if \(await env\.restoreVitals/);
assert.match(surv, /rbId = \/\^l2dop_rb_\/i\.test\(urlRb\) \? urlRb : env\.rt\.target\?\.rb \? env\.rt\.rbCur : null/);
console.log('PASS: 10.0 speed — chain without waiting for the storage write, 50 ms polling, hunt-continue in flight waited up to 15 s, 40 ms between chain fights; lost click 0.7 s, server refusal not waited on screen, debuff result by log line; fightlab sees real hotbar slots, delta tail not double-counted, flushed on page leave; MP saved only without potions; RB HUD null-safe; leave battle before healer; RB death by URL');
