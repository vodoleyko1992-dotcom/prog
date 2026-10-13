'use strict';
// 10.0.5 (обновление игры 13.10 «Обновление чемпионов»): FA с чемпионов — синий 10 %, оранжевый 20 %, красный 60 %, обычный моб 1 %,
// только с мобов не ниже героя −5. Цвет — championTier в /game/map/spawns (живой ответ 13.10). Красные/оранжевые в окне — первыми, FA в журнал
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const load = (file, env) => { const ctx = { console, Date, Math, JSON, Object, Number, String, Array, Set, Map, RegExp, Promise, CSS: { escape: s => s },
  document: { querySelectorAll: () => [], prerendering: false }, location: { href: '' } }; ctx.globalThis = ctx;
  vm.runInNewContext(read(file), ctx); return ctx.L2V7Factories[path.basename(file, '.js')](env); };
const recs = [];
const env = { cfg: { priority: '[квест]\n[чемп]\n[все]', searchChamp: false, searchQuest: true, champFa: true, lvlBelow: 3, lvlAbove: 6, lvlMin: 1, lvlMax: 99 },
  rt: { spawns: {}, lvl: 66 }, PAGE_SIZE: 15, NET_SPAWNS: null, tabIdle: false,
  heroLvl: () => 66, isRaidId: id => /^l2dop_rb_/.test(id), isBoss: () => false, isQuestName: (n, q) => (q || []).includes(n),
  campActive: () => false, campChampOpen: () => false, campChampMin: () => 0, campMobOpen: () => [], farmRules: () => [], recipeRules: () => [],
  rec: (...a) => recs.push(a.join(' | ')), setRt: async p => Object.assign(env.rt, p) };
const mf = load('modules/mobfarm.js', env);

