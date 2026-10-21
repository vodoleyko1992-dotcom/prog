'use strict';
// 20.42 (быстрый удар, решение John 20.10): hook.js снимает delta.hotbarStale только у обычного удара бота в середине боя
// и только если собственный GET /character игры был не позже 5 с назад. Остальные ответы отдаются игре как были.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

function page() {
  let now = 1e9;
  const routes = new Map(), dataset = {};
  const fetch = async (url) => { const u = new URL(url, 'https://l2wap.com'); const r = routes.get(u.pathname); return new Response(JSON.stringify(r), { status: 200, headers: { 'content-type': 'application/json', 'content-length': '999' } }); };
  const window = { fetch, postMessage() {} };
  const box = { window, location: new URL('https://l2wap.com/battle.html'), document: { documentElement: { dataset } }, sessionStorage: { getItem: () => null, setItem() {} },
    XMLHttpRequest: function () {}, URL, URLSearchParams, Response, Headers, FormData, performance: { now: () => now }, Date: { now: () => now }, console, Promise, JSON };
  box.XMLHttpRequest.prototype = { open() {}, send() {} };
  vm.createContext(box); vm.runInContext(read('hook.js'), box);
  const call = async (p, init) => (await window.fetch(p, init)).json();
  const act = (action, mark = action) => { if (mark) dataset.l2botFast = mark + '|' + now; return call('/game/battle/action', { method: 'POST', body: JSON.stringify({ action, expectedRevision: 5 }) }); };
  return { routes, dataset, call, act, tick: ms => { now += ms; } };
}
const mid = (extra = {}, d = {}) => ({ kind: 'delta', delta: { hotbarStale: true, characterHp: 900, mobHp: 3000, ...d }, ...extra });

test('обычный удар в середине боя после свежего GET /character — hotbarStale снят, остальное как было', async () => {
  const p = page();
  p.routes.set('/character', { character: { name: 'W', revision: 1 } });
  await p.call('/character');
  p.routes.set('/game/battle/action', mid({}, { logTail: ['Полум’я 3000'] }));
  const r = await p.act('l2_1220');
  assert.equal(r.delta.hotbarStale, undefined); assert.equal(r.delta.mobHp, 3000); assert.deepEqual(r.delta.logTail, ['Полум’я 3000']);
  assert.equal(p.dataset.l2botFast, undefined, 'метка одноразовая'); assert.equal(p.dataset.l2botFastN, '1');
  const a = await p.act('attack'); assert.equal(a.delta.hotbarStale, undefined);
});

test('без метки бота, чужое действие, старая метка или банка — ответ без изменений', async () => {
  const p = page();
  p.routes.set('/character', {}); await p.call('/character');
  p.routes.set('/game/battle/action', mid());
  assert.equal((await p.act('attack', null)).delta.hotbarStale, true, 'ручной удар игрока');
  assert.equal((await p.act('l2_1220', 'attack')).delta.hotbarStale, true, 'метка другого действия');
  assert.equal((await p.act('battle_potion_use')).delta.hotbarStale, true, 'банка');
  p.dataset.l2botFast = 'attack|' + (1e9 - 2000);
  assert.equal((await p.act('attack', null)).delta.hotbarStale, true, 'метка старше 1,5 с');
});

test('GET /character игры старше 5 с — игре даём обновить персонажа', async () => {
  const p = page();
  p.routes.set('/game/battle/action', mid());
  assert.equal((await p.act('attack')).delta.hotbarStale, true, 'GET ещё не было');
  p.routes.set('/character', {}); await p.call('/character'); p.tick(5001);
  assert.equal((await p.act('attack')).delta.hotbarStale, true);
  await p.call('/character'); p.tick(100);
  assert.equal((await p.act('attack')).delta.hotbarStale, undefined);
});

test('конец боя, смерть, PvP и полные ответы не трогаем', async () => {
  const p = page();
  p.routes.set('/character', {}); await p.call('/character');
  const cases = [mid({ victory: { exp: 1 } }), mid({ defeat: {} }), mid({ lethalMeta: { battleEnded: true } }), mid({}, { battleEnded: true }), mid({}, { mobHp: 0 }),
    mid({}, { characterHp: 0 }), mid({}, { pvpEnd: {} }), mid({ pvpDefeat: { killerName: 'X' } }), mid({}, { characterHp: undefined }), { kind: 'full', delta: { hotbarStale: true, characterHp: 1, mobHp: 1 }, battle: {} }];
  for (const c of cases) { p.routes.set('/game/battle/action', c); assert.equal((await p.act('attack')).delta.hotbarStale, true, JSON.stringify(c)); }
});

test('combat.act ставит метку только для удара и при включённом cfg.fastTurn; выключатель в «Бой»', () => {
  const combat = read('modules/combat.js');
  assert.match(combat, /fastMark\(b, exact\);\n\s+if \(!env\.fire\(b\)\)/);
  assert.match(combat, /env\.cfg\.fastTurn !== false && fastHit\(b, exact\)/);
  const src = combat.slice(combat.indexOf('const FAST_T'), combat.indexOf('const fastMark'));
  const fastHit = vm.runInNewContext(src + '\nfastHit;', { env: { ilOf: b => b.il }, healSlot: b => !!b.heal });
  assert.equal(fastHit({}, 'attack'), true);
  assert.equal(fastHit({ il: { t: 'MDAM', o: 'ACTIVE' } }, 'l2_1220'), true);
  assert.equal(fastHit({ il: { t: 'DRAIN', o: 'ACTIVE' }, heal: 1 }, 'l2_1234'), false, 'лечение');
  assert.equal(fastHit({ il: { t: 'BUFF', o: 'TOGGLE' } }, 'l2_312'), false, 'тоггл');
  assert.equal(fastHit({ il: { t: 'SUMMON', o: 'ACTIVE' } }, 'l2_1279'), false, 'призыв');
  assert.equal(fastHit({ il: { t: 'BUFF', o: 'ACTIVE' } }, 'l2_1331'), false, 'бафф');
  assert.equal(fastHit({}, 'battle_potion_use'), false);
  assert.equal(fastHit({}, 'l2_9999'), false, 'неизвестное умение');
  assert.match(read('defaults.js'), /fastTurn: true/);
  assert.match(read('popup.html'), /<input id="fastTurn" type="checkbox">/);
  assert.match(read('popup.js'), /'fastTurn'/);
});
