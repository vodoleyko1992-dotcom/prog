'use strict';
// 20.68: ожидание кнопки сдачи не превращает выбранные квесты в простой вместо местной охоты.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(process.env.L2_CORE_SOURCE||path.join(__dirname,'../content.js'),'utf8');
function fixture(){
 const state={selected:'quests',wait:{reason:'level'},ready:true,map:0,idle:0,daily:0,go:0};
 const box={cfg:{autoTasks:['quests']},rt:{},location:{pathname:'/map.html'},L2EngineCore:{selectedTask:()=>state.selected,taskAllowed:()=>false},
  L2V7Modules:{quests:{campCompletionWait:()=>state.wait},mobfarm:{map:async()=>{state.map++;}}},campOn:()=>false,
  tasksIdle:async()=>{state.idle++;},dailyWorkReady:async kind=>{assert.equal(kind,'mobs');state.daily++;return state.ready;},
  lootGoal:()=>false,autonomyMode:()=>state.selected==='quests'?'campaign':'tasks',fishNow:()=>false,isBattle:()=>false,prepHold:()=>false,
  isCampaign:()=>false,isMail:()=>false,isQuests:()=>false,isMap:()=>true,sleep:async()=>{},goOutskirts:async()=>{state.go++;}};
 vm.createContext(box);
 const map=source.slice(source.indexOf('const raidIdleFarm ='),source.indexOf('// ---------- бой ----------'));
 const wait=source.includes('const campCompletionWait =')?source.slice(source.indexOf('const campCompletionWait ='),source.indexOf('async function goCampaign')):'const campCompletionWait=()=>null;';
 const loop=source.slice(source.indexOf('async function loopActivity()'),source.indexOf('// Магистр:',source.indexOf('async function loopActivity()')));
 vm.runInContext(wait+'\n'+map+'\n'+loop+'\nthis.runMap=map;this.runActivity=loopActivity;',box);
 return {state,box};
}
test('квесты с ожиданием сдачи: настоящий map wrapper пропускает местную охоту через дневной лимит',async()=>{
 const f=fixture();await f.box.runMap();assert.equal(f.state.map,1);assert.equal(f.state.daily,1);assert.equal(f.state.idle,0);
});
test('квесты с ожиданием сдачи: настоящий loopActivity доходит до map, а не tasksIdle',async()=>{
 const f=fixture();await f.box.runActivity();assert.equal(f.state.map,1);assert.equal(f.state.idle,0);assert.equal(f.state.go,0);
});
test('обычное выключение кампании без ожидания по-прежнему не разрешает охоту',async()=>{
 const f=fixture();f.state.wait=null;await f.box.runMap();await f.box.runActivity();assert.equal(f.state.map,0);assert.equal(f.state.idle,2);
});
test('ожидание главы не обходит дневной лимит мобов',async()=>{
 const f=fixture();f.state.ready=false;await f.box.runActivity();assert.equal(f.state.daily,1);assert.equal(f.state.map,0);
});
test('ожидание квеста не разрешает охоту, когда выбраны только другие задачи',async()=>{
 const f=fixture();f.state.selected='mammon';await f.box.runMap();await f.box.runActivity();assert.equal(f.state.map,0);assert.equal(f.state.idle,2);
});
