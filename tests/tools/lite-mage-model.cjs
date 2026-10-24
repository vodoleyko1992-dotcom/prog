#!/usr/bin/env node
'use strict';
// ===== Модель долгой охоты мага Lite в Ashen Bastion (1.8.1, тред «Добавить Arcane Power и банки MP магу») =====
// John 24.10: «Проведи моделирование и создай правки: Включение Arcane Power ботом, банки MP в долгой охоте».
// Ходы выбирает настоящая логика Lite (lite/logic.js: planTurn, mpRest) — модель подставляет ей панель, героя и бой, как их видит бот,
// а игру считает сама: урон, MP, банки, стойку Arcane Power, соседей массового удара, смерть. Старая логика — файл логики 1.7/1.8
// (node tests/tools/lite-mage-model.cjs --old <путь к logic.js>) и старые правила бота (без постановки банки и без отдыха по MP).
//
// Что измерено вживую (kb/lite-mage-study.md, Storm Screamer 78, 24.10): HP 23 605, MP 6 203; Blizzard 23 519 / крит 54 365 (20 критов из 32),
// Flame Strike крит 43 170, Hell 68 422; MP навыков — таблица L.SK; соседи в Ashen 267 416 и 266 329, лучший главный 268 546;
// бой 3,5–5,1 с из 8–9 массовых, переход к следующему бою 1,5–1,8 с; большая банка MP (#728) — 500 MP, малая (#726) — 200 MP
// Arcane Power: M.Atk ×1,3, MP ×1,1, «−50 HP/2 с», 36 MP. Большая банка MP (#728)
// (импульс 500 MP, цена 2 200), малая (#726) — 200 MP за 90, банка HP «Зілля зцілення» (#1061) — 600 HP за 85 (kb/data/items.json,
// kb/data/game-shop-drops.json). Смерть в Lite: город → баффер (восстановление) → телепорт на место ≈60 с; 3 смерти за 30 мин — Lite
// останавливается (bot.js deathStep, cfg.maxDeaths). Отдых HP < 30 % перед боем — до 90 с подряд (bot.js ashenStep).
// Что НЕ измерено и задаётся параметром: реген MP/HP (по умолчанию 3 MP/с и 8 HP/с — порядок Interlude у мага 78; основной бот берёт
// 2,5 MP/с), урон мобов Ashen по магу, как урон растёт от M.Atk (L2: ∝ √M.Atk — ×1,14; линейно — ×1,3), идёт ли «−50 HP/2 с» и вне
// боя (модель — идёт всегда: худший случай), занимает ли глоток банки ход (модель — занимает).
const path = require('path');

