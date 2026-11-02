// Loads fixtures/galaxy-page.html in Chromium with OgameX's OWN ingame JS bundle
// (the vite.config.js script list, minus pusher/echo/chat) and answers POST /ajax/galaxy
// with the galaxy-ajax-*.json fixtures. Saves the DOM of #galaxyContent after the game's
// renderContentGalaxy() ran, i.e. exactly what a content script sees on the galaxy page.
// Usage: node ogx/tools/render_galaxy.js
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const SRC = '/tmp/claude-0/-home-claude/1ebb7366-d4fd-5fac-899e-5244b2310d13/scratchpad/src/OGameX';
const FIX = path.join(__dirname, '..', 'fixtures');
const SCRIPTS = [
  'jquery-1.12.4.min.js', 'vendor/jquery-ui-1.12.1.js', 'vendor/anythingslider-1.9.7.js', 'vendor/jquery.ba-bbq-1.4pre.js',
  'vendor/jquery.colorpicker.js', 'jquery.js', 'inventory.js', 'jquery-spinners.js', 'messages.js', 'tooltips.js', 'trader.js',
  'timerhandler.js', 'e7c74974620fa35b197315ebdbb8c2.js', 'messages-pagination.js',
];
const bundle = SCRIPTS.map((f) => fs.readFileSync(path.join(SRC, 'resources/js/ingame', f), 'utf8')).join('\n;\n');

const CASES = [
  { page: 'galaxy-page.html', url: 'http://localhost/galaxy?cp=1', json: { '1:42': 'galaxy-ajax-1-42.json' }, out: 'galaxy-rendered-1-42.html' },
  { page: 'galaxy-page-query.html', url: 'http://localhost/galaxy?galaxy=1&system=45&position=6', json: { '1:45': 'galaxy-ajax-1-45.json' }, out: 'galaxy-rendered-1-45.html' },
];

(async () => {
  const browser = await chromium.launch();
  const report = {};
  for (const c of CASES) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message)));
    const posts = [];
    await page.route('**/*', async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      if (u.pathname === '/galaxy') return route.fulfill({ contentType: 'text/html; charset=UTF-8', body: fs.readFileSync(path.join(FIX, c.page), 'utf8') });
      if (/^\/build\/assets\/ingame-.*\.js$/.test(u.pathname)) return route.fulfill({ contentType: 'application/javascript', body: bundle });
      if (u.pathname === '/ajax/galaxy' && req.method() === 'POST') {
        const p = new URLSearchParams(req.postData() || '');
        posts.push({ body: req.postData(), headers: { 'x-csrf-token': req.headers()['x-csrf-token'] || null, 'x-requested-with': req.headers()['x-requested-with'] || null } });
        const f = c.json[p.get('galaxy') + ':' + p.get('system')];
        if (f) return route.fulfill({ contentType: 'application/json', body: fs.readFileSync(path.join(FIX, f), 'utf8') });
        return route.fulfill({ status: 404, body: '' });
      }
      return route.fulfill({ status: 204, body: '' });
    });
    await page.goto(c.url);
    await page.waitForTimeout(1500);
    const html = await page.evaluate(() => document.querySelector('#galaxyContent').outerHTML);
    const tokenAfter = await page.evaluate(() => (typeof token === 'undefined' ? 'undefined' : String(token)));
    fs.writeFileSync(path.join(FIX, c.out), '<!-- #galaxyContent after OgameX renderContentGalaxy() (rendered in Chromium from ' + c.page + ' + ' + Object.values(c.json).join(',') + ') -->\n' + html + '\n');
    report[c.out] = { errors, posts, tokenAfter };
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 1));
})();
