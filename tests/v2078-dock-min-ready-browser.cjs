'use strict';
// 29.10, content.js:4790: готовность текущего iframe до postMessage; настоящий MV3, все HTTPS локальные.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const AND='Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0 Safari/537.36';
const proof=[];
// Общий harness не задаёт UA; меняем только параметры запуска этого локального сценария.
async function openHarness(android){const {chromium}=require(process.env.PLAYWRIGHT_NODE||'/opt/node-tools/node_modules/playwright'),launch=chromium.launchPersistentContext;
 if(!android)return harness({withPopup:false});
 chromium.launchPersistentContext=function(dir,opts){return launch.call(this,dir,{...opts,userAgent:AND})};
 try{return await harness({withPopup:false})}finally{chromium.launchPersistentContext=launch}
}
async function scenario(android){
 const h=await openHarness(android),messages=[],entries=[];
 try{
 h.g.p.on('console',m=>messages.push({type:m.type(),text:m.text()}));
 const cdp=await h.ctx.newCDPSession(h.g.p);await cdp.send('Log.enable');cdp.on('Log.entryAdded',e=>entries.push(e.entry));
 await h.g.p.setViewportSize(android?{width:800,height:1280}:{width:1897,height:953});
 await h.g.core("globalThis.__hbFacts=[];addEventListener('message',e=>{if(e.data?.__l2dock==='hb')__hbFacts.push({origin:e.origin,trusted:e.isTrusted,nullSource:e.source===null,sameSource:e.source===document.querySelector('#l2bot-dock iframe')?.contentWindow})});true");
 const beforeHeartbeat=await h.g.core((android?"dockGameBounds=()=>({left:0,right:790,observed:[document.body]});cfg.dock=true;cfg.dockMin=true;localStorage.setItem('l2bot-dockOpen','1');":"dockGameBounds=()=>({left:650,right:1250,observed:[document.body]});cfg.dock=true;cfg.dockMin=false;")+"dock();({ready:dockMinWindow!==null,hb:dockHb,shown:dockShownMin})");
 assert.equal(beforeHeartbeat.ready,false,'первое сообщение ждёт heartbeat iframe');
 const frame=()=>h.g.p.frames().find(x=>x.url().startsWith('chrome-extension://')&&x.url().includes('dock=1'));
 await until(()=>h.g.core("dockMinWindow===document.querySelector('#l2bot-dock iframe')?.contentWindow&&dockHb>0"));
 await until(async()=>frame()&&await frame().evaluate('dockView===false'));
 const first=await h.g.core('({ANDROID,dockOver,dockShownMin,cfgMin:cfg.dockMin,hb:__hbFacts})');assert.equal(first.ANDROID,android);assert.equal(first.dockShownMin,false);
 // Поддельный hb от другого окна не меняет привязку или пульс.
 const wrong=await h.g.core("(()=>{const old=dockHb;dispatchEvent(new MessageEvent('message',{data:{__l2dock:'hb'},origin:EXT_ORIGIN,source:window}));return dockHb===old&&dockMinWindow===document.querySelector('#l2bot-dock iframe').contentWindow})()");assert.equal(wrong,true);
 if(android){
  await h.g.p.locator('#l2bot-dock-toggle').click();await until(async()=>await frame().evaluate('dockView===true'));assert.equal(await h.g.core('cfg.dockMin'),true);
  await h.g.p.locator('#l2bot-dock-toggle').click();await until(async()=>await frame().evaluate('dockView===false'));assert.equal(await h.g.core('cfg.dockMin'),true);
 }else{
  await h.g.core('cfg.dockMin=true;dock();true');await until(async()=>await frame().evaluate('dockView===true'));
  await h.g.core('cfg.dockMin=false;dock();true');await until(async()=>await frame().evaluate('dockView===false'));
 }
 // Точный сценарий сторожа: старый WindowProxy не разрешает postMessage новой ещё пустой рамке.
 const replaced=await h.g.core("(()=>{const f=document.querySelector('#l2bot-dock iframe'),n=f.cloneNode(false);n.src=chrome.runtime.getURL('popup.html?dock=1&r='+Date.now());f.replaceWith(n);dockBorn=Date.now();dockMinPost();return dockMinWindow!==n.contentWindow})()");assert.equal(replaced,true);
 await until(()=>h.g.core("dockMinWindow===document.querySelector('#l2bot-dock iframe')?.contentWindow"));await until(async()=>frame()&&await frame().evaluate('dockView===false'));
 const hb0=await h.g.core('dockHb');await until(async()=>await h.g.core('dockHb')>hb0,5000); // настоящий периодический hb раз в3с
 await delay(150);const final=await h.g.core('({dockHb,dockShownMin,dockOver,cfgMin:cfg.dockMin,hb:__hbFacts})');
 assert.ok(final.hb.length>=3);assert.ok(final.hb.filter(x=>x.trusted).every(x=>!x.nullSource&&x.sameSource));assert.deepEqual(h.errors,[]);
 const warnings=messages.filter(x=>/postMessage|target origin|recipient window/i.test(x.text));assert.deepEqual(warnings,[]);assert.deepEqual(entries.filter(x=>/postMessage/i.test(x.text)),[]);
 proof.push({case:android?'Android-UA overlay':'Desktop',browser:h.ctx.browser().version(),beforeHeartbeat,first,final,wrongSourceIgnored:true,replacementReady:true,periodicHeartbeat:true,originWarnings:warnings,pageErrors:h.errors});
 console.log('PASS actual MV3 dock readiness',JSON.stringify({case:android?'Android-UA overlay':'Desktop',browser:h.ctx.browser().version(),heartbeatSource:true,replacementReady:true,periodicHeartbeat:true,originWarnings:0,pageErrors:0}));
 }finally{await h.ctx.close()}
}
(async()=>{try{for(const a of [false,true])await scenario(a)}finally{if(process.env.DOCK_MIN_READY_PROOF)fs.writeFileSync(process.env.DOCK_MIN_READY_PROOF,JSON.stringify({boundary:'Actual current Chrome MV3 extension; all HTTPS fulfilled locally by harness; Android UA/layout emulation, not real Firefox or Android device; no live game',proof},null,2)+'\n')}})().catch(e=>{console.error(e.stack);process.exitCode=1});
