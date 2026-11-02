// Runs layout-recipes.js on the REAL saved overview and on the layout fixtures in Chromium (Playwright).
// Usage: node tools/check_layout.js [--write]   (cwd = specs/galaxyz). --write stores fixtures/layout-expected-parse.json
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const HERE = path.resolve(__dirname, '..');
const REAL = path.resolve(HERE, '../../../eu/pages/overview.html');
const files = [
  ['real-overview', REAL],
  ...fs.readdirSync(path.join(HERE, 'fixtures')).filter(f => /^layout-.*\.html$/.test(f)).sort()
    .map(f => [f.replace(/\.html$/, ''), path.join(HERE, 'fixtures', f)]),
];
(async () => {
  const b = await chromium.launch();
  const out = {};
  for (const [name, file] of files) {
    const p = await b.newPage();
    p.on('pageerror', () => {});
    await p.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
    await p.goto('file://' + file, { waitUntil: 'domcontentloaded' });
    await p.addScriptTag({ path: path.join(HERE, 'layout-recipes.js') });
    // also parse the raw HTML through DOMParser (what a background fetch() would see)
    const html = fs.readFileSync(file, 'utf8');
    out[name] = await p.evaluate(h => {
      const live = GZLayout.parseLayout(document);
      const d = new DOMParser().parseFromString(h, 'text/html');
      const parsed = GZLayout.parseLayout(d);
      return { live, sameAsDomParser: JSON.stringify(live.planets) === JSON.stringify(parsed.planets) &&
                                     JSON.stringify(live.resources) === JSON.stringify(parsed.resources) };
    }, html);
    await p.close();
  }
  await b.close();
  const s = JSON.stringify(out, null, 1);
  if (process.argv.includes('--write')) fs.writeFileSync(path.join(HERE, 'fixtures', 'layout-expected-parse.json'), s + '\n');
  console.log(s);
})();
