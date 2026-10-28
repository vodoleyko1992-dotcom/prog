'use strict';
// 20.76+ (ревизия 28.10, группа raid): три находки ревизии модуля raid.js.
// 1) rbHpNow брал rt.rb[id].hpAfter отхода без срока давности: после чужого убийства и респауна РБ прогноз боя считался от 25 % HP,
//    предел «долгий бой» (rbMaxKillMin) обычного тура не срабатывал до оплаты. Теперь hpAfter — только свежий (30 мин, как rbWound),
//    а смерть/воскрешение РБ по таймерам (rbtimer.save) стирает запись отхода, как epics.lifeResetPatch у эпиков.
// 2) rbGoStep передавал в rbTeleportFire цену задания rbGo (из rbList на момент выбора); при расхождении со строкой страницы
//    (VIP включился/кончился) оплата отменялась на каждой итерации без перелёта. Теперь задание и rbList получают свежую цену.
// 3) rbValueScore: подтверждённый бесплатный телепорт (price 0) считался как 100 000 аден.
// Ревью тех же правок (28.10): 2б — rbGoStep сам перечитывает несвежий кошелёк (иначе платный телепорт фарма к РБ не срабатывал вообще:
// prepare/cancel до конца 90 с), нехватка адены снимает задание с отсрочкой 10 мин; 1в — hpAfter живёт, пока это та же «жизнь» РБ
// (минимальный респ 8 ч, таймеры), а не 30 мин; 1г — rbRetreat и combat (реген/«отхиливается быстрее») берут запись только этой жизни.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// ---------- 1. rbHpNow: свежесть hpAfter ----------
const prefix = read('tests/v1027-raid-incoming-probe.test.js').split("test('unknown incoming")[0];
const fixture = vm.runInNewContext(prefix + ';fixture', { require, __dirname, console });
const HP = 2123774;
// фикстура v2014-rb-tour-slow-cap: свой замер DPS даёт бой ≈40 мин при пределе 30 мин
function live(min, dps) {
  const f = fixture(); Object.assign(f.env.cfg, { rbHuntMode: true, rbMaxBelow: 12, rbMaxAbove: 12, rbProbe: false, rbMaxKillMin: min, rbValueTour: true });
  Object.assign(f.rt.rbList.boss, { alive: true, price: 100, unit: 'аден', t: f.now() }); f.env.RB_WIN = 15; f.env.isMap = () => false;
  const ctx = f.env.warlock.raidContext(); f.rt.rbDb.boss = { dps, dpsContext: ctx.key, dpsLvl: 78 }; return f;
}
test('устаревший hpAfter отхода (3 суток) не занижает HP РБ — предел долгого боя тура срабатывает до оплаты', () => {
  const f = live(30, HP / (40 * 60));
  f.rt.rb = { boss: { name: 'boss', max: HP, hpAfter: Math.round(HP * .25), chip: 1000, attempts: 1, t: f.now() - 3 * 86400000 } };
  assert.equal(f.R.rbHpNow('boss', HP), HP, 'старый hpAfter не про эту жизнь РБ');
  const c = f.R.rbEntryDecision('boss', f.rt.rbList.boss);
  assert.equal(c.ok, false, c.why); assert.equal(c.kind, 'slow'); assert.match(c.why, /долгий бой/);
});
test('свежий hpAfter (5 мин) по-прежнему учитывается: недобитый РБ укладывается в предел', () => {
  const f = live(30, HP / (40 * 60)), cur = Math.round(HP * .25);
  f.rt.rb = { boss: { name: 'boss', max: HP, hpAfter: cur, chip: 1000, attempts: 1, t: f.now() - 5 * 60000 } };
  assert.equal(f.R.rbHpNow('boss', HP), cur);
  const c = f.R.rbEntryDecision('boss', f.rt.rbList.boss);
  assert.equal(c.ok, true, c.why); assert.equal(c.kind, 'live'); assert.match(c.why, new RegExp(`РБ HP ${cur}`));
});
test('hpAfter без времени записи (старый формат) не применяется; свежий rbWound — как раньше', () => {
  const f = live(30, HP / (40 * 60));
  f.rt.rb = { boss: { hpAfter: 1000 } };
  assert.equal(f.R.rbHpNow('boss', HP), HP);
  f.rt.rbWound = { boss: { cur: 5000, max: HP, t: f.now() - 60000 } };
  assert.equal(f.R.rbHpNow('boss', HP), 5000);
  f.rt.rbWound.boss.t = f.now() - 31 * 60000;
  assert.equal(f.R.rbHpNow('boss', HP), HP);
});

