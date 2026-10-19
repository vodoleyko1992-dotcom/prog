'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=f=>fs.readFileSync(__dirname+'/../'+f,'utf8'),clone=x=>JSON.parse(JSON.stringify(x));
function fixture(){
 const box={console};vm.createContext(box);for(const f of ['augment.js','modules/lifestone.js'])vm.runInContext(read(f),box);
 const equipped={itemId:123,enchant:7,clanWeaponUid:'exact-a'},bag={itemId:124,enchant:5,clanWeaponUid:'exact-b',qty:1};
 const snap={name:'Hero',revision:10,inventory:{eq:{l1:equipped},stacks:[bag,{itemId:125,qty:1},{itemId:126,qty:1},{itemId:10411,qty:5},{itemId:2133,qty:5}]}};
 const hints={itemGradeHints:{123:'A',124:'A',125:'A',126:'D',10411:'A'},itemSlotHints:{123:'rhand',124:'rhand',125:'chest',126:'rhand',10411:'consumable'},itemNamesRu:{123:'Посох',124:'Копьё'}};
 const posts=[],env={cfg:{autoLs:{targets:['prominence'],maxAttempts:3}},rt:{char:'Hero'},on:true,tabOwner:true,canRun:()=>true,canPrepare:()=>true,context:()=> 'same',
  setRt:async p=>{Object.assign(env.rt,clone(p));return {ok:true}},gameGet:async p=>({ok:true,json:async()=>clone(p==='/character'?{character:snap}:hints)}),
  gamePost:async(...a)=>{posts.push(a);throw Error('POST forbidden in this test')}};
 const m=box.L2V7Factories.lifestone(env),scan=()=>m.command('scan');
 const choose=async equipped=>{await scan();const r=env.rt.lsWeapons.items.find(x=>x.equipped===equipped);env.cfg.autoLs.weaponKey=r.key;return r};
 return {m,env,snap,hints,posts,scan,choose};
}
test('обновление при OFF: надетое и оружие из рюкзака C/B/A/S, без брони/материалов/D и без расходов',async()=>{
 const f=fixture();f.env.on=false;await f.scan();const scan=f.env.rt.lsWeapons;
 assert.equal(scan.char,'Hero');assert.equal(scan.items.length,2);assert.equal(scan.items[0].name,'Посох');assert.equal(scan.items[0].equipped,true);assert.equal(scan.items[1].name,'Копьё');assert.equal(scan.items[1].equipped,false);assert.equal(f.posts.length,0);assert.equal(f.env.rt.autoLs,undefined);
});
test('точный выбранный надетый экземпляр привязывается к серии',async()=>{
 const f=fixture(),r=await f.choose(true);await f.m.command('prepare');assert.equal(f.env.rt.autoLs.weaponKey,r.key);assert.equal(f.env.rt.autoLs.weaponName,'Посох');assert.equal(f.env.rt.autoLs.itemId,123);assert.equal(f.posts.length,0);
});
test('выбор оружия из рюкзака не подменяется надетым',async()=>{
 const f=fixture();await f.choose(false);await assert.rejects(()=>f.m.command('prepare'),/Сначала наденьте.*Копьё/);assert.equal(f.env.rt.autoLs,undefined);assert.equal(f.posts.length,0);
});
test('выбранный экземпляр можно надеть после выбора; qty и ЛС не меняют выбор',async()=>{
 const f=fixture(),r=await f.choose(false),w=f.snap.inventory.stacks.shift();delete w.qty;w.augmentation={uid:'new-ls',outcomeId:'tempest',grade:'A'};f.snap.inventory.eq.l1=w;
 await f.m.command('prepare');assert.equal(f.env.rt.autoLs.weaponKey,r.key);assert.equal(f.env.rt.autoLs.itemId,124);assert.equal(f.env.rt.autoLs.weaponName,'Копьё');
});
for(const part of ['enchant','clanWeaponUid','itemId'])test('замена выбранного экземпляра меняет цель: '+part,async()=>{
 const f=fixture();await f.choose(true);f.snap.inventory.eq.l1[part]=part==='clanWeaponUid'?'other':999;
 await assert.rejects(()=>f.m.command('prepare'),/не найдено|наденьте|грейда/);assert.equal(f.posts.length,0);
});
test('два одинаковых экземпляра без уникального ID не выдаются за точный выбор',async()=>{
 const f=fixture();delete f.snap.inventory.eq.l1.clanWeaponUid;f.snap.inventory.stacks.push({...f.snap.inventory.eq.l1,qty:1});await f.choose(true);
 assert.equal(f.env.rt.lsWeapons.items.filter(x=>x.itemId===123).every(x=>x.ambiguous),true);await assert.rejects(()=>f.m.command('prepare'),/одинаковых экземпляров/);
});
test('одинаковый itemId с разными UID остаётся различимым',async()=>{
 const f=fixture();f.snap.inventory.stacks.push({...f.snap.inventory.eq.l1,qty:1,clanWeaponUid:'other'});await f.choose(true);assert.equal(f.env.rt.lsWeapons.items.some(x=>x.ambiguous),false);await f.m.command('prepare');
});
test('неизвестная сохранённая вещь блокирует серию',async()=>{
 const f=fixture();f.env.cfg.autoLs.weaponKey='missing';await assert.rejects(()=>f.m.command('prepare'),/не найдено/);assert.equal(f.posts.length,0);
});
test('изменение выбора после запуска не расходует камни в старую вещь',async()=>{
 const f=fixture();await f.choose(true);await f.m.command('prepare');await f.m.command('resume');f.env.cfg.autoLs.weaponKey='another';await f.m.step();assert.equal(f.posts.length,0);assert.equal(f.env.rt.autoLs.status,'paused');
});
for(const change of ['hero','owner','context'])test('поздний ответ чтения не публикует чужой список: '+change,async()=>{
 const f=fixture(),original=f.env.gameGet;f.env.gameGet=async p=>{const r=await original(p);return {...r,json:async()=>{const j=await r.json();if(change==='hero')f.env.rt.char='Other';if(change==='owner')f.env.tabOwner=false;if(change==='context')f.env.context=()=> 'other';return j}}};
 await assert.rejects(()=>f.scan());assert.equal(f.env.rt.lsWeapons,undefined);
});
for(const failure of ['catalog','snapshot','write'])test('ошибка обновления не запускает серию: '+failure,async()=>{
 const f=fixture();await f.scan();const previous=clone(f.env.rt.lsWeapons);
 if(failure==='write')f.env.setRt=async()=>({ok:false});else{const g=f.env.gameGet;f.env.gameGet=p=>(failure==='catalog'?p.includes('catalog'):p==='/character')?Promise.resolve({ok:false}):g(p)}
 await assert.rejects(()=>f.scan());assert.deepEqual(f.env.rt.lsWeapons,previous);assert.equal(f.posts.length,0);
});

test('очищенный выбор вещи блокирует и прямую команду подготовки',async()=>{
 const f=fixture();f.env.cfg.autoLs.weaponKey='';await assert.rejects(()=>f.m.command('prepare'),/Выберите оружие/);assert.equal(f.posts.length,0);
});
