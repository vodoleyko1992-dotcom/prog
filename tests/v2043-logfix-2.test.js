'use strict';
// 20.43 (логи John 21.10 13:21/13:30, бот 20.42.2):
//  · 22:07:37 — второй отказ подряд 400 battle_skill_not_allowed «Цей скилл зараз недоступний…» (Wild Sweep после Whirlwind) не узнан:
//    тот же тост на экране, код не в списке — 3 с паузы вместо запрета, в следующем бою снова 400;
//  · 22:07–22:08 (Fortune Seeker с Elysian) и 23:15–23:20 (Warsmith с Yaksa Mace, тур РБ) — Whirlwind/Wild Sweep (только древковое)
//    жались с дубиной, ход терялся в каждом новом оружейном контексте;
//  · 22:40:30 — у Warsmith в таблице видов оружия не было древкового: надетая пика «в класс: нет»;
//  · 23:07:57 — щит (k 'W', вид «—») — weaponOf считал его оружием: скан сумки и повод «новое оружие в сумке».
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const combatSrc = read('modules/combat.js'), contentSrc = read('content.js');
const IL_DB = (() => { const sb = {}; vm.runInNewContext(read('skills-il.js') + ';this.IL_DB=IL_DB;', sb); return sb.IL_DB; })();
const ITEMS = JSON.parse(read('items-il.json'));
// настоящие регулярки ядра: UNAVAIL — как тост страницы, FORCE_NEED — «не хватает энергии»
const RX = (() => { const sb = {}; const a = contentSrc.indexOf('const UNAVAIL = '), b = contentSrc.indexOf('const FORCE_WORD = '), c = contentSrc.indexOf('const FORCE_NEED = ');
  vm.runInNewContext([contentSrc.slice(a, contentSrc.indexOf('\n', a)), contentSrc.slice(b, contentSrc.indexOf('\n', b)), contentSrc.slice(c, contentSrc.indexOf('\n', c)),
    'this.UNAVAIL=UNAVAIL;this.FORCE_NEED=FORCE_NEED;'].join('\n'), sb); return sb; })();
const NOT_ALLOWED = 'Цей скилл зараз недоступний для твого персонажа.';

// ── 1. квитанция хода: error/reason/текст сервера (content.js) ──
test('квитанция хода хранит error, reason и текст отказа сервера', () => {
  const i0 = contentSrc.indexOf("  if(path==='/game/battle/action'&&d.rid!=null){"), end = 'battleReceipts.keys().next().value);\n  }', i1 = contentSrc.indexOf(end, i0);
  assert.ok(i0 > 0 && i1 > i0, 'блок квитанций найден');
  const sb = { battleReceipts: new Map(), observeOwner: () => 'Hero', ACT_NET: { ok: false }, netContext: { at: 1, monsterToken: '' }, Date, String };
  vm.runInNewContext(`this.on = (path, d) => {\n${contentSrc.slice(i0, i1 + end.length)}\n};`, sb);
  sb.on('/game/battle/action', { rid: 7, req: { action: 'wild_sweep' }, status: 400, res: { error: 'battle_skill_not_allowed', code: 'battle_skill_not_allowed', message: NOT_ALLOWED, blockedBy: '' } });
  const r = sb.battleReceipts.get(7);
  assert.equal(r.code, 'battle_skill_not_allowed'); assert.equal(r.error, 'battle_skill_not_allowed'); assert.equal(r.message, NOT_ALLOWED); assert.equal(r.reason, '');
  sb.on('/game/battle/action', { rid: 8, req: { action: 'battle_potion_use' }, status: 400, res: { error: 'battle_none', code: 'battle_skill_not_allowed', reason: 'not_in_battle', messageUk: 'Немає активного бою.' } });
  assert.deepEqual([sb.battleReceipts.get(8).error, sb.battleReceipts.get(8).reason, sb.battleReceipts.get(8).message], ['battle_none', 'not_in_battle', 'Немає активного бою.']);
});

