'use strict';
// 20.43 (автономность, доводка 21.10, ревью): отдельный счёт отсрочек карты на прилёте (rt.selfHoldDefer, raidMap/epicMap) и передышек
// бесплатной проверки карты (rt.selfHoldLog, mapGate). При чередовании «оплаченный перелёт → карта на прилёте не грузится (отсрочка) →
// бесплатная проверка карты не прошла (передышка 30 мин) → после передышки проверка прошла → новый оплаченный перелёт → …» стоп был только на
// 4-й отсрочке: 4 оплаченных перелёта (≈400 000 аден; у эпиков — до 4 Coin of Luck в пределах дневного лимита), с прежним общим счётом — 2.
// Теперь вторая отсрочка, перед которой проверка карты после прошлой отсрочки не прошла, — стоп с причиной. Здесь работают настоящие
// selfHoldStart и mapGate из content.js; тур моделируется: перед платным перелётом — mapGate, после перелёта — отсрочка на прилёте.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const E = require('../engine-core.js');
const content = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const slice = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, a); return s.slice(i, j); };
const MIN = 60000;

function core({ tasks = ['raid', 'farm'], rt: rt0 = {}, serverUp = true } = {}) {
  const calls = [], recs = [];
  const c = { L2EngineCore: E, Date, String, Number, Math, Object, Array, JSON, console, Set,
    rt: { char: 'Hero', manualKickAt: 5, ...rt0 }, cfg: { autoTasks: tasks }, on: true, tabOwner: true, LOOP: { holdWaitT: 0 },
    location: { pathname: '/map.html', href: '' }, L2V7Modules: { actions: { canAct: () => true } }, automationGeneration: 0, leaseEpoch: 'e1', antibotState: () => null,
    setRt: async p => { Object.assign(c.rt, JSON.parse(JSON.stringify(p))); return { ok: true }; }, rtCommit: async () => true,
    // мягкий halt: сервер отвечает — бот выключен; не отвечает — ждёт сервер, бот включён (как content.halt)
    halt: async (msg, hard) => { calls.push(['halt', msg, hard]); if (c.serverUp) c.on = false; }, rec: (...a) => recs.push(a[2]), setStatus() {},
    sleep: async () => {}, autonomyMode: () => 'raid', isBattle: () => false, onMap: true, isMap: () => c.onMap, mapOk: true, mapReady: async () => c.mapOk, serverUp };
  vm.createContext(c);
  vm.runInContext(slice(content, 'const SELF_HOLD_STEPS =', '// ---------- переходы') + ';this.start=selfHoldStart;this.gate=mapGate;this.chain=typeof selfHoldMapChain==="function"?selfHoldMapChain:null;this.arriveOk=typeof selfHoldMapOk==="function"?selfHoldMapOk:null;', c);
  return { c, calls, recs };
}
// бесплатная проверка карты перед платным перелётом (content.mapGate): первый круг открывает карту, второй ждёт её загрузку
async function gate(f, kind, ok) {
  f.c.mapOk = ok;
  for (let i = 0; i < 4 && f.c.rt.mapBad?.at && f.c.on; i++) {
    const before = f.c.rt.selfHoldLog?.[kind]?.length || 0;
    assert.equal(await f.c.gate(kind, kind === 'raidMap' ? 'Тур РБ' : 'Эпики'), true);
    if ((f.c.rt.selfHoldLog?.[kind]?.length || 0) > before) return 'hold';
  }
  return f.c.rt.mapBad ? 'wait' : 'ok';
}
// тур/эпики: checks — исход проверок карты после каждой отсрочки по порядку (false — не прошла, передышка; true — прошла), последний повторяется
async function run(f, kind, checks) {
  let flights = 0;
  for (let i = 0; i < 12 && f.c.on; i++) {
    let k = 0;
    while (f.c.rt.mapBad?.at && f.c.on) {
      const ok = checks[Math.min(k++, checks.length - 1)];
      const r = await gate(f, kind, ok);
      if (r === 'hold') { for (const h of Object.values(f.c.rt.selfHold || {})) h.until = Date.now() - 1; await null; }   // передышка прошла
      if (!f.c.on) return flights;
    }
    flights++;   // платный перелёт (≈100 000 аден / Coin of Luck)
    const r = await f.c.start(kind, `${kind === 'raidMap' ? 'Тур РБ' : 'Эпики'}: карта не загрузилась после 3 обновлений (цель ${flights})`, { noWait: true });
    if (r !== 'defer') break;
    f.c.rt.mapBad = { at: Date.now(), why: 'сбой карты', loadAt: 0 };
  }
  return flights;
}

