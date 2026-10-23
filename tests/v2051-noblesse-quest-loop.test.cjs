'use strict';
// 23.10.2026, Noblesse 1/4: специализированный квест не должен ходить по кругу через «Мои квесты».
// Страницы, часы и ответы локальные. Авторизация и живая игра не используются.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../modules/quests.js'),'utf8');
const coreSource=fs.readFileSync(path.join(__dirname,'../engine-core.js'),'utf8');
const copy=x=>JSON.parse(JSON.stringify(x));
const engineBox={console,Date};vm.runInNewContext(coreSource,engineBox);
const engine=engineBox.L2EngineCore;
const noblesse=()=>({href:'/noblesse-quest.html',title:'Possessor of a Precious Soul · 1/4',lines:['★ Vanor Silenos Chieftain — 0/100','✓ Varnish — 100/100']});
const subclass=()=>({href:'/subclass-quest.html',title:"Fate’s Whisper",lines:['★ Cabriol — 0/1']});

function setup(o={}) {
 let now=1792723678000,current=new URL(o.page||'/character-quests.html','https://l2wap.com');
 let beforeWait=null,afterWrite=null;
 const nav=[],fired=[],writes=[],logs=[],entries=[];
 const location={origin:'https://l2wap.com',get pathname(){return current.pathname},get search(){return current.search},
  get href(){return current.href},set href(value){nav.push(String(value));current=new URL(value,current)}};
 const makeEntry=data=>{
  const row={data,querySelector:s=>s.includes('__title')?row.link:null,
   querySelectorAll:s=>s.includes('__line')?(data.lines||[]).map(textContent=>({textContent})):[]};
  row.link={textContent:data.title,getAttribute:k=>k==='href'?data.href:null,
   closest:s=>s.includes('entry--ready')?(data.ready?row:null):row};
  return row;
 };
 for(const item of o.entries||[noblesse()])entries.push(makeEntry(item));
 const empty={textContent:'Нет активных квестов'};
 const document={querySelectorAll:s=>s==='a.l2-character-quests-entry__title'?entries.map(e=>e.link):s==='.l2-character-quests-entry'?entries:[],
  querySelector:s=>s.includes('l2-character-quests-empty')&&entries.length===0?empty:null};
 const Clock=class extends Date{static now(){return now}};
 const box={console,Date:Clock,URL,location,document};box.globalThis=box;
 vm.runInNewContext(source,box);
 const rt={char:'QuestHero',lvl:68,manualKickAt:0,campaign:null,campaignUrl:'',campaignDue:true,sinceCamp:25,
  storySaga:{completed:true,stage:'completed'},dionCampaign:{completed:true,stage:'completed'},
  story:{noblesse:{active:true,completed:false,part:1,ready:false,targets:[{name:'Vanor Silenos Chieftain',have:0,need:100}]}},...copy(o.rt||{})};
 const raw={autoTasks:['quests'],campaign:true,campAuto:false,searchQuest:true,priority:'[квест]\n[все]',lvlBelow:5,lvlAbove:5,campaignEvery:25,...o.cfg};
 const env={on:true,tabOwner:true,cfg:engine.taskConfig(raw,()=>rt),rt,canAct:()=>true,heroLvl:()=>68,
  shown:e=>!!e,$q:s=>document.querySelector(s),isCampaign:()=>false,isMail:()=>location.pathname==='/mail.html',isMap:()=>location.pathname==='/map.html',
  isBattle:()=>false,rec:(...args)=>logs.push(args.join(' ')),setStatus:message=>logs.push(message),pause:async()=>{},sleep:async()=>{},
  waitFor:async fn=>{await Promise.resolve();const hook=beforeWait;beforeWait=null;hook?.();return fn()},
  setRt:async patch=>{Object.assign(rt,patch);writes.push(copy(patch));await Promise.resolve();const hook=afterWrite;afterWrite=null;hook?.();return {ok:true}},
  goOutskirts:async()=>{env.outs++;if(location.pathname!=='/map.html')location.href='/map.html'},outs:0,
  fire:link=>{fired.push(link.getAttribute('href'));location.href=link.getAttribute('href');return true},noticeText:()=>'',rnd:()=>0};
 let q=box.L2V7Factories.quests(env);
 return {env,rt,raw,location,nav,fired,writes,logs,entries,box,q:()=>q,now:()=>now,tick:n=>now+=n,
  waitHook:fn=>{beforeWait=fn},writeHook:fn=>{afterWrite=fn},reload:()=>{q=box.L2V7Factories.quests(env)},
  savedList:()=>entries.map(e=>({title:e.data.title,href:e.data.href,lines:e.data.lines||[]}))};
}

