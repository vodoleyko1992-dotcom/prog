'use strict';
// 20.65 (John 25.10: «что ещё можем сделать для облегчения нагрузки вообще без потери качества и скорости работы?»): частые мелкие поля
// rt (счёт лимита мобов на каждого моба, рыбалка на каждый заброс) пишутся в маленький ключ «hot», а не переписывают весь rt (0,5–0,9 МБ).
// Проверяем: чистые функции L2EngineCore.hot*, настоящий statePatch/menuPatch фона и обработчик хранилища вкладки на хранилище,
// которое ведёт себя как Chrome (копии, ключи по алфавиту, onChanged со старым и новым значением). Главная проверка — сравнение:
// одна и та же последовательность записей на маленьком rt (всё целиком, как раньше) и на большом (через hot) даёт одинаковую память.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..'), read = p => fs.readFileSync(path.join(root, p), 'utf8');
const bgSrc = read('background.js'), content = read('content.js'), popup = read('popup.js'), core = require(path.join(root, 'engine-core.js'));
const cut = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, 'нет фрагмента ' + a); return src.slice(i, j); };
const clone = v => v === undefined ? undefined : structuredClone(v);
const sorted = v => v && typeof v === 'object' ? (Array.isArray(v) ? v.map(sorted) : Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])]))) : v;
// JSON, как его сохраняет chrome.storage: undefined-поля пропадают, ключи — по алфавиту
const stored = v => v === undefined ? undefined : sorted(JSON.parse(JSON.stringify(v)));
const FILL = Object.fromEntries(Array.from({ length: 900 }, (_, i) => ['l2dop_mob_' + i, { n: 'Моб ' + i, l: 40 + i % 30, z: 'Зона ' + (i % 17) }]));
const noFill = r => { const { spawns, _src, ...x } = r || {}; return x; };
// память вкладки: поле со значением undefined — как его нет (полная запись rt из хранилища дала бы значение по умолчанию DEF_RT)
const DEF = { fishService: null, kills: 0 };
const pageView = r => Object.fromEntries(Object.entries(noFill(r)).map(([k, v]) => [k, v === undefined && Object.hasOwn(DEF, k) ? DEF[k] : v]).filter(([, v]) => v !== undefined));

// ---------- хранилище «как Chrome» ----------
function chromeStore(init) {
  const state = {}, writes = [], listeners = [];
  for (const [k, v] of Object.entries(init)) state[k] = stored(v);
  const local = {
    get: async keys => {
      const ks = keys == null ? Object.keys(state) : Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(ks.filter(k => state[k] !== undefined).map(k => [k, clone(state[k])]));
    },
    set: async p => {
      const ch = {};
      for (const [k, v] of Object.entries(p)) { ch[k] = { oldValue: clone(state[k]), newValue: stored(v) }; state[k] = stored(v); }
      writes.push({ keys: Object.keys(p).sort(), bytes: JSON.stringify(p).length });
      for (const l of listeners) l(clone(ch), 'local');
    },
    remove: async k => { for (const x of [].concat(k)) delete state[x]; }
  };
  return { state, writes, listeners, local };
}
const joined = S => core.hotJoin(S.state.rt, S.state.hot);

// ---------- фон: настоящие statePatch/menuPatch ----------
function bgOf(S, clock) {
  const bg = { Date: { now: () => clock.now }, URL, console, Math, JSON, L2EngineCore: core, crypto: { randomUUID: () => 'id' }, MAX_PATCH_KEYS: 400, LOCK_TTL: 90000,
    serializeLock: async f => f(), buf: [], flush() {}, setTimeout, clearTimeout,
    chrome: { runtime: { id: 'test', getURL: p => 'chrome-extension://test/' + p }, storage: { local: S.local } } };
  bg.globalThis = bg; vm.createContext(bg);
  vm.runInContext(cut(bgSrc, 'function mergeTimerPatch(', 'async function switchCharacter('), bg);
  return bg;
}

