'use strict';
// 10.0.14: повторный вход на страницу/отмена настройки не разрешают повторные платные клики.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const read=m=>fs.readFileSync(path.join(__dirname,'../modules/'+m+'.js'),'utf8');
function faFixture({ids=[1059,1085],H={},interrupt=false,pauseChange=null}={}) {
 const state={balance:10,bought:[],H},rt={tbuff:{step:'fa',fa:ids,t:Date.now()}},cfg={faBuffs:ids.join(',')};
 function create(crash=false){
  const buttons=ids.map(id=>({dataset:{skillId:String(id),cost:'1'},disabled:false,closest:()=>({querySelector:()=>({textContent:'Buff '+id})})}));
  const hud={querySelectorAll:()=>Object.entries(state.H).map(([id,exp])=>({dataset:{skillId:id,expiresAt:String(exp)},getAttribute:()=> 'Buff · Lv.3'}))};
  const query=s=>s==='#l2-hud-active-buffs'?hud:s==='#fast-aden-balance'?{textContent:String(state.balance)}:s==='.l2-fa-buy[data-skill-id]'?buttons[0]:buttons.find(b=>s===`.l2-fa-buy[data-skill-id="${b.dataset.skillId}"]`)||null;
  const box={document:{querySelectorAll:s=>s==='.l2-fa-buy[data-skill-id]'?buttons:[]},location:{pathname:'/fast-aden-buffer.html'}};vm.runInNewContext(read('buffs'),box);
  const env={rt,cfg,on:true,$q:query,TB_KEYS:{basic:[]},IL:{},FA_KNOWN:{1059:['Empower',1],1085:['Acumen',1]},faCost:()=>1,waitX:async f=>f(),pause:async()=>{pauseChange?.(env)},rnd:a=>a,sleep:async()=>{if(crash&&state.bought.length===1)throw Error('reload');},setStatus(){},rec(){},autonomyMode:()=> 'hunt',setRt:async p=>Object.assign(rt,p),fire:b=>{const id=+b.dataset.skillId;state.bought.push(id);state.balance--;state.H[id]=Date.now()+3*3600000;return true;}};
  return {M:box.L2V7Factories.buffs(env),env};
 }
 return {state,rt,cfg,create,first:create(interrupt)};
}
function tvtFixture(change) {
 const bought=[],msg={textContent:''},btn={disabled:false},it={id:920043,n:'Vesper Singer',price:200,lvl:70};
 const row={querySelector:s=>s==='.l2-tvt-shop-row__name'?{textContent:it.n}:s==='.l2-tvt-shop-row__buy'?btn:s==='.l2-tvt-shop-row__price'?{textContent:'200'}:null,closest:()=>null};
 const box={location:{pathname:'/tvt-shop.html'},document:{querySelectorAll:()=>[row]}};vm.runInNewContext(read('tvtshop'),box);
 const env={cfg:{tsBuy:true,tsGoalItem:it.id},rt:{tsJob:{kind:'buy',it,t:Date.now()}},isBattle:()=>false,$q:s=>s==='#tvt-shop-shil-balance'?{textContent:'200'}:s==='#tvt-shop-msg'?msg:null,waitX:async f=>f(),shown:()=>true,pause:async()=>change?.(env),sleep:async()=>{},rec(){},setStatus(){},fishNow:()=>false,setRt:async p=>Object.assign(env.rt,p),fire:b=>{assert.equal(b,btn);bought.push(it.id);msg.textContent='Придбано: Vesper Singer';}};
 // 15.10: подтверждение покупки — fresh inventory, не надпись страницы; реальная защита платежа.
 env.rt.char='Hero'; env.rtCommit=async()=>true; env.setRt=async p=>{Object.assign(env.rt,p);return {ok:true}};
 vm.runInNewContext(read('payments'),box);env.payments=box.L2V7Factories.payments(env);
 env.gameGet=async url=>({ok:true,json:async()=>url==='/character'?{character:{id:'hero',name:'Hero',revision:bought.length?2:1,inventory:{stacks:[{itemId:920030,qty:bought.length?0:200},...(bought.length?[{itemId:it.id,qty:1}]:[])],eq:{}}}}:{categories:[{key:'weapon',items:[{itemId:it.id,nameRu:it.n,priceShil:200}]}]}});
 const fire=env.fire;env.fire=b=>{assert.ok(env.payments.consumePermit());fire(b);return true};
 return {M:box.L2V7Factories.tvtshop(env),env,bought};
}
const cases=[];const test=(n,f)=>cases.push([n,f]);
test('reload между FA-покупками не покупает первый бафф второй раз',async()=>{const f=faFixture({interrupt:true});await assert.rejects(f.first.M.townBuffStep(),/reload/);await f.create().M.townBuffStep();assert.deepEqual(f.state.bought,[1059,1085]);assert.equal(f.state.balance,8);});
test('старое задание FA с уже активным баффом не списывает валюту',async()=>{const f=faFixture({ids:[1059],H:{1059:Date.now()+3600000}});await f.first.M.townBuffStep();assert.deepEqual(f.state.bought,[]);});
test('FA-список выключен во время паузы — не покупать',async()=>{const f=faFixture({ids:[1059],pauseChange:e=>{e.cfg.faBuffs=''}});await f.first.M.townBuffStep();assert.deepEqual(f.state.bought,[]);});
test('свежий отсутствующий выбранный FA-бафф покупается один раз',async()=>{const f=faFixture({ids:[1059]});await f.first.M.townBuffStep();assert.deepEqual(f.state.bought,[1059]);assert.equal(f.rt.tbuff,null);});
test('переход страницы сохраняет разрешённый бафф перед выбранным РБ',async()=>{const f=faFixture({ids:[1059]});Object.assign(f.cfg,{faBuffs:'',townBuffSet:'off',rbHuntMode:true,rbFaFull:true,rbSessBuffs:'1059'});f.rt.tbuff=null;f.rt.rbHunt={step:'pick'};assert.equal(await f.first.M.townBuffStart('перед РБ Test Boss',true),true);await f.create().M.townBuffStep();assert.deepEqual(f.state.bought,[1059]);});
test('выключенный tsBuy отменяет сохранённую покупку Shil',async()=>{const f=tvtFixture();f.env.cfg.tsBuy=false;await f.M.shopStep();assert.deepEqual(f.bought,[]);assert.equal(f.env.rt.tsJob,null);});
test('выключение tsBuy на паузе до покупки сохраняет Shil',async()=>{const f=tvtFixture(e=>{e.cfg.tsBuy=false});await f.M.shopStep();assert.deepEqual(f.bought,[]);});
test('смена TvT-цели не покупает старую вещь',async()=>{const f=tvtFixture(e=>{e.cfg.tsGoalItem=920033});await f.M.shopStep();assert.deepEqual(f.bought,[]);});
test('сохранённая разрешённая TvT-покупка завершается',async()=>{const f=tvtFixture();await f.M.shopStep();assert.deepEqual(f.bought,[920043]);assert.equal(f.env.rt.tsLog[0].ok,true);});
test('повторный ответ каталога освежает истёкшую живую цену и имя',()=>{const f=tvtFixture(),data={categories:[{key:'weapon',items:[{itemId:920043,nameRu:'Живое имя',priceShil:201,requiredLevel:70}]}]};f.M.shopNote(data);f.env.rt.tsCat.t=Date.now()-8*86400000;f.M.shopNote(data);assert.equal(f.M.itemOf(920043).n,'Живое имя');assert.equal(f.M.itemOf(920043).price,201);});
test('14.10: удалённая GM-наживка не попадает в закупку даже из старой настройки',()=>{
 const box={document:{querySelectorAll:()=>[]}};vm.runInNewContext(read('economy'),box);
 const cfg={shopBait:'10/100',fishBait:'good',fishBuyPacks:37,shopHp:'0/0',shopMp:'0/0',shopShots:'0/0',shopSpirit:'0/0',shopSoul:'0/0'},before=JSON.stringify(cfg);
 const env={cfg,rt:{},pair:s=>String(s).split('/').map(Number),heroLevel:()=>1,SHOT_IDS:{NG:17},BSPS_IDS:{NG:3947},classWeaponTypes:()=>({types:[]}),rec(){},setRt:async p=>Object.assign(env.rt,p)};
 const plan=box.L2V7Factories.economy(env).shopPlan();assert.equal(plan.some(x=>x.key==='bait'||x.ids.includes(6519)),false);assert.equal(JSON.stringify(cfg),before,'рыболовные предпочтения и бюджеты не переписываются');
});
(async()=>{let bad=0;for(const[n,f]of cases)try{await f();console.log('PASS:',n)}catch(e){bad++;console.error('FAIL:',n,e.message)}if(bad)process.exitCode=1})();
