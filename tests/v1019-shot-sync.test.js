'use strict';
// 15.10: игрок надел S-кастер до запуска обновлённого бота; в памяти остался A.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../content.js','utf8');
const fragment=source.slice(source.indexOf('async function syncShotWeapon()'),source.indexOf('\nlet SHOP_BUY',source.indexOf('async function syncShotWeapon()')));
function fixture(id=9002284){const calls=[],requests=[];const rt={char:'Warlock',shotEquipCheckT:0,weaponsT:1,weapons:[{id:8688,g:'A',where:'надето'}]};
 const box={Date,on:true,tabOwner:true,rt,gameGet:async path=>{requests.push(path);return {ok:true,json:async()=>({character:{revision:42,inventory:{eq:{l1:{itemId:id,enchant:25,enchantPAtkBonus:0,enchantMAtkBonus:360}}}}})}},setRt:async patch=>Object.assign(rt,patch),weaponEquipNote:async req=>{calls.push(req);rt.weapons=[{id:req.itemId,g:'S',where:'надето'}]},rec:()=>{}};
 vm.createContext(box);vm.runInContext(fragment,box);return {box,rt,calls,requests,sync:()=>box.syncShotWeapon()};}
test('GET /character discovers pre-existing S caster and passes exact equipped metadata',async()=>{const f=fixture();await f.sync();assert.deepEqual(f.requests,['/character']);assert.equal(f.calls.length,1);assert.equal(f.calls[0].itemId,9002284);assert.equal(f.calls[0].enchantMAtkBonus,360);await f.sync();assert.equal(f.requests.length,1,'ten-minute throttle');});
test('confirmed same weapon does not create another equip event',async()=>{const f=fixture(8688);await f.sync();assert.equal(f.calls.length,0)});
test('Stop during GET prevents a late equipment write',async()=>{const f=fixture();const get=f.box.gameGet;f.box.gameGet=async path=>{const out=await get(path);f.box.on=false;return out};await f.sync();assert.equal(f.calls.length,0)});
