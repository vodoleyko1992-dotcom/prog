'use strict';
// Реворк17.10: старое восстановление/автовход не продолжают новую сессию после await.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(process.env.RECOVERY_SOURCE||__dirname+'/../content.js','utf8');
const part=(start,end)=>src.slice(src.indexOf(start),src.indexOf(end,src.indexOf(start)));
function fixture(){let now=1e6,reads=0;const events=[],hooks={},field={isConnected:true,focus(){},closest:()=>({querySelectorAll:()=>[]}),form:{requestSubmit:()=>events.push('submit')}};
 const ctx={console,Date:class extends Date{static now(){return now}},JSON,Object,String,Math,RegExp,Node:{DOCUMENT_POSITION_FOLLOWING:4},on:true,tabOwner:true,leaseEpoch:1,cfg:{autoTasks:['auto']},rt:{char:'Hero',manualKickAt:1,errs:[],engineFailures:{}},
 location:{pathname:'/map.html',search:'?spawnId=x',reload:()=>events.push('reload')},modeSig:c=>JSON.stringify(c.autoTasks),autonomyMode:()=> 'farm',L2V7Modules:{actions:{canAct:()=>hooks.frame!==false}},
 netOutage:{since:0,last:0,failures:[]},document:{title:'503',body:{innerText:''},querySelectorAll:s=>s==='input[type="password"]'?[field]:[]},$q:()=>null,
 setStatus:()=>{},rec:()=>{},setRt:async p=>{ctx.rt={...ctx.rt,...p};events.push('write');await hooks.write?.();return{ok:true}},rtCommit:async()=>{events.push('commit');await hooks.commit?.();return hooks.persist!==false},
 sleep:async ms=>{now+=ms;await hooks.sleep?.(ms)},srvUp:async()=>{events.push('probe');await hooks.probe?.();return hooks.up!==false},
 sessionStorage:{getItem:()=>null,setItem(){}},recovery:{count:()=>0,restore(){},restoreFatal(){},exportFatal:()=>null,failure:()=>({action:hooks.action||'reload',programming:false,recent:3,total:3,error:'timeout',delayMs:1500,times:[now]})},
 halt:async()=>events.push('halt'),accountLoginBlocked:()=>false,stopBlockedLogin:()=>events.push('blocked'),idle:async()=>{},loginPage:()=>true,rnd:a=>a,shown:()=>true,setVal:()=>events.push('fill'),fire:()=>events.push('fire'),waitFor:async()=>false,
 chrome:{storage:{local:{get:async()=>{reads++;await hooks.auth?.();return {auth:{login:'fixture',pass:'fixture'}}}}}}};
 vm.createContext(ctx);
 const helper=src.includes('function automationSnapshot()')?part('let automationGeneration = 0;','function heartbeat()'):'';
 vm.runInContext(helper+part('async function serverWait() {','async function serverBack()')+part('async function softError(e) {','// ---------- меню бота справа')+part('async function autoLogin() {','// ---------- сервер игры'),ctx);
 const generation=()=>{ctx.on=false;ctx.on=true;if(helper)vm.runInContext("automationGeneration++;",ctx)};
 return{ctx,hooks,events,generation,authReads:()=>reads};
}
const changes={Stop:f=>f.ctx.on=false,'Stop→Start':f=>f.generation(),'lease':f=>f.ctx.leaseEpoch++,'персонаж':f=>f.ctx.rt.char='Other','задача':f=>f.ctx.cfg.autoTasks=['fish'],'ручная команда':f=>f.ctx.rt.manualKickAt++,'страница':f=>f.ctx.location.pathname='/fishing.html','frame':f=>f.hooks.frame=false};
for(const [name,change]of Object.entries(changes))test('ожидание сервера отменяется при '+name,async()=>{const f=fixture();f.hooks.sleep=()=>change(f);await f.ctx.serverWait();assert.equal(f.events.includes('reload'),false)});
for(const phase of ['write','probe','commit'])test('восстановление не перезагружает новую сессию после '+phase,async()=>{const f=fixture();f.ctx.rt.downN=1;f.hooks[phase]=()=>f.generation();await f.ctx.serverWait();assert.equal(f.events.includes('reload'),false)});
test('перезагрузка сервера требует подтверждённого сохранения',async()=>{const f=fixture();f.hooks.persist=false;await f.ctx.serverWait();assert.equal(f.events.includes('commit'),true);assert.equal(f.events.includes('reload'),false)});
test('действующий контекст сохраняется до перезагрузки',async()=>{const f=fixture();await f.ctx.serverWait();assert.ok(f.events.indexOf('commit')<f.events.indexOf('reload'));assert.equal(f.events.filter(x=>x==='reload').length,1)});
for(const [name,change]of Object.entries(changes))test('обработчик ошибки не восстанавливает старую сессию: '+name,async()=>{const f=fixture();f.hooks.sleep=()=>change(f);await f.ctx.softError(Error('timeout'));assert.equal(f.events.includes('reload'),false);assert.equal(f.events.includes('halt'),false)});
test('ошибка при недоступном storage не провоцирует потерю очереди через reload',async()=>{const f=fixture();f.hooks.persist=false;await f.ctx.softError(Error('timeout'));assert.equal(f.events.includes('reload'),false)});
for(const up of [true,false])test('старый сетевой probe не останавливает новый запуск: up='+up,async()=>{const f=fixture();f.hooks.action='halt';f.hooks.up=up;f.hooks.probe=()=>f.generation();await f.ctx.softError(Error('timeout'));assert.equal(f.events.includes('halt'),false);assert.equal(f.events.includes('reload'),false)});
test('ошибка завершённой старой сессии не записывается в новую',async()=>{const f=fixture();f.hooks.write=()=>f.generation();await f.ctx.softError(Error('timeout'));assert.equal(f.events.includes('reload'),false)});
for(const phase of ['auth','write','sleep'])test('автовход отменяется после '+phase+' при Stop→Start',async()=>{const f=fixture();f.hooks[phase]=()=>f.generation();await f.ctx.autoLogin();assert.equal(f.events.includes('submit'),false);assert.equal(f.events.includes('fire'),false)});
