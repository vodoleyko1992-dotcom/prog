'use strict';
// 20.43 (автономность, разбор 21.10; docs/NIGHT-FARM-2026-10-17.md 07:25): сбой перелёта — сверка по серверу вместо паузы.
// (а) клика не было / явный отказ, подтверждённый GET, — перелёт снят без паузы (zoneBad); (б) клик был, исход неизвестен — бот включён,
// платное запрещено, бесплатный GET /character раз в 30–60 с; прибыл — forumFinish; ревизия и адена те же в двух сверках ≥ 30 с —
// «не прошёл», маршрут снят; пауза — только если 30 мин не удаётся сверить. Сверка переживает reload; Stop/смена героя во время
// сверки — ни оплаты, ни паузы.
// 20.43 (ревью au/travel): квитанция со сверкой — в отдельном rt.travelCheck (маршрут zoneGo снят той же записью до клика), поэтому
// проверки читают travelCheck; 409/401 — неизвестный исход; отказ снимает перелёт только с GET «ничего не изменилось».
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.join(__dirname, '..'), read = n => fs.readFileSync(path.join(root, n), 'utf8'), clone = x => JSON.parse(JSON.stringify(x));
const NAV = read('modules/navigation.js'), PAY = read('modules/payments.js'), ACT = read('modules/actions.js');
const S = 1000, MIN = 60 * S;

