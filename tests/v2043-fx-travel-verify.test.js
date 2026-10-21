'use strict';
// 20.43 (автономность, доводка 21.10; ревью сверки перелёта): четыре оставшихся замечания к travelVerify (modules/navigation.js).
// 1) вывод «перелёт состоялся / оплата прошла» без совпадения id зоны снимал квитанцию, не записав прибытия, — цель ресурса (farmStep),
//    рецепт и автофарм покупали тот же телепорт ещё раз: теперь прибытие записано (rt.zone = цель), повторного клика нет;
// 2) ревизия выросла другим действием — раньше всегда 30 мин простоя и пауза: адена та же и герой там же (две сверки ≥ 30 с) —
//    «не прошёл»; адены убыло хотя бы на цену — «оплата прошла»; бесплатный переход и неоднозначные случаи — ждём, как раньше;
// 3) статус ожидания и итога сверки — одна форма: строка «бот» в журнал только при смене смысла, а не 2 на каждую сверку;
// 4) метка gaveUp («была пауза — Старт игрока закроет квитанцию») — только после настоящей паузы и с номером Старта rt.dailyStart:
//    перезагрузка во время ожидания сервера, pauseBot без паузы и правки меню (manualKickAt) квитанцию «по решению игрока» не закрывают.
// Все проверки поведенческие (настоящие navigation.js/payments.js/actions.js в vm) и падают на коде до этой правки (748541f).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.join(__dirname, '..'), read = n => fs.readFileSync(path.join(root, n), 'utf8'), clone = x => JSON.parse(JSON.stringify(x));
const NAV = read('modules/navigation.js'), PAY = read('modules/payments.js'), ACT = read('modules/actions.js'), CORE = read('content.js');
const S = 1000, MIN = 60 * S, RELOAD = new Error('страница перезагружена (serverWait → location.reload)');

// Условие farmStep ядра «уже на точке ресурса или перелёт был < 3 мин назад — не лететь» — из настоящего content.js
const farmGuardSrc = (CORE.slice(CORE.indexOf('async function farmStep('), CORE.indexOf('async function farmStep(') + 4000)
  .match(/if \((rt\.zone === p\.tp \|\| Date\.now\(\) - \(rt\.zoneGoT \|\| 0\) < 180000)\) return false;/) || [])[1];
// setStatus ядра: строка «бот» в журнал — при смене формы статуса (цифры → #); та же формула для подсчёта строк
const SHAPE_RE = /[\d.,]+/g;

