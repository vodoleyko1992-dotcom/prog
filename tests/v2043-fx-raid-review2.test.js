'use strict';
// 20.43 (автономность, доводка 21.10, ревью ветки fx/raid) — два оставшихся пути к Coin of Luck/FA у эпиков. Настоящие epics.epicStep и
// content.mapGate (стенд epic-harness, Орфен).
// 1) R2 создал новый путь к Coin of Luck: прилёт в НЕподтверждённое логово (зона из таблицы EPICS), карта не загрузилась после 3 обновлений →
//    epicArriveFail сразу ставил паузу логова 6 ч (lairBadT). Откат (epicMapRelease) жил только 30 мин отсрочки — если и первая бесплатная
//    проверка карты (mapGate) падала, передышка epicMap (30 мин) съедала это окно целиком. Дальше эпик, не видный с этой точки, шёл
//    страницей за Coin of Luck (на базе — через 30 мин снова логово за адену). Теперь по сбою карты — только счёт промаха, пауза логова со
//    второго подряд; промах из-за карты откатывается при любой следующей встрече эпика на карте (и на прилёте «он здесь»).
// 2) R3 закрыт не до конца: запрет перелётов rt.actionBan.zoneGo (2 ч) учитывался только в шаге go. Эпик с дорогой в логово выбирался,
//    подготовка покупала набор за FA (epicFaOk) или «Повний баф» за 15 Coin of Luck (epicBuffPay), и лишь потом go откладывал заход до конца
//    запрета — баффы истекали без боя. Теперь запрет учитывает выбор (epicRoute/epicPickWhy), подготовка и ворота баффов (epicBuffWhy).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const EC = require('../engine-core.js');
const { mk, docOf, base, clone, H, MIN } = require('./epic-harness.cjs');
const content = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
const slice = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, a); return s.slice(i, j); };
const HOLD_SRC = slice(content, 'const SELF_HOLD_STEPS =', '// ---------- переходы');

const ID = 'l2dop_rb_29014', LAIR = 'Sea of Spores';
const pin = `<div><button class="l2-map-mob-pin l2-map-mob-pin--epic" data-spawn-id="${ID}" title="Орфен · ур. 50 · епік-бос"></button></div>`;
const okDb = (x = {}) => ({ orfen: { id: ID, col: 1, adena: 0, apiT: Date.now(), alive: true, canAttack: true, lvl: 50, respH: 12, lifeT: Date.now() - H, seenZone: LAIR, ...x } });
const okStats = () => ({ ...clone(base.rbStats), [ID]: { hp: 400000, patk: 1100, matk: 700, mdef: 800, pdef: 700, src: 'api' } });
const zoneCat = () => ({ [LAIR]: { price: 50000, cur: 'аден', curT: 'аден' } });
// настоящий content.mapGate поверх стенда эпиков (как в v2043-fx-raid-map-release): передышка selfHoldStart — только запись
function wireGate(m) {
  const holds = [], g = { L2EngineCore: EC, Date, String, Number, Math, Object, Array, JSON, console, Promise, URL, location: m.loc, on: true, tabOwner: true,
    automationGeneration: 0, leaseEpoch: 'e1', antibotState: () => null, cfg: {}, setRt: async p => { await m.env.setRt(p); return { ok: true }; }, rtCommit: async () => true,
    rec: (...a) => m.logs.push(a.slice(1).join(' ')), setStatus() {}, sleep: async () => {}, isMap: () => m.env.isMap(), mapReady: (...a) => m.env.mapReady(...a), autonomyMode: () => 'epic' };
  Object.defineProperty(g, 'rt', { get: () => m.env.rt, set() {} });
  vm.createContext(g); vm.runInContext(HOLD_SRC + ';this.gate=mapGate;', g);
  g.selfHoldStart = async (kind, why, opt) => { holds.push({ kind, why, opt }); return 'hold'; };
  m.env.mapGate = (...a) => g.gate(...a);
  const nav = () => { if (m.loc.href) { const u = new URL(m.loc.href, 'https://fixture.invalid'); m.loc.pathname = u.pathname; m.loc.search = u.search; m.loc.href = ''; } };
  return { holds, nav };
}

