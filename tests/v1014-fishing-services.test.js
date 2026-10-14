'use strict';
// 10.0.14: отказы мутаций и Stop не завершают обслуживание улова.
const assert=require('node:assert/strict');const {world}=require('./v1014-fishing-controls.test.js');
function rod(o={}){
 const W=world({rt:{fishRodForce:'Выберите удочку'}});W.selected=o.selected===true?10:o.selected===0?0:null;W.overlay={hidden:false};W.env.shown=x=>!!x&&!x.hidden;
 const rows=[10,0].map(level=>({textContent:'Fishing Rod'+(level?' +'+level:'')+' Шанс Old Box: '+level+'% '+(W.selected===level?'Выбрано':'Выбрать'),querySelector:()=>({textContent:'Fishing Rod'+(level?' +'+level:'')}),querySelectorAll:()=>[{level,disabled:W.selected===level,textContent:W.selected===level?'Выбрано':'Выбрать'}],nodeType:1}));
 const base=W.env.$q;W.env.$q=s=>s==='.l2-fishing-gear-item--rod'?{cloneNode:()=>({textContent:W.selected==null?'Удочка не выбрана':'Вудка +'+W.selected,querySelectorAll:()=>[]})}:s==='#fishing-rod-select-list'?{children:rows}:s.includes('rod-select-overlay')?W.overlay:s.includes('open-rod-select')||s.includes('rod-select-close')?{}:base(s);
 W.env.fire=b=>{if(b?.level!=null){W.clicks.push(b);if(!o.reject){W.selected=b.level;W.overlay.hidden=true;}}};return W;
}
function cut(o={}){
 const W=world({rt:{fishSinceProc:7,fishSinceProcN:7,fishService:'cut'},cfg:{fishOpenBoxes:true}});let opened=false,result='';
 const j={itemId:910603,qty:7},row={dataset:{itemJson:JSON.stringify(j)},querySelector:s=>s==='.l2-char-bag-name'?{textContent:o.box?'Old Box ×7':'White Fish ×7'}:{open:true}};
 W.document.querySelectorAll=s=>s.includes('char-oldbox-open-result')?[{textContent:'Proof of Catching a Fish ×20'},{textContent:'Coin of Luck ×2'}]:s.includes('l2-char-bag-row')?[row]:[];
 W.env.itemJson=()=>j;W.env.MATERIAL_RE=/fish oil/;const base=W.env.$q;
 W.env.$q=s=>s==='button[data-fishing-inventory-tab]'?{getAttribute:()=> 'true'}:s==='#char-bag-modal-cut-row'?opened&&!o.box?{}:null:s==='#char-bag-modal-oldbox-row'?opened&&o.box?{}:null:s==='#char-bag-modal-overlay'?{get textContent(){return result;}}:s==='#char-bag-modal-cut-max'||s==='#char-oldbox-open-max'?{}:s==='#char-bag-modal-cut'||s==='#char-bag-modal-open-oldbox'?{cut:true}:s==='#char-bag-modal-close'?{close:true}:base(s);
 W.env.fire=b=>{if(b?.open)opened=true;if(b?.cut){W.clicks.push(b);if(o.stop)W.env.on=false;if(!o.fail&&!o.stop)result=o.box?'Вы открыли Old Box ×7. Получено: Proof of Catching a Fish ×20.':'Вы разрезали White Fish ×7. Получено: Fish Oil ×25.';}if(b?.close)opened=false;};return W;
}
function exchange(o={}){
 const W=world({cfg:{rodEnchantTo:0,fishGoal:o.goal||''},rt:{fishService:'exchange',fishSinceProcN:7,fishSvc:{stopAfter:true}}});let proof=100,owned=o.empty?0:25,success='';const inp={value:'0'},btn={exchange:true},max={max:true};
 const row={dataset:{exchange:'fish_oil'},querySelector:s=>s==='.l2-fshop-row__owned-qty'?{textContent:String(owned)}:s==='.l2-fshop-row__rate'?{textContent:'25 → Proof 1'}:s==='.l2-fshop-row__name'?{textContent:'Fish Oil'}:s==='.l2-fshop-max-btn'?max:null};
 W.document.querySelectorAll=s=>s.includes('fishing-shop-exchange')?[row]:[];const base=W.env.$q;
 W.env.$q=s=>s==='#fishing-shop-proof-qty'?{textContent:String(proof)}:s==='#fishing-shop-success'?{textContent:success}:s.includes('fishing-shop-tab-')?{classList:{contains:()=>true}}:s.includes('.l2-fshop-exchange-btn')?btn:s.includes('.l2-fshop-qty-input')?inp:s.includes('.l2-fshop-row--exchange')?row:s==='.l2-fshop-buy-gear-btn'?{}:base(s);
 W.box.chrome={storage:{local:{set:async()=>{W.env.on=false;}}}};W.env.fire=b=>{if(b===max)inp.value='1';if(b===btn){W.clicks.push(b);if(o.stop)W.env.on=false;if(!o.fail&&!o.stop){owned=0;proof++;success='Вы обменяли Fish Oil ×25 и получили Proof ×1';}}};return W;
}
let pass=0,fail=0;async function test(n,f){try{await f();pass++;console.log('PASS',n);}catch(e){fail++;console.error('FAIL',n,e.message);}}
(async()=>{
 await test('отказ selectRod не подтверждает снасть',async()=>{const W=rod({reject:true});assert.equal(await W.F.fishRod(),false);assert.equal(W.env.rt.fishRodForce,'Выберите удочку');assert.equal(W.env.rt.fishRodName,undefined);});
 await test('409 перехода с выбранной +0 на +10 не подтверждает новую удочку',async()=>{const W=rod({selected:0,reject:true});assert.equal(await W.F.fishRod(),false);assert.equal(W.selected,0);assert.equal(W.env.rt.fishRodName,undefined);assert.ok(W.env.rt.fishRodForce);});
 await test('принудительный выбор не меняет выбранную +10 на +0',async()=>{const W=rod({selected:true});await W.F.fishRod();assert.equal(W.selected,10);assert.equal(W.clicks.length,0);});
 await test('выбор лучшей доступной удочки подтверждён',async()=>{const W=rod();assert.equal(await W.F.fishRod(),true);assert.equal(W.selected,10);assert.equal(W.env.rt.fishRodName,'Fishing Rod +10');});
 await test('ошибка разделки сохраняет очередь и число рыб',async()=>{const W=cut({fail:true});await W.F.fishCut();assert.equal(W.env.rt.fishService,'cut');assert.equal(W.env.rt.fishSinceProc,7);assert.ok(!W.logs.some(l=>/×7 →/.test(l)));});
 await test('Stop во время разделки сохраняет очередь и число рыб',async()=>{const W=cut({stop:true});await W.F.fishCut();assert.equal(W.env.rt.fishService,'cut');assert.equal(W.env.rt.fishSinceProc,7);});
 await test('подтверждённая разделка переводит в обмен и считает Proof',async()=>{const W=cut();await W.F.fishCut();assert.equal(W.env.rt.fishService,'exchange');assert.equal(W.env.rt.fishSinceProc,0);assert.equal(W.env.rt.fishVal['White Fish'].n,7);});
 await test('прямые Proof из Old Box учитываются в доходе и цели',async()=>{const W=cut({box:true});W.env.rt.fishProof=100;W.env.rt.fishTgt={type:'proof',n:100,got:0};await W.F.fishCut();assert.equal(W.env.rt.fishProofGain,20);assert.equal(W.env.rt.fishProof,120);assert.equal(W.env.rt.fishTgt.got,20);});
 await test('409 обмена сохраняет очередь, улов и не пишет ложный обмен',async()=>{const W=exchange({fail:true});await W.F.fishExchange();assert.equal(W.env.rt.fishService,'exchange');assert.equal(W.env.rt.fishSinceProcN,7);assert.ok(!W.logs.some(l=>/Fish Oil ×25.*Proof/.test(l)));});
 await test('третья ошибка загрузки магазина сохраняет ручную услугу для повтора',async()=>{const W=exchange();W.env.rt.fishShopRetry=2;W.env.$q=()=>null;let wait=0;W.env.idle=async ms=>{wait=ms;};await W.F.fishExchange();assert.equal(W.env.rt.fishService,'exchange');assert.equal(W.env.rt.fishSvc.stopAfter,true);assert.equal(W.env.rt.fishSinceProcN,7);assert.equal(W.env.on,true);assert.equal(wait,30000);assert.ok(!W.logs.some(l=>/готово/.test(l)));});
 await test('успешный обмен учитывает поступившие Proof ровно один раз',async()=>{const W=exchange();await W.F.fishExchange();assert.equal(W.env.rt.fishProofGain,1);assert.equal(W.env.rt.fishProofFish,7);assert.equal(W.env.rt.fishSinceProcN,0);assert.equal(W.env.rt.fishService,null);});
 await test('несуществующая цель магазина не помечается купленной',async()=>{const W=exchange({empty:true,goal:'cloak_missing'});await W.F.fishExchange();assert.deepEqual(Array.from(W.env.rt.fishGearBought||[]),[]);});
 console.log(`${pass} passed / ${fail} failed`);if(fail)process.exitCode=1;
})();
