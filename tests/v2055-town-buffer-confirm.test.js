'use strict';
// 20.55 (лог 24.10 03:06/03:16, «тупит на баффе»): у городского баффера игра теперь спрашивает «Підтвердити отримання бафа?» —
// кнопка набора лишь открывает окно, бафф накладывается по «Підтвердити» (#town-buffer-confirm-accept).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
function fixture(fee){
 const b={console,Date,document:{querySelectorAll:()=>[]},location:{pathname:'/town-buffer.html',search:'',href:''}};vm.runInNewContext(read('modules/buffs.js'),b);
 let rt={char:'HeroA',tbuff:{step:'town',set:'basic',fa:[],t:Date.now()},vipBuff:{char:'HeroA',actor:'a',active:false,until:null,set:'',prof:'',slot:null,t:Date.now()}};
 const fires=[],recs=[],ov={hidden:true},D={result:''};
 const el={'#town-buffer-sets .l2-town-buffer-set-apply[data-set-id="basic"]':{id:'apply'},'#town-buffer-confirm-overlay':ov,
  '#town-buffer-confirm-fee':{textContent:fee},'#town-buffer-confirm-accept':{id:'accept',disabled:false},'#town-buffer-confirm-cancel':{id:'cancel'},
  get '#town-buffer-result-title'(){return {textContent:D.result}}};
 const env={get rt(){return rt},cfg:{townBuffSet:'basic'},on:true,tabOwner:true,TB_KEYS:{basic:[]},FA_KNOWN:{},IL:{},DEAD_RE:/без свідомості/,
  setStatus(){},rec:(...a)=>recs.push(a.join(' ')),setRt:async p=>{rt={...rt,...p};return {ok:true}},$q:s=>el[s]||null,
  sleep:async()=>{},pause:async()=>{},waitX:async f=>f(),autonomyMode:()=>'farm',routeLocation:b.location,
  fire:x=>{fires.push(x.id);if(x.id==='apply')ov.hidden=false;if(x.id==='accept'){ov.hidden=true;D.result='Баф накладено';}if(x.id==='cancel')ov.hidden=true;return true;}};
 return {env,fires,recs,get rt(){return rt},B:b.L2V7Factories.buffs(env)};
}
test('бесплатный «basic»: окно подтверждения → «Підтвердити» → наложен, без круга воскрешения',async()=>{
 const f=fixture('Безкоштовно');await f.B.townBuffStep();
 assert.deepEqual(f.fires.slice(0,2),['apply','accept']);assert.equal(f.rt.revive,undefined);assert.equal(f.rt.tbOk,true);
 assert.ok(f.recs.some(r=>/«basic» — наложен/.test(r)));
});
test('«basic» с неожиданной ценой в окне — отмена, не подтверждаем',async()=>{
 const f=fixture('15 Coin of Luck');await f.B.townBuffStep();
 assert.ok(!f.fires.includes('accept'));assert.ok(f.fires.includes('cancel'));assert.ok(f.recs.some(r=>/не подтверждаю/.test(r)));
});
