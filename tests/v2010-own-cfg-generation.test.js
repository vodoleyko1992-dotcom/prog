'use strict';
// 20.10: своя запись настроек (подстановка оружия после чтения сумки) не поднимает поколение управления
// и не отменяет собственный возврат со страницы сумки; смена из меню/другой вкладки — поднимает.
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const src = fs.readFileSync(require('node:path').join(__dirname, '..', 'content.js'), 'utf8');
const a = src.indexOf('const OWN_CFG'), b = src.indexOf('async function setCfg', a);
assert.ok(a > 0 && b > a, 'блок OWN_CFG перед setCfg');
const ctx = {}; vm.createContext(ctx); vm.runInContext(src.slice(a, b) + ';this.OWN_CFG=OWN_CFG;this.ownCfgChange=ownCfgChange;', ctx);
const { OWN_CFG, ownCfgChange } = ctx, push = p => OWN_CFG.push({ patch: p, t: Date.now() });
const base = { nWeaponMain: '', weaponManual: true, fishMode: true };
// своя запись ровно своих ключей — не поднимает и расходуется
push({ nWeaponMain: 'Fisted Blade', weaponManual: false });
assert.equal(ownCfgChange({ oldValue: base, newValue: { ...base, nWeaponMain: 'Fisted Blade', weaponManual: false } }), true);
assert.equal(OWN_CFG.length, 0);
// та же смена второй раз (уже без своей записи) — чужая
assert.equal(ownCfgChange({ oldValue: base, newValue: { ...base, nWeaponMain: 'Fisted Blade', weaponManual: false } }), false);
// своя запись, но одновременно игрок выключил задачу — поднимает
push({ nWeaponMain: 'X' });
assert.equal(ownCfgChange({ oldValue: base, newValue: { ...base, nWeaponMain: 'X', fishMode: false } }), false);
// значение не совпадает со своим патчем — поднимает
assert.equal(ownCfgChange({ oldValue: base, newValue: { ...base, nWeaponMain: 'Y' } }), false);
// устаревшая (>10 с) своя запись не считается
OWN_CFG.length = 0; OWN_CFG.push({ patch: { nWeaponMain: 'Z' }, t: Date.now() - 11000 });
assert.equal(ownCfgChange({ oldValue: base, newValue: { ...base, nWeaponMain: 'Z' } }), false);
// слушатель хранилища использует проверку, Start/Stop (on) по-прежнему поднимает поколение
assert.match(src, /if \(ch\.on \|\| ch\.cfg && !ownCfgChange\(ch\.cfg\) \|\|/);
assert.match(src, /async function setCfg\(patch\) \{\n  OWN_CFG\.push/);
console.log('PASS v2010-own-cfg-generation: своя запись cfg не отменяет свой маршрут, чужая/смешанная — отменяет');