for (const kind of ['raidMap', 'epicMap']) {
  test(`${kind}: «отсрочка → проверка не прошла → проверка прошла → платный перелёт» — стоп после 2 оплаченных перелётов (было 4)`, async () => {
    const f = core();
    const flights = await run(f, kind, [false, true]);
    assert.equal(flights, 2, 'оплаченных перелётов до стопа'); assert.equal(f.c.on, false);
    assert.equal(f.calls.length, 1); assert.match(f.calls[0][1], /и после прошлой такой отсрочки бесплатная проверка карты не прошла: второй оплаченный перелёт подряд без карты, дальше не плачу/);
    assert.equal(f.calls[0][2], false, 'мягкий стоп: при лежащем сервере сначала ждём сервер');
    assert.deepEqual([...f.c.rt.selfHoldDefer[kind]], [], 'настоящий стоп обнуляет счёт отсрочек вида'); assert.deepEqual([...f.c.rt.selfHoldLog[kind]], [], 'и счёт передышек вида');
  });
}

test('один сбой — один счёт: отсрочка и проваленная проверка карты дают передышку 1/3, а не 2/3; стопа нет', async () => {
  const f = core();
  assert.equal(await f.c.start('raidMap', 'Тур РБ: карта не загрузилась после 3 обновлений (цель A)', { noWait: true }), 'defer');
  f.c.rt.mapBad = { at: Date.now(), why: 'сбой', loadAt: 0 };
  assert.equal(await gate(f, 'raidMap', false), 'hold');
  assert.match(f.recs.at(-1), /\(1\/3 за 6 ч\)/); assert.equal(f.calls.length, 0); assert.equal(f.c.on, true);
});

test('отсрочки без проваленной проверки (карта у героя грузится) — прежний предел: стоп на 4-й отсрочке, «3 отсрочки за 6 ч»', async () => {
  const f = core();
  const flights = await run(f, 'raidMap', [true]);
  assert.equal(flights, 4); assert.equal(f.calls.length, 1); assert.match(f.calls[0][1], /3 отсрочки за 6 ч не помогли/);
});

test('проверка прошла с первого раза — вторая отсрочка не стоп', async () => {
  const f = core();
  assert.equal(await f.c.start('raidMap', 'A', { noWait: true }), 'defer');
  f.c.rt.mapBad = { at: Date.now(), why: 'сбой', loadAt: 0 }; assert.equal(await gate(f, 'raidMap', true), 'ok');
  assert.equal(await f.c.start('raidMap', 'B', { noWait: true }), 'defer'); assert.equal(f.calls.length, 0);
});

test('передышка проверки другого вида и старые (> 6 ч) записи цепочку не образуют', async () => {
  const t = Date.now();
  const f = core({ rt: { selfHoldDefer: { raidMap: [t - MIN] }, selfHoldLog: { epicMap: [t - 30000], mob: [t - 20000] } } });
  assert.equal(await f.c.start('raidMap', 'B', { noWait: true }), 'defer', 'проваленная проверка была у эпиков, не у тура');
  const g = core({ rt: { selfHoldDefer: { raidMap: [t - 7 * 60 * MIN] }, selfHoldLog: { raidMap: [t - 6.5 * 60 * MIN] } } });
  assert.equal(await g.c.start('raidMap', 'B', { noWait: true }), 'defer', 'окно 6 ч');
  const h = core({ rt: { selfHoldLog: { raidMap: [t - 2 * MIN] }, selfHoldDefer: { raidMap: [t - MIN] } } });
  assert.equal(await h.c.start('raidMap', 'B', { noWait: true }), 'defer', 'проверка была до отсрочки, а не после');
  assert.equal(typeof h.c.chain, 'function'); assert.equal(h.c.chain('rbExit', t), false); assert.equal(h.c.chain('route:shop', t), false);
});

