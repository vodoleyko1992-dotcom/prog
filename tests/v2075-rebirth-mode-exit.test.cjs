'use strict';
// Лог28.10 06:42: снят Rebirth, выбран тур РБ, но каждая победа возвращалась в выключенный rebirth.nextFight.
const test=require('node:test'),assert=require('node:assert/strict');
const {flowFixture}=require('./warlock-combat-fixture.cjs');
const RUN='11111111-1111-4111-8111-111111111111';
function fixture(mode='raid',role='mob'){
 const f=flowFixture('fighter'),e=f.env,S={mode,epoch:1,generation:1,native:false,pvp:false,captcha:false,tvt:false,canAct:true,commit:true,hooks:{},rebirth:0,services:0,commits:0};
 let href=`https://l2wap.com/battle.html?spawnId=rebirth_raid_${RUN}_1_1_25082_lv39_${role}_${role==='raid'?3:124}`;
 Object.defineProperties(f.location,{href:{get:()=>href,set:v=>{href=new URL(v,href).href}},pathname:{get:()=>new URL(href).pathname},search:{get:()=>new URL(href).search}});
 Object.assign(e.rt,{char:'Hero',classCur:{prof:'human_wizard',slot:0},manualKickAt:1,rebirth:{runId:RUN,fightPending:{id:'unknown-fight'}}});
 e.cfg.rebirthMode=mode==='rebirth';e.cfg.rbHuntMode=mode==='raid';e.cfg.shopAuto=true;
 const win={},title={textContent:'Rebirth · Windsus · ур.39'},q=e.$q;e.$q=s=>s==='#battle-victory-inline'?(e.victory()?win:null):s==='#battle-mob-title'?title:q(s);
 e.victory=()=>S.won!==false;f.setWon(true);
 Object.assign(e,{autonomyMode:()=>S.mode,evidenceOwner:()=>JSON.stringify([e.rt.char,e.rt.classCur,S.epoch,e.rt.manualKickAt]),
  scanContext:()=>JSON.stringify([e.rt.char,S.mode]),actionGeneration:()=>S.generation,battleInfo:()=>S.metadata||{spawn:'rebirth_raid_'+RUN,name:'Rebirth · Windsus'},
  canAct:()=>S.canAct,antibotState:()=>S.captcha,pvpPending:()=>S.pvp,tvtSoon:()=>S.tvt,nativePending:()=>S.native,
  tvtStep:async()=>{await S.hooks.tvt?.();return false;},pvpStep:async()=>{await S.hooks.pvp?.();return false;},pvpRecoveryStep:async()=>f.events.push('pvp'),
  rtCommit:async()=>{S.commits++;await S.hooks.commit?.();return S.commit;},rebirthNext:async()=>{S.rebirth++;},
  syncShotWeapon:async()=>{S.services++;},shopNeedByPanel:()=>{throw Error('магазин до выхода не запускается');},
  setStatus:s=>f.logs.push(s),fire:()=>{throw Error('старый hunt/вход не нажимается');}});
 return{...f,S,title,run:ctx=>f.farm.nextFight(ctx)};
}
for(const mode of ['raid','epic','fish','cat','farm','auto','tasks','craft'])for(const role of ['mob','champion','raid'])
 test('после выбора '+mode+' победа Rebirth '+role+' выходит на карту без продолжения старой задачи',async()=>{
 const f=fixture(mode,role),saved=JSON.stringify(f.env.rt.rebirth);f.box.sessionStorage.setItem('l2bot.rebirth-next','unknown-receipt');
 await f.run();assert.equal(f.location.pathname,'/map.html');assert.equal(f.S.rebirth,0);assert.equal(f.S.services,0);assert.equal(f.S.commits,1);
 assert.equal(JSON.stringify(f.env.rt.rebirth),saved);assert.equal(f.box.sessionStorage.getItem('l2bot.rebirth-next'),'unknown-receipt');
 });
test('выбранный Rebirth продолжает прежний поход своим обработчиком',async()=>{
 const f=fixture('rebirth');await f.run();assert.equal(f.location.pathname,'/battle.html');assert.equal(f.S.rebirth,1);assert.equal(f.S.commits,0);
});
for(const change of ['live','stop','owner','captcha','pvp','tvt','native','action','failedCommit','wrongPage'])test('выход не обходит запрет: '+change,async()=>{
 const f=fixture();if(change==='live')f.S.won=false;if(change==='stop')f.env.on=false;if(change==='owner')f.env.tabOwner=false;
 if(change==='captcha')f.S.captcha=true;if(change==='pvp')f.S.pvp=true;if(change==='tvt')f.S.tvt=true;if(change==='native')f.S.native=true;
 if(change==='action')f.S.canAct=false;if(change==='failedCommit')f.S.commit=false;if(change==='wrongPage')f.location.href='/menu.html'+f.location.search;
 const page=f.location.href;await f.run();assert.equal(change==='tvt'?f.location.pathname:f.location.href,change==='tvt'?'/tvt-arena.html':page);assert.equal(f.S.rebirth,0);
});
const changes={stop:f=>f.env.on=false,owner:f=>f.env.tabOwner=false,hero:f=>f.env.rt.char='Other',class:f=>f.env.rt.classCur.prof='other',slot:f=>f.env.rt.classCur.slot=1,
 kick:f=>f.env.rt.manualKickAt++,lease:f=>f.S.epoch++,generation:f=>f.S.generation++,mode:f=>f.S.mode='rebirth',page:f=>f.location.href+='#manual',
 title:f=>f.title.textContent='Other',metadata:f=>f.S.metadata={spawn:'new-target'},live:f=>f.S.won=false,native:f=>f.S.native=true,captcha:f=>f.S.captcha=true,
 pvp:f=>f.S.pvp=true,tvt:f=>f.S.tvt=true,action:f=>f.S.canAct=false};
for(const point of ['tvt','pvp','commit'])for(const [name,change]of Object.entries(changes))test('отмена '+name+' после await '+point+' сохраняет текущую страницу',async()=>{
 const f=fixture();let changed=false;f.S.hooks[point]=()=>{changed=true;change(f);};await f.run();assert.equal(changed,true);
 assert.notEqual(f.location.pathname,'/map.html');assert.equal(f.S.rebirth,0);assert.equal(f.S.services,0);
});
test('ошибка commit не разрешает навигацию',async()=>{
 const f=fixture();f.S.hooks.commit=()=>{throw Error('storage');};await assert.rejects(f.run(),/storage/);assert.equal(f.location.pathname,'/battle.html');
});
