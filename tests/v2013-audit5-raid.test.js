'use strict';
// 20.13 (ревизия 17.10, шаг 5, участок raid): застревания тура РБ/баффера/эпиков и устойчивость.
// RB-3 нет FA → простой тура (не пауза бота), BF-1 недоступная кнопка/вечное ожидание баффера, BF-2 снимок без срока и
// режим «после отмены» ≤3 мин, EP-2 фулл бафф перед эпиком не зависит от случайной свежести опроса, RB-5 нарастающая пауза
// после фактических смертей на РБ, TM-1 опрос пустой очереди тура — не больше 2 страниц за раз.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const H6 = 6 * 3600000, MIN = 60000;

// ---------- стенд buffs (как v1028-buff-interruption) ----------
function buffsFixture({ cfg = {}, rt = {}, button = null, balance = '1000', response = null } = {}) {
  const now = Date.now(), H = {}, writes = [], clicks = [], route = { pathname: '/map.html', href: '' }, recs = [];
  const box = { console, Date, document: { querySelectorAll: () => [] } };
  vm.runInNewContext(read('modules/buffs.js'), box);
  const hud = { querySelectorAll: () => Object.entries(H).map(([id, e]) => ({ dataset: { skillId: id, expiresAt: e }, getAttribute: () => 'Buff Lv.3' })) };
  const env = { on: true, tabOwner: true, leaseEpoch: 1, cfg: { townBuffSet: 'off', faBuffs: '1059', ...cfg }, rt: { char: 'Hero', manualKickAt: 1, ...rt },
    TB_KEYS: { basic: [] }, IL: {}, FA_KNOWN: {}, routeLocation: route,
    setRt: async p => { writes.push(p); Object.assign(env.rt, p); return { ok: true }; }, faCost: () => 1, heroRole: () => 'mage', autonomyMode: () => 'raid',
    rec: (...a) => recs.push(a.join(' ')), setStatus() {}, sleep: async () => {}, pause: async () => {}, rnd: () => 0, waitX: async f => f(), fire: b => { clicks.push(b); return true; },
    $q: s => s === '#l2-hud-active-buffs' ? hud : s === '#fast-aden-balance' ? { textContent: balance } : s.startsWith('.l2-fa-buy') ? button : null,
    payments: { blocked: () => false }, gameGet: async () => ({ ok: true, json: async () => response || { character: { name: 'Hero', activeBuffs: [] } } }) };
  return { env, H, writes, clicks, route, recs, now, B: box.L2V7Factories.buffs(env) };
}

test('RB-3: FA с мобов после записи баланса делают прежний «0» неизвестным; faWanted снова идёт к бафферу', () => {
  const f = buffsFixture({ rt: { faBal: { v: 0, t: Date.now(), d: 2 }, faDrop: { f: { mob: 2 } } } });
  assert.equal(f.B.faBalOf(), 0, 'без новых FA баланс 0 известен');
  assert.deepEqual(Array.from(f.B.faWanted()), [], 'FA точно не хватит — к бафферу не ходим (как прежде)');
  f.env.rt.faDrop = { f: { mob: 2, blue: 1 } };
  assert.equal(f.B.faBalOf(), null, 'после записи выпал FA — баланс неизвестен');
  assert.deepEqual(Array.from(f.B.faWanted()), [1059]);
  // старая запись без отметки d — прежнее правило 6 ч
  f.env.rt.faBal = { v: 0, t: Date.now() }; assert.equal(f.B.faBalOf(), 0);
  f.env.rt.faBal = { v: 0, t: Date.now() - H6 - 1 }; assert.equal(f.B.faBalOf(), null);
});

test('RB-3: запись баланса у баффера помнит сумму FA с мобов', async () => {
  const button = { disabled: false, dataset: { skillId: '1059', cost: '1' } };
  const f = buffsFixture({ button, balance: '0', rt: { tbuff: { t: 1, step: 'fa', fa: [1059] }, faDrop: { f: { mob: 3, red: 2 } } } });
  f.route.pathname = '/fast-aden-buffer.html';
  await f.B.townBuffStep();
  assert.equal(f.env.rt.faBal.v, 0); assert.equal(f.env.rt.faBal.d, 5);
  assert.equal(f.clicks.length, 0);
});

