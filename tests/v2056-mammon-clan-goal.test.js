'use strict';
// 20.56 (John 23.10 18:14 «Не определяется А плащ и не могу его прокачать», лог 04:06–04:10): клановое оружие (9002282/9002284) из
// надетого попадало в цели Маммона безымянным «★ #9002284 Lv.0»; его выбирали вместо Cloak of Goddard Guardian (920017), кузнец такой
// вещи не знает. Теперь в памяти надетого и в меню — только вещи кузнеца; выбранная клановая цель снимается один раз
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const box={location:{pathname:'/map.html'},sessionStorage:{getItem:()=>null,setItem(){}},console};vm.runInNewContext(read('modules/mammon.js'),box);
const env={cfg:{mmGoalItem:920017,mmGoalLvl:1},rt:{},ITEMS:{},setRt:async p=>Object.assign(env.rt,p),rec(){},heroLvl:()=>76,heroNick:()=>'Warlock'};
const M=box.L2V7Factories.mammon(env);
M.eqNote({l1:{itemId:9002284,level:0},l2:9002282,cloak:{itemId:920017,specialGearLevel:0},belt:{itemId:920018,specialGearLevel:2},shirt:1234});
assert.deepEqual(Object.keys(env.rt.mmEq).sort(),['belt','cloak'],'clan weapons and ordinary items are not Mammon gear');
assert.deepEqual([...env.rt.mmEq.cloak],[920017,0]);
assert.equal(M.gearLvl(920017),0);
assert.ok(JSON.parse(read('mammon-gear.json'))['920017'],'cloak is in the blacksmith catalogue');
const p=read('popup.js'),c=read('content.js');
assert.match(p,/Object\.entries\(rt\.mmEq \|\| \{\}\)\.filter\(\(\[, v\]\) => \+v\?\.\[0\] >= 910618 && \+v\[0\] <= 929999\)/,'menu filters stale clan weapons');
assert.match(c,/once\('mmGoalClan2056', \(\) => \{\s*const g = \+C\('mmGoalItem'\) \|\| 0;\s*if \(g > 929999\) cf\.mmGoalItem = 0;/);
console.log('v2056-mammon-clan-goal: PASS');
