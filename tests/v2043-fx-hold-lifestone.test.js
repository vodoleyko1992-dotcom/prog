'use strict';
// 20.43 (автономность, доводка 21.10): автоматическая пауза серии Life Stone (сбой чтения, цена, лимит, перезагрузка) оставляла удержание
// rt.autoLs.hold=true — loopGate держал главный цикл без срока и без уведомления (ни рыбалки, ни фарма, ни сторожа), хотя продолжить серию
// мог только игрок. Теперь такая пауза снимает удержание одной строкой журнала «… — серия на паузе, возвращаюсь к задачам; продолжение
// вручную». Удержание остаётся там, где его выбрал игрок («Пауза», в т. ч. нажатая во время шага), у подготовленной серии и у неизвестной
// попытки/закупки (pending — без сверки ничего не тратим).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const read = n => fs.readFileSync(__dirname + '/../' + n, 'utf8'), clone = x => JSON.parse(JSON.stringify(x));
const FREE = /серия на паузе, возвращаюсь к задачам; продолжение вручную/;
function harness({ ls = 5, gem = 5, limit = 3, targets = ['prominence'], outcome = 'tempest' } = {}) {
  let time = 100000, seq = 0, lose = false; const root = { Date: { now: () => time } }; vm.createContext(root);
  vm.runInContext(read('augment.js'), root); vm.runInContext(read('modules/lifestone.js'), root);
  const snap = { name: 'Hero', revision: 10, inventory: { eq: { l1: { itemId: 123, enchant: 7, clanWeaponUid: 'weapon-a' } }, stacks: [{ itemId: 10411, qty: ls }, { itemId: 2133, qty: gem }] } };
  const posts = [], recs = []; let fail = false, gate = null;
  const apply = id => { snap.revision++; snap.inventory.stacks.forEach(r => r.qty--); snap.inventory.eq.l1.augmentation = { uid: 'uid-' + (++seq), grade: 'A', outcomeId: id }; };
  const env = { cfg: { autoLs: { targets, maxAttempts: limit } }, rt: { char: 'Hero' }, on: true, tabOwner: true, canRun: () => true, canPrepare: () => true, context: () => 'context',
    rec: (...a) => recs.push(a.slice(2).join(' ')), setStatus: () => {},
    setRt: async p => { Object.assign(env.rt, clone(p)); return { ok: true }; },
    gameGet: async p => { if (gate) await gate; if (fail && p === '/character') return { ok: false, status: 502, json: async () => ({}) };
      return { ok: true, json: async () => clone(p === '/character' ? { character: snap } : { itemGradeHints: { 123: 'A' } }) }; },
    gamePost: async (p, body, ms, permit) => { assert.equal(m.consumePermit(permit, body), true); posts.push(clone(body)); apply(outcome);
      if (lose) { lose = false; throw Error('lost'); } return { ok: true, status: 200, json: async () => ({ outcomeId: outcome, gemstonesSpent: 1 }) }; } };
  const m = root.L2V7Factories.lifestone(env);
  return { m, env, snap, posts, recs, root, lose: () => lose = true, fail: v => fail = v, gate: p => gate = p, advance: (ms = 16000) => time += ms,
    run: async () => { await m.command('prepare'); await m.command('resume'); }, get s() { return env.rt.autoLs; } };
}

test('сбой чтения оружия во время серии: пауза снимает удержание, строка журнала, главный цикл свободен, трат нет', async () => {
  const h = harness(); await h.run(); assert.equal(h.s.hold, true); h.fail(true); h.recs.length = 0;
  assert.equal(await h.m.step(), true);
  assert.equal(h.s.status, 'paused'); assert.equal(h.s.reason, 'Не удалось прочитать актуальное оружие и материалы');
  assert.equal(h.s.hold, false, 'автоматическая пауза не держит бота'); assert.equal(h.s.pending, null);
  assert.equal(h.recs.filter(x => FREE.test(x)).length, 1, h.recs.join('\n'));
  for (let i = 0; i < 3; i++) { h.advance(); assert.equal(await h.m.step(), false, 'loopGate больше не замирает'); }
  assert.equal(h.posts.length, 0); assert.equal(h.recs.filter(x => FREE.test(x)).length, 1, 'строка одна');
  // продолжить может только игрок — и после этого серия снова держит цикл и тратит по правилам
  h.fail(false); await h.m.command('resume'); assert.equal(h.s.status, 'running'); assert.equal(h.s.hold, true);
  await h.m.step(); assert.equal(h.posts.length, 1);
});

test('«Пауза» игрока, нажатая во время шага: удержание остаётся (userHold), как у обычной «Паузы»', async () => {
  const h = harness(); await h.run(); let open; h.gate(new Promise(r => open = r));
  const st = h.m.step(); await new Promise(r => setImmediate(r));
  assert.equal(await h.m.command('pause'), true); h.gate(null); open(); await st;
  await h.m.step();   // следующий шаг ставит паузу: она — игрока
  assert.equal(h.s.status, 'paused'); assert.equal(h.s.hold, true); assert.equal(h.s.userHold, true);
  assert.ok(!h.recs.some(x => FREE.test(x)));
  assert.equal(await h.m.step(), true, 'удержание игрока держит цикл'); assert.equal(h.posts.length, 0);
});

test('неизвестная попытка (связь прервана): удержание и pending остаются — без сверки ничего не тратим', async () => {
  const h = harness(); await h.run(); h.lose(); await h.m.step();
  assert.equal(h.s.status, 'paused'); assert.ok(h.s.pending); assert.equal(h.s.hold, true); assert.ok(!h.recs.some(x => FREE.test(x)));
  assert.equal(await h.m.step(), true); assert.equal(h.posts.length, 1);
});

test('подготовленная серия и пауза игрока прежней версии держат цикл; пауза сбоя прежней версии (hold без userHold) отпускается', async () => {
  const p = harness(); await p.m.command('prepare'); assert.equal(p.s.hold, true); assert.equal(await p.m.step(), true, 'ждёт «Продолжить»'); assert.equal(p.s.hold, true);
  const u = harness(); await u.run(); u.env.rt.autoLs = { ...u.s, status: 'paused', reason: 'Пауза игрока', hold: true };
  assert.equal(await u.m.step(), true); assert.equal(u.s.hold, true);
  const o = harness(); await o.run(); o.env.rt.autoLs = { ...o.s, status: 'paused', reason: 'Телепорт к Маммону дороже разрешённого лимита', hold: true }; o.recs.length = 0;
  assert.equal(await o.m.step(), true); assert.equal(o.s.hold, false); assert.equal(o.recs.filter(x => FREE.test(x)).length, 1);
  assert.match(o.recs[0], /^Телепорт к Маммону дороже разрешённого лимита — серия на паузе/);
  assert.equal(await o.m.step(), false);
});

test('ядро: шлюз цикла по-прежнему держит только hold/pending ЛС', () => {
  const content = read('content.js');
  assert.match(content, /lifestoneCommandBusy \|\| rt\.autoLs\?\.hold \|\| rt\.autoLs\?\.pending/);
});
