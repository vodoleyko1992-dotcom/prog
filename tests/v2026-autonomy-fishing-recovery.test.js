'use strict';
// 19.10, аудит автономности: потерянный cast + сломанная native-панель не должны запускать бесконечный reload.
const test=require('node:test'),assert=require('node:assert/strict');
const {world}=require('./v1014-fishing-controls.test.js');
function fixture(){
 const W=world({cfg:{fishMode:true,fishTimeAuto:false}}),e=W.env;W.remain='01:00:00';
 Object.assign(e.rt,{char:'Hero',manualKickAt:0,fishCastPending:{char:'Hero',at:W.box.Date.now()-10000,bait:'basic',before:100,pre:[],requestRevision:100}});
 Object.assign(e,{tabOwner:true,leaseEpoch:7,canRun:()=>true,canAct:()=>true,payments:{blocked:()=>false}});
 const values=new Map();Object.assign(W.box.sessionStorage,{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v))});W.values=values;
 W.state={revision:101,target:{name:'White Fish',currentHp:140,maxHp:140}};W.character={name:'Hero',id:'hero-id',revision:101};W.gets=[];W.posts=[];W.status=[];
 e.setRt=async p=>{Object.assign(e.rt,p);return{ok:true}};
 e.setStatus=s=>W.status.push(s);
 e.gameGet=async p=>{W.gets.push(p);return{ok:true,json:async()=>p==='/character'?{character:W.character}:W.state}};
 e.gamePost=async(p,b)=>{W.posts.push({p,b});return{ok:true}};
 W.factoryReload=()=>{W.F=W.box.L2V7Factories.fishing(e)};
 return W;
}
async function exhaust(W){for(let i=0;i<12;i++){await W.F.castReconcile();W.factoryReload();await W.env.sleep(15000);}}
test('активная рыба на сервере без DOM: максимум три reload за десять минут, pending и исходная revision сохранены',async()=>{
 const W=fixture();await exhaust(W);
 assert.equal(W.reloads,3);assert.ok(W.env.rt.fishCastPending);assert.equal(W.env.rt.fishCastPending.requestRevision,100);
 assert.equal(W.env.rt.fish?.casts||0,0);assert.equal(W.posts.length,0);assert.equal(W.clicks.length,0);
 assert.ok(W.status.some(s=>/3 обновления за 10 мин/.test(s)));
});
test('после reload частые тики не перечитывают сервер до дедлайна, пауза переживает фабрику',async()=>{
 const W=fixture();await W.F.castReconcile();W.factoryReload();
 for(let i=0;i<10;i++)await W.F.castReconcile();
 assert.equal(W.reloads,1);assert.equal(W.gets.length,2);assert.equal(W.posts.length,0);
 await W.env.sleep(6000);await W.F.castReconcile();assert.equal(W.reloads,2);assert.equal(W.gets.length,4);
});
test('бюджет предшествующих fishAct/fishStallCheck действует и на неизвестный cast',async()=>{
 const W=fixture(),now=W.box.Date.now();W.values.set('l2bot.fishReload',JSON.stringify([now-3000,now-2000,now-1000]));
 await W.F.castReconcile();assert.equal(W.reloads,0);assert.equal(W.posts.length,0);assert.ok(W.env.rt.fishCastPending);
 for(let i=0;i<8;i++)await W.F.castReconcile();assert.equal(W.gets.length,2);
});
test('после исчерпания бюджета сверка продолжает идти не чаще пятнадцати секунд',async()=>{
 const W=fixture(),now=W.box.Date.now();W.values.set('l2bot.fishReload',JSON.stringify([now-3000,now-2000,now-1000]));
 await W.F.castReconcile();await W.env.sleep(15000);await W.F.castReconcile();
 assert.equal(W.gets.length,4);assert.equal(W.reloads,0);assert.equal(W.posts.length,0);
});
for(const problem of ['network','revision','missingTarget'])test('после reload несогласованный снимок не вызывает непрерывный опрос: '+problem,async()=>{
 const W=fixture();await W.F.castReconcile();await W.env.sleep(15000);const read=W.env.gameGet;
 if(problem==='network')W.env.gameGet=async p=>{W.gets.push(p);throw Error('offline')};
 if(problem==='revision')W.character.revision=102;
 if(problem==='missingTarget')delete W.state.target;
 await W.F.castReconcile();W.factoryReload();for(let i=0;i<8;i++)await W.F.castReconcile();
 assert.equal(W.gets.length,4);assert.equal(W.reloads,1);assert.equal(W.posts.length,0);assert.ok(W.env.rt.fishCastPending);
 W.env.gameGet=read;W.character.revision=W.state.revision=103;W.state.target=null;
 await W.env.sleep(15000);await W.F.castReconcile();assert.equal(W.env.rt.fishCastPending,null);assert.equal(W.env.rt.fish.casts,1);assert.equal(W.posts.length,0);
});
test('лимит истекает: восстановление снова пробует reload без ручного запуска',async()=>{
 const W=fixture();await exhaust(W);assert.equal(W.reloads,3);
 await W.env.sleep(600001);W.factoryReload();await W.F.castReconcile();
 assert.equal(W.reloads,4);assert.equal(W.posts.length,0);assert.ok(W.env.rt.fishCastPending);
});
test('история внутри pending сохраняет предел при недоступном sessionStorage',async()=>{
 const W=fixture();Object.assign(W.box.sessionStorage,{getItem(){throw Error('storage disabled')},setItem(){throw Error('storage disabled')}});
 await exhaust(W);assert.equal(W.reloads,3);assert.equal(W.posts.length,0);assert.ok(W.env.rt.fishCastPending);
});
test('DOM ожил во время паузы: pending закрывается сразу и текущая рыба передана вываживанию',async()=>{
 const W=fixture();await W.F.castReconcile();W.factoryReload();W.active=true;
 let fought=0;W.env.tvtStep=async()=>{fought++;return true};
 await W.F.castReconcile();assert.equal(W.env.rt.fishCastPending,null);assert.equal(W.env.rt.fish.casts,1);assert.equal(W.env.rt.fish.bites,1);
 assert.equal(fought,1);assert.equal(W.gets.length,2);assert.equal(W.reloads,1);assert.equal(W.posts.length,0);
});
test('после паузы сервер подтверждает отсутствие рыбы и новую revision: один учтённый заброс без повтора',async()=>{
 const W=fixture();await W.F.castReconcile();W.state.target=null;await W.env.sleep(15000);W.factoryReload();
 await W.F.castReconcile();assert.equal(W.env.rt.fishCastPending,null);assert.equal(W.env.rt.fish.casts,1);assert.equal(W.env.rt.fish.bites||0,0);
 assert.equal(await W.F.castReconcile(),false);assert.equal(W.reloads,1);assert.equal(W.posts.length,0);
});
test('observeOnly не делает reload или cast, даже когда сервер видит активную рыбу',async()=>{
 const W=fixture();for(let i=0;i<5;i++){await W.F.castReconcile({observeOnly:true});W.factoryReload();}
 assert.equal(W.reloads,0);assert.equal(W.posts.length,0);assert.ok(W.env.rt.fishCastPending);assert.equal(W.env.rt.fishCastActive,undefined);
});
for(const [name,change] of Object.entries({stop:W=>W.env.on=false,lease:W=>W.env.leaseEpoch++,selection:W=>W.env.autonomyMode=()=> 'tasks',actor:W=>W.env.rt.char='Other'}))test('потеря контекста при commit запрещает reload: '+name,async()=>{
 const W=fixture();W.env.rtCommit=async()=>{change(W);return true};await W.F.castReconcile();assert.equal(W.reloads,0);assert.equal(W.posts.length,0);assert.equal(W.values.has('l2bot.fishReload'),false);
});
test('ошибка durable commit запрещает reload и не снимает pending',async()=>{
 const W=fixture();W.env.rtCommit=async()=>false;await W.F.castReconcile();assert.equal(W.reloads,0);assert.equal(W.posts.length,0);assert.ok(W.env.rt.fishCastPending);assert.equal(W.values.has('l2bot.fishReload'),false);
});
test('отклонённая запись запрещает reload и не снимает pending',async()=>{
 const W=fixture();W.env.setRt=async()=>({ok:false});await W.F.castReconcile();assert.equal(W.reloads,0);assert.equal(W.posts.length,0);assert.ok(W.env.rt.fishCastPending);
});
test('после cast reload общий сторож вываживания не получает новый бюджет',async()=>{
 const W=fixture();await exhaust(W);W.active=true;W.slots.pumping={kind:'pumping',disabled:true};
 await W.F.castReconcile();await W.env.sleep(9000);await W.F.fishFight();
 assert.equal(W.reloads,3);assert.equal(W.posts.length,0);
});
test('дневная сверка не готова: новый заброс не создаёт intent и не кликает',async()=>{
 const W=fixture();W.env.rt.fishCastPending=null;let checks=0;
 W.env.dailyWorkReady=async k=>{assert.equal(k,'fish');checks++;return false};
 await W.F.fishing();assert.equal(checks,1);assert.equal(W.clicks.length,0);assert.equal(W.env.rt.fishCastPending,null);
});
test('дневная сверка готова: новый заброс разрешён',async()=>{
 const W=fixture();W.env.rt.fishCastPending=null;let checks=0;
 W.env.dailyWorkReady=async k=>{assert.equal(k,'fish');checks++;return true};
 const fire=W.env.fire;W.env.fire=b=>{const r=fire(b);if(b?.kind==='fishing')W.env.on=false;return r};
 await W.F.fishing();assert.equal(checks,1);assert.equal(W.clicks.filter(b=>b.kind==='fishing').length,1);assert.ok(W.env.rt.fishCastPending);
});
test('Stop при дневной сверке не разрешает уже выбранный заброс',async()=>{
 const W=fixture();W.env.rt.fishCastPending=null;W.env.dailyWorkReady=async()=>{W.env.on=false;return true};
 await W.F.fishing();assert.equal(W.clicks.length,0);assert.equal(W.env.rt.fishCastPending,null);
});
