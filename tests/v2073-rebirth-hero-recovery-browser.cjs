'use strict';
// Лог28.10 04:59: настоящий MV3 Start/main/hook, посмертный городской маршрут и допуск к новому бою.
// HTTPS и нативные обработчики полностью локальные; живой аккаунт и оплата входа не используются.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const HERO='00000000-0000-4000-8000-000000000002',RUN='00000000-0000-4000-8000-000000000001',SPAWN='rebirth_raid_'+RUN+'_2_1_25394_lv38_mob_1';
const IDS=[1068,1268,1086,1045],proof=[];
async function scenario(which){
 const death=which==='death-recovery',stop=which==='stop-held',h=await harness(),paths=[],calls=[],routeErrors=[];
 const S={revision:100,hp:death?3562:359,maxHp:death?3562:2292,mp:1225,maxMp:1225,buffed:death,active:true,inBattle:death,defeated:false,returned:false,
  actions:0,returns:0,basic:0,restores:0,starts:0,entries:0,keys:100,held:false,hadOwnJob:false,recoveryKinds:[]};
 let release;const gate=new Promise(r=>release=r);
 const buffs=()=>S.buffed?IDS.map(skillId=>({skillId,level:skillId===1045?5:2,expiresAtMs:Date.now()+86400000,expiresAt:Date.now()+86400000})):[];
 const char=()=>({id:HERO,name:'AuditHero',revision:S.revision,level:38,rebirthStage:1,l2Profession:'human_wizard',race:'Human',classBranch:'mystic',
  classSlots:{activeSlot:0,slots:[{slot:0,owned:true,active:true,profession:'human_wizard',level:38,rebirthStage:1}]},hp:S.hp,maxHp:S.maxHp,mp:S.mp,maxMp:S.maxMp,cp:992,maxCp:992,
  inBattle:S.inBattle,battleSpawnId:S.inBattle?SPAWN:null,sp:0,adena:'30000000',cityId:'l2dop_giran',currentZoneId:'plains_of_the_lizardman',locationType:'zone',worldX:1,worldY:1,
  activeDungeonId:null,inventory:{stacks:[],eq:{}},activeBuffs:buffs(),activeSummon:null,vip:{active:false}});
 const run=()=>S.active?{id:RUN,difficulty:2,phase:'mobs',mobKillTarget:300,mobKills:0,participantCharacterIds:[HERO],partyId:null,verifiedVictoryIds:[],referenceBossSpawnId:'l2dop_rb_25394',referenceBossLevel:38,mobLevel:38,mobLevelOwnerCharacterId:HERO}:null;
 const battle=()=>({spawnId:SPAWN,mobName:'Rebirth · Fettered Soul',mobLevel:38,mobHp:19839,mobMaxHp:19839,kind:'dungeon',ended:false,championTier:'',logSeq:1,log:['Бій розпочато: [Rebirth · Fettered Soul] (ур.38).']});
 const response=()=>({ok:true,revision:S.revision,character:char(),battle:S.defeated?null:battle(),...(S.defeated?{defeat:{spawnId:SPAWN,mobName:'Rebirth · Fettered Soul',fullLog:['[Rebirth · Fettered Soul] ударив тебе — −6971 HP.','Ти знепритомнів… Бій завершено.','Всі бафи злетіли від смерті.','Тебе віднесли до Місто Гіран.']}}:{})});
 const catalog=()=>({sets:[{id:'basic',feeAdena:'0',feeCoinOfLuck:0,titleUk:'Звичайний баф',skills:IDS.map(skillId=>({skillId,level:skillId===1045?5:2,durationSec:86400}))}]});
 const base=()=>`<div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">38</div><div id="character-profession">Human Wizard</div><div id="l2-nav-bottom"><a data-nav-role="city" href="/city.html">Город</a></div><span id="l2-hud-hp-cur">${S.hp}</span><span id="l2-hud-hp-max">${S.maxHp}</span><span id="l2-hud-mp-cur">${S.mp}</span><span id="l2-hud-mp-max">${S.maxMp}</span><div id="l2-hud-active-buffs">${buffs().map(b=>`<span class="l2-hud-active-buff" data-skill-id="${b.skillId}" data-expires-at="${b.expiresAtMs}" title="Buff · Lv.${b.level}"></span>`).join('')}</div><div id="char-bag-list"></div><div id="char-bag-pager"></div><button data-inv-cat="weapon" aria-selected="true"></button><button data-inv-grade="all" aria-selected="true"></button>`;
 const html=u=>{
  let body;const p=u.pathname;
  if(p==='/battle.html')body=`<section id="battle-mob-panel"><h2 id="battle-mob-title">Rebirth · Fettered Soul · ур.38 · агрессивный</h2><div id="battle-mob-hp-val">19839 /19839</div></section><div id="battle-log"></div><button id="hit" class="l2-battle-hotbar-slot" data-slot-idx="0" title="Атака"><span data-slot-cd="attack">Атака</span></button><div id="battle-victory-inline" hidden></div><div id="battle-defeat-root" hidden><button id="battle-defeat-tocity">Вернуться в город</button></div>`;
  else if(p==='/city.html')body='<h1>Місто Гіран</h1><a class="l2-town-miru-item--buffer-statue" href="/town-buffer.html">Магическая статуя</a>';
  else if(p==='/town-buffer.html')body='<h1>Городской баффер</h1><div id="town-buffer-sets"><button class="l2-town-buffer-set-apply" data-set-id="basic" id="basic">Применить бесплатный basic</button></div><div id="town-buffer-result-overlay" hidden><div id="town-buffer-result-title"></div><div id="town-buffer-result-text"></div></div><div id="town-buffer-msg"></div><button id="town-buffer-restore-btn">Восстановить HP|MP|CP</button>';
  else if(p==='/rebirth-raids.html')body='<h1>Подземелья Rebirth RB</h1><button class="l2-rraid-main-button" id="resume">Продолжить подземелье</button><div id="rebirth-raid-levels">Ключи подземелья:100</div>';
  else if(p==='/rebirth-raid-dungeon.html')body='<h1>Подземелье Rebirth RB</h1><div id="rebirth-instance-content"><p>Мобы · страница1/20</p><button class="l2-rraid-fight" id="fight">Бой</button></div>';
  else throw Error('недопустимый выход из собственного маршрута '+p);
  return `<!doctype html><meta charset="utf-8"><title>Hero recovery fixture</title>${base()}${body}<script>
   localStorage.setItem('token','local-rebirth-hero-fixture');
   const get=p=>fetch(p,{headers:{'X-fixture-native':'1'}}).then(r=>r.json());const post=(p,d)=>fetch(p,{method:'POST',headers:{'Content-Type':'application/json','X-fixture-native':'1'},body:JSON.stringify(d)}).then(r=>r.json());
   const render=c=>{window.snapshot=c;document.getElementById('l2-hud-hp-cur').textContent=c.hp;document.getElementById('l2-hud-hp-max').textContent=c.maxHp;document.getElementById('l2-hud-mp-cur').textContent=c.mp;document.getElementById('l2-hud-active-buffs').innerHTML=(c.activeBuffs||[]).map(b=>'<span class="l2-hud-active-buff" data-skill-id="'+b.skillId+'" data-expires-at="'+b.expiresAtMs+'" title="Buff · Lv.'+b.level+'"></span>').join('');};
   const ready=(async()=>{while(!window.__l2botHook)await new Promise(r=>setTimeout(r,10));render((await get('/character')).character);window.fixtureReady=true;})();
   const hit=document.getElementById('hit');if(hit)hit.onclick=async()=>{await ready;const d=await post('/game/battle/action',{action:'attack',battleSpawnId:'${SPAWN}',expectedRevision:window.snapshot.revision});render(d.character);if(d.defeat){document.getElementById('battle-defeat-root').hidden=false;document.getElementById('battle-log').textContent=d.defeat.fullLog.join(String.fromCharCode(10));}};
   const town=document.getElementById('battle-defeat-tocity');if(town)town.onclick=async()=>{await ready;const d=await post('/game/battle/return-to-town',{expectedRevision:window.snapshot.revision,characterId:'${HERO}',battleSpawnId:'${SPAWN}'});render(d.character);location.href='/city.html';};
   const basic=document.getElementById('basic');if(basic)basic.onclick=async()=>{await ready;const d=await post('/character/town/buffer',{set:'basic',expectedRevision:window.snapshot.revision,expectedFeeAdena:'0',expectedFeeCoinOfLuck:0});render(d.character);document.getElementById('town-buffer-result-title').textContent='Бафф наложен';document.getElementById('town-buffer-result-overlay').hidden=false;};
   const overlay=document.getElementById('town-buffer-result-overlay');if(overlay)overlay.onclick=()=>overlay.hidden=true;
   const restore=document.getElementById('town-buffer-restore-btn');if(restore)restore.onclick=async()=>{await ready;const d=await post('/character/town/restore-vitals',{expectedRevision:window.snapshot.revision});render(d.character);document.getElementById('town-buffer-msg').textContent='Відновлено';};
   const resume=document.getElementById('resume');if(resume)resume.onclick=()=>location.href='/rebirth-raid-dungeon.html';
   const fight=document.getElementById('fight');if(fight)fight.onclick=async()=>{await ready;const d=await post('/game/battle/start',{spawnId:'${SPAWN}',expectedRevision:window.snapshot.revision});location.href='/battle.html?spawnId='+encodeURIComponent(d.battle.spawnId);};
  </script>`;
 };
 try{
  await h.ctx.route('https://l2wap.com/**',async route=>{try{
   const req=route.request(),u=new URL(req.url()),p=u.pathname,native=req.headers()['x-fixture-native']==='1';let body=null;try{body=req.postDataJSON()}catch(_){}
   calls.push({path:p,method:req.method(),native,body});const json=d=>route.fulfill({json:d}).catch(()=>{});
   if(p.endsWith('.html')){paths.push(p+u.search);return route.fulfill({contentType:'text/html; charset=utf-8',body:html(u)}).catch(()=>{});}
   if(p==='/character'){
    if(stop&&!native&&!S.held&&(await h.get(['on'])).on){S.held=true;await gate;}
    return json({character:char()});
   }
   if(p==='/game/rebirth-raids')return json({enabled:true,rebirthStage:1,activeRun:run(),activeMobPage:1,totalMobPages:20,mobTargets:[]});
   if(p==='/game/battle')return json(response());
   if(p==='/game/battle/action'){
    assert.equal(body.action,'attack');assert.equal(body.expectedRevision,S.revision);S.actions++;
    if(!death){await gate;return json(response());}
    S.inBattle=false;S.active=false;S.defeated=true;S.hp=550;S.maxHp=2292;S.buffed=false;S.revision++;return json(response());
   }
   if(p==='/game/battle/return-to-town'){assert.equal(death,true);assert.equal(S.defeated,true);S.returns++;S.returned=true;S.revision++;return json({character:char()});}
   if(p==='/character/town/buffer/catalog'){
    const state=await h.get(['rt']);if(state.rt.tbuff?.rebirthRecovery){S.hadOwnJob=true;const k=state.rt.tbuff.rebirthRecovery.kind;if(!S.recoveryKinds.includes(k))S.recoveryKinds.push(k);}
    return json(catalog());
   }
   if(p==='/character/town/buffer'){
    assert.equal(body.set,'basic');assert.equal(body.expectedFeeAdena,'0');assert.equal(body.expectedFeeCoinOfLuck,0);assert.equal(body.expectedRevision,S.revision);
    if(death)assert.equal(S.returned,true);S.basic++;S.buffed=true;S.maxHp=3562;S.revision++;return json({character:char()});
   }
   if(p==='/character/town/restore-vitals'){
    assert.equal(S.buffed,true,'сначала бесплатный бафф, затемHP нового максимума');assert.equal(body.expectedRevision,S.revision);if(death)assert.equal(S.returned,true);
    S.restores++;S.hp=S.maxHp;S.mp=S.maxMp;S.revision++;return json({character:char()});
   }
   if(p==='/game/battle/start'){
    assert.equal(death,false,'после пропавшего от смерти run новая оплата/бой не разрешены');assert.equal(S.restores,1);assert.equal(S.basic,1);assert.equal(S.hp,S.maxHp);
    assert.equal(body.spawnId,SPAWN);assert.equal(body.expectedRevision,S.revision);S.starts++;assert.equal(S.starts,1);S.inBattle=true;S.revision++;return json(response());
   }
   if(p==='/game/rebirth-raids/start'){S.entries++;throw Error('новый платный вход запрещён');}
   if(p.startsWith('/game/story-quests/'))return json({quest:{completed:true,stage:'completed',chapter:10}});
   assert.equal(req.method(),'GET','неразрешённый POST '+p);return route.fallback();
  }catch(e){routeErrors.push(e.message);return route.fulfill({status:500,json:{error:'fixture_assertion'}}).catch(()=>{})}});
  await h.sw.evaluate(async({death,RUN,SPAWN,HERO})=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']),now=Date.now();await chrome.storage.local.set({on:false,
   cfg:{...cfg,autoTasks:['rebirth'],rebirthMode:true,rebirthDifficulty:2,rebirthAutoEnter:true,rebirthKeyReserve:0,rebirthBossChoice:'manual',chain:true,taskOnly:false,
    zoneAuto:false,combatProfile:'fighter',autoRoles:false,autoMagister:false,autoLearn:false,weaponScanAuto:false,weaponClassEquip:false,shopAuto:false,petAuto:false,petBuffAuto:false,petFullAuto:false,townBuffSet:'basic',vipBuffAuto:false,faBuffs:'',tvtOn:false,enemyHunt:false,clanTasks:false,dailyAuto:false,mmOrders:false,mmUpgrade:false,mmMailClaim:false,mmFarmGuide:false,storyTurnIn:false,
    rbMode:false,rbHuntMode:false,epicMode:false,catMode:false,fishMode:false,campaign:false,campAuto:false,searchChamp:false,searchQuest:false,champFa:false,priority:'[все]',nAttack:'Атака',nPower:'',nBuffs:'',nKeyBuffs:'',nDebuff:'',nToggles:'',autoShots:false,potSlotAuto:false,debuffAuto:false,rec:false,autoSnap:false,reactMin:0,reactMax:0,deepEvery:0,mapEvery:0,dailyKillLimit:0,autoRevive:true},
   rt:{...rt,char:'AuditHero',lvl:38,prof:'human_wizard',classCur:{prof:'human_wizard',slot:0},manualKickAt:0,zone:'plains_of_the_lizardman',hpMin:{},target:null,via:null,rebirth:death?{char:'AuditHero',actor:HERO,prof:'human_wizard',slot:0,runId:RUN,battleSpawn:SPAWN,battleRole:'mob'}:{},kills:0,sp:0,exp:0,adena:0,
    storySaga:{completed:true,stage:'completed'},dionCampaign:{completed:true,stage:'completed',chapter:10},campaign:null,campaignUrl:'',campaignDue:false,questTargets:[],questSeen:{},shopT:now,weaponsT:now,invScan:null,shop:null,magister:null,tbuff:null,restoreRes:null,revive:null,deathLog:[],deaths:[],rbGo:null,zoneGo:null,petBufferTrip:null,storyJob:null,mmJob:null,tsJob:null,actionOwner:null,skills:{},farmQuota:{},dailyQuota:null}});},{death,RUN,SPAWN,HERO});
  await h.g.p.goto('https://l2wap.com/'+(death?'battle.html?spawnId='+SPAWN:'rebirth-raids.html'));await until(()=>h.g.core('!!L2V7Modules.rebirth&&rt.char==="AuditHero"'));await until(()=>h.g.p.evaluate(()=>window.fixtureReady));
  await h.popup.reload();await h.g.p.bringToFront();await h.click('start');
  if(stop){await until(()=>S.held,10000);assert.equal(S.basic,0);assert.equal(S.restores,0);assert.equal(S.starts,0);await h.popup.locator('#stop').click({force:true});await until(async()=>!(await h.get(['on'])).on);release();await delay(500);assert.equal(paths.filter(p=>p==='/town-buffer.html').length,0);}
  else if(death){await until(()=>S.restores===1&&h.g.p.url().includes('/rebirth-raids.html'),35000);await until(()=>h.g.core('String(rt.status||"").includes("прошлый поход исчез")'),10000);await h.popup.locator('#stop').click({force:true});}
  else{await until(()=>S.starts===1,35000);await h.popup.locator('#stop').click({force:true});release();}
  await until(async()=>!(await h.get(['on'])).on);await delay(300);
  const state=await h.get(['rt']);assert.equal(S.entries,0);assert.equal(S.keys,100);assert.equal(paths.some(p=>/^\/map|^\/teleport|^\/fast-aden-buffer/.test(p)),false);
  if(!stop){assert.equal(S.basic,1);assert.equal(S.restores,1);assert.equal(S.hp,3562);assert.equal(S.maxHp,3562);assert.equal(state.rt.restoreRes?.ok,true);assert.equal(state.rt.tbuff,null);assert.equal(S.hadOwnJob,true);}
  if(death){assert.equal(S.returns,1);assert.equal(S.starts,0);assert.equal(state.rt.deathLog.length,1);assert.deepEqual(S.recoveryKinds,['death'],'посмертный маршрут не отменён и не заменён новым prepare');}
  assert.deepEqual(routeErrors,[]);assert.deepEqual(h.errors,[]);
  proof.push({case:which,browser:h.ctx.browser().version(),paths,calls,result:{...S},status:state.rt.status,errors:[...routeErrors,...h.errors]});
  console.log('PASS actual MV3 Rebirth hero recovery',JSON.stringify({case:which,basic:S.basic,restores:S.restores,starts:S.starts,returns:S.returns,entries:S.entries,hp:S.hp,maxHp:S.maxHp}));
 }catch(e){console.error('DIAG rebirth-hero-recovery',JSON.stringify({which,S,paths,routeErrors,pageErrors:h.errors,state:await h.g.core('({on,running,tabOwner,status:rt.status,revive:rt.revive,tbuff:rt.tbuff,rebirth:rt.rebirth})').catch(String)}));throw e;}
 finally{release();await h.ctx.close();}
}
(async()=>{try{for(const c of ['death-recovery','lowhp-before-fight','stop-held'].filter(c=>!process.env.REBIRTH_HERO_CASE||c===process.env.REBIRTH_HERO_CASE))await scenario(c);}finally{if(process.env.REBIRTH_HERO_PROOF)fs.writeFileSync(process.env.REBIRTH_HERO_PROOF,JSON.stringify({boundary:'Actual Chrome MV3/main/hook with local native battle death, city/statue, free basic buff/restore, lowHP fight readiness and popupStop; no live game or paid entry',proof},null,2)+'\n');}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
