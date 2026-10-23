'use strict';
// 20.54 (прогон смоуков 23.10, v1024-raid-ashen-browser): с 20.30 Старт тура сначала заново читает весь список РБ и уходит
// со страницы Ashen Bastion на /rb-bosses.html. Цель выбиралась уже там, по адресу «не Ashen», и платный телепорт отправлялся,
// пока сервер держал героя в Ashen (cityId ashen_bastion) — без штатного выхода в город (правило 15.10).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const file=path.join(__dirname,'v1021-raid-farm-lifecycle.test.js'),source=fs.readFileSync(file,'utf8');
const box={require:require('node:module').createRequire(file),__dirname,console,process};vm.runInNewContext(source.slice(0,source.indexOf("\ntest("))+'\nthis.make=fixture;',box);
const {docOf}=require('./epic-harness.cjs');
const EXIT='<a id="ashen-exit-city" href="/city.html">Вийти в місто (Aden)</a>';
function fixture(o={}){
 const f=box.make({rt:o.rt,env:o.env});f.env.rtCommit=async()=>true;let city=o.city||'ashen_bastion',reads=0;
 f.env.gameGet=async()=>{reads++;return {ok:true,json:async()=>({character:{name:'TestHero',cityId:city,inBattle:false}})}};
 return Object.assign(f,{city:x=>city=x,reads:()=>reads});
}
// Список уже прочитан этим Стартом: тур на шаге выбора, страница — список РБ.
const listed=()=>{const t=Date.now();return {rbListStartRequired:'run-1',rbListReadStart:'run-1',rbListT:t,rbListVerifiedAt:t,rbListIncomplete:false};};

