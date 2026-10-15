'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createBattleCooldown}=require('../battle-cooldown.js');
function fixture(){let now=1000000;const model=createBattleCooldown(()=>now),net={start:1,done:1,doneT:now};
 const b={title:'Атака',disabled:false,getAttribute:()=>null},cd={hidden:false,classList:{contains:()=>true},querySelector:()=>({textContent:'0.3'})};
 const env={rt:{},slotCd:()=>cd,slotAction:()=> 'attack',skKey:()=> 'атака',slotKind:()=> 'атака',cdSpawn:()=> 'chain',memLeft:()=>0,combatCooldown:model,actNet:()=>net};
 const source=fs.readFileSync(require.resolve('../modules/combat.js'),'utf8');
 const api=vm.runInNewContext(source.slice(source.indexOf('let overlayBusySeen'),source.indexOf('function cdLeft'))+';({ready,cdBusy,pressAt,lostUntil})',{env,Date:{now:()=>now},Map,WeakMap,WeakSet,Math,parseFloat});
 return {model,net,b,env,api,tick:n=>now+=n,now:()=>now,reply:r=>model.observe({action:'attack',battleSpawnId:'chain'},r,200,'chain')};
}
for(const layer of ['full','delta','top'])test('physical attack '+layer+' resumes despite frozen visual timer only after server deadline',()=>{
 const f=fixture(),fields={nextPhysicalAttackAt:5001100,attackIntervalMs:1100},r={serverNowMs:5000000};
 Object.assign(r,layer==='top'?fields:{[layer==='full'?'battle':'delta']:fields});f.reply(r);
 assert.equal(f.api.ready(f.b),false);f.tick(1141);assert.equal(f.api.ready(f.b),true);
});
test('hunt continuation snapshot supplies deadline for the same native chain',()=>{const f=fixture();f.model.observeSync({battle:{serverNowMs:5000000,nextAutoAttackAt:5000300}},'chain');f.tick(341);assert.equal(f.api.ready(f.b),true)});
for(const reason of ['missing','wrong spawn','pending','disabled','aria','old observation','lost click','expired observation'])test('does not bypass '+reason,()=>{
 const f=fixture();if(reason!=='missing')f.reply({serverNowMs:5000000,nextPhysicalAttackAt:5000000});f.tick(100);
 if(reason==='wrong spawn')f.env.cdSpawn=()=> 'other';
 if(reason==='pending')f.net.start++;
 if(reason==='disabled')f.b.disabled=true;
 if(reason==='aria')f.b.getAttribute=()=> 'true';
 if(reason==='old observation')f.api.pressAt.set('атака',f.now());
 if(reason==='lost click')f.api.lostUntil.set('атака',f.now()+700);
 if(reason==='expired observation')f.tick(30000);
 assert.equal(f.api.ready(f.b),false);
});
test('later global rejection does not reset physical deadline',()=>{const f=fixture();f.reply({serverNowMs:5000000,nextPhysicalAttackAt:5005000});f.model.observe({action:'attack',battleSpawnId:'chain'},{serverNowMs:5000100,blockedBy:'global',nextPhysicalAttackAt:0,globalRemainingMs:500},400,'chain');assert.ok(f.model.skillWait('attack','chain')>4900);assert.ok(f.model.globalWait()>0)});
test('older response cannot shorten physical deadline',()=>{const f=fixture();f.reply({serverNowMs:5001000,nextPhysicalAttackAt:5005000});f.reply({serverNowMs:5000000,nextPhysicalAttackAt:0});assert.ok(f.model.skillWait('attack','chain')>3900)});
test('unknown physical field does not clear known cooldown',()=>{const f=fixture();f.reply({serverNowMs:5000000,nextPhysicalAttackAt:5005000});f.reply({serverNowMs:5000100});assert.ok(f.model.skillWait('attack','chain')>4900)});

for(const field of ['timestamp','remaining'])test('explicit attack cooldown rejection replaces an expired deadline: '+field,()=>{
 const f=fixture();f.reply({serverNowMs:5000000,nextPhysicalAttackAt:0});f.tick(100);
 f.model.observe({action:'attack',battleSpawnId:'chain'},{serverNowMs:5000100,error:'ATTACK_COOLDOWN',...(field==='timestamp'?{nextPhysicalAttackAt:5001200}:{remainingMs:1100})},400,'chain');
 assert.equal(f.api.ready(f.b),false);f.tick(1141);assert.equal(f.api.ready(f.b),true);
});
