#!/usr/bin/env node
/* tools/gen_catalog.js — Owner: core.
 * Generates shared/core/08-catalog-data.js from:
 *   - specs/objects.jsonl                      (ids, machine names, prices, requirements, rapidfire, properties)
 *   - specs/buildings.md §2                    (class names, list page, planet type, class restrictions)
 *   - ../ogame_knowledge_base.md §16           (Russian names)
 *   - fixtures/messages-object-titles.json     (English titles, as shown by an en server)
 *   - src/OGameX/app/GameObjects/*.php         (speed_upgrade drive switches; built-in fallback when the source is absent)
 * Usage: node tools/gen_catalog.js            (writes the file and prints a summary)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const OGX = path.resolve(__dirname, '..');
const SCRATCH = path.resolve(OGX, '..');
const OUT = path.join(OGX, 'shared/core/08-catalog-data.js');

const read = (p) => fs.readFileSync(p, 'utf8');

// ---------------------------------------------------------------- objects.jsonl
const TYPE = { BuildingObject: 'building', StationObject: 'station', ResearchObject: 'research', ShipObject: 'ship', DefenseObject: 'defense' };
const raw = read(path.join(OGX, 'specs/objects.jsonl')).trim().split('\n').map((l) => JSON.parse(l));
const byMachine = new Map(raw.map((j) => [j.name, j]));
const idOf = (machine) => {
  const j = byMachine.get(machine);
  if (!j) throw new Error('unknown machine name ' + machine);
  return +j.id;
};

// ---------------------------------------------------------------- buildings.md §2
const bmd = read(path.join(OGX, 'specs/buildings.md'));
const sec2 = bmd.slice(bmd.indexOf('## 2. Object map'), bmd.indexOf('## 3. List pages'));
const table = {};
for (const line of sec2.split('\n')) {
  const m = /^\|\s*(\d+)\s*\|\s*([a-z_]+)\s*\|\s*([A-Za-z]+)\s*\|\s*([^|]*)\|\s*([^|]*)\|/.exec(line);
  if (!m) continue;
  table[+m[1]] = { machine: m[2], className: m[3], page: m[4].trim(), planet: m[5].trim() };
}

// ---------------------------------------------------------------- KB §16 Russian names
const kb = read(path.join(SCRATCH, 'ogame_knowledge_base.md'));
const kb16 = kb.slice(kb.indexOf('## 16.'));
const ruByMachine = {};
for (const line of kb16.split('\n')) {
  const m = /^\|\s*(\d+)\s*\|\s*`([a-z_]+)`\s*\|\s*([^|]+?)\s*\|/.exec(line);
  if (m) ruByMachine[m[2]] = m[3].replace(/\s*\([A-Za-z ]+\)\s*$/, '').trim();
}

// Short Russian names for narrow UI (planet bar, tables). Not in the KB: maintained here.
const RU_SHORT = {
  metal_mine: 'Рудник М', crystal_mine: 'Рудник К', deuterium_synthesizer: 'Синт. Д', solar_plant: 'СЭС', fusion_plant: 'Термояд',
  metal_store: 'Хран. М', crystal_store: 'Хран. К', deuterium_store: 'Ёмк. Д',
  robot_factory: 'Роботы', shipyard: 'Верфь', research_lab: 'Лаб.', alliance_depot: 'Склад ал.', missile_silo: 'Шахта ракет',
  nano_factory: 'Наниты', terraformer: 'Терраформ.', space_dock: 'Док', lunar_base: 'Лун. база', sensor_phalanx: 'Фаланга', jump_gate: 'Ворота',
  energy_technology: 'Энерг.', laser_technology: 'Лазер', ion_technology: 'Ион', hyperspace_technology: 'Гипертех.', plasma_technology: 'Плазма',
  combustion_drive: 'Реакт. дв.', impulse_drive: 'Имп. дв.', hyperspace_drive: 'Гипердв.', espionage_technology: 'Шпионаж', computer_technology: 'Компьют.',
  astrophysics: 'Астрофиз.', intergalactic_research_network: 'МИС', graviton_technology: 'Гравитон', weapon_technology: 'Оружие',
  shielding_technology: 'Щиты', armor_technology: 'Броня',
  light_fighter: 'ЛИ', heavy_fighter: 'ТИ', cruiser: 'Крейсер', battle_ship: 'Линкор', battlecruiser: 'Лин. кр.', bomber: 'Бомб.',
  destroyer: 'Уничт.', deathstar: 'ЗС', reaper: 'Жнец', pathfinder: 'Перв.', small_cargo: 'МТ', large_cargo: 'БТ', colony_ship: 'Колон.',
  recycler: 'Перераб.', espionage_probe: 'Зонд', solar_satellite: 'Спутник', crawler: 'Гусен.',
  rocket_launcher: 'РУ', light_laser: 'ЛЛ', heavy_laser: 'ТЛ', gauss_cannon: 'Гаусс', ion_cannon: 'ИО', plasma_turret: 'Плазм. ор.',
  small_shield_dome: 'МЩК', large_shield_dome: 'БЩК', anti_ballistic_missile: 'Перехв.', interplanetary_missile: 'МПР',
};

// ---------------------------------------------------------------- English titles
const titles = JSON.parse(read(path.join(OGX, 'fixtures/messages-object-titles.json')));
const enById = Object.fromEntries(titles.map((t) => [t.id, t.title_en]));

// ---------------------------------------------------------------- speed upgrades (SpeedPropertyService inputs)
const FALLBACK_UPGRADES = {
  small_cargo: [{ drive: 'impulse', level: 5, speed: 10000 }],
  recycler: [{ drive: 'impulse', level: 17, speed: 4000 }, { drive: 'hyperspace', level: 15, speed: 6000 }],
  pathfinder: [{ drive: 'impulse', level: 3, speed: null }, { drive: 'hyperspace', level: 3, speed: null }],
  bomber: [{ drive: 'hyperspace', level: 8, speed: 5000 }],
  reaper: [{ drive: 'hyperspace', level: 4, speed: null }],
};
const DRIVE = { combustion_drive: 'combustion', impulse_drive: 'impulse', hyperspace_drive: 'hyperspace' };
function upgradesFromSource() {
  const dir = path.join(SCRATCH, 'src/OGameX/app/GameObjects');
  const out = {};
  let files;
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.php')); } catch (e) { return null; }
  for (const f of files) {
    const php = read(path.join(dir, f));
    const blocks = php.split(/->machine_name\s*=\s*'/).slice(1);
    for (const b of blocks) {
      const machine = b.slice(0, b.indexOf("'"));
      const end = b.indexOf('$buildingObjectsNew[]');
      const body = end > 0 ? b.slice(0, end) : b;
      const ups = [...body.matchAll(/new GameObjectSpeedUpgrade\('([a-z_]+)',\s*(\d+)(?:,\s*(\d+))?\)/g)]
        .map((m) => ({ drive: DRIVE[m[1]], level: +m[2], speed: m[3] ? +m[3] : null }));
      if (ups.length) out[machine] = ups;
    }
  }
  return out;
}
const upgrades = upgradesFromSource() || FALLBACK_UPGRADES;
const upgradesSrc = upgradesFromSource() ? 'src/OGameX/app/GameObjects/*.php' : 'built-in fallback';

// ---------------------------------------------------------------- build
const PAGE_MAP = { resources: 'resources', facilities: 'facilities', research: 'research', shipyard: 'shipyard', defense: 'defense' };
const out = [];
for (const j of raw) {
  const id = +j.id;
  const type = TYPE[j.type];
  const t = table[id];
  if (!t) throw new Error('buildings.md §2 has no row for ' + id);
  if (t.machine !== j.name) throw new Error('machine name mismatch for ' + id + ': ' + t.machine + ' vs ' + j.name);
  const p = j.price.split(',').map((x) => x.trim());
  const price = {
    metal: +p[0], crystal: +p[1], deuterium: +p[2], energy: +p[3],
    factor: p[4] !== undefined ? +p[4] : 1, round100: p[5] === 'true',
  };
  let page = PAGE_MAP[t.page.split(/\s+/)[0]] || null;
  if (id === 212 || id === 217) page = 'shipyard';
  let planetType = 'both';
  if (/^planet/.test(t.planet)) planetType = 'planet';
  else if (/^moon/.test(t.planet)) planetType = 'moon';
  const classOnly = id === 217 ? 'miner' : id === 218 ? 'warrior' : id === 219 ? 'explorer' : null;
  const req = j.req.map(([n, l]) => [idOf(n), +l]);
  const rapidfire = {};
  for (const [n, v] of j.rf) rapidfire[idOf(n)] = +v;
  let props = null;
  let drive = null;
  if (j.props) {
    const v = j.props.split(',').map((x) => +x.trim());
    props = { structural: v[0], shield: v[1], attack: v[2], speed: v[3], cargo: v[4], fuel: v[5], fuelCapacity: v[6] !== undefined ? v[6] : v[4] };
  }
  if (type === 'ship') {
    // SpeedPropertyService::getBonusPercentage fallback: the LAST drive found in the requirements list.
    let base = null;
    for (const [n] of j.req) if (DRIVE[n]) base = DRIVE[n];
    drive = { base, upgrades: upgrades[j.name] || [] };
  }
  out.push({
    id, machine: j.name, className: t.className, type, page, planetType, classOnly, price, req, rapidfire, props, drive,
    ru: ruByMachine[j.name] || enById[id] || j.name, ruShort: RU_SHORT[j.name] || ruByMachine[j.name] || j.name, en: enById[id] || j.name,
  });
}
const missingRu = out.filter((o) => !ruByMachine[o.machine]).map((o) => o.machine);
if (missingRu.length) console.warn('no Russian name in KB §16 for:', missingRu.join(', '));

const header = `/* shared/core/08-catalog-data.js — GENERATED by tools/gen_catalog.js. Do not edit by hand. Owner: core.
 * Sources: specs/objects.jsonl, specs/buildings.md §2, ogame_knowledge_base.md §16, fixtures/messages-object-titles.json,
 * speed upgrades from ${upgradesSrc}. ${out.length} objects. */
`;
const body = `(function (OGX) {
  'use strict';
  const catalog = (OGX.catalog = OGX.catalog || {});
  catalog._data = ${JSON.stringify(out, null, 0).replace(/\},\{"id"/g, '},\n    {"id"')};
})(window.OGX);
`;
fs.writeFileSync(OUT, header + body);
console.log('wrote', path.relative(OGX, OUT), out.length, 'objects; speed upgrades from', upgradesSrc);
