'use strict';
// Lite 1.8.1 (24.10, John: «Проведи моделирование и создай правки: Включение Arcane Power ботом, банки MP в долгой охоте»).
// Модель долгой охоты (tests/tools/lite-mage-model.cjs, kb/lite-mage-study.md §7): маг в Ashen пьёт ≈9 больших банок MP в минуту боя;
// стопка на панели кончается — игра убирает слот, и Lite 1.7 бил обычной атакой по 1 урону. Arcane Power тянет 25 HP/с: без банок HP
// герой умирал (3 смерти за 30 мин останавливают Lite). Здесь — банка с сумки на панель, экономный режим, отдых по MP, снятие стойки.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const L = require('../lite/logic.js');
const M = require('./tools/lite-mage-model.cjs');
const bot = read('lite/bot.js'), hook = read('lite/hook.js'), pj = read('lite/popup.js'), html = read('lite/popup.html');

const sl = (id, extra = {}) => { const r = L.SK[id]; return { key: 'l2_' + id, action: 'l2_' + id, id, name: r[0], type: r[1], pow: r[2], mp: r[3], hp: r[4], on: true, ready: true, i: id, ...extra }; };
const BASIC = { key: 'attack', action: 'attack', name: 'Атака', type: 'basic', on: true, ready: true, i: 0 };
const POT = (pot, qty = 100) => ({ key: 'item:' + pot, action: '', name: pot === 'mp' ? 'Зілля мани (велика банка)' : 'Зілля зцілення', type: 'item', pot, qty, on: true, ready: true, i: 40 });
const ME = (hpP, mpP = 100) => ({ hp: 23605 * hpP / 100, maxHp: 23605, mp: 6203 * mpP / 100, maxMp: 6203 });
const MOB = { hp: 268546, maxHp: 268546 };
const EX = () => [{ name: 'Dark Reaper', hp: 267416, maxHp: 267416 }, { name: 'Infernal Knight', hp: 266329, maxHp: 266329 }];
const now = 1e6, opt = o => ({ now, mage: true, hpPot: 50, mpPot: 25, extras: EX(), ...o });
const AP = (active, o = {}) => sl(337, { active, ...o });
const bar = (o = {}) => [BASIC, sl(1176, o.bliz), sl(1181, o.flame), sl(1289, o.hell), sl(1292, o.crash), AP(o.ap === undefined ? true : o.ap)];

test('банки: какую ставить на панель и сколько их в сумке', () => {
  const titles = ['Зілля зцілення ×20', 'Зілля мани (мала банка) ×500', 'Зілля мани (велика банка) ×150', 'Свиток телепорта ×3'];
  assert.equal(L.potPick(titles, 'mp'), 2, 'большая раньше малой: глоток — тоже ход');
  assert.equal(L.potPick(titles, 'hp'), 0);
  assert.equal(L.potPick(['Зілля мани (велика банка) ×0', 'Зілля мани (мала банка) ×500'], 'mp'), 1, 'пустую стопку не ставим');
  assert.equal(L.potPick(['Зілля зцілення ×20'], 'mp'), -1);
  assert.equal(L.potPick([], 'mp'), -1);
  assert.ok(L.potGain('Зілля мани (велика банка)') > L.potGain('Зілля мани (мала банка)'));
  assert.deepEqual(L.potsOf([{ itemId: 728, qty: 100 }, { itemId: 726, qty: 5 }, { itemId: 1061, qty: 3 }, { itemId: 57, qty: 9e6 }, { itemId: 728, qty: 0 }]), { mp: 105, hp: 3 });
  assert.equal(L.potsOf(null), null, 'нет сумки в ответе — не знаем, а не «банок нет»');
  // hook считает банки по тем же номерам, что логика
  const m = hook.match(/const POT_MP = \[([\d, ]+)\], POT_HP = \[([\d, ]+)\];/);
  assert.ok(m, 'hook: номера банок');
  assert.deepEqual(m[1].split(',').map(Number), L.POT_MP); assert.deepEqual(m[2].split(',').map(Number), L.POT_HP);
  assert.match(hook, /pots: potsOf\(c\),/);
});