test('BF-1: кнопка FA-баффа недоступна при достаточном балансе — пропуск 6 ч (faGone), при нехватке FA — не помечается', async () => {
  const button = { disabled: true, dataset: { skillId: '1059', cost: '1' } };
  const f = buffsFixture({ button, balance: '50', rt: { tbuff: { t: 1, step: 'fa', fa: [1059] } } });
  f.route.pathname = '/fast-aden-buffer.html';
  await f.B.townBuffStep();
  assert.ok(f.env.rt.faGone[1059] > 0, 'недоступный бафф помечен');
  assert.equal(f.clicks.length, 0);
  assert.deepEqual(Array.from(f.B.faWanted()), [], 'и больше не требуется 6 ч');
  const poor = buffsFixture({ button: { disabled: true, dataset: { skillId: '1059', cost: '5' } }, balance: '1', rt: { tbuff: { t: 1, step: 'fa', fa: [1059] } } });
  poor.route.pathname = '/fast-aden-buffer.html';
  await poor.B.townBuffStep();
  assert.equal(poor.env.rt.faGone?.[1059], undefined, 'нехватка FA — не «нет у баффера»');
});

test('BF-2: эффект без срока в /character не бракует снимок после отмены маршрута', async () => {
  const f = buffsFixture({ rt: { tbT: Date.now() - 50000, tbFail: 0, tbInterrupted: { t: Date.now(), jobT: 1 } },
    response: { character: { name: 'Hero', activeBuffs: [{ skillId: 9001, level: 1, expiresAtMs: null }, { skillId: 1059, level: 3, expiresAtMs: Date.now() + 3 * 3600000 }] } } });
  f.H[1059] = Date.now() + 3 * 3600000;
  assert.equal(await f.B.townBuffStart('перед РБ X', true), false, 'снимок принят, покупать нечего');
  assert.equal(f.env.rt.tbInterrupted, null, 'отметка отмены снята');
  assert.equal(f.route.href, '');
});

test('BF-2: режим «после отмены» ограничен 3 мин — затем обычное решение, без вечного «сверяю эффекты»', async () => {
  const f = buffsFixture({ rt: { tbT: Date.now() - 20 * MIN, tbFail: 0, tbInterrupted: { t: Date.now() - 4 * MIN, jobT: 1 } } });
  f.env.gameGet = async () => ({ ok: false, json: async () => null });   // сервер снимка не даёт
  assert.equal(await f.B.townBuffStart('перед РБ X', true), true);
  assert.equal(f.env.rt.tbInterrupted, null);
  assert.equal(f.route.href, '/fast-aden-buffer.html', 'обычный поход (повтор покупки стережёт payments)');
  assert.match(f.recs.join('\n'), /не завершилась за 3 мин/);
  // свежая отмена по-прежнему ждёт снимка
  const g = buffsFixture({ rt: { tbInterrupted: { t: Date.now(), jobT: 1 } } }); g.env.gameGet = async () => ({ ok: false, json: async () => null });
  assert.equal(await g.B.townBuffStart('перед РБ X', true), true); assert.ok(g.env.rt.tbInterrupted); assert.equal(g.route.href, '');
});

test('EP-2: решение «набор перед эпиком» фиксируется в tbuff и не пропадает, когда ответ сервера старше 3 мин', async () => {
  let ok = true;
  const f = buffsFixture({ cfg: { faBuffs: '', epicMode: true, rbSessBuffs: '1059' }, rt: { epic: { k: 'orfen', step: 'prep' } } });
  f.env.epicFaOk = () => ok;
  assert.equal(await f.B.townBuffStart('перед эпиком Орфен', true), true);
  assert.equal(f.env.rt.tbuff.epicFa, true);
  ok = false;   // прошло > 3 мин с опроса
  assert.deepEqual(Array.from(f.B.faWanted()), [1059], 'шаг FA у баффера всё ещё хочет набор эпика');
  f.env.rt.tbuff.t = Date.now() - 16 * MIN; assert.deepEqual(Array.from(f.B.faWanted()), [], 'старый поход (15 мин) не держит решение');
  f.env.rt.tbuff.t = Date.now(); f.env.rt.epic.step = 'pick'; assert.deepEqual(Array.from(f.B.faWanted()), [], 'эпик не выбран — решения нет');
});

