'use strict';
// 20.43 (автономность, доводка 21.10, ревью fx/hold): три находки ревьюера.
// 1) Сохранённый rbHunt после передышки сам по себе повторную оплату не убирал: [тур, рыбалка], stall-передышка тура на шаге arrive/fight
//    после подтверждённого платного перелёта, рыбалка увела вкладку на /fishing.html. После передышки arrive видел прилёт старше 60 с не на
//    карте и сдавался («после телепорта не попал на карту», rbGoTried) → выбор вне карты → шаг go и платный телепорт к другому РБ; fight
//    сразу уходил в выбор вне карты → платный телепорт даже к тому же раненому РБ рядом. Теперь (content: loopSelfHold → rt.rbResume →
//    raidResumeMap перед шагом тура) сначала бесплатно /map.html, затем тур решает сам — на настоящем raid.js.
// 2) «Пауза» ЛС, нажатая во время POST/снимка, «Сверить» и «Учесть попытку» игрока — удержание остаётся (userHold), «Продолжить» доступно;
//    автоматическая пауза сбоя по-прежнему отпускает бота к задачам.
// 3) Настоящий стоп по передышкам/отсрочкам обнуляет счёт вида в обоих журналах (selfHoldLog и selfHoldDefer).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const E = require('../engine-core.js');
const { mk, docOf } = require('./epic-harness.cjs');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8'), clone = x => JSON.parse(JSON.stringify(x));
const content = read('content.js');
const slice = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, a); return s.slice(i, j); };
const MIN = 60000;

