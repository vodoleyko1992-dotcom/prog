'use strict';
// 20.43 (автономность, доводка 21.10, замечание R1): отсрочка «карта не загрузилась» держалась 30 мин даже после того, как карта на той же
// оплаченной точке снова загрузилась и показывает цель. Тур выбирал другого РБ и платил за перелёт (а через 30 мин — ещё раз за возврат),
// эпик ждал до следующего появления (второй платный заход в это появление запрещён), а режим платил Coin of Luck за следующего эпика.
// Теперь цель, отложенная из-за карты и видимая на текущей карте, снимается с отсрочки и берётся без телепорта; платный путь по-прежнему
// ждёт бесплатной проверки карты (content.mapGate). Настоящие raid.rbHuntStep / epics.epicStep и настоящий content.mapGate.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const E = require('../engine-core.js');
const { mk, docOf, base, clone, H, MIN } = require('./epic-harness.cjs');
const content = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
const slice = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, a); return s.slice(i, j); };
const HOLD_SRC = slice(content, 'const SELF_HOLD_STEPS =', '// ---------- переходы');

// ---------- тур РБ: стенд v1021-raid-farm-lifecycle (РБ «Первый» 80 и «Второй» 81) + настоящий content.mapGate ----------
const lifecycle = path.join(__dirname, 'v1021-raid-farm-lifecycle.test.js'), lsrc = fs.readFileSync(lifecycle, 'utf8');
const lbox = { require: require('node:module').createRequire(lifecycle), __dirname, console, process };
vm.runInNewContext(lsrc.slice(0, lsrc.indexOf('\ntest(')) + '\nthis.fixture=fixture;this.page=page;this.pin=pin;this.docOf=docOf;', lbox);
function wireGate(m) {
  const holds = [], g = { L2EngineCore: E, Date, String, Number, Math, Object, Array, JSON, console, Promise, URL, location: m.loc, on: true, tabOwner: true,
    automationGeneration: 0, leaseEpoch: 'e1', antibotState: () => null, cfg: {}, setRt: async p => { await m.env.setRt(p); return { ok: true }; }, rtCommit: async () => true,
    rec: (...a) => m.logs.push(a.slice(1).join(' ')), setStatus() {}, sleep: async () => {}, isMap: () => m.env.isMap(), mapReady: (...a) => m.env.mapReady(...a), autonomyMode: () => 'raid' };
  Object.defineProperty(g, 'rt', { get: () => m.env.rt, set() {} });
  vm.createContext(g); vm.runInContext(HOLD_SRC + ';this.gate=mapGate;', g);
  g.selfHoldStart = async (kind, why, opt) => { holds.push({ kind, why, opt }); return 'hold'; };
  m.env.mapGate = (...a) => g.gate(...a);
  const nav = () => { if (m.loc.href) { const u = new URL(m.loc.href, 'https://fixture.invalid'); m.loc.pathname = u.pathname; m.loc.search = u.search; m.loc.href = ''; } };
  return { holds, nav };
}
// прилёт к «Первому» оплачен; карта не грузится (3 обновления уже были) → отсрочка 30 мин и метка «карта не подтверждена»
async function mapFailedAtFirst() {
  const m = lbox.fixture({ rt: { rbHunt: { step: 'arrive', phase: 'arrive', id: 'one', name: 'Первый', lvl: 80, page: 1, at: Date.now(), t: 1, mapLoadT: Date.now() - 5 * MIN, mapLoadReloads: 3 } } });
  const w = wireGate(m);
  m.env.selfHold = async (kind, why, opt) => (opt?.noWait ? 'defer' : 'hold');
  m.env.mapReady = async () => false;
  await m.R.rbHuntStep();
  assert.equal(m.env.rt.rbSkip.one.why, 'карта не загрузилась'); assert.ok(m.env.rt.rbSkip.one.until > Date.now() + 25 * MIN);
  assert.ok(m.env.rt.mapBad?.at > 0); assert.equal(m.env.rt.rbHunt.step, 'pick'); assert.ok(m.env.rt.rbGoTried?.one > 0, 'неудачная попытка записана');
  return { m, ...w };
}
// платный телепорт тура — только кнопка «Телепорт» списка РБ (бой открывается кликом по метке на карте)
const paidFires = m => m.fires.filter(el => /l2-rb-row__tp/.test(el?.className || '')).length;