for(const list of [[noblesse()],[subclass()],[noblesse(),subclass()]])test('список specialized: '+list.map(q=>q.href).join(', '),async()=>{
 const f=setup({entries:list});
 await f.q().questsStep();
 assert.deepEqual(f.fired,[],'специализированные ссылки не нажимаются общей кампанией');
 assert.equal(f.nav.includes('/mail.html'),false);
 assert.deepEqual(copy(f.rt.questList),f.savedList(),'полный список сохраняется');
 assert.ok(f.rt.campaign,'пустая общая кампания должна быть подтверждена');
 assert.deepEqual(copy(f.rt.campaign.targets),[]);
 assert.equal(f.rt.campaignDue,false);assert.equal(f.rt.sinceCamp,0);
 assert.equal(engine.selectedTask(f.env.cfg,f.rt),'quests');
 assert.equal(f.q().campOn(),true,'quests-only должен продолжить ★ охоту');
 assert.equal(f.env.outs,1);assert.equal(f.location.pathname,'/map.html');
});

for(const supported of [
 {href:'/starter-story-quest.html',title:'Путь новичка'},
 {href:'/dion-campaign.html',title:'Тень над Дионом'},
 {href:'/giran-campaign.html',title:'Клятва Гирана'}
])test('mixed список сохраняет выбор обычной главы '+supported.href,async()=>{
 const f=setup({entries:[noblesse(),supported,subclass()]});
 await f.q().questsStep();
 assert.deepEqual(f.fired,[supported.href]);
 assert.deepEqual(copy(f.rt.questList),f.savedList());
 assert.equal(f.env.outs,0);
});

test('mixed список сохраняет прежний приоритет готовой campaign-главы',async()=>{
 const f=setup({entries:[noblesse(),{href:'/dion-campaign.html',title:'Дион'},
  {href:'/giran-campaign.html',title:'Гиран',ready:true},subclass()]});
 await f.q().questsStep();assert.deepEqual(f.fired,['/giran-campaign.html']);
});

for(const page of ['/noblesse-quest.html','/subclass-quest.html'])test('goCampaign на '+page+' возвращает карту без списка',async()=>{
 const f=setup({page});await f.q().goCampaign();
 assert.equal(f.location.pathname,'/map.html');assert.equal(f.env.outs,1);
 assert.equal(f.nav.some(x=>/character-quests|mail\.html/.test(x)),false);
 assert.deepEqual(f.fired,[]);assert.equal(f.rt.campaignDue,false);assert.ok(f.rt.campaign);
 assert.deepEqual(copy(f.rt.campaign.targets),[]);assert.equal(f.q().campOn(),true);
});

for(const oldUrl of ['/noblesse-quest.html','/subclass-quest.html?from=old'])test('старый campaignUrl '+oldUrl+' не открывается снова',async()=>{
 const f=setup({page:'/map.html',rt:{campaignUrl:oldUrl,campaign:{title:'Старая общая цель',targets:[{name:'Leto Lizardman',ok:false}]},campaignDue:true}});
 await f.q().goCampaign();
 assert.equal(f.location.pathname,'/map.html');
 assert.equal(f.nav.some(x=>/noblesse|subclass|character-quests|mail\.html/.test(x)),false);
 assert.equal(f.rt.campaignUrl||'','');assert.deepEqual(copy(f.rt.campaign.targets),[]);
 assert.equal(f.rt.campaignDue,false);assert.equal(f.q().campOn(),true);
});

test('свежий specialized-only кеш не открывает список снова при campaignDue',async()=>{
 const f=setup({entries:[noblesse(),subclass()]});await f.q().questsStep();
 f.nav.length=0;f.env.outs=0;f.rt.campaignDue=true;f.tick(599999);
 await f.q().goCampaign();
 assert.equal(f.nav.some(x=>/character-quests|noblesse|subclass|mail\.html/.test(x)),false);
 assert.equal(f.rt.campaignDue,false);assert.equal(f.q().campOn(),true);
 assert.equal(engine.selectedTask(f.env.cfg,f.rt),'quests');
});