// ---------- 1) тур после передышки: настоящий raid.js (стенд v1021-raid-farm-lifecycle) + шаги ядра loopSelfHold/raidResumeMap ----------
const stats = { hp: 5500000, patk: 5000, matk: 2500, pdef: 9000, mdef: 10000, src: 'api' };
const row = (name, lvl, page = 1) => ({ name, lvl, page, alive: true, price: 100000, unit: 'аден', t: Date.now() });
const pin = (id, name) => `<button class="l2-map-mob-pin l2-map-mob-pin--raid" data-spawn-id="${id}" title="${name} · ур. 80 · рейд-босс"></button>`;
function fixture(rt = {}) {
  let inBattle = false;
  const m = mk({ hero: 80, cfg: { epicMode: false, rbHuntMode: true, rbMode: true, rbProbe: true, rbMaxKillMin: 20, rbMaxBelow: 12, rbMaxAbove: 12,
    rbRestHp: 95, rbRetreatHp: 20, stopHp: 25, shopAuto: false, shopReserve: 200000, shopMaxSpend: 2000000 },
  rt: { char: 'TestHero', classCur: { prof: 'human_arcana_lord', slot: 0 }, rbListT: Date.now(), rbStats: { one: { ...stats }, two: { ...stats } },
    rbList: { one: row('Первый', 80), two: row('Второй', 81) }, rbDb: {}, rbK: .109, rbDps: 6000, rbDpsContext: 'wrong',
    rbDpsSample: { id: 'two', powerKey: 'P', dps: 67000, target: { lvl: 80, pdef: 9000, mdef: 10000 }, t: Date.now() },
    adenaSeen: { v: 1000000, t: Date.now() }, rbGoCnt: { one: [Date.now() - 25 * MIN] }, rbPaidAt: Date.now() - 25 * MIN, rbWant: 'one', ...rt },
  meHp: () => ({ cur: 14917, max: 14917, pct: 100 }),
  env: { RB_WIN: 15, RB_RETRY_MS: 120000, RB_TRY_MS: 600000, tabOwner: true, isBattle: () => inBattle, epicOn: () => false,
    warlock: { raidContext: (id, st, opts) => ({ managed: true, key: `${id}:P`, powerKey: 'P', prepared: true, planned: !!opts?.preflight && !inBattle }), noteSnapshot() {} },
    gameGet: async () => ({ ok: true, json: async () => ({ character: { name: 'TestHero', inBattle: false, adena: 1000000 } }) }),
    hudBuffs: () => ({}), potModel: () => ({ pool: 600000, rate: 2000, n: 500, H: 1200, C: 1, est: false, items: [] }),
    waitFor: async fn => fn(), logLines: () => [], newLines: () => [], activeBuffs: () => [] } });
  m.env.map = async () => {}; m.env.rbNote = m.R.rbNote;
  m.env.attackSpawn = async () => { inBattle = true; return true; };
  m.loc.pathname = '/fishing.html';   // рыбалка увела вкладку, пока тур ждал
  // все шаги тура, записанные в память (шаг go = путь к платному телепорту), и клики телепорта списка РБ (клик пина карты — бесплатный бой)
  m.huntSteps = []; const set = m.env.setRt; m.env.setRt = async p => { if (p?.rbHunt?.step) m.huntSteps.push(p.rbHunt.step); return set(p); };
  m.teleports = () => m.fires.filter(e => /l2-rb-row__tp/.test(e.className || '')).length;
  return m;
}
// Шаги ядра из content.js на общей памяти и адресе стенда raid
function core(m, cfg = { autoTasks: ['raid', 'fish'] }) {
  const recs = [], status = [];
  const c = { L2EngineCore: E, Date, String, Number, Math, Object, Array, JSON, console, Set, cfg, LOOP: { holdWaitT: 0 }, on: true, tabOwner: true,
    get rt() { return m.env.rt; }, location: m.loc, L2V7Modules: { actions: { canAct: () => true } }, automationGeneration: 0, leaseEpoch: 'e1',
    setRt: async p => { Object.assign(m.env.rt, clone(p)); return { ok: true }; }, rtCommit: async () => true, antibotState: () => null,
    rec: (...a) => recs.push(a[2]), setStatus: s => status.push(s), sleep: async () => {}, autonomyMode: () => E.selectedTask(cfg, m.env.rt),
    isMap: () => m.loc.pathname === '/map.html', isBattle: () => false, battle: async () => {}, isFishing: () => m.loc.pathname === '/fishing.html', fishState: () => null,
    fishFight: async () => { c.fished = (c.fished || 0) + 1; }, halt: async () => {} };
  vm.createContext(c);
  vm.runInContext(slice(content, 'const SELF_HOLD_STEPS =', '// ---------- переходы') + '\n' + slice(content, 'async function loopSelfHold() {', '// Режим «Задачи бота»')
    + ';this.loop=loopSelfHold;this.resume=typeof raidResumeMap==="function"?raidResumeMap:null;', c);
  assert.equal(typeof c.resume, 'function', 'шаг raidResumeMap есть');
  return { c, recs, status };
}
const endedHold = (task = 'raid') => ({ [task]: { kind: 'stall', why: 'нет прогресса 9 мин после 3 восстановлений', at: Date.now() - 21 * MIN, until: Date.now() - 1000, n: 1, task, kick: 0 } });
const arrive = () => ({ step: 'arrive', phase: 'arrive', id: 'one', name: 'Первый', lvl: 80, page: 1, price: 100000, at: Date.now() - 25 * MIN, t: Date.now() - 25 * MIN });
const fight = () => ({ step: 'fight', phase: 'engage', id: 'one', name: 'Первый', lvl: 80, page: 1, kills0: 0, fightAt: Date.now() - 24 * MIN, t: Date.now() - 24 * MIN });
async function steps(m, n = 4) { for (let i = 0; i < n && !['go', 'fight'].includes(m.env.rt.rbHunt?.step) || i === 0; i++) await m.R.rbHuntStep(); }

test('контраст (прежнее поведение): прилёт после передышки не на карте сдаётся, следующий круг — шаг go и платный телепорт к другому РБ', async () => {
  const m = fixture({ rbHunt: arrive() });
  await m.R.rbHuntStep();
  assert.match(m.env.rt.rbHunt.last, /после телепорта не попал на карту/); assert.ok(m.env.rt.rbGoTried?.one > 0);
  await m.R.rbHuntStep(); assert.equal(m.env.rt.rbHunt.step, 'go'); assert.equal(m.env.rt.rbHunt.id, 'two', 'цель — другой РБ, к нему платный телепорт');
});

