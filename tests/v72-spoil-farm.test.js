'use strict';
// 7.2: спойлер на крафт — спойл-добыча считается в фарм ресурса, свип не жмётся (игра собирает сама), моб-источник ресурса
// не отсекается окном уровней, подбор зоны по дропу + спойлу
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const load = (file, extra = {}) => { const sb = { console, Date, Math, document: { querySelectorAll: () => [], querySelector: () => null }, ...extra }; sb.globalThis = sb; vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), sb); return sb; };

(async () => {
  // 1. «Спойл: Coal ×5» — это Coal: идёт в счётчик «Фарм ресурса»
  const L = load('modules/loot.js');
  const recs = [];
  const env = { cfg: { farmRes: 'Coal', farmNeed: 0, resQuests: '' }, rt: {}, itemsDb: async () => {}, itemOf: () => null, LOOT_RE: /^(.+?)\s*×\s*(\d+)$/, SPECIAL_RE: /^Випа\S*\s+(.+?)\s*\+\s*(\d+)$/i,
    SPOIL_LOOT: /^(?:Спойл|Spoil)\s*:?\s*(.+?)\s*×\s*(\d+)/i, setRt: async p => { Object.assign(env.rt, p); return { ok: true }; }, rec: (...a) => recs.push(a), recipeKey: s => s,
    newLines: (a, b) => b.slice(a.length), logLines: () => [], $q: () => null, slotsBy: () => [], fire: () => { fired++; }, shown: () => true, noticeText: () => '' };
  let fired = 0;
  const M = L.L2V7Factories.loot(env);
  await M.trackLoot(['Спойл: Coal ×5', 'Coal ×3', 'Iron Ore ×2'], 'Unicorn');
  assert.equal(env.rt.farmGot.coal, 8, 'спойл + дроп Coal = 8');
  assert.equal(env.rt.loot.Coal, 8); assert.equal(env.rt.loot['Спойл: Coal'], undefined, 'не отдельный предмет «Спойл: Coal»');

  // 2. свип не жмётся никогда (даже если роль «Сбор спойла» осталась от старой версии)
  env.cfg.nSweep = 'Sweeper'; env.logLines = () => ['Победа!'];
  await M.sweepStep({ spoiled: true, logStart: [], name: 'Unicorn' });
  assert.equal(fired, 0, 'Sweeper не нажат');

  // 3. моб-источник ресурса на 8 ур. ниже героя — цель; обычный моб на 8 ниже — нет (окно lvlBelow 3)
  const F = load('modules/mobfarm.js');
  const fenv = { cfg: { lvlBelow: 3, lvlAbove: 15 }, rt: { spawns: { a: ['Grave Robber', 42], b: ['Goblin', 42] } }, isRaidId: () => false, campChampMin: () => 0,
    isBoss: () => false, isQuestName: () => false, heroLvl: () => 50, campActive: () => false, campChampOpen: () => false };
  const FM = F.L2V7Factories.mobfarm(fenv);
  const rules = [{ neg: false, line: 'Grave Robber (фарм Coal)', quest: false, champ: false, all: false, name: 'grave robber', farm: true }, { neg: false, line: '[все]', all: true, name: '' }];
  const c = [...FM.candidates(rules, { ids: ['a', 'b'] }, {}, 99)].map(x => x.name);
  assert.deepEqual(c, ['Grave Robber'], 'источник ресурса не отсекается окном уровней');

  // 4. content.js: разбор строки ресурса со спойлом, подбор зоны дроп + спойл, «умеет спойлить»
  const mf = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const ctx = vm.createContext({ addEventListener() {}, removeEventListener() {}, console, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, URL, URLSearchParams, Date, Math,
    crypto: { randomUUID: () => 'x' }, sessionStorage: { getItem: () => null, setItem() {} }, navigator: { userAgent: 'Chrome' },
    location: { pathname: '/map.html', search: '', href: 'https://l2wap.com/map.html', origin: 'https://l2wap.com' }, window: { addEventListener() {}, innerWidth: 1080 },
    document: { visibilityState: 'visible', prerendering: false, createElement() { return { style: {}, append() {}, querySelector() { return null; }, querySelectorAll() { return []; } }; },
      addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, getElementsByTagName() { return []; }, hasFocus() { return true; },
      documentElement: { className: '', clientWidth: 1024, append() {} }, body: { className: '', querySelector() { return null; } } },
    chrome: { runtime: { sendMessage: async () => null, onMessage: { addListener() {} }, getManifest: () => mf, getURL: s => s }, storage: { onChanged: { addListener() {} }, local: { get: () => new Promise(() => {}), set: async () => {} } } } });
  ctx.window.window = ctx.window;
  for (const s of mf.content_scripts.find(x => x.js.includes('content.js')).js) vm.runInContext(fs.readFileSync(path.join(root, s), 'utf8'), ctx);
  const el = (cls, text, extra = {}) => ({ className: cls, textContent: text, ...extra });
  const source = (kindCls, kindText, line, tp, loc) => {
    const kind = el('l2-farm-source__kind ' + kindCls, kindText, { nextElementSibling: el('', line) });
    return { querySelector: s => s === '.l2-farm-source__kind' ? kind : s === '[data-teleport-id]' ? { dataset: { teleportId: tp } } : s === '.l2-farm-source__location' ? el('', loc) : null };
  };
  const row = { querySelector: s => s === '.l2-farm-row__name' ? el('', 'Coal') : s === '.l2-farm-row__hint' ? el('', '3 источника') : null,
    querySelectorAll: s => s === '.l2-farm-source' ? [source('l2-farm-source__kind--drop', 'ДРОП', '• Goblin · ур. 50 · 20% · ×1–3', 'z1', 'Zone 1'),
      source('l2-farm-source__kind--spoil', 'СПОЙЛ', '• Goblin · ур. 50 · 60% · ×2–4', 'z1', 'Zone 1'), source('l2-farm-source__kind--spoil', 'СПОЙЛ', '• Orc · ур. 51 · 40% · ×1–1', 'z2', 'Zone 2')] : [] };
  ctx.__row = row;
  const r = vm.runInContext('farmRowParse(__row)', ctx);
  assert.equal(r.drop.length, 1); assert.equal(r.sp.length, 2); assert.equal(r.spoil, 2, 'спойл-источники разобраны (раньше — только счётчик)');
  ctx.__r = r;
  const dropOnly = vm.runInContext('farmZones(__r.drop, 50, 6)', ctx), both = vm.runInContext('farmZones(__r.drop, 50, 6, __r.sp, 0.8)', ctx);
  assert.equal(dropOnly.length, 1);
  const z1 = both.find(z => z.tp === 'z1');
  assert.ok(Math.abs(z1.mobs.Goblin.e - (0.2 * 2 + 0.6 * 3 * 0.8)) < 1e-9, 'с одного моба дроп и спойл складываются');
  assert.equal(both[0].tp, 'z1', 'лучшая зона по дропу + спойлу');
  assert.equal(vm.runInContext(`rt = { ...DEF_RT, prof: 'Bounty Hunter' }; cfg = mergeCfg({}); canSpoil()`, ctx), true);
  assert.equal(vm.runInContext(`rt = { ...DEF_RT, prof: 'Warlock' }; cfg = mergeCfg({}); canSpoil()`, ctx), false);
  assert.equal(vm.runInContext(`rt = { ...DEF_RT, prof: 'Warlock' }; cfg = mergeCfg({ nSpoil: 'Spoil' }); canSpoil()`, ctx), true);
  console.log('PASS: spoiler — spoil loot counted as the resource, no Sweeper, source mobs ignore the level window, zone by drop + spoil');
})().catch(e => { console.error(e); process.exit(1); });
