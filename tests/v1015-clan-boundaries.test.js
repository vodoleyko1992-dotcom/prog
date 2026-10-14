// Независимый review 14.10: реальные factory + финальные await границы, без аккаунта.
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');
const ROOT=process.env.L2_REPO||path.join(__dirname,'..'),SOURCE=process.env.WEAPON_SOURCE||path.join(ROOT,'modules/equipment.js');
const items=require(ROOT+'/items-il.json'),catalog=require('./fixtures/clan-caster/catalog.json'),native=require('./fixtures/clan-caster/native-bag.json');
const clone=x=>JSON.parse(JSON.stringify(x));
function setup(opt={}){
 let now=1e9,opened=false;const calls=[],bag=clone(opt.bag||[native[1]]),slot=clone(opt.slot===undefined?{itemId:9002284,enchant:25,enchantPAtkBonus:0,enchantMAtkBonus:360,clanWeaponUid:'fixture-clan-caster'}:opt.slot);
 const rows=bag.map(r=>({dataset:{itemJson:JSON.stringify(r.item)},querySelector:s=>s==='.l2-char-bag-name'?{textContent:r.item.itemId===9002284?'Клановий кастер':'Кристал Даймона A-grade. Дворучна магічна зброя.'}:s==='.l2-char-bag-equip--wear'?{wear:r.item.targetInstanceId,disabled:!!opt.disabled}:null}));
 const img={className:'l2-char-slot-icon--filled',getAttribute:()=>'/icons/clan_gear/vesper_caster.png',closest:()=>({open:true})};
 const q=s=>s==='img[data-l2-slot="weapon"]'?img:s==='#char-bag-list'?{}:s==='#char-bag-modal-title'&&opened?{textContent:slot?.itemId===9002284?'+25 Клановий кастер':'+8 Кристал Даймона A-grade.'}:s==='#char-bag-modal-close'&&opened?{close:true}:null;
 class Clock extends Date {static now(){return now}}
 const box={console,Date:Clock,document:{querySelectorAll:s=>s==='.l2-char-bag-row[data-item-json]'?rows:[]},location:{pathname:'/char.html',search:''}};
 vm.runInNewContext(fs.readFileSync(SOURCE,'utf8'),box);
 const env={on:true,tabOwner:true,rt:{char:'Warlock',prof:'Arcana lord',lvl:76,invScan:{step:'inv',t:123},panel:[]},cfg:{weaponClassEquip:true,weaponClassPick:true},
 itemOf:id=>items[id]?{id:+id,...items[id]}:null,itemByIcon:()=>null,$q:q,shown:e=>!!e,isChar:()=>true,normalizeProfession:x=>x,combatProfileKind:()=> 'mage_summoner',MAGE:'#mage',GRADE_LV:{NG:0,D:20,C:40,B:52,A:61,S:76},heroLevel:()=>env.rt.lvl,
 setStatus(){},setRt:async p=>{Object.assign(env.rt,p);return{ok:true}},setCfg:async p=>Object.assign(env.cfg,p),itemsDb:async()=>items,baseName:s=>String(s||'').replace(/^\+\d+\s*/,''),itemJson:r=>JSON.parse(r.dataset.itemJson),waitX:async f=>f(),sleep:async ms=>{now+=ms},rnd:a=>a,pause:async()=>{},rec:(...a)=>calls.push(['log',...a]),EQUIP_OK:/надето/,noticeText:()=>calls.some(c=>c[0]==='wear')?'надето':'',fire:b=>{if(b?.open)opened=true;if(b?.close)opened=false;if(b?.wear)calls.push(['wear',b.wear]);return true},
 gameGet:async url=>{calls.push(['GET',url]);return{ok:url!=='/character/catalog-hints'||!opt.catalogFail,json:async()=>url==='/character/catalog-hints'?clone(catalog):{character:{id:'fixture-hero',name:env.rt.char,inventory:{eq:{l1:slot}}}}}}};
 const M=box.L2V7Factories.equipment(env);return{env,M,calls,slot,box,setNow:n=>now=n};
}
const worn=f=>f.calls.filter(x=>x[0]==='wear');
test('manual selection during final pause prevents automatic replacement and keeps chosen name',async()=>{const f=setup({slot:{itemId:90,enchant:0}});f.env.pause=async()=>{f.env.cfg.weaponManual=true;f.env.cfg.nWeaponMain='My exact manual choice'};await f.M.invScanStep();assert.equal(worn(f).length,0);assert.equal(f.env.cfg.nWeaponMain,'My exact manual choice')});
test('disabling autoequip while catalog waits prevents wear',async()=>{const f=setup({slot:{itemId:90,enchant:0},bag:[native[0]]}),get=f.env.gameGet;f.env.gameGet=async u=>{const r=await get(u);if(u==='/character/catalog-hints')f.env.cfg.weaponClassEquip=false;return r};await f.M.invScanStep();assert.equal(worn(f).length,0)});
test('manual equipped marker during reaction pause preserves the new exact weapon event',async()=>{const f=setup({slot:{itemId:90,enchant:0}});f.env.pause=async()=>{f.env.rt.weaponMetaPending={char:'Warlock',id:9002284,inst:'new exact instance',revision:200,t:200}};await f.M.invScanStep();assert.equal(worn(f).length,0);assert.equal(f.env.rt.weaponMetaPending.inst,'new exact instance');assert.equal(f.env.rt.weapons,undefined)});
test('disabling automatic field selection during scan commit does not overwrite nWeaponMain',async()=>{const f=setup();const save=f.env.setRt;f.env.setRt=async p=>{const r=await save(p);if(p.weapons)f.env.cfg.weaponClassPick=false;return r};await f.M.invScanStep();assert.equal(f.env.cfg.nWeaponMain,undefined)});
test('character switch during final scan commit cannot navigate old return destination',async()=>{const f=setup();f.env.rt.invScan.back='/map.html?oldhero';const save=f.env.setRt;let nav='';Object.defineProperty(f.box.location,'href',{set:x=>nav=x});f.env.setRt=async p=>{const r=await save(p);if(p.weapons)f.env.rt.char='OtherHero';return r};await f.M.invScanStep();assert.equal(nav,'')});
