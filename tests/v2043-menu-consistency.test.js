'use strict';
// 20.43 (разбор 21.10): меню перестаёт противоречить само себе — «Катакомбы», «Автофарм» и «Рыбалка», выбранные в «Задачах бота»,
// видны разделам/Старту/закупке так же, как ядру (taskSel / selectedTask); тексты лимитов и РБ-сессии — как в коде; время сброса суток
// по часам игрока (Владивосток) из /game/time с поправкой, без него — полночь Europe/Kyiv (переход на зимнее время учтён);
// поиск настроек ищет и по пояснениям (title + HELP), результаты из подразделов другого класса помечены и открывают «все классы».
// Старый режим без autoTasks ведёт себя как раньше.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const root=__dirname+'/../',read=f=>fs.readFileSync(root+f,'utf8'),js=read('popup.js'),html=read('popup.html');
const E=require('../engine-core.js'),D=require('../defaults.js');
const cut=(a,b)=>{const i=js.indexOf(a),j=js.indexOf(b,i+1);assert.ok(i>=0&&j>i,'вырезка '+a);return js.slice(i,j);};
const TASKS=cut('const AUTO_TASK_LABELS =','const TASK_OWNED =')+'\n'+cut('function selectedAutoTasks(d) {','function autoTaskPatch(');
const json=x=>JSON.parse(JSON.stringify(x));
const T=iso=>Date.parse(iso);
const clock=(at,skew,next,zone='Europe/Kyiv')=>({serverClock:{at,serverNowMs:at+skew,timeZone:zone,gameDayKey:'x',nextDailyResetAt:next}});

