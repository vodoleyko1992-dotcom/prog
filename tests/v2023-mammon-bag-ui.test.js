'use strict';
// UI анализа рюкзака: контекст, свежесть и ручная команда без запуска бота.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../popup.js'), 'utf8');
const body = source.slice(source.indexOf('const mmBagUi ='), source.indexOf('function renderMammon('));
const now = Date.now();
function fixture() {
  const els = { mmGoalItem: { value: '920018' }, mmGoalLvl: { value: '1' }, mmBagAnalyze: {}, mmBagStatus: {} };
  const state = { on: false, cfg: { mmGoalItem: 920018, mmGoalLvl: 1 }, rt: {
    char: 'AuditHero', classCur: { prof: 'human_warlock', slot: 0 }, mmEq: { belt: [920018, 0] }, mmEqT: now,
  }, lock: { tab: 99, t: now } };
  const sent = [], ctx = { Date, Number, JSON, Math, setTimeout, clearTimeout, formChar: 'AuditHero',
    $: id => els[id], fmt: n => String(n), esc: s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    chrome: { storage: { local: { get: async () => state } }, tabs: { sendMessage: async (...args) => { sent.push(args); return { ok: true }; } } },
    activeTab: async () => ({ id: 7 }), load: async () => {},
  };
  vm.createContext(ctx); vm.runInContext(body + '\nglobalThis.ui = mmBagUi;', ctx);
  const analysis = { t: now, attemptAt: now, status: 'ok', char: 'AuditHero', prof: 'human_warlock', slot: 0,
    goal: { id: 920018, lvl: 0, to: 1 }, items: [{ id: 1893, name: 'Oriharukon', need: 13, have: 0, missing: 13, kind: 'material' }],
    raw: [{ id: 1874, name: 'Oriharukon Ore', need: 65, have: 11891, missing: 0, kind: 'raw' }], craft: [], readyMaterials: false };
  state.rt.mmBagAnalysis = analysis;
  ctx.ui.displayContext = ctx.mammonBagContext(state.rt, state.cfg);
  return { ctx, state, analysis, els, sent, view: t => ctx.mammonBagView(state.rt, state.cfg, t ?? now) };
}
let passed = 0;
function test(name, fn) { return Promise.resolve().then(fn).then(() => { passed++; console.log('PASS ' + name); }); }
(async () => {
  await test('точные IDs готового материала и сырья, имена без видимых IDs', () => {
    const { ctx, analysis } = fixture(), html = ctx.mammonBagReport(analysis, false);
    assert.match(html, /data-mm-bag-item="1893" data-mm-bag-kind="material"/);
    assert.match(html, /data-mm-bag-item="1874" data-mm-bag-kind="raw"/);
    assert.match(html, /Готовые материалы.*Lv\.0.*Lv\.1/);
    assert.match(html, /Сырьё для крафта до Lv\.1/);
    const text = html.replace(/<[^>]+>/g, '');
    assert.match(text, /Oriharukon13013/); assert.match(text, /Oriharukon Ore6511891✅/);
    assert.doesNotMatch(text, /1893|1874/); assert.match(text, /Сырьё не заменяет готовые материалы/);
  });
  await test('чужой герой, класс и слот не показывают старую готовность', () => {
    for (const update of [{ char: 'OtherHero' }, { prof: 'human_warlord' }, { slot: 1 }]) {
      const { analysis, view } = fixture(); Object.assign(analysis, update); analysis.readyMaterials = true;
      assert.equal(view().analysis, null); assert.doesNotMatch(view().text, /следующего уровня собраны/);
    }
  });
  await test('смена цели, её уровня и уровня вещи требует нового анализа', () => {
    for (const update of [{ id: 920019 }, { to: 2 }, { lvl: 1 }]) {
      const { analysis, view } = fixture(); Object.assign(analysis.goal, update); assert.equal(view().analysis, null);
    }
    const { state, view } = fixture(); state.rt.mmEq.belt[1] = 1; assert.equal(view().analysis, null);
  });
  await test('экипировка и свежий замер важнее старого списка/дубликата', () => {
    const { ctx, state } = fixture(); state.rt.mmGear = [{ id: 920018, lvl: 4 }, { id: 920018, lvl: 1, eq: true }];
    state.rt.mmGearT = now - 1; assert.equal(ctx.mammonGearLevel(state.rt, 920018), 0);
    state.rt.mmGearT = now + 1; assert.equal(ctx.mammonGearLevel(state.rt, 920018), 1);
  });
  await test('свежесть согласована с автоматическим периодом 5 минут', () => {
    const { view } = fixture(); assert.equal(view(now + 120001).stale, false);
    assert.equal(view(now + 300000).stale, false); assert.equal(view(now + 300001).stale, true);
    assert.match(view(now + 300001).text, /старше 5 минут/);
  });
  await test('ошибка сохраняет прошлые числа с явной меткой, без готовности', () => {
    const { analysis, view, ctx } = fixture(); analysis.status = 'error'; analysis.error = 'Сервер недоступен'; analysis.readyMaterials = true;
    const result = view(); assert.equal(result.analysis.t, now); assert.equal(result.stale, true);
    assert.match(result.text, /Анализ не обновлён: Сервер недоступен/); assert.match(result.text, /прошлого анализа/);
    assert.doesNotMatch(result.text, /следующего уровня собраны/); assert.match(ctx.mammonBagReport(analysis, result.stale), /data-mm-bag-report="previous"/);
  });
  await test('первая ошибка не выдаёт пустой снимок за успешный', () => {
    const { analysis, view } = fixture(); analysis.t = 0; analysis.status = 'error'; analysis.error = 'Не удалось прочитать рюкзак';
    assert.equal(view().analysis, null); assert.match(view().text, /Не удалось прочитать рюкзак/); assert.match(view().text, /Успешного анализа рюкзака ещё нет/);
  });
  await test('достигнутая цель не предлагает несуществующее улучшение', () => {
    const { analysis, state, view, ctx } = fixture(); analysis.goal.lvl = 5; analysis.goal.to = 5;
    state.rt.mmEq.belt[1] = 5; state.cfg.mmGoalLvl = 5; analysis.items = []; analysis.readyMaterials = true;
    assert.match(view().text, /уже достигнут/); assert.doesNotMatch(view().text, /следующего уровня собраны/);
    const html = ctx.mammonBagReport(analysis, false);
    assert.match(html, /цель достигнута/); assert.doesNotMatch(html, /Lv\.6|неизвестны/);
  });
  await test('без цели видны найденные ресурсы и нет Need/Missing', () => {
    const { analysis, state, view, ctx } = fixture(); analysis.goal = null; state.cfg.mmGoalItem = 0;
    analysis.resourceCount = 1; analysis.known = [{ id: 1874, name: 'Ore <script>', have: 15 }];
    assert.equal(view().analysis, analysis); assert.match(view().text, /видов ресурсов 1/);
    const html = ctx.mammonBagReport(analysis, false);
    assert.match(html, /Ресурсы в рюкзаке/); assert.match(html, /Ore &lt;script&gt;/); assert.match(html, /<td>15<\/td>/);
    assert.doesNotMatch(html, /<script>|Нужно|Не хватает/);
  });
  await test('имена ресурсов безопасно экранируются, неизвестные количества не равны нулю', () => {
    const { ctx } = fixture(), html = ctx.mammonBagTable([{ id: 1, name: '<img onerror="bad">', need: 3, have: null, missing: null }], 'material');
    assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img|✅/); assert.match(html, /<td>\?<\/td>/);
  });
  await test('сводка обновляется по анализу, оценённое сырьё помечено', () => {
    const { ctx, analysis } = fixture(); assert.match(ctx.mammonBagSummary(analysis, 'Belt', false), /не хватает Oriharukon ×13/);
    analysis.items[0].have = 13; analysis.items[0].missing = 0; analysis.readyMaterials = true;
    assert.match(ctx.mammonBagSummary(analysis, 'Belt', false), /материалы следующего уровня собраны/);
    analysis.estimated = true; assert.match(ctx.mammonBagReport(analysis, false), /≈ Сырьё до цели оценено/);
  });
  await test('ненадетая вещь не выдаёт старый уровень кузнеца за свежую экипировку', () => {
    const { analysis, view } = fixture(); analysis.levelVerified = false;
    assert.match(view().text, /Уровень вещи вне экипировки — по последнему списку кузнеца/);
    assert.match(view().text, /ресурсы перечитаны из рюкзака/);
  });
  await test('ручная команда при OFF использует вкладку игры и сохраняет OFF/цель', async () => {
    const { ctx, state, sent, els } = fixture(), before = JSON.stringify(state);
    await ctx.analyzeMammonBag(); assert.equal(sent.length, 1); assert.equal(sent[0][0], 7);
    assert.deepEqual(JSON.parse(JSON.stringify(sent[0][1])), { cmd: 'mammonBagAnalyze', expectedChar: 'AuditHero', goalItem: 920018, goalLvl: 1 });
    assert.equal(JSON.stringify(state), before); assert.equal(els.mmBagAnalyze.disabled, false);
  });
  await test('повторный клик во время чтения не создаёт второй запрос', async () => {
    const { ctx, sent } = fixture(); let finish;
    ctx.chrome.tabs.sendMessage = async (...args) => { sent.push(args); return new Promise(resolve => { finish = resolve; }); };
    const first = ctx.analyzeMammonBag(); await new Promise(resolve => setImmediate(resolve));
    await ctx.analyzeMammonBag(); assert.equal(sent.length, 1); finish({ ok: true }); await first;
  });
  await test('несохранённая цель и чужой герой отвергаются до IPC', async () => {
    for (const mode of ['target', 'actor']) {
      const { ctx, state, sent } = fixture(); if (mode === 'target') state.cfg.mmGoalLvl = 2; else state.rt.char = 'OtherHero';
      await ctx.analyzeMammonBag(); assert.equal(sent.length, 0); assert.match(ctx.ui.error, mode === 'target' ? /сохранения/ : /Персонаж изменился/);
    }
  });
  await test('ошибка IPC возвращает кнопку и видимый статус', async () => {
    const { ctx, els, view } = fixture(); ctx.chrome.tabs.sendMessage = async () => { throw Error('Вкладка недоступна'); };
    await ctx.analyzeMammonBag(); assert.equal(els.mmBagAnalyze.disabled, false); assert.match(view().text, /Вкладка недоступна/);
  });
  console.log(`PASS mammon bag UI: ${passed}`);
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
