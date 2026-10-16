'use strict';
// Реальное MV3, только локальные ответы: размеры панелей, клики и смена ширины.
const assert=require('node:assert/strict');
const {harness,until}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness({withPopup:false});try{
 const {p,core}=h.g;await p.setViewportSize({width:1897,height:953});
 await core(`dockGameBounds=()=>({left:650,right:1250,observed:[document.body]});localStorage.setItem('l2bot-dockWide','1');cfg.dock=true;cfg.dockMin=false;cfg.indMode='full';indStick=null;dock();true`);
 const frame=p.frameLocator('#l2bot-dock iframe');await until(()=>frame.locator('#start').isVisible());
 for(const width of [1897,1920,1366,1024,760,640,375]){
  await p.setViewportSize({width,height:953});
  await core(`dockGameBounds=()=>({left:${width>=1366?650:width>=760?320:0},right:${width>=1366?width-647:width>=760?width-320:0},observed:[document.body]});indStick=null;dock();true`);
  const rect=await p.evaluate(()=>{const ind=document.querySelector('#l2bot-ind'),dock=document.querySelector('#l2bot-dock'),i=ind.getBoundingClientRect(),d=dock.getBoundingClientRect(),f=dock.querySelector('iframe').getBoundingClientRect(),b=dock.querySelector('#l2bot-dock-wide').getBoundingClientRect();return {hidden:getComputedStyle(ind).display==='none',right:i.right,left:d.left,menuRight:d.right,iframeLeft:f.left,buttonRight:b.right}});
  assert.equal(rect.hidden,width<760,`${width}: indicator visibility`);
  assert.ok(rect.hidden||rect.right<=rect.left-7,`${width}: panels overlap`);
  assert.ok(rect.iframeLeft>=rect.buttonRight,`${width}: rail overlaps iframe`);
  assert.ok(rect.menuRight<=width,`${width}: menu exceeds viewport`);
  assert.ok(await frame.locator('body').evaluate(e=>e.scrollWidth<=innerWidth),`${width}: horizontal overflow`);
  if(!await frame.locator('#autoTaskSelection').isVisible())await frame.locator('#modeToggle').click();
  for(const task of ['tvt','resources']){const el=frame.locator(`[data-auto-task="${task}"]`);await el.scrollIntoViewIfNeeded();await el.click({trial:true});}
  console.log('PASS viewport',width);
 }
 await p.setViewportSize({width:1897,height:953});await core('dockGameBounds=()=>({left:650,right:1250,observed:[document.body]});indStick=null;dock();true');
 // Широкий режим показывает постоянную навигацию и кликабельный контент.
 await until(()=>frame.locator('nav [data-tab="svc"]').isVisible());await frame.locator('nav [data-tab="svc"]').click();
 assert.equal(await frame.locator('#tab-svc').isVisible(),true);
 await p.locator('#l2bot-dock-wide').click();await until(()=>p.locator('#l2bot-dock-wide').getAttribute('aria-pressed').then(v=>v==='false'));
 assert.equal(await core("ui.classList.contains('dock-covered')"),false);
 assert.equal(await frame.locator('#navToggle').isVisible(),true);
 await p.locator('#l2bot-dock-wide').click();await until(()=>frame.locator('nav [data-tab="svc"]').isVisible());
 await frame.locator('header').evaluate(el=>el.scrollTop=0);
 await p.screenshot({path:__dirname+'/../work/dock-x2.png'});
 await core('cfg.dockMin=true;dock();true');assert.equal(await core("ui.classList.contains('dock-covered')"),false);
 await core('cfg.dock=false;dock();true');assert.equal(await p.locator('#l2bot-dock').count(),0);
 assert.equal((await h.get(['on'])).on,false);assert.deepEqual(h.errors,[]);
 assert.ok(h.requests.every(r=>r.method==='GET'),'no game POST');
 console.log('PASS actual MV3 x2: separate panels/rail, tasks, persistent navigation, normal mode and fold/disable restoration; no game actions or JS errors');
}finally{await h.ctx.close()}})().catch(e=>{console.error(e);process.exitCode=1});
