'use strict';
const fs=require('fs'),vm=require('vm');
const path=require('node:path'),test=require('node:test'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
function fixture(opt={}) {
 let ticks=0; const logs=[],events=[],patches=[],ss=new Map();
 const hp={textContent:opt.hp||'0 / 1000'},title={textContent:`Safe Mob · ур. ${opt.level||74}`},atk={title:'Атака',getAttribute:()=>null};
 const env={
 cfg:{nAttack:'атака',potSlotAuto:false,zeroHpNudge:false,champHpMult:10,lvlAbove:5,lvlBelow:5,chain:true},
 rt:{lvl:75,kills:0,sinceDeep:0,adena:0,exp:0,sp:0,via:'chain'}, on:true,tabOwner:true,SLOT:'.slot', TAG:'test',
 $q:s=>({'#battle-mob-hp-val':hp,'#battle-mob-title':title,'#battle-victory-lootline':{textContent:''}}[s]||null),
 shown:el=>!!el,names:s=>String(s||'').toLowerCase().split('|').filter(Boolean),isEquip:()=>false,
 setStatus:()=>{},setRt:async p=>{patches.push(p);Object.assign(env.rt,p)},rec:(...x)=>logs.push(x.join(' | ')),
 waitFor:async fn=>fn(),waitX:async fn=>fn(),sleep:async()=>{},pause:async()=>{},serverDown:()=>false,
 panelInventory:()=>[],autoRoles:async()=>{},combatProfileKind:()=> 'fighter',hudForce:()=>null,trySnap:()=>{},
 potInventory:()=>{},isBoss:()=>!!opt.rb,campRbOpen:()=>[],epicOn:()=>false,huntOn:()=>false,heroLvl:()=>75,
 isQuestName:()=>!!opt.quest,isChamp:()=>false,logLines:()=>[],goalLines:()=>0,farmRules:()=>opt.resource?[{farm:true,name:'safe mob'}]:[],recipeRules:()=>opt.recipe?[{farm:true,name:'safe mob'}]:[],
 campActive:()=>false,campChampOpen:()=>false,extraKillsInLog:()=>{events.push('fight-entered');return []},totemSlots:()=>[],
 antibotState:()=>{ticks++;if(ticks>(opt.maxTicks||2))throw Error('bounded-loop');return false},meHp:()=>({cur:1000,max:1000,pct:100}),meMp:()=>({cur:1000,max:1000,pct:100}),
 sweepStep:async()=>{events.push('sweep')},trackEfficiency:async()=>{},trackLoot:async()=>{events.push('loot')},newLines:(a,b)=>b,
 trackQuest:async()=>false,nextFight:async()=>events.push('next'),toMap:async()=>events.push('map'),
 onDeath:async()=>events.push('death'),rbNote:async (id,p)=>events.push(['rbNote',id,p]),rbTimerKill:async()=>events.push('rbTimerKill'),fmtT:n=>n+'s',epicById:()=>null,
 };
 const location={pathname:'/battle.html',search:'?spawnId='+ (opt.rb?'l2dop_rb_test':'first-mob')};
 if(opt.rb)env.rt.target={rb:true,name:'Safe Mob'};
 const slots=[atk];
 const box={console:{log(){},info(){},warn(){}},URLSearchParams,Date,Math,setTimeout,location,sessionStorage:{getItem:k=>ss.get(k)||null,setItem:(k,v)=>ss.set(k,v)},document:{querySelectorAll:s=>s===env.SLOT?slots:[],querySelector:()=>null}};
 vm.createContext(box);vm.runInContext(fs.readFileSync(root+'/modules/combat.js','utf8'),box);
 return {env,events,logs,patches,hp,box,atk,slots,location,combat:box.L2V7Factories.combat(env)};
}

// 14.10, расширенный аудит: настоящий battle(), включая ожидание итога и обработку наград.
test('нулевое HP без подтверждения победы не даёт убийство, добычу и следующий бой',async()=>{
 const f=fixture();await f.combat.battle();assert.equal(f.env.rt.kills,0);assert.ok(!f.events.includes('loot'));assert.ok(!f.events.includes('next'));assert.ok(!f.env.rt.dps);
});
test('поражение, пришедшее при ожидании победы, идёт в onDeath без награды',async()=>{
 const f=fixture();let waits=0,dead=false;const q=f.env.$q;
 f.env.$q=s=>s==='#battle-defeat-root'?(dead?{}:null):q(s);
 f.env.waitFor=async fn=>{if(++waits>=2)dead=true;return fn()};await f.combat.battle();assert.ok(f.events.includes('death'));assert.equal(f.env.rt.kills,0);assert.ok(!f.events.includes('loot'));
});
test('запоздалая настоящая победа учитывается один раз после ожидания',async()=>{
 const f=fixture();let waits=0,won=false;const q=f.env.$q;
 f.env.$q=s=>s==='#battle-victory-inline'?(won?{}:null):q(s);
 f.env.waitFor=async fn=>{if(++waits>=2)won=true;return fn()};await f.combat.battle();assert.equal(f.env.rt.kills,1);assert.equal(f.events.filter(x=>x==='loot').length,1);assert.equal(f.events.filter(x=>x==='next').length,1);
});
test('потеря замка во время ожидания итога прекращает учёт и цепочку',async()=>{
 const f=fixture();let waits=0;f.env.waitFor=async fn=>{if(++waits>=2)f.env.tabOwner=false;return fn()};await f.combat.battle();assert.equal(f.env.rt.kills,0);assert.ok(!f.events.includes('loot'));assert.ok(!f.events.includes('next'));
});
async function beforeFight(opt,changes={}){const f=fixture({hp:'1000 / 1000',level:69,...opt});Object.assign(f.env.cfg,changes);f.env.extraKillsInLog=()=>{f.events.push('fight-entered');f.env.on=false;return []};await f.combat.battle();return f;}
// 15.10: по решению игрока слабый сосед не прерывает цепочку ради FA.
test('автоматическая цепочка добивает обычного моба ниже героя на6',async()=>{const f=await beforeFight();assert.ok(!f.events.includes('map'));assert.ok(f.events.includes('fight-entered'))});
test('граница героя−5 остаётся разрешена',async()=>{const f=await beforeFight({level:70});assert.ok(f.events.includes('fight-entered'))});
test('квест и источники ресурса/рецепта ниже−5 не теряют явную цель',async()=>{for(const kind of ['quest','resource','recipe']){const f=await beforeFight({[kind]:true});assert.ok(f.events.includes('fight-entered'),kind)}});
test('вручную выбранное подземелье сохраняет разрешённое собственное окно уровней',async()=>{const f=await beforeFight({}, {catMode:true,catDungeon:'witch'});assert.ok(f.events.includes('fight-entered'))});


// Сквозной стенд: реальные battle → trackLoot → nextFight; ответ игры меняет только DOM/снимок сети.
function flowFixture(role='fighter',opt={}) {
 const f=fixture({hp:'1000 / 1000',maxTicks:12}),{env,box,atk,slots,hp,events,combat}=f;
 let won=false,lines=[],pet={t:Date.now(),has:false},net={start:0,done:0,okN:0};
 const hunt={title:'Охотиться дальше'},blaze={title:'Blaze',getAttribute:()=>null},summon={title:'Summon Kai the Cat',getAttribute:()=>null},queen={title:'Summon Feline Queen',getAttribute:()=>null};
 if(role!=='fighter')slots.push(blaze);
 if(role==='pet')slots.push(queen,summon);
 Object.assign(env.cfg,{priority:'[все]',deepEvery:0,skillMpMin:35,mpPotAt:70,stopHp:25,hpPotAt:50,mageProbe:false,debuffAuto:false,petAuto:role==='pet',farmRes:'Coal',farmNeed:2});
 Object.assign(env.rt,{shopT:Date.now(),skills:{blaze:{damageN:3,dmg:1000}}});
 const q=env.$q;env.$q=s=>s==='#battle-victory-inline'?(won?{}:null):s==='#battle-victory-hunt'?(won?hunt:null):q(s);
 Object.assign(env,{
 isBattle:()=>true,combatProfileKind:()=>role==='fighter'?'fighter':'mage_summoner',
 slotKind:b=>b===atk?'атака':'скилл',slotAction:b=>b===atk?'attack':b===blaze?'l2_1230':b===summon?'l2_1225':'l2_1332',
 slotCd:()=>null,battleSpawn:()=> 'first-mob',memLeft:()=>0,skKey:b=>typeof b==='string'?b.toLowerCase():b.title.toLowerCase(),
 combatCooldown:{globalWait:()=>0,skillWait:()=>0,recentlyGlobalRejected:()=>false},
 expDmg:()=>1000,forceNow:()=>0,forceMax:()=>0,forceCosts:()=>[],longFightMp:()=>null,actCost:()=>0,turnSec:()=>1,
 ilOf:b=>b===blaze||b==='blaze'?{c:'Маг. атака',t:'MDAM',mp:20}:b===summon?{t:'SUMMON'}:b===queen?{target:'PET'}:null,
 keepShots:async()=>{},qty:()=>null,mpPotSlot:()=>null,hpPotPick:()=>null,cleanTitle:s=>String(s||''),skillMp:()=>20,
 buffAuditStep:async()=>{},spoilStep:async()=>false,toggleStep:async()=>false,buffList:()=>[],
 observeSlot:async()=>{},actNet:()=>net,petState:()=>pet,uiTimer:()=>NaN,SK_NET:{},
 logLines:()=>lines.slice(),newLines:(a,b)=>b.slice(a.length),rnd:a=>a,
 tvtSoon:()=>false,autonomyMode:()=> 'farm',townBuffStart:async()=>false,shopNeedByPanel:()=>'',shopPlan:()=>[],
 campOn:()=>false,campEnabled:()=>false,campMobOpen:()=>[],farmStep:async()=>false,recipeStep:async()=>false,
 searchActive:()=>false,mapDue:()=>false,rbDue:()=>false,victory:combat.victory,mobHp:combat.mobHp,
 itemsDb:async()=>{},LOOT_RE:/^(.+?)\s*×\s*(\d+)$/,SPECIAL_RE:/^особое (.+?) ×(\d+)$/,itemOf:()=>null,recipeKey:s=>s.toLowerCase(),
 fire:b=>{
  events.push(b===hunt?'hunt':b.title);
  if(b===hunt){if(opt.huntFail)return true;won=false;hp.textContent='1000 / 1000';return true;}
  net={start:Date.now()+10,done:Date.now()+20,okN:net.okN+1,action:env.slotAction(b),ok:true};
  if(b===summon){pet={t:Date.now()+1,has:true,key:'kai_the_cat',hp:1000,maxHp:1000};lines.push('Покликання Kai the Cat — слугу призвано');return true;}
  hp.textContent='0 / 1000';won=true;
  lines.push(b===atk?'Ты нанёс [Safe Mob] 1000 урона.':'Blaze: 1000 урону.','Coal ×2','Fast Aden ×1');
  if(pet.has)lines.push('Слуга [Kai the Cat] атакує [Safe Mob] 500 урону.');
  return true;
 }
 });
 for(const mod of ['loot','mobfarm'])vm.runInContext(fs.readFileSync(root+'/modules/'+mod+'.js','utf8'),box);
 const loot=box.L2V7Factories.loot(env),farm=box.L2V7Factories.mobfarm(env);
 Object.assign(env,{trackLoot:loot.trackLoot,resQuests:loot.resQuests,nextFight:farm.nextFight});
 return {...f,loot,farm,hunt,blaze,summon,setWon:x=>won=x,setNet:x=>net=x};
}
for(const role of ['fighter','mage','pet'])test(`сквозной ${role}: действие → победа → ресурс/FA → настоящий hunt-continue`,async()=>{
 const f=flowFixture(role);await f.combat.battle();
 assert.equal(f.env.rt.kills,1);assert.equal(f.env.rt.loot.Coal,2);assert.equal(f.env.rt.farmGot.coal,2);assert.equal(f.env.rt.faDrop.f.mob,1);
 assert.equal(f.events.filter(x=>x==='hunt').length,1);assert.equal(f.combat.mobHp().cur,1000);assert.ok(!f.events.includes('map'));
 const used=f.events.filter(x=>['Атака','Blaze','Summon Kai the Cat','Summon Feline Queen'].includes(x));
 assert.deepEqual(used,role==='fighter'?['Атака']:role==='mage'?['Blaze']:['Summon Kai the Cat','Blaze']);
 if(role==='pet'){assert.equal(f.env.rt.petStat.kai_the_cat.summons,1);assert.equal(f.env.rt.petStat.kai_the_cat.hits,1)}
});

test('три последовательных боя учитывают только свежую добычу и каждый начинают одним hunt',async()=>{
 const f=flowFixture('fighter');for(let i=0;i<3;i++)await f.combat.battle();
 assert.equal(f.env.rt.kills,3);assert.equal(f.env.rt.loot.Coal,6);assert.equal(f.env.rt.faDrop.k.mob,3);assert.equal(f.env.rt.faDrop.f.mob,3);
 assert.equal(f.events.filter(x=>x==='hunt').length,3);assert.equal(f.events.filter(x=>x==='Атака').length,3);
});
test('hunt-continue в полёте получает второе ожидание без повторного нажатия',async()=>{
 const f=flowFixture('mage',{huntFail:true}),waits=[];f.setNet({huntT:Date.now()+100,huntDoneT:0});
 f.env.waitFor=async(fn,ms)=>{waits.push(ms);if(ms===8000)return false;if(ms===7000){f.setWon(false);f.hp.textContent='1000 / 1000'}return fn()};
 f.setWon(true);f.hp.textContent='0 / 1000';await f.farm.nextFight({name:'Safe Mob',killed:[]});
 assert.ok(waits.includes(7000));assert.equal(f.events.filter(x=>x==='hunt').length,1);assert.ok(!f.events.includes('map'));
});
test('отказ hunt-continue возвращает на карту с одним нажатием',async()=>{
 const f=flowFixture('fighter',{huntFail:true});f.setWon(true);f.hp.textContent='0 / 1000';await f.farm.nextFight({name:'Safe Mob',killed:[]});
 assert.equal(f.events.filter(x=>x==='hunt').length,1);assert.equal(f.events.filter(x=>x==='map').length,1);
});
test('остановка во время продолжения не запускает recovery и второй бой',async()=>{
 const f=flowFixture('fighter',{huntFail:true});f.setWon(true);f.hp.textContent='0 / 1000';
 f.env.waitFor=async(fn,ms)=>{if(ms===8000){f.env.on=false;return false}return fn()};await f.farm.nextFight({name:'Safe Mob',killed:[]});
 assert.equal(f.events.filter(x=>x==='hunt').length,1);assert.ok(!f.events.includes('map'));
});
test('успешная цепочка подземелья сохраняет место и не вызывает платный вход',async()=>{
 const f=flowFixture('mage');Object.assign(f.env.cfg,{catMode:true,catDungeon:'witch'});f.env.rt.catIn='witch';await f.combat.battle();
 assert.equal(f.env.rt.kills,1);assert.equal(f.env.rt.catIn,'witch');assert.ok(f.env.rt.catInT);assert.equal(f.events.filter(x=>x==='hunt').length,1);assert.equal(f.location.href,undefined);
});
test('отказ цепочки подземелья → настоящий catGo → список текущего подземелья без телепорта',async()=>{
 const f=flowFixture('mage',{huntFail:true});Object.assign(f.env.cfg,{catMode:true,catDungeon:'witch'});f.env.rt.catIn='witch';
 Object.assign(f.env,{CAT_LIST:{witch:['Catacomb of the Witch',60,72]},heroAt:()=>({t:Date.now(),dung:'witch'}),isMap:()=>false});
 vm.runInContext(fs.readFileSync(root+'/modules/dungeons.js','utf8'),f.box);f.env.catGo=f.box.L2V7Factories.dungeons(f.env).catGo;
 await f.combat.battle();assert.equal(f.env.rt.kills,1);assert.equal(f.events.filter(x=>x==='hunt').length,1);
 assert.equal(f.location.href,'/dungeon.html?dungeonId=witch');assert.ok(f.logs.some(x=>x.includes('следующий моб беру из списка')));
});
test('при настройках по умолчанию 0 HP ждёт итог без дополнительных ударов',async()=>{
 const f=flowFixture('fighter');delete f.env.cfg.zeroHpNudge;f.hp.textContent='0 / 1000';
 f.env.fire=b=>{f.events.push('unexpected-attack');return true};await f.combat.battle();
 assert.ok(!f.events.includes('unexpected-attack'));assert.equal(f.env.rt.kills,0);assert.ok(!f.events.includes('hunt'));
});

test('0 HP → живая следующая цель того же боя → один удар и подтверждённая победа',async()=>{
 const f=flowFixture('fighter');delete f.env.cfg.zeroHpNudge;f.hp.textContent='0 / 1000';let resumed=false;
 f.env.waitFor=async(fn,ms)=>{if(ms===3000&&!resumed){resumed=true;f.hp.textContent='1000 / 1000'}return fn()};
 await f.combat.battle();assert.equal(f.events.filter(x=>x==='Атака').length,1);assert.equal(f.env.rt.kills,1);assert.equal(f.events.filter(x=>x==='hunt').length,1);
});
function championFixture(tier){
 const f=flowFixture('mage');Object.assign(f.env.cfg,{champBlue:true,champOrange:false,champRed:false,champMinLvl:20,champCancel:'always'});
 f.env.isChamp=()=>true;f.env.battleInfo=()=>({t:Date.now(),name:'Safe Mob',kind:'champion',tier,lvl:74,max:1000,spawn:'champ_'+tier+'_test'});
 vm.runInContext(fs.readFileSync(root+'/modules/champs.js','utf8'),f.box);f.env.champs=f.box.L2V7Factories.champs(f.env);return f;
}
test('разрешённый синий чемпион: настоящий battle → learn(win) → FA blue → цепочка',async()=>{
 const f=championFixture('blue');await f.combat.battle();assert.equal(f.env.rt.kills,1);assert.equal(f.env.rt.champLearn.st.blue.win,1);assert.equal(f.env.rt.faDrop.f.blue,1);assert.equal(f.events.filter(x=>x==='Blaze').length,1);assert.equal(f.events.filter(x=>x==='hunt').length,1);
});
test('запрещённый цвет квестового чемпиона не получает ни одного удара',async()=>{
 const f=championFixture('red');f.env.isQuestName=()=>true;await f.combat.battle();assert.equal(f.env.rt.kills,0);assert.ok(f.events.includes('map'));assert.ok(!f.events.includes('Blaze'));
});
test('память слабого боя чемпиона блокирует повтор до роста силы',async()=>{
 const f=championFixture('blue');await f.env.champs.learn({champ:true,tier:'blue',lvl:74,heroLvl0:75},'weak',5,10);
 await f.combat.battle();assert.equal(f.env.rt.kills,0);assert.ok(f.events.includes('map'));assert.ok(!f.events.includes('Blaze'));assert.equal(f.env.rt.champLearn.st.blue.weak,1);
});
test('чемпион главы ниже −5 сохраняет явную цель',async()=>{
 const f=fixture({hp:'1000 / 1000',level:69});f.env.isChamp=()=>true;f.env.campActive=()=>true;f.env.campChampOpen=()=>true;
 f.env.extraKillsInLog=()=>{f.events.push('fight-entered');f.env.on=false;return []};await f.combat.battle();assert.ok(f.events.includes('fight-entered'));assert.ok(!f.events.includes('map'));
});
for(const manual of [false,true])test(`цель ниже −5 доводится: ${manual?'ручной бой':'уже повреждённый моб цепочки'}`,async()=>{
 const f=fixture({hp:manual?'1000 / 1000':'900 / 1000',level:69});if(manual)f.env.rt.via='manual';
 f.env.extraKillsInLog=()=>{f.events.push('fight-entered');f.env.on=false;return []};await f.combat.battle();assert.ok(f.events.includes('fight-entered'));assert.ok(!f.events.includes('map'));
});
test('цель второй страницы → настоящий gotoPage/attackSpawn → battle → loot → следующая охота',async()=>{
 const f=flowFixture('mage'),{env}=f;let cur=1;
 const link=id=>({textContent:'Safe Mob · ур. 74',className:'',classList:{contains:()=>false},getAttribute:k=>k==='href'?'/battle.html?spawnId='+id:null});
 const first=link('first-mob'),second=link('second-mob'),next={title:'Следующая страница'},ind={get textContent(){return `${cur} / 2 (16)`}},list={dataset:{l2AroundSig:'16|first-mob:0,second-mob:0|p0|lv75'}};
 const q=env.$q,fire=env.fire,all=f.box.document.querySelectorAll;f.box.CSS={escape:s=>s};f.location.pathname='/map.html';
 Object.assign(env,{PAGE_SIZE:15,LV_RE:/^(★\s*)?(.+?)\s*·\s*ур\.?\s*(\d+)/iu,QUEST:/★/,isRaidId:()=>false,gotoPage:f.farm.gotoPage,isBattle:()=>f.location.pathname==='/battle.html'});
 env.$q=s=>s==='#map-mob-page-ind'?ind:s==='#map-mob-list'?list:s==='#map-mob-page-next'?next:s.includes('#map-mob-list a[href*=')?(cur===2?second:null):q(s);
 f.box.document.querySelectorAll=s=>s==='#map-mob-list a.l2-map-mob-link'?[cur===1?first:second]:all(s);
 env.fire=b=>{if(b===next){cur=2;f.events.push('page-2');return true}if(b===second){f.location.pathname='/battle.html';f.events.push('target-second');return true}return fire(b)};
 assert.equal(await f.farm.attackSpawn({id:'second-mob',name:'Safe Mob',lvl:74,idx:15,champ:false,quest:false},x=>x.name),true);
 await f.combat.battle();assert.ok(f.events.indexOf('page-2')<f.events.indexOf('target-second'));assert.ok(f.events.indexOf('target-second')<f.events.indexOf('Blaze'));
 assert.equal(env.rt.kills,1);assert.equal(env.rt.loot.Coal,2);assert.equal(f.events.filter(x=>x==='hunt').length,1);
});
