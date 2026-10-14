'use strict';
const fs=require('node:fs'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');
const SOURCE=process.env.ECONOMY_SOURCE||__dirname+'/../modules/economy.js';
function fixture(){
 let money=100000,modalOpen=false;const calls=[],name='Благословенний заряд духу',buy={buy:1},confirm={confirm:1},input={focus(){}},price={textContent:'50 Adena',className:'l2-gm-shop-price--adena'};
 const row={className:'l2-gm-shop-row--grade-a',querySelector:s=>s==='.l2-gm-shop-name'?{textContent:name}:s==='.l2-gm-shop-price'?price:s==='.l2-gm-shop-buy'?buy:null};
 const modal={querySelector:s=>s==='[data-buy-qty-confirm]'?confirm:s.includes('input')?input:null},tab={getAttribute:()=> 'true',classList:{contains:()=>true}};
 const box={console,Date,URLSearchParams,location:{pathname:'/gm-shop.html',search:'?grade=A'},document:{querySelectorAll:s=>s==='.l2-gm-shop-row'?[row]:s==='.l2-gm-shop-name'?[{textContent:name}]:[]}};
 vm.runInNewContext(fs.readFileSync(SOURCE,'utf8'),box);
 const env={on:true,rt:{char:'fixture',weaponsT:1,weapons:[{id:8688,g:'A',weaponMode:'magic',name:'Daimon',where:'надето',pa:245,ma:215}]},cfg:{shopAuto:true,shopHp:'0/0',shopMp:'0/0',shopSpirit:'0/0',shopSoul:'0/0',shopShots:'1000/5000',shopReserve:0,shopMaxSpend:1e6},
 BSPS_IDS:{NG:3947,D:3948,C:3949,B:3950,A:3951,S:3952},SHOT_IDS:{NG:1835,A:1466,S:1467},pair:(x,d)=>String(x||d).split('/').map(Number),heroLevel:()=>76,combatProfileKind:()=> 'mage_summoner',classWeaponTypes:()=>({types:[]}),slotsBy:()=>[],shotSlot:()=>({title:'A',qty:0}),qty:()=>0,invQty:id=>id===3951?0:null,
 $q:s=>s==='.l2-gm-shop-adena__amount'?{textContent:String(money)}:s==='.l2-gm-shop-row'?row:s==='#l2-drops-shop-buy-qty-modal'?modalOpen?modal:null:s.startsWith('[data-')?tab:null,shown:x=>!!x,waitX:async f=>f(),sleep:async()=>{},rnd:a=>a,setVal(){},setRt:async p=>Object.assign(env.rt,p),rec(){},setStatus(){},autonomyMode:()=> 'farm',fire:b=>{calls.push(b);if(b===buy)modalOpen=true;if(b===confirm){money-=500;modalOpen=false}return true}};
 return {env,M:box.L2V7Factories.economy(env),calls,buy,confirm};
}
const descriptor={key:'shots',grade:'A',name:/Благословенн\S* заряд дух/i,label:'Благосл. заряды духа A'};
test('pending or failed metadata excludes shots from purchase plan and panel demand',()=>{for(const status of ['pending','unknown']){const f=fixture();f.env.rt.weaponMetaPending={status,id:9002284};assert.equal(f.M.shotGrade().blocked,true);assert.ok(!f.M.shopPlan().some(x=>x.key==='shots'));assert.equal(f.M.shopNeedByPanel(),'')}});
test('pending metadata refuses an already prepared A purchase',async()=>{const f=fixture();f.env.rt.weaponMetaPending={id:9002284};assert.equal((await f.M.shopBuyOne(descriptor,10)).ok,false);assert.equal(f.calls.length,0)});
test('weapon change while confirmation sleeps prevents A purchase',async()=>{const f=fixture();f.env.sleep=async()=>{if(f.calls.includes(f.buy))f.env.rt.weaponMetaPending={id:9002284}};assert.equal((await f.M.shopBuyOne(descriptor,10)).ok,false);assert.equal(f.calls.filter(x=>x===f.confirm).length,0)});
test('known S replaces A during confirmation without buying old A',async()=>{const f=fixture();f.env.sleep=async()=>{if(f.calls.includes(f.buy))f.env.rt.weapons[0].g='S'};assert.equal((await f.M.shopBuyOne(descriptor,10)).ok,false);assert.equal(f.calls.filter(x=>x===f.confirm).length,0)});
test('ordinary known A still purchases A and reports actual debit',async()=>{const f=fixture();const r=await f.M.shopBuyOne(descriptor,10);assert.equal(r.ok,true);assert.equal(r.spent,500);assert.equal(f.calls.filter(x=>x===f.confirm).length,1);assert.equal(f.M.shopPlan().find(x=>x.key==='shots').ids[0],3951)});
test('pending or changed grade cancels old purchase job instead of reusing its quantity',async()=>{for(const status of ['pending','S']){const f=fixture();f.env.rt.shop={step:'buy',need:[{key:'shots',grade:'A',label:'A',buy:5000}]};if(status==='pending')f.env.rt.weaponMetaPending={id:9002284};else f.env.rt.weapons[0].g='S';await f.M.shopStep();assert.equal(f.calls.filter(x=>x===f.buy).length,0);assert.match(f.env.rt.shopLast.text,/оружие изменилось/)}});
