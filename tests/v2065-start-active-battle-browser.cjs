'use strict';
// 20.65 (лог 26.10: Старт из почты, сервер уже ведёт бой Ashen192): настоящий MV3/main/hook.
// Все HTTPS-ответы локальные. Возврат и чтение существующего боя проверяются отдельно от обычных ударов.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const ACTIVE='ashen_bastion_mob_192',OLD='ashen_bastion_mob_001',HERO='start-active-hero',proof=[];

async function scenario(stop){
 const h=await harness(),calls=[],paths=[],routeErrors=[];
 const S={phase:'setup',revision:100,actions:0,held:false,characterReads:0,battleReads:0};
 let release;const gate=new Promise(resolve=>release=resolve);
 const pet=()=>({kind:'servitor',key:'feline_king',summonSkillId:1406,summonSkillLevel:11,hp:22000,maxHp:22000,activeBuffs:[]});
 const character=()=>({id:HERO,name:'AuditHero',revision:S.revision,level:79,l2Profession:'human_arcana_lord',classBranch:'mystic',
  classSlots:{activeSlot:0,slots:[{slot:0,profession:'human_arcana_lord',owned:true,active:true,level:79}]},
  adena:30000000,mobsKilled:100,hp:12000,maxHp:12000,mp:7000,maxMp:7000,inBattle:true,battleSpawnId:ACTIVE,
  locationType:'zone',currentZoneId:'ashen_bastion',currentZoneNameUk:'Ashen Bastion',inventory:{eq:{},stacks:[]},activeBuffs:[],activeSummon:pet()});
 const battle=()=>({spawnId:ACTIVE,mobName:'Active Ashen target',mobLevel:79,mobHp:Math.max(1000,5000-S.actions*100),mobMaxHp:5000,
  kind:'passive',battleMode:'pve',ended:false,log:['Бій розпочато: [Active Ashen target] (ур.79).'],logSeq:1});
 const response=()=>({ok:true,kind:'full',revision:S.revision,character:character(),battle:battle(),serverNowMs:Date.now(),globalCooldownUntilMs:Date.now()+200});
 const base='<div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">79</div><div id="character-profession">Human Arcana Lord</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">12000</span><span id="l2-hud-hp-max">12000</span><span id="l2-hud-mp-cur">7000</span><span id="l2-hud-mp-max">7000</span>';
 const html=inBattle=>'<!doctype html><meta charset="utf-8"><title>Старт в существующем бою</title>'+base+(inBattle
  ? '<div id="battle-mob-title">Active Ashen target · ур.79</div><div id="battle-mob-hp-val">5000 / 5000</div><div id="battle-log"></div><div id="battle-victory-inline" hidden>Победа!</div><button class="l2-battle-hotbar-slot" title="Атака" id="attack"><span data-slot-cd="attack" hidden></span></button>'
  : '<div id="mail-tabs"></div><div id="mail-tab-inbox">Почта</div>')+`<script>
   localStorage.setItem('token','local-start-active-fixture');
   (async()=>{while(!window.__l2botHook)await new Promise(r=>setTimeout(r,10));await fetch('/character');
    ${inBattle?`const current=await(await fetch('/game/battle?characterId=${HERO}&spawnId=${ACTIVE}')).json();window.startActiveBattle=current;
    document.getElementById('battle-mob-title').textContent=current.battle.mobName+' · ур.'+current.battle.mobLevel;
    document.getElementById('battle-mob-hp-val').textContent=current.battle.mobHp+' / '+current.battle.mobMaxHp;
    document.getElementById('attack').onclick=async()=>{const r=await fetch('/game/battle/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'attack',battleSpawnId:'${ACTIVE}',expectedRevision:100})});
     const d=await r.json();document.getElementById('battle-mob-hp-val').textContent=d.battle.mobHp+' / '+d.battle.mobMaxHp;};`:''}
   })();</script>`;
 try{
  await h.ctx.route('https://l2wap.com/**',async route=>{try{
   const req=route.request(),u=new URL(req.url()),p=u.pathname;let body=null;try{body=req.postDataJSON()}catch(_){}
   const call={path:p,query:u.search,method:req.method(),phase:S.phase,body};calls.push(call);
   const json=data=>route.fulfill({json:data}).catch(()=>{});
   if(p.endsWith('.html')){
    paths.push({path:p,query:u.search,phase:S.phase});
    if(S.phase!=='setup')assert.equal(p+u.search,'/battle.html?spawnId='+ACTIVE,'Старт возвращает только к подтверждённому192, без нового выбора');
    if(p==='/battle.html')S.phase='battle';
    return route.fulfill({contentType:'text/html; charset=utf-8',body:html(p==='/battle.html')}).catch(()=>{});
   }
   if(p==='/character'){S.characterReads++;return json({character:character()});}
   if(p==='/game/battle'){
    assert.equal(req.method(),'GET');S.battleReads++;
    assert.equal(u.searchParams.get('characterId'),HERO,'сверка принадлежит текущему герою');
    assert.equal(u.searchParams.get('spawnId'),ACTIVE,'читается серверный192, а не сохранённый001');
    if(stop&&S.phase==='resume'){S.held=true;await gate;}
    return json(response());
   }
   if(p==='/game/battle/action'){
    assert.equal(S.phase,'battle','боевой POST разрешён только после возврата в документ существующего боя');
    assert.equal(req.method(),'POST');assert.equal(body.battleSpawnId,ACTIVE);assert.equal(body.action,'attack');
    S.actions++;S.revision++;return json(response());
   }
   assert.equal(req.method(),'GET','возврат не создаёт новый бой, hunt или платное действие: '+p);
   return route.fallback();
  }catch(e){routeErrors.push(e.message);return route.fulfill({status:500,json:{error:'fixture_assertion'}}).catch(()=>{})}});
  await h.sw.evaluate(async({old})=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:false,
   cfg:{...cfg,autoTasks:['farm'],taskOnly:false,combatProfile:'auto',fightMode:'dps',chain:false,zoneAuto:false,fishMode:false,catMode:false,rbMode:false,rbHuntMode:false,epicMode:false,campaign:false,
    autoRoles:false,autoMagister:false,autoLearn:false,weaponScanAuto:false,weaponClassEquip:false,weaponAuto:false,shopAuto:false,townBuffSet:'off',townBuff:false,vipBuffAuto:false,faBuffs:'',
    petAuto:true,petBuffAuto:false,petFullAuto:false,petResummon:false,petFinish:false,petSummon:'Summon Feline King',nPetBuffs:'',
    tvtOn:false,enemyHunt:false,pvpOnSight:false,pvpAll:false,clanTasks:false,dailyAuto:false,mmOrders:false,mmUpgrade:false,mmMailClaim:false,
    searchChamp:false,searchQuest:false,autoShots:false,potSlotAuto:false,debuffAuto:false,autoRevive:false,rec:false,autoSnap:false,reactMin:0,reactMax:0,
    nAttack:'Атака',nPower:'',nUltra:'',nStun:'',nDebuff:'',nDrain:'',nCharge:'',nBuffs:'',nKeyBuffs:'',nToggles:''},
   rt:{...rt,char:'AuditHero',lvl:79,prof:'human_arcana_lord',classCur:{prof:'human_arcana_lord',slot:0,t:1},classBranch:'mystic',manualKickAt:0,startPrep:null,petPrep:null,petRaidPrep:null,petBufferTrip:null,
    target:{id:old,spawnId:old,name:'Old target001',rb:false,champ:false},via:'/battle.html?spawnId='+old,lastBattle:{id:old,name:'Old target001'},
    invScan:null,shop:null,magister:null,tbuff:null,rbGo:null,rbHunt:null,zoneGo:null,storyJob:null,mmJob:null,tsJob:null,fishSvc:null,fishService:null,dailyFish:null,dailyRb:null,revive:null,actionOwner:null,
    skills:{},skillDb:{},cdUntil:{},cdUse:{},farmQuota:{},dailyQuota:null,shopT:Date.now(),weaponsT:Date.now()}});},{old:OLD});
  await h.g.p.goto('https://l2wap.com/mail.html');
  await until(()=>S.characterReads>0&&h.g.core('rt.char==="AuditHero" && !!L2V7Modules.warlock'));
  await h.popup.reload();await h.g.p.bringToFront();
  calls.length=0;paths.length=0;S.phase='resume';
  await h.click('start');
  if(stop){
   await until(()=>S.held,15000);await h.click('stop');await until(async()=>!(await h.get(['on'])).on);
   await until(()=>h.g.core('!on'));release();await delay(900);
   assert.equal(new URL(h.g.p.url()).pathname,'/mail.html');assert.deepEqual(paths,[],'Стоп во время GET запрещает последующую навигацию');assert.equal(S.actions,0);
  }else{
   await until(()=>paths.some(x=>x.path==='/battle.html'),15000);
   await until(()=>h.g.p.evaluate(active=>window.startActiveBattle?.battle?.spawnId===active,ACTIVE),15000);
   const opened=await h.g.p.evaluate(()=>({id:window.startActiveBattle.character.id,spawn:window.startActiveBattle.battle.spawnId,hp:window.startActiveBattle.battle.mobHp,shown:document.getElementById('battle-mob-hp-val').textContent}));
   assert.deepEqual(opened,{id:HERO,spawn:ACTIVE,hp:5000,shown:'5000 / 5000'},'страница получила и нарисовала подтверждённый серверный бой192');
   await h.click('stop');await until(async()=>!(await h.get(['on'])).on);
   assert.deepEqual(paths.map(x=>x.path+x.query),['/battle.html?spawnId='+ACTIVE]);
   assert.equal(new URL(h.g.p.url()).searchParams.get('spawnId'),ACTIVE);
   assert.ok(calls.some(x=>x.path==='/game/battle'&&x.phase==='battle'),'новый документ прочитал существующий бой192');
   assert.equal((await h.get(['rt'])).rt.target.id,OLD,'старая цель001 не подменяла серверный бой и осталась прежней');
  }
  const returning=calls.filter(x=>x.phase==='resume'),after=calls.filter(x=>x.phase==='battle');
  assert.ok(returning.some(x=>x.path==='/character'),'перед возвратом прочитан свежий персонаж с живым котом');
  assert.ok(returning.some(x=>x.path==='/game/battle'),'серверный активный бой подтверждён отдельно');
  assert.equal(returning.filter(x=>x.method!=='GET').length,0,'возврат к бою — только чтение и навигация');
  assert.equal(calls.filter(x=>x.method==='POST'&&/\/game\/battle\/(?:start|hunt-continue)$/.test(x.path)).length,0,'существующий бой не перезапускается');
  assert.equal(after.filter(x=>x.method==='POST'&&x.path!=='/game/battle/action').length,0);
  assert.deepEqual(routeErrors,[]);assert.deepEqual(h.errors,[]);
  const item={case:stop?'Stop during active-battle GET':'mail Start resumes and reads active192',browser:h.ctx.browser().version(),paths,calls,actions:S.actions,errors:[...routeErrors,...h.errors]};proof.push(item);
  console.log('PASS actual MV3 Start from mail',JSON.stringify({case:item.case,navigations:paths.length,returnPosts:returning.filter(x=>x.method!=='GET').length,combatActions:S.actions}));
 }catch(e){console.error('DIAG start-active-battle',JSON.stringify({stop,S,paths,calls,routeErrors,state:await h.g.core('({on,running,tabOwner,status:rt.status,startPrep:rt.startPrep,petPrep:rt.petPrep,url:location.href})').catch(String)}));throw e;}
 finally{release();await h.ctx.close();}
}
(async()=>{try{for(const stop of [false,true])await scenario(stop)}finally{if(process.env.START_ACTIVE_BATTLE_PROOF)fs.writeFileSync(process.env.START_ACTIVE_BATTLE_PROOF,JSON.stringify({boundary:'actual Chrome MV3; all HTTPS mocked locally; no live game',proof},null,2)+'\n')}})().catch(e=>{console.error(e.stack);process.exitCode=1});
