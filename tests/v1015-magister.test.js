'use strict';
const fs=require('fs'),vm=require('vm'),test=require('node:test'),assert=require('node:assert/strict');
const content=fs.readFileSync(require('path').join(__dirname,'../content.js'),'utf8');
const start=content.indexOf('const MAG_SKIP_DEF ='),end=content.indexOf('// ---------- выбило из игры:',start);
const source=content.slice(start,end);
function fixture(o={}){
 let now=1000000,revision=10,rank=o.rank??0,sp=o.sp??1000,calls=[],gets=[],readN=0;
 const ctx={console,URLSearchParams,Date:{now:()=>now},location:{pathname:o.path||'/magister.html',search:'?npcId=30344',href:''},
 on:true,tabOwner:true,cfg:{autoMagister:true,...o.cfg},rt:{char:'hero',lvl:75,classCur:{prof:'human_warlock',slot:0},zone:'valley',panel:[{name:'Blaze'}],skills:{blaze:{dmgN:2}},magEnabled:true,...o.rt},
 heroNick:()=>ctx.rt.char,heroLevel:()=>ctx.rt.lvl,autonomyMode:()=>ctx.cfg.catMode?'cat':ctx.cfg.fishMode?'fish':'auto',isBattle:()=>ctx.location.pathname==='/battle.html',victory:()=>o.win!==false,
 abHold:()=>!!ctx.rt.abChal,antibotState:()=>ctx.rt.abChal?'check':ctx.rt.pveBlockUntil?'blocked':null,fishNow:()=>!!ctx.cfg.fishMode,names:s=>String(s).split(',').map(x=>x.trim().toLowerCase()),ilOf:()=>({c:'Маг. атака'}),petState:()=>null,rec(){},setStatus(){},rtCommit:async()=>true,
 setRt:p=>{Object.assign(ctx.rt,p);o.write?.(p,ctx);return Promise.resolve({ok:true})},toMap:async()=>{calls.push('map');ctx.location.pathname='/map.html'},catGo:async id=>calls.push('cat:'+id)};
 const character=()=>({name:ctx.rt.char,level:o.serverLevel??ctx.rt.lvl,l2Profession:ctx.rt.classCur.prof,classSlots:{activeSlot:ctx.rt.classCur.slot},revision});
 const catalog=()=>({npc:{npcId:30344},profession:{l2Profession:o.catalogProf||ctx.rt.classCur.prof},characterSp:sp,
 skills:[{battleId:'l2_123',nameUk:o.name||'Blaze',minLevel:o.minLevel??1,spCost:o.cost??100,skillLevel:rank,maxSkillLevel:o.max??2,canLearn:o.canLearn!==false,kind:o.passive?'passive':'active'}]});
 ctx.L2V7Modules={story:{charNote(){}},subclass:{charNote(){}},tvt:{tvtHold:()=>!!o.hold}};
 ctx.gameGet=async path=>{gets.push(path);readN++;await o.read?.(path,ctx,readN);return {ok:true,status:200,json:async()=>path==='/character'?{character:character()}:catalog()}};
 ctx.gamePost=async(path,body)=>{assert.ok(ctx.on&&ctx.tabOwner);calls.push({path,body});if(o.post){const r=await o.post({ctx,body,rank,sp,revision});if(r)return r;}
  if(o.status)return {ok:false,status:o.status};sp-=o.cost??100;revision++;if(o.ack!==false)rank++;return {ok:true,status:200}};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 const seed=()=>ctx.rt.magister={t:now,char:ctx.rt.char,key:`${ctx.rt.classCur.slot}:${ctx.rt.classCur.prof}`,prof:ctx.rt.classCur.prof,slot:ctx.rt.classCur.slot,lvl:ctx.rt.lvl,kick:ctx.rt.manualKickAt||0,home:{zone:'valley',mode:'auto'}};
 seed();return {ctx,calls,gets,start:(a=false)=>ctx.magisterStart(a),step:()=>ctx.magisterStep(),seed,rank:()=>rank,sp:()=>sp,posts:()=>calls.filter(x=>typeof x==='object'),setRank:r=>rank=r,tick:n=>now+=n,reload:()=>vm.runInContext(source.replace('const MAG_SKIP_DEF','globalThis.MAG_SKIP_DEF').replace('const magActive','globalThis.magActive').replace('const magIdentity','globalThis.magIdentity').replace('const magSame','globalThis.magSame').replace('let magBusy = false','magBusy = false').replace('let magUnsent = new WeakSet()','magUnsent = new WeakSet()'),ctx)};
}
test('initial enable checks current level rather than installing baseline',async()=>{const f=fixture({rt:{magEnabled:false,magister:null,magLvl:74,magChecked:{'0:human_warlock':{lvl:75}}}});f.ctx.rt.magister=null;assert.equal(await f.start(),true);assert.equal(f.ctx.rt.magister.lvl,75)});
test('every +1: checked74 schedules75',async()=>{const f=fixture({rt:{magChecked:{'0:human_warlock':{lvl:74}}}});f.ctx.rt.magister=null;assert.equal(await f.start(),true)});
test('already checked75 avoids repeat visit',async()=>{const f=fixture({rt:{magChecked:{'0:human_warlock':{lvl:75}}}});f.ctx.rt.magister=null;assert.equal(await f.start(),false)});
test('active subclass lower level gets independent check',async()=>{const f=fixture({rt:{lvl:40,classCur:{prof:'dwarf_artisan',slot:1},magChecked:{'0:human_warlock':{lvl:75}}}});f.ctx.rt.magister=null;assert.equal(await f.start(),true);assert.equal(f.ctx.rt.magister.key,'1:dwarf_artisan')});
test('actual rank + SP confirmation learns all affordable ranks once',async()=>{const f=fixture();await f.step();assert.equal(f.posts().length,2);assert.equal(f.rank(),2);assert.equal(f.sp(),800);assert.equal(f.ctx.rt.skills.blaze.dmgN,0);assert.equal(f.ctx.rt.magChecked['0:human_warlock'].lvl,75);assert.equal(f.ctx.location.href,'/map.html')});
test('single-rank skill is learned without DOM fraction',async()=>{const f=fixture({max:1});await f.step();assert.equal(f.posts().length,1)});
for(const [n,o] of Object.entries({reserve:{cfg:{magisterSpReserve:950}},skip:{cfg:{magisterSkip:'Blaze'}},SP:{sp:99},level:{minLevel:76},locked:{canLearn:false},max:{rank:2},class:{catalogProf:'dwarf_artisan'}}))test(n+' gate prevents paid POST',async()=>{const f=fixture(o);await f.step();assert.equal(f.posts().length,0)});
test('SP drop without rank confirmation forbids second request and retains receipt',async()=>{const f=fixture({ack:false});await f.step();assert.equal(f.posts().length,1);assert.ok(f.ctx.rt.magPending['0:human_warlock']);assert.equal(f.ctx.rt.skills.blaze.dmgN,2);f.tick(61000);await f.start();await f.step();assert.equal(f.posts().length,1)});
test('reload after accepted response confirms old rank before next payment',async()=>{const f=fixture({post:({ctx})=>{ctx.on=false}});await f.step();assert.equal(f.posts().length,1);assert.ok(f.ctx.rt.magPending['0:human_warlock']);f.ctx.on=true;f.ctx.gamePost=async(path,body)=>{f.calls.push({path,body});f.setRank(2);return {ok:true,status:200}};f.reload();await f.step();assert.equal(f.posts().length,2);assert.equal(f.posts()[1].body.expectedRevision,11);assert.equal(f.ctx.rt.magPending['0:human_warlock'],undefined)});
test('409 returns without immediate POST retry and does not mark level learned',async()=>{const f=fixture({status:409});await f.step();assert.equal(f.posts().length,1);assert.equal(f.ctx.rt.magPending['0:human_warlock'],undefined);assert.equal(f.ctx.rt.magChecked,undefined);assert.equal(await f.start(),false)});
for(const key of ['on','tabOwner'])test('Stop/lease during GET: '+key,async()=>{const f=fixture({read:(_,c)=>{c[key]=false}});await f.step();assert.equal(f.posts().length,0);assert.ok(f.ctx.rt.magister);assert.equal(f.ctx.location.href,'')});
test('toggle false during GET prevents POST',async()=>{const f=fixture({read:(_,c)=>{c.cfg.autoMagister=false}});await f.step();assert.equal(f.posts().length,0);assert.equal(f.ctx.location.href,'')});
test('Stop before POST durable pending is cleared and restart is allowed',async()=>{let once=true;const f=fixture({write:(p,c)=>{if(p.magPending&&Object.keys(p.magPending).length&&once){once=false;c.on=false}}});await f.step();assert.equal(f.posts().length,0);assert.equal(f.ctx.rt.magPending['0:human_warlock'],undefined);f.ctx.on=true;await f.step();assert.equal(f.posts().length,2)});
test('concurrent step calls cannot duplicate request',async()=>{let release;const gate=new Promise(r=>release=r);let first=true;const f=fixture({read:async()=>{if(first){first=false;await gate}}});const p=f.step();const p2=f.step();release();await Promise.all([p,p2]);assert.equal(f.posts().length,2)});
test('more than8 ranks continues persisted job, no false completion',async()=>{const f=fixture({max:10,sp:2000});await f.step();assert.equal(f.posts().length,8);assert.ok(f.ctx.rt.magister);assert.equal(f.ctx.rt.magChecked,undefined);await f.step();assert.equal(f.posts().length,10);assert.equal(f.ctx.rt.magister,null)});
test('afterWin requires confirmed victory; due keeps home and exits once',async()=>{const f=fixture({path:'/battle.html'});f.ctx.rt.magister=null;assert.equal(await f.start(true),true);assert.equal(f.calls[0],'map');assert.equal(f.ctx.rt.magister.home.zone,'valley');const no=fixture({path:'/battle.html',win:false});no.ctx.rt.magister=null;assert.equal(await no.start(true),false);assert.equal(no.calls.length,0)});
test('cat return retains selected dungeon and does not change cfg',async()=>{const f=fixture({cfg:{catMode:true,catDungeon:'witch'},rt:{catIn:'witch'},path:'/battle.html'});f.ctx.rt.magister=null;await f.start(true);f.ctx.location.pathname='/magister.html';await f.step();assert.ok(f.calls.includes('cat:witch'));assert.equal(f.ctx.cfg.catDungeon,'witch')});
test('manual mode during await cancels stale return and payment',async()=>{const f=fixture({read:(_,c)=>{c.rt.manualKickAt=123;c.cfg.fishMode=true}});await f.step();assert.equal(f.posts().length,0);assert.equal(f.ctx.location.href,'')});
test('teacher comes from current catalog, never stale cached NPC',async()=>{const f=fixture({path:'/map.html',rt:{magNpc:111}});await f.step();assert.equal(f.ctx.location.href,'/magister.html?npcId=30344');assert.equal(f.posts().length,0)});
test('Crafter Spoil uses actual canLearn; unavailable Mass Spoil stays blocked',async()=>{for(const canLearn of [true,false]){const f=fixture({name:canLearn?'Spoil':'Spoil Festival',canLearn,max:1,rt:{classCur:{prof:'dwarf_artisan',slot:1}}});await f.step();assert.equal(f.posts().length,canLearn?1:0)}});
test('current-level retry backoff does not suppress next level',async()=>{const f=fixture({rt:{magRetry:{key:'0:human_warlock',lvl:74,until:2000000}}});f.ctx.rt.magister=null;assert.equal(await f.start(),true)});
module.exports={fixture};

