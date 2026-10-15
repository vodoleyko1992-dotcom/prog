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

function timedFixture() {
 const f=flowFixture('fighter');let now=1000000;
 f.box.Date={now:()=>now};f.env.antibotState=()=>false;
 f.env.sleep=async ms=>{now+=ms};f.env.pause=async()=>{};
 f.box.sessionStorage.setItem('l2bot.mageReload',JSON.stringify([now,now,now]));
 f.env.srvHangMark=()=>{};
 f.clock={now:()=>now,advance:ms=>{now+=ms}};
 return f;
}
test('three minutes with no accepted attacks escapes without excluding the species',async()=>{
 const f=timedFixture();f.atk.disabled=true;
 await f.combat.battle();
 assert.ok(f.events.includes('map'));assert.ok(f.clock.now()>=1180000);
 assert.equal(f.env.rt.hardMobs?.['safe mob'],undefined);
 assert.ok(f.logs.some(x=>x.includes('силу моба не оцениваю')));
});
test('one pet hit after 167 seconds wins without a false slow-species verdict',async()=>{
 const f=timedFixture();f.atk.disabled=true;
 f.env.sleep=async ms=>{f.clock.advance(ms);if(f.clock.now()>=1167000){f.setNet({start:1,done:2,okN:1});f.hp.textContent='0 / 1000';f.setWon(true)}};
 await f.combat.battle();
 assert.equal(f.env.rt.kills,1);assert.equal(f.env.rt.hardMobs?.['safe mob'],undefined);
});
test('continuous accepted attacks retain the slow-species verdict',async()=>{
 const f=timedFixture();let n=0;
 f.env.fire=()=>{n++;f.clock.advance(12000);f.setNet({start:1,done:2,okN:n,ok:true,action:'attack'});
 f.hp.textContent=`${Math.max(0,1000-n*150)} / 1000`;if(n===7)f.setWon(true);return true};
 await f.combat.battle();
 assert.equal(f.env.rt.kills,1);assert.ok(f.env.rt.hardMobs?.['safe mob']);
});
test('accepted turns interrupted by a long idle gap cannot certify strength',()=>{
 const f=timedFixture(),c=f.combat,s=c.strengthSample(1000,{okN:20});
 for(let n=1;n<=6;n++)c.strengthReliable(s,1000+n*1000,{okN:20+n});
 assert.equal(c.strengthReliable(s,8000,{okN:26}),true);
 assert.equal(c.strengthReliable(s,50000,{okN:27}),false);
 assert.equal(c.strengthReliable(s,51000,{okN:28}),false);
});
test('server lag and counter reset invalidate a strength verdict',()=>{
 for(const net of [{okN:26,slowT:2000},{okN:2}]){
 const c=timedFixture().combat,s=c.strengthSample(1000,{okN:20});
 assert.equal(c.strengthReliable(s,7000,net),false);
 }
});
test('a genuinely active fight longer than three minutes still excludes the species',async()=>{
 const f=timedFixture();let n=0;f.env.isQuestName=()=>true;
 f.env.fire=()=>{n++;f.clock.advance(12000);f.setNet({start:1,done:2,okN:n,ok:true,action:'attack'});
 f.hp.textContent=`${1000-n*10} / 1000`;return true};
 await f.combat.battle();
 assert.ok(f.clock.now()>1180000);assert.ok(f.events.includes('map'));
 assert.equal(f.env.rt.hardMobs?.['safe mob']?.why,'бой дольше 3 мин');
});
