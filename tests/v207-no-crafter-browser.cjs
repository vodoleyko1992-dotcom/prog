'use strict';
const assert=require('node:assert/strict');
const {harness,until}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness();try{
 const errors=[];h.popup.on('pageerror',e=>errors.push(e.message));
 await h.sw.evaluate(async()=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:false,cfg:{...cfg,mmGoalItem:920018,mmGoalLvl:1,mmCraftSend:true,mmCrafter:'Skye'},rt:{...rt,mmGoalPlan:{id:920018,n:'Пояс',lvl:0,to:1,a:1,c:1,unk:[],lv:[{L:0,a:1,c:1,m:[['Steel',3]]}],tot:[['Steel',3,0,3]],raw:[['Iron Ore',15,5,10,0],['Varnish',15,0,15,0]],cr:[['Steel',3,3,'Iron Ore 5 + Varnish 5']],snd:[['Iron Ore',5]],cm:25},mmCraft:{to:'Skye',at:{1869:5},t:Date.now()},mmMail:{t:Date.now(),unc:[]}}})});
 await h.popup.reload();await h.openTab('mammon');await h.popup.evaluate(async()=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);renderMammon(rt,cfg)});
 await until(async()=>(await h.popup.locator('#mmPlanBox').innerText()).includes('Varnish'));
 const text=await h.popup.locator('#mmPlanBox').innerText();assert.match(text,/Iron Ore/);assert.match(text,/Varnish/);assert.match(text,/15/);assert.match(text,/Нужно изготовить/);assert.doesNotMatch(text,/Передать крафтеру/);
 assert.equal(await h.popup.locator('#mmCraftGo,#mmCraftSend,#mmCrafter,#mmCraftNote,#mmCraftScope').count(),0);assert.equal(await h.popup.locator('#mmMailClaim').count(),1);assert.match(await h.popup.locator('#mmCraftBox').innerText(),/Skye/);assert.equal((await h.get(['on'])).on,false);assert.deepEqual(errors,[]);
 console.log('PASS actual MV3: materials/quantities/crafting list retained; no crafter controls; old ledger and mail preserved; no JS errors');
}finally{await h.ctx.close()}})().catch(e=>{console.error(e);process.exitCode=1});
