'use strict';
// 25.10 (лог 17:11/17:12, 20.62): игра уводит с /map.html в Ashen Bastion, браузер обрывает свой GET /character
// (TypeError за 0 с) — в статусе было «Сверяю сумку… ошибка чтения». Уход со страницы не ошибка и не попытка.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../content.js'),'utf8');
const getter=source.slice(source.indexOf('async function gameGet('),source.indexOf('// 7.2.5',source.indexOf('async function gameGet(')));
const inventory=source.slice(source.indexOf('let INV_NET ='),source.indexOf('const actNet ='));
function fixture(leaving){
 let now=1800000000000;const recs=[],statuses=[],calls=[];
 const box={Date:class extends Date{static now(){return now}},AbortSignal:{timeout:()=>new AbortController().signal},AbortController,
  setTimeout,clearTimeout,gameAuth:()=>({}),cfg:{},on:true,tabOwner:true,leaseEpoch:'one',automationGeneration:1,pageLeaving:leaving,pageGone:false,
  rt:{char:'Hero',classCur:{prof:'dwarf_warsmith',slot:2},manualKickAt:0},heroNick:()=>'Hero',
  sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},setStatus:s=>statuses.push(s),rec:(...a)=>recs.push(a.join(' ')),modeSig:c=>JSON.stringify(c),
  setRt:async()=>({ok:true}),rtCommit:async()=>true,L2V7Modules:{},
  fetch:url=>{calls.push(url);return Promise.reject(new TypeError('Failed to fetch'))}};
 vm.createContext(box);vm.runInContext(getter+inventory+';this.inspectInv=()=>INV_RETRY;',box);
 return{box,recs,statuses,calls,tick:ms=>now+=ms};
}
test('обрыв GET уходом со страницы: без «ошибка чтения» в статусе и без счёта попытки',async()=>{
 const f=fixture(true);
 assert.equal(await f.box.inventoryReady(),false);
 assert.equal(f.statuses.length,0);assert.equal(f.recs.length,0);
 assert.equal(f.box.inspectInv().n,0,'переход не копит попытки до перезагрузки карты');
 assert.equal(await f.box.inventoryReady(),false);assert.equal(f.calls.length,1,'пауза 2 с: без частых GET');
 f.tick(2001);assert.equal(await f.box.inventoryReady(),false);assert.equal(f.calls.length,2);assert.equal(f.box.inspectInv().n,0);
});
test('настоящая ошибка чтения на месте по-прежнему видна и считается',async()=>{
 const f=fixture(false);
 assert.equal(await f.box.inventoryReady(),false);
 assert.equal(f.box.inspectInv().n,1);assert.match(f.statuses[0],/ошибка чтения/);assert.match(f.recs[0],/Проверка 1 не подтверждена/);
});
