'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
function fixture(net = null) {
  let links = [];
  const box = { console, Date, document: { querySelectorAll: () => links } };
  for (const n of ['champs', 'mobfarm']) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../modules/', n + '.js'), 'utf8'), box);
  const env = { cfg: { priority: '[чемп]\n[все]', champBlue: true, champOrange: true, champRed: false, champMinLvl: 20, lvlBelow: 5, lvlAbove: 5, searchChamp: true },
    rt: { lvl: 78, spawns: { dense_test: ['Leto Lizardman Soldier', 37] } }, NET_SPAWNS: net, PAGE_SIZE: 15,
    heroLvl: () => 78, campActive: () => true, campChampOpen: () => true, campChampMin: () => 0, campMobOpen: () => [],
    isRaidId: () => false, isBoss: () => false, isQuestName: () => false, isChamp: s => /чемпион/.test(s),
    farmRules: () => [], recipeRules: () => [], rec() {}, $q: () => null,
    LV_RE: /^(★\s*)?(.+?)\s*·\s*ур\.?\s*(\d+)/i, QUEST: /★/ };
  env.champs = box.L2V7Factories.champs(env);
  const m = box.L2V7Factories.mobfarm(env);
  return { env, m, show(tier = 'blue') { const li = { className: tier ? 'l2-map-mob-item--champion-' + tier : '', textContent: 'Leto Lizardman Soldier · ур. 37 · чемпион HP 27\u00a0384 · EXP 30\u202f450' };
    links = [{ textContent: 'Leto Lizardman Soldier · ур. 37 · чемпион', className: '', classList: { contains: () => false }, getAttribute: () => '/battle.html?spawnId=dense_test', closest: () => li }]; },
    picks(types) { return m.candidates(m.parseRules(), { ids: ['dense_test'], quest: [] }, types || m.markerTypes(), 99); } };
}
const stale = () => ({ t: Date.now() - 600001, kind: { dense_test: 'champion' }, tier: { dense_test: 'red' }, hp: { dense_test: 999999 }, exp: { dense_test: 999999 } });
for (const [label, net] of [['null', null], ['expired', stale()]]) test(label + ' NET: visible blue chapter champion 37 remains eligible for hero78', () => {
  const f = fixture(net); f.show(); const c = f.picks()[0];
  assert.ok(c); assert.equal(c.champ, true); assert.equal(c.ql, true); assert.equal(c.tier, 'blue'); assert.equal(c.rank, 0);
  assert.equal(c.hp, 27384); assert.equal(c.exp, 30450);
});
test('same low-level champion without chapter stays outside farming window', () => {
  const f = fixture(); f.show(); f.env.campActive = () => false; f.env.campChampOpen = () => false;
  assert.equal(f.picks().length, 0);
});
test('unknown visible color does not become allowed blue', () => {
  const f = fixture(stale()); f.show(''); assert.equal(f.picks().length, 0);
});
test('offpage stale HP and EXP never enter candidate', () => {
  const f = fixture(stale());
  // Изолируем сбор данных от запрета неизвестного цвета; он отдельно проверен выше.
  f.env.champs = { tierOff: () => null, valueMode: () => false, judge: () => ({ok:true}) };
  const c = f.picks({ dense_test: 'champion' })[0];
  assert.ok(c); assert.equal(c.hp, 0); assert.equal(c.exp, 0); assert.equal(c.tier, '');
});

// Реальный gate между асинхронным выбором цели и native fire.
const mobSource = fs.readFileSync(path.join(__dirname, '../modules/mobfarm.js'), 'utf8');
const gateSource = mobSource.slice(mobSource.indexOf('function champEntryOff(c)'), mobSource.indexOf('\nasync function attackSpawn'));
for (const scenario of ['never', 'leaveOff', 'chapterDone', 'namedQuestDone', 'held']) test('quick entry отменяется после await: ' + scenario, async () => {
  const f = fixture(); f.show('orange'); f.env.cfg.champCancel = 'paid';
  if (scenario === 'namedQuestDone') {
    f.env.campActive = () => false; f.env.campChampOpen = () => false; f.env.isQuestName = () => true;
  }
  const c = f.picks()[0]; assert.ok(c?.chQuestQuick, 'actual judge разрешает короткую пробу до await');
  const gate = vm.runInNewContext(gateSource + '\nchampEntryOff;', { env: f.env });
  assert.equal(gate(c), null);
  await Promise.resolve();
  if (scenario === 'never') f.env.cfg.champCancel = 'never';
  if (scenario === 'leaveOff') f.env.cfg.champLeave = false;
  if (scenario === 'chapterDone') f.env.campChampOpen = () => false;
  if (scenario === 'namedQuestDone') f.env.isQuestName = () => false;
  if (scenario === 'held') f.env.rt.champLearn = { holds: { [JSON.stringify(['', null, null])]: { orange: { t: Date.now(), gap: -41, pow: { lvl: 78 }, why: 'опасный бой' } } } };
  assert.ok(gate(c), 'native fire должен быть отменён при новом состоянии');
});