// ── 2. настоящий act(): отказ battle_skill_not_allowed → 'unavail' сразу, без тоста и паузы реакции ──
const actSource = combatSrc.slice(combatSrc.indexOf('  let lastHpPot = 0, lastMpPot = 0'), combatSrc.indexOf('  const t0 = Date.now();\n  let progSig'));
function actFixture(receipt, toast = NOT_ALLOWED) {
  let now = 1e6, rid = 10, ready = true; const events = [], fired = [], receipts = new Map(), pauses = [], owner = 'hero';
  const net = { start: 1, done: 1, doneT: now - 10000, startRid: 9, startOwner: owner, ok: true, action: 'wild_sweep' };
  const at = (ms, fn) => events.push({ t: now + ms, fn });
  const advance = to => { events.sort((a, b) => a.t - b.t); while (events.length && events[0].t <= to) { const e = events.shift(); now = e.t; e.fn(); } now = to; };
  const wait = async (fn, ms) => { const end = now + ms; for (let i = 0; i < 1000; i++) { const v = fn(); if (v) return v; if (now >= end) return null; advance(Math.min(end, ...events.map(e => e.t))); } throw Error('spin'); };
  const env = { cfg: { nDrain: '' }, names: () => [], rt: { char: 'Hero', classCur: { prof: 'fortune_seeker', slot: 0 } }, on: true, tabOwner: true, isBattle: () => true, canAct: () => true,
    evidenceOwner: () => owner, battleExitContext: () => owner, routeLocation: { href: '/battle.html?spawnId=one' },
    sleep: async ms => advance(now + ms), combatPulse: async ms => advance(Math.min(now + ms, ...events.map(e => e.t))), combatWait: wait, waitFor: wait, gameBusy: () => ({ busy: false, end: 0 }),
    combatCooldown: { globalWait: () => 0, skillWait: () => 0, skillKnown: () => false, recentlyGlobalRejected: () => false },
    slotAction: () => 'wild_sweep', cdSpawn: () => 'one', battleSpawn: () => 'one', observeSlot: () => {}, actNet: () => net, actReceipt: id => receipts.get(id), skKey: () => 'wild sweep',
    fire() { fired.push(now); const id = ++rid; net.start++; net.startRid = id; net.startOwner = owner;
      at(60, () => { net.done++; net.doneT = now; net.ok = false; net.action = 'wild_sweep'; receipts.set(id, { rid: id, t: now, owner, action: 'wild_sweep', ok: false, blockedBy: '', ...receipt }); }); return true; },
    setStatus: () => {}, setRt: async () => {}, slotCd: () => ({}), meMp: () => ({ cur: 900, max: 900 }), petState: () => null, pause: async () => { pauses.push(now); advance(now + 300); },
    rnd: a => a, rec: () => {}, TAG: 't', cleanTitle: s => s, memLeft: () => 0, FORCE_NEED: RX.FORCE_NEED, UNAVAIL: RX.UNAVAIL, CD_RE: /перезаряд|cooldown/i };
  const box = { console: { info: () => {} }, Date: { now: () => now }, Math, Map, String, env, ctx: { pet: null, block: {} }, LOCK_A: [60, 500, 120], LOCK_B: [30, 200, 50], NOMP_MS: 1500,
    lostUntil: new Map(), mpUntil: new Map(), pressAt: new Map(), victory: () => false, defeat: () => false, affordable: () => true, healSlot: () => false,
    noticeText: () => toast, uiReady: () => ready, mobHp: () => ({ cur: 1000 }), rememberCd: async () => {}, slotsBy: () => [], drainBackoff: () => {} };
  vm.runInNewContext(actSource + '\nthis.act=act;this.refuse=()=>ctx.refuseText;', box);
  return { act: () => box.act({ title: 'Wild Sweep', mp: 30 }, 'AoE'), fired, pauses, now: () => now, refuse: () => box.refuse() };
}
test('22:07:37: второй отказ подряд с тем же тостом — сразу «недоступно» по тексту сервера, без паузы реакции', async () => {
  const f = actFixture({ code: 'battle_skill_not_allowed', error: 'battle_skill_not_allowed', message: NOT_ALLOWED });
  assert.equal(await f.act(), 'unavail');
  assert.equal(f.now() - f.fired[0], 60, 'ответ сервера — и сразу решение, тост не ждём');
  assert.equal(f.pauses.length, 0); assert.equal(f.refuse(), NOT_ALLOWED, 'текст отказа — в строку журнала «недоступно»');
});
test('«боя нет» (battle_none / not_in_battle) с тем же кодом — не «недоступно» (v90-battlegone)', async () => {
  for (const r of [{ code: 'battle_skill_not_allowed', error: 'battle_none', reason: 'not_in_battle', message: 'Немає активного бою.' },
    { code: 'battle_skill_not_allowed', error: 'battle_none', message: NOT_ALLOWED }, { code: 'battle_skill_not_allowed', reason: 'not_in_battle', message: NOT_ALLOWED }]) {
    const f = actFixture(r, ''); assert.notEqual(await f.act(), 'unavail', JSON.stringify(r)); assert.equal(f.refuse(), '');
  }
});
test('отказ без текста или про энергию — прежний путь по тосту страницы', async () => {
  let f = actFixture({ code: 'battle_skill_not_allowed' }, NOT_ALLOWED);
  assert.equal(await f.act(), false, 'тот же тост на экране, кода «unavail» нет — как раньше');
  f = actFixture({ code: 'battle_skill_not_allowed', message: 'Недостатньо енергії — скил недоступний' }, '');
  assert.equal(await f.act(), false, 'энергия — не «недоступно»');
  f = actFixture({ code: 'wrong_weapon' }, ''); assert.equal(await f.act(), 'unavail', 'прежние коды работают');
});

