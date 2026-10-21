'use strict';
// 20.43 (разбор логов John 21.10 13:21/13:30, бот 20.42.2): спойл у Bounty Hunter / Fortune Seeker.
//  1) 22:07–22:08, FS с Elysian (дубина), настройки nSpoil «Spoil»: префикс роли находит и Spoil, и Spoil Crush, но порядок и crushFirst
//     смотрели имя роли — Crush первым не шёл никогда; отказ Crush блокировал всю роль «spoil» (и обычный Spoil).
//  2) 21:35–22:00, BH с пикой: Festival (откат ≈2,7 с) готов через ≈0,1–0,6 с, а бот жал обычный Spoil — Whirlwind клал пачку без спойла.
//  3) 21:39:00–21:39:20: Festival пометил всех 4, ход — 423 капча; после капчи новый ctx снова нажал Festival («вже заспойлено» у всех 4).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(root, 'modules/loot.js'), 'utf8');
const names = s => String(s || '').toLowerCase().split(/[,|]/).map(x => x.trim()).filter(Boolean);
const cleanTitle = t => (t || '').split(/\s+[—–-]\s+|\s*\(/)[0].trim();          // как content.cleanTitle
function store() { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; }

function fixture(o = {}) {
  const solo = { title: 'Spoil', id: 'l2_254', cd: 0 }, crush = { title: 'Spoil Crush', id: 'l2_348', cd: 0 }, mass = { title: 'Spoil Festival', id: 'l2_302', cd: 0 };
  const slots = o.slots || [solo, crush, mass];
  const calls = [], lines = [], recs = [], sleeps = []; let marked = false, near = o.near || [];
  // как combat.slotsBy: title начинается с названия роли и дальше граница слова; точное совпадение — первым
  const slotsBy = str => { const alts = names(str); if (!alts.length) return [];
    const exact = b => alts.includes(cleanTitle(b.title).toLowerCase());
    return slots.filter(b => { const t = b.title.toLowerCase(); return alts.some(a => t.startsWith(a) && (t.length === a.length || /[\s(:.—–-]/.test(t[a.length]))); })
      .sort((a, b) => exact(b) - exact(a)); };
  const env = {
    cfg: { nSpoil: 'Spoil', nSpoilMass: 'Spoil Festival', ...(o.cfg || {}) }, rt: { char: 'Warlock' },
    weaponNow: () => o.wt === null ? null : { id: 164, wt: o.wt ?? 'древковое' }, roleNow: () => o.role || 'spoiler',
    names, slotsBy, cleanTitle, extraMobs: () => near,
    ready: b => !b.disabled && !(b.cd > 0), cdLeft: o.noCdLeft ? undefined : b => (!b.disabled && !(b.cd > 0) ? 0 : b.cd || 99),
    sleep: async ms => { sleeps.push(ms); for (const b of slots) b.cd = Math.max(0, +(b.cd - ms / 1000).toFixed(3)); },
    meMp: () => o.mp || { cur: 2000, max: 2060 }, skillMp: n => /festival/i.test(n) ? 194 : 67,
    logLines: () => lines.slice(), newLines: (a, b) => b.slice(a.length),
    mobSpoiled: () => marked, nameLike: (a, b) => { a = (a || '').toLowerCase().trim(); b = (b || '').toLowerCase().trim(); return !!a && !!b && (a === b || a.includes(b) || b.includes(a)); },
    SPOIL_OK: /(спойл|spoil)[^.]{0,40}(успіш|успіх)|(вже)\s+заспойл/i, SPOIL_FAIL: /(спойл|spoil)[^.]{0,40}не вдав/i, SPOIL_LOOT: /^(?:Спойл|Spoil)\s*:?\s*(.+?)\s*×\s*(\d+)/i,
    waitFor: async fn => fn(), noticeText: () => '', rec: (...a) => recs.push(a.join(' ')), setRt: async p => Object.assign(env.rt, p),
    $q: () => null
  };
  const box = { console, URLSearchParams, Date, Math, location: { search: '?spawnId=' + (o.spawn || 'dense_12145') }, sessionStorage: o.ss || store() };
  vm.runInNewContext(SRC, box);
  const api = box.L2V7Factories.loot(env);
  const act = async b => { calls.push(b.id); const r = o.act?.(b) ?? true; if (r !== true) return r;
    b.cd = b === mass ? 2.7 : b === crush ? 2.1 : 1.4;
    if (b === crush) { if (o.crushFail) lines.push('Spoil Crush: Spoil не вдався (59%) — 9000 урона'); else { marked = true; lines.push('Spoil Crush: Spoil успішний (59%) — 14747 урона'); } }
    else if (b === mass) { marked = true; lines.push(o.festLine || 'Spoil Festival: Forgotten Ancient People: успіх (100%); Giant\'s Shadow: успіх (100%); Forgotten Ancient People: успіх (100%); Giant\'s Shadow: успіх (100%)'); }
    else { if (o.soloFail) lines.push('Спойл не вдався (28%)'); else { marked = true; lines.push('Спойл успішний'); } }
    return true; };
  const ctx = (x = {}) => ({ block: {}, name: 'Forgotten Ancient People', max: 3876, ...x });
  return { env, api, act, calls, recs, sleeps, lines, solo, crush, mass, slots, box, ctx, unmark: () => { marked = false; }, setNear: v => { near = v; },
    mob: { cur: 3876, max: 3876 } };
}

// ---------- 1) Spoil Crush с настоящей ролью nSpoil «Spoil» ----------
test('nSpoil «Spoil» + дубина: префикс находит Crush, первым жмётся Spoil Crush (l2_348), не Festival', async () => {
  for (const wt of ['дубина', 'двуруч. дубина', 'blunt']) {
    const f = fixture({ wt }), c = f.ctx();
    assert.equal(f.api.spoilPick(c).b, f.crush, wt);
    assert.equal(f.api.crushFirst(c, f.mob), true, wt);
    await f.api.spoilStep(c, f.act, f.mob);
    assert.deepEqual(f.calls, ['l2_348'], wt); assert.equal(c.spoiled, true);
  }
});
test('nSpoil «Spoil, Spoil Crush» (Crush найден дважды) — тот же результат, без дублей', async () => {
  const f = fixture({ wt: 'дубина', cfg: { nSpoil: 'Spoil, Spoil Crush' } }), c = f.ctx();
  await f.api.spoilStep(c, f.act, f.mob); assert.deepEqual(f.calls, ['l2_348']);
});
test('дубина: отказ Crush («недоступен») блокирует только Crush — обычный Spoil остаётся', async () => {
  const f = fixture({ wt: 'дубина', act: b => b === f.crush ? 'unavail' : true }), c = f.ctx();
  f.mass.disabled = true;                                           // Festival не изучен/выключен — запасной путь только через Spoil
  await f.api.spoilStep(c, f.act, f.mob);
  assert.equal(c.block['spoil:spoil crush'], Infinity); assert.equal(c.block['spoil:spoil'], undefined);
  await f.api.spoilStep(c, f.act, f.mob);
  assert.deepEqual(f.calls, ['l2_348', 'l2_254']);
  assert.match(f.recs.join('\n'), /Spoil Crush — только с дубиной/);
});
test('дубина: Crush не прошёл, моб жив — следующий ход Festival (100 %); Crush удачен — Festival только при соседях', async () => {
  let f = fixture({ wt: 'дубина', crushFail: true }), c = f.ctx();
  await f.api.spoilStep(c, f.act, f.mob); await f.api.spoilStep(c, f.act, { cur: 2000, max: 3876 });
  assert.deepEqual(f.calls, ['l2_348', 'l2_302']);
  f = fixture({ wt: 'дубина' }); c = f.ctx();
  await f.api.spoilStep(c, f.act, f.mob);
  assert.equal(await f.api.spoilStep(c, f.act, { cur: 100, max: 3876 }), false, 'одиночный моб помечен Crush — Festival не нужен');
  f.setNear([{ name: 'Giant\'s Shadow', cur: 3972, max: 3972 }]);
  await f.api.spoilStep(c, f.act, { cur: 100, max: 3876 });
  assert.deepEqual(f.calls, ['l2_348', 'l2_302']);
});
test('пика (подтверждённая не-дубина): Crush не выбирается никогда, даже когда обычный Spoil на откате', () => {
  for (const wt of ['древковое', 'меч']) {
    const f = fixture({ wt }), c = f.ctx();
    assert.equal(f.api.spoilPick(c).b, f.solo, wt);
    f.solo.cd = 1.2; assert.equal(f.api.spoilPick(c), null, wt + ': Crush с пикой игра отклонит');
    f.solo.cd = 0; c.block['spoil:spoil'] = Date.now() + 300; assert.equal(f.api.spoilPick(c), null, wt + ': блок Spoil не открывает Crush');
    assert.equal(f.api.crushFirst(c, f.mob), false);
  }
});
test('оружие не подтверждено: обычный Spoil раньше Crush (как до 20.43), Crush — запасной', () => {
  const f = fixture({ wt: null }), c = f.ctx();
  assert.equal(f.api.spoilPick(c).b, f.solo);
  f.solo.cd = 1.2; assert.equal(f.api.spoilPick(c).b, f.crush);
  assert.equal(f.api.crushFirst(c, f.mob), false);
});

// ---------- 2) пика: ждём Festival, если он откатится через доли секунды ----------
test('пика, соседей в DOM нет, Festival откатится через 0,2 с, Spoil готов: ждём и жмём Festival (l2_302), Spoil не жмём', async () => {
  const f = fixture({ wt: 'древковое' }), c = f.ctx(); f.mass.cd = 0.2;
  assert.equal(await f.api.spoilStep(c, f.act, f.mob), true, 'шаг занят ожиданием — удар (АОЕ) в этот круг не идёт');
  assert.deepEqual(f.calls, []); assert.ok(f.sleeps.length >= 1 && f.sleeps.every(ms => ms >= 30 && ms <= 150), String(f.sleeps));
  for (let i = 0; i < 5 && !f.calls.length; i++) await f.api.spoilStep(c, f.act, f.mob);
  assert.deepEqual(f.calls, ['l2_302']); assert.equal(c.massTried, true); assert.equal(c.spoiled, true);
  assert.equal(f.env.rt.spoilStat.massOk, 4);
});
test('метка «ждал откат» в нажатии Festival — для разбора журнала', async () => {
  const f = fixture({ wt: 'древковое' }), c = f.ctx(); f.mass.cd = 0.3; const labels = [];
  const act = async (b, why) => { labels.push(why); return f.act(b); };
  for (let i = 0; i < 6 && !f.calls.length; i++) await f.api.spoilStep(c, act, f.mob);
  assert.match(labels[0], /^Масс-спойл: Spoil Festival \(мобов 1, ждал откат \d+\.\d с\)$/);
});
test('Festival далеко (откат 2 с) — сразу обычный Spoil, без ожидания', async () => {
  const f = fixture({ wt: 'древковое' }), c = f.ctx(); f.mass.cd = 2;
  await f.api.spoilStep(c, f.act, f.mob); assert.deepEqual(f.calls, ['l2_254']); assert.deepEqual(f.sleeps, []);
});
test('не ждём: дубина, РБ, мало MP, моб уже помечен, Festival уже был, нет cdLeft', async () => {
  let f = fixture({ wt: 'дубина' }), c = f.ctx(); f.mass.cd = 0.2; f.crush.cd = 1;   // дубина, Crush на откате — обычный Spoil
  await f.api.spoilStep(c, f.act, f.mob); assert.deepEqual(f.calls, ['l2_254'], 'дубина'); assert.deepEqual(f.sleeps, []);
  f = fixture({ wt: 'древковое', cfg: { spoilRb: true } }); c = f.ctx({ rb: { id: 'l2dop_rb_1' } }); f.mass.cd = 0.2;
  assert.equal(await f.api.massSpoilWait(c, f.mob), false, 'РБ');
  f = fixture({ wt: 'древковое', mp: { cur: 120, max: 2060 } }); c = f.ctx(); f.mass.cd = 0.2;
  await f.api.spoilStep(c, f.act, f.mob); assert.deepEqual(f.calls, ['l2_254'], 'MP меньше цены Festival'); assert.deepEqual(f.sleeps, []);
  f = fixture({ wt: 'древковое' }); c = f.ctx({ spoiled: true }); f.mass.cd = 0.2;
  assert.equal(await f.api.massSpoilWait(c, f.mob), false, 'главный помечен');
  f = fixture({ wt: 'древковое' }); c = f.ctx({ massTried: true }); f.mass.cd = 0.2;
  assert.equal(await f.api.massSpoilWait(c, f.mob), false, 'Festival в этом бою уже был');
  f = fixture({ wt: 'древковое', noCdLeft: true }); c = f.ctx(); f.mass.cd = 0.2;
  await f.api.spoilStep(c, f.act, f.mob); assert.deepEqual(f.calls, ['l2_254'], 'без модели отката — как раньше');
});
test('застывший откат Festival: ожидание ограничено за бой, дальше обычный Spoil', async () => {
  const f = fixture({ wt: 'древковое' }), c = f.ctx(); f.mass.cd = 0.3;
  f.env.sleep = async ms => { f.sleeps.push(ms); };                // рисунок КД не меняется
  assert.equal(await f.api.spoilStep(c, f.act, f.mob), true); assert.deepEqual(f.calls, []);
  c.massWaitT0 = Date.now() - 2000;                                   // уже ждали дольше предела
  await f.api.spoilStep(c, f.act, f.mob); assert.deepEqual(f.calls, ['l2_254']);
});
test('крафтер с пикой не ждёт и не спойлит (правило John 21.10 12:48 не меняется)', async () => {
  const f = fixture({ wt: 'древковое', role: 'crafter' }), c = f.ctx(); f.mass.cd = 0.2;
  assert.equal(await f.api.spoilStep(c, f.act, f.mob), false); assert.deepEqual(f.calls, []); assert.deepEqual(f.sleeps, []);
});

// ---------- 3) Festival не повторяется после перерыва (капча) в том же бою ----------
test('капча после Festival: новый ctx того же боя не жмёт Festival повторно и считает главного помеченным', async () => {
  const ss = store(), f = fixture({ wt: 'древковое', ss }), c1 = f.ctx();
  await f.api.spoilStep(c1, f.act, f.mob); assert.deepEqual(f.calls, ['l2_302']);
  // 21:39:01 — 423 «Проверка активности»; 21:39:19 — бой открыт заново: свежий ctx, Festival на откате прошёл
  f.mass.cd = 0; f.unmark(); f.setNear([{ name: 'Giant\'s Shadow', cur: 3972, max: 3972 }, { name: 'Forgotten Ancient People', cur: 3876, max: 3876 }, { name: 'Giant\'s Shadow', cur: 3972, max: 3972 }]);
  const c2 = f.ctx();
  assert.equal(await f.api.spoilStep(c2, f.act, f.mob), false);
  assert.deepEqual(f.calls, ['l2_302'], 'второго Festival нет'); assert.equal(c2.massTried, true); assert.equal(c2.spoiled, true);
  assert.match(f.recs.join('\n'), /масс-спойл в этом бою уже был .* повторно не жму/);
});
test('память Festival переживает перезагрузку вкладки (sessionStorage) и снимается победой', async () => {
  const ss = store(), f = fixture({ wt: 'древковое', ss }), c1 = f.ctx();
  await f.api.spoilStep(c1, f.act, f.mob);
  const g = fixture({ wt: 'древковое', ss }), c2 = g.ctx();          // новый экземпляр модуля — как после reload
  assert.equal(await g.api.spoilStep(c2, g.act, g.mob), false); assert.deepEqual(g.calls, []);
  await g.api.sweepStep(c2);                                          // победа
  assert.equal(ss.getItem('l2bot.festDone'), null);
  const h = fixture({ wt: 'древковое', ss }), c3 = h.ctx();
  await h.api.spoilStep(c3, h.act, h.mob); assert.deepEqual(h.calls, ['l2_302'], 'следующий бой — снова Festival');
});
test('другой бой (spawnId), другой моб, устаревшая память (> 2 мин) — Festival жмётся как обычно', async () => {
  const ss = store(); let f = fixture({ wt: 'древковое', ss }); await f.api.spoilStep(f.ctx(), f.act, f.mob);
  f = fixture({ wt: 'древковое', ss, spawn: 'dense_12075' }); await f.api.spoilStep(f.ctx(), f.act, f.mob); assert.deepEqual(f.calls, ['l2_302'], 'другой spawnId');
  ss.m.clear(); f = fixture({ wt: 'древковое', ss }); await f.api.spoilStep(f.ctx(), f.act, f.mob);
  const g = fixture({ wt: 'древковое', ss }); await g.api.spoilStep(g.ctx({ name: 'Changed Creation' }), g.act, g.mob); assert.deepEqual(g.calls, ['l2_302'], 'другой моб');
  const rec = JSON.parse(ss.getItem('l2bot.festDone')); rec.t = Date.now() - 130000; ss.setItem('l2bot.festDone', JSON.stringify(rec));
  const h = fixture({ wt: 'древковое', ss }); await h.api.spoilStep(h.ctx({ name: 'Changed Creation' }), h.act, h.mob); assert.deepEqual(h.calls, ['l2_302'], 'старше 2 мин');
});
test('РБ: повтор Festival по новым соседям не трогаем (память боя не применяется)', async () => {
  const ss = store(), f = fixture({ wt: 'древковое', ss, cfg: { spoilRb: false } });
  ss.setItem('l2bot.festDone', JSON.stringify({ sp: 'dense_12145', t: Date.now(), names: ['Forgotten Ancient People'], ok: ['Forgotten Ancient People'] }));
  const c = f.ctx({ rb: { id: 'l2dop_rb_1' } }); f.setNear([{ name: 'Giant\'s Shadow', cur: 3972, max: 3972 }]);
  await f.api.spoilStep(c, f.act, f.mob); assert.deepEqual(f.calls, ['l2_302']); assert.equal(c.massTried, true);
});
test('«вже заспойлено» в ответе Festival: разбирается, главный помечен, в статистику успехов не идёт', async () => {
  const line = 'Spoil Festival: Forgotten Ancient People: вже заспойлено; Giant\'s Shadow: вже заспойлено; Giant\'s Shadow: успіх (100%)';
  const f = fixture({ wt: 'древковое', festLine: line }), c = f.ctx(), api = f.api;
  assert.deepEqual(JSON.parse(JSON.stringify(api.festivalParse([line]).map(x => [x.name, x.ok, !!x.was]))),
    [['Forgotten Ancient People', true, true], ["Giant's Shadow", true, true], ["Giant's Shadow", true, false]]);
  await api.spoilStep(c, f.act, f.mob);
  assert.equal(c.spoiled, true); assert.equal(c.nearSpoiled, 2); assert.equal(f.env.rt.spoilStat.massOk, 1);
  assert.match(f.recs.join('\n'), /Forgotten Ancient People уже/);
});
test('подключение: геттер cdLeft у фабрики loot в content.js', () => {
  const src = fs.readFileSync(path.join(root, 'content.js'), 'utf8'), s = src.indexOf('L2V7Modules.loot = L2V7Factories.loot('), e = src.indexOf('L2V7Modules.survival = ', s);
  assert.match(src.slice(s, e), /get cdLeft\(\) \{ return cdLeft; \}/);
  assert.match(src, /function cdLeft\(\.\.\.args\) \{ return L2V7Modules\.combat\.cdLeft\(\.\.\.args\); \}/);
});
