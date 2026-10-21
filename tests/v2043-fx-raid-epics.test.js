'use strict';
// 20.43 (автономность, доводка 21.10, замечания R2 и R3) — эпики, настоящий epics.epicStep (стенд epic-harness, Орфен).
// R2: прилёт эпика, карта не загрузилась после 3 обновлений → было epicGiveUp(…, 30) в обход правила epicArriveFail: через 30 мин эпик снова
//     выбирался — после платного телепорта со страницы при epicCoinPerBoss ≥ 2 это второй Coin of Luck на то же появление, а логово за адену
//     повторялось каждые 30 мин без учёта промаха. Теперь — epicArriveFail: страница — только подтверждённое логово или следующее появление,
//     логово — промах (lairMiss/lairBadT); дорога «он на этой карте» — прежние 30 мин. Учёт передышки epicMap остаётся.
// R3: запрет перелётов zoneGo (actions: rt.actionBan, 2 ч после циклов чужого маршрута) снимал маршрут в логово эпика сразу после резерва
//     адены — до телепорта; прилёт через 25–90 с считал это промахом логова (lairMiss, lairBadT на 6 ч), и дальше эпик шёл платной страницей
//     за Coin of Luck, а резерв адены оставался. Теперь эпик ждёт конца запрета без резерва и без промаха; уже снятый запретом маршрут —
//     резерв снимается, промаха нет.
const test = require('node:test'), assert = require('node:assert/strict');
const { mk, docOf, base, clone, H, MIN } = require('./epic-harness.cjs');

const ID = 'l2dop_rb_29014', LAIR = 'Sea of Spores';
const okDb = (x = {}) => ({ orfen: { id: ID, col: 1, adena: 0, apiT: Date.now(), alive: true, canAttack: true, lvl: 50, respH: 12, lifeT: Date.now() - 3600000, ...x } });
const okStats = () => ({ ...clone(base.rbStats), [ID]: { hp: 400000, patk: 1100, matk: 700, mdef: 800, pdef: 700, src: 'api' } });
const zoneCat = () => ({ [LAIR]: { price: 50000, cur: 'аден', curT: 'аден' } });
function arriveMapFail(via, db = {}, cfg = {}) {
  const at = Date.now() - 400000, holds = [];
  const m = mk({ cfg: { epicCoinDailyMax: 3, epicCoinPerBoss: 2, epicList: 'orfen', ...cfg }, net: () => null,
    rt: { epicDb: okDb({ paidN: via === 'page' ? 1 : 0, ...db }), rbStats: okStats(), zoneCat: zoneCat(),
      epicTpBudget: via === 'page' ? [{ t: at, k: 'orfen', cost: 1, unit: 'Coin of Luck' }] : [],
      epic: { step: 'arrive', k: 'orfen', id: ID, name: 'Орфен', via, ...(via === 'zone' ? { lair: LAIR } : via === 'page' ? { tpT: at, tpRes: at } : {}), at, mapLoadT: Date.now() - 5 * MIN, mapLoadReloads: 3 } },
    env: { mapReady: async () => false, selfHold: async (k, w, o) => { holds.push({ k, o }); return o?.noWait ? 'defer' : 'hold'; } } });
  return { m, holds };
}

// ---------- R2 ----------
test('R2: страница (Coin of Luck), логово не подтверждено — до следующего появления, а не 30 мин: второго платного захода в это появление нет', async () => {
  const { m, holds } = arriveMapFail('page');
  await m.E.epicStep();
  const d = m.env.rt.epicDb.orfen;
  assert.equal(holds.length, 1); assert.equal(holds[0].k, 'epicMap'); assert.equal(holds[0].o.noWait, true, 'учёт передышки остаётся');
  assert.ok(m.env.rt.mapBad?.at > 0); assert.equal(m.env.rt.epic.step, 'pick');
  assert.ok(d.skipT > Date.now() + 10 * H, 'до следующего появления (respH 12 ч)'); assert.match(d.why, /после платного телепорта карта не загрузилась после 3 обновлений — жду следующего появления/);
  assert.ok(m.E.epicPickWhy('orfen', Date.now() + 31 * MIN), 'через 30 мин эпик не выбирается снова (раньше — снова страница за Coin of Luck)');
  assert.equal(m.env.rt.epicTpBudget.length, 1); assert.equal(d.paidN, 1);
});

