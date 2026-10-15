'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function fixture(kind){
 let rt={char:'HeroA',manualKickAt:1},mutated=false,writeAfter=0,pauseAfter=0;
 const tab={classList:{contains:()=>true}};const doc={querySelector:s=>s.includes('data-mail-tab')?tab:s.includes('l2-mail-empty')?{}:null,querySelectorAll:()=>[],getElementById:()=>null};
 const route={pathname:'/map.html',search:'',href:''},b={console,Date,Event:class {},location:route,document:doc,sessionStorage:{getItem:()=>null,setItem(){}}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../modules/mammon.js'),'utf8'),b);
 const env={get rt(){return rt},set rt(v){rt=v},cfg:{},on:true,tabOwner:true,leaseEpoch:'A',ITEMS:{},FARM:{res:{}},autonomyMode:()=> 'farm',setStatus(){},rec(){},invQty:()=>0,fire:()=>false,$q:()=>null,
 setRt:async p=>{if(mutated)writeAfter++;rt={...rt,...p};return {ok:true}},sleep:async()=>{},waitX:async f=>f(),pauseBot:async()=>{if(mutated)pauseAfter++},isBattle:()=>false,fishNow:()=>false,
 gameGet:async()=>({ok:true,status:200,json:async()=>({attachments:[],items:[],totalPages:1})})};
 const mutate=()=>{mutated=true;if(kind==='actor')rt={char:'HeroB',mmJob:{kind:'claim',t:999},marker:'new'};if(kind==='lease')env.leaseEpoch='B';if(kind==='owner')env.tabOwner=false;if(kind==='stop')env.on=false;if(kind==='kick')rt={...rt,manualKickAt:2};};
 return {env,route,doc,mutate,M:b.L2V7Factories.mammon(env),writes:()=>writeAfter,pauses:()=>pauseAfter};
}
for(const kind of ['actor','lease','stop','owner','kick'])for(const task of ['note','claim','send','near','order','npc'])test(`${task}: ${kind} during awaited page/read cannot write current profile`,async()=>{
 const f=fixture(kind),job={kind:task==='note'?'send':task,t:Date.now(),notes:['task'],note:{},items:[[1869,5,'Iron Ore']],to:'Crafter'};f.env.rt.mmJob=job;
 if(task==='note'){f.route.pathname='/mail-compose.html';f.env.waitX=async()=>{f.mutate();return null};await f.M.noteStep(job);}
 if(task==='claim'){f.route.pathname='/mail.html';let first=true;f.env.waitX=async fn=>{if(first){first=false;f.mutate();return {classList:{contains:()=>true}};}return fn()||'none'};await f.M.claimStep(job);}
 if(task==='send'){f.route.pathname='/item-transfer.html';f.env.invRefresh=async()=>{f.mutate();return {}};await f.M.sendStep(job);}
 if(['near','order','npc'].includes(task)){f.env.gameGet=async()=>{f.mutate();return {ok:true,status:200,json:async()=>({items:[],request:{requestId:'old-A',status:'OPEN',quantity:1},mammonMerchant:{current:{worldX:1,worldY:1}},mammonBlacksmith:{current:{worldX:1,worldY:1}}})}};
  if(task==='near')await f.M.isNear('smith');if(task==='order')await f.M.orderPoll();if(task==='npc')await f.M.npcPoll();}
 assert.equal(f.writes(),0);if(kind==='actor')assert.equal(f.env.rt.marker,'new');
});
test('visit completion interrupted at storage must not pause another actor',async()=>{
 const f=fixture('actor');f.route.pathname='/mammon-blacksmith.html';const set=f.env.setRt;f.env.setRt=async p=>{const r=await set(p);f.mutate();return r};await f.M.visit({kind:'smith'});assert.equal(f.pauses(),0);
});

