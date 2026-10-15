'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {flowFixture}=require('./warlock-combat-fixture.cjs');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
// Reuse the real paid-click/ledger fixture, without registering its original tests.
const fixtureBox={console,process,__dirname,URLSearchParams,require:n=>n==='node:test'?()=>{}:require(n)};
vm.runInNewContext(read('tests/v1024-payment-adapters.test.js').split('\nfunction raid(){')[0]+'\nthis.makeBuffs=buffs;',fixtureBox);
async function pending(){const f=fixtureBox.makeBuffs();f.apply(false);await f.B.townBuffStep();assert.equal(f.pays(),1);assert.ok(f.env.payments.blocked());return f;}
function server(f,rows,name='hero'){f.env.gameGet=async()=>({ok:true,json:async()=>({character:{name,activeBuffs:rows}})});}
for(const field of ['expiresAt','expiresAtMs'])test(`FA: реальный ${field} после reload подтверждает оплату один раз`,async()=>{
 const f=await pending();f.reload();server(f,[{skillId:1357,[field]:Date.now()+3*3600000}]);
 assert.equal(await f.B.paymentReconcile(),true);assert.equal(f.env.payments.blocked(),false);assert.equal(f.env.rt.tbuff.fa.length,0);
 await f.B.paymentReconcile();assert.equal(f.pays(),1);assert.equal(f.env.rt.actionPayments.history.length,1);
});
for(const bad of ['expired','missing','wrong-skill','wrong-character','old-effect'])test(`FA: ${bad} не снимает блокировку и не повторяет покупку`,async()=>{
 const f=await pending(),future=Date.now()+3*3600000;
 if(bad==='old-effect')f.env.rt.actionPayments.pending.evidence.before={1357:future};
 const rows=bad==='missing'?[]:[{skillId:bad==='wrong-skill'?1413:1357,expiresAt:bad==='expired'?Date.now()-1:future}];
 server(f,rows,bad==='wrong-character'?'other':'hero');
 assert.equal(await f.B.paymentReconcile(),false);await f.B.townBuffStep();assert.ok(f.env.payments.blocked());assert.equal(f.pays(),1);
});
for(const change of ['lease','owner','character','payment'])test(`FA: поздний expiresAt при смене ${change} не подтверждает чужую квитанцию`,async()=>{
 const f=await pending();f.env.gameGet=async()=>({ok:true,json:async()=>{
  if(change==='lease')f.env.leaseEpoch++;if(change==='owner')f.env.tabOwner=false;if(change==='character')f.env.rt.char='other';
  if(change==='payment')f.env.rt.actionPayments.pending={...f.env.rt.actionPayments.pending,id:'replacement'};
  return {character:{name:'hero',activeBuffs:[{skillId:1357,expiresAt:Date.now()+3*3600000}]}};
 }});assert.equal(await f.B.paymentReconcile(),false);assert.ok(f.env.payments.blocked());assert.equal(f.env.rt.actionPayments.history,undefined);
});
function dispatchFor(f,p){
 const box={Date};vm.runInNewContext(read('modules/actions.js'),box);let gets=0;
 const env={...p.env,rt:f.env.rt,mode:()=> 'farm',lease:()=>p.env.leaseEpoch,page:()=>'/battle.html?spawnId=first-mob',
  isBattle:()=>true,victory:f.combat.victory,runCombat:f.combat.battle,interrupted:()=>false,jobs:()=>[],
  paymentPending:()=>p.env.payments.pending(),reconcile:async()=>{gets++;await p.B.paymentReconcile();}};
 Object.defineProperties(env,{on:{get:()=>p.env.on},tabOwner:{get:()=>p.env.tabOwner}});
 const A=box.L2V7Factories.actions(env);A.enterFrame();return {A,gets:()=>gets};
}
test('сквозной: unknown → живой бой → победа → сверка expiresAt → следующий моб без ручного hunt',async()=>{
 const p=await pending(),f=flowFixture('fighter');Object.assign(f.env.rt,p.env.rt);p.env.rt=f.env.rt;
 f.env.warlock={chainBlocked:()=>p.env.payments.blocked()};
 server(p,[{skillId:1357,expiresAt:Date.now()+3*3600000}]);const d=dispatchFor(f,p);
 await d.A.dispatch();assert.equal(d.gets(),0);assert.equal(f.env.rt.kills,1);assert.equal(f.events.includes('hunt'),false);assert.equal(f.combat.victory(),true);
 await d.A.dispatch();assert.equal(d.gets(),1);assert.equal(p.env.payments.blocked(),false);
 assert.equal(await d.A.dispatch(),false);await f.combat.battle();
 assert.equal(f.events.filter(x=>x==='hunt').length,1);assert.equal(f.events.includes('map'),false);assert.equal(p.pays(),1);
});
test('победа с неподтверждённой оплатой: только GET, без новой охоты и без спама',async()=>{
 const p=await pending(),f=flowFixture('fighter');Object.assign(f.env.rt,p.env.rt);p.env.rt=f.env.rt;f.setWon(true);f.hp.textContent='0 / 1000';
 const d=dispatchFor(f,p);for(let i=0;i<30;i++)await d.A.dispatch();assert.equal(d.gets(),1);assert.equal(f.events.includes('hunt'),false);assert.ok(p.env.payments.blocked());assert.equal(p.pays(),1);
});
test('Stop после победы не запускает сверку и новую охоту',async()=>{
 const p=await pending(),f=flowFixture('fighter');f.setWon(true);p.env.on=false;const d=dispatchFor(f,p);
 assert.equal(await d.A.dispatch(),false);assert.equal(d.gets(),0);assert.equal(f.events.includes('hunt'),false);
});