test('сервер лежит в момент стопа: бот ждёт сервер, счёт прежний — следующая такая отсрочка снова сразу стоп', async () => {
  const f = core({ serverUp: false });
  assert.equal(await run(f, 'raidMap', [false, true]), 2);
  assert.equal(f.c.on, true, 'мягкий halt ушёл в ожидание сервера'); assert.equal(f.calls.length, 1);
  assert.equal(f.c.rt.selfHoldDefer.raidMap.length, 1, 'счёт не сброшен');
  f.c.serverUp = true;
  assert.equal(await f.c.start('raidMap', 'C', { noWait: true }), 'stop'); assert.equal(f.c.on, false);
});

test('после настоящего стопа и нового Старта первая отсрочка карты — обычная отсрочка', async () => {
  const f = core(); await run(f, 'raidMap', [false, true]); assert.equal(f.c.on, false);
  f.c.on = true; f.c.rt.manualKickAt = 6;
  assert.equal(await f.c.start('raidMap', 'после Старта', { noWait: true }), 'defer');
});

test('«подряд»: прилёт с загрузившейся картой между ними обрывает цепочку — вторая отсрочка обычная, стоп только при новой проваленной проверке', async () => {
  const f = core();
  assert.equal(typeof f.c.arriveOk, 'function');
  assert.equal(f.c.arriveOk('raidMap'), null, 'нечего обрывать — без записи');
  assert.equal(await f.c.start('raidMap', 'A', { noWait: true }), 'defer');
  f.c.rt.mapBad = { at: Date.now(), why: 'сбой', loadAt: 0 }; assert.equal(await gate(f, 'raidMap', false), 'hold');
  for (const h of Object.values(f.c.rt.selfHold || {})) h.until = Date.now() - 1;
  assert.equal(await gate(f, 'raidMap', true), 'ok');
  // перелёт к B: карта на прилёте загрузилась (тур/эпики зовут env.mapArriveOk)
  await new Promise(r => setTimeout(r, 2)); const w = f.c.arriveOk('raidMap'); assert.ok(w); await w; assert.ok(f.c.rt.mapArriveOk.raidMap > 0);
  assert.equal(f.c.arriveOk('raidMap'), null, 'повторно не пишет'); assert.equal(f.c.arriveOk('epicMap'), null, 'другой вид — своя цепочка');
  // перелёт к C: карта снова не грузится — это не «второй подряд»
  assert.equal(await f.c.start('raidMap', 'C', { noWait: true }), 'defer'); assert.equal(f.calls.length, 0);
  // но после неё проверка снова не прошла, и следующий оплаченный перелёт без карты — стоп
  f.c.rt.mapBad = { at: Date.now(), why: 'сбой', loadAt: 0 }; await new Promise(r => setTimeout(r, 2)); assert.equal(await gate(f, 'raidMap', false), 'hold');
  for (const h of Object.values(f.c.rt.selfHold || {})) h.until = Date.now() - 1;
  assert.equal(await gate(f, 'raidMap', true), 'ok');
  assert.equal(await f.c.start('raidMap', 'D', { noWait: true }), 'stop'); assert.match(f.calls[0][1], /второй оплаченный перелёт подряд без карты/);
});

test('тур и эпики: карта на прилёте загрузилась — env.mapArriveOk сразу после снятия метки mapBad; геттеры есть', () => {
  const raid = fs.readFileSync(path.join(__dirname, '..', 'modules/raid.js'), 'utf8'), epics = fs.readFileSync(path.join(__dirname, '..', 'modules/epics.js'), 'utf8');
  assert.match(raid, /if \(env\.rt\.mapBad\) \{ await env\.setRt\(\{ mapBad: null \}\);[^\n]*\n[^\n]*\n\s+\{ const ok = env\.mapArriveOk\?\.\('raidMap'\); if \(ok\) \{ await ok; if \(!active\(\) \|\| !sameJob\(\)\) return; \} \}/);
  assert.match(epics, /if \(env\.rt\.mapBad\) \{ await env\.setRt\(\{ mapBad: null \}\);[^\n]*\n[^\n]*\n\s+\{ const ok = env\.mapArriveOk\?\.\('epicMap'\); if \(ok\) \{ await ok; if \(!active\(\)\) return; \} \}/);
  assert.equal((content.match(/get mapArriveOk\(\)\{return selfHoldMapOk\}/g) || []).length, 2);
});
