'use strict';
// Lite 1.5.2 (22.10, ревизия): новые подходящие стрелы/лук снимают отказ по свежему снимку, без требования роста общей суммы.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const bot = process.env.LITE_ARROWS_BOT ? fs.readFileSync(process.env.LITE_ARROWS_BOT, 'utf8') : read('lite/bot.js'), L = require('../lite/logic.js');
let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('ok', name); } catch (e) { fail++; console.error('FAIL', name, e.message); } }
function harness() {
  const a = bot.indexOf('  let ARW = null;'), b = bot.indexOf('  function arrowWait()', a);
  assert.ok(a > 0 && b > a);
  let now = 1000;
  const ctx = { L, cfg: { kind: 'archer', on: true }, CLS: { name: 'PR', prof: 'dark_elf_phantom_ranger', slot: 3 }, rt: {}, owner: true, dead: false, gen: 1,
    Date: { now: () => now }, log() {}, notify() {}, setRt(p) { Object.assign(ctx.rt, p); }, alive: g => ctx.owner && ctx.cfg.on && !ctx.dead && g === ctx.gen, SNAP: null };
  vm.createContext(ctx);
  vm.runInContext(bot.slice(a, b) + `;globalThis.arrows={seen:arrowsSeen,out:arrowsOut,raw:()=>ARW,
    reject:typeof arrowRejected==='function'?arrowRejected:(snap,g)=>{if(!rt.arrowOut) setRt({arrowOut:{t:Date.now(),n:ARW?ARW.n:0}})}};`, ctx);
  let rev = 1;
  const snap = (by, options = {}) => {
    const ch = { ...ctx.CLS, rev: options.rev ?? rev++, ...(Object.prototype.hasOwnProperty.call(options, 'weaponId') ? { weaponId: options.weaponId } : { weaponId: 286 }), ...(options.ch || {}) };
    ctx.arrows.seen(by, ch, { started: options.started ?? now - 1 });
  };
  const reject = () => { now += 10; ctx.arrows.reject(ctx.arrows.raw(), ctx.gen); return ctx.rt.arrowOut; };
  const advance = (ms = 10) => { now += ms; };
  return { ctx, snap, reject, advance, raw: ctx.arrows.raw, out: ctx.arrows.out };
}
function rejected(by = { 1341: 1000 }, options) { const h = harness(); h.snap(by, options); h.reject(); h.advance(); return h; }

