'use strict';
// 8.0 (аудит меню): живая сводка «Обзора», «📤 Логи для разбора», постоянная строка неудачного запуска, тосты,
// скрытие воинских блоков у мага, устаревшие тексты, экономная перерисовка дока, индикатор на странице игры
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const nb = s => String(s).replace(/[\u00a0\u202f]/g, ' ');   // toLocaleString('ru') ставит неразрывный пробел
const html = read('popup.html'), js = read('popup.js'), ui = read('ui-v7.js'), css = read('ui-game.css'), content = read('content.js');
// исходник функции верхнего уровня по имени (подсчёт скобок; строки/шаблоны в этих функциях скобок не путают)
const fnSrc = (src, head) => {
  const a = src.indexOf(head); assert.ok(a >= 0, 'not found: ' + head);
  let i = src.indexOf('{', a), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(a, i + 1);
};

// ---------- 1. разметка «Обзора» ----------
const ov = html.slice(html.indexOf('<section id="tab-overview"'), html.indexOf('</section>', html.indexOf('<section id="tab-overview"')));
for (const id of ['dash', 'dashMode', 'dashState', 'dashSub', 'dashKpi', 'dashLines', 'logsAll', 'logsNote']) assert.match(ov, new RegExp(`id="${id}"`), id);
assert.match(html, /<div id="wakeWarn" class="wake-warn" role="alert" hidden><\/div>/);
assert.ok(!/overview-stat|help-steps|important-note|intro-callout/.test(ov), 'static intro and duplicated tiles removed');
// 20.12 (ревизия 17.10): список задач перенесён в «Обзор» — в нём законно есть «Кампании»; старые тексты ищем вне него.
const ovText = ov.replace(/<fieldset id="autoTaskSelection">[\s\S]*?<\/fieldset>/, '');
assert.ok(!/модуль слева|значок «\?»|[Кк]ампани/.test(ovText), 'no stale texts on the overview');
assert.match(ov, /class="dash no-card"/); assert.match(ov, /class="dash-actions no-card"><button id="logsAll"/);
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(x => x[1]); assert.equal(new Set(ids).size, ids.length, 'duplicate ids');

// ---------- 2. класс: воинские блоки у мага скрыты ----------
assert.match(html, /<label data-cls="fighter">Заряды на РБ, пока мощные навыки на откате <input id="rbCharge"/);
assert.match(html, /<div class="hint" data-cls="fighter">Focused Force применяется/);
assert.match(html, /<div class="hint" data-cls="fighter">Модель 100 000 боёв \(воин\): бафф Bear/);
assert.match(html, /<div class="hint" data-cls="fighter">Воин на TvT: перед силовыми — стан/);
assert.ok(!/удары за энергию и силовые, банки HP/.test(html), 'TvT text for everyone has no energy strikes');
assert.match(js, /if \(prev\?\.matches\('details\.help'\) && \(prev\.dataset\.cls \|\| ''\) === \(h\.dataset\.cls \|\| ''\)\)/, 'a common hint is not folded into a fighter-only fold');
{ // «Расчёт ДПС» у мага — без энергии, тотемов и воинской стратегии
  const box = { textContent: '' };
  const sb = { $: () => box, Math, Object, String };
  vm.runInNewContext(fnSrc(js, 'function renderDps(') + '\n' + fnSrc(js, 'function totemLines('), sb);
  const rt = { turnMs: 1230, force: { n: 1, max: 2 }, buffEff: { bear: { n: 20, r: 1.1, name: 'Bear' } },
    skills: { blaze: { name: 'Blaze', dmg: 8950, dmgN: 10, mp: 220, mpN: 10, cd: 3.1 }, 'force blaster': { name: 'Force Blaster', dmg: 3000, dmgN: 3 } } };
  sb.renderDps(rt, 'mage');
  assert.ok(!/энерги|эн\. →|Тотем|копит/i.test(box.textContent), box.textContent);
  assert.match(box.textContent, /Стратегия мага: добивание/); assert.match(nb(box.textContent), /Blaze: ≈895 урона/);
  sb.renderDps(rt, 'fighter'); assert.match(box.textContent, /энергия ⚡1\/2/); assert.match(box.textContent, /Тотемы/);
  sb.renderDps(rt); assert.match(box.textContent, /энергия ⚡/, 'class unknown — full text as before');
}

