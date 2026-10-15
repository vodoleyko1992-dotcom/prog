'use strict';
// 15.10: воспроизводим автоматический цикл из логов 00:49/01:01 без запросов к игре.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { mk, docOf } = require('./epic-harness.cjs');
const stats = { hp: 5500000, patk: 5000, matk: 2500, pdef: 9000, mdef: 10000, src: 'api' };
const row = (name, lvl, page = 1) => ({ name, lvl, page, alive: true, price: 100000, unit: 'аден', t: Date.now() });
const pin = (id, name) => `<button class="l2-map-mob-pin l2-map-mob-pin--raid" data-spawn-id="${id}" title="${name} · ур. 80 · рейд-босс"></button>`;
const page = (id, name, price = '100000 аден') => `<div id="rb-list"><div class="l2-rb-row"><span class="l2-rb-row__label">${name}</span><span class="l2-rb-row__level">80</span><span class="l2-rb-row__status l2-rb-row__status--alive">Живой</span><span class="l2-rb-row__price">${price}</span><button class="l2-rb-row__tp" data-spawn-id="${id}">Телепорт</button></div></div>`;
function fixture(o = {}) {
 let fresh = o.fresh !== false, inBattle = false, reads = 0;
 const power = () => 'P', key = id => `${id}:P`;
 const m = mk({ hero: 80, net: o.net, cfg: { epicMode: false, rbHuntMode: true, rbMode: true, rbProbe: true, rbMaxKillMin: 20, rbMaxBelow: 12, rbMaxAbove: 12,
   rbRestHp: 95, rbRetreatHp: 20, stopHp: 25, shopAuto: false, shopReserve: 200000, shopMaxSpend: 2000000, ...o.cfg },
  rt: { char: 'TestHero', classCur: { prof: 'human_arcana_lord', slot: 0 }, rbHunt: { step: 'pick' }, rbListT: Date.now(), rbStats: { one: { ...stats }, two: { ...stats }, won: { ...stats } },
   rbList: { one: row('Первый', 80), two: row('Второй', 81), won: { ...row('Убитый', 80), alive: false } }, rbDb: {}, rbK: .109, rbDps: 6000, rbDpsContext: 'wrong',
   rbDpsSample: { id: 'won', powerKey: 'P', dps: 67000, target: { lvl: 80, pdef: 9000, mdef: 10000 }, t: Date.now() },
   adenaSeen: { v: 1000000, t: Date.now() }, ...o.rt }, meHp: () => ({ cur: 14917, max: 14917, pct: 100 }),
  env: { RB_WIN: 15, RB_RETRY_MS: 120000, RB_TRY_MS: 600000, tabOwner: true, isBattle: () => inBattle, epicOn: () => false,
   warlock: { raidContext: (id, st, opts) => ({ managed: true, key: fresh ? key(id) : null, powerKey: fresh ? power() : null, prepared: fresh, planned: !!opts?.preflight && !inBattle }), noteSnapshot: () => { fresh = true; } },
   gameGet: async () => { reads++; return { ok: true, json: async () => ({ character: { name: 'TestHero', inBattle: false, adena: 1000000 } }) }; },
   hudBuffs: () => ({}), potModel: () => ({ pool: 600000, rate: 2000, n: 500, H: 1200, C: 1, est: false, items: [] }),
   waitFor: async fn => fn(), logLines: () => [], newLines: () => [], activeBuffs: () => [], ...o.env } });
 let maps = 0; m.env.map = async () => { maps++; }; m.env.rbNote = m.R.rbNote;
 return { ...m, key, power, reads: () => reads, maps: () => maps, fresh: x => { fresh = x; }, battle: x => { inBattle = x; } };
}

