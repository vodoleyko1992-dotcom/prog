// Per real page: title, body id/class, URL, queryString, whether chrome parts exist, first content nodes of #inhalt.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const DIR = path.resolve(__dirname, '../../../../eu/pages');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ javaScriptEnabled: false });
  for (const f of fs.readdirSync(DIR).filter(f => f.endsWith('.html')).sort()) {
    const p = await ctx.newPage();
    await p.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
    await p.goto('file://' + path.join(DIR, f), { waitUntil: 'domcontentloaded' });
    const html = fs.readFileSync(path.join(DIR, f), 'utf8');
    const r = await p.evaluate(() => {
      const q = s => document.querySelectorAll(s).length;
      const inh = document.querySelector('#inhalt');
      const kids = inh ? [...inh.children].filter(e => !['SCRIPT','STYLE'].includes(e.tagName) && e.id !== 'messages_collapsed')
        .slice(0, 3).map(e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className ? '.' + String(e.className).trim().split(/\s+/).join('.') : '')) : [];
      return { title: document.title.replace(/ - Aeternum.*/, ''), body: document.body.id + '.' + document.body.className,
        sel: q('#planetSelector'), res: q('#resTable'), menu: q('#menuTable'), ev: q('#messages_collapsed'), rechts: q('#rechts'),
        planetList: q('[id=planetList]'), myWorlds: q('[id=myWorlds]'), OvfleetEvents: q('[id=OvfleetEvents]'), footer: q('#siteFooter'),
        footerInPage: !!document.querySelector('#page #siteFooter'), kids };
    });
    r.url = (html.match(/saved from url=\(\d+\)(\S+)/) || [])[1];
    r.refresh = (html.match(/<meta[^>]+http-equiv="refresh"[^>]*>/i) || [''])[0];
    console.log(f.padEnd(22), JSON.stringify(r));
    await p.close();
  }
  await b.close();
})();
