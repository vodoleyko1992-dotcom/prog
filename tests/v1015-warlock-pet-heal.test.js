'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {flowFixture}=require('./warlock-combat-fixture.cjs');
async function choice({pct=40,resummon=true,summonCd=0,healCd=0,preferHeal='heal',manualHeal=false,keyChange=false,captcha=false,stop=false,lease=false}={}){
 const f=flowFixture('pet'), heal={title:'Servitor Heal',getAttribute:()=>null};
 f.slots.push(heal);Object.assign(f.env.cfg,{nPetBuffs:'',petBuffAuto:false,petHealAt:50,petResummonAt:25,petResummon:resummon,petHealPrefer:preferHeal});
 const origIl=f.env.ilOf,origAction=f.env.slotAction;
 f.env.ilOf=b=>b===heal?{target:'PET',c:'Лечение',mp:49}:origIl(b);
 f.env.slotAction=b=>b===heal?'l2_1127':origAction(b);
 const pet={t:Date.now(),has:true,key:'kai_the_cat',hp:pct*100,maxHp:10000};f.env.petState=()=>({...pet,t:Date.now()});
 f.env.gameBusy=()=>{if(manualHeal)pet.hp=8000;if(keyChange){pet.key='mew_the_cat';pet.hp=8000;}if(stop)f.env.on=false;if(lease)f.env.tabOwner=false;if(captcha)f.env.antibotState=()=>true;return {busy:false,end:0};};
 f.env.combatCooldown.skillWait=action=>(action===origAction(f.summon)?summonCd:action==='l2_1127'?healCd:0);
 f.env.slotCd=()=>null;
 const chosen=[];f.env.fire=b=>{chosen.push(b.title);f.env.on=false;return false;};
 try{await f.combat.battle()}catch(e){if(e.message!=='bounded-loop')throw e;}
 return chosen[0];
}
test('independent heal threshold40% remains active while resummon25% enabled',async()=>assert.equal(await choice(),'Servitor Heal'));
test('explicit resummon20% selects permitted same pet resummon when ready',async()=>assert.equal(await choice({pct:20,preferHeal:'resummon'}),'Summon Kai the Cat'));
test('20% summon cooldown falls back to ready heal',async()=>assert.equal(await choice({pct:20,summonCd:5000}),'Servitor Heal'));
test('40% heal cooldown does not spend summon above resummon threshold',async()=>assert.equal(await choice({pct:40,healCd:5000}),'Blaze'));
test('resummon OFF uses healing threshold40%',async()=>assert.equal(await choice({pct:40,resummon:false}),'Servitor Heal'));
test('healthy70% leaves both recovery actions unused',async()=>assert.equal(await choice({pct:70}),'Blaze'));

test('default20% prefers ready heal over permitted resummon',async()=>assert.equal(await choice({pct:20}),'Servitor Heal'));
test('default20% heal cooldown falls back to permitted resummon',async()=>assert.equal(await choice({pct:20,healCd:5000}),'Summon Kai the Cat'));

test('fresh manual heal during gameFree suppresses stale pet cast',async()=>assert.equal(await choice({pct:40,manualHeal:true}),'Blaze'));
test('new pet during gameFree suppresses cast for previous pet',async()=>assert.equal(await choice({pct:40,keyChange:true}),'Blaze'));
test('captcha during gameFree suppresses pet heal',async()=>assert.equal(await choice({pct:40,captcha:true}),undefined));
async function outcome({afterHp=3805,afterMax=6528,accepted=true,newKey=false,stale=false}={}){
 const f=flowFixture('pet'),pet={t:Date.now(),has:true,key:'kai_the_cat',hp:1000,maxHp:7491};
 Object.assign(f.env.cfg,{nPetBuffs:'',petBuffAuto:false,petHealAt:50,petResummonAt:25,petResummon:true,petHealPrefer:'resummon'});
 f.env.petState=()=>pet;
 f.env.fire=b=>{f.events.push(b.title);if(accepted){Object.assign(pet,{hp:afterHp,maxHp:afterMax,key:newKey?'mew_the_cat':'kai_the_cat',t:stale?pet.t:Date.now()+5});f.setNet({start:1,done:1,ok:true,okN:1,action:f.env.slotAction(b)});}f.env.on=false;return accepted;};
 await f.combat.battle();return f;
}
test('accepted partial resummon does not require90% HP or pretend full recovery',async()=>{const f=await outcome();assert.equal(f.env.rt.petResummon.kai_the_cat,true);assert.ok(f.logs.some(l=>l.includes('3805/6528')&&l.includes('наблюдаемый прирост')));});
test('accepted zero net gain never persists permanent false from one snapshot',async()=>{const f=await outcome({afterHp:1000});assert.notEqual(f.env.rt.petResummon?.kai_the_cat,false);assert.ok(f.logs.some(l=>l.includes('прирост HP не подтверждён')));});
test('rejected cast cannot learn recovery success or failure',async()=>{const f=await outcome({accepted:false});assert.equal(f.env.rt.petResummon,undefined);});
test('changed pet result cannot train previous pet recovery',async()=>{const f=await outcome({newKey:true});assert.equal(f.env.rt.petResummon,undefined);});
test('stale aftersnapshot cannot train recovery',async()=>{const f=await outcome({stale:true});assert.equal(f.env.rt.petResummon,undefined);});

test('Stop during gameFree prevents selected recovery cast',async()=>assert.equal(await choice({pct:40,stop:true}),undefined));
test('lease loss during gameFree prevents selected recovery cast',async()=>assert.equal(await choice({pct:40,lease:true}),undefined));
