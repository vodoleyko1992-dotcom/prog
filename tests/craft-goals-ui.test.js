'use strict';
// 22.10: поиск, выбранная цель и preview общей цепочки без потери черновика при обновлениях.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../popup.js','utf8'),html=fs.readFileSync(__dirname+'/../popup.html','utf8');
const cut=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const block=cut("let craftSig = ''",'// ревью 21.10: строка добавляется');
const plain=x=>JSON.parse(JSON.stringify(x));
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function fixture(){
 const els={},calls=[],el=id=>els[id]||(els[id]={id,value:id==='craftN'?'1':'',checked:true,innerHTML:'',textContent:'',disabled:false,hidden:false,handlers:{},
  focus(){this.focused=true;},select(){this.selected=true;},addEventListener(k,f){this.handlers[k]=f;},querySelector(){return this.first||null;}});
 const c={secOpen:()=>true,console,Date,Math,Number,Object,Array,Set,JSON,globalThis:null,fmt:n=>String(n??0),esc,$:el,taskSel:(d,k)=>d.autoTasks?.includes(k)||false,document:{querySelectorAll:()=>[]},
  formChar:'Hero',toast:(...x)=>calls.push(['toast',...x]),load:async()=>calls.push(['load']),gameSend:async(m,o)=>{calls.push(['send',plain(m),plain(o)]);return{ok:true};}};
 c.globalThis=c;vm.createContext(c);vm.runInContext(block,c);
 const book={t:Date.now(),lvl:4,can:true,mp:0,maxMp:1000,list:[['steel','Steel',1880,1,2,10],['synthetic_cokes','Synthetic Cokes',1888,1,2,20]],
  recipes:[{code:'steel',output:{itemId:1880,quantity:1,nameEn:'Steel',nameUk:'Сталь'},createItemLevel:2,mpCost:10,ingredients:[{itemId:1865,nameEn:'Iron Ore',quantity:5}]},
   {code:'synthetic_cokes',output:{itemId:1888,quantity:1,nameEn:'Synthetic Cokes',nameUk:'Синтетичний кокс'},createItemLevel:2,mpCost:20,ingredients:[{itemId:1878,nameEn:'Cokes',quantity:3}]},
   {code:'locked',output:{itemId:999,quantity:3,nameEn:'Rare Frame',nameUk:'Рідкісний каркас'},createItemLevel:9,mpCost:50,ingredients:[]}]};
 const rt={char:'Hero',craftBook:book,craftBag:{char:'Hero',t:Date.now(),stacks:[{itemId:1880,qty:12},{itemId:1888,qty:0},{itemId:1865,qty:30}]},craftQueue:[],craftMade:{}};
 return{c,els,calls,el,rt,render:(d={autoTasks:['craft'],craftChain:true})=>c.renderCraft(rt,d)};
}
test('поиск на русском/украинском/английском выбирает тот же authoritative рецепт',()=>{
 const f=fixture(),rows=f.c.craftCatalogRows(f.rt.craftBook);
 for(const term of ['сталь','Steel','steel'])assert.equal(f.c.craftFiltered(rows,term,'all',f.rt)[0].code,'steel');
 for(const term of ['синтетический кокс','Синтетичний кокс','synthetic cokes'])assert.equal(f.c.craftFiltered(rows,term,'all',f.rt)[0].code,'synthetic_cokes');
 assert.equal(f.c.craftFiltered(rows,'неттакогоресурса','all',f.rt).length,0);
});
test('фильтры по навыку и сумке не выдумывают доступность для другого героя',()=>{
 const f=fixture(),rows=f.c.craftCatalogRows(f.rt.craftBook);
 assert.deepEqual(plain(f.c.craftFiltered(rows,'','learned',f.rt).map(x=>x.code)),['steel','synthetic_cokes']);
 assert.deepEqual(plain(f.c.craftFiltered(rows,'','stock',f.rt).map(x=>x.code)),['steel']);
 f.rt.craftBag.char='Other';assert.equal(f.c.craftFiltered(rows,'','stock',f.rt).length,0);assert.equal(f.c.craftHave(1880,f.rt),null);
});
test('выбранный ресурс, строка поиска и число не теряются на periodic render',()=>{
 const f=fixture();f.render();f.el('craftSearch').value='Сталь';f.el('craftN').value='137';f.c.craftChoose('steel',false);
 for(let n=0;n<5;n++){f.rt.craftBook.mp+=10;f.render();}
 assert.equal(f.el('craftSearch').value,'Сталь');assert.equal(f.el('craftN').value,'137');assert.equal(f.el('craftPick').value,'steel');
 assert.match(f.el('craftCatalog').innerHTML,/aria-pressed="true"/);assert.equal(f.el('craftAdd').disabled,false);
});
test('смена персонажа сбрасывает черновик прежнего героя',()=>{
 const f=fixture();f.render();f.c.craftChoose('steel',false);f.el('craftSearch').value='Сталь';f.el('craftN').value='137';
 f.rt.char='Other';f.rt.craftBook=null;f.rt.craftBag=null;f.render();
 assert.equal(f.el('craftSearch').value,'');assert.equal(f.el('craftPick').value,'');assert.equal(f.el('craftN').value,'1');assert.equal(f.el('craftAdd').disabled,true);
});
test('preview использует общий planner, свежую сумку и n новых конечных, цепочку можно выключить',()=>{
 const f=fixture(),plans=[];f.c.L2CraftPlan={plan:(b,q,m,stacks,opts)=>{plans.push(plain({b,q,m,stacks,opts}));return{goals:[{qid:q[0]?.id,status:'ready',steps:[{name:'Cokes',n:3,mp:30,intermediate:true},{name:'Steel',n:7,mp:70,intermediate:false}],missing:[],blocked:[]}],missing:[]};}};
 f.render({autoTasks:['craft'],craftChain:false});f.el('craftN').value='7';f.c.craftChoose('steel',false);
 const p=plans.at(-1);assert.equal(p.q[0].n,7);assert.equal(p.q[0].code,'steel');assert.equal(p.opts.chain,false);assert.equal(p.b.createItemLevel,4);assert.equal(p.b.canCraftProfession,true);assert.equal(p.stacks[0].qty,12);
 assert.match(f.el('craftPreview').innerHTML,/полуфабрикат/);assert.match(f.el('craftPreview').innerHTML,/На цепочку: 100 MP/);
});
test('preview и очередь показывают точное недостающее сырьё и подтверждённый прогресс',()=>{
 const f=fixture(),missing=[{item:1865,name:'Iron Ore',required:100,have:30,missing:70}];
 f.c.L2CraftPlan={plan:(_b,q)=>({goals:q.map(x=>({qid:x.id,status:'missing',steps:[],missing,blocked:[]})),missing})};
 f.rt.craftQueue=[{id:'goal',code:'steel',nm:'Сталь',n:20}];f.rt.craftMade={goal:3};f.render();f.c.craftChoose('steel',false);
 assert.match(f.el('craftList').innerHTML,/Изготовлено 3 из 20/);assert.match(f.el('craftList').innerHTML,/Нужно сырьё/);
 assert.equal(f.el('craftShortage').hidden,false);assert.match(f.el('craftShortage').innerHTML,/не хватает 70 · есть 30 \/ нужно 100/);
 assert.match(f.el('craftPreview').innerHTML,/Iron Ore/);
});
test('без полного чтения книга остаётся доступной, а preview просит обновить и не выдумывает план',()=>{
 const f=fixture();delete f.rt.craftBook.recipes;f.rt.craftBag=null;let calls=0;f.c.L2CraftPlan={plan:()=>{calls++;throw Error('не должно вызываться')}};
 f.render();f.c.craftChoose('steel',false);assert.equal(calls,0);assert.match(f.el('craftPreview').innerHTML,/Нажмите «Обновить»/);assert.equal(f.el('craftAdd').disabled,false);
});
test('ввод дроби/отрицательного/чрезмерного числа не включает добавление',()=>{
 const f=fixture();f.render();f.c.craftChoose('steel',false);
 for(const value of ['0','-1','1.5','1000001','NaN','']){f.el('craftN').value=value;f.c.renderCraftPicker();assert.equal(f.el('craftAdd').disabled,true,value);}
 f.el('craftN').value='1000000';f.c.renderCraftPicker();assert.equal(f.el('craftAdd').disabled,false);
});
test('неизвестные имена и названия из сервера экранируются во всех карточках и shortage',()=>{
 const f=fixture();f.rt.craftBook.recipes.push({code:'x',output:{itemId:42,nameEn:'<img onerror="bad">'},createItemLevel:1,mpCost:1});f.render();
 assert.doesNotMatch(f.el('craftCatalog').innerHTML,/<img/);assert.match(f.el('craftCatalog').innerHTML,/&lt;img/);
 assert.doesNotMatch(f.c.craftMissingHtml([{name:'<script>',missing:1}]),/<script>/);
});
test('обновление OFF использует отдельную read-команду без старта и возвращает кнопку',async()=>{
 const f=fixture();vm.runInContext(cut("$('craftRefresh')?.addEventListener", "$('craftSearch')?.addEventListener('input'"),f.c);
 await f.el('craftRefresh').handlers.click();assert.deepEqual(f.calls[0],['send',{cmd:'craftRead',char:'Hero'},{char:'Hero'}]);
 assert.equal(f.calls.filter(x=>x[0]==='load').length,1);assert.equal(f.el('craftRefresh').disabled,false);assert.equal(f.el('craftRefresh').textContent,'↻ Обновить');
});
test('ошибка/смена героя во время чтения не выдаёт ложное обновление',async()=>{
 for(const changed of [false,true]){const f=fixture();f.c.gameSend=async()=>{if(changed)f.c.formChar='Other';return{ok:false,reason:'замок занят'}};
  vm.runInContext(cut("$('craftRefresh')?.addEventListener", "$('craftSearch')?.addEventListener('input'"),f.c);await f.el('craftRefresh').handlers.click();
  assert.equal(f.calls.some(x=>x[0]==='load'),false);assert.equal(f.calls.filter(x=>x[0]==='toast').length,changed?0:1);assert.equal(f.el('craftRefresh').disabled,false);}
});
test('раздел крафта доступен напрямую, контролы уникальны, сохранены прежние IDs',()=>{
 assert.match(html,/<button data-tab="craft"/);const section=html.match(/<section id="tab-craft">([\s\S]*?)<\/section>/)[1];
 for(const id of ['craftSearch','craftCatalog','craftPick','craftN','craftAdd','craftPreview','craftRefresh','craftList','craftShortage','craftBox','craftChain','craftNotify']){
  assert.ok(section.includes('id="'+id+'"'),id);assert.equal(html.split('id="'+id+'"').length-1,1,id);}
 assert.match(html,/<script src="craft-plan.js"><\/script>[\s\S]*<script src="popup.js"/);
 assert.match(section,/Количество — новые готовые ресурсы/);assert.match(section,/aria-live="polite"/);
});
test('клавиатура в поиске выбирает первый результат и переводит фокус в количество',()=>{
 const f=fixture();f.render();f.el('craftCatalog').first={dataset:{craftpick:'steel'},focus(){this.focused=true}};
 vm.runInContext(cut('const craftEdit =',"$('craftList')?.addEventListener"),f.c);
 let prevented=0;f.el('craftSearch').handlers.keydown({key:'ArrowDown',preventDefault(){prevented++}});assert.equal(f.el('craftCatalog').first.focused,true);
 f.el('craftSearch').handlers.keydown({key:'Enter',preventDefault(){prevented++}});assert.equal(f.el('craftPick').value,'steel');assert.equal(f.el('craftN').focused,true);assert.equal(prevented,2);
 f.el('craftSearch').value='steel';f.el('craftSearch').handlers.keydown({key:'Escape',preventDefault(){}});assert.equal(f.el('craftSearch').value,'');
});
test('двойное добавление во время записи создаёт одну цель и не стирает новый черновик',async()=>{
 const f=fixture();f.render();f.c.craftChoose('steel',false);f.el('craftN').value='10';let release,patches=[];
 f.c.menuPatch=async(p,o)=>{patches.push(plain({p,o}));return new Promise(r=>release=r)};
 vm.runInContext(cut('const craftEdit =',"$('craftList')?.addEventListener"),f.c);
 const first=f.el('craftAdd').handlers.click();await f.el('craftAdd').handlers.click();assert.equal(patches.length,1);
 assert.equal(patches[0].o.expectedChar,'Hero');assert.equal(patches[0].o.craftQueueEdit.row.n,10);assert.equal(patches[0].o.craftQueueEdit.row.nm,'Сталь');
 f.el('craftN').value='37';f.render();release({ok:true});await first;assert.equal(f.el('craftN').value,'37');assert.equal(f.el('craftAdd').disabled,false);
});
test('дробное количество не уходит в background как молчаливо округлённое',async()=>{
 const f=fixture();f.render();f.c.craftChoose('steel',false);f.el('craftN').value='1.5';let calls=0;f.c.menuPatch=async()=>{calls++};
 vm.runInContext(cut('const craftEdit =',"$('craftList')?.addEventListener"),f.c);await f.el('craftAdd').handlers.click();assert.equal(calls,0);assert.equal(f.el('craftN').focused,true);
});
