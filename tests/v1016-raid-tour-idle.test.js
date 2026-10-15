'use strict';
// 14.10: простой тура заканчивается по доступности, но защитная пауза после отказов не теряется.
const test = require('node:test'), assert = require('node:assert/strict');
const { mk,docOf } = require('./epic-harness.cjs');
const MIN = 60000;
function fixture(o = {}) {
 const now = Date.now(), m = mk({ hero: 55, cfg: { epicMode: false, rbHuntMode: true, rbMode: true, shopAuto: false, rbMaxBelow: 15, rbMaxAbove: 15, ...o.cfg },
  rt: { rbHunt: { step: 'pick' }, rbListT: now, rbHuntIdle: now + 10 * MIN, rbIdleMark: { lvl: 55, pots: 960, t: now - MIN },
   rbList: { low: { name: 'Младший', lvl: 50, alive: true, price: 100000, unit: 'аден', page: 1, t: now } }, rbStats: { low: { hp: 10000, patk: 10, matk: 10, src: 'api' } }, rbDb: {}, ...o.rt },
  env: { RB_WIN: 15, RB_TRY_MS: 10 * MIN, RB_RETRY_MS: 2 * MIN, tabOwner: true, ...o.env } });
 // 15.10: прежние сценарии простоя явно имеют обычного моба; пустая точка проверяется отдельно.
 m.setDoc(docOf('<div id="map-mob-list"><a class="l2-map-mob-link">Моб</a></div>'));
 m.maps = 0; m.env.map = async () => { m.maps++; return 'map'; }; return m;
}
for (const kind of ['уровень', 'банки', 'магазин']) test(`ожидание заканчивается сразу после улучшения: ${kind}`, async () => {
 const m = fixture({ rt: { rbList: {} } });
 if (kind === 'уровень') m.env.rt.rbIdleMark.lvl = 54;
 if (kind === 'банки') m.env.rt.rbIdleMark.pots = 900;
 if (kind === 'магазин') m.env.rt.shopT = Date.now();
 await m.R.rbHuntStep(); assert.equal(m.env.rt.rbHuntIdle, 0); assert.equal(m.env.rt.rbListT === 0, kind === 'уровень'); assert.equal(m.maps, 0); // 15.10: банки не требуют повторного чтения14 страниц.
});
test('свежий живой доступный босс будит тур без события dead→alive', async () => {
 const m = fixture({ env: { rbTimer: { revivedSince: () => [] } } }); await m.R.rbHuntStep(); assert.equal(m.env.rt.rbHuntIdle, 0); assert.equal(m.maps, 0);
});
for (const value of [false, true]) test(`свежая строка таймера будит при устаревшем полном списке, выгода=${value}`, async () => {
 const m = fixture({ cfg: { rbValueTour: value }, rt: { rbListT: Date.now() - 20 * MIN }, env: { rbTimer: { revivedSince: () => ['low'] } } });
 await m.R.rbHuntStep(); assert.equal(m.env.rt.rbHuntIdle, 0); assert.equal(m.fires.length, 0);
 await m.R.rbHuntStep(); assert.equal(m.loc.href, '/rb-bosses.html'); assert.equal(m.fires.length, 0);
});
test('снятый серверный запрет будит тур с новым списком', async () => {
 const m = fixture(); m.env.rt.rbList.low.deny = 'пока нельзя'; await m.R.rbHuntStep(); assert.ok(m.env.rt.rbHuntIdle > Date.now());
 m.env.rt.rbList.low.deny = ''; await m.R.rbHuntStep(); assert.equal(m.env.rt.rbHuntIdle, 0);
});
test('короткий повтор ещё не истёк — простой не сбрасывается от одного alive', async () => {
 const m = fixture({ rt: { rbGoTried: { low: Date.now() } } }); await m.R.rbHuntStep(); assert.ok(m.env.rt.rbHuntIdle > Date.now()); assert.equal(m.maps, 1);
});
test('короткий повтор истёк — простой не досиживается', async () => {
 const m = fixture({ rt: { rbGoTried: { low: Date.now() - 3 * MIN } } }); await m.R.rbHuntStep(); assert.equal(m.env.rt.rbHuntIdle, 0);
});
for (const kind of ['живой', 'воскрес', 'уровень', 'магазин']) test(`два отказа сохраняют защитную паузу: ${kind}`, async () => {
 const m = fixture({ rt: { rbRefuse: { n: 2, t: Date.now() } }, env: { rbTimer: { revivedSince: () => kind === 'воскрес' ? ['low'] : [] } } });
 if (kind === 'уровень') m.env.rt.rbIdleMark.lvl = 54;
 if (kind === 'магазин') m.env.rt.shopT = Date.now();
 await m.R.rbHuntStep(); assert.ok(m.env.rt.rbHuntIdle > Date.now()); assert.equal(m.env.rt.rbRefuse.n, 2); assert.equal(m.maps, 1);
});
test('истёкшая защитная пауза не продлевается одним сохранённым счётчиком', async () => {
 const m = fixture({ rt: { rbHuntIdle: Date.now() - 1, rbRefuse: { n: 2, t: Date.now() - 6 * MIN } } });
 await m.R.rbHuntStep(); assert.equal(m.env.rt.rbHuntIdle, 0); assert.equal(m.env.rt.rbHunt.step, 'go');
});
for (const field of ['on', 'tabOwner']) test(`простой и публикация очереди при ${field}=false не исполняют действий`, async () => {
 const m = fixture({ env: { [field]: false } }); await m.R.rbHuntStep(); assert.equal(m.maps, 0); assert.equal(m.fires.length, 0); assert.equal(m.env.rt.rbTourView, undefined);
});
test('простой публикует фактический расчёт, включая блокировку повтора', async () => {
 const m = fixture({ rt: { rbGoTried: { low: Date.now() } } }); await m.R.rbHuntStep();
 assert.equal(m.env.rt.rbTourView.ready.length, 0); assert.equal(m.env.rt.rbTourView.blocked[0].kind, 'retry'); assert.equal(m.env.rt.rbTourView.mode, 'up');
});