// ---------- 3. устаревшие тексты ----------
assert.ok(!/<h4>📜 Квесты<\/h4>/.test(html), 'card with only a help fold removed');
assert.ok(!/«Фарм РБ»|фарм РБ\./.test(html + js), 'old name «Фарм РБ»');
assert.ok(!/вкладке «Скиллы»|вкладки «Банки»/.test(html), 'old section names');
assert.ok(!/Кампани/.test(html.replace(/<button id="campToggle"[^>]*>[^<]*<\/button>/, '').replace(/<!--[\s\S]*?-->/g, '')), 'no campaign in visible texts');
// 20.12 (ревизия 17.10): таблица заголовков разделов в ui-v7.js убрана — подпись раздела теперь в title кнопки навигации.
assert.match(html, /<button data-tab="hunt"[^>]*title="Цепочка, чемпионы, окно уровней, автофарм, катакомбы, цель ресурса \(Alt\+2\)"/);
assert.ok(!/кампани/i.test(fnSrc(ui, 'const HELP = {')), 'help texts without campaign');
assert.ok(!/overviewKills|async function overview\(\)/.test(ui), 'second storage poll of the overview removed');
// 20.12 (ревизия 17.10): cardify кладёт в текущий контейнер dest (раздел или блок «Дополнительно»).
assert.match(js, /if \(n\.nodeType === 1 && n\.classList\?\.contains\('no-card'\)\) \{ dest\.appendChild\(n\); card = null; continue; \}/);
assert.match(js, /if \(!card && n\.nodeType === 1 && n\.hidden\) \{ dest\.appendChild\(n\); continue; \}/, 'hidden fields do not create an empty «⚙ Основное» card');
{ // «Удочка пока неизвестен» → «неизвестна»
  const el = {}; const sb = { $: id => (el[id] ||= { textContent: '' }), Number };
  vm.runInNewContext(fnSrc(js, 'function renderRodGoal('), sb);
  sb.renderRodGoal({}, {}); assert.match(el.fishRodGoalStatus.textContent, /^Заточка удочки пока неизвестна\./);
  sb.renderRodGoal({ rodLvl: 4 }, {}); assert.match(el.fishRodGoalStatus.textContent, /^Удочка \+4\./);
  sb.renderRodGoal({ rodGoalActive: true }, {}); assert.match(el.fishRodGoalStatus.textContent, /^Цель \+10: текущий уровень пока неизвестен\./);
}

// ---------- 4. чистые функции сводки ----------
const helpers = js.slice(js.indexOf('// ==== 8.0 (аудит меню): сводка «Обзора»'), js.indexOf('// ==== /8.0 сводка «Обзора» ===='));
const H = { Math, Object, String, Number, Map, Date };
vm.runInNewContext(helpers + '\nglobalThis.fmtBig = fmtBig; globalThis.fmtDur = fmtDur;', H);
const T = 1_800_000_000_000;
{ const s = H.sessInfo({ exp: 1000, adena: 50, kills: 3 }, T); assert.equal(s.exp, null, 'no ↺ mark — totals only, no per-hour');
  const s1 = H.sessInfo({ sessT0: T - 3600000, exp: 4200000, adena: 480000, kills: 640 }, T);
  assert.equal(Math.round(s1.exp), 4200000); assert.equal(Math.round(s1.adena), 480000); assert.equal(Math.round(s1.kills), 640);
  assert.equal(H.sessInfo({ sessT0: T - 60000, exp: 5000, kills: 1 }, T).exp, null, 'first 2 minutes — no rate');
  assert.equal(Math.round(H.sessInfo({ sessT0: T - 1800000, exp: 1000000 }, T).exp), 2000000); }
