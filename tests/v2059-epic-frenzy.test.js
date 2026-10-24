'use strict';
// 20.59 (John 24.10: «на эпиках сливайся под френзи и фарми их под френзи»; лог 19:13–19:15 Queen Ant, MaxHP 10293,
// удары 1577–1915: Trance не жался — «HP после Battle Trance не покрывает запас под удары РБ»).
const test=require('node:test'),assert=require('node:assert/strict');
const {flowFixture}=require('./warlock-combat-fixture.cjs');
const MAX=10293,QA=[1577,1906,1600,1915];
function fixture(o={}) {
 const f=flowFixture('fighter'),{env,combat,slots,atk}=f,active=new Set(o.active||[]);
 let cur=o.hp??MAX,mp=874;
 const skill=(title,action,meta)=>({title,action,meta,querySelector:()=>null,getAttribute:()=>null});
 const trance=skill('Battle Trance','battle_trance',{n:'Battle Trance',c:'Расход HP',t:'HP_SELF_COST',target:'SELF',o:'ACTIVE',autoUse:false,mp:0});
 const frenzy=skill('Frenzy','l2_176',{n:'Frenzy',id:176,c:'Бафф',t:'BUFF',target:'SELF',o:'ACTIVE',pc:{hp:30},mp:14});
 const guts=skill('Guts','l2_139',{n:'Guts',id:139,c:'Бафф',t:'BUFF',target:'SELF',o:'ACTIVE',pc:{hp:30},mp:19});
 slots.splice(0,slots.length,atk,trance,frenzy,guts);
 const names=s=>String(s||'').split(/[,|]/).map(x=>x.trim().toLowerCase()).filter(Boolean);
 Object.assign(env.cfg,{destroyerLimits:true,nKeyBuffs:'Frenzy, Guts',nBuffs:'',autoRoles:false,rbFrenzyDive:false,stopHp:25,...(o.cfg||{})});
 Object.assign(env.rt,{prof:'orc_raider',classCur:{prof:'orc_raider',slot:1},skillDb:{},rbDb:{'qa':{sp:2690,...(o.db||{})}},buffAt:{}});
 Object.assign(env,{names,slotKind:b=>b===atk?'атака':'скилл',slotAction:b=>b===atk?'attack':b.action,
  ilOf:b=>typeof b==='string'?slots.find(x=>x.title.toLowerCase()===b.toLowerCase())?.meta:b?.meta,skillMp:()=>0,
  buffActive:(bn,b)=>active.has(String(b?.title||bn).toLowerCase()),meHp:()=>({cur,max:MAX,pct:cur/MAX*100}),meMp:()=>({cur:mp,max:874,pct:mp/874*100}),
  combatCooldown:{globalWait:()=>0,skillWait:()=>0,recentlyGlobalRejected:()=>false},activeBuffs:()=>[],
  epicById:id=>o.epic===false?null:id==='qa'?{k:'ak'}:null});
 const ctx={block:{},rb:{id:'qa',hits:[...(o.hits??QA)]}};
 return {...f,ctx,active,trance,frenzy,guts,setHp:n=>cur=n,plan:()=>combat.limitPlan(ctx,env.meHp(),env.meMp(),{cur:357102,max:429898})};
}

