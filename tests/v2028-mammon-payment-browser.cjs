'use strict';
// Настоящий MV3, dispatcher, storage и native click/fetch; все HTTPS ответы локальные, аккаунт не используется.
// Для исходной 20.28: node этот-файл /путь/к/20.28 --baseline (подтверждает отсутствие POST до исправления).
const assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..')),baseline=process.argv.includes('--baseline');
const {harness,until,delay}=require(root+'/tests/v1014-core-lifecycle-browser.cjs');
const NAME='Татуювання озера',ITEM=910624,TARGET='eq:tattoo';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}};
const base='<div id="l2-hud-legacy-name">AuditHero</div><div id="l2-nav-bottom"></div>';

async function scenario(manual=false){
 const h=await harness({withPopup:false}),release=deferred();let revision=81200,level=4,near=manual,held=false;
 const posts=[],modes=[],requests=[];
 const character=()=>({name:'AuditHero',id:'mammon-local-fixture',level:75,l2Profession:'human_warlock',revision,hp:16000,maxHp:16000,mp:6000,maxMp:6000,adena:10000000,worldX:0,worldY:0,inventory:{stacks:[{itemId:4037,qty:100}],eq:{}}});
 const item=()=>({itemId:ITEM,targetInstanceId:TARGET,nameUk:NAME,level,locationLabelUk:'Одягнено',canAfford:true,max:level===5,cost:{adena:3000000,adenaOwned:10000000,coinOfLuck:5,coinOfLuckOwned:100,materials:[]}});
 const html=(body,script='')=>'<!doctype html><html><head><meta charset="utf-8"><title>Локальный Маммон</title></head><body>'+base+body+'<script>'+script+'</script></body></html>';
 const teleport=()=>html('<div id="mammon-loc-cost">Безкоштовно</div><button id="mammon-loc-teleport-btn">Телепорт до Коваля Маммона</button><div id="mammon-loc-err"></div>',`document.querySelector('button').onclick=async function(){if(this.disabled)return;this.disabled=true;const r=await fetch('/game/mammon/teleport',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'blacksmith',expectedRevision:${revision},expectedAdenaCost:0})});const d=await r.json();if(r.ok)location.href='/mammon-blacksmith.html';else this.disabled=false;};`);
 const smith=()=>html(`<div id="mammon-blacksmith-upgrade-list"><div class="l2-mammon-upgrade-card"><div class="l2-mammon-upgrade-card__name">${NAME}</div><div class="l2-mammon-upgrade-card__level">Lv.${level}</div><div class="l2-mammon-upgrade-card__meta">Одягнено</div><button class="l2-mammon-upgrade-card__btn">Покращити до Lv.${level+1}</button></div></div><div id="mammon-blacksmith-upgrade-msg"></div>`,`document.querySelector('button').onclick=async function(){if(this.disabled)return;this.disabled=true;const r=await fetch('/game/mammon/blacksmith/upgrade',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:${revision},targetInstanceId:${JSON.stringify(TARGET)},expectedLevel:${level}})});const d=await r.json();if(r.ok){document.querySelector('.l2-mammon-upgrade-card__level').textContent='Lv.'+d.upgraded.newLevel;document.querySelector('#mammon-blacksmith-upgrade-msg').textContent='Покращено';}this.disabled=false;};`);
 try{
  await h.ctx.route('https://l2wap.com/**',async r=>{
   const p=new URL(r.request().url()).pathname,method=r.request().method();requests.push({path:p,method});
   if(p==='/mammon-blacksmith-loc.html')return r.fulfill({contentType:'text/html',body:teleport()});
   if(p==='/mammon-blacksmith.html')return r.fulfill({contentType:'text/html',body:smith()});
   if(p==='/fishing.html')return r.fulfill({contentType:'text/html',body:html('<div>Рыбалка после маршрута</div>')});
   if(p==='/character')return r.fulfill({json:{character:character()}});
   if(p==='/game/mammon/blacksmith/upgrades')return r.fulfill(near?{json:{items:[item()]}}:{status:403,json:{error:'mammon_blacksmith_not_nearby'}});
   if(method==='POST'){
    const body=r.request().postDataJSON();posts.push({path:p,body});
    if(p==='/game/player-interaction')return r.fulfill({json:{ok:true}});
    if(!['/game/mammon/teleport','/game/mammon/blacksmith/upgrade'].includes(p))return r.fulfill({status:400,json:{error:'unexpected_post'}});
    modes.push(await h.g.core('({mode:autonomyMode(),pending:L2V7Modules.payments.pending()?.kind||null,job:!!rt.mmJob})').catch(()=>null));
    assert.equal(body.expectedRevision,revision);
    if(p.endsWith('/teleport')){assert.equal(body.expectedAdenaCost,0);near=true;revision++;return r.fulfill({json:{character:character()}})}
    assert.equal(body.targetInstanceId,TARGET);assert.equal(body.expectedLevel,4);
    if(manual){held=true;await release.promise}else await delay(350);
    level=5;revision++;return r.fulfill({json:{character:character(),upgraded:{newLevel:5}}});
   }
   return r.fallback();
  });
  await h.g.p.goto('about:blank');
  await h.sw.evaluate(async({manual,ITEM})=>{
   const{cfg,rt}=await chrome.storage.local.get(['cfg','rt']),now=Date.now();
   await chrome.storage.local.set({on:!manual,cfg:{...cfg,autoTasks:['mammon','raid','fish'],mmGoalItem:ITEM,mmGoalLvl:5,mmUpgrade:true,mmOrders:false,mmMailClaim:false,mmSmithAuto:false,mmShopBuy:false,mmTpMax:500000,fishAutoSetup:false,fishTimeAuto:false,fishAutoBuy:false,fishRodBuy:false,fishProcess:false,fishShots:false,shopAuto:false,dailyKillLimit:0,dailyFishLimit:0,reactMin:0,reactMax:0,rec:true,netLog:true},rt:{...rt,char:'AuditHero',manualKickAt:now,actionOwner:null,actionPayments:{pending:null,history:[]},mmJob:{kind:'smith',step:manual?'act':'go',t:now,id:'up:'+ITEM+':4',up:true,cmd:true,home:null,why:'локальная проверка Lv.4 → 5'},rbHunt:{phase:'wait',step:'pick',id:null},rbFishWait:{at:now,until:now+300000},mmUpFail:null,mmLog:[],fishCastActive:false,fishCastPending:null}});
  },{manual,ITEM});
  await h.g.p.goto('https://l2wap.com/'+(manual?'mammon-blacksmith.html':'mammon-blacksmith-loc.html'));
  await until(()=>h.g.core('typeof L2V7Modules.mammon==="object"'));
  if(manual){
   await h.g.p.click('.l2-mammon-upgrade-card__btn');await until(()=>held);
   await h.sw.evaluate(()=>chrome.storage.local.set({on:true}));
   await until(()=>h.g.core('on&&tabOwner&&/жду завершения действия игры/.test(rt.status||"")'),15000);
   await delay(700);
   assert.equal(h.g.p.url(),'https://l2wap.com/mammon-blacksmith.html');
   const during=await h.g.core('({job:!!rt.mmJob,fail:rt.mmUpFail,log:rt.mmLog,mode:autonomyMode(),pending:L2V7Modules.payments.pending()})');
   assert.equal(during.job,true);assert.equal(during.fail,null);assert.equal(during.log.length,0);assert.equal(during.mode,'fish');assert.equal(during.pending,null);
   assert.equal(posts.filter(x=>x.path.endsWith('/upgrade')).length,1);
   release.resolve();
  }else if(baseline){
   await until(()=>h.g.core('/исход оплаты неизвестен/.test(rt.status||"")'),15000);await delay(750);
   assert.equal(posts.filter(x=>x.path.startsWith('/game/mammon/')).length,0);
   assert.equal(await h.g.core('autonomyMode()'),'fish');assert.equal(await h.g.core('L2V7Modules.payments.pending()'),null);
   console.log('PASS baseline actual MV3: Mammon prepare cancels before native POST; misleading unknown-payment status; mode returns to fish');return;
  }
  await until(async()=>{const{rt}=await h.get(['rt']);return !rt.mmJob&&rt.mmLog?.some(x=>x.ok)},25000);
  await delay(500);
  const mammonPosts=posts.filter(x=>x.path.startsWith('/game/mammon/'));
  assert.deepEqual(mammonPosts.map(x=>x.path),manual?['/game/mammon/blacksmith/upgrade']:['/game/mammon/teleport','/game/mammon/blacksmith/upgrade']);
  if(!manual)assert.ok(modes.every(x=>x?.mode==='fish'&&x.pending==='mammon'&&x.job));
  const final=(await h.get(['rt'])).rt;assert.equal(level,5);assert.equal(final.mmUpFail,null);assert.equal(final.mmLog.filter(x=>!x.ok).length,0);assert.equal(final.actionPayments?.pending,null);
  assert.deepEqual(h.errors,[]);assert.ok(posts.every(x=>x.path.startsWith('/game/mammon/')||x.path==='/game/player-interaction'));
  console.log('PASS actual MV3 '+(manual?'manual native POST holds disabled card: no duplicate/failure/navigation; Lv.5 reconciled':'raid wait + fish mode → one free native teleport + one Lv.4→5 upgrade; mode stable during both payments'),JSON.stringify({mammonPosts,modes,level,errors:h.errors.length}));
 }catch(e){console.error('DIAG',JSON.stringify({manual,baseline,revision,level,near,posts,modes,requests:requests.slice(-20),core:await h.g.core('({on,running,tabOwner,mode:autonomyMode(),status:rt.status,owner:rt.actionOwner,job:rt.mmJob,pending:L2V7Modules.payments.pending(),log:rt.mmLog})').catch(()=>null)}));throw e}
 finally{release.resolve();await h.ctx.close()}
}
(async()=>{await scenario();if(!baseline)await scenario(true)})().catch(e=>{console.error(e.stack);process.exitCode=1});