// ---------- вкладка: настоящий счёт лимита мобов и обработчик storage.onChanged ----------
function pageOf(S, bg, clock) {
  const st = { counter: 100, revision: 10 };
  const page = { Date: { now: () => clock.now }, URLSearchParams, console, Math, JSON, Object, Array, String, Number, Promise, Set, Map, setTimeout, clearTimeout,
    location: { search: '?spawnId=sdms_test_001', pathname: '/battle.html' },
    rt: core.hotJoin(clone(S.state.rt), S.state.hot), cfg: clone(S.state.cfg), on: true, tabOwner: true, tabIdle: false, leaseEpoch: 1, TAB_ID: 'tab7',
    DEF_RT: { ...DEF }, automationGeneration: 0, craftReadControl: 0, ROLE_KEYS: [], FARM: null, RECIPES: null, LEARN: null, learnDirty: false,
    running: true, document: { visibilityState: 'visible', hidden: false }, window: {}, sessionStorage: { removeItem() {} },
    L2V7Modules: { lifestone: { interrupt() {} }, mammon: { bagAuto: async () => {} }, rbtimer: { merge: a => a }, enchant: { command: async () => {} } },
    enchantModePause: async () => {}, draws: 0, drawSoon() { page.draws++; }, dock() {}, draw() {}, abBlink() {}, main() {}, invScanDrive() {}, learnLoad: async () => {},
    rec() {}, setStatus() {}, quietErr() {}, sleep: async () => {}, ownCfgChange: () => true, viewOnlyCfgChange: () => false, modeSig: () => '', mergeCfg: x => x,
    heroNick: () => page.rt.char, rtCommit: async () => true,
    autonomyMode: () => page.cfg.catMode ? 'cat' : page.cfg.taskOnly ? 'tasks' : 'farm',
    gameGet: async () => ({ ok: true, json: async () => ({ character: { name: 'Hero', mobsKilled: st.counter, revision: st.revision } }) }),
    ipc: m => bg.statePatch(m, { tab: { id: 7 }, frameId: 0, url: 'https://l2wap.com/battle.html' }),
    chrome: { storage: { onChanged: { addListener: f => S.listeners.push(f) } }, runtime: { sendMessage() {} } } };
  page.globalThis = page; vm.createContext(page);
  vm.runInContext(read('engine-core.js'), page);
  const write = patch => bg.statePatch({ patch, expectedChar: page.rt.char || '', epoch: page.leaseEpoch, src: page.TAB_ID, menuRev: +page.rt.menuRev || 0 },
    { tab: { id: 7 }, frameId: 0, url: 'https://l2wap.com/fishing.html' });
  page.rtWriter = page.L2EngineCore.createPatchQueue(write, () => true, () => {}, () => clock.now);
  vm.runInContext(cut(content, '// 20.8: считаем мобов', '// ---------- персонаж') +
    cut(content, 'chrome.storage.onChanged.addListener(ch => {\n', '// v5.5.9: игра заранее'), page);
  const fin = page.finishFarmQuota; page.finishFarmQuota = async (...a) => { const r = await fin(...a); await page.farmQuotaIdle(); return r; };
  // setRt вкладки: память меняется сразу, запись — очередью к фону
  const setRt = async p => { page.rt = { ...page.rt, ...p }; return page.rtWriter.enqueue(p); };
  return { page, st, setRt, grow: n => { st.counter += n; st.revision++; } };
}

