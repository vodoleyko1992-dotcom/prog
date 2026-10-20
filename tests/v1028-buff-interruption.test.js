'use strict';
// Отмена маршрута требует свежего снимка, не сбрасывает неизвестную оплату и не повторяет купленный бафф.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function fixture(){
 const now=Date.now(),H={},writes=[],clicks=[],route={pathname:'/map.html',href:''};let reads=0,pending=false,hook=()=>{},response={character:{name:'Hero',activeBuffs:[]}},ok=true;
 const box={console,Date,document:{querySelectorAll:()=>[]}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../modules/buffs.js'),'utf8'),box);
 const hud={querySelectorAll:()=>Object.entries(H).map(([id,e])=>({dataset:{skillId:id,expiresAt:e},getAttribute:()=> 'Buff Lv.3'}))};
 const button={disabled:true,dataset:{skillId:'1059',cost:'1'}};
 const env={on:true,tabOwner:true,leaseEpoch:1,cfg:{townBuffSet:'off',faBuffs:'1059'},rt:{char:'Hero',manualKickAt:1,tbT:now-50000,tbFail:0,tbInterrupted:{t:now,jobT:now-50000}},TB_KEYS:{basic:[]},IL:{},FA_KNOWN:{},routeLocation:route,
  setRt:async p=>{writes.push(p);Object.assign(env.rt,p);return {ok:true}},faCost:()=>1,heroRole:()=> 'mage',autonomyMode:()=> 'raid',rec(){},setStatus(){},sleep:async()=>{},pause:async()=>{},rnd:()=>0,waitX:async f=>f(),fire:b=>{clicks.push(b);return true},
  $q:s=>s==='#l2-hud-active-buffs'?hud:s==='#fast-aden-balance'?{textContent:'1000'}:s.startsWith('.l2-fa-buy')?button:null,
  // 20.29: fixture платных эффектов имеет явный свежий non-VIP; поля проверки отмены остаются прежними.
  payments:{blocked:()=>pending},gameGet:async()=>{reads++;await hook();return {ok,json:async()=>response.character?{...response,character:{id:'fixture-actor',revision:10,vip:{active:false},...response.character}}:response}}};
 return {env,H,writes,clicks,route,now,B:box.L2V7Factories.buffs(env),get reads(){return reads},set hook(f){hook=f},set response(r){response=r},set ok(v){ok=v},set pending(v){pending=v}};
}
const start=f=>f.B.townBuffStart('перед РБ fixture',true);
test('после отмены свежая пустая панель позволяет сразу перепланировать без tbFail/cooldown',async()=>{const f=fixture();assert.equal(await start(f),true);assert.equal(f.env.rt.tbFail,0);assert.equal(f.env.rt.tbInterrupted,null);assert.equal(JSON.stringify(f.env.rt.tbuff.fa),'[1059]');assert.equal(f.route.href,'/fast-aden-buffer.html');assert.equal(f.reads,1);assert.equal(f.clicks.length,0)});
test('оплаченный эффект сервера при пустом HUD не планируется повторно',async()=>{const f=fixture();f.response={character:{name:'Hero',activeBuffs:[{skillId:1059,level:3,expiresAtMs:f.now+3*3600000}]}};assert.equal(await start(f),true);assert.equal(f.env.rt.tbuff,undefined);assert.ok(f.env.rt.tbInterrupted);assert.equal(f.route.href,'');assert.equal(f.clicks.length,0)});
for(const [name,change] of [
 ['HTTP отказ',f=>f.ok=false],['сбой GET',f=>f.hook=()=>{throw Error('offline')}],['чужой герой',f=>f.response={character:{name:'Other',activeBuffs:[]}}],['нет массива эффектов',f=>f.response={character:{name:'Hero'}}],['неверный срок',f=>f.response={character:{name:'Hero',activeBuffs:[{skillId:1059,expiresAtMs:'unknown'}]}}],
 ['смена героя',f=>f.hook=()=>{f.env.rt.char='Other'}],['смена замка',f=>f.hook=()=>{f.env.leaseEpoch=2}],['потеря владения',f=>f.hook=()=>{f.env.tabOwner=false}],['Stop',f=>f.hook=()=>{f.env.on=false}],['ручной выбор',f=>f.hook=()=>{f.env.rt.manualKickAt=2}],
 ['неизвестная оплата появилась во время GET',f=>f.hook=()=>{f.pending=true}],
])test(name+' сохраняет marker и запрещает новый маршрут',async()=>{const f=fixture();change(f);assert.equal(await start(f),!['смена героя','смена замка','потеря владения','Stop','ручной выбор'].includes(name));assert.ok(f.env.rt.tbInterrupted);assert.equal(f.env.rt.tbuff,undefined);assert.equal(f.env.rt.tbFail,0);assert.equal(f.route.href,'');assert.equal(f.clicks.length,0)});
test('существующий unknown payment не запускает даже новый GET перепланирования',async()=>{const f=fixture();f.pending=true;assert.equal(await start(f),true);assert.equal(f.reads,0);assert.ok(f.env.rt.tbInterrupted);assert.equal(f.writes.length,0)});
test('новая потребность добавляется в текущий визит один раз без повторной попытки старого ID',async()=>{const f=fixture();f.route.pathname='/fast-aden-buffer.html';f.env.rt.tbInterrupted=null;f.env.rt.tbuff={t:123,step:'fa',fa:[1059]};f.H[1059]=f.now+3*3600000;f.env.cfg.faBuffs='1059,1085';f.response={character:{name:'Hero',activeBuffs:[{skillId:1059,level:3,expiresAtMs:f.H[1059]}]}};
 await f.B.townBuffStep();assert.equal(JSON.stringify(f.env.rt.tbuff.fa),'[1085]');assert.equal(JSON.stringify(f.env.rt.tbuff.faConsidered),'[1059,1085]');assert.equal(f.route.href,'');
 await f.B.townBuffStep();assert.equal(f.env.rt.tbuff,null);assert.equal(f.clicks.length,0);assert.equal(f.route.href,'/map.html');});
