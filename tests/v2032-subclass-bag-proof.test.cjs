'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'content.js'),'utf8'),clone=x=>JSON.parse(JSON.stringify(x));
const inventory=source.slice(source.indexOf('let INV_NET ='),source.indexOf('const actNet ='));
function snapshot(o={}){return{name:'Hero',revision:100,l2Profession:'dwarf_bounty_hunter',classBranch:'fighter',level:70,
 classSlots:{activeSlot:1,slots:[{slot:0,owned:true,active:false,profession:'human_arcana_lord',level:78},{slot:1,owned:true,active:true,profession:'dwarf_bounty_hunter',level:70}]},
 portraitProfession:'human_arcana_lord',portraitRace:'Human',inventory:{stacks:[{itemId:1464,qty:4153}],eq:{}},...clone(o)};}
function fixture(o={}){
 let now=1800000000000,gets=0,commits=0,commitOk=true,writeOk=true,answer=snapshot(o.snapshot),hero='Hero',getHook,writeHook,commitHook;
 const store={'l2bot-inv':JSON.stringify({char:'Hero',t:now,m:{1464:12}})},writes=[],statuses=[],events=[];
 const rt={char:'Hero',prof:'Arcana lord',lvl:78,classCur:{prof:'human_arcana_lord',slot:0,t:1},classBranch:'mystic',skills:{mage:1},
  classStash:{dwarf_bounty_hunter:{skills:{spoiler:2},t:12}},weaponsT:456,weaponRec:{main:'Клановый кастер',types:['#mage']},weapons:[{id:97,name:'Lance'}],
  autoLs:{pending:{id:'unknown-ls'}},actionPayments:{pending:{id:'unknown-payment'}},...clone(o.rt||{})};
 const cfg={nWeaponMain:'Lance',weaponManual:true,weaponScanAuto:true},saved={rt:clone(rt)};
 const box={Date:class extends Date{static now(){return now}},console,cfg,on:true,tabOwner:true,leaseEpoch:'one',automationGeneration:4,rt,
  heroNick:()=>hero,sessionStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=v,removeItem:k=>delete store[k]},
  gameGet:async()=>{gets++;if(getHook)await getHook();return{ok:true,json:async()=>({character:clone(answer)})}},setStatus:s=>statuses.push(s),rec:(...a)=>events.push(a),modeSig:c=>JSON.stringify(c),
  setRt:async p=>{Object.assign(box.rt,clone(p));writes.push(clone(p));if(writeHook)await writeHook(p);return{ok:writeOk}},
  rtCommit:async()=>{commits++;if(commitHook)await commitHook();if(commitOk)saved.rt=clone(box.rt);return commitOk},
  L2V7Modules:{mammon:{eqNote:async()=>{}},warlock:{noteSnapshot(){}},subclass:{charNote(){}}}};
 vm.createContext(box);vm.runInContext(inventory+';this.qty=invQty;this.inspectInv=()=>({ready:INV_READY,wait:INV_CLASS_WAIT});this.nativeBag=m=>{INV_NET={char:rt.char,t:Date.now(),m};INV_READY=invContext();};',box);
 vm.runInContext(fs.readFileSync(path.join(root,'modules/story.js'),'utf8'),box);
 box.L2V7Modules.story=box.L2V7Factories.story({get rt(){return box.rt},cfg,get on(){return box.on},get tabOwner(){return box.tabOwner},setRt:box.setRt,rec:(...a)=>events.push(a),classSwitched(){}});
 return{box,store,saved,writes,statuses,events,gets:()=>gets,commits:()=>commits,tick:n=>now+=n,setAnswer:x=>answer=clone(x),get answer(){return answer},
  getHook:f=>getHook=f,writeHook:f=>writeHook=f,commitHook:f=>commitHook=f,commitOk:x=>commitOk=x,writeOk:x=>writeOk=x,hero:x=>hero=x};
}
test('пропущенная смена саба: отдельная сверка класса, затем новый GET сумки',async()=>{
 const f=fixture(),old=clone(f.box.rt);assert.equal(await f.box.inventoryReady(),false);
 assert.equal(f.gets(),1);assert.equal(f.box.rt.classCur.prof,'dwarf_bounty_hunter');assert.equal(f.box.rt.classCur.slot,1);assert.equal(f.box.rt.prof,'Bounty hunter');assert.equal(f.box.rt.lvl,70);
 assert.equal(f.box.qty(1464),null,'ответ старого контекста ещё не публикует сумку');assert.equal(f.store['l2bot-inv'],undefined);
 assert.deepEqual(clone(f.box.rt.classStash.human_arcana_lord.skills),{mage:1});assert.deepEqual(clone(f.box.rt.skills),{spoiler:2});assert.equal(f.box.rt.classStash.dwarf_bounty_hunter,undefined);
 assert.equal(f.box.rt.weaponsT,0);assert.equal(f.box.rt.weaponRec,null);assert.deepEqual(clone(f.box.rt.weapons),old.weapons);
 assert.equal(f.box.cfg.nWeaponMain,'Lance');assert.equal(f.box.cfg.weaponManual,true);assert.equal(f.box.cfg.weaponScanAuto,true);
 assert.deepEqual(clone(f.box.rt.autoLs),old.autoLs);assert.deepEqual(clone(f.box.rt.actionPayments),old.actionPayments);
 assert.equal(f.saved.rt.classCur.prof,'dwarf_bounty_hunter','stash и класс сохранены до допуска');
 assert.equal(await f.box.inventoryReady(),true);assert.equal(f.gets(),2);assert.equal(f.box.qty(1464),4153);assert.equal(await f.box.inventoryReady(),true);assert.equal(f.gets(),2);
});
test('portrait основного класса не подменяет активный саб',async()=>{const f=fixture();await f.box.inventoryReady();assert.equal(f.box.rt.prof,'Bounty hunter');assert.equal(f.box.rt.classBranch,'fighter')});
test('возврат на котовода восстанавливает его замеры и display-профессию',async()=>{
 const f=fixture({rt:{prof:'Bounty hunter',lvl:70,classBranch:'fighter',classCur:{prof:'dwarf_bounty_hunter',slot:1,t:1},skills:{spoiler:3},classStash:{human_arcana_lord:{skills:{mage:5},t:1}}},snapshot:{l2Profession:'human_arcana_lord',classBranch:'mystic',level:78,classSlots:{activeSlot:0,slots:[{slot:0,owned:true,active:true,profession:'human_arcana_lord',level:78},{slot:1,owned:true,active:false,profession:'dwarf_bounty_hunter',level:70}]}}});
 assert.equal(await f.box.inventoryReady(),false);assert.equal(f.box.rt.prof,'Arcana lord');assert.equal(f.box.rt.lvl,78);assert.deepEqual(clone(f.box.rt.skills),{mage:5});assert.equal(await f.box.inventoryReady(),true);
});
for(const [name,mutate] of [
 ['revision отсутствует',c=>delete c.revision],['revision строка',c=>c.revision='100'],['revision дробная',c=>c.revision=100.5],
 ['нет slots',c=>delete c.classSlots.slots],['несогласованная profession',c=>c.classSlots.slots[1].profession='dwarf_warsmith'],
 ['два active',c=>c.classSlots.slots[0].active=true],['не owned',c=>c.classSlots.slots[1].owned=false],['дубли slot',c=>c.classSlots.slots.push(clone(c.classSlots.slots[1]))],
 ['уровень расходится с active row',c=>c.classSlots.slots[1].level=78],['неизвестная ветка',c=>c.classBranch='unknown'],['чужой герой',c=>c.name='Other']
])test('неполная/противоречивая сверка не меняет класс: '+name,async()=>{
 const f=fixture(),c=clone(f.answer);mutate(c);f.setAnswer(c);assert.equal(await f.box.inventoryReady(),false);assert.equal(f.box.rt.classCur.prof,'human_arcana_lord');assert.equal(f.writes.length,0);assert.equal(f.box.qty(1464),12);
});
for(const [name,mutate] of [
 ['Stop',f=>f.box.on=false],['владелец',f=>f.box.tabOwner=false],['lease',f=>f.box.leaseEpoch='two'],['персонаж',f=>f.box.rt.char='Other'],
 ['HUD',f=>f.hero('Other')],['новый Start',f=>f.box.rt.manualKickAt=100],['generation',f=>f.box.automationGeneration++],
 ['новый класс во время GET',f=>f.box.rt.classCur={prof:'human_hell_knight',slot:2,t:2}]
])test('поздний GET не восстанавливает прежний контекст: '+name,async()=>{
 const f=fixture();f.getHook(()=>mutate(f));assert.equal(await f.box.inventoryReady(),false);assert.equal(f.writes.length,0);assert.equal(f.box.rt.prof,'Arcana lord');assert.equal(f.box.qty(1464),name==='персонаж'?null:12);
});
test('Stop во время сохранения proof не допускает сумку',async()=>{const f=fixture();f.writeHook(p=>{if(p.invClassProof)f.box.on=false});assert.equal(await f.box.inventoryReady(),false);assert.equal(f.box.qty(1464),null);assert.equal(f.box.inspectInv().ready,'')});
for(const stage of ['write','commit'])test('смена класса туда-обратно во время '+stage+' не подтверждает старый снимок',async()=>{
 const f=fixture(),change=()=>{f.box.rt.classCur={...f.box.rt.classCur,t:99}};
 if(stage==='write')f.writeHook(p=>{if(p.invClassProof)change()});else f.commitHook(change);
 assert.equal(await f.box.inventoryReady(),false);assert.equal(f.box.qty(1464),null);assert.equal(f.box.inspectInv().ready,'');assert.ok(f.box.inspectInv().wait);if(stage==='write')assert.equal(f.commits(),0);
});
test('failed durable commit не обходится следующим GET или native-кэшем',async()=>{
 const f=fixture();f.commitOk(false);assert.equal(await f.box.inventoryReady(),false);assert.equal(f.box.qty(1464),null);f.box.nativeBag({1464:999});
 assert.equal(await f.box.inventoryReady(),false);assert.equal(f.gets(),2);assert.ok(f.box.inspectInv().wait);assert.equal(f.saved.rt.classCur.prof,'human_arcana_lord');
 f.tick(2001);f.commitOk(true);assert.equal(await f.box.inventoryReady(),true);assert.equal(f.gets(),3);assert.equal(f.box.qty(1464),4153);assert.equal(f.box.inspectInv().wait,null);
});
test('отказ записи proof не превращает оптимистический classCur в готовность',async()=>{
 const f=fixture();f.writeOk(false);assert.equal(await f.box.inventoryReady(),false);assert.equal(await f.box.inventoryReady(),false);assert.equal(f.box.qty(1464),null);assert.ok(f.box.inspectInv().wait);
});
test('reload после class-commit требует новый GET, не принимает старую ревизию',async()=>{
 const f=fixture();await f.box.inventoryReady();const persisted=clone(f.saved.rt),g=fixture({rt:persisted,snapshot:{revision:99}});
 assert.equal(await g.box.inventoryReady(),false);assert.equal(g.box.qty(1464),12);g.tick(2001);g.setAnswer(snapshot());assert.equal(await g.box.inventoryReady(),true);assert.equal(g.box.qty(1464),4153);
});
test('равная revision разрешает восстановить cached rollback только в proof-класс',async()=>{
 const f=fixture({rt:{invClassProof:{char:'Hero',prof:'dwarf_bounty_hunter',slot:1,revision:100}}});assert.equal(await f.box.inventoryReady(),false);assert.equal(f.box.rt.classCur.prof,'dwarf_bounty_hunter');assert.equal(await f.box.inventoryReady(),true);
});
test('равная revision с другим классом и меньшая revision отвергаются',async()=>{
 for(const revision of [99,100]){const f=fixture({rt:{invClassProof:{char:'Hero',prof:'human_arcana_lord',slot:0,revision:100}},snapshot:{revision}});assert.equal(await f.box.inventoryReady(),false);assert.equal(f.box.rt.classCur.prof,'human_arcana_lord');assert.equal(f.writes.length,0)}
});
test('watermark другого героя не наследуется',async()=>{const f=fixture({rt:{invClassProof:{char:'Other',prof:'human_warlock',slot:0,revision:999}}});assert.equal(await f.box.inventoryReady(),false);assert.equal(f.box.rt.classCur.prof,'dwarf_bounty_hunter');assert.equal(await f.box.inventoryReady(),true)});
test('после смены класса во время eqNote старые количества не публикуются',async()=>{
 const f=fixture({rt:{classCur:{prof:'dwarf_bounty_hunter',slot:1,t:1},prof:'Bounty hunter',lvl:70}});f.box.L2V7Modules.mammon.eqNote=async()=>{f.box.rt.classCur={prof:'human_arcana_lord',slot:0,t:2}};
 assert.equal(await f.box.invRefresh(),null);assert.equal(f.box.qty(1464),12);assert.equal(JSON.parse(f.store['l2bot-inv']).m[1464],12);assert.equal(f.box.inspectInv().ready,'');
});
test('параллельные потребители не допускают bag по чтению прежнего поколения',async()=>{
 const f=fixture({rt:{classCur:{prof:'dwarf_bounty_hunter',slot:1,t:1},prof:'Bounty hunter',lvl:70}});let release;f.getHook(()=>new Promise(r=>release=r));const a=f.box.inventoryReady(),b=f.box.inventoryReady();f.box.automationGeneration++;release();assert.deepEqual(await Promise.all([a,b]),[false,false]);assert.equal(f.box.qty(1464),12);assert.equal(f.gets(),1);
});
