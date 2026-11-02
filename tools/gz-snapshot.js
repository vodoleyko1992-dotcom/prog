#!/usr/bin/env node
'use strict';
// GALAXYZ adapter check: serves the real saved pages (scratchpad/eu/pages/*.html) at
// http://127.0.0.1:<port>/Aeternum/game.php?page=<name>[&mode=<mode>], loads the extension's content scripts
// (MAIN-world page hook at document_start, then the core files of manifest.json) in Chromium and prints what the core
// understood: OGX.page.detect/info, the state snapshot, and the stores after OGX.boot (no modules).
//
//   node tools/gz-snapshot.js                      one line per page + negative detection checks
//   node tools/gz-snapshot.js overview fleetTable  only these files (names as in eu/pages without .html)
//   node tools/gz-snapshot.js --json overview      full snapshot JSON of the given pages
//   node tools/gz-snapshot.js --full               also load modules + loader.js and report the boot mark and page errors
//   OGX_GZ_PAGES=/path/to/pages node tools/gz-snapshot.js
// Exit code 1 when a real page is not detected or the snapshot misses the basics (current body, planets, resources).
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, 'ogamex-suite');
const PAGES = process.env.OGX_GZ_PAGES || path.resolve(ROOT, '..', 'eu', 'pages');
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const only = args.filter((a) => !a.startsWith('--'));

const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const mainFiles = manifest.content_scripts.filter((c) => c.world === 'MAIN').flatMap((c) => c.js);
const isoFiles = manifest.content_scripts.filter((c) => c.world !== 'MAIN').flatMap((c) => c.js);
const coreFiles = isoFiles.filter((f) => f.startsWith('shared/core/'));
const read = (f) => fs.readFileSync(path.join(EXT, f), 'utf8');

/** eu/pages file name -> query of the live URL (README: filename = ?page=[-mode]). */
function queryFor(name) {
  const [pg, mode] = name.split('-');
  if (pg === 'messages') return 'page=messages&_f=' + name;          // spy/all share one URL (category loaded by AJAX)
  return 'page=' + pg + (mode ? '&mode=' + mode : '');
}

function startServer() {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };
    if (u.pathname === '/Aeternum/game.php') {
      const name = u.searchParams.get('_f') || (u.searchParams.get('page') || 'overview') + (u.searchParams.get('mode') ? '-' + u.searchParams.get('mode') : '');
      const file = path.join(PAGES, path.basename(name) + '.html');
      if (!fs.existsSync(file)) return send(404, 'text/plain', 'no page ' + name);
      // fleetStep3 refreshes to fleetTable after 3 s: keep the page under test
      const html = fs.readFileSync(file, 'utf8').replace(/<meta http-equiv="refresh"[^>]*>/i, '');
      return send(200, 'text/html; charset=UTF-8', html);
    }
    if (u.pathname === '/Aeternum/index.php') return send(200, 'text/html', '<html><head><title>Login</title></head><body><form id="login"></form></body></html>');
    if (u.pathname === '/Aeternum/game2.php') return send(200, 'text/html', fs.readFileSync(path.join(PAGES, 'overview.html'), 'utf8'));
    if (u.pathname === '/other') return send(200, 'text/html', '<html><head><meta name="generator" content="WordPress 6"></head><body><select id="planetSelector"></select></body></html>');
    send(404, 'text/plain', 'not found');
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

async function loadCore(page, files) {
  for (const f of files) {
    await page.evaluate(([src, name]) => { try { (0, eval)(src + '\n//# sourceURL=ogx://' + name); } catch (e) { console.error('[gz-snapshot] ' + name + ': ' + (e && e.stack || e)); } }, [read(f), f]);
  }
}