test('1000 неподходящих стрел заменены на 100 подходящих: меньшая сумма больше не держит охоту', () => { const h = rejected(); h.snap({ 1342: 100 }); assert.equal(h.out(), false); assert.equal(h.ctx.rt.arrowOut, null); });
test('равное число другого грейда: состав изменился, разрешена новая серверная проверка', () => { const h = rejected(); h.snap({ 1342: 1000 }); assert.equal(h.out(), false); });
test('лук сменён под те же стрелы: хватает нового weaponId', () => { const h = rejected(); h.snap({ 1341: 1000 }, { weaponId: 287 }); assert.equal(h.out(), false); });
test('неизменные стрелы и лук после отказа не повторяют выстрел даже с новой revision', () => { const h = rejected(); h.snap({ 1341: 1000 }, { rev: 100 }); assert.equal(h.out(), true); });
test('порядок строк сумки не создаёт изменение состава', () => { const h = rejected({ 1341: 1000, 1342: 100 }); h.snap({ 1342: 100, 1341: 1000 }); assert.equal(h.out(), true); });
test('добавление новых стрел по-прежнему снимает ожидание', () => { const h = rejected(); h.snap({ 1341: 1001 }); assert.equal(h.out(), false); });
test('пустая новая сумка не разрешает пробный выстрел', () => { const h = rejected(); h.snap({}); assert.equal(h.out(), true); });
test('запрос начат до отказа: поздний ответ с изменившимися стрелами не снимает hold', () => { const h = rejected(); h.snap({ 1342: 100 }, { started: 1001, rev: 20 }); assert.equal(h.out(), true); });
test('неизвестное начало запроса не доказывает свежесть', () => { const h = rejected(); h.snap({ 1342: 100 }, { started: 0 }); assert.equal(h.out(), true); });
test('меньшая revision не может восстановить охоту', () => { const h = rejected({ 1341: 1000 }, { rev: 50 }); h.snap({ 1342: 100 }, { rev: 49 }); assert.equal(h.out(), true); });
test('снимок старее уже принятого по началу запроса игнорируется', () => { const h = rejected(); h.snap({ 1341: 1000 }, { started: 1020, rev: 20 }); h.advance(); h.snap({ 1342: 100 }, { started: 1015, rev: 21 }); assert.equal(h.out(), true); });
test('снимок без оружия не доказывает его замену после reload', () => { const h = rejected(); const o = JSON.parse(JSON.stringify(h.ctx.rt.arrowOut)), r = harness(); r.ctx.rt.arrowOut = o; r.advance(1000); r.snap({ 1341: 1000 }, { weaponId: undefined, rev: 50 }); assert.equal(r.out(), true); });
test('неизвестное при отказе оружие, позднее прочитанный id — не доказанная замена', () => { const h = rejected({ 1341: 1000 }, { weaponId: undefined }); h.snap({ 1341: 1000 }, { weaponId: 287 }); assert.equal(h.out(), true); });
test('legacy-квитанция без состава: один свежий положительный снимок допускает сверку сервером', () => { const h = harness(); h.ctx.rt.arrowOut = { t: 1000, n: 1000 }; h.advance(100); h.snap({ 1342: 100 }); assert.equal(h.out(), false); });
test('legacy-квитанция: старый запрос после reload не снимает hold', () => { const h = harness(); h.ctx.rt.arrowOut = { t: 1000, n: 1000 }; h.advance(100); h.snap({ 1342: 2000 }, { started: 900 }); assert.equal(h.out(), true); });
test('повторный отказ после изменения состава блокирует именно новое состояние', () => { const h = rejected(); h.snap({ 1342: 100 }); assert.equal(h.out(), false); h.reject(); h.advance(); h.snap({ 1342: 100 }); assert.equal(h.out(), true); });
test('Stop: фоновый снимок не сбрасывает отказ и ничего не возобновляет', () => { const h = rejected(); h.ctx.cfg.on = false; h.snap({ 1342: 2000 }); assert.ok(h.ctx.rt.arrowOut); });
test('потеря вкладки-хозяина: свежая сумка не пишет квитанцию', () => { const h = rejected(); h.ctx.owner = false; h.snap({ 1342: 2000 }); assert.ok(h.ctx.rt.arrowOut); });
test('профиль Дестра: стрелы не держат охоту и не снимают отказ лука', () => { const h = rejected(); h.ctx.cfg.kind = 'destr'; h.snap({ 1342: 2000 }); assert.equal(h.out(), false); assert.ok(h.ctx.rt.arrowOut); });
test('чужой герой не снимает отказ текущего лука', () => { const h = rejected(); h.snap({ 1342: 2000 }, { ch: { name: 'Other' } }); assert.equal(h.out(), true); });
test('тот же герой, другой слот лучника: квитанция старого слота не становится его отказом', () => { const h = rejected(); h.ctx.CLS.slot = 1; h.snap({ 1341: 1000 }); assert.equal(h.out(), false); });
test('поздний отказ после Stop не записывается в память', () => { const h = harness(); h.snap({ 1341: 1000 }); h.ctx.cfg.on = false; h.reject(); assert.equal(h.ctx.rt.arrowOut, undefined); });
test('поздний отказ после смены поколения не записывается в память', () => { const h = harness(); h.snap({ 1341: 1000 }); h.ctx.gen = 2; h.ctx.arrows.reject(h.raw(), 1); assert.equal(h.ctx.rt.arrowOut, undefined); });
test('TvT: отказ стрел обрабатывается только в PvE; клики по-прежнему через alive и gameIdle', () => { assert.match(bot, /if \(!tvt && cfg\.kind === 'archer' && \/arrow\|стріл\|стрел\/i\.test\(end\.err \|\| ''\)\)/); assert.match(bot, /if \(!\(await gameIdle\(1500, g\)\) \|\| !alive\(g\) \|\| !s\.b\.isConnected\) return false;/); });
test('netEnd передаёт начало запроса к снимку; hook передаёт только itemId надетого оружия', () => { assert.match(bot, /onSnap\(d\.ch,\s*\{\s*started:/); assert.match(read('lite/hook.js'), /weaponId:/); });

function snapshotHarness() {
  let now = 1000;
  const ctx = { L, cfg: { kind: 'archer', on: true, tvt: false }, rt: { k: { kills: 0 } }, owner: true, ready: true, gen: 1, dead: false,
    CLS: { name: 'A', prof: 'dark_elf_phantom_ranger', slot: 3 }, SNAP: null,
    NET: { starts: [], ends: new Map(), inflight: new Map() }, BUSY: /^\/character$/, CD: {}, Date: { now: () => now },
    log() {}, notify() {}, status() {}, abBlink() {}, progress() {}, profSync() {}, onSnapZone() {}, barMine: () => false,
    wakeAll() {}, sess: { set() {} }, hudMark() {}, alive: g => ctx.owner && ctx.cfg.on && !ctx.dead && g === ctx.gen,
    setRt(p) { Object.assign(ctx.rt, p); } };
  vm.createContext(ctx);
  const piece = (a, b) => bot.slice(bot.indexOf(a), bot.indexOf(b, bot.indexOf(a)));
  vm.runInContext(piece('  let ARW = null;', '  function arrowWait()') + '\n' + piece('  function onSnap(', '  // «Где стоит герой') + '\n'
    + piece('  function clsSet(', '  const heroCls') + '\n' + piece('  function onCfg(', '  // Команды меню') + '\n'
    + piece('  function netStart(', "  window.addEventListener('message'")
    + `;globalThis.obs={start:netStart,end:netEnd,snap:onSnap,cfgChange:onCfg,raw:()=>ARW,out:arrowsOut,reject:()=>arrowRejected(ARW,gen)};`, ctx);
  const ch = (name = 'A', arrows = { 1341: 1000 }, rev = 1, slot = 3) => ({ name, arrows, rev, slot, prof: 'dark_elf_phantom_ranger', weaponId: 286, k: 100 });
  const start = rid => ctx.obs.start({ rid, path: '/character', method: 'GET' });
  const end = (rid, value) => ctx.obs.end({ rid, path: '/character', method: 'GET', status: 200, ch: value });
  const at = value => { now = value; };
  start(1); end(1, ch()); at(1010); ctx.obs.reject();
  return { ctx, ch, at, start, end };
}
test('настоящий netEnd→onSnap: B принят, поздний ответ A не возвращает героя и не снимает отказ', () => {
  const h = snapshotHarness(); h.at(1020); h.start(2); h.at(1025); h.start(3); h.at(1030); h.end(3, h.ch('B', { 1342: 100 }, 5));
  h.at(1040); h.end(2, h.ch('A', { 1342: 100 }, 2));
  assert.equal(h.ctx.CLS.name, 'B'); assert.equal(h.ctx.SNAP.name, 'B'); assert.equal(h.ctx.rt.arrowOut.realm.includes('A'), true);
});
test('настоящий netEnd→onSnap: новый слот принят, старый ответ другого слота не переключает обратно', () => {
  const h = snapshotHarness(); h.at(1020); h.start(2); h.at(1025); h.start(3); h.end(3, h.ch('A', { 1342: 100 }, 5, 1));
  h.at(1040); h.end(2, h.ch('A', { 1342: 100 }, 2, 3)); assert.equal(h.ctx.CLS.slot, 1); assert.ok(h.ctx.rt.arrowOut);
});
test('настоящий netEnd→onSnap: Stop→ON не принимает старую сумку после возобновления', () => {
  const h = snapshotHarness(); h.at(1020); h.start(2); h.ctx.cfg.on = false; h.ctx.obs.cfgChange({ ...h.ctx.cfg, on: true });
  h.ctx.cfg.on = true; h.ctx.obs.cfgChange({ ...h.ctx.cfg, on: false }); h.at(1040); h.end(2, h.ch('A', { 1342: 100 }, 5));
  assert.ok(h.ctx.rt.arrowOut); assert.equal(h.ctx.obs.out(), true); assert.equal(h.ctx.SNAP.rev, 1);
});
test('настоящий netEnd→onSnap: потеря и возврат владельца не легализуют старый запрос', () => {
  const h = snapshotHarness(); h.at(1020); h.start(2); h.ctx.owner = false; h.ctx.gen++; h.ctx.owner = true;
  h.at(1040); h.end(2, h.ch('A', { 1342: 100 }, 5)); assert.ok(h.ctx.rt.arrowOut); assert.equal(h.ctx.obs.out(), true);
});
test('настоящий netEnd→onSnap: поздний запрос с большей revision всё равно старее последнего принятого', () => {
  const h = snapshotHarness(); h.at(1020); h.start(2); h.at(1025); h.start(3); h.end(3, h.ch('A', { 1341: 1000 }, 5));
  h.at(1040); h.end(2, h.ch('A', { 1342: 100 }, 6)); assert.ok(h.ctx.rt.arrowOut); assert.equal(h.ctx.SNAP.rev, 5);
});
test('одна миллисекунда: больший rid принят, поздний меньший rid не меняет снимок', () => {
  const h = snapshotHarness(); h.at(1020); h.start(2); h.start(3); h.end(3, h.ch('A', { 1341: 1000 }, 5));
  h.at(1040); h.end(2, h.ch('A', { 1342: 100 }, 6)); assert.ok(h.ctx.rt.arrowOut); assert.equal(h.ctx.SNAP.rev, 5);
});
test('настоящий netEnd→onSnap: потерянная стартовая метка не позволяет заменить уже известного героя', () => {
  const h = snapshotHarness(); h.at(1040); h.end(99, h.ch('B', { 1342: 100 }, 5)); assert.equal(h.ctx.CLS.name, 'A'); assert.ok(h.ctx.rt.arrowOut);
});
test('hook: настоящий XHR отдаёт weaponId без данных экземпляра; неизвестное оружие не становится пустым', () => {
  const posts = [], ctx = { location: new URL('https://l2wap.com/map.html'), URL, Response, Headers, Date, console,
    document: { documentElement: { dataset: {} } }, window: { postMessage: d => posts.push(d) }, payload: null };
  function XHR() { this.responseType = ''; this.status = 200; }
  XHR.prototype.open = function() {}; XHR.prototype.addEventListener = function(_, cb) { this.cb = cb; };
  XHR.prototype.send = function() { this.responseText = JSON.stringify(ctx.payload); this.cb(); };
  ctx.XMLHttpRequest = XHR; vm.createContext(ctx); vm.runInContext(read('lite/hook.js'), ctx);
  const send = inv => { ctx.payload = { character: { name: 'A', l2Profession: 'dark_elf_phantom_ranger', inventory: inv } }; const x = new ctx.XMLHttpRequest(); x.open('GET', '/character'); x.send(); return posts.filter(p => p.ch).at(-1).ch; };
  assert.equal(send({ stacks: [], eq: { l1: { itemId: 286, clanUid: 'private-instance', auth: 'private-marker' } } }).weaponId, 286);
  assert.equal(JSON.stringify(posts).includes('private-'), false);
  assert.equal(send({ stacks: [], eq: { l1: null } }).weaponId, null);
  assert.equal(send({ stacks: [] }).weaponId, undefined);
});
test('повторный Start при ON отменяет старые запросы и поздний отказ старого выстрела', () => {
  const h = snapshotHarness(), shot = h.ctx.obs.raw(), oldGen = h.ctx.gen;
  h.ctx.cfg.zone = 'giran_harbor'; h.ctx.K_RT = 'lite.rt'; h.ctx.K_CMD = 'lite.cmd'; h.ctx.flushRt = () => Promise.resolve();
  const a = bot.indexOf('  function applyCmd('), b = bot.indexOf('  async function load()', a);
  vm.runInContext(bot.slice(a, b), h.ctx);
  h.at(1020); h.start(2); h.ctx.applyCmd({ type: 'start', id: 'new-start' });
  h.ctx.arrowRejected(shot, oldGen); assert.equal(h.ctx.rt.arrowOut, null);
  h.at(1040); h.end(2, h.ch('A', { 1342: 100 }, 5)); assert.equal(h.ctx.SNAP.rev, 1);
});
(async () => {
  try {
    const h = snapshotHarness(); h.ctx.rt.arrowOut = null;
    vm.runInContext('ARW=null', h.ctx);
    let fires = 0;
    Object.assign(h.ctx, { CD: { globalWait: () => 0 }, cdWait: () => 0, cdKnown: () => false, gameIdle: async () => true,
      pressAt: new Map(), frozenSince: new Map(), lockA: 0, lockB: 0, fastMark() {}, quick: false, fire: () => { fires++; return false; } });
    h.ctx.heroNow = async () => { h.at(1030); h.start(3); h.end(3, h.ch('A', {}, 5)); };
    const a = bot.indexOf('  async function press('), b = bot.indexOf('  // ---------- бой', a);
    vm.runInContext(bot.slice(a, b), h.ctx);
    await h.ctx.press({ slot: { key: 'attack', action: 'attack', type: 'basic', b: { isConnected: true } }, why: 'test' }, h.ctx.gen, false);
    assert.equal(fires, 0); assert.equal(h.ctx.obs.out(), true);
    pass++; console.log('ok настоящий press: fallback увидел пустую сумку — ни одного выстрела');
    h.ctx.heroNow = async () => { h.ctx.cfg.on = false; h.ctx.gen++; };
    vm.runInContext('ARW=null', h.ctx);
    h.ctx.cfg.on = true; const g = h.ctx.gen;
    await h.ctx.press({ slot: { key: 'attack', action: 'attack', type: 'basic', b: { isConnected: true } }, why: 'test' }, g, false);
    assert.equal(fires, 0);
    pass++; console.log('ok настоящий press: Stop во время fallback не выпускает выстрел');
  } catch (e) { fail++; console.error('FAIL press fallback', e.message); }
  try {
    const h = snapshotHarness(), shot = h.ctx.obs.raw();
    h.ctx.owner = false; h.ctx.location = { pathname: '/map.html' }; h.ctx.K_RT = 'lite.rt'; h.ctx.K_CMD = 'lite.cmd'; h.ctx.DEF_RT = {}; h.ctx.lastStatus = '';
    h.ctx.applyCmd = () => {};
    const saved = JSON.parse(JSON.stringify(h.ctx.rt));
    h.ctx.chrome = { runtime: { sendMessage: async () => ({ owner: true }) }, storage: { local: { get: async () => ({ 'lite.rt': saved }) } } };
    const a = bot.indexOf('  async function beat()'), b = bot.indexOf('  // ---------- сеть игры', a);
    vm.runInContext(bot.slice(a, b), h.ctx);
    h.at(1020); h.start(2); await h.ctx.beat();
    h.at(1040); h.end(2, h.ch('A', { 1342: 100 }, 5)); assert.ok(h.ctx.rt.arrowOut); assert.equal(h.ctx.SNAP.rev, 1);
    assert.ok(h.ctx.gen > 1); assert.equal(shot.realm, h.ctx.rt.arrowOut.realm);
    pass++; console.log('ok первое получение lease отменяет запросы, начатые до владения');
  } catch (e) { fail++; console.error('FAIL first lease epoch', e.message); }
  try {
    const h = snapshotHarness(), a = bot.indexOf('  async function heroNow()'), b = bot.indexOf('  // 1.5.1 (John 21.10: «привел', a);
    let resolve;
    h.ctx.gameGet = () => new Promise(r => { resolve = r; }); h.ctx.num = Number;
    vm.runInContext(bot.slice(a, b) + ';globalThis.askHero=heroNow;', h.ctx);
    h.at(1020); const pending = h.ctx.askHero();
    h.at(1025); h.start(3); h.end(3, h.ch('B', { 1342: 100 }, 5));
    resolve({ ok: true, json: async () => ({ character: { name: 'A', l2Profession: 'dark_elf_phantom_ranger', classSlots: { activeSlot: 3 } } }) });
    assert.equal(await pending, null); assert.equal(h.ctx.CLS.name, 'B');
    pass++; console.log('ok прямой heroNow после await не возвращает старого героя поверх нового снимка');
  } catch (e) { fail++; console.error('FAIL heroNow epoch', e.message); }
  console.log(`lite-arrows-recovery: ${pass} PASS / ${fail} FAIL`); if (fail) process.exitCode = 1;
})();
