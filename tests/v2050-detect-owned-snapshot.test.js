'use strict';
// 23.10, журнал00:25: свой успешный preflight должен открыть Detect без дополнительного MAIN GET после аренды.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8'),content=read('content.js'),clone=x=>JSON.parse(JSON.stringify(x));
const inventory=content.slice(content.indexOf('let INV_NET ='),content.indexOf('const actNet ='));
const nativeMeta=content.slice(content.indexOf('const IL ='),content.indexOf('const ilNum ='));
const hookDispatch=content.split('\n').find(l=>l.includes("if (path === '/character/skills/cast' || path === '/character'")&&l.includes('detectOutsideNote'));
const ids=[75,87,104],names={75:'Detect Insect Weakness',87:'Detect Animal Weakness',104:'Detect Plant Weakness'},actions={75:'detect_insect_weakness',87:'detect_animal_weakness',104:'detect_plant_weakness'};
function fixture(){
 let now=1792679150000,hero='OfflineHero',gets=0,answer,ok=true,badJSON=false,bodyHook,writeHook,commitHook,eqHook,writeOK=true,commitOK=true;
 const notes=[],store={},page={pathname:'/map.html',search:''};
 const box={console,Date:class extends Date{static now(){return now}},location:page,
  on:true,tabOwner:true,leaseEpoch:'owned',automationGeneration:1,cfg:{nBuffs:ids.map(id=>names[id]).join(', ')},
  rt:{char:hero,classCur:{prof:'human_warlord',slot:3},manualKickAt:1,dailyStart:1},heroNick:()=>hero,
  sessionStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=v,removeItem:k=>delete store[k]},
  setRt:async p=>{Object.assign(box.rt,clone(p));if(writeHook)await writeHook(p);return{ok:writeOK}},
  rtCommit:async()=>{if(commitHook)await commitHook();return commitOK},setStatus(){},rec(){},modeSig:c=>JSON.stringify(c),quietErr(){},
  gameGet:async p=>{assert.equal(p,'/character');gets++;return{ok,json:async()=>{if(bodyHook)await bodyHook();if(badJSON)throw new SyntaxError('local malformed JSON');return clone(answer)}}},
  L2V7Modules:{mammon:{eqNote:async()=>{if(eqHook)await eqHook()}},warlock:{noteSnapshot(){}},story:{charNote(c){box.rt.classCur={prof:c.l2Profession,slot:c.classSlots.activeSlot,t:now}}},subclass:{charNote(){}}}};
 vm.createContext(box);vm.runInContext(read('skills-il.js'),box);vm.runInContext(nativeMeta+';this.ilOf=ilOf;',box);vm.runInContext(read('modules/buffs.js'),box);
 const env={routeLocation:page,names:s=>String(s||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean),ilOf:box.ilOf,
  heroNick:box.heroNick,detectGate:()=>true,detectTask:()=> 'raid',actionGeneration:()=>box.automationGeneration,meMp:()=>({cur:500,max:1000}),setRt:box.setRt,rtCommit:box.rtCommit};
 for(const k of ['rt','cfg','on','tabOwner','leaseEpoch'])Object.defineProperty(env,k,{get:()=>box[k]});
 const buffs=box.L2V7Modules.buffs=box.L2V7Factories.buffs(env),take=buffs.detectOutsideSnapshot;
 buffs.detectOutsideSnapshot=(...a)=>{notes.push({at:a[1],source:a[2],revision:a[0]?.revision});return take?.(...a)};
 vm.runInContext(inventory+'\nthis.startupHook=function(path,d,netContext){'+hookDispatch+'};',box);
 const snap=(patch={})=>({name:'OfflineHero',revision:101,snapshotGeneratedAt:now,inBattle:false,l2Profession:'human_warlord',level:52,classBranch:'fighter',
  classSlots:{activeSlot:3,slots:[{slot:3,owned:true,active:true,profession:'human_warlord',level:52}]},mp:500,maxMp:1000,skillMpCostMul:1,inventory:{stacks:[],eq:{}},activeBuffs:[],
  learnedBattleSkillsDetail:ids.map(id=>({battleId:'l2_'+id,level:1,mpCost:20})),battleHotbarSlots:ids.map(id=>({k:'a',a:actions[id]})),...patch});
 answer={character:snap()};
 return{box,buffs,notes,snap,gets:()=>gets,now:()=>now,advance:n=>now+=n,hero:x=>hero=x,answer:x=>answer=x,
  body:f=>bodyHook=f,write:f=>writeHook=f,commit:f=>commitHook=f,eq:f=>eqHook=f,writeOK:x=>writeOK=x,commitOK:x=>commitOK=x,
  httpOK:x=>ok=x,badJSON:()=>badJSON=true};
}
test('startup GET before lease followed by one own preflight makes a Detect plan without resync',async()=>{
 const f=fixture();f.box.on=false;f.box.tabOwner=false;f.box.leaseEpoch=null;
 f.box.startupHook('/character',{status:200,pet:f.snap()},{lease:null,at:f.now()});
 f.box.on=true;f.box.tabOwner=true;f.box.leaseEpoch='owned';assert.equal(f.buffs.detectOutsidePlan(),null);
 const started=f.now();assert.equal(await f.box.inventoryReady(),true);assert.equal(f.gets(),1);
 assert.deepEqual(f.notes,[{at:started,source:'inventory',revision:101}]);assert.equal(f.buffs.detectOutsidePlan()?.id,75);
 assert.equal(await f.box.inventoryReady(),true);assert.equal(f.gets(),1,'Detect does not add a GET or replace the inventory cache');
});
test('own feed keeps the request start and server-generated time, not the response arrival time',async()=>{
 const f=fixture(),started=f.now();f.body(()=>f.advance(5000));assert.equal(await f.box.inventoryReady(),true);
 assert.deepEqual(f.notes,[{at:started,source:'inventory',revision:101}]);assert.equal(f.buffs.detectOutsidePlan()?.id,75);
 f.advance(25001);assert.equal(f.buffs.detectOutsidePlan(),null,'a slow response cannot renew the snapshot freshness');
});
for(const [name,patch]of[['missing generated',{snapshotGeneratedAt:undefined}],['stale generated',{snapshotGeneratedAt:1792679100000}],['in battle',{inBattle:true}],['false JSON',false]])
 test('own answer does not create a Detect plan: '+name,async()=>{
  const f=fixture();f.answer(patch===false?false:{character:f.snap(patch)});await f.box.inventoryReady();assert.equal(f.buffs.detectOutsidePlan(),null);
 });
