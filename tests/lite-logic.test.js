'use strict';
// Lite 1.0 (20.10, тред «Упрошенка под Дестра»): чистая логика облегчённого бота lite/logic.js —
// ход в бою (лимиты Дестра/Титана после Battle Trance, банки, стойки), TvT, счётчик мобов, выбор моба, цена телепорта.
const assert = require('node:assert/strict');
const L = require('../lite/logic.js');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };

// ---------- скиллы ----------
t('известные скиллы Дестра/Титана по l2_<id> и по именованному actionId', () => {
  const fr = L.skillInfo('l2_176', 'Frenzy — P.Atk при HP ≤ 30 %');
  assert.equal(fr.type, 'lowhp'); assert.equal(fr.name, 'Frenzy'); assert.equal(fr.known, true);
  assert.equal(L.skillInfo('l2_420', 'Zealot').hp, 204);
  assert.equal(L.skillInfo('battle_trance', 'Battle Trance').type, 'trance');
  assert.equal(L.skillInfo('attack', 'Атака').type, 'basic');
  assert.equal(L.skillInfo('war_cry', 'War Cry').id, 78);
  assert.equal(L.skillInfo('L2_315', 'Crush of Doom').type, 'attack');          // регистр actionId не важен
  assert.equal(L.skillInfo('l2_315', 'Crush of Doom').key, 'l2_315');
});
t('незнакомый скилл: тип по описанию, по умолчанию не жмётся', () => {
  const x = L.skillInfo('l2_9999', 'Новый удар — урон 500');
  assert.equal(x.known, false); assert.equal(x.type, 'attack');
  assert.equal(L.skillUse(x).on, false);
  assert.equal(L.skillUse(x, { on: true }).on, true);
  assert.equal(L.skillInfo('l2_9998', 'Щось — якщо HP менше 30%').type, 'lowhp');
});
t('выбор игрока: тип и галка; «Не жать» всегда выключает; атака всегда включена', () => {
  const info = L.skillInfo('l2_190', 'Fatal Strike');
  assert.equal(L.skillUse(info).on, true);
  assert.equal(L.skillUse(info, { on: false }).on, false);
  assert.equal(L.skillUse(info, { on: true, type: 'other' }).on, false);
  assert.equal(L.skillUse(info, { type: 'buff' }).type, 'buff');
  assert.equal(L.skillUse(L.skillInfo('attack', ''), { on: false }).on, true);
  assert.equal(L.skillUse(L.skillInfo('l2_312', 'Vicious Stance')).on, false);        // стойка — только по выбору игрока
  assert.equal(L.skillUse(L.skillInfo('l2_286', 'Provoke')).on, false);              // агро — по умолчанию нет
});
t('банки HP/MP: по номеру TvT-арены и по названию', () => {
  assert.equal(L.potKind('#728 — зілля мани'), 'mp');
  assert.equal(L.potKind('#1539 — зілля'), 'hp');
  assert.equal(L.potKind('Зілля мани (велика банка) ×150'), 'mp');
  assert.equal(L.potKind('Зілля зцілення ×290'), 'hp');
  assert.equal(L.potKind('Заряд душі воїна (C)'), null);
  assert.equal(L.potKind('Свиток телепорта'), null);
});

