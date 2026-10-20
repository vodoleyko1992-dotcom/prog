'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness(),results=[],api=[];try{
 const hints=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../kb/raw/catalog-hints.json'),'utf8')).data;
 const ch={name:'AuditHero',revision:100,inventory:{eq:{l1:{itemId:9002284,enchant:25,instanceId:'audit-clan-caster'}},stacks:[{itemId:97,enchant:8,qty:1,instanceId:'audit-spear'},{itemId:8688,enchant:10,qty:1,instanceId:'audit-daemon'},{itemId:175,enchant:5,qty:1,instanceId:'audit-axe'}]}};
 await h.ctx.route('https://l2wap.com/**',r=>{const p=new URL(r.request().url()).pathname;
 if(p==='/character'||p==='/character/catalog-hints'){
   api.push({method:r.request().method(),path:p});assert.equal(r.request().method(),'GET');
   return r.fulfill({json:p==='/character'?{character:ch}:hints});
 }
 return r.fallback();});
 await h.openTab('lifestone');await delay(600);
 async function scan(label,field='lsWeapon'){
  const old=(await h.get(['rt'])).rt.lsWeapons?.t||0;
  await h.popup.evaluate(field=>{document.getElementById(field).focus();document.getElementById('lsScanWeapons').click();},field);
  await until(()=>h.popup.evaluate(()=>!lsActionBusy),8000);await delay(700);
  const state=await h.get(['rt','on','lock']);
  const row=await h.popup.evaluate(()=>({items:[...document.getElementById('lsWeapon').options].map(o=>({value:o.value,text:o.textContent,disabled:o.disabled})),hint:document.getElementById('lsWeaponHint').textContent,focus:document.activeElement.id,toast:document.getElementById('toast')?.textContent||''}));
  row.label=label;row.on=state.on;row.advanced=(state.rt.lsWeapons?.t||0)>old;row.count=state.rt.lsWeapons?.items?.length||0;row.ids=state.rt.lsWeapons?.items?.map(x=>x.itemId)||[];results.push(row);
 }
 await scan('OFF real catalog');
 await h.click('start');await until(()=>h.g.core('on && running && tabOwner'));
 await h.openTab('lifestone');await scan('ON owner real catalog','lsTargets');
 await h.click('stop');await until(()=>h.g.core('!on && !running'));
 await h.openTab('lifestone');await scan('OFF after Stop real catalog','lsMaxAttempts');
 if(process.env.LS_SCAN_PROOF)fs.writeFileSync(process.env.LS_SCAN_PROOF,JSON.stringify({version:await h.sw.evaluate(()=>chrome.runtime.getManifest().version),results,api,errors:h.errors},null,2));
 console.log(JSON.stringify({results,api,errors:h.errors}));
 for(const r of results){assert.equal(r.advanced,true,r.label);assert.equal(r.count,4,r.label);assert.deepEqual(r.ids,[9002284,97,8688,175]);assert.equal(r.items.length,5,r.label);}
 assert.equal([...api,...h.requests].some(x=>x.method!=='GET'),false,'scan and background make no POST');assert.deepEqual(h.errors,[]);console.log('PASS actual MV3 real offline catalog, four real weapon IDs, OFF/ON/Stop, no POST');
 }finally{await h.ctx.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
