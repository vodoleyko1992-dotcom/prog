'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(require('node:path').join(__dirname,'../content.js'),'utf8');const fragment=src.slice(src.indexOf('const warlockShotContext'),src.indexOf('const warlockCanRun'));
function context(rows){const c=vm.createContext({document:{querySelectorAll:()=>rows},SHOT_IDS:{NG:1835,D:1463,C:1464,B:1465,A:1466,S:1467},BSPS_IDS:{NG:3947,D:3948,C:3949,B:3950,A:3951,S:3952},qty:b=>b.count,shotsOn:b=>b.on});vm.runInContext(fragment,c);return vm.runInContext('warlockShotContext()',c)}
const row=(id,count=5,on=true)=>({count,on,title:'#'+id+' — активний',querySelector:()=>({getAttribute:()=>'/game/item-icon/'+id})});
test('точный item/grade/on/stock',()=>assert.equal(context([row(3951)]),'Благ. заряды духа A (#3951) · вкл · есть'));
test('расход одного заряда не дробит выборку',()=>assert.equal(context([row(3951,100)]),context([row(3951,99)])));
test('выключенные/исчерпанные заряды отделены',()=>{assert.notEqual(context([row(3951,0)]),context([row(3951)]));assert.notEqual(context([row(3951,5,false)]),context([row(3951)]))});
test('нет панели или количества — unknown',()=>{assert.equal(context([]),'unknown');assert.equal(context([row(3951,null)]),'unknown')});
test('не угадывает itemId по общему названию или оружию',()=>{const r=row(0);r.title='Благословений заряд духу';r.querySelector=()=>({getAttribute:()=>'/icons/shared-shot.png'});assert.equal(context([r]),'unknown')});
test('разный тип/грейд и стабильный порядок слотов',()=>{assert.notEqual(context([row(3951)]),context([row(1466)]));assert.notEqual(context([row(3951)]),context([row(3950)]));assert.equal(context([row(3951),row(1466)]),context([row(1466),row(3951)]))});
