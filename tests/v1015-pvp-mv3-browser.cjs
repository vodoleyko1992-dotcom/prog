'use strict';
// Actual MV3/main; every HTTPS request is synthetic. No live account or attacks.
const assert=require('node:assert/strict');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const DID='6f573aad-08ee-4713-9d76-33f5fd4afc93',SELF='self-fixture',EV='death-fixture';
async function test(opt={}){
 const h=await harness(),calls=[],paths=[];let held=false,release;const gate=new Promise(r=>release=r);
 const S={revision:10,dead:!opt.target&&!opt.paidAwait,returned:false,restored:false,hp:opt.target||opt.paidAwait?9785:1434,returns:0,attacks:[],paid:0};
 const df=()=>({killerCharacterId:DID,killerName:'Dremia',deathEventId:EV,scope:'world',fullLog:['[Dremia] −16441 HP.']});
 // 15.10: полноценная сумка для startup preflight, неизвестный запас не подменяем нулём.
 // 20.54 (прогон смоуков 23.10): с 20.32/3a4ebba (решение игрока) Старт на котоводе сам включает «Полный баф суммона»
 // (petFullAuto) — при 30 млн адены и пустом наборе кот уводил героя в город раньше обычной охоты на врагов. В сценариях
 // точной цели набор кота уже действует (как у живого героя после покупки), поход не нужен и проверяется только PvP.
 const petFx=()=>opt.target?Array.from({length:26},(_,i)=>({skillId:1200+i,level:2,expiresAtMs:Date.now()+3600000})):[];
 const char=()=>({inventory:{stacks:[],eq:{}},id:SELF,name:'AuditHero',revision:S.revision,level:75,l2Profession:'human_warlock',classSlots:{activeSlot:0},clanId:'our-clan',hp:S.hp,maxHp:9785,mp:1000,maxMp:1000,inBattle:false,adena:'30000000',...(S.dead?{pvpDefeat:df()}:{}),activeSummon:{kind:'servitor',key:'kai_the_cat',summonSkillId:1276,summonSkillLevel:10,hp:1000,maxHp:1000,pAtk:3000,activeBuffs:petFx()}});
 const target=()=>({characterId:DID,name:'Dremia',level:77,clanId:opt.clan?'our-clan':'their-clan',isPartyMember:!!opt.party,pvpAllowed:!opt.denial,pvpBlockedReasonUk:opt.denial?'Зона без PvP':'',battleOnNameClick:true,pvpNickColor:''});
 function html(path){
  const defeat=S.dead?'<section id="map-defeat-root"><div id="map-defeat-shout">Вас вбив гравець [Dremia]!</div><button id="map-defeat-tocity">Повернутися в місто</button></section>':'';
  const rows=['Stranger','Dremia'].map((name,i)=>`<li data-character-id="${i?DID:'stranger-fixture'}"><button class="l2-map-hero-name-link--battle" data-player="${i?DID:'stranger-fixture'}">${name}</button></li>`).join('');
  return `<!doctype html><meta charset="utf-8"><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">75</div><div id="character-profession">Human Warlock</div><div id="l2-nav-bottom"><a data-nav-role="city" href="/city.html">Город</a></div><span id="l2-hud-hp-cur">${S.hp}</span><span id="l2-hud-hp-max">9785</span><span id="l2-hud-mp-cur">1000</span><span id="l2-hud-mp-max">1000</span><div id="map-mob-list"></div>${path==='/map.html'?defeat+'<ul id="map-hero-list">'+rows+'</ul>':''}${path==='/city.html'?'<a class="l2-town-miru-item--buffer-statue" href="/town-buffer.html">Магическая статуя</a>':''}${path==='/town-buffer.html'?'<button id="town-buffer-restore-btn">Восстановить</button><div id="town-buffer-msg"></div>':''}
  <script>localStorage.setItem('token','fixture');
  const ready=(async()=>{while(!window.__l2botHook)await new Promise(r=>setTimeout(r,20));await fetch('/character');if(location.pathname==='/map.html')await fetch('/game/map/sync')})();
  const back=document.getElementById('map-defeat-tocity');if(back)back.onclick=async()=>{await ready;const {character:c}=await(await fetch('/character')).json();const r=await fetch('/game/battle/return-to-town',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:c.revision})});if(r.ok){await r.json();location.href='/city.html'}};
  const restore=document.getElementById('town-buffer-restore-btn');if(restore)restore.onclick=async()=>{const {character:c}=await(await fetch('/character')).json();const r=await fetch('/character/town/restore-vitals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:c.revision})});if(r.ok){const {character:n}=await r.json();document.getElementById('l2-hud-hp-cur').textContent=n.hp;document.getElementById('town-buffer-msg').textContent='Відновлено'}};
  for(const b of document.querySelectorAll('[data-player]'))b.onclick=async()=>{const {character:c}=await(await fetch('/character')).json();await fetch('/game/battle/pvp/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({targetCharacterId:b.dataset.player,expectedRevision:c.revision})})};
  </script>`;
 }
 await h.ctx.route('https://l2wap.com/**',async r=>{
  const p=new URL(r.request().url()).pathname,m=r.request().method();let data;try{data=r.request().postDataJSON()}catch(_){}
  calls.push({p,m,data,dead:S.dead,at:Date.now()});const json=(x,status=200)=>r.fulfill({status,contentType:'application/json',body:JSON.stringify(x)});
  // 20.54 (прогон смоуков 23.10): с 20.27 (#291) Старт сверяет серверные сутки — /game/time и /game/daily-quests отдаёт
  // общий daily-server-fixture харнесса; прежний ответ {} оставлял фарм в ожидании сверки и героя в городе.
  if(p==='/game/time'||p==='/game/daily-quests')return r.fallback();
  if(p.endsWith('.html')){paths.push(p);return r.fulfill({contentType:'text/html; charset=utf-8',body:html(p)})}
  if(p==='/character')return json({character:char()});
  if(p==='/game/map/sync')return json({character:char(),...(S.dead?{pvpDefeat:df()}:{}),around:{nearbyHeroes:opt.target?[{...target(),characterId:'stranger-fixture',name:'Stranger'},target()]:[]}});
  if(p==='/game/map/around')return json({nearbyHeroes:opt.target?[{...target(),characterId:'stranger-fixture',name:'Stranger'},target()]:[]});
  if(p==='/game/battle/return-to-town'){
   S.returns++;assert.deepEqual(data,{expectedRevision:S.revision});if(opt.stopBefore&&!held){held=true;await gate}
   if(opt.fail)return json({error:'not_available'},409);
   S.returned=true;S.dead=false;S.hp=2000;S.revision++;
   if(opt.receipt&&!held){held=true;await gate}
   return json({character:char()}).catch(()=>{});
  }
  if(p==='/character/town/restore-vitals'){assert.equal(S.returned,true,'restore before confirmed native return is forbidden');assert.deepEqual(data,{expectedRevision:S.revision});S.hp=9785;S.restored=true;S.revision++;return json({character:char()})}
  if(p==='/game/battle/pvp/start'){S.attacks.push(data.targetCharacterId);assert.equal(S.dead,false);assert.equal(!!(opt.party||opt.clan||opt.denial),false);assert.deepEqual(data,{targetCharacterId:DID,expectedRevision:S.revision});return json({error:'fixture_stop_after_exact_native_click'},409)}
  if(p==='/character/town/buffer/catalog'){
   if(opt.paidAwait&&!held){held=true;await gate}
   return json({sets:[{id:'summon',feeAdena:'10000000',feeCoinOfLuck:0,skills:Array.from({length:26},(_,i)=>({skillId:1200+i,level:2,durationSec:18000}))}]});
  }
  if(m==='POST'){S.paid++;return json({error:'unexpected_mutation'},400)}
  return json({});
 });
 try{
  await h.sw.evaluate(async({target,paidAwait,soft,DID})=>{
   const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:false,cfg:{...cfg,taskOnly:(!!target&&!soft)||!!paidAwait,rbMode:!target&&!paidAwait,rbHuntMode:!target&&!paidAwait,rbBetween:false,epicMode:false,fishMode:false,catMode:false,campaign:false,campAuto:false,pvpOnSight:true,autoRevive:true,enemyHunt:!!soft,enemyFlagOnly:false,enemyMinHits:0,enemyMaxLoss:99,enemyLvlAbove:99,petFullAuto:!!paidAwait,petFullBudget:10000000,petFullMaxPrice:10000000,petFullReserve:0,autoMagister:false,enchant:{enabled:false},townBuffSet:'off',faBuffs:'',shopAuto:false,autoRoles:false,petAuto:false,autoShots:false,reactMin:0,reactMax:0},rt:{...rt,char:'AuditHero',lvl:75,classCur:{prof:'human_warlock',slot:0},manualKickAt:0,pvpRecovery:null,pvpResolved:[],pvpAttempt:null,pvpTargets:target?{[DID]:{id:DID,name:'Dremia',enabled:true}}:{},enemies:{[DID]:{id:DID,name:'Dremia',kills:2,hitMax:soft?1:16441,streak:soft?0:4,blockLvl:soft?0:75,skipT:soft?0:Date.now()+3600000}},petFull:{},petBufferTrip:null,revive:null,tbuff:null,rbGo:null,rbHunt:null,magister:null,invScan:null,fishSvc:null,fishService:null,dailyFish:null,dailyRb:null,mmJob:null,tsJob:null,storyJob:null,shop:null,zoneGo:null,target:null,rbCur:null,zone:'silent_valley',weaponsT:Date.now(),shopT:Date.now()}});
  },{target:!!opt.target,paidAwait:!!opt.paidAwait,soft:!!(opt.party||opt.clan||opt.denial),DID});
  await h.g.p.goto('https://l2wap.com/map.html');await until(()=>h.g.core('!!L2V7Modules.pvp'));if(opt.party||opt.clan||opt.denial)await h.g.core('(()=>{const step=L2V7Modules.enemies.step;globalThis.__pvpOrdinaryCalls=0;L2V7Modules.enemies.step=async(...args)=>{globalThis.__pvpOrdinaryCalls++;return step(...args)};return true})()');await h.popup.reload();await h.g.p.bringToFront();const started=Date.now();await h.click('start');
  if(opt.target){
   if(opt.party||opt.clan||opt.denial){await until(()=>h.g.core('on && tabOwner && autonomyMode()==="farm" && cfg.enemyHunt'));await until(()=>h.g.core('globalThis.__pvpOrdinaryCalls>0 && L2V7Modules.pvp._state.heroes.some(h=>h.name==="Dremia")'));await delay(1000);assert.deepEqual(S.attacks,[])}else await until(()=>S.attacks.length===1);
   await h.click('stop');assert.deepEqual(S.attacks,opt.party||opt.clan||opt.denial?[]:[DID]);assert.equal(S.paid,0);console.log('PASS PvP MV3 exact target',JSON.stringify(opt));
  }else if(opt.fail){
   await until(()=>S.returns===1,10000);await delay(700);await h.click('stop');assert.equal(S.returned,false);assert.equal(S.restored,false);assert.equal(S.paid,0);await until(()=>h.g.core('L2V7Modules.pvp.pending()'));console.log('PASS PvP MV3 native return409 keeps recovery barrier, no paid service');
  }else{
   if(opt.paidAwait){await until(()=>held);S.dead=true;S.hp=1434;await h.g.p.evaluate(()=>fetch('/game/map/sync'));await until(()=>h.g.core('L2V7Modules.pvp.pending()'));release();await delay(400);assert.equal(S.paid,0);await h.g.p.reload();}
   if(opt.stopBefore||opt.receipt){await until(()=>held,10000);await h.click('stop');await until(()=>h.g.core('!on'));release();await until(()=>new URL(h.g.p.url()).pathname==='/city.html');await delay(200);assert.equal(S.paid,0);assert.equal(S.restored,false);await h.g.p.reload();await until(()=>h.g.core('!!L2V7Modules.pvp && !on'));await h.g.p.bringToFront();await h.click('start');}
   await until(()=>S.restored,15000);await until(async()=>!(await h.get(['rt'])).rt.revive&&!(await h.get(['rt'])).rt.tbuff&&paths.slice(paths.lastIndexOf('/town-buffer.html')+1).includes('/map.html'),15000);await h.click('stop');
   assert.equal(S.returns,1);assert.equal(S.paid,0);await until(()=>h.g.core('!L2V7Modules.pvp.pending()'));assert.equal((await h.get(['rt'])).rt.restoreRes.ok,true);
   if(!opt.receipt&&!opt.stopBefore&&!opt.paidAwait)assert.ok(calls.find(x=>x.p==='/game/battle/return-to-town').at-started<10000,'must not repeat historical147-second dispatcher loop');
   console.log('PASS PvP MV3 defeat→native return→statue→restore',JSON.stringify(opt),JSON.stringify({returns:S.returns,paid:S.paid,paths}));
  }
  assert.deepEqual(h.errors,[]);
 }catch(e){console.error('DIAG',JSON.stringify({opt,S,paths,calls:calls.slice(-20)}));console.error('CORE',await h.g.core('JSON.stringify({on,tabOwner,running,status:rt.status,pending:L2V7Modules.pvp.pending(),pvp:rt.pvpRecovery,revive:rt.revive,tbuff:rt.tbuff,mode:autonomyMode()})').catch(String));throw e}
 finally{release();await h.ctx.close()}
}
(async()=>{for(const opt of(process.env.PVP_MV3_CASES?JSON.parse(process.env.PVP_MV3_CASES):[{},{fail:true},{stopBefore:true},{receipt:true},{target:true},{target:true,party:true},{target:true,clan:true},{target:true,denial:true},{paidAwait:true}]))await test(opt)})().catch(e=>{console.error(e.stack);process.exitCode=1});
