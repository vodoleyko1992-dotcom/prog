'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync(__dirname+'/../modules/navigation.js','utf8');
function fixture(opt={}) {
 const loc={pathname:opt.map?'/map.html':'/forum-farm-resources.html',search:'',href:''}, storage=new Map(), records=[], pauses=[];
 let n=0, durable=null, snapshot={name:'Hero',id:'hero-1',revision:100,adena:1000000,cityId:'l2dop_dion',currentZoneId:null,inBattle:false,activeDungeonId:null};
 const btn={dataset:{baseAdenaCost:'50000',adenaCost:'50000'},textContent:'Телепорт 50 000 Adena'};
 const env={on:true,tabOwner:true,cfg:{shopReserve:200000},rt:{char:'Hero',zoneGo:{id:'heine',url:'/forum-farm-resources.html',forum:true,t:1},zoneCat:{heine:{name:'Heine'}}},
  rec:(...a)=>records.push(a),setStatus(){},heroLvl:()=>38,isFarmPage:()=>true,$q:()=>btn,sleep:async()=>{},
  gameGet:async()=>({ok:!opt.getFail,json:async()=>({character:{...snapshot}})}),
  setRt:async p=>{Object.assign(env.rt,p);durable=JSON.parse(JSON.stringify(env.rt));if(opt.stopOnSave&&p.zoneGo?.forumTp)env.on=false;},
  pauseBot:async why=>{pauses.push(why);env.on=false;},waitX:async fn=>fn(),
  fire:()=>{n++;assert.ok(durable.zoneGo.forumTp,'pending persist BEFORE click');
   if(opt.stopOnFire){env.on=false;return;}
   const req={teleportId:'heine',expectedRevision:100,expectedAdenaCost:50000};
   const ch={...snapshot,revision:101,cityId:'l2dop_heine'};
   if(opt.mutate)opt.mutate(req,ch,env);
   if(!opt.noAck) N.onForumTeleportNet('/game/farm-guide/resource-teleport',{method:'POST',status:opt.refused?400:200,req,res:opt.refused?{error:'not_enough_adena'}:{character:ch}});
   if(!opt.wrongTarget&&!opt.refused&&!opt.noArrival) snapshot={...snapshot,cityId:'l2dop_heine',revision:101};
   loc.pathname='/map.html';
  }};
 function load(){const box={console,location:loc,document:{querySelectorAll:()=>[]},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}};vm.runInNewContext(code,box);return box.L2V7Factories.navigation(env);}
 let N=load();
 return {env,loc,pauses,records,storage,btn,step:()=>N.zoneGoStep(),clicks:()=>n,snapshot:()=>snapshot,setSnapshot:p=>Object.assign(snapshot,p),net:(...a)=>N.onForumTeleportNet(...a),reload:()=>{env.rt=JSON.parse(JSON.stringify(durable||env.rt));N=load();},getDurable:()=>durable};
}
test('accepted POST → native map → next tick: route completes and only one payment',async()=>{const f=fixture();await f.step();assert.equal(f.clicks(),1);assert.equal(f.env.rt.zoneGo,null);assert.equal(f.env.rt.zone,'heine');await f.step();assert.equal(f.clicks(),1);assert.equal(f.pauses.length,0);assert.equal(f.loc.href,'');});
test('lost ACK across reload: authoritative character at target completes without another click',async()=>{const f=fixture({noAck:true,stopOnFire:true});await f.step();f.reload();f.env.on=true;f.loc.pathname='/map.html';f.setSnapshot({cityId:'l2dop_heine',revision:101});await f.step();assert.equal(f.clicks(),1);assert.equal(f.env.rt.zoneGo,null);});
test('sync ACK survives chrome storage losing final acknowledgment',async()=>{const f=fixture({noArrival:true});const old=f.env.setRt;f.env.setRt=async p=>{if(p.zoneGo?.forumTp?.ack){f.env.on=false;return;}await old(p);};await f.step();assert.ok(f.storage.size);f.reload();f.env.on=true;await f.step();assert.equal(f.env.rt.zoneGo,null);assert.equal(f.clicks(),1);});
test('unknown response: pause retains pending, reload does not pay twice',async()=>{const f=fixture({noAck:true,noArrival:true});await f.step();assert.equal(f.clicks(),1);assert.ok(f.env.rt.zoneGo.forumTp);assert.equal(f.pauses.length,1);f.reload();f.env.on=true;await f.step();assert.equal(f.clicks(),1);assert.equal(f.pauses.length,2);});
test('old route at Heine after upgrade completes instead of returning to forum',async()=>{const f=fixture({map:true});f.env.rt.zoneGoT=10;f.setSnapshot({cityId:'l2dop_heine'});await f.step();assert.equal(f.env.rt.zoneGo,null);assert.equal(f.clicks(),0);assert.equal(f.loc.href,'');});
test('old attempted route on unrelated map is not paid again',async()=>{const f=fixture({map:true});f.env.rt.zoneGoT=10;await f.step();assert.equal(f.clicks(),0);assert.equal(f.pauses.length,1);assert.equal(f.loc.href,'');});
for(const variant of ['target','actor','revision','cost','route','currentZone','kick']) test('unrelated ACK rejected: '+variant,async()=>{const f=fixture({wrongTarget:true,noArrival:true,mutate:(req,ch,env)=>{if(variant==='target')req.teleportId='dion';if(variant==='actor')ch.id='other';if(variant==='revision')req.expectedRevision=99;if(variant==='cost')req.expectedAdenaCost=0;if(variant==='route')env.rt.zoneGo.url='/other.html';if(variant==='currentZone')ch.currentZoneId='other_zone';if(variant==='kick')env.rt.manualKickAt=1;}});await f.step();assert.equal(f.clicks(),1);assert.ok(f.env.rt.zoneGo);assert.ok(!f.env.rt.zoneGo.forumTp.ack?.ok);});
test('explicit refusal is persisted and cannot cause another purchase',async()=>{const f=fixture({refused:true});await f.step();assert.ok(f.env.rt.zoneGo.forumTp.ack.refused);f.reload();f.env.on=true;await f.step();assert.equal(f.clicks(),1);assert.equal(f.env.rt.zone,undefined);});
test('Stop while persisting intent prevents the click',async()=>{const f=fixture({stopOnSave:true});await f.step();assert.equal(f.clicks(),0);assert.equal(f.pauses.length,0);});
test('unknown character cannot initiate paid route',async()=>{const f=fixture({getFail:true});await f.step();assert.equal(f.clicks(),0);assert.equal(f.pauses.length,1);});
test('pending forum route bypasses obsolete two-minute timeout in main loop',()=>{const s=fs.readFileSync(__dirname+'/../content.js','utf8');assert.ok(s.includes('if (rt.zoneGo.forumTp) { await zoneGoStep(); return true; }'));assert.ok(s.includes('L2V7Modules.navigation.onForumTeleportNet(path, d)'));});

for (const variant of ['character','route','kick']) test('persisted success ACK cannot complete a changed '+variant,async()=>{const f=fixture({noArrival:true});const old=f.env.setRt;f.env.setRt=async p=>{if(p.zoneGo?.forumTp?.ack){f.env.on=false;return;}await old(p);};await f.step();f.reload();f.env.on=true;if(variant==='character')f.env.rt.char='Other';if(variant==='route')f.env.rt.zoneGo.url='/other.html';if(variant==='kick')f.env.rt.manualKickAt=9;await f.step();assert.ok(f.env.rt.zoneGo);assert.equal(f.clicks(),1);assert.equal(f.env.rt.zone,undefined);});
test('failed durable write never clicks payment',async()=>{const f=fixture();f.env.rtCommit=async()=>false;await f.step();assert.equal(f.clicks(),0);assert.equal(f.pauses.length,1);});
