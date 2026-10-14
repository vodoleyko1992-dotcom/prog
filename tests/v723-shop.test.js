'use strict';
// 7.2.3 (лог 10.10 23:19–23:30): B-зарядов 310 → 139 при минимуме 500, а закупки не было; игрок: «минимум сосок 1000,
// докупать до 5000», «не срываться посреди РБ — покупать после убийства РБ или купить всё и бить дальше того же РБ»,
// «окно постоянно скачет, то больше, то меньше»
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const load = (f, extra = {}) => { const sb = { console, Date, Math, JSON, document: { querySelectorAll: () => [], querySelector: () => null }, location: { pathname: '/map.html', href: '' }, ...extra }; sb.globalThis = sb; vm.runInNewContext(read(f), sb); return sb; };

// 1. hook.js отдаёт сумку целиком (redact режет массивы до 8 элементов)
const hook = read('hook.js');
const invSrc = hook.match(/const invOf = (o => \{.*\});/)[1];
const invOf = vm.runInNewContext(`(${invSrc})`);
const stacks = Array.from({ length: 30 }, (_, i) => ({ itemId: 1000 + i, qty: i })).concat([{ itemId: 3950, qty: 139 }, { itemId: 1061, qty: 921 }]);
const inv = invOf({ character: { inventory: { v: 1, stacks } } });
assert.equal(inv.length, 32, 'all stacks, not the first 8');
assert.equal(JSON.stringify(inv.at(-2)), "[3950,139]");
assert.equal(invOf({ ok: true }), undefined);
assert.match(hook, /sp: spawns\(o\), inv: invOf\(o\), len: t\.length/);
assert.match(hook, /req, res, sp: spawns\(o\), inv: invOf\(o\), len,/);
const content = read('content.js');
assert.match(content, /const m = invNote\(d\.inv\); if \(m\) \{ INV_NET = \{ m, t: Date\.now\(\) \}; try \{ sessionStorage\.setItem\('l2bot-inv'/);
const invNote = vm.runInNewContext(`(${content.match(/const invNote = (inv => \{.*?return m; \});/)[1]})`);
assert.deepEqual(invNote(inv)[3950], 139); assert.equal(invNote([]), null);

// 2. проверка запасов — по сумке из сети, даже когда панели боя на экране нет; заряды — грейд надетого оружия (B → 3950)
const net = { 3950: 139, 1061: 921, 728: 900 };
const env = { cfg: { shopAuto: true, shopShots: '1000/5000', shopHp: '300/1000', shopMp: '200/1000', nShots: 'Благословенний заряд духу' },
  rt: { weaponsT: Date.now(), weapons: [{ name: "Sprite's Staff", g: 'B', wt: 'двуруч. дубина', pa: 189, ma: 132, where: 'надето' }] },
  MAGE: '#mage', classWeaponTypes: () => ({ types: ['#mage'] }), combatProfileKind: () => 'mage_summoner', heroLevel: () => 54,
  GRADE_LV: { NG: 0, D: 20, C: 40, B: 52, A: 61, S: 76 }, BSPS_IDS: { NG: 3947, D: 3948, C: 3949, B: 3950, A: 3951, S: 3952 }, SHOT_IDS: { NG: 1835, D: 1463, C: 1464, B: 1465, A: 1466, S: 1467 },
  pair: (v, d) => { const m = String(v ?? d).match(/(\d+)\s*\/\s*(\d+)/); return m ? [+m[1], +m[2]] : [0, 0]; },
  qty: () => null, slotsBy: () => [], shotSlot: () => null, invQty: id => net[id] ?? 0, setRt: async () => {}, rec: () => {} };
const E = load('modules/economy.js').L2V7Factories.economy(env);
assert.equal(E.shopNeedByPanel(), 'заряды B 139 < 1000', 'no hotbar on screen — the bag from the server still triggers the shop');
net[3950] = 4200; assert.equal(E.shopNeedByPanel(), '');
env.invQty = () => null; env.shotSlot = () => ({title:'#3950 — Благословенний заряд духу ×600'}); env.qty = () => 600;          // сети нет — счётчик кнопки, как раньше
assert.equal(E.shopNeedByPanel(), 'заряды B 600 < 1000');
assert.deepEqual(E.shopPlan().find(x => x.key === 'shots').mm, [1000, 5000]);

// 3. закупка в туре РБ — только между боями: перед РБ и при отходе (потом обратно к нему же), всё до максимума
const shops = [];
const renv = { cfg: { shopAuto: true, shopHp: '300/1000' }, rt: { shopT: 0 }, pair: env.pair, hpPotStock: () => 921,
  shopNeedByPanel: () => 'заряды B 139 < 1000', shopStart: async (why, force) => shops.push([why, force]), sleep: async () => {}, rec: () => {} };
const R = load('modules/raid.js').L2V7Factories.raid(renv);
(async () => {
  assert.equal(await R.rbShopFirst('Верфа', true), true);
  assert.deepEqual(shops[0], ['отход от РБ Верфа: заряды B 139 < 1000 — докупаю всё, потом обратно к нему', true]);
  renv.rt.shopT = Date.now();                                                        // только что из магазина — не гоняем по кругу
  assert.equal(await R.rbShopFirst('Верфа'), false);
  renv.rt.shopT = 0; renv.shopNeedByPanel = () => ''; renv.hpPotStock = () => 120;
  assert.equal(await R.rbShopFirst('Тіліон'), true);
  assert.match(shops[1][0], /^перед РБ Тіліон: банки HP 120 < 300 — докупаю всё$/);
  renv.hpPotStock = () => 921;
  assert.equal(await R.rbShopFirst('Тіліон'), false, 'everything in stock — straight to the RB');
  const raid = read('modules/raid.js'), mob = read('modules/mobfarm.js'), combat = read('modules/combat.js');
  assert.match(raid, /if \(await rbShopFirst\(ctx\.name, true\)\) return;\s+\/\/ 7\.2\.3[^\n]*\n\s+await env\.toOutskirts\(\);/);
  assert.match(raid, /бой прерван, у него \$\{pct\}% — возвращаюсь добить/);
  assert.match(mob, /докупаю всё, пока не в бою`, true\)/);
  assert.doesNotMatch(combat, /shopStart|shopNeedByPanel/, 'combat never starts shopping mid-fight');
  // недобитый РБ после отхода: «вернусь добить», а не «следующий»
  assert.match(raid, /w \? `отошёл, у него \$\{w\.hpAfter\}\/\$\{w\.max\}\$\{wd \? ' — вернусь добить' : ' → следующий'\}`/);

  // 4. лимит 1000/5000 везде: меню, ядро, базовый профиль, миграция у старых установок
  assert.match(content, /shopShots: '1000\/5000'/);
  assert.match(content, /once\('shots723', \(\) => \{ cf\.shopShots = '1000\/5000'; \}\);/);
  assert.match(read('popup.js'), /shopShots: '1000\/5000'/);
  assert.match(read('popup.html'), /id="shopShots" class="sm" placeholder="1000\/5000"/);
  assert.equal(JSON.parse(read('base-profile.json')).cfg.shopShots, '1000/5000');
  assert.doesNotMatch(read('modules/economy.js'), /500\/3000/);

  // 5. информационное окно не прыгает: ширина поля запоминается для этой ширины браузера
  const { stickyFree } = require('../engine-core.js');
  let s = stickyFree(null, 520, 1920);
  assert.deepEqual(s, { vw: 1920, free: 520, m: 1 });
  assert.equal(stickyFree(s, 700, 1920), s, 'another screen measured a wider margin — keep the window, no jumping');
  assert.equal(stickyFree(s, -16, 1920, false), s, 'game not loaded yet — keep the window');
  assert.deepEqual(stickyFree(s, 300, 1280), { vw: 1280, free: 300, m: 1 }, 'browser resized — measure again');
  // 10.0.5 (спойлер 13.10: «левая панель вышла за край»): экран с более широкой рамкой игры — окно сужается и не лезет на игру
  assert.deepEqual(stickyFree(s, 360, 1920), { vw: 1920, free: 360, m: 1 }, 'narrower margin measured — shrink, never cover the game');
  assert.deepEqual(stickyFree({ vw: 1920, free: 700 }, 400, 1920), { vw: 1920, free: 400, m: 1 }, 'old «widest» record is replaced by a real measure');
  assert.deepEqual(stickyFree({ vw: 1920, free: 700 }, -16, 1920, false), { vw: 1920, free: 700 }, 'no measure — keep what we had');
  assert.equal(stickyFree(null, 1500, 1920).free, 944, 'never wider than half of the screen');
  assert.match(content, /const s = L2EngineCore\.stickyFree\(indStick, \(bounds\?\.left \|\| 0\) - 16, vw, !!bounds\?\.observed\?\.length\);/);
  console.log('PASS: bag counts from the server (full list), shots 1000/5000, shopping only between RB fights (back to the same RB), info window keeps its size');
})().catch(e => { console.error(e); process.exit(1); });
