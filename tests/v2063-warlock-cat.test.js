'use strict';
// 20.63 (лог John 25.10 15:16–16:16, Warlock Arcana Lord 78 + Feline King, Ashen Bastion):
//  · руда Spirit Ore кончилась — 981 отказ 400 battle_no_spirit_ore на Warrior/Final Servitor в начале каждого боя, закупка ждала час;
//  · перепризыв при 25 % заменял живого кота на нового без баффов (два подряд за 4 с), Servitor Heal +1200 HP за ход;
//  · кот бьёт по своему таймеру ≈2,5 с — petExpect 0, и дебафф считал весь урон заклинаниями: Curse Chaos первым ходом в 40 % боёв.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const combatSrc = read('modules/combat.js');
const {flowFixture} = require('./warlock-combat-fixture.cjs');

// ── 1. act(): отказ «Недостаточно Spirit Ore» → 'noore', слот держится до пополнения руды ──
const oreSrc = combatSrc.slice(combatSrc.indexOf('const ORE_IDS'), combatSrc.indexOf('const pressAt = new Map()'));
const actSource = combatSrc.slice(combatSrc.indexOf('  let lastHpPot = 0, lastMpPot = 0'), combatSrc.indexOf('  const t0 = Date.now();\n  let progSig'));
function actFixture(receipt) {
  let now = 1e6, rid = 10, bag = 0; const events = [], receipts = new Map(), pauses = [], logs = [], owner = 'hero', soon = [];
  const net = { start: 1, done: 1, doneT: now - 10000, startRid: 9, startOwner: owner, ok: true, action: 'l2_1346' };
  const at = (ms, fn) => events.push({ t: now + ms, fn });
  const advance = to => { events.sort((a, b) => a.t - b.t); while (events.length && events[0].t <= to) { const e = events.shift(); now = e.t; e.fn(); } now = to; };
  const wait = async (fn, ms) => { const end = now + ms; for (let i = 0; i < 1000; i++) { const v = fn(); if (v) return v; if (now >= end) return null; advance(Math.min(end, ...events.map(e => e.t))); } throw Error('spin'); };
  const env = { cfg: { nDrain: '' }, names: () => [], rt: { char: 'Hero', classCur: { prof: 'arcana_lord', slot: 0 } }, on: true, tabOwner: true, isBattle: () => true, canAct: () => true,
    evidenceOwner: () => owner, battleExitContext: () => owner, routeLocation: { href: '/battle.html?spawnId=one' }, invQty: id => id === 3031 ? bag : null,
    sleep: async ms => advance(now + ms), combatPulse: async ms => advance(Math.min(now + ms, ...events.map(e => e.t))), combatWait: wait, waitFor: wait, gameBusy: () => ({ busy: false, end: 0 }),
    combatCooldown: { globalWait: () => 0, skillWait: () => 0, skillKnown: () => false, recentlyGlobalRejected: () => false },
    slotAction: () => 'l2_1346', cdSpawn: () => 'one', battleSpawn: () => 'one', observeSlot: () => {}, actNet: () => net, actReceipt: id => receipts.get(id), skKey: () => 'warrior servitor',
    fire() { const id = ++rid; net.start++; net.startRid = id; net.startOwner = owner;
      at(60, () => { net.done++; net.doneT = now; net.ok = false; net.action = 'l2_1346'; receipts.set(id, { rid: id, t: now, owner, action: 'l2_1346', ok: false, blockedBy: '', ...receipt }); }); return true; },
    setStatus: () => {}, setRt: async () => {}, slotCd: () => ({}), meMp: () => ({ cur: 7000, max: 7108 }), meHp: () => ({ cur: 20536, max: 20536, pct: 100 }), petState: () => null, pause: async () => { pauses.push(now); advance(now + 300); },
    rnd: a => a, rec: (...a) => logs.push(a.join(' ')), TAG: 't', cleanTitle: s => s, memLeft: () => 0, FORCE_NEED: /не хвата\S* енерг/i, UNAVAIL: /недоступн/i, CD_RE: /перезаряд|cooldown/i };
  const box = { console: { info: () => {} }, Date: { now: () => now }, Math, Map, String, env, ctx: { pet: null, block: {} }, LOCK_A: [60, 500, 120], LOCK_B: [30, 200, 50], NOMP_MS: 1500,
    lostUntil: new Map(), mpUntil: new Map(), pressAt: new Map(), victory: () => false, defeat: () => false, affordable: () => true, healSlot: () => false,
    noticeText: () => '', uiReady: () => true, mobHp: () => ({ cur: 1000 }), rememberCd: async () => {}, slotsBy: () => [], drainBackoff: () => {}, rtSoon: p => soon.push(p) };
  vm.runInNewContext(oreSrc + actSource + '\nthis.act=act;this.oreBlocked=oreBlocked;this.oreKind=oreKind;', box);
  const slot = { title: 'Warrior Servitor', mp: 50 };
  return { act: () => box.act(slot, 'Бафф кота', true), blocked: () => box.oreBlocked(slot), oreKind: box.oreKind, env, pauses, logs, soon,
    later: ms => { now += ms; }, setBag: q => { bag = q; } };
}
const NO_ORE = { code: 'battle_skill_not_allowed', error: 'battle_no_spirit_ore', message: 'Недостаточно Spirit Ore.' };
test('15:16:32: «Недостаточно Spirit Ore» — сразу noore, без паузы реакции, rt.oreOut для закупки', async () => {
  const f = actFixture(NO_ORE);
  assert.equal(await f.act(), 'noore');
  assert.equal(f.pauses.length, 0);
  assert.ok(f.env.rt.oreOut?.spirit > 0); assert.ok(f.soon.some(p => p.oreOut?.spirit));
  assert.ok(f.logs.some(l => /недостаточно Spirit Ore/.test(l)));
});
test('слот с отказом «нет руды» держится, пока руда в сумке не прибавится, и не дольше 30 мин', async () => {
  const f = actFixture(NO_ORE);
  await f.act(); assert.equal(f.blocked(), true, 'следующий бой — не жмём');
  f.later(600000); assert.equal(f.blocked(), true, 'руды всё ещё 0');
  f.setBag(1000); assert.equal(f.blocked(), false, 'купили руду — снова жмём');
  const g = actFixture(NO_ORE); await g.act(); g.later(1800001); assert.equal(g.blocked(), false, 'через 30 мин — одна новая проба');
});
test('распознавание руды: код и текст сервера; прочие отказы — не руда', () => {
  const { oreKind } = actFixture(NO_ORE);
  assert.equal(oreKind(NO_ORE), 'spirit');
  assert.equal(oreKind({ code: 'battle_skill_not_allowed', message: 'Недостатньо Soul Ore.' }), 'soul');
  assert.equal(oreKind({ code: 'battle_skill_not_allowed', message: 'Цей скилл зараз недоступний для твого персонажа.' }), null);
  assert.equal(oreKind({ error: 'battle_none', reason: 'not_in_battle' }), null);
});

