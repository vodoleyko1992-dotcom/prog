'use strict';
const fs=require('node:fs'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {fixture}=require('./warlock-fixture.cjs'),root=path.resolve(__dirname,'..'),core=fs.readFileSync(root+'/content.js','utf8');
const fragment=core.slice(core.indexOf('const warlockShotContext'),core.indexOf('const warlockCanRun'));
const SHOT_IDS={NG:1835,D:1463,C:1464,B:1465,A:1466,S:1467},BSPS_IDS={NG:3947,D:3948,C:3949,B:3950,A:3951,S:3952};
const row=(id,on=true,stock=1000)=>({title:'#'+id,on,stock,querySelector:()=>({getAttribute:()=>'/game/item-icon/'+id})});
function setup(){
 const f=fixture({cfg:{petFullAuto:false}}),env=f.env;let battle=false,rows=[];const listeners=[];
 Object.assign(env.rt,{weaponsT:f.now(),weapons:[{id:8688,g:'A',weaponMode:'magic',where:'надето'}]});
 Object.assign(f.ch,{mAtk:8000,pAtk:1300,pDef:1400,mDef:1100,maxHp:9785,activeBuffs:[{skillId:1356,level:1,expiresAtMs:f.now()+60000}],
  inventory:{eq:{l1:{itemId:8688}},stacks:[{itemId:3951,qty:1000}]},battleHotbarSlots:[{k:'u',id:3951},{k:'a',a:'l2_1147'}],snapshotGeneratedAt:f.now()});
 env.isBattle=()=>battle;
 const economyBox={console,document:{querySelectorAll:()=>rows}};economyBox.globalThis=economyBox;
 vm.runInNewContext(fs.readFileSync(root+'/modules/economy.js','utf8'),economyBox);const economy=economyBox.L2V7Factories.economy(env);
 const box={document:{querySelectorAll:()=>rows},SHOT_IDS,BSPS_IDS,qty:b=>b.stock,shotsOn:b=>b.on,rt:env.rt,isBattle:env.isBattle,heroNick:env.heroNick,
  L2V7Modules:{economy,warlock:f.api()},window:{},location:{origin:'https://fixture.invalid'},apiPath:u=>new URL(u,'https://fixture.invalid').pathname,
  addEventListener:(name,fn)=>{if(name==='message')listeners.push(fn)}};
 for(const k of ['on','tabOwner'])Object.defineProperty(box,k,{get:()=>env[k]});
 vm.createContext(box);vm.runInContext(fragment,box);env.shotContext=vm.runInContext('warlockShotContext',box);
 const note=()=>f.api().noteSnapshot(f.ch),plan=()=>f.api().raidContext('boss',{hp:2000000,pdef:1000,mdef:1000},{preflight:true});
 const net=(data,foreign=false)=>listeners.forEach(fn=>fn({source:foreign?{}:box.window,origin:box.location.origin,data:{__l2bot:'net',method:'POST',status:200,...data}}));
 return {...f,note,plan,net,env,setBattle:b=>{battle=b},setRows:r=>{rows=r},strict:()=>f.api().raidContext('boss',{hp:2000000,pdef:1000,mdef:1000})};
}
test('полный /character вне боя готовит будущий состав; текущие заряды не объявляет включёнными',()=>{
 const f=setup();f.note();const p=f.plan();assert.ok(p.key);assert.equal(p.prepared,true);assert.equal(p.planned,true);assert.match(p.reason,/включит/);
 assert.equal(f.strict().key,null);assert.match(f.api().heroContext(),/"shots":"unknown"/);assert.equal(f.calls.length,0);assert.equal(f.writes.length,0);
});
test('план совпадает с тем же подтверждённым ON после старта; в бою OFF никогда не заменяется планом',()=>{
 const f=setup();f.note();const planned=f.plan().key;
 f.setBattle(true);f.ch.inBattle=true;f.setRows([row(3951,false)]);f.note();assert.notEqual(f.plan().key,planned);assert.equal(f.plan().planned,undefined);
 f.setRows([row(3951,true)]);f.note();assert.equal(f.strict().key,planned);
});
for(const kind of ['empty','missingStock','malformedStock','unknownQty','wrongGrade','differentWeapon','missingWeapon','ambiguousSlots','noSlots','mismatch','pendingMetadata'])test('неподтверждённые заряды '+kind+' оставляют prepared, но без DPS-ключа',()=>{
 const f=setup();
 if(kind==='empty')f.ch.inventory.stacks[0].qty=0;
 if(kind==='missingStock')delete f.ch.inventory.stacks;
 if(kind==='malformedStock')f.ch.inventory.stacks={};
 if(kind==='unknownQty')f.ch.inventory.stacks[0].qty='1000';
 if(kind==='wrongGrade')f.ch.battleHotbarSlots[0].id=3952;
 if(kind==='differentWeapon')f.ch.inventory.eq.l1.itemId=99999;
 if(kind==='missingWeapon')delete f.env.rt.weaponsT;
 if(kind==='ambiguousSlots')f.ch.battleHotbarSlots.push({k:'u',id:1466});
 if(kind==='noSlots')delete f.ch.battleHotbarSlots;
 if(kind==='mismatch')f.env.rt.shotMismatchPending=true;
 if(kind==='pendingMetadata')f.env.rt.weaponMetaPending=true;
 f.note();assert.equal(f.plan().prepared,true);assert.equal(f.plan().key,null);assert.match(f.plan().reason,/Заряды/);
});
test('две одинаковые кнопки не делают один тип неоднозначным, уменьшение ненулевого запаса не меняет состав',()=>{
 const f=setup();f.ch.battleHotbarSlots.push({k:'u',id:3951});f.note();const p=f.plan().key;assert.ok(p);
 f.ch.inventory.stacks[0].qty--;f.note();assert.equal(f.plan().key,p);
});
test('после изменения запаса свежий GET отменяет старый план ON',()=>{const f=setup();f.note();assert.ok(f.plan().key);f.ch.inventory.stacks=[];f.note();assert.equal(f.plan().prepared,true);assert.equal(f.plan().key,null)});
for(const kind of ['ttl','buff','born','class','slot','hero','staleResponse','missingHeroBuffs','missingHeroStats','missingPetStats','deadPet'])test('неполный или устаревший состав '+kind+' не считается подготовленным',()=>{
 const f=setup();if(kind==='buff')f.ch.activeBuffs[0].expiresAtMs=f.now()+1000;
 if(kind==='staleResponse')f.ch.snapshotGeneratedAt-=31000;
 if(kind==='missingHeroBuffs')delete f.ch.activeBuffs;
 if(kind==='missingHeroStats')delete f.ch.pDef;
 if(kind==='missingPetStats')delete f.ch.activeSummon.pAtk;
 if(kind==='deadPet')f.ch.activeSummon.hp=0;
 f.note();
 if(kind==='ttl')f.tick(30001);
 if(kind==='buff')f.tick(1001);
 if(kind==='born')f.env.rt.petBornT=f.now();
 if(kind==='class')f.env.rt.classCur.prof='human_arcana_lord';
 if(kind==='slot')f.env.rt.classCur.slot=1;
 if(kind==='hero')f.env.rt.char='other';
 const p=f.plan();assert.equal(p.prepared,false);assert.equal(p.key,null);
});
test('Stop и потеря замка после GET не дают планируемый DPS',()=>{for(const key of ['on','tabOwner']){const f=setup();f.note();f.env[key]=false;assert.equal(f.plan().key,null)}});
test('перечитывание плана не продлевает30сек свежести',()=>{const f=setup();f.note();f.tick(25000);assert.ok(f.plan().key);f.tick(5001);assert.equal(f.plan().prepared,false)});
for(const data of [
 {url:'/game/battle/hotbar'}, {url:'/character/equip'}, {url:'/game/inventory/discard'}, {url:'/game/drops-shop/buy'},
 {url:'/game/battle/action',req:{action:'mystic_spiritshot_toggle'}}, {url:'/game/battle/action',req:{action:'fighter_soulshot_toggle'}},
 {url:'/game/battle/action',status:400,res:{error:'mystic_spiritshot_grade_mismatch'}}
])test('ответ изменения '+data.url+' '+(data.req?.action||data.res?.error||'')+' требует нового GET',()=>{
 const f=setup();f.note();assert.ok(f.plan().key);f.net(data);assert.equal(f.plan().prepared,false);assert.equal(f.plan().key,null);f.note();assert.ok(f.plan().key);
});
test('чужое сообщение, отказ изменения и обычный удар не отменяют подготовку',()=>{
 const f=setup();f.note();const p=f.plan().key;
 f.net({url:'/character/equip'},true);f.net({url:'/character/equip',status:409,res:{error:'stale'}});f.net({url:'/game/battle/action',req:{action:'l2_1147'}});
 assert.equal(f.plan().key,p);
});
test('не сохраняет исходный объект полного /character и не перечитывает его после noteSnapshot',()=>{
 const f=setup();f.note();const p=f.plan().key;f.ch.inventory.eq.l1.itemId=99999;f.ch.inventory.stacks[0].qty=0;f.ch.battleHotbarSlots[0].id=3952;
 assert.equal(f.plan().key,p);assert.equal(f.writes.length,0);
});
test('новая страница без hotbar восстанавливает перенос полного DPS только после свежего GET',()=>{
 const f=setup(),source='l2dop_rb_25001',target='l2dop_rb_25002',stats={hp:2000000,patk:1000,matk:1000,pdef:1000,mdef:1000,lvl:75};
 f.setBattle(true);f.ch.inBattle=true;f.setRows([row(3951)]);f.note();
 const powerKey=f.api().raidContext(source,stats).powerKey;
 Object.assign(f.env.rt,{rbDpsSample:{id:source,dps:40000,target:{lvl:75,pdef:1000,mdef:1000},powerKey,t:f.now()},rbStats:{[source]:{...stats},[target]:{...stats}},rbList:{[source]:{lvl:75},[target]:{lvl:75}}});
 f.env.heroLvl=()=>75;f.env.epicById=()=>null;
 f.env.warlock={raidContext:(id,st)=>f.api().raidContext(id,st,{preflight:!f.env.isBattle()})};
 const box={console,Math,Number,Date:{now:f.now}};box.globalThis=box;vm.runInNewContext(fs.readFileSync(root+'/modules/raid.js','utf8'),box);const raid=box.L2V7Factories.raid(f.env);
 assert.equal(raid.rbDpsOn(target),32000);
 f.setBattle(false);f.ch.inBattle=false;f.setRows([]);f.reload();assert.equal(raid.rbDpsOn(target),1150);
 f.api().noteSnapshot(f.ch);const p=f.api().raidContext(target,stats,{preflight:true});assert.equal(p.powerKey,powerKey);assert.equal(p.planned,true);assert.equal(raid.rbDpsOn(target),32000);
 f.ch.inventory.stacks=[];f.api().noteSnapshot(f.ch);assert.equal(f.api().raidContext(target,stats,{preflight:true}).prepared,true);assert.equal(raid.rbDpsOn(target),1150);
});
