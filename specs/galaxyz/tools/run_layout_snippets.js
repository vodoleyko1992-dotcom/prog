// Runs the copy-paste snippets of layout.md (JS disabled, raw saved DOM) on real pages and prints their output.
// Usage: node tools/run_layout_snippets.js [page.html ...]   (default overview.html)
const { chromium } = require('playwright');
const path = require('path');
const DIR = path.resolve(__dirname, '../../../../eu/pages');
const S = {
detect: `(() => {
  const gen = document.querySelector('meta[name="generator"]')?.content || '';
  const scripts = [...document.scripts].map(s => s.textContent).join('\\n');
  return { gen, genOk: /^(GALAXYZ|2Moons)\\b/i.test(gen), selector: !!document.querySelector('#planetSelector'),
    serverTime: /\\bserverTime\\s*=\\s*new Date\\(/.test(scripts), ticker: /resourceTicker\\(\\{/.test(scripts),
    bodyClass: document.body.className };
})()`,
route: `(() => {
  const qs = ([...document.scripts].map(s => s.textContent).join('\\n').match(/var\\s+queryString\\s*=\\s*"([^"]*)"/) || [])[1];
  const q = new URLSearchParams(qs || location.search);
  return { queryString: qs, page: q.get('page'), mode: q.get('mode'), bodyId: document.body.id, title: document.title.split(' - ')[0],
    infoPage: !document.querySelector('#rechts') && !!document.querySelector('#inhalt > .headerRS + .mainRS') };
})()`,
current: `(() => {
  const o = document.querySelector('#planetSelector option[selected]');
  const c = o.textContent.match(/\\[(\\d+):(\\d+):(\\d+)\\]/);
  return { id: +o.value, text: o.textContent, coords: c.slice(1).map(Number), isMoon: /\\((Moon|Mond|Luna|Луна)\\)\\s*\\[/.test(o.textContent),
    image: document.querySelector('#planetImage img')?.getAttribute('src').match(/s_([a-z]+\\d*)\\./i)?.[1] };
})()`,
planetsSelect: `[...document.querySelectorAll('#planetSelector option')].map(o => o.value + ' | ' + o.textContent.trim())`,
planetList: `[...document.querySelectorAll('#myWorlds .smallplanet')].map(sp => {
  const a = sp.querySelector('a.planetlink'), t = a.getAttribute('title');
  return { cp: +new URL(a.href, location.href).searchParams.get('cp'), name: sp.querySelector('.planet-name').textContent.trim(),
    coords: sp.querySelector('.planet-koords').textContent.trim(), active: a.classList.contains('active'),
    building: !!sp.querySelector('i.buildingIco'),
    temp: t.match(/(-?\\d+)°C to (-?\\d+)°C/).slice(1).map(Number),
    fields: t.match(/([\\d.]+) km \\((\\d+) \\/ (\\d+)\\)/).slice(1).map(s => +s.replace(/\\./g, '')) };
})`,
countColonies: `document.querySelector('#countColonies').textContent.trim().replace(/\\s+/g, ' ').match(/\\[(\\d+) \\/ (\\d+)\\]/).slice(1).map(Number)`,
ticker: `(() => {
  const src = [...document.scripts].map(s => s.textContent).join('\\n'), out = {};
  for (const m of src.matchAll(/resourceTicker\\(\\{\\s*available:\\s*\\(([-\\d.eE+]+)\\),\\s*limit:\\s*\\[0,\\s*"([-\\d.eE+]+)"\\],\\s*production:\\s*([-\\d.eE+]+),\\s*valueElem:\\s*"current_(\\w+)"/g))
    out[m[4]] = { amount: +m[1], storage: +m[2], perHour: +m[3] };
  return out;
})()`,
headerCells: `['metal','crystal','deuterium','darkmatter'].map(k => { const td = document.getElementById('current_' + k);
  return k + ': data-real=' + td.dataset.real + ' tooltip=' + td.dataset.tooltipContent + ' text=' + JSON.stringify(td.textContent.trim()); })`,
resTooltip: `(() => {
  const t = document.querySelector('img[data-currentname="current_Metal"]').getAttribute('title');
  const d = new DOMParser().parseFromString(t.split('|')[1], 'text/html');
  const n = c => +d.querySelector('.' + c).textContent.trim().replace(/\\./g, '');
  return { current: n('current'), storage: n('storage'), production: n('production') };
})()`,
energy: `(() => {
  const td = document.querySelector('#resTable td.res_current[t]');
  const [free, total] = td.getAttribute('t').split('/').map(s => +s.trim().replace(/\\./g, ''));
  return { t: td.getAttribute('t'), text: td.textContent.trim().replace(/\\s+/g, ' '), free, production: total, consumption: total - free };
})()`,
time: `(() => {
  const src = [...document.scripts].map(s => s.textContent).join('\\n');
  const m = src.match(/serverTime\\s*=\\s*new Date\\((\\d+),\\s*(\\d+),\\s*(\\d+),\\s*(\\d+),\\s*(\\d+),\\s*(\\d+)\\)/).slice(1).map(Number);
  const wall = Date.UTC(...m);                         // server wall clock read as if it were UTC (month is already 0-based)
  const ev = document.querySelector('.fleets[data-fleet-end-time][data-fleet-time]');
  const renderUnix = ev ? +ev.dataset.fleetEndTime - +ev.dataset.fleetTime : null;
  return { args: m, offsetVar: +src.match(/ServerTimezoneOffset\\s*=\\s*(-?\\d+)/)[1], clock: document.querySelector('#clock').textContent,
    renderUnix, serverUtcOffsetH: renderUnix ? Math.round((wall / 1000 - renderUnix) / 900) / 4 : null };
})()`,
player: `(() => ({
  name: document.querySelector('#playerName .textBeefy').textContent.trim(),
  rank: +new URL(document.querySelector('#bar a[href*="page=statistics"]').href).searchParams.get('range'),
  unread: +document.querySelector('.messages-section .new-msg-count')?.textContent.trim() || 0,
  vacation: +[...document.scripts].map(s => s.textContent).join('').match(/var\\s+vacation\\s*=\\s*(\\d+)/)[1],
  idFromPlayercard: (() => { const n = document.querySelector('#playerName .textBeefy').textContent.trim();
    for (const a of document.querySelectorAll('a[onclick*="Dialog.Playercard("]')) { const m = a.getAttribute('onclick').match(/Playercard\\((\\d+),\\s*'([^']*)'/); if (m && m[2] === n) return +m[1]; } return null; })(),
}))()`,
overviewScore: `(() => { const t = document.querySelector('#scoreContentField').textContent.replace(/\\s+/g, ' ').trim();
  const m = t.match(/^([\\d.]+) \\(\\D*(\\d+)\\D+([\\d.]+)\\)/); return { text: t, points: +m[1].replace(/\\./g, ''), rank: +m[2], players: +m[3].replace(/\\./g, '') }; })()`,
overviewPlanet: `({ name: document.querySelector('#planetNameHeader').textContent.trim(),
  diameter: document.querySelector('#diameterContentField').textContent.replace(/\\s+/g, ' ').trim(),
  temp: document.querySelector('#temperatureContentField').textContent.replace(/\\s+/g, ' ').trim(),
  pos: document.querySelector('#positionContentField a').textContent, online: +document.querySelector('.online-title span').textContent,
  moon: document.querySelector('#moon').innerHTML.trim() })`,
overviewBoxes: `[...document.querySelectorAll('#inhalt > .content-box-s')].map(b => ({ h3: b.querySelector('h3').textContent.trim(),
  idle: !!b.querySelector('td.idle'), link: b.querySelector('a[href*="page="]')?.href.split('?')[1], timer: b.querySelector('.timer[data-time]')?.dataset.time ?? null }))`,
events: `(() => { const seen = new Set();
  return [...document.querySelectorAll('#messages_collapsed .OvfleetEvents_ > span.fleets[id^="fleettime_"]')].filter(s => !seen.has(s.id) && seen.add(s.id)).map(s => {
    const line = s.parentElement.querySelector('span.flight, span.return, span.holding');
    return { id: s.id, end: +s.dataset.fleetEndTime, rest: +s.dataset.fleetTime, clock: s.nextElementSibling.textContent,
      cls: line.className, coords: [...line.querySelectorAll('a[href*="page=galaxy"]')].map(a => a.textContent),
      blind: [...line.querySelectorAll('.textForBlind')].map(b => b.textContent.trim()) };
  }); })()`,
duplicates: `(() => { const c = {}; for (const e of document.querySelectorAll('[id]')) c[e.id] = (c[e.id] || 0) + 1;
  return Object.fromEntries(Object.entries(c).filter(([, n]) => n > 1)); })()`,
menu: `[...document.querySelectorAll('#menuTable > li')].map(li => (li.querySelector('.menu_icon a')?.className.split(' ')[0] || li.querySelector('.menu_icon img, .menu_icon div') ?.tagName) + ' -> ' + new URL(li.querySelector('a.menubutton').href).search + ' "' + li.querySelector('.textlabel').textContent.trim() + '"')`,
anchors: `(() => { const r = s => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().width) + 'px' : null; };
  return { menuTable: !!document.querySelector('#links > ul#menuTable'), links: r('#links'), inhalt: r('#inhalt'), rechts: r('#rechts'), bar: !!document.querySelector('#bar > ul'), footerRight: !!document.querySelector('#siteFooter .fright') }; })()`,
};
(async () => {
  const files = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
  const b = await chromium.launch(); const ctx = await b.newContext({ javaScriptEnabled: false });
  for (const f of files.length ? files : ['overview.html']) {
    const p = await ctx.newPage();
    await p.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
    await p.goto('file://' + path.join(DIR, f), { waitUntil: 'domcontentloaded' });
    console.log('=== ' + f);
    for (const [k, code] of Object.entries(S)) {
      if (only.length && !only.includes(k)) continue;
      let v; try { v = await p.evaluate(code); } catch (e) { v = 'ERROR ' + e.message.split('\n')[0]; }
      console.log('--- ' + k + '\n' + JSON.stringify(v, null, only.length ? 0 : 1));
    }
    await p.close();
  }
  await b.close();
})();