for(const kind of ['actor','lease','stop','owner','kick'])for(const branch of ['empty','next','full'])test(`claim ${branch}: ${kind} during final mail poll cannot rearm cloned job`,async()=>{
 const f=fixture(kind);f.route.pathname='/mail.html';const job={kind:'claim',t:Date.now(),context:{char:'HeroA',kick:1,mode:'farm'}};f.env.rt.mmJob=job;
 const tab={classList:{contains:()=>true}},msg={textContent:''},button={closest:()=>null};
 f.doc.querySelector=s=>s.includes('data-mail-tab')?tab:s.includes('l2-mail-page-label')?{textContent:'1 / 2'}:s.includes('l2-mail-items-msg')?msg:s.includes('l2-mail-item__claim')&&branch==='full'?button:s.includes('l2-mail-empty')?{}:null;
 f.doc.querySelectorAll=()=>branch==='next'?[{disabled:true},{disabled:false}]:[];
 let waits=0;f.env.waitX=async fn=>{waits++;return branch==='full'&&waits===3?'инвентарь переполнен':fn()};
 f.env.gameGet=async()=>{f.mutate();return {ok:true,status:200,json:async()=>({attachments:[],items:[],totalPages:1})}};
 await f.M.claimStep(job);assert.equal(f.writes(),0);assert.ok(f.env.rt.mmJob);assert.equal(f.route.href,'');
});
test('smith upgrade clone must retain lease captured before storage',async()=>{
 const f=fixture('lease');f.route.pathname='/mammon-blacksmith.html';f.env.cfg={mmGoalItem:920018,mmGoalLvl:1};
 const job={kind:'smith',t:Date.now(),context:{char:'HeroA',kick:1,mode:'farm'}},item={itemId:920018,level:0,nameUk:'Belt',canAfford:true,cost:{adena:1,coinOfLuck:1,materials:[]}};f.env.rt.mmJob=job;
 f.env.gameGet=async()=>({ok:true,status:200,json:async()=>({items:[item]})});
 const set=f.env.setRt;f.env.setRt=async p=>{const r=await set(p);if(p.mmJob?.up)f.mutate();return r};
 await f.M.smith(job);assert.equal(f.writes(),0);assert.ok(f.env.rt.mmJob);assert.equal(f.route.href,'');
});

function sending(f,modalVisible){
 f.route.pathname='/item-transfer.html';const input={value:'',dispatchEvent(){}},submit={},confirm={},form={querySelector:s=>s.includes('button')?submit:input};
 const wrap={dataset:{itemKey:'ore'},querySelector:()=>form},body={textContent:'Надіслати «Iron Ore» гравцю «Crafter»? Кількість: 5'},modal={hidden:false,querySelector:s=>s.includes('body')?body:confirm};
 f.doc.querySelector=s=>s.includes('row-wrap')?wrap:null;f.doc.querySelectorAll=s=>s.includes('row-wrap')?[wrap]:[];f.doc.getElementById=id=>id==='item-transfer-confirm-modal'&&modalVisible?modal:null;
 f.env.invRefresh=async()=>({1869:5});f.env.invQty=()=>5;
 f.env.gameGet=async path=>({ok:true,status:200,json:async()=>path==='/character'?{character:{name:'HeroA',id:'a',revision:1,inventory:{stacks:[{itemId:1869,qty:5}]}}}:path.includes('/sent')?{items:[]}:{totalPages:1,candidates:[{itemId:1869,itemKey:'ore',availableQty:5,stackable:true,transferValueUnitAdena:1}]}});
 const job={kind:'send',t:Date.now(),context:{char:'HeroA',kick:1,mode:'farm'},items:[[1869,5,'Iron Ore']],to:'Crafter'};f.env.rt.mmJob=job;return job;
}
test('send clone cannot rearm lease after clearing unopened modal',async()=>{
 const f=fixture('lease'),job=sending(f,false),set=f.env.setRt;f.env.setRt=async p=>{const r=await set(p);if(p.mmJob&&p.mmJob.cur===null)f.mutate();return r};
 await f.M.sendStep(job);assert.equal(f.writes(),0);assert.ok(f.env.rt.mmJob);assert.equal(f.route.href,'');
});
for(const kind of ['lease','stop'])test(`send cancellation preserves original context after ${kind}`,async()=>{
 const f=fixture(kind),job=sending(f,true);const ticket={id:'p1',char:'HeroA'};
 f.env.payments={blocked:()=>false,prepare:async()=>ticket,sent:()=>false,cancel:async()=>{f.mutate();return true}};f.env.rtCommit=async()=>true;
 await f.M.sendStep(job);assert.equal(f.writes(),kind==='stop'?1:0);
 if(kind==='lease')assert.equal(f.env.rt.mmJob.cur.paymentId,'p1');else assert.equal(f.env.rt.mmJob.cur,null);
});