test('после доказанной победы полный DPS ведёт к живому РБ автоматически, без фарма мобов', async () => {
 const m = fixture({ fresh: false }); await m.R.rbHuntStep();
 assert.equal(m.reads(), 1); assert.equal(m.env.rt.rbHunt.step, 'go'); assert.equal(m.env.rt.rbHunt.id, 'one'); assert.equal(m.maps(), 0);
 assert.equal(m.env.rt.rbTourView.ready[0].id, 'one'); assert.equal(m.R.rbDpsEvidence('one').source, 'transfer'); assert.ok(m.R.rbPreCheck('one', stats).t < 180);
});
test('подготовка выполняется до окончательного решения, даже когда все РБ сначала отсечены банками', async () => {
 const m = fixture({ cfg: { rbHuntMode: false } }); let supplied = false, buffs = 0; m.env.potModel = () => ({ pool: supplied ? 600000 : 0, rate: 2000, n: supplied ? 500 : 0 });
 m.env.townBuffStart = async () => { buffs++; supplied = true; return false; };
 assert.equal(m.R.rbTourPlan().ready.length, 0); await m.R.rbHuntStep(); assert.equal(buffs, 1); assert.equal(m.env.rt.rbHunt.step, 'go'); assert.equal(m.maps(), 0);
});
test('сбой сверки состава имеет backoff и явное следующее действие, без нового сканирования', async () => {
 const m = fixture({ fresh: false, cfg: { rbHuntMode: false } }); let requests = 0; m.env.gameGet = async () => { requests++; throw Error('offline'); };
 const listT = m.env.rt.rbListT; for (let i = 0; i < 4; i++) await m.R.rbHuntStep();
 assert.equal(requests, 1); assert.equal(m.env.rt.rbListT, listT); assert.equal(m.env.rt.rbHunt.phase, 'prepare'); assert.match(m.env.rt.rbHunt.next, /свер.*снова/); assert.equal(m.fires.length, 0); assert.equal(m.loc.href, '');
 assert.ok(m.env.rt.rbHuntIdle > Date.now(), 'до повторной сверки nextFight сохраняет цепочку мобов');
});
test('готовый состав с неизвестным DPS и уже виденным безопасным спецударом получает30с пробу', () => {
 const m = fixture({ cfg: { rbHuntMode: false }, rt: { rbDpsSample: null, rbDb: { one: { sp: 2000, hitP90: 200, kills: 1 } } } });
 const c = m.R.rbPreCheck('one', stats); assert.equal(c.ok, true); assert.equal(c.measure, true); assert.equal(c.source, 'unknown'); assert.match(c.why, /30 с/);
});
test('неоднозначные заряды дают только ограниченную пробу, не заимствуют известный DPS', () => {
 const m = fixture({ cfg: { rbHuntMode: false }, env: { warlock: { raidContext: () => ({ managed: true, key: null, prepared: true, planned: true }) } } });
 const c = m.R.rbPreCheck('one', stats); assert.equal(c.source, 'unknown'); assert.equal(c.measure, true); assert.ok(m.R.rbDpsOn('one') < 1200);
});
for (const reason of ['off', 'spent', 'slowPots', 'noPots', 'lethal', 'noExit']) test(`проба сохраняет ограничения: ${reason}`, () => {
 const m = fixture({ cfg: { rbHuntMode: false }, rt: { rbDpsSample: null } });
 if (reason === 'off') m.env.cfg.rbProbe = false;
 if (reason === 'spent') m.env.rt.rbDb.one = { probe: { kind: 'dps', key: 'P', t: Date.now(), lvl: 80 } };
 if (reason === 'slowPots') m.env.potModel = () => ({ pool: 600000, rate: 10 });
 if (reason === 'noPots') m.env.potModel = () => ({ pool: 0, rate: 2000 });
 if (reason === 'lethal') m.env.rt.rbDb.one = { sp: 14000 };
 if (reason === 'noExit') m.env.rt.rbDb.one = { leaveBadUntil: Date.now() + 3600000 };
 const c = m.R.rbPreCheck('one', stats);
 // 10.0.27: без обещанного лечения разрешено только конечное окно за счёт HP.
 if (['noPots','slowPots'].includes(reason)) { assert.equal(c.ok,true); assert.ok(c.probeSeconds>0&&c.probeSeconds<=8); return; }
 assert.equal(c.ok, false); if (['off','spent'].includes(reason)) { assert.equal(c.kind, 'unmeasured'); assert.doesNotMatch(m.R.rbListWhy(), /бой дольше|не по силам/); }
});
test('старый probe не ограничивает обычный тур после включения новой политики', async () => {
 const m = fixture({ rt: { rbDpsSample: null, rbDb: { one: { probe: { lvl: 80, sp: 3000, t: Date.now() - 60000 } } } } });
 m.setDoc(docOf(pin('one', 'Первый')));
 assert.equal(m.R.rbPreCheck('one', stats).measure, false); await m.R.rbEngage({ id: 'one', name: 'Первый', lvl: 80, idx: -1 }, 'Бой');
 assert.equal(m.R.probeFight('one'), false); assert.ok(m.env.rt.target);
});
test('оплаченный переход → бой → новая победа → следующий РБ, без повторного списка', async () => {
 const m = fixture(); await m.R.rbHuntStep(); const listT = m.env.rt.rbListT;
 m.loc.pathname = '/rb-bosses.html'; m.loc.search = '?page=1'; m.setDoc(docOf(page('one', 'Первый')));
 m.env.fire = el => { m.fires.push(el); if (el.dataset.spawnId === 'one') { m.loc.pathname = '/map.html'; m.setDoc(docOf(pin('one', 'Первый'))); } return true; };
 await m.R.rbHuntStep(); assert.equal(m.env.rt.rbHunt.step, 'arrive'); assert.equal(m.env.rt.rbGoCnt.one.length, 1);
 // Реальный rbEngage: окно разведки не появилось, но точные цифры есть; штатный attackSpawn подтверждает бой.
 m.env.attackSpawn = async () => { m.battle(true); return true; }; await m.R.rbHuntStep(); assert.equal(m.env.rt.rbHunt.step, 'fight'); assert.equal(m.env.rt.rbHunt.kills0, 0);
 m.env.rt.rbHuntIdle = Date.now() + 1200000; await m.R.rbNote('one', { kills: 1, verdict: 'ok' });
 m.env.rt.rbList.one.alive = false; m.battle(false); await m.R.rbHuntStep(); assert.match(m.env.rt.rbHunt.last, /победа этой попытки/); assert.equal(m.env.rt.rbHuntIdle, 0);
 await m.R.rbHuntStep(); assert.equal(m.env.rt.rbHunt.id, 'two'); assert.equal(m.env.rt.rbHunt.step, 'go'); assert.equal(m.env.rt.rbListT, listT); assert.equal(m.maps(), 0); assert.equal(m.env.rt.rbGoCnt.one.length, 1);
});
test('сохранённый rt.rbGo в основном рейде отменяется до старого платного пути', async () => {
 const m = fixture({ rt: { rbGo: { id: 'one', ...row('Первый', 80), t: Date.now() }, adenaSeen: { v: 0, t: Date.now() }, rbGoCnt: { one: [Date.now(), Date.now(), Date.now()] } } });
 m.loc.pathname = '/rb-bosses.html'; m.loc.search = '?page=1'; m.setDoc(docOf(page('one', 'Первый')));
 await m.R.rbGoStep(); assert.equal(m.env.rt.rbGo, null); assert.equal(m.fires.length, 0); assert.equal(m.env.rt.rbGoCnt.one.length, 3); assert.equal(m.env.rt.rbHunt.step, 'pick');
});
test('историческое убийство не превращает непринятую текущую попытку в победу', async () => {
 const m = fixture({ rt: { rbHunt: { step: 'fight', id: 'one', name: 'Первый', kills0: 5, fightAt: Date.now() }, rbDb: { one: { kills: 5, verdict: 'ok' } } } });
 await m.R.rbHuntStep(); assert.match(m.env.rt.rbHunt.last, /не подтверждён/); assert.doesNotMatch(m.env.rt.rbHunt.last, /✅/);
});
for (const reason of ['wallet', 'reserve', 'currency', 'priceChanged', 'limit']) test(`последняя проверка перед платным кликом: ${reason}`, async () => {
 const m = fixture(); await m.R.rbHuntStep(); m.loc.pathname = '/rb-bosses.html'; m.loc.search = '?page=1'; m.setDoc(docOf(page('one', 'Первый')));
 m.env.pause = async () => {
  if (reason === 'wallet') m.env.rt.adenaSeen = null;
  if (reason === 'reserve') m.env.rt.adenaSeen.v = 250000;
  if (reason === 'currency') m.setDoc(docOf(page('one', 'Первый', '1 Coin of Luck')));
  if (reason === 'priceChanged') m.setDoc(docOf(page('one', 'Первый', '3000000 аден')));
  if (reason === 'limit') m.env.rt.rbGoCnt = { one: [Date.now(), Date.now(), Date.now()] };
 };
 await m.R.rbHuntStep(); assert.equal(m.fires.length, 0); assert.equal(m.env.rt.rbHunt.step, 'pick');
 assert.equal(m.env.rt.rbGoTried?.one, undefined, 'отказ до клика не считается попыткой');
});
test('после отказа по адене пополнение сразу возвращает цель без ложного retry', async () => {
 const m = fixture(); await m.R.rbHuntStep(); m.loc.pathname = '/rb-bosses.html'; m.loc.search = '?page=1'; m.setDoc(docOf(page('one', 'Первый')));
 m.env.pause = async () => { m.env.rt.adenaSeen.v = 250000; }; await m.R.rbHuntStep();
 assert.equal(m.R.rbEntryDecision('one', m.env.rt.rbList.one).kind, 'funds'); assert.equal(m.env.rt.rbGoTried?.one, undefined);
 m.env.rt.adenaSeen = { v: 1000000, t: Date.now() }; m.loc.pathname = '/map.html'; m.setDoc(docOf(''));
 await m.R.rbHuntStep(); assert.equal(m.env.rt.rbHunt.step, 'go'); assert.equal(m.env.rt.rbHunt.id, 'one');
});
test('живой подходящий РБ уже на карте доступен без бюджета платного перелёта', async () => {
 const m = fixture({ rt: { adenaSeen: { v: 0, t: Date.now() } } }); m.setDoc(docOf(pin('one', 'Первый')));
 await m.R.rbHuntStep(); assert.equal(m.env.rt.rbHunt.step, 'arrive'); assert.equal(m.env.rt.rbHunt.id, 'one'); assert.equal(m.env.rt.rbGoCnt?.one, undefined); assert.equal(m.fires.length, 0);
});
for (const expired of [false, true]) test(`реальный wait из-за бюджета → пополнение без shopT будит тур; состав устарел=${expired}`, async () => {
 const m = fixture({ rt: { adenaSeen: { v: 250000, t: Date.now() } } }); await m.R.rbHuntStep();
 assert.equal(m.env.rt.rbHunt.phase, 'wait'); assert.ok(m.env.rt.rbHuntIdle > Date.now()); assert.ok(m.env.rt.rbTourView.blocked.some(x => x.kind === 'funds'));
 const shop = m.env.rt.shopT; m.env.rt.adenaSeen = { v: 1000000, t: Date.now() }; if (expired) m.fresh(false);
 await m.R.rbHuntStep(); assert.equal(m.env.rt.rbHuntIdle, 0); assert.equal(m.env.rt.shopT, shop);
 await m.R.rbHuntStep(); assert.equal(m.env.rt.rbHunt.step, 'go'); assert.equal(m.env.rt.rbHunt.id, 'one'); assert.equal(m.reads(), expired ? 1 : 0);
});
for (const stop of ['on', 'tabOwner', 'mode', 'manual']) test(`прибытие не атакует после отмены во время mapReady: ${stop}`, async () => {
 const m = fixture({ rt: { rbHunt: { step: 'arrive', id: 'one', name: 'Первый', at: Date.now() } } }); m.setDoc(docOf(pin('one', 'Первый')));
 m.env.mapReady = async () => { if (stop === 'mode') m.env.cfg.rbHuntMode = false; else if (stop === 'manual') m.env.rt.manualKickAt = Date.now(); else m.env[stop] = false; };
 await m.R.rbHuntStep(); assert.equal(m.fires.length, 0); assert.equal(m.env.rt.rbHunt.step, 'arrive');
});
for (const stop of ['manual', 'mode']) test(`отмена ${stop} внутри запасного ожидания метки не открывает battle URL`, async () => {
 const m = fixture(); m.setDoc(docOf(pin('one', 'Первый')));
 m.env.waitFor = async (fn, ms) => { if (ms === 3000) { if (stop === 'manual') m.env.rt.manualKickAt = Date.now(); else m.env.cfg.rbHuntMode = false; } return null; };
 await m.R.rbEngage({ id: 'one', name: 'Первый', lvl: 80, idx: -1 }, 'Бой', { active: () => m.env.cfg.rbHuntMode });
 assert.equal(m.loc.href, ''); assert.equal(m.env.rt.target, undefined);
});
for (const stage of ['page', 'pause', 'target']) for (const stop of ['manual', 'mode', 'owner']) test(`настоящий attackSpawn: отмена ${stop} во время ${stage} не открывает старого РБ`, async () => {
 const m = fixture(), doc = docOf('<div id="map-mob-list"><a class="l2-map-mob-link" href="/battle.html?spawnId=one">Первый · ур. 80</a></div>'); m.setDoc(doc);
 const cancel = () => { if (stop === 'manual') m.env.rt.manualKickAt = Date.now(); else if (stop === 'mode') m.env.cfg.rbHuntMode = false; else m.env.tabOwner = false; };
 Object.assign(m.env, { PAGE_SIZE: 15, QUEST: /★/, isChamp: () => false, isBoss: () => true, isRaidId: () => true, campActive: () => false,
  gotoPage: async () => { if (stage === 'page') cancel(); return true; }, pause: async () => { if (stage === 'pause') cancel(); } });
 const set = m.env.setRt; m.env.setRt = async p => { await set(p); if (stage === 'target' && p.target) cancel(); };
 const box = { console, Date, Math, CSS: { escape: s => s }, document: doc, location: m.loc }; vm.runInNewContext(fs.readFileSync(__dirname + '/../modules/mobfarm.js', 'utf8'), box);
 m.env.attackSpawn = box.L2V7Factories.mobfarm(m.env).attackSpawn;
 await m.R.rbEngage({ id: 'one', name: 'Первый', lvl: 80, idx: 0 }, 'Бой', { active: () => m.env.cfg.rbHuntMode });
 assert.equal(m.fires.length, 0); assert.equal(m.loc.href, '');
});
test('нет точных цифр — разведка с backoff, платный полёт даже к старой победе не разрешён', async () => {
 const m = fixture({ cfg: { rbHuntMode: false }, rt: { rbStats: {}, rbList: { one: row('Неизвестный', 80) }, rbDb: { one: { kills: 10, verdict: 'ok' } }, rbInfoFail: { one: Date.now() } } });
 await m.R.rbHuntStep(); assert.equal(m.env.rt.rbHunt.phase, 'wait'); assert.equal(m.fires.length, 0); assert.match(m.env.rt.rbHunt.next, /разведка/);
});
test('сбой цифр первого РБ не мешает разведать и выбрать второго живого', async () => {
 const m = fixture({ cfg: { rbHuntMode: false }, rt: { rbStats: {}, rbInfoFail: { one: Date.now() } }, net: url => url.endsWith('/two/info') ? { stats: { maxHp: stats.hp, pAtk: stats.patk, mAtk: stats.matk, pDef: stats.pdef, mDef: stats.mdef } } : null });
 await m.R.rbHuntStep(); assert.deepEqual(m.calls, ['/game/spawn/two/info']); assert.equal(m.env.rt.rbHunt.step, 'go'); assert.equal(m.env.rt.rbHunt.id, 'two');
});

