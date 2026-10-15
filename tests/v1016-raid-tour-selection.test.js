'use strict';
// 14.10: жалоба на пропущенных живых РБ и скачки уровня — настоящий raid со списком/картой без сети игры.
const test = require('node:test'), assert = require('node:assert/strict');
const { mk, docOf } = require('./epic-harness.cjs');
const MIN = 60000;
const low = { name: 'Младший', lvl: 50, alive: true, price: 100000, unit: 'аден', page: 1, ord: 1 };
const high = { name: 'Старший', lvl: 55, alive: true, price: 100000, unit: 'аден', page: 2, ord: 2 };
const stats = { hp: 10000, patk: 10, matk: 10, mdef: 10, pdef: 10, src: 'api' };
function fixture(o = {}) {
 const now = Date.now(), m = mk({ hero: 55, cfg: { epicMode: false, rbHuntMode: true, rbMode: true, rbOrder: 'up', rbProbe: false, shopAuto: false, rbMaxBelow: 15, rbMaxAbove: 15, ...o.cfg },
  rt: { rbHunt: { step: 'pick' }, rbListT: now, rbList: { low: { ...low }, high: { ...high } }, rbDb: {}, rbStats: { low: { ...stats }, high: { ...stats } }, rbDps: 2000, ...o.rt },
  meHp: () => ({ cur: 10000, max: 10000, pct: 100 }), doc: o.doc || docOf(''),
  env: { RB_WIN: 15, RB_TRY_MS: 10 * MIN, RB_RETRY_MS: 2 * MIN, tabOwner: true, storyRbIds: () => [], ...o.env } });
 m.maps = 0; m.env.map = async () => { m.maps++; return 'map'; }; return m;
}
const wound = () => ({ cur: 100, max: 10000, t: Date.now() });
const pin = (id, row) => `<button class="l2-map-mob-pin l2-map-mob-pin--raid" data-spawn-id="${id}" title="${row.name} · ур. ${row.lvl} · рейд-босс"></button>`;

