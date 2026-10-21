'use strict';
// 20.43 (автономность, доводка 21.10, ревью): подготовка кота после Старта (warlock.startPrepare) при сбое чтения /character.
// Было: failLater() на Старте сразу возвращал true без паузы, а задача rt.petPrep ещё не записана (пишется после удачного чтения) — ветка
// loopGate со сном 0,3 с не срабатывала, loopStartPrep возвращал true без сна, и следующий круг сразу снова слал GET /character: с частотой
// ответов сервера (при быстрых 429 — 5–20 в секунду) все 2 мин этапа, на каждом Старте и после воскрешения. 40 вызовов при 429 = 40 GET.
// Удачное чтение в ожидании подтверждения/MP/панели тоже читало /character на каждом круге (≈3 раза в секунду). Теперь: сбой — пауза
// 1,5 → 3 → 6 с, ожидание — 1,5 с (подтверждение, панель) или 3 с (MP/откат); loopStartPrep после занятого шага спит, как loopGate.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), test = require('node:test'), assert = require('node:assert/strict');
const { fixture } = require('./warlock-fixture.cjs');
const content = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
const CAT = { kind: 'servitor', key: 'feline_king', summonSkillId: 1406, summonSkillLevel: 3, hp: 100, activeBuffs: [] };
function setup(o = {}) {
  const state = { fail: o.fail || null };
  const f = fixture({ cfg: { petFullAuto: false, petAuto: true, petBuffAuto: true, nPetBuffs: 'Summon Feline Queen' },
    char: { mp: 5000, l2Profession: 'arcana_lord', activeSummon: null, ...o.char }, rt: { classCur: { prof: 'arcana_lord', slot: 0 }, startPrep: { id: 1, phase: 'summon' }, ...o.rt },
    read: async (p, env, ch) => { if (p !== '/character' || !state.fail) return; if (state.fail === 'throw') throw Error('HTTP 429'); if (state.fail === 'battle') ch.inBattle = true; if (state.fail === 'other') ch.name = 'другой'; } });
  const e = f.env, fires = [], logs = [];
  let page = o.page || '/dungeon.html?dungeonId=x';
  e.leaseEpoch = 'owner'; e.canRun = () => true; e.canAct = () => true; e.startPrepWanted = () => true; e.raidWanted = () => false; e.classNote = () => {};
  e.setStatus = t => logs.push(t); e.rec = (...x) => logs.push(x.join(' '));
  const row = (id, name) => ({ action: 'l2_' + id, skillId: id, effectId: id === 1331 ? 4699 : id, name, mp: 10, ready: true, button: { id } });
  const panel = { summon: row(1406, 'Summon Feline King'), buffs: [row(1331, 'Summon Feline Queen')] };
  e.nativePanel = () => panel; e.nativePanelPath = () => page.split('?')[0]; e.nativeReturnPath = () => page; e.nativePanelOpen = async () => {};
  e.nativeNavigate = p => { page = p; }; e.nativeFire = b => { fires.push(b.id); return true; };
  const chars = () => f.gets.filter(p => p === '/character').length, prep = (x = { buffs: false }) => f.api().startPrepare(x);
  // главный цикл: занятый шаг кота спит 0,3 с (loopGate/loopStartPrep)
  const loop = async (ms, x) => { const out = []; for (let t = 0; t < ms; t += 300) { out.push(await prep(x)); f.tick(300); } return out; };
  return { ...f, e, fires, logs, panel, state, chars, prep, loop, page: () => page };
}

test('429 на Старте: 40 вызовов подряд — один GET /character, а не 40; подготовка ждёт (true), кликов нет', async () => {
  const f = setup({ fail: 'throw' });
  for (let i = 0; i < 40; i++) assert.equal(await f.prep(), true);
  assert.equal(f.chars(), 1, 'в паузе без новых GET'); assert.equal(f.e.rt.petPrep, undefined, 'задача ещё не записана — держит пауза warlock'); assert.deepEqual(f.fires, []);
});

for (const [kind, why] of [['throw', 'исключение чтения (429/5xx/HTML)'], ['battle', 'снимок «в бою»'], ['other', 'снимок другого героя']]) {
  test(`Старт, ${why}: за 10 с не больше 5 GET (1,5 → 3 → 6 с), за 2 мин — не больше 25`, async () => {
    const f = setup({ fail: kind });
    await f.loop(10000); assert.ok(f.chars() <= 5, `за 10 с ${f.chars()} чтений (было ≈34)`);
    const res = await f.loop(110000); assert.ok(f.chars() <= 25, `за 2 мин ${f.chars()} чтений (было ≈400)`);
    assert.ok(res.every(x => x === true)); assert.deepEqual(f.fires, []);
  });
}

test('удачное чтение снимает паузу и сбрасывает рост: призыв идёт, новый сбой — снова через 1,5 с', async () => {
  const f = setup({ fail: 'throw' });
  await f.loop(20000); const n0 = f.chars();
  f.state.fail = null; await f.loop(7000);
  assert.ok(f.chars() > n0); assert.equal(f.page(), '/skill-panel.html', 'после восстановления — родная панель'); assert.deepEqual(f.fires, [1406]);
  f.state.fail = 'throw'; f.tick(5000); f.ch.revision++;
  const g0 = f.chars(); await f.prep(); assert.equal(f.chars(), g0 + 1);
  await f.loop(1200); assert.equal(f.chars(), g0 + 1, 'внутри 1,5 с не читает');
  await f.loop(600); assert.equal(f.chars(), g0 + 2, 'через 1,5 с — следующее чтение');
});