for(const [name,change]of[
 ['manual OFF',f=>f.box.on=false],['no owner',f=>f.box.tabOwner=false],['empty lease',f=>f.box.leaseEpoch=null],['unknown HUD',f=>f.hero('')]
])test('a valid manual inventory read is not a Detect snapshot: '+name,async()=>{
 const f=fixture();change(f);assert.ok(await f.box.invRefresh());assert.equal(f.notes.length,0);assert.equal(f.buffs.detectOutsidePlan(),null);
});
test('Start during a manual OFF read does not adopt that old request as owned',async()=>{
 const f=fixture();f.box.on=false;f.body(()=>f.box.on=true);assert.equal(await f.box.invRefresh(),null);assert.equal(f.notes.length,0);assert.equal(f.buffs.detectOutsidePlan(),null);
});
for(const [name,change]of[
 ['Stop',f=>f.box.on=false],['owner',f=>f.box.tabOwner=false],['lease',f=>f.box.leaseEpoch='other'],['hero',f=>f.hero('Other')],
 ['actor',f=>f.box.rt.char='Other'],['class',f=>f.box.rt.classCur={prof:'human_arcana_lord',slot:0}],['Start',f=>f.box.rt.manualKickAt=2],['generation',f=>f.box.automationGeneration++]
])test('late own response cannot seed Detect after '+name,async()=>{
 const f=fixture();f.body(()=>change(f));assert.equal(await f.box.inventoryReady(),false);assert.equal(f.notes.length,0);assert.equal(f.buffs.detectOutsidePlan(),null);
});
for(const stage of ['write','commit','equipment'])test('Stop during '+stage+' prevents the own Detect feed',async()=>{
 const f=fixture(),stop=()=>f.box.on=false;if(stage==='write')f.write(stop);if(stage==='commit')f.commit(stop);if(stage==='equipment')f.eq(stop);
 assert.equal(await f.box.inventoryReady(),false);assert.equal(f.notes.length,0);assert.equal(f.buffs.detectOutsidePlan(),null);
});
for(const stage of ['write','commit'])test('negative '+stage+' ACK prevents the own Detect feed',async()=>{
 const f=fixture();f[stage+'OK'](false);assert.equal(await f.box.inventoryReady(),false);assert.equal(f.notes.length,0);assert.equal(f.buffs.detectOutsidePlan(),null);
});
test('class confirmation never feeds the old response; next owned GET can prepare Detect',async()=>{
 const f=fixture();f.box.rt.classCur={prof:'human_arcana_lord',slot:0};assert.equal(await f.box.inventoryReady(),false);
 assert.equal(f.box.rt.classCur.prof,'human_warlord');assert.equal(f.notes.length,0);assert.equal(f.buffs.detectOutsidePlan(),null);
 assert.equal(await f.box.inventoryReady(),true);assert.equal(f.gets(),2);assert.equal(f.notes.length,1);assert.equal(f.buffs.detectOutsidePlan()?.id,75);
});
for(const error of ['http','JSON','wrong hero','old revision'])test('failed '+error+' never reaches the Detect feed',async()=>{
 const f=fixture();if(error==='http')f.httpOK(false);if(error==='JSON')f.badJSON();if(error==='wrong hero')f.answer({character:f.snap({name:'Other'})});
 if(error==='old revision'){f.box.rt.invClassProof={char:'OfflineHero',prof:'human_warlord',slot:3,revision:102};}
 assert.equal(await f.box.inventoryReady(),false);assert.equal(f.notes.length,0);assert.equal(f.buffs.detectOutsidePlan(),null);
});
test('native Monster80 is managed support and an eligible outside-panel button',()=>{
 const f=fixture(),button={name:'Вразливість монстрів',title:'Вразливість монстрів (Detect Monster Weakness)',cdKey:'detect_monster_weakness'};
 const il=f.box.ilOf(button);assert.equal(il?.id,80);assert.equal(il.autoUse,false);assert.equal(il.managedDetect,true);
 Object.assign(f.box,{SLOT:'.local-hotbar',shown:()=>true,slotKind:()=> 'скилл',slotAction:b=>b.cdKey,uiReady:()=>true,memLeft:()=>0,
  combatCooldown:{globalWait:()=>0,skillWait:()=>0},cdSpawn:()=>'',document:{querySelectorAll:()=>[button],querySelector:()=>({})}});
 vm.runInContext(content.slice(content.indexOf('function detectOutsidePanel()'),content.indexOf('// Фоновые опросы',content.indexOf('function detectOutsidePanel()'))),f.box);
 const panel=f.box.detectOutsidePanel();assert.equal(panel.hotbar,true);assert.equal(panel.slots.length,1);assert.equal(panel.slots[0].id,80);assert.equal(panel.slots[0].action,'detect_monster_weakness');assert.equal(panel.slots[0].ready,true);
});
