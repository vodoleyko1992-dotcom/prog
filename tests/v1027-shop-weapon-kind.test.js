'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(change){let balance=10000000,buys=0;const name={textContent:'Blessed Spiritshot'},buy={dataset:{shopKey:'consumable/blessed_spiritshot_s'}},confirm={},input={value:'0',focus(){}},price={textContent:'560 Adena',className:'l2-gm-shop-price--adena',querySelectorAll:()=>[]};
 const row={className:'l2-gm-shop-row--grade-s',querySelector:s=>s==='.l2-gm-shop-name'?name:s==='.l2-gm-shop-price'?price:s==='.l2-gm-shop-buy'?buy:null};
 const modal={querySelector:s=>s.includes('input')?input:s.includes('confirm')?confirm:null},tab={getAttribute:()=> 'true',classList:{contains:()=>true}};
 const env={rt:{char:'Hero',weaponsT:1,weapons:[{id:900,g:'S',weaponMode:'magic',where:'надето',name:'Caster'}]},cfg:{shopMaxSpend:2000000,shopReserve:200000},pair:()=>[0,0],BSPS_IDS:{S:3952},SHOT_IDS:{S:1467},classWeaponTypes:()=>({types:[]}),MAGE:'magic',on:true,
 $q:s=>s.includes('data-grade')||s.includes('data-consumablesub')?tab:s==='.l2-gm-shop-adena__amount'?{textContent:String(balance)}:s==='#l2-drops-shop-buy-qty-modal'?modal:null,
 waitX:async f=>f(),sleep:async()=>{},rnd:()=>0,shown:x=>!!x,setVal:(i,v)=>{i.value=v;change?.(env)},setRt:async p=>Object.assign(env.rt,p),rec(){},invQty:()=>0,fire:b=>{if(b===confirm){buys++;balance-=560*+input.value;}return true}};
 const box={document:{querySelectorAll:s=>s==='.l2-gm-shop-name'?[name]:s==='.l2-gm-shop-row'?[row]:[]},location:{pathname:'/gm-shop.html',search:'?grade=S'},URLSearchParams};vm.runInNewContext(fs.readFileSync(__dirname+'/../modules/economy.js','utf8'),box);
 return {env,M:box.L2V7Factories.economy(env),buys:()=>buys,it:{key:'shots',label:'Благосл. заряды духа S',grade:'S',ids:[3952],name:/Blessed Spiritshot/}};
}
test('same S grade magic→physical while modal opens does not buy old spiritshots',async()=>{const f=fixture(e=>e.rt.weapons[0].weaponMode='phys');const r=await f.M.shopBuyOne(f.it,1000);assert.equal(f.buys(),0);assert.equal(r.ok,false);assert.match(r.why,/оружие/)});
test('same kind and grade still buys intended spiritshots',async()=>{const f=fixture();const r=await f.M.shopBuyOne(f.it,1000);assert.equal(f.buys(),1);assert.equal(r.ok,true);});
