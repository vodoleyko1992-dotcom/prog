'use strict';
// 14.10: сквозной daily detour + фактический popup.setMode; паузы хранилища моделируют Stop/ручной режим.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
function make(){
 const loc={pathname:'/map.html',href:''},cfgs=[],posts=[],series=[];
 const sb={console,Date,location:loc,sessionStorage:{getItem(){return null},setItem(){}}};sb.globalThis=sb;
 vm.runInNewContext(read('modules/dailies.js'),sb);
 const env={cfg:{dailyAuto:true,clanTasks:true,zoneAuto:true,fishMode:false,rbHuntMode:false,epicMode:false,catMode:false},rt:{daily:{day:'audit-day',t:Date.now(),tasks:{fishing_catch_50:{have:49,need:50,done:false}}}},on:true,tabOwner:true,
 isBattle:()=>false,awayFree:()=>true,fishNow:()=>env.cfg.fishMode,heroLevel:()=>75,rec(){},setStatus(){},sleep:async()=>{},setRt:async p=>Object.assign(env.rt,p),setCfg:async p=>{cfgs.push(p);Object.assign(env.cfg,p)},rbRun:{start:async x=>series.push(x)},gamePost:async p=>{posts.push(p);return {ok:true,json:async()=>({})}}};
 sb.save=async()=>{};sb.chrome={storage:{local:{get:async()=>({cfg:env.cfg,rt:env.rt,on:env.on})}}};
 sb.menuPatch=async(p,o={})=>{Object.assign(env.rt,p);Object.assign(env.cfg,o.cfgPatch||{});if(o.on!==undefined)env.on=o.on;};
 sb.activateMode=async(p,c)=>sb.menuPatch({...p,manualKickAt:Date.now()},{cfgPatch:c,on:true});sb.toast=()=>{};sb.MODE_NAME={};
 const popup=read('popup.js'),a=popup.indexOf('const MODES_OFF ='),b=popup.indexOf('// 10.0: повторное нажатие',a);assert(a>=0&&b>a);vm.runInNewContext(popup.slice(a,b),sb);
 return {loc,env,D:sb.L2V7Factories.dailies(env),mode:sb.setMode,cfgs,posts,series};
}
test('auto → dailyFish → manual raid сохраняет ручной выбор и прогресс',async()=>{
 const {env,D,mode}=make();await D.dailyStep();await mode('rb');await D.fishNote();await D.dailyStep();
 assert.equal(env.cfg.rbHuntMode,true);assert.equal(env.cfg.fishMode,false);assert.equal(env.rt.dailyFish,null);assert.equal(env.rt.dailyDone.fish,'audit-day');
});
for(const why of ['Stop','потеря вкладки'])test(why+' при записи старта не переключает режим; продолжение доводит тот же дейлик',async()=>{
 const {env,D,cfgs}=make();let first=true;env.setRt=async p=>{Object.assign(env.rt,p);if(first&&p.dailyFish){first=false;if(why==='Stop')env.on=false;else env.tabOwner=false;}};
 await D.dailyStep();assert.equal(cfgs.length,0);assert.equal(env.cfg.zoneAuto,true);
 env.on=true;env.tabOwner=true;await D.dailyStep();assert.equal(env.cfg.fishMode,true);
 await D.fishNote();await D.dailyStep();assert.equal(env.cfg.zoneAuto,true);assert.equal(env.cfg.fishMode,false);assert.equal(env.rt.dailyFish,null);
});
test('ручной режим во время записи старта не перекрывается старым dailyStep',async()=>{
 const {env,D,mode}=make();let first=true;env.setRt=async p=>{Object.assign(env.rt,p);if(first&&p.dailyFish){first=false;await mode('rb');}};
 await D.dailyStep();assert.equal(env.cfg.rbHuntMode,true);assert.equal(env.cfg.fishMode,false);assert.equal(env.rt.dailyFish,null);
});
test('выключение dailyAuto завершает незаконченный detour с возвратом',async()=>{
 const {env,D}=make();await D.dailyStep();env.cfg.dailyAuto=false;await D.dailyStep();assert.equal(env.rt.dailyFish,null);assert.equal(env.cfg.fishMode,false);assert.equal(env.cfg.zoneAuto,true);
});
test('Stop во время возврата не меняет страницу, restart закрывает готовый detour',async()=>{
 const {env,D,loc}=make();await D.dailyStep();await D.fishNote();loc.pathname='/fishing.html';
 env.setCfg=async p=>{Object.assign(env.cfg,p);env.on=false;};await D.dailyStep();assert.equal(loc.href,'');assert.ok(env.rt.dailyFish,'готовый detour остаётся до подтверждённого возврата');
 env.on=true;env.setCfg=async p=>Object.assign(env.cfg,p);await D.dailyStep();assert.equal(env.rt.dailyFish,null);assert.equal(env.cfg.zoneAuto,true);assert.equal(loc.href,'/map.html');
});
test('РБ по дейлику → один зачтённый kill → прежний auto и одна серия',async()=>{
 const {env,D,series}=make();env.rt.daily.tasks={strong_enemy_20:{have:0,need:1,done:false}};env.rt.rbKills=5;
 await D.dailyStep();assert.equal(env.cfg.rbHuntMode,true);assert.deepEqual(series,['daily']);env.rt.rbKills=6;await D.dailyStep();assert.equal(env.cfg.rbHuntMode,false);assert.equal(env.cfg.zoneAuto,true);assert.equal(env.rt.dailyRb,null);
});
test('остановленный бот не выполняет POST кланового задания и не возвращает detour',async()=>{
 const {env,D,posts,cfgs}=make();env.rt.clanTasks={t:Date.now(),me:{id:'hero'},defs:[{id:'kill_monsters',n:'Охота',canTake:true,reward:{}}],active:[]};
 env.rt.dailyFish={got:1,need:1,t:Date.now(),prev:{fishMode:false,zoneAuto:true}};env.on=false;await D.clanStep();await D.dailyStep();assert.deepEqual(posts,[]);assert.deepEqual(cfgs,[]);
});