// outcome (ответ сервера на клик телепорта): lost502 — ничего не изменилось; grew502 — ревизия выросла другим действием, адена и место те же;
// grewSpent502 — ревизия выросла, адены убыло меньше цены, место то же (неоднозначно); grewPaid502 — ревизия выросла, адены −цена, место то же;
// moved502 — сервер применил телепорт в зону с другим id (cruma_alt), адены −цена; ok — ответ 200 с героем в цели
function fixture(o = {}) {
  const clock = { t: 1800000000000 };
  class FakeDate extends Date { constructor(...a) { super(...(a.length ? a : [clock.t])); } static now() { return clock.t; } }
  const forum = !!o.forum, target = forum ? 'heine' : 'cruma_marshlands', cost = o.cost ?? 50000;
  let href = forum ? '/forum-farm-resources.html' : '/teleport.html', clicks = 0, gets = 0, disk = null, shape = '', last = null;
  const loc = { get href() { return href; }, set href(v) { href = v; }, get pathname() { return href.split('?')[0]; }, get search() { return href.includes('?') ? '?' + href.split('?')[1] : ''; } };
  const srv = { id: 'hero-1', name: 'Hero', revision: 100, adena: 1000000, currentZoneId: 'giran_field', cityId: 'l2dop_giran', inBattle: false, activeDungeonId: null };
  const row = { textContent: `${cost} аден`, querySelector: s => s.includes('currency') ? { textContent: 'аден', querySelectorAll: () => [] } : s.includes('price-num') ? { textContent: String(cost) } : null };
  const btn = { closest: () => row, dataset: { baseAdenaCost: String(cost), adenaCost: String(cost) }, textContent: `Телепорт ${cost} Adena` };
  const records = [], pauses = [], statuses = [], botLines = [], session = new Map();
  const F = { pauseMode: 'pause' };
  const env = {
    on: true, tabOwner: true, cfg: { shopReserve: 200000 },
    rt: { char: 'Hero', manualKickAt: 5, dailyStart: 3, zoneGo: forum ? { id: target, url: '/forum-farm-resources.html', forum: true, t: clock.t - 1000 } : { id: target, t: clock.t - 1000 },
      zoneCat: { [target]: { name: forum ? 'Heine' : 'Cruma' } } },
    rec: (...a) => records.push(a.join(' | ')), heroLvl: () => 40, shown: () => true, isFarmPage: () => forum, $q: () => btn,
    // как content.setStatus: строка «бот» в журнал при новой форме статуса
    setStatus(s) { statuses.push(s); const sh = String(s).replace(SHAPE_RE, '#'); if (s !== last && sh !== shape) { shape = sh; botLines.push(s); } last = s; },
    sleep: async () => {}, waitX: async f => f(), rnd: a => o.gap ?? a,
    setRt: async p => { Object.assign(env.rt, p); disk = clone(env.rt); return { ok: true }; },
    // pauseMode: pause — фон записал паузу (on=false); serverDown — сервер лежит, pauseBot ждал его и вернулся без паузы;
    // reload — ожидание сервера кончилось перезагрузкой вкладки (код после pauseBot не выполняется); функция — своё поведение
    pauseBot: async (why, opt) => {
      pauses.push({ why, opt }); const m = F.pauseMode;
      if (typeof m === 'function') return m(F);
      if (m === 'reload') throw RELOAD;
      if (m === 'pause') env.on = false;
    },
    gameGet: async () => { gets++; o.onGet?.(F, gets); if (o.getFail?.(gets)) return { ok: false, json: async () => ({}) }; return { ok: true, json: async () => ({ character: { ...srv } }) }; },
    fire: () => {
      clicks++;
      const g = env.rt.travelCheck, p = g.nativeTp || g.forumTp, out = o.outcome || 'ok';
      const apply = (zone = target) => { srv.revision++; srv.adena -= cost; if (forum && zone === target) { srv.cityId = 'l2dop_heine'; srv.currentZoneId = null; } else srv.currentZoneId = zone; };
      let status = 200, res = null;
      if (out === 'ok') { apply(); res = { character: { ...srv } }; }
      else {
        status = 502;
        if (out === 'grew502') srv.revision++;
        if (out === 'grewSpent502') { srv.revision++; srv.adena -= 10000; }
        if (out === 'grewPaid502') { srv.revision++; srv.adena -= cost; }
        if (out === 'moved502') apply('cruma_alt');
      }
      const req = { teleportId: target, expectedRevision: p.revision, expectedAdenaCost: p.cost };
      N.onForumTeleportNet(forum ? '/game/farm-guide/resource-teleport' : '/game/teleport', { method: 'POST', status, nativeNonce: forum ? '' : p.nonce, req, res });
      if (out === 'ok' || out === 'moved502') href = '/map.html';
    },
  };
  function load() {
    const box = { console, URL, URLSearchParams, Date: FakeDate, location: loc, document: { querySelectorAll: () => [{}], body: { innerText: '' } },
      sessionStorage: { getItem: k => session.get(k) ?? null, setItem: (k, v) => session.set(k, String(v)), removeItem: k => session.delete(k) } };
    vm.runInNewContext(PAY, box); vm.runInNewContext(NAV, box); vm.runInNewContext(ACT, box); return box;
  }
  let box = load(), N = box.L2V7Factories.navigation(env);
  Object.assign(F, {
    env, srv, clock, records, pauses, statuses, botLines, loc, target, cost, FakeDate,
    step: () => N.zoneGoStep().catch(e => { if (e !== RELOAD) throw e; }), advance: ms => { clock.t += ms; },
    clicks: () => clicks, gets: () => gets, disk: () => disk, N: () => N, box: () => box,
    // перезагрузка вкладки: память — из хранилища, новый экземпляр модулей, статус-форма ядра сброшена
    reload() { env.rt = clone(disk); env.on = true; session.clear(); shape = ''; last = null; box = load(); N = box.L2V7Factories.navigation(env); },
    log: re => records.some(r => re.test(r)),
    tc: () => env.rt.travelCheck,
    // farmStep ядра через 3+ мин: на точке ресурса не стоим — новый маршрут к той же цели (как content.farmStep), затем шаги маршрута
    async farmAgain() {
      const guard = new Function('rt', 'p', 'Date', 'return (' + farmGuardSrc + ')');
      if (guard(env.rt, { tp: target }, FakeDate)) return false;
      await env.setRt({ zoneGo: forum ? { id: target, url: '/forum-farm-resources.html', forum: true, res: 'Ресурс', task: 'resources', t: clock.t, why: 'фарм' } : { id: target, t: clock.t, why: 'фарм' }, zoneGoT: 0 });
      for (let i = 0; i < 4 && (env.rt.zoneGo || env.rt.travelCheck); i++) await F.step();
      return true;
    },
  });
  return F;
}
const closed = f => { assert.equal(f.env.rt.travelCheck ?? null, null, 'квитанция закрыта'); assert.equal(f.env.rt.zoneGo ?? null, null, 'маршрут снят'); };
const until30 = async f => { const n = f.pauses.length; let t = 0; while (f.pauses.length === n && t < 40 * MIN) { f.advance(30 * S); t += 30 * S; await f.step(); } return t; };   // до следующего вызова pauseBot
const payments = f => f.box().L2V7Factories.payments({ get rt() { return f.env.rt; }, setRt: f.env.setRt, rtCommit: async () => true, on: true, tabOwner: true, rec() {},
  autonomyMode: () => 'farm', lease: () => 'l1', paymentContext: () => 'ctx', canRun: () => true, externalPending: () => f.N().travelPending() });