// Runs in the page: compact summary of what the core understood.
async function summarize(page, { json }) {
  return page.evaluate(async (wantJson) => {
    const det = OGX.page.detect(document, location);
    if (!det.ok) return { det };
    OGX.page.setEngine(det.engine);
    const info = OGX.page.info();
    const s = OGX.state.snapshotSync(document);
    if (wantJson) return { det, info: Object.assign({}, info, { query: String(info.query) }), snap: s };
    const r = s.inline || {};
    const short = (x) => (x == null ? null : Math.round(x));
    const out = {
      det: det.engine + ' ' + det.version,
      route: info.name + (info.aliases.length ? '(' + info.aliases.join('/') + ')' : '') + ' raw=' + info.raw + (info.mode ? '&' + info.mode : '') + (info.step ? ' step' + info.step : '') + (info.info ? ' INFO' : ''),
      time: s.serverTimeString + ' render=' + s.renderUnix,
      cur: s.current && (s.current.key + ' ' + s.current.coords + ' "' + s.current.name + '"'),
      planets: (s.planets || []).map((p) => p.planetId + (p.diameter ? '' : '?') + (p.building ? '*' : '')).join(','),
      count: s.planetCount ? s.planetCount.used + '/' + s.planetCount.max : null,
      res: r.metal ? ['metal', 'crystal', 'deuterium'].map((k) => short(r[k].amount) + '/' + short(r[k].storage) + '@' + short(r[k].perHour)).join(' ') : null,
      energy: s.tooltips && s.tooltips.energy ? s.tooltips.energy.available + '/' + s.tooltips.energy.production : null,
      dm: r.darkmatter,
      player: s.player.name + '#' + s.player.rank + ' id=' + s.player.id + ' msg=' + s.player.unreadMessages,
      events: (s.events || []).map((e) => (e.own ? '' : '!') + e.status[0] + e.mission + ':' + e.from + '>' + e.to + ' f' + e.fleetId).join(' '),
    };
    if (s.techList) out.tech = s.techList.length + ' items, on=' + s.techList.filter((t) => t.status === 'on').length + ' off=' + s.techList.filter((t) => t.status === 'off').length + ' e.g. ' + s.techList.slice(0, 3).map((t) => t.id + ':' + t.value + ':' + t.status).join(' ');
    if (s.queues) out.queues = JSON.stringify({ b: s.queues.building, r: s.queues.research, u: s.queues.unit, known: s.queues.known });
    if (s.overviewInfo) { const o = s.overviewInfo; out.overview = `${o.diameter}km ${o.fieldsUsed}/${o.fieldsMax} ${o.tempMin}..${o.tempMax}C ${o.coords} pts=${o.points} rank=${o.rank}/${o.players} boxes=${o.constructions.map((b) => b.box + (b.idle ? ':idle' : ':busy')).join(',')}`; }
    if (s.resourceSettings) out.settings = JSON.stringify(s.resourceSettings.percents);
    if (s.fleetPage) { const f = s.fleetPage; out.fleet = `slots=${JSON.stringify(f.slots)} exp=${JSON.stringify(f.expSlots)} ships=${JSON.stringify(f.shipsOnPlanet)} speed=${f.speedFactors.war} flights=${f.gz.fleetTable.flights.map((x) => x.fleetId + ':' + x.missionId + (x.recallable ? 'R' : '')).join(',')}` + (f.gz.step1 ? ' step1 token=' + (f.gz.step1.token ? f.gz.step1.token.slice(0, 6) + '…' : null) + ' gamespeed=' + (f.gz.step1.data && f.gz.step1.data.gamespeed) : '') + (f.gz.step2 ? ' step2 missions=' + f.gz.step2.missions.map((m) => m.id).join(',') + ' cons=' + f.gz.step2.consumption : ''); }
    if (s.empire) out.empire = 'cols=' + s.empire.columns.map((c) => c.cp).join(',') + ' m38?=' + (s.empire.bodies[s.empire.columns[0].cp] || {}).buildings[1] + ' res106=' + s.empire.research[106] + ' warn=' + s.empire.warnings.length;
    if (s.officers) out.officers = 'dm=' + s.officers.darkMatter + ' ' + s.officers.officers.map((o) => o.id + ':' + o.level + '/' + o.max).join(' ');
    if (s.infoMessage) out.info = s.infoMessage;
    if (OGX.page.engine === 'galaxyz') {
      out.urls = [OGX.page.url('/fleet', { galaxy: 2, system: 68, position: 9, type: 1, mission: 7 }), OGX.page.url('fleetStep1'), OGX.page.url('/defense')]
        .map((u) => u.replace(location.origin, '')).join(' ');
    }
    return out;
  }, !!json);
}

// Boot the core (no modules) and read the stores: proves storage identity, time calibration and state.merge.
async function bootAndRead(page) {
  return page.evaluate(async () => {
    try { localStorage.clear(); } catch (e) { /* ignore */ }
    await OGX.boot({ ext: 'suite', modules: [] });
    await OGX.storage.flush();
    const bodies = await OGX.state.bodies();
    const cur = OGX.state.current();
    const b = cur && bodies[cur.key];
    const pl = await OGX.state.player();
    const research = await OGX.state.research();
    const slots = await OGX.state.slots();
    const server = await OGX.state.server();
    return {
      mark: document.documentElement.dataset.ogxSuite || null,
      ns: OGX.storage.ns.host + '|' + OGX.storage.ns.playerId,
      tz: OGX.time.tzOffsetMs / 3600000 + 'h cal=' + OGX.time.calibrated + ' renderMs=' + new Date(OGX.time.renderMs).toISOString(),
      bodies: Object.keys(bodies).join(','),
      body: b ? { res: b.res && Math.round(b.res.metal.amount), energy: b.energy && b.energy.production, levels: Object.keys(b.levels).length, ships: Object.keys(b.ships).length, defense: Object.keys(b.defense).length, percents: Object.keys(b.percents || {}).length, unitQueue: !!(b.queues && b.queues.unit), fields: b.fieldsUsed + '/' + b.fieldsMax, temp: b.tempMin + '..' + b.tempMax } : null,
      player: pl && { name: pl.name, id: pl.id, rank: pl.rank, dm: pl.darkMatter, officers: pl.officers ? Object.keys(pl.officers).length : 0 },
      research: Object.keys(research.levels || {}).length,
      slots: slots && JSON.stringify({ f: slots.fleet, e: slots.expedition }),
      server: { engine: server.engine, version: server.version, fleetSpeed: server.fleetSpeed, tz: server.tzOffsetMs },
      menu: (() => { const e = OGX.dom.menuEntry({ id: 'gz-snapshot', label: 'test' }); const ok = !!e.li.parentElement && e.li.parentElement.id; e.li.remove(); return ok; })(),
      anchors: Object.entries(OGX.dom.anchors()).filter(([, el]) => el).map(([k]) => k).join(','),
      errors: OGX.errors.map((e) => e.where + ': ' + e.message),
    };
  });
}