test('EP-2: подготовка к эпику при включённом фулл баффе за FA освежает список эпиков бесплатным GET', async () => {
  const { mk, fx } = require('./epic-harness.cjs');
  const run = async cfg => {
    const m = mk({ cfg: { epicCoinDailyMax: 0, ...cfg }, rt: { epicDb: { orfen: { id: 'l2dop_rb_29014', apiT: Date.now() - 10 * MIN, alive: true } }, epic: { step: 'prep', k: 'orfen', route: 'here' } },
      env: { faFullIds: () => [1413] }, net: u => /epic-bosses/.test(u) ? fx : null });
    await m.E.epicStep();
    return m.calls.filter(u => /\/game\/epic-bosses/.test(u)).length;
  };
  assert.equal(await run({}), 1, 'фулл бафф за FA включён (по умолчанию) — опрос перед баффером');
  assert.equal(await run({ epicFaFull: false }), 0, 'выключен и платного набора нет — без лишнего GET');
});

// ---------- тур РБ (стенд v1021-raid-buff-order) ----------
function raidFixture(extra = {}) {
  const { mk } = require('./epic-harness.cjs');
  const row = { name: 'Boss', lvl: 72, page: 11, alive: true, price: 100000, unit: 'аден', t: Date.now() };
  let pauses = 0, buffCalls = 0, need = extra.need ?? null;
  const m = mk({ hero: 77, cfg: { epicMode: false, rbHuntMode: true, rbMode: true, rbFaFull: true, petFullAuto: false, shopAuto: false, rbRestHp: 95 },
    rt: { char: 'Warlock', classCur: { prof: 'human_arcana_lord', slot: 0 }, rbHunt: { step: 'pick' }, rbListT: Date.now(), rbList: { boss: row },
      rbStats: { boss: { hp: 5500000, patk: 5000, matk: 2500, pdef: 9000, mdef: 10000, src: 'api' } }, rbDb: {}, adenaSeen: { v: 20000000, t: Date.now() },
      rbDpsSample: { id: 'old', powerKey: 'same', dps: 60000, target: { lvl: 72, pdef: 9000, mdef: 10000 }, t: Date.now() }, ...(extra.rt || {}) },
    env: { tabOwner: true, warlock: { raidContext: () => ({ managed: true, key: 'same', powerKey: 'same', prepared: true }), step: async () => false, summary: () => ({ status: 'active', expiresAt: Date.now() + 3600000 }) },
      townBuffStart: async () => { buffCalls++; return false; }, townBuffNeed: () => need,
      potModel: () => ({ pool: 600000, rate: 2000, n: 500, H: 1200, C: 1, items: [] }), faFullIds: () => [1323, 1413], hudBuffs: () => ({}),
      gameGet: async () => ({ ok: true, json: async () => ({ character: { name: 'Warlock', inBattle: false, adena: 20000000 } }) }),
      meHp: () => ({ cur: 14917, max: 14917, pct: 100 }), meMp: () => ({ cur: 5408, max: 5408 }), logLines: () => [], newLines: () => [], activeBuffs: () => [],
      pauseBot: async () => { pauses++; }, ...(extra.env || {}) } });
  return { ...m, pauses: () => pauses, buffCalls: () => buffCalls, setNeed: v => { need = v; } };
}

test('RB-3: нет FA на выбранный набор — тур в простое 10 мин, бот не на паузе; ждёт FA, а не живого РБ', async () => {
  const f = raidFixture({ rt: { faBal: { v: 0, t: Date.now(), d: 0 } } });
  await f.R.rbHuntStep();
  assert.equal(f.pauses(), 0, 'pauseBot не вызван');
  assert.ok(f.env.rt.rbHuntIdle > Date.now() + 9 * MIN, 'простой тура');
  assert.equal(f.env.rt.rbIdleMark.faShort, true);
  assert.equal(f.env.rt.rbHunt.step, 'pick'); assert.equal(f.fires.length, 0);
  assert.match(f.logs.join('\n'), /нет FA для выбранного баффа/);
  // живой РБ в очереди не будит простой, пока FA не появились
  await f.R.rbHuntStep(); assert.ok(f.env.rt.rbHuntIdle > Date.now(), 'простой держится');
  // FA с мобов — простой снят сразу
  f.env.rt.faDrop = { f: { mob: 1 } };
  await f.R.rbHuntStep(); assert.equal(f.env.rt.rbHuntIdle, 0, 'новые FA будят тур');
});