const SPEC = { key: 'shop:x', kind: 'shop', quote: { amount: 100, currency: 'Adena' } };

test('условие farmStep ядра найдено в content.js (на нём построены проверки повторной покупки)', () => {
  assert.ok(farmGuardSrc, 'farmStep: rt.zone === p.tp || Date.now() - (rt.zoneGoT || 0) < 180000');
  assert.ok(CORE.includes("const shape = String(s).replace(/[\\d.,]+/g, '#');") && CORE.includes('if (s !== rt.status && shape !== statusShape) { statusShape = shape; recBot(s);'), 'форма статуса в setStatus ядра');
});

// ===== 1) «оплата прошла» записывает прибытие — тот же телепорт не покупается снова =====
for (const forum of [false, true]) test(`${forum ? 'форум' : 'обычный'}: перелёт состоялся в зону с другим id — прибытие записано (rt.zone = цель), через 4 мин цель ресурса не покупает тот же телепорт снова`, async () => {
  const f = fixture({ forum, outcome: 'moved502' }); await f.step();
  closed(f); assert.equal(f.clicks(), 1); assert.equal(f.pauses.length, 0);
  assert.equal(f.env.rt.zone, f.target, 'прибытие записано'); assert.equal(f.env.rt.zonePend ?? null, null);
  assert.ok(f.log(/перелёт состоялся, оплату считаю прошедшей; прибытие в «.+» записано \(зону уточнит карта\), повтора нет/));
  f.advance(4 * MIN);
  assert.equal(await f.farmAgain(), false, 'farmStep: уже на точке — не лечу'); assert.equal(f.clicks(), 1, 'второй оплаты того же телепорта нет');
});
test('обычный: вывод «оплата прошла» по адене (место прежнее) — тоже прибытие, повторной покупки нет', async () => {
  const f = fixture({ outcome: 'grewPaid502' }); await f.step();
  closed(f); assert.equal(f.env.rt.zone, f.target); assert.equal(f.pauses.length, 0); assert.equal(f.clicks(), 1);
  assert.ok(f.log(/адены убыло на цену телепорта \(до клика 1000000, сейчас 950000, цена 50000; другие оплаты всё это время запрещены\) — оплату считаю прошедшей/));
  f.advance(4 * MIN); assert.equal(await f.farmAgain(), false); assert.equal(f.clicks(), 1);
  assert.equal(f.env.rt.zoneBad, undefined, 'зона, куда заплатили, не «плохая»');
});

