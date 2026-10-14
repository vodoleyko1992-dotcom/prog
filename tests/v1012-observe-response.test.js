// 10.0.12: замер навыка ждёт свой ответ, а не фиксированные 900 мс.
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const src = fs.readFileSync(require('node:path').join(__dirname, '..', 'content.js'), 'utf8');
const fn = src.slice(src.indexOf('let lastObserve = 0;'), src.indexOf('// роли по панели', src.indexOf('let lastObserve = 0;')));
async function scenario({ delay = 1300, sent = true, refused = false, supersede = false, wrongAction = false } = {}) {
  let now = 10000, callback, mp = 100, hp = 100, writes = [], logs = [], arr = [], trigger = false;
  const NET = { start: 2, done: 2, ok: true, action: 'l2_1220' };
  const update = () => { if (sent && now >= 10000 + delay) { NET.done = 3; NET.ok = !refused; if (wrongAction) NET.action = 'l2_1274'; if (!refused) { mp = 70; hp = 0; arr = ['Полум’я 100']; } } };
  const b = { title: 'Blaze', querySelector: () => null };
  const sb = { Date: { now: () => now }, ACT_NET: NET, slotAction: () => 'l2_1220', isBattle: () => true, slotKind: () => 'скилл', cleanTitle: x => x,
    mobHp: () => ({ cur: hp, max: 100 }), meHp: () => ({ cur: 100 }), meMp: () => ({ cur: mp }), logLines: () => arr, noticeText: () => '',
    slotCd: () => null, setTimeout: f => { callback = f; }, sleep: async ms => { now += ms; update(); if (supersede && !trigger) { trigger = true; vm.runInContext('lastObserve++', ctx); } },
    newLines: (a, z) => z.slice(a.length), BUFF_RE: /x^/, ilOf: () => null, isChargeName: () => false, dmgFromLog: () => arr.length ? 100 : 0,
    L2V7Modules: { fightlab: { turnFor: () => null } }, rt: {}, fightNote: () => {}, splashDmg: () => 0, BUFF_CTX: null, UNAVAIL: /x^/, setRt: async p => writes.push(p), rec: (...a) => logs.push(a),
  };
  const ctx = vm.createContext(sb); vm.runInContext(fn + '\nthis.observeSlot = observeSlot;', ctx);
  sb.observeSlot(b, 'B'); if (sent) NET.start = 3; now += 900; update(); await callback();
  return { writes, logs, elapsed: now - 10000 };
}
(async () => {
  const slow = await scenario(); assert.match(slow.logs[0]?.[2] || '', /урон 100 · MP −30/, 'late accepted response supplies actual damage and MP');
  const fast = await scenario({ delay: 300 }); assert.match(fast.logs[0]?.[2] || '', /урон 100 · MP −30/, 'fast reply keeps the established sample');
  const other = await scenario({ wrongAction: true }); assert.equal(other.writes.length, 0, 'another action response cannot teach this skill');
  const pending = await scenario({ delay: 20000 }); assert.equal(pending.writes.length, 0, 'pending request cannot teach a zero'); assert.equal(pending.logs.length, 0); assert.ok(pending.elapsed < 10000, 'waiting is bounded');
  const newer = await scenario({ supersede: true }); assert.equal(newer.writes.length, 0, 'newer click cannot contaminate the sample');
  const denied = await scenario({ refused: true }); assert.equal(denied.writes.length, 0, 'rejected action is not learned as a use');
  const fallback = await scenario({ sent: false }); assert.equal(fallback.logs.length, 1, 'legacy/manual observation without network events remains available');
  console.log('PASS v1012 observe response');
})().catch(e => { console.error(e); process.exitCode = 1; });