const DEF = {
  T: 3600,                  // с охоты
  maxHp: 23605, maxMp: 6203,
  act: 0.45,                // с на принятое действие (ответ сервера + свободная игра): бой 3,5–5,1 с из 8–9 массовых
  trans: 1.7,               // победа → следующий бой (свой GET списка + загрузка страницы боя), живой прогон 1,5–1,8 с
  crit: 0.6, critMul: 2.31, // Blizzard 20 критов из 32, 54 365 / 23 519
  ap: true,                 // галка Arcane Power в меню
  apAtk: 1.3, dmgExp: 0.5,  // урон ∝ M.Atk^dmgExp: 0,5 — формула L2 (×1,14 от стойки), 1 — линейно (×1,3)
  apMp: 1.1, apDrain: 25, apCost: 36,
  mpRegen: 3, hpRegen: 8,   // в секунду, не измерены
  maxDeaths: 3, deathT: 60,
  mobDps: 0,                // урон мобов по магу в бою, HP/с, не измерен
  panelKind: 728, potPanel: 1e9, bagKind: 726, potBag: 0, hpPots: 0,
  main: 268546, ex: [267416, 266329],
  bot: 'new', seed: 7,
};
const GAIN = { 726: 200, 728: 500, 920045: 2500 }, PRICE = { 726: 90, 728: 2200, hp: 85 };
const EXP_KILL = 60000, ADENA_KILL = 47000;  // EXP 54–66 тыс. на моба, адена ≈1,70 млн за 36 убитых (24.10)

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function run(P0, L) {
  const P = { ...DEF, ...P0 }, rnd = rng(P.seed), neu = P.bot === 'new';
  const sk = id => ({ id, key: 'l2_' + id, action: 'l2_' + id, name: L.SK[id][0], type: L.SK[id][1], pow: L.SK[id][2], mp: L.SK[id][3], hp: 0, cd: L.SK[id][5], on: true, i: id });
  const bar = [{ key: 'attack', action: 'attack', name: 'Атака', type: 'basic', on: true, i: 0 }, sk(1176), sk(1181), sk(1289), sk(1292), { ...sk(337), on: P.ap }];
  const S = { t: 0, hp: P.maxHp, mp: P.maxMp, ap: false, panel: { kind: P.panelKind, qty: P.potPanel }, bag: { kind: P.bagKind, qty: P.potBag }, hpq: P.hpPots,
    kills: 0, battles: 0, casts: 0, basic: 0, mpPots: 0, potAd: 0, hpUsed: 0, deaths: 0, dT: [], stopT: 0, apOnT: 0, apOn: 0, apOff: 0, restT: 0, waitT: 0,
    stuck: 0, leaves: 0, fixes: 0, stalls: 0, battleT: 0, mpOutT: 0, maxBattle: 0, ecoCasts: 0 };
  const cdUntil = {};
  let lastPot = { hp: -1e12, mp: -1e12 }, restSt = null, fixT = -1e9;
  const tick = dt => {
    S.t += dt;
    if (S.ap) { S.apOnT += dt; S.hp -= P.apDrain * dt; }
    S.hp = Math.min(P.maxHp, S.hp + P.hpRegen * dt);
    S.mp = Math.min(P.maxMp, S.mp + P.mpRegen * dt);
  };
  const fightTick = dt => { tick(dt); S.hp -= P.mobDps * dt; };
  const die = () => {
    S.deaths++; S.ap = false; S.dT = [...S.dT.filter(t => S.t - t < 1800), S.t];
    if (S.dT.length >= P.maxDeaths) { S.stopT = S.t; return; }   // Lite останавливается: «3 смерти за 30 мин»
    S.t += P.deathT; S.hp = P.maxHp; S.mp = P.maxMp;
  };
  const potsAll = () => Math.max(0, S.panel.qty) + S.bag.qty;
  const me = () => ({ hp: Math.max(0, S.hp), maxHp: P.maxHp, mp: Math.max(0, S.mp), maxMp: P.maxMp });
  const mult = () => (S.ap ? Math.pow(P.apAtk, P.dmgExp) : 1);

  function battle() {
    S.battles++;
    const t0 = S.t, mob = { hp: P.main, maxHp: P.main }, ex = P.ex.map(m => ({ name: 'сосед', hp: m, maxHp: m }));
    let aoeN = 0, lastOk = S.t, first = true;
    while (mob.hp > 0 && S.t < P.T) {
      if (S.hp <= 0) { die(); return; }
      if (S.t - lastOk > 45) { S.leaves++; return; }              // bot.js: 45 с ни одного принятого хода — выход из боя
      // 1.8.1: банки MP на панели нет, а в сумке есть — бот ставит её на пустой слот (≈2,5 с, не чаще раза в 2 мин)
      if (neu && !(S.panel.qty > 0) && S.bag.qty > 0 && S.t - fixT > 120 && (first || S.mp * 100 / P.maxMp <= 25)) {
        fixT = S.t; fightTick(2.5); S.panel = { ...S.bag }; S.bag = { kind: S.bag.kind, qty: 0 }; S.fixes++; continue;
      }
      first = false;
      const now = Math.round(S.t * 1000), mpMul = S.ap ? P.apMp : 1;
      const slots = bar.map(s => ({ ...s, ready: (cdUntil[s.key] || 0) <= now, left: Math.max(0, (cdUntil[s.key] || 0) - now),
        mp: s.type === 'toggle' ? P.apCost : Math.round((s.mp || 0) * mpMul) }));
      slots.find(s => s.id === 337).active = S.ap;                 // игра показывает стойку верно (снимок героя / подсветка слота)
      if (S.panel.qty > 0) slots.push({ key: 'item:mp', action: '', name: 'Зілля мани', type: 'item', pot: 'mp', qty: S.panel.qty, on: true, ready: true, i: 50 });
      if (S.hpq > 0) slots.push({ key: 'item:hp', action: '', name: 'Зілля зцілення', type: 'item', pot: 'hp', qty: S.hpq, on: true, ready: true, i: 51 });
      const p = L.planTurn(slots, me(), { ...mob }, { now, hpPot: 50, mpPot: 25, lastPot, mage: true,
        extras: aoeN ? ex.map(x => ({ ...x })) : null, aoeTry: !aoeN, mpPots: potsAll() });
      if (!p) { fightTick(0.1); S.waitT += 0.1; if (L.mpShort && L.mpShort(slots, me())) S.mpOutT += 0.1; continue; }
      const s = p.slot;
      if (s.pot === 'mp') { S.mp = Math.min(P.maxMp, S.mp + (GAIN[S.panel.kind] || 300)); S.panel.qty--; S.mpPots++; S.potAd += PRICE[S.panel.kind] || 0; lastPot = { ...lastPot, mp: now }; }
      else if (s.pot === 'hp') { S.hp = Math.min(P.maxHp, S.hp + 600); S.hpq--; S.hpUsed++; S.potAd += PRICE.hp; lastPot = { ...lastPot, hp: now }; }
      else if (s.type === 'toggle') { if (!S.ap) S.mp -= P.apCost; S.ap = !S.ap; if (p.off) S.apOff++; else S.apOn++; }
      else if (s.type === 'basic') { mob.hp -= 1; S.basic++; }
      else {
        if (S.mp < s.mp) { fightTick(P.act); continue; }            // сервер откажет (не должно случаться: planTurn проверяет MP)
        S.mp -= s.mp; S.casts++; if (/экономлю/.test(p.why)) S.ecoCasts++;
        cdUntil[s.key] = now + Math.round(s.cd * 1000);
        const dmg = Math.round(s.pow * 1000 * (rnd() < P.crit ? P.critMul : 1) * mult());
        if (s.type === 'aoe') { aoeN++; for (const x of ex) { x.hp -= dmg; if (x.hp <= 0) { S.kills++; x.hp = x.maxHp; } } }
        mob.hp -= dmg;
      }
      lastOk = S.t;
      fightTick(P.act);
      if (S.t - t0 > 120 && !S._stuckB) { S._stuckB = S.battles; S.stuck++; }
    }
    if (mob.hp <= 0) { S.kills++; S.battleT += S.t - t0; S.maxBattle = Math.max(S.maxBattle, S.t - t0); }
  }

  let restT0 = 0;
  while (S.t < P.T && !S.stopT) {
    S._stuckB = 0;
    // перед боем: HP < 30 % — отдых до 90 с подряд (bot.js ashenStep, оба бота)
    const hpP = S.hp * 100 / P.maxHp;
    if (hpP < 30 && (!restT0 || S.t - restT0 < 90)) { restT0 = restT0 || S.t; tick(1.5); S.restT += 1.5; if (S.hp <= 0) die(); continue; }
    if (hpP >= 30) restT0 = 0;
    // 1.8.1: отдых по MP, когда банок MP нет совсем (L.mpRest)
    if (neu && L.mpRest) for (;;) {
      const R = L.mpRest(restSt, me(), { mage: true, pots: potsAll(), now: Math.round(S.t * 1000) });
      restSt = R.st; if (R.stall) S.stalls++;
      if (!R.rest || S.t >= P.T) break;
      tick(2); S.restT += 2;
      if (S.hp <= 0) break;
    }
    if (S.hp <= 0) { die(); continue; }
    if (S.t >= P.T) break;
    battle();
    if (S.stopT) break;
    tick(P.trans);
  }
  const h = P.T / 3600;
  return { kills: S.kills, killsH: Math.round(S.kills / h), stopMin: S.stopT ? Math.round(S.stopT / 60) : '-', battles: S.battles, battleS: S.battles ? +(S.battleT / Math.max(1, S.battles - S.stuck - S.leaves)).toFixed(1) : 0,
    castsPerBattle: S.battles ? +(S.casts / S.battles).toFixed(1) : 0, mpPots: S.mpPots, hpPots: S.hpUsed, basic: S.basic, deaths: S.deaths,
    apUp: Math.round(S.apOnT * 100 / P.T), apOn: S.apOn, apOff: S.apOff, restMin: +(S.restT / 60).toFixed(1), waitMin: +(S.waitT / 60).toFixed(1),
    mpOutMin: +(S.mpOutT / 60).toFixed(1), stuck: S.stuck, leaves: S.leaves, fixes: S.fixes, stalls: S.stalls, ecoCasts: S.ecoCasts,
    expM: +(S.kills * EXP_KILL / 1e6).toFixed(1), adenaM: +(S.kills * ADENA_KILL / 1e6).toFixed(1), potAdenaM: +(S.potAd / 1e6).toFixed(2),
    hpEnd: Math.round(Math.max(0, S.hp)), mpEnd: Math.round(Math.max(0, S.mp)) };
}