test('R2: страница, логово подтверждено — второй раз страницей не идём, пробуем логово за адену (только бесплатно или логово)', async () => {
  const { m } = arriveMapFail('page', { lairOkT: Date.now() - H, seenZone: LAIR });
  await m.E.epicStep();
  const E = m.env.rt.epic;
  assert.equal(E.step, 'go'); assert.equal(E.noPay, true); assert.equal(E.lairOnly, true); assert.ok(!(m.env.rt.epicDb.orfen.skipT > Date.now()));
  assert.ok(m.logs.some(l => /после платного телепорта карта не загрузилась после 3 обновлений — пробую подтверждённое логово \(за адену\), страницей второй раз не иду/.test(l)));
});

// 20.43 (ревью fx/raid): сбой карты — не довод, что неподтверждённое логово неверное. Первый такой сбой — только счёт промаха (без паузы 6 ч:
// иначе дальше эпик шёл страницей за Coin of Luck вместо логова за адену); второй подряд — пауза логова 6 ч, логово за адену не повторяется
test('R2: логово не подтверждено — промах логова учтён; пауза логова 6 ч — со второго сбоя карты подряд', async () => {
  const { m } = arriveMapFail('zone', { seenZone: LAIR });
  await m.E.epicStep();
  const d = m.env.rt.epicDb.orfen;
  assert.equal(d.lairMiss, 1); assert.ok(!d.lairBadT, '20.43 (ревью fx/raid): первый сбой карты — без паузы логова'); assert.match(d.why, /^логово: карта не загрузилась после 3 обновлений/);
  assert.equal(m.E.epicLair('orfen', Date.now() + 31 * MIN).ok, true, 'через 30 мин — снова логово за адену');
  const n = arriveMapFail('zone', { seenZone: LAIR, lairMiss: 1 }).m;
  await n.E.epicStep();
  assert.equal(n.env.rt.epicDb.orfen.lairMiss, 2); assert.ok(n.env.rt.epicDb.orfen.lairBadT > 0);
  assert.equal(n.E.epicLair('orfen', Date.now() + 31 * MIN).ok, false, 'второй сбой подряд — через 30 мин логово не выбирается снова');
});

test('R2: подтверждённое логово — первый промах учитывается (второй подряд — пауза логова 6 ч)', async () => {
  const { m } = arriveMapFail('zone', { seenZone: LAIR, lairOkT: Date.now() - H, lairMiss: 0 });
  await m.E.epicStep();
  assert.equal(m.env.rt.epicDb.orfen.lairMiss, 1); assert.ok(!m.env.rt.epicDb.orfen.lairBadT, 'один промах подтверждённого логова — без паузы');
  const n = arriveMapFail('zone', { seenZone: LAIR, lairOkT: Date.now() - H, lairMiss: 1 }).m;
  await n.E.epicStep(); assert.equal(n.env.rt.epicDb.orfen.lairMiss, 2); assert.ok(n.env.rt.epicDb.orfen.lairBadT > 0);
});

test('R2: дорога «он на этой карте» — как раньше, отсрочка на 30 мин (без платного перелёта)', async () => {
  const { m } = arriveMapFail('here');
  await m.E.epicStep();
  const d = m.env.rt.epicDb.orfen;
  assert.ok(d.skipT > Date.now() + 25 * MIN && d.skipT < Date.now() + 35 * MIN); assert.equal(d.why, 'карта не загрузилась после 3 обновлений'); assert.equal(d.mapFail.via, 'here');
});

// ---------- R3 ----------
const ban = (x = {}) => ({ zoneGo: { t: Date.now() - 10 * MIN, until: Date.now() + 100 * MIN, why: 'Маршрут zoneGo: более 10 переходов без продвижения этапа', ...x } });
function goLair(rt = {}) {
  return mk({ cfg: { epicCoinDailyMax: 3, epicList: 'orfen' }, net: () => null,
    rt: { epicDb: okDb({ seenZone: LAIR, lairOkT: Date.now() - H }), rbStats: okStats(), zoneCat: zoneCat(), epicTpBudget: [],
      epic: { step: 'go', k: 'orfen', id: ID, name: 'Орфен', at: Date.now(), t: Date.now(), via: null, mapChecked: true }, ...rt } });
}

