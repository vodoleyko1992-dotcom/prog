'use strict';
// 20.41 (лог 20.10 21:09:13–21:09:31, 21:12:12): тур РБ выбирал цель из списка 3–6 мин давности. Перед переходом — один JSON-GET
// страницы цели (rbtimer.pageCheck), а открытая страница списка освежает rbList/таймеры по всем строкам, не только по цели.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const { mk, docOf } = require('./epic-harness.cjs');
const rbtSrc = fs.readFileSync(path.join(__dirname, '../modules/rbtimer.js'), 'utf8');
const ID = 'l2dop_rb_99999', OTHER = 'l2dop_rb_88888', OLD = Date.now() - 5 * 60000;

function timerFor(env) {
  const box = { Date, Math, JSON, console, sessionStorage: { getItem: () => null, setItem() {} } }; box.globalThis = box;
  vm.runInNewContext(rbtSrc, box);
  return box.L2V7Factories.rbtimer({ get cfg() { return env.cfg; }, get rt() { return env.rt; }, get setRt() { return env.setRt; }, get rec() { return env.rec; },
    get gameGet() { return env.gameGet; }, heroLevel: () => 54, sleep: async () => {}, RB_WIN: 15 });
}
const reply = (aliveTarget, page = 1) => ({ page, totalPages: 14, bosses: [
  { spawnId: ID, name: 'Audit Raid', level: 54, bossType: 'raid', isAlive: aliveTarget, adenaCost: 1000, canAttack: true },
  { spawnId: OTHER, name: 'Other Raid', level: 55, bossType: 'raid', isAlive: false, adenaCost: 1000, canAttack: true }] });
const rowHtml = (id, name, alive) => `<div class="l2-rb-row"><span class="l2-rb-row__label">${name}</span><span class="l2-rb-row__level">54</span><span class="l2-rb-row__status ${alive ? 'l2-rb-row__status--alive' : 'l2-rb-row__status--dead'}">${alive ? 'Живой' : 'Убит'}</span><span class="l2-rb-row__price">1000 аден</span><button class="l2-rb-row__tp" data-spawn-id="${id}">Телепорт</button></div>`;

function fixture({ t = OLD, onPage = false, net, doc } = {}) {
  const g = { id: ID, name: 'Audit Raid', lvl: 54, page: 1, price: 1000, unit: 'аден', alive: true, t };
  const m = mk({ path: onPage ? '/rb-bosses.html' : '/map.html', search: onPage ? '?page=1' : '', doc: doc || docOf(''), cfg: { epicMode: false },
    rt: { char: 'Warlock', classCur: { prof: 'human_warlock', slot: 0 }, adenaSeen: { v: 1000000, t: Date.now() }, rbHunt: { ...g, step: 'go', t: Date.now() },
      rbList: { [ID]: g, [OTHER]: { name: 'Other Raid', lvl: 55, page: 1, alive: true, price: 1000, unit: 'аден', t } },
      rbStats: { [ID]: { hp: 1000, patk: 1, matk: 1, mdef: 1, pdef: 1, src: 'api' } }, rbDb: {} },
    env: { tabOwner: true, warlock: { raidContext: () => ({ managed: true, key: 'same', powerKey: 'same', prepared: true }) } } });
  const gets = [];
  m.env.gameGet = async url => { gets.push(url); const r = /^\/character/.test(url) ? { character: { name: 'Warlock', inBattle: false, adena: 1000000 } } : net ? net(url) : null; return r ? { ok: true, status: 200, json: async () => r } : { ok: false, status: 500 }; };
  m.env.rbTimer = timerFor(m.env); m.gets = gets;
  return m;
}

