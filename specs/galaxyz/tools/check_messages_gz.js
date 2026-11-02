// Runs every GZMessagesB parser (messages-recipes-b.js) on the REAL message pages and on all fixtures/messages-*.html
// (Chromium, JS disabled) and compares with fixtures/messages-gz-expected-parse.json; --write refreshes that file.
// Usage (cwd = specs/galaxyz): NODE_PATH=$(npm root -g) node tools/check_messages_gz.js [--write]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const HERE = path.resolve(__dirname, '..');
const FIX = path.join(HERE, 'fixtures');
const OUT = path.join(FIX, 'messages-gz-expected-parse.json');
const RECIPES = fs.readFileSync(path.join(HERE, 'messages-recipes-b.js'), 'utf8');
const PARSE = `(() => {
  const G = GZMessagesB, l = G.list(document);
  const strip = (o) => { if (o) { delete o.body; delete o.text; delete o.simulateHref; } return o; };
  return {
    categories: G.categories(document), headerUnread: G.headerUnread(document),
    list: l && { ...l, items: l.items.map(i => { const key = G.classify(i), b = i.body; const r = { ...i, key };
      if (b.querySelector('.spyRaport')) r.spy = strip(G.spyReport(b));
      else if (b.querySelector('.raportMessage')) r.combat = G.combatShort(b);
      else r.fleet = strip(G.fleetText(i));
      return strip(r); }) },
    combatFull: document.body && document.body.id === 'raport' ? G.combatFull(document) : undefined,
  };
})()`;
(async () => {
  const write = process.argv.includes('--write');
  const files = [path.resolve(HERE, '../../../eu/pages/messages-spy.html'), path.resolve(HERE, '../../../eu/pages/messages-all.html')]
    .concat(fs.readdirSync(FIX).filter(f => /^messages-.*\.html$/.test(f) && !/^messages-real-/.test(f)).sort().map(f => path.join(FIX, f)));
  const b = await chromium.launch(); const ctx = await b.newContext({ javaScriptEnabled: false });
  const got = {};
  for (const f of files) {
    const p = await ctx.newPage();
    await p.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
    await p.goto('file://' + f, { waitUntil: 'domcontentloaded' });
    await p.evaluate(RECIPES);
    got[path.basename(f)] = await p.evaluate(PARSE);
    await p.close();
  }
  await b.close();
  if (write) { fs.writeFileSync(OUT, JSON.stringify(got, null, 1) + '\n'); console.log('wrote ' + OUT + ' (' + files.length + ' files)'); return; }
  const exp = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  let bad = 0;
  for (const [k, v] of Object.entries(got)) {
    const ok = JSON.stringify(v) === JSON.stringify(exp[k]);
    if (!ok) bad++;
    console.log((ok ? 'ok   ' : 'DIFF ') + k);
  }
  process.exitCode = bad ? 1 : 0;
})();
