'use strict';
// Lite 1.2 (21.10, тред «Упрошенка под Дестра», решение John «Разрешаю», «по умолчанию вкл»): быстрый удар из основного бота 20.42.
// lite/hook.js снимает delta.hotbarStale только у обычного удара Lite (метка data-l2lite-fast) в середине боя и только если
// собственный GET /character игры был не позже 5 с назад (с 1.5.1 — 30 с); остальные ответы отдаются игре как были. Выключатель — «Ещё» в меню.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const L = require('../lite/logic.js');

function page() {
  let now = 1e9;
  const routes = new Map(), dataset = {}, posts = [];
  const fetch = async url => { const u = new URL(url, 'https://l2wap.com'); return new Response(JSON.stringify(routes.get(u.pathname)), { status: 200, headers: { 'content-type': 'application/json', 'content-length': '999' } }); };
  const window = { fetch, postMessage: d => posts.push(d) };
  const box = { window, location: new URL('https://l2wap.com/battle.html'), document: { documentElement: { dataset } },
    XMLHttpRequest: function () {}, URL, Response, Headers, Date: { now: () => now }, console, Promise, JSON };
  box.XMLHttpRequest.prototype = { open() {}, send() {} };
  vm.createContext(box); vm.runInContext(read('lite/hook.js'), box);
  const call = async (p, init) => (await window.fetch(p, init)).json();
  const act = (action, mark = action) => { if (mark) dataset.l2liteFast = mark + '|' + now; return call('/game/battle/action', { method: 'POST', body: JSON.stringify({ action, expectedRevision: 5 }) }); };
  return { routes, dataset, posts, call, act, tick: ms => { now += ms; } };
}
const mid = (extra = {}, d = {}) => ({ kind: 'delta', delta: { hotbarStale: true, characterHp: 900, characterMaxHp: 1000, characterMp: 300, characterMaxMp: 400, mobHp: 3000, ...d }, ...extra });
const flush = () => new Promise(r => setTimeout(r, 5));

test('обычный удар Lite в середине боя после свежего GET /character — hotbarStale снят, остальное как было', async () => {
  const p = page();
  p.routes.set('/character', { character: { name: 'D', revision: 1 } });
  await p.call('/character');
  p.routes.set('/game/battle/action', mid({}, { logTail: ['Fatal Strike 3000'], skillCooldowns: [{ skillId: 190, remainingSec: 12 }] }));
  const r = await p.act('l2_190');
  assert.equal(r.delta.hotbarStale, undefined); assert.equal(r.delta.mobHp, 3000); assert.deepEqual(r.delta.logTail, ['Fatal Strike 3000']);
  assert.deepEqual(r.delta.skillCooldowns, [{ skillId: 190, remainingSec: 12 }]);
  assert.equal(p.dataset.l2liteFast, undefined, 'метка одноразовая'); assert.equal(p.dataset.l2liteFastN, '1');
  assert.equal((await p.act('attack')).delta.hotbarStale, undefined);
  // бот получает HP/MP героя из ответа хода
  await flush();
  const end = p.posts.filter(x => x.__l2lite === 'end' && x.path === '/game/battle/action').pop();
  assert.deepEqual(JSON.parse(JSON.stringify(end.me)), { hp: 900, maxHp: 1000, mp: 300, maxMp: 400 });
});

test('без метки Lite, метка основного бота, чужое действие, старая метка или банка — ответ без изменений', async () => {
  const p = page();
  p.routes.set('/character', {}); await p.call('/character');
  p.routes.set('/game/battle/action', mid());
  assert.equal((await p.act('attack', null)).delta.hotbarStale, true, 'ручной удар игрока');
  p.dataset.l2botFast = 'attack|' + 1e9;
  assert.equal((await p.act('attack', null)).delta.hotbarStale, true, 'метка основного бота — не наша');
  assert.equal((await p.act('l2_190', 'attack')).delta.hotbarStale, true, 'метка другого действия');
  assert.equal((await p.act('battle_potion_use')).delta.hotbarStale, true, 'банка');
  assert.equal((await p.act('power_smash')).delta.hotbarStale, true, 'именованный actionId — как в основном боте, не трогаем');
  assert.equal((await p.act('soul_of_sagittarius')).delta.hotbarStale, true, 'бафф лучника под именем игры');
  p.dataset.l2liteFast = 'attack|' + (1e9 - 2000);
  assert.equal((await p.act('attack', null)).delta.hotbarStale, true, 'метка старше 1,5 с');
  assert.equal(p.dataset.l2liteFastN, undefined);
});

