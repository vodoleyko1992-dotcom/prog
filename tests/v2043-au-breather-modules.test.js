'use strict';
// 20.43 (автономность, разбор 21.10): «передышка» вместо стопа — модули. Карта фарма (клик не открыл бой / бой вернул на карту / список не
// грузится) → передышка 5 → 15 → 30 мин вместо стопа; карта тура/эпика → отсрочка цели на 30 мин, тур идёт дальше; цикл выхода тура →
// РБ отложен на 60 мин; третий цикл маршрута за час → маршрут запрещён на 2 ч. Платное не повторяется, ручная команда меню не запрещается.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const MIN = 60000;

// ---------- mobfarm.map ----------
function farm({ hold = 'hold', holdOn = false, defeat = false } = {}) {
  const box = { console, document: null, Date, JSON, Object, Math, location: { reload() { calls.push('reload'); }, href: '' } }; box.globalThis = box;
  const calls = [], status = [];
  vm.createContext(box); vm.runInContext(read('modules/mobfarm.js'), box);
  const env = { on: true, rt: { char: 'Hero', mobClickAt: 0, bounce: 0 }, cfg: {},
    setRt: async p => { Object.assign(env.rt, p); return { ok: true }; }, setStatus: s => status.push(s), sleep: async () => {}, rnd: () => 0,
    $q: s => (s === '#map-defeat-root' && defeat ? { id: 'defeat' } : null), shown: el => !!el, onDeath: async () => calls.push('death'),
    townBuffStart: async () => { calls.push('townBuff'); return true; }, halt: async s => { calls.push('halt:' + s); env.on = false; },
    ...(hold ? { selfHold: async (kind, why, opt) => { calls.push({ kind, why, opt }); return hold; } } : {}),
    selfHoldOn: k => holdOn && k === 'mob', selfHoldText: h => `Передышка до 12:00: ${h?.why || ''}` };
  const M = box.L2V7Factories.mobfarm(env);
  return { M, env, calls, status };
}
test('mobfarm: бой трижды вернул на карту — передышка вида mob с уходом на /char.html, не стоп', async () => {
  const f = farm(); f.env.rt.mobClickAt = Date.now() - 1000; f.env.rt.bounce = 2;
  await f.M.map();
  const h = f.calls.find(x => typeof x === 'object'); assert.ok(h, 'передышка запрошена');
  assert.equal(h.kind, 'mob'); assert.equal(h.why, 'Клик по мобу 3 раза вернул на карту'); assert.equal(h.opt.page, '/char.html');
  assert.equal(f.env.on, true); assert.ok(!f.calls.some(x => typeof x === 'string' && x.startsWith('halt'))); assert.equal(f.env.rt.bounce, 0);
  // старое ядро без передышек — прежний стоп с советом (проверка сохранена)
  const g = farm({ hold: null }); g.env.rt.mobClickAt = Date.now() - 1000; g.env.rt.bounce = 2; await g.M.map();
  assert.ok(g.calls.includes('halt:Клик по мобу 3 раза вернул на карту — пришлите лог'));
});
test('mobfarm: на передышке карта не кликается и баффер не зовётся — честное ожидание; поражение на карте обрабатывается', async () => {
  const f = farm({ holdOn: true }); f.env.rt.selfHold = { why: 'Клик по мобу 3 раза подряд не открыл бой' }; f.env.rt.mobClickAt = Date.now() - 1000; f.env.rt.bounce = 2;
  await f.M.map();
  assert.deepEqual(f.calls, [], 'ни клика, ни баффера, ни новой передышки'); assert.match(f.status.at(-1), /^Передышка до 12:00: Клик по мобу/); assert.equal(f.env.rt.bounce, 2);
  const d = farm({ holdOn: true, defeat: true }); await d.M.map(); assert.deepEqual(d.calls, ['death']);
});
test('mobfarm (исходник): все четыре прежних стопа карты — через передышку; «Список приоритетов пуст» — по-прежнему стоп', () => {
  const s = read('modules/mobfarm.js');
  assert.match(s, /const mobHold = \(why, advice\) => env\.selfHold \? env\.selfHold\('mob', why, \{ page: '\/char\.html' \}\) : env\.halt\(`\$\{why\} — \$\{advice\}`\);/);
  for (const re of [/await mobHold\('Клик по мобу 3 раза подряд не открыл бой', 'проверьте игру'\); return true;/, /return mobHold\('Клик по мобу 3 раза вернул на карту', 'пришлите лог'\);/,
    /return mobHold\('Список мобов не грузится 15 минут', 'проверьте игру\/интернет'\);/, /return mobHold\('Не вижу список мобов после 3 обновлений карты', 'проверьте игру'\);/]) assert.match(s, re);
  assert.doesNotMatch(s, /env\.halt\('(?:Клик по мобу 3 раза|Список мобов не грузится|Не вижу список мобов)/);
  assert.match(s, /if \(env\.selfHoldOn\?\.\('mob'\)\) \{\s+if \(env\.shown\(env\.\$q\('#map-defeat-root'\)\)\) return env\.onDeath\(\);/);
});

// ---------- raid: отсрочка цели тура ----------
const lifecycle = path.join(__dirname, 'v1021-raid-farm-lifecycle.test.js'), lsrc = fs.readFileSync(lifecycle, 'utf8');
const lbox = { require: require('node:module').createRequire(lifecycle), __dirname, console, process };
vm.runInNewContext(lsrc.slice(0, lsrc.indexOf('\ntest(')) + '\nthis.fixture=fixture', lbox);
test('raid: РБ, отложенный после сбоя (rbSkip {until}), не выбирается туром до конца отсрочки; потом снова доступен', () => {
  const f = lbox.fixture(); const first = f.R.rbTourPlan().ready.map(x => x.id); assert.ok(first.includes('one'), 'без отсрочки «Первый» доступен');
  f.env.rt.rbSkip = { one: { t: Date.now(), until: Date.now() + 30 * MIN, why: 'карта не загрузилась' } };
  const plan = f.R.rbTourPlan(); assert.ok(!plan.ready.some(x => x.id === 'one')); assert.equal(plan.ready[0]?.id, 'two', 'тур идёт дальше');
  const b = plan.blocked.find(x => x.id === 'one'); assert.equal(b.kind, 'skip'); assert.match(b.why, /^отложен: карта не загрузилась/);
  assert.match(f.R.rbEntryDecision('one', f.env.rt.rbList.one).why, /^отложен: карта не загрузилась/);
  f.env.rt.rbSkip.one.until = Date.now() - 1; assert.ok(f.R.rbTourPlan().ready.some(x => x.id === 'one'), 'отсрочка кончилась');
  // старая числовая метка — 30 мин, как раньше
  f.env.rt.rbSkip = { one: Date.now() - 29 * MIN }; assert.equal(f.R.rbEntryDecision('one', f.env.rt.rbList.one).why, 'явный пропуск цели');
});
test('raid: отсрочка действует и в туре вместе с эпиками (не «обычный живой тур»)', () => {
  const f = lbox.fixture({ cfg: { epicMode: true } }); f.env.rt.rbSkip = { one: { t: Date.now(), until: Date.now() + 60 * MIN, why: 'цикл маршрута тура' } };
  const plan = f.R.rbTourPlan(); assert.ok(!plan.ready.some(x => x.id === 'one')); assert.match(plan.blocked.find(x => x.id === 'one')?.why || '', /отложен: цикл маршрута тура/);
});

// ---------- actions: запрет маршрута ----------
function actions(saved = {}) {
  const box = { Date, JSON, Object, Proxy }; vm.runInNewContext(read('modules/actions.js'), box);
  const calls = [], recs = [], holds = [];
  const env = { rt: { char: 'Hero', ...saved }, cfg: {}, on: true, tabOwner: true, mode: () => 'farm', lease: () => 'a', page: () => '/map.html', id: () => String(Math.random()),
    setRt: async p => { Object.assign(env.rt, p); return { ok: true }; }, rtCommit: async () => true, rec: (...a) => recs.push(a.join(' ')), setStatus() {},
    halt: async s => { calls.push('halt:' + s); env.on = false; }, isBattle: () => false, interrupted: () => false, paymentPending: () => null, reconcile: async () => {},
    selfHold: async (kind, why, opt) => { holds.push({ kind, why, opt }); return 'hold'; },
    pauseBot: async (msg, opt) => { calls.push({ pause: msg, opt }); env.on = false; },
    jobs: () => ['tbuff', 'shop', 'invScan', 'rbHunt'].map(key => ({ key, run: async () => calls.push(key) })) };
  const A = box.L2V7Factories.actions(env); A.enterFrame();
  return { A, env, calls, recs, holds };
}
// 20.43 (автономность, ревью 21.10): 10-й запрос запрещённого маршрута раньше давал передышку текущей основной задаче (фарму), а служба
// продолжала проситься — тупик. Теперь 10 запросов за 1 мин — пауза с причиной (pauseBot fault), передышки задаче нет (проверка изменена)
test('actions: запрещённый маршрут снимается до запуска, в журнал — один раз; 10 запросов за 1 мин — пауза с причиной, не передышка задачи', async () => {
  const until = Date.now() + 90 * MIN, f = actions({ actionBan: { shop: { t: 1, until, why: 'цикл магазина' } } });
  for (let i = 1; i <= 10; i++) { f.env.rt.shop = { step: 'buy', t: i }; assert.equal(await f.A.dispatch(), true); assert.equal(f.env.rt.shop, null); }
  assert.ok(!f.calls.includes('shop'), 'маршрут ни разу не запущен');
  assert.equal(f.recs.filter(r => /маршрут shop запрещён до \d\d:\d\d \(цикл магазина\)/.test(r)).length, 1, 'в журнал — один раз');
  assert.equal(f.holds.length, 0, 'передышки основной задаче нет');
  const pause = f.calls.find(c => c?.pause); assert.ok(pause, 'пауза с причиной'); assert.equal(pause.opt.fault, true);
  assert.match(pause.pause, /^Маршрут shop запрещён после циклов \(до \d\d:\d\d\), но его снова создают — 10 раз за 1 мин/);
  assert.equal(f.env.rt.actionBan.shop.asks, 0, 'после паузы счёт запросов заново'); f.env.on = true;
  // явная команда меню (urgent/manual) запретом не задерживается
  f.env.rt.shop = { step: 'buy', t: 99, urgent: true }; await f.A.dispatch(); assert.ok(f.calls.includes('shop'));
  // запрет кончился — маршрут снова работает
  const g = actions({ actionBan: { invScan: { t: 1, until: Date.now() - 1 } } }); g.env.rt.invScan = { t: 1, step: 'scan' }; await g.A.dispatch(); assert.ok(g.calls.includes('invScan'));
});
test('actions: запрет баффера держит и сторожа баффов (tbPauseUntil), чтобы маршрут не создавался по кругу', async () => {
  const until = Date.now() + 100 * MIN, f = actions({ actionBan: { tbuff: { t: 1, until } }, tbPauseUntil: 0 });
  f.env.rt.tbuff = { step: 'fa', t: 1 }; await f.A.dispatch(); assert.equal(f.env.rt.tbuff, null); assert.equal(f.env.rt.tbPauseUntil, until);
});

// ---------- epics (исходник; поведение — tests/v1027-epic-route-context) ----------
test('epics: карта после 3 обновлений — отсрочка эпика на 30 мин через учёт передышки, пауза только у старого ядра', () => {
  const s = read('modules/epics.js');
  assert.match(s, /const EPIC_MAP_WAITS = \[30000, 60000, 120000\];/);
  // 20.43 (ревью au/breather): между учётом и отсрочкой — метка «карта не подтверждена» (rt.mapBad), поведение — v2043-au-breather-review
  // 20.43 (доводка 21.10): после платного перелёта (страница/логово) — общее правило epicArriveFail (страницей второй раз не идём, промах
  // логова учитывается), отсрочка на 30 мин — только для дороги «он на этой карте»; поведение — v2043-fx-raid-epics
  assert.match(s, /const EPIC_MAP_WHY = 'карта не загрузилась после 3 обновлений';/);
  assert.match(s, /const held = await env\.selfHold\('epicMap', `Эпики: карта не загрузилась после 3 обновлений \(цель \$\{e\.nm\}\)`, \{ noWait: true \}\);\s+if \(held !== 'defer' \|\| !active\(\)\) return;[\s\S]{0,400}await env\.setRt\(\{ mapBad: \{ at: Date\.now\(\), why: `эпики, \$\{e\.nm\}`, loadAt: 0 \} \}\);\s+if \(!active\(\)\) return;[\s\S]{0,700}if \(E\.via === 'page' \|\| E\.via === 'zone'\) return epicArriveFail\(E, e, EPIC_MAP_WHY, \{ map: true \}\);\s+return epicGiveUp\(E\.k, 30, EPIC_MAP_WHY, epicMapFailMark\(E\)\);/);
});
