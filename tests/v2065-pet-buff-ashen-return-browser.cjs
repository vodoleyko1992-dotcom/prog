'use strict';
// 20.65 (лог 26.10 13:50–13:57): восстановление уже сохранённого returnSent после баффа кота.
// Настоящий MV3; HTTPS полностью локальный. Покупку баффа и родной телепорт здесь не воспроизводим.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const ID='ashen-buff-return',SPAWN='ashen_bastion_mob_001',proof=[];

async function scenario(kind){
 const h=await harness(),calls=[],paths=[],routeErrors=[];
 const S={armed:false,held:false,reads:0,confirmed:0,starts:0,inBattle:false,revision:501,clearedAtStart:null};
 let release;const gate=new Promise(resolve=>release=resolve);
 const character=()=>({id:'ashen-return-hero',name:'AuditHero',revision:S.revision,level:79,l2Profession:'human_arcana_lord',classBranch:'mystic',
  classSlots:{activeSlot:0,slots:[{slot:0,profession:'human_arcana_lord',owned:true,active:true,level:79}]},
  cityId:kind==='wrong-city'?'giran':'ashen_bastion',currentZoneId:'ashen_bastion',activeDungeonId:null,locationType:'zone',inBattle:S.inBattle,
  hp:12000,maxHp:12000,mp:7000,maxMp:7000,adena:20000000,mobsKilled:100,inventory:{eq:{},stacks:[]},activeBuffs:[],
  activeSummon:{kind:'servitor',key:'feline_king',summonSkillId:1406,summonSkillLevel:11,hp:22000,maxHp:22000,activeBuffs:[]}});
 const battle=()=>({spawnId:SPAWN,mobName:'Return target',mobLevel:79,mobHp:5000,mobMaxHp:5000,kind:'passive',log:[]});
 const base='<div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">79</div><div id="character-profession">Human Arcana Lord</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">12000</span><span id="l2-hud-hp-max">12000</span><span id="l2-hud-mp-cur">7000</span><span id="l2-hud-mp-max">7000</span>';
 const html=p=>'<!doctype html><meta charset="utf-8"><title>Возврат после баффа кота</title>'+base+(p==='/ashen-bastion.html'
  ? `<h1>Ashen Bastion</h1><div id="ashen-mobs"><article class="ashen-mob"><span class="ashen-name">Return target · Lv79</span><button class="ashen-fight" data-id="${SPAWN}">Бій</button></article></div><script>
    document.querySelector('.ashen-fight').onclick=()=>{location.href='/battle.html?spawnId='+encodeURIComponent('${SPAWN}');};</script>`
  : `<div id="battle-mob-title">Return target · ур.79</div><div id="battle-mob-hp-val">5000 / 5000</div><div id="battle-log"></div><div id="battle-victory-inline" hidden>Победа!</div><script>
    localStorage.setItem('token','local-pet-return-fixture');(async()=>{while(!window.__l2botHook)await new Promise(r=>setTimeout(r,10));
     const {character:c}=await(await fetch('/character')).json();window.returnBattle=await(await fetch('/game/battle/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({spawnId:'${SPAWN}',expectedRevision:c.revision})})).json();})();</script>`);
 try{
  await h.ctx.route('https://l2wap.com/**',async route=>{try{
   const req=route.request(),u=new URL(req.url()),p=u.pathname;let body=null;try{body=req.postDataJSON()}catch(_){}
   calls.push({path:p,method:req.method(),query:u.search,body});const json=data=>route.fulfill({json:data}).catch(()=>{});
   if(p.endsWith('.html')){if(S.armed)paths.push(p+u.search);return route.fulfill({contentType:'text/html; charset=utf-8',body:html(p)}).catch(()=>{});}
   if(p==='/character'){
    S.reads++;
    const state=(await h.get(['rt'])).rt;
    if(S.armed&&!S.held&&state.actionOwner?.key==='petBufferTrip'){S.held=true;await gate;S.confirmed++;}
    return json({character:character()});
   }
   if(p==='/game/battle/start'){
    assert.equal(kind,'confirmed','при неподтверждённом возврате новый бой запрещён');assert.equal(req.method(),'POST');
    const state=(await h.get(['rt'])).rt;S.clearedAtStart={job:state.petBufferTrip??null,owner:state.actionOwner??null};
    assert.deepEqual(S.clearedAtStart,{job:null,owner:null},'до нового действия закончены и поход, и владение маршрутом');
    assert.equal(body.spawnId,SPAWN);assert.equal(body.expectedRevision,501);assert.equal(S.starts,0,'новый бой начинается один раз');
    S.starts++;S.inBattle=true;S.revision++;return json({ok:true,character:character(),battle:battle()});
   }
   assert.equal(req.method(),'GET','восстановление не повторяет бафф, телепорт или иной POST: '+p);
   return route.fallback();
  }catch(e){routeErrors.push(e.message);return route.fulfill({status:500,json:{error:'fixture_assertion',message:e.message}}).catch(()=>{})}});
  await h.sw.evaluate(async({id})=>{const{cfg,rt}=await chrome.storage.local.get(['cfg','rt']);const now=Date.now();await chrome.storage.local.set({on:false,
   cfg:{...cfg,autoTasks:['farm','petbuff'],taskOnly:false,combatProfile:'auto',chain:false,zoneAuto:false,fishMode:false,catMode:false,rbMode:false,rbHuntMode:false,epicMode:false,campaign:false,
    autoRoles:false,autoMagister:false,autoLearn:false,weaponScanAuto:false,weaponClassEquip:false,weaponAuto:false,shopAuto:false,townBuffSet:'off',townBuff:false,vipBuffAuto:false,faBuffs:'',
    petAuto:false,petBuffAuto:false,petFullAuto:true,petFullRenew:true,petFullReserve:0,petFullMaxPrice:10000000,petResummon:false,
    tvtOn:false,enemyHunt:false,pvpOnSight:false,pvpAll:false,clanTasks:false,dailyAuto:false,mmOrders:false,mmUpgrade:false,mmMailClaim:false,
    searchChamp:false,searchQuest:false,autoShots:false,potSlotAuto:false,debuffAuto:false,rec:false,autoSnap:false,reactMin:0,reactMax:0,lvlMin:1,lvlMax:99,
    dailyKillLimit:0,dailyAutoKillLimit:0,dailyCatKillLimit:0,nAttack:'',nPower:'',nUltra:'',nStun:'',nDebuff:'',nDrain:'',nCharge:'',nBuffs:'',nKeyBuffs:'',nToggles:''},
   rt:{...rt,char:'AuditHero',lvl:79,prof:'human_arcana_lord',classCur:{prof:'human_arcana_lord',slot:0,t:1},classBranch:'mystic',manualKickAt:7,zone:'ashen_bastion',startPrep:null,petPrep:null,petRaidPrep:null,
    petFull:{status:'active',spent:10000000,lifetimeSpent:10000000,purchases:1,pending:null,expiresAt:now+18000000,nextCheckAt:now+18000000},
    petBufferTrip:{id,char:'AuditHero',revision:498,price:10000000,kick:7,t:now-10000,phase:'returnSent',
     entry:{job:id,char:'AuditHero',revision:499,at:now-9000},home:{mode:'farm',zone:'ashen_bastion',catIn:null,catDungeon:'auto',path:'/map.html'},
     returnQuote:{kind:'zone',id:'ashen_bastion',price:0,revision:500,t:now-1000}},
    target:null,actionOwner:null,invScan:null,shop:null,magister:null,tbuff:null,rbGo:null,rbHunt:null,zoneGo:null,storyJob:null,mmJob:null,tsJob:null,fishSvc:null,fishService:null,dailyFish:null,dailyRb:null,revive:null,
    skills:{},skillDb:{},farmQuota:{},dailyQuota:null,shopT:now,weaponsT:now}});},{id:ID});
  await h.g.p.goto('https://l2wap.com/ashen-bastion.html');await until(()=>h.g.core('!on && rt.petBufferTrip?.id==="'+ID+'" && !!L2V7Modules.actions'));
  await h.popup.reload();await h.g.p.bringToFront();calls.length=0;paths.length=0;S.armed=true;
  // Возобновляется сохранённое on; новая команда Старт изменила бы kick и отменила прежний поход по другому правилу.
  await h.sw.evaluate(()=>chrome.storage.local.set({on:true}));
  await until(()=>S.held,15000);
  const pending=(await h.get(['rt'])).rt;
  assert.equal(pending.petBufferTrip.id,ID);assert.equal(pending.petBufferTrip.phase,'returnSent');assert.equal(pending.actionOwner.key,'petBufferTrip');
  if(kind==='stop'){
   await h.click('stop');await until(async()=>!(await h.get(['on'])).on);await until(()=>h.g.core('!on'));release();await delay(900);
  }else{
   release();await until(()=>S.confirmed>0);
   if(kind==='confirmed'){
    await until(()=>S.starts===1,15000);await until(()=>h.g.p.evaluate(spawn=>window.returnBattle?.battle?.spawnId===spawn,SPAWN));
    await h.click('stop');await until(async()=>!(await h.get(['on'])).on);
   }else await delay(900);
  }
  const state=(await h.get(['rt'])).rt;
  assert.equal(state.petFull.spent,10000000);assert.equal(state.petFull.purchases,1);assert.equal(state.petFull.pending,null,'квитанция принятого баффа сохранена');
  if(kind==='confirmed'){
   assert.equal(state.petBufferTrip,null);assert.equal(state.actionOwner,null);
   assert.deepEqual(paths,['/battle.html?spawnId='+SPAWN]);assert.equal(S.starts,1);
   assert.deepEqual(calls.filter(x=>x.method==='POST').map(x=>x.path),['/game/battle/start']);
  }else{
   assert.equal(state.petBufferTrip.id,ID);assert.equal(state.petBufferTrip.phase,'returnSent');assert.equal(state.actionOwner.key,'petBufferTrip');
   assert.deepEqual(paths,[]);assert.equal(S.starts,0);assert.equal(calls.filter(x=>x.method==='POST').length,0);
   assert.equal(new URL(h.g.p.url()).pathname,'/ashen-bastion.html');
   if(kind!=='stop'){await h.click('stop');await until(async()=>!(await h.get(['on'])).on);}
  }
  assert.deepEqual(routeErrors,[]);assert.deepEqual(h.errors,[]);
  proof.push({case:kind,browser:h.ctx.browser().version(),paths,calls,starts:S.starts,clearedAtStart:S.clearedAtStart,job:state.petBufferTrip?.phase??null,owner:state.actionOwner?.key??null,errors:[...routeErrors,...h.errors]});
  console.log('PASS actual MV3 saved summon-buff Ashen return',JSON.stringify({case:kind,starts:S.starts,job:state.petBufferTrip?.phase??null,owner:state.actionOwner?.key??null,posts:calls.filter(x=>x.method==='POST').map(x=>x.path)}));
 }catch(e){console.error('DIAG pet-buff-ashen-return',JSON.stringify({kind,S,paths,calls,routeErrors,state:await h.get(['on','rt']).then(x=>({on:x.on,status:x.rt.status,job:x.rt.petBufferTrip,owner:x.rt.actionOwner,ledger:x.rt.petFull})).catch(String)}));throw e;}
 finally{release();await h.ctx.close();}
}
(async()=>{try{for(const kind of ['confirmed','wrong-city','stop'])await scenario(kind)}finally{if(process.env.PET_ASHEN_RETURN_PROOF)fs.writeFileSync(process.env.PET_ASHEN_RETURN_PROOF,JSON.stringify({boundary:'real Chrome MV3; restored returnSent only; purchase and accepted teleport seeded; all HTTPS local',proof},null,2)+'\n')}})().catch(e=>{console.error(e.stack);process.exitCode=1});
