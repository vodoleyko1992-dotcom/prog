'use strict';
// 20.41 (лог 20.10 21:09: память героя 1,3 МБ, «бот стал очень медленный»): каждая запись rt — полный get+set памяти в фоне
// (0,4–1,3 с) и рассылка старого+нового значения всем страницам. Настоящий MV3, HTTPS целиком локальный, живой игры нет.
// Считаем statePatch вкладки на одного обычного моба цепочки катакомб: «Охотиться дальше» в том же документе (native) и
// переход на страницу боя выбранной цели (spread). Цель: в установившемся режиме у native обычных записей вкладки нет — только итог
// квоты фона (начало и победа, их не откладываем) и один отложенный пакет статистики раз в 8 с. У spread остаются только записи,
// которые читает следующая страница: цель/mobClickAt перед переходом (с ней уходит отложенная статистика), сброс счётчика петли
// bounce/mobClickAt на новой странице и память боя fightMem (у каждой страницы своя первая сводка).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const MOBS=+(process.env.MOBS||8),WARM=2;
const content=fs.readFileSync(path.join(__dirname,'..','content.js'),'utf8');
// Ключи, которые вкладка пишет только отложенно: RT_STAT_SOON ядра + записи через setRtSoon (замеры навыков, запасы клика, причина
// ожидания боя, минутная копия статуса). Обычная запись допустима лишь ради ключей, которые читает следующая страница (NEED).
const DEFER=new Set([...content.match(/const RT_STAT_SOON = new Set\(\[([\s\S]*?)\]\)/)[1].matchAll(/'([^']+)'/g)].map(m=>m[1]).concat(['skills','clickLockA','clickLockB','combatWait','fightGroups','status']));
const NEED=new Set(['mobClickAt','bounce','fightMem','fightLast']),LIMIT={native:0,spread:3};
async function scenario(kind){
 const h=await harness(),routeErrors=[],winAt=[],did='necropolis_of_martyrdom',sid=n=>'sdms_'+did+'_'+String(n).padStart(3,'0');
 const names=['Lilim Knight Banneret','Nephilim Praetorian'],lv=i=>kind==='native'||i%3!==2?72:64;
 const mobs=Array.from({length:MOBS*2+6},(_,i)=>({id:sid(13+i*7),name:names[i%2],level:lv(i),hp:3636,dead:false}));
 let cur=mobs[0],counter=100,revision=100;
 const won=()=>cur.dead;
 const char=()=>({id:'writes-hero',name:'AuditHero',revision,level:71,l2Profession:'dwarf_bounty_hunter',classBranch:'fighter',classSlots:{activeSlot:1,slots:[{slot:0,profession:'human_arcana_lord',active:false,owned:true,level:78},{slot:1,profession:'dwarf_bounty_hunter',active:true,owned:true,level:71}]},adena:30000000,mobsKilled:counter,inBattle:!won(),hp:16549,maxHp:21188,mp:1600,maxMp:1883,locationType:'dungeon',activeDungeonId:did,inventory:{eq:{l1:{itemId:97,enchant:0}},stacks:[]},activeBuffs:[],activeSummon:null});
 const logs=()=>['Бій розпочато: ['+cur.name+'] (ур.'+cur.level+').',...(won()?['Перемога!','EXP + 1000','SP + 100','+100 аден']:[])];
 const result=()=>({kind:'full',ok:true,revision,character:char(),battle:{spawnId:cur.id,mobName:cur.name,mobHp:cur.hp,mobMaxHp:3636,mobLevel:cur.level,kind:'passive',log:logs(),logSeq:logs().length},serverNowMs:Date.now(),globalCooldownUntilMs:Date.now()+60,...(won()?{victory:{spawnId:cur.id,mobName:cur.name,fullLog:logs()}}:{})});
 const base='<div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">71</div><div id="character-profession">Bounty Hunter</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">16549</span><span id="l2-hud-hp-max">21188</span><span id="l2-hud-mp-cur">1600</span><span id="l2-hud-mp-max">1883</span>';
 // Страница боя как в игре: всё рисуется по ответам сервера; «Охотиться дальше» — POST hunt-continue и новый бой в том же документе
 const doc='<!doctype html><meta charset="utf-8"><title>Бой — L2WAP</title>'+base+`<div id="battle-mob-title"></div><div id="battle-mob-hp-val"></div><div id="battle-mob-effects-row"></div><button class="l2-battle-hotbar-slot" title="Атака" id="attack"><span data-slot-cd="attack" hidden></span></button><div id="battle-log"></div><div id="battle-victory-inline" hidden>Победа!</div><div id="battle-victory-lootline"></div><button id="battle-victory-hunt" hidden>Охотиться дальше</button><script>
 const $=id=>document.getElementById(id),sp=()=>new URLSearchParams(location.search).get('spawnId'),post=(u,b)=>fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json());
 function render(d){const b=d.battle,v=!!d.victory;$('battle-mob-title').textContent=b.mobName+' · ур.'+b.mobLevel;$('battle-log').innerHTML=b.log.map(s=>'<div class="l2-battle-log-line">'+s+'</div>').join('');$('battle-mob-hp-val').textContent=b.mobHp+' / 3636';$('battle-victory-inline').hidden=!v;$('battle-victory-hunt').hidden=!v;$('battle-victory-lootline').textContent=v?'+100 аден, +1000 EXP, +100 SP':'';}
 (async()=>{while(!window.__l2botHook)await new Promise(r=>setTimeout(r,10));render(await post('/game/battle/start',{spawnId:sp()}));
  $('attack').onclick=async()=>{render(await post('/game/battle/action',{action:'attack',battleSpawnId:sp(),expectedRevision:0}));await fetch('/character?afterTurn=1');};
  $('battle-victory-hunt').onclick=async()=>{const d=await post('/game/battle/hunt-continue',{excludeSpawnId:sp(),targetLevel:72,expectedRevision:0});history.replaceState({},'','/battle.html?spawnId='+d.battle.spawnId);render(d);};})();</script>`;
 try{
  await h.ctx.route('https://l2wap.com/**',async r=>{try{const q=r.request(),u=new URL(q.url()),p=u.pathname;
   if(p==='/battle.html')return r.fulfill({contentType:'text/html',body:doc});
   if(p.endsWith('.html'))return r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8">'+base+'<div id="map-mob-list"></div>'});
   if(p==='/character')return r.fulfill({json:{character:char()}});
   if(p==='/game/battle')return r.fulfill({json:result()});
   if(p==='/game/battle/start'){const m=mobs.find(x=>x.id===q.postDataJSON().spawnId&&!x.dead);if(m)cur=m;return r.fulfill({json:result()});}
   if(p==='/game/dungeon/view')return r.fulfill({json:{dungeon:{id:did,mobs:mobs.filter(x=>!x.dead).map(x=>({id:x.id,name:x.name,level:x.level,kind:'passive',inBattleRange:true}))}}});
   if(p==='/game/battle/action'){await delay(40);revision++;if(!cur.dead){cur.hp=Math.max(0,cur.hp-1300);if(!cur.hp){cur.dead=true;counter++;winAt.push(Date.now());}}return r.fulfill({json:result()});}
   if(p==='/game/battle/hunt-continue'){await delay(150);revision++;cur=mobs.find(x=>!x.dead&&x.level===72);return r.fulfill({json:result()});}
   assert.equal(q.method(),'GET','неожиданный POST '+p);return r.fallback();
  }catch(e){routeErrors.push(e.message);return r.fulfill({status:500,json:{error:'fixture_assertion'}}).catch(()=>{})}});
  await h.sw.evaluate(async({did})=>{const{cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:['cat'],taskOnly:false,catMode:true,catDungeon:'auto',chain:true,lvlBelow:9,lvlAbove:5,rbHuntMode:false,rbMode:false,fishMode:false,epicMode:false,autoRoles:false,weaponScanAuto:false,weaponClassEquip:false,petFullAuto:false,petAuto:false,petBuffAuto:false,shopAuto:false,autoMagister:false,tvtOn:false,enemyHunt:false,pvpOnSight:false,townBuffSet:'off',vipBuffAuto:false,faBuffs:'',nBuffs:'',nKeyBuffs:'',nPower:'',nUltra:'',nStun:'',nDebuff:'',nDrain:'',nCharge:'',nToggles:'',nAttack:'Атака',fightMode:'dps',combatProfile:'fighter',searchChamp:false,searchQuest:false,potSlotAuto:false,autoShots:false,zoneAuto:false,catKillLimit:0,dailyCatKillLimit:0,dailyAuto:false,reactMin:0,reactMax:0,rec:false,autoSnap:false},rt:{...rt,char:'AuditHero',lvl:71,prof:'dwarf_bounty_hunter',classCur:{prof:'dwarf_bounty_hunter',slot:1,t:1},classBranch:'fighter',manualKickAt:0,catCur:did,catIn:did,catInT:Date.now(),catLv:{[did]:{lo:62,hi:75,n:5,t:Date.now()}},invScan:null,shop:null,magister:null,tbuff:null,rbGo:null,rbHunt:null,zoneGo:null,storyJob:null,mmJob:null,tsJob:null,petBufferTrip:null,petRaidPrep:null,fishSvc:null,fishService:null,dailyFish:null,dailyRb:null,actionOwner:null,revive:null,weaponsT:Date.now(),shopT:Date.now(),target:{name:'Lilim Knight Banneret',rb:false,champ:false},buffCancel:{},farmQuota:{},dailyQuota:null,farmKillMark:null,kills:0,exp:0,sp:0,adena:0,skills:{'атака':{dmg:1300,dmgN:3,uses:3}},clickLockA:60,clickLockB:30,hpMin:{'lilim knight banneret':3636,'nephilim praetorian':3636},syntheticStoragePadding:'x'.repeat(1300*1024)}});
   // Отдельный слушатель фона: каждое сообщение statePatch (это и есть полный get+set памяти в фоне); ответы не трогает.
   // 20.41 (ревью 2): очередь вкладки шлёт и menuRev (метку последней записи меню) — это не служебная операция фона
   globalThis.__writes=[];chrome.runtime.onMessage.addListener(m=>{if(m?.cmd==='statePatch')__writes.push({at:Date.now(),keys:Object.keys(m.patch||{}),svc:Object.keys(m).filter(k=>!['cmd','patch','src','epoch','expectedChar','menuRev'].includes(k)).map(k=>k+(m[k]?.op?':'+m[k].op:''))});});
  },{did});
  await h.g.p.goto('https://l2wap.com/battle.html?spawnId='+mobs[0].id);await until(()=>h.g.core('rt.char==="AuditHero"'),20000);await h.g.p.evaluate(()=>fetch('/game/battle'));await until(()=>h.g.core('BATTLE_NET?.name==="Lilim Knight Banneret"'),20000);
  await h.popup.reload();await h.g.p.bringToFront();
  await h.click('start');await until(()=>winAt.length>=MOBS,120000);
  await h.click('stop');await until(async()=>!(await h.get(['on'])).on);
  const n=winAt.length;await until(async()=>{const{rt}=await h.get(['rt']);return rt.dailyQuota?.cat===n&&rt.farmQuota?.cat?.got===n},20000);
  const rows=await h.sw.evaluate(()=>__writes),saved=(await h.get(['rt'])).rt;
  const kindOf=x=>x.svc.length?'quota':!x.keys.length?'empty':x.keys.every(k=>DEFER.has(k))?'deferred':'regular';
  // Установившийся режим: после WARM первых побед (первый документ, первое имя вида — hpMin, разовые сведения о герое) и до последней
  const a=winAt[WARM-1],b=winAt[MOBS-1],steady=MOBS-WARM,win=rows.filter(x=>x.at>a&&x.at<=b),count=k=>win.filter(x=>kindOf(x)===k).length;
  const regular=win.filter(x=>kindOf(x)==='regular'),quotaOps=win.filter(x=>kindOf(x)==='quota').map(x=>x.svc.join('+'));
  const report={kind,mobs:MOBS,steadyMobs:steady,steadyMs:b-a,statePatch:win.length,perMob:+(win.length/steady).toFixed(2),regular:regular.length,regularPerMob:+(regular.length/steady).toFixed(2),regularKeys:regular.map(x=>x.keys.join(',')),quota:quotaOps.length,deferred:count('deferred'),deferredKeys:win.filter(x=>kindOf(x)==='deferred').map(x=>Math.round(x.at-a)+':'+x.keys.join(',')),empty:count('empty'),saved:{kills:saved.kills,daily:saved.dailyQuota?.cat,task:saved.farmQuota?.cat?.got}};
  console.log('MEASURE actual MV3 battle writes',JSON.stringify(report));
  // Итог квоты фона — на каждого моба (начало и победа): лимит и дневной счёт не откладываются
  assert.equal(quotaOps.filter(x=>x==='farmQuota:win').length,steady,'итог квоты — на каждого моба');
  // Новое поле сообщения очереди не должно молча превращать записи вкладки в «квоту» (так счёт обычных записей становился пустым)
  assert.deepEqual(quotaOps.filter(x=>!/^farmQuota:\w+$/.test(x)),[],'служебные записи фона — только итог квоты');
  assert.deepEqual(regular.filter(x=>!x.keys.some(k=>NEED.has(k))).map(x=>x.keys.join(',')),[],'обычная запись вкладки — только ради ключей следующей страницы');
  // native: допуск — одна сводка памяти боя (раз в 30 с); spread: переход, сброс петли и память боя новой страницы
  assert.ok(regular.length<=LIMIT[kind]*steady+1,'обычных записей вкладки на моба не больше '+LIMIT[kind]+': '+JSON.stringify(report.regularKeys));
  // Отложенная статистика: пакет раз в 8 с; при переходе на другую страницу — один досыл при уходе (pagehide), без второй такой же
  // записи из visibilitychange (Chrome шлёт его сразу после pagehide)
  assert.ok(count('deferred')<=(kind==='spread'?steady:Math.ceil((b-a)/8000))+1,'отложенная статистика — пакет раз в 8 с или один досыл на переход');
  const twins=win.filter((x,i)=>i&&!x.svc.length&&x.at-win[i-1].at<50&&x.keys.join()===win[i-1].keys.join());
  assert.deepEqual(twins.map(x=>x.keys.join(',')),[],'одна и та же очередь не уходит дважды при уходе со страницы');
  assert.equal(saved.kills,n);assert.equal(saved.dailyQuota.cat,n);assert.equal(saved.farmQuota.cat.got,n);assert.equal(saved.syntheticStoragePadding.length,1300*1024);
  assert.deepEqual(routeErrors,[]);assert.deepEqual(h.errors,[]);
  console.log('PASS actual MV3 '+kind+': '+report.regularPerMob+' обычных записей вкладки на моба, квота фона '+(quotaOps.length/steady).toFixed(1)+' на моба');
 }catch(e){console.error('DIAG',kind,JSON.stringify({error:e.message,wins:winAt.length,cur:cur.id,url:h.g.p.url(),routeErrors,core:await h.g.core('({on,running,tabOwner,status:rt.status,recent:RECENT.slice(0,8)})').catch(String)}));throw e;}
 finally{await h.ctx.close();}
}
(async()=>{for(const k of (process.env.WRITE_CASES||'native,spread').split(','))await scenario(k)})().catch(e=>{console.error('FAIL',e.stack);process.exitCode=1});