test('через 10 минут список обновляется вместо вечного запрета generic кампаний',async()=>{
 const f=setup();await f.q().questsStep();f.nav.length=0;f.rt.campaignDue=true;f.tick(600001);
 await f.q().goCampaign();assert.equal(f.location.pathname,'/character-quests.html');
 assert.equal(f.nav.length,1);
});

test('reload сохраняет паузу generic-поиска и не отключает ★ охоту',async()=>{
 const f=setup();await f.q().questsStep();f.reload();f.nav.length=0;f.rt.campaignDue=true;
 await f.q().goCampaign();
 assert.equal(f.location.pathname,'/map.html');assert.equal(f.nav.includes('/character-quests.html'),false);
 assert.equal(f.q().campOn(),true);assert.equal(f.rt.campaignDue,false);
});

test('активная starter-глава важнее старого специализированного campaignUrl',async()=>{
 const f=setup({page:'/map.html',rt:{campaignUrl:'/noblesse-quest.html',
  storySaga:{title:'Путь новичка',completed:false,stage:'hunt_1',minLevel:10,lvl:68}}});
 await f.q().goCampaign();
 assert.equal(f.location.pathname,'/starter-story-quest.html');
 assert.deepEqual(f.nav,['/starter-story-quest.html']);
 assert.equal(f.env.outs,0);assert.deepEqual(f.fired,[]);
});

test('спецстраница со смешанным кешем возвращается к выбору настоящей campaign-главы',async()=>{
 const f=setup({page:'/noblesse-quest.html',entries:[noblesse(),{href:'/giran-campaign.html',title:'Клятва Гирана',ready:true}]});
 f.rt.questList=f.savedList();f.rt.questListT=f.now();f.rt.campaignUrl='/noblesse-quest.html';
 await f.q().goCampaign();
 assert.equal(f.location.pathname,'/character-quests.html');
 assert.deepEqual(f.nav,['/character-quests.html']);assert.equal(f.env.outs,0);
 await f.q().questsStep();
 assert.deepEqual(f.fired,['/giran-campaign.html']);
 assert.equal(f.location.pathname,'/giran-campaign.html');
});

test('повторные campaignDue и reload не продлевают срок специального списка',async()=>{
 const f=setup();await f.q().questsStep();const readAt=f.rt.questListT;
 f.nav.length=0;
 for(let n=0;n<3;n++){
  f.tick(199999);f.rt.campaignDue=true;f.reload();await f.q().goCampaign();
  assert.equal(f.rt.questListT,readAt,'TTL отсчитывается от настоящего чтения списка');
  assert.equal(f.rt.campaignDue,false);assert.equal(f.location.pathname,'/map.html');
 }
 assert.deepEqual(f.nav,[]);
 f.tick(5);f.rt.campaignDue=true;await f.q().goCampaign();
 assert.equal(f.location.pathname,'/character-quests.html');
 assert.equal(f.rt.questListT,readAt,'само открытие списка ещё не подтверждает чтение');
});

for(const action of ['questsStep','goCampaign'])test(action+': отказ записи отдельного helper запрещает навигацию',async()=>{
 const f=setup({page:action==='goCampaign'?'/noblesse-quest.html':'/character-quests.html'});
 f.env.setRt=async()=>({ok:false,reason:'write_rejected'});
 await f.q()[action]();
 assert.deepEqual(f.nav,[]);assert.deepEqual(f.fired,[]);assert.equal(f.env.outs,0);
});

for(const phase of ['wait','write'])for(const gate of ['Stop','owner','manual','hero'])test(phase+': '+gate+' во время await запрещает навигацию',async()=>{
 const f=setup();const change=()=>{if(gate==='Stop')f.env.on=false;if(gate==='owner')f.env.tabOwner=false;
  if(gate==='manual')f.rt.manualKickAt++;if(gate==='hero')f.rt.char='AnotherHero'};
 if(phase==='wait')f.waitHook(change);else f.writeHook(change);
 await f.q().questsStep();
 assert.deepEqual(f.nav,[]);assert.deepEqual(f.fired,[]);assert.equal(f.env.outs,0);
});