test('[тур, рыбалка], передышка тура на шаге arrive: после неё бесплатно карта, тот же РБ найден на карте — без шага go и без телепорта', async () => {
  const m = fixture({ rbHunt: arrive(), selfHold: endedHold('raid') }), k = core(m);
  await k.c.loop();
  assert.equal(m.env.rt.selfHold, null); assert.deepEqual({ id: m.env.rt.rbResume?.id, step: m.env.rt.rbResume?.step }, { id: 'one', step: 'arrive' }, 'метка возобновления тура');
  // вкладка на рыбалке: сначала бесплатный переход на карту, одна строка журнала
  assert.equal(await k.c.resume(), true); assert.equal(m.loc.href, '/map.html'); assert.ok(m.env.rt.rbResume.navAt > 0);
  assert.equal(k.recs.filter(r => /передышка окончена — сначала бесплатно открываю карту здесь/.test(r)).length, 1, k.recs.join('\n'));
  assert.equal(await k.c.resume(), true, 'переход ещё идёт — ждём, ничего не решаем'); assert.equal(m.fires.length, 0); assert.equal(m.huntSteps.length, 0);
  // карта открылась: прилёт со свежим окном, метка снята, решает тур
  m.loc.pathname = '/map.html'; m.setDoc(docOf(pin('one', 'Первый')));
  assert.equal(await k.c.resume(), false); assert.equal(m.env.rt.rbResume, null); assert.ok(Date.now() - m.env.rt.rbHunt.at < 5000, 'окно прилёта обновлено');
  await m.R.rbHuntStep();
  assert.equal(m.env.rt.rbHunt.step, 'fight'); assert.equal(m.env.rt.rbHunt.id, 'one'); assert.equal(m.teleports(), 0, 'телепорта нет');
  assert.ok(!m.huntSteps.includes('go'), m.huntSteps.join());
  assert.equal(m.env.rt.rbGoTried?.one, undefined); assert.equal(m.env.rt.rbGoCnt.one.length, 1, 'счётчик платных перелётов прежний');
  assert.ok(!m.logs.some(l => /не попал на карту|телепорт к/.test(l)), m.logs.join('\n'));
});

test('[тур, рыбалка], передышка тура на шаге fight у раненого РБ: без карты — платный go к нему же; с картой после передышки — «он здесь», без телепорта', async () => {
  const wound = { one: { cur: 2750000, max: 5500000, t: Date.now() - MIN, name: 'Первый' } };
  const a = fixture({ rbHunt: fight(), rbWound: clone(wound) });
  await steps(a); assert.equal(a.env.rt.rbHunt.step, 'go'); assert.equal(a.env.rt.rbHunt.id, 'one', 'прежнее: платный телепорт к РБ, рядом с которым стоим');
  const m = fixture({ rbHunt: fight(), rbWound: clone(wound), selfHold: endedHold('raid') }), k = core(m);
  await k.c.loop(); assert.equal(m.env.rt.rbResume?.step, 'fight');
  assert.equal(await k.c.resume(), true); assert.equal(m.loc.href, '/map.html');
  m.loc.pathname = '/map.html'; m.setDoc(docOf(pin('one', 'Первый')));
  assert.equal(await k.c.resume(), false); assert.equal(m.env.rt.rbResume, null);
  await steps(m);
  assert.ok(!m.huntSteps.includes('go'), m.huntSteps.join()); assert.equal(m.env.rt.rbHunt.id, 'one'); assert.equal(m.teleports(), 0);
  assert.equal(m.env.rt.rbGoCnt.one.length, 1, 'новых платных перелётов нет');
  assert.ok(m.logs.some(l => /он здесь, на этой карте: без телепорта/.test(l)), m.logs.join('\n'));
});

