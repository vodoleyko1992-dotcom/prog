'use strict';
// 14.10: «Стоп» во время ожидания перед подтверждением не разрешает старому циклу покупать.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
function core() {
  const src = read('content.js'), start = src.indexOf('function fire(el)'), end = src.indexOf('// Single-writer settings update.', start);
  assert.ok(start >= 0 && end > start);
  // В полном runtime фабрика PvP уже есть; эти проверки сохраняют обычное состояние без смерти.
  const box = { console, L2V7Modules: { pvp: { pending: () => false } }, on: true, running: true, tabOwner: true, invBusy: false, rt: {}, abHold: () => false,
    PointerEvent: class { constructor(type) { this.type = type; } }, MouseEvent: class { constructor(type) { this.type = type; } } };
  box.window = box; vm.createContext(box); vm.runInContext(src.slice(start, end) + '\nthis.fire = fire;', box);
  return box;
}
function button(click) {
  return { scrollIntoView() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 20, height: 20 }),
    dispatchEvent: event => { if (event.type === 'click') click(); } };
}
async function buy(stop) {
  const box = core(); let money = 1000, open = false, confirmed = 0;
  const confirm = button(() => { confirmed++; money -= 20; open = false; });
  const start = button(() => { open = true; }), input = { focus() {} }, name = { textContent: 'Potion' };
  const price = { className: 'l2-gm-shop-price--adena', textContent: '10 Adena', querySelectorAll: () => [] };
  const row = { className: '', querySelector: selector => selector === '.l2-gm-shop-name' ? name : selector === '.l2-gm-shop-price' ? price : selector === '.l2-gm-shop-buy' ? start : null };
  const modal = { querySelector: selector => selector === '[data-buy-qty-confirm]' ? confirm : input };
  box.document = { querySelector: () => null, querySelectorAll: selector => selector === '.l2-gm-shop-name' ? [name] : selector === '.l2-gm-shop-row' ? [row] : [] };
  vm.runInContext(read('modules/economy.js'), box);
  const env = { cfg: { shopReserve: 0, shopMaxSpend: 10000 }, rt: {}, get on() { return box.on; }, fire: box.fire,
    $q: selector => selector === '.l2-gm-shop-adena__amount' ? { textContent: String(money) } : selector === '#l2-drops-shop-buy-qty-modal' && open ? modal : null,
    waitX: async fn => fn(), sleep: async () => { if (stop && open) box.on = false; }, rnd: () => 300,
    shown: el => !!el, setVal: (el, value) => { el.value = value; }, rec() {}, setRt: async () => {} };
  await box.L2V7Factories.economy(env).shopBuyOne({ key: 'hp', name: /^Potion$/, label: 'Potion' }, 2);
  return { confirmed, money };
}
test('остановленный автоматический цикл не подтверждает покупку после sleep', async () => {
  const result = await buy(true);
  assert.equal(result.confirmed, 0, 'настоящие shopBuyOne + core.fire отправили click после Stop');
  assert.equal(result.money, 1000);
});
test('активный владелец по-прежнему подтверждает запланированную покупку', async () => {
  const result = await buy(false); assert.equal(result.confirmed, 1); assert.equal(result.money, 980);
});
test('потерявшая замок вкладка не может нажать кнопку при включённом боте', () => {
  const box = core(); box.tabOwner = false; let clicks = 0;
  assert.equal(box.fire(button(() => clicks++)), false); assert.equal(clicks, 0);
});
test('явная ручная проверка оружия при выключенном боте сохраняет клики', () => {
  // 14.10: явный off scan имеет manual; остаток автоматического тура после Stop не должен оживать.
  const box = core(); box.on = false; box.running = false; box.invBusy = true; box.rt.invScan = { t: Date.now(), manual: true }; let clicks = 0;
  assert.equal(box.fire(button(() => clicks++)), true); assert.equal(clicks, 1);
});
test('выключенный бот по-прежнему раскрывает три ряда панели без игровых действий', async () => {
  const box = core(); box.on = false; box.running = false;
  const hb = { dataset: { visibleRows: '1' } }, down = button(() => { hb.dataset.visibleRows = String(+hb.dataset.visibleRows + 1); });
  down.matches = selector => selector === '.l2-battle-hotbar__row-nav--down';
  box.document = { querySelectorAll: () => [{}, {}, {}] };
  box.env = { $q: selector => selector === '.l2-battle-hotbar' ? hb : down, fire: box.fire, waitX: async fn => fn(), rt: {}, rec() {}, setRt() {} };
  const src = read('modules/combat.js'), start = src.indexOf('async function hotbarRows3()'), end = src.indexOf('// 10.0.10', start);
  vm.runInContext(src.slice(start, end) + '\nthis.expand=hotbarRows3;', box); await box.expand();
  assert.equal(hb.dataset.visibleRows, '3');
  let actions = 0; assert.equal(box.fire(button(() => actions++)), false); assert.equal(actions, 0);
});
test('исключения для ручного инвентаря и панели не обходят антибот', () => {
  const box = core(); box.on = false; box.running = false; box.invBusy = true; box.rt.invScan = { t: Date.now() }; box.abHold = () => true;
  let clicks = 0; const b = button(() => clicks++);
  assert.equal(box.fire(b), false);
  box.invBusy = false; b.matches = () => true; assert.equal(box.fire(b), false); assert.equal(clicks, 0);
  box.on = true; b.closest = () => ({}); assert.equal(box.fire(b), true, 'крестик сообщения о блоке фарма остаётся доступен');
});

