'use strict';
// 17.10.2026: старый toast не подтверждает переодевание; read-only сверка знает экземпляр.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test');
const source=fs.readFileSync(process.env.L2_EQUIPMENT_SOURCE||path.join(__dirname,'../modules/equipment.js'),'utf8');
function fixture(opt={}){
 let notice='надето',icon='same-icon',fires=0,eq={itemId:100,enchant:3,targetInstanceId:'bag:100:other'};
 const w={id:100,inst:'bag:100:chosen',ench:3,name:'Chosen Pole',wt:'древковое',g:'C'};
 const button={get disabled(){return false}},row={querySelector:()=>button};
 const env={on:true,tabOwner:true,rt:{char:'Hero',prof:'Warlord'},generation:1,actionGeneration:()=>env.generation,$q:s=>s==='img[data-l2-slot="weapon"]'?{getAttribute:()=>icon}:null,
 itemJson:()=>({itemId:100,targetInstanceId:w.inst}),shown:()=>true,pause:async()=>{opt.pause?.(env)},fire:()=>{fires++;if(opt.newNotice)notice='Chosen Pole надето';if(opt.newIcon)icon='changed';if(opt.confirm)eq={itemId:100,enchant:3,targetInstanceId:w.inst};opt.fire?.(env);return opt.refuse!==true},
 noticeText:()=>notice,EQUIP_OK:/надето/,rec(){},waitX:async fn=>fn(),sleep:async()=>{},rnd:n=>n,
 gameGet:async()=>{opt.get?.(env);return {ok:!opt.failedGet,json:async()=>({character:{inventory:{eq:{l1:eq}}}})}}};
 const box={console,Date,document:{querySelectorAll:s=>s==='.l2-char-bag-row[data-item-json]'?[row]:[]},location:{pathname:'/char.html',search:''}};vm.runInNewContext(source,box);
 return {env,w,M:box.L2V7Factories.equipment(env),get fires(){return fires},setEq:x=>{eq=x}};
}
test('старый успешный toast не подтверждает неприменённую смену',async()=>{const f=fixture();assert.equal(await f.M.wearFromBag(f.w),false);assert.equal(f.fires,1)});
test('тот же значок и toast: точный выбранный экземпляр подтверждает сервер',async()=>{const f=fixture({confirm:true});assert.equal(await f.M.wearFromBag(f.w),true);assert.equal(f.fires,1)});
test('тот же тип с другим экземпляром не подтверждает выбор',async()=>{const f=fixture();assert.equal(await f.M.wearFromBag(f.w),false)});
for(const instance of [undefined,'eq:l1'])test('общий слот '+String(instance)+' не подтверждает выбранную копию',async()=>{const f=fixture();f.setEq({itemId:100,enchant:3,targetInstanceId:instance});assert.equal(await f.M.wearFromBag(f.w),false)});
test('разная заточка экземпляра не подтверждает выбор',async()=>{const f=fixture();f.setEq({itemId:100,enchant:5,targetInstanceId:'eq:l1'});assert.equal(await f.M.wearFromBag(f.w),false)});
test('ошибка сверки при прежнем toast не становится успехом',async()=>{const f=fixture({failedGet:true});assert.equal(await f.M.wearFromBag(f.w),false)});
test('новая native квитанция подтверждает смену',async()=>{const f=fixture({newNotice:true});assert.equal(await f.M.wearFromBag(f.w),true)});
for(const [label,change] of [['Stop',e=>{e.on=false}],['владелец',e=>{e.tabOwner=false}],['герой',e=>{e.rt.char='Other'}],['класс',e=>{e.rt.prof='Tyrant'}],['Stop→Start',e=>{e.generation++}]]){
 test(label+' в паузе запрещает клик',async()=>{const f=fixture({pause:change});assert.equal(await f.M.wearFromBag(f.w),false);assert.equal(f.fires,0)});
 test(label+' во время подтверждения запрещает устаревший успех',async()=>{const f=fixture({confirm:true,get:change});assert.equal(await f.M.wearFromBag(f.w),false)});
}
