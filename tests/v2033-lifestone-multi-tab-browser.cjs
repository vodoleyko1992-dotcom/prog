'use strict';
// Actual MV3; stale foreign hero tab precedes matching game, popup is its own active tab.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness(),api=[];let other;try{
 const hints=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../kb/raw/catalog-hints.json'),'utf8')).data;
 const ch={name:'AuditHero',revision:100,inventory:{eq:{l1:{itemId:9002284,enchant:25}},stacks:[{itemId:97,enchant:0,qty:1},{itemId:8688,enchant:7,qty:1},{itemId:175,enchant:0,qty:1}]}};
 await h.ctx.route('https://l2wap.com/**',r=>{const p=new URL(r.request().url()).pathname;
 if(p==='/character'||p==='/character/catalog-hints'){api.push({method:r.request().method(),path:p});assert.equal(r.request().method(),'GET');return r.fulfill({json:p==='/character'?{character:ch}:hints});}
 return r.fallback();});
 other=await h.game();
 // A paused older document can retain the previous hero's DOM/runtime after another tab updates global storage.
 await h.g.p.evaluate(()=>{document.getElementById('l2-hud-legacy-name').textContent='OtherHero'});
 await h.g.core("rt={...rt,char:'OtherHero'};true");
 await h.popup.reload();await h.openTab('lifestone');await h.popup.bringToFront();await delay(700);
 const before={first:await h.g.core('({hero:heroNick(),char:rt.char,on,owner:tabOwner})'),second:await other.core('({hero:heroNick(),char:rt.char,on,owner:tabOwner})'),stored:{char:(await h.get(['rt'])).rt.char,on:(await h.get(['on'])).on}};
 const old=(await h.get(['rt'])).rt.lsWeapons?.t||0;
 await h.popup.evaluate(()=>document.getElementById('lsScanWeapons').click());
 await until(()=>h.popup.evaluate(()=>!lsActionBusy),8000);await delay(600);
 const state=await h.get(['rt','on','lock']);
 const popup=await h.popup.evaluate(()=>({count:document.getElementById('lsWeapon').options.length,hint:document.getElementById('lsWeaponHint').textContent,toast:document.getElementById('toast')?.textContent||''}));
 const advanced=(state.rt.lsWeapons?.t||0)>old,proof={at:new Date().toISOString(),source:process.env.LS_SCAN_SOURCE||'/workspace/prog',expectedBaselineFailure:!!process.env.LS_SCAN_EXPECT_FAIL,before,advanced,storedCount:state.rt.lsWeapons?.items?.length||0,popup,api,errors:h.errors};
 if(process.env.LS_SCAN_PROOF)fs.writeFileSync(process.env.LS_SCAN_PROOF,JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
 assert.equal([...api,...h.requests].some(x=>x.method!=='GET'),false,'scan and background make no POST');assert.deepEqual(h.errors,[]);assert.equal(state.on,false);assert.equal(api.some(x=>x.method!=='GET'),false);
 if(process.env.LS_SCAN_EXPECT_FAIL){assert.equal(advanced,false);assert.equal(api.length,0);assert.match(popup.toast,/Персонаж изменился/);console.log('PASS baseline reproduces wrong first game tab: scan never reached API');}
 else{assert.equal(advanced,true);assert.equal(state.rt.lsWeapons.items.length,4);assert.equal(popup.count,5);assert.equal(api.filter(x=>x.path==='/character').length,1);assert.equal(api.filter(x=>x.path==='/character/catalog-hints').length,1);console.log('PASS fixed scan probes and reads matching second hero tab exactly once');}
 }finally{await h.ctx.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