assert.equal(H.fmtBig(3456789), '3,5 млн'); assert.equal(H.fmtBig(402500), '403 тыс.'); assert.equal(H.fmtDur(72 * 60000), '1 ч 12 мин'); assert.equal(H.fmtDur(5 * 60000), '5 мин');
{ const f = H.fishRate({ fishSess: { t0: T - 3600000, last: T, n: 560 }, fishProofGain: 330, fishProofFish: 1000 }, T);
  assert.equal(Math.round(f.perH), 560); assert.equal(Math.round(f.proofH), 185); assert.equal(f.fresh, true);
  const g = H.fishRate({ fishSess: { t0: T - 3600000, last: T, n: 100 }, fishVal: { a: { n: 10, proof: 5 }, b: { n: 10, proof: 1 } } }, T);
  assert.equal(g.perFish, 0.3, 'no exchange yet — Proof per fish from cut results'); assert.equal(H.fishRate({}, T), null); }
{ const rt = { pots: { a: { kind: 'hp', n: 1085, t: 5 }, b: { kind: 'hp', n: 49 }, c: { kind: 'mp', n: 983 }, d: { kind: 'mp' } },
    bagAll: { t: 7, n: { 'Благословенний заряд духу': 11596, 'Рибальський заряд душі': 7203, 'Coal': 5 } } };
  const u = H.suppliesOf(rt, { nShots: 'Благословенний заряд духу', shopHp: '300/1000', shopMp: '20/100', shopShots: '1000/5000' });
  assert.deepEqual([u.hp, u.mp, u.shots, u.shotsT, u.hpMin, u.shotsMin], [1134, 983, 11596, 7, 300, 1000], 'fishing shots are not weapon shots');
  const e = H.suppliesOf({}, {}); assert.deepEqual([e.hp, e.mp, e.shots], [null, null, null], 'nothing known — nothing shown'); }
{ const sk = [1, 2, 3, 4, 5, 6].map(i => ({ name: 'Boss ' + i, lvl: 40 + i, why: 'игра не даёт: доступно лише для героїв 60+' })).concat([{ name: 'Ikuntai', lvl: 51, why: '❌ не по силам' }]);
  const g = H.skipGroups(sk);
  assert.equal(g.length, 2); assert.equal(g[0], '• игра не даёт: доступно лише для героїв 60+ (6): Boss 1 41, Boss 2 42, Boss 3 43, Boss 4 44 … ещё 2');
  assert.equal(g[1], '• Ikuntai 51 — ❌ не по силам'); }
{ const t = H.rbLineOf({ rbHunt: { step: 'fight', name: 'Hatar', lvl: 52 }, rbKills: 3, rbWound: { x: { cur: 43, max: 100, t: T - 60000, name: 'Ikuntai' }, old: { cur: 1, max: 100, t: T - 3600000 } } }, { rbHuntMode: true }, T);
  assert.equal(t, '👑 Тур: бой · Hatar (52) · убито 3 · недобит: Ikuntai 43 %');
  assert.equal(H.rbLineOf({}, {}, T), '', 'no tour, no kills — no RB line'); }
assert.equal(nb(H.petLineOf({ petStat: { kai: { name: 'Kai the Cat', fights: 12, hits: 175, hitDmg: 336165, crits: 4, misses: 43, dmg: 366093, dealt: 2550216, deaths: 0, t: 2 }, mew: { name: 'Mew', fights: 50, hits: 10, t: 1 } } })),
  '🐱 Kai the Cat · боёв 12 · удар ≈1 921 · промахов 19 % · 14 % урона · гибель 0', 'the most recent cat');
// сводка и чип ⏱ — темп сессии, а не rt.eff за всё время
assert.match(js, /chip\('⏱', fmtBig\(S\.exp\) \+ ' EXP\/ч', 'EXP в час за сессию \(с нажатия ↺\)'\)/);
assert.ok(!/eh = expHour\(rt\)/.test(js), 'header chip no longer uses lifetime rt.eff');
assert.match(js, /renderDash\(rt, d, \{ on, paused, heartbeatValid, booting, failing \}\);/);
assert.match(js, /sessT0: Date\.now\(\) \}\);/, '↺ starts the session');

