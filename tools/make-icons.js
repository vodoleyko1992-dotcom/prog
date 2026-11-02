'use strict';
// Renders the «OgameX Suite» icon (inline SVG) to ogamex-suite/icons/icon{16,32,48,128}.png with Playwright.
//   node tools/make-icons.js
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, '..', 'ogamex-suite', 'icons');
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#14263b"/><stop offset="1" stop-color="#2d5f93"/></linearGradient>
    <radialGradient id="pl" cx=".38" cy=".35" r=".75"><stop offset="0" stop-color="#ffd68a"/><stop offset=".55" stop-color="#e08a2c"/><stop offset="1" stop-color="#7a3d10"/></radialGradient>
  </defs>
  <rect x="4" y="4" width="120" height="120" rx="26" fill="url(#bg)"/>
  <rect x="4" y="4" width="120" height="120" rx="26" fill="none" stroke="#6f9fd8" stroke-width="4"/>
  <ellipse cx="64" cy="68" rx="50" ry="16" fill="none" stroke="#9cc4ef" stroke-width="7" transform="rotate(-20 64 68)"/>
  <circle cx="64" cy="64" r="28" fill="url(#pl)"/>
  <path d="M20 82 A50 16 -20 0 0 108 50" fill="none" stroke="#9cc4ef" stroke-width="7" transform="rotate(0)" clip-path="inset(0)"/>
  <path d="M98 20 l4 10 10 4 -10 4 -4 10 -4 -10 -10 -4 10 -4z" fill="#ffffff"/>
</svg>`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${SVG.replace('width="128" height="128"', `width="${size}" height="${size}"`)}</body></html>`);
    await page.screenshot({ path: path.join(OUT, `icon${size}.png`), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  }
  await browser.close();
  console.log('icons written to', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
