'use strict';
// 22.10: чтение до запуска не расходует ресурсы, не забирает чужой замок и не публикует старый снимок.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(__dirname+'/../content.js','utf8');
const fn=src.slice(src.indexOf('let craftReadCommandBusy ='),src.indexOf('// 19.10: чтение рюкзака по кнопке',src.indexOf('let craftReadCommandBusy =')));
const book={canCraftProfession:true,createItemLevel:4,maxMp:1000,currentMp:500,recipes:[{code:'steel',output:{itemId:10,nameEn:'Steel',quantity:1},ingredients:[{itemId:1,quantity:1}],mpCost:10,createItemLevel:1}]};
function fixture(){
 const calls=[],f={on:false,tabOwner:false,tabIdle:false,leaseEpoch:null,documentLease:'doc',lockMine:0,automationGeneration:1,cfg:{craftChain:true},
  rt:{char:'Crafter',classCur:{prof:'dwarf_maestro',slot:2},craftQueue:[{id:'q',code:'steel',n:1}]},heroNick:()=> 'Crafter',tabVis:()=>true,location:{pathname:'/craft.html'},
  rtWriter:{recover:async()=>({ok:true})},quietErr:()=>{},L2V7Modules:{craft:{wake:()=>calls.push('wake')}},
  chrome:{storage:{local:{get:async()=>({rt:f.rt,on:f.on})}}},
  ipc:async m=>{calls.push(m);return m.cmd==='lockAcquire'?{ok:true,epoch:'read'}:{ok:true};},
  gameGet:async path=>{calls.push(path);return{ok:true,json:async()=>path==='/character'?{character:{name:'Crafter',revision:10,mp:500,maxMp:1000,inventory:{stacks:[{itemId:1,qty:5}]}}}:structuredClone(book)};},
  setRt:async patch=>{calls.push(patch);Object.assign(f.rt,patch);return{ok:true};},calls};
 vm.createContext(f);vm.runInContext(fs.readFileSync(__dirname+'/../craft-plan.js','utf8'),f);vm.runInContext(fn,f);return f;
}
test('OFF: одна временная аренда, два GET, сохранённый план; Start и POST не вызываются',async()=>{
 const f=fixture();assert.equal((await f.craftReadCommand({char:'Crafter'})).ok,true);assert.equal(f.on,false);assert.equal(f.tabOwner,false);assert.equal(f.leaseEpoch,null);
 assert.equal(f.rt.craftBook.recipes.length,1);assert.equal(f.rt.craftBag.revision,10);assert.equal(f.rt.craftPlan.goals[0].status,'ready');
 assert.deepEqual(f.calls.filter(x=>typeof x==='string'),['/game/craft/materials','/character','wake']);assert.deepEqual(f.calls.filter(x=>x?.cmd).map(x=>x.cmd),['lockAcquire','lockRelease']);
});
test('ON owner читает без захвата/освобождения аренды',async()=>{
 const f=fixture();f.on=true;f.tabOwner=true;f.leaseEpoch='own';assert.equal((await f.craftReadCommand({char:'Crafter'})).ok,true);
 assert.equal(f.leaseEpoch,'own');assert.equal(f.tabOwner,true);assert.equal(f.calls.some(x=>x?.cmd),false);
});
test('чужой герой, работа у другой вкладки и занятый замок не читают игру',async()=>{
 for(const variant of ['char','owner','lock']){const f=fixture();if(variant==='char')f.rt.char='Other';if(variant==='owner'){f.on=true;}if(variant==='lock')f.ipc=async()=>({ok:false});
  assert.equal((await f.craftReadCommand({char:'Crafter'})).ok,false);assert.equal(f.calls.some(x=>typeof x==='string'),false);
 }
});
for(const change of ['Stop','OFF-Stop','class','lease','char'])test(change+' во время GET запрещает запись',async()=>{
 const f=fixture(),original=f.gameGet;f.gameGet=async p=>{const r=await original(p);if(change==='Stop')f.automationGeneration++;if(change==='OFF-Stop')vm.runInContext('craftReadControl++',f);if(change==='class')f.rt.classCur.slot=3;if(change==='lease')f.leaseEpoch='new';if(change==='char')f.rt.char='Other';return r;};
 assert.equal((await f.craftReadCommand({char:'Crafter'})).ok,false);assert.equal(f.rt.craftBook,undefined);
});
test('старый revision не перезаписывает новую сумку',async()=>{
 const f=fixture();f.rt.craftBag={char:'Crafter',revision:11};assert.equal((await f.craftReadCommand({char:'Crafter'})).ok,false);assert.equal(f.rt.craftBag.revision,11);
});
test('ошибка ACK возвращает отказ и не снимает задержку крафта',async()=>{
 const f=fixture();f.setRt=async()=>({ok:false});assert.equal((await f.craftReadCommand({char:'Crafter'})).ok,false);assert.equal(f.calls.includes('wake'),false);
});
test('два одновременных чтения не открывают две аренды',async()=>{
 const f=fixture();let release;f.chrome.storage.local.get=()=>new Promise(r=>{release=()=>r({rt:f.rt,on:f.on});});
 const first=f.craftReadCommand({char:'Crafter'});assert.equal((await f.craftReadCommand({char:'Crafter'})).ok,false);release();assert.equal((await first).ok,true);
});