// outcome: что делает сервер на клик телепорта (POST): ok | refuse400 | biz500 | plain500 | lost502 | grew502 | moved502 | movedFree502
// 20.43 (ревью): applied409 / applied401 — сервер применил телепорт (ревизия +1, адена −цена, герой в цели) и ответил 409/401;
// refuse409 — не применил и ответил 409; refuse400grew — отказ 400, но ревизия героя выросла по другой причине
// 20.43 (доводка 21.10): grewSpent502 — 502, ревизия выросла другим действием и адены убыло меньше цены телепорта, герой на месте:
// ни «оплата прошла», ни «следов перелёта нет» — неоднозначный исход (grew502 теперь доказуем: «не прошёл» двумя сверками)
function fixture(o = {}) {
  const clock = { t: 1800000000000 };
  class FakeDate extends Date { constructor(...a) { super(...(a.length ? a : [clock.t])); } static now() { return clock.t; } }
  const forum = !!o.forum, target = forum ? 'heine' : 'cruma_marshlands', cost = 50000;
  let href = forum ? '/forum-farm-resources.html' : '/teleport.html', clicks = 0, gets = 0, writes = 0, disk = null;
  const loc = { get href() { return href; }, set href(v) { href = v; }, get pathname() { return href.split('?')[0]; }, get search() { return href.includes('?') ? '?' + href.split('?')[1] : ''; } };
  const srv = { id: 'hero-1', name: 'Hero', revision: 100, adena: 1000000, currentZoneId: 'giran_field', cityId: 'l2dop_giran', inBattle: false, activeDungeonId: null };
  const row = { textContent: '50 000 аден', querySelector: s => s.includes('currency') ? { textContent: 'аден', querySelectorAll: () => [] } : s.includes('price-num') ? { textContent: '50 000' } : null };
  const btn = { closest: () => row, dataset: { baseAdenaCost: '50000', adenaCost: '50000' }, textContent: 'Телепорт 50 000 Adena' };
  const records = [], pauses = [], session = new Map(), store = { on: true, paused: null, stopMeta: null };
  const env = {
    on: true, tabOwner: true, cfg: { shopReserve: 200000 },
    rt: { char: 'Hero', manualKickAt: 5, zoneGo: forum ? { id: target, url: '/forum-farm-resources.html', forum: true, t: clock.t - 1000 } : { id: target, t: clock.t - 1000 },
      zoneCat: { [target]: { name: forum ? 'Heine' : 'Cruma' } } },
    rec: (...a) => records.push(a.join(' | ')), setStatus() {}, heroLvl: () => 40, shown: () => true, isFarmPage: () => forum, $q: () => btn,
    sleep: async () => {}, waitX: async f => f(), rnd: (a) => o.gap ?? a,
    setRt: async p => { writes++; Object.assign(env.rt, p); disk = clone(env.rt); return { ok: true }; },
    // 20.43 (доводка 21.10, ревью сверки): пауза — как фон botControl: on=false, paused и stopMeta 'content-pause' с причиной в хранилище
    // (метку «была пауза» navigation ставит только по этой записи, а не по on=false вкладки); сервер лежит — паузы и записи нет
    pauseBot: async (why, opt) => { pauses.push({ why, opt }); if (!o.serverDown) { env.on = false; store.on = false; store.paused = { t: clock.t, why: String(why).slice(0, 160) }; store.stopMeta = { source: 'content-pause', reason: String(why).slice(0, 240), t: clock.t }; } },
    gameGet: async () => { gets++; o.onGet?.(F, gets); if (o.getFail?.(gets)) return { ok: false, json: async () => ({}) }; return { ok: true, json: async () => ({ character: { ...srv } }) }; },
    fire: () => {
      clicks++;
      const g = env.rt.travelCheck, p = g.nativeTp || g.forumTp, out = o.outcome || 'ok';
      const apply = (zone = target) => { srv.revision++; srv.adena -= cost; if (forum && zone === target) { srv.cityId = 'l2dop_heine'; srv.currentZoneId = null; } else srv.currentZoneId = zone; };
      let status = 200, res = null;
      if (out === 'ok') { apply(); res = { character: { ...srv } }; }
      else if (out === 'refuse400') { status = 400; res = { error: 'not_enough_adena' }; }
      else if (out === 'refuse400grew') { status = 400; res = { error: 'not_enough_adena' }; srv.revision++; }
      else if (out === 'biz500') { status = 500; res = { message: 'not_enough_adena' }; }
      else if (out === 'plain500') { status = 500; res = { message: 'Internal server error' }; }
      else if (out === 'applied409' || out === 'applied401') { apply(); status = out === 'applied409' ? 409 : 401; res = { error: out === 'applied409' ? 'revision_conflict' : 'unauthorized', serverRevision: srv.revision }; }
      else if (out === 'refuse409') { status = 409; res = { error: 'revision_conflict', serverRevision: srv.revision }; }
      else { status = 502; if (out === 'grew502') srv.revision++; if (out === 'grewSpent502') { srv.revision++; srv.adena -= 10000; } if (out === 'moved502') apply('cruma_alt'); if (out === 'movedFree502') { srv.revision++; srv.currentZoneId = 'cruma_alt'; } }
      const req = forum ? { teleportId: target, expectedRevision: p.revision, expectedAdenaCost: p.cost } : { teleportId: target, expectedRevision: p.revision, expectedAdenaCost: p.cost };
      N.onForumTeleportNet(forum ? '/game/farm-guide/resource-teleport' : '/game/teleport', { method: 'POST', status, nativeNonce: forum ? '' : p.nonce, req, res });
      if (out === 'ok' || out === 'moved502') href = '/map.html';
    },
  };
  function load() {
    const box = { console, URL, URLSearchParams, Date: FakeDate, location: loc, document: { querySelectorAll: () => [{}], body: { innerText: '' } },
      sessionStorage: { getItem: k => session.get(k) ?? null, setItem: (k, v) => session.set(k, String(v)), removeItem: k => session.delete(k) },
      chrome: { storage: { local: { get: async keys => clone(Object.fromEntries([].concat(keys).filter(k => store[k] !== undefined).map(k => [k, store[k]]))) } } } };   // 20.43: хранилище фона (on/paused/stopMeta)
    vm.runInNewContext(PAY, box); vm.runInNewContext(NAV, box); vm.runInNewContext(ACT, box); return box;
  }
  let box = load(), N = box.L2V7Factories.navigation(env);
  const F = {
    env, srv, clock, records, pauses, session, loc, target, step: () => N.zoneGoStep(), advance: ms => { clock.t += ms; },
    clicks: () => clicks, gets: () => gets, writes: () => writes, disk: () => disk, N: () => N, box: () => box,
    reload() { env.rt = clone(disk); env.on = true; Object.assign(store, { on: true, paused: null }); session.clear(); box = load(); N = box.L2V7Factories.navigation(env); },
    log: re => records.some(r => re.test(r)),
    tc: () => env.rt.travelCheck,
  };
  return F;
}
// перелёт закрыт: ни квитанции, ни маршрута
const closed = f => { assert.equal(f.env.rt.travelCheck ?? null, null, 'квитанция закрыта'); assert.equal(f.env.rt.zoneGo ?? null, null, 'маршрут снят'); };

