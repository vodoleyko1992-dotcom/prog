'use strict';
// 23.10 (лог 13:17, 23:15:58–23:17:11): тур РБ собрался к Fairy Queen Timiniel, а игрок в это время сам нажал «Телепорт» к Ancient
// Weird Drake. Игра держит один телепорт за раз — клик бота проглочен, оплата бота осталась «отправленной» без запроса, и после
// аварийного выхода от Drake (HP 6%) тур стоял на «исход телепорта не подтверждён» до ручного Стопа.
// 1) чужой старт телепорта РБ за последние 10 с — бот свою оплату не отправляет; 2) бесплатный перелёт без квитанции не держит тур вечно.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function raid({ price = 100 } = {}) {
  const text = price === 0 ? '(Безкоштовно · VIP)' : `(Аден ${price})`;
  const doc = require('./epic-harness.cjs').docOf(`<div id="rb-list"><div class="l2-rb-row"><span class="l2-rb-row__status l2-rb-row__status--alive">Жив</span><span class="l2-rb-row__price">${text}</span><button class="l2-rb-row__tp" data-spawn-id="boss">Телепорт</button></div></div>`);
  const recs = [];
  const env = { on: true, tabOwner: true, leaseEpoch: 1, autonomyMode: () => 'raid', cfg: { shopReserve: 0, shopMaxSpend: 1000000 },
    routeLocation: { pathname: '/rb-bosses.html', search: '?page=9' }, $q: s => doc.querySelector(s),
    rt: { char: 'hero', manualKickAt: 1, adenaSeen: { v: 1000000, t: Date.now() }, rbHunt: { step: 'go', id: 'boss', name: 'Fairy Queen Timiniel', price }, rbWant: null },
    setStatus() {}, rec: (...a) => recs.push(a.join(' ')), isMap: () => false };
  env.setRt = async p => { Object.assign(env.rt, p); return { ok: true }; };
  env.rtCommit = async () => true;
  const pbox = { console, Date }; vm.runInNewContext(read('modules/payments.js'), pbox);
  env.payments = pbox.L2V7Factories.payments(env);
  let fires = 0, start = null;
  env.raidTeleportStart = () => start;
  env.fire = () => { if (env.payments.blocked() && !env.payments.consumePermit()) return false; fires++; return true; };
  const box = { console, document: doc, URLSearchParams }; vm.runInNewContext(read('modules/raid.js'), box);
  const R = box.L2V7Factories.raid(env), button = doc.querySelector('.l2-rb-row__tp');
  const src = read('modules/raid.js'), a = src.indexOf('async function paymentReconcile('), b = src.indexOf('\nasync function rbGoStep()', a);
  const rbox = { env, raidList: () => [] }; vm.runInNewContext(src.slice(a, b) + '\nthis.reconcile=paymentReconcile;', rbox);
  return { env, recs, fires: () => fires, setStart: v => { start = v; }, reconcile: () => rbox.reconcile(),
    fire: () => R.rbTeleportFire(button, { rbHunt: { ...env.rt.rbHunt, step: 'arrive' }, rbWant: 'boss' }) };
}

test('ручной телепорт РБ только что стартовал — бот не готовит оплату и не кликает', async () => {
  const f = raid();
  f.setStart({ t: Date.now() - 2000, id: 'l2dop_rb_25234', paymentId: '' });
  assert.equal(await f.fire(), false);
  assert.equal(f.fires(), 0);
  assert.equal(f.env.payments.blocked(), false, 'ожидания оплаты нет');
  assert.equal(f.env.rt.rbHunt.step, 'go', 'шаг тура прежний');
  assert.ok(f.recs.some(r => /другой телепорт РБ/.test(r)));
});

test('игрок нажал «Телепорт», пока бот читал /character перед оплатой — неотправленная оплата отменяется', async () => {
  const f = raid();
  f.env.gameGet = async () => { f.setStart({ t: Date.now(), id: 'l2dop_rb_25234', paymentId: '' });
    return { ok: true, json: async () => ({ character: { name: 'hero', revision: 5, adena: '1000000', id: 'x' } }) }; };
  assert.equal(await f.fire(), false);
  assert.equal(f.fires(), 0);
  assert.equal(f.env.payments.blocked(), false, 'намерение снято, тур не стоит на «исход не подтверждён»');
  assert.equal(f.env.rt.rbHunt.step, 'go');
  assert.equal(f.env.rt.rbWant, null);
});

test('старый телепорт (больше 10 с назад) не мешает обычному перелёту', async () => {
  const f = raid();
  f.setStart({ t: Date.now() - 60000, id: 'other', paymentId: '' });
  assert.equal(await f.fire(), true);
  assert.equal(f.fires(), 1);
  assert.ok(f.env.payments.blocked());
});

test('бесплатный перелёт без квитанции и без цели на карте снимается через 15 с', async () => {
  const f = raid({ price: 0 });
  assert.equal(await f.fire(), true);
  assert.equal(f.env.payments.pending().quote.amount, 0);
  assert.equal(await f.reconcile(), false, 'первые 15 с ждём квитанцию');
  f.env.rt.actionPayments.pending.at = Date.now() - 16000;
  assert.equal(await f.reconcile(), true);
  assert.equal(f.env.payments.blocked(), false);
  assert.equal(f.env.rt.actionPayments.history[0].confirmation.kind, 'free-unresolved');
  assert.ok(f.recs.some(r => /бесплатный переход/.test(r)));
});

test('платный перелёт без доказательств по-прежнему ждёт сверки', async () => {
  const f = raid({ price: 100 });
  assert.equal(await f.fire(), true);
  f.env.rt.actionPayments.pending.at = Date.now() - 16000;
  assert.equal(await f.reconcile(), false);
  assert.ok(f.env.payments.blocked());
});