test('свежий список при Старте со страницы Ashen запоминает уход до перехода',async()=>{
 const f=fixture({rt:{rbListStartRequired:'run-1',rbListReadStart:null,rbListIncomplete:true,rbListVerifiedAt:0}});
 f.loc.pathname='/ashen-bastion.html';f.setDoc(docOf(EXIT));
 await f.R.rbHuntStep();
 assert.equal(f.loc.href,'/rb-bosses.html?page=1');assert.ok(f.env.rt.rbHunt.ashenFrom>0,'уход со страницы Ashen не сохранён');assert.equal(f.fires.length,0);
});
test('цель со списка после ухода из Ashen — этап выхода, а не платный перелёт',async()=>{
 const f=fixture({rt:{...listed(),rbHunt:{step:'pick',ashenFrom:Date.now()-5000}}});f.loc.pathname='/rb-bosses.html';
 await f.R.rbHuntStep();
 assert.equal(f.env.rt.rbHunt.step,'exit');assert.equal(f.env.rt.rbHunt.id,'one');assert.equal(f.loc.href,'');assert.equal(f.fires.length,0);
});
test('последний снимок героя игры с cityId ashen_bastion тоже ведёт на выход',async()=>{
 const f=fixture({rt:listed(),env:{heroAt:()=>({char:'TestHero',city:'ashen_bastion',t:Date.now()})}});f.loc.pathname='/rb-bosses.html';
 await f.R.rbHuntStep();
 assert.equal(f.env.rt.rbHunt.step,'exit');assert.equal(f.loc.href,'');
});
test('выход со списка: сервер в Ashen → страница Ashen → штатная ссылка → подтверждённый город → перелёт',async()=>{
 const f=fixture({rt:{...listed(),rbHunt:{step:'pick',ashenFrom:Date.now()-5000}}});f.loc.pathname='/rb-bosses.html';
 await f.R.rbHuntStep();assert.equal(f.env.rt.rbHunt.step,'exit');
 await f.R.rbHuntStep();
 assert.equal(f.loc.href,'/ashen-bastion.html','со списка не открыта страница Ashen');assert.equal(f.fires.length,0);assert.equal(f.env.rt.rbHunt.step,'exit');
 f.loc.href='';f.loc.pathname='/ashen-bastion.html';f.setDoc(docOf(EXIT));
 await f.R.rbHuntStep();assert.equal(f.fires.length,1,'штатный выход не нажат');assert.ok(f.env.rt.rbHunt.exitClickAt>0);
 // Первая загрузка города ещё со старым cityId: обратно в Ashen не уходим.
 f.loc.pathname='/city.html';await f.R.rbHuntStep();assert.equal(f.loc.href,'');assert.equal(f.env.rt.rbHunt.step,'exit');
 f.city('l2dop_aden');f.env.rt.rbHunt.exitReadAt=0;await f.R.rbHuntStep();   // следующая сверка (между ними ≥1,5 с)
 assert.equal(f.env.rt.rbHunt.step,'go');assert.equal(f.env.rt.rbHunt.id,'one');assert.equal(f.env.rt.rbHunt.ashenFrom,null);assert.equal(f.fires.length,1);
});
test('устаревшая метка при герое уже в городе: выход подтверждается сервером без переходов',async()=>{
 const f=fixture({city:'l2dop_giran',rt:{...listed(),rbHunt:{step:'pick',ashenFrom:Date.now()-60000}}});f.loc.pathname='/rb-bosses.html';
 await f.R.rbHuntStep();assert.equal(f.env.rt.rbHunt.step,'exit');
 await f.R.rbHuntStep();
 assert.equal(f.env.rt.rbHunt.step,'go');assert.equal(f.loc.href,'');assert.equal(f.fires.length,0);assert.equal(f.env.rt.rbHunt.ashenFrom,null);
});
test('без метки и без Ashen в снимке героя список ведёт сразу к перелёту, как раньше',async()=>{
 const f=fixture({rt:{...listed(),rbHunt:{step:'pick',ashenFrom:Date.now()-31*60000}}});f.loc.pathname='/rb-bosses.html';
 await f.R.rbHuntStep();
 assert.equal(f.env.rt.rbHunt.step,'go');assert.equal(f.loc.href,'');
});
// 20.54 (ревью прогона смоуков): метка ashenFrom живёт 30 мин. Если герой за это время ушёл не в город l2dop_* (деревня, карта),
// этап выхода раньше ждал «город не подтверждён» до часа. До нажатия выхода свежий ответ «не Ashen» сразу подтверждает этап.
test('устаревшая метка, герой в деревне без l2dop_: этап выхода подтверждается без ожидания и переходов',async()=>{
 const f=fixture({city:'hunters_village',rt:{...listed(),rbHunt:{step:'pick',ashenFrom:Date.now()-60000}}});f.loc.pathname='/rb-bosses.html';
 await f.R.rbHuntStep();assert.equal(f.env.rt.rbHunt.step,'exit');
 await f.R.rbHuntStep();
 assert.equal(f.env.rt.rbHunt.step,'pick');assert.equal(f.loc.href,'');assert.equal(f.fires.length,0);assert.equal(f.env.rt.rbHunt.ashenFrom,null);assert.ok(f.env.rt.rbHunt.ashenOkAt>0);
 await f.R.rbHuntStep();assert.equal(f.env.rt.rbHunt.step,'go');
});
test('то же по истечении минуты этапа выхода (первая сверка опоздала): без перехода на страницу Ashen и без повторов',async()=>{
 const f=fixture({city:'hunters_village',rt:{...listed(),rbHunt:{step:'exit',phase:'exit-ashen',id:'one',name:'Первый',lvl:80,page:1,price:100000,exitAt:Date.now()-61000,exitClickAt:0}}});
 f.loc.pathname='/rb-bosses.html';
 await f.R.rbHuntStep();
 assert.equal(f.env.rt.rbHunt.step,'pick');assert.equal(f.loc.href,'');assert.ok(!f.env.rt.rbHunt.exitMiss);
});
// 20.54 (ревью): сохранённый шаг go (Stop посреди перелёта, герой сам ушёл в Ashen, новый Старт) обходил выбор цели —
// последняя сверка /character перед оплатой видит Ashen: оплату не отправляем, тур идёт на штатный выход.
test('сохранённый шаг go при герое в Ashen: оплата не уходит, тур на этапе выхода',async()=>{
 const page=`<div id="rb-list"><div class="l2-rb-row"><span class="l2-rb-row__label">Первый</span><span class="l2-rb-row__level">80</span><span class="l2-rb-row__status l2-rb-row__status--alive">Живой</span><span class="l2-rb-row__price">100000 аден</span><button class="l2-rb-row__tp" data-spawn-id="one">Телепорт</button></div></div>`;
 const f=fixture({rt:{...listed(),rbHunt:{step:'go',phase:'travel',id:'one',name:'Первый',lvl:80,page:1,price:100000,t:Date.now()}}});
 let city='ashen_bastion',prepared=0;
 f.env.gameGet=async()=>({ok:true,json:async()=>({character:{name:'TestHero',cityId:city,inBattle:false,adena:1000000,revision:5}})});
 // в расширении оплата идёт через payments (квитанции); заглушка пропускает намерение, чтобы проверить сверку героя перед ним
 f.env.payments={prepare:async()=>(prepared++,{id:'p'+prepared}),sent:()=>true,cancel:async()=>{},matchesContext:()=>true,blocked:()=>false,pending:()=>null,confirm:async()=>{},probeDue:()=>false,probeNote:()=>{},unchanged:()=>false};
 const set1=f.env.setRt;f.env.setRt=async p=>(await set1(p),{ok:true});
 f.loc.pathname='/rb-bosses.html';f.loc.search='?page=1';f.setDoc(docOf(page));
 for(let i=0;i<4;i++)await f.R.rbHuntStep();
 assert.equal(f.fires.length,0,'оплата телепорта ушла из Ashen');assert.equal(prepared,0,'намерение оплаты заведено в Ashen');assert.equal(f.env.rt.rbHunt.step,'exit');
 // контроль: тот же шаг go вне Ashen доходит до оплаты
 const g=fixture({rt:{...listed(),rbHunt:{step:'go',phase:'travel',id:'one',name:'Первый',lvl:80,page:1,price:100000,t:Date.now()}}});
 g.env.gameGet=async()=>({ok:true,json:async()=>({character:{name:'TestHero',cityId:'l2dop_aden',inBattle:false,adena:1000000,revision:5}})});
 g.env.payments={prepare:async()=>({id:'q'}),sent:()=>true,cancel:async()=>{},matchesContext:()=>true,blocked:()=>false,pending:()=>null,confirm:async()=>{},probeDue:()=>false,probeNote:()=>{},unchanged:()=>false};
 const set0=g.env.setRt;g.env.setRt=async p=>(await set0(p),{ok:true});   // путь payments ждёт подтверждённую запись
 g.loc.pathname='/rb-bosses.html';g.loc.search='?page=1';g.setDoc(docOf(page));
 for(let i=0;i<4&&!g.fires.length;i++)await g.R.rbHuntStep();
 assert.equal(g.fires.length,1,'контроль: вне Ashen оплата должна уйти');
});
test('после нажатия выхода ответ «не Ashen» без l2dop_ по-прежнему не подтверждает город',async()=>{
 const f=fixture({city:'ashen_bastion',rt:{...listed(),rbHunt:{step:'pick',ashenFrom:Date.now()-5000}}});f.loc.pathname='/ashen-bastion.html';f.setDoc(docOf(EXIT));
 await f.R.rbHuntStep();assert.equal(f.env.rt.rbHunt.step,'exit');
 await f.R.rbHuntStep();assert.equal(f.fires.length,1);assert.ok(f.env.rt.rbHunt.exitClickAt>0);
 f.loc.pathname='/city.html';f.city('');f.env.rt.rbHunt.exitReadAt=0;await f.R.rbHuntStep();
 assert.equal(f.env.rt.rbHunt.step,'exit');assert.equal(f.loc.href,'');
});
test('снимок героя «в Ashen» старше подтверждённого выхода не возвращает тур на этап выхода',async()=>{
 const t=Date.now();
 const f=fixture({rt:{...listed(),rbHunt:{step:'pick',ashenOkAt:t}},env:{heroAt:()=>({char:'TestHero',city:'ashen_bastion',t:t-1000})}});f.loc.pathname='/rb-bosses.html';
 await f.R.rbHuntStep();
 assert.equal(f.env.rt.rbHunt.step,'go');assert.equal(f.loc.href,'');
});
