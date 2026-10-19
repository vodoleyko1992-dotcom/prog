'use strict';
// 20.22, журнал19.10 16:40: третье поражение Sheshark считалось снова после каждого Start.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..'),survival=fs.readFileSync(path.join(root,'modules/survival.js'),'utf8'),rbrun=fs.readFileSync(path.join(root,'modules/rbrun.js'),'utf8'),content=fs.readFileSync(path.join(root,'content.js'),'utf8');
const urgent=content.match(/async function loopUrgent\(\) \{[\s\S]*?\n\}(?=\n\/\/ Режим)/)?.[0];
assert.ok(urgent,'проверяем настоящий шаг воскрешения главного цикла');
function fixture({autoRevive=true,previous=2,epic=false}={}){
 let now=1_792_392_034_000,defeated=true,acceptTown=true,saveOk=true,hook=async()=>{},S,stored;
 const data=new Map(),writes=[],notes=[],logs=[],halts=[],haltArgs=[],clicks=[],town={kind:'native-return'},statue={kind:'statue'};
 const ss={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,String(v))};
 const route={pathname:'/battle.html',search:'?spawnId=l2dop_rb_25199',href:''};
 const env={on:true,tabOwner:true,leaseEpoch:1,cfg:{autoRevive,tvtOn:false,rbHuntMode:!epic,epicMode:epic},rt:{char:'Hero',manualKickAt:1,classCur:{prof:'dwarf_bounty_hunter',slot:1},deathLog:Array.from({length:previous},(_,i)=>now-(previous-i)*7*60000),deaths:[],epic:epic?{k:'boss',step:'fight'}:null,epicDb:{},rbRun:{t0:now-60000,mode:epic?'epic':'tour'}},
  routeLocation:route,pvpPending:()=>false,epicOn:()=>epic,epicById:()=>epic?{k:'boss'}:null,mobHp:()=>({cur:4715796,max:5542351}),mobName:()=> 'Water Dragon Seer Sheshark',
  rbNote:async(id,note)=>{notes.push({id,...note});await hook('rbNote')},epicDbSet:async()=>{throw Error('счётчик эпика должен входить в общий patch')},
  setRt:async p=>{writes.push({char:env.rt.char,p:structuredClone(p)});Object.assign(env.rt,p);await hook('setRt',p);const ok=typeof saveOk==='function'?saveOk(p):saveOk;if(ok){stored=structuredClone(env.rt);await hook('durable',p)}return {ok}},
  rec:(...a)=>logs.push(a.join(' ')),setStatus(){},rnd:a=>a,sleep:async()=>hook('sleep'),pause:async()=>hook('pause'),
  waitFor:async fn=>{await hook('waitFor');return fn()},shown:el=>!!el,byText:()=>null,
  $q:s=>defeated&&s==='#battle-defeat-tocity'?town:route.pathname==='/city.html'&&s==='a.l2-town-miru-item--buffer-statue'?statue:null,
  fire:el=>{if(!env.on||!env.tabOwner)return false;clicks.push(el.kind);if(el===town&&acceptTown){ss.setItem('l2bot.toTown',now);defeated=false;route.pathname='/city.html';route.search=''}if(el===statue)route.pathname='/town-buffer.html';return true},
  isCity:()=>route.pathname==='/city.html',isBattle:()=>route.pathname==='/battle.html',isMap:()=>route.pathname==='/map.html',
  halt:async (msg,hard)=>{halts.push(msg);haltArgs.push({msg,hard});env.on=false;await hook('halt')},toOutskirts:async()=>{throw Error('лишний выход')}
 };
 Object.defineProperty(env,'rbDeaths',{get:()=>env.rt.rbRun?.deaths||0});
 class Clock extends Date{static now(){return now}}
 const load=()=>{const box={console,Date:Clock,Math,JSON,URLSearchParams,sessionStorage:ss,document:{querySelectorAll:()=>[]},location:route};vm.runInNewContext(rbrun,box);vm.runInNewContext(survival,box);env.rbRun=box.L2V7Factories.rbrun(env);S=box.L2V7Factories.survival(env);return S};
 stored=structuredClone(env.rt);load();
 const core={serverDown:()=>false,loginPage:()=>false,reviveStep:()=>S.reviveStep(),sleep:env.sleep,isMap:env.isMap,leaveCheck:async()=>false,tvtStep:async()=>false,taskPolicyNote(){}};
 Object.defineProperties(core,{rt:{get:()=>env.rt},cfg:{get:()=>env.cfg}});vm.runInNewContext(urgent+'\nthis.urgent=loopUrgent;',core);
 return {env,route,writes,notes,logs,halts,haltArgs,clicks,ss,get S(){return S},get now(){return now},advance(ms){now+=ms},set hook(fn){hook=fn},set acceptTown(v){acceptTown=v},set saveOk(v){saveOk=v},
  async start(){now+=5000;env.rt=structuredClone(stored);env.rt.deaths=[];env.rt.manualKickAt++;stored=structuredClone(env.rt);env.on=true;load();return core.urgent()},
  async flush(){return env.setRt(Object.assign({},...writes.map(x=>x.p)))},
  async tick(){return core.urgent()},nativeTown(){now++;ss.setItem('l2bot.toTown',now);defeated=false;route.pathname='/city.html';route.search=''},
  nextDefeat(){now+=2000;defeated=true;route.pathname='/battle.html';route.search='?spawnId=l2dop_rb_25199';env.on=true;load()},
  mutate(kind){if(kind==='hero')env.rt={char:'Other',manualKickAt:1};if(kind==='class')env.rt.classCur={prof:'human_arcana_lord',slot:0};if(kind==='lease')env.leaseEpoch++;if(kind==='stop')env.on=false;if(kind==='owner')env.tabOwner=false;if(kind==='kick')env.rt.manualKickAt++}
 };
}
test('третья смерть сохранена до halt; Start/reload продолжают native возврат без нового учёта',async()=>{
 const f=fixture();let atStop;
 f.hook=async point=>{if(point==='halt')atStop=structuredClone(f.env.rt)};
 await f.S.onDeath();assert.equal(atStop.deathLog.length,3);assert.equal(atStop.revive?.counted,true);assert.equal(atStop.revive?.revived,false);assert.match(f.halts[0],/3 смерти/);assert.equal(f.env.rbDeaths,1);assert.equal(f.notes.length,1);
 f.acceptTown=false;await f.start();await f.start();assert.equal(f.env.rt.deathLog.length,3);assert.equal(f.env.rbDeaths,1);assert.equal(f.notes.length,1);assert.equal(f.halts.length,1);
 f.acceptTown=true;await f.start();assert.equal(f.route.pathname,'/city.html');await f.tick();assert.equal(f.env.rt.revive,null);assert.equal(f.route.pathname,'/town-buffer.html');assert.equal(f.env.rt.deathLog.length,3);assert.equal(f.env.rbDeaths,1);
 f.nextDefeat();await f.S.onDeath();assert.equal(f.env.rt.deathLog.length,4,'новая жизнь и новое поражение того же РБ считаются отдельно');assert.equal(f.env.rbDeaths,2);assert.equal(f.notes.length,2);
});
test('прямое повторное onDeath и Start спустя 2,5 мин не теряют маркер неотработанного поражения',async()=>{
 const f=fixture();await f.S.onDeath();f.advance(180000);f.acceptTown=false;await f.start();await f.S.onDeath();assert.equal(f.env.rt.deathLog.length,3);assert.equal(f.env.rbDeaths,1);assert.equal(f.notes.length,1);assert.equal(f.env.rt.revive.counted,true);
});
test('autoRevive=false: повторный Start ничего не воскрешает; native возврат снимает ожидание',async()=>{
 const f=fixture({autoRevive:false,previous:0});await f.S.onDeath();assert.equal(f.env.rt.deathLog.length,1);assert.equal(f.clicks.length,0);
 await f.start();f.advance(180000);await f.start();await f.S.onDeath();assert.equal(f.env.rt.deathLog.length,1);assert.equal(f.env.rbDeaths,1);assert.equal(f.notes.length,1);assert.equal(f.clicks.length,0);assert.equal(f.route.href,'');
 f.nativeTown();await f.start();assert.equal(f.env.rt.revive,null);assert.equal(f.env.rt.tbuff,undefined);assert.equal(f.clicks.length,0);assert.equal(f.route.pathname,'/city.html');
 f.nextDefeat();await f.S.onDeath();assert.equal(f.env.rt.deathLog.length,2);assert.equal(f.env.rbDeaths,2);
});
test('эпик после Start/reload не получает второй deathsLife и итог серии РБ',async()=>{
 const f=fixture({epic:true,previous:0});f.env.cfg.epicMaxDeaths=1;f.env.rt.deaths1h=[f.now-10000];await f.S.onDeath();assert.equal(f.env.rt.epicDb.boss.deathsLife,1);assert.equal(f.env.rt.revive?.counted,true);await f.start();await f.tick();assert.equal(f.env.rt.epicDb.boss.deathsLife,1);assert.equal(f.env.rbDeaths,1);assert.equal(f.env.rt.deathLog.length,1);
});
for(const kind of ['stop','lease'])test('эпик: '+kind+' сразу после durable save не теряет deathsLife, серию и часовую смерть',async()=>{
 const f=fixture({epic:true,previous:0});let changed=false;f.hook=async(point,p)=>{if(point==='durable'&&p.revive?.counted&&!changed){changed=true;f.mutate(kind)}};
 await f.S.onDeath();assert.equal(changed,true);assert.equal(f.clicks.length,0);
 const p=f.writes.find(x=>x.p.revive?.counted).p;assert.equal(p.epicDb.boss.deathsLife,1);assert.equal(p.rbRun.deaths,1);assert.equal(p.deaths1h.length,1);assert.equal(p.deathLog.length,1);
 f.hook=async()=>{};await f.start();await f.tick();assert.equal(f.env.rt.epicDb.boss.deathsLife,1);assert.equal(f.env.rt.rbRun.deaths,1);assert.equal(f.env.rt.deaths1h.length,1);assert.equal(f.env.rt.deathLog.length,1);
});
test('явное включение autoRevive после ручного стопа разрешает обычное восстановление',async()=>{
 const f=fixture({autoRevive:false,previous:0});await f.S.onDeath();f.env.cfg.autoRevive=true;await f.start();await f.tick();assert.equal(f.env.rt.revive,null);assert.equal(f.route.pathname,'/town-buffer.html');assert.equal(f.env.rt.deathLog.length,1);assert.equal(f.env.rbDeaths,1);
});
test('выключение autoRevive после третьей смерти запрещает сохранённый автоклик',async()=>{
 const f=fixture();await f.S.onDeath();f.env.cfg.autoRevive=false;await f.start();assert.equal(f.clicks.length,0);assert.equal(f.env.rt.deathLog.length,3);assert.equal(f.env.rt.revive.counted,true);
});
test('старый native возврат до смерти не завершает новое учтённое поражение после неудачного клика',async()=>{
 const f=fixture();f.ss.setItem('l2bot.toTown',f.now-1000);await f.S.onDeath();f.acceptTown=false;await f.start();assert.equal(f.env.rt.revive.revived,true);
 f.env.cfg.autoRevive=false;const n=f.clicks.length;await f.start();assert.equal(f.env.rt.revive.counted,true);assert.equal(f.env.rt.deathLog.length,3);assert.equal(f.clicks.length,n);assert.equal(f.env.on,false);
});
for(const failure of ['false','throw'])test('отказ первой записи '+failure+': hard Stop; успешный retry не воскрешает до нового Start',async()=>{
 const f=fixture();f.saveOk=p=>{if(!p.revive?.counted)return true;if(failure==='throw')throw Error('хранилище недоступно');return false};
 await f.S.onDeath();assert.equal(f.halts.length,1);assert.equal(f.haltArgs[0].hard,true);assert.match(f.halts[0],/Не удалось сохранить/);assert.equal(f.clicks.length,0);assert.equal(f.env.rbDeaths,1);assert.equal(f.env.rt.revive.counted,true);assert.equal(f.env.rt.deathLog.length,3);assert.equal(f.env.on,false);
 f.saveOk=true;await f.S.reviveStep();await f.flush();await f.S.reviveStep();assert.equal(f.clicks.length,0);assert.equal(f.env.rt.rbRun.deaths,1);assert.equal(f.env.rt.deathLog.length,3);assert.equal(f.env.on,false);
 await f.start();await f.tick();assert.equal(f.route.pathname,'/town-buffer.html');assert.equal(f.env.rt.rbRun.deaths,1);assert.equal(f.env.rt.deathLog.length,3);assert.equal(f.halts.length,1);
});
test('отказ записи завершения оставляет маркер и не открывает статую',async()=>{
 const f=fixture({autoRevive:false,previous:0});await f.S.onDeath();f.nativeTown();f.env.on=true;f.saveOk=p=>p.revive!==null;await f.S.reviveStep();assert.equal(f.env.rt.revive.counted,true);assert.equal(f.clicks.length,0);
 f.saveOk=true;await f.start();assert.equal(f.env.rt.revive,null);assert.equal(f.env.rt.deathLog.length,1);assert.equal(f.clicks.length,0);
});
for(const kind of ['hero','class','lease','stop','owner','kick'])for(const point of ['rbNote','setRt','sleep','waitFor','pause'])test(`граница ${kind} при ${point} не продолжает старое воскрешение`,async()=>{
 const f=fixture({previous:point==='pause'?2:0});let changed=false,at=0;f.hook=async p=>{if(p===point&&!changed){changed=true;at=f.writes.length;f.mutate(kind)}};
 if(point==='pause'){await f.S.onDeath();f.env.on=true;f.route.pathname='/battle.html';await f.S.reviveStep()}else await f.S.onDeath();
 assert.equal(changed,true);assert.equal(f.writes.length,at);assert.equal(f.clicks.length,0);assert.equal(f.writes.filter(x=>x.char==='Other').length,0);
});
for(const kind of ['interface','network',undefined])test('диагноз зависания '+String(kind)+' не объявляет неподтверждённую силу РБ',async()=>{
 const f=fixture({autoRevive:false,previous:0});f.ss.setItem('l2bot.srvHang',JSON.stringify({t:f.now,why:'застой боя',...(kind?{kind}:{})}));await f.S.onDeath();assert.equal(f.notes[0].verdict,undefined);
 assert.match(f.logs.join('\n'),kind==='interface'?/при застывшем интерфейсе боя \(застой боя\)/:/пока сервер не отвечал \(застой боя\)/);
 if(kind==='interface')assert.doesNotMatch(f.logs.join('\n'),/пока сервер не отвечал/);
});