test('Arcane Power: снимаем без банок HP при HP ≤ 30 %, включаем снова от 60 %; банки HP есть — держим', () => {
  // HP 25 %, банок HP нет, банки MP есть — снимаем (одно нажатие стойки с пометкой off)
  let p = L.planTurn([...bar(), POT('mp')], ME(25), MOB, opt({ mpPots: 100 }));
  assert.equal(p.slot.key, 'l2_337'); assert.equal(p.off, true); assert.match(p.why, /снимаю Arcane Power: HP 25 %, банок HP нет/);
  // HP 31 % — ещё держим
  p = L.planTurn([...bar(), POT('mp')], ME(31), MOB, opt({ mpPots: 100 }));
  assert.notEqual(p.slot.key, 'l2_337');
  // банки HP есть: HP 25 % — сначала банка, а с порогом банки 10 % стойку не трогаем
  p = L.planTurn([...bar(), POT('mp'), POT('hp')], ME(25), MOB, opt({ mpPots: 100 }));
  assert.equal(p.slot.pot, 'hp');
  p = L.planTurn([...bar(), POT('mp'), POT('hp')], ME(25), MOB, opt({ mpPots: 100, hpPot: 10 }));
  assert.ok(p.slot.key !== 'l2_337' && !p.off);
  // выключена: без банок HP включаем только от 60 % HP; с банками HP — сразу
  p = L.planTurn([...bar({ ap: false }), POT('mp')], ME(45), MOB, opt({ mpPots: 100 }));
  assert.notEqual(p.slot.key, 'l2_337');
  p = L.planTurn([...bar({ ap: false }), POT('mp')], ME(65), MOB, opt({ mpPots: 100 }));
  assert.equal(p.slot.key, 'l2_337'); assert.ok(!p.off); assert.match(p.why, /включаю стойку/);
  p = L.planTurn([...bar({ ap: false }), POT('mp'), POT('hp')], ME(45), MOB, opt({ mpPots: 100, hpPot: 10 }));
  assert.equal(p.slot.key, 'l2_337');
  // снять можно и при пустой мане: MP стойки (36) — цена включения, не снятия
  p = L.planTurn([...bar()], { ...ME(20), mp: 0 }, MOB, opt({ mpPots: 100 }));
  assert.equal(p.slot.key, 'l2_337'); assert.equal(p.off, true);
  // галка снята в меню (on: false) — бот её не трогает ни так, ни так
  p = L.planTurn([BASIC, sl(1181), AP(true, { on: false }), POT('mp')], ME(20), MOB, opt({ mpPots: 100 }));
  assert.notEqual(p.slot.key, 'l2_337');
  // TvT: стойки не трогаем
  p = L.planTurn([BASIC, sl(1181), AP(true)], ME(20), MOB, { now, mage: true, tvt: true });
  assert.ok(!p || p.slot.key !== 'l2_337');
  // стойка воина (Vicious Stance 312) HP не тянет — правило её не касается
  p = L.planTurn([BASIC, sl(190), sl(312, { active: false })], ME(20), MOB, { now });
  assert.equal(p.slot.key, 'l2_312');
  assert.deepEqual(L.TGL_DRAIN, { 337: 25 });
});

test('Arcane Power у мага без банок MP: снимаем и не включаем — впереди отдых, а она тянет HP', () => {
  let p = L.planTurn(bar(), ME(100), MOB, opt({ mpPots: 0 }));
  assert.equal(p.slot.key, 'l2_337'); assert.equal(p.off, true); assert.match(p.why, /банок MP нет — впереди отдых/);
  p = L.planTurn(bar({ ap: false }), ME(100), MOB, opt({ mpPots: 0 }));
  assert.notEqual(p.slot.key, 'l2_337');
  // в сумке банки есть (стопку на панель бот поставит сам) — держим и включаем
  p = L.planTurn(bar({ ap: false }), ME(100), MOB, opt({ mpPots: 300 }));
  assert.equal(p.slot.key, 'l2_337');
  // сумку ещё не видели (null) — как раньше: стойка не снимается
  p = L.planTurn(bar(), ME(100), MOB, opt({ mpPots: null }));
  assert.notEqual(p.slot.key, 'l2_337');
});