function world(big) {
  const clock = { now: 5000000 };
  const S = chromeStore({ on: true, lock: { k: 'tab7', epoch: 1, t: clock.now + 1e9 }, cfg: { autoKillLimit: 50, autoTasks: ['auto', 'dailies'], dailyKillLimit: 0, dailyFishLimit: 500 },
    rt: { char: 'Hero', manualKickAt: 1, kills: 4, keep: 17, fish: { casts: 1, caught: 1, t0: 1 }, fishService: 'cut', ...(big ? { spawns: FILL } : {}) } });
  const bg = bgOf(S, clock), P = pageOf(S, bg, clock);
  const menu = rtPatch => bg.menuPatch({ rtPatch, cfgPatch: {} }, { url: 'chrome-extension://test/popup.html' });
  bg.afterOnWrite = async () => {}; bg.stopAlert = async () => {};   // значок и уведомление — за пределами отрезка фона
  const ctl = action => bg.botControl({ action }, { url: 'chrome-extension://test/popup.html' });
  return { S, bg, ...P, clock, menu, pause: () => ctl('pause'), stop: () => ctl('stop') };
}

// одна и та же последовательность для маленького и большого rt; после каждого шага — снимок
async function scenario(W) {
  const snaps = [], snap = (name, reply) => snaps.push(clone({ name, reply, store: noFill(joined(W.S)), page: pageView(W.page.rt), writes: W.S.writes.splice(0) }));   // копия — объекты одного мира
  W.S.writes.splice(0);
  let t = await W.page.beginFarmQuota('sdms_test_001'); snap('begin', t);
  W.grow(3); snap('win', await W.page.finishFarmQuota(t));
  snap('pending', await W.setRt({ fishCastPending: { at: W.clock.now, bait: 'basic' } }));
  snap('caught', await W.setRt({ fishCastPending: null, fishCastActive: false, fish: { casts: 2, caught: 2, t0: 1 }, fishSess: { n: 2 } }));
  snap('daily', await W.page.dailyLimitFishSync());
  snap('gone', await W.setRt({ fishService: undefined }));
  snap('same', await W.setRt({ fishCastActive: false }));
  W.clock.now += 1000;
  snap('loot', await W.setRt({ lootStat: { Ore: { n: 1, k: { Голем: 1 } } }, fishLag: { a: 1, b: 2 } }));
  t = await W.page.beginFarmQuota('sdms_test_001'); W.grow(2); snap('win2', await W.page.finishFarmQuota(t));
  // hot висит дольше минуты — следующая запись частых полей сама пишет полный rt
  W.clock.now += 61000;
  t = await W.page.beginFarmQuota('sdms_test_001'); snap('fold', t);
  W.grow(1); snap('win3', await W.page.finishFarmQuota(t));
  snap('menu-reset', await W.menu({ kills: 0, mobKills: {} }));
  t = await W.page.beginFarmQuota('sdms_test_001'); W.grow(4); snap('win4', await W.page.finishFarmQuota(t));
  // Пауза из меню: значение только в памяти вкладки (откат атаки) остаётся, как и до 20.65; висящий hot — в rt той же записью
  W.page.rt = { ...W.page.rt, cdUntil: { 'атака': 777 } };
  snap('pause', await W.pause());
  return snaps;
}

