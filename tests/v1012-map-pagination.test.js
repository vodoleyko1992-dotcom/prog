'use strict';
// 14.10: карта игры использует 1 2 3 4 5 >>, а стрелки переключают группы из пяти страниц.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const sandbox = { console, document: null }; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../modules/mobfarm.js'), 'utf8'), sandbox);
function fixture({ count = 398, current = 1, legacy = false, fallback = false, stalled = false, denied = false } = {}) {
  let cur = current, clicks = [], waits = 0; const ids = Array.from({length:count}, (_,i)=>'mob'+i);
  const btn = (label, page, disabled = false) => ({textContent:label, page, disabled});
  function buttons() {
    if (legacy || fallback || count <= 15) return [];
    const total=Math.ceil(count/15), first=Math.floor((cur-1)/5)*5+1, last=Math.min(total,first+4), out=[];
    if(first>1)out.push(btn('<<',first-5));
    for(let p=first;p<=last;p++)out.push(btn(String(p),p,p===cur));
    if(last<total)out.push(btn('>>',first+5));
    return out;
  }
  const list = {get dataset() {return {l2AroundSig:count+'|'+ids.map(id=>id+':1').join(',')+'|p'+(cur-1)+'|lv74|qnone'};}};
  const ind = {get textContent(){return legacy ? `${cur} / ${Math.ceil(count/15)} (${count})` : fallback ? `${cur} / ${Math.ceil(count/15)}` : buttons().map(b=>b.textContent).join('');},
    querySelectorAll:()=>buttons()};
  const q = sel => sel==='#map-mob-list'?list:sel==='#map-mob-page-ind'?ind:
    sel==='#map-mob-page-next'?btn('next',cur+1,cur>=Math.ceil(count/15)):
    sel==='#map-mob-page-prev'?btn('prev',cur-1,cur<=1):null;
  sandbox.document={querySelectorAll:()=>ids.slice((cur-1)*15,cur*15).map(id=>({getAttribute:()=>'/battle.html?spawnId='+id,textContent:'Mob · ур. 74',classList:{contains:()=>false},className:''}))};
  const env={PAGE_SIZE:15,on:true,$q:q,LV_RE:/^()(.*?) · ур\. (\d+)/,QUEST:/★/,isChamp:()=>false,isBoss:()=>false,isRaidId:()=>false,
    fire:b=>{if(denied)return false;clicks.push(b.textContent);if(!stalled)cur=b.page;return true;},
    waitFor:async predicate=>{waits++;return predicate()||null;},sleep:async()=>{},rnd:()=>0};
  const mod=sandbox.L2V7Factories.mobfarm(env);
  return {mod,env,state:()=>({cur,clicks,waits})};
}
(async()=>{
  const map=fixture(); assert.deepEqual(JSON.parse(JSON.stringify(map.mod.pagerInfo())),{cur:1,total:27,count:398});
  assert.equal(await map.mod.gotoPage(24),true);assert.deepEqual(map.state().clicks,['>>','>>','>>','>>','24']);
  assert.equal(await map.mod.gotoPage(3),true);assert.deepEqual(map.state().clicks.slice(5),['<<','<<','<<','<<','3']);
  const old=fixture({legacy:true});assert.equal(await old.mod.gotoPage(3),true);assert.deepEqual(old.state().clicks,['next','next']);
  const fallback=fixture({fallback:true});assert.equal(await fallback.mod.gotoPage(2),true);
  const last=fixture({current:26});assert.equal(await last.mod.gotoPage(99),true);assert.equal(last.state().cur,27);
  const one=fixture({count:7});assert.deepEqual(JSON.parse(JSON.stringify(one.mod.pagerInfo())),{cur:1,total:1,count:7});assert.equal(await one.mod.gotoPage(5),true);assert.equal(one.state().clicks.length,0);
  const denied=fixture({denied:true});assert.equal(await denied.mod.gotoPage(3),false);assert.equal(denied.state().waits,0);
  const stalled=fixture({stalled:true});assert.equal(await stalled.mod.gotoPage(3),false);assert.equal(stalled.state().clicks.length,1);
  const stopped=fixture();stopped.env.on=false;assert.equal(await stopped.mod.gotoPage(3),false);assert.equal(stopped.state().clicks.length,0);
  console.log('PASS: map pagination — numbered pages, five-page groups, old UI, boundaries and denied/stalled clicks');
})().catch(e=>{console.error(e);process.exitCode=1;});