// ---------- 1б. rbtimer: смерть/воскрешение стирают запись отхода rt.rb[id] ----------
function timer(rt) {
  const patches = [], ctx = { Date, Math, Object, String, Number, Array, Set, JSON, console, sessionStorage: { getItem: () => null, setItem() {} } };
  ctx.globalThis = ctx; vm.runInNewContext(read('modules/rbtimer.js'), ctx);
  const env = { rt, cfg: {}, RB_WIN: 15, heroLevel: () => 70, sleep: () => Promise.resolve(), rec() {}, setRt: p => { patches.push(Object.keys(p)); Object.assign(env.rt, p); return Promise.resolve(); } };
  return { T: ctx.L2V7Factories.rbtimer(env), env, patches };
}
const A = 'l2dop_rb_25001', B = 'l2dop_rb_25002';
test('РБ убит другими (список: был жив → мёртв) — HP прошлого отхода стирается, чужие записи сохраняются', async () => {
  const now = Date.now(), m = timer({ rbTimer: { b: { [A]: { n: 'A', l: 70, al: true, ch: now - 3600000, pv: 0, ls: now - 600000 }, [B]: { n: 'B', l: 70, al: true, ch: now - 3600000, pv: 0, ls: now - 600000 } } },
    rb: { [A]: { hpAfter: 100, max: 1000, chip: 50, attempts: 2, t: now - 3600000 }, [B]: { hpAfter: 200, max: 1000, chip: 50, attempts: 1, t: now - 60000 } } });
  const ev = await m.T.domNote({ [A]: { name: 'A', lvl: 70, alive: false }, [B]: { name: 'B', lvl: 70, alive: true } });
  assert.equal(ev.length, 1); assert.equal(ev[0].kind, 'dead');
  assert.equal(m.env.rt.rb[A], undefined, 'запись отхода от прошлой жизни стёрта');
  assert.equal(m.env.rt.rb[B].hpAfter, 200, 'живой без смены жизни — запись не тронута');
});
test('РБ воскрес (список: был мёртв → жив) — HP прошлого отхода стирается', async () => {
  const now = Date.now(), m = timer({ rbTimer: { b: { [A]: { n: 'A', l: 70, al: false, ch: now - 9 * 3600000, pv: now - 10 * 3600000, dl: now - 10 * 3600000, dh: now - 9 * 3600000, ls: now - 600000 } } },
    rb: { [A]: { hpAfter: 100, max: 1000, chip: 50, attempts: 3, t: now - 10 * 3600000 } } });
  const ev = await m.T.domNote({ [A]: { name: 'A', lvl: 70, alive: true } });
  assert.equal(ev[0].kind, 'alive'); assert.equal(m.env.rt.rb[A], undefined);
});
test('без смены жизни список не пишет rt.rb (лишних записей памяти нет)', async () => {
  const now = Date.now(), rb = { [A]: { hpAfter: 100, max: 1000, chip: 50, attempts: 1, t: now - 60000 } };
  const m = timer({ rbTimer: { b: { [A]: { n: 'A', l: 70, al: true, ch: now - 3600000, pv: 0, ls: now - 600000 } } }, rb });
  await m.T.domNote({ [A]: { name: 'A', lvl: 70, alive: true } });
  assert.equal(m.patches.length, 1); assert.ok(!m.patches[0].includes('rb'), JSON.stringify(m.patches)); assert.equal(m.env.rt.rb, rb);
});

