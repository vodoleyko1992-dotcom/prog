'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),src=fs.readFileSync(root+'/modules/fightlab.js','utf8'),hook=fs.readFileSync(root+'/hook.js','utf8');
const h={SECRET:/password|token|session|secret/i};vm.runInNewContext(hook.slice(hook.indexOf('  const btOf ='),hook.indexOf('  const pvOf ='))+';globalThis.extract={btOf,battleOf}',h);
const plain=x=>JSON.parse(JSON.stringify(x));
function fixture(rt){
 let now=100000,rid=0,revision=0,setup='gear-buffs-1',spawn='dense_1';const events=[];
 const env={rt:rt||{char:'Hero',prof:'human_warlord',lvl:48,classCur:{prof:'human_warlord',slot:1},zone:'Garden',sessT0:1000,manualKickAt:1},cfg:{stopHp:25},routeLocation:{search:'?spawnId=dense_1'},
  recoveryContext:()=>setup,actName:x=>x,rec:(...x)=>events.push(x),setRt:p=>{Object.assign(env.rt,p);return Promise.resolve({ok:true})},pvpPending:()=>false,mobTitle:()=> 'Garden Guard'};
 let L;function load(){const box={Date:{now:()=>now},URLSearchParams,console};vm.runInNewContext(src,box);L=box.L2V7Factories.fightlab(env);return L}load();
 function send(path,raw,{action='',status=200,ms=0,requestId=++rid,expected=revision,actor='Hero'}={}){
  const req={action,battleSpawnId:spawn,expectedRevision:expected};revision=raw.revision??revision;raw.character={name:actor,l2Profession:env.rt.classCur.prof,classSlots:{activeSlot:env.rt.classCur.slot},hp:10000,maxHp:10000,mp:1000,maxMp:1000,...raw.character,revision};
  const d={status,ms,rid:requestId,req,res:raw,bt:h.extract.btOf({pathname:path},raw),be:h.extract.battleOf({pathname:path},raw,req)};return L.onNet(path,d);
 }
 function start(i=++rid){spawn='dense_'+i;env.routeLocation.search='?spawnId='+spawn;now+=1000;
  send('/game/battle/start',{revision:++revision,battle:{spawnId:spawn,mobName:'Garden Guard',mobLevel:48,kind:'normal',mobHp:1000,mobMaxHp:1000,logSeq:0,log:['Бой начат']}});}
 function pull(action='provoke',extras=2){now+=1000;send('/game/battle/action',{revision:revision+1,delta:{mobHp:1000,mobMaxHp:1000,logSeq:1,logTail:['Провокація'],whirlwindExtras:Array.from({length:extras},(_,i)=>({spawnId:'extra_'+i,name:'Side '+i,mobHp:1000,mobMaxHp:1000}))}},{action});}
 function end({mode='none',win=true,reward=100,hp=10000,ms=0,lines,seq,elapsed=10000}={}){
  const p=env.rt.packLab?.active;now+=elapsed-(mode==='none'?0:1000);const extras=p?.extras?.length||0;
  const log=lines||['Ты нанёс [Garden Guard] 1200 урона.',...(extras?['Вихор вразив ворогів поруч: '+Array.from({length:extras},(_,i)=>`Side ${i} −1200`).join(', ')+'.']:[])];
  send('/game/battle/action',{revision:revision+1,character:{hp},delta:{mobHp:win?0:1000,mobMaxHp:1000,characterHp:hp,logSeq:seq??((p?.seq||0)+log.length),logTail:log},
   ...(win?{victory:{spawnId:spawn,mobName:'Garden Guard',...(reward==null?{}:{adena:reward,sp:reward/10}),fullLog:log}}:{defeat:{spawnId:spawn,mobName:'Garden Guard',fullLog:log}})},{action:'whirlwind',ms});
  return env.rt.packLab.samples.at(-1);
 }
 function fight(mode='none',options={}){start();if(mode!=='none')pull(mode,options.extras??2);return end({...options,mode});}
 return{env,events,send,start,pull,end,fight,reload:load,get L(){return L},get rows(){return env.rt.packLab?.samples||[]},advance:n=>now+=n,set setup(x){setup=x},get now(){return now},get revision(){return revision},get spawn(){return spawn}};
}
test('real hook → accepted pull → end: targets, timing, useful damage and rewards are distinct',()=>{
 const f=fixture(),r=f.fight('provoke',{reward:3100});assert.equal(r.quality,true);assert.equal(r.mode,'provoke');assert.equal(r.peak,3);assert.equal(r.accepted,2);assert.equal(r.raw,3600);assert.equal(r.useful,3000);assert.equal(r.skills.whirlwind.known,1);assert.equal(r.collectMs,9000);assert.equal(r.reward.adena,3100);assert.equal(f.events.filter(x=>x[1]==='пачка').length,1);
});
test('equal revision is reported as unchanged; rejected retries are distinct and duplicated rid is ignored',()=>{
 const f=fixture();f.start();const raw={revision:f.revision,ok:false,error:'skill_cooldown'};
 f.send('/game/battle/action',raw,{status:409,action:'provoke',requestId:77});f.send('/game/battle/action',raw,{status:409,action:'provoke',requestId:77});
 f.send('/game/battle/action',raw,{status:409,action:'provoke',requestId:78});f.send('/game/battle/action',{revision:f.revision},{action:'attack',requestId:79});
 const r=f.end();assert.equal(r.attempts,4);assert.equal(r.rejected,2);assert.equal(r.unchanged,1);assert.equal(r.mode,'failed');
});
test('duplicate victory GET cannot add another completed pack',()=>{
 const f=fixture();f.fight('provoke');f.send('/game/battle',{revision:f.revision,victory:{spawnId:f.spawn,mobName:'Garden Guard',adena:3100,sp:310,fullLog:[]}});assert.equal(f.rows.length,1);
});
test('reload restores observed start and pull, including a temporarily missing hero snapshot',()=>{
 const f=fixture();f.start();f.pull();f.advance(100);f.setup='';f.reload();f.send('/game/battle',{revision:f.revision,battle:{spawnId:f.spawn,mobName:'Garden Guard',mobHp:1000,mobMaxHp:1000,logSeq:1,log:['Бой начат','Провокація']}});f.setup='gear-buffs-1';const r=f.end({mode:'provoke'});assert.equal(r.quality,true);assert.equal(r.accepted,2);assert.equal(r.mode,'provoke');assert.equal(r.peak,3);
});
test('midfight attachment is displayed but never contributes to comparative rates',()=>{
 const f=fixture();f.send('/game/battle',{revision:1,battle:{spawnId:'dense_1',mobName:'Garden Guard',mobHp:500,mobMaxHp:1000,logSeq:4,log:['Уже идёт бой']}});const r=f.end();assert.equal(r.quality,false);assert.equal(r.partial,true);assert.equal(f.L.packStats(f.rows).adena.value,null);
});
for(const [name,change]of Object.entries({weapon:f=>f.setup='new-weapon',buffs:f=>f.setup='new-buffs',unknown:f=>f.setup='',session:f=>f.env.rt.sessT0++,start:f=>f.env.rt.manualKickAt++,level:f=>f.env.rt.lvl++}))test('context change excludes '+name+' from learning',()=>{
 const f=fixture();f.start();change(f);assert.equal(f.end().quality,false);
});
test('server latency excludes the result, and absent rewards remain unknown rather than zero',()=>{
 const f=fixture(),a=f.fight('provoke',{ms:8001}),b=f.fight('none',{reward:null});assert.equal(a.quality,false);assert.equal(a.slow,true);assert.equal(b.reward.adena,undefined);assert.equal(f.L.packStats(f.rows).adena.value,null);
});
test('cycles include a short observed transition; a long pause or new run does not inflate rates',()=>{
 const f=fixture();f.fight();const b=f.fight();assert.equal(b.cycle,true);assert.equal(b.cycleMs,b.ms+1000);
 f.advance(40000);assert.equal(f.fight().cycle,false);f.env.rt.manualKickAt++;assert.equal(f.fight().cycle,false);
});
test('fresh death outcomes enter the sample; three deaths in six pull fights suppress only that skill',()=>{
 const f=fixture();for(let i=0;i<6;i++)f.fight('provoke',{win:i>=3,hp:i<3?0:9000});const a=f.L.packAdvice('Garden Guard',1000);assert.deepEqual(plain(a.blocked),['provoke']);assert.equal(a.preferred,'');
});
test('comparison requires six timed cycles per arm; proven gains prefer that pull without extra trials',()=>{
 const f=fixture();for(let i=0;i<7;i++)f.fight('none',{reward:100});for(let i=0;i<5;i++)f.fight('howl',{reward:1000});f.fight('howl',{reward:1000});assert.equal(f.L.packAdvice('Garden Guard',1000).preferred,'');
 f.fight('howl',{reward:1000});f.fight('howl',{reward:1000});assert.equal(f.L.packAdvice('Garden Guard',1000).preferred,'howl');
 assert.match(f.L.packReport(),/адена\/мин/);assert.match(f.L.packReport(),/SP\/мин/);assert.match(f.L.packReport(),/лишний 17%/);
});
test('a slower reward rate in both currencies suppresses pull; competing currencies do not',()=>{
 const f=fixture();for(let i=0;i<7;i++)f.fight('none',{reward:1000});for(let i=0;i<7;i++)f.fight('provoke',{reward:100});assert.ok(f.L.packAdvice('Garden Guard',1000).blocked.includes('provoke'));
 for(const r of f.rows.filter(x=>x.mode==='provoke'))r.reward.sp=10000;assert.equal(f.L.packAdvice('Garden Guard',1000).blocked.length,0);
});
test('different initial HP/MP ranges and old data cannot prefer or suppress a pull',()=>{
 const f=fixture();for(let i=0;i<7;i++)f.fight('none',{reward:100});for(let i=0;i<7;i++)f.fight('provoke',{reward:1000});
 for(const r of f.rows.filter(x=>x.mode==='none'))r.startMp=20;
 assert.equal(f.L.packAdvice('Garden Guard',1000).preferred,'');
 for(const r of f.rows.filter(x=>x.mode==='none'))r.startMp=100;
 assert.equal(f.L.packAdvice('Garden Guard',1000,{hp:100,mp:20}).preferred,'');
 assert.equal(f.L.packAdvice('Garden Guard',1000,{hp:100,mp:100}).preferred,'provoke');
 f.advance(31*60000);assert.equal(f.L.packAdvice('Garden Guard',1000).preferred,'');
});
test('recent pressure can raise the HP requirement, never lower the original floor',()=>{
 const f=fixture();for(let i=0;i<5;i++)f.fight('provoke',{hp:4000});assert.equal(f.L.packAdvice('Garden Guard',1000).minHp,95);
 f.setup='other-gear';assert.equal(f.L.packAdvice('Garden Guard',1000).minHp,75);
});
test('mixed pull skills are not attributed to one treatment',()=>{
 const f=fixture();f.start();f.pull('provoke');f.pull('howl');const r=f.end({mode:'howl'});assert.equal(r.mode,'mixed');assert.equal(r.repeat,1);
});
test('actor/class change and PvP do not publish a foreign result',()=>{
 const f=fixture();f.start();f.send('/game/battle/action',{revision:f.revision+1,victory:{spawnId:f.spawn,mobName:'Garden Guard',adena:100}},{action:'whirlwind',actor:'Other'});assert.equal(f.rows.length,0);
 f.env.rt.classCur={prof:'human_warlock',slot:0};f.end();assert.equal(f.rows.length,0);
 const g=fixture();g.start();g.env.pvpPending=()=>true;g.end();assert.equal(g.rows.length,0);
});
test('the ledger is bounded and the same target in another zone does not share the learned preference',()=>{
 const f=fixture();for(let i=0;i<70;i++)f.fight();assert.equal(f.rows.length,64);
 assert.equal(f.env.rt.packLab.totals.n,70);assert.equal(f.env.rt.packLab.totals.adena,7000);assert.match(f.L.packReport(),/Сессия: боёв 70/);
 f.env.rt.zone='Other';assert.equal(f.L.packAdvice('Garden Guard',1000).blocked.length,0);assert.equal(f.L.packAdvice('Garden Guard',1000).preferred,'');
});
test('missing side HP leaves useful damage unknown instead of inventing zero overkill',()=>{
 const f=fixture();f.start();const r=f.end({lines:['Ты нанёс [Garden Guard] 1200 урона.','Вихор вразив ворогів поруч: Unseen −1200.']});assert.equal(r.damageUnknown,1);assert.equal(r.skills.whirlwind.known,0);assert.match(f.L.packReport(),/не полностью измерен/);
});
test('the reset and subclass stash include the new class-owned ledger',()=>{
 const p=fs.readFileSync(root+'/popup.js','utf8'),s=fs.readFileSync(root+'/modules/story.js','utf8');assert.match(p,/fightGroups: \{\}, packLab: null/);assert.match(s,/const CLASS_KEYS = \[[\s\S]*?'packLab'\]/);
});
function combatFixture(){
 const s=fs.readFileSync(root+'/tests/v205-warlord-provoke.test.js','utf8'),a=s.indexOf('function fixture()'),b=s.indexOf("\ntest(",a),box={require,fs,vm,console,Date};
 vm.runInNewContext(s.slice(a,b)+';globalThis.fixture=fixture;',box);return box.fixture();
}
test('learned preference only reorders currently ready pull skills and reserves MP',()=>{
 const f=combatFixture();f.panel.unshift({...f.panel[0],action:'howl',title:'Howl',mp:57});f.env.packAdvice=()=>({blocked:[],preferred:'howl',minHp:75});
 assert.equal(f.C.warlordPullPlan(f.ctx,f.mp).b.action,'howl');f.state.cd.howl=1000;assert.equal(f.C.warlordPullPlan(f.ctx,f.mp).b.action,'provoke');
 f.env.packAdvice=()=>({blocked:['provoke','howl'],minHp:75});assert.equal(f.C.warlordPullPlan(f.ctx,f.mp),null);
});
test('HP advice can only tighten safety; already pulled packs still receive their follow-up hit',()=>{
 const f=combatFixture();f.env.packAdvice=()=>({blocked:[],minHp:95});f.state.hp=940;assert.equal(f.C.warlordPullPlan(f.ctx,f.mp),null);
 f.state.hp=1000;const a=f.C.warlordPullPlan(f.ctx,f.mp);f.C.warlordPullResult(f.ctx,a,true);f.env.packAdvice=()=>({blocked:['provoke'],minHp:100});f.state.hp=900;assert.equal(f.C.warlordPullPlan(f.ctx,f.mp).warlordPull,'hit');
});
test('follow-up chooses observed useful damage on remaining targets, not the cheapest MP skill',()=>{
 const f=combatFixture();f.env.expDmg=name=>name==='Грозова буря'?10000:1000;f.env.fightGroupOn=name=>({damage:name==='Грозова буря'?10000:1000});
 const a=f.C.warlordPullPlan(f.ctx,f.mp);f.C.warlordPullResult(f.ctx,a,true);f.state.extra=[2484,2484];assert.equal(f.C.warlordPullPlan(f.ctx,{cur:143,max:874}).b.action,'thunder_storm');
 f.env.expDmg=()=>10000;f.env.fightGroupOn=()=>({damage:10000});assert.equal(f.C.warlordPullPlan(f.ctx,{cur:143,max:874}).b.action,'whirlwind');
});
test('a failed durable write retries through flush; reset and owner changes prevent resurrection',async()=>{
 for(const reset of [false,true,'owner']){
  const f=fixture();f.start();await new Promise(r=>setImmediate(r));const save=f.env.setRt;let fail=true,n=0;
  f.env.setRt=p=>{if(p.packLab){n++;save(p);return Promise.resolve({ok:!fail})}return save(p)};
  f.end();await new Promise(r=>setImmediate(r));const before=n;fail=false;
  if(reset===true)f.env.rt.packLab=null;if(reset==='owner')f.env.rt.char='Other';
  f.L.flush();await new Promise(r=>setImmediate(r));assert.equal(n,before+(reset?0:1));
  if(!reset){f.L.flush();await new Promise(r=>setImmediate(r));assert.equal(n,before+1);}
 }
});
test('a truncated damage line is not reported as a complete overkill measurement',()=>{
 const f=fixture();f.start();const r=f.end({lines:['Ты нанёс [Garden Guard] 1200 урона.','Вихор вразив ворогів поруч: '+ 'Unseen −1200, '.repeat(250)]});assert.ok(r.damageUnknown>0);assert.equal(r.skills.whirlwind.known,0);
});
test('unknown payout after a death prevents survivor-only profit learning',()=>{
 const f=fixture();for(let i=0;i<7;i++)f.fight('none',{reward:100});for(let i=0;i<7;i++)f.fight('provoke',{reward:1000});assert.equal(f.L.packAdvice('Garden Guard',1000).preferred,'provoke');
 f.fight('provoke',{win:false,reward:null,hp:0});assert.equal(f.L.packAdvice('Garden Guard',1000).preferred,'');
});
test('a treatment boundary does not charge the previous method transition to the new method',()=>{
 const f=fixture();f.fight('none');assert.equal(f.fight('provoke').cycle,false);assert.equal(f.fight('provoke').cycle,true);
});
test('Unicode setup changes and an unknown dungeon cannot share actionable context',()=>{
 const f=fixture();f.setup='🧙';f.start();f.setup='🧛';assert.equal(f.end().quality,false);
 const g=fixture();g.env.cfg.catMode=true;g.env.cfg.catDungeon='auto';assert.equal(g.fight('provoke').quality,false);
});
test('session totals outlive the rolling comparison window and include idle time in rates',()=>{
 const f=fixture();f.fight();f.advance(25*3600000);assert.match(f.L.packReport(),/Сессия: боёв 1/);assert.match(f.L.packReport(),/включая простои/);
});
test('queued active snapshots are immutable as later actions change the live pack',()=>{
 const f=fixture(),save=f.env.setRt,writes=[];f.env.setRt=p=>{if(p.packLab)writes.push(p.packLab);return save(p)};
 f.start();f.pull();f.end({mode:'provoke'});assert.equal(writes[0].active.mode,'none');assert.equal(writes[0].active.accepted,0);assert.equal(writes[1].active.mode,'provoke');assert.equal(writes[1].active.done,undefined);
});
test('reset during a live pack does not resurrect pre-reset observations on the next response',()=>{
 const f=fixture();f.start();f.pull();f.env.rt.packLab=null;const r=f.end();assert.equal(r.partial,true);assert.equal(r.quality,false);assert.equal(r.accepted,1);assert.equal(r.mode,'none');assert.equal(f.env.rt.packLab.totals.n,1);
});
