'use strict';
// 15.10, аудит: rid нужен для привязки поздних ответов к персонажу/владельцу вкладки, не только для busy боя.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 const out=[];let finish;const response={status:200,headers:{get:()=> 'application/json'},clone:()=>({text:async()=> '{}'})};
 const window={postMessage:x=>out.push(x),fetch:()=>new Promise(r=>{finish=()=>r(response)}),alert(){}};
 class X {open(){} send(){this.status=200;this.responseText='{}';this.end()}addEventListener(_,cb){this.end=cb}getResponseHeader(){return 'application/json'}}
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../hook.js'),'utf8'),{window,location:{href:'https://l2wap.com/map.html',origin:'https://l2wap.com',host:'l2wap.com',pathname:'/map.html'},URL,URLSearchParams,XMLHttpRequest:X,performance:{now:()=>1},console});
 return {out,window,X,finish:()=>finish()};
}
for(const path of ['/game/tvt/state','/game/daily-quests','/game/map','/game/catacombs/enter','/character/teleport','/character/town/buffer']){
 test('actual hook fetch correlates '+path,async()=>{
  const f=fixture(),p=f.window.fetch(path+'?sid=hidden',{method:'POST',body:'{}'});const start=f.out.find(x=>x.__l2bot==='netStart');
  assert.ok(Number.isSafeInteger(start?.rid));assert.equal(start.path,path);assert.equal(start.method,'POST');assert.equal(JSON.stringify(start).includes('hidden'),false);
  f.finish();await p;for(let i=0;i<8;i++)await Promise.resolve();
  assert.equal(f.out.find(x=>x.__l2bot==='net').rid,start.rid);
 });
}
test('actual XHR shares distinct request IDs with fetch for non-battle game requests',async()=>{
 const f=fixture(),p=f.window.fetch('/game/map');const x=new f.X();x.open('POST','/game/tvt/register');x.send('{}');f.finish();await p;for(let i=0;i<8;i++)await Promise.resolve();
 const starts=f.out.filter(x=>x.__l2bot==='netStart'),ends=f.out.filter(x=>x.__l2bot==='net');
 assert.equal(starts.length,2);assert.notEqual(starts[0].rid,starts[1].rid);assert.deepEqual(ends.map(x=>x.rid).sort(),starts.map(x=>x.rid).sort());
});
test('foreign requests and static assets do not open request context',async()=>{
 for(const path of ['https://other.invalid/game/map','/game/ui.js']){const f=fixture(),p=f.window.fetch(path);f.finish();await p;for(let i=0;i<8;i++)await Promise.resolve();assert.equal(f.out.length,0)}
});
