'use strict';
// 7.2.1 (скрин игрока 10.10): «Банка HP» = «Зілля мани». У банки маны в замере было «HP +136» (реген в момент глотка),
// и распознавание по панели брало её как лечебную. Теперь — по названию; по замеру — только явно HP-банка без «мана» в названии.
// Плюс: миграция в авторолях и фильтр в hpPots (банку маны как лечебную не пьём)
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const load = file => { const sb = { console, Date, Math, document: { querySelectorAll: () => [], querySelector: () => null } }; sb.globalThis = sb; vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), sb); return sb; };
const names = s => String(s || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
// панель Warlock из лога 21:07:55
const panel = [{ name: 'Зілля мани', title: 'Зілля мани ×1040', kind: 'предмет', img: 'Etc_potion_blue_i00_0.jpg' }, { name: 'Blaze', title: 'Blaze', kind: 'скилл', img: '' },
  { name: 'Зілля зцілення', title: 'Зілля зцілення ×1120', kind: 'предмет', img: 'Etc_potion_scarlet_i00_0.jpg' }, { name: 'Благословенний заряд духу', title: 'Благословенний заряд духу', kind: 'заряды', img: '' }];
const rt = { skills: { 'зілля мани': { uses: 282, heal: 136, mpGain: 542 } } };
const env = { cfg: { autoRoles: true }, rt, isBattle: () => true, panelInventory: () => panel, combatProfileKind: () => 'mage_summoner', ilOf: () => null, noEffect: () => false,
  names, iconStem: s => s, itemOf: () => null, expDmg: () => 1, isChargeName: () => false, isForceName: () => false, skillCost: () => 0, ilNum: x => x, normalizeProfession: x => x || '', CLASS_WEAPONS: {}, isEquip: () => false, slotsBy: () => [], heroLevel: () => 52, itemByIcon: () => null };
const E = load('modules/equipment.js').L2V7Factories.equipment(env);
let r = E.suggestRoles().roles;
assert.equal(r.nMpPot, 'Зілля мани'); assert.equal(r.nHpPot, 'Зілля зцілення', 'scarlet «Зілля зцілення» — HP, not the mana potion');
// на панели только банка маны — в «Банку HP» её не ставим
panel.splice(2, 1);
r = E.suggestRoles().roles;
assert.equal(r.nHpPot, '', 'only a mana potion on the bar → no HP potion');
// банка без понятного названия, но по замеру явно лечебная
panel.push({ name: 'Elixir X', title: 'Elixir X ×5', kind: 'предмет', img: 'x.jpg' }); rt.skills['elixir x'] = { heal: 900, mpGain: 0 };
assert.equal(E.suggestRoles().roles.nHpPot, 'Elixir X');
// resources.hpPots: роль «Банка HP» с банкой маны — такую банку не пьём как лечебную
const src = fs.readFileSync(path.join(root, 'modules/resources.js'), 'utf8');
assert.match(src, /env\.slotsBy\(env\.cfg\.nHpPot \|\| ''\)\.filter\(b => !\/ман\|mana\|\\bmp\\b\/i\.test/);
// миграция в авторолях
assert.match(fs.readFileSync(path.join(root, 'modules/equipment.js'), 'utf8'), /hp\.every\(n => POT_MP\.test\(n\)\)\) fix\.nHpPot/);
console.log('PASS: potions — HP role never gets the mana potion (name first, measured heal only when clearly HP), migration, hpPots filter');
