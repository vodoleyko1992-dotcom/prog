'use strict';
// Лог27.10 02:46: 266 повторов сдачи Dion9 без кнопки при level35/minLevel36 и atNpc:true.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.env.L2_TEST_ROOT||path.resolve(__dirname,'..'),code=fs.readFileSync(process.env.QUESTS_SOURCE||path.join(root,'modules/quests.js'),'utf8');
const combat=fs.readFileSync(path.join(root,'modules/combat.js'),'utf8');
const a=combat.indexOf('  if (!ctx.rebirth && env.cfg.campaign) {\n    // условия главы'),b=combat.indexOf('  // квест: прогресс с экрана победы',a);
assert.ok(a>0&&b>a,'исполняем настоящий post-win учёт кампании');
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(o={}){
 let now=1793066230000,level=o.level??35,Q,complete=o.complete??false,done=o.done??true;
 const page={pathname:'/dion-campaign.html',href:'/dion-campaign.html',search:''},calls=[],status=[],storage=new Map();
 const state={title:'Перед бурей',chapter:9,atNpc:o.atNpc??true,reads:0,outs:0,teleports:0,finishes:0,waitHook:null,saveHook:null};
 const npc={textContent:'К NPC',dataset:{questTeleportId:'wastelands'},disabled:false};
 const finish={textContent:'Завершить главу',dataset:{action:'complete-chapter'},disabled:false};
 const target={textContent:'Leto Lizardman Soldier: 50 / 50',querySelector:s=>s==='strong'?{textContent:'Leto Lizardman Soldier'}:s==='.l2-starter-story-progress'?{textContent:done?'50 / 50':'49 / 50'}:null};
 const ch={name:'Hero',id:'own-hero',revision:100,currentZoneId:'dion',locationType:'zone',activeDungeonId:null,worldX:0,worldY:0};
 const env={on:true,tabOwner:true,cfg:{campaign:true,campAuto:true,campaignEvery:25,autoTasks:['quests','petbuff'],autoKillLimit:0},rt:{char:'Hero',classCur:{prof:'human_wizard',slot:0},manualKickAt:1},leaseEpoch:'lease',routeLocation:page,
  heroLvl:()=>level,isCampaign:()=>page.pathname==='/dion-campaign.html',isMail:()=>false,canAct:()=>true,
  setRt:async p=>{Object.assign(env.rt,p);state.saveHook?.(p);return{ok:true}},rtCommit:async()=>true,
  setStatus:s=>status.push(s),rec:(...xs)=>calls.push(xs),sleep:async()=>{},pause:async()=>{},rnd:()=>0,
  shown:b=>!!b&&!b.hidden,$q:s=>s.includes('-campaign-title')?{textContent:state.title}:s==='[data-action="complete-chapter"]'?(complete?finish:null):s.startsWith('li.l2-starter-story-target,')?target:s.startsWith('.l2-starter-story-location')?(o.npc?npc:null):null,
  waitFor:async fn=>{state.waitHook?.();return fn()},goOutskirts:async()=>{state.outs++;page.pathname='/map.html';page.href='/map.html'},
  gameGet:async p=>{assert.equal(p,'/character');return{ok:true,json:async()=>({character:clone(ch)})}},
  fire:b=>{if(b===finish){state.finishes++;state.title='Последний удар';state.chapter++;note({chapter:state.chapter,chapterTitleRu:state.title});return true;}
   assert.equal(b,npc);state.teleports++;const req={teleportId:'wastelands',expectedRevision:ch.revision};Object.assign(ch,{revision:ch.revision+1,currentZoneId:'wastelands',worldX:100,worldY:200});
   Q.campLocationNote('/game/story-quests/dion-campaign/teleport',{method:'POST',status:200,req,res:{character:clone(ch)}});note({location:{atNpc:true}});return true;
  }
 };
 const doc={querySelectorAll:s=>s==='li.l2-starter-story-target'?[target]:s==='[data-quest-teleport-id], [data-quest-transport-id]'?(o.npc?[npc]:[]):[],querySelector:()=>null};
 function load(){class Clock extends Date{static now(){return now;}}const box={document:doc,Date:Clock,URL,console,sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}};
  vm.runInNewContext(code,box);Q=box.L2V7Factories.quests(env);vm.runInNewContext('this.afterWin=async function(env,ctx){'+combat.slice(a,b)+'}',box);
  env.campActive=Q.campActive;env.campOpen=Q.campOpen;env.applyQuestLog=async()=>({changes:[],closed:[],verify:false});env.goalLines=()=>0;
  return box.afterWin;
 }
 const qdata={stage:'active',completed:false,chapter:9,chapterTitleRu:state.title,level,minLevel:o.minLevel??36,location:{atNpc:state.atNpc}};
 function note(p={}){Object.assign(qdata,p);Q.dionNote(qdata);}
 let afterWin=load();note();env.rt.campaignPoints=[{tp:'wastelands',x:100,y:200}];
 return {env,state,page,status,get Q(){return Q;},note,tick:ms=>now+=ms,setLevel:n=>level=n,setDone:v=>done=v,setComplete:v=>complete=v,
  async read(){page.pathname='/dion-campaign.html';page.href=page.pathname;state.reads++;await Q.campaign()},
  async win(){page.pathname='/battle.html';page.href=page.pathname;await afterWin(env,{name:'Ordinary Mob',killed:[],champ:false,goalsAt:0});if(Q.campOn()&&env.rt.campaignDue){await Q.goCampaign();if(page.href==='/dion-campaign.html')await this.read();}},
  reload(){env.rt=clone(env.rt);afterWin=load();},now:()=>now,
 };
}