// ── 2. закупка: руда по сумке из сети, отказ сервера — купить даже при минимуме 0 ──
function shopFixture({ spirit = '0/1000', bag = 0, oreOut = 0 } = {}) {
  const box = { console, Date, URLSearchParams, location: { pathname: '/battle.html', search: '' }, document: { querySelectorAll: () => [] } };
  vm.runInNewContext(read('modules/economy.js'), box);
  const env = { on: true, rt: { char: 'Warlock', weaponsT: 1, weapons: [{ id: 1, g: 'S', weaponMode: 'magic', name: 'Клановий кастер', where: 'надето' }], oreOut: oreOut ? { spirit: oreOut } : undefined },
    cfg: { shopAuto: true, shopHp: '0/0', shopMp: '0/0', shopSpirit: spirit, shopSoul: '0/0', shopShots: '0/0' },
    BSPS_IDS: { NG: 3947, S: 3952 }, SHOT_IDS: { NG: 1835, S: 1467 }, pair: (x, d) => String(x || d).split('/').map(Number), heroLevel: () => 78, combatProfileKind: () => 'mage_summoner',
    classWeaponTypes: () => ({ types: [] }), slotsBy: () => [], shotSlot: () => null, qty: () => null, invQty: id => id === 3031 ? bag : null, $q: () => null, shown: () => false };
  return box.L2V7Factories.economy(env);
}
test('отказ «нет руды» свежее часа — Spirit Ore 0 сразу в закупку, даже при минимуме 0', () => {
  assert.match(shopFixture({ oreOut: Date.now() - 60000 }).shopNeedByPanel(), /Spirit Ore 0 < 1 \(сервер: недостаточно руды\)/);
  assert.equal(shopFixture({ oreOut: Date.now() - 60000, bag: 1000 }).shopNeedByPanel(), '', 'руда уже есть');
  assert.equal(shopFixture({ oreOut: Date.now() - 2 * 3600000 }).shopNeedByPanel(), '', 'старый отказ не держит');
  assert.equal(shopFixture().shopNeedByPanel(), '', 'минимум 0 и отказа не было — как раньше');
});
test('минимум руды из настройки проверяется по сумке, не только раз в час', () => {
  assert.match(shopFixture({ spirit: '10/1000', bag: 3 }).shopNeedByPanel(), /Spirit Ore 3 < 10/);
  assert.equal(shopFixture({ spirit: '10/1000', bag: 500 }).shopNeedByPanel(), '');
});

