'use strict';
// 20.37: настоящий Старт/main/dispatcher; полный реальный каталог и выбор Greater по иконке.
// Все HTTPS-ответы локальные; набор Greater заменяет только свою группу, Noblesse отдельно.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const realCatalog=JSON.parse(fs.readFileSync(path.join(__dirname,'../kb/raw/buffer-catalog.json'),'utf8')).data;
const GROUP=[1356,1357,1355,1363,1413,1414],NOBLESSE=1323;
const cases=[
 {name:'mage default Water',branch:'mystic',want:1357},
 {name:'fighter default Paagrio',branch:'fighter',want:1414},
 {name:'stale base-only receipt',branch:'mystic',want:1357,stale:true},
 {name:'preserve active Greater',branch:'mystic',want:1413,existing:1413},
 {name:'restore remembered Magnus on Wizard',branch:'mystic',prof:'human_wizard',want:1413,remembered:1413},
 {name:'explicit Water replaces Magnus',branch:'mystic',want:1357,existing:1413,explicit:1357},
 {name:'Stop during fresh icon quote',branch:'mystic',want:1357,stop:true},
 {name:'price increases between icons',branch:'mystic',want:1357,price:true},
];
const clone=x=>JSON.parse(JSON.stringify(x));
async function scenario(tc){
 const h=await harness(),posts=[],visits=[];let revision=50,fee=0,catalogCalls=0,paused=false,rejected=0;
 const base=tc.branch==='fighter'?'warrior':'mage',prof=tc.prof||(tc.branch==='fighter'?'human_warlord':'human_archmage');
 const baseRow=realCatalog.sets.find(x=>x.id===base),greater=realCatalog.sets.find(x=>x.id==='greater');
 assert.equal(greater.pickByIcon,true);assert.equal(greater.skills.length,7);assert.equal(realCatalog.sets.length,5);
 const applied=x=>({...x,expiresAtMs:Date.now()+86400000});
 let buffs=baseRow.skills.map(applied);if(tc.existing)buffs.push(applied(greater.skills.find(x=>x.skillId===tc.existing)));
 const ch=()=>({name:'AuditHero',id:'vip-icon-fixture',revision,level:78,l2Profession:prof,classBranch:tc.branch,race:'Human',hp:5000,maxHp:5000,mp:5000,maxMp:5000,inBattle:false,activeDungeonId:null,locationType:'open_world',inventory:{stacks:[],eq:{}},classSlots:{activeSlot:0,slots:[{slot:0,profession:prof,race:'Human',level:78,owned:true,active:true}]},vip:{active:true,vipUntil:new Date(Date.now()+86400000).toISOString()},activeBuffs:clone(buffs)});
 const catalog=()=>{const c=clone(realCatalog);for(const row of c.sets){row.feeAdena='0';row.feeCoinOfLuck=row.id==='greater'?fee:0;}return c;};
 function html(){const c=ch();return `<!doctype html><meta charset="utf-8"><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">78</div><div id="character-profession">${prof}</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">5000</span><span id="l2-hud-hp-max">5000</span><span id="l2-hud-mp-cur">5000</span><span id="l2-hud-mp-max">5000</span><div id="l2-hud-active-buffs">${c.activeBuffs.map(b=>`<span class="l2-hud-active-buff" data-skill-id="${b.skillId}" data-expires-at="${b.expiresAtMs}" title="${b.nameUk||b.skillId} · Lv.${b.level}"></span>`).join('')}</div><div id="char-bag-list"></div><div id="char-bag-pager"></div><button data-inv-cat="weapon" aria-selected="true"></button><button data-inv-grade="all" aria-selected="true"></button><div id="map-mob-list"></div><div id="town-buffer-sets">${catalog().sets.map(s=>`<section class="l2-town-buffer-set"><button class="l2-town-buffer-set-apply" data-set-id="${s.id}">${s.id}</button>${s.skills.map(x=>`<img src="/game/skill-icon/${x.iconSkillId||x.skillId}" title="${x.nameUk} lvl ${x.level}">`).join('')}</section>`).join('')}</div><script>fetch('/character');</script>`;}
 try{
  await h.ctx.route('https://l2wap.com/**',async route=>{
   const u=new URL(route.request().url()),p=u.pathname,json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)}).catch(()=>{});
   if(p==='/character')return json({character:ch()});
   if(p==='/character/town/buffer/catalog'){
    catalogCalls++;
    if(tc.stop&&catalogCalls===1){await h.click('stop');paused=true;}
    return json(catalog());
   }
   if(p==='/character/town/buffer'){
    const q=route.request().postDataJSON(),row=catalog().sets.find(x=>x.id===q.set),record={...q,feeAtRequest:fee};posts.push(record);
    if(q.set==='greater'&&!Number.isSafeInteger(q.skillId)){record.status=400;rejected++;return json({error:'town_buffer_skill_required'},400);}
    if(!row){record.status=400;rejected++;return json({error:'town_buffer_set_unknown'},400);}
    if(q.expectedRevision!==revision){record.status=409;rejected++;return json({error:'revision_conflict'},409);}
    if(q.expectedFeeAdena!=='0'||q.expectedFeeCoinOfLuck!==row.feeCoinOfLuck){record.status=409;rejected++;return json({error:'buffer_price_changed'},409);}
    const selected=q.set==='greater'?row.skills.filter(s=>s.skillId===q.skillId):row.skills;
    if(!selected.length){record.status=400;rejected++;return json({error:'town_buffer_skill_unknown'},400);}
    if(q.set==='greater'&&GROUP.includes(q.skillId))buffs=buffs.filter(b=>!GROUP.includes(b.skillId));
    for(const skill of selected)buffs=[...buffs.filter(b=>b.skillId!==skill.skillId),applied(skill)];
    revision++;record.status=200;
    if(tc.price&&q.set==='greater')fee=5;
    return json({character:ch(),set:q.set,...(q.skillId?{skillId:q.skillId}:{})});
   }
   if(p.endsWith('.html')){visits.push(p);return route.fulfill({contentType:'text/html',body:html()});}
   return route.fallback();
  });
  await h.sw.evaluate(async ({base,prof,branch,stale,skills,explicit,remembered})=>{
   const{cfg,rt}=await chrome.storage.local.get(['cfg','rt']);
   await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:['farm'],taskOnly:false,townBuffSet:'basic',vipBuffAuto:true,faBuffs:explicit?String(explicit):'',nBuffs:'',nKeyBuffs:'',nToggles:'',petAuto:false,petBuffAuto:false,autoMagister:false,autoRoles:false,rbMode:false,rbTour:false,epicMode:false,fishMode:false,tvtOn:false,enemyHunt:false,campAuto:false,campaign:false,shopAuto:false,weaponScanAuto:false,rec:true,autoSnap:false,reactMin:0,reactMax:0,dailyKillLimit:0,dailyFishLimit:0},rt:{...rt,char:'AuditHero',lvl:78,prof,classCur:{prof,slot:0},weaponsT:Date.now(),shopT:Date.now(),manualKickAt:0,tbT:0,tbWatchT:0,tbOk:true,tbFail:0,tbWant:null,hudLong:{},tbuff:null,actionOwner:null,tbSetIds:{[base]:skills.map(x=>x.skillId)},tbLvl:{[base]:Object.fromEntries(skills.map(x=>[x.skillId,x.level]))},vipBuff:{char:'AuditHero',actor:'vip-icon-fixture',active:true,until:Date.now()+86400000,set:base,prof,slot:0,t:Date.now()},vipApplied:stale?{char:'AuditHero',actor:'vip-icon-fixture',set:base,slot:0,prof,bundleChecked:true,skills:skills.map(x=>({skillId:x.skillId,level:x.level})),ids:skills.map(x=>x.skillId)}:null}});
   // 20.67: сохранённая подтверждённая связка пережила reload; Magnus уже снят, остальные эффекты класса остались.
   if(remembered){const s=await chrome.storage.local.get(['rt']);await chrome.storage.local.set({rt:{...s.rt,vipApplied:{schema:2,char:'AuditHero',actor:'vip-icon-fixture',set:base,slot:0,prof,bundleChecked:true,baseSkills:skills,greaterIds:[remembered,1323],greaterOptions:[1356,1357,1355,1363,1413,1414],resistIds:[],skills:[...skills,{skillId:remembered,level:1},{skillId:1323,level:1}],ids:[...skills.map(x=>x.skillId),remembered,1323]}}});}
  },{base,prof,branch:tc.branch,stale:!!tc.stale,skills:baseRow.skills,explicit:tc.explicit||0,remembered:tc.remembered||0});
  await h.g.p.goto('https://l2wap.com/map.html?fixture=vip-icon');
  await until(()=>h.g.core('rt.char==="AuditHero"&&!!L2V7Modules.buffs.vipPreferred()'));
  assert.equal(await h.g.core(`Object.keys(hudBuffs()||{}).length`),buffs.length,'полный класс-набор уже висит до Старта');
  await h.g.p.bringToFront();await h.click('start');
  if(tc.stop){
   await until(()=>paused,25000);await until(()=>h.g.core('!on&&!running'));await delay(800);assert.equal(posts.length,0,'Stop до нового подтверждения цены запрещает применение');
  }else if(tc.price){
   await until(()=>posts.length>0,25000);
   assert.equal(rejected,0,'Greater требует skillId; отправлен неверный запрос: '+JSON.stringify(posts));
   await until(()=>catalogCalls>=2,25000);await delay(1200);assert.equal(posts.filter(x=>x.set==='greater').length,1,'новая цена проверяется перед следующей иконкой');assert.ok(posts.every(x=>x.set==='greater'||x.set==='resists'&&x.status===200),'20.43: бесплатные резисты не зависят от цены Greater');
   assert.equal(posts[0].expectedFeeCoinOfLuck,0);assert.equal(posts[0].feeAtRequest,0);await until(()=>h.g.core('!!L2V7Modules.buffs.vipSession()'),15000);assert.equal(await h.g.core('L2V7Modules.buffs.vipSession()?.ready'),false,'неполный эффект не выдаётся за готовую VIP-связку');
   await h.click('stop');
  }else{
   await until(()=>posts.length>0||visits.includes('/town-buffer.html'),25000);
   await until(()=>posts.some(x=>x.status!==200)||buffs.some(b=>b.skillId===tc.want)&&buffs.some(b=>b.skillId===NOBLESSE),25000);
   assert.equal(rejected,0,'Greater требует skillId; отправлен неверный запрос: '+JSON.stringify(posts));
   await until(async()=>{const s=await h.get(['rt']);return s.rt.tbOk&&s.rt.tbuff===null&&h.g.p.url().includes('/map.html')},25000);
   assert.ok(visits.includes('/town-buffer.html'),'настоящий townBuffStart открыл баффера');
   assert.ok(visits.filter(x=>x==='/map.html').length>=2,'после подтверждения эффектов вернулись на карту');
   assert.deepEqual(buffs.filter(b=>GROUP.includes(b.skillId)).map(b=>b.skillId),[tc.want],'один выбранный Greater вместо несовместимого набора');
   assert.ok(buffs.some(b=>b.skillId===NOBLESSE));
   for(const skill of baseRow.skills)assert.ok(buffs.some(b=>b.skillId===skill.skillId&&b.level>=skill.level),'класс-набор сохранён '+skill.skillId);
   // 20.43: бесплатные «resists» из каталога берутся отдельной кнопкой без skillId; основной набор не повторяется.
   assert.ok(posts.every(q=>(q.set==='greater'&&Number.isSafeInteger(q.skillId)||q.set==='resists'&&q.skillId==null)&&q.expectedFeeAdena==='0'&&q.expectedFeeCoinOfLuck===0),'только точные бесплатные icon-запросы и резисты');
   assert.ok(posts.filter(q=>q.set==='resists').length<=1,'резисты не дольше одного запроса');
   assert.deepEqual(posts.filter(q=>q.set==='greater').map(q=>q.skillId).sort((a,b)=>a-b),(tc.existing&&!tc.explicit?[NOBLESSE]:[NOBLESSE,tc.want]).sort((a,b)=>a-b));
   await until(()=>h.g.core('L2V7Modules.buffs.vipSession()?.ready===true'),15000); // возврат создал новый isolated world
   const state=await h.get(['rt']);assert.equal(state.rt.actionPayments?.pending??null,null);
   await h.click('stop');
  }
  assert.deepEqual(h.errors,[]);
  console.log('PASS actual MV3 VIP icons:',tc.name,JSON.stringify({posts:posts.map(x=>({set:x.set,skillId:x.skillId,status:x.status,revision:x.expectedRevision})),catalogCalls,visits,group:buffs.filter(b=>GROUP.includes(b.skillId)).map(b=>b.skillId)}));
 }catch(e){
  console.error('DIAG',tc.name,JSON.stringify({posts,catalogCalls,visits,ids:buffs.map(x=>x.skillId)}),await h.g.core('({on,running,tabOwner,status:rt.status,tbuff:rt.tbuff,owner:rt.actionOwner,vip:rt.vipBuff,applied:rt.vipApplied,need:L2V7Modules.buffs.townBuffNeed(),session:L2V7Modules.buffs.vipSession()})').catch(String));throw e;
 }finally{await h.ctx.close();}
}
(async()=>{for(const tc of cases.filter(x=>!process.env.VIP_ICON_CASE||x.name===process.env.VIP_ICON_CASE))await scenario(tc);})().catch(e=>{console.error(e.stack);process.exitCode=1;});