// ── 3. навык не под надетое оружие не выбирается (combat.chooseAction) ──
function combatFixture({ wt = 'дубина', confirmed = true } = {}) {
  const panel = [];
  const env = { cfg: { nPower: '', nUltra: '', nForce: '', nCharge: '', nStun: '', nHeal: '', nDrain: '', nAttack: '', skillMpMin: 35, stunEvery: 0, ultMode: 'always' },
    rt: { char: 'Hero', prof: 'Fortune Seeker', classCur: { slot: 0, prof: 'dwarf_fortune_seeker' }, skills: {}, skillDb: {},
      ...(wt == null ? {} : { weaponsT: confirmed ? 5 : 0, weapons: [{ id: 2503, inst: 'eq:l1', ench: 4, where: 'надето', wt }] }) }, SLOT: '.slot',
    cleanTitle: s => String(s || '').split(/\s+[—–-]\s+|\s*\(/)[0].trim(), names: s => String(s || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean),
    ilOf: b => typeof b === 'string' ? panel.find(x => x.title.toLowerCase() === b.toLowerCase())?.il : b?.il,
    slotKind: b => b.kind || 'скилл', slotAction: b => b.action || b.title.toLowerCase(), skKey: b => b.title.toLowerCase(), isEquip: () => false,
    slotCd: () => null, memLeft: () => 0, cdSpawn: () => 'one', battleSpawn: () => 'one', combatCooldown: { skillWait: () => 0 }, shown: b => !!b && !b.hidden,
    $q: s => s === '#battle-mob-hp-val' ? { textContent: '10000 / 10000' } : null, combatProfileKind: () => 'fighter', meHp: () => ({ cur: 1000, max: 1000, pct: 100 }), meMp: () => ({ cur: 900, max: 900 }),
    skillMp: () => 0, noEffect: () => false, forceNow: () => 0, forceMax: () => 0, forceCosts: () => [], isChargeName: () => false, isForceName: () => false,
    expDmg: () => 1000, longFightMp: () => null, turnSec: () => 1, powerOf: () => 0, mpPotSlot: () => null, chargeValue: () => 0 };
  const box = { console, Date, document: { querySelectorAll: () => panel }, location: { search: '?spawnId=one' } };
  vm.runInNewContext(combatSrc, box);
  const C = box.L2V7Factories.combat(env);
  const add = (title, id, extra = {}) => { const b = { title, il: { id, ...IL_DB[id], ...(extra.il || {}) }, getAttribute: () => null, ...extra }; panel.push(b); return b; };
  const pick = (ctx = { block: {}, lastStun: 0 }) => C.chooseAction(ctx, env.meMp())?.b?.title || null;
  return { C, env, add, pick };
}
test('дубина (Yaksa Mace / Elysian): Whirlwind и Wild Sweep не жмутся, Hammer Crush — да', () => {
  for (const wt of ['дубина', 'двуруч. дубина', 'blunt']) {
    const f = combatFixture({ wt }); f.add('Wild Sweep', 245); f.add('Whirlwind', 36); f.add('Hammer Crush', 260);
    f.env.cfg.nPower = 'Wild Sweep, Whirlwind, Hammer Crush';
    assert.equal(f.pick(), 'Hammer Crush', wt);
    assert.equal(f.pick({ block: { 'power:Hammer Crush': Infinity }, lastStun: 0 }), null, wt + ': остальное — только древковое, отказа сервера не ждём');
  }
});
test('пика (Клановий штормер / Оркська алебарда): Whirlwind/Wild Sweep — да, Hammer Crush — нет', () => {
  for (const wt of ['древковое', 'polearm', 'pole']) {
    const f = combatFixture({ wt }); f.add('Hammer Crush', 260); f.add('Wild Sweep', 245); f.add('Whirlwind', 36);
    f.env.cfg.nPower = 'Hammer Crush, Wild Sweep, Whirlwind';
    assert.match(f.pick(), /^(?:Wild Sweep|Whirlwind)$/, wt);
    assert.equal(f.pick({ block: { 'power:Wild Sweep': Infinity, 'power:Whirlwind': Infinity }, lastStun: 0 }), null, wt + ': Hammer Crush только с дубиной');
  }
});
test('оружие не подтверждено или вид неизвестен — как раньше, решает отказ сервера', () => {
  for (const o of [{ wt: 'дубина', confirmed: false }, { wt: null }, { wt: '—' }, { wt: 'прочее' }, { wt: 'рапира' }, { wt: '' }]) {
    const f = combatFixture(o); f.add('Whirlwind', 36); f.env.cfg.nPower = 'Whirlwind';
    assert.equal(f.pick(), 'Whirlwind', JSON.stringify(o));
  }
});
test('станы и сверхсильные тоже сверяются с оружием', () => {
  let f = combatFixture({ wt: 'древковое' }); f.add('Stun Attack', 100); f.env.cfg.nStun = 'Stun Attack';
  assert.equal(f.C.chooseAction({ block: {}, lastStun: 0, champ: true }, f.env.meMp()), null, 'Stun Attack — только дубина');
  f = combatFixture({ wt: 'дубина' }); f.add('Stun Attack', 100); f.env.cfg.nStun = 'Stun Attack';
  assert.equal(f.C.chooseAction({ block: {}, lastStun: 0, champ: true }, f.env.meMp())?.b?.title, 'Stun Attack');
  f = combatFixture({ wt: 'дубина' }); f.add('Wild Sweep', 245); f.env.cfg.nUltra = 'Wild Sweep';
  assert.equal(f.pick(), null, 'nUltra с дубиной: Wild Sweep не жмётся');
});
test('все виды оружия справочника: свой вид — навык доступен, чужой — нет; «без оружия»/«щит» — не ограничение', () => {
  const tokens = new Set(), free = new Set(['без оружия', 'щит']);
  for (const s of Object.values(IL_DB)) if (s.w) String(s.w).split(',').forEach(x => tokens.add(x.trim()));
  const kinds = [...tokens].filter(t => !free.has(t));
  assert.deepEqual([...tokens].filter(t => free.has(t)).sort(), [...free].sort(), 'в справочнике есть «без оружия» и «щит»');
  assert.ok(kinds.length >= 9, 'девять видов оружия');
  for (const need of kinds) {
    const own = combatFixture({ wt: need }); own.add('Probe Skill', 3, { il: { w: need } }); own.env.cfg.nPower = 'Probe Skill';
    assert.equal(own.pick(), 'Probe Skill', need + ' со своим видом');
    const other = kinds.find(k => k !== need), alien = combatFixture({ wt: other }); alien.add('Probe Skill', 3, { il: { w: need } }); alien.env.cfg.nPower = 'Probe Skill';
    assert.equal(alien.pick(), null, need + ' с ' + other);
  }
  // каталог игры (/character/catalog-hints) пишет парные мечи «дуалы»
  let f = combatFixture({ wt: 'дуалы' }); f.add('Triple Slash', 1); f.env.cfg.nPower = 'Triple Slash'; assert.equal(f.pick(), 'Triple Slash', 'дуалы = парные мечи');
  // лук и кинжал: свои навыки — да, чужие — нет
  f = combatFixture({ wt: 'лук' }); f.add('Power Shot', 56); f.add('Mortal Blow', 16); f.env.cfg.nPower = 'Mortal Blow, Power Shot'; assert.equal(f.pick(), 'Power Shot');
  f = combatFixture({ wt: 'кинжал' }); f.add('Power Shot', 56); f.add('Mortal Blow', 16); f.env.cfg.nPower = 'Power Shot, Mortal Blow'; assert.equal(f.pick(), 'Mortal Blow');
  // Shield Stun («без оружия» — щитовой) с любым оружием не запрещён по виду
  for (const wt of ['дубина', 'меч', 'древковое']) { f = combatFixture({ wt }); f.add('Shield Stun', 92); f.env.cfg.nPower = 'Shield Stun'; assert.equal(f.pick(), 'Shield Stun', wt); }
});
test('журнал ожидания навыков называет нужное оружие', () => {
  assert.match(combatSrc, /const reason = weaponBarred\(b\) \? 'нужно ' \+ weaponNeed\(b\)\.join\('\/'\)/);
});

// ── 4. Warsmith/Artisan/Maestro: древковое «в класс» (content.js CLASS_W + equipment.rankWeapons) ──
function equipFixture(rt, extraEnv = {}) {
  const a = contentSrc.indexOf('const GRADE_LV = '), b = contentSrc.indexOf('const heroLevel = ', a);
  const cls = {}; vm.runInNewContext(contentSrc.slice(a, b) + '\nthis.CLASS_W=CLASS_W;this.MAGE=MAGE;this.GRADE_LV=GRADE_LV;', cls);
  const env = { rt, cfg: {}, GRADE_LV: cls.GRADE_LV, CLASS_W: cls.CLASS_W, MAGE: cls.MAGE, heroLevel: () => rt.lvl,
    normalizeProfession: n => String(n || '').trim().replace(/[_\s-]+/g, ' ').replace(/\s+/g, ' ').toLowerCase(), combatProfileKind: () => 'fighter',
    itemOf: id => ITEMS[id] ? { id: +id, ...ITEMS[id] } : null, ...extraEnv };
  const sb = { console, Date, Math, document: { querySelectorAll: () => [], querySelector: () => null } }; sb.globalThis = sb;
  vm.runInNewContext(read('modules/equipment.js'), sb);
  return { E: sb.L2V7Factories.equipment(env), CLASS_W: cls.CLASS_W, env, sb };
}
test('22:40:30: у Warsmith надетая Оркська алебарда — «в класс», булава тоже', () => {
  const { E, CLASS_W } = equipFixture({ lvl: 40, prof: 'Warsmith', classCur: { prof: 'dwarf_warsmith', slot: 1 } });
  for (const p of ['artisan', 'warsmith', 'maestro']) { assert.ok(CLASS_W[p].includes('древковое'), p); assert.ok(CLASS_W[p].includes('дубина'), p); }
  assert.deepEqual([...CLASS_W['fortune seeker']], ['дубина', 'двуруч. дубина', 'древковое'], 'спойлер без изменений');
  const pike = { ...E.weaponOf(299, { where: 'надето' }), ench: 0 }, mace = { ...E.weaponOf(2503, { where: 'сумка' }), ench: 0 };
  const R = E.rankWeapons([pike, mace]);
  assert.equal(R.inClass(pike), true); assert.equal(R.inClass(mace), true);
  assert.equal(R.types.includes('древковое'), true);
});

// ── 5. щит — не оружие (equipment.weaponOf → скан сумки и повод перечитать) ──
test('23:07:57: Full Plate Shield (вид «—») — не оружие: ни в скан сумки, ни в «новое оружие в сумке»', async () => {
  assert.equal(ITEMS[2497].k, 'W'); assert.equal(ITEMS[2497].wt, '—');
  const rt = { lvl: 42, weaponsT: 1, weaponRec: { lv: 42 }, weapons: [{ id: 299, g: 'C', where: 'надето', wt: 'древковое' }] };
  const row = (itemId, name) => ({ dataset: { itemJson: JSON.stringify({ itemId, enchant: 0 }) }, querySelector: () => ({ textContent: name }) });
  const rows = [row(2503, 'Yaksa Mace'), row(2497, 'Full Plate Shield')];
  const { E, sb } = equipFixture(rt, { itemJson: r => JSON.parse(r.dataset.itemJson), baseName: s => String(s || '').trim() });
  sb.document.querySelectorAll = s => /l2-char-bag-row/.test(s) ? rows : [];
  assert.equal(E.weaponOf(2497), null, 'щит');
  assert.equal(E.weaponOf(2503)?.wt, 'дубина', 'булава — оружие');
  assert.equal(E.weaponOf(299)?.wt, 'древковое', 'пика — оружие');
  const bag = await E.readWeaponsPage();
  assert.deepEqual([...bag.map(w => w.id)], [2503], 'в сумке оружия — только булава');
  assert.equal(E.weaponRescanWhy({ 2497: 1 }, 42), '', 'щит в сумке — не повод перечитывать');
  assert.match(E.weaponRescanWhy({ 2503: 1, 2497: 1 }, 42), /новое оружие в сумке: Yaksa Mace$/, 'настоящее новое оружие — повод, без щита в списке');
});

// ── 6. ревью logfix-2 ──
// 6.1: запись rt.weapons «надето» устарела (смена без POST, который видит бот) — навыки настоящего оружия не прячутся.
// Живая правая рука — rt.weaponAug.w из GET /character игры (hook aug, eq.l1); верим ей, только если она не старше записи
function weaponLiveFixture(aug, wt = 'дубина', order = 'Whirlwind, Hammer Crush') {
  const f = combatFixture({ wt }); f.add('Whirlwind', 36); f.add('Hammer Crush', 260); f.env.cfg.nPower = order;
  if (aug) f.env.rt.weaponAug = aug; return f;    // запись: id 2503 (Yaksa Mace) от weaponsT 5
}
test('ревью: в записи дубина, в руке (GET /character) пика новее записи — Whirlwind выбирается, как до 20.43', () => {
  assert.equal(weaponLiveFixture({ w: 299, e: 0, o: null, t: 10 }).pick(), 'Whirlwind', 'живая пика новее записи');
  assert.equal(weaponLiveFixture({ w: 0, t: 10 }).pick(), 'Whirlwind', 'в руке ничего — запись неверна, решает сервер');
  assert.equal(weaponLiveFixture({ w: 2503, t: 10 }).pick(), 'Hammer Crush', 'живое = записи — Whirlwind под дубину не выбирается');
  assert.equal(weaponLiveFixture({ w: 299, t: 1 }).pick(), 'Hammer Crush', 'живое старше записи (свой POST набора крафтера мимо hook) — верим записи');
  assert.equal(weaponLiveFixture({ w: 299 }).pick(), 'Hammer Crush', 'отметки t нет (запись lifestone) — верим записи');
  assert.equal(weaponLiveFixture(null).pick(), 'Hammer Crush', 'rt.weaponAug нет — как в 20.43');
  // обратная ошибка: в записи пика, в руке дубина — Hammer Crush не прячется
  const r = weaponLiveFixture({ w: 2503, t: 10 }, 'древковое', 'Hammer Crush, Whirlwind'); r.env.rt.weapons[0].id = 299;
  assert.equal(r.pick(), 'Hammer Crush', 'живая дубина новее записи «пика»');
  r.env.rt.weaponAug = { w: 299, t: 10 }; assert.equal(r.pick(), 'Whirlwind', 'живая пика = записи — Hammer Crush под пику не выбирается');
});
test('ревью: content.augNote освежает отметку правой руки при расхождении с более новой записью — одна запись', () => {
  const an = contentSrc.match(/function augNote\(a, path\) \{[\s\S]*?\n\}\n/)[0];
  let now = 1000; const writes = [];
  const f = weaponLiveFixture({ w: 299, e: 0, o: null, t: 100 });
  f.env.rt.weaponsT = 500;                        // запись «надето Yaksa Mace» после того, как пика попала в rt.weaponAug
  const sb = { rt: f.env.rt, AUG: { info: () => null, text: () => '' }, itemOf: () => null, rec: () => {}, Date: { now: () => now },
    setRt: p => { writes.push(p); Object.assign(sb.rt, p); } };
  vm.runInNewContext(an + 'this.augNote = augNote;', sb);
  assert.equal(f.pick(), 'Hammer Crush', 'до GET игры верим записи');
  sb.augNote({ w: 299, e: 0, o: null, g: null }, '/character');
  assert.equal(writes.length, 1); assert.equal(f.env.rt.weaponAug.t, 1000); assert.equal(f.env.rt.weaponAug.w, 299);
  assert.equal(f.pick(), 'Whirlwind', 'после первого GET /character игры — навыки настоящей пики');
  now = 2000; sb.augNote({ w: 299, e: 0, o: null, g: null }, '/character'); assert.equal(writes.length, 1, 'повтор того же — без записи');
  // набор крафтера: свой POST надел булаву (запись новее), GET игры показывает её же — прежняя запись смены, согласие
  f.env.rt.weaponsT = 3000; now = 3500; sb.augNote({ w: 2503, e: 0, o: null, g: null }, '/character');
  assert.equal(writes.length, 2); assert.equal(f.pick(), 'Hammer Crush', 'булава в руке и в записи — Whirlwind не выбирается');
  now = 4000; sb.augNote({ w: 2503, e: 0, o: null, g: null }, '/character'); assert.equal(writes.length, 2, 'согласие — без записи');
});

// 6.2: «недоступно» в строках баффа, баффа кота, спойла и тоггла — текст отказа сервера (ctx.refuseText из act), не старый тост
const OLD_TOAST = 'Whirlwind: Скіл на перезарядці.';
test('ревью: строка «недоступно» спойла (loot) — текст отказа сервера; без него — тост, как раньше', async () => {
  const solo = { title: 'Spoil' }, recs = [];
  const env = { cfg: { nSpoil: 'Spoil', nSpoilMass: '' }, rt: { char: 'Hero' }, weaponNow: () => null, roleNow: () => 'spoiler',
    names: s => String(s || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean), slotsBy: n => n.toLowerCase() === 'spoil' ? [solo] : [],
    ready: () => true, cleanTitle: s => s, extraMobs: () => [], meMp: () => ({ cur: 900, max: 900 }), skillMp: () => 40, logLines: () => [], newLines: () => [],
    mobSpoiled: () => false, nameLike: (a, b) => a === b, SPOIL_OK: /^$/, SPOIL_FAIL: /^$/, waitFor: async fn => fn(), noticeText: () => OLD_TOAST,
    rec: (...a) => recs.push(a.join(' ')), setRt: async () => {} };
  const box = { console, URLSearchParams, Date, Math }; vm.runInNewContext(read('modules/loot.js'), box);
  const L = box.L2V7Factories.loot(env);
  let ctx = { block: {}, name: 'Buffalo' };
  assert.equal(await L.spoilStep(ctx, async () => { ctx.refuseText = NOT_ALLOWED; return 'unavail'; }, { cur: 3000, max: 3000 }), true);
  assert.equal(recs.length, 1); assert.ok(recs[0].includes('«Spoil»: ' + NOT_ALLOWED), recs[0]); assert.ok(!recs[0].includes(OLD_TOAST));
  ctx = { block: {}, name: 'Buffalo' };
  await L.spoilStep(ctx, async () => { ctx.refuseText = ''; return 'unavail'; }, { cur: 3000, max: 3000 });
  assert.ok(recs[1].includes('«Spoil»: ' + OLD_TOAST), recs[1]);
});
test('ревью: строка «недоступно» тоггла (content.toggleStep) — текст отказа сервера', async () => {
  const b = { title: 'Vicious Stance' }, recs = [];
  const box = { cfg: { nToggles: 'vicious stance', toggleMpOff: 10, toggleMpOn: 30 }, rt: {}, names: s => String(s || '').split(',').map(x => x.trim()).filter(Boolean),
    meMp: () => ({ cur: 400, max: 500 }), slotsBy: () => [b], toggleState: () => false, ilOf: () => null, activeBuffs: () => [], uiReady: () => true, cleanTitle: s => s,
    noticeText: () => OLD_TOAST, setRt: async () => {}, rec: (...a) => recs.push(a.join(' | ')), Date };
  vm.runInNewContext(contentSrc.slice(contentSrc.indexOf('async function toggleStep('), contentSrc.indexOf('// ---------- 🩺')) + '\nthis.step=toggleStep;', box);
  const ctx = { block: {} };
  assert.equal(await box.step(ctx, {}, async () => { ctx.refuseText = NOT_ALLOWED; return 'unavail'; }), true);
  assert.equal(ctx.block['tgl:vicious stance'], Infinity); assert.ok(recs[0].includes('Vicious Stance: ' + NOT_ALLOWED), recs[0]);
});
test('ревью: бафф, бафф кота и удар пишут ctx.refuseText раньше тоста; act ставит его в каждом ходе', () => {
  assert.match(combatSrc, /бафф кота «\$\{env\.cleanTitle\(pb\.b\.title\)\}»: \$\{ctx\.refuseText \|\| noticeText\(\) \|\| 'недоступен'\}/);
  assert.match(combatSrc, /`бафф «\$\{b\.title\}»: \$\{ctx\.refuseText \|\| noticeText\(\) \|\| 'недоступен'\}`/);
  assert.match(combatSrc, /`«\$\{a\.b\.title\}»: \$\{ctx\.refuseText \|\| noticeText\(\) \|\| 'скилл недоступен'\}`/);
  assert.equal((combatSrc.match(/ctx\.refuseText=/g) || []).length, 1, 'одно место записи — в act, до ответа «unavail»');
  assert.equal((combatSrc.replace(/ctx\.refuseText/g, '').match(/\brefuseText\b/g) || []).length, 0, 'локальной refuseText больше нет');
});
