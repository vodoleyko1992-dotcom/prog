'use strict';
// Hook получает полный JSON, журнал остаётся коротким; fetch/XHR не меняют ответ игры.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/../hook.js', 'utf8');
const path = '/game/spawn/l2dop_rb_25051/info', ordinary = () => ({ itemId: 1, chance: 1 });
function fixture(data) {
  const messages = [], calls = [];
  class Xhr {
    open() {} send() { this.status = 200; this.responseType = 'json'; this.response = data; this.listener(); }
    addEventListener(_, f) { this.listener = f; }
    getResponseHeader() { return 'application/json'; }
  }
  const response = { status: 200, headers: { get: () => 'application/json' }, clone: () => ({ text: async () => JSON.stringify(data) }) };
  const window = { postMessage: m => messages.push(m), fetch: async (...args) => { calls.push(args); return response; } };
  const box = { window, XMLHttpRequest: Xhr, URL, URLSearchParams, location: new URL('https://l2wap.com/map.html'),
    performance: { now: () => 1 }, console };
  vm.runInNewContext(source, box);
  return { window, Xhr, response, messages, calls, net: () => messages.filter(m => m.__l2bot === 'net').at(-1) };
}
for (const transport of ['fetch', 'xhr']) test(transport + ': свиток после первых8строк сохраняется, исходный ответ и redaction не меняются', async () => {
  const data = { stats: { maxHp: 10000 }, drops: [...Array.from({ length: 12 }, ordinary), { l2ItemId: 910529, chance: .005 }], authToken: 'fixture-secret' };
  const before = JSON.stringify(data), f = fixture(data);
  if (transport === 'fetch') { assert.equal(await f.window.fetch(path), f.response); await new Promise(setImmediate); assert.equal(f.calls.length, 1); }
  else { const xhr = new f.Xhr(); xhr.open('GET', path); xhr.send(); assert.equal(xhr.response, data); }
  const msg = f.net(); assert.equal(msg.res.scrollDrops, true); assert.equal(msg.res.drops.length, 9);
  assert.match(msg.res.drops.at(-1), /ещё/); assert.equal(msg.res.authToken, '***');
  assert.equal(JSON.stringify(data), before);
});
test('summary false подтверждает отсутствие, нулевой шанс/телепорт/неизвестный ID не дают true', async () => {
  const f = fixture({ drops: [...Array.from({ length: 8 }, ordinary), { itemId: 910510, chance: 0 }, { itemId: 736, chance: 1 }, { itemId: 910600, chance: 1 }] });
  await f.window.fetch(path); await new Promise(setImmediate); assert.equal(f.net().res.scrollDrops, false);
});
test('summary отсутствует у другого эндпоинта, неполного массива и отсутствующего drops', async () => {
  for (const [url, data] of [['/character', { drops: [{ itemId: 910510, chance: 1 }] }], [path, {}], [path, { drops: [ordinary(), '…ещё 5'] }],
    [path, { drops: [{ itemId: 910510 }] }], [path, { drops: [ordinary(), '…ещё 5'], scrollDrops: false }]]) {
    const f = fixture(data); await f.window.fetch(url); await new Promise(setImmediate); assert.equal(f.net().res.scrollDrops, undefined);
  }
});
