'use strict';
// LS hold выпускает только один проверенный запрос материалов, не общий доступ к магазину.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(__dirname+'/../content.js','utf8'),code=src.slice(src.indexOf('async function gamePost('),src.indexOf('async function gameGet('));
function fixture(){
 const calls=[],permits=[],expected={id:'purchase:1',path:'/game/mammon/merchant/buy',body:{category:'life_stones',itemKey:'s',qty:1,expectedRevision:10}};let used=false;
 const box={AbortController,setTimeout,clearTimeout,on:true,tabOwner:true,rt:{autoLs:{hold:true,pending:{kind:'supply'}}},gameAuth:()=>({}),
  L2V7Modules:{lifestone:{consumePermit:()=>false,consumeSupplyPermit:(id,path,body)=>{permits.push({id,path,body});if(used||id!==expected.id||path!==expected.path||JSON.stringify(body)!==JSON.stringify(expected.body))return false;used=true;return true}},pvp:{pending:()=>false},actions:{canAct:()=>true},payments:{blocked:()=>false}},
  fetch:async(path,options)=>{calls.push({path,options});return {ok:true,status:200}}};
 vm.createContext(box);vm.runInContext(code+';globalThis.post=gamePost',box);
 return {box,calls,permits,expected,post:(id=expected.id,path=expected.path,body=expected.body)=>box.post(path,body,1000,id)};
}
for(const path of ['/game/mammon/merchant/buy','/game/drops-shop/buy','/game/mammon/teleport'])test('exact one-use LS supply permission reaches '+path+' once',async()=>{
 const f=fixture();f.expected.path=path;assert.equal((await f.post()).ok,true);assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.method,'POST');assert.equal(f.calls[0].options.credentials,'include');
 await assert.rejects(()=>f.post(),/lifestone_session_active/);assert.equal(f.calls.length,1);
});
for(const part of ['id','path','qty','itemKey','revision'])test('mismatching supply '+part+' cannot reach network',async()=>{
 const f=fixture(),body={...f.expected.body};let id=f.expected.id,path=f.expected.path;
 if(part==='id')id='other';if(part==='path')path='/game/drops-shop/buy';if(part==='qty')body.qty=2;if(part==='itemKey')body.itemKey='a';if(part==='revision')body.expectedRevision=11;
 await assert.rejects(()=>f.post(id,path,body),/lifestone_session_active/);assert.equal(f.calls.length,0);
});
for(const guard of ['Stop','owner','action','PvP','payment'])test('valid supply permit does not override '+guard+' guard',async()=>{
 const f=fixture();if(guard==='Stop')f.box.on=false;if(guard==='owner')f.box.tabOwner=false;if(guard==='action')f.box.L2V7Modules.actions.canAct=()=>false;if(guard==='PvP')f.box.L2V7Modules.pvp.pending=()=>true;if(guard==='payment')f.box.L2V7Modules.payments.blocked=()=>true;
 await assert.rejects(()=>f.post(),/bot_inactive|action_cancelled|pvp_defeat_pending|payment_unconfirmed/);assert.equal(f.calls.length,0);
});
test('legacy install permit remains independent and does not open supply path',async()=>{
 const f=fixture();f.box.L2V7Modules.lifestone.consumePermit=(id,body)=>id==='install:1'&&body.operation==='install';
 assert.equal((await f.post('install:1','/character/weapon-augmentation',{operation:'install',expectedRevision:10})).ok,true);assert.equal(f.permits.length,0);
 await assert.rejects(()=>f.post('install:1'),/lifestone_session_active/);assert.equal(f.calls.length,1);
});
test('active LS without supply API never permits shop request',async()=>{
 const f=fixture();delete f.box.L2V7Modules.lifestone.consumeSupplyPermit;await assert.rejects(()=>f.post(),/lifestone_session_active/);assert.equal(f.calls.length,0);
});
test('LS-free normal POST still follows original dispatch',async()=>{const f=fixture();f.box.rt.autoLs=null;assert.equal((await f.post()).ok,true);assert.equal(f.permits.length,0);assert.equal(f.calls.length,1);});
