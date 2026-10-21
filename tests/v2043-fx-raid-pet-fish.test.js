'use strict';
// 20.43 (автономность, доводка 21.10, замечание R5): отсрочка тура РБ «призыв кота не подтвердился» (warlock.raidBlocked) писала
// rbFishWait{pet:true} лишь потому, что рыбалка есть в списке задач. Если рыбалка сейчас идти не может (дневной лимит рыбы, цель достигнута,
// предел забросов), выбор задач пропускал её и возвращал тур, а тот до 30 мин стоял в rbIdleMap с ложным «перехожу к выбранной рыбалке».
// Теперь raid спрашивает ту же L2EngineCore.selectedTask на копии памяти с этим ожиданием: ход рыбалке — только если выбор правда её отдаст.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { mk } = require('./epic-harness.cjs');
const core = {}; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../engine-core.js'), 'utf8'), core);
const E = core.L2EngineCore;
const HOLD = 'призыв кота перед РБ не подтвердился и после повтора — тур отложен до 05:30 (снимут новый Старт или кот, призванный вручную)';
const row = { name: 'Water Dragon Seer Sheshark', lvl: 72, page: 11, alive: true, price: 100000, unit: 'аден', t: Date.now() };
function fixture({ cfg = {}, rt = {}, engine = true } = {}) {
  const until = Date.now() + 1800000;
  const m = mk({ hero: 77, sb: engine ? { L2EngineCore: E } : {},
    cfg: { epicMode: false, rbHuntMode: true, rbMode: true, rbFaFull: true, petFullAuto: false, shopAuto: false, rbRestHp: 95, autoTasks: ['tvt', 'raid', 'fish'], ...cfg },
    rt: { char: 'Warlock', classCur: { prof: 'human_arcana_lord', slot: 0 }, rbHunt: { step: 'pick' }, rbListT: Date.now(),
      rbList: { boss: row }, rbStats: { boss: { hp: 5500000, patk: 5000, matk: 2500, pdef: 9000, mdef: 10000, src: 'api' } },
      rbDb: {}, adenaSeen: { v: 20000000, t: Date.now() }, ...rt },
    env: { tabOwner: true, warlock: { raidContext: () => ({ managed: true, key: 'same', powerKey: 'same', prepared: true }), step: async () => false,
      summary: () => ({ status: 'active', expiresAt: Date.now() + 3600000, reason: 'active' }), raidBlocked: () => HOLD, raidHoldUntil: () => until },
      townBuffStart: async () => false, townBuffNeed: () => null, potModel: () => ({ pool: 600000, rate: 2000, n: 500, H: 1200, C: 1, items: [] }),
      faFullIds: () => [1323], hudBuffs: () => ({ 1323: Date.now() + 3600000 }),
      gameGet: async () => ({ ok: true, json: async () => ({ character: { name: 'Warlock', inBattle: false, adena: 20000000 } }) }),
      meHp: () => ({ cur: 14917, max: 14917, pct: 100 }), meMp: () => ({ cur: 5408, max: 5408 }), logLines: () => [], newLines: () => [], activeBuffs: () => [] } });
  return { ...m, until };
}
const today = fish => ({ ...E.dailyQuotaToday({}), fish });

for (const [kind, o] of [
  ['дневной лимит рыбы выбран', { cfg: { dailyFishLimit: 100 }, rt: { dailyQuota: today(100) } }],
  ['цель рыбалки достигнута', { rt: { fishTgt: { done: true } } }],
  ['предел забросов исчерпан', { cfg: { fishMaxCasts: 50 }, rt: { fish: { casts: 50 } } }],
]) test(`R5: ${kind} — ход рыбалке не передаётся, журнал не обещает «перехожу к выбранной рыбалке»`, async () => {
  const f = fixture(o);
  assert.equal(E.selectedTask(f.env.cfg, f.env.rt), 'raid', 'рыбалка сейчас не идёт — выбор задач отдаёт тур');
  for (let i = 0; i < 3; i++) await f.R.rbHuntStep();
  assert.equal(f.env.rt.rbFishWait, undefined, 'rbFishWait{pet} не пишется (раньше — писался, а выбор всё равно возвращал тур)');
  assert.equal(f.env.rt.rbHunt.phase, 'wait'); assert.equal(f.env.rt.rbHunt.step, 'pick');
  assert.equal(f.env.rt.rbHunt.next, HOLD + '; выбранная рыбалка сейчас не идёт (дневной лимит, цель или предел забросов); жду, фарм мобов сейчас не выбран');
  assert.ok(!f.logs.some(l => /перехожу к выбранной рыбалке/.test(l)));
  assert.equal(f.logs.filter(l => /выбранная рыбалка сейчас не идёт/.test(l)).length, 1, 'одна строка журнала на отсрочку');
  assert.equal(f.fires.length, 0); assert.equal(f.loc.href, '');
  assert.equal(E.selectedTask(f.env.cfg, f.env.rt), 'raid');
});

test('R5: рыбалка может идти — ход ей передаётся, как раньше (rbFishWait{pet} до конца отсрочки, выбор задач — рыбалка)', async () => {
  const f = fixture({ cfg: { dailyFishLimit: 100, fishMaxCasts: 50 }, rt: { dailyQuota: today(99), fish: { casts: 49 } } });
  for (let i = 0; i < 3; i++) await f.R.rbHuntStep();
  const W = f.env.rt.rbFishWait; assert.ok(W && W.pet === true && W.until === f.until);
  assert.equal(E.selectedTask(f.env.cfg, f.env.rt), 'fish');
  assert.equal(f.logs.filter(l => /перехожу к выбранной рыбалке/.test(l)).length, 1);
  assert.ok(!f.logs.some(l => /рыбалка сейчас не идёт/.test(l)));
});

test('R5: фарм на месте разрешён — без рыбалки честно «фарм на месте при наличии мобов»', async () => {
  const f = fixture({ rt: { fishTgt: { done: true } } }); f.env.idleFarmAllowed = () => true;
  await f.R.rbHuntStep();
  assert.equal(f.env.rt.rbFishWait, undefined);
  assert.equal(f.env.rt.rbHunt.next, HOLD + '; выбранная рыбалка сейчас не идёт (дневной лимит, цель или предел забросов); фарм на месте при наличии мобов');
});

test('R5: неизвестная оплата — по-прежнему без передачи и без упоминания рыбалки; без справочника ядра — прежнее поведение', async () => {
  const f = fixture({ rt: { actionPayments: { pending: { kind: 'raid-teleport' } } } });
  await f.R.rbHuntStep();
  assert.equal(f.env.rt.rbFishWait, undefined); assert.equal(f.env.rt.rbHunt.next, HOLD + '; жду, фарм мобов сейчас не выбран');
  const g = fixture({ engine: false });
  await g.R.rbHuntStep();
  assert.equal(g.env.rt.rbFishWait?.pet, true, 'старый стенд без L2EngineCore — как раньше');
});
