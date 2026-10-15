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
  env.rt.rbHuntIdle = Date.now() + 60000; env.cfg.rbMode = true; env.rt.rbPending = 1; assert.equal(rbHold(), false, 'tour idle — stale rbPending does not hold autofarm');
  env.cfg.rbHuntMode = false; env.cfg.rbMode = true; env.rt.rbPending = 1; assert.equal(rbHold(), true, 'RB waiting here still holds'); }
// 2. тур: «≤ 3 платных телепорта к одному РБ в час» для всех веток выбора; выбор — с карты; медленный телепорт — не второй платный
// 14.10: раздельные wd/qb/fresh объединены в rbTourPlan; проверяем сам лимит для каждого вида цели, не имена прежних переменных.
{ const { mk } = require('./epic-harness.cjs'), now = Date.now();
  for (const kind of ['ordinary', 'wounded', 'quest', 'value']) {
    const m = mk({ hero: 55, cfg: { rbMaxBelow: 15, rbMaxAbove: 15, rbValueTour: kind === 'value' },
      // 15.10: лимит переходов проверяется на разведанной цели; неизвестные цифры теперь требуют разведку до выбора.
      rt: { rbListT: now, rbList: { boss: { name: 'РБ', alive: true, lvl: 50, price: 100000, unit: 'аден' } }, rbDb: {}, rbStats: { boss: { hp: 1000, patk: 1, matk: 1, src: 'api' } },
        rbWound: kind === 'wounded' ? { boss: { cur: 100, max: 1000, t: now } } : {} },
      env: { RB_WIN: 15, RB_TRY_MS: 600000, RB_RETRY_MS: 120000, storyRbIds: () => kind === 'quest' ? ['boss'] : [] } });
    assert.equal(m.R.rbListPick()?.id, 'boss', kind + ': eligible before the hourly cap');
    m.env.rt.rbGoCnt = { boss: [now - 3000, now - 2000, now - 1000] };
    assert.equal(m.R.rbListPick(), null, kind + ': third paid trip blocks every selection path');
    m.env.rt.rbGoCnt.boss[0] = now - 3600001;
    assert.equal(m.R.rbListPick()?.id, 'boss', kind + ': an expired trip releases the cap');
  }
}
// 15.10: после точной оценки всё так же проверяем местную метку до создания платного маршрута.
assert.match(raid, /if \(!env\.isMap\(\)\) \{ location\.href = '\/map\.html'; await env\.sleep\(3000\); return; \}\n\s*const h = raidList\(\)\.find\(r => r\.id === p\.id\)/);
assert.match(raid, /if \(!msg\) return;\n\s*return huntDone\(H\.id, `\$\{H\.name\}: телепорт не сработал — \$\{msg\}`\);/);
assert.match(raid, /idleMs = RB_IDLE_MS \* \[1, 2, 4\]\[idleN\]/);
// 3. лечение на мобах — цепочкой; после выбора зоны метка «при старте» снята; телепорт в зону — ждём до 8 с
// 15.10: фаза подготовки сохраняет цепочку лечения независимо от текста статуса.
assert.match(mob, /const healing = \(env\.rt\.rbHunt\?\.phase === 'prepare' \|\| env\.rt\.rbHunt\?\.last === 'лечусь на мобах'\)/);
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
