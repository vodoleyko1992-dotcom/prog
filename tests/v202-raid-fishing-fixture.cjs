'use strict';
const {fishingRecovery,until,delay}=require('./v101-fishing-cast-recovery-fixture.cjs');
async function raidFishing(){
 const f=await fishingRecovery('raid-fallback'),{h,S,state}=f;let release;const gate=new Promise(r=>release=r);S.fightHeld=false;S.mapVisits=0;
 await h.ctx.route('https://l2wap.com/map.html',r=>{S.mapVisits++;return r.fulfill({contentType:'text/html',body:'<!doctype html><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">75</div><div id="character-profession">Human Warlock</div><span id="l2-hud-hp-cur">16000</span><span id="l2-hud-hp-max">16000</span><span id="l2-hud-mp-cur">6000</span><span id="l2-hud-mp-max">6000</span><div id="map-mob-list" data-l2-around-sig="0||p0|lv75|q"></div><script>(async()=>{while(!window.__l2botHook)await new Promise(r=>setTimeout(r,20));await fetch("/character")})();</script>'});});
 await h.ctx.route('https://l2wap.com/game/fishing/action',async r=>{
  const b=r.request().postDataJSON(),json=(x,status=200)=>r.fulfill({status,contentType:'application/json',body:JSON.stringify(x)});
  if(b.expectedRevision!==state.revision)return json({error:'revision_conflict'},409);
  if(b.action==='cast'){S.casts.push(b);S.accepted++;state.revision++;state.basicBait.quantity--;state.target={name:'White Fish',currentHp:70,maxHp:70,stateHint:'Рыба замерла — Pumping'};state.logTail=[{kind:'bite',text:'Что-то клюнуло!'}];}
  else if(['pumping','reeling'].includes(b.action)){S.fightHeld=true;await gate;S.hits++;state.revision++;state.target=null;state.logTail=[{kind:'catch',text:'Вы вытащили White Fish.'}];}
  else S.errors.push('unexpected fishing action '+b.action);
  return json({fishing:state,revision:state.revision});
 });
 await h.sw.evaluate(async()=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']),now=Date.now();await chrome.storage.local.set({cfg:{...cfg,autoTasks:['raid','fish','tvt'],fishMode:false,rbHuntMode:true,rbMode:true,rbFaFull:false,shopAuto:false,petAuto:false,petBuffAuto:false,autoRoles:false,rbMaxBelow:12,rbMaxAbove:12},rt:{...rt,rbHunt:{step:'pick'},rbHuntIdle:0,rbIdleMark:null,rbFishWait:null,rbListT:now,rbListVerifiedAt:now,rbList:Object.fromEntries(Array.from({length:51},(_,i)=>['mob_rb_'+(29095+i),{id:'mob_rb_'+(29095+i),name:'Fixture Raid '+i,lvl:80,alive:false,page:1,price:100000,unit:'аден',t:now}])),rbStats:{},rbSkip:{},rbPreSkip:{},rbWound:{},rbRefuse:null,rbScan:null}});});
 await h.g.p.goto('https://l2wap.com/map.html');await until(()=>h.g.core('typeof L2V7Modules.raid === "object"'));await h.popup.reload();
 return {...f,releaseFight:()=>release(),close:async()=>{release();await f.close();}};
}
module.exports={raidFishing,until,delay};
