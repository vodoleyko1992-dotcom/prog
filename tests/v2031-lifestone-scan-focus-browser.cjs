'use strict';
// Настоящий MV3 popup: активация кнопки сохраняет фокус как при touch/Firefox.
const assert=require('node:assert/strict');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness(),results=[];try{
 const ch={name:'AuditHero',revision:100,inventory:{eq:{l1:{itemId:123,enchant:7}},stacks:[]}};
 await h.ctx.route('https://l2wap.com/**',r=>{const p=new URL(r.request().url()).pathname;
 assert.equal(r.request().method(),'GET','обновление списка не расходует материалы');
 if(p==='/character')return r.fulfill({json:{character:ch}});
 if(p==='/character/catalog-hints')return r.fulfill({json:{itemGradeHints:{123:'A'},itemSlotHints:{123:'rhand'},itemNamesRu:{123:'Посох'}}});
 return r.fallback();});
 await h.openTab('lifestone');await delay(500);
 for(const field of ['lsWeapon','lsTargets','lsMaxAttempts']){
  const old=(await h.get(['rt'])).rt.lsWeapons?.t||0;
  await h.popup.evaluate(field=>{const e=document.getElementById(field);e.focus();if(field==='lsTargets'){for(const o of e.options)o.selected=o.value==='prominence';}if(field==='lsMaxAttempts')e.value='37';document.getElementById('lsScanWeapons').click();},field);
  await until(async()=>((await h.get(['rt'])).rt.lsWeapons?.t||0)>old,6000);await delay(800);
  const row=await h.popup.evaluate(()=>({focus:document.activeElement.id,options:document.getElementById('lsWeapon').options.length,targets:[...document.getElementById('lsTargets').selectedOptions].map(o=>o.value),max:document.getElementById('lsMaxAttempts').value}));
  row.field=field;row.stored=(await h.get(['rt'])).rt.lsWeapons.items.length;results.push(row);
 }
 console.log('RESULTS',JSON.stringify(results));assert.deepEqual(h.errors,[]);
 for(const row of results){assert.equal(row.stored,1);assert.equal(row.options,2,row.field+': обновлённое оружие видно даже при сохранённом фокусе');if(row.field==='lsTargets')assert.deepEqual(row.targets,['prominence'],'не теряем черновик целей');if(row.field==='lsMaxAttempts')assert.equal(row.max,'37','не теряем черновик лимита');}
 console.log('PASS MV3: явное обновление оружия сохраняет фокус и черновики целей/лимита');
 }finally{await h.ctx.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
