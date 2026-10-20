'use strict';
// Реальное MV3 с локальными ответами. Подменён только контекст экипировки, не сбор/сохранение/меню.
const {harness,until}=require('./v1014-core-lifecycle-browser.cjs'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{const h=await harness();try{
 let revision=0,stage=0,spawn='',mode='none';const extras=()=>Array.from({length:2},(_,i)=>({spawnId:'side_'+i,name:'Side '+i,mobHp:1000,mobMaxHp:1000}));
 const char=()=>({name:'AuditHero',l2Profession:'human_warlord',classSlots:{activeSlot:1},hp:10000,maxHp:10000,mp:1000,maxMp:1000,revision});
 await h.g.p.route('**/game/battle**',async r=>{
  const p=new URL(r.request().url()).pathname,q=r.request().postDataJSON?.()||{};let body;
  if(p.endsWith('/start')){stage=0;mode=q.mode;spawn=q.spawnId;revision++;body={revision,character:char(),battle:{spawnId:spawn,mobName:'Garden Guard',kind:'normal',mobHp:1000,mobMaxHp:1000,logSeq:0,log:['Бой начат']}};}
  else if(p.endsWith('/action')&&q.action==='provoke'){stage=1;revision++;body={revision,character:char(),delta:{mobHp:1000,mobMaxHp:1000,logSeq:1,logTail:['Провокація'],whirlwindExtras:extras()}};}
  else if(p.endsWith('/action')){stage=2;revision++;const log=['Ты нанёс [Garden Guard] 1200 урона.',...(mode==='provoke'?['Вихор вразив ворогів поруч: Side 0 −1200, Side 1 −1200.']:[])];body={revision,character:char(),delta:{mobHp:0,mobMaxHp:1000,logSeq:(mode==='provoke'?1:0)+log.length,logTail:log},victory:{spawnId:spawn,mobName:'Garden Guard',adena:mode==='provoke'?750:250,sp:mode==='provoke'?75:25,fullLog:log}};}
  else body={revision,character:char(),battle:{spawnId:spawn,mobName:'Garden Guard',kind:'normal',mobHp:1000,mobMaxHp:1000,logSeq:stage,log:stage?['Бой начат','Провокація']:['Бой начат'],whirlwindExtras:stage?extras():[]}};
  await r.fulfill({json:body});
 });
 await h.sw.evaluate(async()=>{const {cfg}=await chrome.storage.local.get('cfg');await chrome.storage.local.set({cfg:{...cfg,rec:true,netLog:true,autoLearn:false}})});
 await until(()=>h.g.core('cfg.rec && cfg.netLog'));
 await h.g.core("(async()=>{await setRt({prof:'human_warlord',classCur:{prof:'human_warlord',slot:1},lvl:48,zone:'Garden',sessT0:Date.now(),packLab:null}); L2V7Modules.warlock.heroContext=()=> 'browser-gear-buffs'; return true;})()");
 async function post(path,body){await h.g.p.evaluate(async({path,body})=>(await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).json(),{path,body});}
 async function start(id,which){await post('/game/battle/start',{spawnId:id,mode:which});await until(()=>h.g.core('rt.packLab?.active?.spawn==='+JSON.stringify(id)));}
 async function hit(action){await post('/game/battle/action',{action,battleSpawnId:spawn,expectedRevision:revision});}
 await start('pack_base','none');await hit('whirlwind');await until(()=>h.g.core('rt.packLab?.samples?.length===1'));
 await start('pack_pull','provoke');await hit('provoke');await until(async()=>(await h.get(['rt'])).rt.packLab?.active?.mode==='provoke');
 const original=(await h.get(['rt'])).rt.packLab.active.uid;
 await h.g.p.reload();await until(()=>h.g.core('typeof L2V7Modules.fightlab.packReport === "function"'));
 await h.g.core("L2V7Modules.warlock.heroContext=()=> 'browser-gear-buffs'; true");
 await h.g.p.evaluate(async()=>(await fetch('/game/battle')).json());await until(()=>h.g.core('L2V7Modules.fightlab.fight()?.pack?.uid==='+JSON.stringify(original)));
 await hit('whirlwind');
 const data=await until(async()=>{const {rt}=await h.get(['rt']);return rt.packLab?.samples?.length===2?rt.packLab:null});
 assert.equal(data.totals.n,2);assert.equal(data.totals.adena,1000);assert.equal(data.samples[1].uid,original);assert.equal(data.samples[1].quality,true);assert.equal(data.samples[1].useful,3000);assert.equal(data.samples[1].raw,3600);assert.equal(data.samples[1].peak,3);
 await until(()=>h.popup.locator('#packBox').textContent().then(x=>x.includes('боёв 2')&&x.includes('1000 адены')&&x.includes('provoke')));
 console.log('PASS actual fetch → full battle ledger → background persistence → reload restores pull → popup totals/useful damage');
 const downloaded=h.popup.waitForEvent('download');await h.popup.evaluate(async()=>exportLog(await readLog({last:200}),'пачки',false));
 const txt=fs.readFileSync(await(await downloaded).path(),'utf8');assert.match(txt,/# Пачки: Сессия: боёв 2/);assert.match(txt,/# Подтверждённые награды: 1000 адены/);assert.match(txt,/лишний 17%/);
 assert.deepEqual(h.errors,[]);console.log('PASS actual TXT includes the same session report; 0 page errors; no live game traffic');
 }finally{await h.ctx.close()}})().catch(e=>{console.error(e.stack);process.exitCode=1});