test('возрастание: недобитый старший не обгоняет живого младшего', () => {
 const m = fixture({ rt: { rbWound: { high: wound() } } }); assert.equal(m.R.rbListPick().id, 'low');
});
test('возрастание: сюжетный старший не обгоняет младшего', () => {
 const m = fixture({ env: { storyRbIds: () => ['high'] } }); assert.equal(m.R.rbListPick().id, 'low');
});
test('убывание: недобитый младший не обгоняет старшего', () => {
 const m = fixture({ cfg: { rbOrder: 'down' }, rt: { rbWound: { low: wound() } } }); assert.equal(m.R.rbListPick().id, 'high');
});
test('равный уровень: недобитый остаётся первым и несёт свежий остаток HP', () => {
 const m = fixture({ rt: { rbList: { low, high: { ...high, lvl: 50 } }, rbWound: { high: wound() } } });
 assert.equal(m.R.rbListPick().id, 'high'); assert.equal(m.R.rbListPick().wounded.cur, 100);
});
test('равный уровень: сюжетный РБ первым среди целых', () => {
 const m = fixture({ rt: { rbList: { low, high: { ...high, lvl: 50 } } }, env: { storyRbIds: () => ['high'] } });
 assert.equal(m.R.rbListPick().id, 'high'); assert.equal(m.R.rbListPick().quest, true);
});
test('прошедший короткий интервал повтор входит в общую очередь уровней', () => {
 const m = fixture({ rt: { rbGoTried: { low: Date.now() - 3 * MIN } } }); assert.equal(m.R.rbListPick().id, 'low');
});
test('короткий интервал повторов остаётся обязательным для целого босса', () => {
 const m = fixture({ rt: { rbGoTried: { low: Date.now() - MIN } } }); assert.equal(m.R.rbListPick().id, 'high');
});
test('сохранённый rbCur не исключает живого РБ после завершённого шага', () => {
 const m = fixture({ rt: { rbCur: 'low' } }); assert.equal(m.R.rbListPick().id, 'low');
});
test('на карте rbCur не ставится перед порядком уровней', () => {
 const m = fixture({ rt: { rbCur: 'high' }, doc: docOf(pin('high', high) + pin('low', low)) });
 assert.deepEqual(Array.from(m.R.rbCandidates(), x => x.id), ['low', 'high']);
});
test('прибытие к явной выбранной цели сохраняет её, не начинает новую очередь', () => {
 const m = fixture({ rt: { rbWant: 'high' }, doc: docOf(pin('high', high) + pin('low', low)) });
 assert.equal(m.R.rbCandidates()[0].id, 'high');
});
test('выбранная цель на карте не обходит окно уровня', () => {
 const m = fixture({ rt: { rbWant: 'far' }, doc: docOf(pin('far', { name: 'Вне окна', lvl: 80 }) + pin('low', low)) });
 assert.equal(m.R.rbCandidates()[0].id, 'low');
});
test('местный старший не подменяет выбранного удалённого младшего', async () => {
 const m = fixture({ doc: docOf(pin('high', high)) }); await m.R.rbHuntStep();
 assert.equal(m.env.rt.rbHunt.id, 'low'); assert.equal(m.env.rt.rbHunt.step, 'go'); assert.equal(m.fires.length, 0);
});
test('выбранный младший уже на карте — остаётся бесплатный бой', async () => {
 const m = fixture({ doc: docOf(pin('high', high) + pin('low', low)) }); await m.R.rbHuntStep();
 assert.equal(m.env.rt.rbHunt.id, 'low'); assert.equal(m.env.rt.rbHunt.step, 'arrive'); assert.equal(m.fires.length, 0);
});
for (const why of ['dead', 'deny', 'limit']) test(`ожидание подготовки не сохраняет устаревшую местную цель: ${why}`, async () => {
 const m = fixture({ doc: docOf(pin('low', low)) });
 m.env.townBuffStart = async () => {
  if (why === 'dead') m.env.rt.rbList.low.alive = false;
  if (why === 'deny') m.env.rt.rbList.low.deny = 'игра запретила';
  if (why === 'limit') m.env.rt.rbGoCnt = { low: [Date.now(), Date.now(), Date.now()] };
  return false;
 };
 await m.R.rbHuntStep(); assert.equal(m.env.rt.rbHunt.step, 'pick'); assert.equal(m.fires.length, 0);
});
for (const why of ['on', 'tabOwner', 'manual']) test(`потеря активного режима во время подготовки не сохраняет цель: ${why}`, async () => {
 const m = fixture({ doc: docOf(pin('low', low)) });
 m.env.townBuffStart = async () => { if (why === 'manual') { m.env.rt.manualKickAt = Date.now(); m.env.rt.rbHunt = { step: 'pick', id: 'new' }; } else m.env[why] = false; return false; };
 await m.R.rbHuntStep(); assert.equal(m.env.rt.rbHunt.step, 'pick'); assert.equal(m.env.rt.rbHunt.id || '', why === 'manual' ? 'new' : ''); assert.equal(m.fires.length, 0);
});
test('новая команда при записи местной цели не перезаписывается старым arrive', async () => {
 const m = fixture({ doc: docOf(pin('low', low)) }), set = m.env.setRt;
 m.env.setRt = async p => { await set(p); if (p.rbWant) { m.env.rt.manualKickAt = Date.now(); m.env.rt.rbHunt = { step: 'pick', id: 'new' }; } };
 await m.R.rbHuntStep(); assert.equal(m.env.rt.rbHunt.id, 'new'); assert.equal(m.env.rt.rbHunt.step, 'pick');
});
test('разведка знакомых зон также идёт по уровню босса', () => {
 const m = fixture({ rt: { zone: 'home', rbSeen: { high: { ...high, zone: 'highzone' }, low: { ...low, zone: 'lowzone' } }, rbDb: { high: { verdict: 'ok' } } } });
 assert.equal(m.R.rbTourPick().id, 'lowzone');
});
test('точные характеристики пересчитывают прежний условный отказ', () => {
 for (const kind of ['pots', 'slow', 'strong', 'unknown']) {
  const m = fixture({ rt: { rbPreSkip: { low: { t: Date.now(), kind } } } }); assert.equal(m.R.rbListPick().id, 'low', kind);
 }
});
test('отказ без точных характеристик остаётся до истечения паузы', () => {
 const m = fixture({ rt: { rbStats: { high: { ...stats } }, rbPreSkip: { low: { t: Date.now(), kind: 'pots' } } } }); assert.equal(m.R.rbListPick().id, 'high');
});
test('аварийный отход не снимается успешной предбоевой оценкой', () => {
 for (const legacy of [false, true]) {
  const m = fixture({ rt: { rbPreSkip: { low: { t: Date.now(), kind: 'strong', ...(!legacy ? { observed: true } : {}) } }, rbDb: legacy ? { low: { note: 'аварийный выход: следующий удар убьёт' } } : {} } });
  assert.equal(m.R.rbListPick().id, 'high');
 }
});
test('измеренный опасный спецудар и доказанное поражение не снимаются пересчётом', () => {
 for (const db of [{ verdict: 'no', heroLvl: 55 }, { sp: 5000 }]) {
  const m = fixture({ rt: { rbDb: { low: db }, rbPreSkip: { low: { t: Date.now(), kind: 'strong' } } } }); assert.equal(m.R.rbListPick().id, 'high');
 }
});
test('серверный запрет, валюта и предел 3 переходов продолжают исключать босса', () => {
 for (const blocked of [{ deny: 'уровень' }, { unit: 'Coin of Luck' }, { unit: '' }]) {
  const m = fixture({ rt: { rbList: { low: { ...low, ...blocked }, high } } }); assert.equal(m.R.rbListPick().id, 'high');
 }
 const m = fixture({ rt: { rbGoCnt: { low: [Date.now(), Date.now(), Date.now()] }, rbWound: { low: wound() } } }); assert.equal(m.R.rbListPick().id, 'high');
});
test('объяснение пустой очереди отражает лимит переходов, ожидание и режим выгоды', () => {
 const m = fixture({ rt: { rbList: { low }, rbGoCnt: { low: [Date.now(), Date.now(), Date.now()] } } }); assert.match(m.R.rbListWhy(), /3.*телепорт|лимит.*телепорт/);
 m.env.rt.rbGoCnt = {}; m.env.rt.rbGoTried = { low: Date.now() }; assert.match(m.R.rbListWhy(), /пробовал|повтор/);
 m.env.rt.rbGoTried = {}; m.env.cfg.rbValueTour = true; m.env.rt.rbDb.low = { adenaPerKill: 0, expPerKill: 0 }; assert.equal(m.R.rbListPick(), null); assert.match(m.R.rbListWhy(), /выгод/);
});
test('явный режим выгоды может выбрать старшего и не меняет настройку порядка', () => {
 const m = fixture({ cfg: { rbValueTour: true }, rt: { rbDb: { low: { adenaPerKill: 110000, expPerKill: 0 }, high: { adenaPerKill: 1000000, expPerKill: 0 } } } });
 assert.equal(m.R.rbListPick().id, 'high'); assert.equal(m.env.cfg.rbOrder, 'up');
});
test('единый план отдаёт ту же очередь и причины, что реальный selector', () => {
 const m = fixture({ rt: { rbGoCnt: { low: [Date.now(), Date.now(), Date.now()] } } }); const plan = m.R.rbTourPlan();
 assert.equal(plan.ready[0].id, m.R.rbListPick().id); assert.equal(plan.blocked.find(x => x.id === 'low').kind, 'limit');
 assert.deepEqual([plan.lo, plan.hi, plan.mode], [40, 70, 'up']);
});
test('чтение плана не меняет память и не пишет журнал отказов', () => {
 const m = fixture({ rt: { rbDb: { low: { sp: 5000 } } } }), before = JSON.stringify(m.env.rt);
 m.R.rbTourPlan(); m.R.rbListPick(); m.R.rbListWhy(); assert.equal(JSON.stringify(m.env.rt), before); assert.equal(m.logs.length, 0);
});