(async () => {
  if (!fs.existsSync(PAGES)) { console.error('pages not found: ' + PAGES); process.exit(2); }
  const files = fs.readdirSync(PAGES).filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -5)).filter((n) => !only.length || only.includes(n)).sort();
  const srv = await startServer();
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch();
  const context = await browser.newContext();
  for (const f of mainFiles) await context.addInitScript({ content: read(f) });
  // saved pages point at missing *_files assets: answer them locally with 404 (nothing leaves 127.0.0.1)
  await context.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    return route.fulfill({ status: 404, body: '' });
  });
  let bad = 0;
  for (const name of files) {
    const page = await context.newPage();
    const pageErrors = [];
    page.on('console', (m) => { if (m.type() === 'error' && /\[OGX|gz-snapshot/.test(m.text())) pageErrors.push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => { if (/ogx:\/\//.test(e.stack || '')) pageErrors.push(String(e.message).slice(0, 300)); });
    await page.goto(base + '/Aeternum/game.php?' + queryFor(name), { waitUntil: 'domcontentloaded' });
    await loadCore(page, flags.has('--full') ? isoFiles : coreFiles);
    const sum = await summarize(page, { json: flags.has('--json') });
    if (flags.has('--json')) { console.log('=== ' + name + '\n' + JSON.stringify(sum, null, 1)); await page.close(); continue; }
    if (!sum.cur) { bad++; console.log(name.padEnd(17), 'NOT DETECTED', JSON.stringify(sum.det)); await page.close(); continue; }
    const missing = ['cur', 'planets', 'res'].filter((k) => !sum[k]);
    if (missing.length) bad++;
    console.log('\n## ' + name + (missing.length ? '   MISSING: ' + missing.join(',') : ''));
    for (const [k, v] of Object.entries(sum)) if (v !== null && v !== '' && v !== undefined) console.log('  ' + k.padEnd(9) + ' ' + v);
    if (flags.has('--full')) {
      await page.waitForFunction(() => document.documentElement.dataset.ogxSuite === 'ready', null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const mark = await page.evaluate(() => ({ mark: document.documentElement.dataset.ogxSuite || null, mods: (window.OGX._ctxs || []).map((c) => c.def.name).join(','),
        menu: document.querySelectorAll('#menuTable > li.ogx-menu-entry').length, errors: OGX.errors.map((e) => e.where + ': ' + e.message.slice(0, 160)) }));
      console.log('  full      mark=' + mark.mark + ' menuEntries=' + mark.menu + ' modules=' + mark.mods);
      for (const e of mark.errors) console.log('  modErr    ' + e);
    } else {
      const st = await bootAndRead(page);
      console.log('  boot      mark=' + st.mark + ' ns=' + st.ns + ' tz=' + st.tz + ' menu=' + st.menu + ' anchors=' + st.anchors);
      console.log('  stores    bodies=' + st.bodies + ' body=' + JSON.stringify(st.body) + ' research=' + st.research + (st.slots ? ' slots=' + st.slots : ''));
      console.log('  player    ' + JSON.stringify(st.player) + ' server=' + JSON.stringify(st.server));
      for (const e of st.errors) { console.log('  ERROR     ' + e); bad++; }
    }
    for (const e of pageErrors) { console.log('  pageErr   ' + e); }
    await page.close();
  }
  if (!only.length && !flags.has('--json')) {
    // negative / reason checks: unrelated site, wrong path, login page
    const page = await context.newPage();
    console.log('\n## detection reasons');
    for (const p of ['/other', '/Aeternum/index.php', '/Aeternum/game2.php']) {
      await page.goto(base + p, { waitUntil: 'domcontentloaded' });
      await loadCore(page, coreFiles.slice(0, 6));
      const d = await page.evaluate(() => OGX.page.detect(document, location));
      console.log('  ' + p.padEnd(22) + ' ok=' + d.ok + ' candidate=' + d.candidate + ' reason=' + d.reason);
      if (d.ok) bad++;
    }
    await page.close();
  }
  await browser.close();
  srv.close();
  if (bad) { console.log('\nproblems: ' + bad); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
