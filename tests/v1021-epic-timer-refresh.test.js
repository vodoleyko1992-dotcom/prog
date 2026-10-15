'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const read=f=>fs.readFileSync(__dirname+'/../'+f,'utf8');
const H=3600000, t=Date.UTC(2026,9,15,0,0);
function timer(){const box={console,Date,Math,sessionStorage:{getItem:()=>null}};box.globalThis=box;vm.runInNewContext(read('modules/rbtimer.js'),box);
 return box.L2V7Factories.rbtimer({rt:{},cfg:{},rec:()=>{},setRt:async()=>{}});}
test('просроченный эпик после свежей проверки показывает состояние сервера, а не старый отсчёт',()=>{
 const R=timer(), id='l2dop_rb_29001';let s=R.observe(null,[{id,n:'АК',l:40,e:true,rh:12,al:false}],t).T;
 s=R.observe(s,[{id,n:'АК',l:40,e:true,rh:12,al:false}],t+13*H).T;
 const msg=R.upTxt(R.timerOf(s,id,t+13*H),t+13*H);
 assert.match(msg,/всё ещё убит по списку игры/);assert.match(msg,/проверено/);assert.match(msg,/новый респ неизвестен/);
});
test('без новой проверки просроченный прогноз отмечен как устаревший',()=>{
 const R=timer(), id='l2dop_rb_29001',s=R.observe(null,[{id,n:'АК',l:40,e:true,rh:12,al:false}],t).T;
 assert.match(R.upTxt(R.timerOf(s,id,t+13*H),t+13*H),/прогноз респа истёк.*жду свежий список/);
});
test('при открытии страницы список DOM синхронизируется с таймерами',()=>{
 assert.match(read('content.js'),/if \(isEpicPage\(\)\) setTimeout\(\(\) => epicListScan\(\)/);
 assert.match(read('modules/epics.js'),/rbTimerListNote\?\.\(\{ bosses: n\.filter/);
});
