'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const src = fs.readFileSync('content.js', 'utf8');
const migration = src.match(/once\('champInterval30_20261017', \(\) => \{.*?\}\);/)[0];
for (const [champ, deep, wantChamp, wantDeep] of [[20,20,30,30],[20,10,30,30],[50,50,50,50],[30,0,30,0],[75,100,75,100]]) {
 const cfg = {champEvery:champ,deepEvery:deep}, cf = {};
 vm.runInNewContext(migration,{C:k=>k in cf?cf[k]:cfg[k],cf,once:(_flag,fn)=>fn()});
 const next = {...cfg,...cf};
 assert.equal(next.champEvery,wantChamp);assert.equal(next.deepEvery,wantDeep);
 const context = {cfg:next,Math,champRuleOn:()=>true,parseRules:()=>[{champ:true}],farmMapOn:()=>false,campChampDue:()=>false};
 const code = src.slice(src.indexOf('const CHAMP_EVERY ='),src.indexOf('const campChampDue ='));
 const deepN = src.slice(src.indexOf('const deepN ='),src.indexOf('const mapDue ='));
 assert.equal(vm.runInNewContext(code+'\n'+deepN+'\ndeepN()',context),deep===0?wantChamp:Math.min(wantChamp,wantDeep));
}
console.log('PASS: 30 боёв, миграция старых интервалов, сохранение своих значений и выключенной карты');
