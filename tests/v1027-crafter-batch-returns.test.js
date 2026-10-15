'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(rt={},bag={}){
 const b={console,Date,sessionStorage:{getItem:()=>null,setItem(){}},location:{pathname:'/map.html'},document:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../modules/mammon.js'),'utf8'),b);
 const env={rt:clone(rt),cfg:{mmCrafter:'Crafter',mmGoalItem:920018,mmGoalLvl:1},setRt:async p=>{Object.assign(env.rt,p);return {ok:true}},rec(){},ITEMS:{},FARM:{res:{}},invQty:id=>bag[id]||0};
 return {env,M:b.L2V7Factories.mammon(env)};
}
const batch=()=>({to:'Crafter',t0:Date.now()-1000,at:{1880:4,1868:50},ret:{1884:40}});
const mail=(id,qty,itemId=1884)=>({attachmentId:id,senderName:'Crafter',itemId,name:'material',qty,createdAt:new Date().toISOString(),claimedAt:new Date().toISOString()});
test('Cord40: split10+10+20 consumes exactly two craft batches across reload',()=>{
 let f=fixture({mmCraft:batch()});const a=mail('a',10),b=mail('b',10),c=mail('c',20);
 f.M.mailList([a]);assert.deepEqual(clone(f.env.rt.mmCraft.at),{1880:2,1868:25,1884:10});
 f=fixture(f.env.rt);f.M.mailList([a,b]);assert.deepEqual(clone(f.env.rt.mmCraft.at),{1880:2,1868:25});
 f.M.mailList([a,b]);assert.deepEqual(clone(f.env.rt.mmCraft.at),{1880:2,1868:25});
 f.M.mailList([a,b,c]);assert.equal(f.env.rt.mmCraft,null);
});
test('partial return of single output batch keeps unreturned produced stock',()=>{
 const C=batch();C.at={1880:2,1868:25};C.ret={1884:20};const f=fixture({mmCraft:C});f.M.mailList([mail('a',1)]);assert.deepEqual(clone(f.env.rt.mmCraft.at),{1884:19});
 f.M.mailList([mail('b',19)]);assert.equal(f.env.rt.mmCraft,null);
});
test('MetallicFiber split returns preserve nested Cord output through reload',()=>{
 let f=fixture({mmCraft:{to:'Crafter',t0:Date.now()-1000,at:{1873:30,1880:4,1868:50},ret:{1895:40}}});const a=mail('a',10,1895),b=mail('b',10,1895),c=mail('c',20,1895);
 f.M.mailList([a]);assert.deepEqual(clone(f.env.rt.mmCraft.at),{1873:15,1880:2,1868:25,1895:10});f=fixture(f.env.rt);f.M.mailList([a,b,c]);assert.equal(f.env.rt.mmCraft,null);
});
test('receipts already counted in completed batch cannot consume next batch',()=>{
 let f=fixture({mmCraft:batch()});const old=mail('old',40);f.M.mailList([old]);assert.equal(f.env.rt.mmCraft,null);
 f=fixture(f.env.rt);f.env.rt.mmCraft=batch();f.M.mailList([old]);assert.deepEqual(clone(f.env.rt.mmCraft.at),batch().at);
 f.M.mailList([old,mail('new',40)]);assert.equal(f.env.rt.mmCraft,null);
});
test('duplicate attachment on same response is counted only once',()=>{
 const f=fixture({mmCraft:batch()}),a=mail('same',10);f.M.mailList([a,a]);assert.deepEqual(clone(f.env.rt.mmCraft.at),{1880:2,1868:25,1884:10});
});
test('more returned than funded does not manufacture phantom residual stock',()=>{
 const C=batch();C.at={1880:2,1868:25};C.ret={1884:20};const f=fixture({mmCraft:C});f.M.mailList([mail('gift',25)]);assert.equal(f.env.rt.mmCraft,null);
});
test('raw material return closes batch without inventing crafted output',()=>{
 const f=fixture({mmCraft:batch()});f.M.mailList([mail('steel',4,1880),mail('thread',50,1868)]);assert.equal(f.env.rt.mmCraft,null);
});
test('unclaimed, unrelated sender and unexpected material do not consume craft stock',()=>{
 const f=fixture({mmCraft:batch()});f.M.mailList([{...mail('unclaimed',10),claimedAt:null},{...mail('other',10),senderName:'Other'},mail('unexpected',1,1893)]);assert.deepEqual(clone(f.env.rt.mmCraft.at),batch().at);
});
test('plan asks for complete unavoidable batch output in craft instructions and return list',()=>{
 const f=fixture({mmEq:{belt:[920018,0]},mmCost:{'920018:0':{a:0,c:0,m:[[1884,'Cord',21]]}}},{1880:4,1868:50});const P=f.M.goalAll();assert.equal(P.cmiss,0);assert.equal(P.craft.find(x=>x.id===1884).runs,2);assert.equal(P.craft.find(x=>x.id===1884).qty,40);assert.equal(P.ret[1884],40);assert.equal(P.tot[0].need,21);
});
for(const kind of ['actor','lease','stop','kick'])test(`old mail response after ${kind} cannot settle a new party`,async()=>{
 const f=fixture({char:'HeroA',manualKickAt:1,mmCraft:batch()});Object.assign(f.env,{on:true,tabOwner:true,leaseEpoch:'A'});
 f.env.gameGet=async()=>{if(kind==='actor')f.env.rt={char:'HeroB',mmCraft:batch()};if(kind==='lease')f.env.leaseEpoch='B';if(kind==='stop')f.env.on=false;if(kind==='kick')f.env.rt.manualKickAt=2;
  return {ok:true,json:async()=>({attachments:[mail('old-profile',40)],totalPages:1})};};
 assert.equal(await f.M.mailPoll(),null);assert.deepEqual(clone(f.env.rt.mmCraft.at),batch().at);assert.equal(f.env.rt.mmMail,undefined);
});