test('lease lost after prepared write: new owner resumes without phantom receipt',async()=>{let once=true;const f=fixture({write:(p,c)=>{if(p.magPending?.['0:human_warlock']?.phase==='prepared'&&once){once=false;c.tabOwner=false}}});await f.step();assert.equal(f.posts().length,0);assert.equal(f.ctx.rt.magPending['0:human_warlock'].phase,'prepared');f.ctx.tabOwner=true;f.reload();await f.step();assert.equal(f.posts().length,0,'prepared после reload ещё не доказывает отсутствие запроса');f.tick(61000);await f.start();await f.step();assert.equal(f.posts().length,2)});
test('manual clear while scheduling does not throw or exit battle',async()=>{const f=fixture({path:'/battle.html',write:(p,c)=>{if(p.magister)c.rt.magister=null}});f.ctx.rt.magister=null;assert.equal(await f.start(true),false);assert.equal(f.calls.length,0)});
test('new hero during character GET cannot annotate old profile or buy',async()=>{const f=fixture({read:(_,c)=>{c.rt.char='otherHero'}});let noted=0;f.ctx.L2V7Modules.story.charNote=()=>noted++;await f.step();assert.equal(f.posts().length,0);assert.equal(noted,0)});
for(const key of ['magisterSkip','magisterSpReserve'])test('changed '+key+' during receipt write is respected',async()=>{const f=fixture({write:(p,c)=>{if(p.magPending?.['0:human_warlock']?.phase==='prepared')c.cfg[key]=key==='magisterSkip'?'Blaze':950}});await f.step();assert.equal(f.posts().length,0)});
test('receipt write failure cannot spend SP',async()=>{const f=fixture();f.ctx.setRt=async p=>{Object.assign(f.ctx.rt,p);return {ok:false}};f.ctx.rtCommit=async()=>false;await f.step();assert.equal(f.posts().length,0)});

