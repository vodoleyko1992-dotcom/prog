'use strict';
// 20.65 (John 25.10: «что ещё можем сделать для облегчения нагрузки … без потери качества»): настоящий MV3 — фон, вкладка игры и меню.
// Большая память героя (базовый профиль + кэш спавнов): итог боя пишет только маленький ключ hot; вкладка, меню и перезагрузка
// страницы видят тот же итог; Пауза с висящим hot — остановка, следом запись rt+hot, память вкладки не пересобирается; сброс цели из меню — полная запись rt, hot очищен. Ответы игры локальные (как v208-farm-kill-quota).
const assert=require('node:assert/strict');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const core=require('../engine-core.js'),L2HOT_MIN=core.HOT_MIN_RT,L2J=s=>core.hotJoin(s.rt,s.hot);
async function scenario(task){
 const h=await harness();let counter=100,won=false;const acts=[];
 const character=()=>({name:'AuditHero',level:49,l2Profession:'dwarf_bounty_hunter',revision:100+acts.length,mobsKilled:counter,hp:7000,maxHp:7000,mp:500,maxMp:900,inBattle:!won});
 try{
 await h.sw.evaluate(async task=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:task==='cat'?['cat','auto']:['auto','dailies'],autoKillLimit:task==='auto'?3:0,catKillLimit:task==='cat'?3:0,taskOnly:false,zoneAuto:true,catMode:task==='cat',catDungeon:'catacomb_of_the_branded',warlordAggro:false,autoMagister:false,autoRoles:false,combatProfile:'fighter',nAttack:'Атака',nPower:'',nUltra:'',nStun:'',nBuffs:'',nKeyBuffs:'',nDebuff:'',nDrain:'',nCharge:'',nToggles:'',petAuto:false,petBuffAuto:false,debuffAuto:false,autoShots:false,potSlotAuto:false,townBuffSet:'off',faBuffs:'',tvtOn:false,enemyHunt:false,fishMode:false,rbMode:false,rbHuntMode:false,epicMode:false,shopAuto:false,campAuto:false,campaign:false,weaponScanAuto:false,mmOrders:false,mmUpgrade:false,mmMailClaim:false,dailyAuto:false,clanTasks:false,chain:false},rt:{...rt,spawns:Object.fromEntries(Array.from({length:900},(_,i)=>['l2dop_mob_'+i,{n:'Моб '+i,l:40+i%30,z:'Зона '+i%17}])),char:'AuditHero',lvl:49,prof:'dwarf_bounty_hunter',classCur:{prof:'dwarf_bounty_hunter',slot:1},farmQuota:{},magister:null,magPending:{},magEnabled:false,shop:null,tbuff:null,storyJob:null,rbGo:null,rbHunt:null,zoneGo:null,invScan:null,target:null,petBufferTrip:null,manualKickAt:0,kills:0,skills:{},skillDb:{},cdUntil:{},cdUse:{},weaponsT:Date.now(),shopT:Date.now()}})},task);
 await h.ctx.route('https://l2wap.com/**',async route=>{const p=new URL(route.request().url()).pathname;const json=x=>route.fulfill({json:x}).catch(()=>{});
 if(p==='/character')return json({character:character()});
 if(p==='/game/battle')return json({character:character(),battle:{spawnId:'fixture',mobName:'Garden Guard',mobHp:won?0:1000,mobMaxHp:1000,mobLevel:49,kind:'normal',log:[]}});
 if(p==='/game/battle/action'){acts.push(route.request().postDataJSON().action);counter+=3;won=true;return json({character:character(),victory:{spawnId:'fixture'}})}
 if(p==='/battle.html')return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">49</div><div id="character-profession">Bounty Hunter</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">7000</span><span id="l2-hud-hp-max">7000</span><span id="l2-hud-mp-cur">500</span><span id="l2-hud-mp-max">900</span><div id="battle-mob-title">Garden Guard · ур.49</div><div id="battle-mob-hp-val">1000 / 1000</div><button class="l2-battle-hotbar-slot" title="Атака" id="attack"><span data-slot-cd="attack" hidden></span></button><div id="battle-log"></div><div id="battle-victory-inline" hidden>Победа!</div><script>fetch('/character');fetch('/game/battle');document.getElementById('attack').onclick=async()=>{await fetch('/game/battle/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'attack'})});document.getElementById('battle-mob-hp-val').textContent='0 / 1000';document.getElementById('battle-victory-inline').hidden=false;};</script>`});
 return json({});
 });
 const rtSize=await h.sw.evaluate(async()=>JSON.stringify((await chrome.storage.local.get('rt')).rt).length);assert.ok(rtSize>L2HOT_MIN,'большой rt: '+rtSize);
 await h.sw.evaluate(()=>{globalThis.__keys=[];chrome.storage.onChanged.addListener(ch=>{const k=Object.keys(ch).filter(k=>k==='rt'||k==='hot').sort().join('+');if(k)globalThis.__keys.push(k)})});
 await h.g.p.goto('https://l2wap.com/battle.html?spawnId=fixture');await until(()=>h.g.core('rt.char==="AuditHero"'));await h.g.p.evaluate(()=>fetch('/game/battle'));await h.g.p.bringToFront();await h.click('start');
 await until(async()=>((await h.get(['rt'])).rt.farmQuota?.[task]?.done),20000);
 const state=await h.get(['rt','cfg','on']);
 // итог боя и начало — только hot; сам rt хранилища за это время мог переписать лишь отложенный пакет статистики вкладки
 const keys=await h.sw.evaluate(()=>globalThis.__keys);assert.ok(keys.includes('hot'),'записи только hot: '+keys.join(' '));
 const raw=await h.sw.evaluate(()=>chrome.storage.local.get(['rt','hot']));
 assert.equal(L2J(raw).farmQuota.auto.got,3,'rt + hot');
 // вкладка игры и меню видят тот же итог
 assert.equal(await h.g.core('rt.farmQuota?.auto?.got'),3,'вкладка');
 await h.openTab('overview');await until(async()=>(await h.popup.evaluate(()=>document.querySelector('#status .chip b')?.textContent))===String(state.rt.kills),8000);
 // перезагрузка страницы игры читает rt вместе с hot
 await h.g.p.reload();await until(()=>h.g.core('typeof on !== "undefined" && rt.char==="AuditHero"'),30000);assert.equal(await h.g.core('rt.farmQuota?.auto?.got'),3,'после перезагрузки');
assert.equal(state.on,true);assert.equal(state.rt.farmQuota[task].got,3);assert.ok(!state.cfg.autoTasks.includes(task));assert.ok(state.cfg.autoTasks.includes(task==='cat'?'auto':'dailies'));assert.deepEqual(acts,['attack']);await h.click('stop');
 await until(async()=>(await h.get(['on'])).on===false);await delay(1500);
 { const r=await h.sw.evaluate(()=>chrome.storage.local.get(['rt','hot']));assert.equal(r.hot??null,null,'после Стопа hot нет');assert.equal(r.rt.farmQuota.auto.got,3,'после Стопа итог в самом rt'); }
 // Пауза с висящим hot (вкладка стоит — между записью hot и Паузой никто не пишет): остановка, следом запись rt+hot, удалённое поле удалено,
 // значение только в памяти вкладки (откат атаки) не пересобирается
 const hang=(v,src)=>h.sw.evaluate(async([v,src])=>{const s=await chrome.storage.local.get('rt');const f={...v};for(const k of Object.keys(f))if(f[k]==='__del')f[k]=undefined;await chrome.storage.local.set({hot:L2EngineCore.hotNext(s.rt,null,f,src,Date.now())});},[v,src]);
 await h.sw.evaluate(async()=>{const s=await chrome.storage.local.get('rt');await chrome.storage.local.set({rt:{...s.rt,fishService:'cut',_src:'probe-full'},hot:null});});
 await until(()=>h.g.core('rt.fishService==="cut"'));
 await hang({fishCastPending:{at:1,bait:'basic'},fishService:'__del'},'probe');
 await until(()=>h.g.core('rt.fishCastPending?.bait==="basic" && (rt.fishService ?? null)===null'));
 await h.g.core('(rt={...rt,cdUntil:{...(rt.cdUntil||{}),"атака":4242}},1)');
 await h.sw.evaluate(()=>{globalThis.__onKeys=[];chrome.storage.onChanged.addListener(ch=>globalThis.__onKeys.push(Object.keys(ch).sort().join('+')))});   // on уже false — Chrome его в событии не шлёт
 assert.equal((await h.sw.evaluate(()=>botControl({action:'pause'},{url:chrome.runtime.getURL('popup.html')}))).ok,true);
 assert.deepEqual(await h.sw.evaluate(()=>globalThis.__onKeys),['paused+stopMeta','hot+rt'],'Пауза: остановка прежней записью, свёртка hot — следом');
 { const r=await h.sw.evaluate(()=>chrome.storage.local.get(['rt','hot']));assert.equal(r.hot,null);assert.equal(r.rt.fishCastPending.bait,'basic');assert.ok(!('fishService' in r.rt),'удалённое поле');assert.equal(r.rt._src,'hot-fold');assert.equal(r.rt.farmQuota.auto.got,3); }
 await delay(300);assert.equal(await h.g.core('rt.cdUntil?.["атака"]'),4242,'память вкладки не пересобрана');assert.equal(await h.g.core('rt.fishCastPending?.bait'),'basic');
 // сброс цели из меню при висящем hot — полная запись: hot сложен и очищен той же записью
 await hang({fishCastPending:{at:2,bait:'good'}},'probe2');await until(()=>h.g.core('rt.fishCastPending?.bait==="good"'));
 await h.reveal('#'+task+'KillLimit');   // 20.12 (ревизия 17.10): разовые цели — в «Дополнительно» «Обзора»
 await h.popup.locator('#'+task+'KillLimit').fill('12');await h.popup.locator('#'+task+'KillLimit').dispatchEvent('change');await until(async()=>((await h.get(['cfg'])).cfg[task+'KillLimit'])===12);await h.click(task+'KillReset');assert.equal((await h.get(['rt'])).rt.farmQuota[task].got,0);
 { const r=await h.sw.evaluate(()=>chrome.storage.local.get(['rt','hot']));assert.equal(L2J(r).farmQuota.auto.got,0);assert.equal(r.rt.farmQuota.auto.got,0,'сброс меню — полная запись rt, не hot');assert.equal(r.hot,null,'hot очищен');assert.equal(r.rt.fishCastPending.bait,'good','висящий hot сложен в rt'); }
 assert.deepEqual(h.errors,[]);console.log('PASS MV3 hot: большой rt ('+rtSize+' символов), итог боя — только hot; вкладка/меню/перезагрузка видят итог; Пауза складывает hot; сброс из меню — полная запись rt');
 }catch(e){console.error('DIAG',task,acts,await h.get(['rt','cfg','on']));throw e}finally{await h.ctx.close()}
}
(async()=>{await scenario('auto')})().catch(e=>{console.error(e.stack);process.exitCode=1});
