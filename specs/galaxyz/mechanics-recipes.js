// Copy-paste parsing recipes for specs/galaxyz/mechanics.md.
// Each recipe is a plain function (doc[, arg]) => JSON, run on the REAL saved pages by tools/mechanics/run_mechanics_snippets.js
// (Chromium, JS disabled, raw saved DOM). Recipes only read the DOM; they never send anything.

// "1.932.927.923" -> 1932927923, "-14.214" -> -14214, "-" -> null.
// Short forms (avoid them, exact values exist): JS shortly_number "3.417\u00a0M" = 3 417 M = 3.417e9 (long scale K 1e3, M 1e6, B 1e12, T 1e18,
// "." = thousands); PHP "47.5K" ("." = decimal). Rule used here: "." followed by exactly 3 digits = thousands separator.
const gzNum = (s) => {
  const t = String(s).replace(/\u00a0/g, ' ').replace(/\u2212/g, '-').trim();
  if (t === '-' || t === '') return null;
  const m = t.match(/^(-?[\d.]+(?:,\d+)?)\s*([KMBT])?$/i);
  if (!m) return NaN;
  const digits = /^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(m[1]) ? m[1].replace(/\./g, '').replace(',', '.') : m[1].replace(',', '.');
  return m[2] ? Math.round(+digits * { K: 1e3, M: 1e6, B: 1e12, T: 1e18 }[m[2].toUpperCase()]) : +digits;
};

// R1 page=resources: production table, one object per row
const productionTable = (doc) => [...doc.querySelectorAll('table.listOfResourceSettingsPerPlanet tr')]
  .filter((tr) => tr.querySelector('td.label'))
  .map((tr) => {
    const td = tr.querySelectorAll('td');
    const label = td[0].textContent.replace(/\s+/g, ' ').trim();
    const lv = label.match(/\((?:Level|Quantity)\s+(\d+)\)/);
    const sel = tr.querySelector('select[name^="prod["]');
    return { label, id: sel ? +sel.name.match(/\d+/)[0] : null, level: lv ? +lv[1] : null,
      metal: gzNum(td[1].textContent), crystal: gzNum(td[2].textContent), deuterium: gzNum(td[3].textContent), energy: gzNum(td[4].textContent),
      percent: sel ? +sel.value * 10 : null };
  });