test('метка только у передышки тура на оплаченном прилёте/бое; устаревшая снимается; начатое вываживание доводится; карта не открылась за минуту — решает тур', async () => {
  for (const [hold, hunt, want] of [[endedHold('fish'), arrive(), false], [endedHold('raid'), { step: 'go', id: 'one', name: 'Первый' }, false], [endedHold('raid'), { step: 'pick' }, false], [endedHold('raid'), arrive(), true]]) {
    const m = fixture({ rbHunt: hunt, selfHold: clone(hold) }), k = core(m, { autoTasks: ['raid', 'fish'] });
    if (hold.fish) m.env.rt.selfHold.raid = { ...endedHold('raid').raid, until: Date.now() + 10 * MIN };   // тур ещё на передышке
    await k.c.loop(); assert.equal(!!m.env.rt.rbResume, want, JSON.stringify([Object.keys(hold), hunt.step]));
  }
  // без списка задач: передышка режима «raid» — так же
  const n = fixture({ rbHunt: arrive(), selfHold: { 'mode:raid': { ...endedHold('raid').raid, task: null, mode: 'raid' } } }); await core(n, {}).c.loop(); assert.equal(n.env.rt.rbResume?.id, 'one');
  // маршрут сменился — метка снимается без перехода
  const s = fixture({ rbHunt: { step: 'pick' }, rbResume: { id: 'one', step: 'arrive', at: Date.now() } }), ks = core(s);
  assert.equal(await ks.c.resume(), false); assert.equal(s.env.rt.rbResume, null); assert.equal(s.loc.href, '');
  const old = fixture({ rbHunt: arrive(), rbResume: { id: 'one', step: 'arrive', at: Date.now() - 31 * MIN } }); assert.equal(await core(old).c.resume(), false); assert.equal(old.env.rt.rbResume, null);
  // идёт вываживание — доводим, на карту не уходим
  const f = fixture({ rbHunt: arrive(), rbResume: { id: 'one', step: 'arrive', at: Date.now() } }), kf = core(f); kf.c.fishState = () => ({ phase: 'fight' });
  assert.equal(await kf.c.resume(), true); assert.equal(kf.c.fished, 1); assert.equal(f.loc.href, '');
  // карта за минуту не открылась — метка снята, у прилёта свежее окно (тур сам ещё раз откроет карту, прежде чем сдаться)
  const g = fixture({ rbHunt: arrive(), rbResume: { id: 'one', step: 'arrive', at: Date.now() - 2 * MIN, navAt: Date.now() - 61000 } }), kg = core(g);
  assert.equal(await kg.c.resume(), false); assert.equal(g.env.rt.rbResume, null); assert.ok(Date.now() - g.env.rt.rbHunt.at < 5000);
  assert.ok(kg.recs.some(r => /карта после передышки не открылась за минуту/.test(r)));
  await g.R.rbHuntStep(); assert.equal(g.env.rt.rbHunt.step, 'arrive'); assert.equal(g.loc.href, '/map.html', 'прилёт сам открывает карту, а не сдаётся'); assert.equal(g.teleports(), 0);
  // в Ashen Bastion карта не открывается — сразу решает тур (свежее окно прилёта), без своего перехода
  const ash = fixture({ rbHunt: arrive(), rbResume: { id: 'one', step: 'arrive', at: Date.now() } }); ash.loc.pathname = '/ashen-bastion.html'; const ka = core(ash);
  assert.equal(await ka.c.resume(), false); assert.equal(ash.loc.href, ''); assert.equal(ash.env.rt.rbResume, null); assert.ok(Date.now() - ash.env.rt.rbHunt.at < 5000); assert.equal(ka.recs.length, 0);
});

test('проводка: loopRaid сначала raidResumeMap, потом шаг тура', () => {
  const raid = slice(content, 'async function loopRaid() {', '\n}\n');
  assert.match(raid, /if \(autonomyMode\(\) === 'raid' && !isBattle\(\) && rt\.rbResume && await raidResumeMap\(\)\) return true;[^\n]*\n\s+if \(autonomyMode\(\) === 'raid' && !isBattle\(\)\) \{ await rbHuntStep\(\); await sleep\(200\); return true; \}/);
});

