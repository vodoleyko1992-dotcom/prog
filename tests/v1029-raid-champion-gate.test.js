'use strict';
// РБ и эпики не относятся к цветным чемпионам, хотя исторический target.champ=true.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../modules/mobfarm.js'),'utf8');
function gate(){let tierCalls=0,holdCalls=0;const env={campChampMin:()=>0,campActive:()=>false,campChampOpen:()=>false,champs:{tierOff:()=>{tierCalls++;return 'неизвестный цвет'},held:()=>{holdCalls++;return 'слабый'}}};const box={env};vm.runInNewContext(source.slice(source.indexOf('function champEntryOff('),source.indexOf('async function attackSpawn('))+'\nthis.check=champEntryOff;',box);return {check:box.check,env,get tierCalls(){return tierCalls},get holdCalls(){return holdCalls}};}
for(const id of ['l2dop_rb_25035','l2dop_eg_baium'])test(id+' не отклоняется запретом цвета/силы обычного чемпиона',()=>{const f=gate();assert.equal(f.check({id,rb:true,champ:true,tier:''}),null);assert.equal(f.tierCalls,0);assert.equal(f.holdCalls,0)});
test('обычный чемпион с неизвестным цветом по-прежнему запрещён',()=>{const f=gate();assert.equal(f.check({id:'mob',champ:true,tier:''}),'неизвестный цвет');assert.ok(f.tierCalls>0)});
test('разрешённый цвет не обходит подтверждённый запрет силы обычного чемпиона',()=>{const f=gate();f.env.champs.tierOff=()=>null;assert.equal(f.check({id:'mob',champ:true,tier:'blue'}),'слабый');assert.equal(f.holdCalls,1)});
test('квестовый чемпион не обходит явный запрет цвета',()=>{const f=gate();assert.equal(f.check({id:'quest-mob',champ:true,quest:true,tier:'red'}),'неизвестный цвет')});
test('обычный моб не проверяется как чемпион',()=>{const f=gate();assert.equal(f.check({id:'mob',champ:false}),null);assert.equal(f.tierCalls,0)});
