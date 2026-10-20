'use strict';
// 20.13 (ревизия 17.10, шаг 7, участок combat): находки «Код» C3, C4, C6, C7, C8, C11, C12.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const combat=read('modules/combat.js'),content=read('content.js');
const {flowFixture}=require('./warlock-combat-fixture.cjs');

// ---------- C3: тоггл — состояние только по сработавшему нажатию, выключение без проверки MP ----------
function toggleBox(state,mp={cur:20,max:500}){
 const b={title:'Vicious Stance'},writes=[],recs=[];
 const box={cfg:{nToggles:'vicious stance',toggleMpOff:10,toggleMpOn:30},rt:{},names:s=>String(s||'').split(',').map(x=>x.trim()).filter(Boolean),
  meMp:()=>mp,slotsBy:()=>[b],toggleState:()=>state,ilOf:()=>null,activeBuffs:()=>[],uiReady:()=>true,cleanTitle:s=>s,noticeText:()=>'',
  setRt:async p=>{writes.push(p);Object.assign(box.rt,p)},rec:(...a)=>recs.push(a.join(' | ')),Date};
 vm.runInNewContext(content.slice(content.indexOf('async function toggleStep('),content.indexOf('// ---------- 🩺'))+'\nthis.step=toggleStep;',box);
 return {box,b,writes,recs};
}
for(const r of ['lock',false,'cd','noforce'])test(`тоггл: ответ act ${String(r)} не пишет состояние «выключен»`,async()=>{
 const t=toggleBox(true),ctx={block:{}};let args=null;
 assert.equal(await t.box.step(ctx,{},async(...a)=>{args=a;return r;}),true);
 assert.equal(t.writes.length,0,'нет записи toggleOn/toggleOff');assert.equal(t.recs.length,0);
 assert.equal(args[4],true,'выключение — act без проверки цены MP');
 if(r==='lock')assert.equal(ctx.block['tgl:vicious stance'],0,'потерянный клик — повтор сразу');
 else assert.ok(ctx.block['tgl:vicious stance']>Date.now(),'иначе пауза слота 4 с');
});
test('тоггл: сработавшее выключение пишет состояние; включение проверяет MP как раньше',async()=>{
 const t=toggleBox(true);assert.equal(await t.box.step({block:{}},{},async()=>true),true);
 assert.equal(t.box.rt.toggleOff['vicious stance'],true);assert.equal(t.box.rt.toggleOn['vicious stance'],false);
 const on=toggleBox(false,{cur:400,max:500});let args=null;await on.box.step({block:{}},{},async(...a)=>{args=a;return true;});
 assert.equal(args[4],false,'включение — с проверкой цены');assert.equal(on.box.rt.toggleOn['vicious stance'],true);
});

// ---------- act(): стенд из исходника (как v803-clicklock) ----------
const actSrc=combat.slice(combat.indexOf('  let lastHpPot = 0, lastMpPot = 0'),combat.indexOf('  const t0 = Date.now();\n  let progSig'));
const consts=combat.match(/const LOCK_A = \[60, 500, 120\], LOCK_B = \[30, 200, 50\];/)[0]+'\nconst NOMP_MS = 1500;';
function actBox({net,gameEnd=0,send=false,mp=null,cost=0}){
 let now=1_000_000;const fired=[];
 const env={cfg:{nDrain:''},names:()=>[],on:true,tabOwner:true,isBattle:()=>true,rt:{},setRt:async()=>{},
  gameBusy:()=>({busy:false,end:gameEnd}),meMp:mp?()=>mp:undefined,skillMp:()=>cost,
  combatCooldown:{globalWait:()=>0,skillWait:()=>0,recentlyGlobalRejected:()=>false},slotAction:()=>'l2_1220',cdSpawn:()=>'sp',battleSpawn:()=>'sp',
  observeSlot:()=>{},actNet:()=>net,fire:b=>{fired.push(b.title);if(send){net.start++;net.done++;net.ok=true;net.action='l2_1220';}return true;},
  sleep:async ms=>{now+=ms;},waitFor:async(fn,ms)=>{const r=fn();if(!r)now+=ms;return r;},setStatus:()=>{},skKey:()=>'blaze',
  slotCd:()=>({}),petState:()=>null,pause:async()=>{},rnd:a=>a,rec:()=>{},TAG:'',cleanTitle:s=>s,memLeft:()=>0,FORCE_NEED:/x^/,UNAVAIL:/x^/,CD_RE:/x^/,
  slotKind:()=>'скилл',ilOf:()=>({}),noEffect:()=>false};
 const sb={env,Date:{now:()=>now},Math,Map,Number,console,ctx:{pet:null,block:{}},lostUntil:new Map(),mpUntil:new Map(),pressAt:new Map(),victory:()=>false,defeat:()=>false,noticeText:()=>'',
  uiReady:()=>true,mobHp:()=>({cur:100}),rememberCd:async()=>{},mageCombat:()=>true,healSlot:()=>false,slotsBy:()=>[],drainBackoff:()=>{},
  affordable:(b,m,r=1)=>!m||m.cur>=cost+(cost>0?r:0)};
 vm.runInNewContext(`${consts}\n${actSrc}\nthis.act = act;`,sb);
 return {sb,fired,now:()=>now};
}
test('C3: act с mpFree жмёт выключение тоггла при MP ниже цены; без флага — nomp',async()=>{
 const a=actBox({net:{start:1,done:1,doneT:1},send:true,mp:{cur:5,max:500},cost:40});
 assert.equal(await a.sb.act({title:'Stance'},'off'),'nomp');assert.equal(a.fired.length,0);
 const b=actBox({net:{start:1,done:1,doneT:1},send:true,mp:{cur:5,max:500},cost:40});
 assert.equal(await b.sb.act({title:'Stance'},'off',false,null,true),true);assert.deepEqual(b.fired,['Stance']);
});
// ---------- C11: первый потерянный клик на свежей странице боя ----------
test('C11: счётчик ходов 0, но хук живой (конец запроса игры) — потерянный клик распознан: слот занят 0,7 с, а не 3 с',async()=>{
 const a=actBox({net:{start:0,done:0,doneT:0},gameEnd:1_000_000-5000});
 assert.equal(await a.sb.act({title:'Blaze'},'Blaze'),false);
 assert.equal(a.sb.ctx.lastLost,true,'вызывающий ставит паузу 0,7 с');
 assert.ok((a.sb.lostUntil.get('blaze')||0)>a.now(),'слот «занят» коротко');
});
test('C11: без признаков хука на свежей странице — прежнее поведение (по рисунку отката)',async()=>{
 const a=actBox({net:{start:0,done:0,doneT:0},gameEnd:0});
 await a.sb.act({title:'Blaze'},'Blaze');
 assert.equal(a.sb.ctx.lastLost,false);assert.equal(a.sb.lostUntil.get('blaze'),undefined);
});

