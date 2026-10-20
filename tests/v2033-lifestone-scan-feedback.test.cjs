'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=n=>fs.readFileSync(__dirname+'/../'+n,'utf8'),clone=x=>JSON.parse(JSON.stringify(x));
function popup(){
 const src=read('popup.js'),functions=src.slice(src.indexOf('function lsRenderWeapons('),src.indexOf('async function lsSave(')),action=src.slice(src.indexOf('async function lsAction(action)'),src.indexOf('\nfor(const [id,action] of Object.entries({lsScanWeapons:',src.indexOf('async function lsAction(action)')));
 class Select{constructor(id){this.id=id;this.options=[];this._value='';}replaceChildren(){this.options=[];this._value='';}append(o){this.options.push(o);}set value(v){this._value=String(v);for(const o of this.options)o.selected=o.value===this._value;}get value(){return this._value;}get selectedOptions(){return this.options.filter(o=>o.selected);}}
 const els={lsWeapon:new Select('lsWeapon'),lsTargets:new Select('lsTargets'),lsMaxAttempts:{id:'lsMaxAttempts',value:'37'},lsWeaponHint:{textContent:''},lsRun:{textContent:''},lsAcknowledge:{hidden:false},lsScanWeapons:{disabled:false,setAttribute(k,v){this[k]=v;}},lsScanStatus:{textContent:'',dataset:{}}};
 els.lsTargets.append({value:'prominence',selected:true});let state={cfg:{autoLs:{weaponKey:'saved',targets:['major_heal'],maxAttempts:10}},rt:{char:'Hero',lsWeapons:{char:'Hero',t:1,items:[{key:'saved',name:'Посох',enchant:7,grade:'A',equipped:true}]}},on:false},listener,command=async()=>true;
 const doc={activeElement:null,createElement:()=>({value:'',textContent:'',selected:false,disabled:false})},box={document:doc,$:id=>els[id],chrome:{storage:{local:{get:async()=>clone(state)},onChanged:{addListener:f=>listener=f}}},L2Aug:{info:id=>({n:id})},toast(){},console};vm.createContext(box);
 vm.runInContext("let lsEditing=false,lsActionBusy=false,lsRenderedChar='Hero',controlGeneration=0;\n"+functions+'\n'+action+"\nthis.api={action:lsAction,refresh:lsRefresh,refreshWeapons:lsRefreshWeapons};",box);box.lsCommand=(...a)=>command(...a);
 els.lsWeapon.append({value:'saved',textContent:'Посох'});els.lsWeapon.value='saved';
 return {api:box.api,els,doc,box,get state(){return state;},set command(v){command=v;},changeHero(name){const old=clone(state.rt);state.rt.char=name;state.rt.lsWeapons={char:name,t:2,items:[]};listener?.({rt:{oldValue:old,newValue:clone(state.rt)}});}};
}
const hold=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};};
test('scan shows busy immediately and prevents duplicate command, then durable success with item count',async()=>{
 const f=popup(),h=hold();let commands=0;f.command=()=>{commands++;return h.promise};const pending=f.api.action('scan');
 assert.equal(f.els.lsScanWeapons.disabled,true);assert.equal(f.els.lsScanWeapons['aria-busy'],'true');assert.match(f.els.lsScanStatus.textContent,/Читаю/);await f.api.action('scan');assert.equal(commands,1);
 h.resolve(true);await pending;assert.equal(f.els.lsScanWeapons.disabled,false);assert.equal(f.els.lsScanWeapons['aria-busy'],'false');assert.match(f.els.lsScanStatus.textContent,/Прочитано оружия: 1/);await f.api.refresh();assert.match(f.els.lsScanStatus.textContent,/Прочитано оружия: 1/);
});
for(const focus of [null,'lsWeapon','lsTargets','lsMaxAttempts'])test('scan failure remains visible through polling/focus and preserves prior list/drafts: '+focus,async()=>{
 const f=popup();f.doc.activeElement=f.els[focus]||null;f.command=async()=>{throw Error('Нет связи с вкладкой игры')};await f.api.action('scan');
 const message=f.els.lsScanStatus.textContent;assert.match(message,/Нет связи с вкладкой игры/);assert.equal(f.els.lsScanWeapons.disabled,false);
 await f.api.refresh();await f.api.refreshWeapons('Hero');assert.equal(f.els.lsScanStatus.textContent,message);assert.equal(f.state.rt.lsWeapons.t,1);assert.equal(f.els.lsWeapon.options.length,2);assert.equal(f.els.lsWeapon.value,'saved');
 if(focus){assert.equal(f.els.lsMaxAttempts.value,'37');assert.deepEqual(f.els.lsTargets.selectedOptions.map(o=>o.value),['prominence']);}
});
test('actor change clears previous error even while field has focus',async()=>{
 const f=popup();f.doc.activeElement=f.els.lsMaxAttempts;f.command=async()=>{throw Error('Старая ошибка')};await f.api.action('scan');assert.match(f.els.lsScanStatus.textContent,/Старая ошибка/);f.changeHero('Other');assert.equal(f.els.lsScanStatus.textContent,'');
});
for(const settled of ['resolve','reject'])test('late '+settled+' from old hero cannot attach feedback to new hero',async()=>{
 const f=popup(),h=hold();f.doc.activeElement=f.els.lsWeapon;f.command=()=>h.promise;const pending=f.api.action('scan');f.changeHero('Other');h[settled](settled==='resolve'?true:Error('Старая ошибка'));await pending;assert.equal(f.els.lsScanStatus.textContent,'');assert.equal(f.els.lsScanWeapons.disabled,false);
});
test('new scan replaces old error and reports an empty successful result',async()=>{
 const f=popup();f.command=async()=>{throw Error('Ошибка каталога')};await f.api.action('scan');f.command=async()=>{f.state.rt.lsWeapons={char:'Hero',t:2,items:[]};return true};await f.api.action('scan');assert.match(f.els.lsScanStatus.textContent,/Прочитано оружия: 0/);assert.doesNotMatch(f.els.lsScanStatus.textContent,/Ошибка каталога/);
});
test('markup exposes persistent scan feedback as an atomic live status',()=>{assert.match(read('popup.html'),/<[^>]+id="lsScanStatus"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);});
function moduleFixture(timers={setTimeout,clearTimeout}){
 const box={console,...timers};vm.createContext(box);for(const n of ['augment.js','modules/lifestone.js'])vm.runInContext(read(n),box);
 const snap={name:'Hero',revision:10,inventory:{eq:{l1:{itemId:123,enchant:7}},stacks:[]}},hints={itemGradeHints:{123:'A'},itemSlotHints:{123:'rhand'}};
 let context='same';const messages=[],previous={char:'Hero',t:1,items:[{key:'old'}]},env={cfg:{},rt:{char:'Hero',lsWeapons:clone(previous)},on:false,tabOwner:true,context:()=>context,canRun:()=>false,canPrepare:()=>false,setRt:async p=>{Object.assign(env.rt,clone(p));return{ok:true}},gameGet:async p=>({ok:true,json:async()=>clone(p==='/character'?{character:snap}:hints)}),gamePost:async()=>{throw Error('POST forbidden')},rec:(...r)=>messages.push(r)};
 return {env,snap,hints,messages,previous,m:box.L2V7Factories.lifestone(env),move:()=>context='new'};
}
for(const failure of ['snapshot','catalog','context','write','exception'])test('module scan diagnoses '+failure+' without raw response/secret, cached fallback or mutation',async()=>{
 const f=moduleFixture(),read=f.env.gameGet;
 if(failure==='snapshot')f.env.gameGet=p=>p==='/character'?Promise.resolve({ok:false}):read(p);
 if(failure==='catalog')f.env.gameGet=p=>p.includes('catalog')?Promise.resolve({ok:false}):read(p);
 if(failure==='context')f.env.gameGet=async p=>{const r=await read(p);f.move();return r};
 if(failure==='write')f.env.setRt=async()=>({ok:false});
 if(failure==='exception')f.env.setRt=async()=>{throw Error('token=private-value')};
 let message='';try{await f.m.command('scan');assert.fail('expected scan rejection')}catch(e){message=e.message;}
 assert.match(message,failure==='snapshot'?/инвентарь героя/:failure==='catalog'?/каталог оружия/:failure==='context'?/Герой или управление/:/сохранить список/);
 assert.deepEqual(f.env.rt.lsWeapons,f.previous);assert.equal(f.env.rt.autoLs,undefined);assert.equal(f.messages.length,2);assert.match(f.messages[0][2],/Обновляю список/);assert.match(f.messages[1][2],/не выполнено/);assert.doesNotMatch(JSON.stringify(f.messages),/private-value|token=/);
});
test('module success logs request and exact count, without a write command',async()=>{const f=moduleFixture();await f.m.command('scan');assert.equal(f.messages.length,2);assert.match(f.messages[0][2],/Обновляю список/);assert.match(f.messages[1][2],/Оружие прочитано: 1/);assert.equal(f.env.rt.lsWeapons.items.length,1);assert.equal(f.env.rt.autoLs,undefined);});
for(const part of ['инвентарь героя','каталог оружия'])for(const type of ['HTTP','timeout','JSON','shape'])test('scan-only API diagnostic distinguishes '+part+': '+type,async()=>{
 const f=moduleFixture(),read=f.env.gameGet,path=part==='инвентарь героя'?'/character':'/character/catalog-hints';f.env.gameGet=async p=>{
  if(p!==path)return read(p);
  if(type==='HTTP')return{ok:false,status:401,json:async()=>({token:'not-printed'})};
  if(type==='timeout'){const error=Error('private timed out token=hidden');error.name='AbortError';throw error;}
  if(type==='JSON')return{ok:true,json:async()=>{throw Error('secret JSON') }};
  return{ok:true,json:async()=>[]};
 };
 await assert.rejects(()=>f.m.command('scan'),e=>e.message.includes(part)&&e.message.includes(type==='HTTP'?'HTTP 401':type==='timeout'?'таймаут':type==='JSON'?'некорректный JSON':'объект ответа'));
 assert.deepEqual(f.env.rt.lsWeapons,f.previous);assert.doesNotMatch(JSON.stringify(f.messages),/hidden|not-printed|secret JSON|token=/);
});
for(const field of ['character','name','foreignName','revision','eq','stacks','itemGradeHints','itemSlotHints'])test('scan diagnoses missing or mismatched '+field+' without exposing values',async()=>{
 const f=moduleFixture();
 if(field==='character'){const read=f.env.gameGet;f.env.gameGet=p=>p==='/character'?Promise.resolve({ok:true,json:async()=>({})}):read(p);}
 if(field==='name')delete f.snap.name;if(field==='foreignName')f.snap.name='PrivateOtherHero';if(field==='revision')f.snap.revision='10';if(field==='eq')delete f.snap.inventory.eq;if(field==='stacks')delete f.snap.inventory.stacks;if(field==='itemGradeHints')delete f.hints.itemGradeHints;if(field==='itemSlotHints')delete f.hints.itemSlotHints;
 await assert.rejects(()=>f.m.command('scan'),e=>e.message.includes(field==='foreignName'?'имя героя не совпадает':field==='name'?'нет имени':field==='revision'?'revision':field==='eq'||field==='stacks'?'inventory':field==='character'?'character':'itemGradeHints'));
 assert.deepEqual(f.env.rt.lsWeapons,f.previous);assert.doesNotMatch(JSON.stringify(f.messages),/PrivateOtherHero/);
});

