'use strict';
// 17.10.2026: письмо из журнала00:52:18 — русский текст, точные названия и количества.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const sb={console};vm.createContext(sb);vm.runInContext(fs.readFileSync(__dirname+'/../modules/mammon.js','utf8'),sb);
const M=sb.L2V7Factories.mammon({rt:{},cfg:{}});
const sent=[['Coal',24],['Iron Ore',20],['Varnish',20],['Thread',50],['Animal Skin',144]];
const note={goal:'Плащ Захисника Діона Lv.0 → 1',part:false,craft:[['Leather',24],['Steel',4],['Cord',40],['Crafted Leather',6]],ret:[['Crafted Leather',6]]};
assert.equal(M.noteText(note,sent,'alt2').join('\n'),
 'Привет! Отправил ресурсы на крафт (Плащ Захисника Діона Lv.0 → 1): Coal ×24, Iron Ore ×20, Varnish ×20, Thread ×50, Animal Skin ×144.\nСкрафти, пожалуйста: Leather ×24, Steel ×4, Cord ×40, Crafted Leather ×6.\nВерни почтой на alt2: Crafted Leather ×6.\nСпасибо!');
const partial=M.noteText({...note,goal:'',part:true,craft:note.ret},sent,'')[0];
assert.match(partial,/Скрафти, пожалуйста, и верни почтой: Crafted Leather ×6\./);
assert.match(partial,/Часть сырья ещё собираю — дошлю позже\.\nСпасибо!$/);
assert.doesNotMatch(partial,/ на :/);
console.log('PASS Russian crafter letter: exact logged batch, intermediate craft, return nickname, partial delivery and unknown nickname');
