'use strict';
// 19.10.2026: реальная очередь, обработчик storage и фон; сбои записи без обращения к игре.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = process.env.L2_REPO || path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const core = require(path.join(root, 'engine-core.js')), clone = value => structuredClone(value);
const cut = (source, begin, end) => {
  const i = source.indexOf(begin), j = source.indexOf(end, i);
  assert.ok(i >= 0 && j > i, 'Фрагмент исходника: ' + begin); return source.slice(i, j);
};
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture(on = false) {
  let now = 1000000, failures = 1, listener, gate = null;
  const reserve = { id: 'payment-A', char: 'HeroA', phase: 'prepared', quote: { amount: 10, currency: 'adena' } };
  const state = { on, lock: on ? { k: 'tab1', tab: 1, epoch: 'lease', t: now } : null,
    rt: { char: 'HeroA', kills: 7, actionPayments: { pending: reserve } }, cfg: {},
    'rt@HeroB': { char: 'HeroB', kills: 100 }, 'cfg@HeroB': {} };
  const messages = [], notes = [];
  const page = { rt: clone(state.rt), on, tabOwner: on, tabIdle: false, leaseEpoch: on ? 'lease' : null,
    TAB_ID: 'page-A', DEF_RT: {}, cfg: {}, automationGeneration: 0, ROLE_KEYS: [],
    Date: { now: () => now }, document: { visibilityState: 'visible' }, window: {},
    L2V7Modules: { lifestone: { interrupt() {} }, mammon: { bagAuto: async () => {} } },
    enchantModePause: async () => {}, draw() {}, drawSoon() {}, dock() {}, rec: (...args) => notes.push(args), sleep: async () => {},
    ownCfgChange: () => false, viewOnlyCfgChange: () => false, modeSig: () => '', mergeCfg: x => x,
    heroNick: () => 'HeroB', pageTranslated: () => false,
    chrome: { storage: { onChanged: { addListener: callback => { listener = callback; } } } } };
  vm.createContext(page);
  const bg = { Date: { now: () => now }, URL, crypto: { randomUUID: () => 'new' }, L2EngineCore: core,
    console: { warn() {} }, noteAlive: async () => {}, chrome: { storage: { local: {
      get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, clone(state[k])])),
      set: async patch => {
        const changes = Object.fromEntries(Object.keys(patch).map(k => [k, { oldValue: clone(state[k]), newValue: clone(patch[k]) }]));
        Object.assign(state, clone(patch)); listener(changes);
      },
      remove: async key => { delete state[key]; }
    } }, tabs: { update: async () => {}, sendMessage: async () => {} } } };
  vm.createContext(bg);
  vm.runInContext(cut(background, 'const LOCK_TTL =', '// A single process owns') +
    cut(background, 'function retireRaidSessionPatch(', '// Popup writes') +
    cut(background, 'function pvpSeedPatch(', 'async function menuPatch(') +
    cut(background, 'async function switchCharacter(', '// 8.0.6 (Firefox'), bg);
  const sender = id => ({ frameId: 0, url: 'https://l2wap.com/map.html', tab: { id, active: true } });
  const write = async patch => {
    const message = { patch, expectedChar: page.rt.char || '', epoch: page.leaseEpoch, src: page.TAB_ID };
    messages.push(clone(message));
    if (gate) { const held = gate; gate = null; held.started.resolve(); await held.release.promise; }
    if (failures > 0) { failures--; return { ok: false, reason: 'temporary_storage_failure' }; }
    return bg.statePatch(message, sender(1));
  };
  page.rtWriter = core.createPatchQueue(write, () => !page.tabIdle && (!page.on || page.tabOwner && !!page.leaseEpoch), () => {}, () => now);
  page.ipc = message => bg.switchCharacter(message, sender(1));
  vm.runInContext(cut(content, 'chrome.storage.onChanged.addListener(ch => {\n', '// v5.5.9: игра заранее') +
    cut(content, 'async function switchChar()', '// ---------- главный цикл'), page);
  return { page, bg, state, messages, notes, reserve, advance: () => { now += 4000; },
    fail: n => { failures = n; },
    hold: () => (gate = { started: deferred(), release: deferred() }),
    switchElsewhere: () => bg.switchCharacter({ nick: 'HeroB', vis: true, src: 'other-tab', defRt: {} }, sender(2)),
    event: patch => bg.chrome.storage.local.set(patch) };
}

