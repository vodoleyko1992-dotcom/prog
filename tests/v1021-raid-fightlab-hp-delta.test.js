'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../modules/fightlab.js','utf8');
test('журнал РБ отличает распознанные удары от полного падения HP цели',()=>{
 let now=1000000;const notes=[];const env={rt:{},cfg:{},mobTitle:()=>'',isBoss:()=>true,isChamp:()=>false,
  actName:()=> 'Blaze',rec:(...x)=>notes.push(x.join(' ')),fmtT:x=>String(x),setRt:async p=>Object.assign(env.rt,p)};
 const box={console,Math,Date:{now:()=>now},URLSearchParams};box.globalThis=box;vm.runInNewContext(source,box);
 const F=box.L2V7Factories.fightlab(env),id='l2dop_rb_1';
 F.onNet('/game/battle/start',{status:200,bt:{spawn:id,name:'Boss',kind:'raid',mob:100000,mobMax:100000,seq:0,log:[]}});
 now+=1000;F.onNet('/game/battle/action',{status:200,req:{action:'blaze',battleSpawnId:id},bt:{spawn:id,mob:50000,mobMax:100000,seq:1,log:['Полум’я 1000']}});
 now+=9000;F.onNet('/game/battle/action',{status:200,req:{action:'blaze',battleSpawnId:id},bt:{spawn:id,mob:0,mobMax:100000,seq:2,log:['Полум’я 1000'],end:true,win:true}});
 const s=F.lastSum();assert.equal(s.dps,200);assert.equal(s.hpDps,10000);assert.equal(s.hpLoss,100000);
 assert.match(notes.join(' '),/распознано ударов 2000 \(≈200\/с\).*HP РБ уменьшилось на 100000 \(≈10000\/с/);
 assert.match(notes.join(' '),/возможный урон других игроков/);
});