function postCore() {
  const src = read('content.js'), start = src.indexOf('async function gamePost('), end = src.indexOf('async function gameGet(', start);
  const requests = [], box = { rt:{}, console, L2V7Modules: { pvp: { pending: () => false } }, on: true, tabOwner: true, AbortController, setTimeout, clearTimeout,
    autonomyMode: () => 'farm', // 15.10: проверяем Stop/lease обычного режима; смена на заточку покрыта отдельным диспетчерским тестом.
    gameAuth: () => ({}), fetch: async (url, init) => { requests.push({ url, method: init.method }); return { ok: true, json: async () => ({ clan: { name: 'Test' }, taskDefinitions: [], activeClanTasks: [], me: {} }) }; } };
  vm.createContext(box); vm.runInContext(src.slice(start, end) + '\nthis.gamePost=gamePost;', box);
  return { box, requests };
}
for (const lost of ['stop', 'lease']) test('прямой POST не отправляется после ' + lost, async () => {
  const { box, requests } = postCore(); if (lost === 'stop') box.on = false; else box.tabOwner = false;
  await box.gamePost('/game/clan-tasks/kill_monsters/take', {}).catch(() => null);
  assert.equal(requests.length, 0);
});
test('прямой POST активного владельца сохранён', async () => {
  const { box, requests } = postCore(); await box.gamePost('/game/clan-tasks/kill_monsters/take', {});
  assert.deepEqual(requests, [{ url: '/game/clan-tasks/kill_monsters/take', method: 'POST' }]);
});
for (const lost of ['stop', 'lease']) for (const stage of ['mammon', 'story', 'tvtshop']) test('диспетчер после await ' + stage + ' не начинает клановое действие: ' + lost, async () => {
  const { box, requests } = postCore(); vm.runInContext(read('modules/dailies.js'), box);
  const rt = { clanTasks: { t: Date.now(), me: {}, active: [], defs: [{ id: 'kill_monsters', canTake: true, n: 'Охота', reward: {} }] } };
  const dailies = box.L2V7Factories.dailies({ cfg: {}, rt, isBattle: () => false, gamePost: box.gamePost,
    rec() {}, setRt: async p => Object.assign(rt, p) });
  const next = name => async () => { await Promise.resolve(); if (name === stage) { if (lost === 'stop') box.on = false; else box.tabOwner = false; } return false; };
  box.L2V7Modules = { mammon: { mmStep: next('mammon') },
    story: { storyTick: async () => {}, storyStep: next('story') }, tvtshop: { shopStep: next('tvtshop') },
    dailies: { tick: async () => {}, clanStep: dailies.clanStep, dailyStep: async () => false } };
  box.sleep = async () => {};
  // Настоящий порядок диспетчера: mmStep может ждать gearDb/setRt и вернуться false; затем шёл клановый POST.
  box.L2EngineCore = require('../engine-core.js'); box.cfg = {};
  const src = read('content.js'), start = src.indexOf("\n  if (L2EngineCore.taskAllowed(cfg,'mammon') && await L2V7Modules.mammon.mmStep())"), end = src.indexOf('\n  if (epicOn())', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(src.match(/^const loopStale = .*$/m)[0], box);   // 20.13 (шаг 7): участок стал шагом loopSideJobs(), охрана — общий помощник
  vm.runInContext('this.runDispatch=async()=>{for(let i=0;i<1;i++){\n' + src.slice(start, end) + '\n}};', box);
  await box.runDispatch();
  assert.equal(requests.length, 0, 'остановленный диспетчер вызвал POST');
  assert.equal(rt.clanTaskFail, undefined, 'Stop не должен записывать ложный отказ сервера на 30 минут');
});