test('OFF: неудачный PATCH героя A после смены героя не дописывается в профиль B', async () => {
  const f = fixture(); assert.equal((await f.page.rtWriter.enqueue({ kills: 8 })).ok, false);
  assert.equal((await f.switchElsewhere()).ok, true);
  assert.equal(f.page.rt.char, 'HeroB'); assert.equal(f.page.rt.kills, 100);
  f.advance(); assert.equal((await f.page.rtWriter.recover()).ok, true);
  assert.equal(f.state.rt.kills, 100); assert.equal(f.messages.length, 1);
  assert.deepEqual(f.state['rt@HeroA'].actionPayments.pending, f.reserve);
  assert.equal(f.notes.filter(row => row[1] === 'память').length, 1);
});

test('OFF: поздний отказ старого inflight после смены героя не создаёт повтор с новым expectedChar', async () => {
  const f = fixture(); f.fail(0); const held = f.hold();
  const pending = f.page.rtWriter.enqueue({ kills: 8 }); await held.started.promise;
  await f.switchElsewhere(); held.release.resolve();
  assert.equal((await pending).reason, 'cleared'); f.advance(); await f.page.rtWriter.recover();
  assert.equal(f.state.rt.kills, 100); assert.equal(f.messages.length, 1);
});

test('OFF: неизвестный платёж A остаётся в сохранённом профиле A и не блокирует B', async () => {
  const f = fixture();
  await f.page.rtWriter.enqueue({ actionPayments: { pending: { ...f.reserve, phase: 'unknown' } } });
  await f.switchElsewhere(); f.advance(); await f.page.rtWriter.recover();
  assert.deepEqual(f.state['rt@HeroA'].actionPayments.pending, f.reserve);
  assert.equal(f.state.rt.actionPayments, undefined); assert.equal(f.page.rt.actionPayments, undefined);
});

test('Обычное обновление того же героя сохраняет pending и дописывает его после backoff', async () => {
  const f = fixture(); await f.page.rtWriter.enqueue({ kills: 8 });
  await f.event({ rt: { ...f.state.rt, status: 'Свежий статус', _src: 'menu' } });
  assert.equal(f.page.rt.kills, 8); f.advance(); await f.page.rtWriter.recover();
  assert.equal(f.state.rt.kills, 8); assert.equal(f.state.rt.status, 'Свежий статус');
  assert.equal(f.messages.length, 2); assert.equal(f.notes.length, 0);
});

test('Своя активная смена героя сначала сохраняет очередь A вместе с резервом оплаты', async () => {
  const f = fixture(true); await f.page.rtWriter.enqueue({ kills: 8 });
  await f.page.switchChar(); assert.equal(f.state.rt.char, 'HeroA', 'backoff не разрешает преждевременную смену');
  f.advance(); await f.page.switchChar(); await settle();
  assert.equal(f.state.rt.char, 'HeroB'); assert.equal(f.state.rt.kills, 100);
  assert.equal(f.state['rt@HeroA'].kills, 8);
  assert.deepEqual(f.state['rt@HeroA'].actionPayments.pending, f.reserve);
  assert.deepEqual(f.page.rtWriter.peek(), {});
});

test('OFF: новая запись B после очистки старой очереди проходит со своим expectedChar', async () => {
  const f = fixture(); await f.page.rtWriter.enqueue({ kills: 8 }); await f.switchElsewhere();
  assert.equal((await f.page.rtWriter.enqueue({ kills: 101 })).ok, true);
  assert.equal(f.messages.at(-1).expectedChar, 'HeroB'); assert.equal(f.state.rt.kills, 101);
  assert.equal(f.state['rt@HeroA'].kills, 7);
});
