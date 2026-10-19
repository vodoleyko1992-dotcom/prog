'use strict';
// 20.12 (ревизия 17.10, раздел 3 «Панель управления и визуал»): UI-1/UI-2 запись только изменённых полей, UI-3/M2 честные переключатели
// режима задач и ручные кнопки, UI-7/UI-10 состояние дока, UI-8/UI-9 окно бота, UI-11 пустое поле, UI-4 импорт через фон, UI-5 скрытые панели.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const popup = read('popup.js'), content = read('content.js'), bgSrc = read('background.js'), ui7 = read('ui-v7.js'), html = read('popup.html');
const part = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };

(async () => {
  // ---------- UI-1/UI-2/UI-11/UI-3: save() пишет только изменённые поля ----------
  const mk = (cfg = {}) => {
    const fields = { shopReserve: { value: '' }, stopHp: { value: '25' }, nPower: { value: 'Blaze' }, fishGoal: { value: 'a, b' }, tvtOn: { checked: false }, catMode: { checked: true }, zoneAuto: { checked: false }, rbSessBuffs: { value: 'auto' } };
    const sent = [], toasts = [];
    const b = { Date, Object, Array, JSON, Number, String, Math, Promise, setTimeout, console, cfg,
      NUM: ['shopReserve', 'stopHp'], TXT: ['nPower', 'fishGoal', 'rbSessBuffs'], BOOL: ['tvtOn', 'catMode', 'zoneAuto'],
      DEF: { shopReserve: 200000, stopHp: 25, tvtOn: true, catMode: false, zoneAuto: false, autoTasks: null }, formChar: 'Hero',
      $: id => fields[id], toast: t => toasts.push(t), chrome: { storage: { local: { get: async () => ({ cfg: b.cfg }) } } },
      menuPatch: async (rtPatch, extra) => { sent.push({ rtPatch, cfgPatch: extra.cfgPatch }); } };
    vm.createContext(b);
    vm.runInContext(part(popup, 'async function save(e)', '// ---------- вкладки ----------') + '\n' + part(popup, 'const AUTO_TASK_LABELS =', 'let autoTaskEditQueue')
      + ';this.saveKeys=saveKeys;this.settingsFlush=settingsFlush;', b);
    return { b, fields, sent, toasts };
  };
  { const { b, sent } = mk({ nPower: 'Blaze, Aura Burn', shopReserve: 999 });
    assert.strictEqual(await b.save(), true, 'save() без события только ждёт записей'); assert.strictEqual(sent.length, 0, 'Старт/режимы не отправляют форму');
    await b.save({ target: { id: '' } }); await b.save({ target: { id: 'farmSearch' } });
    assert.strictEqual(sent.length, 0, 'галка задачи без id и поиск по ресурсам не пишут cfg (UI-1)');
    await b.save({ target: { id: 'nPower' } });
    assert.strictEqual(JSON.stringify(sent[0].cfgPatch), '{"nPower":"Blaze"}', 'одно поле — один ключ'); }
  { const { b, sent, fields, toasts } = mk();
    await b.save({ target: { id: 'shopReserve' } });
    assert.strictEqual(sent[0].cfgPatch.shopReserve, 200000, 'UI-11: пустое поле — умолчание, не 0'); assert.strictEqual(fields.shopReserve.value, 200000); assert.ok(toasts.length);
    fields.shopReserve.value = 'abc'; await b.save({ target: { id: 'shopReserve' } }); assert.strictEqual(sent[1].cfgPatch.shopReserve, 200000, 'нечисло — умолчание');
    fields.shopReserve.value = '0'; await b.save({ target: { id: 'shopReserve' } }); assert.strictEqual(sent[2].cfgPatch.shopReserve, 0, 'явный 0 сохраняется');
    await b.saveKeys(['fishGoal']); assert.strictEqual(JSON.stringify(sent[3].cfgPatch), '{"fishGoal":"a, b"}', 'saveKeys — только названные поля'); }
  { const { b, sent } = mk({ autoTasks: ['tvt', 'fish'] });
    await b.save({ target: { id: 'tvtOn' } });
    assert.strictEqual(JSON.stringify(sent[0].cfgPatch.autoTasks), '["fish"]', 'UI-3: снятая галка TvT в разделе снимает задачу TvT'); assert.strictEqual(sent[0].cfgPatch.tvtOn, false);
    assert.ok(sent[0].rtPatch.manualKickAt > 0, 'движок пересматривает задачи сразу');
    b.cfg = { autoTasks: ['fish'] }; await b.save({ target: { id: 'catMode' } });
    assert.strictEqual(JSON.stringify(sent[1].cfgPatch.autoTasks), '["fish","cat"]', 'галка «Фармить в подземелье» добавляет задачу «Катакомбы»'); assert.strictEqual(sent[1].cfgPatch.catMode, true);
    b.cfg = {}; await b.save({ target: { id: 'catMode' } }); assert.strictEqual(sent[2].cfgPatch.autoTasks, undefined, 'без списка задач — прежний флаг'); }
  { const { b } = mk(); b.saveRunning = 1; let done = false; const p = b.settingsFlush().then(() => { done = true; });
    await new Promise(r => setTimeout(r, 150)); assert.strictEqual(done, false, 'Старт ждёт уже начатого сохранения поля'); b.saveRunning = 0; await p; assert.ok(done); }
  assert.match(popup, /el\.id && \(NUM\.includes\(el\.id\) \|\| TXT\.includes\(el\.id\) \|\| BOOL\.includes\(el\.id\)\) && !\['recN',/, 'UI-1: общий change — только у полей настроек');
  assert.ok(!/Math\.max\(0, \+\$\(k\)\.value \|\| 0\)/.test(popup), 'UI-11: пустая строка больше не превращается в 0');
  for (const k of ['fishGoal', 'resQuests', 'rbSessBuffs', 'learnShots']) assert.match(popup, new RegExp(`saveKeys\\(\\['${k}'\\]\\)`), k);

  // ---------- UI-3: в режиме задач tsBuy/campAuto выключены с пояснением ----------
  { const els = {}, mkEl = id => { const label = { classList: { add() {}, remove() {} }, nextElementSibling: null, after(h) { this.nextElementSibling = h; } };
      return els[id] = { id, checked: false, disabled: false, closest: () => label, label }; };
    ['tvtOn', 'catMode', 'zoneAuto', 'tsBuy', 'campAuto'].forEach(mkEl);
    const b = { Object, $: id => els[id], document: { activeElement: null, createElement: () => ({ className: '', textContent: '', classList: { contains: c => c === 'task-owned' }, remove() {} }) } };
    vm.createContext(b);
    vm.runInContext(part(popup, 'const AUTO_TASK_LABELS =', 'const AUTO_MAIN_TASKS') + 'const TASK_FLAG_OF = { tvtOn: \'tvt\', catMode: \'cat\', zoneAuto: \'auto\' };' + part(popup, '// …и те, что в этом режиме не действуют', '// 17.10: UI показывает подтверждённые причины'), b);
    b.paintTaskOwned({ autoTasks: ['cat'] });
    assert.strictEqual(els.tsBuy.disabled, true); assert.strictEqual(els.campAuto.disabled, true); assert.strictEqual(els.catMode.checked, true); assert.strictEqual(els.tvtOn.checked, false);
    assert.match(els.tsBuy.label.nextElementSibling.textContent, /Задачи бота/); assert.match(els.tvtOn.label.nextElementSibling.textContent, /Управляется задачами/);
    let made = 0; b.document.createElement = () => { made++; return { className: '', textContent: '', remove() {} }; };
    els.tvtOn.label.nextElementSibling = { classList: { contains: () => false } };   // ui-v7 вставил своё пояснение между label и подсказкой
    b.paintTaskOwned({ autoTasks: ['cat'] }); b.paintTaskOwned({ autoTasks: ['cat'] }); assert.strictEqual(made, 0, 'перерисовка не дублирует подсказку');
    b.paintTaskOwned({ autoTasks: null }); assert.strictEqual(els.tsBuy.disabled, false, 'прежний режим — галка снова доступна'); assert.strictEqual(els.tsBuy._taskHint, null); }
  assert.match(popup, /paintTaskOwned\(d\);/, 'перерисовка каждый load()');

  // ---------- core-a/M2: ручные кнопки не отменяются списком задач ----------
  { const box = vm.createContext({}); vm.runInContext(read('engine-core.js'), box); const E = box.L2EngineCore;
    const c = E.taskConfig({ autoTasks: ['fish'] }, () => ({}));
    assert.strictEqual(E.taskJobAllowed(c, 'shop', { shop: { step: 'count', urgent: true } }), true, '«🛒 Закупить сейчас» при рыбалке');
    assert.strictEqual(E.taskJobAllowed(c, 'shop', { shop: { step: 'count' } }), false, 'плановая закупка при рыбалке по-прежнему ждёт');
    for (const k of ['bagCheck', 'faScan', 'recipeScan', 'farmScan', 'zoneScan', 'invScan']) {
      assert.strictEqual(E.taskJobAllowed(c, k, { [k]: { manual: true, t: 1 } }), true, k + ' вручную');
      assert.strictEqual(E.taskJobAllowed(E.taskConfig({ autoTasks: [] }, () => ({})), k, { [k]: true }), false, k + ' автоматически — по-прежнему по списку'); }
    assert.strictEqual(E.taskJobAllowed(c, 'rbGo', { rbGo: { manual: true } }), false, 'боевые маршруты метка не пропускает'); }
  for (const k of ['recipeScan', 'farmScan', 'zoneScan', 'bagCheck', 'faScan']) assert.match(popup, new RegExp(`menuPatch\\(\\{ ${k}: \\{ manual: true, t: Date\\.now\\(\\) \\} \\}\\)`), k);

  // ---------- UI-10 / UI-4: команды фона ----------
  { const store = { cfg: { nPower: 'Blaze', shopReserve: 1 }, 'cfg@Hero': { a: 1 }, rt: { char: 'Hero' } }, L = [];
    const ev = () => ({ addListener: f => L.push(f) });
    const chrome = new Proxy({
      runtime: { onMessage: { addListener: f => L.push(f) }, getURL: p => 'chrome-extension://x/' + p, getManifest: () => ({ version: '1' }), onInstalled: ev(), onStartup: ev(), id: 'x' },
      storage: { local: { get: async k => Object.fromEntries([].concat(k || Object.keys(store)).map(x => [x, store[x]])), set: async v => Object.assign(store, JSON.parse(JSON.stringify(v))), remove: async () => {} }, onChanged: ev(), session: { get: async () => ({}), set: async () => {} } },
      alarms: { create() {}, clear: async () => {}, get: async () => null, onAlarm: ev() }, tabs: { onRemoved: ev(), onUpdated: ev(), query: async () => [], get: async () => ({}) }
    }, { get: (o, k) => k in o ? o[k] : new Proxy({}, { get: (_, kk) => kk.startsWith('on') ? ev() : async () => {} }) });
    const ctx = { chrome, console, setTimeout, clearTimeout, setInterval, clearInterval, URL, indexedDB: undefined, self: {}, fetch: async () => ({ ok: false }) };
    ctx.globalThis = ctx; vm.createContext(ctx); try { vm.runInContext(bgSrc, ctx); } catch (e) {}
    const send = (m, s) => new Promise(r => { let done = false; for (const f of L) { const ret = f(m, s, x => { done = true; r(x); }); if (ret === true || done) return; } r(undefined); });
    const game = { url: 'https://l2wap.com/battle.html', tab: { id: 7 } }, pop = { url: 'chrome-extension://x/popup.html?dock=1' };
    assert.ok(!(await send({ cmd: 'dockMinSet', dockMin: true }, { url: 'https://evil.example/' }))?.ok, 'чужая страница не пишет');
    assert.ok(!(await send({ cmd: 'dockMinSet', dockMin: 'yes' }, game))?.ok, 'только boolean');
    assert.ok((await send({ cmd: 'dockMinSet', dockMin: true }, game))?.ok, 'док сворачивается без замка вкладки');
    assert.strictEqual(store.cfg.dockMin, true); assert.strictEqual(store.cfg.nPower, 'Blaze', 'прочие настройки не тронуты');
    assert.ok(!(await send({ cmd: 'cfgImport', cfg: { shopReserve: 5 } }, game))?.ok, 'импорт — только из меню');
    assert.ok(!(await send({ cmd: 'cfgImport', cfg: { __proto__x: 1, 'bad key': 1 } }, pop))?.ok, 'плохие ключи отклоняются');
    assert.ok((await send({ cmd: 'cfgImport', cfg: { shopReserve: 5 }, perChar: { 'cfg@Hero': { b: 2 } } }, pop))?.ok);
    assert.strictEqual(store.cfg.shopReserve, 5); assert.strictEqual(store.cfg.nPower, 'Blaze', 'импорт сливается с текущими настройками в очереди фона');
    assert.strictEqual(JSON.stringify(store['cfg@Hero']), '{"a":1,"b":2}');
    // Старт больше не пишет всю форму: нет ключа дневного лимита в cfg — фон берёт то же заводское значение, что и вкладка (1511)
    assert.strictEqual(ctx.dailyFishChange({ on: true, cfg: {}, rt: { fish: { t0: 1, caught: 0 } } }, { limit: 1511, kick: 0 }, Date.now()).ok, true, 'нет ключа — заводской лимит');
    assert.strictEqual(ctx.dailyFishChange({ on: true, cfg: { dailyFishLimit: 0 }, rt: {} }, { limit: 1511, kick: 0 }, Date.now()).ok, false, 'явный 0 — лимита нет');
    // то же для общего дневного лимита мобов: нет ключа — сверка со значением вкладки; явное число — строго
    const fq = (cfg, dl) => ctx.farmQuotaChange({ on: true, cfg: { autoTasks: ['cat'], ...cfg }, rt: {} }, { task: 'cat', op: 'begin', limit: 0, dailyLimit: dl, counter: 0, revision: 1, spawn: 'sdms_x_001', kick: 0 }, Date.now());
    assert.strictEqual(fq({}, 8000).ok, true, 'нет ключа dailyKillLimit — значение вкладки');
    assert.strictEqual(fq({ dailyKillLimit: 9000 }, 8000).reason, 'quota_changed', 'явный другой лимит — сверка строгая'); }
  { const b = { Object, JSON, Number, Array, DEF: { shopReserve: 200000, nPower: 'x', tvtOn: true, autoTasks: null, enchant: { a: 1 }, petFullReserve: null } };
    vm.createContext(b); vm.runInContext(part(popup, 'const CFG_IMPORT_EXTRA', "$('cfgImport').onclick") + ';this.clean=cfgImportClean;', b);
    const r = b.clean({ shopReserve: 7, nPower: 'Blaze', tvtOn: 'yes', autoTasks: ['fish'], enchant: { q: 1 }, dockMin: true, petFullReserve: 5, deep25: 1, evil: { x: 1 }, stopHp: 1, shopMaxSpend: -5 });
    assert.strictEqual(JSON.stringify(r.clean), '{"shopReserve":7,"nPower":"Blaze","autoTasks":["fish"],"enchant":{"q":1},"dockMin":true,"petFullReserve":5}', 'белый список и типы');
    assert.strictEqual(JSON.stringify(r.skipped), '["tvtOn","deep25","evil","stopHp","shopMaxSpend"]'); }
  assert.match(popup, /chrome\.runtime\.sendMessage\(\{ cmd: 'cfgImport', cfg: main\.clean, perChar \}\)/, 'UI-4: импорт через фон');
  assert.ok(!/const patch = \{ cfg: \{ \.\.\.cfg, \.\.\.src\.cfg \} \}/.test(popup), 'прямой записи cfg мимо очереди больше нет');

  // ---------- UI-10: док во вкладке без замка ----------
  assert.match(content, /if \(tabOwner\) await setCfg\(\{ dockMin: want \}\); else throw new Error\('not_owner'\);/);
  assert.match(content, /chrome\.runtime\.sendMessage\(\{ cmd: 'dockMinSet', dockMin: want \}\)/, 'запасной путь через фон');
  assert.match(content, /tg\.title = 'Не удалось свернуть меню/, 'отказ объясняется на кнопке');
  { const b = {}; vm.createContext(b); vm.runInContext(part(content, 'const VIEW_CFG', 'async function setCfg(') + ';this.v=viewOnlyCfgChange;', b);
    assert.strictEqual(b.v({ oldValue: { dockMin: false, a: 1 }, newValue: { dockMin: true, a: 1 } }), true, 'свернуть меню — не новое поколение');
    assert.strictEqual(b.v({ oldValue: { dockMin: false, a: 1 }, newValue: { dockMin: true, a: 2 } }), false); }

  // ---------- UI-7: док помнит список задач и прокрутку ----------
  assert.match(popup, /const DOCK_UI_KEY = 'l2bot-dockUi';\nconst dockUi = \(\(\) => \{ try \{/, 'localStorage в try/catch');
  assert.match(popup, /const dockUiSave = \(\) => \{ try \{ localStorage\.setItem\(DOCK_UI_KEY/);
  assert.match(popup, /if \(typeof dockUi\.tasksOpen === 'boolean'\) taskListOpen\(dockUi\.tasksOpen, false\);/);
  assert.match(popup, /const tabScroll = new Map\(Object\.entries\(dockUi\.scroll\)/, 'прокрутка разделов из localStorage');
  assert.match(popup, /load\(\)\.catch\(\(\) => \{\}\)\.finally\(\(\) => \{ restoreTabScroll\(\);/);
  // 20.12 (новая компоновка): строка задач в шапке открывает «Обзор» со списком; состояние по-прежнему пишет taskListOpen
  assert.match(ui7, /modeToggle\?\.addEventListener\('click', \(\) => \{ if \(typeof taskListToggle === 'function'\) taskListToggle\(\); \}\);/, 'кнопка списка задач запоминает состояние');
  assert.match(popup, /function taskListToggle\(\) \{[\s\S]*?showTab\('overview'\); taskListOpen\(true\);/);
  assert.match(html, /id="modeToggle"/); assert.match(html, /id="quickModeGrid"/);

  // ---------- UI-8/UI-9: окно бота ----------
  { let redraws = 0, timers = []; const b = { Date, setTimeout: (f, ms) => timers.push(f), draw: () => redraws++, document: {} };
    vm.createContext(b); vm.runInContext(part(content, 'let indAsk =', 'function draw()') + ';this.ask=indAskFirst;this.patch=indPatch;this.state=()=>indAsk;', b);
    assert.strictEqual(b.ask('mm:order'), true, 'первое нажатие только просит подтвердить'); assert.strictEqual(b.state().key, 'mm:order');
    assert.strictEqual(b.ask('mm:order'), false, 'второе — выполнить'); assert.strictEqual(b.state().key, '');
    assert.strictEqual(b.ask('mm:smith'), true); assert.strictEqual(b.ask('rbrun:reset'), true, 'другая кнопка — снова первое нажатие'); assert.ok(redraws >= 3);
    let sets = 0; const el = { _h: '', set innerHTML(v) { sets++; this._h = v; }, get innerHTML() { return this._h; } };
    b.patch(el, '<div>a</div>'); b.patch(el, '<div>a</div>'); assert.strictEqual(sets, 1, 'та же разметка — DOM не трогаем'); b.patch(el, '<div>b</div>'); assert.strictEqual(sets, 2); }
  assert.match(content, /if \(indAskFirst\('mm:' \+ npc\)\) return;/, 'UI-8: Маммон вторым нажатием');
  assert.match(content, /if \(indAskFirst\('rbrun:reset'\)\) return;/, 'UI-9: «↺ Новая серия» — подтверждение не в DOM');
  assert.ok(!/b\.dataset\.ask/.test(content), 'подтверждение больше не хранится в dataset кнопки');
  assert.match(content, /indPatch\(ui, lines\.map\(/, 'draw() правит узлы на месте');

  // ---------- UI-5: скрытые панели не перечитывают cfg+rt ----------
  for (const [id, ui] of [['enchantPanel', 'enchantUI'], ['warlockPanel', 'warlockUI'], ['pvpTargetsPanel', 'pvpUI']]) assert.match(popup, new RegExp(`panelRefresher\\(\\$\\('${id}'\\), \\(\\) => ${ui}\\.refresh\\(\\)`), id);
  { const sec = { classList: { contains: c => c === 'act' } }; let closed = false;
    const el = { closest: s => s === 'section' ? sec : s === '.card.closed' ? (closed ? {} : null) : null, contains: () => false };
    const L = [], D = {}, Q = []; let refreshed = 0; const fire = (ch) => { if (ch) L[0](ch); while (Q.length) Q.shift()(); };
    const b = { setTimeout: (f) => { Q.push(f); return 1; }, dockMin: false, document: { hidden: false, activeElement: null, addEventListener: (k, f) => { D[k] = f; } }, chrome: { storage: { onChanged: { addListener: f => L.push(f) } } } };
    vm.createContext(b); vm.runInContext(part(popup, 'function panelShown(el)', "panelRefresher($('enchantPanel')") + ';this.pr=panelRefresher;', b);
    b.pr(el, async () => { refreshed++; }, 350);
    fire({ rt: {} }); assert.strictEqual(refreshed, 1, 'видимая панель обновляется');
    closed = true; fire({ rt: {} }); fire({ rt: {} }); assert.strictEqual(refreshed, 1, 'свёрнутая карточка не читает storage');
    closed = false; D['l2:cardtoggle'](); fire(); assert.strictEqual(refreshed, 2, 'раскрыли — одно обновление');
    D['l2:cardtoggle'](); fire(); assert.strictEqual(refreshed, 2, 'без новых записей — повторно не читаем');
    b.dockMin = true; fire({ rt: {} }); assert.strictEqual(refreshed, 2, 'свёрнутый док не перерисовывается');
    b.document.hidden = true; b.dockMin = false; fire({ cfg: {} }); assert.strictEqual(refreshed, 2, 'скрытая вкладка');
    b.document.hidden = false; D.visibilitychange(); fire(); assert.strictEqual(refreshed, 3, 'вернулись — обновили один раз'); }
  console.log('PASS v2012-panel-audit: поля сохраняются по одному, пустое поле — умолчание, переключатели режима задач честные, ручные кнопки не отменяются, док помнит вид, окно бота без потерянных кликов и с подтверждением Маммона, импорт через фон, скрытые панели не читают storage');
})().catch(e => { console.error('FAIL v2012-panel-audit:', e); process.exit(1); });