test('новое поколение подготовки (новый Старт, воскрешение) читает сразу, несмотря на паузу прошлого', async () => {
  const f = setup({ fail: 'throw' });
  await f.loop(5000); const n = f.chars();
  f.e.rt.startPrep = { id: 2, phase: 'summon' }; await f.prep(); assert.equal(f.chars(), n + 1);
});

test('срок 2 мин сохранённой задачи действует и в паузе сбоя: задача Старта снимается, кот — в бою', async () => {
  const f = setup({ page: '/skill-panel.html' });
  await f.prep(); assert.deepEqual(f.fires, [1406]); assert.ok(f.e.rt.petPrep?.pending);
  f.state.fail = 'throw'; await f.loop(30000);
  f.tick(100000); assert.equal(await f.prep(), false); assert.equal(f.e.rt.petPrep, null);
  assert.ok(f.logs.some(x => /не уложилась в 2 мин/.test(x))); assert.equal(f.api().startReady('pet'), true);
});

test('ожидание подтверждения призыва на Старте: /character раз в 1,5 с (первые 15 с), затем раз в 3 с; повтор после 15 с прежний', async () => {
  const f = setup({ page: '/skill-panel.html' });
  await f.prep(); assert.deepEqual(f.fires, [1406]);
  const g0 = f.chars(); await f.loop(15000);
  assert.ok(f.chars() - g0 <= 11, `за 15 с ожидания ${f.chars() - g0} чтений (было 50)`);
  f.ch.revision++; await f.loop(4000);
  assert.ok(f.e.rt.petPrep?.retries === 1 || f.fires.length === 2, 'после 15 с без подтверждения — прежний повтор (1/2)');
  assert.ok(f.logs.some(x => /не подтверждён сервером — повторю \(1\/2\)/.test(x)));
  // подтверждение приходит — подготовка завершается без лишнего ожидания
  f.ch.revision++; f.ch.activeSummon = { ...CAT }; await f.loop(3000);
  assert.equal(f.e.rt.petPrep, null); assert.equal(f.api().startReady('summon'), true);
});

test('MP на Старте: ожидание читает раз в 3 с, а не на каждом круге', async () => {
  const f = setup({ page: '/skill-panel.html', char: { mp: 1 } });
  await f.loop(9000);
  assert.ok(f.chars() <= 4, `за 9 с ${f.chars()} чтений (было 30)`); assert.deepEqual(f.fires, []);
  f.ch.mp = 5000; f.ch.revision++; await f.loop(3300); assert.deepEqual(f.fires, [1406], 'MP появилось — призыв');
});

test('панель навыков не открылась: ожидание 10 с с чтением раз в 1,5 с, затем задача идёт', async () => {
  const f = setup({ page: '/skill-panel.html' }); f.panel.incomplete = true; f.panel.hotbar = false; f.panel.summon = null;
  const res = await f.loop(12000);
  assert.ok(f.chars() <= 9, `${f.chars()} чтений`); assert.equal(res.at(-1), false); assert.equal(f.e.rt.petPrep, null);
  assert.ok(f.logs.some(x => /панель навыков кота не открылась/.test(x)));
});

test('тур РБ не изменился: его пауза отдельная, Старт её не сбрасывает', async () => {
  const f = setup({ fail: 'throw' }); f.e.raidWanted = () => true;
  await f.api().raidPrepare(); const n = f.chars();
  await f.api().raidPrepare(); assert.equal(f.chars(), n, 'пауза тура действует');
});

test('content.js: loopStartPrep после занятого шага кота спит 0,3 с, как loopGate', async () => {
  const block = content.slice(content.indexOf('const START_PREP_MS'), content.indexOf('// Сторож баффов, обслуживание рыбы'));
  for (const phase of ['summon', 'pet']) {
    let now = 1792000000000; const sleeps = [];
    const sb = { console, Date: class extends Date { static now() { return now; } }, Object, JSON,
      cfg: { autoTasks: ['cat'], petAuto: true }, rt: { char: 'hero', classCur: { prof: 'arcana_lord', slot: 0 }, dailyStart: 1,
        startPrep: { char: 'hero', classKey: '0:arcana_lord', start: 1, task: 'cat', phase, t: now, id: 1 } }, on: true, tabOwner: true, location: { pathname: '/map.html' },
      L2EngineCore: { selectedTask: () => 'cat', taskAllowed: (c, k) => (c.autoTasks || []).includes(k) }, autonomyMode: () => 'cat',
      L2V7Modules: { warlock: { startPrepare: async () => true, startReady: () => false, step: async () => false }, payments: { blocked: () => false } },
      loopStale: () => false, isBattle: () => false, fishNow: () => false, tvtSoon: () => false,
      setRt: async p => { Object.assign(sb.rt, p); return { ok: true }; }, rtCommit: async () => true, rec: () => {}, setStatus: () => {}, townBuffStart: async () => false,
      sleep: async ms => { sleeps.push(ms); now += ms; } };
    vm.createContext(sb); vm.runInContext(block + ';this.loopStartPrep=loopStartPrep;', sb);
    assert.equal(await sb.loopStartPrep(), true); assert.deepEqual(sleeps, [300], phase);
  }
});
