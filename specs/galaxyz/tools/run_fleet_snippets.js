// Runs the copy-paste snippets of fleet.md (Chromium, JS disabled, raw saved DOM) on the real pages and prints their output.
// Usage: NODE_PATH=$(npm root -g) node tools/run_fleet_snippets.js [--only=a,b]
// Each snippet is evaluated in the page as an expression; output is JSON, one line per result.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const DIR = path.resolve(__dirname, '../../../../eu/pages');

const SCRIPT_DATA = `(doc => { const m = [...doc.scripts].map(s => s.textContent).join('\\n').match(/^\\s*data\\s*=\\s*(\\{.*\\});\\s*$/m); return m ? JSON.parse(m[1]) : null; })`;
const NUM = `(s => +String(s).replace(/\\./g, '').replace(',', '.').trim())`;

// [name, pages, expression]
const S = [
['fleetTableHeader', ['fleetTable.html'], `(() => {
  const divs = [...document.querySelectorAll('.fleetTablemain th[colspan="9"] > div.transparent')].map(d => d.textContent.replace(/\\s+/g, ' ').trim());
  const pair = s => s.match(/(\\d+)\\s*\\/\\s*(\\d+)/).slice(1).map(Number);
  return { divs, slots: pair(divs[0]), expeditions: pair(divs[1]), asteroids: pair(divs[2]) };
})()`],
['fleetTableMovements', ['fleetTable.html'], `[...document.querySelectorAll('.fleetTablemain table.listOfOthers tr')].filter(tr => tr.cells.length === 9 && tr.cells[0].tagName === 'TD' && /^\\d+$/.test(tr.cells[0].textContent.trim())).map(tr => {
  const c = tr.cells, tip = c[2].querySelector('a.tooltip_sticky');
  const ships = {}; if (tip) { const d = new DOMParser().parseFromString(tip.dataset.tooltipContent, 'text/html');
    for (const r of d.querySelectorAll('tr')) { const td = r.querySelectorAll('td'); if (td.length === 2) ships[td[0].textContent.replace(/:$/, '').trim()] = +td[1].textContent.replace(/\\./g, ''); } }
  const timer = c[7].querySelector('[id^="fleettime_"]') || c[7];
  const form = c[8].querySelector('form[action*="action=sendfleetback"]');
  return { row: +c[0].textContent, mission: c[1].firstChild.textContent.trim(), state: c[1].querySelector('a')?.textContent.trim() ?? null,
    amount: +c[2].textContent.trim().replace(/\\./g, ''), ships,
    from: c[3].textContent.trim(), arriveText: c[4].textContent.trim(), outward: /lime/.test(c[4].getAttribute('style') || ''),
    to: c[5].textContent.trim(), backText: c[6].textContent.trim(),
    backUnix: +timer.dataset.fleetEndTime, restSec: +timer.dataset.fleetTime,
    fleetId: form ? +form.querySelector('input[name=fleetID]').value : null, recallUrl: form?.getAttribute('action') ?? null };
})`],
['fleetTableShips', ['fleetTable.html'], `(() => {
  const form = document.querySelector('form[action*="page=fleetStep1"]');
  const hidden = Object.fromEntries([...form.querySelectorAll('input[type=hidden]')].map(i => [i.name, i.value]));
  const ships = [...form.querySelectorAll('td[id^="ship"][id$="_value"]')].map(td => {
    const id = +td.id.match(/^ship(\\d+)_value$/)[1], row = td.parentElement, sp = row.querySelector('span.tooltip[data-tooltip-content]');
    return { id, name: row.querySelector('img').alt, count: +td.textContent.trim().replace(/\\./g, ''),
      speed: sp ? +sp.dataset.tooltipContent.replace(/\\D/g, '') : null, input: row.querySelector('input[name="ship' + id + '"]')?.id ?? null };
  });
  return { action: form.getAttribute('action'), hidden, ships };
})()`],
['fleetTableBonus', ['fleetTable.html'], `Object.fromEntries([...document.querySelectorAll('.fleetTablemain table.hard-table img.tooltipTop[title]')].map(i => {
  const m = i.title.match(/^(.*?)\\s*\\+?(-?\\d+)\\s*%$/); return [i.getAttribute('src').match(/([a-z]+)\\.png$/)[1], +m[2]]; }))`],
['step1', ['fleetStep1.html'], `(() => {
  const f = document.querySelector('form#form[action*="page=fleetStep2"]');
  const fields = {}; for (const el of f.querySelectorAll('input[name], select[name]')) if (!/^shortcut/.test(el.name)) fields[el.name] = el.value;
  return { action: f.getAttribute('action'), fields, speeds: [...f.querySelectorAll('#speed option')].map(o => o.value + '=' + o.textContent + '%'),
    types: [...f.querySelectorAll('#type option')].map(o => o.value + '=' + o.textContent),
    shown: Object.fromEntries(['distance', 'duration', 'arrival', 'return', 'consumption', 'maxspeed', 'storage'].map(k => [k, document.getElementById(k)?.textContent.trim()])),
    colonies: [...f.querySelectorAll('a[href^="javascript:setTarget("]')].map(a => a.getAttribute('href').match(/setTarget\\(([\\d,]+)\\)/)[1] + ' ' + a.textContent.replace(/\\s+/g, ' ').trim()),
    data: ${SCRIPT_DATA}(document) };
})()`],
['step1Formulas', ['fleetStep1.html'], `(() => {
  const data = ${SCRIPT_DATA}(document);
  const dist = (a, b) => a[0] != b[0] ? Math.abs(a[0] - b[0]) * 20000 : a[1] != b[1] ? Math.abs(a[1] - b[1]) * 95 + 2700 : a[2] != b[2] ? Math.abs(a[2] - b[2]) * 5 + 1000 : 5;
  const duration = (speed10, d) => Math.max(Math.round((3500 / (speed10 * 0.1) * Math.sqrt(d * 10 / data.maxspeed) + 10) / data.gamespeed) * data.fleetspeedfactor, data.fleetMinDuration);
  const consumption = (sec, d) => { let c = 0; for (const s of Object.values(data.ships)) { const spd = 35000 / (sec * data.gamespeed - 10) * Math.sqrt(d * 10 / s.speed); c += s.consumption * s.amount * d / 35000 * (spd / 10 + 1) ** 2; } return Math.round(c) + 1; };
  const from = [+data.planet.galaxy, +data.planet.system, +data.planet.planet];
  const out = {};
  for (const [label, to] of [['same planet (page default)', from], ['[2:68:9] (sent, see step3)', [2, 68, 9]], ['[2:70:5]', [2, 70, 5]], ['[3:68:5]', [3, 68, 5]]]) {
    const d = dist(from, to), t = duration(10, d); out[label] = { distance: d, durationSec: t, consumption: consumption(t, d), storage: data.fleetroom - consumption(t, d) };
  }
  return out;
})()`],
['step2', ['fleetStep2.html'], `(() => {
  const f = document.querySelector('form[action*="page=fleetStep3"]');
  return { action: f.getAttribute('action'), h2: document.querySelector('#inhalt h2')?.textContent.trim(),
    token: f.querySelector('input[name=token]').value,
    missions: [...f.querySelectorAll('input[type=radio][name=mission]')].map(r => ({ id: +r.value, label: f.querySelector('label[for="' + r.id + '"]')?.textContent.trim(), checked: r.checked })),
    staytime: [...f.querySelectorAll('select[name=staytime] option')].map(o => o.value),
    resourceInputs: [...f.querySelectorAll('input[name=metal], input[name=crystal], input[name=deuterium]')].map(i => i.name),
    capacityLeft: +document.getElementById('remainingresources').textContent.trim().replace(/\\./g, ''),
    consumption: +document.getElementById('consumption').textContent.trim().replace(/\\./g, ''),
    fleetPoints: +document.getElementById('fleetPoints')?.textContent.trim().replace(/\\./g, ''),
    data: ${SCRIPT_DATA}(document) };
})()`],
['step3', ['fleetStep3.html'], `(() => {
  const t = document.querySelector('#inhalt .mainRS table, .mainRS > table');
  const ok = t?.querySelector('th.success'); if (!ok) return { ok: false };
  const rows = [...t.rows], fleetAt = rows.findIndex((r, i) => i > 0 && r.cells.length === 1 && r.cells[0].tagName === 'TH');
  const kv = rows.slice(1, fleetAt).map(r => [r.cells[0].textContent.trim(), r.cells[1].textContent.trim()]);
  const ships = Object.fromEntries(rows.slice(fleetAt + 1).map(r => [r.cells[0].textContent.trim(), +r.cells[1].textContent.trim().replace(/\\./g, '')]));
  const refresh = document.querySelector('meta[http-equiv="refresh" i]')?.content;
  return { ok: true, title: ok.textContent.trim(), kv, ships, refresh };
})()`],
['step3Dates', ['fleetStep3.html'], `(() => {
  const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const parse = s => { const m = s.match(/^(\\d{1,2})\\. (\\w{3}) (\\d{4}), (\\d\\d):(\\d\\d):(\\d\\d)$/); return m && Date.UTC(+m[3], months[m[2]], +m[1], +m[4], +m[5], +m[6]) / 1000; };
  const cells = [...document.querySelectorAll('.mainRS table tr')].map(r => [...r.cells].map(c => c.textContent.trim()));
  const get = i => cells.find(r => r.length === 2 && /^\\d{1,2}\\. \\w{3} \\d{4}, /.test(r[1]) && (i-- === 0))?.[1];
  const src = [...document.scripts].map(s => s.textContent).join('\\n');
  const st = src.match(/serverTime\\s*=\\s*new Date\\((\\d+),\\s*(\\d+),\\s*(\\d+),\\s*(\\d+),\\s*(\\d+),\\s*(\\d+)\\)/).slice(1).map(Number);
  const now = Date.UTC(...st) / 1000, arrive = parse(get(0)), back = parse(get(1));
  return { serverWall: st, target: get(0), back: get(1), oneWaySec: arrive - now, returnLegSec: back - arrive };
})()`],
['transport', ['transport.html'], `(() => {
  const box = document.querySelector('#inhalt > .mainRS table.hard-table td img[src*="warning"]')?.closest('td');
  return { infoPage: !document.querySelector('#rechts'), header: document.querySelector('#inhalt > .headerRS')?.textContent.trim(),
    error: box ? box.querySelector('p').textContent.trim() : null, back: box?.querySelector('a')?.getAttribute('href') };
})()`],
['transportMenu', ['fleetTable.html'], `[...document.querySelectorAll('#menuTable a.menubutton[href*="page=transport"], #menuTable a[href*="page=transport"]')].map(a => a.className + ' -> ' + a.getAttribute('href'))`],
['admiralLevel', ['officier.html'], `(() => { const a = document.querySelector('a[data-technology="602"]'); return { title: a.title, level: a.querySelector('.level').textContent.trim() }; })()`],
['events', ['overview.html', 'fleetStep3.html'], `(() => { const seen = new Set();
  return [...document.querySelectorAll('#messages_collapsed .OvfleetEvents_ > span.fleets[id^="fleettime_"]')].filter(s => !seen.has(s.id) && seen.add(s.id)).map(s => {
    const line = s.parentElement.querySelector('span.flight, span.return, span.holding');
    const [, status, style] = line.className.match(/^(flight|return|holding)\\s+(\\S+)/);
    const k = s.id.slice('fleettime_'.length), end = s.dataset.fleetEndTime;
    return { fleetId: +k.slice(end.length), end: +end, rest: +s.dataset.fleetTime, status, own: style.startsWith('own'), style: style.replace(/^own/, ''),
      coords: [...line.querySelectorAll('a[href*="page=galaxy"]')].map(a => a.textContent),
      ships: line.querySelector('a[data-tooltip-content]') ? [...new DOMParser().parseFromString(line.querySelector('a[data-tooltip-content]').dataset.tooltipContent, 'text/html').querySelectorAll('tr')].map(r => r.textContent.replace(/\\s+/g, ' ').trim()) : [],
      blind: [...line.querySelectorAll('.textForBlind')].map(b => b.textContent.trim()), text: line.textContent.replace(/\\s+/g, ' ').trim() };
  }); })()`],
['eventSurvey', 'ALL', `(() => { const c = {}; for (const l of document.querySelectorAll('#messages_collapsed .OvfleetEvents_ span.flight, #messages_collapsed .OvfleetEvents_ span.return, #messages_collapsed .OvfleetEvents_ span.holding')) c[l.className] = (c[l.className] || 0) + 1;
  return { events: new Set([...document.querySelectorAll('#messages_collapsed span.fleets[id^="fleettime_"]')].map(s => s.id)).size, classes: c,
    boxes: document.querySelectorAll('[id=OvfleetEvents]').length, fleetsSpansOutsideBox: [...document.querySelectorAll('.fleets')].filter(e => !e.closest('#messages_collapsed')).length }; })()`],
['galaxyPrefill', ['galaxy.html'], `[...new Set([...document.querySelectorAll('a[href*="page=fleetTable&"][href*="target_mission="]')].map(a => { const q = new URL(a.href).searchParams; return [...q.keys()].join('&') + '  mission=' + q.get('target_mission'); }))]`],
['galaxyCounters', ['galaxy.html'], `({ probes: document.querySelector('#probes').textContent.replace(/\\s+/g, ' ').trim(), slots: document.querySelector('#slotValue').textContent.replace(/\\s+/g, ' ').trim(),
  recyclerSpans: [...document.querySelectorAll('[id=recycler]')].map(e => e.textContent.replace(/\\s+/g, ' ').trim()) })`],
['spyAttackLink', ['messages-spy.html'], `[...new Set([...document.querySelectorAll('a[href*="target_mission="]')].map(a => new URL(a.href).search))]`],
['ids', ['fleetTable.html', 'fleetStep1.html', 'fleetStep2.html', 'fleetStep3.html'], `(() => { const c = {}; for (const e of document.querySelectorAll('[id]')) c[e.id] = (c[e.id] || 0) + 1; return Object.fromEntries(Object.entries(c).filter(([, n]) => n > 1)); })()`],
];

(async () => {
  const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  await ctx.route('**/*', r => r.request().url().startsWith('file:') && r.request().resourceType() === 'document' ? r.continue() : r.abort());
  const page = await ctx.newPage();
  const all = fs.readdirSync(DIR).filter(f => f.endsWith('.html')).sort();
  for (const [name, pages, expr] of S) {
    if (only.length && !only.includes(name)) continue;
    for (const p of pages === 'ALL' ? all : pages) {
      await page.goto('file://' + path.join(DIR, p));
      let out; try { out = await page.evaluate(expr); } catch (e) { out = 'ERROR ' + e.message.split('\n')[0]; }
      console.log(`## ${name} ${p}\n${JSON.stringify(out)}`);
    }
  }
  await browser.close();
})();
