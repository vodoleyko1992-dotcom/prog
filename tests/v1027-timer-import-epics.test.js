'use strict';
// 15.10: внешний импорт вместо фоновой слежки; полный экспорт памяти и старые снимки эпиков.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const read = f => fs.readFileSync(require('node:path').join(__dirname, '..', f), 'utf8');
const now = Date.now(), H = 3600000, id = 'l2dop_rb_29022';
function fixture() {
  const box = { Date, console }; vm.createContext(box); vm.runInContext(read('modules/rbtimer.js'), box);
  return { box, T: box.L2V7Factories.rbtimer({ cfg: {}, rt: {} }) };
}
test('memory export seconds normalize before merge, identify epic, show in dock immediately', async () => {
  const { box, T } = fixture();
  const dead = Math.floor((now - H) / 1000), seen = Math.floor(now / 1000);
  const file = JSON.stringify({ l2bot: 1, data: { rt: { rbTimer: { b: { [id]: { n: 'Zaken', l: 60, al: false, dl: dead, dh: dead, ls: seen, respawnHours: 36 } } } } } });
  const parsed = T.parseFile(file); assert.equal(parsed.b[id].e, 1); assert.equal(parsed.b[id].ls, seen * 1000);
  const stored = { rbTimer: { b: { [id]: { n: 'Zaken', al: true, ls: now - 2 * H } } } };
  let draws = 0;
  Object.assign(box, { L2V7Modules: { rbtimer: T }, rt: stored, draw: () => draws++, chrome: { storage: { local: { get: async () => ({ rt: stored }) } }, runtime: { sendMessage: async m => { stored.rbTimer = m.rbTimer; return { ok: true }; } } } });
  const content = read('content.js');
  vm.runInContext(content.slice(content.indexOf('function epicRespTxt('), content.indexOf('// 10.0.6: сводка')), box);
  vm.runInContext(content.slice(content.indexOf('async function rbtImportText('), content.indexOf('\nfunction rbtPick()')), box);
  await box.rbtImportText(file);
  assert.equal(draws, 1); assert.equal(box.rt.rbTimer.b[id].al, false);
  const dock = box.epicRespTxt(true, now);
  assert.match(dock, /Zaken \(60\)/); assert.match(dock, /через 35 ч/); assert.doesNotMatch(dock, /все живы|данных пока нет/);
});
test('JSONL and object snapshots preserve epic respawn; mixed epoch units sort chronologically', () => {
  const { T } = fixture(), t = Math.floor(now / 1000);
  const snaps = [{ t: (t + 60) * 1000, st: { [id]: ['Zaken', 60, false, 'epic', 37] } }, { t, st: { [id]: { name: 'Zaken', level: 60, isAlive: true, respawnHours: 37 } } }];
  const data = T.parseFile(snaps.map(x => JSON.stringify(x)).join('\n'));
  assert.equal(data.b[id].al, false); assert.equal(data.b[id].dl, t * 1000); assert.equal(data.b[id].dh, (t + 60) * 1000);
  assert.equal(T.timerOf(data, id, now).R.lo, 37 * H);
  const legacy = T.parseFile(JSON.stringify({ t, st: { [id]: ['Zaken', 60, false] } }));
  assert.equal(T.table(legacy, now, { lo: 1, hi: 10 })[0].e, true);
  assert.equal(T.timerOf(legacy, id, now).R.lo, 36 * H);
  assert.equal(T.timerOf(legacy, id, now).R.src, 'reference');
});
test('malformed entries are excluded; fresh alive clears death metadata; older import cannot replace fresh state', () => {
  const { T } = fixture();
  const parsed = T.parseFile(JSON.stringify({ b: { bad: null, nope: { al: 'false' }, [id]: { n: 'Zaken', al: true, ls: now, dl: now - H, dh: now - H } } }));
  assert.deepEqual(Object.keys(parsed.b), [id]); assert.equal(parsed.b[id].dh, undefined);
  const result = T.merge(parsed, T.parseFile(JSON.stringify({ rbTimer: { b: { [id]: { al: false, ls: (now - H) / 1000, dh: (now - H) / 1000 } } } })));
  assert.equal(result.b[id].al, true); assert.equal(result.b[id].dh, undefined);
});
test('popup import accepts same full export and reloads table after writing', async () => {
  const { box } = fixture(), elements = { rbtImport: {}, rbtFile: {} }; let patch, reload = 0, toast = '';
  Object.assign(box, { $: id => elements[id], chrome: { storage: { local: { get: async () => ({ rt: {} }) } } }, menuPatch: async p => { patch = p; }, load: () => reload++, toast: text => { toast = text; } });
  const source = read('popup.js'); vm.runInContext(source.slice(source.indexOf("$('rbtImport').onclick"), source.indexOf("$('cfgImport').onclick")), box);
  await elements.rbtFile.onchange({ target: { value: 'file', files: [{ text: async () => JSON.stringify({ data: { rt: { rbTimer: { b: { [id]: { n: 'Zaken', al: false, ls: now, dh: now } } } } } }) }] } });
  assert.equal(patch.rbTimer.b[id].e, 1); assert.equal(reload, 1); assert.match(toast, /загружены: 1/);
});
test('fresh imported timer survives late statePatch, popup patch and cached character switch', async () => {
  const { box } = fixture();
  const stale = { b: { [id]: { n: 'Zaken', al: true, ls: now - H } } }, fresh = { b: { [id]: { n: 'Zaken', al: false, ls: now, dh: now } } };
  const store = { rt: { char: 'First', rbTimer: fresh }, cfg: {}, on: false, 'rt@Second': { char: 'Second', rbTimer: stale }, 'cfg@Second': {} };
  Object.assign(box, { URL, MAX_PATCH_KEYS: 400, LOCK_TTL: 90000, serializeLock: fn => fn(), pvpSeedPatch: p => ({ ...p }), chrome: { storage: { local: { get: async keys => Object.fromEntries(keys.map(k => [k, store[k]])), set: async patch => Object.assign(store, patch) } } } });
  const bg = read('background.js');
  vm.runInContext(bg.slice(bg.indexOf('function mergeTimerPatch('), bg.indexOf('// Popup writes')), box);
  vm.runInContext(bg.slice(bg.indexOf('async function menuPatch('), bg.indexOf('// 8.0.6 (Firefox')), box);
  const sender = { url: 'https://l2wap.com/map.html', frameId: 0, tab: { id: 1, active: true } };
  assert.equal((await box.statePatch({ patch: { rbTimer: stale, unrelated: 1 }, expectedChar: 'First', src: 'tab1' }, sender)).ok, true);
  assert.equal(store.rt.rbTimer.b[id].al, false); assert.equal(store.rt.unrelated, 1);
  box.chrome.runtime = { getURL: name => 'chrome-extension://test/' + name };
  assert.equal((await box.menuPatch({ rtPatch: { rbTimer: stale }, expectedChar: 'First' }, { url: 'chrome-extension://test/popup.html' })).ok, true);
  assert.equal(store.rt.rbTimer.b[id].al, false);
  const switched = await box.switchCharacter({ nick: 'Second', vis: true, src: 'tab1', defRt: {} }, sender);
  assert.equal(switched.ok, true); assert.equal(store.rt.char, 'Second'); assert.equal(store.rt.rbTimer.b[id].al, false);
  assert.equal(store['rt@First'].rbTimer.b[id].ls, now);
});
test('storage event updates paused dock despite pending stale timer and accepts own canonical echo', () => {
  const { box, T } = fixture();
  const stale = { b: { [id]: { n: 'Zaken', l: 60, al: true, e: 1, ls: now - H } } }, fresh = { b: { [id]: { n: 'Zaken', l: 60, al: false, e: 1, ls: now, dh: now, rh: 36 } } };
  const content = read('content.js'), start = content.indexOf('  const timerPrevious = rt;'), end = content.indexOf('\n  if (ch.cfg || ch.rt) enchantModePause', start);
  assert.ok(start > 0 && end > start);
  Object.assign(box, { rt: { char: 'Hero', rbTimer: stale }, ch: { rt: { newValue: { char: 'Hero', rbTimer: fresh, _src: 'menu' } } }, DEF_RT: {}, TAB_ID: 'tab1', L2V7Modules: { rbtimer: T }, rtWriter: { peek: () => ({ rbTimer: stale }) } });
  vm.runInContext('{'+content.slice(start, end)+'}', box); assert.equal(box.rt.rbTimer.b[id].al, false);
  box.rt.rbTimer = stale; box.ch.rt.newValue._src = 'tab1';
  vm.runInContext('{'+content.slice(start, end)+'}', box); assert.equal(box.rt.rbTimer.b[id].ls, now);
  box.rtWriter.peek = () => ({ rbTimer: { b: { otherHero: { al: true, ls: now + H } } } });
  box.ch.rt.newValue.char = 'Second'; box.ch.rt.newValue._src = 'menu';
  vm.runInContext('{'+content.slice(start, end)+'}', box); assert.equal(box.rt.rbTimer.b.otherHero, undefined);
});
