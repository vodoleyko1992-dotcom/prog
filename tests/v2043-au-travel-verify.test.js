'use strict';
// 20.43 (автономность, разбор 21.10; docs/NIGHT-FARM-2026-10-17.md 07:25): сбой перелёта — сверка по серверу вместо паузы.
// (а) клика не было / явный отказ — перелёт снят без паузы (zoneBad); (б) клик был, исход неизвестен — бот включён, платное запрещено,
// бесплатный GET /character раз в 30–60 с; прибыл — forumFinish; ревизия и адена те же в двух сверках ≥ 30 с — «не прошёл», маршрут снят;
// пауза — только если 30 мин не удаётся сверить. Сверка переживает reload; Stop/смена героя во время сверки — ни оплаты, ни паузы.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.join(__dirname, '..'), read = n => fs.readFileSync(path.join(root, n), 'utf8'), clone = x => JSON.parse(JSON.stringify(x));
const NAV = read('modules/navigation.js'), PAY = read('modules/payments.js');
const S = 1000, MIN = 60 * S;

// outcome: что делает сервер на клик телепорта (POST): ok | refuse400 | biz500 | plain500 | lost502 | grew502 | moved502 | movedFree502
function fixture(o = {}) {
  const clock = { t: 1800000000000 };
  class FakeDate extends Date { constructor(...a) { super(...(a.length ? a : [clock.t])); } static now() { return clock.t; } }
  const forum = !!o.forum, target = forum ? 'heine' : 'cruma_marshlands', cost = 50000;
  let href = forum ? '/forum-farm-resources.html' : '/teleport.html', clicks = 0, gets = 0, writes = 0, disk = null;
  const loc = { get href() { return href; }, set href(v) { href = v; }, get pathname() { return href.split('?')[0]; }, get search() { return href.includes('?') ? '?' + href.split('?')[1] : ''; } };
  const srv = { id: 'hero-1', name: 'Hero', revision: 100, adena: 1000000, currentZoneId: 'giran_field', cityId: 'l2dop_giran', inBattle: false, activeDungeonId: null };
  const row = { textContent: '50 000 аден', querySelector: s => s.includes('currency') ? { textContent: 'аден', querySelectorAll: () => [] } : s.includes('price-num') ? { textContent: '50 000' } : null };
  const btn = { closest: () => row, dataset: { baseAdenaCost: '50000', adenaCost: '50000' }, textContent: 'Телепорт 50 000 Adena' };
  const records = [], pauses = [], session = new Map();
  const env = {
    on: true, tabOwner: true, cfg: { shopReserve: 200000 },
    rt: { char: 'Hero', manualKickAt: 5, zoneGo: forum ? { id: target, url: '/forum-farm-resources.html', forum: true, t: clock.t - 1000 } : { id: target, t: clock.t - 1000 },
      zoneCat: { [target]: { name: forum ? 'Heine' : 'Cruma' } } },
    rec: (...a) => records.push(a.join(' | ')), setStatus() {}, heroLvl: () => 40, shown: () => true, isFarmPage: () => forum, $q: () => btn,
    sleep: async () => {}, waitX: async f => f(), rnd: (a) => o.gap ?? a,
    setRt: async p => { writes++; Object.assign(env.rt, p); disk = clone(env.rt); return { ok: true }; },
    pauseBot: async (why, opt) => { pauses.push({ why, opt }); if (!o.serverDown) env.on = false; },
    gameGet: async () => { gets++; o.onGet?.(F, gets); if (o.getFail?.(gets)) return { ok: false, json: async () => ({}) }; return { ok: true, json: async () => ({ character: { ...srv } }) }; },
    fire: () => {
      clicks++;
      const g = env.rt.zoneGo, p = g.nativeTp || g.forumTp, out = o.outcome || 'ok';
      const apply = (zone = target) => { srv.revision++; srv.adena -= cost; if (forum && zone === target) { srv.cityId = 'l2dop_heine'; srv.currentZoneId = null; } else srv.currentZoneId = zone; };
      let status = 200, res = null;
      if (out === 'ok') { apply(); res = { character: { ...srv } }; }
      else if (out === 'refuse400') { status = 400; res = { error: 'not_enough_adena' }; }
      else if (out === 'biz500') { status = 500; res = { message: 'not_enough_adena' }; }
      else if (out === 'plain500') { status = 500; res = { message: 'Internal server error' }; }
      else { status = 502; if (out === 'grew502') srv.revision++; if (out === 'moved502') apply('cruma_alt'); if (out === 'movedFree502') { srv.revision++; srv.currentZoneId = 'cruma_alt'; } }
      const req = forum ? { teleportId: target, expectedRevision: p.revision, expectedAdenaCost: p.cost } : { teleportId: target, expectedRevision: p.revision, expectedAdenaCost: p.cost };
      N.onForumTeleportNet(forum ? '/game/farm-guide/resource-teleport' : '/game/teleport', { method: 'POST', status, nativeNonce: forum ? '' : p.nonce, req, res });
      if (out === 'ok' || out === 'moved502') href = '/map.html';
    },
  };
  function load() {
    const box = { console, URL, URLSearchParams, Date: FakeDate, location: loc, document: { querySelectorAll: () => [{}], body: { innerText: '' } },
      sessionStorage: { getItem: k => session.get(k) ?? null, setItem: (k, v) => session.set(k, String(v)), removeItem: k => session.delete(k) } };
    vm.runInNewContext(PAY, box); vm.runInNewContext(NAV, box); return box;
  }
  let box = load(), N = box.L2V7Factories.navigation(env);
  const F = {
    env, srv, clock, records, pauses, session, loc, target, step: () => N.zoneGoStep(), advance: ms => { clock.t += ms; },
    clicks: () => clicks, gets: () => gets, writes: () => writes, disk: () => disk, N: () => N, box: () => box,
    reload() { env.rt = clone(disk); env.on = true; session.clear(); box = load(); N = box.L2V7Factories.navigation(env); },
    log: re => records.some(r => re.test(r)),
  };
  return F;
}