test('Dion9 level35/min36 уже у NPC: первая проверка сохраняет цели и не телепортирует',async()=>{
 const f=fixture({npc:true}),cfg=clone(f.env.cfg);await f.read();assert.equal(f.Q.campOn(),false);assert.equal(f.Q.campActive(),false);
 assert.equal(f.state.teleports,0);assert.equal(f.env.rt.campCompletionWait.kind,'level');assert.equal(f.env.rt.campCompletionWait.minLevel,36);
 assert.equal(f.env.rt.campaign.targets[0].done,50);assert.equal(f.env.rt.campaign.targets[0].ok,true);assert.deepEqual(f.env.cfg,cfg);
 assert.match(f.status.at(-1),/35.*36/);assert.equal(f.state.outs,1);
});
test('настоящий post-win: 80 побед не возвращают на сдачу и не обещают её после каждого боя',async()=>{
 const f=fixture();await f.read();f.status.length=0;for(let i=0;i<80;i++)await f.win();assert.equal(f.state.reads,1);assert.equal(f.Q.campOn(),false);
 assert.ok(!f.status.some(s=>/Все цели главы выполнены/.test(s)));assert.equal(f.env.rt.campaign.targets[0].done,50);
});
test('повторный свежий GET той же главы и уровня сохраняет ожидание, в том числе после reload',async()=>{
 const f=fixture();await f.read();const W=clone(f.env.rt.campCompletionWait);f.tick(30000);f.note();f.reload();assert.equal(f.Q.campOn(),false);assert.deepEqual(f.env.rt.campCompletionWait,W);
 for(let i=0;i<30;i++)await f.win();assert.equal(f.state.reads,1);
});
test('наблюдённый уровень36 немедленно освобождает ожидание; ближайшая победа снова разрешает сдачу',async()=>{
 const f=fixture();await f.read();f.setLevel(36);assert.equal(f.Q.campOn(),true);assert.equal(f.Q.campActive(),true);
 f.setComplete(true);await f.win();assert.equal(f.state.finishes,1);assert.equal(f.env.rt.dionCampaign.chapter,10);assert.equal(f.env.rt.campCompletionWait,null);
});
test('свежий серверный level36 освобождает ожидание до обновления DOM уровня',async()=>{
 const f=fixture();await f.read();f.note({level:36});assert.equal(f.Q.campOn(),true);assert.equal(f.Q.campCompletionWait(),null);
});
test('новое требование уровня той же главы отменяет прежнюю причину ожидания',async()=>{
 const f=fixture();await f.read();f.note({minLevel:35});assert.equal(f.Q.campCompletionWait(),null);assert.equal(f.Q.campOn(),true);
});
test('ожидание сдачи не возвращает готовой цели приоритет по старой звезде карты',async()=>{
 const f=fixture();await f.read();f.env.rt.questSeen={'leto lizardman soldier':f.now()};f.env.rt.questTargets=['Leto Lizardman Soldier'];
 assert.equal(f.Q.isQuestName('Leto Lizardman Soldier'),false);assert.equal(f.Q.isQuestName('Another Quest Mob',['Another Quest Mob']),true);
});
for(const change of ['chapter','character','class','slot','manual','url'])test('привязка ожидания освобождается после изменения: '+change,async()=>{
 const f=fixture();await f.read();
 if(change==='chapter')f.note({chapter:10});if(change==='character')f.env.rt.char='Other';if(change==='class')f.env.rt.classCur.prof='human_sorcerer';if(change==='slot')f.env.rt.classCur.slot=1;
 if(change==='manual')f.env.rt.manualKickAt++;if(change==='url')f.env.rt.campaignUrl='/starter-story-quest.html';
 assert.equal(f.Q.campCompletionWait(),null);assert.equal(f.Q.campOn(),true);
});
test('отключение кампании снимает ожидание; одноразовая ручная проверка остаётся чтением',async()=>{
 const f=fixture();await f.read();f.env.cfg.campaign=false;f.env.cfg.campAuto=false;f.env.rt.campOnce=true;f.env.rt.campaignDue=true;
 assert.equal(f.Q.campCompletionWait(),null);assert.equal(f.Q.campOn(),true);await f.read();assert.equal(f.env.rt.campOnce,false);assert.equal(f.state.teleports,0);assert.equal(f.state.finishes,0);assert.equal(f.Q.campOn(),false);
});
test('ручная разовая проверка действующей кампании разрешена во время ожидания',async()=>{
 const f=fixture();await f.read();f.env.rt.campOnce=true;f.env.rt.campaignDue=true;assert.equal(f.Q.campOn(),true);await f.read();assert.equal(f.env.rt.campOnce,false);assert.equal(f.Q.campOn(),false);assert.equal(f.state.outs,2);
});
test('показанная рабочая кнопка сдачи важнее старого ожидания и данных minLevel',async()=>{
 const f=fixture();await f.read();f.setComplete(true);f.page.pathname='/dion-campaign.html';assert.equal(f.Q.campOn(),true);await f.read();assert.equal(f.state.finishes,1);assert.equal(f.state.teleports,0);
});
test('недоступная кнопка не отменяет ранее подтверждённое ожидание',async()=>{
 const f=fixture();await f.read();f.setComplete(true);const lookup=f.env.$q;f.env.$q=s=>{const b=lookup(s);if(s==='[data-action="complete-chapter"]'&&b)b.disabled=true;return b};f.page.pathname='/dion-campaign.html';assert.equal(f.Q.campOn(),false);
});
test('без доказанного ограничения уровня: ожидание ограничено двумя минутами, а не каждой победой',async()=>{
 const f=fixture({minLevel:35});await f.read();assert.equal(f.env.rt.campCompletionWait.kind,'retry');assert.equal(f.Q.campOn(),false);
 for(let i=0;i<30;i++)await f.win();assert.equal(f.state.reads,1);f.tick(120001);assert.equal(f.Q.campOn(),true);await f.win();assert.equal(f.state.reads,2);
});
test('просроченный снимок ниже minLevel не создаёт бессрочное ожидание уровня',async()=>{
 const f=fixture();f.tick(60001);await f.read();assert.equal(f.env.rt.campCompletionWait.kind,'retry');
});
test('ответ другого класса не доказывает текущие atNpc и ограничение уровня',async()=>{
 const f=fixture();f.env.rt.classCur.prof='human_sorcerer';await f.read();assert.equal(f.env.rt.campCompletionWait.kind,'retry');
});
test('свежий atNpc без известного level не ведёт к NPC повторно',async()=>{
 const f=fixture({npc:true});f.note({level:undefined});await f.read();assert.equal(f.env.rt.campCompletionWait.kind,'retry');assert.equal(f.state.teleports,0);
});
test('не все цели выполнены: нужный уровень сам по себе не приостанавливает охоту',async()=>{
 const f=fixture({done:false});await f.read();assert.ok(!f.env.rt.campCompletionWait);assert.equal(f.Q.campOn(),true);assert.equal(f.Q.campOpen().length,1);
});
test('обычная готовая глава без ожидания по-прежнему сдаётся нативной кнопкой',async()=>{
 const f=fixture({complete:true});await f.read();assert.equal(f.state.finishes,1);assert.equal(f.env.rt.dionCampaign.chapter,10);assert.ok(!f.env.rt.campCompletionWait);
});
test('обычная сдача вдали от NPC сохраняет один подтверждённый нативный телепорт',async()=>{
 const f=fixture({level:36,minLevel:36,atNpc:false,npc:true});await f.read();assert.equal(f.state.teleports,1);assert.equal(f.env.rt.campaignTp,null);assert.equal(f.env.rt.campaignAnchor.npc,true);
 await f.read();assert.equal(f.state.teleports,1);assert.equal(f.env.rt.campCompletionWait.kind,'retry');
});
for(const when of ['before','read','save'])test('Stop '+when+' запрещает новый маршрут и нативные действия',async()=>{
 const f=fixture({npc:true});if(when==='before')f.env.on=false;if(when==='read')f.state.waitHook=()=>{f.env.on=false};if(when==='save')f.state.saveHook=p=>{if(p.campCompletionWait)f.env.on=false};
 await f.read();assert.equal(f.state.outs,0);assert.equal(f.state.teleports,0);assert.equal(f.state.finishes,0);
});
test('смена профессии во время снятия ожидания запрещает старую сдачу главы',async()=>{
 const f=fixture();await f.read();f.setComplete(true);const outs=f.state.outs;
 f.state.saveHook=p=>{if(p.campCompletionWait===null)f.env.rt.classCur.prof='human_sorcerer'};
 await f.read();assert.equal(f.state.finishes,0);assert.equal(f.state.teleports,0);assert.equal(f.state.outs,outs);assert.equal(f.env.rt.dionCampaign.chapter,9);
});
test('смена слота во время сохранения ожидания запрещает старый выход на карту',async()=>{
 const f=fixture();f.state.saveHook=p=>{if(p.campCompletionWait)f.env.rt.classCur.slot=1};
 await f.read();assert.equal(f.state.outs,0);assert.equal(f.state.finishes,0);assert.equal(f.state.teleports,0);assert.equal(f.Q.campCompletionWait(),null);
});