test('storage read failure in finally releases scan UI and keeps an error until retry succeeds',async()=>{
 const f=popup();f.box.chrome.storage.local.get=async()=>{throw Error('storage unavailable')};await f.api.action('scan');assert.equal(f.els.lsScanWeapons.disabled,false);assert.match(f.els.lsScanStatus.textContent,/Не удалось показать список/);
 f.box.chrome.storage.local.get=async()=>clone(f.state);await f.api.action('scan');assert.match(f.els.lsScanStatus.textContent,/Прочитано оружия: 1/);assert.equal(f.els.lsScanWeapons.disabled,false);
});

for(const point of ['headers','body'])test('scan-only whole response deadline releases a hung '+point+' read without publishing late data',async()=>{
 const timers=new Map(),cleared=[];let sequence=0,bodyRead=false;const f=moduleFixture({setTimeout(fn,ms){assert.equal(ms,8000);const id=++sequence;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);cleared.push(id);}}),read=f.env.gameGet;
 f.env.gameGet=p=>p!=='/character'?read(p):point==='headers'?new Promise(()=>{}):Promise.resolve({ok:true,json:()=>{bodyRead=true;return new Promise(()=>{});}});
 const pending=f.m.command('scan');for(let n=0;n<8;n++)await Promise.resolve();if(point==='body')assert.equal(bodyRead,true);
 assert.equal(timers.size,1,'completed catalog deadline is already cleared');for(const fn of timers.values())fn();
 await assert.rejects(()=>pending,/инвентарь героя: таймаут запроса или чтения JSON/);assert.deepEqual(f.env.rt.lsWeapons,f.previous);assert.equal(timers.size,0);assert.equal(cleared.length,2);assert.match(f.messages[1][2],/таймаут/);
});
