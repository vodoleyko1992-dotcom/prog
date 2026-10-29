'use strict';
// Лог29.10 09:51–10:28: полные HP/MP, сильные баффы и устаревшая VIP-память не должны гонять каталог ↔ баффер.
// Настоящие Chrome MV3/main/hook; HTTPS целиком обслуживается локальными fixture-маршрутами harness.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const HERO='00000000-0000-4000-8000-000000000002',RUN='00000000-0000-4000-8000-000000000001',proof=[];
const BASE=[{skillId:1059,level:2},{skillId:1303,level:2},{skillId:1045,level:5}],EXTRA=[{skillId:1357,level:1},{skillId:1323,level:1}];
async function scenario(stop){
 const h=await harness(),paths=[],posts=[],routeErrors=[];let revision=100,held=false,release;
 const gate=new Promise(r=>release=r),expires=Date.now()+86400000;
 let effects=BASE.map(x=>({...x,level:x.skillId===1059?3:x.level,expiresAtMs:expires}));
 const initialStrong=structuredClone(effects[0]);
 const ch=()=>({id:HERO,name:'AuditHero',revision,level:38,rebirthStage:1,l2Profession:'human_wizard',race:'Human',classBranch:'mystic',
  classSlots:{activeSlot:0,slots:[{slot:0,owned:true,active:true,profession:'human_wizard',level:38,rebirthStage:1}]},hp:5198,maxHp:5198,mp:2271,maxMp:2271,cp:992,maxCp:992,
  inBattle:false,sp:0,adena:'30000000',cityId:'l2dop_giran',currentZoneId:'plains_of_the_lizardman',locationType:'city',worldX:1,worldY:1,
  activeDungeonId:null,inventory:{stacks:[],eq:{}},activeBuffs:effects,activeSummon:null,vip:{active:true,vipUntil:new Date(expires).toISOString()}});
 const catalog={sets:[{id:'basic',feeAdena:'0',feeCoinOfLuck:0,skills:[{skillId:1068,level:2}]},
  {id:'mage',feeAdena:'0',feeCoinOfLuck:0,skills:BASE},{id:'greater',feeAdena:'0',feeCoinOfLuck:0,skills:EXTRA}]};
 const hud=()=>`<div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">38</div><div id="character-profession">Human Wizard</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">5198</span><span id="l2-hud-hp-max">5198</span><span id="l2-hud-mp-cur">2271</span><span id="l2-hud-mp-max">2271</span><div id="l2-hud-active-buffs">${effects.map(b=>`<span class="l2-hud-active-buff" data-skill-id="${b.skillId}" data-expires-at="${b.expiresAtMs}" title="Buff · Lv.${b.level}"></span>`).join('')}</div><div id="char-bag-list"></div><div id="char-bag-pager"></div><button data-inv-cat="weapon" aria-selected="true"></button><button data-inv-grade="all" aria-selected="true"></button>`;
 const html=p=>{
  assert.ok(['/rebirth-raids.html','/town-buffer.html'].includes(p),'собственный маршрут не выходит на другие страницы: '+p);
  return `<!doctype html><meta charset="utf-8"><title>Rebirth VIP loop fixture</title>${hud()}${p==='/town-buffer.html'?'<h1>Городской баффер</h1><div id="town-buffer-msg"></div><button id="town-buffer-restore-btn">Восстановить HP|MP|CP</button>':'<h1>Подземелья Rebirth RB</h1><div id="rebirth-raid-levels">Ключи подземелья:100</div>'}<script>localStorage.setItem('token','local-only-vip-loop-fixture');(async()=>{while(!window.__l2botHook)await new Promise(r=>setTimeout(r,10));window.fixtureReady=true})();const restore=document.getElementById('town-buffer-restore-btn');if(restore)restore.onclick=()=>fetch('/character/town/restore-vitals',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});</script>`;
 };
 try{
  await h.ctx.route('https://l2wap.com/**',async route=>{try{
   const req=route.request(),p=new URL(req.url()).pathname,json=d=>route.fulfill({json:d}).catch(()=>{});
   if(p.endsWith('.html')){paths.push(p);return route.fulfill({contentType:'text/html; charset=utf-8',body:html(p)}).catch(()=>{});}
   if(req.method()==='POST'){
    const body=req.postDataJSON();posts.push({path:p,body});assert.equal(p,'/character/town/buffer','только бесплатные VIP-эффекты');
    assert.equal(body.set,'greater','сильный классовый набор не понижается');assert.ok(EXTRA.some(x=>x.skillId===body.skillId));
    assert.equal(body.expectedFeeAdena,'0');assert.equal(body.expectedFeeCoinOfLuck,0);assert.equal(body.expectedRevision,revision);
    assert.equal(effects.some(x=>x.skillId===body.skillId),false,'готовый эффект не покупается повторно');
    effects=[...effects,{...EXTRA.find(x=>x.skillId===body.skillId),expiresAtMs:expires}];revision++;return json({character:ch()});
   }
   if(p==='/character')return json({character:ch()});
   if(p==='/character/town/buffer/catalog'){
    if(stop&&!held){held=true;await gate;}return json(catalog);
   }
   if(p==='/game/rebirth-raids')return json({enabled:true,rebirthStage:1,activeRun:null,levels:[],keys:100});
   if(p.startsWith('/game/story-quests/'))return json({quest:{completed:true,stage:'completed',chapter:10}});
   // Последний route harness тоже локальный, поддерживает серверные часы и дневные лимиты.
   return route.fallback();
  }catch(e){routeErrors.push(e.message);return route.fulfill({status:500,json:{error:'fixture_assertion'}}).catch(()=>{});}});
  await h.sw.evaluate(async({HERO,RUN})=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']),now=Date.now(),kick=5;
   await chrome.storage.local.set({on:true,cfg:{...cfg,autoTasks:['rebirth'],rebirthMode:true,rebirthDifficulty:2,rebirthAutoEnter:false,rebirthBossChoice:'manual',chain:true,taskOnly:false,
    zoneAuto:false,combatProfile:'fighter',autoRoles:false,autoMagister:false,autoLearn:false,weaponScanAuto:false,weaponClassEquip:false,shopAuto:false,petAuto:false,petBuffAuto:false,petFullAuto:false,townBuffSet:'basic',vipBuffAuto:true,vipResists:false,faBuffs:'',rbSessBuffs:'',tvtOn:false,enemyHunt:false,clanTasks:false,dailyAuto:false,mmOrders:false,mmUpgrade:false,mmMailClaim:false,mmFarmGuide:false,storyTurnIn:false,
    rbMode:false,rbHuntMode:false,epicMode:false,catMode:false,fishMode:false,campaign:false,campAuto:false,searchChamp:false,searchQuest:false,champFa:false,priority:'[все]',nAttack:'',nPower:'',nBuffs:'',nKeyBuffs:'',nDebuff:'',nToggles:'',autoShots:false,potSlotAuto:false,debuffAuto:false,rec:false,autoSnap:false,reactMin:0,reactMax:0,deepEvery:0,mapEvery:0,dailyKillLimit:0,autoRevive:true},
    rt:{...rt,char:'AuditHero',lvl:38,prof:'human_wizard',classCur:{prof:'human_wizard',slot:0},manualKickAt:kick,zone:'plains_of_the_lizardman',hpMin:{},target:null,via:null,
     rebirth:{actor:HERO,failedRun:{kind:'death',at:now-60000,char:'AuditHero',actor:HERO,prof:'human_wizard',slot:0,kick,runId:RUN,spawn:'rebirth_raid_'+RUN+'_2_1_25394_lv38_mob_27'}},
     vipBuff:{char:'AuditHero',actor:HERO,active:true,until:now+86400000,set:'mage',prof:'human_wizard',slot:0,t:now-600000},vipApplied:null,
     storySaga:{completed:true,stage:'completed'},dionCampaign:{completed:true,stage:'completed',chapter:10},campaign:null,campaignUrl:'',campaignDue:false,questTargets:[],questSeen:{},shopT:now,weaponsT:now,invScan:null,shop:null,magister:null,tbuff:null,restoreRes:null,revive:null,deathLog:[],deaths:[],rbGo:null,zoneGo:null,petBufferTrip:null,storyJob:null,mmJob:null,tsJob:null,actionOwner:null,skills:{},farmQuota:{},dailyQuota:null}});
  },{HERO,RUN});
  await h.g.p.goto('https://l2wap.com/rebirth-raids.html');await until(()=>h.g.p.evaluate(()=>window.fixtureReady));
  await until(()=>h.g.core('on&&running&&tabOwner&&rt.char==="AuditHero"'));
  if(stop){
   await until(()=>held,15000);assert.equal(posts.length,0);await h.popup.locator('#stop').click({force:true});await until(async()=>!(await h.get(['on'])).on);release();await delay(500);assert.equal(posts.length,0,'Stop во время каталога запрещает поздний VIP POST');
  }else{
   await until(()=>posts.length===2,25000);
   await until(async()=>{const {rt}=await h.get(['rt']);return h.g.p.url().endsWith('/rebirth-raids.html')&&rt.tbuff===null&&rt.vipApplied?.bundleChecked&&String(rt.status).includes('поход не активен');},20000);
   await delay(1500);assert.ok(paths.filter(x=>x==='/town-buffer.html').length<=1,'после готового VIP нет новой петли');
   await h.popup.locator('#stop').click({force:true});await until(async()=>!(await h.get(['on'])).on);
  }
  const {rt}=await h.get(['rt']);assert.deepEqual(effects.find(x=>x.skillId===1059),initialStrong,'сильный Empower сохранён с прежним уровнем и сроком');
  assert.ok(paths.length<=3,'не более каталог→баффер→каталог');assert.deepEqual(routeErrors,[]);assert.deepEqual(h.errors,[]);
  if(!stop){assert.equal(posts.length,2);assert.equal(rt.tbuff,null);assert.equal(rt.restoreRes?.ok,true);assert.ok(rt.rebirth.failedRun.restoredAt>0);}
  const result={case:stop?'Stop-during-catalog':'full-vitals-stale-VIP',browser:h.ctx.browser().version(),paths,posts,held,strongBuffPreserved:true,paidEntries:0,restorePosts:0,liveRequests:0,status:rt.status,errors:[...routeErrors,...h.errors]};proof.push(result);
  console.log('PASS actual Chrome MV3 Rebirth buff loop',JSON.stringify({case:result.case,paths,freePosts:posts.length,paidEntries:0,strongBuffPreserved:true,liveRequests:0}));
 }catch(e){console.error('DIAG rebirth-buff-loop',JSON.stringify({stop,paths,posts,routeErrors,pageErrors:h.errors,state:await h.g.core('({on,running,tabOwner,status:rt.status,tbuff:rt.tbuff,vipBuff:rt.vipBuff,vipApplied:rt.vipApplied,rebirth:rt.rebirth})').catch(String)}));throw e;}
 finally{release();await h.ctx.close();}
}
(async()=>{try{for(const stop of [false,true])await scenario(stop);}finally{if(process.env.REBIRTH_BUFF_LOOP_PROOF)fs.writeFileSync(process.env.REBIRTH_BUFF_LOOP_PROOF,JSON.stringify({boundary:'Actual Chrome MV3/main/hook; all HTTPS fulfilled locally; resumed fullHP/MP death marker, stale VIP, protected stronger buffs, free extras, popupStop; no live game or paid entry',proof},null,2)+'\n');}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