test('тур РБ: карта на оплаченной точке снова загрузилась и показывает «Первого» — отсрочка снята, бой с ним без нового телепорта', async () => {
  const { m, nav } = await mapFailedAtFirst();
  for (let i = 0; i < 3; i++) { await m.R.rbHuntStep(); nav(); }                 // карта ещё сломана: проверка без телепорта
  assert.equal(m.fires.length, 0); assert.ok(m.env.rt.rbSkip.one, 'пока карта пустая — отсрочка держится');
  // карта ожила на той же точке: метка «Первого» снова на карте
  m.env.mapReady = async () => true; m.setDoc(lbox.docOf(lbox.pin('one', 'Первый')));
  for (let i = 0; i < 10 && !['fight', 'go'].includes(m.env.rt.rbHunt.step); i++) { await m.R.rbHuntStep(); nav(); }
  assert.equal(m.env.rt.rbHunt.step, 'fight', 'платный перелёт к «Второму» не начат (раньше — сразу)'); assert.equal(m.env.rt.rbHunt.id, 'one', 'бой с «Первым» здесь');
  assert.equal(paidFires(m), 0, 'ни одного платного телепорта'); assert.equal(m.env.rt.rbGoCnt?.one, undefined); assert.equal(m.env.rt.rbGoCnt?.two, undefined);
  assert.equal(m.env.rt.rbSkip.one, undefined); assert.equal(m.env.rt.rbGoTried?.one, undefined); assert.equal(m.env.rt.mapBad, null);
  assert.match(m.logs.join('\n'), /Первый: карта снова загружается и показывает его здесь — отсрочку «карта не загрузилась» снимаю, беру без телепорта/);
  assert.match(m.logs.join('\n'), /цель: Первый \(80\) — он здесь, на этой карте: без телепорта/);
});

test('тур РБ: карта ожила, а «Первого» на ней нет — отсрочка остаётся, один платный перелёт к следующему (как раньше)', async () => {
  const { m, nav } = await mapFailedAtFirst();
  m.env.mapReady = async () => true;                                               // карта пустая — другая точка или РБ ушёл
  for (let i = 0; i < 8 && m.env.rt.rbHunt.step !== 'go'; i++) { await m.R.rbHuntStep(); nav(); }
  assert.equal(m.env.rt.rbHunt.step, 'go'); assert.equal(m.env.rt.rbHunt.id, 'two'); assert.ok(m.env.rt.rbSkip.one.until > Date.now());
  assert.ok(!m.logs.some(l => /отсрочку «карта не загрузилась» снимаю/.test(l)));
});

test('тур РБ: другие отсрочки (цикл маршрута) и чужие РБ на карте карта не снимает', async () => {
  const m = lbox.fixture({ rt: { rbSkip: { one: { t: Date.now(), until: Date.now() + 60 * MIN, why: 'цикл маршрута тура' }, two: { t: Date.now(), until: Date.now() + 30 * MIN, why: 'карта не загрузилась' } } } });
  m.setDoc(lbox.docOf(lbox.pin('one', 'Первый')));
  await m.R.rbHuntStep();
  assert.equal(m.env.rt.rbSkip.one.why, 'цикл маршрута тура'); assert.equal(m.env.rt.rbSkip.two.why, 'карта не загрузилась', '«Второго» на карте нет');
  assert.notEqual(m.env.rt.rbHunt.id, 'one');
});

// ---------- эпики: стенд epic-harness (Орфен) ----------
const pin = '<div><button class="l2-map-mob-pin l2-map-mob-pin--epic" data-spawn-id="l2dop_rb_29014" title="Орфен · ур. 50 · епік-бос"></button></div>';
const okDb = (x = {}) => ({ orfen: { id: 'l2dop_rb_29014', col: 1, adena: 0, apiT: Date.now(), alive: true, canAttack: true, lvl: 50, respH: 12, lifeT: Date.now() - 3600000, ...x } });
const okStats = () => ({ ...clone(base.rbStats), l2dop_rb_29014: { hp: 400000, patk: 1100, matk: 700, mdef: 800, pdef: 700, src: 'api' } });
function epicMapFailed(via, db = {}) {
  const at = Date.now() - 400000, id = 'l2dop_rb_29014';
  const m = mk({ cfg: { epicCoinDailyMax: 1, epicList: 'orfen,core' }, net: () => null,
    rt: { epicDb: okDb({ paidN: via === 'page' ? 1 : 0, ...db }), rbStats: okStats(), epicTpBudget: via === 'page' ? [{ t: at, k: 'orfen', cost: 1, unit: 'Coin of Luck' }] : [],
      epic: { step: 'arrive', k: 'orfen', id, name: 'Орфен', via, ...(via === 'zone' ? { lair: 'Sea of Spores' } : { tpT: at, tpRes: at }), at, mapLoadT: Date.now() - 5 * MIN, mapLoadReloads: 3 } },
    env: { mapReady: async () => false, selfHold: async (k, w, o) => (o?.noWait ? 'defer' : 'hold') } });
  const engaged = []; m.env.rbEngage = async r => { engaged.push(r.id); return true; };
  return { m, engaged, id };
}

