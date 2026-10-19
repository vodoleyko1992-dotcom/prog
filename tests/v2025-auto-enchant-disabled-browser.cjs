'use strict';
const assert=require('node:assert/strict');const{harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness();try{
 const posts=[];h.ctx.on('request',r=>{if(r.method()==='POST')posts.push(new URL(r.url()).pathname)});
 await h.popup.reload();await until(()=>h.popup.evaluate(()=>!!document.querySelector('#start')?.onclick));
 assert.equal(await h.popup.evaluate(()=>searchIndex().some(r=>r.tab==='enchant')),false);
 assert.equal(await h.popup.locator('nav [data-tab="enchant"]').isVisible(),false);assert.equal(await h.popup.locator('[data-auto-task="enchant"]').isVisible(),false);
 await h.popup.evaluate(()=>{showTab('enchant')});assert.equal(await h.popup.locator('#tab-enchant').isVisible(),false);assert.equal(await h.popup.locator('#tab-overview').isVisible(),true);
 await h.sw.evaluate(async()=>{const{cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:true,cfg:{...cfg,autoTasks:['enchant'],enchantMode:true,enchant:{enabled:true,queue:[{key:'old'}]}},rt:{...rt,enchant:{char:'AuditHero',status:'running',pending:null,items:[],totals:{},history:[]}}})});
 await until(()=>h.g.core('on&&running&&tabOwner&&autonomyMode()==="tasks"'));
 assert.equal(await h.g.core('cfg.enchantMode'),false);assert.deepEqual(await h.g.core('cfg.autoTasks'),[]);
 for(const action of ['start','resume','refresh']){const r=await h.g.core(`enchantCommand({action:${JSON.stringify(action)},char:'AuditHero'})`);assert.equal(r.ok,false)}
 await delay(1800);assert.equal((await h.get(['rt'])).rt.enchant.status,'paused');assert.ok((await h.get(['rt'])).rt.enchant);
 await h.sw.evaluate(async()=>{const{cfg}=await chrome.storage.local.get('cfg');await chrome.storage.local.set({cfg:{...cfg,autoTasks:null,enchantMode:true,taskOnly:false}})});
 await until(()=>h.g.core('on&&running&&tabOwner&&cfg.taskOnly===true&&autonomyMode()==="tasks"'));
 assert.deepEqual(posts,[]);assert.deepEqual(h.errors,[]);
 console.log('PASS actual MV3: автозаточка скрыта; старые список/legacy/running → ожидание+пауза; start/resume/refresh отклонены; 0POST/0ошибок');
 }finally{await h.ctx.close()}})().catch(e=>{console.error(e);process.exitCode=1});
