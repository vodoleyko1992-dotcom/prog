'use strict';
// Golden battle cases for OGX.botSim vs upstream calculateAttack/calculateSteal (tests/bot-sim-php/make-golden.js).
// Side = C4 Side ({ units, tech, factor, bonusPct, storageFactor, carried }); units may be [[id, n], ...] with keepOrder.
const T0 = { weapons: 0, shielding: 0, armour: 0 };
const T10 = { weapons: 10, shielding: 10, armour: 10 };
const P = (m, c, d) => ({ metal: m, crystal: c, deuterium: d });

const cases = [
  // one round worked by hand in tests/bot-sim.test.js (10 LF vs 5 RL)
  { name: 'lf-vs-rl-basic', seed: 1, attackers: [{ units: { 204: 10 }, tech: T0 }], defenders: [{ units: { 401: 5 }, tech: T0 }], planet: P(1e5, 5e4, 2e4) },
  { name: 'rf-cruiser-vs-lf', seed: 2, attackers: [{ units: { 206: 50 }, tech: T10 }], defenders: [{ units: { 204: 400 }, tech: T10 }], planet: P(1e6, 1e6, 1e6) },
  { name: 'rf-lf-vs-cruiser-defending', seed: 3, attackers: [{ units: { 204: 300 }, tech: T0 }], defenders: [{ units: { 206: 40, 401: 100 }, tech: T0 }], planet: P(0, 0, 0) },
  { name: 'rf-214-vs-many', seed: 4, attackers: [{ units: { 214: 1 }, tech: T10 }],
    defenders: [{ units: { 202: 200, 203: 100, 204: 500, 205: 200, 206: 50, 210: 30, 212: 40, 401: 300, 402: 200, 403: 50, 404: 10, 405: 20 }, tech: T10 }], planet: P(5e7, 3e7, 1e7) },
  { name: 'rf-214x2-vs-215', seed: 5, attackers: [{ units: { 214: 2, 202: 50 }, tech: T0 }], defenders: [{ units: { 215: 100, 213: 20 }, tech: T0 }], planet: P(1e6, 1e6, 0) },
  { name: 'rf-many-vs-214-defending', seed: 6, attackers: [{ units: { 204: 2000, 206: 300, 215: 50 }, tech: T10 }], defenders: [{ units: { 214: 3, 210: 100 }, tech: T10 }], planet: P(1e8, 1e8, 1e8) },
  { name: 'domes-small-large', seed: 7, attackers: [{ units: { 204: 100 }, tech: T0 }], defenders: [{ units: { 401: 50, 407: 1, 408: 1 }, tech: T0 }], planet: P(1e5, 1e5, 1e5) },
  { name: 'domes-vs-bs', seed: 8, attackers: [{ units: { 207: 200 }, tech: T10 }], defenders: [{ units: { 402: 300, 404: 20, 407: 1, 408: 1, 409: 1 }, tech: T10 }], planet: P(1e7, 1e7, 1e7) },
  { name: 'draw-6-rounds-lc-vs-dome', seed: 9, attackers: [{ units: { 202: 10 }, tech: T0 }], defenders: [{ units: { 407: 1 }, tech: T0 }], planet: P(1e5, 0, 0) },
  { name: 'draw-6-rounds-even', seed: 10, attackers: [{ units: { 205: 200 }, tech: T0 }], defenders: [{ units: { 402: 400, 405: 100 }, tech: T10 }], planet: P(1e6, 0, 0) },
  { name: 'defense-rebuild', seed: 11, attackers: [{ units: { 207: 500, 206: 200 }, tech: T10 }], defenders: [{ units: { 401: 1000, 402: 500, 403: 100 }, tech: T0 }], planet: P(2e6, 1e6, 5e5), defDebrisPct: 30 },
  { name: 'acs-two-attackers', seed: 12, attackers: [{ units: { 206: 100, 202: 40 }, tech: T10 }, { units: { 207: 60, 203: 20 }, tech: { weapons: 5, shielding: 7, armour: 3 } }],
    defenders: [{ units: { 204: 300, 401: 400, 402: 200, 403: 40 }, tech: { weapons: 8, shielding: 8, armour: 8 } }], planet: P(5e6, 4e6, 3e6) },
  { name: 'acs-three-attackers', seed: 13, attackers: [{ units: { 204: 500 }, tech: T0 }, { units: { 205: 200 }, tech: T10 }, { units: { 211: 30, 203: 30 }, tech: { weapons: 12, shielding: 12, armour: 12 } }],
    defenders: [{ units: { 401: 800, 403: 100, 405: 50, 406: 10 }, tech: T10 }], planet: P(9e6, 9e6, 9e6) },
  { name: 'two-defender-sides-hold', seed: 14, attackers: [{ units: { 215: 100, 206: 100 }, tech: T10 }],
    defenders: [{ units: { 205: 100, 207: 10 }, tech: { weapons: 6, shielding: 6, armour: 6 } }, { units: { 204: 200, 401: 300, 402: 100 }, tech: T10 }], planet: P(3e6, 2e6, 1e6) },
  { name: 'empty-defender', seed: 15, attackers: [{ units: { 202: 5, 203: 2 }, tech: T0 }], defenders: [{ units: {}, tech: T0 }], planet: P(1e5, 8e4, 6e4) },
  { name: 'attacker-wiped', seed: 16, attackers: [{ units: { 204: 5 }, tech: T0 }], defenders: [{ units: { 404: 50 }, tech: T10 }], planet: P(1e6, 1e6, 1e6) },
  { name: 'capacity-below-halves', seed: 17, attackers: [{ units: { 202: 2 }, tech: T0 }], defenders: [{ units: {}, tech: T0 }], planet: P(1e6, 1e6, 1e6) },
  // metal = deuterium, capacity = sum of the halves: calculateSteal takes only 11/12 of it [UPSTREAM]
  { name: 'steal-metal-eq-deut-11-12', seed: 18, attackers: [{ units: { 202: 24 }, tech: T0 }], defenders: [{ units: {}, tech: T0 }], planet: P(120000, 0, 120000) },
  { name: 'steal-storage-carried', seed: 19, attackers: [{ units: { 203: 10, 204: 20 }, tech: T0, factor: { ShipStorage: 0.5 }, carried: P(30000, 20000, 10000) }], defenders: [{ units: { 401: 3 }, tech: T0 }], planet: P(2e6, 1e6, 3e5) },
  { name: 'gz-213-vs-402-215', seed: 20, attackers: [{ units: { 213: 80 }, tech: T10 }], defenders: [{ units: { 215: 30, 402: 500, 401: 200 }, tech: T10 }], planet: P(4e6, 4e6, 4e6) },
  { name: 'gz-215-vs-mix', seed: 21, attackers: [{ units: { 215: 150 }, tech: T10 }], defenders: [{ units: { 202: 100, 203: 100, 205: 200, 206: 100, 207: 40, 210: 50 }, tech: T10 }], planet: P(8e6, 5e6, 2e6) },
  { name: 'gz-216-vs-214', seed: 22, attackers: [{ units: { 216: 2 }, tech: T10 }], defenders: [{ units: { 214: 3, 213: 50 }, tech: T10 }], planet: P(1e9, 1e9, 1e9) },
  { name: 'gz-218-vs-411', seed: 23, attackers: [{ units: { 218: 1 }, tech: { weapons: 20, shielding: 20, armour: 20 } }], defenders: [{ units: { 411: 1, 410: 5 }, tech: { weapons: 20, shielding: 20, armour: 20 } }], planet: P(1e10, 1e10, 1e10) },
  { name: 'gz-217-219-220', seed: 24, attackers: [{ units: { 217: 10, 219: 2, 220: 3, 204: 100 }, tech: T10 }], defenders: [{ units: { 401: 150, 402: 50 }, tech: T10 }], planet: P(5e8, 3e8, 1e8) },
  { name: 'gz-410-graviton', seed: 25, attackers: [{ units: { 214: 5, 207: 500 }, tech: T10 }], defenders: [{ units: { 410: 3, 406: 20, 409: 1 }, tech: T10 }], planet: P(1e8, 1e8, 1e8) },
  { name: 'high-tech-factors', seed: 26, attackers: [{ units: { 207: 100, 206: 100 }, tech: { weapons: 25, shielding: 22, armour: 24 }, factor: { Attack: 0.1, Defensive: 0.05, Shield: 0.15 } }],
    defenders: [{ units: { 403: 200, 404: 40, 405: 100, 406: 20 }, tech: { weapons: 18, shielding: 19, armour: 20 }, factor: { Attack: 0.25, Defensive: 0, Shield: 0.1 } }], planet: P(2e7, 1e7, 5e6) },
  { name: 'bonuspct-sides', seed: 27, attackers: [{ units: { 205: 300, 206: 80 }, bonusPct: { attack: 35, defense: 85, shield: 60 } }],
    defenders: [{ units: { 401: 400, 402: 300, 403: 30 }, bonusPct: { attack: 120, defense: 110, shield: 125 } }], planet: P(3e6, 2e6, 1e6) },
  { name: 'keep-order-pirates', seed: 28, keepOrder: true, attackers: [{ units: [[202, 10], [204, 30], [210, 2]], tech: T10 }],
    defenders: [{ units: [[204, 5], [202, 3], [210, 1]], tech: { weapons: 0, shielding: 0, armour: 0 } }], planet: P(0, 0, 0), fleetDebrisPct: 0 },
  { name: 'probes-only', seed: 29, attackers: [{ units: { 210: 10 }, tech: T0 }], defenders: [{ units: { 401: 1 }, tech: T0 }], planet: P(1e5, 1e5, 1e5) },
  { name: 'defender-civil-ships', seed: 30, attackers: [{ units: { 204: 300, 202: 50 }, tech: T0 }], defenders: [{ units: { 202: 30, 203: 20, 208: 2, 209: 15, 210: 40, 212: 100 }, tech: T0 }], planet: P(4e6, 3e6, 2e6) },
  { name: 'big-numbers', seed: 31, attackers: [{ units: { 204: 1000000, 206: 100000 }, tech: T10 }], defenders: [{ units: { 401: 500000, 402: 300000, 404: 20000 }, tech: T10 }], planet: P(5e10, 4e10, 3e10) },
  { name: 'one-vs-one', seed: 32, attackers: [{ units: { 205: 1 }, tech: T0 }], defenders: [{ units: { 204: 1 }, tech: T0 }], planet: P(100, 100, 100) },
  { name: 'defender-wins-ships', seed: 33, attackers: [{ units: { 204: 100, 202: 20 }, tech: T0 }], defenders: [{ units: { 207: 30 }, tech: T10 }], planet: P(1e6, 1e6, 1e6) },
  { name: 'satellites-rf', seed: 34, attackers: [{ units: { 204: 50 }, tech: T0 }], defenders: [{ units: { 212: 500, 401: 20 }, tech: T0 }], planet: P(1e6, 5e5, 1e5) },
  { name: 'debris-pcts-50-50', seed: 35, fleetDebrisPct: 50, defDebrisPct: 50, attackers: [{ units: { 207: 100 }, tech: T0 }], defenders: [{ units: { 204: 200, 401: 300, 403: 50 }, tech: T0 }], planet: P(1e6, 1e6, 1e6) },
];

// seeded random mixes
const SHIPS = [202, 203, 204, 205, 206, 207, 211, 213, 215];
const DEFS = [401, 402, 403, 404, 405, 406, 407, 408];
function mix(S, i) {
  const r = S.rng('mix-' + i);
  const pick = (list, k, max) => { const o = {}; for (let j = 0; j < k; j++) o[list[r.int(0, list.length - 1)]] = r.int(1, max); return o; };
  const tech = () => ({ weapons: r.int(0, 20), shielding: r.int(0, 20), armour: r.int(0, 20) });
  const dUnits = Object.assign(pick(SHIPS.concat([210, 212, 209]), r.int(0, 4), 300), pick(DEFS, r.int(0, 4), 500));
  return { name: 'random-mix-' + i, seed: 100 + i, attackers: [{ units: pick(SHIPS, r.int(1, 4), 400), tech: tech() }], defenders: [{ units: dUnits, tech: tech() }],
    planet: P(r.int(0, 1e7), r.int(0, 1e7), r.int(0, 1e7)), defDebrisPct: r.int(0, 1) ? 0 : 30 };
}
module.exports = (S) => cases.concat(Array.from({ length: 10 }, (_, i) => mix(S, i)));