// ---------- 5. «📤 Логи для разбора»: журнал → снимки → отчёт, по очереди ----------
const ex = fnSrc(js, 'async function exportAll(');
const order = ['readLog({ after: exLogKey })', 'exportLog(rows, title, true)', 'readSnaps(exSnapT)', 'exportSnaps(snaps', 'learnReportDl()'].map(x => ex.indexOf(x));
assert.ok(order.every((v, i) => v > 0 && (!i || v > order[i - 1])), 'sequential exports: ' + order);
assert.match(ex, /rows = await readLog\(\{ since: t0\.getTime\(\) \}\); title = 'сегодня';/, 'nothing new — today');
assert.match(js, /\$\('learnReport'\)\.onclick = learnReportDl;/); assert.match(js, /if \(\$\('logsAll'\)\) \$\('logsAll'\)\.onclick = exportAll;/);
assert.match(fnSrc(js, 'async function exportLog('), /return false; \}[\s\S]*return true;\n\}$/);

// ---------- 6. неудачный запуск и тосты ----------
{ const sb = {}; vm.runInNewContext(js.slice(js.indexOf("const WAKE_KEY"), js.indexOf('function paintWakeWarn(')), sb);
  assert.equal(sb.wakeWarnText('Откройте вкладку l2wap.com, затем включите режим'), 'Бот включён, но вкладка игры не отвечает — откройте l2wap.com');
  assert.equal(sb.wakeWarnText('Не получено подтверждение после обновления вкладки. Проверьте активную версию расширения.'), 'Бот включён, но вкладка игры не отвечает — откройте l2wap.com');
  assert.match(sb.wakeWarnText('Вкладка не получила управление: закройте другие вкладки L2WAP и повторите Старт'), /^Бот включён, но игра не подтвердила запуск: Вкладка не получила/); }
const sw = fnSrc(js, 'async function showWakeResult(');
assert.match(sw, /wakeWarnSet\(\{ text, reason: result\.reason, t: Date\.now\(\) \}\);\s*paintWakeWarn\(true, text\);/);
assert.ok(!/\$\('status'\)\.textContent = '⚠ ' \+ result\.reason/.test(sw), 'no longer written into #status (the next redraw erased it)');
assert.match(js, /if \(!on \|\| heartbeatValid\) \{ if \(w\) wakeWarnSet\(null\); paintWakeWarn\(false\); \}/, 'line disappears on engine signal or Stop');
{ const sb = { String }; vm.runInNewContext(js.match(/const toastMs = [^\n]+/)[0].replace('const toastMs', 'globalThis.toastMs'), sb);
  assert.equal(sb.toastMs('⚠ Бот включён, но вкладка игры не отвечает'), 4000); assert.equal(sb.toastMs('✓ Сохранено'), 1400);
  assert.equal(sb.toastMs('x', 'var(--bad)'), 4000); assert.equal(sb.toastMs('Список зон обновится после ▶ Старт (или откройте «Телепорт» — зоны читаются сами)'), 3000); }