// ---------- 2) Life Stone: удержание игрока во всех путях ----------
const FREE = /серия на паузе, возвращаюсь к задачам; продолжение вручную/;
function ls({ ls = 5, gem = 5, limit = 3, targets = ['prominence'], outcome = 'tempest' } = {}) {
  let time = 100000, seq = 0, lose = false, postGate = null, status = 200; const box = { Date: { now: () => time } }; vm.createContext(box);
  vm.runInContext(read('augment.js'), box); vm.runInContext(read('modules/lifestone.js'), box);
  const snap = { name: 'Hero', revision: 10, inventory: { eq: { l1: { itemId: 123, enchant: 7, clanWeaponUid: 'weapon-a' } }, stacks: [{ itemId: 10411, qty: ls }, { itemId: 2133, qty: gem }] } };
  const posts = [], recs = [];
  const apply = id => { snap.revision++; snap.inventory.stacks.forEach(r => r.qty--); snap.inventory.eq.l1.augmentation = { uid: 'uid-' + (++seq), grade: 'A', outcomeId: id }; };
  const env = { cfg: { autoLs: { targets, maxAttempts: limit } }, rt: { char: 'Hero' }, on: true, tabOwner: true, canRun: () => true, canPrepare: () => true, context: () => 'context',
    rec: (...a) => recs.push(a.slice(2).join(' ')), setStatus: () => {},
    setRt: async p => { Object.assign(env.rt, clone(p)); return { ok: true }; },
    gameGet: async p => ({ ok: true, json: async () => clone(p === '/character' ? { character: snap } : { itemGradeHints: { 123: 'A' } }) }),
    gamePost: async (p, body, ms, permit) => { assert.equal(m.consumePermit(permit, body), true); posts.push(clone(body)); if (postGate) await postGate;
      if (status !== 200) return { ok: false, status, json: async () => ({}) };
      apply(outcome); if (lose) { lose = false; throw Error('lost'); } return { ok: true, status: 200, json: async () => ({ outcomeId: outcome, gemstonesSpent: 1 }) }; } };
  const m = box.L2V7Factories.lifestone(env);
  return { m, env, snap, posts, recs, lose: () => lose = true, gate: p => postGate = p, status: s => status = s, advance: (ms = 16000) => time += ms,
    run: async () => { await m.command('prepare'); await m.command('resume'); }, get s() { return env.rt.autoLs; } };
}
const tick = () => new Promise(r => setImmediate(r));
async function pauseDuringPost(h) {
  let open; h.gate(new Promise(r => open = r));
  const st = h.m.step(); await tick(); await tick();
  assert.equal(h.posts.length, 1, 'POST попытки ушёл'); assert.equal(await h.m.command('pause'), true, '«Пауза» во время POST принята');
  h.gate(null); open(); await st;
}

test('ЛС: «Пауза» во время POST попытки — сверка пишет паузу игрока (userHold), удержание остаётся, «Продолжить» работает', async () => {
  const h = ls(); await h.run(); await pauseDuringPost(h);
  assert.equal(h.s.status, 'paused'); assert.equal(h.s.attempts, 1, 'попытка сверена'); assert.equal(h.s.hold, true); assert.equal(h.s.userHold, true);
  for (let i = 0; i < 3; i++) { h.advance(); assert.equal(await h.m.step(), true, 'удержание игрока держит цикл'); }
  assert.equal(h.s.hold, true); assert.ok(!h.recs.some(x => FREE.test(x)), h.recs.join('\n')); assert.equal(h.posts.length, 1);
  await h.m.command('resume'); assert.equal(h.s.status, 'running'); assert.equal(h.s.userHold, false);
  h.advance(); await h.m.step(); assert.equal(h.posts.length, 2, 'серия продолжилась с прежним счётом'); assert.equal(h.s.attempts, 2);
});

