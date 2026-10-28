'use strict';
// 20.76+ (ревизия 28.10, участок combat): две подтверждённые находки.
// 1) potSlotRestore не узнавал усиленные «Велике зілля HP/MP» (#920044/#920045) и «Зілля слабкого зцілення» — при пустом слоте
//    и только таких банках в сумке бот писал «в сумке их тоже нет» и бился без банок.
// 2) emergencyBuffStep: отказ сервера «недоступно» держал аварийный бафф лишь 5 с — при низком HP тот же бафф снова уходил на отказ.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),combat=fs.readFileSync(path.join(root,'modules/combat.js'),'utf8');

// ---------- 1: возврат банки на панель — настоящий модуль combat, подставное окно выбора слота ----------
function potBox(titles){
 const recs=[],fired=[];let modal=false;
 const empty={title:'Порожній слот 4',isConnected:true,classList:{contains:c=>c==='l2-battle-hotbar-slot--empty'}};
 const tab={classList:{contains:()=>true}},picks=titles.map(title=>({title}));
 const env={rt:{},cfg:{},SLOT:'.slot',TAG:'test',setRt:p=>{Object.assign(env.rt,p);return Promise.resolve()},rec:(...a)=>recs.push(a.join(' | ')),shown:el=>!!el,
  $q:s=>s==='.l2-battle-hotbar-modal #l2-bh-modal-tabs'||s==='.l2-battle-hotbar-modal__panel'?(modal?{}:null):s==='.l2-battle-hotbar-tab[data-tab-key="consumable"]'?tab:null,
  fire:b=>{fired.push(b.title);if(b===empty)modal=true;else if(picks.includes(b))modal=false;return true},
  waitFor:async fn=>fn(),sleep:async()=>{}};
 const document={querySelectorAll:s=>s==='.l2-battle-hotbar-slot--empty'?[empty]:s==='.l2-battle-hotbar-pick'?(modal?picks:[]):[],
  querySelector:s=>s==='.l2-battle-hotbar-pick'?(modal?picks[0]||null:null):null};
 const box={console:{log(){},info(){},warn(){}},URLSearchParams,Date,Math,setTimeout,location:{pathname:'/battle.html',search:''},
  sessionStorage:{getItem:()=>null,setItem:()=>{}},document};
 vm.createContext(box);vm.runInContext(combat,box);
 return {c:box.L2V7Factories.combat(env),recs,fired:()=>fired.filter(t=>t!==empty.title)};
}
test('пустой слот HP, в сумке только «Велике зілля HP» — ставит её, а не «в сумке их тоже нет»',async()=>{
 const p=potBox(['Велике зілля HP ×40']);
 assert.equal(await p.c.potSlotRestore('hp'),true);
 assert.deepEqual(p.fired(),['Велике зілля HP ×40']);
 assert.ok(p.recs.some(x=>/поставил «Велике зілля HP» \(×40\)/.test(x)),p.recs.join('\n'));
 assert.ok(!p.recs.some(x=>/в сумке их тоже нет/.test(x)));
});
test('пустой слот MP (маг), в сумке только «Велике зілля MP» — ставит её',async()=>{
 const p=potBox(['Велике зілля MP ×77']);
 assert.equal(await p.c.potSlotRestore('mp'),true);assert.deepEqual(p.fired(),['Велике зілля MP ×77']);
});
test('обычная и усиленная HP-банка: усиленная первой (18.10), даже при меньшем запасе',async()=>{
 const p=potBox(['Зілля зцілення ×990','Велике зілля HP ×11']);
 await p.c.potSlotRestore('hp');assert.deepEqual(p.fired(),['Велике зілля HP ×11']);
 const m=potBox(['Зілля мани (велика банка) ×1024','Велике зілля MP ×5']);
 await m.c.potSlotRestore('mp');assert.deepEqual(m.fired(),['Велике зілля MP ×5']);
});
test('HP-выбор не берёт банки маны и CP; MP-выбор не берёт HP',async()=>{
 const p=potBox(['Велике зілля MP ×77','Зілля мани (велика банка) ×1024','Велике зілля CP ×12']);
 assert.equal(await p.c.potSlotRestore('hp'),false);assert.deepEqual(p.fired(),[]);
 assert.ok(p.recs.some(x=>/в сумке их тоже нет/.test(x)));
 const m=potBox(['Велике зілля HP ×40','Зілля зцілення ×990']);
 assert.equal(await m.c.potSlotRestore('mp'),false);assert.deepEqual(m.fired(),[]);
});
test('подпись до загрузки каталога «#920044 — зілля …» и «Зілля слабкого зцілення» узнаются как HP',async()=>{
 const p=potBox(['#920044 — зілля ×3']);await p.c.potSlotRestore('hp');assert.deepEqual(p.fired(),['#920044 — зілля ×3']);
 const w=potBox(['Зілля слабкого зцілення ×10']);await w.c.potSlotRestore('hp');assert.deepEqual(w.fired(),['Зілля слабкого зцілення ×10']);
 const m=potBox(['#920045 — зілля ×4']);await m.c.potSlotRestore('mp');assert.deepEqual(m.fired(),['#920045 — зілля ×4']);
});
test('прежние обычные банки по-прежнему ставятся: среди обычных HP — больший запас, у маны — «велика банка»',async()=>{
 const p=potBox(['Зілля зцілення ×20','Зілля сильного зцілення ×500']);await p.c.potSlotRestore('hp');assert.deepEqual(p.fired(),['Зілля сильного зцілення ×500']);
 const o=potBox(['Зілля зцілення ×990']);assert.equal(await o.c.potSlotRestore('hp'),true);assert.deepEqual(o.fired(),['Зілля зцілення ×990']);
 const m=potBox(['Зілля мани ×5','Зілля мани (велика банка) ×3']);await m.c.potSlotRestore('mp');assert.deepEqual(m.fired(),['Зілля мани (велика банка) ×3']);
});