// ---------- ход ----------
const sk = (action, extra = {}) => { const i = L.skillUse(L.skillInfo(action, extra.title || '')); return { ...i, ready: true, i: extra.i || 0, ...extra }; };
const pot = (kind, extra = {}) => ({ key: 'item:' + kind, name: kind, type: 'item', pot: kind, qty: 10, on: true, ready: true, i: 20, ...extra });
const ME = (hp, mp = 1000) => ({ hp, maxHp: 10000, mp, maxMp: 2000 });
const MOB = { hp: 5000, maxHp: 5000 };
t('обычный ход: сильнейший готовый удар, потом обычная атака', () => {
  const slots = [sk('attack'), sk('l2_3', { i: 1 }), sk('l2_190', { i: 2 }), sk('l2_315', { i: 3, ready: false })];
  assert.equal(L.planTurn(slots, ME(9000), MOB).slot.key, 'l2_190');
  slots[2].ready = false; slots[1].ready = false;
  assert.equal(L.planTurn(slots, ME(9000), MOB).slot.key, 'attack');
});
t('выключенный игроком скилл не жмётся; MP не хватает — не жмётся', () => {
  const fs = sk('l2_190', { i: 2, on: false });
  assert.equal(L.planTurn([sk('attack'), fs], ME(9000), MOB).slot.key, 'attack');
  const fs2 = sk('l2_190', { i: 2 });
  assert.equal(L.planTurn([sk('attack'), fs2], ME(9000, 50), MOB).slot.key, 'attack');
});
t('моб почти мёртв — добиваем обычной атакой, скилл бережём', () => {
  assert.equal(L.planTurn([sk('attack'), sk('l2_190')], ME(9000), { hp: 300, maxHp: 5000 }).slot.key, 'attack');
});
t('Battle Trance → Frenzy/Zealot: транс только при готовых лимитах и HP ≥ 50 %', () => {
  const slots = () => [sk('attack'), sk('l2_190'), sk('battle_trance', { i: 5 }), sk('l2_176', { i: 6 }), sk('l2_420', { i: 7 }), sk('l2_139', { i: 8 })];
  let p = L.planTurn(slots(), ME(9000), MOB);
  assert.equal(p.slot.type, 'trance'); assert.match(p.why, /Frenzy, Zealot, Guts/);
  // лимиты не готовы — транс не жмём
  const s2 = slots(); s2[3].ready = s2[4].ready = s2[5].ready = false;
  assert.equal(L.planTurn(s2, ME(9000), MOB).slot.key, 'l2_190');
  // после транса HP 25 % — Frenzy первым, потом Zealot, потом Guts
  p = L.planTurn(slots(), ME(2500), MOB); assert.equal(p.slot.key, 'l2_176');
  const s3 = slots(); s3[3].active = true;
  assert.equal(L.planTurn(s3, ME(2500), MOB).slot.key, 'l2_420');
  // MP не хватает на Zealot (136) — транс не жмём вслепую
  const s4 = slots(); s4[3].ready = false; s4[5].ready = false;
  assert.notEqual(L.planTurn(s4, ME(9000, 100), MOB).slot.type, 'trance');
});
t('HP < 15 % — сначала банка, даже при готовых лимитах; 15–30 % — лимит раньше банки', () => {
  const slots = [sk('attack'), sk('l2_176'), pot('hp')];
  assert.equal(L.planTurn(slots, ME(1200), MOB).slot.pot, 'hp');
  assert.equal(L.planTurn(slots, ME(2500), MOB).slot.key, 'l2_176');
  slots[1].active = true;
  assert.equal(L.planTurn(slots, ME(2500), MOB).slot.pot, 'hp');
});
t('банки: HP по порогу и не чаще раза в 1,1 с; MP по порогу; пустая банка не жмётся', () => {
  const now = 100000, slots = [sk('attack'), pot('hp'), pot('mp')];
  assert.equal(L.planTurn(slots, ME(4900), MOB, { now, hpPot: 50 }).slot.pot, 'hp');
  assert.equal(L.planTurn(slots, ME(4900), MOB, { now, hpPot: 50, lastPot: { hp: now - 500 } }).slot.key, 'attack');
  assert.equal(L.planTurn(slots, ME(9000, 300), MOB, { now, mpPot: 25 }).slot.pot, 'mp');
  slots[1].qty = 0;
  assert.equal(L.planTurn(slots, ME(4900), MOB, { now, hpPot: 50 }).slot.key, 'attack');
});
t('баффы жмутся, пока не висят; стойка — только подтверждённо выключенная', () => {
  const wc = sk('l2_78'), vs = sk('l2_312', { on: true, active: null });
  assert.equal(L.planTurn([sk('attack'), wc], ME(9000), MOB).slot.key, 'l2_78');
  wc.active = true;
  assert.equal(L.planTurn([sk('attack'), wc, vs], ME(9000), MOB).slot.key, 'attack');
  vs.active = false;
  assert.equal(L.planTurn([sk('attack'), wc, vs], ME(9000), MOB).slot.key, 'l2_312');
  vs.active = true;
  assert.equal(L.planTurn([sk('attack'), wc, vs], ME(9000), MOB).slot.key, 'attack');
});
t('TvT: без баффов/транса/лечения, только разрешённые по врагу скиллы', () => {
  const slots = [sk('attack'), sk('l2_190', { tvtOk: false }), sk('l2_3', { i: 1 }), sk('l2_78'), sk('battle_trance'), sk('l2_176')];
  assert.equal(L.planTurn(slots, ME(9000), { hp: 4000, maxHp: 5000 }, { tvt: true }).slot.key, 'l2_3');
  assert.equal(L.planTurn(slots, ME(2500), { hp: 4000, maxHp: 5000 }, { tvt: true }).slot.key, 'l2_3');
});
t('нечего жать — null', () => {
  assert.equal(L.planTurn([sk('attack', { ready: false })], ME(9000), MOB), null);
});

