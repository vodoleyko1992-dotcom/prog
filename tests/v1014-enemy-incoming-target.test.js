'use strict';
// 14.10: HUD игры показывает incoming[0]; общая кнопка не должна атаковать другого игрока из списка.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function fixture(ids=['stranger','enemy']){
 const clicked=[],btn={dataset:{attackerId:ids[0]},disabled:false};
 const env={cfg:{},rt:{enemies:{enemy:{id:'enemy',name:'Enemy',kills:1}}},setRt:async p=>Object.assign(env.rt,p),rec(){},heroLevel:()=>75,
 meHp:()=>({cur:1000,max:1000}),autonomyMode:()=> 'farm',fishNow:()=>false,tvtSoon:()=>false,isBattle:()=>true,isMap:()=>false,
 $q:s=>s==='#l2-pvp-incoming-attack'?btn:null,shown:x=>!!x&&!x.hidden,fire:x=>clicked.push(x.dataset.attackerId),sleep:async()=>{}};
 const box={console,Date,Math,URLSearchParams,CSS:{escape:x=>x},location:{pathname:'/battle.html',search:'?spawnId=mob'},document:{querySelectorAll:()=>[]}};
 vm.createContext(box);vm.runInContext(fs.readFileSync(path.join(__dirname,'../modules/enemies.js'),'utf8'),box);
 const en=box.L2V7Factories.enemies(env);en.onNet('/character',{pv:{incoming:ids.map(id=>({id,name:id==='enemy'?'Enemy':'Stranger'}))}});
 return {en,env,btn,clicked};
}
test('второй нападающий из листа врагов не разрешает кнопку первого постороннего',async()=>{const f=fixture();await f.en.step();assert.deepEqual(f.clicked,[]);assert.equal(f.env.rt.enemyHunt,undefined)});
test('HUD-кнопка текущего врага запускает только его бой',async()=>{const f=fixture(['enemy','stranger']);await f.en.step();assert.deepEqual(f.clicked,['enemy']);assert.equal(f.env.rt.enemyHunt.id,'enemy')});
test('смена нападающего при сохранении target отменяет нажатие',async()=>{const f=fixture(['enemy']);f.env.setRt=async p=>{Object.assign(f.env.rt,p);if(p.enemyHunt)f.btn.dataset.attackerId='stranger'};await f.en.step();assert.deepEqual(f.clicked,[]);assert.equal(f.env.rt.enemyHunt,null)});
test('выключение ответного PvP при сохранении target отменяет нажатие',async()=>{const f=fixture(['enemy']);f.env.setRt=async p=>{Object.assign(f.env.rt,p);if(p.enemyHunt)f.env.cfg.enemyHunt=false};await f.en.step();assert.deepEqual(f.clicked,[]);assert.equal(f.env.rt.enemyHunt,null)});
test('старый интерфейс без ID допускает только первого известного нападающего',async()=>{const f=fixture();delete f.btn.dataset.attackerId;await f.en.step();assert.deepEqual(f.clicked,[]);const g=fixture(['enemy']);delete g.btn.dataset.attackerId;await g.en.step();assert.equal(g.clicked.length,1)});