test('R3: перелёты запрещены после циклов — эпик ждёт конца запрета: без резерва адены, без маршрута, без промаха логова и без страницы за CoL', async () => {
  const m = goLair({ actionBan: ban() });
  await m.E.epicStep();
  const d = m.env.rt.epicDb.orfen;
  assert.equal(m.env.rt.epicTpBudget.length, 0, 'резерва нет'); assert.equal(m.env.rt.zoneGo, undefined, 'маршрута в логово нет'); assert.equal(m.loc.href, '');
  assert.equal(d.lairMiss, undefined); assert.equal(d.lairBadT, undefined); assert.equal(m.fires.length, 0);
  assert.equal(m.env.rt.epic.step, 'pick'); assert.ok(Math.abs(d.skipT - m.env.rt.actionBan.zoneGo.until) < 2 * MIN, 'отсрочка — до конца запрета');
  assert.match(d.why, /перелёт в логово Sea of Spores запрещён до \d\d:\d\d \(Маршрут zoneGo: более 10 переходов/);
  // 20.43 (ревью fx/raid): при запрете эпик с дорогой в логово больше не выбирается (подготовка не покупала бы баффы зря) — и платной
  // страницы вместо логова по-прежнему нет
  { const r = m.E.epicRoute('orfen'); assert.equal(r.via, '', 'дорога — не платная страница'); assert.match(r.why, /перелёт в логово Sea of Spores запрещён до/); }
  // запрет кончился — обычный путь: резерв адены и маршрут в логово
  const n = goLair({ actionBan: ban({ until: Date.now() - 1 }) });
  await n.E.epicStep();
  assert.equal(n.env.rt.epicTpBudget.length, 1); assert.equal(n.env.rt.epicTpBudget[0].unit, 'аден'); assert.equal(n.env.rt.zoneGo.id, LAIR);
  assert.equal(n.env.rt.epic.step, 'arrive'); assert.equal(n.env.rt.epic.via, 'zone'); assert.ok(n.env.rt.epic.lairT > 0); assert.equal(n.env.rt.epic.tpRes, n.env.rt.epicTpBudget[0].t);
});

test('R3: маршрут в логово уже снят запретом, действовавшим до него (диспетчер — до запуска): резерв снят, промаха логова нет', async () => {
  const lairT = Date.now() - 60000;
  const m = mk({ cfg: { epicList: 'orfen' }, net: () => null,
    rt: { epicDb: okDb({ seenZone: LAIR }), rbStats: okStats(), zoneCat: zoneCat(), actionBan: ban({ t: lairT - 5 * MIN }), zoneGoT: Date.now() - 50000,
      epicTpBudget: [{ t: lairT, k: 'orfen', cost: 50000, unit: 'аден', kind: 'lair' }],
      epic: { step: 'arrive', k: 'orfen', id: ID, name: 'Орфен', via: 'zone', lair: LAIR, at: lairT, lairT, tpRes: lairT, seenSaved: false } } });
  await m.E.epicStep();
  const d = m.env.rt.epicDb.orfen;
  assert.equal(m.env.rt.epicTpBudget.length, 0, 'резерв адены снят'); assert.equal(d.lairMiss, undefined, 'не промах логова (раньше — lairMiss и lairBadT на 6 ч)'); assert.equal(d.lairBadT, undefined);
  assert.equal(m.env.rt.epic.step, 'pick'); assert.ok(d.skipT > Date.now() + 90 * MIN); assert.match(d.why, /маршрут в логово снят запретом перелётов/);
  assert.equal(m.E.epicLair('orfen', Date.now() + 2 * H).ok, true, 'после запрета логово снова доступно');
});

test('R3: запрет появился уже после маршрута (мог быть телепорт) или маршрут ещё в работе — прежнее правило прилёта', async () => {
  const lairT = Date.now() - 60000;
  for (const [name, rt] of [['запрет позже', { actionBan: ban({ t: lairT + 1000 }) }], ['маршрут жив', { actionBan: ban({ t: lairT - 5 * MIN }), zoneGo: { id: LAIR, t: lairT } }]]) {
    const m = mk({ cfg: { epicList: 'orfen' }, net: () => null,
      rt: { epicDb: okDb({ seenZone: LAIR }), rbStats: okStats(), zoneCat: zoneCat(), epicTpBudget: [{ t: lairT, k: 'orfen', cost: 50000, unit: 'аден', kind: 'lair' }],
        epic: { step: 'arrive', k: 'orfen', id: ID, name: 'Орфен', via: 'zone', lair: LAIR, at: lairT, lairT, tpRes: lairT, seenSaved: false }, ...rt } });
    await m.E.epicStep();
    assert.equal(m.env.rt.epicTpBudget.length, 1, name + ': резерв не трогаем');
    assert.ok(m.env.rt.epicDb.orfen.lairMiss === 1 || m.env.rt.epic.step === 'arrive', name);
  }
});
