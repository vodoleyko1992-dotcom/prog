'use strict';
// 20.43 (автономность, доводка 21.10): маршрут задачи на передышке. В режиме задач передышка меняет выбор (selectedTask), и loopTaskList
// снимал маршруты удерживаемой задачи как несовместимые: тур на stall-передышке терял rbHunt (шаг arrive/fight) уже после подтверждённого
// платного перелёта — через 20 мин тур начинал с выбора и снова платил за телепорт к тому же РБ; фарм терял zoneGo. Теперь такой маршрут
// хранится (L2EngineCore.taskJobHeld), но до конца передышки не исполняется (диспетчер jobs и сторож вкладки его не видят), а застрявший
// маршрут, ставший причиной передышки (hold.drop — владелец круга при «нет прогресса»), снимается как прежде.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const E = require('../engine-core.js');
const content = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const slice = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, a); return s.slice(i, j); };
const MIN = 60000, T = Date.now();
const hold = (task, kind, extra = {}) => ({ kind, why: 'сбой', at: T - MIN, until: T + 20 * MIN, n: 1, task, kick: 1, ...extra });
const rbHunt = { phase: 'go', step: 'fight', id: 'l2dop_rb_25001', name: 'Первый', paidAt: T - 5 * MIN };
const zoneGo = { t: T - MIN, pt: 'Blazing Swamp', paid: true };

test('taskJobHeld: тур на передышке — rbHunt/rbGo хранятся, но не разрешены; без передышки — разрешены; застрявший — нет', () => {
  const cfg = { autoTasks: ['raid', 'farm'] }, rt = { manualKickAt: 1, rbHunt, rbGo: { t: T }, selfHold: { raid: hold('raid', 'stall') } };
  assert.equal(E.selectedTask(cfg, rt), 'farm');
  for (const key of ['rbHunt', 'rbGo']) {
    assert.equal(E.taskJobAllowed(cfg, key, rt), false, key + ' не исполняется на передышке');
    assert.equal(E.taskJobHeld(cfg, key, rt), true, key + ' хранится');
  }
  assert.equal(E.taskJobHeld(cfg, 'rbHunt', { ...rt, selfHold: { raid: hold('raid', 'stall', { drop: ['rbHunt'] }) } }), false, 'причина передышки не держится');
  assert.equal(E.taskJobHeld(cfg, 'rbHunt', { ...rt, selfHold: { raid: hold('raid', 'stall', { until: T - 1 }) } }), false, 'кончилась — обычный маршрут');
  assert.equal(E.taskJobAllowed(cfg, 'rbHunt', { ...rt, selfHold: null }), true);
  assert.equal(E.taskJobHeld({}, 'rbHunt', rt), false, 'без списка задач — прежнее поведение');
  // маршрут, который и без передышки несовместим (тур не выбран), не «хранится»
  assert.equal(E.taskJobHeld({ autoTasks: ['farm', 'fish'] }, 'rbHunt', { ...rt, selfHold: { farm: hold('farm', 'mob') } }), false);
  // [фарм, Маммон]: фарм на передышке «mob» — выбор «tasks», перелёт фарма хранится
  const r2 = { manualKickAt: 1, zoneGo, selfHold: { farm: hold('farm', 'mob') } }, c2 = { autoTasks: ['farm', 'mammon'] };
  assert.equal(E.selectedTask(c2, r2), 'tasks'); assert.equal(E.taskJobHeld(c2, 'zoneGo', r2), true);
});

function policy({ cfg, rt }) {
  const writes = [], recs = [], box = { L2EngineCore: E, cfg, rt, on: true, tabOwner: true, L2V7Modules: {}, Date, Object, JSON,
    taskPolicyNote() {}, sealQueue: async () => false, rec: (...a) => recs.push(a[2]), autonomyMode: () => E.selectedTask(cfg, rt),
    isBattle: () => false, isFishing: () => false, fishState: () => null, fishFight: async () => {}, battle: async () => {}, tasksIdle: async () => {}, sleep: async () => {},
    setRt: async p => { writes.push(structuredClone(p)); Object.assign(rt, p); return { ok: true }; } };
  vm.runInNewContext(slice(content, 'async function loopTaskList() {', '// 15.10: заточка — отдельный режим.') + '\nthis.step=loopTaskList;', box);
  return { box, writes, recs };
}

test('loopTaskList: [тур, фарм], тур на передышке после оплаченного перелёта — rbHunt остаётся, перелёт после передышки не повторяется', async () => {
  // одиночная запись (формат до доводки 21.10) — её читают обе версии: прежняя здесь стирала rbHunt
  const cfg = { autoTasks: ['raid', 'farm'] }, rt = { char: 'Hero', manualKickAt: 1, rbHunt: structuredClone(rbHunt), selfHold: hold('raid', 'stall') };
  const p = policy({ cfg, rt });
  assert.equal(E.selectedTask(cfg, rt), 'farm', 'тур на передышке');
  await p.box.step();
  assert.deepEqual(rt.rbHunt, rbHunt, 'маршрут тура цел'); assert.ok(!p.writes.some(w => Object.hasOwn(w, 'rbHunt')), 'rbHunt не стирается');
  assert.ok(!p.recs.some(r => /несовместимые маршруты: .*rbHunt/.test(r)));
  // передышка кончилась — тот же маршрут снова исполняется (без нового выбора и оплаты)
  rt.selfHold = null; assert.equal(E.selectedTask(cfg, rt), 'raid'); assert.equal(E.taskJobAllowed(cfg, 'rbHunt', rt), true);
});