// R2 every full page: exact numbers from the inline resourceTicker({...}) calls
const resourceTickers = (doc) => [...doc.scripts].map((s) => s.textContent).join('\n')
  .split('resourceTicker({').slice(1).map((chunk) => {
    const get = (k) => { const m = chunk.match(new RegExp(k + '\\s*:\\s*\\(?\\s*([^,)\\n]+)')); return m ? m[1].trim() : null; };
    const lim = chunk.match(/limit\s*:\s*\[\s*([\d.]+)\s*,\s*"?([\d.]+)"?\s*\]/);
    return { valueElem: (get('valueElem') || '').replace(/["']/g, ''), available: +get('available'),
      limitMin: lim ? +lim[1] : null, limit: lim ? +lim[2] : null, production: +get('production') };
  });

// R3 every full page: resource bar tooltips (exact storage, available, production as shown)
const resourceBarTooltips = (doc) => [...doc.querySelectorAll('#resTable img.tooltipHTML[title]')].map((img) => {
  const [name, html] = img.getAttribute('title').split('|');
  const t = new DOMParser().parseFromString(html || '', 'text/html');
  const val = (sel) => { const e = t.querySelector(sel); return e ? gzNum(e.textContent) : null; };
  return { name: name.replace(/[:\s]+/g, ' ').trim(), current: val('.current'), storage: val('.storage'), production: val('.production') };
});

// R4 every full page: planet temperature and fields from the planet list title (#planetList is duplicated: dedupe by cp)
const planetFacts = (doc) => {
  const seen = new Map();
  for (const a of doc.querySelectorAll('.smallplanet a.planetlink[href*="cp="]')) {
    const cp = +new URL(a.href, 'https://x/').searchParams.get('cp');
    if (seen.has(cp)) continue;
    const t = new DOMParser().parseFromString(a.getAttribute('title') || '', 'text/html').body.textContent.replace(/\s+/g, ' ');
    const temp = t.match(/(-?\d+)\s*°C to (-?\d+)\s*°C/), fields = t.match(/\((\d+) \/ (\d+)\)/), co = t.match(/\[(\d+):(\d+):(\d+)\]/);
    seen.set(cp, { cp, coords: co ? co.slice(1).map(Number) : null, tMin: temp ? +temp[1] : null, tMax: temp ? +temp[2] : null,
      fieldsUsed: fields ? +fields[1] : null, fieldsMax: fields ? +fields[2] : null, active: a.classList.contains('active') });
  }
  return [...seen.values()];
};

// R5 page=buildings | research | shipyard: levels by element id (two markups: buildings span.level[data-value], research a.detail_button .level)
const elementLevels = (doc) => {
  const out = {};
  for (const li of doc.querySelectorAll('li.technology[data-technology]')) {
    const id = +li.dataset.technology, lv = li.querySelector('span.level');
    if (!lv) continue;
    out[id] = lv.dataset.value != null ? +lv.dataset.value : gzNum(lv.textContent);
  }
  return out;
};

// R6 page=officier: officer levels "18/20" -> {601: {level: 18, max: 20}}
const officerLevels = (doc) => Object.fromEntries([...doc.querySelectorAll('a.detail_button[data-technology]')]
  .map((a) => [a, (a.querySelector('.level') || {}).textContent || ''])
  .filter(([, t]) => /\d+\s*\/\s*\d+/.test(t))
  .map(([a, t]) => { const m = t.match(/(\d+)\s*\/\s*(\d+)/); return [+a.dataset.technology, { name: a.title, level: +m[1], max: +m[2] }]; }));

// R7 page=resources: infer universe multipliers from the production table (2Moons formulas, install.sql vars)
const inferEconomy = (doc) => {
  const rows = productionTable(doc), tickers = resourceTickers(doc);
  const tMax = planetFacts(doc).find((p) => p.active).tMax;
  const f = (k, L) => k * L * Math.pow(1.1, L);
  const row = (id) => rows.find((r) => r.id === id);
  const m = row(1), c = row(2), d = row(3), s = row(4), sat = row(212);
  const basic = rows[0], bonus = rows[rows.length - 5], total = rows[rows.length - 3];
  return {
    tMax,
    resourceMultiplier: { fromMetalMine: m.metal / f(30, m.level), fromCrystalMine: c.crystal / f(20, c.level),
      fromDeutRefinery: d.deuterium / (f(10, d.level) * (-0.002 * tMax + 1.28)), fromBasicIncome: [basic.metal / 20, basic.crystal / 10] },
    energySpeed: { fromSolarPlant: s.energy / f(20, s.level), fromMetalMineUse: m.energy / -f(10, m.level),
      fromSatellites: sat.energy / ((tMax + 160) / 6 * sat.level) },
    bonusShare: { metal: bonus.metal / m.metal, crystal: bonus.crystal / c.crystal, deuterium: bonus.deuterium / d.deuterium,
      energy: bonus.energy / (s.energy + sat.energy) },
    totalCheck: { metalRowsSum: basic.metal + m.metal + bonus.metal, metalTotalRow: total.metal, tickerProduction: tickers[0].production },
  };
};

// R8 any full page + storage levels from page=buildings: storage multiplier = limit / upstream formula
const storageMultiplier = (doc, levels) => {
  const st = (L) => Math.floor(2.5 * Math.pow(1.8331954764, L)) * 5000;
  return resourceTickers(doc).slice(0, 3).map((t, i) => {
    const L = levels[22 + i];
    return { res: 901 + i, storageLevel: L, limit: t.limit, upstreamFormula: st(L), multiplier: t.limit / st(L) };
  });
};

// R9 page=messages (spy reports): are the spied resources exactly at a storage cap 5 x formula(L)?
const spyResourceCaps = (doc) => [...doc.querySelectorAll('.spyRaport')].map((rep) => {
  const st = (L) => Math.floor(2.5 * Math.pow(1.8331954764, L)) * 5000;
  const head = rep.querySelector('.spyRaportHead').textContent.trim();
  const box = rep.querySelector('.spyRaportContainerHeadClass900').parentElement;
  const cells = [...box.querySelectorAll('.spyRaportContainerCell')].map((c) => c.textContent.trim());
  const res = {};
  for (let i = 0; i + 1 < cells.length; i += 2) res[cells[i]] = gzNum(cells[i + 1]);
  const capLevel = (v) => { for (let L = 0; L < 60; L++) if (5 * st(L) === v) return L; return null; };
  return { head, res, atCap5xLevel: Object.fromEntries(['Metal', 'Crystal', 'Deuterium'].map((k) => [k, capLevel(res[k])])) };
});

// R10 page=fleetStep1: universe fleet constants from the inline data = {...}
const fleetStep1Data = (doc) => {
  const m = [...doc.scripts].map((s) => s.textContent).join('\n').match(/^\s*data\s*=\s*(\{.*\});\s*$/m);
  const data = m ? JSON.parse(m[1]) : null;
  return data && { gamespeed: data.gamespeed, fleetSpeedConfig: data.gamespeed * 2500, fleetspeedfactor: data.fleetspeedfactor,
    fleetMinDuration: data.fleetMinDuration, fleetroom: +data.fleetroom, ships: data.ships };
};

// R11 page=overview (any page with the event box): own Recycle fleet, outward arrival vs return end -> one-way flight seconds
const harvestFlight = (doc) => {
  const seen = new Map();
  for (const s of doc.querySelectorAll('span.fleets[id^="fleettime_"][data-fleet-end-time]')) {
    const line = s.parentElement.querySelector('span.flight, span.return');
    if (!line || !/harvest/.test(line.className) || seen.has(s.id)) continue;
    seen.set(s.id, { end: +s.dataset.fleetEndTime, status: line.classList.contains('return') ? 'return' : 'flight',
      blind: (line.querySelector('.textForBlind') || {}).textContent, coords: [...line.querySelectorAll('a[href*="page=galaxy"]')].map((a) => a.textContent) });
  }
  const ev = [...seen.values()], out = ev.find((e) => e.status === 'flight'), back = ev.find((e) => e.status === 'return');
  return { events: ev, oneWaySeconds: out && back ? back.end - out.end : null };
};

// R12 page=fleetTable: slots, expeditions, bonus table (tech x10 + officer %)
const fleetTableFacts = (doc) => {
  const divs = [...doc.querySelectorAll('.fleetTablemain th[colspan="9"] > div.transparent')].map((d) => d.textContent.replace(/\s+/g, ' ').trim());
  const pair = (s) => (s.match(/(\d+)\s*\/\s*(\d+)/) || []).slice(1).map(Number);
  const bonus = Object.fromEntries([...doc.querySelectorAll('.fleetTablemain table.hard-table img.tooltipTop[title]')]
    .map((i) => [i.getAttribute('src').match(/([a-z]+)\.png$/)[1], +i.title.match(/(-?\d+)\s*%$/)[1]]));
  const speeds = Object.fromEntries([...doc.querySelectorAll('td[id^="ship"][id$="_value"]')].map((td) => {
    const sp = td.parentElement.querySelector('span.tooltip[data-tooltip-content]');
    return [+td.id.match(/\d+/)[0], sp ? +sp.dataset.tooltipContent.replace(/\D/g, '') : null];
  }));
  return { slots: pair(divs[0]), expeditions: pair(divs[1]), asteroids: pair(divs[2]), bonus, speeds };
};

// R13 page=fleetDealer: the server's own price table var CostInfo = {id: [amountOnPlanet, name, {901..921: "cost"}]}
const costInfo = (doc) => {
  const s = [...doc.scripts].find((x) => /CostInfo\s*=/.test(x.textContent));
  const m = s && s.textContent.match(/CostInfo\s*=\s*(\{.*?\});/s);
  return m ? Object.fromEntries(Object.entries(JSON.parse(m[1])).map(([id, [n, name, c]]) => [id, { name, cost: Object.fromEntries(Object.entries(c).filter(([, v]) => +v).map(([k, v]) => [k, +v])) }])) : null;
};

// R14 page=trader: exchange rate text and merchant fee
const traderFacts = (doc) => {
  const txt = doc.body.textContent.replace(/\s+/g, ' ');
  return { rate: (txt.match(/exchange rate is:\s*([\d/.,]+)/) || [])[1] || null, fee: (txt.match(/merchant is ([\d.]+) Dark Matter/) || [])[1] || null };
};

// R15 page=galaxy: expedition position from the prefill link (= max_planets + 1)
const expeditionPosition = (doc) => [...new Set([...doc.querySelectorAll('a[href*="target_mission=15"]')].map((a) => +new URL(a.href).searchParams.get('planet')))];

if (typeof module !== 'undefined') module.exports = { gzNum, productionTable, resourceTickers, resourceBarTooltips, planetFacts, elementLevels,
  officerLevels, inferEconomy, storageMultiplier, spyResourceCaps, fleetStep1Data, harvestFlight, fleetTableFacts, costInfo, traderFacts, expeditionPosition };
