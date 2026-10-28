'use strict';
// 20.76+ (ревизия 28.10, группа raid): три находки ревизии модуля raid.js.
// 1) rbHpNow брал rt.rb[id].hpAfter отхода без срока давности: после чужого убийства и респауна РБ прогноз боя считался от 25 % HP,
//    предел «долгий бой» (rbMaxKillMin) обычного тура не срабатывал до оплаты. Теперь hpAfter — только свежий (30 мин, как rbWound),
//    а смерть/воскрешение РБ по таймерам (rbtimer.save) стирает запись отхода, как epics.lifeResetPatch у эпиков.
// 2) rbGoStep передавал в rbTeleportFire цену задания rbGo (из rbList на момент выбора); при расхождении со строкой страницы
//    (VIP включился/кончился) оплата отменялась на каждой итерации без перелёта. Теперь задание и rbList получают свежую цену.
// 3) rbValueScore: подтверждённый бесплатный телепорт (price 0) считался как 100 000 аден.
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
function farmGo(goPrice, domPrice) {
  const recs = [], statuses = [], pay = { prepare: [], cancel: 0 };
  const m = mk({ hero: 80, cfg: { epicMode: false, rbHuntMode: false, rbMode: false, rbProbe: true, rbMaxKillMin: 20, rbMaxBelow: 12, rbMaxAbove: 12, rbRestHp: 95, rbRetreatHp: 20, stopHp: 25, shopAuto: false, shopReserve: 200000, shopMaxSpend: 2000000 },
    rt: { char: 'TestHero', classCur: { prof: 'x', slot: 0 }, rbListT: Date.now(), rbStats: { one: { ...stats } },
      rbList: { one: { name: 'Первый', lvl: 80, page: 1, alive: true, price: goPrice, unit: 'аден', t: Date.now() } }, rbDb: { one: { verdict: 'ok', kills: 3 } }, rbDps: 600000,
      rbGo: { id: 'one', name: 'Первый', lvl: 80, page: 1, price: goPrice, t: Date.now() }, farmRb: { id: 'one', name: 'Первый', t: Date.now() },
      adenaSeen: { v: 5000000, t: Date.now() } },
    meHp: () => ({ cur: 14917, max: 14917, pct: 100 }),
    env: { tabOwner: true, isBattle: () => false, epicOn: () => false,
      gameGet: async () => ({ ok: true, json: async () => ({ character: { name: 'TestHero', inBattle: false, adena: 5000000, revision: 7, id: 'c1' } }) }),
      hudBuffs: () => ({}), potModel: () => ({ pool: 600000, rate: 2000, n: 500, H: 1200, C: 1, est: false, items: [] }), waitFor: async fn => fn(), logLines: () => [], newLines: () => [], activeBuffs: () => [] } });
  m.env.rec = (...a) => recs.push(a.join(' | ')); m.env.setStatus = s => statuses.push(s);
  m.env.rtCommit = async () => true; { const o = m.env.setRt; m.env.setRt = async p => { await o(p); return { ok: true }; }; }
  m.env.payments = { blocked: () => false, pending: () => null, prepare: async spec => { pay.prepare.push(spec.quote.amount); return { id: 'p' + pay.prepare.length, ...spec }; }, matchesContext: () => true, sent: () => true, cancel: async () => { pay.cancel++; return true; } };
  m.loc.pathname = '/rb-bosses.html'; m.loc.search = '?page=1'; m.setDoc(docOf(page('one', 'Первый', domPrice)));
  return { ...m, recs, statuses, pay };
}
test('VIP кончился (задание 0, строка 100 000): задание и список получают новую цену, затем один телепорт по ней — без цикла отмен', async () => {
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