// ---------- 2. rbGoStep: свежая цена строки вместо цены задания ----------
const { mk, docOf } = require('./epic-harness.cjs');
const stats = { hp: 5500000, patk: 5000, matk: 2500, pdef: 9000, mdef: 10000, src: 'api' };
const page = (id, name, price) => `<div id="rb-list"><div class="l2-rb-row"><span class="l2-rb-row__label">${name}</span><span class="l2-rb-row__level">80</span><span class="l2-rb-row__status l2-rb-row__status--alive">Живой</span><span class="l2-rb-row__price">${price}</span><button class="l2-rb-row__tp" data-spawn-id="${id}">Телепорт</button></div></div>`;
// 20.76+ (ревью ревизии 28.10): o.walletAge — возраст rt.adenaSeen (мс; по умолчанию свежий), o.adena — адена в GET /character,
// o.getFail — GET /character не отвечает, o.paidAt — rt.rbPaidAt. gets — число GET /character (сверка кошелька + before0 оплаты)
function farmGo(goPrice, domPrice, o = {}) {
  const recs = [], statuses = [], pay = { prepare: [], cancel: 0 }, gets = [];
  const m = mk({ hero: 80, cfg: { epicMode: false, rbHuntMode: false, rbMode: false, rbProbe: true, rbMaxKillMin: 20, rbMaxBelow: 12, rbMaxAbove: 12, rbRestHp: 95, rbRetreatHp: 20, stopHp: 25, shopAuto: false, shopReserve: 200000, shopMaxSpend: 2000000 },
    rt: { char: 'TestHero', classCur: { prof: 'x', slot: 0 }, rbListT: Date.now(), rbStats: { one: { ...stats } },
      rbList: { one: { name: 'Первый', lvl: 80, page: 1, alive: true, price: goPrice, unit: 'аден', t: Date.now() } }, rbDb: { one: { verdict: 'ok', kills: 3 } }, rbDps: 600000,
      rbGo: { id: 'one', name: 'Первый', lvl: 80, page: 1, price: goPrice, t: Date.now() }, farmRb: { id: 'one', name: 'Первый', t: Date.now() },
      adenaSeen: { v: 5000000, t: Date.now() - (o.walletAge || 0) }, ...(o.paidAt ? { rbPaidAt: o.paidAt } : {}) },
    meHp: () => ({ cur: 14917, max: 14917, pct: 100 }),
    env: { tabOwner: true, isBattle: () => false, epicOn: () => false,
      gameGet: async u => { gets.push(u); if (o.getFail) throw Error('net'); return { ok: true, json: async () => ({ character: { name: 'TestHero', inBattle: false, adena: o.adena ?? 5000000, revision: 7, id: 'c1' } }) }; },
      hudBuffs: () => ({}), potModel: () => ({ pool: 600000, rate: 2000, n: 500, H: 1200, C: 1, est: false, items: [] }), waitFor: async fn => fn(), logLines: () => [], newLines: () => [], activeBuffs: () => [] } });
  m.env.rec = (...a) => recs.push(a.join(' | ')); m.env.setStatus = s => statuses.push(s);
  m.env.rtCommit = async () => true; { const o = m.env.setRt; m.env.setRt = async p => { await o(p); return { ok: true }; }; }
  m.env.payments = { blocked: () => false, pending: () => null, prepare: async spec => { pay.prepare.push(spec.quote.amount); return { id: 'p' + pay.prepare.length, ...spec }; }, matchesContext: () => true, sent: () => true, cancel: async () => { pay.cancel++; return true; } };
  m.loc.pathname = '/rb-bosses.html'; m.loc.search = '?page=1'; m.setDoc(docOf(page('one', 'Первый', domPrice)));
  return { ...m, recs, statuses, pay, gets };
}
test('VIP кончился (задание 0, строка 100 000), кошелёк свежий: задание и список получают новую цену, затем один телепорт по ней — без цикла отмен', async () => {
  const m = farmGo(0, '(Аден 100000)');
  await m.R.rbGoStep();
  assert.equal(m.fires.length, 0); assert.equal(m.pay.prepare.length, 0, 'старую цену не готовим к оплате');
  assert.equal(m.env.rt.rbGo.price, 100000); assert.equal(m.env.rt.rbList.one.price, 100000);
  assert.ok(m.recs.some(r => /цена телепорта изменилась/.test(r)), m.recs.join('\n'));
  await m.R.rbGoStep();
  assert.equal(m.fires.length, 1); assert.deepEqual(m.pay.prepare, [100000]); assert.equal(m.pay.cancel, 0);
});
test('VIP включился (задание 100 000, строка «Бесплатно»): телепорт за 0 без отмен', async () => {
  const m = farmGo(100000, 'Бесплатно');
  for (let i = 0; i < 3 && !m.fires.length; i++) await m.R.rbGoStep();
  assert.equal(m.fires.length, 1); assert.deepEqual(m.pay.prepare, [0]); assert.equal(m.pay.cancel, 0);
});
test('цена совпадает — телепорт с первого шага, как раньше', async () => {
  const m = farmGo(100000, '(Аден 100000)');
  await m.R.rbGoStep();
  assert.equal(m.fires.length, 1); assert.deepEqual(m.pay.prepare, [100000]); assert.equal(m.pay.cancel, 0);
  assert.ok(!m.recs.some(r => /цена телепорта изменилась/.test(r)));
});
test('цена изменилась во время паузы перед кликом — оплата по-прежнему отменяется, следующий шаг идёт по новой цене', async () => {
  const m = farmGo(100000, '(Аден 100000)'); let flipped = false;
  m.env.pause = async () => { if (!flipped) { flipped = true; m.setDoc(docOf(page('one', 'Первый', '(Аден 150000)'))); } };
  await m.R.rbGoStep();
  assert.equal(m.fires.length, 0); assert.equal(m.pay.cancel, 1); assert.equal(m.env.rt.rbGo.price, 100000, 'задание сохранено откатом');
  await m.R.rbGoStep(); assert.equal(m.env.rt.rbGo.price, 150000);
  await m.R.rbGoStep(); assert.equal(m.fires.length, 1); assert.deepEqual(m.pay.prepare, [100000, 150000]);
});