// 1. хук отдаёт цвет; netSpawns запоминает его
const hook = read('hook.js');
assert.match(hook, /x\.kind === 'champion' \? String\(x\.championTier \|\| 'blue'\)/, 'hook passes championTier');
(async () => {
  await mf.netSpawns([
    ['dense_1', 'aggressive', 'Kookaburra', 67, 100, ''],
    ['dense_2', 'champion', 'Buffalo', 70, 200, 'blue'],
    ['champ_o_wbp_0', 'champion', 'Buffalo', 70, 300, 'orange'],
    ['champ_r_wbp_0', 'champion', 'Kookaburra', 67, 400, 'red'],
    ['champ_r_low_0', 'champion', 'Grizzly', 60, 50, 'red'],
    ['dense_3', 'passive', 'Antelope', 68, 500, '']]);
  assert.equal(env.NET_SPAWNS.tier.champ_r_wbp_0, 'red');
  assert.equal(env.NET_SPAWNS.tier.dense_2, 'blue');
  assert.ok(recs.some(r => /Kookaburra \(67, красный\)/.test(r)), 'champions logged with colour, red first');
  // цвет без ответа сервера — по spawnId и по классу строки карты
  const saved = env.NET_SPAWNS; env.NET_SPAWNS = null;
  assert.equal(mf.champTier('champ_o_x_1'), 'orange');
  assert.equal(mf.champTier('dense_9', { closest: () => ({ className: 'l2-map-mob-item l2-map-mob-item--champion l2-map-mob-item--champion-red' }) }), 'red');
  assert.equal(mf.champTier('dense_9'), 'blue');
  env.NET_SPAWNS = saved;
  // 2. шанс FA: окно −5 от героя
  assert.equal(mf.faChance(true, 'red', 61, 66), 0.6);
  assert.equal(mf.faChance(true, 'red', 60, 66), 0, '66 − 5 = 61: с 60 ур. FA не падает');
  assert.equal(mf.faChance(false, '', 70, 66), 0.01);
  // 3. кандидаты: красный в окне — первым, потом оранжевый, даже при выключенном «Искать чемпионов» (правило [все])
  const sig = { ids: ['dense_1', 'dense_2', 'champ_o_wbp_0', 'champ_r_wbp_0', 'champ_r_low_0', 'dense_3'], quest: [] };
  env.cfg.lvlBelow = 10;
  const types = env.NET_SPAWNS.kind, rules = mf.parseRules();
  let c = mf.candidates(rules, sig, types, 99);
  assert.deepEqual(JSON.parse(JSON.stringify(c.slice(0, 2).map(x => x.id))), ['champ_r_wbp_0', 'champ_o_wbp_0'], 'red, then orange');
  const low = c.find(x => x.id === 'champ_r_low_0');
  assert.ok(!low, 'red champion 6 levels below — not a target at all (floor −5, even with lvlBelow 10)');
  assert.ok(!c.find(x => x.id === 'dense_2').faHot, 'blue — ordinary priority');
  // ★ квест выше FA-чемпиона
  sig.quest = ['Antelope'];
  c = mf.candidates(mf.parseRules(), sig, types, 99);
  assert.equal(c[0].id, 'dense_3', 'quest target stays first');
  assert.equal(c[1].id, 'champ_r_wbp_0');
  sig.quest = [];
  // галочка выключена — чемпионы как обычные мобы
  env.cfg.champFa = false;
  c = mf.candidates(mf.parseRules(), sig, types, 99);
  assert.ok(!c.some(x => x.faHot), 'champFa off — no FA priority');
  env.cfg.champFa = true;
  // 4. учёт FA после победы
  const lenv = { cfg: {}, rt: { lvl: 66 }, heroLvl: () => 66, LOOT_RE: /^(.+?)\s*×\s*(\d+)$/, rec: (...a) => recs.push(a.join(' | ')) };
  const lt = load('modules/loot.js', lenv);
  let fd = lt.faNote(['Fast Aden ×1', 'Coal ×3'], 'Kookaburra', { champ: true, tier: 'red', lvl: 67 });
  assert.deepEqual(JSON.parse(JSON.stringify([fd.k, fd.f])), [{ red: 1 }, { red: 1 }]);
  assert.ok(recs.some(r => /FA \| 💎 Fast Aden \+1 — Kookaburra \(67, чемпион, красный\)/.test(r)));
  lenv.rt.faDrop = fd;
  fd = lt.faNote(['Coal ×3'], 'Grizzly', { champ: true, tier: 'red', lvl: 60 });
  assert.equal(fd.k.low, 1); assert.equal(fd.f.red, 1);
  assert.ok(recs.some(r => /Grizzly .*FA не выпал — ниже героя больше чем на 5 ур\./.test(r)));
  lenv.rt.faDrop = fd;
  fd = lt.faNote(['Fast Aden ×1'], 'Buffalo', { champ: false, tier: '', lvl: 70 });
  assert.equal(fd.f.mob, 1);
  assert.equal(lt.faNote(['Fast Aden ×1'], 'Rahha', null), null, 'RB not counted');
  // 5. настройки и меню
  const content = read('content.js'), popup = read('popup.js'), html = read('popup.html'), base = JSON.parse(read('base-profile.json'));
  assert.match(content, /searchChamp: true, champFa: true/);   // 10.0.5: поиск чемпионов ВКЛ (игрок 13.10)
  assert.match(popup, /'searchChamp', 'champFa'/);
  assert.match(html, /id="champFa"/); assert.match(html, /id="faDropBox"/);
  assert.equal(JSON.stringify(base).includes('"champFa":true'), true);
  assert.match(read('modules/combat.js'), /env\.trackLoot\([^\n]+\{ champ: !!ctx\.champ, tier: ctx\.tier \|\| '', lvl: ctx\.lvl \|\| 0 \}/);
  console.log('PASS: 10.0.5 FA from champions — tier from server/spawnId/markup, FA window −5, red→orange first (after ★ quest), toggle, FA drop journal and stats');
})().catch(e => { console.error(e); process.exit(1); });
// 10.0.5 (игрок 13.10 00:32: «поставь фарм мобов −5 лвл максимум, иначе не падают ФА»): ниже героя −5 не бьём никогда, кроме явных задач
(() => {
  const recs2 = [];
  const env2 = { cfg: { priority: '[квест]\n[чемп]\n[все]', searchChamp: true, searchQuest: true, lvlBelow: 0, lvlAbove: 20, lvlMin: 1, lvlMax: 99 },
    rt: { spawns: { a: ['Sixty', 60], b: ['SixtyOne', 61], c: ['Champ', 60], q: ['Quest', 55] }, lvl: 66, lvlRelaxDown: { t: Date.now(), zone: null } }, PAGE_SIZE: 15,
    heroLvl: () => 66, isRaidId: () => false, isBoss: () => false, isQuestName: (n, q) => (q || []).includes(n),
    campActive: () => false, campChampOpen: () => false, campChampMin: () => 0, campMobOpen: () => [], farmRules: () => [], recipeRules: () => [],
    rec: (...a) => recs2.push(a.join(' | ')), setRt: async p => Object.assign(env2.rt, p) };
  const m2 = load('modules/mobfarm.js', env2);
  assert.equal(m2.lowCap(), 5, 'lvlBelow 0 (no limit) → 5');
  env2.cfg.lvlBelow = 9; assert.equal(m2.lowCap(), 5, 'lvlBelow 9 → 5');
  env2.cfg.lvlBelow = 3; assert.equal(m2.lowCap(), 3);
  const ids = Array.from(m2.candidates(m2.parseRules(), { ids: ['a', 'b', 'c', 'q'], quest: ['Quest'] }, { c: 'champion' }, 99), x => x.id);
  assert.ok(!ids.includes('a') && !ids.includes('c'), '60 at hero 66: neither mob nor champion, even with the soft window');
  assert.ok(ids.includes('b'), '61 = hero −5 allowed by the soft window');
  assert.ok(ids.includes('q'), '★ quest target is an explicit task — kept');
  assert.match(read('modules/mobfarm.js'), /все ниже героя больше чем на 5 ур\. — не бью \(FA с них не падает\)/);
  assert.match(read('modules/navigation.js'), /const lo = L - Math\.min\(\+env\.cfg\.lvlBelow > 0 \? \+env\.cfg\.lvlBelow : 5, 5\)/);
  console.log('PASS: 10.0.5 hero −5 floor — menu window capped at 5, champions −8 → −5, soft window only to −5, ★ quest kept, zone/catacomb windows capped');
})();
