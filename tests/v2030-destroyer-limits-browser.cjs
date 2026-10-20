'use strict';
// Настоящие MV3/main/hook; каждый HTTPS-запрос получает только локальный ответ.
const assert=require('node:assert/strict');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
async function scenario(mode){
 const h=await harness();const acts=[];let hp=37261,mp=3841,ended=false,paused=false;const buffs=[];
 const character=()=>({id:'fixture-titan',name:'AuditHero',level:79,l2Profession:'orc_titan',classBranch:'fighter',classSlots:{activeSlot:0,slots:[{slot:0,active:true,profession:'orc_titan',level:79}]},revision:100+acts.length,hp,maxHp:37261,mp,maxMp:3841,inBattle:!ended,activeBuffs:buffs.map(id=>({skillId:id,level:1,expiresAt:Date.now()+60000}))});
 const battle=()=>({spawnId:'fixture',mobName:"Giant's Shadow",mobHp:ended?0:3972,mobMaxHp:3972,mobLevel:79,kind:'normal',log:ended?['Победа!']:acts.slice()});
 try{
 await h.sw.evaluate(async mode=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:false,cfg:{...cfg,destroyerLimits:mode!=='off',autoTasks:['farm'],autoMagister:false,taskOnly:false,zoneAuto:false,catMode:false,chain:false,searchChamp:false,searchQuest:false,champFa:false,autoRoles:false,combatProfile:'fighter',nAttack:'Атака',nPower:'',nUltra:'',nStun:'',nBuffs:'',nKeyBuffs:'Frenzy, Zealot',nDebuff:'',nDrain:'',nCharge:'',nToggles:'',nHeal:'Battle Roar',nHpPot:'Велике зілля HP',hpPotAt:50,stopHp:25,petAuto:false,petBuffAuto:false,debuffAuto:false,autoShots:false,potSlotAuto:false,townBuffSet:'off',faBuffs:'',tvtOn:false,enemyHunt:false,reactMin:0,reactMax:0,rbMode:false,rbHuntMode:false,rbTour:false,rbFrenzyDive:false,epicMode:false,fishMode:false,shopAuto:false,campAuto:false,campaign:false,weaponScanAuto:false},rt:{...rt,char:'AuditHero',lvl:79,prof:'orc_titan',classCur:{prof:'orc_titan',slot:0},magister:null,magPending:{},magEnabled:false,shop:null,tbuff:null,storyJob:null,rbGo:null,rbHunt:null,zoneGo:null,invScan:null,target:null,petBufferTrip:null,manualKickAt:0,kills:0,skills:{},skillDb:{},cdUntil:{},cdUse:{},buffAt:{},weaponMetaPending:null,weaponNow:'Orcish Poleaxe',weapons:[{id:297,name:'Orcish Poleaxe',wt:'древковое',g:'C',where:'надето'}],weaponsT:Date.now(),shopT:Date.now()}})},mode);
 await h.ctx.route('https://l2wap.com/**',async route=>{
 const path=new URL(route.request().url()).pathname;const json=d=>route.fulfill({contentType:'application/json',body:JSON.stringify(d)}).catch(()=>{});
 if(path==='/character')return json({character:character()});
 if(path==='/game/battle')return json({character:character(),battle:battle()});
 if(path==='/game/battle/action'){
  const q=route.request().postDataJSON();acts.push(q.action);
  if(q.action==='battle_trance'){hp=Math.floor(37261*.25);if(mode==='stop'){await h.click('stop');paused=true;}}
  if(q.action==='l2_176'){buffs.push(176);mp-=25;}
  if(q.action==='l2_420'){buffs.push(420);mp-=136;}
  if(q.action==='battle_potion_use')hp=37261;
  if(q.action==='attack')ended=true;
  return json({kind:'full',character:character(),battle:battle(),...(ended?{victory:{spawnId:'fixture',mobName:"Giant's Shadow"}}:{})});
 }
 if(path==='/battle.html')return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">79</div><div id="character-profession">Titan</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">37261</span><span id="l2-hud-hp-max">37261</span><span id="l2-hud-mp-cur">3841</span><span id="l2-hud-mp-max">3841</span><div id="l2-hud-active-buffs"></div><div id="battle-mob-title">Giant's Shadow · ур.79</div><div id="battle-mob-hp-val">3972 / 3972</div>${[['trance','Battle Trance','battle_trance'],['frenzy','Frenzy','l2_176'],['zealot','Zealot','l2_420'],['heal','Battle Roar','l2_121'],['attack','Атака','attack']].map(([id,title,action])=>'<button class="l2-battle-hotbar-slot" title="'+title+'" id="'+id+'"><span data-slot-cd="'+action+'" hidden></span>'+title+'</button>').join('')}<button class="l2-battle-hotbar-slot" title="Велике зілля HP" id="pot"><span class="l2-battle-hotbar-slot-uqty">100</span>HP</button><div id="battle-log"></div><div id="battle-victory-inline" hidden>Победа!</div><script>fetch('/character');fetch('/game/battle');for(const [id,action]of [['trance','battle_trance'],['frenzy','l2_176'],['zealot','l2_420'],['heal','l2_121'],['attack','attack'],['pot','battle_potion_use']])document.getElementById(id).onclick=async()=>{const d=await(await fetch('/game/battle/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,battleSpawnId:'fixture',...(action==='battle_potion_use'?{itemId:920044}:{})})})).json();document.getElementById('l2-hud-hp-cur').textContent=d.character.hp;document.getElementById('l2-hud-mp-cur').textContent=d.character.mp;document.getElementById('l2-hud-active-buffs').innerHTML=d.character.activeBuffs.map(b=>'<span data-skill-id="'+b.skillId+'" data-expires-at="'+b.expiresAt+'">'+b.skillId+'</span>').join('');document.getElementById('battle-log').textContent=d.battle.log.join(' ');if(['battle_trance','l2_176','l2_420'].includes(action))document.getElementById(id).disabled=true;if(d.victory){document.getElementById('battle-mob-hp-val').textContent='0 / 3972';document.getElementById('battle-victory-inline').hidden=false;}};</script>`});
 return route.fallback();
 });
 await h.g.p.goto('https://l2wap.com/battle.html?spawnId=fixture');await until(()=>h.g.core('rt.char==="AuditHero"'));await h.g.p.evaluate(()=>fetch('/game/battle'));await until(()=>h.g.core('BATTLE_NET?.name==="Giant\'s Shadow"'));await h.g.p.bringToFront();await h.click('start');
 if(mode==='stop'){await until(()=>paused,12000);await delay(1600);assert.deepEqual(acts,['battle_trance']);}
 else if(mode==='off'){await until(()=>ended,12000);assert.deepEqual(acts,['attack']);}
 else {await until(()=>acts.includes('battle_potion_use'),12000);assert.deepEqual(acts.slice(0,4),['battle_trance','l2_176','l2_420','battle_potion_use']);await until(()=>h.g.core('meHp().pct>30'));assert.equal(acts.filter(a=>a==='battle_trance').length,1);assert.deepEqual(buffs,[176,420]);}
 await h.click('stop');assert.deepEqual(h.errors,[]);console.log('PASS MV3/main/hook Destroyer limits',mode,acts.join('→'));
 }catch(e){console.error('DIAG',mode,acts,await h.g.core('JSON.stringify({on,tabOwner,status:rt.status,prof:rt.classCur,cfg:{limits:cfg.destroyerLimits,key:cfg.nKeyBuffs,heal:cfg.nHeal},hp:meHp(),panel:panelInventory(),net:BATTLE_NET,errors:rt.errors})').catch(()=>''));throw e;}finally{await h.ctx.close()}
}
(async()=>{for(const mode of ['on','off','stop'])await scenario(mode)})().catch(e=>{console.error(e.stack);process.exitCode=1});
