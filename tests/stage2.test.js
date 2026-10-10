'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const { createBattleCooldown } = require('../battle-cooldown.js');
const moduleEpics = fs.readFileSync(path.join(root, 'modules/epics.js'), 'utf8');
const source = fs.readFileSync(path.join(root, 'content.js'), 'utf8') + '\n' + moduleEpics + '\n' + fs.readFileSync(path.join(root, 'modules/combat.js'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'modules/raid.js'), 'utf8');
const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
function testCooldown() {
  let now = 500000;
  const g = createBattleCooldown(() => now);
  // Реальный ответ из журнала 09.10: 400 blockedBy=global, skillRemainingMs=0.
  g.observe({ action:'wild_sweep', battleSpawnId:'dense_1625' }, {
    error:'skill_cooldown', blockedBy:'global', skillId:'l2_245', normalizedSkillId:'l2_245',
    nowMs:1791523768821, serverNowMs:1791523768821, globalCooldownUntilMs:1791523769255,
    cooldownUntilMs:1791523769255, remainingMs:434, globalRemainingMs:434, skillRemainingMs:0
  }, 400);
  assert(g.globalWait('dense_1625') >= 434, 'Global cooldown should block all actions');
  assert.equal(g.skillWait('wild_sweep','dense_1625'),0,'Global rejection must not be remembered as a skill cooldown');
  assert.equal(g.skillWait('l2_245','dense_1625'),0);
  assert.equal(g.recentlyGlobalRejected(now), true);
  now+=550;
  assert.equal(g.globalWait('dense_1625'),0);
  g.observe({ action:'wild_sweep', battleSpawnId:'dense_1625' }, {
    serverNowMs:1791523769821, blockedBy:'skill', skillRemainingMs:3000,
    cooldownUntilMs:1791523772821, normalizedSkillId:'l2_245', skillId:'l2_245'
  },400);
  assert(g.skillWait('wild_sweep','dense_1625')>=3000);
  assert(g.skillWait('l2_245','dense_1625')>=3000);
  assert.equal(g.globalWait('dense_1625'),0);
  g.observe({ action:'attack', battleSpawnId:'dense_1625' }, { serverNowMs:1791523773821, skillCooldowns: { l2_29: 1791523779821 } },200);
  assert(g.skillWait('l2_29','dense_1625')>=6000);
  assert.equal(g.skillWait('l2_29','another_battle'),0);
  g.observe({ action:'attack', battleSpawnId:'another_battle' },{ serverNowMs:500000 }, 200);
  assert.equal(g.skillWait('l2_29','another_battle'),0,'Battle transitions must reset the scheduler');
  console.log('PASS: server global cooldown, per-skill cooldown, clock skew, battle reset');
}
async function testBudget() {
  let now = 1000000000;
  const cfg={ epicCoinDailyMax:3, epicAdenaDailyMax:10000 };
  const rt={ epicTpBudget:[] };
  const ctx=vm.createContext({ Date: { now:()=>now }, Number, Math });
  vm.runInContext(moduleEpics, ctx);
  const module=ctx.L2V7Factories.epics({ cfg,rt,rec(){}, async setRt(update){Object.assign(rt,update); } });
  ctx.quote=module.epicTpBudgetQuote; ctx.reserve=module.epicTpBudgetReserve;
  const coin={ price:1, priceKnown:true,priceUnit:'Coin of Luck' };
  for(let i=0;i<3;i++)assert.equal((await ctx.reserve('core',coin)).ok,true);
  assert.equal(ctx.quote(coin).ok,false,'Fourth Coin of Luck teleport must be blocked');
  assert.equal(rt.epicTpBudget.length,3);
  assert.equal(ctx.quote({price:0,priceKnown:false}).ok,false,'Unknown cost must fail closed with a limit');
  const adena={ price:4000,priceKnown:true,priceUnit:'аден' };
  assert.equal((await ctx.reserve('core',adena)).ok,true);
  assert.equal((await ctx.reserve('orfen',adena)).ok,true);
  assert.equal(ctx.quote(adena).ok,false,'Adena daily limit should apply');
  now+=86400001;
  assert.equal(ctx.quote(coin).ok,true,'Entries expire after rolling 24h');
  cfg.epicCoinDailyMax=0;cfg.epicAdenaDailyMax=0;
  assert.equal(ctx.quote({priceKnown:false}).ok,true,'Limits are opt-in for backward compatibility');
  console.log('PASS: rolling 24h currency budgets, conservative reservation, unknown-price guard');
}
function testIntegration() {
  const c = manifest.content_scripts.find(c=>c.js.includes('content.js'));
  assert(c.js.indexOf('battle-cooldown.js') < c.js.indexOf('content.js'));
  for(const id of ['epicCoinDailyMax','epicAdenaDailyMax','epicMinHpPots']) {
    assert(html.includes(`id="${id}"`));assert(popup.includes(`'${id}'`));assert(source.includes(id));
  }
  assert(source.includes('const reliable = dt >= 15 && S.samples.length >= 5'));
  assert(source.includes("if (!env.combatCooldown.recentlyGlobalRejected(firedAt)) await rememberCd(b, 'cd')"));
  console.log('PASS: stage-2 integration, popup configuration, conservative boss assessment');
}
(async()=>{testCooldown();await testBudget();testIntegration();console.log('PASS: all stage-2 tests');})().catch(err=>{console.error(err);process.exitCode=1;});