// ===== 2) ветка «ревизия выросла»: исход доказуем по адене и месту =====
for (const forum of [false, true]) test(`${forum ? 'форум' : 'обычный'}: ревизия выросла другим действием, адена та же, герой там же — «не прошёл» двумя сверками ≥ 30 с (≈1 мин, а не 30 мин и пауза)`, async () => {
  const f = fixture({ forum, outcome: 'grew502' }); await f.step();
  assert.ok(f.tc(), 'сразу после клика — не вывод'); assert.equal(f.tc().check.stay ?? 0, 0, 'сверка в первые 30 с после клика не идёт в счёт');
  f.advance(30 * S); await f.step(); assert.ok(f.tc(), 'одной сверки мало'); assert.equal(f.tc().check.stay, 1);
  f.advance(30 * S); await f.step();
  closed(f); assert.equal(f.clicks(), 1); assert.equal(f.pauses.length, 0); assert.equal(f.env.on, true);
  assert.equal(f.env.rt.zoneBad, undefined, '«не прошёл» — не «плохая» зона'); assert.equal(f.N().travelPending(), false);
  assert.ok(f.log(/телепорт не прошёл — ревизия героя выросла \(100 → 101\) другим действием, а адена та же и герой там же \(giran_field\) в двух сверках с промежутком 30 с; прежний запрос с той ревизией уже не применится — оплаты не было/));
  assert.ok(await payments(f).prepare(SPEC), 'платное снова можно');
});
test('«следов перелёта нет» требует двух сверок подряд: бой (TvT) между ними сбрасывает счёт; уход героя в другое место без расхода — не вывод', async () => {
  const f = fixture({ outcome: 'grew502', onGet: (F, n) => { F.srv.inBattle = n === 4; } }); await f.step();
  f.advance(30 * S); await f.step(); assert.equal(f.tc().check.stay, 1);
  f.advance(30 * S); await f.step(); assert.ok(f.tc(), 'герой в бою — сверка не в счёт'); assert.equal(f.tc().check.stay, 0);
  f.advance(30 * S); await f.step(); assert.ok(f.tc()); assert.equal(f.tc().check.stay, 1);
  f.advance(30 * S); await f.step(); closed(f); assert.equal(f.clicks(), 1);
  const g = fixture({ outcome: 'grew502', onGet: (F, n) => { if (n >= 4) F.srv.currentZoneId = 'dion_field'; } }); await g.step();
  for (let i = 0; i < 4; i++) { g.advance(30 * S); await g.step(); }
  assert.ok(g.tc()?.nativeTp, 'место изменилось, адена та же — не «не прошёл» и не «оплата прошла»'); assert.equal(g.pauses.length, 0);
});
test('мировая зона (id места не меняются) + победа в TvT (+500 000 аден) во время сверки: списанная плата не выглядит «не прошёл» — ждём, второго клика нет', async () => {
  // сервер применил телепорт (ревизия +1, −50 000), но currentZoneId/cityId те же; затем TvT: ревизия +1, +500 000 аден
  const f = fixture({ outcome: 'grewPaid502', onGet: (F, n) => { if (n === 2) { F.srv.revision++; F.srv.adena += 500000; } } }); await f.step();
  for (let i = 0; i < 6; i++) { f.advance(30 * S); await f.step(); }
  assert.ok(f.tc()?.nativeTp, 'не «не прошёл» и не повтор'); assert.ok(!f.log(/телепорт не прошёл/)); assert.equal(f.clicks(), 1); assert.ok(f.N().travelPending());
  assert.ok(f.srv.adena > 1000000, 'адены больше, чем до клика');
});
test('неоднозначно — ждём, как раньше: бесплатный переход (адена не доказательство) и расход меньше цены; ни вывода, ни повторного клика', async () => {
  for (const o of [{ outcome: 'grew502', cost: 0 }, { outcome: 'grewSpent502' }]) {
    const f = fixture(o); await f.step();
    for (let i = 0; i < 10; i++) { f.advance(30 * S); await f.step(); }
    assert.ok(f.tc(), JSON.stringify(o)); assert.equal(f.pauses.length, 0); assert.equal(f.clicks(), 1); assert.ok(f.N().travelPending());
  }
});
test('Старт игрока после паузы и «следов перелёта нет» — одна сверка: «не прошёл» (сверка после Старта)', async () => {
  const f = fixture({ outcome: 'grewSpent502' }); await f.step(); await until30(f);
  assert.equal(f.pauses.length, 1); assert.equal(f.env.on, false);
  f.srv.adena += 10000;                                   // адены снова не меньше, чем до клика (возврат/доход), место то же
  f.reload(); f.env.rt.manualKickAt = 50; f.env.rt.dailyStart++; await f.step();
  closed(f); assert.ok(f.log(/телепорт не прошёл — ревизия героя выросла \(100 → 101\).+\(сверка после Старта игрока\)/)); assert.ok(!f.log(/по решению игрока/));
});