test('экономный режим: банок MP нет — лучший урон на 1 MP, ждём его откат или MP, обычной атакой маг не бьёт', () => {
  assert.ok(L.perMp(sl(1181)) > L.perMp(sl(1176)) && L.perMp(sl(1181)) > L.perMp(sl(1289)), 'Flame Strike 19/28 — лучший на 1 MP');
  let p = L.planTurn(bar({ ap: false }), ME(100, 90), MOB, opt({ mpPots: 0 }));
  assert.equal(p.slot.key, 'l2_1181'); assert.match(p.why, /экономлю MP: банок нет/); assert.match(p.why, /\+2 соседа умрут/);
  // Flame Strike откатится через 0,4 с — ждём его, а не тратим 200 MP на Hell
  p = L.planTurn(bar({ ap: false, flame: { ready: false, left: 400 } }), ME(100, 90), MOB, opt({ mpPots: 0 }));
  assert.equal(p, null);
  // откат дольше 1,5 с — следующий по урону на 1 MP
  p = L.planTurn(bar({ ap: false, flame: { ready: false, left: 5000 } }), ME(100, 90), MOB, opt({ mpPots: 0 }));
  assert.equal(p.slot.key, [sl(1176), sl(1289)].sort((a, b) => L.perMp(b) - L.perMp(a))[0].key);
  // MP 20 — ни на что не хватает: ждём (статус «жду MP»), а не обычная атака по 1 урону
  const me = { ...ME(100), mp: 20 };
  p = L.planTurn(bar({ ap: false }), me, MOB, opt({ mpPots: 0 }));
  assert.equal(p, null); assert.equal(L.mpShort(bar({ ap: false }), me), true);
  assert.equal(L.mpShort(bar({ ap: false }), ME(100, 50)), false);
  // без банок, но с банкой на панели или в сумке — обычный порядок (сильнейший массовый)
  p = L.planTurn([...bar(), POT('mp')], ME(100, 90), MOB, opt({ mpPots: 0 }));
  assert.equal(p.slot.key, 'l2_1289'); assert.doesNotMatch(p.why, /экономлю/);
  p = L.planTurn(bar(), ME(100, 90), MOB, opt({ mpPots: null }));
  assert.equal(p.slot.key, 'l2_1289');
  // маг без MP и с банкой на паузе между глотками — ждём глоток, не бьём атакой; воин — как раньше
  p = L.planTurn([BASIC, sl(1181), POT('mp')], { ...ME(100), mp: 0 }, MOB, opt({ mpPots: 100, lastPot: { mp: now - 300 } }));
  assert.equal(p, null);
  assert.equal(L.planTurn([BASIC, sl(1181)], { ...ME(100), mp: 0 }, MOB, { now }).slot.key, 'attack');
});