test('сброс суток без serverClock: полночь Киева, летнее/зимнее время, перевод часов внутри суток',()=>{
 assert.equal(new Date(E.dailyResetAt(T('2026-10-24T12:00:00Z'),{})).toISOString(),'2026-10-24T21:00:00.000Z');   // EEST: 00:00 Киева = 21:00 UTC
 assert.equal(E.dailyResetText(T('2026-10-24T12:00:00Z'),{}),'сброс в 07:00 по Владивостоку (через 9 ч)');
 assert.equal(new Date(E.dailyResetAt(T('2026-10-25T12:00:00Z'),{})).toISOString(),'2026-10-25T22:00:00.000Z');   // после 25.10 — EET
 assert.equal(E.dailyResetText(T('2026-10-25T12:00:00Z'),{}),'сброс в 08:00 по Владивостоку (через 10 ч)');
 // сутки 25.10 по Киеву длиннее на час: из 01:00 EEST до следующей полуночи EET ровно 24 ч
 assert.equal(new Date(E.dailyResetAt(T('2026-10-24T22:00:00Z'),{})).toISOString(),'2026-10-25T22:00:00.000Z');
 assert.equal(E.dailyResetText(T('2026-10-24T22:00:00Z'),{}),'сброс в 08:00 по Владивостоку (через 24 ч)');
 // весной сутки короче: 29.03 переход на EEST
 assert.equal(new Date(E.dailyResetAt(T('2026-03-29T00:30:00Z'),{})).toISOString(),'2026-03-29T21:00:00.000Z');
 assert.equal(E.dailyResetText(T('2026-03-29T00:30:00Z'),{}),'сброс в 07:00 по Владивостоку (через 20 ч 30 мин)');
 assert.equal(E.dailyResetText(T('2026-10-21T17:48:00Z'),{}),'сброс в 07:00 по Владивостоку (через 3 ч 12 мин)');
 assert.equal(E.dailyResetText(T('2026-10-21T20:55:30Z'),{}),'сброс в 07:00 по Владивостоку (через 5 мин)');
 // показ совпадает с границей дневного счёта ядра (dailyDay)
 for(const iso of ['2026-10-24T12:00:00Z','2026-10-25T12:00:00Z','2026-03-28T23:00:00Z','2026-07-01T05:00:00Z']){
  const at=E.dailyResetAt(T(iso),{});assert.equal(E.dailyDay(at-1,{}),E.dailyDay(T(iso),{}),iso);assert.notEqual(E.dailyDay(at,{}),E.dailyDay(T(iso),{}),iso);
 }
});
test('сброс суток по /game/time: расхождение часов, устаревший снимок, часы назад',()=>{
 const at=T('2026-10-21T00:00:00Z'),next=T('2026-10-21T21:00:00Z');
 // часы компьютера на 2 мин отстают от сервера — сброс наступит раньше по своим часам
 assert.equal(E.dailyResetAt(at,clock(at,120000,next)),next-120000);
 assert.equal(E.dailyResetText(at,clock(at,120000,next)),'сброс в 06:58 по Владивостоку (через 20 ч 58 мин)');
 assert.equal(E.dailyResetText(at+3600000,clock(at,0,next)),'сброс в 07:00 по Владивостоку (через 20 ч)');   // экстраполяция serverNow + (now − at)
 // снимок прошлых суток: следующий сброс — полночь его часового пояса после serverNow
 assert.equal(new Date(E.dailyResetAt(T('2026-10-22T03:00:00Z'),clock(at,0,next))).toISOString(),'2026-10-22T21:00:00.000Z');
 // часы ушли назад (now < at) — запасная полночь Киева
 assert.equal(E.dailyResetAt(at-60000,clock(at,0,next+3600000)),T('2026-10-21T21:00:00Z'));
 // неизвестная зона в снимке не ломает показ
 assert.equal(E.dailyResetAt(T('2026-10-22T03:00:00Z'),clock(at,0,next,'Bad/Zone')),T('2026-10-22T21:00:00Z'));
 assert.equal(E.dailyResetAt(at,{serverClock:null}),T('2026-10-21T21:00:00Z'));
});
test('«Лимиты» и доска задач: время сброса и остаток вместо «до 00:00»',()=>{
 const els={},$=id=>els[id]||(els[id]={}),ctx={$,Date,L2EngineCore:E};
 vm.runInNewContext(cut('const dailyLimitKeys=','for(const task of Object.keys(dailyLimitKeys))'),ctx);
 const day=E.dailyDay(),rt={dailyQuota:{day,auto:10,fish:3}};
 ctx.renderDailyLimits(rt,{dailyKillLimit:10,dailyFishLimit:5});
 assert.match(els.dailyLimitsDay.textContent,/^Сегодня: \d{4}-\d\d-\d\d · время сервера · сброс в \d\d:\d\d по Владивостоку \(через [^)]+\)$/);
 assert.match(els.mobsDailyProgress.textContent,/^10 \/ 10 .* · сброс в \d\d:\d\d по Владивостоку \(через [^)]+\)$/);
 assert.equal(els.fishDailyProgress.textContent,'3 / 5 · осталось 2');
 assert.ok(!js.includes("label = 'До 00:00 сервера'")&&!js.includes("' · до 00:00'"),'прежние «до 00:00» убраны из показа');
 const board={L2EngineCore:E,Date,Math,Object,Array,Set,currentMode:()=>'fish'};vm.runInNewContext(cut('const AUTO_TASK_LABELS =','let autoTaskEditQueue ='),board);
 const now=T('2026-10-21T17:48:00Z'),q={dailyQuota:{day:'2026-10-21',fish:5,auto:8000}};
 const rows=json(board.taskBoardRows(q,{autoTasks:['fish','auto'],dailyFishLimit:5,dailyKillLimit:8000},{on:true},now));
 assert.equal(rows[0].label,'Ждёт сброса суток');assert.equal(rows[0].state,'waiting');assert.match(rows[0].progress,/сброс в 07:00 по Владивостоку \(через 3 ч 12 мин\)$/);
 assert.equal(rows[1].label,'Ждёт сброса суток');assert.match(rows[1].progress,/сброс в 07:00 по Владивостоку \(через 3 ч 12 мин\)$/);
 assert.match(board.dailyMobBoardRow(q,{dailyKillLimit:8000},now).progress,/осталось 0 · сброс в 07:00 по Владивостоку \(через 3 ч 12 мин\)$/);
 assert.match(board.dailyFishBoardRow(q,{dailyFishLimit:5},now).progress,/\/ 5 · осталось 0 · сброс в 07:00 по Владивостоку \(через 3 ч 12 мин\)$/);
 // лимит не достигнут — строки прежние
 assert.doesNotMatch(board.dailyMobBoardRow({dailyQuota:{day:'2026-10-21',auto:10}},{dailyKillLimit:8000},now).progress,/сброс/);
 assert.doesNotMatch(json(board.taskBoardRows({},{autoTasks:['fish'],dailyFishLimit:5},{on:true},now))[0].progress,/сброс/);
});
test('«Катакомбы»: строка состояния по списку задач, старый режим — по catMode',()=>{
 const els={},ctx={$:id=>els[id]||(els[id]={}),renderSeal:()=>{},CAT_NM:{necropolis_of_sacrifice:['Necropolis of Sacrifice',20,30]},Date,Object,Array,Set};
 vm.runInNewContext(TASKS+'\n'+cut('function renderCat(','// ---------- 7.2.1'),ctx);
 const box=d=>{ctx.renderCat({},d);return els.catBox.textContent;};
 assert.match(box({autoTasks:['cat','tvt'],catMode:false}),/Цель выберу по уровню героя/);     // выбрано в «Задачах бота», флага нет
 assert.equal(box({autoTasks:['fish'],catMode:true}),'Выключено');                              // старый флаг без задачи не включает
 assert.match(box({catMode:true}),/Цель выберу/);assert.equal(box({catMode:false}),'Выключено');   // без списка задач — как раньше
 assert.match(html.split('id="tab-dungeon"')[1].split('subsec-title')[0],/Включается в «Задачах бота».*или переключателем «Фармить в подземелье»/);
 assert.ok(!html.includes('Включение производится только переключателем'));
});
function shopCtx(store){
 const writes=[],els={},ctx={DEF:D.CFG,L2EngineCore:E,Date,Object,Array,Set,JSON,toast:()=>{},save:async()=>{},$:id=>els[id]||(els[id]={}),
  menuPatch:async(rt,opts={})=>{writes.push(json({rt,opts}));if(opts.cfgPatch)store.cfg={...store.cfg,...opts.cfgPatch};},
  chrome:{storage:{local:{get:async()=>json(store),set:async x=>Object.assign(store,x)}}}};
 vm.createContext(ctx);vm.runInContext(TASKS,ctx);return {ctx,writes,els};
}
test('«Закупить сейчас» возвращает на рыбалку, когда рыбалка — текущая задача; старый режим — по fishMode',async()=>{
 const back=async(cfg,rt={})=>{const f=shopCtx({cfg,rt,on:true});vm.runInContext(cut('async function shopNowGo() {',"$('shopNow').onclick"),f.ctx);await f.ctx.shopNowGo();return f.writes[0].rt.shop.back;};
 assert.equal(await back({autoTasks:['fish','tvt']}),'/fishing.html');
 assert.equal(await back({autoTasks:['raid','fish']}),'/map.html');                                   // сейчас тур РБ — назад на карту, как ядро
 assert.equal(await back({autoTasks:['fish','cat'],dailyFishLimit:5},{dailyQuota:{day:E.dailyDay(),fish:5}}),'/map.html');   // рыба на сегодня всё
 assert.equal(await back({autoTasks:['cat'],fishMode:true}),'/map.html');                               // устаревший флаг без задачи
 assert.equal(await back({fishMode:true}),'/fishing.html');assert.equal(await back({fishMode:false}),'/map.html');assert.equal(await back({}),'/map.html');
});
test('Старт и быстрый запуск: «Автофарм» из задач сразу будит подбор зоны; старый режим — по zoneAuto',async()=>{
 const start=async(cfg,quick)=>{
  const store={cfg,rt:{char:'Hero'},on:false},f=shopCtx(store);
  Object.assign(f.ctx,{formChar:'Hero',showWakeResult:async()=>{}});
  vm.runInContext(cut('let controlGeneration = 0;','async function botControl('),f.ctx);
  await(quick?f.ctx.quickStart(quick):f.els.start.onclick());
  const w=f.writes.find(x=>x.opts.on===true);assert.ok(w,'Старт записан');return w.rt;
 };
 let rt=await start({autoTasks:['auto','tvt'],zoneAuto:false});assert.ok(rt.zoneAutoKick>0);assert.equal(rt.zoneGoT,0);assert.equal(rt.zoneLvlT,0);
 rt=await start({autoTasks:['fish'],zoneAuto:true});assert.equal(rt.zoneAutoKick,undefined);                  // устаревший zoneAuto без задачи
 rt=await start({autoTasks:['farm']},'auto');assert.ok(rt.zoneAutoKick>0);                                    // быстрый запуск «Автофарм»
 rt=await start({autoTasks:['auto']},'fish');assert.equal(rt.zoneAutoKick,undefined);                          // быстрый запуск снял автофарм
 rt=await start({zoneAuto:true});assert.ok(rt.zoneAutoKick>0);rt=await start({zoneAuto:false});assert.equal(rt.zoneAutoKick,undefined);rt=await start({});assert.equal(rt.zoneAutoKick,undefined);
 assert.equal(rt.sinceDeep,999);assert.equal(rt.campaignDue,true);
});
test('тексты меню совпадают с кодом: заводские лимиты, конец РБ-сессии, сброс суток',()=>{
 const limits=html.split('<section id="tab-limits">')[1].split('</section>')[0];
 assert.ok(!/8434|9119/.test(limits),'старый заводской диапазон убран');
 assert.ok(limits.includes(`заводская настройка — ${D.DAILY_KILL_DEF} мобов в сутки и диапазон ${D.DAILY_RANGE.min}–${D.DAILY_RANGE.max} рыбы`));
 assert.match(limits,/Сброс суток — в 00:00 по времени сервера \(Киев; по Владивостоку это 07:00, а после перехода Киева на зимнее время — 08:00\)/);
 assert.ok(!/до 00:00,/.test(limits));
 const sess=html.split('Фулл бафф за FA: РБ-сессия')[1].split('id="rbSessBox"')[0];
 assert.match(sess,/«Тур по РБ» снимается из выбранных задач, остальные выбранные задачи продолжаются \(без списка задач — прежний режим «Автофарм»\)/);
 const raid=read('modules/raid.js');assert.ok(raid.includes("«Тур РБ» снят из выбранных задач")&&raid.includes("режим «Автофарм», жду игрока"),'подсказка описывает обе ветки rbSessEnd');
});
test('горячие клавиши разделов: подсказки кнопок совпадают с тем, что открывает Alt+N',()=>{
 // 20.71: отдельная кнопка Rebirth не сдвигает прежние Alt+1…0; проверяем фактическую таблицу обработчика.
 const nav=html.split('<nav id="moduleNav"')[1].split('</nav>')[0],btn=[...nav.matchAll(/<button([^>]*)>/g)].map(m=>m[1]);
 const m=js.match(/const tab = (\[[^\n]+?\])\[n - 1\]; if \(tab\) showTab\(tab\);/);assert.ok(m,'таблица Alt+N найдена');
 const tabs=vm.runInNewContext(m[1]);assert.deepEqual(Array.from(tabs),['overview','hunt','craft','rb','panel','enchant','fish','mammon','lifestone','pvp']);
 btn.forEach(b=>{const key=b.match(/\(Alt\+(\d)\)"/),tab=b.match(/data-tab="([^"]+)"/);if(key){assert.ok(tab,b);assert.equal(tabs[(+key[1]||10)-1],tab[1],b);}});
 assert.ok(btn.find(b=>/data-tab="rebirth"/.test(b)&&!/\(Alt\+/.test(b)),'отдельная кнопка не отнимает прежнюю клавишу');
});
test('поиск: по пояснению — ниже совпадений по названию; карточки другого класса помечены и открывают «все классы»',async()=>{
 const els={uiSearch:{value:''},uiResults:{classList:{add(){},remove(){}},innerHTML:''}};let showAll=0;
 const ctx={$:id=>els[id]||(els[id]={}),esc:t=>String(t),showAllCls:false,showTab:()=>{},revealEl:()=>{},setTimeout:()=>{},
  getComputedStyle:el=>({display:el.hide?'none':'block'}),globalThis:{}};
 els.showAllCls={onclick:async()=>{showAll++;ctx.showAllCls=true;}};
 vm.createContext(ctx);vm.runInContext(cut('const searchHelp =','function searchIndex()')+'\n'+cut('let IDX = null','$(\'uiSearch\').addEventListener(\'input\''),ctx);
 const el=(o={})=>({nodeType:1,parentElement:null,dataset:{},scrollIntoView(){},classList:{remove(){},add(){}},querySelector:()=>null,...o});
 const fighter=el({dataset:{cls:'fighter'},hide:true}),inFighter=el({parentElement:fighter});
 vm.runInContext('IDX=[]',ctx);
 ctx.IDXset=x=>{ctx.__x=x;vm.runInContext('IDX=__x',ctx);};
 ctx.IDXset([
  {el:el(),tab:'mammon',text:'⚒ Улучшать вещь-цель у кузнеца',where:'Маммон',kind:'',help:'Тратит Coin of Luck'},
  {el:el(),tab:'rb',text:'Coin of Luck на эпика',where:'РБ и эпики',kind:'',help:''},
  {el:inFighter,tab:'panel',text:'Атака',where:'Бой › Воин',kind:'',help:'удары воина'},
 ]);
 els.uiSearch.value='coin';ctx.runSearch();
 const hits=json(els.uiResults._hits);assert.deepEqual(hits.map(h=>h.text),['Coin of Luck на эпика','⚒ Улучшать вещь-цель у кузнеца']);
 assert.equal(hits[0].byHelp,undefined);assert.equal(hits[1].byHelp,true);assert.match(els.uiResults.innerHTML,/Маммон · по пояснению/);
 els.uiSearch.value='воин';ctx.runSearch();assert.equal(els.uiResults._hits[0].otherCls,true);assert.match(els.uiResults.innerHTML,/Атака <span class="other-cls">\(для другого класса\)<\/span>/);
 await ctx.goTo(els.uiResults._hits[0]);assert.equal(showAll,1,'переход включил «все классы»');
 ctx.showAllCls=true;await ctx.goTo(els.uiResults._hits[0]);assert.equal(showAll,1,'уже показаны — не переключает обратно');
 els.uiSearch.value='кузнец';ctx.runSearch();assert.equal(els.uiResults._hits[0].otherCls,false);assert.doesNotMatch(els.uiResults.innerHTML,/другого класса|по пояснению/);
 // title поля и HELP ui-v7 идут в пояснение; служебная подсказка кнопки «i» — нет
 const label=el({getAttribute:k=>k==='title'?'Свой список FA не покупать':null,querySelectorAll:()=>[{getAttribute:()=>'подсказка поля'}],querySelector:()=>({id:'catNoFa'})});
 ctx.globalThis.L2V7Help={catNoFa:'пояснение HELP'};assert.equal(vm.runInContext('searchHelp',ctx)(label),'Свой список FA не покупать подсказка поля пояснение HELP');
 assert.match(js,/querySelectorAll\?\.\('\[title\]:not\(\.inline-info\)'\)/);
});
test('кнопка «i» из title: только сенсорный экран/вкладка Android, на ПК скрыта; title остаётся',()=>{
 const ui=read('ui-v7.js'),css=read('ui-v7.css');
 assert.match(ui,/document\.querySelectorAll\('section label\[title\]'\)\.forEach\(label=>\{/);
 assert.match(ui,/tip\.className='inline-info'\+\(auto\?' auto-info':''\)/);assert.ok(!/removeAttribute\('title'\)/.test(ui),'title для ПК не снимается');
 assert.match(ui,/globalThis\.L2V7Help=Object\.freeze\(\{\.\.\.HELP\}\)/);
 assert.match(css,/\.inline-info\.auto-info\{display:none!important\}/);
 assert.match(css,/@media \(hover:none\)\{\.inline-info\.auto-info\{display:inline-grid!important\}\}/);
 assert.match(css,/html\.tabbed \.inline-info\.auto-info\{display:inline-grid!important\}/);
 // пояснения, ради которых это сделано, действительно в title подписанных полей
 for(const id of ['catNoFa','epicFaFull','mmTpMax','mmUpgrade']){const m=html.match(new RegExp('<label[^>]*title="([^"]+)"[^>]*>[^<]*(?:<[^>]+>[^<]*)*?<(?:input|select)[^>]*id="'+id+'"'));assert.ok(m,id);}
});
