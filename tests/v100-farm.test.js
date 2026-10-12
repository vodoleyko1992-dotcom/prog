'use strict';
// 10.0 автофарм, тур РБ, телепорты (лог 12.10 11:16–12:02 + аудит фарма)
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const mob = read('modules/mobfarm.js'), raid = read('modules/raid.js'), nav = read('modules/navigation.js'), content = read('content.js'),
  loot = read('modules/loot.js'), en = read('modules/enemies.js'), tvt = read('modules/tvt.js');
// 1. тур РБ в простое не держит автофарм: rbHold по-настоящему
{ const ctx = { console, Date, Math, JSON, Object, Number, String, Array, Set, Map, RegExp, document: { querySelectorAll: () => [] } }; ctx.globalThis = ctx;
  const m = mob.match(/const rbHold = [^\n]+/)[0];
  const env = { cfg: { rbHuntMode: true }, rt: {} };
  const rbHold = vm.runInNewContext(`(env => { ${m}; return rbHold; })`, ctx)(env);
  assert.equal(rbHold(), true, 'tour picking an RB holds');
  env.rt.rbHuntIdle = Date.now() + 60000; assert.equal(rbHold(), false, 'tour idle — autofarm free');
  env.cfg.rbHuntMode = false; env.cfg.rbMode = true; env.rt.rbPending = 1; assert.equal(rbHold(), true, 'RB waiting here still holds'); }
// 2. тур: «≤ 3 платных телепорта к одному РБ в час» для всех веток выбора; выбор — с карты; медленный телепорт — не второй платный
assert.match(raid, /const wd = base\.filter\(\(\[id\]\) => rbWounded\(id\) && hourN\(id\) < 3\)/);
assert.match(raid, /qIds\.includes\(id\) && now - \(tried\[id\] \|\| 0\) > env\.RB_TRY_MS && hourN\(id\) < 3/);
assert.match(raid, /const fresh = candidates\.filter\(\(\[id\]\) => now - \(tried\[id\] \|\| 0\) > env\.RB_TRY_MS && hourN\(id\) < 3\)/);
assert.match(raid, /if \(!env\.isMap\(\)\) \{ location\.href = '\/map\.html'; await env\.sleep\(3000\); return; \}\n\s*\/\/ 8\.0 \(аудит РБ B1\)/);
assert.match(raid, /if \(!msg\) return;\n\s*return huntDone\(H\.id, `\$\{H\.name\}: телепорт не сработал — \$\{msg\}`\);/);
assert.match(raid, /idleMs = RB_IDLE_MS \* \[1, 2, 4\]\[idleN\]/);
// 3. лечение на мобах — цепочкой; после выбора зоны метка «при старте» снята; телепорт в зону — ждём до 8 с
assert.match(mob, /const healing = env\.rt\.rbHunt\?\.last === 'лечусь на мобах'/);
assert.match(mob, /zoneGo: \{ \.\.\.pick, t: Date\.now\(\) \}, zoneGoT: 0, zoneAutoKick: null \}/);
assert.match(nav, /await env\.waitX\(\(\) => !isTeleport\(\) \|\| \/недостат\|not enough\/i\.test/);
// 4. ресурс «только с РБ» — список раз в 60 мин, если подходящего не было; добыча после 200 видов пишется; враг — не жать кнопку каждые 4 с; TvT без id
assert.match(content, /\(rt\.farmWhy === 'rb:' \+ g\.key \? 60 : 20\) \* 60000/);
{ const cv = x => typeof x === 'number' ? x : +x?.n || 0; const src = loot.match(/const cap = [^\n]+?\};(?= )/)[0];
  const cap = vm.runInNewContext(`(cv => { ${src}; return cap; })`, {})(cv);
  const o = {}; for (let i = 0; i < 201; i++) o['old' + i] = 1; o.fresh = 50;
  assert.ok('fresh' in cap(o, 200), 'new frequent item kept'); }
assert.match(en, /skipWhy: 'нажал «напасть», жду боя'/);
assert.match(tvt, /env\.rt\.tvtDone === \(S\.id \|\| String\(S\.start \|\| ''\)\)/);
console.log('PASS: 10.0 farm — idle RB tour no longer pins autofarm, ≤3 paid RB teleports/h for every pick, pick from the map (no paying to fly where we stand), slow teleport ≠ retry, idle backoff 5/10/20 min, healing on mobs by chain, start-kick cleared after zone pick, zone teleport waited 8 s, RB-only resource list 60 min, loot cap by count, enemy button not spammed, TvT without event id');