test('loopTaskList: [фарм, Маммон], фарм на передышке — zoneGo хранится; маршрут-владелец круга отпускается одной строкой', async () => {
  const cfg = { autoTasks: ['farm', 'mammon'] }, rt = { char: 'Hero', manualKickAt: 1, zoneGo: structuredClone(zoneGo), actionOwner: { key: 'zoneGo', id: 'a1' }, selfHold: { farm: hold('farm', 'mob') } };
  const p = policy({ cfg, rt });
  assert.equal(await p.box.step(), true);
  assert.deepEqual(rt.zoneGo, zoneGo); assert.equal(rt.actionOwner, null, 'круг больше не принадлежит ожидающему маршруту');
  assert.equal(p.recs.length, 1); assert.match(p.recs[0], /маршрут zoneGo задачи на передышке сохранён и ждёт её конца/);
  p.recs.length = 0; p.writes.length = 0; await p.box.step();
  assert.ok(!p.writes.some(w => Object.hasOwn(w, 'zoneGo')), 'повторный круг маршрут не трогает'); assert.equal(p.recs.length, 0);
});

test('loopTaskList: застрявший маршрут — причина передышки (drop) и несовместимые маршруты снимаются как прежде', async () => {
  const cfg = { autoTasks: ['raid', 'farm'] }, rt = { char: 'Hero', manualKickAt: 1, rbHunt: structuredClone(rbHunt), rbGo: { t: T },
    tsJob: { t: T }, selfHold: { raid: hold('raid', 'stall', { drop: ['rbGo'] }) } };
  const p = policy({ cfg, rt });
  assert.equal(await p.box.step(), true);
  assert.equal(rt.rbGo, null, 'застрявший перелёт снят'); assert.equal(rt.tsJob, null, 'несовместимый маршрут снят');
  assert.deepEqual(rt.rbHunt, rbHunt, 'остальной маршрут тура хранится');
  assert.match(p.recs[0], /отменены несовместимые маршруты: tsJob, rbGo; квитанции оплат сохранены/);
});

test('selfHoldStart(stall): владелец круга записывается в hold.drop', async () => {
  const c = { L2EngineCore: E, Date, String, Number, Math, Object, Array, JSON, console, Set,
    rt: { char: 'Hero', manualKickAt: 1, actionOwner: { key: 'mmJob', id: 'x' } }, cfg: { autoTasks: ['mammon', 'farm'] }, on: true, tabOwner: true, LOOP: {},
    location: { pathname: '/map.html' }, L2V7Modules: { actions: { canAct: () => true } }, automationGeneration: 0, leaseEpoch: 'e', antibotState: () => null,
    setRt: async p => { Object.assign(c.rt, structuredClone(p)); return { ok: true }; }, rtCommit: async () => true, halt: async () => {}, rec() {}, setStatus() {}, sleep: async () => {},
    autonomyMode: () => 'farm', isBattle: () => false, battle: async () => {}, isFishing: () => false, fishState: () => null, fishFight: async () => {} };
  c.structuredClone = structuredClone; vm.createContext(c);
  vm.runInContext(slice(content, 'const SELF_HOLD_STEPS =', '// ---------- переходы') + ';this.start=selfHoldStart;', c);
  assert.equal(await c.start('stall', 'нет прогресса 9 мин'), 'hold');
  const h = Object.values(c.rt.selfHold)[0]; assert.deepEqual(h.drop, ['mmJob']);
});

test('диспетчер: маршрут задачи на передышке не попадает в jobs; без передышки — попадает', () => {
  const src = slice(content, 'get jobs(){return ()=>[', '\n});');
  const fn = () => {}, box = { L2EngineCore: E, cfg: { autoTasks: ['raid', 'farm'] }, rt: { manualKickAt: 1, rbGo: { t: T }, zoneGo: structuredClone(zoneGo), rbHunt: { ...rbHunt, step: 'exit' }, selfHold: { raid: hold('raid', 'stall') } },
    sealAvailable: () => false, sealStep: fn, townBuffStep: fn, warlockTripStep: fn, shopStep: fn, magisterDisable: fn, magisterStep: fn, invScanStep: fn,
    rbGoStep: fn, zoneGoStep: fn, actionScanStep: fn, fishNow: () => false, L2V7Modules: {} };
  vm.runInNewContext('this.api=({' + src + '})', box);
  const keys = () => box.api.jobs().map(j => j.key);
  assert.ok(!keys().includes('rbGo') && !keys().includes('rbHunt'), 'маршруты тура на передышке не исполняются');
  assert.ok(keys().includes('zoneGo') && keys().includes('shop'), 'остальные маршруты — как прежде');
  box.rt.selfHold = null; assert.ok(keys().includes('rbGo') && keys().includes('rbHunt'));
});

test('сторож вкладки: хранимый маршрут задачи на передышке — не «работа без прогресса»', async () => {
  const src = slice(content, 'async function loopWatchdog() {', '\n}\n') + '\n}\nthis.wd=loopWatchdog;';
  let active = null;
  const box = { L2EngineCore: E, cfg: { autoTasks: ['raid', 'farm'] }, rt: { manualKickAt: 1, rbGo: { t: T }, selfHold: { raid: hold('raid', 'stall') } }, Date,
    L2V7Modules: {}, LOOP: {}, location: { pathname: '/map.html', search: '' }, autonomyMode: () => 'farm', isBattle: () => false, isFishing: () => false, fishState: () => null,
    fishNow: () => false, antibotState: () => null, serverDown: () => false, selfHoldMain: () => false, meHp: () => null, mobHp: () => null,
    progressMonitor: { tick: (sig, a) => { active = a; return ''; } } };
  vm.runInNewContext(src, box);
  await box.wd(); assert.equal(active, false, 'ожидающий перелёт тура не считается зависшей работой');
  box.rt.selfHold = null; await box.wd(); assert.equal(active, true, 'без передышки перелёт — работа, сторож следит');
});