test('RB-3: баффы, которых нет у баффера (faGone), не создают нехватку; при достаточном балансе нехватки нет', () => {
  const f = raidFixture({ rt: { faBal: { v: 0, t: Date.now() }, faGone: { 1323: Date.now(), 1413: Date.now() } } });
  assert.equal(f.R.rbBuffShortage(), 0);
  f.env.rt.faGone = { 1323: Date.now() }; assert.equal(f.R.rbBuffShortage(), 1);
  f.env.rt.faBal = { v: 3, t: Date.now() }; assert.equal(f.R.rbBuffShortage(), 0, 'на дешёвый бафф FA хватает — купит');
  f.env.faCost = () => 5; assert.equal(f.R.rbBuffShortage(), 1, 'не хватает даже на самый дешёвый — нехватка (как отказ faWanted)');
  f.env.rt.faBal = { v: 0, t: Date.now() - H6 }; assert.equal(f.R.rbBuffShortage(), 0, 'старый баланс неизвестен');
});

test('BF-1: баффер 15 мин не даёт нужное — тур идёт без недостающих баффов, через час снова пробует', async () => {
  const f = raidFixture({ need: { fa: [1413] }, env: { hudBuffs: () => ({ 1323: Date.now() + 3600000, 1413: Date.now() + 3600000 }) } });
  await f.R.rbHuntStep();
  assert.equal(f.env.rt.rbHunt.phase, 'prepare'); assert.equal(f.env.rt.rbHunt.step, 'pick'); assert.equal(f.env.rt.rbBuffWait.name, 'Boss');
  f.env.rt.rbBuffWait.t = Date.now() - 16 * MIN;
  const calls = f.buffCalls();
  await f.R.rbHuntStep();
  assert.equal(f.env.rt.rbHunt.step, 'go', 'после 15 мин ожидания — к РБ');
  assert.equal(f.buffCalls(), calls, 'баффер в этот раз не зовём');
  assert.match(f.logs.join('\n'), /не дал нужные баффы.*иду без них/);
  f.env.rt.rbBuffWait.t = Date.now() - 61 * MIN; f.env.rt.rbHunt = { step: 'pick' };
  await f.R.rbHuntStep();
  assert.equal(f.env.rt.rbHunt.step, 'pick', 'через час — снова ждём баффера');
  assert.ok(Date.now() - f.env.rt.rbBuffWait.t < MIN);
});

test('RB-5: фактические смерти на одном РБ при том же уровне героя — пауза 30 мин → 2 ч → 6 ч; новый уровень — заново', () => {
  const f = raidFixture({ cfg: {} });
  const now = Date.now(), d = n => ({ deathAt: now - 40 * MIN, deathLog: Array.from({ length: n }, (_, i) => ({ t: now - (40 + i) * MIN, lvl: 77 })) });
  assert.equal(f.R.rbDeathPauseMs(d(1)), 30 * MIN);
  assert.equal(f.R.rbDeathPauseMs(d(2)), 2 * 3600000);
  assert.equal(f.R.rbDeathPauseMs(d(3)), 6 * 3600000);
  f.setHero(78); assert.equal(f.R.rbDeathPauseMs(d(3)), 30 * MIN, 'другой уровень героя — прежние смерти не в счёт');
  f.setHero(77);
  f.env.rt.rbDb = { boss: d(2) };
  const plan = f.R.rbTourPlan();
  assert.equal(plan.ready.length, 0, 'через 40 мин после второй смерти РБ ещё не готов');
  assert.match(JSON.stringify(plan.blocked), /2 подтверждённые смерти/);
  f.env.rt.rbDb = { boss: d(1) };
  assert.equal(f.R.rbTourPlan().ready.length, 1, 'одна смерть 40 мин назад — пауза 30 мин прошла');
});

test('RB-5: rbNote ведёт журнал смертей на РБ', async () => {
  const f = raidFixture();
  await f.R.rbNote('boss', { note: 'убил героя спецударом' });
  await f.R.rbNote('boss', { note: 'убил героя спецударом' });
  assert.equal(f.env.rt.rbDb.boss.deathLog.length, 2); assert.equal(f.env.rt.rbDb.boss.deathLog[0].lvl, 77);
});