// ---------- 1: сбой карты в неподтверждённом логове ----------
test('1: неподтверждённое логово, карта не загрузилась, первая бесплатная проверка карты тоже падает (передышка 30 мин) — после неё дорога снова логово за адену, а не страница за Coin of Luck', async () => {
  const at = Date.now() - 400000, holds0 = [];
  const m = mk({ cfg: { epicCoinDailyMax: 3, epicCoinPerBoss: 2, epicList: 'orfen,core' }, net: () => null,
    rt: { epicDb: okDb({ verdict: { v: 'ok', why: 'по силам' } }), rbStats: okStats(), zoneCat: zoneCat(), epicTpBudget: [], epicApi: { t: Date.now() },
      epic: { step: 'arrive', k: 'orfen', id: ID, name: 'Орфен', via: 'zone', lair: LAIR, at, mapLoadT: Date.now() - 5 * MIN, mapLoadReloads: 3 } },
    env: { mapReady: async () => false, selfHold: async (k, w, o) => { holds0.push({ k, o }); return o?.noWait ? 'defer' : 'hold'; } } });
  const { holds, nav } = wireGate(m);
  await m.E.epicStep();
  let d = m.env.rt.epicDb.orfen;
  assert.equal(holds0.length, 1); assert.equal(holds0[0].k, 'epicMap'); assert.ok(m.env.rt.mapBad?.at > 0, 'метка «карта не подтверждена» стоит');
  assert.equal(d.lairMiss, 1, 'промах логова учтён'); assert.ok(!d.lairBadT, 'по одному сбою карты — без паузы логова 6 ч (на ветке до правки — lairBadT = сейчас)');
  assert.equal(d.mapFail?.via, 'zone'); assert.ok(d.skipT > Date.now() + 25 * MIN && d.skipT < Date.now() + 35 * MIN);
  // подготовка к другому эпику: бесплатная проверка карты тоже падает → передышка epicMap (30 мин), шаг эпиков стоит
  await m.env.setRt({ epic: { step: 'prep', k: 'core', name: 'Core', deaths: 0, at: Date.now(), t: Date.now(), route: 'page' } });
  for (let i = 0; i < 3 && !holds.length; i++) { await m.E.epicStep(); nav(); }
  assert.equal(holds.length, 1, 'передышка epicMap'); assert.equal(holds[0].kind, 'epicMap');
  // передышка (30 мин) кончилась — 30-минутная отсрочка Орфена тоже, окно отката прошло, а эпика с этой точки не видно
  const after = Date.now() + 31 * MIN;
  d = m.env.rt.epicDb.orfen;
  assert.ok(d.skipT < after);
  assert.equal(m.E.epicLair('orfen', after).ok, true, 'логово не на паузе 6 ч');
  const r = m.E.epicRoute('orfen', after);
  assert.notEqual(r.via, 'page', 'не страница за Coin of Luck'); assert.equal(r.via, 'zone'); assert.equal(r.zone, LAIR);
  assert.equal(m.env.rt.epicTpBudget.length, 0, 'ни одной траты');
});

test('1: второй сбой карты подряд в том же логове — пауза логова 6 ч (как у подтверждённого)', async () => {
  const at = Date.now() - 400000;
  const m = mk({ cfg: { epicCoinDailyMax: 3, epicList: 'orfen' }, net: () => null,
    rt: { epicDb: okDb({ lairMiss: 1 }), rbStats: okStats(), zoneCat: zoneCat(), epicTpBudget: [],
      epic: { step: 'arrive', k: 'orfen', id: ID, name: 'Орфен', via: 'zone', lair: LAIR, at, mapLoadT: Date.now() - 5 * MIN, mapLoadReloads: 3 } },
    env: { mapReady: async () => false, selfHold: async (k, w, o) => (o?.noWait ? 'defer' : 'hold') } });
  await m.E.epicStep();
  const d = m.env.rt.epicDb.orfen;
  assert.equal(d.lairMiss, 2); assert.ok(d.lairBadT > 0); assert.equal(d.mapFail.lairMiss, 1, 'для отката — счёт до этого сбоя');
});

test('1: промах логова из-за сбоя карты откатывается и после конца 30-минутной отсрочки — при следующей встрече эпика на карте', async () => {
  const m = mk({ cfg: { epicList: 'orfen' }, doc: docOf(pin), net: () => null,
    rt: { epicDb: okDb({ lairMiss: 2, lairBadT: Date.now() - 40 * MIN, skipT: Date.now() - 5 * MIN, why: 'логово: карта не загрузилась после 3 обновлений',
      mapFail: { t: Date.now() - 40 * MIN, via: 'zone', lairMiss: 1, lairBadT: 0 } }), rbStats: okStats(), zoneCat: zoneCat(), epicApi: { t: Date.now() }, epic: { step: 'pick' } } });
  await m.E.epicStep();
  const d = m.env.rt.epicDb.orfen;
  assert.equal(d.lairMiss, 1); assert.equal(d.lairBadT, 0, 'пауза логова снята (до правки — держалась 6 ч: откат только при skipT > now)'); assert.equal(d.mapFail, null);
  assert.ok(m.logs.some(l => /Орфен: карта работает и показывает его здесь — промах логова из-за сбоя карты откатываю/.test(l)), m.logs.join('\n'));
  assert.equal(m.E.epicLair('orfen').ok, true);
});

