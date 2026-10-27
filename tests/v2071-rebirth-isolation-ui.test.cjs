'use strict';
// 20.71 (John: «вынеси режим подземелий вообще отдельно»). Написано без запуска по просьбе «без проверок».
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'popup.js'),'utf8'),html=fs.readFileSync(path.join(root,'popup.html'),'utf8');
const D=require(path.join(root,'defaults.js'));
function fixture(){
 const state={cfg:{...D.CFG,autoTasks:['tvt','raid','cat','auto','farm','petbuff'],zoneAuto:true,rbMode:true,rbHuntMode:true,catMode:true,epicMode:true,
  rebirthAutoEnter:false,rebirthDifficulty:2,rebirthBossChoice:'manual',rebirthKeyReserve:7},rt:{rebirth:{pending:{id:'unknown-entry'}},rbGo:{id:'old-rb'},zoneGo:{id:'old-zone'},catIn:'old-cat'},on:false,starts:0,tabs:[]};
 const box={console,Date,Object,Set,Promise,Number,Array,String,Math,formChar:'Hero',settingsSerial:0,controlGeneration:0,DEF:D.CFG,
  chrome:{storage:{local:{get:async()=>({cfg:state.cfg,rt:state.rt})}}},load:async()=>{},save:async()=>true,
  menuPatch:async(p,o)=>{Object.assign(state.rt,p);Object.assign(state.cfg,o.cfgPatch);},
  $:id=>id==='start'?{onclick:async()=>{state.on=true;state.starts++}}:null,showTab:t=>state.tabs.push(t),toast:()=>{}};
 vm.createContext(box);
 vm.runInContext(source.slice(source.indexOf('const AUTO_TASK_LABELS ='),source.indexOf('function currentMode('))+
  source.slice(source.indexOf('async function quickStart('),source.indexOf('async function botControl('))+
  '\nthis.edit=editAutoTask;this.quick=quickStart;this.patch=autoTaskPatch;',box);
 return {box,state};
}
test('подземелья являются самостоятельным разделом навигации, а не частью Охоты',()=>{
 assert.match(html,/<button data-tab="rebirth"[^>]*>[\s\S]*?<span class="lb">Подземелья<\/span><\/button>/);
 assert.match(html,/<section id="tab-rebirth">/);
 const hunt=html.slice(html.indexOf('<section id="tab-hunt">'),html.indexOf('<section id="tab-rebirth">'));
 assert.ok(!hunt.includes('id="rebirthMode"'));
 const groups=source.slice(source.indexOf('const TAB_GROUP ='),source.indexOf('const DOCK_UI_KEY'));
 assert.ok(!/rebirth\s*:/.test(groups));
 for(const id of ['rebirthMode','rebirthDifficulty','rebirthBossChoice','rebirthAutoEnter','rebirthKeyReserve','rebirthBox','rebirthStart'])
  assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
});
test('выбор подземелий заменяет основные задачи, сохраняет только уже выбранные фоновые и не запускает бота',async()=>{
 const f=fixture();await f.box.edit('rebirth',true);
 assert.deepEqual(Array.from(f.state.cfg.autoTasks),['tvt','petbuff','rebirth']);
 for(const key of ['zoneAuto','rbMode','rbHuntMode','catMode','epicMode','craftMode','enchantMode','fishMode','campaign','storyTurnIn'])assert.equal(f.state.cfg[key],false,key);
 assert.equal(f.state.cfg.rebirthMode,true);assert.equal(f.state.on,false);assert.equal(f.state.starts,0);
 assert.equal(f.state.rt.rbGo,null);assert.equal(f.state.rt.zoneGo,null);assert.equal(f.state.rt.catIn,null);
 assert.deepEqual(f.state.rt.rebirth,{pending:{id:'unknown-entry'}},'неизвестная оплата похода сохраняется');
});
test('быстрый запуск открывает самостоятельный раздел без сброса выбора РБ, сложности, ключей или неизвестной оплаты',async()=>{
 const f=fixture();await f.box.quick('rebirth');
 assert.deepEqual(f.state.tabs,['rebirth']);assert.equal(f.state.starts,1);assert.equal(f.state.on,true);
 assert.deepEqual(Array.from(f.state.cfg.autoTasks),['tvt','petbuff','rebirth']);
 assert.equal(f.state.cfg.rebirthDifficulty,2);assert.equal(f.state.cfg.rebirthAutoEnter,false);assert.equal(f.state.cfg.rebirthKeyReserve,7);assert.equal(f.state.cfg.rebirthBossChoice,'manual');
 assert.deepEqual(f.state.rt.rebirth,{pending:{id:'unknown-entry'}});
});
test('явный выбор другого основного режима снимает отдельный Rebirth без добавления сторонних задач',()=>{
 const f=fixture(),d={...f.state.cfg,autoTasks:['tvt','rebirth'],rebirthMode:true};
 for(const key of ['farm','auto','cat','raid','epic','fish','craft']){
  const p=f.box.patch(d,key,true);assert.equal(p.rebirthMode,false,key);assert.deepEqual(Array.from(p.autoTasks),['tvt',key],key);
 }
});
