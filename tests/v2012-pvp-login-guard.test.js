'use strict';
// 20.12 (ревизия 17.10, аудит core-a/C1): PvP-восстановление на странице входа / незагруженной странице игры не уводит на /map.html
// каждый круг (раньше main() так и не доходил до автовхода). Стенд — из v1015-pvp-independent (настоящие modules/pvp.js + enemies.js).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'v1015-pvp-independent.test.js'),'utf8');
const i=src.indexOf("const ROOT="),j=src.indexOf('const clicks=');
const box={require,__dirname,process,fs,vm,path,assert,console,URLSearchParams,Math,Object,Date};
vm.runInNewContext(src.slice(i,j)+';this.fixture=fixture;',box);
function dead(){
 const f=box.fixture();f.nodes['#map-defeat-root']={};f.nodes['#map-defeat-shout']={textContent:'Вас вбив игрок [Dremia]!'};
 return f;
}
async function pendingOnLogin(){
 const f=dead();
 // первый круг: смерть поймана, кнопки «В город» ещё нет — восстановление висит
 f.env.waitX=async()=>null;await f.pvp.recoveryStep();assert.equal(f.pvp.pending(),true);
 // выкинуло на форму входа
 for(const k of Object.keys(f.nodes))delete f.nodes[k];
 f.location.pathname='/';let nav=0;Object.defineProperty(f.location,'href',{set(){nav++},get(){return 'https://l2wap.com/'}});
 return {f,nav:()=>nav};
}
test('страница входа: PvP-восстановление ждёт входа и не уводит на карту',async()=>{
 const {f,nav}=await pendingOnLogin();f.env.loginPage=()=>true;f.env.gameLoaded=()=>false;
 for(let k=0;k<3;k++)assert.equal(await f.pvp.recoveryStep(),true);
 assert.equal(nav(),0,'переходов на /map.html нет');
});
test('незагруженная страница игры: 15 с ожидания без перехода, затем прежнее восстановление',async()=>{
 const {f,nav}=await pendingOnLogin();f.env.loginPage=()=>false;f.env.gameLoaded=()=>false;
 assert.equal(await f.pvp.recoveryStep(),true);assert.equal(nav(),0);
 f.setNow(1e6+16000);assert.equal(await f.pvp.recoveryStep(),true);assert.equal(nav(),1,'после 15 с — переход на карту, как раньше');
});
