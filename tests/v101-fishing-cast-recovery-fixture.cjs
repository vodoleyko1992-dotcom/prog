'use strict';
const fs=require('node:fs'),path=require('node:path');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
async function fishingRecovery(kind){
 const cache=process.env.L2_FISHING_PUBLIC||['/tmp/prog-game-static',...fs.readdirSync('/tmp').filter(n=>n.startsWith('l2bot-fishing-public-')).sort().map(n=>path.join('/tmp',n))].find(p=>fs.existsSync(path.join(p,'fishing.html'))&&fs.existsSync(path.join(p,'fishing-page.js')));
 if(!cache)throw Error('Cached public fishing assets required: set L2_FISHING_PUBLIC (test never uses live network)');
 const h=await harness();
 const state=JSON.parse(fs.readFileSync(path.join(__dirname,'../kb/raw/fishing-state.json'))).data;
 Object.assign(state,{revision:100,target:null,logTail:[],serverNowMs:Date.now()});Object.assign(state.basicBait,{quantity:30,selected:true});Object.assign(state.goodBait,{quantity:0,selected:false});Object.assign(state.fishingSoulshot,{quantity:100,enabled:true});Object.assign(state.fishingTime,{remainingMs:18000000,active:false,canFish:true});state.cooldowns={pumpingMs:100,reelingMs:100,pumpingUntil:0,reelingUntil:0};
 const S={casts:[],accepted:0,hits:0,gets:0,held:false,visits:0,errors:[],tvt:false};let release;const gate=new Promise(r=>release=r);
 const char=()=>({name:'AuditHero',id:'fixture-fisher',level:75,l2Profession:'human_warlock',revision:state.revision,hp:16000,maxHp:16000,mp:6000,maxMp:6000,adena:1000000,inventory:{stacks:[],eq:{}},activeBuffs:[]});
 const accept=()=>{S.accepted++;state.revision++;state.basicBait.quantity--;state.target={name:'White Fish',currentHp:70,maxHp:70,stateHint:'Рыба замерла — Pumping'};state.logTail=[{text:'Что-то клюнуло!',kind:'bite'},{text:'Вы забросили удочку...',kind:'cast'}];};
 await h.ctx.route('https://l2wap.com/**',async r=>{try{const p=new URL(r.request().url()).pathname,json=(data,status=200)=>r.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  if(p==='/character')return json({character:char()});
  if(p==='/game/tvt')return json({phase:S.tvt?'REGISTRATION':'IDLE',eventId:'fixture-tvt',isRegistered:S.tvt,startsAt:Date.now()+30000,registrationEndsAt:Date.now()+20000,serverNow:Date.now()});
  if(p==='/game/fishing/state'){S.gets++;if(['stop','tvt','selection'].includes(kind)&&S.casts.length&&!S.held){S.held=true;await gate;}state.serverNowMs=Date.now();return json(state);}
  if(p==='/game/fishing/action'){
   const b=r.request().postDataJSON();if(b.action==='cast'){S.casts.push(b);if(S.casts.length===1){if(kind.startsWith('accepted-lost'))accept();return r.abort('failed');}if(kind==='race'&&S.accepted===0)accept();if(b.expectedRevision!==state.revision)return json({error:'revision_conflict'},409);accept();}
   else if(['pumping','reeling'].includes(b.action)){if(b.expectedRevision!==state.revision)return json({error:'revision_conflict'},409);S.hits++;state.revision++;state.target=null;state.logTail=[{kind:'catch',text:'Вы вытащили White Fish.'}];}
   else throw Error('unexpected fishing action '+b.action);
   return json({fishing:state,revision:state.revision,character:char()});
  }
  if(p==='/fishing.html'){S.visits++;let html=fs.readFileSync(path.join(cache,'fishing.html'),'utf8').replace(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g,(a,s)=>/\/(?:fishing-|battle-hotbar-cd)/.test(s)?a:'').replace(/<link\b[^>]*>/g,'');html=html.replace('</body>','<div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">75</div><span id="l2-hud-hp-cur">16000</span><span id="l2-hud-hp-max">16000</span><span id="l2-hud-mp-cur">6000</span><span id="l2-hud-mp-max">6000</span><script>(async()=>{while(!window.__l2botHook)await new Promise(r=>setTimeout(r,20));await fetch("/character")})();</script></body>');return r.fulfill({contentType:'text/html',body:html});}
  const file=path.join(cache,path.basename(p));if(p.endsWith('.js')&&fs.existsSync(file))return r.fulfill({contentType:'application/javascript',body:fs.readFileSync(file)});
  if(r.request().method()==='POST')throw Error('unexpected POST '+p);return json({});
 }catch(e){S.errors.push(e.message);return r.fulfill({status:500,body:'{}'}).catch(()=>{});}});
 await h.ctx.addInitScript(()=>{localStorage.setItem('token','fixture');window.L2={whenReady:f=>f(),applyCharacterSnapshot(){},fetchCatalogHints:async()=>{},lastSnapshot:()=>({revision:100}),authFetch:(u,i)=>fetch(u,i),resyncCharacterAfterConflict:async()=>{await fetch('/character');}};});
 await h.sw.evaluate(async(kind)=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({cfg:{...cfg,autoTasks:['fish','tvt'],tvtOn:true,fishMode:true,fishAutoSetup:false,fishTimeAuto:false,fishAutoBuy:false,fishProcess:false,fishShots:true,fishBait:'basic',rodEnchantTo:0,fishMaxCasts:kind==='accepted-lost-limit'?1:0,reactMin:0,reactMax:0},rt:{...rt,char:'AuditHero',rodLvl:10,fishSetupDone:Date.now(),fishCastPending:null}});},kind);
 await h.g.p.goto('https://l2wap.com/fishing.html');await until(()=>h.g.core('typeof L2V7Modules.fishing==="object"'));await h.g.p.waitForSelector('.l2-fishing-hotbar-slot');await h.popup.reload();
 return {h,S,state,release:()=>release(),start:()=>h.click('start'),close:async()=>{release();await h.ctx.close();}};
}
module.exports={fishingRecovery,until,delay};
