'use strict';
// Независимая локальная модель подтверждённых контрактов20.10; никаких запросов к живой игре.
const assert=require('node:assert/strict');
const clone=x=>JSON.parse(JSON.stringify(x));
module.exports=function supplyServer(options={}){
 const cfg={lsPrice:160000,gemPrice:100000,tpPrice:0,aa:3000000,adena:5000000,ls:0,gem:0,near:false,outcomes:['matk_6'],...options};
 const npc={id:'audit-merchant',worldX:50000,worldY:50000},events=[];
 const character={name:'AuditHero',revision:100,level:78,adena:cfg.adena,worldX:cfg.near?npc.worldX:0,worldY:cfg.near?npc.worldY:0,fastAden:11,inBattle:false,
  inventory:{eq:{l1:{itemId:9002284,enchant:25,instanceId:'audit-caster'}},stacks:[{itemId:5575,qty:cfg.aa},{itemId:4037,qty:7},{itemId:920048,qty:11},{itemId:10412,qty:cfg.ls},{itemId:2134,qty:cfg.gem}]}};
 const qty=id=>character.inventory.stacks.filter(x=>x.itemId===id).reduce((n,x)=>n+x.qty,0);
 const put=(id,n)=>{assert.ok(Number.isSafeInteger(n)&&n>=0);const row=character.inventory.stacks.find(x=>x.itemId===id);if(row)row.qty=n;else character.inventory.stacks.push({itemId:id,qty:n});};
 const lsShop=()=>({categories:[{categoryId:'life_stones',items:[{categoryId:'life_stones',itemKey:'s',itemId:10412,aaPrice:cfg.lsPrice,priceCoinOfLuck:null,priceFastAden:null}]}]});
 const gmShop=()=>({grades:[{grade:'S',sections:[{category:'consumable',items:[
  {category:'consumable',grade:'S',consumableSubtype:'resources',itemId:2134,shopKey:'craft_test/resource_gemstone_s',purchasable:true,minPurchaseQty:500,priceAdena:0,priceCoinOfLuck:null},
  {category:'consumable',grade:'S',consumableSubtype:'resources',itemId:2134,shopKey:'consumable/resource_gemstone_s',purchasable:true,minPurchaseQty:1,priceAdena:cfg.gemPrice,priceCoinOfLuck:null,priceFastAden:null}
 ]}]}]});
 const merchant=()=>({mammonMerchant:{current:clone(npc)},teleport:{adenaCost:cfg.tpPrice,vipFreeApplied:cfg.tpPrice===0}});
 const counts={travel:0,ls:0,gem:0,augmentation:0};
 const response=(json,status=200)=>({status,json:clone(json)});
 function handle(path,method,body){
  const event={path,method,...(body?{body:clone(body)}:{})};events.push(event);
  if(method==='GET'){
   if(path==='/character')return response({character});
   if(path==='/game/mammon/merchant/shop')return response(lsShop());
   if(path==='/game/mammon/merchant')return response(merchant());
   if(path==='/game/drops-shop')return response(gmShop());
   return null;
  }
  assert.equal(method,'POST');assert.ok(['/game/mammon/teleport','/game/mammon/merchant/buy','/game/drops-shop/buy','/character/weapon-augmentation'].includes(path),'неожиданная мутация '+path);
  if(body?.expectedRevision!==character.revision){event.rejected='revision';return response({error:'revision_conflict'},409);}
  if(path==='/game/mammon/teleport'){
   assert.deepEqual(Object.keys(body).sort(),['expectedAdenaCost','expectedRevision','kind']);assert.equal(body.kind,'merchant');assert.equal(body.expectedAdenaCost,cfg.tpPrice);
   if(character.adena<cfg.tpPrice)return response({error:'not_enough_adena'},400);
   character.adena-=cfg.tpPrice;character.worldX=npc.worldX;character.worldY=npc.worldY;character.revision++;counts.travel++;return response({character});
  }
  if(path==='/game/mammon/merchant/buy'){
   assert.deepEqual(Object.keys(body).sort(),['category','expectedRevision','itemKey','qty']);assert.equal(body.category,'life_stones');assert.equal(body.itemKey,'s');assert.ok(Number.isSafeInteger(body.qty)&&body.qty>0&&body.qty<=9999);
   if(Math.hypot(character.worldX-npc.worldX,character.worldY-npc.worldY)>10800)return response({error:'mammon_merchant_not_nearby'},400);
   if(qty(5575)<cfg.lsPrice*body.qty)return response({error:'not_enough_ancient_adena'},400);
   put(5575,qty(5575)-cfg.lsPrice*body.qty);put(10412,qty(10412)+body.qty);character.revision++;counts.ls+=body.qty;return response({character});
  }
  if(path==='/game/drops-shop/buy'){
   assert.deepEqual(Object.keys(body).sort(),['expectedRevision','qty','shopKey']);assert.equal(body.shopKey,'consumable/resource_gemstone_s','обычный магазин, тестовый дубль запрещён');assert.ok(Number.isSafeInteger(body.qty)&&body.qty>0&&body.qty<=9999);
   if(character.adena<cfg.gemPrice*body.qty)return response({error:'not_enough_adena'},400);
   character.adena-=cfg.gemPrice*body.qty;put(2134,qty(2134)+body.qty);character.revision++;counts.gem+=body.qty;return response({character});
  }
  assert.deepEqual(Object.keys(body).sort(),['expectedRevision','operation']);assert.equal(body.operation,'install');assert.equal(character.inventory.eq.l1.itemId,9002284);
  if(qty(10412)<1||qty(2134)<1)return response({error:'not_enough_augmentation_materials'},400);
  put(10412,qty(10412)-1);put(2134,qty(2134)-1);character.revision++;counts.augmentation++;
  const outcomeId=cfg.outcomes[Math.min(counts.augmentation-1,cfg.outcomes.length-1)];character.inventory.eq.l1.augmentation={uid:'audit-augmentation-'+counts.augmentation,grade:'S',outcomeId};
  return response({character,outcomeId,gemstonesSpent:1});
 }
 if(options.existingGoal)character.inventory.eq.l1.augmentation={uid:'audit-existing-ls',grade:'S',outcomeId:'matk_6'};
 return {handle,character,qty,put,counts,events,config:cfg,snapshot:()=>clone(character),merchant};
};
