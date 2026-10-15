'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const content = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');

assert.match(content, /localStorage\.getItem\('l2bot-dockWide'\)/, 'wide mode is restored after navigation');
assert.match(content, /localStorage\.setItem\('l2bot-dockWide', dockWideOpen\(\) \? '0' : '1'\)/, 'button switches wide mode');
assert.match(content, /const wideOn = dockWideOpen\(\) && !dockOver;/, 'Android overlay remains unchanged');
assert.match(content, /const w = wideOn \? Math\.min\(normalWidth \* 2, Math\.max\(0, viewport - 16\)\) : normalWidth;/, 'width doubles but stays within viewport');
assert.match(content, /wideButton\.style\.display = min \|\| dockOver \? 'none' : 'block';/, 'button is hidden when the dock is folded');
assert.match(content, /wideButton\.setAttribute\('aria-pressed', String\(wideOn\)\)/, 'toggle exposes its state');
console.log('PASS: dock doubles width on demand, restores it, and respects viewport and folded mode');
