'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness(),api=[];let fail=false,hold=false,release;const gate=new Promise(r=>release=r);try{
 const hints=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../kb/raw/catalog-hints.json'),'utf8')).data;
 const ch={name:'AuditHero',revision:100,inventory:{eq:{l1:{itemId:9002284,enchant:25}},stacks:[{itemId:97,enchant:0,qty:1},{itemId:8688,enchant:7,qty:1},{itemId:175,enchant:0,qty:1}]}};
 await h.ctx.route('https://l2wap.com/**',async r=>{const p=new URL(r.request().url()).pathname;
 if(p==='/character'||p==='/character/catalog-hints'){
  api.push({method:r.request().method(),path:p});assert.equal(r.request().method(),'GET');
  if(p==='/character/catalog-hints'&&fail){if(hold)await gate;return r.fulfill({status:503,json:{error:'audit service unavailable'}});}
  return r.fulfill({json:p==='/character'?{character:ch}:hints});
 }
 return r.fallback();});
 await h.openTab('lifestone');await delay(600);
 async function clickScan(){await h.popup.evaluate(()=>document.getElementById('lsScanWeapons').click());await until(()=>h.popup.evaluate(()=>!lsActionBusy),8000);await delay(600);}
 async function view(){return h.popup.evaluate(()=>({status:document.getElementById('lsScanStatus')?.textContent,state:document.getElementById('lsScanStatus')?.dataset.state,disabled:document.getElementById('lsScanWeapons').disabled,aria:document.getElementById('lsScanWeapons').getAttribute('aria-busy'),count:document.getElementById('lsWeapon').options.length,targets:[...document.getElementById('lsTargets').selectedOptions].map(o=>o.value),max:document.getElementById('lsMaxAttempts').value,focus:document.activeElement.id}));}
 await clickScan();const successful=await view();assert.match(successful.status,/Прочитано оружия: 4/);assert.equal(successful.state,'success');assert.equal(successful.count,5);
 const old=(await h.get(['rt'])).rt.lsWeapons;
 fail=true;hold=true;
 await h.popup.evaluate(()=>{for(const o of document.getElementById('lsTargets').options)o.selected=o.value==='matk_6';document.getElementById('lsMaxAttempts').value='37';document.getElementById('lsMaxAttempts').focus();document.getElementById('lsScanWeapons').click();});
 await until(async()=>{const v=await view();return v.state==='loading'&&v.disabled;});const loading=await view();assert.equal(loading.aria,'true');release();await until(()=>h.popup.evaluate(()=>!lsActionBusy),8000);
 await delay(4600);const error=await view();assert.equal(error.state,'error');assert.match(error.status,/каталог оружия: HTTP 503/);assert.equal(error.count,5);assert.deepEqual(error.targets,['matk_6']);assert.equal(error.max,'37');assert.equal(error.disabled,false);assert.equal(error.aria,'false');assert.deepEqual((await h.get(['rt'])).rt.lsWeapons,old);
 fail=false;await clickScan();const recovered=await view();assert.equal(recovered.state,'success');assert.match(recovered.status,/Прочитано оружия: 4/);assert.equal(recovered.count,5);assert.deepEqual(recovered.targets,['matk_6']);assert.equal(recovered.max,'37');
 assert.equal([...api,...h.requests].some(x=>x.method!=='GET'),false);assert.deepEqual(h.errors,[]);
 const proof={at:new Date().toISOString(),source:process.env.LS_SCAN_SOURCE||'/workspace/prog',successful,loading,errorAfter4_6s:error,recovered,api,errors:h.errors,posts:0};
 if(process.env.LS_SCAN_PROOF)fs.writeFileSync(process.env.LS_SCAN_PROOF,JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));console.log('PASS actual MV3 persistent scan status, held loading/HTTP503/old4weapons/drafts/recovery, 0POST');
 }finally{release();await h.ctx.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
