'use strict';
// 23.10, журнал20.50: новый Monster80 работает в бою; outside разрешает только свежий серверный castable-каталог.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=process.env.L2_DETECT_SOURCE_ROOT||path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const rows={75:['detect_insect_weakness','Detect Insect Weakness','Вразливість комах',14],87:['detect_animal_weakness','Detect Animal Weakness','Вразливість звірів',18],104:['detect_plant_weakness','Detect Plant Weakness','Вразливість рослин',21],80:['detect_monster_weakness','Detect Monster Weakness','Вразливість монстрів',24]},ids=[75,87,104,80];
const names=s=>String(s||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean),exact=Object.fromEntries(ids.flatMap(id=>rows[id].slice(1,3).map(n=>[n.toLowerCase(),id])));
function fixture(saved={}){
 let now=1792679365317,generation=1,gate=true;const fired=[],nav=[],buttons=Object.fromEntries(ids.map(id=>[id,{id}]));
 const page={pathname:'/map.html',search:'',get href(){return this.pathname+this.search},set href(v){nav.push(v);this.pathname=v.split('?')[0];this.search=v.includes('?')?'?'+v.split('?')[1]:''}};
 const env={on:true,tabOwner:true,leaseEpoch:'lease1',cfg:{nBuffs:ids.map(id=>rows[id][1]).join(', ')},rt:{char:'Hero',classCur:{prof:'human_warlord',slot:3},manualKickAt:1,dailyStart:1,...saved},routeLocation:page,names,
  ilOf:x=>{const id=typeof x==='string'?exact[x.toLowerCase()]:x?.id;return rows[id]?{id,c:'Бафф',autoUse:false,managedDetect:true,st:'detect_weakness'}:null},heroNick:()=>env.rt.char,
  detectGate:()=>gate,detectTask:()=> 'farm',actionGeneration:()=>generation,detectTab:()=> 'tab1',detectLineage:()=>null,setRt:async p=>{Object.assign(env.rt,p);return{ok:true}},rtCommit:async()=>true,
  rec:()=>{},setStatus:()=>{},meMp:()=>({cur:500,max:500}),detectPanelOpen:async()=>{},fire:b=>{fired.push(b.id);return true},
  detectPanel:()=>({hotbar:true,slots:ids.map(id=>({id,action:rows[id][0],button:buttons[id],ready:true}))})};
 const box={Date:class extends Date{static now(){return now}},location:page};vm.createContext(box);vm.runInContext(read('modules/buffs.js'),box);const B=box.L2V7Factories.buffs(env);
 const snap=(patch={})=>({name:'Hero',l2Profession:'human_warlord',classSlots:{activeSlot:3},revision:100,snapshotGeneratedAt:now,inBattle:false,mp:500,maxMp:500,skillMpCostMul:1,
  learnedBattleSkillsDetail:ids.map(id=>({battleId:'l2_'+id,level:1,mpCost:rows[id][3],hintUk:'MP '+rows[id][3]})),battleHotbarSlots:ids.map(id=>({k:'a',a:rows[id][0]})),
  castableSelfBuffs:[{battleId:'l2_80',l2SkillId:80,mpCost:24,readyRemainingSec:0}],activeBuffs:[],...patch});
 const note=async(patch={})=>B.detectOutsideNote('/character',{status:200,pet:snap(patch)},now);
 const key=id=>JSON.stringify(['Hero','human_warlord',3,id]);
 const ack=async(id,revision=100,rid=7,patch={},dpatch={})=>{await B.detectOutsideRequest({path:'/character/skills/cast',method:'POST',rid,req:{battleId:'l2_'+id,expectedRevision:revision}},now);
  return B.detectOutsideNote('/character/skills/cast',{status:200,rid,req:{battleId:'l2_'+id,expectedRevision:revision},pet:snap({revision:revision+1,activeBuffs:ids.map(skillId=>({skillId,expiresAtMs:now+600000})),...patch}),...dpatch},now)};
 return{B,env,snap,note,ack,key,page,fired,nav,now:()=>now,advance:n=>now+=n,nextGeneration:()=>generation++,gate:v=>gate=v};
}
async function prepared(f){await f.note();assert.equal(await f.B.detectOutsideQueue(),true);await f.B.detectOutsideStep();await f.B.detectOutsideStep();assert.deepEqual(f.fired,[80]);return f.env.rt.detectOutsideIntent[f.key(80)];}
test('все четыре выбранных Detect получают отдельный own ACK; native buff IDs не заменяют proof',async()=>{
 const f=fixture();await f.note({activeBuffs:ids.map(skillId=>({skillId,expiresAtMs:f.now()+600000}))});assert.equal(await f.B.detectOutsideQueue(),true);await f.B.detectOutsideStep();
 for(let n=0;n<ids.length;n++){await f.B.detectOutsideStep();assert.equal(f.fired.at(-1),ids[n]);await f.ack(ids[n],100+n,7+n);}
 await f.B.detectOutsideStep();await f.B.detectOutsideStep();assert.deepEqual(f.fired,ids);assert.equal(Object.keys(f.env.rt.detectOutsideProof).length,4);assert.equal(await f.B.detectOutsideQueue(),false);
});
for(const patch of [{castableSelfBuffs:null},{castableSelfBuffs:[]},{castableSelfBuffs:[{battleId:'l2_80',readyRemainingSec:0}]},{castableSelfBuffs:[{battleId:'l2_80',mpCost:-1,readyRemainingSec:0}]},{castableSelfBuffs:[{battleId:'l2_80',mpCost:NaN,readyRemainingSec:0}]}])test('Monster не использует learned/IL MP вместо явного castable: '+JSON.stringify(patch),async()=>{
 const f=fixture();f.env.cfg.nBuffs='Detect Monster Weakness';await f.note(patch);assert.equal(await f.B.detectOutsideQueue(),false);assert.deepEqual(f.fired,[]);
});
for(const row of [{battleId:80},{battleId:'l2_80'},{l2SkillId:80},{battleId:'detect_monster_weakness',l2SkillId:80}])test('явная server80 capability нормализуется: '+JSON.stringify(row),async()=>{
 const f=fixture();f.env.cfg.nBuffs='Detect Monster Weakness';await f.note({castableSelfBuffs:[{...row,mpCost:24,readyRemainingSec:0}]});assert.equal(await f.B.detectOutsideQueue(),true);await f.B.detectOutsideStep();await f.B.detectOutsideStep();assert.deepEqual(f.fired,[80]);
});
for(const row of [null,{battleId:'l2_80',mpCost:501,readyRemainingSec:0},{battleId:'l2_80',mpCost:24,readyRemainingSec:3}])test('fresh capability перепроверяется после записи intent: '+JSON.stringify(row),async()=>{
 const f=fixture();f.env.cfg.nBuffs='Detect Monster Weakness';await f.note();assert.equal(await f.B.detectOutsideQueue(),true);await f.B.detectOutsideStep();const save=f.env.setRt;
 f.env.setRt=async p=>{const out=await save(p);if(p.detectOutsideIntent)await f.note({castableSelfBuffs:row?[row]:[]});return out};await f.B.detectOutsideStep();assert.deepEqual(f.fired,[]);assert.equal(f.env.rt.detectOutsideIntent[f.key(80)].phase,'notSent');
});
test('прежние три Detect сохраняют learned MP fallback без castable-каталога',async()=>{
 const f=fixture();f.env.cfg.nBuffs=ids.slice(0,3).map(id=>rows[id][1]).join(', ');await f.note({castableSelfBuffs:null});assert.equal(await f.B.detectOutsideQueue(),true);await f.B.detectOutsideStep();await f.B.detectOutsideStep();assert.deepEqual(f.fired,[75]);
});
for(const [name,change]of Object.entries({stop:f=>f.env.on=false,owner:f=>f.env.tabOwner=false,lease:f=>f.env.leaseEpoch='lease2',generation:f=>f.nextGeneration(),manualRemoval:f=>f.env.cfg.nBuffs='',mp:f=>f.env.meMp=()=>({cur:23,max:500})}))test('Monster перепроверяет '+name+' после durable intent до native клика',async()=>{
 const f=fixture();f.env.cfg.nBuffs='Detect Monster Weakness';await f.note();assert.equal(await f.B.detectOutsideQueue(),true);await f.B.detectOutsideStep();const save=f.env.setRt;
 f.env.setRt=async p=>{const out=await save(p);if(p.detectOutsideIntent)change(f);return out};await f.B.detectOutsideStep();assert.deepEqual(f.fired,[]);
});
for(const [name,patch]of Object.entries({notLearned:{learnedBattleSkillsDetail:[]},notOnPanel:{battleHotbarSlots:[]},nativeCD:{skillCooldowns:{detect_monster_weakness:1792679365317+3000}},numericCD:{skillCooldowns:{l2_80:1792679365317+3000}},castableCD:{castableSelfBuffs:[{battleId:'l2_80',mpCost:24,readyRemainingSec:3}]}}))test('Monster требует learned/panel/ready: '+name,async()=>{
 const f=fixture();f.env.cfg.nBuffs='Вразливість монстрів';await f.note(patch);assert.equal(await f.B.detectOutsideQueue(),false);assert.deepEqual(f.fired,[]);
});
test('серверный CD Monster заканчивается по deadline, без исторического минимума10с',async()=>{
 const f=fixture();f.env.cfg.nBuffs='Detect Monster Weakness';await f.note({castableSelfBuffs:[{battleId:'l2_80',mpCost:24,readyRemainingSec:3}]});assert.equal(await f.B.detectOutsideQueue(),false);f.advance(3001);assert.equal(await f.B.detectOutsideQueue(),true);
});
test('native Monster battle ACK не создаёт outside proof; неизвестный исход не повторяется после reload',async()=>{
 const f=fixture();f.env.cfg.nBuffs='Detect Monster Weakness';await prepared(f);await f.B.detectOutsideNote('/game/battle/action',{status:200,rid:7,req:{action:rows[80][0],expectedRevision:100},pet:f.snap({revision:101})},f.now());assert.equal(f.env.rt.detectOutsideProof,undefined);
 f.advance(21000);await f.B.detectOutsideStep();await f.B.detectOutsideStep();assert.equal(f.env.rt.detectOutsideIntent[f.key(80)].phase,'unknown');
 const g=fixture(JSON.parse(JSON.stringify(f.env.rt)));g.env.cfg.nBuffs='Detect Monster Weakness';g.advance(130000);await g.note({revision:102});assert.equal(await g.B.detectOutsideQueue(),false);assert.deepEqual(g.fired,[]);
});
for(const [name,dpatch,patch]of [['reject',{status:400},{}],['wrongRid',{rid:99},{}],['sameRevision',{}, {revision:100}],['noActive',{}, {activeBuffs:[]}],['wrongSlot',{}, {classSlots:{activeSlot:2}}]])test('Monster ACK '+name+' не подтверждает действие',async()=>{
 const f=fixture();f.env.cfg.nBuffs='Detect Monster Weakness';await prepared(f);await f.ack(80,100,7,patch,dpatch);assert.equal(f.env.rt.detectOutsideProof?.[f.key(80)],undefined);const count=f.fired.length;await f.B.detectOutsideStep();assert.equal(f.fired.length,count);
});
test('повтор собственного ACK идемпотентен, чужой ACK не переписывает следующее намерение',async()=>{
 const f=fixture();f.env.cfg.nBuffs='Detect Monster Weakness';await prepared(f);await f.ack(80);const proof=JSON.stringify(f.env.rt.detectOutsideProof);await f.ack(80);assert.equal(JSON.stringify(f.env.rt.detectOutsideProof),proof);
 f.env.rt.detectOutsideIntent[f.key(80)]={...f.env.rt.detectOutsideIntent[f.key(80)],id:'new',phase:'sent',rid:99,baseRevision:102};await f.ack(80);assert.equal(f.env.rt.detectOutsideIntent[f.key(80)].id,'new');assert.equal(JSON.stringify(f.env.rt.detectOutsideProof),proof);
});
test('синхронный export принимает validated own inventory snapshot без native GET и не даёт готовности после Stop',()=>{
 const f=fixture();f.env.cfg.nBuffs='Detect Monster Weakness';assert.equal(f.B.detectOutsideSnapshot(f.snap(),f.now(),'inventory'),true);assert.equal(f.B.detectOutsidePlan().id,80);f.env.on=false;assert.equal(f.B.detectOutsidePlan(),null);
});
test('hook сохраняет80 native alias/MP/castable/CD/expiry без чужих полей',()=>{
 const src=read('hook.js'),a=src.indexOf('  const petOf ='),b=src.indexOf('  // 20.12',a),box={};vm.createContext(box);vm.runInContext(src.slice(a,b)+'\nthis.petOf=petOf;',box);const f=fixture();
 const p=box.petOf({pathname:'/character/skills/cast'},{character:f.snap({skillCooldowns:{l2_80:f.now()+3000,detect_monster_weakness:f.now()+3000,foreign:f.now()+3000},activeBuffs:[{skillId:80,expiresAt:f.now()+600000}]})});
 assert.equal(p.battleHotbarSlots[3].a,rows[80][0]);assert.equal(p.learnedBattleSkillsDetail[3].mpCost,24);assert.match(p.learnedBattleSkillsDetail[3].hintUk,/MP 24/);assert.equal(p.castableSelfBuffs[0].l2SkillId,80);
 assert.deepEqual(JSON.parse(JSON.stringify(p.skillCooldowns)),{l2_80:f.now()+3000,detect_monster_weakness:f.now()+3000});assert.equal(p.activeBuffs[0].expiresAtMs,f.now()+600000);
});
test('hook netStart публикует только допустимое l2_80 намерение с revision',()=>{
 const src=read('hook.js'),a=src.indexOf('  function start(u, method, req)'),b=src.indexOf('  // 20.42',a),events=[],box={TRACK:/./,STORY_TP:/^\/never$/,ridN:0,storyRetry:null,mutationN:0,Date,Number,location:{origin:'https://local.invalid'},window:{postMessage:x=>events.push(x)}};
 vm.createContext(box);vm.runInContext(src.slice(a,b)+'\nthis.start=start;',box);box.start({pathname:'/character/skills/cast'},'POST',{battleId:'l2_80',expectedRevision:100});assert.deepEqual(JSON.parse(JSON.stringify(events[0].req)),{battleId:'l2_80',expectedRevision:100});
 box.start({pathname:'/character/skills/cast'},'POST',{battleId:'l2_80',expectedRevision:null});assert.equal(events[1].req,undefined);
});
test('серверный l2_80 CD блокирует native Monster и истекает одинаково в main/Lite shared parser',()=>{
 for(const file of ['battle-cooldown.js','lite/battle-cooldown.js']){let now=10000;const box={};vm.createContext(box);vm.runInContext(read(file),box);const C=box.L2BattleCooldown.createBattleCooldown(()=>now);
  C.observe({action:'detect_monster_weakness',battleSpawnId:'mob'},{serverNowMs:10000,skillCooldowns:{l2_80:13000}},200,'mob');assert.ok(C.skillWait('detect_monster_weakness','mob')>0,file);now=13041;assert.equal(C.skillWait('detect_monster_weakness','mob'),0,file);
 }
});
function rolesFixture(){
 const box={Date,rt:{skillDb:{}}},core=read('content.js');vm.createContext(box);vm.runInContext(read('skills-il.js')+'\n'+core.slice(core.indexOf('const IL = typeof IL_DB'),core.indexOf('// ---------- база предметов'))+'\nthis.ilOf=ilOf;',box);
 const panel=ids.map(id=>({cdKey:rows[id][0],name:rows[id][2],kind:'скилл'}));const env={on:true,tabOwner:true,cfg:{autoRoles:true,nBuffs:'Свій бафф'},rt:{char:'Hero',classCur:{prof:'human_warlord',slot:3},weapons:[],panelKnown:panel.map(x=>x.name.toLowerCase()),warriorRoles1027:panel.map(x=>x.name.toLowerCase())},
  isBattle:()=>true,actionGeneration:()=>1,itemsDb:async()=>{},panelInventory:()=>panel,ilOf:box.ilOf,normalizeProfession:s=>s,CLASS_W:{},isEquip:()=>false,combatProfileKind:()=> 'fighter',cleanTitle:s=>s,slotAction:b=>b.cdKey,noEffect:()=>false,isChargeName:()=>false,isForceName:()=>false,skillCost:()=>0,expDmg:()=>500,ilNum:x=>x,itemOf:()=>null,iconStem:x=>x,FREE_HIT:/x^/,names,slotsBy:n=>panel.filter(x=>x.name.toLowerCase()===n),setCfg:async p=>{Object.assign(env.cfg,p);return{ok:true}},setRt:async p=>{Object.assign(env.rt,p);return{ok:true}},rec:()=>{}};
 box.chrome={storage:{local:{get:async()=>({cfg:env.cfg})}}};vm.runInContext(read('modules/equipment.js'),box);return{env,panel,E:box.L2V7Factories.equipment(env),box};
}
test('автороли добавляют четвёртый Detect один раз, сохраняют EN/UK alias и ручное удаление',async()=>{
 const f=rolesFixture();await f.E.autoRoles();assert.deepEqual(names(f.env.cfg.nBuffs).filter(n=>exact[n]).map(n=>exact[n]),ids);assert.equal(f.env.rt.warlordDetectRoles2050[80],true);
 f.env.cfg.nBuffs=names(f.env.cfg.nBuffs).filter(n=>exact[n]!==80).join(', ');f.panel[3].name=rows[80][1];await f.E.autoRoles();assert.equal(names(f.env.cfg.nBuffs).some(n=>exact[n]===80),false);
});
test('выключенные автороли не добавляют Monster; generic buffList никогда не запускает Detect',async()=>{
 const f=rolesFixture();f.env.cfg.autoRoles=false;await f.E.autoRoles();assert.equal(f.env.cfg.nBuffs,'Свій бафф');for(const id of ids)assert.equal(f.env.ilOf({cdKey:rows[id][0],name:rows[id][1]}).autoUse,false);
 vm.runInContext(read('modules/buffs.js'),f.box);const B=f.box.L2V7Factories.buffs({...f.env,isTotem:()=>false});f.env.cfg.nBuffs=ids.map(id=>rows[id][2]).join(', ');assert.equal(JSON.stringify(B.buffList({rb:true})),JSON.stringify([]));
});