// ---------- TM-1: rbtimer ----------
test('TM-1: опрос пустой очереди — не больше 2 страниц за раз, страницы с наступающим респом первыми', async () => {
  let now = Date.UTC(2026, 9, 17, 3, 0);
  const store = new Map(), gets = [];
  const box = { Date: class extends Date { static now() { return now; } }, console, sessionStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) } };
  box.globalThis = box; vm.runInNewContext(read('modules/rbtimer.js'), box);
  const row = (lvl, page) => ({ name: 'B' + page, lvl, page, alive: false, price: 100000, unit: 'аден', t: now });
  const dead = (killedAgo) => ({ n: 'B', l: 70, al: false, dl: now - killedAgo, dh: now - killedAgo, ls: now });
  const rbList = {}, b = {};
  for (let p = 5; p <= 12; p++) { rbList['rb' + p] = row(65 + p - 5, p); b['rb' + p] = dead(MIN); }   // все убиты только что — респ через часы
  b.rb9 = dead(9 * 3600000);   // у этого окно респа уже открыто
  const env = { cfg: { rbMaxBelow: 15, rbMaxAbove: 15, rbRespH: 8 }, rt: { lvl: 70, rbList, rbTimer: { b, pg: {} } }, RB_WIN: 15, heroLevel: () => 70, rec() {}, sleep: async () => {},
    setRt: async p => { Object.assign(env.rt, p); }, gameGet: async url => { gets.push(+url.split('=').pop()); return { ok: true, json: async () => ({ page: +url.split('=').pop(), bosses: [] }) }; } };
  const T = box.L2V7Factories.rbtimer(env);
  assert.deepEqual(Array.from(T.tourPages()), [5, 6, 7, 8, 9, 10, 11, 12], 'окно страниц прежнее');
  await T.tourTick({ active: () => true });
  assert.ok(gets.length <= 2, `за опрос ${gets.length} GET`);
  assert.equal(gets[0], 9, 'страница с открытым окном респа — первой');
  for (let i = 0; i < 8; i++) { now += 30000; await T.tourTick({ active: () => true }); }
  assert.ok(gets.length <= 18);
  assert.equal(gets.filter(p => p === 9).length >= 8, true, 'наступающий респ проверяется каждый раз');
  assert.deepEqual([...new Set(gets)].sort((a, c) => a - c), [5, 6, 7, 8, 9, 10, 11, 12], 'остальные страницы не забыты');
});

// ---------- ревью шага 5 ----------
test('ревью BF-1: кнопка погашена на время перерисовки — короткое ожидание, покупка, без пометки на 6 ч', async () => {
  const button = { disabled: true, dataset: { skillId: '1059', cost: '1' } };
  const f = buffsFixture({ button, balance: '50', rt: { tbuff: { t: 1, step: 'fa', fa: [1059] } } });
  f.env.payments = null;
  f.env.waitX = async fn => { if (/disabled/.test(String(fn))) button.disabled = false; return fn(); };   // оживает только в ожидании самой кнопки
  f.route.pathname = '/fast-aden-buffer.html';
  await f.B.townBuffStep();
  assert.equal(f.clicks.length, 1, 'кнопка ожила — куплено');
  assert.equal(f.env.rt.faGone?.[1059], undefined, 'не помечено «недоступна»');
});

test('ревью RB-3/BF-1: истёкшее ожидание баффера не уводит тур к РБ без FA при нулевом балансе — простой, без круга pick↔go', async () => {
  const f = raidFixture({ need: { fa: [1413] }, rt: { faBal: { v: 0, t: Date.now(), d: 0 }, rbBuffWait: { name: 'Boss', t: Date.now() - 16 * MIN } } });
  await f.R.rbHuntStep();
  assert.notEqual(f.env.rt.rbHunt.step, 'go', 'без FA к РБ не летим');
  assert.ok(f.env.rt.rbHuntIdle > Date.now() + 9 * MIN, 'простой тура');
  assert.equal(f.env.rt.rbBuffWait, null, 'ожидание баффера сброшено');
  assert.equal(f.pauses(), 0); assert.equal(f.fires.length, 0);
  assert.doesNotMatch(f.logs.join('\n'), /иду без них/);
});
