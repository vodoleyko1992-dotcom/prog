// node verify.js : runs parse-buildings.js on every fixtures/buildings-*.html in Chromium (scripts stripped)
// and writes fixtures/buildings-expected-parse.json. Prints a one-line summary per fixture.
const { chromium } = require(process.env.PW || '/opt/node-tools/node_modules/playwright');
const fs = require('fs'), path = require('path');
const FX = path.join(__dirname, '../../fixtures');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
  const p = await b.newPage();
  const lib = fs.readFileSync(path.join(__dirname, 'parse-buildings.js'), 'utf8');
  const res = {};
  for (const f of fs.readdirSync(FX).filter((x) => x.startsWith('buildings-') && x.endsWith('.html')).sort()) {
    // keep inline scripts as text (parsers read them) but neutralise execution
    const html = fs.readFileSync(path.join(FX, f), 'utf8')
      .replace(/<script[^>]*\bsrc=[^>]*>\s*<\/script>/gi, '')
      .replace(/<script(?![^>]*type=)([^>]*)>/gi, '<script type="text/plain"$1>');
    await p.setContent(html);
    await p.addScriptTag({ content: lib });
    res[f] = await p.evaluate(() => ({
      page: GZBuild.pageInfo(document, null),
      list: GZBuild.parseTechList(document),
      queueBox: GZBuild.parseQueueBox(document),
      overviewBoxes: GZBuild.parseOverviewBoxes(document),
      planetsBuilding: GZBuild.planetsBuilding(document),
      resources: GZBuild.parseResources(document),
      techtree: GZBuild.parseTechtree(document),
      panels: GZBuild.parseForkPanels(document),
      upstreamQueue: GZBuild.parseUpstreamQueue(document),
      upstreamShipyardQueue: GZBuild.parseUpstreamShipyardQueue(document),
    }));
  }
  fs.writeFileSync(path.join(FX, 'buildings-expected-parse.json'), JSON.stringify(res, null, 1));
  for (const [f, r] of Object.entries(res)) {
    console.log(f.padEnd(44), r.page.page.padEnd(10), 'list', r.list.length, 'start', r.list.filter((x) => x.canStart).length,
      'off', r.list.filter((x) => !x.requirementsMet).length, 'qbox', r.queueBox ? (r.queueBox.empty ? 'empty' : 'FULL') : '-',
      'ovw', Object.keys(r.overviewBoxes).length, 'res', Object.keys(r.resources.settings).length, 'tt', r.techtree.length,
      'panels', r.panels.length, 'upQ', r.upstreamQueue.length, 'upYard', r.upstreamShipyardQueue ? r.upstreamShipyardQueue.items.length : '-');
  }
  await b.close();
})();
