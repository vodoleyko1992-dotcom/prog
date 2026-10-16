'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const content = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');

assert.match(content, /localStorage\.getItem\('l2bot-dockWide'\)/, 'wide mode is restored after navigation');
assert.match(content, /localStorage\.setItem\('l2bot-dockWide', dockWideOpen\(\) \? '0' : '1'\)/, 'button switches wide mode');
assert.match(content, /const wideOn = dockWideOpen\(\) && !dockOver;/, 'Android overlay remains unchanged');
// 16.10.2026: x2 ограничен общей границей с индикатором, поведение проверено в v204-dock-layout.
assert.match(content, /const room = dockWideRoom\(viewport, normalWidth, wideOn, min, bounds.left\);/, 'width shares available room with indicator');
assert.match(content, /wideButton\.style\.display = min \|\| dockOver \? 'none' : 'block';/, 'button is hidden when the dock is folded');
assert.match(content, /wideButton\.setAttribute\('aria-pressed', String\(wideOn\)\)/, 'toggle exposes its state');
console.log('PASS: dock doubles width on demand, restores it, and respects viewport and folded mode');
