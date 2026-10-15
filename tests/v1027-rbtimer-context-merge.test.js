'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const H=3600000;
function fixture(){
 const box={Date,Math,console,sessionStorage:{getItem:()=>null,setItem(){}}};box.globalThis=box;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../modules/rbtimer.js'),'utf8'),box);
 const calls=[],writes=[];
 const env={rt:{char:'First',lvl:75,classCur:{prof:'human_warlock',slot:0}},cfg:{rbTimers:true},RB_WIN:15,heroLevel:()=>env.rt.lvl,sleep:async()=>{},rec(){},
  setRt:async p=>{writes.push(p);Object.assign(env.rt,p)},gameGet:async p=>{calls.push(p);return {ok:false}}};
 return {T:box.L2V7Factories.rbtimer(env),env,calls,writes};
}
const reply=()=>({page:1,totalPages:1,bosses:[{spawnId:'l2dop_rb_9',name:'Boss',level:75,bossType:'raid',isAlive:true,adenaCost:100000,canAttack:true}]});
for(const phase of ['fetch','json'])for(const change of ['hero','subclass','disabled'])test('timer poll discards '+phase+' response after '+change,async()=>{
 const f=fixture();let release;const gate=new Promise(r=>release=r);
 f.env.gameGet=async p=>{f.calls.push(p);if(p.includes('epic'))return {ok:false};if(phase==='fetch')await gate;return {ok:true,json:async()=>{if(phase==='json')await gate;return reply()}}};
 const pending=f.T.tick();await Promise.resolve();
 if(change==='hero')f.env.rt={char:'Second',lvl:25,classCur:{prof:'warrior',slot:0}};
 if(change==='subclass')f.env.rt.classCur={prof:'dark_avenger',slot:1};
 if(change==='disabled')f.env.cfg.rbTimers=false;
 release();assert.equal(await pending,false);assert.equal(f.writes.length,0);assert.equal(f.calls.length,1,'no further pages or epic GET after cancellation');
 f.env.cfg.rbTimers=true;assert.equal(await f.T.tick(),true,'new context can poll without inheriting old ten-minute cooldown');
});
test('same-profile timer poll still refreshes list and epics',async()=>{
 const f=fixture();f.env.gameGet=async p=>{f.calls.push(p);return {ok:true,json:async()=>p.includes('epic')?{bosses:[{spawnId:'l2dop_rb_29001',name:'Queen',level:40,bossType:'epic',isAlive:false,respawnHours:12}]}:reply()}};
 assert.equal(await f.T.tick(),true);assert.equal(f.env.rt.rbList.l2dop_rb_9.alive,true);assert.equal(f.env.rt.rbTimer.b.l2dop_rb_29001.rh,12);assert.equal(f.calls.length,2);
});
test('tour polling also rejects subclass change even if caller stays active',async()=>{
 const f=fixture();f.env.rt.rbList={old:{lvl:75,page:1}};let release;const gate=new Promise(r=>release=r);
 f.env.gameGet=async()=>{await gate;return {ok:true,json:async()=>reply()}};
 const pending=f.T.tourTick({active:()=>true});f.env.rt.classCur={prof:'warrior',slot:1};release();assert.equal(await pending,false);assert.equal(f.writes.length,0);
});
test('new death cycle wins over ancient precise own kill in either merge order',()=>{
 const {T}=fixture(),now=Date.now(),old=now-20*H,fresh=now-H;
 const A={b:{rb:{al:false,dl:old,dh:old,k:old,ls:old+1000}}},B={b:{rb:{al:false,dl:fresh-1000,dh:fresh,ls:now}}};
 for(const args of [[A,B],[B,A]]){const M=T.merge(...args);assert.equal(M.b.rb.dh,fresh);assert.equal(M.b.rb.dl,fresh-1000);assert.equal(M.b.rb.k,undefined);assert.equal(T.timerOf(M,'rb',now).late,false)}
});
test('overlapping same-cycle broad death observation keeps precise own kill',()=>{
 const {T}=fixture(),now=Date.now(),k=now-H;
 const M=T.merge({b:{rb:{al:false,dl:k,dh:k,k,ls:k}}},{b:{rb:{al:false,dl:0,dh:now,ls:now}}});
 assert.equal(M.b.rb.dl,k);assert.equal(M.b.rb.dh,k);assert.equal(M.b.rb.k,k);assert.equal(M.b.rb.ls,now);
});
test('fresh resurrection removes old death metadata when merging',()=>{
 const {T}=fixture(),now=Date.now();const M=T.merge({b:{rb:{al:false,dl:now-H,dh:now-H,k:now-H,ls:now-H}}},{b:{rb:{al:true,ch:now,ls:now}}});
 assert.equal(M.b.rb.al,true);assert.equal(M.b.rb.dl,undefined);assert.equal(M.b.rb.dh,undefined);assert.equal(M.b.rb.k,undefined);
});
test('first dead observation is not a fresh kill: next alive response updates both timer and tour',async()=>{
 const f=fixture(),now=Date.now();f.env.rt.rbTimer={b:{l2dop_rb_9:{al:false,dl:0,dh:now-60000,ls:now-60000}}};
 await f.T.listNote(reply());assert.equal(f.env.rt.rbTimer.b.l2dop_rb_9.al,true);assert.equal(f.env.rt.rbList.l2dop_rb_9.alive,true);
});
test('recent confirmed own kill still rejects stale alive response in timer and tour',async()=>{
 const f=fixture(),now=Date.now();f.env.rt.rbTimer={b:{l2dop_rb_9:{al:false,dl:now-60000,dh:now-60000,k:now-60000,ls:now-60000}}};
 await f.T.listNote(reply());assert.equal(f.env.rt.rbTimer.b.l2dop_rb_9.al,false);assert.equal(f.env.rt.rbList.l2dop_rb_9.alive,false);
});
