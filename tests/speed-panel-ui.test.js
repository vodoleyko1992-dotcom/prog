'use strict';
// Панель общей паузы: секунды в меню, штатная запись только изменённого поля и защита профиля.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const read = file => fs.readFileSync(__dirname + '/../' + file, 'utf8');
const popup = read('popup.js'), html = read('popup.html'), defaults = require('../defaults.js').CFG;
const part = (start, end) => { const a = popup.indexOf(start), b = popup.indexOf(end, a); assert.ok(a >= 0 && b > a, start); return popup.slice(a, b); };

test('общая пауза доступна в отдельном разделе и сохраняется в базовом профиле', () => {
  const speed = html.slice(html.indexOf('<section id="tab-speed">'), html.indexOf('</section>', html.indexOf('<section id="tab-speed">')));
  assert.equal(defaults.actionDelayMs, 500);
  assert.equal(JSON.parse(read('base-profile.json')).cfg.actionDelayMs, defaults.actionDelayMs);
  assert.match(speed, /<input id="actionDelayMs" type="range" min="0" max="5000" step="100" value="500" aria-describedby="speedHint"/);
  assert.match(speed, /<label class="speed-control" for="actionDelayMs">/);
  assert.match(speed, /<output id="actionDelayValue" for="actionDelayMs" aria-live="polite">/);
  assert.match(speed, /id="reactMin"/); assert.match(speed, /id="reactMax"/);
  assert.match(speed, /0 выключает дополнительную паузу/);
  assert.match(speed, /Штатная реакция и серверные паузы сохраняются/);
  assert.ok(!html.slice(html.indexOf('<section id="tab-panel">'), html.indexOf('<section id="tab-enchant"')).includes('id="reactMin"'));
});

test('бегунок показывает секунды сразу и обновляет значение для скринридера', () => {
  const fields = { actionDelayMs: { value: '0', setAttribute(name, value) { this[name] = value; } }, actionDelayValue: {} };
  const box = { $: key => fields[key] }; vm.createContext(box);
  vm.runInContext(part('function paintActionDelay()', '// подтверждение опасных кнопок'), box);
  for (const [value, seconds] of [['0', 'Без задержки'], ['100', '0,1 с'], ['500', '0,5 с'], ['1000', '1,0 с'], ['2300', '2,3 с'], ['5000', '5,0 с'], ['0', 'Без задержки']]) {
    fields.actionDelayMs.value = value; box.paintActionDelay();
    assert.equal(fields.actionDelayValue.textContent, seconds);
    assert.equal(fields.actionDelayMs['aria-valuetext'], seconds);
  }
});

function fixture() {
  const field = { value: '0' }, writes = [];
  const box = { NUM: ['actionDelayMs'], TXT: [], BOOL: [], DEF: defaults, TASK_FLAG_OF: {}, formChar: 'Hero', saveRunning: 0, settingsSerial: 0,
    $: () => field, chrome: { storage: { local: { get: async () => ({ cfg: { rbFast: true, reactMin: 150 } }) } } },
    menuPatch: async (rtPatch, options) => { writes.push({ rtPatch, ...options }); }, toast() {}, setTimeout };
  vm.createContext(box); vm.runInContext(part('async function save(e)', '// ---------- вкладки ----------'), box);
  return { box, field, writes };
}

test('изменение паузы пишет один ключ текущего героя и соблюдает границы бегунка', async () => {
  const { box, field, writes } = fixture();
  for (const [value, expected] of [['2300', 2300], ['0', 0], ['100', 100], ['400', 400], ['-100', 0], ['9999', 5000], ['675', 700], ['', defaults.actionDelayMs]]) {
    field.value = value; await box.save({ target: { id: 'actionDelayMs' } });
    assert.deepEqual(JSON.parse(JSON.stringify(writes.at(-1))), { rtPatch: {}, cfgPatch: { actionDelayMs: expected }, expectedChar: 'Hero' });
  }
  assert.equal(box.saveRunning, 0);
});

test('смена персонажа во время чтения настроек отменяет запись паузы', async () => {
  const { box, writes } = fixture();
  box.chrome.storage.local.get = async () => { box.formChar = 'OtherHero'; return { cfg: {} }; };
  await assert.rejects(box.save({ target: { id: 'actionDelayMs' } }), /Персонаж изменился/);
  assert.deepEqual(writes, []);
  assert.equal(box.saveRunning, 0);
});