// ---------- 3. rbValueScore: бесплатный телепорт ----------
function valueFix() {
  const env = { cfg: { rbProbe: false, rbMaxKillMin: 30, rbValueTour: true },
    rt: { rbDps: 3000, rbDb: { boss: { dps: 3000, sp: 0, fightS: 600, fightContext: null, adenaPerKill: 40000, expPerKill: 200000 } }, rbStats: { boss: { hp: 1800000 } }, rbList: { boss: { lvl: 40, price: 0, unit: 'аден' } } },
    heroLvl: () => 45, meHp: () => ({ cur: 9000, max: 10000, pct: 90 }), potModel: () => null,
    fmtT: x => String(x), fmtK: x => String(x), rec: () => {}, logLines: () => [], newLines: () => [], activeBuffs: () => [], epicOn: () => false, epicById: () => null, setRt: async p => Object.assign(env.rt, p) };
  const sb = { console, Math, Number, Date }; sb.globalThis = sb; vm.runInNewContext(read('modules/raid.js'), sb);
  return { env, R: sb.L2V7Factories.raid(env) };
}
test('подтверждённый бесплатный телепорт (0) оценивается не хуже платного, неизвестная цена — по-прежнему 100 000', () => {
  const { R } = valueFix();
  const free = R.rbValueScore('boss', { price: 0, unit: 'аден' }), one = R.rbValueScore('boss', { price: 1, unit: 'аден' }), unknown = R.rbValueScore('boss', {});
  assert.ok(free > 0, `бесплатный выгоден: ${free}`); assert.ok(free >= one, `${free} ≥ ${one}`);
  assert.equal(unknown, -Infinity, 'неизвестная цена — прежние 100 000 (здесь невыгодно)');
  assert.equal(R.rbValueScore('boss', { price: null }), -Infinity); assert.equal(R.rbValueScore('boss', { price: 100000, unit: 'аден' }), unknown);
});
// 20.76+ (ревью ревизии 28.10) — дополнение к v2077-audit-raid.test.js; дописывается в конец файла
// ---------- 2б (ревью 28.10). rbGoStep: несвежий кошелёк перечитывается, нехватка адены — без цикла prepare/cancel ----------
// Раньше: adenaSeen старше 60 с → current() в rbTeleportFire видел «нужен свежий запас адены» → prepare/cancel на каждой итерации, перелёта нет.
test('ревью: VIP кончился (0 → 100 000) при кошельке старше 60 с — свежая адена бесплатным GET, один телепорт, 0 отмен', async () => {
  const m = farmGo(0, '(Аден 100000)', { walletAge: 120000 });
  for (let i = 0; i < 4 && !m.fires.length; i++) await m.R.rbGoStep();
  assert.equal(m.fires.length, 1, m.statuses.join('\n')); assert.deepEqual(m.pay.prepare, [100000]); assert.equal(m.pay.cancel, 0);
  assert.ok(Date.now() - m.env.rt.adenaSeen.t < 5000, 'кошелёк перечитан');
  assert.ok(m.env.rt.rbPaidAt > 0, 'после платного перелёта кошелёк считается несвежим (rbPaidAt, как в туре)');
});
test('ревью: совпадающая платная цена 100 000 при кошельке старше 60 с — телепорт с первого шага, 0 отмен', async () => {
  const m = farmGo(100000, '(Аден 100000)', { walletAge: 120000 });
  await m.R.rbGoStep();
  assert.equal(m.fires.length, 1, m.statuses.join('\n')); assert.deepEqual(m.pay.prepare, [100000]); assert.equal(m.pay.cancel, 0);
  assert.equal(m.gets.length, 2, 'одна сверка кошелька + чтение героя перед оплатой');
});
test('ревью: кошелёк моложе 60 с, но старше прошлой оплаты (rbPaidAt) — перечитывается перед новой оплатой', async () => {
  const m = farmGo(100000, '(Аден 100000)', { walletAge: 10000, paidAt: Date.now() - 5000 });
  await m.R.rbGoStep();
  assert.equal(m.fires.length, 1); assert.equal(m.gets.length, 2); assert.ok(m.env.rt.adenaSeen.t > Date.now() - 5000);
});
test('ревью: свежий кошелёк — лишнего GET нет', async () => {
  const m = farmGo(100000, '(Аден 100000)');
  await m.R.rbGoStep();
  assert.equal(m.fires.length, 1); assert.equal(m.gets.length, 1, 'только чтение героя перед оплатой');
});
for (const [go, dom] of [[100000, '(Аден 100000)'], [0, '(Аден 100000)']]) test(`ревью: не хватает адены сверх резерва (задание ${go}, строка 100 000) — 0 кликов и 0 оплат, задание снято`, async () => {
  const m = farmGo(go, dom, { walletAge: 120000, adena: 250000 });   // 250 000 − 100 000 < резерв 200 000
  for (let i = 0; i < 4 && m.env.rt.rbGo; i++) await m.R.rbGoStep();
  assert.equal(m.fires.length, 0); assert.equal(m.pay.prepare.length, 0); assert.equal(m.pay.cancel, 0);
  assert.equal(m.env.rt.rbGo, null); assert.equal(m.env.rt.rbWant, null);
  assert.ok(m.recs.some(r => /не полетел к Первый: на телепорт 100000 не хватает адены сверх резерва 200000 — оплату не отправляю/.test(r)), m.recs.join('\n'));
  assert.equal(m.loc.href, '/map.html');
  // отсрочка 10 мин: выбор фарма (rbTeleportCheck → rbEntryDecision) не создаёт задание снова, когда кошелёк опять старше 60 с
  assert.equal(m.env.rt.rbSkip.one.funds, true); assert.ok(m.env.rt.rbSkip.one.until > Date.now() + 9 * 60000);
  m.env.rt.adenaSeen = { v: 250000, t: Date.now() - 120000 }; m.loc.pathname = '/map.html';
  assert.match(m.R.rbTeleportCheck('one', m.env.rt.rbList.one, true) || '', /отложен: на телепорт 100000 не хватает адены/);
  assert.equal(m.R.rbEntryDecision('one', m.env.rt.rbList.one).kind, 'funds');
  // более свежий кошелёк с достаточной аденой снимает отсрочку сразу (решает обычная проверка бюджета)
  m.env.rt.adenaSeen = { v: 5000000, t: Date.now() + 1 }; assert.notEqual(m.R.rbEntryDecision('one', m.env.rt.rbList.one).kind, 'funds');
  m.env.rt.adenaSeen = { v: 250000, t: Date.now() + 1 }; assert.equal(m.R.rbEntryDecision('one', m.env.rt.rbList.one).kind, 'funds');
});
test('ревью: сверка адены не ответила — задание ждёт, оплату не готовит; повтор GET не чаще паузы rbStateRead', async () => {
  const m = farmGo(100000, '(Аден 100000)', { walletAge: 120000, getFail: true });
  for (let i = 0; i < 3; i++) await m.R.rbGoStep();
  assert.equal(m.fires.length, 0); assert.equal(m.pay.prepare.length, 0); assert.equal(m.pay.cancel, 0);
  assert.equal(m.env.rt.rbGo.id, 'one', 'задание не снято — его срок 90 с ведёт ядро');
  assert.equal(m.gets.length, 1, 'после сбоя rbStateRead.nextAt держит паузу 60 с');
  assert.ok(m.statuses.some(x => /сверяю адену — оплату не готовлю/.test(x)), m.statuses.join('\n'));
});
test('ревью: бесплатный телепорт (VIP 0) кошелёк не читает и rbPaidAt не ставит', async () => {
  const m = farmGo(0, 'Бесплатно', { walletAge: 120000 });
  for (let i = 0; i < 3 && !m.fires.length; i++) await m.R.rbGoStep();
  assert.equal(m.fires.length, 1); assert.deepEqual(m.pay.prepare, [0]); assert.equal(m.env.rt.rbPaidAt, undefined);
});

