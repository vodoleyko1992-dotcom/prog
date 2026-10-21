'use strict';
// Настоящие MV3/main/dispatcher/gamePost; все ответы локальные, аккаунт не открывается.
const assert=require('node:assert/strict');
const {harness,until}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness();const posts=[];let vip=true,revision=20,buffs=[];try{
 const skills=[{skillId:1068,level:3,durationSec:86400},{skillId:1045,level:5,durationSec:86400}],greater=[1356,1357,1355,1363,1413,1414,1323].map(skillId=>({skillId,level:1,durationSec:86400}));
 const ch=()=>({name:'AuditHero',id:'vip-fixture',revision,level:68,hp:1000,maxHp:1000,mp:1000,maxMp:1000,inBattle:false,inventory:{stacks:[],eq:{}},classBranch:'fighter',race:'Dwarf',l2Profession:'dwarf_bounty_hunter',classSlots:{activeSlot:1,slots:[{slot:1,profession:'dwarf_bounty_hunter',race:'Dwarf',level:68,owned:true,active:true}]},vip:{active:vip,vipUntil:new Date(Date.now()+(vip?86400000:-1000)).toISOString()},activeBuffs:buffs});
 await h.ctx.route('https://l2wap.com/character',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({character:ch()})}));
 await h.ctx.route('https://l2wap.com/character/town/buffer/catalog',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({sets:[{id:'warrior',feeAdena:'0',feeCoinOfLuck:vip?0:15,skills},{id:'greater',pickByIcon:true,feeAdena:'0',feeCoinOfLuck:vip?0:5,skills:greater}]})}));
 await h.ctx.route('https://l2wap.com/character/town/buffer',r=>{const q=r.request().postDataJSON();posts.push(q);assert.ok(['warrior','greater'].includes(q.set));assert.equal(q.expectedFeeCoinOfLuck,0);assert.equal(q.expectedFeeAdena,'0');assert.equal(q.expectedRevision,revision);
  // Реальный Greater применяется выбранной иконкой; общий set без skillId отвергается.
  if(q.set==='greater'&&(!Number.isSafeInteger(q.skillId)||!greater.some(s=>s.skillId===q.skillId)))return r.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'skill_required'})});
  revision++;const row=q.set==='warrior'?skills:greater.filter(s=>s.skillId===q.skillId),group=[1356,1357,1355,1363,1413,1414];
  buffs=[...buffs.filter(b=>!row.some(s=>s.skillId===b.skillId||group.includes(s.skillId)&&group.includes(b.skillId))),...row.map(s=>({...s,expiresAtMs:Date.now()+86400000}))];return r.fulfill({contentType:'application/json',body:JSON.stringify({character:ch()})})});
 await h.sw.evaluate(async()=>{const{cfg}=await chrome.storage.local.get('cfg');await chrome.storage.local.set({on:true,cfg:{...cfg,autoTasks:['farm'],taskOnly:false,townBuffSet:'basic',vipBuffAuto:true,faBuffs:''}})});
 await until(()=>h.g.core('on&&running&&tabOwner&&L2V7Modules.actions.canAct()'));
 await h.g.core(`(async()=>{await setRt({char:'AuditHero',classCur:{slot:1,prof:'dwarf_bounty_hunter'},tbuff:{t:Date.now(),step:'town',set:'warrior',vipFree:true,fa:[]}});await rtCommit();return true})()`);
 await until(()=>posts.length===3,20000);await until(async()=>{const{rt}=await h.get(['rt']);return rt.tbOk&&rt.tbuff===null},20000);
 assert.equal(posts.length,3);assert.equal((await h.get(['rt'])).rt.actionPayments?.pending??null,null);
 const events=await h.get(['rt']);assert.deepEqual(posts.map(q=>[q.set,q.skillId]),[['warrior',undefined],['greater',1414],['greater',1323]]);assert.deepEqual(events.rt.tbSetIds.warrior,[1068,1045]);assert.equal(events.rt.vipApplied.schema,2);assert.equal(events.rt.vipApplied.bundleChecked,true);assert.deepEqual(events.rt.vipApplied.greaterIds,[1414,1323]);assert.deepEqual(buffs.filter(x=>[1356,1357,1355,1363,1413,1414].includes(x.skillId)).map(x=>x.skillId),[1414]);
 vip=false;buffs=[];
 await until(()=>h.g.p.url().includes('/map.html'));
 await until(()=>h.g.core('on&&running&&tabOwner&&L2V7Modules.actions.canAct()'));
 await h.g.core(`(async()=>{await setRt({tbuff:{t:Date.now(),step:'town',set:'warrior',vipFree:true,fa:[]}});await rtCommit();return true})()`);
 await h.g.p.goto('https://l2wap.com/town-buffer.html');
 await until(async()=>{const{rt}=await h.get(['rt']);return rt.vipBuff?.active===false},20000);assert.equal(posts.length,3);
 const c=await h.get(['cfg']);assert.equal(c.cfg.townBuffSet,'basic');assert.equal(c.cfg.vipBuffAuto,true);
 assert.deepEqual(h.errors,[]);
 console.log('PASS actual MV3: бесплатные VIP warrior → Greater1414 → Noblesse1323, три точных POST0/0 → подтверждённые отдельные эффекты → возврат; окончаниеVIP без нового POST/CoL');
}catch(e){console.error('DIAG',await h.g.core('({on,running,tabOwner,status:rt.status,tbuff:rt.tbuff,owner:rt.actionOwner,kick:rt.manualKickAt,mode:autonomyMode()})').catch(String),h.requests.slice(-12));throw e}finally{await h.ctx.close()}})().catch(e=>{console.error(e);process.exitCode=1});
