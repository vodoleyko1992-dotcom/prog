'use strict';
// Докупка ЛС: настройки и деньги не теряются при выборе оружия/эффектов, неизвестная покупка не становится попыткой.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=process.env.LS_UI_ROOT||path.resolve(__dirname,'..'),read=n=>fs.readFileSync(path.join(root,n),'utf8'),clone=x=>JSON.parse(JSON.stringify(x)),source=read('popup.js');
const a=source.indexOf('function lsRenderWeapons('),b=source.indexOf('async function lsScanTab(',a),ui=source.slice(a,b);
function fixture(){
 class Select{constructor(id,options=[]){this.id=id;this.options=options;this.value='';}replaceChildren(){this.options=[];}append(o){this.options.push(o);}get selectedOptions(){return this.options.filter(o=>o.selected);}}
 const fields={lsWeapon:new Select('lsWeapon'),lsTargets:new Select('lsTargets',[{value:'matk_6',selected:false},{value:'prominence',selected:false}]),lsMaxAttempts:{id:'lsMaxAttempts',value:'10'},lsBuyMaterials:{id:'lsBuyMaterials',checked:true},lsAaBudget:{id:'lsAaBudget',value:'2000000'},lsAdenaBudget:{id:'lsAdenaBudget',value:'2000000'},lsAaReserve:{id:'lsAaReserve',value:'0'},lsWeaponHint:{textContent:''},lsRun:{textContent:''},lsAcknowledge:{hidden:true}};
 let state={cfg:{autoLs:{weaponKey:'saved',targets:['matk_6'],maxAttempts:10,buyMaterials:false,aaBudget:700000,adenaBudget:300000,aaReserve:200000,extraPreserved:'sentinel'}},rt:{char:'Hero',lsWeapons:{char:'Hero',items:[{key:'saved',name:'Кастер',enchant:25,grade:'S',equipped:true}]}},on:true};
 const patches=[],document={activeElement:null,createElement:()=>({})};let readHook,writeError;
 const box={console,document,$:id=>fields[id],L2Aug:{info:id=>({n:id})},chrome:{storage:{local:{get:async()=>{readHook?.();return clone(state)}},onChanged:{addListener(){}}}},menuPatch:async(patch,request)=>{if(writeError)throw writeError;if(state.rt.char!==request.expectedChar)throw Error('Персонаж изменился');patches.push(clone(request));state.cfg={...state.cfg,...clone(request.cfgPatch)};},toast(){}};
 vm.createContext(box);vm.runInContext("let lsEditing=false,lsRenderedChar='Hero';\n"+ui+"\nthis.api={refresh:lsRefresh,save:lsSave,editing:()=>lsEditing};",box);
 return{fields,box,document,patches,get state(){return state},set state(v){state=v},api:box.api,hookRead(fn){readHook=fn},failWrite(){writeError=Error('storage unavailable')}};
}
test('factory defaults, base profile and new-character reset agree without inherited targets',()=>{
 const box={};vm.createContext(box);vm.runInContext(read('defaults.js'),box);const expected={targets:[],maxAttempts:10,buyMaterials:true,aaBudget:2000000,adenaBudget:2000000,aaReserve:0};
 assert.deepEqual(clone(box.L2Defaults.CFG.autoLs),expected);assert.deepEqual(JSON.parse(read('base-profile.json')).cfg.autoLs,expected);
 const reset=read('background.js').match(/nextCfg\.autoLs = ([^;]+);/);assert.ok(reset);vm.runInContext('this.nextCfg={autoLs:{targets:["old"],aaBudget:1}};nextCfg.autoLs='+reset[1],box);assert.deepEqual(clone(box.nextCfg.autoLs),expected);
});
test('refresh shows purchase settings and zero/false remain explicit rather than defaults',async()=>{
 const f=fixture();await f.api.refresh();assert.equal(f.fields.lsBuyMaterials.checked,false);assert.equal(f.fields.lsAaBudget.value,700000);assert.equal(f.fields.lsAdenaBudget.value,300000);assert.equal(f.fields.lsAaReserve.value,200000);
 Object.assign(f.state.cfg.autoLs,{buyMaterials:false,aaBudget:0,adenaBudget:0,aaReserve:0});await f.api.refresh();assert.equal(f.fields.lsBuyMaterials.checked,false);for(const id of ['lsAaBudget','lsAdenaBudget','lsAaReserve'])assert.equal(f.fields[id].value,0,id);
});
test('legacy profile without new keys renders explicit bounded defaults',async()=>{
 const f=fixture();f.state.cfg.autoLs={targets:['matk_6'],maxAttempts:10};await f.api.refresh();assert.equal(f.fields.lsBuyMaterials.checked,true);assert.equal(f.fields.lsAaBudget.value,2000000);assert.equal(f.fields.lsAdenaBudget.value,2000000);assert.equal(f.fields.lsAaReserve.value,0);
});
for(const id of ['lsBuyMaterials','lsAaBudget','lsAdenaBudget','lsAaReserve'])test('polling preserves unsaved supply draft while focused: '+id,async()=>{
 const f=fixture();f.document.activeElement=f.fields[id];f.fields.lsAaBudget.value='999';f.fields.lsBuyMaterials.checked=true;await f.api.refresh();assert.equal(f.fields.lsAaBudget.value,'999');assert.equal(f.fields.lsBuyMaterials.checked,true);
});
test('save retains supply settings and unrelated options when changing weapon/targets/attempts',async()=>{
 const f=fixture();await f.api.refresh();f.fields.lsWeapon.value='new-weapon';for(const o of f.fields.lsTargets.options)o.selected=o.value==='prominence';f.fields.lsMaxAttempts.value='25';await f.api.save();
 assert.deepEqual(f.state.cfg.autoLs,{weaponKey:'new-weapon',targets:['prominence'],maxAttempts:25,buyMaterials:false,aaBudget:700000,adenaBudget:300000,aaReserve:200000,extraPreserved:'sentinel'});assert.equal(f.patches[0].expectedChar,'Hero');assert.equal(f.api.editing(),false);
});
test('supply change events save whole settings with explicit zero budgets',async()=>{
 const f=fixture();await f.api.refresh();f.fields.lsBuyMaterials.checked=true;f.fields.lsAaBudget.value='0';f.fields.lsAdenaBudget.value='0';f.fields.lsAaReserve.value='0';await f.fields.lsAaBudget.onchange();assert.equal(f.state.cfg.autoLs.buyMaterials,true);assert.equal(f.state.cfg.autoLs.aaBudget,0);assert.equal(f.state.cfg.autoLs.adenaBudget,0);assert.equal(f.state.cfg.autoLs.aaReserve,0);assert.equal(f.state.cfg.autoLs.weaponKey,'saved');
});
for(const key of ['lsAaBudget','lsAdenaBudget','lsAaReserve'])for(const value of ['','-1','1.5','NaN','Infinity','9007199254740992'])test('invalid money never reaches storage: '+key+'='+value,async()=>{
 const f=fixture();await f.api.refresh();f.fields[key].value=value;const before=clone(f.state.cfg);await assert.rejects(()=>f.api.save(),/целое число/);assert.deepEqual(f.state.cfg,before);assert.equal(f.patches.length,0);assert.equal(f.api.editing(),false);
});
test('changed hero is rejected without writing settings into a different profile',async()=>{
 const f=fixture();await f.api.refresh();f.hookRead(()=>{f.state.rt.char='Other'});await assert.rejects(()=>f.api.save(),/Персонаж изменился/);assert.equal(f.patches.length,0);assert.equal(f.api.editing(),false);
});
test('failed write leaves the editable draft and allows another save',async()=>{
 const f=fixture();await f.api.refresh();f.fields.lsAaBudget.value='123456';f.failWrite();await assert.rejects(()=>f.api.save(),/storage unavailable/);assert.equal(f.fields.lsAaBudget.value,'123456');assert.equal(f.api.editing(),false);assert.equal(f.state.cfg.autoLs.aaBudget,700000);
});
for(const action of ['buy','travel'])test('unknown supply '+action+' shows cost/reservation and cannot be counted as an augmentation attempt',async()=>{
 const f=fixture();f.state.rt.autoLs={status:'paused',attempts:0,maxAttempts:10,grade:'S',itemId:9002284,targets:['matk_6'],spentAA:160000,spentAdena:100000,reservedAA:160000,reservedAdena:0,pending:{kind:'supply',action,name:'Life Stone S'}};await f.api.refresh();
 assert.equal(f.fields.lsAcknowledge.hidden,true);assert.match(f.fields.lsRun.textContent,/0\/10 попыток/);assert.match(f.fields.lsRun.textContent,/На докупку:/);assert.match(f.fields.lsRun.textContent,/Ожидают сверки:/);assert.match(f.fields.lsRun.textContent,action==='travel'?/Телепорт к Маммону/:/Покупка: Life Stone S/);assert.doesNotMatch(f.fields.lsRun.textContent,/неподтверждённая попытка/);
});
test('legacy unknown augmentation still offers explicit manual attempt accounting',async()=>{
 const f=fixture();f.state.rt.autoLs={status:'paused',attempts:1,maxAttempts:10,grade:'S',itemId:9002284,targets:['matk_6'],pending:{id:'old-install'}};await f.api.refresh();assert.equal(f.fields.lsAcknowledge.hidden,false);assert.match(f.fields.lsRun.textContent,/неподтверждённая попытка/);
});
test('supply UI names ordinary currencies and explains zero budget and reserve semantics',()=>{
 const html=read('popup.html');for(const id of ['lsBuyMaterials','lsAaBudget','lsAdenaBudget','lsAaReserve'])assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/Нулевой лимит запрещает покупки/);assert.match(html,/Coin of Luck и Fast Aden не расходуются/);assert.doesNotMatch(html,/Покупок нет\./);
});
test('automatic AA-limited reduction refreshes saved input and actual series progress',async()=>{
 const f=fixture();await f.api.refresh();f.state.cfg.autoLs.maxAttempts=5;f.state.rt.autoLs={status:'paused',attempts:2,maxAttempts:5,grade:'S',itemId:9002284,targets:['matk_6'],reason:'AA хватит на 3 оставшиеся попытки'};await f.api.refresh();assert.equal(f.fields.lsMaxAttempts.value,5);assert.match(f.fields.lsRun.textContent,/2\/5 попыток/);assert.match(f.fields.lsRun.textContent,/AA хватит/);
});
test('automatic reduction does not overwrite focused attempt draft; blur shows reduced config',async()=>{
 const f=fixture();await f.api.refresh();f.document.activeElement=f.fields.lsMaxAttempts;f.fields.lsMaxAttempts.value='9';f.state.cfg.autoLs.maxAttempts=5;await f.api.refresh();assert.equal(f.fields.lsMaxAttempts.value,'9');f.document.activeElement=null;await f.api.refresh();assert.equal(f.fields.lsMaxAttempts.value,5);
});
test('batch pending displays exact purchased quantity without exposing request payload',async()=>{
 const f=fixture();f.state.rt.autoLs={status:'paused',attempts:0,maxAttempts:10,grade:'S',itemId:9002284,targets:['matk_6'],pending:{kind:'supply',action:'buy',name:'Life Stone S',qty:8,body:{secret:'not for display'}}};await f.api.refresh();assert.match(f.fields.lsRun.textContent,/Покупка: Life Stone S ×8/);assert.doesNotMatch(f.fields.lsRun.textContent,/secret|not for display/);assert.equal(f.fields.lsAcknowledge.hidden,true);
 const html=read('popup.html');assert.match(html,/для всех оставшихся попыток/);assert.match(html,/число попыток автоматически уменьшается/);assert.doesNotMatch(html,/Перед попыткой докупается только недостающая пара/);
});
