'use strict';
// Контекст await проверяется отдельно в v209-rework-recovery-context.
// Явная блокировка аккаунта не превращается в обычный повторный вход.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../content.js'),'utf8');
const code=source.slice(source.indexOf('function accountLoginBlocked()'),source.indexOf('// ---------- сервер игры недоступен'));
function fixture(text='',options={}){const el={textContent:text,hidden:!!options.hidden},calls={auth:0,click:0,stop:0,idle:0},pw={focus(){},closest:()=>form},btn={textContent:'Войти'},form={querySelectorAll:s=>s.startsWith('button')?[btn]:[]},box={automationSnapshot:()=>1,automationCurrent:()=>true,document:{querySelectorAll:s=>s.includes('#login-msg')?[el]:s.includes('password')?[pw]:[]},shown:e=>!e.hidden,halt:async(msg,hard)=>{calls.stop++;assert.equal(hard,true);assert.match(msg,/Аккаунт заблокирован/);},chrome:{storage:{local:{get:async()=>{calls.auth++;options.afterRead?.(el);return {auth:options.auth?{login:'fixture',pass:'synthetic'}:null}}}}},idle:async()=>{calls.idle++},rt:{},setRt:async()=>{},setStatus(){},rec(){},setVal(){},sleep:async()=>{},rnd:()=>0,fire:()=>{calls.click++;if(options.afterSubmit)el.textContent=options.afterSubmit},waitFor:async f=>f(),loginPage:()=>true,$q:()=>null,location:{pathname:'/'},Node:{DOCUMENT_POSITION_FOLLOWING:4}};vm.runInNewContext(code,box);return {box,calls,el};}
(async()=>{
 for(const text of ['Акаунт заблоковано. Причина: Бот','Аккаунт заблокирован','Учётная запись заблокирована','Account blocked']){const f=fixture(text);await f.box.autoLogin();assert.equal(f.calls.stop,1);assert.equal(f.calls.auth,0);assert.equal(f.calls.click,0)}
 for(const [text,hidden] of [['Неверный пароль',false],['Фарм заблоковано на 1 годину',false],['',false],['Акаунт заблоковано',true]]){const f=fixture(text,{hidden});await f.box.autoLogin();assert.equal(f.calls.stop,0);assert.equal(f.calls.idle,1);assert.equal(f.calls.click,0)}
 {const f=fixture('',{auth:true,afterRead:e=>e.textContent='Акаунт заблоковано'});await f.box.autoLogin();assert.equal(f.calls.stop,1);assert.equal(f.calls.click,0)}
 {const f=fixture('',{auth:true,afterSubmit:'Акаунт заблоковано. Причина: Бот'});await f.box.autoLogin();assert.equal(f.calls.stop,1);assert.equal(f.calls.click,1)}
 console.log('PASS: 10 account-block scenarios; no retry/credential read before visible block, ordinary logout/PvE/hidden text preserved');
})().catch(e=>{console.error(e);process.exitCode=1});