test('граница64 ограничивает общий considered даже когда новых эффектов несколько',async()=>{const f=fixture();f.route.pathname='/fast-aden-buffer.html';f.env.rt.tbInterrupted=null;f.env.rt.tbuff={t:123,step:'fa',fa:[],faConsidered:Array.from({length:63},(_,i)=>i+1)};f.env.cfg.faBuffs='1059,1085';await f.B.townBuffStep();assert.equal(f.env.rt.tbuff.faConsidered.length,64);assert.equal(f.env.rt.tbuff.fa.length,1);assert.equal(f.clicks.length,0);});
for(const pending of [false,true])test('actions: смена списка '+(pending?'с unknown сверяет оплату без удаления':'без unknown помечает отменённый бафф'),async()=>{
 const box={console,Date};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../modules/actions.js'),'utf8'),box);
 const receipt={id:'paid',kind:'fa-buff'},rt={char:'Hero',manualKickAt:200,tbuff:{t:100,step:'fa',fa:[1059]},actionOwner:{key:'tbuff',context:'old',stamp:'100'},actionPayments:{pending:pending?receipt:null,history:[receipt]}};let runs=0,reconciles=0;
 const env={rt,cfg:{autoTasks:['raid']},on:true,tabOwner:true,mode:()=> 'raid',lease:()=>1,jobs:()=>[{key:'tbuff',run:async()=>runs++}],paymentPending:()=>rt.actionPayments.pending,isBattle:()=>false,page:()=>'/map.html',reconcile:async()=>reconciles++,setRt:async p=>{Object.assign(rt,p);return {ok:true}},rtCommit:async()=>true,rec(){}};
 const M=box.L2V7Factories.actions(env);M.enterFrame();await M.dispatch();assert.equal(runs,0);assert.equal(rt.actionPayments.history[0],receipt);
 if(pending){assert.equal(reconciles,1);assert.equal(rt.actionPayments.pending,receipt);assert.ok(rt.tbuff);assert.equal(rt.tbInterrupted,undefined)}else{assert.equal(rt.tbuff,null);assert.equal(rt.tbInterrupted.jobT,100);assert.equal(rt.actionOwner,null)}
});

test('повторное решение до обновления HUD не возвращает уже оплаченный серверный эффект в очередь',async()=>{const f=fixture();f.env.rt.tbT=f.now-20*60000;f.response={character:{name:'Hero',activeBuffs:[{skillId:1059,level:3,expiresAtMs:f.now+3*3600000}]}};await start(f);await start(f);assert.equal(f.env.rt.tbuff,undefined);assert.equal(f.route.href,'');assert.equal(f.clicks.length,0)});

test('HUD догнал подтверждённый серверный эффект: ожидание завершается без нового маршрута',async()=>{const f=fixture();const expiry=f.now+3*3600000;f.response={character:{name:'Hero',activeBuffs:[{skillId:1059,level:3,expiresAtMs:expiry}]}};assert.equal(await start(f),true);assert.ok(f.env.rt.tbInterrupted);f.H[1059]=expiry;assert.equal(await start(f),false);assert.equal(f.env.rt.tbInterrupted,null);assert.equal(f.env.rt.tbuff,undefined);assert.equal(f.route.href,'');assert.equal(f.clicks.length,0)});