test('ЛС: «Пауза» во время POST, сервер отклонил (4xx) — пауза игрока держит; без «Паузы» тот же отказ — автоматическая пауза, отпускает', async () => {
  const h = ls(); await h.run(); h.status(422); await pauseDuringPost(h);
  assert.equal(h.s.status, 'paused'); assert.match(h.s.reason, /Сервер отклонил попытку \(422\)/); assert.equal(h.s.userHold, true);
  h.advance(); assert.equal(await h.m.step(), true); assert.equal(h.s.hold, true);
  const a = ls(); await a.run(); a.status(422); await a.m.step(); assert.equal(a.s.status, 'paused'); assert.notEqual(a.s.userHold, true);
  a.advance(); await a.m.step(); assert.equal(a.s.hold, false, 'пауза сбоя отпускает бота к задачам'); assert.equal(a.recs.filter(x => FREE.test(x)).length, 1);
});

test('ЛС: «Сверить» игрока после неизвестной попытки — удержание остаётся; та же сверка автоматически — отпускает, как задумано', async () => {
  const h = ls(); await h.run(); h.lose(); await h.m.step(); assert.ok(h.s.pending); assert.equal(h.s.hold, true);
  assert.equal(await h.m.command('reconcile'), true);
  assert.equal(h.s.pending, null); assert.equal(h.s.reason, 'Состояние сверено; продолжение вручную'); assert.equal(h.s.userHold, true); assert.equal(h.s.hold, true);
  h.advance(); assert.equal(await h.m.step(), true); assert.equal(h.s.hold, true); assert.ok(!h.recs.some(x => FREE.test(x)));
  await h.m.command('resume'); h.advance(); await h.m.step(); assert.equal(h.posts.length, 2, '«Продолжить» доступно, без повтора неизвестной попытки');
  const a = ls(); await a.run(); a.lose(); await a.m.step(); a.advance(); await a.m.step();
  assert.equal(a.s.pending, null); assert.equal(a.s.status, 'paused'); assert.notEqual(a.s.userHold, true);
  a.advance(); await a.m.step(); assert.equal(a.s.hold, false); assert.equal(a.posts.length, 1);
});

test('ЛС: «Учесть попытку» игрока — удержание остаётся, «Продолжить» работает; «Сверить» без pending ничего не помечает', async () => {
  const h = ls(); await h.run(); h.lose(); await h.m.step();
  h.snap.revision++;   // свежая ревизия героя после неизвестной попытки
  assert.equal(await h.m.command('acknowledge'), true);
  assert.equal(h.s.pending, null); assert.equal(h.s.attempts, 1); assert.match(h.s.reason, /Неизвестная попытка учтена/); assert.equal(h.s.userHold, true);
  h.advance(); assert.equal(await h.m.step(), true); assert.equal(h.s.hold, true); assert.ok(!h.recs.some(x => FREE.test(x)));
  await h.m.command('resume'); assert.equal(h.s.status, 'running'); h.advance(); await h.m.step(); assert.equal(h.posts.length, 2);
  // «Сверить» без неизвестной попытки — команда ничего не делает и не превращает следующую паузу сбоя в паузу игрока
  const b = ls(); await b.run(); assert.equal(await b.m.command('reconcile'), false); b.status(422); await b.m.step(); b.advance(); await b.m.step();
  assert.equal(b.s.hold, false, 'пауза сбоя по-прежнему отпускает');
});