test('явный отказ 400 после клика: GET подтвердил «ничего не изменилось» — без паузы, перелёт снят, зона 6 ч «плохая», ушёл на карту, второго клика нет', async () => {
  const f = fixture({ outcome: 'refuse400' }); await f.step();
  assert.equal(f.clicks(), 1); assert.equal(f.pauses.length, 0); assert.equal(f.env.on, true); assert.equal(f.gets(), 2, 'GET до клика и GET-подтверждение отказа');
  closed(f); assert.ok(f.env.rt.zoneBad[f.target]); assert.equal(f.loc.pathname, '/map.html');
  assert.ok(f.log(/сервер отказал в телепорте \(HTTP 400\) — оплаты не было/));
  await f.step(); assert.equal(f.clicks(), 1);
});
test('отказ 500 с кодом «не хватает адены» — тоже явный отказ; обычный 500 — неизвестный исход (сверка, не отказ)', async () => {
  const a = fixture({ outcome: 'biz500' }); await a.step();
  closed(a); assert.ok(a.env.rt.zoneBad[a.target]); assert.equal(a.pauses.length, 0);
  const b = fixture({ outcome: 'plain500' }); await b.step();
  assert.ok(b.tc()?.nativeTp, 'квитанция остаётся'); assert.equal(b.tc().check.n, 1); assert.equal(b.env.rt.zoneBad, undefined); assert.equal(b.pauses.length, 0); assert.equal(b.env.on, true);
});
test('сбой до клика: персонаж не прочитан — без клика и без паузы, перелёт снят с zoneBad', async () => {
  const f = fixture({ getFail: n => n === 1 }); await f.step();
  assert.equal(f.clicks(), 0); assert.equal(f.pauses.length, 0); closed(f); assert.ok(f.env.rt.zoneBad[f.target]);
  assert.ok(f.env.rt.zoneTried[f.target + ':40']); assert.equal(f.loc.pathname, '/map.html');
  assert.ok(f.log(/персонаж перед телепортом не подтверждён — оплаты не было, перелёт снят/));
});
test('сбой до клика: квитанция не записалась — без клика и без паузы, перелёт снят', async () => {
  const f = fixture(); f.env.rtCommit = async () => false; await f.step();
  assert.equal(f.clicks(), 0); assert.equal(f.pauses.length, 0); closed(f); assert.ok(f.env.rt.zoneBad[f.target]);
});
test('502, ревизия не изменилась: первая сверка сразу не считается, две следующие ≥ 30 с — «не прошёл», маршрут снят, второй оплаты нет', async () => {
  const f = fixture({ outcome: 'lost502' }); await f.step();
  assert.equal(f.clicks(), 1); assert.equal(f.pauses.length, 0); assert.equal(f.env.on, true);
  const g = f.tc(); assert.ok(g.nativeTp); assert.equal(g.check.n, 1); assert.equal(g.check.same, 0, 'сверка сразу после клика не идёт в счёт');
  assert.equal(f.env.rt.zoneGo, null, 'маршрут снят записью квитанции до клика');
  assert.ok(f.log(/прибытие не подтверждено; повторная оплата запрещена\. На паузу не встаю/));
  const gets = f.gets(); await f.step(); assert.equal(f.gets(), gets, 'до срока GET не шлём');
  f.advance(30 * S); await f.step(); assert.equal(f.tc().check.n, 2); assert.equal(f.tc().check.same, 1); assert.ok(f.tc(), 'одной сверки мало');
  f.advance(30 * S); await f.step();
  closed(f); assert.equal(f.clicks(), 1); assert.equal(f.pauses.length, 0); assert.equal(f.env.rt.zone, undefined);
  assert.ok(f.log(/телепорт не прошёл — ревизия героя \(100\) и адена не изменились в двух сверках с промежутком 30 с; оплаты не было/));
});
test('две сверки «без изменений» ближе 30 с друг к другу — ещё не доказательство', async () => {
  const f = fixture({ outcome: 'lost502', gap: 20 * S }); await f.step();
  f.advance(20 * S); await f.step(); assert.equal(f.tc().check.same, 0, '20 с после клика — рано');
  f.advance(20 * S); await f.step(); assert.equal(f.tc().check.same, 1);
  f.advance(20 * S); await f.step(); assert.ok(f.tc(), 'промежуток 20 с — не вывод');
  f.advance(20 * S); await f.step(); closed(f); assert.equal(f.clicks(), 1);
});
test('ревизия та же, но адены стало меньше — не «ничего не изменилось» (L2PayOutcome.unchanged)', async () => {
  const f = fixture({ outcome: 'lost502' }); await f.step(); f.srv.adena -= 50000;
  for (let i = 0; i < 4; i++) { f.advance(30 * S); await f.step(); }
  assert.ok(f.tc()?.nativeTp); assert.equal(f.tc().check.same, 0); assert.equal(f.pauses.length, 0);
});
test('502, а потом сервер показал героя в цели с выросшей ревизией — прибытие подтверждено сверкой', async () => {
  const f = fixture({ outcome: 'lost502', onGet: (F, n) => { if (n === 3) { F.srv.revision++; F.srv.adena -= 50000; F.srv.currentZoneId = F.target; } } });
  await f.step(); assert.ok(f.tc());
  f.advance(30 * S); await f.step();
  closed(f); assert.equal(f.env.rt.zone, f.target); assert.equal(f.clicks(), 1); assert.equal(f.pauses.length, 0);
  assert.ok(f.log(/прибытие подтверждено сервером \(сверка 2\)/));
});
// 20.43 (доводка 21.10): ревизия выросла, герой на месте и адена та же — теперь вывод «не прошёл» (v2043-fx-travel-verify);
// без вывода остаётся неоднозначный исход — адены убыло, но меньше цены телепорта (grewSpent502)
test('502 и ревизия выросла, адены убыло меньше цены, герой на месте: вывода нет, сверка до 30 мин, затем одна пауза с причиной (fault)', async () => {
  const f = fixture({ outcome: 'grewSpent502' }); await f.step();
  let t = 0; while (f.pauses.length === 0 && t < 40 * MIN) { f.advance(30 * S); t += 30 * S; await f.step(); }
  assert.equal(f.pauses.length, 1); assert.ok(t >= 30 * MIN - 30 * S && t <= 31 * MIN, 'пауза только через 30 мин: ' + t);
  assert.equal(f.pauses[0].opt?.fault, true); assert.match(f.pauses[0].why, /^Телепорт: прибытие не подтверждено: исход перелёта в «Cruma» не удалось сверить за 30 мин \(\d+ сверок\)\. Проверьте положение героя$/);
  assert.equal(f.clicks(), 1); assert.ok(f.tc().nativeTp, 'квитанция сохранена'); assert.ok(f.tc().check.gaveUp, 'пауза была — метка для Старта игрока');
});
test('сервер лежит на 30-й минуте: pauseBot ждал сервер, а не встал на паузу — ещё 5 мин сверки, затем снова причина', async () => {
  const f = fixture({ outcome: 'lost502', serverDown: true, getFail: n => n >= 2 }); await f.step();
  let t = 0; while (f.pauses.length === 0 && t < 40 * MIN) { f.advance(30 * S); t += 30 * S; await f.step(); }
  assert.equal(f.pauses.length, 1); assert.equal(f.env.on, true); assert.equal(f.tc().check.gaveUp, undefined, 'паузы не было — метки нет');
  f.advance(4 * MIN); await f.step(); assert.equal(f.pauses.length, 1);
  f.advance(90 * S); await f.step(); assert.equal(f.pauses.length, 2); assert.equal(f.clicks(), 1);
});
test('ревизия выросла, герой в другом месте, адены убыло на цену — перелёт состоялся (id зоны не совпал), повтора нет', async () => {
  const f = fixture({ outcome: 'moved502' }); await f.step();
  // 20.43 (доводка 21.10): прибытие записывается (rt.zone = цель, как forumFinish) — иначе тот же телепорт покупался снова; уточнит карта
  closed(f); assert.equal(f.env.rt.zone, f.target, 'прибытие записано'); assert.equal(f.pauses.length, 0); assert.equal(f.clicks(), 1);
  assert.ok(f.log(/герой уже в другом месте \(было giran_field, сейчас cruma_alt\) — перелёт состоялся, оплату считаю прошедшей/));
});
test('герой в другом месте, но адена не убыла — это не доказательство оплаты: сверка продолжается', async () => {
  const f = fixture({ outcome: 'movedFree502' }); await f.step();
  assert.ok(f.tc()?.nativeTp); assert.equal(f.pauses.length, 0);
});
test('сверка переживает reload: счёт «без изменений» и срок следующего GET сохранены, повторного клика нет', async () => {
  const f = fixture({ outcome: 'lost502' }); await f.step();
  f.advance(30 * S); await f.step(); assert.equal(f.disk().travelCheck.check.same, 1);
  f.reload(); f.loc.href = '/map.html';
  const gets = f.gets(); await f.step(); assert.equal(f.gets(), gets, 'после reload срок следующей сверки прежний');
  f.advance(30 * S); await f.step();
  closed(f); assert.equal(f.clicks(), 1); assert.equal(f.pauses.length, 0);
});
test('Stop во время сверки: ни оплаты, ни паузы, ни записи — сверка отменена', async () => {
  const f = fixture({ outcome: 'lost502', onGet: (F, n) => { if (n === 3) F.env.on = false; } }); await f.step();
  const writes = f.writes(), check = clone(f.tc().check);
  f.advance(30 * S); await f.step();
  assert.equal(f.clicks(), 1); assert.equal(f.pauses.length, 0); assert.equal(f.writes(), writes); assert.deepEqual(clone(f.tc().check), check);
  f.advance(60 * S); await f.step(); assert.equal(f.gets(), 3, 'выключенный бот не сверяет');
});
test('смена героя во время сверки: ни оплаты, ни паузы, память прежнего героя не трогаем', async () => {
  const f = fixture({ outcome: 'lost502', onGet: (F, n) => { if (n === 3) F.env.rt = { char: 'Other' }; } }); await f.step();
  const writes = f.writes(), before = clone(f.disk());
  f.advance(30 * S); await f.step();
  assert.equal(f.clicks(), 1); assert.equal(f.pauses.length, 0); assert.equal(f.writes(), writes); assert.deepEqual(f.disk(), before);
});
test('новый Старт (другой manualKickAt) с квитанцией: окно 30 мин и счёт начинаются заново, без паузы и без клика; квитанция не снята', async () => {
  const f = fixture({ outcome: 'lost502' }); await f.step(); f.advance(30 * S); await f.step(); assert.equal(f.tc().check.same, 1);
  f.env.rt.manualKickAt = 9; f.advance(1 * S); await f.step();
  assert.equal(f.tc().check.kick, 9); assert.equal(f.tc().check.n, 1); assert.equal(f.tc().check.same, 1, 'первая сверка нового окна уже ≥ 30 с после клика');
  assert.equal(f.tc().check.ackStart, undefined, 'Старт без паузы «Проверьте положение героя» квитанцию не закрывает');
  assert.equal(f.clicks(), 1); assert.equal(f.pauses.length, 0);
});
test('форум: 502 без ответа — сверка вместо паузы, две сверки «без изменений» снимают перелёт; один POST', async () => {
  const f = fixture({ forum: true, outcome: 'lost502' }); await f.step();
  assert.equal(f.clicks(), 1); assert.ok(f.tc().forumTp); assert.equal(f.pauses.length, 0); assert.equal(f.env.on, true);
  assert.equal(f.tc().forumTp.adena, 1000000); assert.deepEqual(clone(f.tc().forumTp.from), { zone: 'giran_field', city: 'l2dop_giran' });
  f.advance(30 * S); await f.step(); f.advance(30 * S); await f.step();
  closed(f); assert.equal(f.clicks(), 1); assert.equal(f.pauses.length, 0);
});
test('форум: квитанция с прошлого Старта — не пауза (как раньше), а сверка; прибытие подтверждается сервером', async () => {
  const f = fixture({ forum: true, outcome: 'lost502' }); await f.step();
  f.env.rt.manualKickAt = 77; f.srv.revision++; f.srv.cityId = 'l2dop_heine'; f.srv.currentZoneId = null; f.advance(5 * S); await f.step();
  closed(f); assert.equal(f.env.rt.zone, 'heine'); assert.equal(f.pauses.length, 0); assert.equal(f.clicks(), 1);
});
test('успешный обычный телепорт: ACK своего запроса завершает перелёт сразу, без сверки', async () => {
  const f = fixture({ outcome: 'ok' }); await f.step();
  closed(f); assert.equal(f.env.rt.zone, f.target); assert.equal(f.gets(), 1, 'только GET до клика'); assert.ok(!f.log(/На паузу не встаю/));
});
test('пока квитанция перелёта не закрыта — payments.prepare отказывает (externalPending), после «не прошёл» — снова можно', async () => {
  const f = fixture({ outcome: 'lost502' }); await f.step();
  const P = f.box().L2V7Factories.payments({ get rt() { return f.env.rt; }, setRt: f.env.setRt, rtCommit: async () => true, on: true, tabOwner: true, rec() {},
    autonomyMode: () => 'farm', lease: () => 'l1', paymentContext: () => 'ctx', canRun: () => true, externalPending: () => f.N().travelPending() });
  const spec = { key: 'shop:x', kind: 'shop', quote: { amount: 100, currency: 'Adena' } };
  assert.equal(f.N().travelPending(), true); assert.equal(await P.prepare(spec), null);
  f.advance(30 * S); await f.step(); f.advance(30 * S); await f.step();
  assert.equal(f.N().travelPending(), false); assert.ok(await P.prepare(spec));
});

