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
// Очистка при загрузке: кусок блока миграций content.js от новой строки до записи rf, и начало loopMigrations (запись отложенного после замка).
const loadCut=(()=>{const a=C.indexOf('{ const pc = rt.petCohorts;'),b=C.indexOf('else setRt(rf);\n  }',a)+'else setRt(rf);\n  }'.length;assert.ok(a>0&&b>a);return C.slice(a,b)})();
const loopCut=(()=>{const a=C.indexOf('async function loopMigrations() {'),m='  if (cfgStale) deferredMigrations.cfg = {};',b=C.indexOf(m,a);assert.ok(a>0&&b>a);return C.slice(a,b)+'}'})();
function boot(x,state){
 const calls=[],c={rt:{...state},rf:{},on:false,tabOwner:false,deferredMigrations:{cfg:{},rt:{}},L2V7Modules:{warlock:x.api()},L2EngineCore:{rawTaskConfig:v=>v},cfg:{},Object,
  migApplied:(patch,...states)=>Object.keys(patch).some(k=>patch[k]===1&&states.some(s=>s&&s[k])),setRt:p=>{calls.push(JSON.parse(JSON.stringify(p)));Object.assign(c.rt,p);return Promise.resolve({ok:true})}};
 vm.runInNewContext(loopCut,c);return {c,calls,load:(o={})=>{Object.assign(c,{rf:{},...o});vm.runInNewContext(loadCut,c)}};
}
test('загрузка: старые строки ужимаются одной записью, следующая загрузка ничего не пишет',()=>{
 const x=fat(fixture()),b=boot(x,{char:'hero',petCohorts:legacy(x)});
 b.load();assert.equal(b.calls.length,1);const p=b.calls[0].petCohorts;assert.equal(Object.keys(p).length,40);assert.ok(Object.values(p).every(r=>!r.hero&&!r.snapshotKey));
 b.load();assert.equal(b.calls.length,1,'второй загрузке писать нечего');assert.equal(Object.keys(b.c.rf).length,0);
 const e=boot(x,{char:'hero'});e.load();assert.equal(e.calls.length,0);
 // Очистка не через once(): флаг в общий cfg не ложится, другие герои её тоже получат.
 assert.doesNotMatch(loadCut,/once\(/);
});
test('вкладка без замка при включённом боте только откладывает очистку; после замка loopMigrations пишет её',async()=>{
 const x=fat(fixture()),b=boot(x,{char:'hero',petCohorts:legacy(x)});
 b.load({on:true,tabOwner:false});assert.equal(b.calls.length,0);assert.equal(Object.keys(b.c.deferredMigrations.rt.petCohorts).length,40);
 b.c.tabOwner=true;await b.c.loopMigrations();assert.equal(b.calls.length,1);assert.equal(Object.keys(b.calls[0].petCohorts).length,40);assert.deepEqual(J(b.c.deferredMigrations.rt),{});
});