test('1: настоящий промах логова (карта загрузилась, его нет) снимает метку сбоя карты — следующая встреча его не стирает', async () => {
  const lairT = Date.now() - 60000;
  const m = mk({ cfg: { epicList: 'orfen' }, net: () => null,
    rt: { epicDb: okDb({ lairMiss: 1, mapFail: { t: Date.now() - H, via: 'zone', lairMiss: 0, lairBadT: 0 } }), rbStats: okStats(), zoneCat: zoneCat(), epicApi: { t: Date.now() },
      epic: { step: 'arrive', k: 'orfen', id: ID, name: 'Орфен', via: 'zone', lair: LAIR, at: lairT, seenSaved: false } } });
  await m.E.epicStep();
  let d = m.env.rt.epicDb.orfen;
  assert.equal(d.lairMiss, 2); assert.ok(d.lairBadT > 0); assert.equal(d.mapFail, null, 'метка сбоя карты снята'); assert.match(d.why, /логово: на карте его нет/);
  m.setDoc(docOf(pin)); await m.env.setRt({ epic: { step: 'pick' } });
  await m.E.epicStep();
  d = m.env.rt.epicDb.orfen;
  assert.equal(d.lairMiss, 2); assert.ok(d.lairBadT > 0, 'настоящий промах остаётся');
});

test('1: прилёт «он здесь» — метка сбоя карты снимается, промах логова из-за карты откатывается', async () => {
  const m = mk({ cfg: { epicList: 'orfen' }, doc: docOf(pin), net: () => null,
    rt: { epicDb: okDb({ lairMiss: 2, lairBadT: Date.now() - MIN, mapFail: { t: Date.now() - 2 * MIN, via: 'zone', lairMiss: 0, lairBadT: 0 } }), rbStats: okStats(), zoneCat: zoneCat(),
      epic: { step: 'arrive', k: 'orfen', id: ID, name: 'Орфен', via: 'here', at: Date.now(), seenSaved: false } } });
  const engaged = []; m.env.rbEngage = async r => { engaged.push(r.id); return true; };
  await m.E.epicStep();
  const d = m.env.rt.epicDb.orfen;
  assert.deepEqual(engaged, [ID]); assert.equal(d.mapFail, null); assert.equal(d.lairMiss, 0); assert.equal(d.lairBadT, 0);
});

// ---------- 2: запрет перелётов уже на выборе и в подготовке ----------
const ban = (x = {}) => ({ zoneGo: { t: Date.now() - 10 * MIN, until: Date.now() + 100 * MIN, why: 'Маршрут zoneGo: более 10 переходов без продвижения этапа', ...x } });
function prepBench(rt = {}, path = '/map.html') {
  const calls = { buff: 0, shop: 0, vitals: 0 };
  const m = mk({ cfg: { epicCoinDailyMax: 30, epicCoinPerBoss: 2, epicList: 'orfen', townBuffSet: 'mage' }, net: () => null, path,
    rt: { epicDb: okDb({ lairOkT: Date.now() - H }), rbStats: okStats(), zoneCat: zoneCat(), epicTpBudget: [], epicApi: { t: Date.now() }, ...rt },
    env: { townBuffStart: async () => { calls.buff++; return false; }, rbShopFirst: async () => { calls.shop++; return false; }, restoreVitals: async () => { calls.vitals++; return false; }, faFullIds: () => [1323] } });
  return { m, calls };
}

