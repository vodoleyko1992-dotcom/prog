'use strict';
// Настоящие hook.js и content.js на полностью перехваченной локальной странице, без игры/доступа к аккаунту.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_NODE||'/opt/node-tools/node_modules/playwright');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const manifest=JSON.parse(read('manifest.json')),scripts=manifest.content_scripts.find(x=>x.js.includes('content.js')).js;
const rows=[{spawn:'pole1',name:'Marsh Stakato',hp:1572,sides:[['Neer Crawler',1524,11649],['Marsh Stakato Drone',1860,2028]]},
 {spawn:'pole2',name:'Marsh Stakato Soldier',hp:1764,sides:[['Marsh Stakato Worker',1668,12024],['Marsh Stakato Drone',1860,2050]]}];
const pageHtml='<html><head><meta charset="utf-8"></head><body><div id="l2-hud-legacy-name"><span class="l2-player-identity__nick">Warlock</span></div><div id="battle-mob-title"></div><div id="battle-mob-hp-val"></div><div id="battle-log"></div><button class="l2-battle-hotbar-slot" title="Атака"><span data-slot-cd="attack"></span></button></body></html>';
const mock=`(()=>{const data={on:false,cfg:{rec:false,autoLearn:false},rt:{char:'Warlock',zone:'cruma',classCur:{prof:'human_warrior'}}};window.__data=data;
window.chrome={runtime:{id:'mock',lastError:null,getManifest:()=>({version:'${manifest.version}'}),getURL:p=>'https://l2wap.com/__ext/'+p,onMessage:{addListener(){}},sendMessage(m,cb){let r=null;if(m.cmd==='tabId')r=3;if(m.cmd==='statePatch'){Object.assign(data.rt,m.patch||{});r={ok:true}}if(cb){queueMicrotask(()=>cb(r));return}return Promise.resolve(r)}},storage:{onChanged:{addListener(){}},local:{get:async ks=>Object.fromEntries([].concat(ks).map(k=>[k,data[k]])),set:async p=>Object.assign(data,p)}}}})()`;
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM||'/opt/pw-browsers/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));let current=0;
 await page.route('https://l2wap.com/**',async r=>{
  const u=new URL(r.request().url());let data={};
  if(u.pathname.startsWith('/__ext/'))return r.fulfill({status:200,contentType:'application/json',body:read(u.pathname.slice(7))});
  if(u.pathname==='/game/battle/start'){
   current=+r.request().postDataJSON().case;const c=rows[current];data={character:{id:'fixture',name:'Warlock',revision:current*2+1,hp:5000,mp:500},battle:{spawnId:c.spawn,mobName:c.name,mobHp:c.hp,mobMaxHp:c.hp,log:[],logSeq:0,whirlwindExtras:c.sides.map(x=>({name:x[0],mobHp:x[1],mobMaxHp:x[1]}))}};
  }else if(u.pathname==='/game/battle/action'){
   const c=rows[current];data={character:{id:'fixture',name:'Warlock',revision:current*2+2,hp:5000,mp:500},victory:{spawnId:c.spawn,mobName:c.name,fullLog:[`[Warlock] — крит! −${c.hp} HP.`,`Древко розсікло ворогів поруч: ${c.sides.map(x=>x[0]+' −'+x[2]).join(', ')}.`,...c.sides.map(x=>'Додаткова ціль повалена: '+x[0]+'.'),'Перемога!']}};
  }else if(!u.pathname.startsWith('/game/')&&u.pathname!=='/character')return r.fulfill({status:200,contentType:'text/html',body:pageHtml});
  return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('https://l2wap.com/battle.html?spawnId=pole1');await page.evaluate(mock);await page.addScriptTag({content:read('hook.js')});for(const s of scripts)await page.addScriptTag({content:read(s)});
 const result=await page.evaluate(async rows=>{
  tabOwner=true;leaseEpoch='fixture';const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const post=(p,v)=>fetch(p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(v)}).then(r=>r.json());
  const results=[];
  for(let i=0;i<rows.length;i++){
   const c=rows[i];history.replaceState({},'', '/battle.html?spawnId='+c.spawn);document.querySelector('#battle-mob-title').textContent=c.name;document.querySelector('#battle-mob-hp-val').textContent=c.hp+'/'+c.hp;
   await post('/game/battle/start',{case:i});await wait(100);const b=document.querySelector('.l2-battle-hotbar-slot');observeSlot(b,'B');
   await post('/game/battle/action',{action:'attack',expectedRevision:i*2+1,battleSpawnId:c.spawn});await wait(2000);
   results.push({turn:L2V7Modules.fightlab.turnFor('атака',Date.now()-2000),damage:L2V7Modules.fightlab.damageFor(c.name,c.spawn),sample:{...rt.skills['атака']},group:L2V7Modules.fightlab.groupOn('атака',c.hp)});
  }
  return results;
 },rows);
 for(let i=0;i<rows.length;i++){
  const c=rows[i],r=result[i];assert.equal(r.turn.own,c.hp);assert.equal(r.turn.ownKnown,true);assert.equal(r.damage.removed,c.hp+c.sides.reduce((s,x)=>s+x[1],0));assert.equal(r.sample.dmgN,i+1);assert.equal(r.sample.unknown,undefined);assert.equal(r.group.kills,2);
 }
 assert.deepEqual(errors,[]);console.log('PASS browser: hook → actor-aware fightlab → real observeSlot; two accepted polearm victories, capped extras, group learning, no false zero');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
