'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const sb = {console, URLSearchParams}; sb.globalThis = sb; vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../modules/mobfarm.js'), 'utf8'), sb);
function fixture({ mode = 'farm', level = 85, ready = true, page = 1 } = {}) {
  const clicks = [], status = [];
  let href = '/ashen-bastion.html';
  const fight = { disabled: !ready, textContent: ready ? 'Бій' : 'Возрождение 18 с' };
  const row = {classList:{contains:()=>false},querySelector:s=>s==='button.ashen-fight'?fight:s==='.ashen-name'?{textContent:`Dark Reaper · Lv ${level}`}:null};
  const next = {disabled:page===8}, prev={disabled:page===1};
  sb.location={pathname:'/ashen-bastion.html',get href(){return href},set href(v){href=v},reload(){href+='?reload'}};
  sb.document={querySelectorAll:s=>s==='#ashen-mobs .ashen-mob'?[row]:[],querySelector:s=>s==='#ashen-next'?next:s==='#ashen-prev'?prev:null};
  const env={on:true,tabOwner:true,autonomyMode:()=>mode,cfg:{lvlMin:80,lvlMax:90},setStatus:s=>status.push(s),
    fire:b=>{clicks.push(b);if(b===fight)href='/battle.html?spawnId=ashen_bastion_mob_001';return true},waitFor:async fn=>fn(),sleep:async()=>{}};
  return {mod:sb.L2V7Factories.mobfarm(env), env, clicks, status};
}
(async()=>{
  const f=fixture(); assert.equal(f.mod.ashenRows()[0].lvl,85);await f.mod.ashenStep();assert.equal(f.clicks.length,1);assert.match(sb.location.href,/battle\.html/);
  const dead=fixture({ready:false});await dead.mod.ashenStep();assert.equal(dead.clicks.length,1);assert.match(dead.status[0],/следующая страница/);
  const wrong=fixture({level:75,page:8});await wrong.mod.ashenStep();assert.equal(wrong.clicks.length,0);assert.match(wrong.status[0],/все страницы/);
  const off=fixture({mode:'cat'});await off.mod.ashenStep();assert.equal(off.clicks.length,0);
  console.log('PASS: Ashen Bastion local monster list, pager, level policy, and mode guard');
})().catch(e=>{console.error(e);process.exitCode=1});
