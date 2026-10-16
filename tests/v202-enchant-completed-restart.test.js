'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../modules/enchant.js'),'utf8');
async function fixture(bag=false){
 const row={itemId:8688,enchant:3,enchantPAtkBonus:0,enchantMAtkBonus:18,qty:1,clanWeaponUid:'own'};
 const snap={name:'Hero',revision:100,adena:1000,inventory:{eq:bag?{}:{l1:row},stacks:bag?[row]:[]}};
 const hints={itemSlotHints:{8688:'rhand'},itemGradeHints:{8688:'A'}};let readFail=false,afterRead=null;
 const env={on:true,tabOwner:true,cfg:{enchantMode:true,enchant:{enabled:true,maxAttempts:2,maxScrolls:2,queue:[]}},rt:{char:'Hero'},canRun:()=>true,canStartCompleted:()=>true,
 setRt:async p=>{Object.assign(env.rt,p);return {ok:true}},setStatus:s=>env.status=s,gameGet:async url=>{await afterRead?.();return {ok:!readFail,json:async()=>JSON.parse(JSON.stringify(url==='/character'?{character:snap}:hints))}}};
 const box={};vm.runInNewContext(source,box);const m=box.L2V7Factories.enchant(env);
 const scan=await m.readItems(),q={...scan.items[0],key:'own-key',targetLevel:4,weaponMode:'magic',rules:{}};env.cfg.enchant.queue=[q];assert.equal(await m.command('start'),true);
 row.enchant=4;row.enchantMAtkBonus=24;snap.revision++;
 const final=m.snapshotItems(snap)[0],old={...env.rt.enchant,status:'done',items:[{...env.rt.enchant.items[0],...final,key:q.key,done:true,attempts:1,successes:1}],totals:{...env.rt.enchant.totals,attempts:1,successes:1,scrolls:1}};
 env.rt.enchant=old;env.cfg.enchantMode=false;q.targetLevel=5;
 return {env,m,snap,row,q,old,fail:()=>readFail=true,after:f=>afterRead=f};
}
for(const bag of [false,true])test('new series preserves exact completed '+(bag?'bag token':'equipped item')+' and resets counters',async()=>{
 const f=await fixture(bag);assert.equal(await f.m.command('start'),true);const s=f.env.rt.enchant;
 assert.equal(s.status,'running');assert.equal(s.items[0].start,4);assert.equal(s.items[0].level,4);assert.equal(s.items[0].attempts,0);assert.equal(s.totals.attempts,0);
 assert.equal(s.items[0].targetInstanceId,bag?'bag:8688:4:0:24:own':'eq:l1');assert.equal(f.env.rt.enchantArchive[0].totals.attempts,1);
});
for(const [name,change] of Object.entries({
 wrongCharacter:f=>f.old.char='Other',changedKey:f=>f.q.key='other',changedBinding:f=>f.q.targetInstanceId='eq:l2',manualEnchant:f=>f.row.enchant=5,
 changedUid:f=>f.row.clanWeaponUid='other',movedSlot:f=>{f.snap.inventory.eq.l2=f.row;delete f.snap.inventory.eq.l1},unknown:f=>f.old.pending={id:'unknown'},
 malformedBinding:f=>f.old.cfgSig='broken',duplicateWitness:f=>f.old.items.push({...f.old.items[0]}),notSelected:f=>f.env.canStartCompleted=()=>false,
 stopped:f=>f.env.on=false,lostOwner:f=>f.env.tabOwner=false,failedRead:f=>f.fail(),guardDuringRead:f=>f.after(()=>{f.env.canStartCompleted=()=>false})
}))test('restart refuses '+name+' and keeps completed evidence',async()=>{
 const f=await fixture();change(f);assert.equal(await f.m.command('start'),false);assert.equal(f.env.rt.enchant,f.old);assert.equal(f.env.rt.enchantArchive,undefined);
});
