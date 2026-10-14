'use strict';
// 10.0.14: настоящий invScanStep сравнивает бонусы заточки надетого предмета из /character, не только сумку.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../modules/equipment.js'),'utf8'),items=require('../items-il.json');
function fixture(slot={itemId:90,enchant:10,enchantPAtkBonus:0,enchantMAtkBonus:35},{api=true,title='+10 Goat Head Staff',bagId=189}={}) {
 let time=1e9,worn='',opened=false;const requests=[];
 const get=id=>items[id]?{id:+id,...items[id]}:null;
 const j={itemId:bagId,qty:1,enchant:0,targetInstanceId:'bag:'+bagId+':0'};
 const row={dataset:{itemJson:JSON.stringify(j)},querySelector:s=>s==='.l2-char-bag-name'?{textContent:'Staff of Life'}:s==='.l2-char-bag-equip--wear'?{wear:j.targetInstanceId}:null};
 const img={className:'l2-char-slot-icon--filled',getAttribute:()=>'/icons/weapon_goat_head_staff.jpg',closest:()=>({open:true})};
 const q=s=>s==='img[data-l2-slot="weapon"]'?img:s==='#char-bag-list'?{}:s==='#char-bag-modal-title'&&opened?{textContent:title}:s==='#char-bag-modal-close'&&opened?{close:true}:null;
 class Clock extends Date {static now(){return time}}
 const box={location:{pathname:'/char.html',search:''},document:{querySelectorAll:s=>s==='.l2-char-bag-row[data-item-json]'?[row]:[]},Date:Clock,console};vm.runInNewContext(source,box);
 const env={on:true,rt:{prof:'Warlock',lvl:40,invScan:{step:'inv'},panel:[{kind:'снаряжение',img:'weapon_goat_head_staff.jpg',name:title}]},cfg:{weaponClassEquip:true},itemOf:get,itemByIcon:()=>get(90),$q:q,shown:el=>!!el,isChar:()=>true,normalizeProfession:x=>x,combatProfileKind:()=> 'mage_summoner',MAGE:'маг',GRADE_LV:{D:20},heroLevel:()=>40,setStatus(){},setRt:async p=>Object.assign(env.rt,p),setCfg:async p=>Object.assign(env.cfg,p),itemsDb:async()=>{},baseName:s=>s?.replace(/^\+\d+\s*/,''),itemJson:r=>JSON.parse(r.dataset.itemJson),waitX:async f=>f(),sleep:async ms=>{time+=ms},rnd:a=>a,pause:async()=>{},rec(){},EQUIP_OK:/надето/,noticeText:()=>worn?'надето':'',fire:b=>{if(b?.open)opened=true;if(b?.close)opened=false;if(b?.wear)worn=b.wear;return true},gameGet:async url=>{requests.push(url);return {ok:api,json:async()=>({character:{inventory:{eq:{l1:slot}}}})}}};
 return {M:box.L2V7Factories.equipment(env),env,requests,location:box.location,get worn(){return worn}};
}
const cases=[];const test=(n,f)=>cases.push([n,f]);
test('+10 надетое сильнее +0 из сумки — не заменять',async()=>{const f=fixture();await f.M.invScanStep();assert.equal(f.worn,'');assert.equal(f.env.rt.weapons.find(w=>w.where==='надето').ma,98);assert.deepEqual(f.requests,['/character']);});
test('живой контракт 14.10: Daimon Crystal +8 с M.Atk бонусом54',async()=>{const f=fixture({itemId:8688,enchant:8,enchantPAtkBonus:0,enchantMAtkBonus:54});await f.M.invScanStep();const eq=f.env.rt.weapons.find(w=>w.where==='надето');assert.equal(eq.id,8688);assert.equal(eq.ma,items[8688].ma+54);assert.equal(eq.ench,8);assert.equal(f.worn,'');});
test('более сильное оружие всё ещё надевается при достоверном +0',async()=>{const f=fixture({itemId:90,enchant:0});await f.M.invScanStep();assert.equal(f.worn,'bag:189:0');});
test('неизвестные бонусы заточенного предмета не приравниваются к нулю',async()=>{const f=fixture({itemId:90,enchant:10});await f.M.invScanStep();assert.equal(f.worn,'');assert.equal(f.env.rt.weapons.find(w=>w.where==='надето').ma,null);});
test('свежий пустой слот при старой иконке допускает надевание',async()=>{const f=fixture(null);await f.M.invScanStep();assert.equal(f.worn,'bag:189:0');});
test('ошибка GET и +10 в окне предмета сохраняют надетое',async()=>{const f=fixture(null,{api:false});await f.M.invScanStep();assert.equal(f.worn,'');assert.equal(f.env.rt.weapons.find(w=>w.where==='надето').ma,null);});
test('неизвестная заточка не заменяется и более высоким грейдом',async()=>{const f=fixture(null,{api:false,bagId:195});await f.M.invScanStep();assert.equal(f.worn,'');});
test('свежий снимок работает и при ручной проверке с выключенным ботом',async()=>{const f=fixture();f.env.on=false;f.env.rt.invScan.manual=true;await f.M.invScanStep();assert.equal(f.env.rt.weapons.find(w=>w.where==='надето').ma,98);assert.equal(f.worn,'');});
test('Stop/reload не запускает оставшуюся автоматическую проверку',async()=>{const f=fixture();f.env.on=false;assert.equal(await f.M.invScanStep(),false);await f.M.invScanDrive();assert.equal(f.requests.length,0);assert.equal(f.env.rt.invScan.step,'inv');});
test('Stop во время GET прекращает автоматическую проверку до надевания',async()=>{const f=fixture({itemId:90,enchant:0});const get=f.env.gameGet;f.env.gameGet=async url=>{f.env.on=false;return get(url)};assert.equal(await f.M.invScanStep(),false);assert.equal(f.worn,'');assert.equal(f.env.rt.invScan.step,'inv');});
test('Stop во время сохранения prof не уводит на character.html',async()=>{const f=fixture();f.env.rt.invScan={step:'prof',t:1};f.env.isCharacter=()=>false;const set=f.env.setRt;f.env.setRt=async p=>{await set(p);f.env.on=false};assert.equal(await f.M.invScanStep(),false);assert.equal(f.location.href,undefined);});
test('потеря владельца при GET прекращает автоматическую проверку',async()=>{const f=fixture({itemId:90,enchant:0});const get=f.env.gameGet;f.env.gameGet=async url=>{f.env.tabOwner=false;return get(url)};assert.equal(await f.M.invScanStep(),false);assert.equal(f.worn,'');assert.equal(f.location.href,undefined);});
test('замена задания во время GET не завершает новую проверку',async()=>{const f=fixture();f.env.rt.invScan.t=1;const get=f.env.gameGet;f.env.gameGet=async url=>{f.env.rt.invScan={step:'prof',t:2};return get(url)};assert.equal(await f.M.invScanStep(),false);assert.equal(f.env.rt.invScan.t,2);});
(async()=>{let bad=0;for(const[n,f]of cases)try{await f();console.log('PASS:',n)}catch(e){bad++;console.error('FAIL:',n,e.message)}if(bad)process.exitCode=1})();