test('1.5: выстрел лучника под именем игры (метка Lite) — hotbarStale снят', async () => {
  const p = page();
  p.routes.set('/character', {}); await p.call('/character');
  p.routes.set('/game/battle/action', mid());
  assert.equal((await p.act('double_shot')).delta.hotbarStale, undefined);
  assert.equal((await p.act('power_shot', null)).delta.hotbarStale, true, 'выстрел игрока руками');
});

// 1.5.1 (John 21.10: «поставь пересчет не раз в 5 а раз в 30 сек»): окно — 30 с вместо 5.
test('GET /character игры старше 30 с — игре даём обновить персонажа; моложе 30 с — нет', async () => {
  const p = page();
  p.routes.set('/game/battle/action', mid());
  assert.equal((await p.act('attack')).delta.hotbarStale, true, 'GET ещё не было');
  p.routes.set('/character', {}); await p.call('/character'); p.tick(29000);
  assert.equal((await p.act('attack')).delta.hotbarStale, undefined, '29 с после GET — ещё без перечитывания');
  p.tick(1001);
  assert.equal((await p.act('attack')).delta.hotbarStale, true, '30 с прошло — игра перечитывает героя');
  await p.call('/character'); p.tick(100);
  assert.equal((await p.act('attack')).delta.hotbarStale, undefined);
});
test('1.5.1: ответ без activeBuffs — buffs не «пусто», а неизвестно', async () => {
  const p = page();
  p.routes.set('/character', { character: { name: 'D', toggleStances: [] } }); await p.call('/character'); await flush();
  p.routes.set('/character', { character: { name: 'D', activeBuffs: [{ skillId: 312, expiresAt: null }] } }); await p.call('/character'); await flush();
  const chs = p.posts.filter(d => d.ch).map(d => d.ch);
  assert.equal(chs[0].buffs, undefined);
  assert.deepEqual(chs[1].buffs.map(b => b.id), [312]);
});

test('конец боя, смерть, PvP, TvT и полные ответы не трогаем', async () => {
  const p = page();
  p.routes.set('/character', {}); await p.call('/character');
  const cases = [mid({ victory: { exp: 1 } }), mid({ defeat: {} }), mid({ lethalMeta: { battleEnded: true } }), mid({}, { battleEnded: true }), mid({}, { mobHp: 0 }),
    mid({}, { characterHp: 0 }), mid({}, { pvpEnd: {} }), mid({ pvpDefeat: { killerName: 'X' } }), mid({}, { characterHp: undefined }), { kind: 'full', delta: { hotbarStale: true, characterHp: 1, mobHp: 1 }, battle: {} }];
  for (const c of cases) { p.routes.set('/game/battle/action', c); assert.equal((await p.act('attack')).delta.hotbarStale, true, JSON.stringify(c)); }
  p.routes.set('/game/tvt/action', mid());
  p.dataset.l2liteFast = 'attack|' + 1e9;
  const tv = await p.call('/game/tvt/action', { method: 'POST', body: JSON.stringify({ action: 'attack' }) });
  assert.equal(tv.delta.hotbarStale, true, 'арена TvT');
});

