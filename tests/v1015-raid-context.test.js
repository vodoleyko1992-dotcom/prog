'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(process.argv[2]||require('node:path').join(__dirname,'../modules/raid.js'),'utf8');
const tests=[]; const test=(name,fn)=>tests.push({name,fn});
function fixture(key='new') {
 let now=1_000_000, current=key;
 const env={cfg:{rbProbe:false,rbRetreatHp:20,stopHp:25,rbRestHp:95,rbMaxKillMin:20},
  rt:{rbDps:3000,rbDb:{boss:{dps:3000,dpsBase:3000,dpsLvl:75,sp:1000,hitP90:200}},rbStats:{boss:{hp:2_409_850,patk:1000,matk:1000}},rbList:{boss:{lvl:75}}},
  warlock:{raidContext:()=>current===false?null:{managed:true,key:current}},
  heroLvl:()=>75,meHp:()=>({cur:9000,max:10000,pct:90}),potModel:()=>null,
  fmtT:x=>String(Math.round(x)),fmtK:x=>String(Math.round(x)),rec:()=>{},logLines:()=>[],newLines:()=>[],activeBuffs:()=>[],
  epicOn:()=>false,epicById:()=>null,setRt:async p=>Object.assign(env.rt,p),rbLive:null};
 const sb={console,Math,Number,Date:{now:()=>now}};sb.globalThis=sb;
 vm.runInNewContext(source,sb); const R=sb.L2V7Factories.raid(env);env.rbNote=R.rbNote;
 const ctx={name:'Boss',rb:{id:'boss',samples:[],hits:[100,110,120,130],sp:1000}},mob={cur:2_409_850,max:2_409_850},me={cur:9000,max:10000,pct:90};
 function sample(sec,damage=1000,loss=10) {now=1_000_000+sec*1000;mob.cur=mob.max-damage*sec;me.cur=9000-loss*sec;me.pct=me.cur/100;if(sec>0)ctx.rb.hits.push(130);return R.rbAssess(ctx,me,mob);}
 return {env,R,ctx,mob,me,sample,setKey:k=>current=k,setNow:n=>now=n};
}
test('fresh changed context cannot reuse untagged 3k history',()=>{const f=fixture();assert.equal(f.R.rbDpsOn('boss'),1150);});
test('expired/unknown context cannot reuse optimistic full-buff memory',()=>{const f=fixture(null);Object.assign(f.env.rt,{rbDps:34462,rbDpsContext:'old'});Object.assign(f.env.rt.rbDb.boss,{dps:34462,dpsContext:'old'});assert.equal(f.R.rbDpsOn('boss'),1150);});
test('matching full DPS is not multiplied by global DPS again',()=>{const f=fixture();Object.assign(f.env.rt,{rbDps:60000,rbDpsContext:'new'});Object.assign(f.env.rt.rbDb.boss,{dps:34462,dpsContext:'new',dpsBase:3000});assert.equal(f.R.rbDpsOn('boss'),34462);});
test('new context learns exact measured total without old 60 percent mixture',async()=>{const f=fixture();await f.R.rbDpsLearn('boss',34462);assert.equal(f.env.rt.rbDb.boss.dps,34462);assert.equal(f.env.rt.rbDb.boss.dpsContext,'new');});
test('same context can smooth separate total-DPS observations',async()=>{const f=fixture();Object.assign(f.env.rt.rbDb.boss,{dps:30000,dpsContext:'new'});await f.R.rbDpsLearn('boss',40000);assert.equal(f.env.rt.rbDb.boss.dps,34000);});
test('unknown context does not persist measurements',async()=>{const f=fixture(null),old=JSON.stringify(f.env.rt);await f.R.rbDpsLearn('boss',50000);assert.equal(JSON.stringify(f.env.rt),old);});
test('legacy class retains untagged formula and learning',async()=>{const f=fixture(false);f.env.rt.rbDps=6000;assert.equal(f.R.rbDpsOn('boss'),6000);await f.R.rbDpsLearn('boss',10000);assert.equal(f.env.rt.rbDb.boss.dps,7600);});
test('legacy class cannot borrow tagged Warlock total DPS',()=>{const f=fixture(false);f.env.rt.rbDpsContext='warlock';f.env.rt.rbDb.boss.dpsContext='warlock';assert.equal(f.R.rbDpsOn('boss'),1150);});
test('8 second pet crit burst never becomes durable DPS',async()=>{const f=fixture();for(let i=0;i<=8;i++)f.sample(i,30000);await Promise.resolve();assert.equal(f.env.rt.rbDb.boss.dps,3000);});
test('30 second full HP loss learns total exactly once, no pet addition',async()=>{const f=fixture();for(let i=0;i<=29;i++)f.sample(i,34462);await Promise.resolve();assert.equal(f.env.rt.rbDb.boss.dps,34462);assert.equal(f.env.rt.rbDps,34462);assert.equal(f.env.rt.rbDpsContext,'new');});
test('context transition resets forecast window but keeps observed specials',()=>{const f=fixture();for(let i=0;i<=29;i++)f.sample(i,1000);f.setKey('expired');f.sample(30,1000);assert.equal(f.ctx.rb.samples.length,1);assert.equal(f.env.rbLive.verdict,'measuring');assert.equal(f.env.rbLive.win,false);assert.equal(f.ctx.rb.sp,1000);assert.equal(f.ctx.rb.hits.length,34);});
test('pause/reload-like observation gap cannot include manual healing in window',()=>{const f=fixture();for(let i=0;i<=20;i++)f.sample(i);f.sample(50,1000,-20);assert.equal(f.ctx.rb.samples.length,1);assert.equal(f.env.rbLive.win,false);});
test('net HP already includes vampire heal and is not healed twice',()=>{const f=fixture();for(let i=0;i<=29;i++)f.sample(i,1000,20);assert.equal(f.env.rbLive.loss,20);});
test('potion correction excludes only its own observed-window contribution',()=>{const f=fixture();f.env.potModel=()=>({H:600,C:2,n:100,rate:300,pool:60000,est:false,items:[]});f.ctx.rb.potT=[1_010_000];for(let i=0;i<=29;i++)f.sample(i,1000,20);assert.ok(Math.abs(f.env.rbLive.loss-(20+600/29))<1e-6);});
test('matched sustained net-zero loss can replace stale positive loss',async()=>{const f=fixture();Object.assign(f.env.rt.rbStats.boss,{loss:400,lossContext:'old'});for(let i=0;i<=29;i++)f.sample(i,1000,0);await Promise.resolve();assert.equal(f.env.rt.rbStats.boss.loss,0);assert.equal(f.env.rt.rbStats.boss.lossContext,'new');});
test('stale cheap fight duration cannot rank a changed-context boss',()=>{const f=fixture();Object.assign(f.env.rt.rbDb.boss,{fightS:1,fightContext:'old'});const a=f.R.rbValueScore('boss',{price:1});delete f.env.rt.rbDb.boss.fightS;assert.equal(a,f.R.rbValueScore('boss',{price:1}));});
test('changed-context low loss cannot waive current reserve requirement',()=>{const f=fixture();f.env.rt.rbStats.boss.loss=1;f.env.rt.rbStats.boss.lossContext='old';f.env.rt.rbLossK=0.001;const r=f.R.rbPreCheck('boss',{...f.env.rt.rbStats.boss,hp:10000,patk:5000});assert.ok(r.need>500);});
test('real 41 percent special retains conservative risk despite net healing',()=>{const f=fixture();f.ctx.rb.sp=4023;f.env.rt.rbDb.boss.sp=4023;for(let i=0;i<=29;i++)f.sample(i,30000,-10);assert.equal(f.env.rbLive.win,false);assert.equal(f.env.rbLive.verdict,'risk');});
test('actual level66 Utenus is in level75 default window and permits bounded existing probe, then current-context learning',async()=>{const f=fixture();Object.assign(f.env.cfg,{rbMaxBelow:9,rbMaxAbove:15,rbProbe:true});f.env.RB_WIN=15;assert.ok(66>=f.R.rbLo(75)&&66<=f.R.rbHi(75));f.env.rt.rbDb={};f.env.rt.rbList.boss.lvl=66;
 // Source: kb/data/game-raid-bosses.json l2dop_rb_25470 (game snapshot; current availability still schedule-dependent).
 const st={hp:1012137,patk:4949,matk:3292,pdef:5924,mdef:5517};f.env.rt.rbStats.boss=st;f.env.potModel=()=>({H:600,n:811,C:2.2,rate:273,pool:487000,est:false,items:[]});
 const first=f.R.rbPreCheck('boss',st);assert.equal(first.ok,true);assert.equal(first.confidence,'probe');assert.ok(first.t<1200);await f.R.rbDpsLearn('boss',10000);assert.equal(f.R.rbDpsOn('boss'),10000);assert.equal(f.R.rbPreCheck('boss',st).t,101);
});
test('unmeasured large target explicitly explains conservative time rejection',()=>{const f=fixture();const r=f.R.rbPreCheck('boss',f.env.rt.rbStats.boss);assert.equal(r.kind,'slow');assert.match(r.why,/текущий состав ещё не измерен/);});
test('one isolated pet crit followed by no damage is not a persistent DPS sample',async()=>{const f=fixture();for(let i=0;i<=29;i++)f.sample(i,i===0?0:100000/i);await Promise.resolve();assert.equal(f.env.rt.rbDb.boss.dps,3000);assert.equal(f.env.rt.rbDps,3000);});
test('matched target-specific scalar does not apply level penalty twice',()=>{const f=fixture();f.env.rt.rbDb={};f.env.rt.rbList.boss.lvl=90;f.env.rt.rbDpsContext='new';f.env.rt.rbDps=3000;assert.equal(f.R.rbDpsOn('boss'),3000);});
test('known Warlock with unavailable provider fails closed to unmeasured context',()=>{const f=fixture();f.env.warlock=null;f.env.rt.classCur={prof:'human_warlock',slot:0};assert.equal(f.R.rbDpsOn('boss'),1150);});
test('fresh incoming hits remain measurable after bounded raw-hit history reaches120',()=>{const f=fixture();f.ctx.rb.hits=Array(120).fill(100);f.env.newLines=(_,lines)=>lines;
 for(let i=0;i<=29;i++){f.setNow(1_000_000+i*1000);f.env.logLines=()=>i?['[Boss] ударив тебе −120 HP']:[];f.R.rbAssess(f.ctx,{cur:9000,max:10000,pct:90},{cur:2409850-i*1000,max:2409850});}
 assert.equal(f.ctx.rb.hits.length,120);assert.ok(f.env.rbLive.hits>=4);assert.equal(f.env.rt.rbStats.boss.lossContext,'new');
});
test('context transition immediately invalidates persisted likely forecast too',()=>{const f=fixture();for(let i=0;i<=29;i++)f.sample(i);f.env.rt.rbForecast={status:'likely',dps:34462,tKill:30};f.setKey('new-buffs');f.sample(30);assert.equal(f.env.rt.rbForecast.status,'measuring');assert.equal(f.env.rt.rbForecast.dps,null);assert.equal(f.env.rt.rbForecast.tKill,null);});
(async()=>{let fail=0;for(const t of tests){try{await t.fn();console.log('PASS '+t.name);}catch(e){fail++;console.log('FAIL '+t.name+': '+e.message);}}console.log(JSON.stringify({pass:tests.length-fail,fail}));process.exitCode=fail?1:0;})();