// ---------- TvT ----------
const NOW = Date.parse('2026-10-20T08:00:00Z');
const T = o => ({ t: NOW, off: 0, schedule: { enabled: true, next: {} }, ...o });
t('TvT: запись открыта → записаться; мест нет / пропуск / закончилась — нет', () => {
  const V = L.tvtView(T({ phase: 'REGISTRATION', eventId: 'e1', registrationEndsAt: NOW + 300000, registeredCount: 3, maxPlayers: 20 }));
  assert.equal(V.start, NOW + 330000);
  assert.equal(L.tvtDecide(V, NOW), 'register');
  assert.equal(L.tvtDecide({ ...V, count: 20 }, NOW), null);
  assert.equal(L.tvtDecide(V, NOW, { skip: { id: 'e1', until: NOW + 1000 } }), null);
  assert.equal(L.tvtDecide(V, NOW + 400000), null);
});
t('TvT: записан → hold за 3 мин, fight за 90 с и во время боя, leave после итога', () => {
  const V = L.tvtView(T({ phase: 'REGISTRATION', eventId: 'e1', isRegistered: true, registrationEndsAt: NOW + 120000 }));
  assert.equal(L.tvtDecide(V, NOW - 60000), null);           // до старта 3,5 мин — охотимся
  assert.equal(L.tvtDecide(V, NOW), 'hold');                  // 2,5 мин
  assert.equal(L.tvtDecide(V, NOW + 70000), 'fight');         // 80 с
  const A = L.tvtView(T({ phase: 'ACTIVE', eventId: 'e1', isRegistered: true, startsAt: NOW, endsAt: NOW + 600000, selfCombat: { alive: true } }));
  assert.equal(L.tvtDecide(A, NOW + 5000), 'fight');
  assert.equal(L.tvtDecide(A, NOW + 5000, { done: 'e1' }), null);
  const E = L.tvtView(T({ phase: 'ACTIVE', eventId: 'e1', isRegistered: true, startsAt: NOW, selfCombat: { alive: false } }));
  assert.equal(E.eliminated, true);
  assert.equal(L.tvtDecide(E, NOW + 5000, { inTvt: 'e1' }), 'leave');
  assert.equal(L.tvtDecide(E, NOW + 5000), null);
  const F = L.tvtView(T({ phase: 'RESULT', eventId: 'e1', isRegistered: true }));
  assert.equal(L.tvtDecide(F, NOW, { inTvt: 'e1' }), 'leave');
  assert.equal(L.tvtDecide(L.tvtView(T({ phase: 'ACTIVE', eventId: 'e1', isRegistered: true, schedule: { enabled: false } })), NOW), null);
});
t('TvT: «бой идёт» не вечно — после конца события не тянет на арену', () => {
  const A = L.tvtView(T({ phase: 'ACTIVE', eventId: 'e1', isRegistered: true, startsAt: NOW, endsAt: NOW + 600000 }));
  assert.equal(L.tvtDecide(A, NOW + 600000 + 400000), null);
});
t('TvT: опрос — часто в окнах, редко вне их, с отступом при ошибках', () => {
  assert.equal(L.tvtPollGap(null, NOW, 0), 5000);
  assert.equal(L.tvtPollGap(null, NOW, 7), 300000);
  assert.equal(L.tvtPollGap(L.tvtView(T({ phase: 'REGISTRATION' })), NOW), 5000);
  const idle = L.tvtView(T({ phase: 'IDLE', schedule: { enabled: true, next: { registrationOpensAt: NOW + 3600000 } } }));
  assert.equal(L.tvtPollGap(idle, NOW), 300000);
  assert.equal(L.tvtPollGap(idle, NOW + 3600000 - 60000), 3000);
});

