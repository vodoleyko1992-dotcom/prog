'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const allGameplay = content + fs.readdirSync(path.join(root, 'modules')).map(f => fs.readFileSync(path.join(root, 'modules', f), 'utf8')).join('\n');
function chunk(text, start, end) {
  const i = text.indexOf(start), j = text.indexOf(end, i + start.length);
  assert(i >= 0 && j > i, `Missing source section: ${start}`);
  return text.slice(i, j);
}
const saved = {
  on: true, rt: { char: 'West', kills: 20, xp: 500 },
  cfg: { epicMode: true, nAttack: 'hit', nPower: 'strike' },
  'rt@WestSPOIL': { char: 'WestSPOIL', kills: 8 },
  'cfg@WestSPOIL': { epicMode: false, nAttack: 'sweep', nPower: 'bash' }
};
const local = {
  async get(keys) {
    const out = {};
    for (const k of typeof keys === 'string' ? [keys] : keys)
      if (Object.hasOwn(saved, k)) out[k] = structuredClone(saved[k]);
    return out;
  },
  async set(values) { for (const [k, v] of Object.entries(values)) saved[k] = structuredClone(v); }
};
const bctx = vm.createContext({ chrome: { storage: { local } }, noteAlive() {}, console, Date, URL, crypto: { randomUUID: (() => { let i = 0; return () => 'epoch-' + (++i); })() } });
vm.runInContext(chunk(bg, 'const LOCK_TTL =', 'const paint =') + '\nthis.lockCommand=lockCommand;this.switchCharacter=switchCharacter;this.statePatch=statePatch;', bctx);
const sender = id => ({ tab: { id, active: true }, frameId: 0, url: 'https://l2wap.com/map.html' });
const request = () => ({ cmd: 'lockAcquire', page: '/map.html', vis: true, focus: true });

async function checkLocks() {
  const [a, b] = await Promise.all([bctx.lockCommand(request(), sender(11)), bctx.lockCommand(request(), sender(22))]);
  assert(a.ok !== b.ok, 'Exactly one active owner');
  const owner = a.ok ? 11 : 22, other = owner === 11 ? 22 : 11;
  const first = a.ok ? a : b;
  assert.equal((await bctx.lockCommand({ cmd: 'lockRenew', epoch: first.epoch }, sender(other))).ok, false);
  assert.equal((await bctx.lockCommand({ cmd: 'lockRenew', epoch: first.epoch }, sender(owner))).ok, true);
  const taken = await bctx.lockCommand(request(), sender(other));
  assert.equal(taken.ok, true, 'Visible focused tab preempts hidden one');
  assert.equal((await bctx.lockCommand({ cmd: 'lockRenew', epoch: first.epoch }, sender(owner))).ok, false);
  assert.equal(saved.lock.k, 'tab' + other);
  assert.equal((await bctx.lockCommand({ cmd: 'lockRelease', epoch: first.epoch }, sender(owner))).ok, false);
  const patch = await bctx.statePatch({ patch: { kills: 123 }, epoch: taken.epoch, src: 'test' }, sender(other));
  assert.equal(patch.ok, true);
  assert.equal(saved.rt.kills, 123);
  assert.equal(saved.rt.xp, 500, 'Unrelated storage key preserved');
  assert.equal((await bctx.statePatch({ patch: { kills: 999 }, epoch: first.epoch }, sender(owner))).ok, false);
  // A new document in the SAME tab must rotate epoch, fencing out old context.
  const next = await bctx.lockCommand(request(), sender(other));
  assert(next.ok && next.epoch !== taken.epoch);
  assert.equal((await bctx.lockCommand({ cmd: 'lockRelease', epoch: taken.epoch }, sender(other))).ok, false);
  assert.equal((await bctx.statePatch({ patch: { kills: 999 }, epoch: taken.epoch }, sender(other))).ok, false);
  assert.equal((await bctx.lockCommand({ cmd: 'lockRenew', epoch: next.epoch }, sender(other))).ok, true);
  assert.equal((await bctx.switchCharacter({ nick: 'WestSPOIL', epoch: taken.epoch }, sender(other))).ok, false);
  const r = await bctx.switchCharacter({ nick: 'WestSPOIL', epoch: next.epoch, vis: true, src: 'test', roles: ['nAttack','nPower'], defRt: { kills: 0 } }, sender(other));
  assert.equal(r.ok, true);
  assert.equal(saved.rt.char, 'WestSPOIL');
  assert.equal(saved.rt.kills, 8);
  assert.equal(saved['rt@West'].kills, 123);
  assert.equal(saved.cfg.nAttack, 'sweep');
  assert.equal(saved['cfg@West'].nAttack, 'hit');
  assert.equal((await bctx.lockCommand({ cmd: 'lockRelease', epoch: next.epoch }, sender(other))).ok, true);
  assert.equal(saved.lock, null);
  console.log('PASS: epoch fencing, concurrent tabs, atomic PATCH, character isolation');
}

function checkLearning() {
  const changes = [], LEARN = { api: {} };
  const cctx = vm.createContext({ LEARN, Date, learnPk: () => 'battle',
    learnChange: (...a) => changes.push(a), learnSaveSoon() {}, console, learnDirty: false });
  vm.runInContext(chunk(content, 'const apiPath =', 'const netSeen =') + '\nthis.learnApi=learnApi;', cctx);
  const key = 'POST /game/battle/action';
  for (let i = 0; i < 7; ++i) cctx.learnApi(key, { status: 200, res: { kind: 'skill', revision: i, character: {}, delta: null } });
  for (let i = 0; i < 5; ++i) cctx.learnApi(key, { status: 400, res: { error: 'skill_cooldown', messageRu: 'Cooldown' } });
  cctx.learnApi(key, { status: 200, res: { kind: 'skill', revision: 7, character: {}, delta: null } });
  assert.equal(changes.length, 0, 'Cooldown errors must not be mistaken for API shape changes');
  assert.equal(LEARN.api[key].forms['error:skill_cooldown'].n, 5);
  cctx.learnApi(key, { status: 200, res: { kind: 'skill', revision: 8, character: {}, delta: null, newField: true } });
  assert(changes.some(x => String(x[1]).includes('newField')), 'Genuine schema additions must be reported');
  console.log('PASS: normal/error responses separated, real schema changes detected');
}

function checkSafety() {
  assert(allGameplay.includes('while (env.on && env.tabOwner) {'), 'Long-running combat checks owner');
  assert(content.includes('if (!el || (on && !tabOwner)) return false;'), 'Clicks blocked after ownership loss');
  assert(allGameplay.includes("env.rt.epic?.step === 'retreatVerify' && ctx.rb"), 'Retreat verifies in battle');
  assert(allGameplay.includes("E.retreatFailed) return epicGiveUp"), 'Failed leave suppresses attempts');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, '10.0.3');
  console.log('PASS: ownership and retreat protections, extension version');
}

(async () => {
  await checkLocks(); checkLearning(); checkSafety();
  console.log('PASS: all stage-1 regression tests');
})().catch(e => { console.error(e); process.exitCode = 1; });
