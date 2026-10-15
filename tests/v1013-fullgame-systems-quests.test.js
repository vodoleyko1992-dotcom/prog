'use strict';
// 14.10, полный аудит: DOM по публичному starter-story-quest.js. На этапах встречи/возврата
// actions.canMeetScout/canReportScout/canClaimReward дают кнопку лишь у NPC; вне NPC есть только телепорт.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'modules/quests.js'), 'utf8');
const el = extra => ({ textContent: '', dataset: {}, disabled: false, hidden: false,
  querySelector: () => null, closest: () => null, classList: { contains: () => false }, ...extra });
function setup(stage, cfg = {}) {
  const state = { targets: [], actions: [], teleports: [], err: el({ hidden: true }), body: 'Этап ' + stage };
  const all = sel => sel.includes('li.l2-starter-story-target') ? state.targets
    : sel.includes('button[data-action]') ? state.actions
    : sel.includes('data-quest-teleport-id') ? state.teleports : [];
  const document = { body: el(), querySelectorAll: all, querySelector: sel => {
    if (sel.includes('-err')) return state.err;
    if (sel.includes('quest-body') || sel.includes('starter-story-body')) return el({ textContent: state.body });
    return all(sel)[0] || null;
  } };
  const location = { pathname: '/starter-story-quest.html', search: '', href: 'https://l2wap.com/starter-story-quest.html', origin: 'https://l2wap.com' };
  const sb = { document, location, console, Date, URL }; sb.globalThis = sb;
  vm.runInNewContext(src, sb);
  const fired = [], logs = []; let q;
  const ch = {name:'Hero',id:'hero',revision:1,currentZoneId:'town',locationType:'city',worldX:10,worldY:20};
  const env = { cfg: { campaign: true, campAuto: false, ...cfg }, rt: {
    char: 'Hero', storySaga: { stage, title: 'Путь новичка', completed: false, minLevel: 10, lvl: 15 },
    campaignDue: true, campOnce: !cfg.campaign,
  }, on: true, heroLvl: () => 15, setRt: async p => {Object.assign(env.rt, p);return {ok:true}}, rtCommit: async()=>true, gameGet:async()=>({ok:true,json:async()=>({character:{...ch}})}),
    shown: e => !!e && !e.hidden, $q: s => document.querySelector(s),
    setStatus() {}, rec: (...a) => logs.push(a.join(' ')), pause: async () => {}, sleep: async () => {}, rnd: () => 0,
    waitFor: async f => { for (let i = 0; i < 3; i++) { const r = f(); if (r) return r; } return null; },
    fire: e => { assert.ok(e, 'кнопка существует'); fired.push(e.dataset.action || e.dataset.questTeleportId); e.onFire?.();
      if(e.dataset.questTeleportId){const req={teleportId:e.dataset.questTeleportId,expectedRevision:ch.revision};
        if(!state.err.hidden)q.campLocationNote('/game/story-quests/starter-saga/teleport',{method:'POST',status:400,req,res:{error:'insufficient_adena'}});
        else {ch.revision++;ch.worldX++;q.campLocationNote('/game/story-quests/starter-saga/teleport',{method:'POST',status:200,req,res:{character:{...ch}}});}}
      return true; },
    goOutskirts: async () => { env.outs = (env.outs || 0) + 1; }, noticeText: () => '', isCampaign: () => true,
  };
  q = sb.L2V7Factories.quests(env);
  return { q, env, state, fired, logs, ch, location, reload:()=>q=sb.L2V7Factories.quests(env) };
}
const cases = [];
function test(name, f) { cases.push([name, f]); }
for (const [stage, target, action] of [
  ['not_started', 'talking_island', 'accept'], ['meet_scout', 'elven_ruins', 'meet-scout'],
  ['return_scout', 'elven_ruins', 'report-scout'], ['return_home', 'talking_island', 'claim-reward'],
]) test(stage + ': телепорт к NPC, затем действие', async () => {
  const { q, env, state, fired } = setup(stage);
  state.teleports.push(el({ textContent: 'Телепорт', dataset: { questTeleportId: target }, onFire() {
    state.actions = [el({ textContent: 'Поговорить', dataset: { action } })];
  } }));
  await q.campaign();
  assert.deepEqual(fired, [target], 'пустые targets на этапе NPC требуют телепорт, а не возврат на карту');
  assert.equal(env.outs || 0, 0, 'не уходим фармить вместо NPC');
  await q.campaign();
  assert.deepEqual(fired, [target, action]);
});
test('разовая проверка не принимает квест и не телепортирует', async () => {
  const { q, env, state, fired } = setup('not_started', { campaign: false, campAuto: false });
  state.actions.push(el({ textContent: 'Взять квест', dataset: { action: 'accept' } }));
  state.teleports.push(el({ textContent: 'Телепорт', dataset: { questTeleportId: 'talking_island' } }));
  await q.campaign();
  assert.deepEqual(fired, []);
  assert.equal(env.rt.campOnce, false); assert.equal(env.rt.campaignDue, false);
  assert.equal(env.outs, 1);
});
test('отказ телепорта не создаёт бесконечный цикл', async () => {
  const { q, env, state, fired } = setup('meet_scout');
  state.teleports.push(el({ textContent: 'Телепорт', dataset: { questTeleportId: 'elven_ruins' }, onFire() {
    state.err.hidden = false; state.err.textContent = 'Недостаточно адены';
  } }));
  for (let i = 0; i < 5; i++) await q.campaign();
  assert.ok(fired.length > 0 && fired.length <= 4);
  assert.ok(env.rt.campSkipUntil > Date.now(), 'после ограниченного числа попыток есть пауза');
  assert.equal(env.rt.lastTeleport || '', '', 'отказ не выдаётся за успешный полёт');
});
test('завершённая глава не телепортирует обратно к NPC', async () => {
  const { q, env, state, fired } = setup('completed'); env.rt.storySaga.completed = true;
  state.teleports.push(el({ textContent: 'Телепорт', dataset: { questTeleportId: 'talking_island' } }));
  await q.campaign(); assert.deepEqual(fired, []);
});
test('стоп во время паузы отменяет телепорт к NPC', async () => {
  const { q, env, state, fired } = setup('meet_scout');
  state.teleports.push(el({ textContent: 'Телепорт', dataset: { questTeleportId: 'elven_ruins' } }));
  env.pause = async () => { env.on = false; };
  await q.campaign(); assert.deepEqual(fired, []);
});
test('стоп во время паузы отменяет принятие квеста', async () => {
  const { q, env, state, fired } = setup('not_started');
  state.actions.push(el({ textContent: 'Взять квест', dataset: { action: 'accept' } }));
  env.pause = async () => { env.on = false; };
  await q.campaign(); assert.deepEqual(fired, []);
});
(async () => { let fail = 0; for (const [name, f] of cases) {
  try { await f(); console.log('PASS:', name); } catch (e) { fail++; console.error('FAIL:', name, '\n', e.message); }
} if (fail) process.exitCode = 1; else console.log('v1013-fullgame-systems-quests: PASS (' + cases.length + ')'); })();