// Закупка материалов (стенд v2043-lifestone-supply-refusal): Gemstone S через /game/drops-shop/buy, POST можно задержать
const GEM = 2134, ADENA_PRICE = 100000, FULL = { statusCode: 500, error: 'Internal Server Error', message: 'inventory_full' };
function supply() {
  let time = 100000, module, reply = null, gate = null; const posts = [], recs = [];
  const snap = { name: 'Hero', revision: 10, adena: '50000000', worldX: 114496, worldY: 132416, inventory: { eq: { l1: { itemId: 9002284, enchant: 25, clanWeaponUid: 'w' } },
    stacks: [{ itemId: 10412, qty: 3 }, { itemId: GEM, qty: 0 }, { itemId: 5575, qty: 5000000 }, { itemId: 4037, qty: 14 }, { itemId: 920048, qty: 9 }] } };
  const gmShop = { grades: [{ grade: 'S', sections: [{ category: 'consumable', items: [{ category: 'consumable', grade: 'S', itemId: GEM, shopKey: 'consumable/resource_gemstone_s', consumableSubtype: 'resources', purchasable: true, priceAdena: ADENA_PRICE, priceCoinOfLuck: null }] }] }] };
  const env = { cfg: { autoLs: { targets: ['matk_6'], maxAttempts: 3 }, shopReserve: 200000, mmTpMax: 500000 }, rt: { char: 'Hero', manualKickAt: 1 }, on: true, tabOwner: true,
    canPrepare: () => true, canRun: () => true, context: () => 'ctx', rec: (...a) => recs.push(a.slice(2).join(' ')), setStatus: () => {},
    setRt: async p => { Object.assign(env.rt, clone(p)); return { ok: true }; },
    gameGet: async p => ({ ok: true, status: 200, json: async () => clone(p === '/character' ? { character: snap } : p === '/character/catalog-hints' ? { itemGradeHints: { 9002284: 'S' }, itemSlotHints: { 9002284: 'rhand' } } : p === '/game/drops-shop' ? gmShop : {}) }),
    gamePost: async (p, body, ms, id) => { assert.equal(module.consumeSupplyPermit(id, p, body), true); posts.push({ p, body: clone(body) }); if (gate) await gate;
      if (reply) return reply();
      snap.inventory.stacks.find(x => x.itemId === GEM).qty += body.qty; snap.adena = String(+snap.adena - ADENA_PRICE * body.qty); snap.revision++;
      return { ok: true, status: 200, json: async () => ({ character: clone(snap) }) }; } };
  const box = { console, Date: { now: () => time }, setTimeout, clearTimeout }; vm.createContext(box);
  vm.runInContext(read('augment.js'), box); vm.runInContext(read('modules/payments.js'), box); vm.runInContext(read('modules/lifestone.js'), box);
  module = box.L2V7Factories.lifestone(env);
  return { env, posts, recs, m: module, refuse: () => reply = () => ({ ok: false, status: 500, json: async () => clone(FULL) }), gate: p => gate = p, advance: (ms = 16000) => time += ms,
    start: async () => { await module.command('prepare'); await module.command('resume'); }, get s() { return env.rt.autoLs; } };
}
async function pauseDuringSupply(h) {
  let open; h.gate(new Promise(r => open = r));
  const st = h.m.step(); for (let i = 0; i < 30 && !h.posts.length; i++) await tick();
  assert.equal(h.posts.length, 1, 'POST закупки ушёл'); assert.equal(await h.m.command('pause'), true); h.gate(null); open(); await st;
}

test('ЛС, закупка: «Пауза» во время POST — сверенная покупка и отказ игры (inventory_full) держат удержание игрока; без «Паузы» отказ отпускает, как раньше', async () => {
  const a = supply(); await a.start(); await pauseDuringSupply(a);
  assert.equal(a.s.reason, 'Покупка сверена; продолжение вручную'); assert.equal(a.s.spentAdena, 3 * ADENA_PRICE); assert.equal(a.s.userHold, true); assert.equal(a.s.hold, true);
  a.advance(); assert.equal(await a.m.step(), true); assert.equal(a.s.hold, true); assert.ok(!a.recs.some(x => FREE.test(x)), a.recs.join('\n'));
  const b = supply(); await b.start(); b.refuse(); await pauseDuringSupply(b);
  assert.equal(b.s.pending, null); assert.equal(b.s.reservedAdena, 0); assert.match(b.s.reason, /сумка полна/); assert.equal(b.s.hold, true); assert.equal(b.s.userHold, true);
  assert.ok(b.recs.some(x => /покупки не было\. Серия на паузе игрока; продолжение вручную/.test(x)), b.recs.join('\n'));
  b.advance(); assert.equal(await b.m.step(), true, 'удержание игрока'); assert.equal(b.posts.length, 1, 'повтора закупки нет');
  const c = supply(); await c.start(); c.refuse(); await c.m.step();
  assert.equal(c.s.hold, false, 'отказ без «Паузы» — к задачам, как раньше'); assert.notEqual(c.s.userHold, true);
  assert.ok(c.recs.some(x => /Серия на паузе, возвращаюсь к задачам/.test(x)));
});