for(const field of ['abChal','pveBlockUntil'])test('captcha/PvE hold during GET forbids learning: '+field,async()=>{const f=fixture({read:(_,c)=>{c.rt[field]=true}});await f.step();assert.equal(f.posts().length,0);assert.equal(f.ctx.location.href,'')});
test('captcha appears after first accepted rank: no next POST or navigation',async()=>{const f=fixture({post:({ctx})=>{ctx.rt.abChal=true}});await f.step();assert.equal(f.posts().length,1);assert.equal(f.ctx.location.href,'');assert.ok(f.ctx.rt.magPending['0:human_warlock'])});
test('guild navigation waits for durable state',async()=>{const f=fixture({path:'/map.html'});f.ctx.rtCommit=async()=>false;await f.step();assert.equal(f.ctx.location.href,'');assert.equal(f.posts().length,0)});
test('failed state commit after victory does not exit or hunt',async()=>{const f=fixture({path:'/battle.html'});f.ctx.rt.magister=null;f.ctx.rtCommit=async()=>false;assert.equal(await f.start(true),true);assert.equal(f.calls.length,0);assert.ok(f.ctx.rt.magister)});

test('HUD level not loaded: verified character API supplies real level without guessing99',async()=>{const f=fixture({serverLevel:75,rt:{lvl:0}});f.ctx.rt.magister=null;assert.equal(await f.start(),true);assert.equal(f.ctx.rt.magister.lvl,75);await f.step();assert.equal(f.posts().length,2)});

test('actual inactive setRt + empty queue commit cannot authorize SP payment',async()=>{
 const f=fixture(),{createPatchQueue}=require('../engine-core.js');
 // setRt обновляет память, но inactive не ставит patch в очередь; recover пустой очереди возвращает ok:true.
 Object.assign(f.ctx,{tabIdle:true,document:{prerendering:false},RT_BULKY:[],rtSizeT:f.ctx.Date.now(),rtWriter:createPatchQueue(async()=>({ok:true}))});
 const setStart=content.indexOf('function setRt(p)'),setEnd=content.indexOf('const RECENT',setStart);
 const commitStart=content.indexOf('async function rtCommit('),commitEnd=content.indexOf('const rodLvlOf',commitStart);
 vm.runInContext(content.slice(setStart,setEnd)+content.slice(commitStart,commitEnd),f.ctx);
 assert.equal(await f.ctx.rtCommit(),true);await f.step();assert.equal(Object.keys(f.ctx.rtWriter.peek()).length,0);
 assert.equal(f.posts().length,0,'успешный commit пустой очереди не подтверждает отклонённый receipt');
});