// Сценарии отчёта (kb/lite-mage-study.md §7). По умолчанию: большие банки MP на панели без счёта, банок HP нет, реген 3 MP/с и 8 HP/с.
const SCEN = [
  ['A1 банки MP есть, Arcane Power выкл.', { ap: false }],
  ['A2 банки MP и HP есть, Arcane Power вкл., урон ×1,14 (√M.Atk)', { hpPots: 1e9 }],
  ['A3 банки MP и HP есть, Arcane Power вкл., урон ×1,3 (линейно)', { hpPots: 1e9, dmgExp: 1 }],
  ['A4 банки MP есть, банок HP нет, Arcane Power вкл.', {}],
  ['A5 то же, но реген HP 0', { hpRegen: 0 }],
  ['B1 на панели 150 больших банок MP, больше нет', { potPanel: 150 }],
  ['B2 на панели 100 больших, в сумке 500 малых другой стопкой', { potPanel: 100, potBag: 500 }],
  ['B3 только малые банки MP (200 MP за 90 адены)', { panelKind: 726 }],
  ['C1 банок MP нет', { potPanel: 0 }],
  ['C2 банок MP нет, Arcane Power выкл.', { potPanel: 0, ap: false }],
  ['C3 банок MP нет, реген MP 10/с', { potPanel: 0, mpRegen: 10 }],
  ['D1 моб бьёт 30 HP/с, банок HP нет', { mobDps: 30 }],
  ['D2 моб бьёт 30 HP/с, банки HP есть', { mobDps: 30, hpPots: 1e9 }],
];