test('отказ записи при восстановлении смешанного списка запрещает переход',async()=>{
 const f=setup({page:'/noblesse-quest.html',rt:{questList:[noblesse(),{href:'/giran-campaign.html',title:'Гиран'}]}});
 f.env.setRt=async()=>({ok:false});await f.q().goCampaign();
 assert.deepEqual(f.nav,[]);assert.deepEqual(f.fired,[]);assert.equal(f.env.outs,0);
});

test('Noblesse ready, storyJob и неизвестная оплата остаются у специализированной службы',async()=>{
 const financial={pending:{id:'story-unknown',kind:'story-teleport',quote:{amount:100000,currency:'Adena'}}};
 const story={noblesse:{active:true,completed:false,part:1,ready:true,targets:[{name:'Vanor Silenos Chieftain',have:100,need:100}]}};
 const job={kind:'noblesse',key:'noblesse:1',t:1792723600000,char:'QuestHero'};
 const f=setup({rt:{story,storyJob:job,actionPayments:financial,storyTpReceipt:{id:'story-unknown',outcome:'unknown'},petFull:{spent:10000000,unknownReserved:10000000},questSeen:{'vanor silenos chieftain':1792723677000}}});
 const before=copy({story:f.rt.story,storyJob:f.rt.storyJob,actionPayments:f.rt.actionPayments,storyTpReceipt:f.rt.storyTpReceipt,petFull:f.rt.petFull,questSeen:f.rt.questSeen});
 await f.q().questsStep();
 const after=copy({story:f.rt.story,storyJob:f.rt.storyJob,actionPayments:f.rt.actionPayments,storyTpReceipt:f.rt.storyTpReceipt,petFull:f.rt.petFull,questSeen:f.rt.questSeen});
 assert.deepEqual(after,before);assert.deepEqual(f.fired,[]);
});

test('настоящий map gate и mobfarm сохраняют ★ Vanor ур50 для quests-only героя68',async()=>{
 const f=setup();await f.q().questsStep();
 const mapSource=fs.readFileSync(path.join(__dirname,'../content.js'),'utf8');
 const start=mapSource.indexOf('async function map(...args) {'),end=mapSource.indexOf('\n}',start)+2;
 let hunted=0,idled=0;
 const mapBox={cfg:f.env.cfg,rt:f.rt,L2EngineCore:engine,campOn:()=>f.q().campOn(),raidIdleFarm:()=>false,
  lootGoal:()=>null,tasksIdle:async()=>{idled++},dailyWorkReady:async()=>true,
  L2V7Modules:{mobfarm:{map:async()=>{hunted++}}}};
 vm.runInNewContext(mapSource.slice(start,end)+'\nglobalThis.runMap=map;',mapBox);
 await mapBox.runMap();assert.equal(hunted,1);assert.equal(idled,0);
 f.rt.questTargets=['Vanor Silenos Chieftain'];f.rt.questSeen={'vanor silenos chieftain':f.now()};
 const row={textContent:'★ Vanor Silenos Chieftain · ур. 50 HP 2 580 · EXP 3 637',className:''};
 const link={textContent:row.textContent,className:'l2-map-mob-link--quest-target',
  classList:{contains:name=>name==='l2-map-mob-link--quest-target'},closest:()=>row,getAttribute:()=>'/battle.html?spawnId=dense_9584'};
 const mobBox={console,Date,document:{querySelectorAll:()=>[link]}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../modules/mobfarm.js'),'utf8'),mobBox);
 const env={...f.env,NET_SPAWNS:null,PAGE_SIZE:15,LV_RE:/^(★\s*)?(.+?)\s*·\s*ур\.?\s*(\d+)/i,QUEST:/★/,
  campActive:()=>f.q().campActive(),campChampOpen:()=>false,campChampMin:()=>0,campMobOpen:()=>f.q().campMobOpen(),
  farmRules:()=>[],recipeRules:()=>[],isRaidId:()=>false,isBoss:()=>false,isChamp:()=>false,
  isQuestName:(...args)=>f.q().isQuestName(...args),$q:()=>null};
 const m=mobBox.L2V7Factories.mobfarm(env);
 const picks=m.candidates(m.parseRules(),{ids:['dense_9584'],quest:['Vanor Silenos Chieftain']},m.markerTypes(),99);
 assert.equal(picks.length,1);assert.equal(picks[0].name,'Vanor Silenos Chieftain');assert.equal(picks[0].ql,true);
});