test('память стойки: бот снял её сам — старая подсветка не заставит «снять» ещё раз; включение после снятия — первое нажатие', () => {
  const mem = { on: false, off: 1, t: now - 1000, flap: 0 };
  assert.equal(L.toggleOn({ mem, dom: true, buff: true, now }), false, 'подсветка и баффы старее нажатия');
  assert.equal(L.toggleOn({ mem, dom: true, now, snap: { fresh: true, entry: { on: true } } }), true, 'свежий снимок игры важнее');
  assert.deepEqual(L.toggleDecide({ mem, dom: false, now }), { st: false, hold: false }, 'снятая — не «туда-сюда»');
  assert.equal(L.toggleFlap(mem, now), 0);
  assert.equal(L.toggleFlap({ on: true, t: now - 1000, flap: 0 }, now), 1, 'прежнее правило для включений подряд');
  // бот: снятие пишет off в память, включение — off: 0
  assert.match(bot, /if \(plan\.off\) \{ tglSet\(key, \{ on: false, off: 1, t: t0, flap: 0 \}\); log\(`\$\{s\.name\}: стойку снял — /);
  assert.match(bot, /else \{ tglSet\(key, \{ on: true, off: 0, t: t0, flap: L\.toggleFlap\(tglMem\(\)\[key\], t0\) \}\); log\(`\$\{s\.name\}: стойку включил`\); \}/);
});

test('отдых по MP: только маг и только когда банок нет совсем; до 50 %; реген не идёт 90 с — бьёмся как есть, 10 мин не отдыхаем', () => {
  const me = p => ({ hp: 20000, maxHp: 20000, mp: 6203 * p / 100, maxMp: 6203 });
  assert.equal(L.mpRest(null, me(10), { mage: true, pots: null, now }).rest, false, 'сумку не видели');
  assert.equal(L.mpRest(null, me(10), { mage: true, pots: 5, now }).rest, false, 'банки есть');
  assert.equal(L.mpRest(null, me(10), { mage: false, pots: 0, now }).rest, false, 'не маг');
  assert.equal(L.mpRest(null, me(20), { mage: true, pots: 0, now }).rest, false, 'MP 20 % — ещё бьёмся');
  let r = L.mpRest(null, me(10), { mage: true, pots: 0, now });
  assert.equal(r.rest, true); assert.match(r.why, /банок MP нет, MP 10 % — отдыхаю до 50 %/);
  r = L.mpRest(r.st, me(30), { mage: true, pots: 0, now: now + 60000 });
  assert.equal(r.rest, true, 'начатый отдых держим до 50 %');
  r = L.mpRest(r.st, me(50), { mage: true, pots: 0, now: now + 120000 });
  assert.equal(r.rest, false); assert.equal(r.st.t0, 0);
  // MP не растёт (реген вне боя не идёт)
  let s = L.mpRest(null, me(10), { mage: true, pots: 0, now }).st;
  r = L.mpRest(s, me(10), { mage: true, pots: 0, now: now + L.REST_STALL + 1000 });
  assert.equal(r.rest, false); assert.equal(r.stall, true);
  assert.equal(L.mpRest(r.st, me(5), { mage: true, pots: 0, now: now + L.REST_STALL + 60000 }).rest, false, '10 мин после бесполезного отдыха');
  assert.equal(L.mpRest(r.st, me(5), { mage: true, pots: 0, now: now + L.REST_STALL + L.REST_OFF + 2000 }).rest, true);
  // купили банки посреди отдыха — сразу в бой
  s = L.mpRest(null, me(10), { mage: true, pots: 0, now }).st;
  assert.equal(L.mpRest(s, me(12), { mage: true, pots: 100, now: now + 5000 }).rest, false);
});

test('бот: банка с сумки на пустой слот, счёт банок, отдых перед боем и после победы, меню', () => {
  // пустой слот → «Розхідники» → банка по L.potPick; не чаще раза в 2 мин; в сумке 0 — не открываем окно
  assert.match(bot, /async function potSlotFix\(kind, g\)/);
  assert.match(bot, /if \(now - \(sess\.get\(tk, 0\) \|\| 0\) < 120000\) return false;/);
  assert.match(bot, /if \(!POTS \|\| now - POTS\.t > 600000 \|\| !\(POTS\[kind\] > 0\)\) return false;/);
  assert.match(bot, /\$\$\('\.l2-battle-hotbar-slot--empty'\)\.find\(shown\)/);
  assert.match(bot, /\$\('\.l2-battle-hotbar-tab\[data-tab-key="consumable"\]'\)/);
  assert.match(bot, /L\.potPick\(picks\.map\(b => b\.getAttribute\('title'\) \|\| ''\), kind\)/);
  assert.match(bot, /if \(cfg\.kind === 'mage' && !slots\.some\(s => s\.pot === 'mp' && \(s\.qty == null \|\| s\.qty > 0\)\) && await potSlotFix\('mp', g\)\) return;/);
  // банки в сумке — из ответа игры и своего GET; нет пустого слота — для хода банок нет
  assert.match(bot, /if \(ch\.pots && typeof ch\.pots === 'object'\) potsSeen\(ch\.pots\);/);
  assert.match(bot, /potsSeen\(L\.potsOf\(c\.inventory\.stacks\)\);/);
  assert.match(bot, /const mpPotsNow = \(\) => \(!POTS \|\| Date\.now\(\) - POTS\.t > 600000 \? null : Date\.now\(\) - potNoSlotT < 120000 \? 0 : POTS\.mp\);/);
  assert.match(bot, /notify\('mppots', 'L2wap Lite: банки MP кончились'/);
  // отдых — на карте и в списке Ashen (после отдыха по HP), а после победы — не в новый бой, а к списку
  assert.equal((bot.match(/if \(pct >= 30\) restT0 = 0;\n\s+if \(await mpRestGate\(\)\) return;/g) || []).length, 2);
  const av = bot.slice(bot.indexOf('async function afterVictory'), bot.indexOf('async function battleStep'));
  assert.ok(av.indexOf('mpRestCheck(meStats()).rest') > 0 && av.indexOf('mpRestCheck(meStats()).rest') < av.indexOf('inAshen() && aoeProf()'), 'отдых раньше следующего боя');
  assert.match(bot, /hp: num\(c\.hp\), maxHp: num\(c\.maxHp\), mp: num\(c\.mp\), maxMp: num\(c\.maxMp\) \};/);
  assert.match(bot, /status\(cfg\.kind === 'mage' && L\.mpShort\(slots, meStats\(\)\) \? `Бой: жду MP/);
  // меню
  assert.match(html, /<div id="magePots" class="dim"><\/div>/);
  assert.match(html, /Arcane Power \(M\.Atk \+30 %, но −25 HP\/с\)/);
  assert.match(pj, /\$\('magePots'\)\.textContent = pt/);
});

test('модель долгой охоты: банки из сумки, экономный режим, Arcane Power без смертей', () => {
  const run = p => M.run({ ...p, bot: 'new' }, L);
  // банки вдоволь: Arcane Power с банками HP прибавляет убийств; без банок HP — стойка снимается и снова включается, смертей нет
  const a1 = run({ ap: false }), a2 = run({ hpPots: 1e9 }), a4 = run({});
  assert.ok(a2.killsH > a1.killsH, `AP с банками HP: ${a2.killsH} > ${a1.killsH}`);
  assert.ok(a2.apUp >= 90);
  assert.equal(a4.deaths, 0); assert.ok(a4.apOff >= 1 && a4.apUp > 20 && a4.apUp < 90, `стойка циклами: ${a4.apUp} %`);
  // стопка на панели кончилась, в сумке малые — ставит их и продолжает; обычной атакой маг не бьёт нигде
  const b2 = run({ potPanel: 100, potBag: 500 });
  assert.ok(b2.fixes >= 1 && b2.mpPots > 100, `поставил стопку: ${b2.fixes}, банок ${b2.mpPots}`);
  for (const r of [a1, a2, a4, b2]) assert.equal(r.basic, 0);
  // банок нет совсем: убийства идут (экономно и с отдыхом), стойка не держится, смертей нет
  const c1 = run({ potPanel: 0 });
  assert.ok(c1.killsH > 100 && c1.basic === 0 && c1.apUp === 0 && c1.deaths === 0, JSON.stringify(c1));
  // моб бьёт, банок HP нет — не умираем до остановки Lite (3 смерти за 30 мин)
  const d1 = run({ mobDps: 30 });
  assert.equal(d1.stopMin, '-'); assert.equal(d1.deaths, 0);
});
