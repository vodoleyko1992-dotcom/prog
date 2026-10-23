// 23.10 (John: «Раздели режим РБ и ЭПИКИ, для удобства»): эпики — отдельный раздел меню «Эпики», в «РБ» их настроек нет.
'use strict';
const assert = require('node:assert/strict'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8'), js = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const section = id => html.match(new RegExp('<section id="tab-' + id + '"[^>]*>([\\s\\S]*?)</section>'))?.[1] || '';
assert.match(html, /<button data-tab="rb" data-short="РБ"[^>]*><span class="ic">♛<\/span><span class="lb">РБ<\/span><\/button>/);
assert.match(html, /<button data-tab="epic" data-short="Эпики"[^>]*><span class="ic">🐉<\/span><span class="lb">Эпики<\/span><\/button>/);
const rb = section('rb'), ep = section('epic');
assert.ok(ep.length > 0, 'раздел «Эпики» есть');
for (const id of ['epicToggle2', 'epicList', 'epicCoinDailyMax', 'epicCoinPerBoss', 'epicCoinKeep', 'epicAdenaDailyMax', 'epicScan', 'epicSum', 'epicTable', 'epicBox', 'epicFaFull',
  'epicMaxDeaths', 'epicCheck', 'epicRetreatHp', 'epicLvlUp', 'epicMinHpPots', 'epicMaxFightMin', 'epicMaxRetreats']) {
  assert.ok(ep.includes(`id="${id}"`), 'в «Эпиках»: ' + id); assert.ok(!rb.includes(`id="${id}"`), 'не в «РБ»: ' + id);
}
assert.ok(!/class="epicChk"/.test(rb) && /class="epicChk"/.test(ep), 'галки эпиков — в «Эпиках»');
for (const id of ['huntToggle2', 'rbOneBtn', 'rbSessBuffs', 'rbFaFull', 'rbTimerAll', 'rbList']) assert.ok(rb.includes(`id="${id}"`), 'РБ остаётся в «РБ»: ' + id);
assert.match(ep, /<div class="adv-start" data-adv="epic">⚙ Дополнительно<\/div>[\s\S]*epicMaxDeaths/, 'тонкая настройка эпиков свёрнута в «Дополнительно»');
assert.ok(!/\bepic: 'rb'/.test(js.match(/const TAB_GROUP = \{([\s\S]*?)\};/)[1]), 'epic больше не подраздел rb');
assert.match(js, /const TASK_TABS = \{[^}]*epic:'epic'/, 'задача «Эпики» в «Обзоре» ведёт в раздел «Эпики»');
console.log('PASS 20.54 РБ и Эпики — разные разделы меню');
