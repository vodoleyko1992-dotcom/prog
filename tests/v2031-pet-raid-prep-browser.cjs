'use strict';
// Настоящие MV3/main/hook; HTTPS полностью перехвачен локальной моделью.
// Обработчик панели здесь — модель игры, а не копия публичного l2-skill-cast-client.js.
const assert=require('node:assert/strict');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const wanted='Summon Feline Queen, Warrior Servitor, Final Servitor';
const proof=[];
async function scenario(stop){
 const h=await harness(),calls=[],paths=[],casts=[],routeErrors=[];
 const S={revision:10,pet:false,buffs:[],hold:false,held:false};let release;
 const gate=new Promise(r=>release=r);
 const ch=()=>({name:'AuditHero',revision:S.revision,level:75,l2Profession:'human_warlock',classBranch:'mystic',classSlots:{activeSlot:0,slots:[{slot:0,profession:'human_warlock',active:true,owned:true,level:75}]},adena:30000000,inBattle:false,hp:5000,maxHp:5000,mp:5000,maxMp:5000,pAtk:1000,mAtk:1000,pDef:1000,mDef:1000,activeBuffs:[],locationType:'map',inventory:{eq:{},stacks:[]},activeSummon:S.pet?{kind:'servitor',key:'kai_the_cat',summonSkillId:1276,summonSkillLevel:10,hp:2000,maxHp:2000,activeBuffs:S.buffs}:null});
 const panel=()=>`<div id="skill-panel-hotbar-mount"><div class="l2-battle-hotbar" data-visible-rows="3"><div class="l2-battle-hotbar__row">${[[1276,'Summon Kai the Cat'],[1331,'Summon Feline Queen'],[1346,'Warrior Servitor'],[1349,'Final Servitor']].map(([id,name])=>`<button class="l2-battle-hotbar-slot" title="${name}" data-native-skill="${id}"><span data-slot-cd="l2_${id}" hidden></span>${name}</button>`).join('')}</div><div class="l2-battle-hotbar__row"></div><div class="l2-battle-hotbar__row"></div></div></div>`;
 const html=p=>`<!doctype html><meta charset="utf-8"><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">75</div><div id="character-profession">Human Warlock</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">5000</span><span id="l2-hud-hp-max">5000</span><span id="l2-hud-mp-cur">5000</span><span id="l2-hud-mp-max">5000</span>${p==='/skill-panel.html'?panel():'<div id="map-mob-list"></div>'}<script>localStorage.setItem('token','fixture');(async()=>{while(!window.__l2botHook)await new Promise(r=>setTimeout(r,20));await fetch('/character')})();for(const b of document.querySelectorAll('[data-native-skill]'))b.onclick=async()=>{await fetch('/character/skills/cast',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fixtureSkillId:+b.dataset.nativeSkill})});};</script>`;
 try{
  await h.ctx.route('https://l2wap.com/**',async r=>{
   try{
    const req=r.request(),p=new URL(req.url()).pathname;let body;try{body=req.postDataJSON()}catch{}
    calls.push({p,m:req.method(),revision:S.revision,body});
    const json=j=>r.fulfill({contentType:'application/json',body:JSON.stringify(j)}).catch(()=>{});
    if(p.endsWith('.html')){paths.push(p);return r.fulfill({contentType:'text/html; charset=utf-8',body:html(p)})}
    if(p==='/character'){
     if(stop&&S.hold&&!S.held){S.held=true;await gate;}
     return json({character:ch()});
    }
    if(p==='/character/skills/cast'){
     assert.equal(req.method(),'POST');const id=body.fixtureSkillId;
     assert.equal(id,[1276,1331,1346,1349][casts.length],'native buttons must follow summon → three buffs');
     if(id===1276){assert.equal(S.pet,false);S.pet=true;if(stop)S.hold=true;}
     else {assert.equal(S.pet,true,'buff before live summon');S.buffs.push({skillId:id===1331?4699:id,level:1,expiresAtMs:Date.now()+1200000});}
     casts.push(id);S.revision++;return json({character:ch()});
    }
    assert.notEqual(req.method(),'POST','unexpected mutation '+p);
    return r.fallback();
   }catch(e){routeErrors.push(e.message);return r.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'fixture_assertion'})}).catch(()=>{})}
  });
  await h.sw.evaluate(async wanted=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:['raid'],taskOnly:false,rbHuntMode:true,rbMode:true,rbFaFull:false,townBuffSet:'off',faBuffs:'',vipBuffAuto:false,petFullAuto:false,petFullBudget:0,petAuto:true,petBuffAuto:true,nPetBuffs:wanted,petSummon:'',autoRoles:false,autoMagister:false,weaponScanAuto:false,shopAuto:false,tvtOn:false,enemyHunt:false,pvpOnSight:false,potSlotAuto:false,autoShots:false,zoneAuto:false,catMode:false,fishMode:false,epicMode:false,campaign:false,nBuffs:'',nKeyBuffs:'',nDebuff:'',searchChamp:false,searchQuest:false,reactMin:0,reactMax:0},rt:{...rt,char:'AuditHero',lvl:75,classCur:{prof:'human_warlock',slot:0},manualKickAt:0,petFull:{},petBufferTrip:null,petRaidSkills:null,petRaidPrep:{char:'AuditHero',classKey:'0:warlock',settings:JSON.stringify([true,true,'',wanted]),kick:0,back:'/skill-panel.html',pending:null,t:Date.now()},magister:null,invScan:null,fishSvc:null,fishService:null,dailyFish:null,dailyRb:null,mmJob:null,tsJob:null,storyJob:null,rbGo:null,zoneGo:null,tbuff:null,shop:null,enchant:null,rbHunt:{step:'pick'},rbList:{},rbListT:Date.now(),weaponsT:Date.now(),shopT:Date.now(),target:null}})},wanted);
  await h.g.p.goto('https://l2wap.com/map.html');await until(()=>h.g.core('!!L2V7Modules.warlock && !!rt.petRaidPrep'));
  await h.popup.reload();await h.g.p.bringToFront();await h.click('start');
  if(stop){
   await until(()=>S.held,15000);await h.click('stop');await until(()=>h.g.core('!on'));release();await delay(1000);
   assert.deepEqual(casts,[1276]);assert.ok((await h.get(['rt'])).rt.petRaidPrep,'native job survives interruption');
  }else{
   await until(()=>casts.length===4,15000);await until(async()=>!(await h.get(['rt'])).rt.petRaidPrep,15000);
   // Обычный рейд уже может уйти с панели к списку: проверяем реальную повторную сверку после навигации.
   await until(()=>h.g.core('(async()=>{if(!on||!tabOwner||rt.petRaidPrep)return false;L2V7Modules.actions.enterFrame();await L2V7Modules.warlock.raidPrepare();return L2V7Modules.warlock.raidReady()})()'),15000);await h.click('stop');
   assert.deepEqual(casts,[1276,1331,1346,1349]);assert.deepEqual(S.buffs.map(x=>x.skillId),[4699,1346,1349]);
   for(let n=0;n<4;n++){const i=calls.findIndex(x=>x.p==='/character/skills/cast'&&x.body.fixtureSkillId===casts[n]);const next=calls.findIndex((x,j)=>j>i&&x.p==='/character');assert.ok(next>i,'fresh GET after native action '+casts[n]);if(n<3){const later=calls.findIndex((x,j)=>j>i&&x.p==='/character/skills/cast');assert.ok(next<later,'confirmation precedes next native action');}}
  }
  assert.ok(paths.includes('/skill-panel.html'));assert.deepEqual(routeErrors,[]);assert.deepEqual(h.errors,[]);assert.equal(calls.filter(x=>x.p==='/character/town/buffer'&&x.m==='POST').length,0);
  proof.push({case:stop?'stop':'native-preparation',browser:h.ctx.browser().version(),casts,paths,requests:calls,errors:[...h.errors,...routeErrors],effects:S.buffs.map(x=>x.skillId)});
  console.log('PASS actual MV3/main/hook pet raid prep '+(stop?'Stop during fresh confirmation':'native summon → Queen → Warrior → Final → fresh raidReady'),JSON.stringify({casts,paths,gets:calls.filter(x=>x.p==='/character').length}));
 }catch(e){console.error('DIAG',JSON.stringify({stop,S,casts,paths,routeErrors,calls:calls.slice(-20),state:await h.g.core('({on,tabOwner,status:rt.status,prep:rt.petRaidPrep,ready:L2V7Modules.warlock.raidReady(),owner:rt.actionOwner,mode:autonomyMode(),cfg:{petAuto:cfg.petAuto,petFullAuto:cfg.petFullAuto,rbHuntMode:cfg.rbHuntMode},panel:warlockNativePanel()})').catch(String)}));throw e;}
 finally{release();await h.ctx.close()}
}
(async()=>{for(const stop of [false,true])await scenario(stop);if(process.env.PET_RAID_PROOF)require('node:fs').writeFileSync(process.env.PET_RAID_PROOF,JSON.stringify({at:new Date().toISOString(),boundary:'actual extension; fully local server/native-handler model; no live game',proof},null,2)+'\n')})().catch(e=>{console.error(e.stack);process.exitCode=1});
