'use strict';
// 20.41 (лог 20.10 21:09: память 1,3 МБ, каждая запись ≈0,5 с): строки petCohorts (сравнение суммонов) хранили весь снимок
// героя — hero.setup со снаряжением и умениями, key/snapshotKey JSON-строками — ≈10 КБ × 100 ≈ 1 МБ. Теперь ключ — хэш полного
// ключа (алгоритм packHash из fightlab.js), строка — только поля меню и счётчики, не больше 40; старые строки ужимаются при загрузке.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./warlock-fixture.cjs');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const W=read('modules/warlock.js'),F=read('modules/fightlab.js'),C=read('content.js'),UI=read('warlock-ui.js');
const body=(src,name)=>{const m=src.match(new RegExp('const '+name+' = s => (\\{.*?\\});\\n'));assert.ok(m,name);return m[1]};
const hash=new Function('return s => '+body(F,'packHash'))();
const J=v=>JSON.parse(JSON.stringify(v)),COUNT=['hits','hitDmg','crits','misses','dmg','acts'];
// Реалистичный полный снимок: 18 слотов снаряжения с аугментацией и клановыми атрибутами, 45 умений, 20 бафов героя, 15 у кота.
function fat(x){
 const now=x.now(),eq={};for(let i=0;i<18;i++)eq['slot_'+i]={itemId:6000+i,enchant:i%7,specialGearLevel:i%3,enchantPAtkBonus:i*11,enchantMAtkBonus:i*13,augmentation:i===0?{outcomeId:'ls_active_'+i}:null,
  clanWeaponAttrs:i===0?[{attributeId:'fire',level:3},{attributeId:'holy',level:2}]:[],clanArmorAttrs:i>5?[{attributeId:'earth',level:1}]:[]};
 Object.assign(x.ch,{mAtk:8000,pAtk:1300,pDef:1400,mDef:1100,maxHp:9785,mCritPct:17,critRate:120,castSpd:1200,pAtkSpd:600,inventory:{eq},
  learnedBattleSkillsDetail:Array.from({length:45},(_,i)=>({battleId:'l2_'+(1000+i*7),level:1+i%9})),
  activeBuffs:Array.from({length:20},(_,i)=>({skillId:1000+i*3,level:1+i%3,expiresAtMs:now+3600000}))});
 x.ch.activeSummon.activeBuffs=Array.from({length:15},(_,i)=>({skillId:1200+i*5,level:1+i%3,expiresAtMs:now+3600000}));
 x.env.shotContext=()=>'BSPS-A:on';x.api().noteSnapshot(x.ch);return x;
}
const target=i=>({name:'Mob '+i,spawnId:'sp_'+i,lvl:70,max:50000});
// Строка ровно в прежнем формате noteBattle (до 20.41): { ...полная когорта, fights, счётчики, at } под полным ключом.
function legacy(x,n=100){
 const map={};for(let i=0;i<n;i++){const ctx={...target(i),pet:{key:'kai_the_cat'}};x.api().capture(ctx);const c=ctx.petCohort;assert.ok(c&&c.hero&&c.snapshotKey);
  map[c.key]={...c,fights:2,hits:10+i,hitDmg:(10+i)*1500,crits:1,misses:1,dmg:(10+i)*1700,acts:12+i,at:x.now()-100000+i};}
 return map;
}
test('cohortId в warlock.js — тот же алгоритм, что packHash в fightlab.js; L2EngineCore модулю не нужен',()=>{
 assert.equal(body(W,'cohortId'),body(F,'packHash'));
 assert.doesNotMatch(W,/\bL2EngineCore\s*(?:\?\.|\.|\[)/);
 for(const s of ['','a','[["x"],1]','Ж'.repeat(300)])assert.ok(hash(s).length<=64);
});
test('100 старых полных строк → не больше 40 коротких под хэшем, счётчики целы; замер размера',t=>{
 const x=fat(fixture()),old=legacy(x),before=JSON.stringify(old).length;
 const slim=JSON.parse(JSON.stringify(x.api().slimCohorts(old))),after=JSON.stringify(slim).length;
 const msg=`petCohorts: 100 полных строк ${Math.round(before/1024)} КБ (${Math.round(before/100)} Б на строку) → ${Object.keys(slim).length} коротких ${Math.round(after/1024)} КБ (${Math.round(after/Object.keys(slim).length)} Б на строку)`;
 t.diagnostic(msg);console.log('  '+msg);
 assert.ok(before>500000,'реалистичный старый словарь ≈1 МБ: '+before);
 assert.equal(Object.keys(slim).length,40);assert.ok(after<before/20,after+' / '+before);
 const keep=Object.entries(old).sort((a,b)=>b[1].at-a[1].at).slice(0,40);
 for(const [k,v] of keep){const r=slim[hash(k)];assert.ok(r,'строка под хэшем полного ключа');
  for(const f of [...COUNT,'fights','at'])assert.equal(r[f],v[f],f);
  for(const f of ['petKey','petLevel','level','classKey','pAtk','accuracy','critRate','critDmgMul','shots'])assert.equal(r[f],v[f],f);
  assert.deepEqual(r.target,J(v.target));assert.deepEqual(r.buffs,J(v.buffs));
  for(const f of ['hero','key','snapshotKey','char','validUntil','born'])assert.equal(f in r,false,f);}
 for(const k of Object.keys(slim))assert.ok(k.length<=64);
 // Все поля, которые читает меню (warlock-ui.js cohorts), в строке есть.
 const ui=[...new Set((UI.slice(UI.indexOf('function cohorts(all)'),UI.indexOf('function wire()')).match(/\br\.[a-zA-Z]+/g)||[]).map(s=>s.slice(2)))];
 assert.ok(ui.length>=15,ui.join());for(const f of [...ui,'at'])assert.ok(f in Object.values(slim)[0],f);
 // Повторное ужатие уже коротких строк ничего не меняет.
 assert.deepEqual(JSON.parse(JSON.stringify(x.api().slimCohorts(slim))),slim);
});
test('petExpected находит счётчики ужатой старой строки по хэшу полного ключа',()=>{
 const x=fat(fixture()),old=legacy(x);x.env.rt.petCohorts=JSON.parse(JSON.stringify(x.api().slimCohorts(old)));
 const ctx={...target(99),pet:{key:'kai_the_cat',hits:0,crits:0,misses:0,hitDmg:0,dmg:0,acts:0}};
 assert.equal(x.api().petExpected(ctx),1500*0.85);
 assert.ok(ctx.petCohort.key.length>64&&ctx.petCohort.hero,'в памяти боя — полный ключ и снимок');
 // Старая строка за пределами 40 свежих отброшена: по ней предсказания нет (своих 0 ударов).
 const gone={...target(0),pet:{key:'kai_the_cat',hits:0,crits:0,misses:0,hitDmg:0,dmg:0,acts:0}};assert.equal(x.api().petExpected(gone),0);
});
// Песочница warlock-fixture.cjs не загружает engine-core.js: запись ниже идёт без L2EngineCore.
test('noteBattle без L2EngineCore пишет короткую строку и ужимает старые; второй бой копит в ту же строку',async()=>{
 const x=fat(fixture());x.env.rt.petCohorts=legacy(x);
 const ctx={...target(500),pet:{key:'kai_the_cat'}};x.api().capture(ctx);Object.assign(ctx.pet,{hits:3,hitDmg:4500,crits:1,misses:0,dmg:9000,acts:4});const full=ctx.petCohort.key;
 await x.api().noteBattle(ctx);
 const w=x.writes.at(-1).petCohorts,id=hash(full);assert.ok(w&&w[id]);
 assert.equal(Object.keys(w).length,40);assert.ok(Object.keys(w).every(k=>k.length<=64));
 assert.ok(Object.values(w).every(r=>!r.hero&&!r.snapshotKey&&!r.key));
 assert.deepEqual(JSON.parse(JSON.stringify(w[id])),{petKey:'kai_the_cat',petLevel:10,level:75,classKey:'0:human_warlock',buffs:J(ctx.petCohort.buffs),pAtk:2688,accuracy:70,critRate:650,critDmgMul:2.44,
  shots:'BSPS-A:on',target:['sp_500','mob 500',70,50000,false,''],fights:1,hits:3,hitDmg:4500,crits:1,misses:0,dmg:9000,acts:4,at:x.now()});
 assert.equal(ctx.petCohort.key,full);
 const again={...target(500),pet:{key:'kai_the_cat'}};x.api().capture(again);Object.assign(again.pet,{hits:2,hitDmg:3000,crits:0,misses:1,dmg:3000,acts:3});await x.api().noteBattle(again);
 const r=x.env.rt.petCohorts[id];assert.equal(r.fights,2);assert.equal(r.hits,5);assert.equal(r.hitDmg,7500);assert.equal(r.misses,1);assert.equal(r.acts,7);
 assert.equal(Object.keys(x.env.rt.petCohorts).length,40);
});
// Очистка при загрузке и после замка — настоящие куски content.js в одной песочнице: верхние migApplied/petCohortsFat, блок миграций
// от новой строки до записи rf, loopLease (перечитывает хранилище при получении замка) и loopMigrations. Хранилище и фон — модель:
// statePatch принимает запись только для героя, который сейчас в хранилище (expectedChar = rt.char вкладки).
const cut=(a,b)=>{const i=C.indexOf(a),j=C.indexOf(b,i);assert.ok(i>=0&&j>i,a);return C.slice(i,j)};
const topCut=['const migApplied = ','const petCohortsFat = '].map(a=>cut(a,'\n')+'\n').join('');
const loadCut=cut('{ const slim = L2V7Modules.warlock?.slimCohorts;','  try { dock(); }');
const loopCut=cut('async function loopLease() {','// Сервер/вход/антибот');
function tab(x,store,o={}){
 const writes=[],order=[],c=vm.createContext({console,store,on:true,tabOwner:false,leaseOk:true,fail:0,hero:o.hero||store.rt.char,rf:{},cfg:{},rt:J(store.rt),DEF_RT:{},
  deferredMigrations:{cfg:{},rt:{},petSlim:false},L2V7Modules:{warlock:x.api()},L2EngineCore:{rawTaskConfig:v=>v},window:{__lockT:0},location:{pathname:'/map.html'},
  chrome:{runtime:{getManifest:()=>({version:'20.41'})},storage:{local:{get:async()=>J(store)}}},rtWriter:{clear(){}},mergeCfg:v=>v||{},
  tabLock:async()=>{if(!c.leaseOk)return false;c.tabOwner=true;return true},setStatus(){},tabVis:()=>true,sleep:async()=>{},rec(){},stopPendRetry:async()=>false,setCfg:async()=>{},
  heroNick:()=>c.hero,switchChar:async()=>{order.push('switch:'+c.hero)},
  setRt:p=>{c.rt={...c.rt,...p};const char=c.rt.char||'';if(c.fail){c.fail--;return Promise.resolve({ok:false,reason:'write_failed'})}
   if(store.rt.char!==char)return Promise.resolve({ok:false,reason:'char'});writes.push({char,keys:Object.keys(p)});order.push('write:'+char);Object.assign(store.rt,J(p));return Promise.resolve({ok:true})}});
 vm.runInContext(topCut+loopCut,c);
 return {c,writes,order,load:(v={})=>{Object.assign(c,{rf:{},...v});vm.runInContext(loadCut,c)},tick:async()=>await c.loopLease()||await c.loopMigrations()};
}
const heroB=()=>fat(fixture({rt:{char:'B'},char:{name:'B'}}));
const ids=m=>Object.keys(m).sort();
test('загрузка при выключенном боте: старые строки ужимаются одной записью, следующая загрузка ничего не пишет',()=>{
 const x=fat(fixture()),store={rt:{char:'hero',petCohorts:legacy(x)}},t=tab(x,store);
 t.load({on:false});assert.equal(t.writes.length,1);const p=store.rt.petCohorts;assert.equal(Object.keys(p).length,40);assert.ok(Object.values(p).every(r=>!r.hero&&!r.snapshotKey));
 t.load({on:false});assert.equal(t.writes.length,1,'второй загрузке писать нечего');assert.equal(Object.keys(t.c.rf).length,0);
 const e=tab(x,{rt:{char:'hero'}});e.load({on:false});assert.equal(e.writes.length,0);
 // Очистка не через once(): флаг в общий cfg не ложится, другие герои её тоже получат.
 assert.doesNotMatch(loadCut,/once\(/);
});
// 20.41 (ревью petCohorts, 1): прежде вкладка без замка клала в deferredMigrations.rt готовый словарь, посчитанный при загрузке;
// после замка он писался поверх строк, которые хозяин успел дописать (migApplied снимает только пакеты с флагом once() = 1).
test('вкладка без замка откладывает только намерение; после замка ужимает свежий rt одной записью',async()=>{
 const x=fat(fixture()),store={rt:{char:'hero',petCohorts:legacy(x)}},t=tab(x,store);
 t.load({on:true,tabOwner:false});assert.equal(t.writes.length,0);assert.equal('petCohorts' in t.c.deferredMigrations.rt,false,'словарь не откладывается');
 assert.equal(t.c.deferredMigrations.petSlim,true);
 await t.tick();assert.deepEqual(t.writes,[{char:'hero',keys:['petCohorts']}]);assert.equal(Object.keys(store.rt.petCohorts).length,40);assert.equal(t.c.deferredMigrations.petSlim,false);
 await t.tick();assert.equal(t.writes.length,1,'повторно не пишет');
});
test('ревью 1: пока вкладка ждала замок, хозяин ужал и дописал строки — после замка ничего не затирается',async()=>{
 const x=fat(fixture()),store={rt:{char:'hero',petCohorts:legacy(x)}},t=tab(x,store);
 t.load({on:true,tabOwner:false});
 // Хозяин (другая вкладка): своя очистка, затем бои — счётчики растут, новая строка.
 const S1=J(x.api().slimCohorts(store.rt.petCohorts)),k0=ids(S1)[0];Object.assign(S1[k0],{fights:51,hits:510});
 S1['new:row:1']={...S1[k0],fights:1,hits:3,at:x.now()+5};store.rt.petCohorts=J(S1);
 await t.tick();assert.equal(t.writes.length,0,'свежий rt уже короткий — писать нечего');
 assert.deepEqual(store.rt.petCohorts,S1);assert.deepEqual(J(t.c.rt.petCohorts),S1);assert.equal(t.c.deferredMigrations.petSlim,false);
});
test('ревью 1: в хранилище всё ещё старые строки, но с новыми счётчиками — ужимаются именно они, не снимок загрузки',async()=>{
 const x=fat(fixture()),old=legacy(x),store={rt:{char:'hero',petCohorts:J(old)}},t=tab(x,store);
 t.load({on:true,tabOwner:false});
 const newest=Object.entries(old).sort((a,b)=>b[1].at-a[1].at)[0][0];Object.assign(store.rt.petCohorts[newest],{fights:51,hits:510});
 await t.tick();assert.equal(t.writes.length,1);const r=store.rt.petCohorts[hash(newest)];assert.equal(r.fights,51);assert.equal(r.hits,510);
});
// 20.41 (ревью petCohorts, 2): смена героя не чистит deferredMigrations — словарь героя загрузки уходил в rt другого героя
// (expectedChar = rt.char вкладки после перечтения).
test('ревью 2: пока ждали замок, в хранилище сменился герой — строки нового героя целы, чужих строк нет',async()=>{
 const x=fat(fixture()),xb=heroB(),store={rt:{char:'hero',petCohorts:legacy(x)}},t=tab(x,store);
 t.load({on:true,tabOwner:false});
 const B=J(xb.api().slimCohorts(legacy(xb,5)));store.rt={char:'B',petCohorts:J(B)};t.c.hero='B';
 await t.tick();assert.equal(t.writes.length,0);assert.deepEqual(store.rt.petCohorts,B);
});
test('ревью 2: у нового героя свои старые строки — ужимаются его строки, в его rt, до switchChar',async()=>{
 const x=fat(fixture()),xb=heroB(),A=legacy(x),store={rt:{char:'hero',petCohorts:A}},t=tab(x,store);
 t.load({on:true,tabOwner:false});
 const Bfat=legacy(xb,5);store.rt={char:'B',petCohorts:J(Bfat)};   // страница вкладки ещё показывает героя загрузки
 await t.tick();assert.deepEqual(t.writes,[{char:'B',keys:['petCohorts']}]);assert.deepEqual(t.order,['write:B','switch:hero']);
 assert.deepEqual(ids(store.rt.petCohorts),ids(Object.fromEntries(Object.keys(Bfat).map(k=>[hash(k),1]))));
 for(const k of Object.keys(A))assert.equal(hash(k) in store.rt.petCohorts,false,'строк героя загрузки нет');
});
test('запись не прошла — намерение остаётся; после потери и нового замка ужимается свежий rt',async()=>{
 const x=fat(fixture()),store={rt:{char:'hero',petCohorts:legacy(x)}},t=tab(x,store);
 t.load({on:true,tabOwner:false});t.c.fail=1;
 await t.tick();assert.equal(t.writes.length,0);assert.equal(t.c.deferredMigrations.petSlim,true);
 t.c.tabOwner=false;await t.tick();assert.deepEqual(t.writes,[{char:'hero',keys:['petCohorts']}]);assert.equal(Object.keys(store.rt.petCohorts).length,40);
 assert.equal(t.c.deferredMigrations.petSlim,false);
});