// ---------- 1в (ревью 28.10). rbRetreatRec: запись отхода — пока это та же «жизнь» РБ, а не плоские 30 мин ----------
const cur25 = Math.round(HP * .25);
const retreat = (f, ageMs, extra = {}) => { f.rt.rb = { boss: { name: 'boss', max: HP, hpAfter: cur25, chip: 1000, attempts: 1, t: f.now() - ageMs, ...extra } }; };
test('ревью: hpAfter после 30-минутной паузы тура (45 мин, таймеры без смены жизни) ещё учитывается — недобитый РБ не уходит в «долгий бой»', () => {
  const f = live(30, HP / (40 * 60)); retreat(f, 45 * 60000);
  assert.equal(f.R.rbHpNow('boss', HP), cur25);
  const c = f.R.rbEntryDecision('boss', f.rt.rbList.boss); assert.equal(c.ok, true, c.why); assert.equal(c.kind, 'live');
});
test('ревью: таймеры видели РБ мёртвым после отхода (al:false, окно смерти позже записи) — hpAfter не применяется', () => {
  const f = live(30, HP / (40 * 60)); retreat(f, 45 * 60000);
  f.rt.rbTimer = { b: { boss: { al: false, dl: f.now() - 40 * 60000, dh: f.now() - 20 * 60000, ch: f.now() - 20 * 60000, ls: f.now() } } };
  assert.equal(f.R.rbHpNow('boss', HP), HP); assert.equal(f.R.rbRetreatRec('boss'), null);
  assert.equal(f.R.rbEntryDecision('boss', f.rt.rbList.boss).kind, 'slow');
});
test('ревью: импорт слежки — РБ видели мёртвым после отхода и снова живым (pv > t) — новая жизнь, hpAfter не применяется', () => {
  const f = live(30, HP / (40 * 60)); retreat(f, 2 * 3600000);
  f.rt.rbTimer = { b: { boss: { al: true, pv: f.now() - 3600000, ch: f.now() - 600000, ls: f.now() } } };
  assert.equal(f.R.rbHpNow('boss', HP), HP);
});
test('ревью: воскрес до нашего отхода (pv < t) — та же жизнь, hpAfter учитывается', () => {
  const f = live(30, HP / (40 * 60)); retreat(f, 2 * 3600000);
  f.rt.rbTimer = { b: { boss: { al: true, pv: f.now() - 3 * 3600000, ch: f.now() - 150 * 60000, ls: f.now() } } };
  assert.equal(f.R.rbHpNow('boss', HP), cur25);
});
test('ревью: запись старше минимального респа (8 ч × 0,95) не применяется; 7 ч — ещё да; меньший cfg.rbRespH сужает срок', () => {
  const f = live(30, HP / (40 * 60));
  retreat(f, 7.7 * 3600000); assert.equal(f.R.rbHpNow('boss', HP), HP);
  retreat(f, 7 * 3600000); assert.equal(f.R.rbHpNow('boss', HP), cur25);
  f.env.cfg.rbRespH = 4; assert.equal(f.R.rbHpNow('boss', HP), HP);
  retreat(f, 3.5 * 3600000); assert.equal(f.R.rbHpNow('boss', HP), cur25);
  f.env.cfg.rbRespH = 24; retreat(f, 9 * 3600000); assert.equal(f.R.rbHpNow('boss', HP), HP, 'больший rbRespH не растягивает срок сверх замеренных 8 ч');
});
test('ревью: известный реген РБ (rbDb.regen) прибавляется за время с отхода', () => {
  const f = live(30, HP / (40 * 60)); retreat(f, 1000 * 1000); f.rt.rbDb.boss.regen = 100;
  const v = f.R.rbHpNow('boss', HP); assert.ok(Math.abs(v - (cur25 + 100000)) <= 200, String(v));
});

