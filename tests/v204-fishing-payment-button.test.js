'use strict';
// 16.10, журнал07:48: обновление магазина удаляло кнопку до расходного клика.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(require.resolve('../modules/fishing.js'),'utf8');
function world(){
 const calls=[],p={id:'synthetic'};
 const env={shown:b=>!b.hidden,payments:{sent:x=>{calls.push(['sent',x]);return true},cancel:async(...x)=>{calls.push(['cancel',...x]);return true}},fire:b=>{calls.push(['fire',b]);return true}};
 return {calls,p,env,run:vm.runInNewContext('('+src.match(/async function paymentFire\(p,button\) \{[\s\S]*?\n\}/)[0]+')',{env})};
}
for(const [name,b] of [['удалённая кнопка',{isConnected:false}],['отключённая кнопка',{isConnected:true,disabled:true}],['скрытая кнопка',{isConnected:true,hidden:true}],['кнопка отсутствует',null]])test(name+': отмена до sent, без клика и неизвестной оплаты',async()=>{
 const w=world();assert.equal(await w.run(w.p,b),false);assert.deepEqual(w.calls.map(x=>x[0]),['cancel']);assert.equal(w.calls[0][1],w.p);
});
test('актуальная кнопка: ровно одно разрешение и один клик',async()=>{const w=world();assert.equal(await w.run(w.p,{isConnected:true}),true);assert.deepEqual(w.calls.map(x=>x[0]),['sent','fire']);});
test('ядро отказало до отправки: снимается только несостоявшийся платёж',async()=>{const w=world();w.env.fire=()=>false;assert.equal(await w.run(w.p,{isConnected:true}),false);assert.deepEqual(w.calls.map(x=>x[0]),['sent','cancel']);assert.equal(w.calls[1][2].notSent,true);});
test('отправленный клик без ответа остаётся неподтверждённым',async()=>{const w=world();await w.run(w.p,{isConnected:true});assert.ok(!w.calls.some(x=>x[0]==='cancel'));});
