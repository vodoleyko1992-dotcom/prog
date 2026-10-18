'use strict';
// 20.14 (лог 17.10 21:53–22:53, сборка 20.11): GET /game/map/around не ответил за 6 с → обрыв fetch «signal is aborted without
// reason» уходил из pvp.step() в главный цикл; 18 «сбоев» за 30 мин — СТОП бота, хотя сервер игры отвечал.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),test=require('node:test'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),DID='6f573aad-08ee-4713-9d76-33f5fd4afc93';
function fixture(){
 let now=1e6;const calls=[],nodes={},location={pathname:'/map.html',search:''};
 const hero={characterId:DID,name:'Dremia',level:77,clanId:'their-clan',isPartyMember:false,battleOnNameClick:true,pvpAllowed:true,pvpNickColor:''};
 nodes[`#map-hero-list li[data-character-id="${DID}"] .l2-map-hero-name-link--battle`]={dataset:{},textContent:'Dremia',disabled:false};
 const net={fail:true};
 const env={cfg:{autoRevive:true,enemyHunt:true,pvpOnSight:true},rt:{char:'Warlock',manualKickAt:0,pvpTargets:{[DID]:{id:DID,name:'Dremia',enabled:true}},enemies:{}},on:true,tabOwner:true,
  antibotState:()=>false,abHold:()=>false,setRt:async p=>{Object.assign(env.rt,p);return{ok:true}},rtCommit:async()=>true,rec:(...a)=>calls.push(['log',...a]),setStatus:()=>{},
  heroLevel:()=>75,meHp:()=>({cur:9785,max:9785}),autonomyMode:()=>'raid',fishNow:()=>false,tvtSoon:()=>false,
  isMap:()=>location.pathname==='/map.html',isBattle:()=>false,victory:()=>false,
  $q:s=>nodes[s],shown:b=>!!b&&!b.hidden,fire:b=>{calls.push(['click',b]);return true},pause:async()=>{},sleep:async()=>{},waitX:async fn=>fn(),toMap:async()=>{},
  gameGet:async p=>{calls.push(['GET',p]);if(net.fail&&p==='/game/map/around')throw new Error('signal is aborted without reason');
   return{ok:true,json:async()=>p==='/character'?{character:{id:'our-id',name:'Warlock',clanId:'our-clan'}}:p.startsWith('/game/player/')?{profile:{id:p.split('/')[3],name:p.includes(DID)?'Dremia':'Warlock',clanId:p.includes(DID)?'their-clan':'our-clan'}}:{nearbyHeroes:[hero]}}}};
 const box={console,Date:{now:()=>now},Math,URLSearchParams,Object,location,document:{querySelectorAll:()=>[]},CSS:{escape:x=>x}};
 vm.createContext(box);vm.runInContext(fs.readFileSync(ROOT+'/modules/pvp.js','utf8'),box);
 return {pvp:box.L2V7Factories.pvp(env),calls,net,setNow:n=>now=n};
}
const around=f=>f.calls.filter(c=>c[0]==='GET'&&c[1]==='/game/map/around').length;
test('обрыв GET /game/map/around не выбрасывается из pvp.step в главный цикл',async()=>{
 const f=fixture();
 assert.equal(await f.pvp.step(),false);   // раньше — исключение «signal is aborted without reason»
 assert.equal(around(f),1);
});
test('после сетевого сбоя следующий опрос не раньше чем через 30 с, затем PvP снова работает',async()=>{
 const f=fixture();await f.pvp.step();
 f.setNow(1e6+10000);assert.equal(await f.pvp.step(),false);assert.equal(around(f),1,'не долбим сервер каждый круг');
 f.net.fail=false;f.setNow(1e6+31000);assert.equal(await f.pvp.step(),true);assert.equal(around(f),2);
 assert.equal(f.calls.filter(c=>c[0]==='click').length,1);
});