test('эпик: после платного телепорта со страницы карта не загрузилась → ждёт следующего появления; карта снова показывает его — отсрочка снята, бой без новой траты Coin of Luck', async () => {
  const { m, engaged, id } = epicMapFailed('page');
  await m.E.epicStep();
  const d = m.env.rt.epicDb.orfen;
  assert.ok(d.skipT > Date.now() + 2 * H, 'до следующего появления, а не 30 мин'); assert.match(d.why, /после платного телепорта карта не загрузилась после 3 обновлений/);
  assert.equal(d.mapFail.via, 'page'); assert.equal(m.env.rt.epic.step, 'pick'); assert.ok(m.env.rt.mapBad?.at > 0);
  await m.E.epicStep(); assert.equal(engaged.length, 0); assert.ok(m.env.rt.epicDb.orfen.skipT > Date.now(), 'карта пустая — отсрочка держится');
  // карта ожила, метка Орфена здесь
  m.env.mapReady = async () => true; m.setDoc(docOf(pin));
  for (let i = 0; i < 8 && !engaged.length; i++) await m.E.epicStep();
  assert.deepEqual(engaged, [id], 'бой с Орфеном здесь'); assert.equal(m.fires.length, 0);
  assert.equal(m.env.rt.epicTpBudget.length, 1, 'новой траты Coin of Luck нет'); assert.equal(m.env.rt.epicDb.orfen.paidN, 1);
  assert.equal(m.env.rt.epicDb.orfen.skipT, 0); assert.equal(m.env.rt.epicDb.orfen.mapFail, null); assert.equal(m.env.rt.epic.route, 'here');
  assert.ok(m.logs.some(l => /Орфен: карта снова загружается и показывает его здесь — отсрочку «карта не загрузилась» снимаю, бой без телепорта/.test(l)), m.logs.join('\n'));
});

test('эпик: логово, карта не загрузилась — промах логова учтён; карта показывает его здесь — промах и пауза логова откатываются, бой без телепорта', async () => {
  const { m, engaged, id } = epicMapFailed('zone', { lairOkT: Date.now() - H, lairMiss: 0, lairBadT: 0, seenZone: 'Sea of Spores' });
  await m.E.epicStep();
  let d = m.env.rt.epicDb.orfen;
  assert.equal(d.lairMiss, 1, 'промах логова учтён (раньше — нет, и логово за адену повторялось каждые 30 мин)'); assert.match(d.why, /логово: карта не загрузилась после 3 обновлений/);
  assert.equal(d.mapFail.via, 'zone'); assert.equal(d.mapFail.lairMiss, 0);
  m.env.mapReady = async () => true; m.setDoc(docOf(pin));
  for (let i = 0; i < 8 && !engaged.length; i++) await m.E.epicStep();
  d = m.env.rt.epicDb.orfen;
  assert.deepEqual(engaged, [id]); assert.equal(m.fires.length, 0); assert.equal(d.lairMiss, 0); assert.equal(d.lairBadT, 0); assert.equal(d.skipT, 0);
  assert.equal(m.env.rt.zoneGo, undefined, 'в логово снова не летим');
});

test('эпик: подготовка к другому эпику — отложенный из-за карты Орфен нашёлся здесь, сначала он; начатый заход (после смерти) не бросаем', async () => {
  for (const started of [false, true]) {
    const m = mk({ cfg: { epicList: 'orfen,core' }, doc: docOf(pin),
      rt: { epicDb: okDb({ skipT: Date.now() + 10 * H, why: 'после платного телепорта карта не загрузилась после 3 обновлений — жду следующего появления', mapFail: { t: Date.now() - MIN, via: 'page', lairMiss: 0, lairBadT: 0 } }),
        rbStats: okStats(), epic: { step: 'prep', k: 'core', name: 'Core', deaths: started ? 1 : 0, noPay: started, at: Date.now(), t: Date.now() } } });
    let shop = 0; m.env.rbShopFirst = async () => { shop++; return false; };
    await m.E.epicStep();
    assert.equal(m.env.rt.epicDb.orfen.skipT, 0, 'отсрочка Орфена снята в обоих случаях');
    if (!started) { assert.equal(m.env.rt.epic.step, 'pick'); assert.equal(m.env.rt.epic.k, 'orfen'); assert.equal(shop, 0, 'подготовка к Core не начата'); }
    else { assert.equal(m.env.rt.epic.k, 'core'); assert.equal(m.env.rt.epic.noPay, true, 'ограничения начатого захода сохранены'); assert.equal(shop, 1); }
  }
});

test('эпик: прочие отсрочки (не карта) метка на карте не снимает', async () => {
  const m = mk({ cfg: { epicList: 'orfen' }, doc: docOf(pin), rt: { epicDb: okDb({ skipT: Date.now() + H, why: 'сервер отказал в выходе из боя', mapFail: { t: 1, via: 'page' } }), rbStats: okStats(), epic: { step: 'pick' } } });
  await m.E.epicStep(); assert.ok(m.env.rt.epicDb.orfen.skipT > Date.now()); assert.notEqual(m.env.rt.epic.step, 'prep');
});
