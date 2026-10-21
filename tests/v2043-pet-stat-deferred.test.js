'use strict';
// 20.43 (лог 21.10 15:47–15:51): статистика кота (petStat/petAdvice/petCohorts) и отметка EXP% (expMark) после каждой победы
// писались полной записью памяти ≈960 КБ. Теперь — отложенной статистикой (RT_STAT_SOON) и под защитой сброса из меню
// (MENU_STAT_KEYS): «Сбросить статистику котов» не откатывается пакетом вкладки, собранным до сброса.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const core=require('../engine-core.js'),read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8'),clone=x=>JSON.parse(JSON.stringify(x));
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r))};
const KEYS=['petStat','petAdvice','petCohorts','expMark'];
function background(storage){
 const src=read('background.js'),cut=(a,b)=>{const i=src.indexOf(a),j=src.indexOf(b,i);if(i<0||j<i)throw Error(a);return src.slice(i,j)};
 const hold=[],ctx={console,Date,URL,Number,JSON,Object,Math,Promise,Set,Array,String,L2EngineCore:core,MAX_PATCH_KEYS:400,LOCK_TTL:90000,lockQueue:Promise.resolve(),
  chrome:{runtime:{getURL:p=>'chrome-extension://x/'+p},storage:{local:{get:async keys=>{const r={};for(const k of keys)r[k]=clone(storage[k]??null);return r},
   set:async p=>{if(hold.length)await hold.shift();Object.assign(storage,clone(p))}}}}};
 vm.createContext(ctx);vm.runInContext(cut('function serializeLock(fn)','async function lockCommand(')+cut('function mergeTimerPatch(','// Реворк ядра'),ctx);
 const tab={frameId:0,url:'https://l2wap.com/battle.html',tab:{id:1}},menu={url:'chrome-extension://x/popup.html'};
 return {hold,state:(patch,extra={})=>ctx.statePatch({patch,epoch:'e1',src:'tab-1',expectedChar:'Hero',...extra},tab),menu:(rtPatch,extra={})=>ctx.menuPatch({rtPatch,...extra},menu)};
}
test('ключи кота и expMark — в отложенной статистике вкладки и в MENU_STAT_KEYS',()=>{
 const src=read('content.js'),m=src.match(/const RT_STAT_SOON = new Set\(\[([\s\S]*?)\]\);/);assert.ok(m);
 for(const k of KEYS){assert.ok(m[1].includes(`'${k}'`),'RT_STAT_SOON '+k);assert.ok(core.MENU_STAT_KEYS.includes(k),'MENU_STAT_KEYS '+k);}
 for(const k of ['petFull','petBornT','petLast','petResummon','mobClickAt'])assert.ok(!core.MENU_STAT_KEYS.includes(k),k);
});
test('сброс статистики котов из меню не воскрешается отложенным petStat вкладки',async()=>{
 const S={on:true,lock:{k:'tab1',epoch:'e1',t:Date.now()},cfg:{},rt:{char:'Hero',petStat:{kai:{fights:40}},petAdvice:{text:'old'}}},B=background(S);let tabRt=clone(S.rt);
 const q=core.createPatchQueue(p=>B.state(p,{menuRev:+tabRt.menuRev||0}),()=>true,()=>{},()=>Date.now(),{set:()=>0,clear(){}});
 let release;B.hold.push(new Promise(r=>release=r));
 const reset=B.menu({petStat:{},petAdvice:null});await flush();
 q.defer({petStat:{kai:{fights:41}},petAdvice:{text:'old+1'},expMark:{p:5,l:78}});const w=q.enqueue({mobClickAt:4});await flush();
 release();await reset;
 const keys=Object.keys(q.peek()).filter(k=>core.MENU_STAT_KEYS.includes(k));q.drop(keys);tabRt={...S.rt,...q.peek()};
 await w;
 assert.deepEqual(S.rt.petStat,{},'сброс сохранён');assert.equal(S.rt.petAdvice,null);assert.equal(S.rt.mobClickAt,4,'прочее пишется');
 await B.state({petStat:{kai:{fights:1}}},{menuRev:S.rt.menuRev});assert.deepEqual(S.rt.petStat,{kai:{fights:1}},'после сброса новая статистика пишется');
});
test('combat/warlock пишут статистику кота обычным setRt — ядро само откладывает (без отдельной ожидаемой записи)',()=>{
 const c=read('content.js');assert.match(c,/if \(Object\.keys\(patch\)\.every\(k => RT_STAT_SOON\.has\(k\)\)\) return rtWriter\.defer\(patch, 8000\);/);
 assert.match(read('modules/combat.js'),/env\.setRt\(\{ petStat: S, petAdvice: petAdvice\(S\) \}\)/);
 assert.match(read('modules/warlock.js'),/env\.setRt\(\{ petCohorts: kept \}\)/);
});
