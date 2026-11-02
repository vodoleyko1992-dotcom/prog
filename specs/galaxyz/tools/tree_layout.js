// Prints the element skeleton (tags with id/class) of a real page down to a depth, skipping repeated siblings.
const { chromium } = require('playwright');
const path = require('path');
const f = path.resolve(__dirname, '../../../../eu/pages', process.argv[2] || 'overview.html');
const depth = +(process.argv[3] || 6);
(async () => {
  const b = await chromium.launch({}); const ctx = await b.newContext({ javaScriptEnabled: false }); const p = await ctx.newPage();
  await p.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await p.goto('file://' + f, { waitUntil: 'domcontentloaded' });
  console.log(await p.evaluate(D => {
    const out = [];
    const walk = (el, d) => {
      if (d > D || ['SCRIPT','STYLE','LINK','META','BR','OPTION'].includes(el.tagName)) return;
      const lab = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '');
      out.push('  '.repeat(d) + lab);
      let prev = null, rep = 0;
      for (const c of el.children) { const k = c.tagName + c.className; if (k === prev && !c.id) { rep++; continue; } if (rep) out.push('  '.repeat(d+1) + `(+${rep} more)`); rep = 0; prev = k; walk(c, d + 1); }
      if (rep) out.push('  '.repeat(d+1) + `(+${rep} more)`);
    };
    walk(document.body, 0); return out.join('\n');
  }, depth));
  await b.close();
})();
