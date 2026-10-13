'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'popup.html'),'utf8');
const js=fs.readFileSync(path.join(root,'ui-v7.js'),'utf8');
const css=fs.readFileSync(path.join(root,'ui-v7.css'),'utf8');
const mf=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
const base=JSON.parse(fs.readFileSync(path.join(__dirname,'v71-baseline-ids.json'),'utf8'));
assert.equal(mf.version,'10.0.9');
assert.equal(new Set(ids).size,ids.length,'Duplicate HTML IDs');
for(const id of base) assert(ids.includes(id),`Legacy control lost: ${id}`);
const tabs=[...html.matchAll(/<button data-tab="([a-z]+)"/g)].map(x=>x[1]);
assert.equal(tabs.length,8);   // 7.1.31: 15 разделов сведены в 7 (бывшие — подразделы с меткой #tab-<старый>); 9.0: + «Маммон»
for(const tab of tabs) assert(ids.includes('tab-'+tab),`Missing section ${tab}`);
assert.equal((html.match(/class="epicChk"/g)||[]).length,8);
assert(html.includes('id="tab-epic"')&&html.includes('id="tab-dungeon"'));   // 7.1.31: подразделы «РБ и эпики» / «Охота»
assert(html.includes('<script src="popup.js"></script>\n<script src="ui-v7.js"></script>'));
assert(html.includes('<link rel="stylesheet" href="ui-v7.css">'));
assert((js.match(/:'[^']+'[,\n]/g)||[]).length>55,'Missing per-control documentation');
assert(css.includes('html.docked')&&css.includes('.overview-modules'));
console.log(`PASS: v7.1 UI, ${tabs.length} tabs, ${base.length} old IDs preserved, ${ids.length-base.length} new IDs`);
console.log('PASS: distinct epic/dungeon tabs, 8 boss checkboxes, inline explanations, dock styles');
