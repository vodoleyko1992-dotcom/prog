'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.join(__dirname, '..'), no = () => {};
function moduleOf(name, extra = {}) { const box = { console, ...extra }; vm.runInNewContext(fs.readFileSync(path.join(root, 'modules', name + '.js'), 'utf8'), box); return box.L2V7Factories[name]; }
for (const requested of [false, true]) test(`сбой опроса Маммона ${requested ? 'по запросу' : 'по расписанию'} повторяется с паузой и объяснением`, async () => {
  let now = 2e12, calls = 0; const D = class extends Date { static now() { return now; } }, store = new Map(), logs = [];
  const env = { on: true, tabOwner: true, cfg: { mmOrders: false, mmMailClaim: false }, rt: { char: 'Warlock', mmNpc: { order: { at: now + 2 * 3600000 } }, ...(requested ? { mmPollReq: now } : {}) },
    gameGet: async () => { calls++; throw Error('network failed'); }, rec: (...a) => logs.push(a.join(' ')), setRt: async p => Object.assign(env.rt, p) };
  const m = moduleOf('mammon', { Date: D, sessionStorage: { getItem: k => store.get(k), setItem: (k, v) => store.set(k, v) } })(env);
  await m.mmTick(); const firstCalls = calls; now += 30000; await m.mmTick(); assert.equal(calls, firstCalls);
  now += 31000; await m.mmTick(); assert.equal(calls, firstCalls + 1); assert.ok(logs.some(s => /повтор через 60 с/.test(s)));
  if (requested) assert.ok(env.rt.mmPollReq, 'явный запрос сохраняется до успешного опроса');
});
test('успешный повтор Маммона снимает запрос и возвращает обычный интервал', async () => {
  let now = 2e12, fail = true, calls = 0; const D = class extends Date { static now() { return now; } }, store = new Map();
  const env = { on: true, tabOwner: true, cfg: { mmOrders: false, mmMailClaim: false }, rt: { char: 'Warlock', mmPollReq: now },
    gameGet: async path => { calls++; if (fail) throw Error('offline'); return { ok: true, status: 200, json: async () => path.includes('/request') ? { request: null } : { mammonMerchant: { current: { id: 'cat', labelEn: 'Catacombs' } }, mammonBlacksmith: { current: { id: 'cat', labelEn: 'Catacombs' } } } }; },
    rec: no, setRt: async p => Object.assign(env.rt, p) };
  const m = moduleOf('mammon', { Date: D, sessionStorage: { getItem: k => store.get(k), setItem: (k, v) => store.set(k, v) } })(env);
  await m.mmTick(); assert.ok(env.rt.mmPollReq); fail = false; now += 90001; await m.mmTick(); assert.equal(env.rt.mmPollReq, null);
  const after = calls; now += 30000; await m.mmTick(); assert.equal(calls, after);
});
test('временный HTTP 403 не выключает клан, настоящее отсутствие клана пересматривается через 6 часов', async () => {
  let now = 2e12, calls = 0, error = 'temporary_forbidden'; const D = class extends Date { static now() { return now; } };
  const env = { on: true, tabOwner: true, cfg: { dailyAuto: false, clanTasks: true }, rt: { char: 'Warlock' },
    gameGet: async () => { calls++; return { status: 403, ok: false, json: async () => ({ error }) }; }, rec: no, setRt: async p => Object.assign(env.rt, p) };
  const m = moduleOf('dailies', { Date: D, sessionStorage: { getItem: () => null, setItem: no } })(env);
  await m.tick(); assert.equal(env.rt.clanTasks, undefined);
  error = 'clan_required'; now += 11 * 60000; await m.tick(); assert.equal(env.rt.clanTasks.noClan, true);
  now += 5 * 3600000; await m.tick(); assert.equal(calls, 2);
  now += 3600001; await m.tick(); assert.equal(calls, 3);
});
test('пустой успешный ответ клана не выдаётся за отсутствие клана', () => {
  const env = { rt: { char: 'Warlock' }, rec: no, setRt: p => Object.assign(env.rt, p) };
  const m = moduleOf('dailies', { Date, sessionStorage: { getItem: () => null, setItem: no } })(env);
  assert.equal(m.clanNote({}), false); assert.equal(env.rt.clanTasks, undefined);
});
