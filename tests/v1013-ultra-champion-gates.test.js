'use strict';
// 14.10: независимый аудит — тип чемпиона, Cancel и повторная проверка перед кликом.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
function fixture() {
  let links = [], clicks = 0;
  const box = { console: { log() {} }, Date, Math, CSS: { escape: x => x },
    document: { querySelectorAll: selector => selector === '#dungeon-mob-list li' ? [] : links } };
  vm.createContext(box);
  for (const name of ['champs', 'buffs', 'quests', 'dungeons', 'mobfarm']) vm.runInContext(read('modules/' + name + '.js'), box);
  const env = {
    cfg: { catDungeon: 'auto', lvlBelow: 5, lvlAbove: 5, lvlMin: 1, lvlMax: 99,
      champBlue: true, champOrange: false, champRed: false, champMinLvl: 20,
      champCancel: 'paid', noCancelMobs: true, priority: '[все]', searchChamp: false, champFa: true },
    rt: { lvl: 74, rbDps: 1000, spawns: { champ_o_test: ['Buffalo Slave', 72], ordinary: ['Safe', 74] } },
    NET_SPAWNS: { t: Date.now(), tier: { champ_o_test: 'orange' } }, PAGE_SIZE: 15, on: true,
    heroLvl: () => env.rt.lvl, setRt: async patch => Object.assign(env.rt, patch), rec() {}, setStatus() {},
    campActive: () => false, campChampOpen: () => false, campChampMin: () => 0, campMobOpen: () => [], campOpen: () => [],
    isRaidId: () => false, isBoss: () => false, isQuestName: () => false, isChamp: () => false,
    farmRules: () => [], recipeRules: () => [], faPaidLeft: () => 0,
    $q: () => links[0] || null, pause: async () => {}, gotoPage: async () => true,
    fire: () => { clicks++; return true; }, waitFor: async () => true, isBattle: () => true,
    LV_RE: /^(★\s*)?(.+?)\s*·\s*ур\.?\s*(\d+)/i, QUEST: /★/,
  };
  env.champs = box.L2V7Factories.champs(env);
  const buffs = box.L2V7Factories.buffs(env); env.cancelRisk = (...args) => buffs.cancelRisk(...args);
  const f = { env, box, d: box.L2V7Factories.dungeons(env), m: box.L2V7Factories.mobfarm(env),
    quests: box.L2V7Factories.quests(env), clicks: () => clicks,
    ordinary: { id: 'ordinary', name: 'Safe', lvl: 74, champ: false },
    champion: { id: 'champ_o_test', name: 'Buffalo Slave', lvl: 72, champ: true, tier: 'orange' } };
  f.show = (c, cls = '') => { links = [{ textContent: `${c.name} · ур. ${c.lvl}`, className: 'l2-map-mob-link',
    classList: { contains: () => false }, getAttribute: () => '/battle.html?spawnId=' + c.id,
    closest: () => ({ className: cls }) }]; };
  return f;
}
test('порог чемпионов главы не превращает запрещённого оранжевого в обычного моба', () => {
  const f = fixture(); f.env.cfg.campaign = true;
  f.env.rt.campaign = { targets: [{ name: 'Чемпионы', champ: true, objective: true, minLvl: 73, ok: false }] };
  for (const key of ['campActive', 'campChampOpen', 'campChampMin', 'campMobOpen', 'campOpen']) f.env[key] = f.quests[key];
  assert.equal(f.env.campChampMin(), 73, 'используем настоящие условия главы');
  const picks = f.m.candidates(f.m.parseRules(), { ids: ['champ_o_test', 'ordinary'], quest: [] },
    { champ_o_test: 'champion', ordinary: 'passive' }, 99);
  assert.ok(!picks.some(x => x.id === 'champ_o_test'), 'оранжевый ниже минимального уровня главы всё равно запрещён');
  assert.ok(picks.some(x => x.id === 'ordinary'));
});
test('разрешённый синий ниже порога главы остаётся чемпионом без приоритета главы', () => {
  const f = fixture(); f.env.cfg.campaign = true;
  f.env.rt.campaign = { targets: [{ name: 'Чемпионы', champ: true, objective: true, minLvl: 73, ok: false }] };
  for (const key of ['campActive', 'campChampOpen', 'campChampMin', 'campMobOpen', 'campOpen']) f.env[key] = f.quests[key];
  f.env.rt.spawns.dense_blue = ['Buffalo Slave', 72]; f.env.NET_SPAWNS.tier.dense_blue = 'blue';
  const picks = f.m.candidates(f.m.parseRules(), { ids: ['dense_blue', 'ordinary'], quest: [] },
    { dense_blue: 'champion', ordinary: 'passive' }, 99);
  const blue = picks.find(x => x.id === 'dense_blue');
  assert.ok(blue, 'обычная безопасная охота на синего разрешена');
  assert.equal(blue.champ, true, 'сведения о физическом типе нельзя терять из-за требований главы');
  assert.equal(blue.ql, false, 'синий 72 не выполняет задание на чемпионов 73+');
  assert.equal(blue.rank, picks.find(x => x.id === 'ordinary').rank, 'ниже порога главы — обычный приоритет');
});
test('катакомбы соблюдают жёсткий обход Cancel при разрешённом цвете', () => {
  const f = fixture(); f.env.cfg.champOrange = true; f.env.cfg.champCancel = 'never';
  assert.equal(f.env.champs.tierOff(f.champion), null);
  assert.equal(f.env.cancelRisk(f.champion.name, true, 'orange'), null, 'обычная память Cancel не проверяет чемпионов');
  assert.equal(f.env.champs.judge(f.champion).cancel, true, 'карта запрещает по отдельной настройке Cancel');
  assert.equal(f.d.catPick([f.champion, f.ordinary], 74)?.id, 'ordinary');
});
test('катакомбы учитывают цену потери платных баффов у синего чемпиона', () => {
  const f = fixture(); const blue = { ...f.champion, id: 'dense_blue', tier: 'blue' };
  f.env.faPaidLeft = () => 20;
  assert.equal(f.env.champs.judge(blue).cancel, true, 'настоящая модель Cancel отклоняет бой с 20 платными баффами');
  assert.equal(f.d.catPick([blue, f.ordinary], 74)?.id, 'ordinary');
});
test('карта перепроверяет запрет цвета после асинхронной паузы перед кликом', async () => {
  const f = fixture(); f.env.cfg.champOrange = true; f.show(f.champion, 'l2-map-mob-item--champion-orange');
  f.env.pause = async () => { f.env.cfg.champOrange = false; };
  await f.m.attackSpawn({ ...f.champion, idx: 0 }, () => 'цель');
  assert.equal(f.clicks(), 0, 'галка уже выключена, но старый кандидат не должен открыть бой');
});
test('катакомбы перепроверяют запрет цвета после асинхронной паузы перед кликом', async () => {
  const f = fixture(); f.env.cfg.champOrange = true; f.env.cfg.champCancel = 'always'; f.show(f.champion);
  f.env.CAT_LIST = { witch: ['Witch'] }; f.env.$q = () => null; f.env.shown = () => false;
  f.env.dungNet = () => ({ id: 'witch', t: Date.now(), mobs: [[f.champion.id, 'champion', f.champion.name, f.champion.lvl, 0, 'orange']] });
  f.env.waitX = async fn => fn(); f.env.pause = async () => { f.env.cfg.champOrange = false; };
  await f.d.catHunt('witch');
  assert.equal(f.clicks(), 0, 'после выключения цвета катакомбы не должны открывать выбранного чемпиона');
});
test('карта перепроверяет запрет цвета после ожидания записи цели', async () => {
  const f = fixture(); f.env.cfg.champOrange = true; f.show(f.champion);
  f.env.setRt = async patch => { Object.assign(f.env.rt, patch); if (patch.target) f.env.cfg.champOrange = false; };
  await f.m.attackSpawn({ ...f.champion, idx: 0 }, () => 'цель');
  assert.equal(f.clicks(), 0);
  assert.equal(f.env.rt.target, null, 'запрещённая подготовленная цель очищена');
});
test('катакомбы перепроверяют запрет после листания к свежей ссылке', async () => {
  const f = fixture(); f.env.cfg.champOrange = true; f.env.cfg.champCancel = 'always';
  f.env.CAT_LIST = { witch: ['Witch'] }; f.env.shown = x => !!x;
  f.env.dungNet = () => ({ id: 'witch', t: Date.now(), mobs: [
    ...Array.from({ length: 15 }, (_, i) => ['away' + i, 'passive', 'Away', 1, 0]),
    [f.champion.id, 'champion', f.champion.name, f.champion.lvl, 0, 'orange']] });
  f.env.waitX = async fn => fn();
  const next = { disabled: false }; f.env.$q = selector => selector === '#dungeon-mob-page-ind' ? { textContent: '1 / 2' } : selector === '#dungeon-mob-page-next' ? next : null;
  f.env.sleep = async () => { f.env.cfg.champOrange = false; f.show(f.champion); };
  await f.d.catHunt('witch');
  assert.equal(f.clicks(), 1, 'разрешено только перелистывание, не клик по чемпиону');
  assert.equal(f.env.rt.target, null);
});
test('катакомбы перепроверяют запрет перед резервной кнопкой «В бой»', async () => {
  const f = fixture(); f.env.cfg.champOrange = true; f.env.cfg.champCancel = 'always';
  f.env.CAT_LIST = { witch: ['Witch'] }; f.env.shown = x => !!x;
  f.env.dungNet = () => ({ id: 'witch', t: Date.now(), mobs: [[f.champion.id, 'champion', f.champion.name, f.champion.lvl, 0, 'orange']] });
  const info = {}, go = {}, link = { getAttribute: () => '/battle.html?spawnId=' + f.champion.id, closest: () => ({ querySelector: () => info }) };
  f.box.document.querySelectorAll = selector => selector === '#dungeon-mob-list li' ? [] : [link];
  f.env.$q = selector => selector === '#dungeon-mob-modal-battle' ? go : null;
  const clicked = []; f.env.fire = button => { clicked.push(button); return true; };
  f.env.waitX = async fn => fn();
  let waits = 0; f.env.waitFor = async fn => { waits++; if (waits === 1) return false; if (waits === 2) { f.env.cfg.champOrange = false; return fn(); } return true; };
  f.env.sleep = async () => {}; f.env.noticeText = () => ''; f.env.NET_ERR = {};
  f.box.location = {};
  await f.d.catHunt('witch');
  assert.ok(!clicked.includes(go), 'запрет изменён во время открытия окна: резервный вход тоже запрещён');
});
test('разрешённый цвет без Cancel сохраняет безопасный выбор катакомб', () => {
  const f = fixture(); f.env.cfg.champOrange = true; f.env.cfg.champCancel = 'always';
  assert.equal(f.d.catPick([f.champion, f.ordinary], 74)?.id, 'champ_o_test');
});
test('отсутствующий championTier не перекрашивает серверные champ_o_/champ_r_ в разрешённый синий', async () => {
  const f = fixture(), hook = read('hook.js');
  const start = hook.indexOf('const spawns ='), end = hook.indexOf('// 9.0 (катакомбы', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(hook.slice(start, end) + '\nthis.readSpawns = spawns;', f.box);
  const data = f.box.readSpawns({ nearbySpawns: [
    { id: 'champ_o_test', kind: 'champion', name: 'Buffalo Slave', level: 72 },
    { id: 'champ_r_test', kind: 'champion', name: 'Buffalo Slave', level: 72 },
    { id: 'dense_blue', kind: 'champion', championTier: 'blue', name: 'Buffalo Slave', level: 72 }] });
  f.env.NET_SPAWNS.tier = { champ_o_test: 'blue', champ_r_test: 'blue' }; // старый hook успел записать синтетический цвет
  await f.m.netSpawns(data);
  assert.equal(f.m.champTier('champ_o_test'), 'orange', 'hook не должен подменять неизвестный цвет и терять достоверный префикс');
  assert.equal(f.m.champTier('champ_r_test'), 'red');
  assert.equal(f.m.champTier('dense_blue'), 'blue', 'явный синий остаётся разрешённым');
  const picks = f.m.candidates(f.m.parseRules(), { ids: data.map(x => x[0]), quest: [] }, f.env.NET_SPAWNS.kind, 99);
  assert.equal(JSON.stringify(picks.map(x => x.id)), JSON.stringify(['dense_blue']));
  const explicit = f.box.readSpawns({ nearbySpawns: [{ id: 'champ_o_test', kind: 'champion', name: 'Buffalo Slave', level: 72, championTier: 'blue' }] });
  await f.m.netSpawns(explicit);
  assert.equal(f.m.champTier('champ_o_test'), 'blue', 'явный ответ сервера сохраняет приоритет перед префиксом');
});
