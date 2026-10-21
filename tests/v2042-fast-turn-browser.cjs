'use strict';
// 20.42 (быстрый удар, решение John 20.10): замер на модели игры. Страница боя ведёт себя как battle-action-dispatch игры: пока ход
// «в полёте» (ответ сервера и, при delta.hotbarStale, её GET /character), новый клик теряется. Сервер: ход 0,4 с, GET /character 0,35 с.
// Сравниваем интервал удар→удар при cfg.fastTurn ВЫКЛ и ВКЛ. Настоящий MV3, HTTPS целиком локальный, живой игры нет.
const assert=require('node:assert/strict');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const HITS=+(process.env.HITS||30),ACT_MS=400,CHAR_MS=350,HP=13000,DMG=1300;
async function scenario(FAST){
 const h=await harness(),routeErrors=[],acts=[],chars=[],did='necropolis_of_martyrdom',sid=n=>'sdms_'+did+'_'+String(n).padStart(3,'0');
 const names=['Lilim Knight Banneret','Nephilim Praetorian'];
 const mobs=Array.from({length:40},(_,i)=>({id:sid(13+i*7),name:names[i%2],level:72,hp:HP,dead:false}));
 let cur=mobs[0],counter=100,revision=100,seq=1;
 const won=()=>cur.dead;
 const char=()=>({id:'writes-hero',name:'AuditHero',revision,level:71,l2Profession:'dwarf_bounty_hunter',classBranch:'fighter',classSlots:{activeSlot:1,slots:[{slot:0,profession:'human_arcana_lord',active:false,owned:true,level:78},{slot:1,profession:'dwarf_bounty_hunter',active:true,owned:true,level:71}]},adena:30000000,mobsKilled:counter,inBattle:!won(),hp:16549,maxHp:21188,mp:1600,maxMp:1883,locationType:'dungeon',activeDungeonId:did,inventory:{eq:{l1:{itemId:97,enchant:0}},stacks:[]},activeBuffs:[],activeSummon:null});
 const logs=()=>['Бій розпочато: ['+cur.name+'] (ур.'+cur.level+').',...(won()?['Перемога!','EXP + 1000','SP + 100','+100 аден']:[])];
 const full=()=>({kind:'full',ok:true,revision,character:char(),battle:{spawnId:cur.id,mobName:cur.name,mobHp:cur.hp,mobMaxHp:HP,mobLevel:cur.level,kind:'passive',log:logs(),logSeq:logs().length},serverNowMs:Date.now(),globalCooldownUntilMs:Date.now()+60,...(won()?{victory:{spawnId:cur.id,mobName:cur.name,fullLog:logs()}}:{})});
 const delta=()=>({kind:'delta',ok:true,revision,serverNowMs:Date.now(),globalCooldownUntilMs:Date.now()+60,delta:{hotbarStale:true,mobHp:cur.hp,mobMaxHp:HP,characterHp:16549,characterMaxHp:21188,characterMp:1600,characterMaxMp:1883,logTail:['Ти завдав ['+cur.name+'] '+DMG+' урону.'],logSeq:++seq,serverNowMs:Date.now()}});
 const base='<div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">71</div><div id="character-profession">Bounty Hunter</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">16549</span><span id="l2-hud-hp-max">21188</span><span id="l2-hud-mp-cur">1600</span><span id="l2-hud-mp-max">1883</span>';
 const doc='<!doctype html><meta charset="utf-8"><title>Бой — L2WAP</title>'+base+`<div id="battle-mob-title"></div><div id="battle-mob-hp-val"></div><div id="battle-mob-effects-row"></div><button class="l2-battle-hotbar-slot" title="Атака" id="attack"><span data-slot-cd="attack" hidden></span></button><div id="battle-log"></div><div id="battle-victory-inline" hidden>Победа!</div><div id="battle-victory-lootline"></div><button id="battle-victory-hunt" hidden>Охотиться дальше</button><script>
 const $=id=>document.getElementById(id),sp=()=>new URLSearchParams(location.search).get('spawnId'),post=(u,b)=>fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json());
 let B=null,inFlight=false;
 function render(d){if(d.battle)B=d.battle;else if(d.delta&&B){B={...B,mobHp:d.delta.mobHp,log:[...B.log,...d.delta.logTail]};}const b=B,v=!!d.victory;$('battle-mob-title').textContent=b.mobName+' · ур.'+b.mobLevel;$('battle-log').innerHTML=b.log.slice(-30).map(s=>'<div class="l2-battle-log-line">'+s+'</div>').join('');$('battle-mob-hp-val').textContent=b.mobHp+' / '+b.mobMaxHp;$('battle-victory-inline').hidden=!v;$('battle-victory-hunt').hidden=!v;$('battle-victory-lootline').textContent=v?'+100 аден, +1000 EXP, +100 SP':'';}
 (async()=>{while(!window.__l2botHook)await new Promise(r=>setTimeout(r,10));await fetch('/character');render(await post('/game/battle/start',{spawnId:sp()}));
  // как battle-action-dispatch/battle-action-result игры: замок на весь ход, при hotbarStale — свой GET /character под замком
  $('attack').onclick=async()=>{if(inFlight)return;inFlight=true;try{const d=await post('/game/battle/action',{action:'attack',battleSpawnId:sp(),expectedRevision:0});render(d);if(d.kind==='delta'&&d.delta.hotbarStale)await fetch('/character');}finally{inFlight=false;}};
  $('battle-victory-hunt').onclick=async()=>{const d=await post('/game/battle/hunt-continue',{excludeSpawnId:sp(),targetLevel:72,expectedRevision:0});history.replaceState({},'','/battle.html?spawnId='+d.battle.spawnId);render(d);};})();</script>`;
 try{
  await h.ctx.route('https://l2wap.com/**',async r=>{try{const q=r.request(),u=new URL(q.url()),p=u.pathname;
   if(p==='/battle.html')return r.fulfill({contentType:'text/html',body:doc});
   if(p.endsWith('.html'))return r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8">'+base+'<div id="map-mob-list"></div>'});
   if(p==='/character'){chars.push(Date.now());await delay(CHAR_MS);return r.fulfill({json:{character:char()}});}
   if(p==='/game/battle')return r.fulfill({json:full()});
   if(p==='/game/battle/start'){const m=mobs.find(x=>x.id===q.postDataJSON().spawnId&&!x.dead);if(m)cur=m;return r.fulfill({json:full()});}
   if(p==='/game/dungeon/view')return r.fulfill({json:{dungeon:{id:did,mobs:mobs.filter(x=>!x.dead).map(x=>({id:x.id,name:x.name,level:x.level,kind:'passive',inBattleRange:true}))}}});
   if(p==='/game/battle/action'){acts.push({at:Date.now(),spawn:cur.id});await delay(ACT_MS);revision++;if(!cur.dead){cur.hp=Math.max(0,cur.hp-DMG);if(!cur.hp){cur.dead=true;counter++;}}return r.fulfill({json:cur.dead?full():delta()});}
   if(p==='/game/battle/hunt-continue'){await delay(150);revision++;cur=mobs.find(x=>!x.dead);return r.fulfill({json:full()});}
   assert.equal(q.method(),'GET','неожиданный POST '+p);return r.fallback();
  }catch(e){routeErrors.push(e.message);return r.fulfill({status:500,json:{error:'fixture_assertion'}}).catch(()=>{})}});
  await h.sw.evaluate(async({did,FAST})=>{const{cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:['cat'],taskOnly:false,catMode:true,catDungeon:'auto',chain:true,lvlBelow:9,lvlAbove:5,rbHuntMode:false,rbMode:false,fishMode:false,epicMode:false,autoRoles:false,weaponScanAuto:false,weaponClassEquip:false,petFullAuto:false,petAuto:false,petBuffAuto:false,shopAuto:false,autoMagister:false,tvtOn:false,enemyHunt:false,pvpOnSight:false,townBuffSet:'off',vipBuffAuto:false,faBuffs:'',nBuffs:'',nKeyBuffs:'',nPower:'',nUltra:'',nStun:'',nDebuff:'',nDrain:'',nCharge:'',nToggles:'',nAttack:'Атака',fightMode:'dps',combatProfile:'fighter',searchChamp:false,searchQuest:false,potSlotAuto:false,autoShots:false,zoneAuto:false,catKillLimit:0,dailyCatKillLimit:0,dailyAuto:false,fastTurn:FAST,reactMin:0,reactMax:0,rec:false,autoSnap:false},rt:{...rt,char:'AuditHero',lvl:71,prof:'dwarf_bounty_hunter',classCur:{prof:'dwarf_bounty_hunter',slot:1,t:1},classBranch:'fighter',manualKickAt:0,catCur:did,catIn:did,catInT:Date.now(),catLv:{[did]:{lo:62,hi:75,n:5,t:Date.now()}},invScan:null,shop:null,magister:null,tbuff:null,rbGo:null,rbHunt:null,zoneGo:null,storyJob:null,mmJob:null,tsJob:null,petBufferTrip:null,petRaidPrep:null,fishSvc:null,fishService:null,dailyFish:null,dailyRb:null,actionOwner:null,revive:null,weaponsT:Date.now(),shopT:Date.now(),target:{name:'Lilim Knight Banneret',rb:false,champ:false},buffCancel:{},farmQuota:{},dailyQuota:null,farmKillMark:null,kills:0,exp:0,sp:0,adena:0,skills:{'атака':{dmg:1300,dmgN:3,uses:3}},clickLockA:60,clickLockB:30,hpMin:{'lilim knight banneret':3636,'nephilim praetorian':3636}}});
  },{did,FAST});
  await h.g.p.goto('https://l2wap.com/battle.html?spawnId='+mobs[0].id);await until(()=>h.g.core('rt.char==="AuditHero"'),20000);await h.g.p.evaluate(()=>fetch('/game/battle'));await until(()=>h.g.core('BATTLE_NET?.name==="Lilim Knight Banneret"'),20000);
  await h.popup.reload();await h.g.p.bringToFront();
  await h.click('start');await until(()=>acts.length>=HITS,120000);
  await h.click('stop');await until(async()=>!(await h.get(['on'])).on);
  // интервал удар→удар внутри одного моба (без перехода к следующему), первые 3 удара — разгон
  const gaps=[];for(let i=4;i<acts.length;i++)if(acts[i].spawn===acts[i-1].spawn)gaps.push(acts[i].at-acts[i-1].at);
  gaps.sort((a,b)=>a-b);const med=gaps[gaps.length>>1],avg=Math.round(gaps.reduce((a,b)=>a+b,0)/gaps.length);
  const t0=acts[3].at,t1=acts[acts.length-1].at,charsIn=chars.filter(t=>t>=t0&&t<=t1).length;
  const fastN=+(await h.g.p.evaluate(()=>document.documentElement.dataset.l2botFastN||0));
  const report={fastTurn:FAST,hits:acts.length,gaps:gaps.length,medianMs:med,avgMs:avg,characterGets:charsIn,spanS:+((t1-t0)/1000).toFixed(1),fastN};
  console.log('MEASURE fast turn',JSON.stringify(report));
  assert.deepEqual(routeErrors,[]);assert.deepEqual(h.errors,[]);
  if(FAST){assert.ok(fastN>0,'быстрый удар сработал');assert.ok(charsIn>=Math.floor((t1-t0)/5000)-1,'персонаж обновляется не реже раза в 5 с');}
  else assert.equal(fastN,0,'выключатель ВЫКЛ — ответы игры не меняются');
  return report;
 }finally{await h.ctx.close();}
}
(async()=>{const off=await scenario(false),on=await scenario(true);
 console.log('PASS fast turn: удар→удар '+off.medianMs+' → '+on.medianMs+' мс (медиана)');
 assert.ok(on.medianMs<off.medianMs-200,'быстрый удар заметно короче');})().catch(e=>{console.error('FAIL',e.stack);process.exitCode=1});