test('сравнение: большой rt через hot даёт ту же память фона и вкладки, что и полная запись маленького', async () => {
  const small = await scenario(world(false)), big = await scenario(world(true));
  assert.equal(small.length, big.length);
  for (let i = 0; i < small.length; i++) {
    const a = small[i], b = big[i];
    assert.deepEqual(b.reply, a.reply, 'ответ: ' + a.name);
    assert.deepEqual(b.store, a.store, 'память в хранилище: ' + a.name);
    assert.deepEqual(b.page, a.page, 'память вкладки: ' + a.name);
    // маленький rt — всегда целиком, без hot (как до 20.65)
    for (const w of a.writes) assert.ok(!w.keys.includes('hot'), 'маленький rt без hot: ' + a.name + ' ' + w.keys);
  }
  const W = Object.fromEntries(big.map(s => [s.name, s.writes]));
  for (const k of ['begin', 'win', 'pending', 'caught', 'daily', 'gone', 'win2', 'win3', 'win4']) {
    assert.ok(W[k].length >= 1, 'есть запись: ' + k);
    for (const w of W[k]) { assert.deepEqual(w.keys, ['hot'], 'только hot: ' + k); assert.ok(w.bytes < 3000, `hot маленький (${w.bytes} б): ${k}`); }
  }
  assert.equal(W.same.length, 0, 'ничего не изменилось — записи нет');
  assert.deepEqual(W.pause.map(w => w.keys), [['on', 'paused', 'stopMeta'], ['hot', 'rt']], 'Пауза: сначала остановка, потом hot сложен');
  assert.deepEqual(small.at(-1).writes.map(w => w.keys), [['on', 'paused', 'stopMeta']], 'Пауза маленького — как раньше');
  assert.equal(big.at(-1).page.cdUntil['атака'], 777, 'Пауза не трогает память вкладки');
  for (const k of ['loot', 'menu-reset', 'fold']) {
    assert.equal(W[k].length, 1, 'одна полная запись: ' + k); assert.ok(W[k][0].keys.includes('rt') && W[k][0].keys.includes('hot'), k + ': rt и hot:null той же записью');
  }
  // итог: hot сложен в rt полной записью и очищен; память совпадает с маленьким
  assert.equal(big.at(-1).store.kills, small.at(-1).store.kills);
  assert.equal(big.at(-1).store.farmQuota.auto.got, 10); assert.equal(big.at(-1).store.kills, 4, 'сброс меню, потом 4 моба');
  assert.equal(big[2].store.fishCastPending.bait, 'basic');
  assert.ok(!Object.hasOwn(big.find(s => s.name === 'gone').store, 'fishService'), 'удалённое поле пропало и в hot');
  assert.equal(big.find(s => s.name === 'gone').page.fishService, null, 'во вкладке — значение по умолчанию, как при полной записи');
});

test('hot пишется, пока rt не переписан, — сам rt в хранилище не меняется; полная запись складывает hot и очищает его', async () => {
  const W = world(true), raw0 = clone(W.S.state.rt);
  const t = await W.page.beginFarmQuota('sdms_test_001'); W.grow(5); await W.page.finishFarmQuota(t);
  assert.deepEqual(W.S.state.rt, raw0, 'rt не переписывался');
  assert.equal(W.S.state.hot.char, 'Hero'); assert.equal(joined(W.S).farmQuota.auto.got, 5); assert.equal(joined(W.S).kills, 9);
  assert.equal(W.page.rt.farmQuota.auto.got, 5, 'вкладка видит итог');
  await W.setRt({ lootStat: { x: { n: 1, k: {} } } });
  assert.equal(W.S.state.hot, null, 'hot очищен той же записью');
  assert.equal(W.S.state.rt.farmQuota.auto.got, 5); assert.equal(W.S.state.rt.kills, 9); assert.equal(W.S.state.rt.spawns['l2dop_mob_5'].n, 'Моб 5');
});

