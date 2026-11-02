#!/usr/bin/env node
/* tools/gen_catalog.js — Owner: core.
 * Generates shared/core/08-catalog-data.js (the GALAXYZ element catalog) from specs/galaxyz/elements.json
 * (real names, prices, factors and requirements from the saved ogamex.eu/Aeternum pages; ship stats and rapidfire from upstream 2Moons).
 * The previous OgameX generator lives in tools/legacy-ogamex/gen_catalog.js.
 * Usage: node tools/gen_catalog.js            (writes the file and prints a summary)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const OGX = path.resolve(__dirname, '..');
const SRC = path.join(OGX, 'specs/galaxyz/elements.json');
const OUT = path.join(OGX, 'shared/core/08-catalog-data.js');

const json = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const E = json.elements;

// Resource buildings (OgameX page /resources) vs. stations (/facilities). GALAXYZ shows both on page=buildings.
const RESOURCE_BUILDINGS = [1, 2, 3, 4, 12, 22, 23, 24];
// 2Moons speed "tech": 1 combustion, 2 impulse, 3 hyperspace, 4 = 202 (impulse from impulse 5), 5 = 211 (hyperspace from hyperspace 8).
const DRIVE = { 1: 'combustion', 2: 'impulse', 3: 'hyperspace' };
const DRIVE_SWITCH = { 4: { base: 'combustion', upgrades: [{ drive: 'impulse', level: 5, speed: null }] },
  5: { base: 'impulse', upgrades: [{ drive: 'hyperspace', level: 8, speed: null }] } };
// Civil ships (no combat role): the rest of the ship list is military.
const CIVIL = [202, 203, 208, 209, 210, 212, 217, 219, 220];

// Short Russian names for tables and chips (catalog.shortName).
const RU_SHORT = {
  1: 'Рудник М', 2: 'Рудник К', 3: 'Синт. Д', 4: 'СЭС', 6: 'Технополис', 12: 'Термояд', 14: 'Роботы', 15: 'Наниты', 21: 'Верфь',
  22: 'Хран. М', 23: 'Хран. К', 24: 'Ёмк. Д', 31: 'Лаб.', 33: 'Терраформ.', 34: 'Склад ал.', 41: 'Лун. база', 42: 'Фаланга',
  43: 'Телепорт', 44: 'Шахта ракет', 71: 'Конв. 1', 72: 'Конв. 2', 73: 'Конв. 3',
  106: 'Шпионаж', 108: 'Компьют.', 109: 'Оружие', 110: 'Щиты', 111: 'Броня', 113: 'Энерг.', 114: 'Гипертех.', 115: 'Реакт. дв.',
  117: 'Имп. дв.', 118: 'Гипердв.', 120: 'Лазер', 121: 'Ион', 122: 'Плазма', 123: 'МИС', 124: 'Астрофиз.', 131: 'Добыча М',
  132: 'Добыча К', 133: 'Добыча Д', 199: 'Гравитон',
  202: 'МТ', 203: 'БТ', 204: 'ЛИ', 205: 'ТИ', 206: 'Крейсер', 207: 'Линкор', 208: 'Колон.', 209: 'Перераб.', 210: 'Зонд',
  211: 'Бомб.', 212: 'Спутник', 213: 'Уничт.', 214: 'ЗС', 215: 'Лин. кр.', 216: 'Сверхн.', 217: 'Ул. трансп.', 218: 'Аватар',
  219: 'Мега пер.', 220: 'Сборщик ТМ',
  401: 'РУ', 402: 'ЛЛ', 403: 'ТЛ', 404: 'Гаусс', 405: 'ИО', 406: 'Плазм. ор.', 407: 'МЩК', 408: 'БЩК', 409: 'ПЩК', 410: 'Гравитон. ор.',
  411: 'Орб. база', 502: 'Перехв.', 503: 'МПР',
};
// Names the upstream Russian language file does not have (fork-only buildings).
const RU = { 71: 'Лёгкий конвейер', 72: 'Средний конвейер', 73: 'Тяжёлый конвейер' };

const camel = (s) => String(s).replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const num = (v) => (v === undefined || v === null ? 0 : +v);

function typeOf(e) {
  if (e.kind === 'building') return RESOURCE_BUILDINGS.includes(e.id) ? 'building' : 'station';
  if (e.kind === 'missile') return 'defense';
  if (e.kind === 'dmfunc') return 'boost';
  return e.kind; // research, ship, defense, officer
}
const PAGE = { building: 'resources', station: 'facilities', research: 'research', ship: 'shipyard', defense: 'defense', officer: 'premium', boost: 'premium' };
const GZ_PAGE = { building: 'buildings', station: 'buildings', research: 'research', ship: 'shipyard', defense: 'shipyard', officer: 'officier', boost: 'officier' };

const out = [];
for (const e of Object.values(E).sort((a, b) => a.id - b.id)) {
  const type = typeOf(e);
  const pt = e.onPlanetType || [1];
  const planetType = pt.includes(1) && pt.includes(3) ? 'both' : pt.includes(3) ? 'moon' : 'planet';
  const c = e.cost || {};
  const priceKnown = !!e.cost;
  const price = { metal: num(c[901]), crystal: num(c[902]), deuterium: num(c[903]), energy: num(c[911]), darkMatter: num(c[921]),
    factor: e.factor === null || e.factor === undefined ? 1 : +e.factor, round100: false };
  const req = Object.entries(e.requirements || {}).map(([id, lvl]) => [+id, +lvl]);
  const rf = e.rapidfire || {};
  let props = null;
  let drive = null;
  if (type === 'ship' || type === 'defense') {
    props = { structural: num(e.structure), shield: num(e.shield), attack: num(e.attack), speed: num(e.speed), cargo: num(e.capacity),
      fuel: num(e.consumption), fuelCapacity: num(e.capacity) };
    if (type === 'ship') {
      Object.assign(props, { speed2: num(e.speed2), fuel2: num(e.consumption2), speedTech: num(e.speedTech) });
      drive = DRIVE_SWITCH[e.speedTech] ? JSON.parse(JSON.stringify(DRIVE_SWITCH[e.speedTech])) : { base: DRIVE[e.speedTech] || null, upgrades: [] };
    }
  }
  const o = {
    id: e.id, machine: e.key, className: camel(e.key), type, page: PAGE[type], gzPage: GZ_PAGE[type], planetType, classOnly: null,
    price, priceKnown, maxLevel: e.maxLevel === undefined ? null : e.maxLevel, onePerPlanet: !!e.onePerPlanet, req,
    rapidfire: Object.fromEntries(Object.entries(rf.to || {}).map(([k, v]) => [+k, +v])),
    rapidfireFrom: Object.fromEntries(Object.entries(rf.from || {}).map(([k, v]) => [+k, +v])),
    props, drive, ru: e.nameRu || RU[e.id] || e.name, ruShort: RU_SHORT[e.id] || e.nameRu || RU[e.id] || e.name, en: e.name,
  };
  if (e.kind === 'missile') o.missile = true;
  if (type === 'ship') o.civil = CIVIL.includes(e.id);
  if (e.bonus) o.bonus = Object.fromEntries(Object.entries(e.bonus).map(([k, v]) => [k, +v.value]));
  if (e.forkOnly) o.forkOnly = true;
  out.push(o);
}
const unknown = out.filter((o) => !o.priceKnown).map((o) => o.id);

const header = `/* shared/core/08-catalog-data.js — GENERATED by tools/gen_catalog.js. Do not edit by hand. Owner: core.
 * GALAXYZ (ogamex.eu/Aeternum, 2Moons fork) elements from specs/galaxyz/elements.json: names, prices, factors and requirements
 * are REAL (saved pages), ship/defence stats and rapidfire UPSTREAM 2Moons. ${out.length} objects; price unknown: ${unknown.join(', ') || 'none'}. */
`;
const body = `(function (OGX) {
  'use strict';
  const catalog = (OGX.catalog = OGX.catalog || {});
  catalog._data = ${JSON.stringify(out, null, 0).replace(/\},\{"id"/g, '},\n    {"id"')};
})(window.OGX);
`;
fs.writeFileSync(OUT, header + body);
console.log('wrote', path.relative(OGX, OUT), out.length, 'objects; price unknown:', unknown.join(', ') || 'none');
