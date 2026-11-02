// Runs galaxy-recipes.js on the REAL saved galaxy page and on fixtures/galaxy-*.html in Chromium (Playwright).
// Usage (cwd = specs/galaxyz): NODE_PATH=/opt/node22/lib/node_modules node tools/check_galaxy.js [--write]
//   --write stores fixtures/galaxy-expected-parse.json
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const HERE = path.resolve(__dirname, '..');
const REAL = path.resolve(HERE, '../../../eu/pages/galaxy.html');
const FIX = path.join(HERE, 'fixtures');
const files = [['real-galaxy', REAL],
  ...fs.readdirSync(FIX).filter((f) => /^galaxy-.*\.html$/.test(f)).sort().map((f) => [f.replace(/\.html$/, ''), path.join(FIX, f)])];
const which = (name) => (/statistics/.test(name) ? 'parseStatistics' : /search/.test(name) ? 'parseSearchResult'
  : /playercard/.test(name) ? 'parsePlayerCard' : /phalanx/.test(name) ? 'parsePhalanx' : 'parseSystem');
const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'links' ? undefined : v)));
(async () => {
  const b = await chromium.launch();
  const out = {};
  let fail = 0;
  for (const [name, file] of files) {
    const p = await b.newPage();
    p.on('pageerror', () => {});
    await p.route('**/*', (r) => (r.request().url().startsWith('file:') ? r.continue() : r.abort()));
    await p.goto('file://' + file, { waitUntil: 'domcontentloaded' });
    await p.addScriptTag({ path: path.join(HERE, 'galaxy-recipes.js') });
    const html = fs.readFileSync(file, 'utf8');
    const fn = which(name);
    const r = await p.evaluate(([h, fn]) => {
      const opts = { me: { id: 4377, name: 'vodoleyko1992' } };
      const live = GZGalaxy[fn](document, opts);
      const fromString = GZGalaxy[fn](h, opts);
      return { live, same: JSON.stringify(live) === JSON.stringify(fromString) };
    }, [html, fn]);
    if (!r.same) { fail++; console.error('MISMATCH live vs DOMParser:', name); }
    out[name] = { parser: fn, result: strip(r.live) };
    await p.close();
  }
  await b.close();
  const s = JSON.stringify(out, null, 1);
  if (process.argv.includes('--write')) fs.writeFileSync(path.join(FIX, 'galaxy-expected-parse.json'), s + '\n');
  console.log(s);
  if (fail) process.exit(1);
})();