test('2: запрет перелётов уже стоит — эпик с логовом не выбирается: ни подготовки, ни townBuffStart, ни резерва, ни страницы за Coin of Luck', async () => {
  const { m, calls } = prepBench({ actionBan: ban(), epic: { step: 'pick' } });
  for (let i = 0; i < 3; i++) await m.E.epicStep();
  assert.equal(calls.buff, 0, 'баффы не покупаются (до правки — townBuffStart «перед эпиком Орфен» на подготовке)'); assert.equal(calls.shop, 0);
  assert.notEqual(m.env.rt.epic.step, 'prep'); assert.ok(!m.env.rt.epic.k || m.env.rt.epic.step === 'pick');
  assert.equal(m.env.rt.epicTpBudget.length, 0); assert.equal(m.env.rt.zoneGo, undefined); assert.equal(m.fires.length, 0);
  assert.match(m.E.epicPickWhy('orfen'), /перелёт в логово Sea of Spores запрещён до \d\d:\d\d/);
  assert.ok(m.logs.some(l => /подходящих эпиков нет — Орфен: перелёт в логово Sea of Spores запрещён/.test(l)), m.logs.join('\n'));
  // запрет кончился — обычный выбор: логово за адену, подготовка
  const n = prepBench({ actionBan: ban({ until: Date.now() - 1 }), epic: { step: 'pick' } }).m;
  await n.E.epicStep();
  assert.equal(n.env.rt.epic.step, 'prep'); assert.equal(n.env.rt.epic.route, 'zone');
});

test('2: запрет появился после выбора — подготовка не покупает баффы, заход отложен до конца запрета; «он на этой карте» — подготовка идёт', async () => {
  const { m, calls } = prepBench({ actionBan: ban(), epic: { step: 'prep', k: 'orfen', id: ID, name: 'Орфен', deaths: 0, hpLog: [], tries: 0, at: Date.now(), t: Date.now(), route: 'zone' } }, '/town-buffer.html');
  await m.E.epicStep();
  const d = m.env.rt.epicDb.orfen;
  assert.equal(calls.buff, 0, 'townBuffStart не вызван'); assert.equal(calls.shop, 0, 'банки не закупаются под заход, которого не будет');
  assert.equal(m.env.rt.epic.step, 'pick'); assert.ok(Math.abs(d.skipT - m.env.rt.actionBan.zoneGo.until) < 2 * MIN, 'отсрочка — до конца запрета');
  assert.match(d.why, /перелёт в логово Sea of Spores запрещён до/); assert.equal(d.lairMiss, undefined, 'не промах логова');
  const h = prepBench({ actionBan: ban(), epic: { step: 'prep', k: 'orfen', id: ID, name: 'Орфен', deaths: 0, hpLog: [], tries: 0, at: Date.now(), t: Date.now(), route: 'here' } }, '/town-buffer.html');
  await h.m.E.epicStep();
  assert.equal(h.calls.buff, 1, 'дорога «он на этой карте» — бесплатна, запрет не мешает');
  // после смерти герой в городе: прежний выбор «он здесь» уже не верен — дорога снова логово, баффы под запрет не покупаем
  const dd = prepBench({ actionBan: ban(), epic: { step: 'prep', k: 'orfen', id: ID, name: 'Орфен', deaths: 1, noPay: true, hpLog: [], tries: 0, at: Date.now(), t: Date.now(), route: 'here' } }, '/town-buffer.html');
  assert.equal(dd.m.E.epicFaOk(), false, 'набор за FA после смерти не берётся');
  await dd.m.E.epicStep();
  assert.equal(dd.calls.buff, 0); assert.equal(dd.m.env.rt.epic.step, 'pick'); assert.match(dd.m.env.rt.epicDb.orfen.why, /перелёт в логово Sea of Spores запрещён до/);
});

test('2: ворота баффов эпика (набор за FA и «Повний баф» за Coin of Luck) закрыты, пока дорога — запрещённое логово', async () => {
  const E0 = { step: 'prep', k: 'orfen', id: ID, name: 'Орфен', at: Date.now(), t: Date.now(), route: 'zone' };
  const { m } = prepBench({ actionBan: ban(), epic: E0 }, '/town-buffer.html');
  assert.equal(m.E.epicFaOk(), false, 'набор за FA не берётся');
  assert.equal(m.E.epicBuffCol(), false, '«Повний баф» за Coin of Luck не берётся');
  assert.match(m.E.epicBuffWhy(Date.now(), true), /перелёт в логово запрещён до \d\d:\d\d/);
  assert.equal(await m.E.epicBuffPay('mage'), false); assert.equal(m.env.rt.epicTpBudget.length, 0, 'резерва Coin of Luck нет');
  // без запрета — те же ворота открыты (проверка стенда), «он здесь» — открыты и при запрете
  assert.equal(prepBench({ epic: E0 }, '/town-buffer.html').m.E.epicFaOk(), true);
  assert.equal(prepBench({ actionBan: ban(), epic: { ...E0, route: 'here' } }, '/town-buffer.html').m.E.epicFaOk(), true);
});