// ---------- 2: аварийный бафф с отказом «недоступно» — шаг боя из исходника (как v2013 act()) ----------
const emSrc=combat.slice(combat.indexOf('  async function emergencyBuffStep('),combat.indexOf('  // шаг: отход от чемпиона'));
function emBox(results){
 let now=1_000_000;const acts=[],recs=[],frenzy={title:'Frenzy'};
 const sb={Date:{now:()=>now},NEXT:'next',AGAIN:'again',NOMP_MS:1500,lastHpPot:0,ctx:{block:{},rb:null,refuseText:''},
  env:{cfg:{nKeyBuffs:'frenzy',nBuffs:''},rt:{},names:s=>String(s||'').split(',').map(x=>x.trim()).filter(Boolean),ilOf:()=>({id:176,pc:{hp:30}}),
   buffActive:()=>false,hpPotPick:()=>null,cleanTitle:s=>String(s||''),setRt:()=>Promise.resolve(),rec:(...a)=>recs.push(a.join(' | '))},
  slotsBy:()=>[frenzy],ready:()=>true,affordable:()=>true,noticeText:()=>'',
  act:async(b,why)=>{acts.push(why);const r=results.shift();sb.ctx.refuseText=r==='unavail'?'Цей скилл зараз недоступний':'';return r;}};
 vm.runInNewContext(emSrc+'\nthis.step=emergencyBuffStep;',sb);
 const me={cur:200,max:1000,pct:20},mp={cur:500,max:500,pct:100};
 return {step:()=>sb.step(me,mp,{cur:500,max:1000}),sb,acts,recs,adv:ms=>{now+=ms},now:()=>now};
}
test('отказ «недоступно» на аварийном баффе — запрет до конца боя и причина в журнале, повтора через 5 с нет',async()=>{
 const e=emBox(['unavail',true]);
 assert.equal(await e.step(),'again');assert.equal(e.acts.length,1);
 assert.equal(e.sb.ctx.block['buff:frenzy'],Infinity);
 assert.ok(e.recs.some(x=>/недоступно \| аварийный бафф «Frenzy»: Цей скилл зараз недоступний — до конца боя/.test(x)),e.recs.join('\n'));
 e.adv(6000);
 assert.equal(await e.step(),'next','через 6 с бафф не выбирается');assert.equal(e.acts.length,1,'второго нажатия нет');
});
test('прежние ветки аварийного баффа не изменились: lock — повтор сразу, nomp — пауза слота, true — buffAt',async()=>{
 const l=emBox(['lock']);await l.step();assert.equal(l.sb.ctx.block['buff:frenzy'],0);assert.equal(l.recs.length,0);
 const n=emBox(['nomp']);await n.step();assert.equal(n.sb.ctx.block['buff:frenzy'],n.now()+1500);
 const t=emBox([true]);let saved=null;t.sb.env.setRt=p=>{saved=p;return Promise.resolve()};await t.step();
 assert.equal(saved.buffAt.frenzy,t.now());assert.equal(t.sb.ctx.block['buff:frenzy'],t.now()+5000);
 const f=emBox([false]);await f.step();assert.equal(f.sb.ctx.block['buff:frenzy'],f.now()+5000,'обычный отказ без ответа — прежние 5 с');
});
