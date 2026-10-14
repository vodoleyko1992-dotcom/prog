'use strict';
// 8.0.3 (игрок 11.10: «кнопку — убить одного РБ и ждать команды, после команды убить ещё РБ и так каждый раз;
// это когда я не могу 24/7 сидеть смотреть за ботом, а даю ему по 1 РБ за раз»)
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const load = f => { const sb = { console, Date, Math, JSON, CSS: { escape: s => s }, document: { querySelectorAll: () => [], querySelector: () => null }, location: { pathname: '/map.html', href: '' } };
  sb.globalThis = sb; vm.runInNewContext(read(f), sb); return sb; };
const mk = rt => {
  const log = { pauses: [], done: [] };
  // 10.0.14: проверка команды «один РБ» выполняется активным владельцем вкладки.
  const env = { on: true, tabOwner: true, cfg: { rbHuntMode: true, rbMode: true, rbMaxBelow: 15, rbMaxAbove: 15, rbRestHp: 95 }, rt, heroLvl: () => 54, RB_WIN: 15, RB_TRY_MS: 0,
    setRt: async p => Object.assign(env.rt, p), rec: (...a) => log.done.push(a.join(' ')), recBot: () => {}, setStatus: () => {},
    pauseBot: async msg => { log.pauses.push(msg); }, isMap: () => false, sleep: async () => {}, map: async () => {} };
  return { env, log, R: load('modules/raid.js').L2V7Factories.raid(env) };
};
(async () => {
  // 1. бой закончен убийством — пауза с понятным текстом, счётчик «по команде» +1, тур — снова с выбора
  { const { env, log, R } = mk({ rbKills: 19, rbOne: { on: true, k0: 18 }, rbHunt: { step: 'fight', id: 'l2dop_rb_1', name: 'Залізний Гігантський Тотем' }, rbDb: { l2dop_rb_1: { kills: 1, verdict: 'ok' } } });
    await R.rbHuntStep();
    assert.equal(log.pauses.length, 1, 'paused after the kill');
    assert.match(log.pauses[0], /По одному РБ: Залізний Гігантський Тотем убит \(1-й по команде\) — жду команды/);
    assert.equal(env.rt.rbOne.k0, 19, 'next command counts from the current kills');
    assert.equal(env.rt.rbOne.n, 1); assert.equal(env.rt.rbOne.on, true, '«▶ Продолжить» = one more RB');
    assert.equal(env.rt.rbHunt.step, 'pick');
    assert.ok(env.rt.rbGoTried.l2dop_rb_1, 'the killed boss is marked as tried (30 min)'); }
  // 2. отошёл / не по силам — не пауза: «один РБ» = пока не убьёт одного
  { const { log, R } = mk({ rbKills: 18, rbOne: { on: true, k0: 18 }, rbHunt: { step: 'fight', id: 'x', name: 'X' }, rbDb: { x: { verdict: 'no', heroLvl: 54 } } });
    await R.rbHuntStep();
    assert.equal(log.pauses.length, 0, 'no kill — keep going'); }
  // 3. РБ убит вне шага боя (на карте между делом) — тоже пауза
  { const { log, R } = mk({ rbKills: 21, rbOne: { on: true, k0: 20 }, rbHunt: { step: 'pick' }, rbListT: Date.now() });
    await R.rbHuntStep();
    assert.equal(log.pauses.length, 1); }
  // 4. обычный тур (без «по одному») — без остановок
  { const { log, R } = mk({ rbKills: 30, rbHunt: { step: 'fight', id: 'y', name: 'Y' }, rbDb: { y: { kills: 3 } } });
    await R.rbHuntStep();
    assert.equal(log.pauses.length, 0, 'plain tour never pauses'); }
  // 5. 10.0.2 (лог 12.10 01:00:20–01:00:39): Rahha убит, а до паузы сторож баффов успел купить набор за FA — rbOneStep ядро зовёт первым
  { const { env, log, R } = mk({ rbKills: 2, rbOne: { on: true, k0: 1 }, rbHunt: { step: 'fight', id: 'l2dop_rb_25051', name: 'Rahha' }, rbDb: { l2dop_rb_25051: { kills: 1 } },
      rbSess: { on: true, bought: true, until: Date.now() + 3600000 } });
    let sess = 0; env.faFullIds = () => { sess++; return [1413]; };
    assert.equal(await R.rbOneStep(), true, 'kill by command — handled');
    assert.equal(log.pauses.length, 1); assert.match(log.pauses[0], /Rahha убит/);
    assert.equal(sess, 0, 'RB session tick (FA buffs) is not run after the commanded kill');
    assert.equal(await R.rbOneStep(), false, 'after the pause the next kill is counted from the new k0'); }
  { const { log, R } = mk({ rbKills: 5, rbHunt: { step: 'fight', id: 'y', name: 'Y' } });
    assert.equal(await R.rbOneStep(), false, 'plain tour — no-op'); assert.equal(log.pauses.length, 0); }
  { const content = read('content.js'), i1 = content.indexOf('await L2V7Modules.raid.rbOneStep()'), i2 = content.indexOf("townBuffStart('сторож: баффы слетели')"),
      i3 = content.indexOf('if (rt.shop && (!isBattle() || rt.shop.urgent)'), i4 = content.indexOf('if (rt.tbuff && !isBattle()');
    assert.ok(i1 > 0 && i1 < i2 && i1 < i3 && i1 < i4, 'core: «one RB killed» pause comes before the buff watchdog, shop and town buff'); }
  // ядро: пауза = как кнопка «⏸ Пауза» (on:false + paused), геттер модуля есть
  const content = read('content.js');
  assert.match(content, /async function pauseBot\(msg\) \{\n  rec\('B', 'пауза', msg\);\n  on = false;\n  await chrome\.storage\.local\.set\(\{ on: false, paused: \{ t: Date\.now\(\), why:/);
  // 10.0.15: новые lazy getters не меняют контракт pauseBot и не обязаны идти после него.
  assert.match(content.match(/L2V7Modules\.raid = L2V7Factories\.raid\(\{([\s\S]*?)\}\);/)?.[1] || '', /get pauseBot\(\) \{ return pauseBot; \}/);
  assert.match(content, /am === 'raid' && rt\.rbOne\?\.on && '🎯 по одному РБ'/, 'indicator shows the mode');
  // меню: кнопка в «Центре управления» РБ; повторное нажатие во время работы не сбивает; выбор режима руками — обычный тур
  const html = read('popup.html'), popup = read('popup.js');
  const box = html.slice(html.indexOf('<div class="rb-summary">'), html.indexOf('<div class="rb-primary">'));
  assert.match(box, /<button id="rbOneBtn" type="button"[^>]*>🎯 Убить один РБ и ждать команды<\/button><div id="rbOneInfo" class="hint"><\/div>/);
  assert.match(popup, /if \(on && cfg\.rbHuntMode && rt\.rbOne\?\.on\) return toast\(/);
  assert.match(popup, /const one = \{ \.\.\.\(rt\.rbOne \|\| \{\}\), on: true, k0: rt\.rbKills \|\| 0, t: now \};/);
  assert.match(popup, /\.\.\.\(tour \? \{\} : \{ (?:rbRun: \{ t0: now, mode: 'one' \}, )?rbHunt: \{ step: 'pick', t: now, last: 'один РБ по команде' \}, rbGo: null, rbWant: null, rbListT: 0 \}\)/, 'tour already running — no list rescan');   // 10.0.6: + rbRun — новая «📦 Серия РБ»
  assert.match(popup, /if \(rt\.rbOne\?\.on\) await menuPatch\(\{ rbOne: \{ \.\.\.rt\.rbOne, on: false \} \}\); \}   \/\/ 8\.0\.3: режим выбран руками/);
  assert.match(popup, /\.\.\.\(rt\.rbOne\?\.on \? \{ rbOne: \{ \.\.\.rt\.rbOne, on: false \} \} : \{\}\) \};\n  const mode = \{ rbHuntMode: v,/, 'tour toggle = plain tour');
  assert.match(popup, /paintRbOne\(rt, on, paused\);/);
  console.log('PASS: 8.0.3 «🎯 Один РБ и ждать команды» — pause after one kill, «Ещё один РБ»/«Продолжить» = one more, plain tour unaffected');
})().catch(e => { console.error(e); process.exit(1); });
