'use strict';
// 10.0.14: отмена платного действия по настройке между асинхронными шагами; ручная команда сохраняет свой смысл.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../modules/mammon.js'),'utf8');
function upgradeFixture(change,cmd=false){
 const item={itemId:920018,nameUk:'Пояс',level:0,canAfford:true,targetInstanceId:'eq:belt',locationLabelUk:'Одягнено',cost:{adena:250000,coinOfLuck:1,materials:[]}},btn={textContent:'Покращити до Lv.1'};
 const fields={'.l2-mammon-upgrade-card__name':{textContent:'Пояс'},'.l2-mammon-upgrade-card__level':{textContent:'Lv.0'},'.l2-mammon-upgrade-card__meta':{textContent:'D-grade · Пояс · Одягнено'},'.l2-mammon-upgrade-card__btn':btn},card={querySelector:s=>fields[s]||null},clicks=[];
 const box={location:{pathname:'/mammon-blacksmith.html'},document:{documentElement:{dataset:{}},querySelectorAll:()=>[card]},sessionStorage:{getItem:()=>null,setItem(){}}};vm.runInNewContext(source,box);
 const env={rt:{},cfg:{mmGoalItem:920018,mmGoalLvl:1,mmUpgrade:!cmd},setRt:async p=>Object.assign(env.rt,p),rec(){},setStatus(){},fishNow:()=>false,sleep:async()=>{},waitX:async f=>{const v=f();if(v===card)change?.(env);return v},$q:()=>null,fire:b=>clicks.push(b),gameGet:async()=>({ok:true,json:async()=>({items:[item]})})};
 return {M:box.L2V7Factories.mammon(env),env,item,clicks,job:{kind:'smith',up:true,cmd,t:Date.now()}};
}
function transferFixture({disabled=false,disableAtModal=false,cmd=false}={}){
 const input=()=>({value:'',dispatchEvent(){}}),q=input(),nick=input(),submit={},ok={},cancel={},body={textContent:'Надіслати «Iron Ore» гравцю «Skye»? Кількість: 15 Комісія: 8 аден'},success={hidden:true,textContent:''},error={hidden:true,textContent:''},clicks=[];
 const form={querySelector:s=>s==='input[type="number"]'?q:s==='input[type="text"]'?nick:s==='button[type="submit"]'?submit:null};
 const wrap={dataset:{itemKey:'stk:1869'},querySelector:s=>/form/.test(s)?form:null};
 const modal={hidden:true,querySelector:s=>s==='#item-transfer-confirm-body'?body:s.includes(':not(')?ok:cancel};
 const doc={querySelector:()=>wrap,querySelectorAll:()=>[wrap],getElementById:id=>({'item-transfer-confirm-modal':modal,'item-transfer-success':success,'item-transfer-err':error}[id]||null)};
 const box={document:doc,location:{pathname:'/item-transfer.html'},Event:class{},sessionStorage:{getItem:()=>null,setItem(){}}};vm.runInNewContext(source,box);
 const job={kind:'send',cmd,to:'Skye',items:[[1869,15,'Iron Ore']],ret:{1880:3},t:Date.now()},env={rt:{mmJob:job},cfg:{mmCraftSend:!disabled},invQty:()=>115,invRefresh:async()=>({1869:115}),ITEMS:{},setRt:async p=>Object.assign(env.rt,p),rec(){},setStatus(){},fishNow:()=>false,sleep:async()=>{},waitX:async f=>{const v=f();if(v===modal&&disableAtModal)env.cfg.mmCraftSend=false;return v},fire:b=>{clicks.push(b);if(b===submit)modal.hidden=false;if(b===ok){modal.hidden=true;success.hidden=false;success.textContent='Предмет надіслано.'}},gameGet:async()=>({ok:true,json:async()=>({candidates:[{itemId:1869,itemKey:'stk:1869',stackable:true,availableQty:115,transferValueUnitAdena:10}],totalPages:1})})};
 return {M:box.L2V7Factories.mammon(env),env,job,clicks,ok};
}
const cases=[];const test=(n,f)=>cases.push([n,f]);
test('выключение автоповышения при ожидании карточки сохраняет CoL',async()=>{const f=upgradeFixture(e=>{e.cfg.mmUpgrade=false});await f.M.upgrade(f.job,[f.item]);assert.equal(f.clicks.length,0);});
test('смена вещи-цели при ожидании карточки не повышает старую вещь',async()=>{const f=upgradeFixture(e=>{e.cfg.mmGoalItem=920019});await f.M.upgrade(f.job,[f.item]);assert.equal(f.clicks.length,0);});
test('явная команда повысить сейчас работает при выключенном авто',async()=>{const f=upgradeFixture(null,true);await f.M.upgrade(f.job,[f.item]);assert.equal(f.clicks.length,1);});
test('выключенная автоотправка не продолжает сохранённую партию',async()=>{const f=transferFixture({disabled:true});await f.M.sendStep(f.job);assert.equal(f.clicks.includes(f.ok),false);});
test('отключение автоотправки перед подтверждением сохраняет сырьё',async()=>{const f=transferFixture({disableAtModal:true});await f.M.sendStep(f.job);assert.equal(f.clicks.includes(f.ok),false);});
test('явная отправка сейчас работает при выключенном авто',async()=>{const f=transferFixture({disabled:true,cmd:true});await f.M.sendStep(f.job);assert.equal(f.clicks.includes(f.ok),true);assert.equal(f.env.rt.mmCraft.at[1869],15);});
(async()=>{let bad=0;for(const[n,f]of cases)try{await f();console.log('PASS:',n)}catch(e){bad++;console.error('FAIL:',n,e.message)}if(bad)process.exitCode=1})();