function assessment(o = {}) {
 let now = 1000000; const DateFake = class extends Date { static now() { return now; } };
 const m = fixture({ rt: { rbDpsSample: null, rbDb: { one: { sp: 1500, probe: { kind: 'dps', key: 'P', lvl: 80, t: now } } } }, ...o });
 const box = { console, Date: DateFake, Math, Number }; vm.runInNewContext(fs.readFileSync(__dirname + '/../modules/raid.js', 'utf8'), box); m.R = box.L2V7Factories.raid(m.env); m.env.rbNote = m.R.rbNote; m.battle(true);
 const ctx = { name: 'Первый', rb: { id: 'one', samples: [], hits: [], t0: now, persist: true } };
 const sample = (i, dps = 67000, loss = 20) => { now = 1000000 + i * 1000; if (i && i % 4 === 0) ctx.rb.hits.push(150); return m.R.rbAssess(ctx, { max: 14917, cur: 14917 - i * loss, pct: (14917 - i * loss) / 149.17 }, { max: 5500000, cur: 5500000 - i * dps }); };
 return { ...m, ctx, sample };
}
test('полный HP-delta текущего боя учит модель, завершает пробу и принимает ручной бой в lifecycle', () => {
 const m = assessment(); for (let i = 0; i <= 30; i++) m.sample(i);
 assert.equal(m.env.rt.rbDpsSample.dps, 67000); assert.equal(m.R.probeFight('one'), false); assert.equal(m.env.rt.rbHunt.phase, 'fight'); assert.equal(m.env.rt.rbHunt.id, 'one');
 assert.equal(m.R.rbDpsEvidence('two').source, 'transfer'); assert.doesNotMatch(m.ctx.rb.note, /заходами/);
});
test('доказанная победа закрывает пробу до истечения 30с и не вызывает лишний выход после потери свежести снимка', async () => {
 const m = assessment(); let v; for (let i = 0; i <= 27; i++) v = m.sample(i);
 await Promise.resolve(); assert.equal(m.R.probeFight('one'), false); assert.equal(v.retreat, false);
 m.env.warlock.raidContext = () => ({ managed: true, key: null });
 v = m.sample(31); assert.equal(v.abort, undefined); assert.equal(m.R.probeFight('one'), false);
});
for (const damage of [0, 100]) test(`30с пробы без достаточного DPS (${damage}) требует штатный выход, не победу`, () => {
 const m = assessment({ cfg: { rbHuntMode: false } }); let v; for (let i = 0; i <= 30; i++) v = m.sample(i, damage);
 assert.equal(v.abort, true); assert.match(v.why, /30 с/); assert.equal(m.R.probeFight('one'), true); assert.equal(m.env.rt.rbDb.one.verdict, undefined);
});
test('дедлайн30с пробы сохраняется при новом ctx после reload, не начинается заново', () => {
 const m = assessment({ cfg: { rbHuntMode: false } }); for (let i = 0; i <= 20; i++) m.sample(i, 0);
 const started = m.env.rt.rbDb.one.probe.startedAt; assert.equal(m.env.rt.rbDb.one.probe.deadlineAt, started + 30000);
 for (const k of Object.keys(m.ctx.rb)) if (k !== 'id') delete m.ctx.rb[k]; Object.assign(m.ctx.rb, { samples: [], hits: [], persist: true });
 let v; for (let i = 21; i <= 31; i++) v = m.sample(i, 0);
 assert.equal(m.env.rt.rbDb.one.probe.startedAt, started); assert.equal(v.abort, true); assert.match(v.why, /30 с/);
});
test('planned key ни при каких условиях не создаёт боевое измерение', async () => {
 const m = fixture({ env: { warlock: { raidContext: (id, st, opts) => opts?.preflight ? { managed: true, key: 'planned', powerKey: 'P', planned: true } : { managed: true, key: null } } } });
 m.env.rt.rbDpsSample = null; await m.R.rbDpsLearn('one', 99000); assert.equal(m.env.rt.rbDb.one, undefined); assert.equal(m.env.rt.rbDpsSample, null);
});
test('при одном прогнозируемом заходе и выключенном отходе нет ложной подписи «заходами»', () => {
 const m = assessment({ cfg: { rbChipRetreat: false }, rt: { rbDb: { one: { sp: 5500 } } } });
 for (let i = 0; i <= 29; i++) m.sample(i, 67000, 0);
 assert.equal(m.ctx.rb.chip, false); assert.doesNotMatch(m.ctx.rb.note, /заходами/); assert.match(m.ctx.rb.note, /победа не подтверждена/);
});
for (const mode of ['raid', 'between', 'resource']) test(`карта во время ${mode}: у основного рейда один маршрут, отдельная ресурсная цель сохранена`, async () => {
 const m = fixture({ cfg: { rbHuntMode: mode === 'raid', rbMode: mode !== 'resource', priority: '' }, rt: { rbPending: true, sinceRb: 999, rbHuntIdle: Date.now() + 60000 } });
 const doc = docOf('<div id="map-mob-list" data-l2-around-sig="1|dummy:0|p0|lv80"><a class="l2-map-mob-link" href="/battle.html?spawnId=dummy">Mob · ур. 80</a></div><div id="map-mob-page-ind">1 / 1 (1)</div>'); m.setDoc(doc);
 let raids = 0, normal = 0;
 Object.assign(m.env, { serverDown: () => false, farmRbOn: () => mode === 'resource', raidList: () => [{ id: 'one', name: 'Первый', lvl: 80 }], rbCandidates: () => [{ id: 'one', name: 'Первый', lvl: 80 }],
  rbLo: () => 68, rbHi: () => 92, rbEngage: async () => { raids++; return true; }, rnd: () => 0, isBoss: () => false, isChamp: () => false, isRaidId: () => false, QUEST: /★/, PAGE_SIZE: 15,
  campRbOpen: () => [], campMobOpen: () => [], campActive: () => false, farmRules: () => [], recipeRules: () => [], halt: async () => { normal++; } });
 const box = { console, Date, Math, URLSearchParams, CSS: { escape: s => s }, location: m.loc, document: doc }; vm.runInNewContext(fs.readFileSync(__dirname + '/../modules/mobfarm.js', 'utf8'), box);
 await box.L2V7Factories.mobfarm(m.env).map();
 assert.equal(raids, mode === 'raid' ? 0 : 1); assert.equal(normal, mode === 'raid' ? 1 : 0); assert.equal(m.env.rt.rbGo, undefined);
 if (mode === 'raid') { assert.equal(m.R.rbDue(), false, 'ожидание не прерывает каждый бой старым счётчиком'); assert.equal(m.env.rt.rbPending, true, 'старыми признаками маршрут не управляется'); }
});
test('настоящие warlock + shot provider: перезагрузка после победы → полный GET → planned DPS → проверенная оплата', async () => {
 const { fixture: warlockFixture } = require('./warlock-fixture.cjs'), f = warlockFixture({ cfg: { petFullAuto: false } }); f.tick(Date.now() - f.now());
 const m = fixture({ rt: { char: 'hero', classCur: { prof: 'human_warlock', slot: 0 }, rbDpsSample: null,
  rbList: { one: row('Первый', 70), won: { ...row('Убитый', 70), alive: false } }, adenaSeen: null } });
 m.env.heroLvl = () => 75; f.env.rt = m.env.rt; f.env.cfg = m.env.cfg;
 Object.assign(m.env.rt, { weaponsT: f.now(), weapons: [{ id: 8688, g: 'A', weaponMode: 'magic', where: 'надето' }] });
 Object.assign(f.ch, { mAtk: 8000, pAtk: 1300, pDef: 1400, mDef: 1100, maxHp: 14917, activeBuffs: [{ skillId: 1356, level: 1, expiresAtMs: f.now() + 60000 }],
  inventory: { eq: { l1: { itemId: 8688 } }, stacks: [{ itemId: 3951, qty: 1000 }] }, battleHotbarSlots: [{ k: 'u', id: 3951 }], snapshotGeneratedAt: f.now() });
 let battle = true, buttons = [{ on: true, stock: 1000, title: '#3951', querySelector: () => ({ getAttribute: () => '/game/item-icon/3951' }) }];
 m.env.isBattle = f.env.isBattle = () => battle;
 const document = { querySelectorAll: () => buttons }, economyBox = { console, document }; vm.runInNewContext(fs.readFileSync(__dirname + '/../modules/economy.js', 'utf8'), economyBox);
 const core = fs.readFileSync(__dirname + '/../content.js', 'utf8'), providerBox = { document,
  SHOT_IDS: { NG: 1835, D: 1463, C: 1464, B: 1465, A: 1466, S: 1467 }, BSPS_IDS: { NG: 3947, D: 3948, C: 3949, B: 3950, A: 3951, S: 3952 },
  qty: b => b.stock, shotsOn: b => b.on, rt: m.env.rt, isBattle: f.env.isBattle, heroNick: f.env.heroNick, on: true, tabOwner: true,
  L2V7Modules: { economy: economyBox.L2V7Factories.economy(m.env), warlock: f.api() }, addEventListener() {} };
 vm.createContext(providerBox); vm.runInContext(core.slice(core.indexOf('const warlockShotContext'), core.indexOf('const warlockCanRun')), providerBox);
 f.env.shotContext = vm.runInContext('warlockShotContext', providerBox);
 m.env.warlock = { raidContext: (...args) => f.api().raidContext(...args), noteSnapshot: ch => f.api().noteSnapshot(ch) }; m.env.gameGet = f.env.gameGet;
 f.ch.inBattle = true; f.api().noteSnapshot(f.ch);
 const powerKey = f.api().raidContext('won', stats).powerKey; assert.ok(powerKey);
 m.env.rt.rbDpsSample = { id: 'won', powerKey, dps: 67000, target: { lvl: 70, pdef: stats.pdef, mdef: stats.mdef }, t: Date.now() };
 battle = false; buttons = []; f.ch.inBattle = false; f.reload();
 assert.equal(m.R.rbDpsEvidence('one').source, 'unknown');
 await m.R.rbHuntStep(); assert.equal(m.env.rt.rbHunt.step, 'go'); assert.equal(m.env.rt.rbHunt.id, 'one'); assert.equal(m.R.rbDpsEvidence('one').source, 'transfer');
 assert.equal(f.api().raidContext('one', stats).key, null, 'planned context не подменил строгий'); assert.equal(f.gets.length, 1);
 // /character возвращает адену десятичной строкой, как в серверном контракте Warlock.
 m.env.rt.adenaSeen = null; m.loc.pathname = '/rb-bosses.html'; m.loc.search = '?page=1'; m.setDoc(docOf(page('one', 'Первый')));
 await m.R.rbHuntStep(); assert.equal(m.env.rt.adenaSeen.v, 20000000); assert.equal(m.env.rt.rbHunt.step, 'arrive'); assert.equal(m.fires.length, 1); assert.equal(f.calls.length, 0);
});

