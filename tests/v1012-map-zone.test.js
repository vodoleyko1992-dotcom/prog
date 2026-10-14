'use strict';
// Снимки 14.10: новая панель на страницах 11/26, подпись списка p10/p25. Дальние страницы не являются первой.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const sandbox = {console,Date,Math,JSON};sandbox.globalThis=sandbox;
vm.createContext(sandbox);
for(const name of ['mobfarm','navigation'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../modules/'+name+'.js'),'utf8'),sandbox);
function fixture(page,zone='near') {
  const rt={zone,zoneMobs:{near:['A','B','C'],far:['D','E','F']},zoneCat:{near:{name:'Ближняя',lo:40,hi:45},far:{name:'Дальняя',lo:70,hi:80}},
    spawns:{a:['A',40],b:['B',42],c:['C',45],d:['D',74],e:['E',75],f:['F',76]},zoneStat:{}};
  let writes=0;
  const env={rt,heroLvl:()=>74,isRaidId:()=>false,PAGE_SIZE:15,
    $q:sel=>sel==='#map-mob-list'?{dataset:{l2AroundSig:'400|d:1,e:2,f:3|p'+(page-1)+'|lv74|qnone'}}:
      sel==='#map-mob-page-ind'?{textContent:page<6?'12345>>':'<<1112131415>>'}:null,
    pageItems:()=>['D','E','F'].map((name,i)=>({id:name,name,lvl:74+i,champ:false})),
    rec:()=>{},setRt:patch=>{writes++;Object.assign(rt,patch);}};
  const farm=sandbox.L2V7Factories.mobfarm(env);env.pagerInfo=()=>farm.pagerInfo();
  return {rt,env,nav:sandbox.L2V7Factories.navigation(env),writes:()=>writes};
}
for(const page of [2,11,26]) {
  const f=fixture(page);f.nav.zoneHere();
  assert.equal(f.rt.zone,'near','страница '+page+' не меняет локацию по дальним мобам');
  assert.deepEqual(f.rt.zoneMobs.near,['A','B','C'],'чужие уровни не попадают в память ближней зоны');
  assert.equal(f.writes(),0);
  const unset=fixture(page,null);unset.nav.zoneHere();assert.equal(unset.rt.zone,null);assert.equal(unset.writes(),0);
}
const first=fixture(1);first.nav.zoneHere();assert.equal(first.rt.zone,'far','на первой странице локация по мобам распознаётся');
const unknown=fixture(11);unknown.env.pagerInfo=()=>null;unknown.nav.zoneHere();assert.equal(unknown.rt.zone,'near','неизвестная пагинация не считается первой страницей');
console.log('PASS: zone detection — new pagination keeps far pages from changing the zone or polluting its mob list');