test('метку получают только обычная атака и известные удары по цели', () => {
  const sl = (action, title, choice) => ({ ...L.skillUse(L.skillInfo(action, title), choice), action });
  assert.equal(L.fastHit(sl('attack', 'Атака')), true);
  assert.equal(L.fastHit(sl('l2_190', 'Fatal Strike')), true);
  assert.equal(L.fastHit(sl('l2_315', 'Crush of Doom')), true);
  assert.equal(L.fastHit(sl('l2_176', 'Frenzy')), false, 'лимит');
  assert.equal(L.fastHit(sl('l2_94', 'Rage')), false, 'бафф');
  assert.equal(L.fastHit(sl('l2_312', 'Vicious Stance')), false, 'стойка');
  assert.equal(L.fastHit(sl('l2_440', 'Braveheart')), false, 'лечение');
  assert.equal(L.fastHit(sl('battle_trance', 'Battle Trance')), false, 'транс');
  assert.equal(L.fastHit(sl('power_smash', 'Power Smash')), false, 'именованный actionId');
  // 1.5: выстрелы лучника приходят именем игры — тоже известный удар (тред «Изучение лука» 21.10)
  assert.equal(L.fastHit(sl('power_shot', 'Power Shot')), true);
  assert.equal(L.fastHit(sl('double_shot', 'Double Shot')), true);
  assert.equal(L.fastHit(sl('stun_shot', 'Stun Shot')), true);
  assert.equal(L.fastHit(sl('soul_of_sagittarius', 'Soul of Sagittarius')), false, 'бафф лучника');
  assert.equal(L.fastHit(sl('rapid_shot', 'Rapid Shot')), false, 'Rapid Shot — бафф, хоть и «_shot»');
  assert.equal(L.fastHit(sl('l2_9999', 'Новый удар — урон')), false, 'незнакомый скилл');
  assert.equal(L.fastHit(sl('l2_94', 'Rage', { on: true, type: 'attack' })), false, 'игрок сменил тип баффа на удар');
  assert.equal(L.fastHit({ type: 'item', pot: 'hp', action: '' }), false, 'банка');
});

test('HP/MP: ответ на ход свежее панели — берём его; панель сменилась позже — панель', () => {
  const hud = { hp: 1000, maxHp: 1000, mp: 400, maxMp: 400 };
  assert.deepEqual(L.meMerge(hud, { hp: 250, maxHp: 1000, mp: 100, t: 5000 }, 4000, 6000), { hp: 250, maxHp: 1000, mp: 100, maxMp: 400 });
  assert.deepEqual(L.meMerge(hud, { hp: 250, t: 5000 }, 5500, 6000), hud, 'панель обновилась после ответа');
  assert.deepEqual(L.meMerge(hud, { hp: 250, t: 1000 }, 0, 6000), hud, 'ответ старше 4 с');
  assert.deepEqual(L.meMerge(hud, null, 0, 6000), hud);
  assert.deepEqual(L.meMerge(hud, { mp: 5, t: 5000 }, 0, 6000), hud, 'без HP ответ не используем');
});

test('бот: метка только перед кликом обычного удара, не в TvT, по выключателю; снимается при неудаче', () => {
  const bot = read('lite/bot.js');
  assert.match(bot, /fastMark\(!tvt && cfg\.fastTurn !== false && L\.fastHit\(s\) \? s\.action : ''\);\n\s+if \(!fire\(s\.b, g\)\) \{ fastMark\(''\); return false; \}/);
  assert.match(bot, /if \(!st\) \{[^\n]*\n\s+fastMark\(''\);/);
  assert.match(bot, /ds\.l2liteFast = a \+ '\|' \+ Date\.now\(\)/);
  assert.equal(L.DEF_PROF.fastTurn, true, 'по умолчанию ВКЛ (1.5: умолчания профиля — в logic.js)');
  assert.equal(L.profCfg({}, 'archer').fastTurn, true); assert.equal(L.profCfg({ fastTurn: false }, 'destr').fastTurn, false);
  assert.match(bot, /if \(d\.me && ok && !d\.err\) \{ hudMark\(\); BME = \{ \.\.\.d\.me, t \}; \}/);
  assert.match(bot, /return L\.meMerge\(/);
  assert.match(read('lite/popup.js'), /\$\('fastTurn'\)\.checked = cfg\.fastTurn !== false;/);
  assert.match(read('lite/popup.js'), /\$\('fastTurn'\)\.onchange = e => save\(\{ fastTurn: e\.target\.checked \}\);/);
  assert.match(read('lite/popup.html'), /<input id="fastTurn" type="checkbox">/);
});