// ===== 3) одна форма статуса — одна строка журнала на смену смысла, а не 2 на каждую сверку =====
test('статус сверки: ожидание и итог одной формы — 502 до вывода «не прошёл» даёт 2 строки «бот» (было 4)', async () => {
  const f = fixture({ outcome: 'lost502' }); await f.step();
  for (let i = 0; i < 70 && f.tc(); i++) { f.advance(1 * S); await f.step(); }
  closed(f);
  assert.deepEqual(f.botLines, ['Телепорт в Cruma: исход не подтверждён — сверка 1, следующая через 30 с; платное не трачу',
    'Телепорт в Cruma: исход не подтверждён — сверка 2 (без изменений), следующая через 30 с; платное не трачу']);
  assert.ok(f.statuses.length > 50, 'статус обновлялся каждую секунду ожидания');
});
test('статус сверки: 30 мин без вывода — одна строка «бот» на всё окно (было ≈2 на каждую сверку)', async () => {
  const f = fixture({ outcome: 'grewSpent502' }); await f.step();
  let t = 0; while (f.pauses.length === 0 && t < 40 * MIN) { f.advance(5 * S); t += 5 * S; await f.step(); }
  assert.equal(f.pauses.length, 1); assert.ok(f.tc().check.n >= 55, 'сверок ≈60: ' + f.tc().check.n);
  assert.equal(f.botLines.length, 1, f.botLines.slice(0, 4).join(' / '));
  assert.match(f.botLines[0], /^Телепорт в Cruma: исход не подтверждён — сверка 1, следующая через 30 с; платное не трачу$/);
});

