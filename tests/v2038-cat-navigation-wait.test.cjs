'use strict';
// Лог20.10 19:36: следующий бой → старый экран победы → возврат в подземелье.
// Native Location сохраняет старый адрес до commit; простой href-мок скрывал гонку.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {flowFixture}=require('./warlock-combat-fixture.cjs');
const did='necropolis_of_martyrdom',sid=n=>'sdms_'+did+'_'+n;
const drain=async()=>{for(let i=0;i<80;i++)await Promise.resolve()};
function fixture(){
 const f=flowFixture('fighter'),{env,location:loc,events}=f;
 let clock=100000,wait=null,href='https://l2wap.com/battle.html?spawnId='+sid('013');
 const intents=[],waits=[];
 loc.pathname='/battle.html';loc.search='?spawnId='+sid('013');
 Object.defineProperty(loc,'href',{get:()=>href,set:value=>intents.push(value),configurable:true});
 Object.assign(env.cfg,{catMode:true,catDungeon:'auto',chain:true,lvlBelow:5,lvlAbove:5});
 Object.assign(env.rt,{char:'Hero',manualKickAt:1,lvl:71,classCur:{prof:'dwarf_bounty_hunter',slot:1},catCur:did,catLv:{[did]:{lo:70,hi:80,n:3}}});
 env.routeLocation=loc;env.autonomyMode=()=>env.cfg.catMode?'cat':'farm';env.heroLvl=()=>71;
 env.CAT_LIST={[did]:['Martyrdom',70,80]};env.canAct=()=>true;env.canRun=()=>true;
 env.catGo=async()=>{events.push('catGo');loc.href='/dungeon.html?dungeonId='+did};
 env.gameGet=async p=>{events.push('GET '+p);return{ok:true,json:async()=>({dungeon:{id:did,mobs:[{id:sid('032'),name:'Nephilim Praetorian',level:72,kind:'passive',inBattleRange:true}]}})}};
 env.waitFor=async(fn,timeout,step)=>{const value=fn();if(value)return value;waits.push({timeout,step});return new Promise(resolve=>{wait={fn,resolve,until:clock+timeout}})};
 class Clock extends Date{static now(){return clock}}
 const box={console,Date:Clock,Math,URLSearchParams,document:{querySelectorAll:()=>[]},location:loc};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../modules/dungeons.js'),'utf8'),box);
 const D=box.L2V7Factories.dungeons(env);env.catNext=()=>D.catNext();f.setWon(true);
 const advance=async ms=>{clock+=ms;if(wait){const w=wait,value=w.fn();if(value||clock>=w.until){wait=null;w.resolve(value||null)}}await drain()};
 return{...f,D,intents,waits,advance,commit:()=>{href='https://l2wap.com/battle.html?spawnId='+sid('032');loc.search='?spawnId='+sid('032')},run:()=>f.farm.nextFight({name:'Previous'})};
}
test('старый документ не возвращает управление диспетчеру до commit нового боя',async()=>{
 const f=fixture();let ticks=0;
 const run=(async()=>{await f.run();ticks++})();await drain();
 try{
  assert.equal(ticks,0,'после href ещё открыт прежний экран победы');
  await f.advance(1500);assert.equal(ticks,0,'медленная загрузка не открывает второй круг старой победы');
  assert.equal(f.intents.length,1);assert.match(f.intents[0],/_032$/);
  assert.equal(f.events.filter(x=>x.startsWith('GET ')).length,1);assert.ok(!f.events.includes('catGo'));
  assert.equal(f.env.rt.target.name,'Nephilim Praetorian');
  f.commit();await f.advance(50);await run;assert.equal(ticks,1);
 }finally{await f.advance(10000)}
});
for(const why of ['Stop','lease','class','mode','chain','manual','hold','route'])test('ожидание навигации: '+why+' освобождает старый контекст без нового перехода',async()=>{
 const f=fixture();let done=false;const run=f.run().then(()=>done=true);await drain();
 try{
  assert.equal(done,false);
  if(why==='Stop')f.env.on=false;
  if(why==='lease')f.env.tabOwner=false;
  if(why==='class')f.env.rt.classCur={prof:'human_warlord',slot:0};
  if(why==='mode')f.env.cfg.catMode=false;
  if(why==='chain')f.env.cfg.chain=false;
  if(why==='manual')f.env.rt.manualKickAt++;
  if(why==='hold')f.env.canRun=()=>false;
  if(why==='route')f.commit();
  await f.advance(50);await run;
  assert.equal(done,true);assert.equal(f.intents.length,1);assert.ok(!f.events.includes('catGo'));
 }finally{await f.advance(10000)}
});
test('несостоявшийся переход имеет ограниченное ожидание и не выключает бота',async()=>{
 const f=fixture();let done=false;const run=f.run().then(()=>done=true);await drain();
 try{
  assert.equal(done,false);assert.equal(f.waits.length,1);
  assert.ok(f.waits[0].timeout>=8000&&f.waits[0].timeout<=15000);
  await f.advance(f.waits[0].timeout-1);assert.equal(done,false);assert.equal(f.intents.length,1);
  await f.advance(1);await run;assert.equal(done,true);assert.equal(f.env.on,true);
 }finally{await f.advance(15000)}
});
test('ошибка каталога оставляет запасной список без ожидания неотправленной навигации',async()=>{
 const f=fixture();f.env.gameGet=async()=>({ok:false});await f.run();
 assert.equal(f.waits.length,0);assert.equal(f.intents.length,1);assert.match(f.intents[0],/dungeon\.html/);
});