// ===== 20.43 (ревью au/travel) =====
// 1) 409 (revision_conflict) и 401 на телепорт — не доказательство отказа: сервер мог применить первый запрос (браузер повторил POST)
for (const forum of [false, true]) for (const outcome of ['applied409', 'applied401']) test(`${forum ? 'форум' : 'обычный'}: сервер применил телепорт и ответил ${outcome.slice(-3)} — не «оплаты не было», а прибытие по GET; zoneBad нет, второго клика нет`, async () => {
  const f = fixture({ forum, outcome }); await f.step();
  assert.equal(f.clicks(), 1); assert.equal(f.pauses.length, 0); closed(f); assert.equal(f.env.rt.zone, f.target);
  assert.equal(f.env.rt.zoneBad, undefined, 'зона, куда заплатили, не «плохая»'); assert.equal(f.srv.adena, 950000);
  assert.ok(f.log(/прибытие подтверждено сервером/)); assert.ok(!f.log(/оплаты не было/), 'ложной строки «оплаты не было» нет');
  await f.step(); assert.equal(f.clicks(), 1);
});
test('409 без применения: неизвестный исход — квитанция и сверка (не отказ, не zoneBad), «не прошёл» только двумя сверками ≥ 30 с', async () => {
  const f = fixture({ outcome: 'refuse409' }); await f.step();
  assert.ok(f.tc()?.nativeTp); assert.equal(f.tc().nativeTp.ack, undefined, '409 не пишется отказом'); assert.equal(f.env.rt.zoneBad, undefined); assert.equal(f.pauses.length, 0);
  f.advance(30 * S); await f.step(); assert.ok(f.tc()); f.advance(30 * S); await f.step();
  closed(f); assert.equal(f.env.rt.zoneBad, undefined); assert.equal(f.clicks(), 1);
});
// 2) явный отказ — только вместе с GET: ревизия выросла (что-то изменилось) или GET не прошёл — не «оплаты не было», а сверка
test('отказ 400, но ревизия героя выросла — не вывод «оплаты не было»: квитанция остаётся, сверка, zoneBad нет', async () => {
  const f = fixture({ outcome: 'refuse400grew' }); await f.step();
  assert.ok(f.tc()?.nativeTp?.ack?.refused, 'отказ записан'); assert.equal(f.tc().check.n, 1); assert.equal(f.env.rt.zoneBad, undefined); assert.ok(!f.log(/оплаты не было/));
  assert.equal(f.pauses.length, 0); assert.equal(f.clicks(), 1); assert.ok(f.N().travelPending(), 'платное запрещено');
});
test('отказ 400, а GET /character не прошёл — не вывод: квитанция остаётся; следующая сверка (через 30–60 с) с той же ревизией снимает перелёт', async () => {
  const f = fixture({ outcome: 'refuse400', getFail: n => n === 2 }); await f.step();
  assert.ok(f.tc()?.nativeTp); assert.equal(f.env.rt.zoneBad, undefined); assert.equal(f.gets(), 2);
  await f.step(); assert.equal(f.gets(), 2, 'до срока GET не шлём (отказ не обходит ритм сверки)');
  f.advance(30 * S); await f.step(); closed(f); assert.ok(f.env.rt.zoneBad[f.target]); assert.equal(f.clicks(), 1);
});
test('подтверждённое прибытие (ACK ok) не затирается поздним отказом того же nonce', async () => {
  const f = fixture({ outcome: 'lost502' }); await f.step();
  const p = f.tc().nativeTp, req = { teleportId: f.target, expectedRevision: p.revision, expectedAdenaCost: p.cost };
  f.srv.revision++; f.srv.currentZoneId = f.target;
  f.N().onForumTeleportNet('/game/teleport', { method: 'POST', status: 200, nativeNonce: p.nonce, req, res: { character: { ...f.srv } } });
  assert.equal(f.tc().nativeTp.ack.ok, true);
  f.N().onForumTeleportNet('/game/teleport', { method: 'POST', status: 400, nativeNonce: p.nonce, req, res: { error: 'already_there' } });
  assert.equal(f.tc().nativeTp.ack.ok, true, 'ok не стал отказом'); assert.equal(JSON.parse(f.session.get('l2bot.nativeTeleportAck')).ack.ok, true);
  await f.step(); closed(f); assert.equal(f.env.rt.zone, f.target); assert.equal(f.env.rt.zoneBad, undefined);
});
test('метка своего телепорта (nativeNonce для NET_CONTEXT) — только первые 30 с после клика: поздний ручной клик игрока не засчитывается клику бота', async () => {
  const f = fixture({ outcome: 'lost502' }); await f.step();
  assert.equal(f.N().nativeNonce(), f.tc().nativeTp.nonce);
  f.advance(31 * S); assert.equal(f.N().nativeNonce(), '');
  const c = read('content.js'); assert.ok(c.includes("nativeNonce:L2V7Modules.navigation?.nativeNonce?.()||''"), 'NET_CONTEXT берёт метку из navigation'); assert.ok(!c.includes('rt.zoneGo?.nativeTp?.nonce'));
});
// 3) квитанция не живёт внутри маршрута: снятие/замена маршрута (диспетчер, «Задачи бота», меню, новые маршруты) её не трогает
test('маршрут zoneGo снят или заменён во время сверки — квитанция и запрет платного остаются, новый маршрут не кликает до вывода', async () => {
  const f = fixture({ outcome: 'lost502' }); await f.step();
  await f.env.setRt({ zoneGo: null, manualKickAt: 6 });                      // смена режима в меню: zoneGo:null + manualKickAt
  assert.ok(f.N().travelPending()); assert.ok(f.tc().nativeTp);
  await f.env.setRt({ zoneGo: { id: 'dragon_valley', t: f.clock.t, why: 'автофарм' } }); // новый маршрут автофарма
  f.advance(30 * S); await f.step(); assert.equal(f.clicks(), 1, 'новый маршрут не платит, пока квитанция открыта'); assert.ok(f.tc());
  f.advance(30 * S); await f.step(); assert.equal(f.tc() ?? null, null, '«не прошёл» — квитанция закрыта');
  assert.equal(f.env.rt.zoneGo?.id, 'dragon_valley', 'новый маршрут не снят выводом по старой квитанции'); assert.equal(f.clicks(), 1);
});
test('настоящий диспетчер (actions.js): смена режима/цели снимает маршрут zoneGo, но не rt.travelCheck', async () => {
  const f = fixture({ outcome: 'lost502' }); await f.step();
  let mode = 'farm'; const e = f.env;
  Object.assign(e, { mode: () => mode, lease: () => 'l1', page: () => f.loc.href, id: () => 'owner-1', interrupted: () => false, isBattle: () => false, paymentPending: () => null,
    rtCommit: async () => true, jobs: () => [{ key: 'zoneGo', run: () => f.N().zoneGoStep() }] });
  const A = f.box().L2V7Factories.actions(e); e.canAct = () => A.canAct();
  await e.setRt({ zoneGo: { id: 'dragon_valley', t: f.clock.t + 1, why: 'автофарм' } });
  A.enterFrame(); await A.dispatch(); assert.equal(e.rt.actionOwner?.key, 'zoneGo');
  mode = 'fish'; A.enterFrame(); await A.dispatch();
  assert.equal(e.rt.zoneGo, null, 'диспетчер снял маршрут'); assert.ok(e.rt.travelCheck?.nativeTp, 'квитанция осталась'); assert.ok(f.N().travelPending());
  assert.equal(f.clicks(), 1);
});
test('ядро: «Задачи бота» и диспетчер не знают про travelCheck; сверку ведёт loopTravel раньше них; занятость — и для travelCheck', () => {
  const s = read('content.js');
  const list = s.slice(s.indexOf('async function loopTaskList'), s.indexOf('async function loopEnchant'));
  assert.ok(/for \(const key of \[[^\]]*'zoneGo'[^\]]*\]\)/.test(list) && !list.includes('travelCheck'), 'список «Задачи бота» снимает маршруты, не квитанцию');
  // 20.43 (слияние au/travel + au/breather): между срочными и сверкой — loopSelfHold (только снимает истёкшую передышку, круг не держит);
  // сверка перелёта по-прежнему раньше списка задач и диспетчера
  assert.match(s, /await loopUrgent\(\) \|\| await loopSelfHold\(\)\s*\|\| await loopTravel\(\) \|\| await loopTaskList\(\)/);
  assert.match(s, /async function loopTravel\(\) \{\s*if \(!L2V7Modules\.navigation\?\.travelPending\?\.\(\) \|\| isBattle\(\) \|\| \(isFishing\(\) && fishState\(\)\)\) return;\s*await L2V7Modules\.navigation\.travelStep\(\); await sleep\(200\); return true;/);
  const jobs = s.slice(s.indexOf('get jobs(){return ()=>['), s.indexOf('const actionLocation='));
  assert.ok(!jobs.includes('travelCheck'), 'квитанция — не маршрут диспетчера');
  assert.ok(s.includes("'rbGo','zoneGo','travelCheck','dailyFish'"), 'закупка ЛС ждёт'); assert.ok(s.includes('!rt.zoneGo && !rt.travelCheck && !rt.tbuff'), 'баффер кота ждёт');
  assert.match(s.slice(s.indexOf('async function magisterStart('), s.indexOf('if (!magActive() || fishNow()', s.indexOf('async function magisterStart('))), /if \(rt\.travelCheck\) return false;/, 'магистр ждёт');
  for (const [m, re] of [['mammon', /r\.zoneGo \|\| r\.travelCheck/], ['enemies', /r\.zoneGo \|\| r\.travelCheck/], ['pvp', /r\.zoneGo\|\|r\.travelCheck/], ['warlock', /env\.rt\.zoneGo \|\| !!env\.rt\.travelCheck/]])
    assert.match(read('modules/' + m + '.js'), re, m);
});
test('старая квитанция внутри zoneGo (до этой правки) переносится в rt.travelCheck и сверяется без клика', async () => {
  const f = fixture({ outcome: 'lost502' }); await f.step();
  const legacy = { ...clone(f.tc()), check: undefined }; delete legacy.check;
  await f.env.setRt({ travelCheck: null, zoneGo: legacy }); assert.ok(f.N().travelPending());
  f.advance(30 * S); await f.step();
  assert.equal(f.env.rt.zoneGo, null); assert.ok(f.tc()?.nativeTp); assert.equal(f.tc().check.n, 1); assert.equal(f.clicks(), 1);
});
// 20.43 (доводка 21.10): неоднозначный исход (grewSpent502 — grew502 теперь доказуем); Старт игрока — это и новый manualKickAt, и +1 к
// rt.dailyStart (фон: menuPatch on:true); одна правка меню (только manualKickAt) квитанцию не закрывает — v2043-fx-travel-verify
test('Старт игрока после паузы «Проверьте положение героя»: одна сверка — квитанция закрыта по его решению, без нового окна 30 мин; платное снова можно', async () => {
  const f = fixture({ outcome: 'grewSpent502' }); await f.step();
  let t = 0; while (f.pauses.length === 0 && t < 40 * MIN) { f.advance(30 * S); t += 30 * S; await f.step(); }
  assert.equal(f.pauses.length, 1); assert.equal(f.env.on, false); assert.ok(f.disk().travelCheck.check.gaveUp, 'метка паузы сохранена');
  f.reload(); f.env.rt.manualKickAt = 1234; f.env.rt.dailyStart = (f.env.rt.dailyStart || 0) + 1; f.advance(5 * MIN); await f.step();
  closed(f); assert.equal(f.pauses.length, 1); assert.equal(f.clicks(), 1); assert.equal(f.env.rt.zoneBad, undefined);
  assert.ok(f.log(/после паузы «Проверьте положение героя» игрок нажал Старт — исход перелёта сервер так и не подтвердил \(ревизия 101, до клика 100\); квитанцию закрываю по решению игрока/));
  assert.equal(f.N().travelPending(), false);
});
test('Старт после паузы, а герой уже в цели — прибытие; ревизия и адена те же — «не прошёл» одной сверкой', async () => {
  for (const kind of ['arrived', 'same']) {
    let down = true;                                   // GET /character не отвечает все 30 мин сверки, после Старта — отвечает
    const f = fixture({ outcome: kind === 'arrived' ? 'grew502' : 'lost502', getFail: n => n >= 2 && down });
    let t = 0; await f.step(); while (f.pauses.length === 0 && t < 40 * MIN) { f.advance(30 * S); t += 30 * S; await f.step(); }
    assert.equal(f.pauses.length, 1, kind);
    if (kind === 'arrived') { f.srv.revision++; f.srv.currentZoneId = f.target; }
    // 20.43 (доводка 21.10): Старт игрока — новый manualKickAt и +1 к rt.dailyStart
    down = false; f.reload(); f.env.rt.manualKickAt = 4321; f.env.rt.dailyStart = (f.env.rt.dailyStart || 0) + 1; f.advance(5 * MIN); await f.step();
    closed(f); assert.equal(f.clicks(), 1);
    if (kind === 'arrived') assert.equal(f.env.rt.zone, f.target); else assert.ok(f.log(/телепорт не прошёл — ревизия героя \(100\) и адена не изменились \(сверка после Старта игрока\)/));
  }
});
test('ядро: квитанция обычного телепорта идёт в сверку без таймаута, сверка не «нет прогресса», другие оплаты ждут', () => {
  const s = read('content.js');
  assert.ok(s.includes('if (rt.zoneGo.forumTp || rt.zoneGo.nativeTp) { await zoneGoStep(); return true; }'));
  assert.match(s, /const activeJob = !L2V7Modules\.payments\?\.pending\?\.\(\) && \(!\(typeof dailyWorkWaiting==='function' && dailyWorkWaiting\(\)\)\) && !L2V7Modules\.navigation\?\.travelPending\?\.\(\) &&/);
  assert.match(s, /get externalPending\(\)\{return \(\)=>!!rt\.petFull\?\.pending\|\|!!rt\.enchant\?\.pending\|\|!!L2V7Modules\.navigation\?\.travelPending\?\.\(\)\}/);
  // пауза — только на 30-й минуте; прежние паузы до клика и после клика из перелёта убраны
  const nav = read('modules/navigation.js'), step = nav.slice(nav.indexOf('async function zoneGoStep'), nav.indexOf('async function toMap'));
  assert.equal((step.match(/forumUncertain\(/g) || []).length, 0, 'zoneGoStep не ставит паузу сам');
  assert.equal((nav.match(/await forumUncertain\(/g) || []).length, 1, 'одна пауза — после 30 мин сверки');
  // 20.43 (ревью): отказ не снимает перелёт без GET — в шаге нет прямого travelDrop по ack.refused
  assert.ok(!/refused\)\s*await travelDrop/.test(nav), 'отказ → только через сверку');
});
