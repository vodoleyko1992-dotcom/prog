'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../content.js','utf8');
const fragment=source.slice(source.indexOf('async function syncShotWeapon()'),source.indexOf('\nlet SHOP_BUY',source.indexOf('async function syncShotWeapon()')));
test('серверный отказ позволяет немедленно сверить S-оружие и снять блокировку',async()=>{
 const rt={char:'Warlock',weaponsT:1,weapons:[{id:8688,g:'A',where:'надето'}],shotEquipCheckT:Date.now(),shotMismatchPending:true};
 const calls=[];const box={Date,on:true,tabOwner:true,rt,gameGet:async()=>({ok:true,json:async()=>({character:{revision:42,inventory:{eq:{l1:{itemId:9002284}}}}})}),setRt:async p=>Object.assign(rt,p),weaponEquipNote:async q=>{calls.push(q);rt.weapons=[{id:q.itemId,g:'S',where:'надето'}]},rec:()=>{}};
 vm.createContext(box);vm.runInContext(fragment,box);await box.syncShotWeapon();
 assert.equal(calls.length,1);assert.equal(calls[0].itemId,9002284);assert.equal(rt.shotMismatchPending,false);
});
test('пока сверка не завершена, старые заряды не используются и новые не покупаются',()=>{
 const resources=fs.readFileSync(__dirname+'/../modules/resources.js','utf8');
 const economy=fs.readFileSync(__dirname+'/../modules/economy.js','utf8');
 assert.match(resources,/async function keepShots\(\) \{\s*if \(env\.rt\.shotMismatchPending/);
 assert.match(economy,/env\.rt\.weaponMetaPending \|\| env\.rt\.shotMismatchPending/);
 assert.match(source,/mystic_spiritshot\|soulshot\)_grade_mismatch/);
});