assert.match(css, /#toast\{white-space:normal;width:max-content;max-width:calc\(100vw - 24px\)/, 'toasts wrap at 375 px');
assert.ok(!/\$\('status'\)\.textContent = on \?/.test(js), 'hints after buttons are toasts, not #status text erased by the next redraw');

// ---------- 7. экономная перерисовка встроенного меню ----------
const lst = js.slice(js.indexOf('function loadSoon()'), js.indexOf("document.addEventListener('visibilitychange'"));
assert.match(lst, /if \(document\.hidden \|\| dockMin\) \{ loadPending = true; return; \}/, 'collapsed dock is not redrawn');
assert.match(lst, /if \(ch\.cfg \|\| ch\.rt \|\| ch\.on \|\| ch\.paused \|\| ch\.wdog\) return loadSoon\(\);/);
assert.match(lst, /if \(ch\.reccount \|\| ch\.snapcount\) \{[\s\S]*showCounts\(recN, snapN\);/, 'journal counters only');
assert.ok(!/ch\.reccount \|\| ch\.snapcount \|\| ch\.wdog\) loadSoon/.test(js));
assert.match(js, /if \(dlSig\.mob !== sig\) \{ dlSig\.mob = sig; \$\('mobNames'\)\.innerHTML/, 'mob names list rebuilt only when spawns changed');
assert.match(js, /if \(huntOpen\(\)\) renderHuntDb\(rt, d\);/, 'farm/recipe bases only with «Охота» open');
assert.match(js, /document\.addEventListener\('l2:tabchange', async e => \{\s*if \(e\.detail\?\.tab !== 'hunt'\) return;/);
assert.ok(!/^\s*renderRes\(rt, d\);\s*$/m.test(fnSrc(js, 'async function load(')), 'load() no longer reads farmDb on every redraw');

// ---------- 8. индикатор на странице игры ----------
{ const a = content.indexOf("const escH = t =>"), b = content.indexOf('// стоп с клавиатуры — двойной Esc');
  const src = content.slice(a, b);
  assert.match(src, /chrome\.storage\.onChanged\.addListener\(ch => \{ if \(ch\.paused\) \{ indPaused = ch\.paused\.newValue \|\| null;/);
  const mk = over => {
    const listeners = [];
    const sb = { Date, Math, Object, String, Number, console, document: {},
      chrome: { storage: { local: { get: async () => ({ paused: over.paused || null }) }, onChanged: { addListener: fn => listeners.push(fn) } } },
      ui: { classList: { contains: () => false }, style: {}, innerHTML: '' },
      cfg: { indMode: 'full', nShots: 'Благословенний заряд духу', tvtOn: true, ...over.cfg }, rt: { status: 'Бой: Hatar', kills: 10, exp: 5000, ...over.rt }, on: !!over.on,
      forceNow: () => 0, forceMax: () => 0, autonomyMode: () => over.am || 'farm', isBattle: () => false, mpPotSlot: () => null, potBag: () => null, slotsBy: () => [], qty: () => null,
      names: s => (s || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean), meHp: () => null, meMp: () => null, activeBuffs: () => [], hpPots: () => [], rbLive: null,
      huntOn: () => false, fmtT: s => String(s), fmtK: n => String(n), fishRateTxt: () => '', questSummary: () => '', RECENT: [] };
    vm.runInNewContext(src.replace(/^let indPaused = null;/m, `let indPaused = ${JSON.stringify(over.paused || null)};`), sb);
    sb.draw(); return { text: nb(sb.ui.innerHTML).replace(/<[^>]+>/g, '\n').replace(/\n+/g, '\n').trim(), sb };
  };
  let r = mk({ on: true, cfg: { zoneAuto: true, rbMode: true }, rt: { sessT0: Date.now() - 3600000, exp: 3500000, adena: 400000, health: { action: 'retry', failures10m: 2, updatedAt: Date.now() },
    pots: { m: { kind: 'mp', n: 983 } }, bagAll: { n: { 'Благословенний заряд духу': 11596 } } } });
  assert.match(r.text, /^L2wap Bot · работает · 🗺 автофарм \+ TvT/);
  assert.match(r.text, /▶ Бой: Hatar/);
  assert.match(r.text, /⏱ 1 ч 00 мин · EXP 3,5 млн\/ч · адена 400 тыс\.\/ч · 💧 банок MP 983 · ✨ зарядов 11 596/);
  assert.match(r.text, /🛠 Сбой — повтор действия · сбоев за 10 мин: 2/); assert.ok(!/retry|Восстановление:/.test(r.text), 'no raw English recovery words');
  r = mk({ on: false, paused: { t: 1 } });
  assert.match(r.text, /^L2wap Bot · ⏸ пауза · ⚔ фарм на месте \+ TvT/); assert.match(r.text, /последнее: Бой: Hatar/);
  assert.match(r.sb.ui.innerHTML, /<div class="s old">последнее:/, 'last status dimmed when the bot does not work');
  r = mk({ on: false, am: 'raid', cfg: { rbMode: true, tvtOn: false } });
  assert.match(r.text, /^L2wap Bot · остановлен · 👑 тур по РБ\n/, 'RB between mobs is not repeated in the tour; no TvT');
  r = mk({ on: true, am: 'fish' }); assert.match(r.text, /^L2wap Bot · работает · 🎣 рыбалка \+ TvT/);
  assert.match(content, /#l2bot-ind \.s\.old\{color:#a39280;font-weight:400/);
}
console.log('PASS: 8.0 menu audit — live overview (session rates, RB, fishing, supplies, cat), logs in one click, persistent failed-start line, wrapping toasts');
console.log('PASS: 8.0 menu audit — mage sees no fighter blocks, stale texts gone, RB skip reasons grouped, dock redraws only when visible, indicator shows the real mode/pause/session');
