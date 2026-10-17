'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function load(name,env,location,document={}){const box={console,location,document};vm.runInNewContext(fs.readFileSync(__dirname+'/../modules/'+name+'.js','utf8'),box);return box.L2V7Factories[name](env);}
test('Маммон: текущая Ashen важнее прежней зоны и недавнего zonePend',async()=>{
 const loc={pathname:'/ashen-bastion.html',search:''},env={rt:{zone:'old-low-zone',zonePend:{id:'old-pending',t:Date.now()}},cfg:{},fishNow:()=>false,rec(){},setRt:async p=>Object.assign(env.rt,p)};
 const M=load('mammon',env,loc);assert.equal(M.homePoint(),'ashen_bastion');
 loc.pathname='/battle.html';loc.search='?spawnId=ashen_bastion_mob_002';assert.equal(M.homePoint(),'ashen_bastion');
 await M.finish({kind:'smith',home:M.homePoint()},true,'готово');assert.equal(env.rt.zoneGo.id,'ashen_bastion');assert.equal(env.rt.zoneGo.returnPath,'/ashen-bastion.html');
 loc.pathname='/map.html';loc.search='';assert.equal(M.homePoint(),'old-pending');env.rt.zonePend=null;assert.equal(M.homePoint(),'old-low-zone');
});
function nav(opt={}){
 let clicks=0;const pauses=[];const loc={pathname:opt.path||'/teleport.html',search:'',href:''};
 const row={textContent:opt.paid?'100 аден':'Бесплатно',querySelector:s=>s.includes('currency')?{textContent:'аден',querySelectorAll:()=>[]}:s.includes('price-num')?{textContent:opt.paid?'100':'0'}:null};
 const btn={disabled:false,closest:()=>row};
 const env={on:true,tabOwner:true,cfg:{},rt:{char:'Hero',zoneGo:{id:'ashen_bastion',returnPath:'/ashen-bastion.html',t:1}},
  rec(){},setStatus(){},setRt:async p=>Object.assign(env.rt,p),sleep:async()=>{},shown:b=>!!b,
  pauseBot:async why=>{pauses.push(why);env.on=false;},$q:()=>opt.missing?null:btn,
  waitX:async f=>{if(opt.stop)env.on=false;return f();},fire:()=>{clicks++;loc.pathname=opt.wrong?'/map.html':'/ashen-bastion.html';},
  gameGet:async()=>({ok:true,json:async()=>({character:{name:'Hero',adena:opt.poor?0:1000000}})})};
 return {N:load('navigation',env,loc,{querySelectorAll:()=>[{}],body:{innerText:''}}),env,loc,pauses,clicks:()=>clicks};
}
test('возврат: штатный бесплатный телепорт подтверждён страницей Ashen',async()=>{const f=nav();await f.N.zoneGoStep();assert.equal(f.clicks(),1);assert.equal(f.env.rt.zoneGo,null);assert.equal(f.env.rt.zone,'ashen_bastion');assert.equal(f.pauses.length,0);});
test('нет кнопки: пауза, сохранена цель, перехода на карту нет',async()=>{const f=nav({missing:true});await f.N.zoneGoStep();assert.equal(f.clicks(),0);assert.equal(f.pauses.length,1);assert.equal(f.env.rt.zoneGo.id,'ashen_bastion');assert.equal(f.loc.href,'');});
test('неподтверждённый возврат не становится фармом и не повторяет телепорт после reload',async()=>{const f=nav({wrong:true});await f.N.zoneGoStep();assert.equal(f.clicks(),1);assert.equal(f.pauses.length,1);assert.ok(f.env.rt.zoneGo.sentAt);f.env.on=true;f.loc.pathname='/teleport.html';await f.N.zoneGoStep();assert.equal(f.clicks(),1);assert.equal(f.pauses.length,2);});
test('после перезагрузки уже в Ashen возврат закрывается без клика',async()=>{const f=nav({path:'/ashen-bastion.html'});f.env.rt.zoneGo.sentAt=1;await f.N.zoneGoStep();assert.equal(f.clicks(),0);assert.equal(f.env.rt.zoneGo,null);});
test('Stop во время ожидания не телепортирует и не меняет маршрут',async()=>{const f=nav({stop:true});await f.N.zoneGoStep();assert.equal(f.clicks(),0);assert.equal(f.pauses.length,0);assert.ok(f.env.rt.zoneGo);});
test('платный возврат при недостатке адены ставит паузу',async()=>{const f=nav({paid:true,poor:true});await f.N.zoneGoStep();assert.equal(f.clicks(),0);assert.equal(f.pauses.length,1);});
test('ядро не стирает незавершённый возврат по истечению двух минут',()=>{const s=fs.readFileSync(__dirname+'/../content.js','utf8'),a=s.indexOf("if (rt.zoneGo && !isBattle()) {");assert.ok(a>0);const b=s.slice(a,a+1100);assert.ok(b.indexOf("rt.zoneGo.returnPath === '/ashen-bastion.html'")<b.indexOf('120000'));assert.match(b,/await zoneGoStep\(\); return true;/);});
