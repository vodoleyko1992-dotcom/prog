'use strict';
// 7.2.1: браузерный смоук списка «что фармить» как на форуме (node tests/v721-tree-browser.cjs; CHROMIUM=…)
const { chromium } = require(process.env.PLAYWRIGHT_NODE || '/opt/node-tools/node_modules/playwright');
const fs = require('fs'), path = require('path');
const root = require('path').join(__dirname, '..');
const base = JSON.parse(fs.readFileSync(path.join(root, 'base-profile.json'), 'utf8'));
const py = fs.readFileSync(path.join(root, 'tests/v715-ui-browser.py'), 'utf8');
let mock = py.slice(py.indexOf('mock=r"""') + 9); mock = mock.slice(0, mock.indexOf('"""'));
mock = mock.replace("rt:{char:'West',lvl:56,fishProof:850,fish:{casts:10,caught:5}}", "rt:{char:'Warlock',lvl:52,prof:'Warlock',farmGot:{'coal':12}},farmDb:window.__farmDb,recipeDb:{rec:{'recipe: bonebreaker':{name:'Recipe: Bonebreaker',grade:'C',group:'Оружие',drop:[['Ol Mahum Raider',27,1.2,'Gludio']],spoil:[]}},t:Date.now()}");
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  for (const [w, nm] of [[760, 'wide'], [375, 'dock']]) {
    const page = await b.newPage({ viewport: { width: w, height: 1100 } });
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.evaluate(db => { window.__farmDb = db; }, base.farmDb);
    await page.evaluate(mock);
    let html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8').replace(/<link rel="stylesheet" href="[^"]+">/g, '').replace(/<script src="[^"]+"><\/script>/g, '');
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    for (const c of ['ui-v7.css', 'ui-game.css']) await page.addStyleTag({ content: fs.readFileSync(path.join(root, c), 'utf8') });
    for (const j of ['popup.js', 'ui-v7.js']) await page.addScriptTag({ content: fs.readFileSync(path.join(root, j), 'utf8') });
    await page.waitForTimeout(900);
    await page.locator('#navToggle').click(); await page.locator('#moduleNav button[data-tab="hunt"]').click(); await page.waitForTimeout(400);
    await page.evaluate(() => { document.querySelector('#farmTree').scrollIntoView(); });
    const groups = await page.$$eval('#farmTree > details.fgrp > summary', s => s.map(x => x.textContent.trim()));
    await page.locator('#farmTree > details.fgrp >> nth=2 >> summary').click(); await page.waitForTimeout(400);   // «Ресурсы»
    const sub = await page.$$eval('#farmTree details.fgrp[open] .frow', r => r.length);
    await page.locator('#farmTree .fr-name >> nth=0').click(); await page.waitForTimeout(300);
    const src = await page.$$eval('#farmTree .fr-src .fs', r => r.slice(0, 4).map(x => x.textContent));
    await page.locator('#farmTree .fr-go >> nth=0').click(); await page.waitForTimeout(500);
    const target = await page.evaluate(() => window.__mockState.cfg.farmRes);
    await page.fill('#farmSearch', 'stone of'); await page.waitForTimeout(400);
    const found = await page.$$eval('#farmTree .frow .fr-name', r => r.map(x => x.textContent.trim()).slice(0, 5));
    await page.fill('#farmSearch', ''); await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('#farmTree').scrollIntoView());
    
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    const ok = groups.length >= 3 && sub > 0 && src.length > 0 && target && found.some(x => /Stone of Purity/.test(x)) && !overflow && !errors.length;
    if (!ok) { console.error('FAIL', JSON.stringify({ w, groups, sub, src, target, found, overflow, errors })); process.exit(1); }
    console.log(`PASS ${w}px: forum-like farm list — groups, rows, sources, «farm this», search`);
    await page.close();
  }
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
