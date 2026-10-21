'use strict';
// 20.43 (лог 21.10 17:13): старая выполненная цель рыбалки («✅ 1679 рыб», 18.10) держала selectedTask без рыбалки —
// игрок снова выбрал рыбалку в задачах, а бот писал «только задачи: TvT; дел нет, стою». Новое явное включение рыбалки
// (галка задачи или «Старт» с выбранной рыбалкой) снимает выполненную цель; незавершённая цель и прочие записи не трогаются.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const core=require('../engine-core.js'),read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8'),clone=x=>JSON.parse(JSON.stringify(x));
function background(storage){
 const src=read('background.js'),cut=(a,b)=>{const i=src.indexOf(a),j=src.indexOf(b,i);if(i<0||j<i)throw Error(a);return src.slice(i,j)};
 const ctx={console,Date,URL,Number,JSON,Object,Math,Promise,Set,Array,String,L2EngineCore:core,MAX_PATCH_KEYS:400,LOCK_TTL:90000,lockQueue:Promise.resolve(),
  afterOnWrite:async()=>{},stopAlert:async()=>{},
  chrome:{runtime:{getURL:p=>'chrome-extension://x/'+p},storage:{local:{get:async keys=>{const r={};for(const k of keys)r[k]=clone(storage[k]??null);return r},set:async p=>{Object.assign(storage,clone(p))}}}}};
 vm.createContext(ctx);vm.runInContext(cut('function serializeLock(fn)','async function lockCommand(')+cut('function mergeTimerPatch(','// Реворк ядра'),ctx);
 return (rtPatch,extra={})=>ctx.menuPatch({rtPatch,...extra},{url:'chrome-extension://x/popup.html'});
}
const done={type:'fish',n:1679,got:1679,t:1,done:true,doneT:2,final:true};
const store=(tasks,tgt=done)=>({on:true,cfg:{autoTasks:tasks},rt:{char:'Hero',fishTgt:clone(tgt)}});
test('до правки: выполненная цель держит выбранную рыбалку в простое',()=>{
 const S=store(['tvt','fish']);assert.equal(core.selectedTask(S.cfg,S.rt),'tasks');
});
test('галка рыбалки снова включена → выполненная цель снята, рыбалка — выбранная задача',async()=>{
 const S=store(['tvt','dailies']),menu=background(S);
 assert.equal((await menu({manualKickAt:5},{cfgPatch:{autoTasks:['tvt','fish','dailies']},expectedChar:'Hero'})).ok,true);
 assert.equal(S.rt.fishTgt,null);assert.equal(core.selectedTask(S.cfg,S.rt),'fish');
});
test('«Старт» с уже выбранной рыбалкой снимает выполненную цель (состояние из лога)',async()=>{
 const S=store(['tvt','fish']),menu=background(S);
 assert.equal((await menu({manualKickAt:5},{on:true,expectedChar:'Hero'})).ok,true);
 assert.equal(S.rt.fishTgt,null);assert.equal(core.selectedTask(S.cfg,S.rt),'fish');
});
test('незавершённая цель, другие задачи и правка без включения рыбалки цель не трогают',async()=>{
 const run={type:'fish',n:100,got:10,t:1};
 let S=store(['tvt'],run),menu=background(S);await menu({},{cfgPatch:{autoTasks:['tvt','fish']},expectedChar:'Hero'});assert.deepEqual(S.rt.fishTgt,run);
 S=store(['tvt','fish']);menu=background(S);await menu({},{cfgPatch:{autoTasks:['tvt','fish','clan']},expectedChar:'Hero'});assert.equal(S.rt.fishTgt.done,true,'рыбалка уже была выбрана — без «Старта» цель остаётся');
 S=store(['tvt']);menu=background(S);await menu({},{cfgPatch:{autoTasks:['tvt','cat']},expectedChar:'Hero'});assert.equal(S.rt.fishTgt.done,true);
 S=store(['tvt']);menu=background(S);await menu({manualKickAt:5},{on:true,expectedChar:'Hero'});assert.equal(S.rt.fishTgt.done,true,'Старт без рыбалки');
});
test('простой в режиме задач называет выполненную цель рыбалки',()=>{
 const src=read('content.js');assert.match(src,/рыбалка не идёт: цель/);
});
