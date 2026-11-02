// node run-recipe.js <page.html> <recipe.js> [--full]
// Loads a REAL saved page into Chromium with JavaScript DISABLED and all network blocked, evaluates the recipe
// (a function `(doc = document) => result`) against `document`, prints the JSON result.
const { chromium } = require(process.env.PW || '/opt/node-tools/node_modules/playwright');
const fs = require('fs');
async function run(pages) {           // pages: [[file, recipeFile], ...] -> results
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
  const ctx = await b.newContext({ javaScriptEnabled: false });
  const p = await ctx.newPage();
  await p.route('**/*', (r) => r.abort());
  const out = [];
  for (const [file, recipe] of pages) {
    await p.setContent(fs.readFileSync(file, 'utf8'), { waitUntil: 'domcontentloaded' });
    out.push(await p.evaluate((s) => (0, eval)('(' + s + ')')(document), fs.readFileSync(recipe, 'utf8')));
  }
  await b.close();
  return out;
}
module.exports = { run };
if (require.main === module) {
  const [file, recipe] = process.argv.slice(2);
  run([[file, recipe]]).then(([r]) => console.log(JSON.stringify(r, null, process.argv.includes('--full') ? 1 : 0)))
    .catch((e) => { console.error(e); process.exit(1); });
}
