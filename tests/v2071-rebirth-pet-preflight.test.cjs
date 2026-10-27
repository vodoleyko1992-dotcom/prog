'use strict';
// 20.71: собственная подготовка суммона использует прежние явные разрешения и квитанции. Написано, не запускалось.
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./warlock-fixture.cjs');
function own(o={}){
 const f=fixture({...o,cfg:{petFullAuto:false,petAuto:false,...o.cfg}}),raw={petFullAuto:true,petFullMaxPrice:10000000,petFullReserve:null,petFullRenew:true,shopReserve:200000,...o.raw};
 let selected=true;f.env.leaseEpoch='owner';f.env.canAct=()=>true;f.env.canRun=()=>true;f.env.rebirthCfg=()=>selected?raw:null;
 return{...f,raw,select:v=>selected=v,prep:options=>f.api().rebirthPrepare({wanted:()=>selected,returnPath:'/rebirth-raids.html',...options})};
}
test('собственное разрешение полного баффа работает при отключённой обычной petbuff-службе',async()=>{
 const f=own();await f.prep();assert.equal(f.calls.length,1);assert.equal(f.status(),'active');assert.equal(f.env.cfg.petFullAuto,false);
 assert.deepEqual(f.calls[0].body,{set:'summon',expectedRevision:100,expectedFeeAdena:'10000000',expectedFeeCoinOfLuck:0});
});
test('отдельная подготовка не включает выключенное игроком разрешение',async()=>{
 const f=own({raw:{petFullAuto:false}});await f.prep();assert.equal(f.calls.length,0);assert.equal(f.raw.petFullAuto,false);
 let writes=0;f.env.setCfg=async()=>{writes++;};await f.api().autoEnableClass(f.ch);assert.equal(writes,0);
});
test('прежние цена, резерв и неизвестный платёж остаются обязательными',async()=>{
 const cap=own({raw:{petFullMaxPrice:9999999}});await cap.prep();assert.equal(cap.calls.length,0);assert.equal(cap.status(),'price');
 const reserve=own({raw:{petFullReserve:15000000}});await reserve.prep();assert.equal(reserve.calls.length,0);assert.equal(reserve.status(),'reserve');
 const unknown=own({post:()=>{throw Error('lost_response');}});await unknown.prep();assert.equal(unknown.calls.length,1);assert.ok(unknown.env.rt.petFull.pending);
 unknown.reload();unknown.tick(61000);await unknown.prep();assert.equal(unknown.calls.length,1);assert.ok(unknown.env.rt.petFull.pending);
});
test('Stop, потеря вкладки и смена режима до покупки запрещают платёж и поездку',async()=>{
 for(const mode of ['stop','owner','mode']){
  let f;f=own({read:p=>{if(p==='/character/town/buffer/catalog'){if(mode==='stop')f.env.on=false;else if(mode==='owner')f.env.tabOwner=false;else f.select(false);}}});
  let trips=0;f.env.townBufferReady=()=>false;f.env.townBufferStart=async()=>{trips++;};await f.prep();assert.equal(f.calls.length,0,mode);assert.equal(trips,0,mode);
 }
});
test('нужный родной призыв возвращает в каталог Rebirth, а не на обычную карту',async()=>{
 const f=own({cfg:{petAuto:true,petBuffAuto:false,nPetBuffs:''},char:{activeSummon:null,mp:5000}}),nav=[];let page='/rebirth-raid-dungeon.html';
 f.env.nativePanelPath=()=>page;f.env.nativeNavigate=p=>{nav.push(p);page=p;};f.env.nativeReturnPath=()=>'/map.html';
 await f.prep();assert.deepEqual(nav,['/skill-panel.html']);assert.equal(f.env.rt.petPrep.back,'/rebirth-raids.html');assert.equal(f.env.rt.petPrep.rebirth,true);assert.equal(f.env.rt.petPrep.ownerMode,'rebirth');assert.equal(f.calls.length,0);
});
test('смена режима не возобновляет старую бесплатную подготовку с возвратом в Rebirth',async()=>{
 const f=own({cfg:{petAuto:true,petBuffAuto:false,nPetBuffs:''},rt:{petPrep:{char:'hero',rebirth:true,back:'/rebirth-raids.html',pending:{kind:'summon'}}}}),nav=[];
 f.env.startPrepWanted=()=>true;f.env.nativeNavigate=p=>nav.push(p);f.select(false);await f.api().startPrepare({buffs:false});
 assert.equal(f.env.rt.petPrep,null);assert.deepEqual(nav,[]);assert.equal(f.calls.length,0);
});
test('после победы подтверждённое отсутствие кота ведёт к собственной подготовке',async()=>{
 const f=own({battle:true,win:true,char:{activeSummon:null}}),nav=[];f.env.nativeNavigate=p=>nav.push(p);
 await f.prep({afterWin:true});assert.deepEqual(nav,['/rebirth-raids.html']);assert.equal(f.calls.length,0);
});
test('готовый полный набор и действующий оплаченный срок не оплачиваются заново',async()=>{
 const f=own();f.apply();await f.prep();assert.equal(f.calls.length,0);assert.equal(f.status(),'active');
 const paid=own();await paid.prep();const end=paid.env.rt.petFull.lastReceipt.expiresAt;paid.tick(61000);paid.ch.activeSummon.activeBuffs=[];paid.ch.revision++;
 await paid.prep();assert.equal(paid.calls.length,1);assert.equal(paid.status(),'early-loss');assert.equal(paid.env.rt.petFull.nextCheckAt,end);
});