// ---------- чистые функции ----------
test('hotStr: порядок ключей не важен, undefined — пусто', () => {
  assert.equal(core.hotStr({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } }), core.hotStr({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }));
  assert.equal(core.hotStr(undefined), ''); assert.notEqual(core.hotStr(null), core.hotStr(undefined)); assert.notEqual(core.hotStr(0), core.hotStr('0'));
  assert.equal(core.hotStr({ a: undefined, b: 1 }), core.hotStr({ b: 1 }));
});
test('hotJoin: без hot / чужой герой / любое поле изменено мимо hot — rt как есть', () => {
  const rt = { char: 'A', kills: 1, fish: { b: 2, a: 1 }, x: 5 };
  assert.equal(core.hotJoin(rt, null), rt);
  const hot = core.hotNext(rt, null, { kills: 3, fishCastPending: { at: 1 } }, 's', 10);
  assert.deepEqual(core.hotJoin(rt, hot), { ...rt, kills: 3, fishCastPending: { at: 1 } });
  assert.equal(core.hotJoin({ ...rt, char: 'B' }, hot).kills, 1, 'чужой герой');
  assert.deepEqual(core.hotJoin(sorted(rt), hot).kills, 3, 'ключи по алфавиту — тот же rt');
  // откат на старую сборку: она переписала rt (счёт мобов вырос) — весь hot устарел, даже если fishCastPending в rt снова null
  const old = { ...rt, kills: 2, fishCastPending: null };
  assert.equal(core.hotJoin(old, hot), old);
  assert.equal(core.hotOwn(hot, old), null);
  // hot без was для поля — испорчен
  assert.equal(core.hotJoin(rt, { ...hot, was: { kills: hot.was.kills } }), rt);
  // не-HOT поле в hot не применяется
  assert.equal(core.hotJoin(rt, { ...hot, v: { x: 9 }, was: { x: core.hotStr(5) } }), rt);
});
test('hotNext: накопление, удаление, t0 первой записи', () => {
  const raw = { char: 'A', kills: 1, fishService: 'cut' };
  const h1 = core.hotNext(raw, null, { kills: 2 }, 'a', 100), h2 = core.hotNext(raw, h1, { fishService: undefined, kills: 3 }, 'b', 150);
  assert.deepEqual(h2.v, { kills: 3 }); assert.deepEqual(h2.gone, ['fishService']); assert.equal(h2.t0, 100); assert.equal(h2.t, 150); assert.equal(h2._src, 'b');
  assert.equal(h2.was.kills, '1', 'was — значение первой записи');
  const j = core.hotJoin(raw, h2); assert.equal(j.kills, 3); assert.ok(!Object.hasOwn(j, 'fishService'));
  const h3 = core.hotNext(raw, h2, { fishService: 'exchange' }, 'c', 160); assert.equal(h3.gone, undefined); assert.equal(core.hotJoin(raw, h3).fishService, 'exchange');
  assert.equal(core.hotNext({ ...raw, kills: 7 }, h2, { kills: 8 }, 'd', 200).t0, 200, 'прежний hot устарел — новое поколение');
});
test('hotPlan: маленький rt, не-HOT поле, другой герой, старше минуты — полная запись; без изменений — same', () => {
  const big = { char: 'A', kills: 1, spawns: FILL }, st = rt => ({ rt, rtRaw: rt, hot: null });
  assert.equal(core.hotPlan(st({ char: 'A', kills: 1 }), { char: 'A', kills: 2 }, 1), null, 'маленький rt — целиком');
  const h = core.hotPlan(st(big), { ...big, kills: 2, _src: 'x' }, 1000); assert.deepEqual(h.v, { kills: 2 });
  assert.equal(core.hotPlan(st(big), { ...big, kills: 2, lootStat: {} }, 1), null);
  assert.equal(core.hotPlan(st(big), { ...big, char: 'B' }, 1), null);
  assert.equal(core.hotPlan(st(big), { ...big, _src: 'y' }, 1), 'same');
  const S2 = { rt: core.hotJoin(big, h), rtRaw: big, hot: h };
  assert.equal(core.hotPlan(S2, { ...S2.rt, kills: 3 }, 1000 + core.HOT_FOLD_MS - 1).v.kills, 3);
  assert.equal(core.hotPlan(S2, { ...S2.rt, kills: 3 }, 1000 + core.HOT_FOLD_MS), null, 'раз в минуту — полная запись');
  assert.ok(core.HOT_KEYS.every(k => !['spawns', 'lootStat', 'skills', 'classStash', 'char', 'manualKickAt'].includes(k)));
});
test('hotStore: get склеивает и не меняет ответ хранилища; set сбрасывает hot только если он был', async () => {
  const raw = { char: 'A', kills: 1, spawns: FILL }, hot = core.hotNext(raw, null, { kills: 5 }, 's', 1);
  const S = chromeStore({ rt: raw, hot, cfg: { a: 1 } });
  const A = core.hotStore(() => S.local);
  const s = await A.get(['rt', 'cfg']); assert.equal(s.rt.kills, 5); assert.ok(!Object.hasOwn(s, 'hot'));
  assert.equal(S.state.rt.kills, 1, 'хранилище не тронуто');
  const w = await A.get(['rt'], true); assert.equal(w.rtRaw.kills, 1); assert.equal(w.hot.v.kills, 5);
  const all = await A.get(null); assert.equal(all.rt.kills, 5); assert.ok(!Object.hasOwn(all, 'hot'), 'выгрузка памяти без hot');
  assert.equal((await A.get(['rt', 'hot'])).hot.v.kills, 5);
  await A.set({ rt: { ...s.rt, x: 1 } }); assert.equal(S.state.hot, null); assert.equal(S.state.rt.kills, 5);
  // hot не было — запись как раньше, без лишнего ключа
  const S2 = chromeStore({ rt: { char: 'A' } }), B = core.hotStore(() => S2.local); await B.get('rt'); await B.set({ rt: { char: 'A', y: 1 } });
  assert.deepEqual(S2.writes.at(-1).keys, ['rt']);
  // get не было (импорт памяти) — hot:null на всякий случай
  const C = core.hotStore(() => S2.local); await C.set({ rt: { char: 'A' } }); assert.deepEqual(S2.writes.at(-1).keys, ['hot', 'rt']);
  // без rt — как обычный get/set
  await C.set({ cfg: {} }); assert.deepEqual(S2.writes.at(-1).keys, ['cfg']);
  assert.deepEqual(await core.hotStore(() => S.local).get('cfg'), { cfg: { a: 1 } });
});
test('put: только частые поля + cfg — {cfg, hot}; финиш цели рыбалки так и пишется', async () => {
  const raw = { char: 'A', kills: 1, fishTgt: { type: 'x', n: 1, t: 1, got: 1 }, spawns: FILL };
  const S = chromeStore({ rt: raw, cfg: { fishMode: true } }), A = core.hotStore(() => S.local), state = await A.get(['rt', 'cfg'], true);
  await A.put(state, { rt: { ...state.rt, fishTgt: { ...raw.fishTgt, done: true }, fishService: null }, cfg: { fishMode: false } }, 1);
  assert.deepEqual(S.writes.at(-1).keys, ['cfg', 'hot']); assert.equal(joined(S).fishTgt.done, true); assert.equal(S.state.cfg.fishMode, false);
});

