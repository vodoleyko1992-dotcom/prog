'use strict';
const assert=require('node:assert/strict'),{allPages,until,delay}=require('./v101-champion-all-pages-fixture.cjs');
async function test(kind){const f=await allPages({ordinaryFirst:kind==='ordinary-first',redPage:kind==='red-page',noChampion:kind==='empty-reset',hold:['stop','tvt','selection'].includes(kind)});try{
 await f.start();
 if(['stop','tvt','selection'].includes(kind)){
  await until(()=>f.S.held,20000);
  if(kind==='stop'){await f.h.click('stop');await until(async()=>!(await f.h.get(['on'])).on);}
  else if(kind==='selection'){await f.h.popup.locator('[data-auto-task="quests"]').click();await until(async()=>!(await f.h.get(['cfg'])).cfg.autoTasks.includes('quests'));}
  else{f.S.tvt=true;await f.h.g.p.evaluate(()=>fetch('/game/tvt'));await until(()=>f.h.g.core('L2V7Modules.tvt.tvtHold()'));}
  f.release();await delay(1800);await f.h.click('stop');assert.equal(f.S.pages.filter(p=>p>2).length,0,'отменённое чтение не продолжает скан');assert.equal((await f.diag()).S.entries,0);
 }else if(kind==='empty-reset'){
  await until(()=>f.S.pages.includes(20),25000);for(let p=1;p<=20;p++)assert.ok(f.S.pages.includes(p),'просмотрена страница '+p);await delay(1200);const n=f.S.pages.length;await delay(1000);assert.equal(f.S.pages.length,n,'полный пустой проход завершён');
  await f.h.click('stop');await until(()=>f.h.g.core('!on&&!running'));f.S.champPage=8;f.S.generation++;await f.seed();await f.h.g.p.goto('https://l2wap.com/map.html');await f.start();await until(async()=>(await f.diag()).S.wins===1,25000);await f.h.click('stop');
 }else if(kind==='ordinary-first'){await until(()=>f.S.battleTargets.length>0,25000);await f.h.click('stop');assert.deepEqual(f.S.battleTargets,['known_0_0']);assert.deepEqual(f.S.pages,[1],'обычная квестовая цель выше чемпиона: без скана');
 }else{await until(async()=>(await f.diag()).S.wins===1,25000);await f.h.click('stop');for(let p=1;p<=12;p++)assert.ok(f.S.pages.includes(p),'просмотрена страница '+p);}
 if(kind==='red-page')assert.deepEqual(f.S.battleTargets,['dense_leto_fixture'],'красный чемпион страницы2 не выбран');
 const d=await f.diag();assert.deepEqual(d.S.routeErrors,[]);assert.deepEqual(f.h.errors,[]);console.log('PASS all pages '+kind,JSON.stringify({pages:f.S.pages,entries:d.S.entries,attacks:d.S.attacks}));
 }catch(e){console.error('DIAG '+kind,JSON.stringify(await f.diag()));throw e;}finally{await f.close();}}
(async()=>{for(const k of(process.env.ALL_PAGES_CASES||'late,red-page,empty-reset,stop,tvt,selection,ordinary-first').split(','))await test(k);})().catch(e=>{console.error(e.stack);process.exitCode=1;});