test('устаревшая строка: убитая цель отсеивается одним JSON-GET без перехода на страницу списка', async () => {
  const m = fixture({ net: url => url.includes('raid-bosses?page=1') ? reply(false) : null });
  await m.R.rbHuntStep();
  assert.deepEqual(m.gets.filter(u => u.includes('raid-bosses')), ['/game/raid-bosses?page=1']);
  assert.equal(m.loc.href, '', 'на страницу списка не уходим');
  assert.equal(m.env.rt.rbHunt.step, 'pick');
  assert.match(m.env.rt.rbHunt.last, /по свежему списку игры/);
  assert.equal(m.env.rt.rbList[ID].alive, false);
  assert.equal(m.env.rt.rbList[OTHER].alive, false, 'соседние строки той же страницы тоже освежены');
  assert.equal(m.env.rt.rbTimer.b[OTHER].al, false);
  assert.equal(m.fires.length, 0);
});
test('живая цель по свежему списку — прежний путь к странице списка', async () => {
  const m = fixture({ net: url => url.includes('raid-bosses?page=1') ? reply(true) : null });
  await m.R.rbHuntStep();
  assert.equal(m.gets.filter(u => u.includes('raid-bosses')).length, 1);
  assert.equal(m.loc.href, '/rb-bosses.html?page=1');
  assert.equal(m.env.rt.rbHunt.step, 'go');
  assert.ok(Date.now() - m.env.rt.rbList[ID].t < 5000);
});
test('строка свежее минуты — без лишнего запроса', async () => {
  const m = fixture({ t: Date.now(), net: () => reply(false) });
  await m.R.rbHuntStep();
  assert.equal(m.gets.filter(u => u.includes('raid-bosses')).length, 0);
  assert.equal(m.loc.href, '/rb-bosses.html?page=1');
});
test('ошибка GET не останавливает тур: прежний переход на страницу', async () => {
  const m = fixture({ net: () => null });
  await m.R.rbHuntStep();
  assert.equal(m.loc.href, '/rb-bosses.html?page=1');
  assert.equal(m.env.rt.rbHunt.step, 'go');
});
test('открытая страница списка освежает rbList и таймеры по всем строкам, а не только по цели', async () => {
  const doc = docOf(`<div id="rb-list">${rowHtml(ID, 'Audit Raid', true)}${rowHtml(OTHER, 'Other Raid', false)}</div>`);
  const m = fixture({ onPage: true, doc, net: () => reply(true) });
  m.env.pause = async () => { m.env.on = false; };    // до оплаты не доходим
  await m.R.rbHuntStep();
  assert.equal(m.env.rt.rbList[OTHER].alive, false);
  assert.equal(m.env.rt.rbList[OTHER].name, 'Other Raid');
  await new Promise(r => setImmediate(r));
  assert.equal(m.env.rt.rbTimer.b[OTHER].al, false);
  assert.equal(m.env.rt.rbTimer.b[ID].al, true);
  assert.equal(m.fires.length, 0);
});
test('страница списка: «жив» ≤10 мин после своего килла не оживляет соседа в очереди тура', async () => {
  const doc = docOf(`<div id="rb-list">${rowHtml(ID, 'Audit Raid', true)}${rowHtml(OTHER, 'Other Raid', true)}</div>`);
  const m = fixture({ onPage: true, doc, net: () => reply(true) }), k = Date.now() - 60000;
  m.env.rt.rbList[OTHER].alive = false;
  m.env.rt.rbTimer = { b: { [OTHER]: { n: 'Other Raid', l: 55, al: false, dl: k, dh: k, k, ls: k } } };
  m.env.pause = async () => { m.env.on = false; };
  await m.R.rbHuntStep();
  assert.equal(m.env.rt.rbList[OTHER].alive, false);
});
test('pageCheck уважает занятый опрос тура и смену героя', async () => {
  const env = { cfg: {}, rt: { char: 'A', classCur: { prof: 'x', slot: 0 }, rbList: { [ID]: { page: 1, lvl: 54 } } }, rec() {}, setRt: async p => { Object.assign(env.rt, p); } };
  let release; const gate = new Promise(r => release = r), gets = [];
  env.gameGet = async url => { gets.push(url); await gate; return { ok: true, json: async () => reply(false) }; };
  const T = timerFor(env);
  const poll = T.tourTick({ active: () => true });
  assert.equal(await T.pageCheck(1, ID, () => true), null, 'опрос тура занят — без второго запроса');
  release(); await poll;
  const n = gets.length;
  let rel2; const gate2 = new Promise(r => rel2 = r);
  env.gameGet = async url => { gets.push(url); await gate2; return { ok: true, json: async () => reply(true) }; };
  env.rt.rbList[ID].alive = false;
  const p = T.pageCheck(1, ID, () => true);
  env.rt = { ...env.rt, char: 'B' }; rel2();
  assert.equal(await p, null);
  assert.equal(gets.length, n + 1);
  assert.equal(env.rt.rbList[ID].alive, false, 'ответ чужого героя не записан');
});
// 20.41 (ревью): цель убита на открытой странице — и тогда освежаются все строки страницы, а не только она.
test('цель на открытой странице убита: соседняя убитая строка тоже уходит из очереди тура', async () => {
  const doc = docOf(`<div id="rb-list">${rowHtml(ID, 'Audit Raid', false)}${rowHtml(OTHER, 'Other Raid', false)}</div>`);
  const m = fixture({ onPage: true, doc, net: () => reply(false) });
  await m.R.rbHuntStep();
  assert.equal(m.env.rt.rbHunt.step, 'pick');assert.equal(m.env.rt.rbList[ID].alive, false);
  assert.equal(m.env.rt.rbList[OTHER].alive, false, 'сосед на той же странице');
  await new Promise(r => setImmediate(r));assert.equal(m.env.rt.rbTimer.b[OTHER].al, false);assert.equal(m.fires.length, 0);
});
