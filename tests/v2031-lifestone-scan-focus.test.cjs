'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(__dirname+'/../popup.js','utf8');
const functions=src.slice(src.indexOf('function lsRenderWeapons('),src.indexOf('async function lsSave('));
const action=src.slice(src.indexOf('async function lsAction(action)'),src.indexOf('\nfor(const [id,action] of Object.entries({lsScanWeapons:',src.indexOf('async function lsAction(action)')));
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(){
 class Select{
  constructor(id){this.id=id;this.options=[];this._value='';}
  replaceChildren(){this.options=[];this._value='';}
  append(o){this.options.push(o);}
  set value(v){this._value=String(v);for(const o of this.options)o.selected=o.value===this._value;}
  get value(){return this._value;}
  get selectedOptions(){return this.options.filter(o=>o.selected);}
 }
 const els={lsWeapon:new Select('lsWeapon'),lsTargets:new Select('lsTargets'),lsMaxAttempts:{id:'lsMaxAttempts',value:'37'},lsWeaponHint:{textContent:''},lsRun:{textContent:''},lsAcknowledge:{hidden:false}};
 for(const value of ['prominence','major_heal'])els.lsTargets.append({value,selected:value==='prominence'});
 const item=(key,equipped=true)=>({key,name:key==='saved'?'Посох':'Копьё',enchant:7,grade:'A',equipped});
 let state={cfg:{autoLs:{weaponKey:'saved',targets:['major_heal'],maxAttempts:10}},rt:{char:'Hero',lsWeapons:{char:'Hero',t:123,items:[item('saved'),item('draft',false)]}},on:false},reads=0,commands=[];
 const doc={activeElement:null,createElement:()=>({value:'',textContent:'',selected:false,disabled:false})};
 const box={document:doc,$:id=>els[id],chrome:{storage:{local:{get:async()=>{reads++;return clone(state);}}}},L2Aug:{info:id=>({n:id})},toast:()=>{},console};vm.createContext(box);
 vm.runInContext("let lsEditing=false,lsActionBusy=false,lsRenderedChar='Hero',controlGeneration=0;\n"+functions+'\n'+action+"\nthis.api={render:lsRenderWeapons,refresh:lsRefresh,refreshWeapons:lsRefreshWeapons,action:lsAction,setEditing:v=>lsEditing=v,setRendered:v=>lsRenderedChar=v};",box);
 box.lsCommand=async action=>commands.push(action);
 const addOption=(key)=>els.lsWeapon.append({value:key,selected:false,textContent:key});addOption('saved');addOption('draft');els.lsWeapon.value='draft';
 return {els,doc,box,api:box.api,get state(){return state;},set state(v){state=v;},reads:()=>reads,commands,item};
}
for(const field of ['lsWeapon','lsTargets','lsMaxAttempts'])test('явная кнопкаscan обновляет оружие при фокусе '+field+' и сохраняет черновики',async()=>{
 const f=fixture();f.doc.activeElement=f.els[field];await f.api.action('scan');
 assert.deepEqual(Array.from(f.commands),['scan']);assert.equal(f.els.lsWeapon.options.length,3);assert.equal(f.doc.activeElement,f.els[field]);
 assert.deepEqual(f.els.lsTargets.selectedOptions.map(x=>x.value),['prominence']);assert.equal(f.els.lsMaxAttempts.value,'37');
 assert.equal(f.els.lsWeapon.value,field==='lsWeapon'?'draft':'saved');
});
test('явное обновление сохраняет ещё не сохранённый выбор оружия',async()=>{
 const f=fixture();f.doc.activeElement=f.els.lsWeapon;await f.api.refreshWeapons('Hero');assert.equal(f.els.lsWeapon.value,'draft');assert.match(f.els.lsWeaponHint.textContent,/рюкзака/);
});
test('исчезнувший черновой выбор остаётся видимым и не подменяется другим оружием',async()=>{
 const f=fixture();f.doc.activeElement=f.els.lsWeapon;f.els.lsWeapon.append({value:'missing',textContent:'missing'});f.els.lsWeapon.value='missing';await f.api.refreshWeapons('Hero');
 assert.equal(f.els.lsWeapon.value,'missing');assert.match(f.els.lsWeapon.options.find(o=>o.value==='missing').textContent,/не в списке/);
});
test('успешный пустойscan отличается от ещё не прочитанного инвентаря',()=>{
 const f=fixture();delete f.state.rt.lsWeapons;f.api.render(f.state.rt,f.state.cfg.autoLs);assert.match(f.els.lsWeaponHint.textContent,/Нажмите/);
 f.state.rt.lsWeapons={char:'Hero',t:123,items:[]};f.api.render(f.state.rt,f.state.cfg.autoLs);assert.match(f.els.lsWeaponHint.textContent,/Оружие прочитано.*не найдено/);
});
test('список другого персонажа не считается результатом чтения текущего',()=>{
 const f=fixture();f.state.rt.lsWeapons.char='Other';f.api.render(f.state.rt,{});assert.equal(f.els.lsWeapon.options.length,1);assert.match(f.els.lsWeaponHint.textContent,/Нажмите/);
});
for(const point of ['who','stored','rendered','duringGet'])test('позднее обновление не пишет чужой список: '+point,async()=>{
 const f=fixture();const before=clone(f.els.lsWeapon.options);let who='Hero';
 if(point==='who')who='Other';if(point==='stored')f.state.rt.char='Other';if(point==='rendered')f.api.setRendered('Other');
 if(point==='duringGet')f.box.chrome.storage.local.get=async()=>{f.api.setRendered('Other');return clone(f.state);};
 await f.api.refreshWeapons(who);assert.deepEqual(f.els.lsWeapon.options,before);
});
for(const field of ['lsWeapon','lsTargets','lsMaxAttempts'])test('обычное фоновое обновление по-прежнему не затирает фокус '+field,async()=>{
 const f=fixture();f.doc.activeElement=f.els[field];await f.api.refresh();assert.equal(f.reads(),0);assert.equal(f.els.lsWeapon.value,'draft');assert.equal(f.els.lsMaxAttempts.value,'37');assert.deepEqual(f.els.lsTargets.selectedOptions.map(x=>x.value),['prominence']);
});
test('обычное обновление без фокуса синхронизирует сохранённые значения и статус',async()=>{
 const f=fixture();await f.api.refresh();assert.equal(f.els.lsWeapon.options.length,3);assert.equal(f.els.lsWeapon.value,'saved');assert.equal(f.els.lsMaxAttempts.value,10);assert.deepEqual(f.els.lsTargets.selectedOptions.map(x=>x.value),['major_heal']);assert.equal(f.els.lsRun.textContent,'Серия не запущена');assert.equal(f.els.lsAcknowledge.hidden,true);
});
test('обычное обновление по-прежнему ждёт незавершённую запись настроек',async()=>{
 const f=fixture();f.api.setEditing(true);await f.api.refresh();assert.equal(f.reads(),0);assert.equal(f.els.lsWeapon.value,'draft');
});
test('неоднозначный экземпляр остаётся запрещённым для выбора',async()=>{
 const f=fixture();f.state.rt.lsWeapons.items[0].ambiguous=true;await f.api.refreshWeapons('Hero');assert.equal(f.els.lsWeapon.options.find(o=>o.value==='saved').disabled,true);assert.match(f.els.lsWeaponHint.textContent,/Одинаковые экземпляры/);
});