function report(Lnew, Lold) {
  const cols = ['killsH', 'battleS', 'castsPerBattle', 'mpPots', 'hpPots', 'potAdenaM', 'adenaM', 'basic', 'apUp', 'apOff', 'deaths', 'stopMin', 'restMin', 'stuck', 'fixes'];
  const rows = [];
  for (const [name, p] of SCEN) {
    const n = run({ ...p, bot: 'new' }, Lnew), o = Lold ? run({ ...p, bot: 'old' }, Lold) : null;
    rows.push({ name, n, o });
  }
  const line = r => cols.map(c => String(r[c]).padStart(c.length)).join(' ');
  const out = [`колонки: ${cols.join(' ')}`];
  for (const r of rows) {
    out.push(r.name);
    if (r.o) out.push('  было  ' + line(r.o));
    out.push('  стало ' + line(r.n));
  }
  return { rows, text: out.join('\n') };
}

if (require.main === module) {
  const a = process.argv.slice(2), oi = a.indexOf('--old');
  const Lnew = require(path.join(__dirname, '..', '..', 'lite', 'logic.js'));
  const Lold = oi >= 0 ? require(path.resolve(a[oi + 1])) : null;
  console.log(report(Lnew, Lold).text);
}
module.exports = { DEF, SCEN, run, report };