// ---------- 3) стоп обнуляет счёт вида в обоих журналах ----------
function holds({ rt: rt0 = {} } = {}) {
  const calls = [], recs = [];
  const c = { L2EngineCore: E, Date, String, Number, Math, Object, Array, JSON, console, Set,
    rt: { char: 'Hero', manualKickAt: 5, ...rt0 }, cfg: { autoTasks: ['raid', 'farm'] }, on: true, tabOwner: true, LOOP: { holdWaitT: 0 },
    location: { pathname: '/map.html', href: '' }, L2V7Modules: { actions: { canAct: () => true } }, automationGeneration: 0, leaseEpoch: 'e1', antibotState: () => null,
    setRt: async p => { Object.assign(c.rt, clone(p)); return { ok: true }; }, rtCommit: async () => true,
    halt: async (msg, hard) => { calls.push(['halt', msg, hard]); c.on = false; }, rec: (...a) => recs.push(a[2]), setStatus() {}, sleep: async () => {}, autonomyMode: () => 'raid',
    isBattle: () => false, battle: async () => {}, isFishing: () => false, fishState: () => null, fishFight: async () => {} };
  vm.createContext(c);
  vm.runInContext(slice(content, 'const SELF_HOLD_STEPS =', '// ---------- переходы') + ';this.start=selfHoldStart;', c);
  return { c, calls, recs };
}

test('стоп по 4-й отсрочке на прилёте обнуляет и передышки mapGate того же вида: после Старта первый сбой карты — передышка 1/3, а не стоп', async () => {
  const t = Date.now(), three = [t - 3 * MIN, t - 2 * MIN, t - MIN];
  const f = holds({ rt: { selfHoldLog: { raidMap: [...three], stall: [t - MIN] }, selfHoldDefer: { raidMap: [...three] } } });
  assert.equal(await f.c.start('raidMap', 'Тур РБ: карта не загрузилась после 3 обновлений (цель Первый)', { noWait: true }), 'stop');
  assert.match(f.calls[0][1], /3 отсрочки за 6 ч не помогли/);
  assert.deepEqual(clone(f.c.rt.selfHoldDefer.raidMap), []); assert.deepEqual(clone(f.c.rt.selfHoldLog.raidMap), [], 'счёт передышек вида тоже обнулён');
  assert.equal(f.c.rt.selfHoldLog.stall.length, 1, 'другие виды не трогаем');
  f.c.on = true; f.c.rt.manualKickAt = 6;   // новый Старт игрока
  assert.equal(await f.c.start('raidMap', 'Тур РБ: карта не загружается и при бесплатной проверке'), 'hold');
  assert.equal(Object.values(f.c.rt.selfHold)[0].n, 1); assert.match(f.recs.at(-1), /\(1\/3 за 6 ч\)/); assert.equal(f.calls.length, 1);
  // и наоборот: стоп по 4-й передышке mapGate обнуляет отсрочки вида — первая отсрочка после Старта не стоп
  const g = holds({ rt: { selfHoldLog: { raidMap: [...three] }, selfHoldDefer: { raidMap: [...three] } } });
  assert.equal(await g.c.start('raidMap', 'Тур РБ: карта не загружается и при бесплатной проверке'), 'stop');
  g.c.on = true; g.c.rt.manualKickAt = 6;
  assert.equal(await g.c.start('raidMap', 'Тур РБ: карта не загрузилась после 3 обновлений (цель Второй)', { noWait: true }), 'defer');
  // не остановились (мягкий halt при лежащем сервере) — оба счёта прежние, следующий сбой снова ведёт к стопу
  const s = holds({ rt: { selfHoldDefer: { raidMap: [...three] }, selfHoldLog: { raidMap: [...three] } } }); s.c.halt = async () => {};
  assert.equal(await s.c.start('raidMap', 'отсрочка', { noWait: true }), null);
  assert.equal(s.c.rt.selfHoldDefer.raidMap.length, 3); assert.equal(s.c.rt.selfHoldLog.raidMap.length, 3);
});