// ===== 4) метка gaveUp — только после настоящей паузы; закрывает квитанцию только Старт игрока (rt.dailyStart) =====
test('сервер лежит на 30-й минуте и вкладка перезагрузилась в ожидании сервера: метки нет, правка меню квитанцию не закрывает; потом пауза и Старт', async () => {
  const f = fixture({ outcome: 'grewSpent502' }); await f.step();
  f.pauseMode = 'reload'; await until30(f);
  assert.equal(f.pauses.length, 1); const mark = f.disk().travelCheck.check.gaveUp;
  f.reload(); f.pauseMode = 'pause';
  f.env.rt.manualKickAt = 999; f.advance(30 * S); await f.step();     // правка меню (задача/лимит/режим): manualKickAt без Старта
  assert.ok(!f.log(/по решению игрока/), 'ложного «решения игрока» нет'); assert.ok(f.tc()?.nativeTp, 'квитанция открыта');
  assert.ok(f.N().travelPending(), 'платное по-прежнему запрещено'); assert.equal(f.env.on, true); assert.equal(await payments(f).prepare(SPEC), null);
  assert.equal(mark, undefined, 'паузы не было — метки нет');
  assert.equal(f.tc().check.kick, 999); assert.equal(f.tc().check.ackStart, undefined, 'новое окно сверки, не закрытие');
  // новое окно 30 мин — настоящая пауза (сервер жив): метка с номером Старта; Старт игрока закрывает квитанцию одной сверкой
  await until30(f); assert.equal(f.pauses.length, 2); assert.equal(f.env.on, false);
  assert.ok(f.disk().travelCheck.check.gaveUp); assert.equal(f.disk().travelCheck.check.gaveUpStart, 3);
  f.reload(); f.env.rt.manualKickAt = 1500; f.env.rt.dailyStart = 4; f.advance(1 * MIN); await f.step();
  closed(f); assert.ok(f.log(/квитанцию закрываю по решению игрока/)); assert.equal(f.clicks(), 1);
});
test('pauseBot ждал сервер, а игрок тем временем правил меню (manualKickAt): паузы не было — квитанция не закрыта «по решению игрока»', async () => {
  const f = fixture({ outcome: 'grewSpent502' }); await f.step();
  f.pauseMode = F => { F.env.rt.manualKickAt = 777; };            // ожидание сервера, бот включён; меню подняло manualKickAt
  await until30(f); assert.equal(f.pauses.length, 1); assert.equal(f.env.on, true); const mark = f.disk().travelCheck.check.gaveUp;
  f.advance(30 * S); await f.step();
  assert.ok(!f.log(/по решению игрока/), 'ложного «решения игрока» нет'); assert.ok(f.tc()?.nativeTp, 'квитанция открыта'); assert.ok(f.N().travelPending());
  assert.equal(mark, undefined, 'метки паузы нет');
});
test('настоящая пауза: правка меню на паузе и включение без Старта (тот же rt.dailyStart) не закрывают; Старт игрока (+1 к rt.dailyStart) — закрывает', async () => {
  // бот снова включён, но не Стартом (пауза не удержалась): rt.dailyStart прежний — это не решение игрока
  const g = fixture({ outcome: 'grewSpent502' }); await g.step(); await until30(g);
  g.reload(); g.env.rt.manualKickAt = 601; g.advance(30 * S); await g.step();
  assert.ok(!g.log(/по решению игрока/), 'ложного «решения игрока» нет'); assert.ok(g.tc()?.nativeTp, 'квитанция открыта'); assert.equal(g.tc().check.ackStart, undefined);
  const f = fixture({ outcome: 'grewSpent502' }); await f.step(); await until30(f);
  assert.equal(f.pauses.length, 1); assert.equal(f.env.on, false);
  const mark = f.disk().travelCheck.check; assert.ok(mark.gaveUp >= f.clock.t - 1000); assert.equal(mark.gaveUpStart, 3, 'метка помнит номер Старта');
  const gets = f.gets();
  f.env.rt.manualKickAt = 600; f.advance(10 * S); await f.step();     // правка меню на паузе: бот выключен, сверки нет
  assert.equal(f.gets(), gets, 'на паузе GET нет'); assert.ok(f.tc()?.check?.gaveUp, 'на паузе ничего не меняется');
  // Старт игрока: новый manualKickAt и +1 к rt.dailyStart
  f.reload(); f.env.rt.manualKickAt = 700; f.env.rt.dailyStart = 4; f.advance(30 * S); await f.step();
  closed(f); assert.ok(f.log(/после паузы «Проверьте положение героя» игрок нажал Старт.+квитанцию закрываю по решению игрока/)); assert.equal(f.N().travelPending(), false);
});
test('метка паузы прежнего вида (gaveUp без номера Старта) — не решение игрока: даже Старт начинает новое окно сверки', async () => {
  const f = fixture({ outcome: 'grewSpent502' }); await f.step(); await until30(f);
  const legacy = clone(f.disk().travelCheck); delete legacy.check.gaveUpStart; await f.env.setRt({ travelCheck: legacy });
  f.reload(); f.env.rt.manualKickAt = 800; f.env.rt.dailyStart = 9; f.advance(30 * S); await f.step();
  assert.ok(f.tc()?.nativeTp, 'квитанция открыта'); assert.ok(!f.log(/по решению игрока/)); assert.equal(f.tc().check.ackStart, undefined); assert.equal(f.clicks(), 1);
});
test('фон не подтвердил паузу и сменился запуск: pauseBot выключил вкладку, но manualKickAt другой — метки нет', async () => {
  const f = fixture({ outcome: 'grewSpent502' }); await f.step();
  f.pauseMode = F => { F.env.on = false; F.env.rt.manualKickAt = 321; };   // automationStop: on=false сразу, фон ответил character_changed
  await until30(f); assert.equal(f.pauses.length, 1); const mark = f.disk().travelCheck.check.gaveUp;
  f.env.on = true; f.advance(30 * S); await f.step();                 // пауза в хранилище не записана — вкладка снова работает
  assert.ok(!f.log(/по решению игрока/), 'ложного «решения игрока» нет'); assert.ok(f.tc()?.nativeTp, 'квитанция открыта');
  assert.equal(mark, undefined, 'метки нет');
});
