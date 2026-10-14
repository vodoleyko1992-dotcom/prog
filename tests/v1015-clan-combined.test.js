'use strict';
const fs=require('node:fs'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');
const ROOT=__dirname+'/..',review=process.env.L2_GEAR_REVIEW_ROOT||ROOT,draft=process.env.L2_GEAR_DRAFT;
const mod=n=>draft?draft+'/'+n+'.js':review+'/modules/'+n+'.js';
const catalog=JSON.parse(fs.readFileSync(__dirname+'/fixtures/clan-caster/catalog.json','utf8')); 
const defA={id:8688,k:'W',n:'Daimon Crystal',wt:'дубина',g:'A',pa:245,ma:194,spd:379};
const defS={id:9002284,k:'W',n:'Clan Caster',wt:'дубина',g:'S',pa:317,ma:334,spd:399,weaponMode:'magic'};
function fixture(opt={}){
 let resolveMeta,rejectMeta;const gate=new Promise((r,j)=>{resolveMeta=r;rejectMeta=j});
 let releaseCatalog,startedCatalog;const catalogGate=new Promise(r=>releaseCatalog=r),catalogStarted=new Promise(r=>startedCatalog=r);
 const rt={char:'fixture-hero',lvl:76,weaponsT:1,weapons:[{...defA,name:'Daimon Crystal',where:'надето'}],weaponEq:{id:8688,g:'A'},shotSwapT:Date.now()},cfg={},calls=[],known={8688:defA};
 const slot={title:'#3951 — Благословенний заряд духу',isConnected:true,querySelector:()=>null};
 const env={on:true,tabOwner:true,rt,cfg,lastShotTry:0,TAG:'test',shotSlot:()=>slot,shotsOn:()=>false,qty:()=>1000,rec(){},setStatus(){},setRt:async p=>Object.assign(rt,p),sleep:async()=>{},waitFor:async f=>f(),fire:b=>{calls.push(b);return true},heroLevel:()=>76,combatProfileKind:()=> 'mage_summoner',classWeaponTypes:()=>({types:['mage']}),MAGE:'mage',itemOf:id=>known[id]||null,gameGet:async url=>{assert.equal(url,'/character/catalog-hints');startedCatalog();if(opt.catalogPending)await catalogGate;return{ok:!opt.catalogFail,json:async()=>catalog}}};
 const box={console:{log(){},info(){},warn(){}},Date,Math,document:{querySelectorAll:s=>s==='.l2-hotbar-shot--enabled, .l2-hotbar-shot--disabled'?[slot]:[],querySelector:()=>null},rt,cfg,itemsDb:()=>gate,itemOf:id=>known[id]||null,setRt:env.setRt,rec(){},L2V7Modules:{}};
 vm.createContext(box);
 vm.runInContext(fs.readFileSync(mod('equipment'),'utf8'),box);box.L2V7Modules.equipment=box.L2V7Factories.equipment(env);
 vm.runInContext(fs.readFileSync(mod('economy'),'utf8'),box);const econ=box.L2V7Factories.economy(env);env.shotGrade=econ.shotGrade;
 vm.runInContext(fs.readFileSync(process.env.L2_RESOURCES_REVIEW||review+'/modules/resources.js','utf8'),box);const res=box.L2V7Factories.resources(env);
 const content=fs.readFileSync(review+'/content.js','utf8'),start=content.indexOf('async function weaponEquipNote('),end=content.indexOf('\nlet SHOP_BUY',start);assert.ok(start>0&&end>start,'actual core equipment handler anchor');
 vm.runInContext(draft?fs.readFileSync(draft+'/weaponEquipNote.js','utf8'):content.slice(start,end),box);
 return{rt,cfg,env,calls,known,resolveMeta,rejectMeta,releaseCatalog,catalogStarted,note:req=>box.weaponEquipNote(req),keep:res.keepShots};
}
test('observed unknown equip invalidates stale A before metadata await',async()=>{const f=fixture();const note=f.note({action:'equip',itemId:9002284,enchant:25,targetInstanceId:'bag:fixture',enchantPAtkBonus:0,enchantMAtkBonus:360});await f.keep();assert.equal(f.calls.length,0,'old A cache must not authorize a toggle while new equipped metadata is pending');f.resolveMeta();await note});
test('failed metadata lookup does not revive old A authorization',async()=>{const f=fixture({catalogFail:true});const note=f.note({action:'equip',itemId:9002284,enchant:25});f.resolveMeta();await note;await f.keep();assert.equal(f.calls.length,0,'unrecognized new item must stay unknown, not former A')});
test('verified S equip feeds actual grade selector and refuses A after swap cooldown',async()=>{const f=fixture();const note=f.note({action:'equip',itemId:9002284,enchant:25,enchantPAtkBonus:0,enchantMAtkBonus:360});f.resolveMeta();await note;assert.equal(f.env.shotGrade().g,'S');assert.equal(f.rt.weapons.find(w=>w.where==='надето').ma,694);await f.keep();assert.equal(f.calls.length,0)});
test('ordinary verified A equip still enables A normally',async()=>{const f=fixture();const note=f.note({action:'equip',itemId:8688,enchant:8,enchantPAtkBonus:0,enchantMAtkBonus:0});f.resolveMeta();await note;assert.equal(f.env.shotGrade().g,'A');await f.keep();assert.equal(f.calls.length,1)});

test('native metadata GET pending does not enable previous A slot',async()=>{const f=fixture({catalogPending:true});const note=f.note({action:'equip',itemId:9002284,enchant:25,enchantPAtkBonus:0,enchantMAtkBonus:360});f.resolveMeta();await f.catalogStarted;await f.keep();assert.equal(f.calls.length,0);f.releaseCatalog();await note});
test('verified S to ordinary A change clears pending and restores matching activation',async()=>{const f=fixture();f.resolveMeta();await f.note({action:'equip',itemId:9002284,enchant:25,enchantPAtkBonus:0,enchantMAtkBonus:360});await f.note({action:'equip',itemId:8688,enchant:8,enchantPAtkBonus:0,enchantMAtkBonus:54});assert.equal(f.env.shotGrade().g,'A');assert.ok(!f.env.shotGrade().blocked);await f.keep();assert.equal(f.calls.length,1)});
