'use strict';
// Реальные MV3/storage/dispatcher/gamePost и native FA-кнопка; все HTTPS ответы локальные.
const assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const {harness,until,delay}=require(root+'/tests/v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness({withPopup:false}),posts=[];let revision=100,buffs=[];try{
 const skills=[{skillId:1068,level:3,durationSec:86400},{skillId:1045,level:5,durationSec:86400}];
 const character=()=>({name:'AuditHero',id:'vip-no-fa-fixture',revision,level:68,hp:1000,maxHp:1000,mp:1000,maxMp:1000,adena:10000000,inBattle:false,inventory:{stacks:[],eq:{}},classBranch:'fighter',race:'Dwarf',l2Profession:'dwarf_bounty_hunter',classSlots:{activeSlot:1,slots:[{slot:1,profession:'dwarf_bounty_hunter',race:'Dwarf',level:68,owned:true,active:true}]},vip:{active:true,vipUntil:new Date(Date.now()+86400000).toISOString()},activeBuffs:buffs});
 const html=p=>`<!doctype html><html><head><meta charset="utf-8"><title>VIP fixture</title></head><body><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-nav-bottom"></div><div id="l2-hud-active-buffs">${buffs.map(b=>`<span class="l2-hud-active-buff" data-skill-id="${b.skillId}" data-expires-at="${b.expiresAtMs}" title="Buff · Lv.${b.level}"></span>`).join('')}</div>${p==='/fast-aden-buffer.html'?'<div id="fast-aden-balance">100</div><button class="l2-fa-buy" data-skill-id="1414" data-set-id="greater" data-cost="5">Купить FA</button>':'<div id="map-mob-list"></div>'}<script>const buy=document.querySelector('.l2-fa-buy');if(buy)buy.onclick=()=>fetch('/character/town/fast-aden-buffer/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({set:'greater',skillId:1414,expectedCostFastAden:5,expectedRevision:${revision}})});</script></body></html>`;
 await h.ctx.route('https://l2wap.com/**',async r=>{
  const p=new URL(r.request().url()).pathname;
  if(p.endsWith('.html'))return r.fulfill({contentType:'text/html',body:html(p)});
  if(p==='/character')return r.fulfill({json:{character:character()}});
  if(p==='/character/town/buffer/catalog')return r.fulfill({json:{sets:[{id:'warrior',feeAdena:'0',feeCoinOfLuck:0,skills}]}});
  if(r.request().method()==='POST'){
   const q=r.request().postDataJSON();posts.push({path:p,body:q});
   if(p!=='/character/town/buffer')return r.fulfill({status:400,json:{error:'unexpected_paid_action'}});
   assert.equal(q.set,'warrior');assert.equal(q.expectedFeeAdena,'0');assert.equal(q.expectedFeeCoinOfLuck,0);assert.equal(q.expectedRevision,revision);
   revision++;buffs=skills.map(s=>({...s,expiresAtMs:Date.now()+86400000}));return r.fulfill({json:{character:character()}});
  }
  return r.fallback();
 });
 await h.g.p.goto('about:blank');
 await h.sw.evaluate(async()=>{const{cfg,rt}=await chrome.storage.local.get(['cfg','rt']),now=Date.now();await chrome.storage.local.set({on:true,cfg:{...cfg,autoTasks:['raid'],taskOnly:false,townBuff:true,townBuffSet:'basic',vipBuffAuto:true,rbFaFull:true,rbSessBuffs:'1414,1323',faBuffs:'1414,1323',rbSessNob:true,reactMin:0,reactMax:0},rt:{...rt,char:'AuditHero',classCur:{slot:1,prof:'dwarf_bounty_hunter'},manualKickAt:now,actionOwner:null,actionPayments:{pending:null,history:[]},rbSess:{on:true,start:now},tbuff:{t:now,step:'fa',fa:[1414,1323]},tbT:now-1200000}})});
 await h.g.p.goto('https://l2wap.com/fast-aden-buffer.html');
 await until(()=>posts.some(x=>x.path==='/character/town/buffer'),25000);
 await until(async()=>{const{rt}=await h.get(['rt']);return rt.rbSess?.vip&&rt.rbSess.bought&&rt.tbOk&&!rt.tbuff},25000);
 await delay(500);
 let state=await h.get(['cfg','rt']);
 assert.equal(posts.filter(x=>x.path==='/character/town/buffer').length,1);
 assert.equal(posts.filter(x=>x.path==='/character/town/fast-aden-buffer/apply').length,0);
 assert.ok(posts.every(x=>x.path==='/character/town/buffer'));
 assert.equal(state.rt.rbSess.on,true);assert.deepEqual(state.rt.vipApplied.ids,[1068,1045]);assert.equal(state.rt.actionPayments.pending,null);
 assert.equal(state.cfg.faBuffs,'1414,1323');assert.equal(state.cfg.rbFaFull,true);
 console.log('PASS actual MV3: saved FA route + rbSess/rbFaFull → free warrior0/0, one POST, session ready by VIP effects, zero native FA POST');
 await until(()=>h.g.core('on&&tabOwner&&L2V7Modules.actions.canAct()'));
 await h.sw.evaluate(async()=>{const{cfg}=await chrome.storage.local.get('cfg');await chrome.storage.local.set({cfg:{...cfg,vipBuffAuto:false,townBuffSet:'off'}})});
 await until(()=>h.g.core('cfg.vipBuffAuto===false&&cfg.townBuffSet==="off"'));
 await h.g.core('(async()=>{await setRt({tbuff:{t:Date.now(),step:"fa",fa:[1414]},actionOwner:null});await rtCommit();return true})()');
 await h.g.p.goto('https://l2wap.com/fast-aden-buffer.html');
 // 20.76+ (ревизия 28.10): набор VIP выключен — сохранённая очередь FA больше не ждёт весь срок VIP (раньше держала главный цикл),
 // а снимается без покупки; FA при VIP по-прежнему не тратятся, лишних POST нет.
 await until(async()=>{const{rt}=await h.get(['rt']);return rt.tbuff===null},15000);await delay(700);
 state=await h.get(['cfg','rt']);assert.equal(posts.length,1);assert.equal(state.rt.tbuff,null);assert.equal(state.rt.actionPayments.pending,null);assert.equal(state.cfg.vipBuffAuto,false);assert.equal(state.cfg.townBuffSet,'off');assert.equal(state.cfg.faBuffs,'1414,1323');assert.deepEqual(h.errors,[]);
 console.log('PASS actual MV3: free auto OFF while VIP remains active → saved FA queue dropped without purchase, zero native FA/extra free POST, settings preserved, 0 pageerrors');
 await h.g.core('automationStop("Конец локальной проверки VIP", "stop", {user:true})');
 }catch(e){console.error('DIAG',JSON.stringify({posts,revision,core:await h.g.core('({on,running,tabOwner,status:rt.status,tbuff:rt.tbuff,session:rt.rbSess,vip:rt.vipBuff,applied:rt.vipApplied,owner:rt.actionOwner})').catch(()=>null)}));throw e}finally{await h.ctx.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
