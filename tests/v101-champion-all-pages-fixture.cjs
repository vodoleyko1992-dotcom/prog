'use strict';
// Настоящие MV3/main и DOM-пагинация; все имена известны, типы NET отсутствуют.
const {questChampion,until,delay}=require('./v1029-quest-champion-fixture.cjs');
async function allPages(opt={}){
 const f=await questChampion({noNet:true}),h=f.h,S={pages:[],champPage:opt.noChampion?0:12,tvt:false,generation:0,held:false,battleTargets:[]};
 let release;const gate=new Promise(r=>release=r),count=300,size=15;
 const ids=()=>Array.from({length:count},(_,i)=>i===(S.champPage-1)*size?f.id:opt.redPage&&i===15?'red_fixture':'known_'+S.generation+'_'+i);
 const data=p=>({p,count,ids:ids(),generation:S.generation,rows:ids().slice((p-1)*size,p*size).map(id=>({id,champ:id===f.id||id==='red_fixture',tier:id==='red_fixture'?'red':'blue',name:id===f.id?'Leto Lizardman Soldier':'Leto Lizardman Warrior'}))});
 const mapHTML=()=>`<!doctype html><meta charset="utf-8"><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">78</div><div id="character-profession">Human Warlock</div><div id="l2-nav-bottom"><a data-nav-role="outskirts" href="/map.html">Окрестности</a></div><span id="l2-hud-hp-cur">16660</span><span id="l2-hud-hp-max">16660</span><span id="l2-hud-mp-cur">6355</span><span id="l2-hud-mp-max">6355</span><div id="map-mob-list"></div><div id="map-mob-page-ind"></div><script>
 localStorage.setItem('token','fixture');
 function render(d){document.querySelector('#map-mob-list').dataset.l2AroundSig=d.count+'|'+d.ids.map(id=>id+':1').join(',')+'|p'+(d.p-1)+'|lv78|q';document.querySelector('#map-mob-list').innerHTML=d.rows.map(r=>'<li class="'+(r.champ?'l2-map-mob-item--champion-'+r.tier:'')+'"><a class="l2-map-mob-link" href="/battle.html?spawnId='+r.id+'">'+r.name+' · ур.37'+(r.champ?' · чемпион':'')+'</a><span>HP '+(r.champ?27384:1908)+' · EXP 30450</span></li>').join('');const start=Math.floor((d.p-1)/5)*5+1;let buttons=[];if(start>1)buttons.push(['<<',start-5]);for(let p=start;p<start+5&&p<=20;p++)buttons.push([String(p),p]);if(start+5<=20)buttons.push(['>>',start+5]);document.querySelector('#map-mob-page-ind').innerHTML=buttons.map(([label,p])=>'<button class="l2-compact-pages__btn" data-page="'+p+'" '+(p===d.p?'disabled':'')+'>'+label+'</button>').join('');document.querySelectorAll('[data-page]').forEach(b=>b.onclick=async()=>{const r=await fetch('/fixture/map-page?p='+b.dataset.page);render(await r.json())});}
 render(${JSON.stringify(data(1))});(async()=>{while(!window.__l2botHook)await new Promise(r=>setTimeout(r,20));await fetch('/character');await fetch('/game/map/spawns');})();</script>`;
 await h.ctx.route('https://l2wap.com/map.html',r=>{S.pages.push(1);return r.fulfill({contentType:'text/html',body:mapHTML()});});
 await h.ctx.route('https://l2wap.com/fixture/map-page?*',async r=>{const p=+new URL(r.request().url()).searchParams.get('p');S.pages.push(p);if(opt.hold&&p===2&&!S.held){S.held=true;await gate;}return r.fulfill({contentType:'application/json',body:JSON.stringify(data(p))}).catch(()=>{});});
 await h.ctx.route('https://l2wap.com/game/tvt',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({phase:S.tvt?'REGISTRATION':'IDLE',eventId:S.tvt?'fixture-tvt':null,isRegistered:S.tvt,registeredCount:4,maxPlayers:20,registrationEndsAt:Date.now()+20000,startsAt:Date.now()+30000,serverNow:Date.now()})}));
 await h.ctx.route('https://l2wap.com/battle.html?*',async r=>{S.battleTargets.push(new URL(r.request().url()).searchParams.get('spawnId'));await r.fallback();});
 async function seed(){await h.sw.evaluate(async ids=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({cfg:{...cfg,autoTasks:['quests','tvt'],tvtOn:true,champRed:false},rt:{...rt,spawns:Object.fromEntries(ids.map(id=>[id,[id==='dense_leto_fixture'?'Leto Lizardman Soldier':'Leto Lizardman Warrior',37]]))}});},ids());}
 await seed();
 // Закрытая champ-цель не повышает [чемп] выше пользовательского [квест].
 if(opt.ordinaryFirst)await h.g.p.evaluate(()=>{document.querySelector('.l2-starter-story-target strong').textContent='Leto Lizardman Warrior';document.querySelector('.l2-starter-story-progress').textContent='0 / 40';document.querySelector('.l2-starter-story-done').remove();document.querySelector('.l2-starter-story-objective-line').textContent='Чемпионы: 12 / 12';});
 return {...f,S,release:()=>release(),seed,close:async()=>{release();await f.close();},diag:async()=>({pages:S,...await f.diag()})};
}
module.exports={allPages,until,delay};