// ---------- 1г (ревью 28.10). rbRetreat не продолжает запись прошлой жизни; combat не ставит ложное «отхиливается быстрее» ----------
test('ревью: rbRetreat при записи прошлой жизни начинает попытки заново', async () => {
  const m = mk({ hero: 80, cfg: { epicMode: false }, rt: { char: 'TestHero', rbDb: {}, rb: { one: { hpAfter: 100, max: 1000, chip: 900, attempts: 5, t: Date.now() - 9 * 3600000 } } },
    env: { rnd: () => 0, toOutskirts: async () => {} } });
  const ctx = { name: 'Первый', rb: { id: 'one', start: 1000 } };
  await m.R.rbRetreat(ctx, { cur: 600, max: 1000 }, 'отход');
  assert.equal(m.env.rt.rb.one.attempts, 1); assert.equal(m.env.rt.rb.one.chip, 400);
  await m.R.rbRetreat(ctx, { cur: 500, max: 1000 }, 'отход');
  assert.equal(m.env.rt.rb.one.attempts, 2, 'в той же жизни попытки копятся, как раньше');
});
function combatRegen(rt, cfg = {}) {
  const env = { rt, cfg: { ...cfg }, epicById: () => null };
  const sbR = { console, Math, Number, Date }; sbR.globalThis = sbR; vm.runInNewContext(read('modules/raid.js'), sbR);
  const R = sbR.L2V7Factories.raid(env); env.rbRetreatRec = R.rbRetreatRec; env.ordinaryLiveTour = R.ordinaryLiveTour;
  const box = { console, Date, Math, URLSearchParams, setTimeout, sessionStorage: { getItem: () => null, setItem() {} }, location: { pathname: '/', search: '' }, document: { querySelectorAll: () => [], querySelector: () => null } };
  box.globalThis = box; vm.createContext(box); vm.runInContext(read('modules/combat.js'), box);
  return box.L2V7Factories.combat(env);
}
test('ревью: возродившийся РБ (таймеры видели смерть после отхода), attempts 2, старый hpAfter — вердикт «отхиливается быстрее» не ставится, реген не учится', () => {
  const now = Date.now();
  const C = combatRegen({ rb: { one: { hpAfter: 100000, max: 1000000, chip: 50000, attempts: 2, t: now - 3 * 3600000 } },
    rbTimer: { b: { one: { al: true, pv: now - 3600000, ch: now - 600000, ls: now } } } });
  const r = C.rbRegenCheck('one', 1000000);
  assert.equal(r.no, false); assert.equal(r.prev, null); assert.equal(r.rate, undefined);
});
test('ревью: запись отхода старше минимального респа или без времени — вердикта нет', () => {
  const now = Date.now();
  assert.equal(combatRegen({ rb: { one: { hpAfter: 100000, max: 1000000, chip: 50000, attempts: 3, t: now - 9 * 3600000 } } }).rbRegenCheck('one', 1000000).no, false);
  assert.equal(combatRegen({ rb: { one: { hpAfter: 100000, max: 1000000, chip: 50000, attempts: 3 } } }).rbRegenCheck('one', 1000000).no, false);
});
test('ревью: та же жизнь (2 ч, таймеры без смены) — настоящий реген по-прежнему даёт вердикт и HP/с для rbDb.regen', () => {
  const now = Date.now();
  const r = combatRegen({ rb: { one: { hpAfter: 100000, max: 1000000, chip: 50000, attempts: 2, t: now - 7200 * 1000 } } }).rbRegenCheck('one', 1000000, now);
  assert.equal(r.no, true); assert.equal(r.healed, 900000); assert.equal(r.rate, 125);
  const tour = combatRegen({ rb: { one: { hpAfter: 100000, max: 1000000, chip: 50000, attempts: 2, t: now - 7200 * 1000 } } }, { rbHuntMode: true }).rbRegenCheck('one', 1000000, now);
  assert.equal(tour.no, false, 'обычный тур этот вердикт не ставит, как раньше'); assert.equal(tour.rate, 125);
});
// combat.battleOpen берёт запись отхода только через rbRegenCheck (env.rbRetreatRec), а ядро даёт combat этот геттер
test('ревью: combat.battleOpen не читает rt.rb напрямую; content.js даёт combat геттер rbRetreatRec', () => {
  const combat = read('modules/combat.js'), open = combat.slice(combat.indexOf('async function battleOpen()'), combat.indexOf('async function battleWin('));
  assert.doesNotMatch(open, /env\.rt\.rb\?\.\[/); assert.match(open, /const RG = rbRegenCheck\(ctx\.rb\.id, mob0\.cur\)/);
  assert.match(read('content.js'), /get rbRetreatRec\(\)\{return \(\.\.\.args\)=>L2V7Modules\.raid\.rbRetreatRec\(\.\.\.args\)\}/);
});
test('ревью: только что улетели к нему (rbGoTried < 2 мин) — «ищу на карте» без сверки кошелька и без снятия rbWant', async () => {
  const m = farmGo(100000, '(Аден 100000)', { walletAge: 120000, adena: 250000 });
  m.env.rt.rbGoTried = { one: Date.now() - 30000 };
  await m.R.rbGoStep();
  assert.equal(m.gets.length, 0); assert.equal(m.env.rt.rbWant, 'one'); assert.equal(m.env.rt.rbGo, null); assert.equal(m.env.rt.rbSkip, undefined);
  assert.ok(m.recs.some(r => /телепорт уже был — ищу на карте/.test(r)), m.recs.join('\n'));
});
