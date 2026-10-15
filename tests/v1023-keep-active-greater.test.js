'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
// Тот же HUD и настоящие модули, что у проверки стабильности автонабора.
const file=path.join(__dirname,'v1023-fa-plan-stability.test.js'),source=fs.readFileSync(file,'utf8');
const box={require:require('node:module').createRequire(file),__dirname,console};
vm.runInNewContext(source.slice(0,source.indexOf("test('"))+'\nthis.make=fixture;',box);
for(const role of ['mage','fighter'])for(const id of [1355,1356,1357,1363,1413,1414])test(role+': действующий Greater '+id+' не заменяется новым за5FA',()=>{
 const f=box.make();f.role(role);f.H[id]=f.now+3600000;
 assert.deepEqual(Array.from(f.group()),[id]);
 const need=Array.from(f.B.townBuffNeed()?.fa||[]);
 assert.equal(need.some(x=>[1355,1356,1357,1363,1413,1414].includes(x)),false);
});
test('после окончания баффа ПП танк выбирает свой орочий набор',()=>{
 const f=box.make();f.role('fighter');f.H[1356]=f.now-1000;
 assert.deepEqual(Array.from(f.group()),[1414]);assert.ok(f.B.townBuffNeed().fa.includes(1414));
});
test('явный выбор игрока по-прежнему разрешает замену баффа ПП',()=>{
 const f=box.make();f.role('fighter');f.H[1356]=f.now+3600000;f.env.cfg.rbSessBuffs='1414';
 assert.deepEqual(Array.from(f.group()),[1414]);assert.ok(f.B.townBuffNeed().fa.includes(1414));
});