// ---------- C4: кубики — не слуги ----------
test('C4: Summon Life Cubic не делает бой «с котом» и не жмётся как призыв кота',async()=>{
 const f=flowFixture('fighter'),cubic={title:'Summon Life Cubic',getAttribute:()=>null};f.slots.push(cubic);f.env.cfg.petAuto=true;
 assert.equal(f.combat.summonCombat(),false);
 assert.equal(f.combat.petPick([cubic],''),null);
 await f.combat.battle();
 assert.ok(!f.events.includes('Summon Life Cubic'),JSON.stringify(f.events));assert.equal(f.env.rt.kills,1);
});
test('C4: настоящий призыв слуги по-прежнему узнаётся',()=>{
 const f=flowFixture('fighter'),panther={title:'Summon Dark Panther',getAttribute:()=>null},cubic={title:'Summon Storm Cubic',getAttribute:()=>null};
 f.slots.push(cubic,panther);assert.equal(f.combat.summonCombat(),true);assert.equal(f.combat.petPick([cubic,panther],''),panther);
});

// ---------- C6: причина пропуска агро Warlord ----------
test('C6: причина пропуска агро — в итоге боя, без повтора той же причины 10 мин; сбор состоялся — не пишем',()=>{
 const f=flowFixture('fighter'),logs=f.logs,agro=()=>logs.filter(x=>x.startsWith('B | агро')).length;
 assert.equal(f.combat.warlordSkipNote({warlordPullWhy:'мало HP для сбора группы'},1000),true);assert.equal(agro(),1);
 assert.equal(f.combat.warlordSkipNote({warlordPullWhy:'мало HP для сбора группы'},1000+60000),false,'та же причина через минуту — тихо');
 assert.equal(f.combat.warlordSkipNote({warlordPullWhy:'не подтверждена надетая пика'},1000+61000),true,'новая причина — сразу');
 assert.equal(f.combat.warlordSkipNote({warlordPullWhy:'не подтверждена надетая пика'},1000+61000+600001),true,'через 10 мин — снова');
 assert.equal(f.combat.warlordSkipNote({warlordPullWhy:'x',warlordPull:{target:'t',follow:false}},5e9),false,'сбор был — причину не пишем');
 assert.equal(agro(),3);
 assert.doesNotMatch(combat,/warlordPullNoted/,'на первом тике боя больше не пишем');
});

// ---------- C7/C8: исходник ----------
test('C7: словарь навыков берётся один раз на функцию; C8: мёртвый spikeFar убран',()=>{
 assert.ok(combat.split('(env.damageSkills || env.rt.skills)').length-1<=1,'не больше одного прямого обращения вне skillView');
 assert.match(combat,/const skillView = \(\) => env\.damageSkills \|\| env\.rt\.skills;/);
 assert.doesNotMatch(combat,/const spikeFar|spikeFar \?/);
});

// ---------- разрез battle на шаги: порядок проверок круга прежний ----------
test('battle: шаги круга вызываются в прежнем порядке, сторожа и банки — между ними на своих местах',()=>{
 const b=combat.slice(combat.indexOf('async function battle() {'),combat.indexOf('  // ---------- шаги круга боя'));
 const order=['epicRetreatWait(','const me = env.meHp()','{ const g = env.actNet?.().gone;','{ const an = env.actNet?.(), hangMs','mainTargetDead(','emergencyBuffStep(','champFleeStep(',
  'if (ctx.rb && me && mob && !ctx.rb.retreated)','if (me && me.pct <= Math.max(env.cfg.stopHp, 25))','ctx.emWait = 0;','exitCheckStep(','stallStep(','await env.keepShots();','petStep(','healStep(',
  'let potAt = env.cfg.hpPotAt;','const hpPot = me && me.pct <= potAt','mpPotStep(','petBuffStep(','buffStep(','debuffStep(','strikeStep(','idleStep(','await env.sleep(100);','return battleWin('];
 let at=-1;for(const m of order){const i=b.indexOf(m,at+1);assert.ok(i>at,'порядок: '+m);at=i;}
 for(const n of ['epicRetreatWait','mainTargetDead','emergencyBuffStep','champFleeStep','exitCheckStep','stallStep','petStep','healStep','mpPotStep','petBuffStep','buffStep','debuffStep','strikeStep','idleStep'])
  assert.match(combat,new RegExp('\\n  async function '+n+'\\('),n);
 assert.match(combat,/\nasync function battleOpen\(\) \{/);assert.match(combat,/\nasync function battleWin\(ctx, t0, spawnId, strength, countExtras\) \{/);
});