// ── 3. перепризыв и лечение кота по замерам ──
async function petChoice({ pct = 20, maxHp = 25370, summonHp = 10268, healGain = [1200, 1200, 1200], lastSummonAgo = 600000, noHeal = false } = {}) {
  const f = flowFixture('pet'), heal = { title: 'Servitor Heal', getAttribute: () => null };
  if (!noHeal) f.slots.push(heal);
  Object.assign(f.env.cfg, { nPetBuffs: 'Summon Feline Queen', petBuffAuto: false, petHealAt: 50, petResummonAt: 25, petResummon: true, petHealPrefer: 'heal' });
  Object.assign(f.env.rt, { petSummonHp: summonHp ? { kai_the_cat: summonHp } : undefined, petHealGain: healGain, petSummonOkT: Date.now() - lastSummonAgo });
  const origIl = f.env.ilOf, origAction = f.env.slotAction;
  f.env.ilOf = b => b === heal ? { target: 'PET', c: 'Лечение', mp: 75 } : origIl(b);
  f.env.slotAction = b => b === heal ? 'l2_1127' : origAction(b);
  const pet = { has: true, key: 'kai_the_cat', hp: Math.round(pct * maxHp / 100), maxHp };
  f.env.petState = () => ({ ...pet, t: Date.now() });
  f.env.slotCd = () => null;
  const chosen = []; f.env.fire = b => { chosen.push(b.title); f.env.on = false; return false; };
  try { await f.combat.battle(); } catch (e) { if (e.message !== 'bounded-loop') throw e; }
  return { pick: chosen[0], logs: f.logs };
}
test('16:12:03→07: второй перепризыв через 4 с после прошлого — нет, бьём', async () => {
  assert.equal((await petChoice({ pct: 10, lastSummonAgo: 4000 })).pick, 'Blaze');
});
test('перепризыв при 23 % от баффнутых 25 370 HP (новый кот 10 268) — не окупается, бьём', async () => {
  assert.equal((await petChoice({ pct: 23 })).pick, 'Blaze');
});
test('кот почти мёртв (8 %), новый даст +30 % — перепризыв', async () => {
  assert.equal((await petChoice({ pct: 8 })).pick, 'Summon Kai the Cat');
});
test('HP нового кота ещё не замерено — перепризыв как раньше', async () => {
  assert.equal((await petChoice({ pct: 20, summonHp: 0, noHeal: true })).pick, 'Summon Kai the Cat');
});
test('Servitor Heal +1200 за ход против нового кота 10 268 за 2 хода — вне РБ не лечим', async () => {
  const r = await petChoice({ pct: 40 });
  assert.equal(r.pick, 'Blaze'); assert.ok(r.logs.some(l => /вне РБ не лечу/.test(l)));
});
test('сильное лечение (+6000 за ход) — лечим, как раньше', async () => {
  assert.equal((await petChoice({ pct: 40, healGain: [6000, 6000, 6000] })).pick, 'Servitor Heal');
});

// ── 4. дебафф: доля урона кота — средний удар кота на ход хозяина, а не 0 ──
test('debuffPlan берёт средний урон кота на действие (кот бьёт по таймеру, не каждый ход)', () => {
  const i = combatSrc.indexOf('function petPerAct('), body = combatSrc.slice(i, combatSrc.indexOf('\n}\n', i) + 3);
  const box = { env: { petState: () => ({ key: 'feline_king' }), rt: { petStat: { feline_king: { dmg: 3000000, acts: 30 } } } }, petAlive: () => true };
  vm.runInNewContext(body + 'this.f=petPerAct;', box);
  assert.equal(box.f({ pet: { dmg: 0, acts: 0 } }), 100000);
  box.env.rt.petStat.feline_king.acts = 5; assert.equal(box.f({ pet: { dmg: 0, acts: 0 } }), 0, 'мало замеров — 0, как раньше');
  assert.match(combatSrc, /const pet = Math\.max\(petExpect\(ctx\), petPerAct\(ctx\)\)/);
});
