'use strict';
// Lite 1.5.1 (21.10, тред «Упрошенка под Дестра»): правки по журналам John 19:55–20:05.
// 1) «Vicious Stance то включает то выключает туда сюда»: 1.5 считал стойку выключенной, если её нет в character.toggleStances,
//    и жал снова — второе нажатие её снимало. Теперь L.toggleDecide: включена — по подсветке слота, баффам героя или списку игры;
//    выключена — только когда игра так показала после нашего нажатия; иначе — память о принятом нажатии; два нажатия подряд
//    и снова «выкл» — пауза 30 мин.
// 2) «привел куда надо мне, не бьет мобов»: L.noMobWhy — почему на карте нет цели, одной строкой для журнала.
const test = require('node:test'), assert = require('node:assert/strict');
const L = require('../lite/logic.js');
const NOW = 1e9;

test('стойку, которой игра нигде не показывает, жмём один раз — дальше верим своему нажатию', () => {
  const snap = { fresh: true, entry: null, buffs: true };
  assert.equal(L.toggleOn({ snap, now: NOW }), false, 'не нажимали и игра молчит — включить');
  const mem = { on: true, t: NOW - 5000 };
  assert.equal(L.toggleOn({ snap, mem, now: NOW }), true, 'нажали — включена, второй раз не жмём (1.5 жал и снимал)');
  assert.deepEqual(L.toggleDecide({ snap, mem, now: NOW }), { st: true, hold: false });
});

test('включена — по подсветке слота, по баффам героя или по списку игры', () => {
  assert.equal(L.toggleOn({ dom: true, now: NOW }), true);
  assert.equal(L.toggleOn({ buff: true, snap: { fresh: true, entry: { on: false }, buffs: true }, now: NOW }), true, 'бафф важнее списка');
  assert.equal(L.toggleOn({ snap: { fresh: true, entry: { on: true }, buffs: true }, now: NOW }), true);
  for (const cls of ['l2-battle-hotbar-slot l2-battle-hotbar-slot--toggle-on', 'x--active', 'x--on']) assert.ok(L.TGL_DOM_ON.test(cls), cls);
  for (const cls of ['l2-battle-hotbar-slot', 'l2-battle-hotbar-slot--soulshot-on', 'l2-battle-hotbar-slot--cooldown', 'x--online', 'x--on-cooldown', 'x--active-cd']) assert.ok(!L.TGL_DOM_ON.test(cls), cls);
});

test('выключена — только по свежему ответу игры после нажатия или если раньше висела в баффах', () => {
  const mem = { on: true, t: NOW - 600000 };
  assert.equal(L.toggleOn({ snap: { fresh: true, entry: { on: false }, buffs: true }, mem, now: NOW }), false, 'список игры: active:false');
  assert.equal(L.toggleOn({ snap: { fresh: false, entry: { on: false }, buffs: true }, mem, now: NOW }), true, 'снимок старше нажатия — не верим');
  assert.equal(L.toggleOn({ seen: true, snap: { fresh: true, entry: null, buffs: true }, mem, now: NOW }), false, 'была в баффах, теперь нет');
  assert.equal(L.toggleOn({ seen: true, snap: { fresh: true, entry: null, buffs: false }, mem, now: NOW }), true, 'в ответе нет списка баффов — не знаем');
  assert.equal(L.toggleOn({ dom: false, mem, now: NOW }), false, 'aria-pressed=false');
});

test('«туда-сюда»: нажали дважды подряд, а игра снова показывает «выкл» — третий раз не жмём, пауза 30 мин', () => {
  const snap = { fresh: true, entry: { on: false }, buffs: true };
  // первое нажатие могло снять стойку, которую бот не видел (или игра сняла её сама) — одно «выкл» ещё не повод для паузы
  assert.deepEqual(L.toggleDecide({ snap, mem: { on: true, t: NOW - 3000, flap: 0 }, now: NOW }), { st: false, hold: false });
  assert.deepEqual(L.toggleDecide({ snap, mem: { on: true, t: NOW - 3000, flap: 1 }, now: NOW }), { st: null, hold: true });
  assert.deepEqual(L.toggleDecide({ snap, mem: { on: true, t: NOW - L.TGL_FLAP_MS - 1, flap: 3 }, now: NOW }), { st: false, hold: false }, 'давно нажимали — включаем');
  assert.equal(L.toggleOn({ dom: true, mem: { hold: NOW + 1000 }, now: NOW }), null, 'пауза — не трогаем');
  assert.equal(L.TGL_HOLD_MS, 30 * 60000);
  // номер нажатия подряд: прошлое < 2 мин назад — +1, иначе с нуля
  assert.equal(L.toggleFlap(null, NOW), 0);
  assert.equal(L.toggleFlap({ t: NOW - 5000 }, NOW), 1);
  assert.equal(L.toggleFlap({ t: NOW - 5000, flap: 1 }, NOW), 2);
  assert.equal(L.toggleFlap({ t: NOW - L.TGL_FLAP_MS - 1, flap: 4 }, NOW), 0);
});

test('planTurn жмёт стойку только при st === false', () => {
  const slot = st => ({ key: 'vicious_stance', type: 'toggle', on: true, ready: true, active: st, i: 1 });
  const atk = { key: 'attack', type: 'basic', on: true, ready: true, i: 0 };
  const me = { hp: 1000, maxHp: 1000, mp: 500, maxMp: 500 };
  assert.equal(L.planTurn([atk, slot(false)], me, { hp: 100, maxHp: 100 }).slot.key, 'vicious_stance');
  for (const st of [true, null]) assert.equal(L.planTurn([atk, slot(st)], me, { hp: 100, maxHp: 100 }).slot.key, 'attack', String(st));
});

test('почему на карте нет цели — одной строкой', () => {
  const rows = [L.mobRow('Ice Golem · ур. 68', 'a'), L.mobRow('Frost Lord · ур. 70', 'b'), L.mobRow('Yeti · ур. 64 · чемпион', 'champ_c'), L.mobRow('Bear · ур. 52', 'd')];
  assert.equal(L.pickMob(rows, { hero: 48, skip: new Set(['d']) }), null);
  assert.equal(L.noMobWhy(rows, { hero: 48, skip: new Set(['d']) }),
    'на карте 4: 2 выше героя +10 (герой 48 ур.: Ice Golem 68, Frost Lord 70); 1 — РБ, чемпионы или NPC; 1 — бой с ними не начался, пропуск 2 мин');
  assert.equal(L.noMobWhy([], { hero: 48 }), 'список мобов пуст');
});
