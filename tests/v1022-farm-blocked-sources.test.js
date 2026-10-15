'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const src=fs.readFileSync(__dirname+'/../content.js','utf8');
const extract=name=>{const m=src.match(new RegExp('function '+name+'\\([^]*?\\n\\}\\n'));assert.ok(m,name);return m[0];};
function fixture(){
 const drop=[['Marsh Stalker',54,7,1,3,'forsaken','Forsaken Plains'],['Fallen Orc',55,7,1,3,'forsaken','Forsaken Plains'],['Marsh Drake',55,7,1,3,'forsaken','Forsaken Plains'],['Other source',54,5,1,1,'other','Other']];
 const box={cfg:{},rt:{hardMobs:{}},Date,Math,FARM:{res:{stone:{drop,sp:[]}}},heroLvl:()=>56,canSpoil:()=>false,spoilK:()=>.8};
 vm.createContext(box);vm.runInContext(src.match(/const hardNow =[^\n]+/)[0]+src.match(/const farmWin =[^\n]+/)[0]+extract('farmFit')+extract('farmZones')+extract('farmPick')+';this.pick=farmPick;this.zones=farmZones;',box);
 return box;
}
test('все три источника Forsaken запрещены — ресурсный план выбирает другую зону',()=>{
 const f=fixture();assert.equal(f.pick({key:'stone'}).tp,'forsaken');for(const n of ['marsh stalker','fallen orc','marsh drake'])f.rt.hardMobs[n]={t:Date.now()};
 assert.equal(f.pick({key:'stone'}).tp,'other');
});
test('частичный запрет исключает моба из имён и расчёта добычи, сохраняя доступных соседей',()=>{
 const f=fixture();f.rt.hardMobs['marsh stalker']={t:Date.now()};const p=f.pick({key:'stone'});
 assert.equal(p.tp,'forsaken');assert.ok(!p.names.includes('Marsh Stalker'));assert.equal(p.names.length,2);
});
test('истёкший запрет возвращает источник в план без ручного сброса',()=>{
 const f=fixture();for(const n of ['marsh stalker','fallen orc','marsh drake'])f.rt.hardMobs[n]={t:Date.now()-7200001};assert.equal(f.pick({key:'stone'}).tp,'forsaken');
});
test('если все источники запрещены, план отсутствует, старой цели для телепорта нет',()=>{
 const f=fixture();for(const row of f.FARM.res.stone.drop)f.rt.hardMobs[row[0].toLowerCase()]={t:Date.now()};assert.equal(f.pick({key:'stone'}),null);
});
test('спойл не обходит запрет вида и не увеличивает ложный рейтинг зоны',()=>{
 const f=fixture();f.canSpoil=()=>true;f.FARM.res.stone.sp=[['Marsh Stalker',54,90,1,5,'forsaken','Forsaken Plains']];
 for(const n of ['marsh stalker','fallen orc','marsh drake'])f.rt.hardMobs[n]={t:Date.now()};assert.equal(f.pick({key:'stone'}).tp,'other');
});