// ---------- обработчик хранилища во вкладке ----------
test('вкладка: чужая запись hot — поля поверх памяти, свой остаток поверх всего; своё эхо и чужой герой — без изменений', async () => {
  const W = world(true), p = W.page, ch = (v, src = 'farm-quota', char = 'Hero', gone) => ({ hot: { oldValue: null, newValue: { char, v, was: {}, t0: 1, t: 1, _src: src, ...(gone ? { gone } : {}) } } });
  W.S.listeners[0](ch({ kills: 50, farmQuota: { auto: { got: 3 } } })); assert.equal(p.rt.kills, 50); assert.equal(p.rt.farmQuota.auto.got, 3); assert.equal(p.rt.keep, 17);
  const d0 = p.draws; W.S.listeners[0](ch({ kills: 60 }, 'tab7')); assert.equal(p.rt.kills, 50, 'своё эхо'); assert.ok(p.draws > d0, 'окно бота перерисовывается');
  W.S.listeners[0](ch({ kills: 70 }, 'farm-quota', 'Other')); assert.equal(p.rt.kills, 50, 'чужой герой');
  p.rtWriter.defer({ kills: 80 }, 8000); W.S.listeners[0](ch({ kills: 75 })); assert.equal(p.rt.kills, 80, 'неподтверждённая запись вкладки поверх');
  W.S.listeners[0](ch({}, 'farm-quota', 'Hero', ['fishService', 'keep'])); assert.equal(p.rt.fishService, null); assert.ok(!Object.hasOwn(p.rt, 'keep'));
  W.S.listeners[0]({ hot: { oldValue: null, newValue: null } }); assert.equal(p.rt.kills, 80, 'очистка hot без rt — ничего');
  // значение только в памяти вкладки (откат атаки из ответа сервера) чужая запись hot не сбрасывает — меняются только её поля
  p.rt = { ...p.rt, cdUntil: { 'атака': 123 } }; W.S.listeners[0](ch({ fish: { casts: 9 } }));
  assert.equal(p.rt.cdUntil['атака'], 123); assert.equal(p.rt.fish.casts, 9);
});
// ревью части 3: после Стопа/Паузы вся память героя — в rt (сборка без hot ничего не теряет), без hot — запись прежняя
test('Стоп/Пауза: остановка прежней записью, висящий hot — следом в rt; без hot — только on/paused/stopMeta', async () => {
  const W = world(true);
  const t = await W.page.beginFarmQuota('sdms_test_001'); W.grow(3); await W.page.finishFarmQuota(t);
  await W.setRt({ fishService: undefined });   // удаление поля — тоже через hot
  assert.ok(W.S.state.hot?.gone?.includes('fishService'), 'hot висит, с удалённым полем');
  // значение только в памяти вкладки (откат атаки) — Стоп его не трогает, как и до 20.65
  W.page.rt = { ...W.page.rt, cdUntil: { 'атака': 123 } };
  const want = noFill(joined(W.S)); W.S.writes.splice(0);
  assert.equal((await W.pause()).ok, true);
  assert.deepEqual(W.S.writes.map(w => w.keys), [['on', 'paused', 'stopMeta'], ['hot', 'rt']], 'остановка — прежней маленькой записью, свёртка — следом');
  assert.equal(W.S.state.hot, null); assert.equal(W.S.state.on, false); assert.equal(W.S.state.rt._src, 'hot-fold');
  assert.deepEqual(noFill(W.S.state.rt), want, 'rt = сложенная память'); assert.equal(W.S.state.rt.spawns['l2dop_mob_3'].n, 'Моб 3');
  assert.equal(W.S.state.rt.farmQuota.auto.got, 3); assert.equal(W.S.state.rt.kills, 7); assert.ok(!Object.hasOwn(W.S.state.rt, 'fishService'));
  assert.equal(W.page.rt.farmQuota.auto.got, 3, 'вкладка'); assert.equal(W.page.rt.keep, 17); assert.equal(W.page.rt.fishService ?? null, null, 'удалено своей записью вкладки');
  assert.equal(W.page.rt.cdUntil['атака'], 123, 'свёртка не пересобирает память вкладки');
  // после Паузы последняя запись вкладки (только частые поля) — целиком, hot снова не появляется
  W.S.writes.splice(0); await W.setRt({ fishCastPending: { at: 1, bait: 'basic' } });
  assert.deepEqual(W.S.writes.map(w => w.keys), [['rt']], 'при OFF — полная запись'); assert.equal(W.S.state.rt.fishCastPending.bait, 'basic');
  W.S.state.on = true; W.S.writes.splice(0);
  assert.equal((await W.stop()).ok, true);
  assert.deepEqual(W.S.writes.map(w => w.keys), [['on', 'paused', 'stopMeta']], 'hot нет — rt не переписывается');
});
test('Стоп/Пауза: устаревший hot (rt переписан мимо него — откат сборки) и hot другого героя не складываются', async () => {
  for (const spoil of ['stale', 'other']) {
    const W = world(true);
    const t = await W.page.beginFarmQuota('sdms_test_001'); W.grow(3); await W.page.finishFarmQuota(t);
    assert.ok(W.S.state.hot);
    if (spoil === 'stale') W.S.state.rt = { ...W.S.state.rt, kills: 100, farmQuota: { auto: { got: 40 } } };   // старая сборка записала rt
    else W.S.state.hot = { ...W.S.state.hot, char: 'Other' };
    W.S.writes.splice(0);
    assert.equal((await W.pause()).ok, true);
    assert.deepEqual(W.S.writes.map(w => w.keys), [['on', 'paused', 'stopMeta']], spoil + ': rt не переписан');
    assert.equal(W.S.state.rt.kills, spoil === 'stale' ? 100 : 4, spoil + ': счёт мобов не откатился');
  }
});
test('вкладка: сброс меню при висящем hot снимает из очереди только то, что меню изменило', async () => {
  const W = world(true);
  const t = await W.page.beginFarmQuota('sdms_test_001'); W.grow(2); await W.page.finishFarmQuota(t);
  assert.ok(W.S.state.hot, 'hot висит'); assert.equal(W.S.state.rt.kills, 4);
  // в очереди вкладки — счёт сессии и лут; меню сбрасывает только лут
  W.page.rtWriter.defer({ kills: 7, lootStat: { a: { n: 1, k: {} } } }, 8000);
  await W.menu({ lootStat: {} });
  assert.deepEqual(Object.keys(W.page.rtWriter.peek()).sort(), ['kills'], 'kills не снят: сырой rt.kills (4) ≠ сложенный (6), но меню kills не меняло');
  assert.equal(W.page.rt.kills, 7);
  await W.menu({ kills: 0 });
  assert.deepEqual(Object.keys(W.page.rtWriter.peek()), [], 'kills сброшен меню — снят из очереди');
});