test('явный отказ 400 после клика: без паузы, перелёт снят, зона 6 ч «плохая», ушёл на карту, второго клика нет', async () => {
  const f = fixture({ outcome: 'refuse400' }); await f.step();
  assert.equal(f.clicks(), 1); assert.equal(f.pauses.length, 0); assert.equal(f.env.on, true);
  assert.equal(f.env.rt.zoneGo, null); assert.ok(f.env.rt.zoneBad[f.target]); assert.equal(f.loc.pathname, '/map.html');
  assert.ok(f.log(/сервер отказал в телепорте \(HTTP 400\) — оплаты не было/));
  await f.step(); assert.equal(f.clicks(), 1);
});
test('отказ 500 с кодом «не хватает адены» — тоже явный отказ; обычный 500 — неизвестный исход (сверка, не отказ)', async () => {
  const a = fixture({ outcome: 'biz500' }); await a.step();
  assert.equal(a.env.rt.zoneGo, null); assert.ok(a.env.rt.zoneBad[a.target]); assert.equal(a.pauses.length, 0);
  const b = fixture({ outcome: 'plain500' }); await b.step();
  assert.ok(b.env.rt.zoneGo?.nativeTp, 'квитанция остаётся'); assert.equal(b.env.rt.zoneGo.check.n, 1); assert.equal(b.env.rt.zoneBad, undefined); assert.equal(b.pauses.length, 0); assert.equal(b.env.on, true);
});
test('сбой до клика: персонаж не прочитан — без клика и без паузы, перелёт снят с zoneBad', async () => {
  const f = fixture({ getFail: n => n === 1 }); await f.step();
  assert.equal(f.clicks(), 0); assert.equal(f.pauses.length, 0); assert.equal(f.env.rt.zoneGo, null); assert.ok(f.env.rt.zoneBad[f.target]);
  assert.ok(f.env.rt.zoneTried[f.target + ':40']); assert.equal(f.loc.pathname, '/map.html');
  assert.ok(f.log(/персонаж перед телепортом не подтверждён — оплаты не было, перелёт снят/));
});
test('сбой до клика: квитанция не записалась — без клика и без паузы, перелёт снят', async () => {
  const f = fixture(); f.env.rtCommit = async () => false; await f.step();
  assert.equal(f.clicks(), 0); assert.equal(f.pauses.length, 0); assert.equal(f.env.rt.zoneGo, null); assert.ok(f.env.rt.zoneBad[f.target]);
});
test('502, ревизия не изменилась: первая сверка сразу не считается, две следующие ≥ 30 с — «не прошёл», маршрут снят, второй оплаты нет', async () => {
  const f = fixture({ outcome: 'lost502' }); await f.step();
  assert.equal(f.clicks(), 1); assert.equal(f.pauses.length, 0); assert.equal(f.env.on, true);
  const g = f.env.rt.zoneGo; assert.ok(g.nativeTp); assert.equal(g.check.n, 1); assert.equal(g.check.same, 0, 'сверка сразу после клика не идёт в счёт');
  assert.ok(f.log(/прибытие не подтверждено; повторная оплата запрещена\. На паузу не встаю/));
  const gets = f.gets(); await f.step(); assert.equal(f.gets(), gets, 'до срока GET не шлём');
  f.advance(30 * S); await f.step(); assert.equal(f.env.rt.zoneGo.check.n, 2); assert.equal(f.env.rt.zoneGo.check.same, 1); assert.ok(f.env.rt.zoneGo, 'одной сверки мало');
  f.advance(30 * S); await f.step();
  assert.equal(f.env.rt.zoneGo, null); assert.equal(f.clicks(), 1); assert.equal(f.pauses.length, 0); assert.equal(f.env.rt.zone, undefined);
  assert.ok(f.log(/телепорт не прошёл — ревизия героя \(100\) и адена не изменились в двух сверках с промежутком 30 с; оплаты не было/));
});
test('две сверки «без изменений» ближе 30 с друг к другу — ещё не доказательство', async () => {
  const f = fixture({ outcome: 'lost502', gap: 20 * S }); await f.step();
  f.advance(20 * S); await f.step(); assert.equal(f.env.rt.zoneGo.check.same, 0, '20 с после клика — рано');
  f.advance(20 * S); await f.step(); assert.equal(f.env.rt.zoneGo.check.same, 1);
  f.advance(20 * S); await f.step(); assert.ok(f.env.rt.zoneGo, 'промежуток 20 с — не вывод');
  f.advance(20 * S); await f.step(); assert.equal(f.env.rt.zoneGo, null); assert.equal(f.clicks(), 1);
});
test('ревизия та же, но адены стало меньше — не «ничего не изменилось» (L2PayOutcome.unchanged)', async () => {
  const f = fixture({ outcome: 'lost502' }); await f.step(); f.srv.adena -= 50000;
  for (let i = 0; i < 4; i++) { f.advance(30 * S); await f.step(); }
  assert.ok(f.env.rt.zoneGo?.nativeTp); assert.equal(f.env.rt.zoneGo.check.same, 0); assert.equal(f.pauses.length, 0);
});
test('502, а потом сервер показал героя в цели с выросшей ревизией — прибытие подтверждено сверкой', async () => {
  const f = fixture({ outcome: 'lost502', onGet: (F, n) => { if (n === 3) { F.srv.revision++; F.srv.adena -= 50000; F.srv.currentZoneId = F.target; } } });
  await f.step(); assert.ok(f.env.rt.zoneGo);
  f.advance(30 * S); await f.step();
  assert.equal(f.env.rt.zoneGo, null); assert.equal(f.env.rt.zone, f.target); assert.equal(f.clicks(), 1); assert.equal(f.pauses.length, 0);
  assert.ok(f.log(/прибытие подтверждено сервером \(сверка 2\)/));
});
test('502 и ревизия выросла, а герой на месте: вывода нет, сверка до 30 мин, затем одна пауза с причиной (fault)', async () => {
  const f = fixture({ outcome: 'grew502' }); await f.step();
  let t = 0; while (f.pauses.length === 0 && t < 40 * MIN) { f.advance(30 * S); t += 30 * S; await f.step(); }
  assert.equal(f.pauses.length, 1); assert.ok(t >= 30 * MIN - 30 * S && t <= 31 * MIN, 'пауза только через 30 мин: ' + t);
  assert.equal(f.pauses[0].opt?.fault, true); assert.match(f.pauses[0].why, /^Телепорт: прибытие не подтверждено: исход перелёта в «Cruma» не удалось сверить за 30 мин \(\d+ сверок\)\. Проверьте положение героя$/);
  assert.equal(f.clicks(), 1); assert.ok(f.env.rt.zoneGo.nativeTp, 'квитанция сохранена');
});
test('сервер лежит на 30-й минуте: pauseBot ждал сервер, а не встал на паузу — ещё 5 мин сверки, затем снова причина', async () => {
  const f = fixture({ outcome: 'lost502', serverDown: true, getFail: n => n >= 2 }); await f.step();
  let t = 0; while (f.pauses.length === 0 && t < 40 * MIN) { f.advance(30 * S); t += 30 * S; await f.step(); }
  assert.equal(f.pauses.length, 1); assert.equal(f.env.on, true);
  f.advance(4 * MIN); await f.step(); assert.equal(f.pauses.length, 1);
  f.advance(90 * S); await f.step(); assert.equal(f.pauses.length, 2); assert.equal(f.clicks(), 1);
});
test('ревизия выросла, герой в другом месте, адены убыло на цену — перелёт состоялся (id зоны не совпал), повтора нет', async () => {
  const f = fixture({ outcome: 'moved502' }); await f.step();
  assert.equal(f.env.rt.zoneGo, null); assert.equal(f.env.rt.zone, undefined, 'зону определит карта'); assert.equal(f.pauses.length, 0); assert.equal(f.clicks(), 1);
  assert.ok(f.log(/герой уже в другом месте \(было giran_field, сейчас cruma_alt\) — перелёт состоялся, оплату считаю прошедшей/));
});
test('герой в другом месте, но адена не убыла — это не доказательство оплаты: сверка продолжается', async () => {
  const f = fixture({ outcome: 'movedFree502' }); await f.step();
  assert.ok(f.env.rt.zoneGo?.nativeTp); assert.equal(f.pauses.length, 0);
});
test('сверка переживает reload: счёт «без изменений» и срок следующего GET сохранены, повторного клика нет', async () => {
  const f = fixture({ outcome: 'lost502' }); await f.step();
  f.advance(30 * S); await f.step(); assert.equal(f.disk().zoneGo.check.same, 1);
  f.reload(); f.loc.href = '/map.html';
  const gets = f.gets(); await f.step(); assert.equal(f.gets(), gets, 'после reload срок следующей сверки прежний');
  f.advance(30 * S); await f.step();
  assert.equal(f.env.rt.zoneGo, null); assert.equal(f.clicks(), 1); assert.equal(f.pauses.length, 0);
});
test('Stop во время сверки: ни оплаты, ни паузы, ни записи — сверка отменена', async () => {
  const f = fixture({ outcome: 'lost502', onGet: (F, n) => { if (n === 3) F.env.on = false; } }); await f.step();
  const writes = f.writes(), check = clone(f.env.rt.zoneGo.check);
  f.advance(30 * S); await f.step();
  assert.equal(f.clicks(), 1); assert.equal(f.pauses.length, 0); assert.equal(f.writes(), writes); assert.deepEqual(clone(f.env.rt.zoneGo.check), check);
  f.advance(60 * S); await f.step(); assert.equal(f.gets(), 3, 'выключенный бот не сверяет');
});
test('смена героя во время сверки: ни оплаты, ни паузы, память прежнего героя не трогаем', async () => {
  const f = fixture({ outcome: 'lost502', onGet: (F, n) => { if (n === 3) F.env.rt = { char: 'Other' }; } }); await f.step();
  const writes = f.writes(), before = clone(f.disk());
  f.advance(30 * S); await f.step();
  assert.equal(f.clicks(), 1); assert.equal(f.pauses.length, 0); assert.equal(f.writes(), writes); assert.deepEqual(f.disk(), before);
});
test('новый Старт (другой manualKickAt) с квитанцией: окно 30 мин и счёт начинаются заново, без паузы и без клика', async () => {
  const f = fixture({ outcome: 'lost502' }); await f.step(); f.advance(30 * S); await f.step(); assert.equal(f.env.rt.zoneGo.check.same, 1);
  f.env.rt.manualKickAt = 9; f.advance(1 * S); await f.step();
  assert.equal(f.env.rt.zoneGo.check.kick, 9); assert.equal(f.env.rt.zoneGo.check.n, 1); assert.equal(f.env.rt.zoneGo.check.same, 1, 'первая сверка нового окна уже ≥ 30 с после клика');
  assert.equal(f.clicks(), 1); assert.equal(f.pauses.length, 0);
});
test('форум: 502 без ответа — сверка вместо паузы, две сверки «без изменений» снимают перелёт; один POST', async () => {
  const f = fixture({ forum: true, outcome: 'lost502' }); await f.step();
  assert.equal(f.clicks(), 1); assert.ok(f.env.rt.zoneGo.forumTp); assert.equal(f.pauses.length, 0); assert.equal(f.env.on, true);
  assert.equal(f.env.rt.zoneGo.forumTp.adena, 1000000); assert.deepEqual(clone(f.env.rt.zoneGo.forumTp.from), { zone: 'giran_field', city: 'l2dop_giran' });
  f.advance(30 * S); await f.step(); f.advance(30 * S); await f.step();
  assert.equal(f.env.rt.zoneGo, null); assert.equal(f.clicks(), 1); assert.equal(f.pauses.length, 0);
});
test('форум: квитанция с прошлого Старта — не пауза (как раньше), а сверка; прибытие подтверждается сервером', async () => {
  const f = fixture({ forum: true, outcome: 'lost502' }); await f.step();
  f.env.rt.manualKickAt = 77; f.srv.revision++; f.srv.cityId = 'l2dop_heine'; f.srv.currentZoneId = null; f.advance(5 * S); await f.step();
  assert.equal(f.env.rt.zoneGo, null); assert.equal(f.env.rt.zone, 'heine'); assert.equal(f.pauses.length, 0); assert.equal(f.clicks(), 1);
});
test('успешный обычный телепорт: ACK своего запроса завершает перелёт сразу, без сверки', async () => {
  const f = fixture({ outcome: 'ok' }); await f.step();
  assert.equal(f.env.rt.zoneGo, null); assert.equal(f.env.rt.zone, f.target); assert.equal(f.gets(), 1, 'только GET до клика'); assert.ok(!f.log(/На паузу не встаю/));
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
test('ядро: квитанция обычного телепорта идёт в сверку без таймаута, сверка не «нет прогресса», другие оплаты ждут', () => {
  const s = read('content.js');
  assert.ok(s.includes('if (rt.zoneGo.forumTp || rt.zoneGo.nativeTp) { await zoneGoStep(); return true; }'));
  assert.match(s, /const activeJob = !L2V7Modules\.payments\?\.pending\?\.\(\) && \(!\(typeof dailyWorkWaiting==='function' && dailyWorkWaiting\(\)\)\) && !L2V7Modules\.navigation\?\.travelPending\?\.\(\) &&/);
  assert.match(s, /get externalPending\(\)\{return \(\)=>!!rt\.petFull\?\.pending\|\|!!rt\.enchant\?\.pending\|\|!!L2V7Modules\.navigation\?\.travelPending\?\.\(\)\}/);
  // пауза — только на 30-й минуте; прежние паузы до клика и после клика из перелёта убраны
  const nav = read('modules/navigation.js'), step = nav.slice(nav.indexOf('async function zoneGoStep'), nav.indexOf('async function toMap'));
  assert.equal((step.match(/forumUncertain\(/g) || []).length, 0, 'zoneGoStep не ставит паузу сам');
  assert.equal((nav.match(/await forumUncertain\(/g) || []).length, 1, 'одна пауза — после 30 мин сверки');
});