test('лог 19:13 Queen Ant: на эпике сливаемся (обычный РБ с теми же цифрами — нет)',()=>{
 assert.equal(fixture().plan()?.b?.title,'Battle Trance');
 const rb=fixture({epic:false});assert.equal(rb.plan(),null);assert.match(rb.ctx.limitSkip,/не покрывает запас/);
});
test('после слива: Guts первым, затем Frenzy — один удар переживаем',()=>{
 const f=fixture();f.setHp(Math.floor(MAX*.25));assert.equal(f.plan()?.b,f.guts);f.active.add('guts');assert.equal(f.plan()?.b,f.frenzy);
});
test('эпик без замеренных ударов: HP не сливаю',()=>{const f=fixture({hits:[]});assert.equal(f.plan(),null);assert.match(f.ctx.limitSkip,/не замерены/);});
test('эпик бьёт сильнее HP после слива: не сливаю',()=>{const f=fixture({hits:[2400]});assert.equal(f.plan(),null);assert.match(f.ctx.limitSkip,/не переживу/);});
test('выключатель epicFrenzy: эпик по прежним строгим правилам',()=>{const f=fixture({cfg:{epicFrenzy:false}});assert.equal(f.plan(),null);});
test('limitBig выключен: на эпике тоже не сливаю',()=>{const f=fixture({cfg:{limitBig:false}});assert.equal(f.plan(),null);});
test('90 с под Frenzy: держим HP, банка только у края по свежим ударам',()=>{
 const f=fixture(),{combat,ctx}=f;assert.equal(combat.epicFrenzyHold(ctx),false);
 ctx.limitDiveT=Date.now();ctx.limitDiveHits=ctx.rb.hits.length;assert.equal(combat.epicFrenzyHold(ctx),true);
 assert.equal(combat.epicFrenzyFloor(ctx,{max:MAX}),Math.round(1915*1.3),'до свежих ударов — по всем');
 ctx.rb.hits.push(640,700);assert.equal(combat.epicFrenzyFloor(ctx,{max:MAX}),910,'под Guts удары слабее — край по свежим');
 ctx.rb.hits.push(300);ctx.limitDiveHits=ctx.rb.hits.length-1;assert.equal(combat.epicFrenzyFloor(ctx,{max:MAX}),Math.round(MAX*.08),'не ниже 8 %');
 ctx.limitDiveT=Date.now()-91000;assert.equal(combat.epicFrenzyHold(ctx),false);
 f.env.epicById=()=>null;ctx.limitDiveT=Date.now();assert.equal(combat.epicFrenzyHold(ctx),false,'обычный РБ — без удержания');
});
test('отход эпика по HP и замер HP учитывают слив',()=>{
 const fs=require('node:fs'),path=require('node:path'),root=path.join(__dirname,'..');
 const c=fs.readFileSync(path.join(root,'modules/combat.js'),'utf8'),r=fs.readFileSync(path.join(root,'modules/raid.js'),'utf8');
 assert.match(c,/me\.pct <= env\.cfg\.epicRetreatHp && !limitDiveFresh\(ctx\) && !epicFrenzyHold\(ctx\)/);
 assert.match(c,/if \(epicFrenzyHold\(ctx\)\) \{\s*const floor = epicFrenzyFloor\(ctx, me\);\s*potAt = me\.cur <= floor \? 100 : -1;/);
 assert.match(r,/const dove = ctx\.limitDiveT > 0 && S\.diveSeen !== ctx\.limitDiveT;/);assert.match(r,/if \(changed \|\| interrupted \|\| dove\)/);
});
test('меню и умолчания: epicFrenzy ВКЛ',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),root=path.join(__dirname,'..'),box={};vm.runInNewContext(fs.readFileSync(path.join(root,'defaults.js'),'utf8'),box);
 assert.equal(box.L2Defaults.CFG.epicFrenzy,true);assert.match(fs.readFileSync(path.join(root,'popup.html'),'utf8'),/id="epicFrenzy" type="checkbox"/);assert.match(fs.readFileSync(path.join(root,'popup.js'),'utf8'),/'epicFrenzy'/);
});

// Лог 24.10 19:23:24, Core: Battle Trance нажат руками → HP 2573 (25 %); бот счёл слив ударом Core «5220 — смертельно» и пил банку на 24 %.
const fs2=require('node:fs'),path2=require('node:path'),vm2=require('node:vm'),SRC=fs2.readFileSync(path2.join(__dirname,'..','modules/combat.js'),'utf8');
const emBlock=(()=>{const i0=SRC.indexOf('    if (me && me.pct <= Math.max(env.cfg.stopHp, 25)'),i1=SRC.indexOf('    ctx.emWait = 0;',i0);assert.ok(i0>0&&i1>i0);return SRC.slice(i0,i1);})();
async function emergency(hold,cur){
 const calls=[],sb={env:{cfg:{stopHp:25},hpPotPick:()=>({title:'Велике зілля HP'}),cleanTitle:s=>s,qty:()=>77,hpPots:()=>[1],rec:()=>{}},
  ctx:{rb:{id:'core'}},me:{pct:cur/MAX*100,cur,max:MAX},mp:null,drainPick:()=>null,healPick:()=>null,mageCombat:()=>false,Date,Math,
  epicFrenzyHold:()=>hold,epicFrenzyFloor:()=>2490,act:async b=>{calls.push(b.title);return true}};
 vm2.runInNewContext(`let lastHpPot = 0; this.step = async () => { for (let i = 0; i < 1; i++) {\n${emBlock}\n} };`,sb);await sb.step();return calls;
}
test('лог 19:23 Core: в окне Frenzy 25 % HP — не авария; у края и без окна — банка как раньше',async()=>{
 assert.deepEqual(await emergency(true,2573),[],'HP после слива выше края — бьёмся под Frenzy');
 assert.deepEqual(await emergency(true,900),['Велике зілля HP'],'у края — банка');
 assert.deepEqual(await emergency(false,2573),['Велике зілля HP'],'без окна Frenzy — прежняя аварийная банка');
});
test('ручной Battle Trance: слив этого боя замечается, старый из прошлого боя — нет',()=>{
 const i0=SRC.indexOf('    ctx.born ||= Date.now();'),i1=SRC.indexOf('    const plan = limitPlan(',i0);assert.ok(i0>0&&i1>i0);
 const run=(tranceT,born)=>{const ctx={rb:{id:'core',hits:[2400,2700]},born};vm2.runInNewContext(SRC.slice(i0,i1),{ctx,env:{actNet:()=>({tranceT})},Date});return ctx;};
 const now=Date.now(),c=run(now,now-5000);assert.equal(c.limitDiveT,now);assert.equal(c.limitDiveHits,2);
 assert.equal(run(now-60000,now-5000).limitDiveT,undefined,'Trance прошлого боя');
 const cs=fs2.readFileSync(path2.join(__dirname,'..','content.js'),'utf8');assert.match(cs,/ACT_NET\.ok && ACT_NET\.action === 'battle_trance'\) ACT_NET\.tranceT = Date\.now\(\)/);
});