// ---------- исходники: всё чтение/запись rt — через обёртку ----------
const calls = (src, re) => { const out = []; let m; re.lastIndex = 0; while ((m = re.exec(src))) { let i = m.index + m[0].length, d = 1; while (d && i < src.length) { const c = src[i++]; if (c === '(') d++; else if (c === ')') d--; } out.push(src.slice(m.index, i)); } return out; };
test('фон, вкладка, меню: rt читается вместе с hot, полная запись rt — через обёртку (hot:null той же записью)', () => {
  // импорт настроек (cfgImport) пишет только cfg и cfg@Ник — из проверки записи rt его убираем
  const bgNoCfgImport = bgSrc.replace(cut(bgSrc, "if (m?.cmd === 'cfgImport') {", 'return true;\n  }'), '');
  for (const [file, src] of [['background.js', bgNoCfgImport], ['content.js', content], ['popup.js', popup]]) {
    const gets = calls(src, /chrome\.storage\.local\.get\(/g).filter(c => /'rt'|\(null\)/.test(c));
    assert.deepEqual(gets, [], file + ': чтение rt мимо hotStore');
    const sets = calls(src, /chrome\.storage\.local\.set\(/g).filter(c => /\brt\s*[:,}]|'rt@'|\.\.\.data|\(\s*(change|set|next)\s*\)/.test(c));
    assert.deepEqual(sets, [], file + ': запись rt мимо hotStore');
  }
  assert.match(bgSrc, /const state = await ST\.get\(\['lock', 'on', 'rt', 'cfg'\], true\), put = c => ST\.put && state\.on \? ST\.put\(state, c, now\) : ST\.set\(c\);/);
  assert.doesNotMatch(cut(bgSrc, 'async function statePatch(', '// Popup writes also'), /chrome\.storage\.local\.set\(/, 'statePatch пишет только через put');
  assert.match(popup, /const MEM_SKIP = new Set\(\['hot',/, 'hot не попадает в выгрузку/загрузку памяти');
  // импорт памяти идёт мимо очереди фона: hot, записанный фоном между его get и set, не должен лечь поверх загруженной памяти
  assert.match(popup, /await ST\.set\(\{ \.\.\.data, \.\.\.\(data\.rt \? \{ hot: null \} : \{\}\), on: false,/, 'импорт памяти всегда сбрасывает hot');
  assert.match(content, /if \(ch\.cfg \|\| ch\.rt \|\| ch\.hot \|\| ch\.on\) drawSoon\(\);/);
});
