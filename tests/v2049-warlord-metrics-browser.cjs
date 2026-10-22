'use strict';
// 22.10 22:44:31: настоящий MV3/hook/core/observeSlot, локальные ответы вместо игры.
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const actual=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/warlord-metrics-20261022.json'),'utf8'));
(async()=>{
 const h=await harness({withPopup:false});
 try{
  let revision=439225,spawn='',pull='provoke',ended=false,started=false;
  const name='Lilim Magus',startLog=actual.log.slice(0,1),pullLog=actual.log.slice(0,5);
  const extras=()=>['Lilim Magus','Lilim Magus','Nephilim Priest'].map((name,i)=>({spawnId:spawn+'_side_'+i,name,mobHp:2628,mobMaxHp:2628}));
  const char=mp=>({name:'AuditHero',l2Profession:'human_warlord',classSlots:{activeSlot:3},hp:10159,maxHp:10159,mp,maxMp:1016,revision});
  const battle=log=>({spawnId:spawn,mobName:name,kind:'normal',mobHp:2628,mobMaxHp:2628,log,whirlwindExtras:started?extras():[]});
  const result=()=>({revision,character:char(325),victory:{spawnId:spawn,mobName:name,fullLog:actual.log}});
  await h.g.p.route('**/game/battle**',async route=>{
   const pathname=new URL(route.request().url()).pathname,req=route.request().postDataJSON()||{};let body;
   if(pathname.endsWith('/start')){spawn=req.spawnId;pull=req.mode;ended=false;started=false;revision++;body={revision,character:char(418),battle:battle(startLog)};}
   else if(pathname.endsWith('/action')&&['provoke','howl'].includes(req.action)){started=true;revision++;body={revision,character:char(364),battle:battle(pullLog)};}
   else if(pathname.endsWith('/action')){if(!ended)revision++;ended=true;body=result();if(pull==='howl')await delay(150);}
   else body=ended?result():{revision,character:char(started?364:418),battle:battle(started?pullLog:startLog)};
   await route.fulfill({json:body});
  });
  await h.g.core(`(async()=>{cfg={...cfg,autoLearn:true,rec:false,netLog:false};await setRt({char:'AuditHero',prof:'human_warlord',classCur:{prof:'human_warlord',slot:3},classSwT:0,lvl:51,zone:'Garden',sessT0:Date.now(),packLab:null,skills:{}});L2V7Modules.warlock.heroContext=()=> 'metrics-fixture-gear-buffs';return true;})()`);
  async function post(url,body){await h.g.p.evaluate(async({url,body})=>(await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).json(),{url,body});}
  async function fight(index,mode){
   const id='metrics_'+index;
   await h.g.p.evaluate(id=>{
    history.replaceState({},'','/battle.html?spawnId='+id);
    document.querySelector('#metrics-battle')?.remove();
    const el=document.createElement('div');el.id='metrics-battle';
    el.innerHTML='<span id="battle-mob-title">Lilim Magus · ур.51</span><span id="battle-mob-hp-val">2628 / 2628</span><span id="l2-hud-hp-cur">10159</span><span id="l2-hud-hp-max">10159</span><span id="l2-hud-mp-cur">364</span><span id="l2-hud-mp-max">1016</span><div id="battle-log"></div><div class="l2-battle-hotbar"><button class="l2-battle-hotbar-slot" title="Вихор" data-slot-cd="whirlwind"><img src="/icons/skill0036.gif"></button></div>';
    document.body.append(el);
   },id);
   await post('/game/battle/start',{spawnId:id,mode});
   await until(()=>h.g.core('L2V7Modules.fightlab.fight()?.spawn==='+JSON.stringify(id)));
   await post('/game/battle/action',{action:mode,battleSpawnId:id,expectedRevision:revision});
   await until(()=>h.g.core('rt.packLab?.active?.mode==='+JSON.stringify(mode)));
   await h.g.p.evaluate(()=>fetch('/game/battle').then(r=>r.json()));
   await delay(100);
   await h.g.core("observeSlot(document.querySelector('.l2-battle-hotbar-slot'),'B');true");
   await h.g.p.evaluate(async({revision,race})=>{
    const pending=fetch('/game/battle/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'whirlwind',battleSpawnId:new URLSearchParams(location.search).get('spawnId'),expectedRevision:revision})});
    if(race){await new Promise(r=>setTimeout(r,30));await fetch('/game/battle').then(r=>r.json());}
    const answer=await pending;
    document.querySelector('.l2-battle-hotbar')?.remove();
    document.querySelector('#battle-log').textContent='Победа!';
    await answer.json();
   },{revision,race:index===1});
   await until(()=>h.g.core('rt.skills?.["вихор"]?.uses==='+String(index+1)));
   return h.g.core('({skill:rt.skills["вихор"],sample:rt.packLab.samples.at(-1),turn:L2V7Modules.fightlab.turnFor("вихор",Date.now()-4000,"whirlwind",ACT_NET.rid),nativeTurn:L2V7Modules.fightlab.turnFor("whirlwind",Date.now()-4000,"whirlwind",ACT_NET.rid)})');
  }
  const first=await fight(0,'provoke');
  assert.equal((first.turn||first.nativeTurn)?.own,16137,'server turn exists before localized lookup');
  assert.equal(first.turn?.own,16137,'native action keeps localized name after hotbar disappears');
  assert.equal(first.skill.damageEvidence.dmgN,1,'observeSlot records accepted native damage');
  assert.equal(first.skill.damageEvidence.unknown,0);
  assert.equal(first.sample.raw,64548);assert.equal(first.sample.useful,10512);assert.equal(first.sample.peak,4);
  const before=await h.g.core('rt.packLab.totals.n');
  await post('/game/battle/action',{action:'whirlwind',battleSpawnId:spawn,expectedRevision:revision-1});
  await delay(150);assert.equal(await h.g.core('rt.packLab.totals.n'),before,'duplicate victory is not a new fight');
  await fight(1,'howl');await fight(2,'provoke');
  const rows=await h.g.core('rt.packLab.samples');
  assert.equal(rows.length,3);assert.equal(rows.filter(x=>x.observedCycle).length,2,'alternating modes produce observed cycles');
  assert.equal(rows.filter(x=>x.cycle).length,0,'alternation does not claim comparable rotation evidence');
  const report=await h.g.core('L2V7Modules.fightlab.packReport()');
  assert.match(report,/наблюдаем/);assert.match(report,/сопоставим/);
  assert.deepEqual(h.errors,[]);
  console.log('PASS Chrome MV3: native whirlwind → localized slot snapshot → accepted AoE learning with removed hotbar; useful/raw damage; duplicate victory; alternating observed cycles kept separate from rotation advice; 0 page errors; local routes only');
 }finally{await h.ctx.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
