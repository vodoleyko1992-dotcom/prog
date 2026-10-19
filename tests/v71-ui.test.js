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
assert.equal(mf.version,'20.19');
assert.equal(new Set(ids).size,ids.length,'Duplicate HTML IDs');
// 14.10: GM больше не продаёт наживку; прежнее поле заменено подсказкой к отдельному сервису рыбалки.
const retained=base.filter(id=>!['shopBait','rbToggle','campToggle','tasksToggle','farmToggle','autoFarmToggle','huntToggle','epicToggle','fishToggle','catToggle','enchantToggle','tvtToggle'].includes(id));
for(const id of retained) assert(ids.includes(id),`Legacy control lost: ${id}`);
for(const key of ['quests','farm','auto','raid','epic','fish','cat','enchant','tvt']) assert(html.includes('data-auto-task="'+key+'"'),'canonical selection retained '+key);
assert(!ids.includes('shopBait'),'Removed GM bait control must not return');
assert(html.includes('Наживка и рыболовные заряды настраиваются в разделе «Рыбалка».'));
const tabs=[...html.matchAll(/<button data-tab="([a-z]+)"/g)].map(x=>x[1]);
assert.equal(tabs.length,11); // 19.10: лимиты отдельно. // 20.19: Маммон, заточка, ЛС и сервис отдельно. // 20.12 (ревизия 17.10): 12 разделов сведены в 6, прежние — подразделы с метками #tab-<старый>.
assert(html.includes('<section id="tab-enchant">') && !/enchant: 'panel'/.test(fs.readFileSync(path.join(root,'popup.js'),'utf8')), '20.19: Автозаточка — отдельный раздел по прежнему имени');
for(const tab of tabs) assert(ids.includes('tab-'+tab),`Missing section ${tab}`);
assert.equal((html.match(/class="epicChk"/g)||[]).length,8);
assert(html.includes('id="tab-epic"')&&html.includes('id="tab-dungeon"'));   // 7.1.31: подразделы «РБ и эпики» / «Охота»
assert(html.includes('<script src="popup.js"></script>\n<script src="ui-v7.js"></script>'));
assert(html.includes('<link rel="stylesheet" href="ui-v7.css">'));
assert((js.match(/:'[^']+'[,\n]/g)||[]).length>55,'Missing per-control documentation');
assert(css.includes('html.docked'));   // 20.12: плитки «Быстрые переходы» (.overview-modules) убраны — шесть разделов всегда на виду
console.log(`PASS: v7.1 UI, ${tabs.length} tabs, ${retained.length} old IDs preserved, ${ids.length-retained.length} new IDs, obsolete GM bait replaced by fishing hint`);
console.log('PASS: distinct epic/dungeon tabs, 8 boss checkboxes, inline explanations, dock styles');
