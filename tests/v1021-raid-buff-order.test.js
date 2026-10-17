'use strict';
// Лог 15.10 14:20–14:23: ожидание баффера и полного баффа кота — не разрешение начать РБ.
const test = require('node:test'), assert = require('node:assert/strict');
const { mk, docOf } = require('./epic-harness.cjs');
const row = { name: 'Water Dragon Seer Sheshark', lvl: 72, page: 11, alive: true, price: 100000, unit: 'аден', t: Date.now() };
function fixture({ need = null, cat = true, state = 'active' } = {}) {
  let missing = need, buffCalls = 0, catCalls = 0, status = state;
  const m = mk({ hero: 77, cfg: { epicMode: false, rbHuntMode: true, rbMode: true, rbFaFull: true, petFullAuto: cat, shopAuto: false, rbRestHp: 95 },
    rt: { char: 'Warlock', classCur: { prof: 'human_arcana_lord', slot: 0 }, rbHunt: { step: 'pick' }, rbListT: Date.now(),
      rbList: { boss: row }, rbStats: { boss: { hp: 5500000, patk: 5000, matk: 2500, pdef: 9000, mdef: 10000, src: 'api' } },
      rbDb: {}, adenaSeen: { v: 20000000, t: Date.now() }, rbDpsSample: { id: 'old', powerKey: 'same', dps: 60000, target: { lvl: 72, pdef: 9000, mdef: 10000 }, t: Date.now() } },
    env: { tabOwner: true, warlock: { raidContext: () => ({ managed: true, key: 'same', powerKey: 'same', prepared: true }),
      step: async () => { catCalls++; return false; }, summary: () => ({ status, expiresAt: Date.now() + 3600000, reason: status }) },
      townBuffStart: async () => { buffCalls++; return false; }, townBuffNeed: () => missing,
      potModel: () => ({ pool: 600000, rate: 2000, n: 500, H: 1200, C: 1, items: [] }),
      faFullIds: () => [1323], hudBuffs: () => ({ 1323: Date.now() + 3600000 }),
      gameGet: async () => ({ ok: true, json: async () => ({ character: { name: 'Warlock', inBattle: false, adena: 20000000 } }) }),
      meHp: () => ({ cur: 14917, max: 14917, pct: 100 }), meMp: () => ({ cur: 5408, max: 5408 }),
      logLines: () => [], newLines: () => [], activeBuffs: () => [] } });
  return { ...m, setNeed: value => { missing = value; }, setCat: value => { status = value; }, buffCalls: () => buffCalls, catCalls: () => catCalls };
}
// 10.0.23: общий статус полного баффа теперь относится и к пантере.
test('отложенный FA-бафф удерживает тур до подтверждения, затем разрешает выбор РБ', async () => {
  const f = fixture({ need: { fa: [1323] }, cat: false });
  await f.R.rbHuntStep(); assert.equal(f.env.rt.rbHunt.phase, 'prepare'); assert.equal(f.env.rt.rbHunt.step, 'pick'); assert.equal(f.fires.length, 0);
  f.setNeed(null); await f.R.rbHuntStep(); assert.equal(f.env.rt.rbHunt.step, 'go'); assert.equal(f.buffCalls(), 2);
});
test('включённый полный бафф кота не допускает к РБ до подтверждённого срока', async () => {
  const f = fixture({ state: 'budget' });
  await f.R.rbHuntStep(); assert.equal(f.env.rt.rbHunt.step, 'pick'); assert.match(f.env.rt.rbHunt.next, /полный бафф суммона/); assert.equal(f.catCalls(), 1);
  f.setCat('active'); await f.R.rbHuntStep(); assert.equal(f.env.rt.rbHunt.step, 'go');
});
test('если бафф снят после выбора, платный перелёт отменяется до клика', async () => {
  const f = fixture({ need: { fa: [1323] }, cat: false });
  f.env.rt.rbHunt = { step: 'go', id: 'boss', name: row.name, ...row, t: Date.now() };
  await f.R.rbHuntStep(); assert.equal(f.fires.length, 0); assert.equal(f.env.rt.rbHunt.step, 'pick');
});
test('на карте с РБ ожидание баффера не начинает бой', async () => {
  const f = fixture({ need: { fa: [1323] }, cat: false });
  f.env.rt.rbHunt = { step: 'arrive', id: 'boss', name: row.name, at: Date.now(), t: Date.now() };
  f.setDoc(docOf('<button class="l2-map-mob-pin l2-map-mob-pin--raid" data-spawn-id="boss" title="Water Dragon Seer Sheshark · ур. 72 · рейд-босс"></button>'));
  let attacks = 0; f.env.rbEngage = async () => { attacks++; return true; };
  await f.R.rbHuntStep(); assert.equal(attacks, 0); assert.equal(f.env.rt.rbHunt.step, 'arrive');
});
test('нулевой баланс FA с отсутствующим баффом не обходится пустым townBuffNeed', async () => {
  const f = fixture({ cat: false }); let pauses = 0;
  f.env.rt.faBal = { v: 0, t: Date.now() }; f.env.hudBuffs = () => ({});
  f.env.pauseBot = async () => { pauses++; };
  // 20.13 (ревизия 17.10, шаг 5, RB-3): тур не летит, но бота целиком не останавливает — простой тура с повтором
  await f.R.rbHuntStep(); assert.equal(pauses, 0); assert.ok(f.env.rt.rbHuntIdle > Date.now()); assert.equal(f.env.rt.rbHunt.step, 'pick'); assert.equal(f.fires.length, 0);
});
test('без читаемой шапки баффов рейд не принимает отсутствие доказательств за готовность', async () => {
  const f = fixture({ cat: false }); f.env.hudBuffs = () => null;
  await f.R.rbHuntStep(); assert.equal(f.env.rt.rbHunt.step, 'pick'); assert.equal(f.fires.length, 0);
});
