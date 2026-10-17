'use strict';
// 20.13 (ревизия 17.10, шаг 7, участок modules): чистка кода модулей без смены поведения бота.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const read = n => fs.readFileSync(path.join(__dirname, '..', n), 'utf8');
const response = j => ({ ok: true, status: 200, json: async () => j });
function fixture(n, extra = {}) {
  const loc = { pathname: '/map.html', search: '', href: '' }, notes = [], storage = new Map();
  const box = { console, Date, URLSearchParams, CSS: { escape: x => x }, location: loc, document: { querySelectorAll: () => [] },
    sessionStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) } };
  vm.runInNewContext(read('modules/' + n + '.js'), box);
  const e = { on: true, tabOwner: true, cfg: {}, rt: { char: 'Hero', manualKickAt: 1 }, setRt: async p => { Object.assign(e.rt, p); return { ok: true }; },
    rec: (...x) => notes.push(x), setStatus() {}, sleep: async () => {}, gameGet: async () => response({}), tvtSoon: () => false, tvtHold: () => false,
    autonomyMode: () => 'farm', ...extra };
  return { e, M: box.L2V7Factories[n](e), notes, storage };
}

test('SUB-1: пока ник героя не прочитан, герой не помощник и недостачу не пишет', async () => {
  let nick = '';
  const shared = {};
  const f = fixture('subclass', { cfg: { subMainNick: 'Warlock', mmGoalItem: 5 }, heroNick: () => nick,
    sharedSet: async (k, v) => { shared[k] = v; }, sharedGet: async k => shared[k],
    mammon: { goalAll: () => ({ name: 'Staff', to: 5, raw: [{ id: 1, nm: 'Ore', miss: 3 }] }) } });
  assert.equal(f.M.isHelper(), false, 'пустой ник — не помощник');
  assert.equal(await f.M.needWrite(Date.now()), false, 'пустой ник — subNeed не пишется');
  f.e.rt.subHandReq = { t: Date.now() };
  assert.equal(f.M.handWant(Date.now()), null, 'команда передачи ждёт ник, а не снимается');
  nick = 'Warlock';
  assert.equal(f.M.isHelper(), false, 'сам основной');
  nick = 'Helper';
  assert.equal(f.M.isHelper(), true, 'другой герой — помощник');
});

test('TVT-7: без известного состояния и при нерабочем /game/tvt опрос реже (5 с → 30 с → 5 мин), удача сбрасывает', async () => {
  let calls = 0, ok = false;
  const f = fixture('tvt', { cfg: { tvtOn: true }, gameGet: async () => { calls++; return ok ? response({ phase: 'IDLE' }) : { ok: false, status: 403, json: async () => ({}) }; } });
  const realNow = Date.now; let now = realNow.call(Date);
  Date.now = () => now;
  try {
    for (let i = 0; i < 3; i++) { await f.M.tvtRefresh(); now += 5001; }
    assert.equal(calls, 3, 'первые три неудачи — раз в 5 с');
    await f.M.tvtRefresh();
    assert.equal(calls, 3, 'после трёх неудач 5 с мало');
    now += 25000; await f.M.tvtRefresh();
    assert.equal(calls, 4, 'через 30 с — снова');
    for (let i = 0; i < 2; i++) { now += 30001; await f.M.tvtRefresh(); }
    assert.equal(calls, 6);
    now += 30001; await f.M.tvtRefresh();
    assert.equal(calls, 6, 'после шести неудач — не чаще раза в 5 мин');
    now += 300001; ok = true; await f.M.tvtRefresh();
    assert.equal(calls, 7);
    assert.equal(f.e.rt.tvt?.phase, 'IDLE', 'удачный ответ сохранён');
  } finally { Date.now = realNow; }
});

test('TVT-8: метка «уже написали про окно» не пишется в rt мимо setRt', () => {
  const src = read('modules/tvt.js');
  assert.doesNotMatch(src, /env\.rt\.tvtHoldNote\s*=/);
  assert.match(src, /let holdNote = ''/);
});

test('MF-3: метки «пропускаю — …» раз в 10 мин хранятся в sessionStorage, а не только в памяти модуля', () => {
  const src = read('modules/mobfarm.js');
  assert.match(src, /const SKIP_KEY = 'l2bot\.skipRecT'/);
  assert.match(src, /function cancelSkip[\s\S]{0,200}if \(!skipDue\(k\)\) return;/);
  assert.match(src, /function champSkip[\s\S]{0,200}if \(!skipDue\(k\)\) return;/);
  assert.doesNotMatch(src, /const skipRecT = \{\}/);
});

test('BF-4: пороги «кончается» в buffs — две именованные константы с прежними значениями', () => {
  const src = read('modules/buffs.js');
  assert.match(src, /const FA_RENEW_MS = 60000, BUFF_LOW_MS = 10 \* 60000;/);
  assert.equal((src.match(/H\[id\] - Date\.now\(\) < FA_RENEW_MS/g) || []).length, 2);
  assert.equal((src.match(/H\[id\] - Date\.now\(\) < BUFF_LOW_MS/g) || []).length, 2);
});

test('CQ-1: мёртвые rest() и now_ удалены, резерв рыбака — одна функция', () => {
  const res = read('modules/resources.js'), raid = read('modules/raid.js'), fish = read('modules/fishing.js'), content = read('content.js');
  assert.doesNotMatch(res, /async function rest\(/);
  assert.doesNotMatch(content, /resources\.rest\(|raid\.now_\(/);
  assert.doesNotMatch(raid, /\bnow_\b(?! удалён)/);
  assert.equal((fish.match(/Math\.max\(0, ?\+env\.cfg\.shopReserve \|\| ?0\)/g) || []).length, 1, 'одна копия формулы резерва');
  assert.equal((fish.match(/fishReserve\(\)/g) || []).length, 3);
});
