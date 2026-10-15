'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./v1015-magister.test.js');
function missing(o={}) {
 const f=fixture({rank:2,max:3,...o}),get=f.ctx.gameGet;
 f.ctx.gameGet=async path=>{const r=await get(path),json=r.json;r.json=async()=>{
  const d=await json();
  if(path==='/character')d.character.learnedBattleSkillsDetail=[{battleId:'l2_123',level:f.rank()}];
  else if(f.rank()===3)d.skills=[];
  return d;
 };return r};return f;
}
test('maxed skill omitted from guild is confirmed by fresh exact character rank',async()=>{
 const f=missing();await f.step();assert.equal(f.posts().length,1);assert.equal(f.rank(),3);
 assert.equal(f.ctx.rt.magPending['0:human_warlock'],undefined);assert.equal(f.ctx.rt.magister,null);
});
test('reload with omitted max rank resolves durable receipt without another SP payment',async()=>{
 const f=missing({rank:3,rt:{magPending:{'0:human_warlock':{id:'l2_123',name:'Blaze',rank:2,revision:9,sp:1100,t:900000}}}});
 await f.step();assert.equal(f.posts().length,0);assert.equal(f.ctx.rt.magPending['0:human_warlock'],undefined);
});
for(const kind of ['other skill','unchanged rank','old revision','other class','Stop'])test('missing catalog is insufficient: '+kind,async()=>{
 const f=missing(),get=f.ctx.gameGet;
 f.ctx.gameGet=async path=>{const r=await get(path),json=r.json;r.json=async()=>{const d=await json();
  if(path==='/character'&&f.rank()===3){
   if(kind==='other skill')d.character.learnedBattleSkillsDetail[0].battleId='l2_other';
   if(kind==='unchanged rank')d.character.learnedBattleSkillsDetail[0].level=2;
   if(kind==='old revision')d.character.revision=10;
   if(kind==='other class')d.character.l2Profession='human_warrior';
   if(kind==='Stop')f.ctx.on=false;
  }return d};return r};
 await f.step();assert.equal(f.posts().length,1);assert.ok(f.ctx.rt.magPending['0:human_warlock']);
});
