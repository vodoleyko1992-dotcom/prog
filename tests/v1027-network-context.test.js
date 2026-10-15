'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),cp=require('node:child_process');
const source=process.env.BASELINE?cp.execFileSync('git',['show','HEAD:content.js'],{encoding:'utf8'}):fs.readFileSync(require('node:path').join(__dirname,'../content.js'),'utf8');
function fixture(){
 const listeners=[],notes=[],stored={},win={};let hero='Old';
 const box={console,Date,Map,rt:{char:'Old'},leaseEpoch:'old-lease',ACT_NET:{start:0},location:{origin:'https://l2wap.com'},window:win,
 heroNick:()=>hero,apiPath:x=>new URL(x,'https://l2wap.com').pathname,TAG:'test',L2V7Modules:{pvp:{onNet:(p,d)=>notes.push(p)},payments:{pending:()=>({id:'intent-1'})}},
 sessionStorage:{getItem:k=>stored[k],setItem:(k,v)=>stored[k]=v},addEventListener:(_,f)=>listeners.push(f)};
 let start=source.slice(source.indexOf('const GAME_REQ ='),source.indexOf('async function weaponEquipNote'));
 let end=source.slice(source.indexOf("addEventListener('message', e => {",source.indexOf('const zoneMoveNet =')),source.indexOf('  // 8.0.3 (логи 11.10 09:11'))+'});';
 vm.runInNewContext(start+end+'\nthis.busy=gameBusy',box);
 const emit=d=>listeners.forEach(f=>f({source:win,origin:box.location.origin,data:d}));
 return{box,notes,stored,busy:()=>box.busy(),switchChar(){box.rt={char:'New'};hero='New';box.leaseEpoch='new-lease'},
 start:(path,rid=1)=>emit({__l2bot:'netStart',path,rid}),end:(path,rid=1,extra={})=>emit({__l2bot:'net',url:path,rid,status:200,...extra})};
}
for(const path of ['/game/tvt','/game/daily-quests','/game/map/around'])test(path+' поздний ownerless ответ не загрязняет другой профиль',()=>{
 const f=fixture();f.start(path);f.switchChar();f.end(path);assert.equal(f.notes.length,0);
});
test('поздний character освобождает busy, но не вызывает обработчики нового героя',()=>{
 const f=fixture();f.start('/character');assert.equal(f.busy().busy,true);f.switchChar();f.end('/character');assert.equal(f.busy().busy,false);assert.equal(f.notes.length,0);
});
test('same character response allowed; noncombat request never blocks native actions',()=>{
 const f=fixture();f.start('/game/tvt');assert.equal(f.busy().busy,false);f.end('/game/tvt');assert.deepEqual(f.notes,['/game/tvt']);
});
test('утрата lease отвергает поздний ответ даже того же персонажа',()=>{const f=fixture();f.start('/game/tvt');f.box.leaseEpoch='replacement';f.end('/game/tvt');assert.equal(f.notes.length,0)});
test('явное чужое имя отвергается без netStart',()=>{const f=fixture();f.end('/character',undefined,{hero:{name:'Other'}});assert.equal(f.notes.length,0)});
test('cat receipt synchronously carries payment identity captured at request start',()=>{
 const f=fixture();f.start('/game/catacombs/teleport');f.box.L2V7Modules.payments.pending=()=>({id:'later'});
 f.end('/game/catacombs/teleport',1,{method:'POST',req:{dungeonId:'disciples',expectedRevision:42,expectedAdenaCost:10000},res:{character:{name:'Old',id:'hero1'}}});
 const a=JSON.parse(f.stored['l2bot.catTpReceipt']);assert.equal(a.paymentId,'intent-1');assert.equal(a.id,'disciples');assert.equal(a.ok,true);
});

test('ответ вытесненного старого rid не принимается как новый',()=>{const f=fixture();f.start('/game/tvt',1);for(let i=2;i<1003;i++)f.start('/game/tvt',i);f.end('/game/tvt',1);assert.equal(f.notes.length,0)});

for(const path of ['/game/map/around','/game/daily-quests','/game/catacombs/teleport'])test(path+' не удерживает боевую очередь',()=>{const f=fixture();f.start(path);assert.equal(f.busy().busy,false)});
test('battle action удерживает busy до ответа',()=>{const f=fixture();f.start('/game/battle/action');assert.equal(f.busy().busy,true);f.end('/game/battle/action');assert.equal(f.busy().busy,false)});

test('тот же герой сменил подкласс: поздние GET и action прежнего класса отвергаются',()=>{const f=fixture();f.box.rt.classCur={prof:'warlock',slot:0};f.start('/character',1);f.start('/game/battle/action',2);f.box.rt.classCur={prof:'dark_avenger',slot:1};f.end('/character',1);f.end('/game/battle/action',2);assert.deepEqual(f.notes,[]);assert.equal(f.busy().busy,false)});

test('ответ без наблюдаемого начала не приписывается текущему профилю',()=>{const f=fixture();f.switchChar();f.end('/game/tvt',100);assert.equal(f.notes.length,0)});