// ---------- счётчик мобов ----------
t('счётчик: прирост mobsKilled только при включённом боте и у того же героя', () => {
  let st = { kills: 0 }, r;
  r = L.killStep(st, { name: 'Dstr', k: 100, rev: 1 }, true); assert.equal(r.why, 'base'); st = r.st;
  r = L.killStep(st, { name: 'Dstr', k: 103, rev: 2 }, true); assert.equal(r.add, 3); st = r.st;           // AoE: три сразу
  r = L.killStep(st, { name: 'Dstr', k: 102, rev: 1 }, true); assert.equal(r.why, 'old'); assert.equal(r.st.kills, 3);
  r = L.killStep(st, { name: 'Dstr', k: 110, rev: 3 }, false); assert.equal(r.add, 0); st = r.st;          // выключен — не считаем
  r = L.killStep(st, { name: 'Dstr', k: 111, rev: 4 }, true); assert.equal(r.add, 1); st = r.st;
  r = L.killStep(st, { name: 'Dstr', k: 300, rev: 5 }, true); assert.equal(r.why, 'jump'); st = r.st;      // играл без бота
  r = L.killStep(st, { name: 'Alt', k: 5, rev: 9 }, true); assert.equal(r.why, 'base'); assert.equal(r.st.kills, 4);
  assert.equal(L.limitDone(4, 4), true); assert.equal(L.limitDone(3, 4), false); assert.equal(L.limitDone(99, 0), false);
});

// ---------- карта ----------
t('карта: РБ, охрана эпика, чемпион и NPC не цели; «Boss» в имени — обычный моб', () => {
  const rows = [
    L.mobRow('Ancient Drake · ур. 60 · рейд-босс', 'l2dop_rb_1'),
    L.mobRow('Guard · ур. 70', 'l2dop_eg_1'),
    L.mobRow('Yeti · ур. 61', 's2', 'l2-map-mob-link--champion'),
    L.mobRow('Yeti · ур. 61', 's3', '', 'champion'),
    L.mobRow('Gatekeeper · ур. 1', 's4', 'l2-map-mob-link--npc'),
    L.mobRow('Hatar Ratman Boss · ур. 48', 's5'),
    L.mobRow('★ Grave Robber · ур. 62', 's6'),
  ];
  assert.equal(rows[5].boss, false); assert.equal(rows[5].lvl, 48); assert.equal(rows[6].name, 'Grave Robber');
  assert.equal(L.pickMob(rows, { hero: 60 }).id, 's5');
  assert.equal(L.pickMob(rows, { hero: 60, skip: new Set(['s5']) }).id, 's6');
  assert.equal(L.pickMob(rows, { hero: 30, skip: new Set(['s5']) }), null);                 // +10 и выше — не берём
});

// ---------- телепорт ----------
t('телепорт: адена — да, Coin of Luck и непрочитанная цена — нет', () => {
  assert.deepEqual(L.teleportCost('Гавань 2 500', '2 500', 'аден'), { price: 2500, why: '' });
  assert.match(L.teleportCost('x', '5', 'Coin of Luck').why, /Coin of Luck/);
  assert.match(L.teleportCost('x', null, 'аден').why, /цена/);
  assert.match(L.teleportCost('x', '100', '').why, /валюта/);
  assert.equal(L.teleportCost('Бесплатно', null, '').why, '');
});

console.log(`lite-logic: ${n} PASS`);