test('обычный тур выбирает живого РБ при недоступных цифрах силы и старом отказе модели', async () => {
 const m = fixture({ cfg: { rbProbe: false, rbMaxKillMin: 1, rbValueTour: true }, rt: { rbStats: {}, rbDpsSample: null, rbInfoFail: { one: Date.now(), two: Date.now() }, rbDb: { one: { verdict: 'no', heroLvl: 80, sp: 90000 } }, rbPreSkip: { one: { kind: 'strong', observed: true, probeExit: true, t: Date.now() } } } });
 await m.R.rbHuntStep(); assert.equal(m.env.rt.rbHunt.step, 'go'); assert.equal(m.env.rt.rbHunt.id, 'one'); assert.equal(m.fires.length, 0);
});


test('старые два отказа модели не держат обычный тур в глобальной паузе', async () => {
 const m = fixture({ rt: { rbRefuse: { n: 2, t: Date.now() }, rbHuntIdle: Date.now() + 300000, rbIdleMark: { lvl: 80, pots: 500, t: Date.now(), adena: 1000000 }, rbHunt: { step: 'pick', phase: 'wait' } } });
 await m.R.rbHuntStep(); assert.equal(m.env.rt.rbHuntIdle, 0);
 await m.R.rbHuntStep(); assert.equal(m.env.rt.rbHunt.step, 'go'); assert.equal(m.env.rt.rbHunt.id, 'one');
});
