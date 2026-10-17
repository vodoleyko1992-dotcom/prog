'use strict';
// 10.0.11 (лог 13.10 22:00, alt1 Knight 20 на TvT; игрок: «учим бота быстро убивать на TvT» + «команды других задач подавляют TvT»):
// 1) окно TvT (tvtHold) — за tvtHoldMin мин до старта задачи не начинаем; 2) из PvE-боя — на карту и на арену;
// 3) на арене скилл дороже текущего MP не жмём (30 с Power Strike 19 MP за 3 урона, потом 22 с клики без MP и без запросов);
// 4) клик без ответа сервера 2 раза → слот «залип», бьём обычной атакой; 5) «Атака питомца»; 6) цель без цифр HP — по уровню.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
function load(doc, loc) {
  const sb = { console, Date, Map, String, Math, Number, Infinity, isNaN, document: doc, location: loc }; sb.globalThis = sb;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'modules/tvt.js'), 'utf8'), sb); return sb;
}
const now = Date.now();
const baseEnv = () => ({ cfg: { tvtOn: true, tvtHoldMin: 3 }, rt: {}, on: true, tabOwner: true, TVT: null, TVTC: null, TVTS: null,
  rec: () => {}, setStatus: () => {}, setRt: async () => {}, sleep: async () => {}, rnd: () => 0, $q: () => null, shown: e => !!e && e.shown !== false,
  names: s => String(s || '').split(',').map(x => x.trim()).filter(Boolean), cleanTitle: t => t, isBattle: () => false, toMap: async () => {},
  waitX: async () => null, meHp: () => ({ pct: 100 }), meMp: () => null, hpPotPick: () => null, forceCosts: () => [], hudForce: () => 0, forceNow: () => 0, forceMax: () => 0,
  slotsBy: () => [], ready: () => true, slotAction: b => b?.cd || '', autonomyMode: () => 'farm', fire: () => {} });

// ---- 1) окно TvT: за 2 мин до старта — держим, за 5 мин — нет, после FINISHED — нет
{
  const env = baseEnv(), T = load({ querySelectorAll: () => [] }, { pathname: '/map.html', search: '' }).L2V7Factories.tvt(env);
  const base = { eventId: 'e1', isRegistered: true, myTeam: 2, serverNow: now, t: now, phase: 'REGISTRATION' };
  env.TVT = { ...base, startsAt: now + 120000 }; assert.equal(T.tvtHold(), true, 'за 2 мин до старта — окно TvT');
  assert.equal(T.tvtSoon(), false, 'за 2 мин на арену ещё рано (туда — за минуту)');
  env.TVT = { ...base, startsAt: now + 300000 }; assert.equal(T.tvtHold(), false, 'за 5 мин — обычная работа');
  env.TVT = { ...base, phase: 'ACTIVE', startsAt: now - 10000 }; assert.equal(T.tvtHold(), true, 'бой идёт — окно');
  env.TVT = { ...base, phase: 'FINISHED', startsAt: now - 10000 }; assert.equal(T.tvtHold(), false, 'бой кончился — окна нет');
  env.TVT = { ...base, isRegistered: false, myTeam: null, startsAt: now + 60000 }; assert.equal(T.tvtHold(), true, '15.10: ещё не записаны — регистрация уже приоритетна');
}
// ---- 2) PvE-бой, бой TvT через 30 с → выход на карту (моб — всегда, РБ — по галке tvtOverRb)
{
  const env = baseEnv(); let left = 0; env.isBattle = () => true; env.toMap = async () => { left++; };
  env.TVT = { eventId: 'e1', isRegistered: true, myTeam: 2, serverNow: now, t: now, phase: 'PREPARATION', startsAt: now + 30000 };
  const T = load({ querySelectorAll: () => [] }, { pathname: '/battle.html', search: '?spawnId=dense_17910' }).L2V7Factories.tvt(env);
  (async () => {
    assert.equal(await T.tvtStep(), true, 'из боя с мобом — шаг TvT сделан'); assert.equal(left, 1, 'ушли на карту (следующий круг уведёт на арену)');
    env.cfg.tvtOverRb = false; env.rt.rbHunt = { step: 'fight' }; T.tvtStep.leaveT = 0;
    assert.equal(await T.tvtStep(), true, '15.10: TvT всегда важнее РБ, старая галка не отменяет'); assert.equal(left, 2);
    env.cfg.tvtOverRb = true; assert.equal(await T.tvtStep(), false, 'сервер мог не подтвердить выход — повтор не раньше чем через 30 с');
    T.tvtStep.leaveT = 0; assert.equal(await T.tvtStep(), true, 'галка включена — бросаем и босса'); assert.equal(left, 3);
    env.TVT.startsAt = now + 300000; env.TVT.phase = 'REGISTRATION';
    assert.equal(await T.tvtStep(), false, 'до боя 5 мин — моба добиваем');
  })().catch(e => { console.error(e); process.exit(1); });
}
// ---- 3–6) бой на арене: MP 6, Power Strike 19 MP → обычная атака; залипший клик; питомец; цель по уровню
{
  const nick = (id, name, lvl) => ({ dataset: { characterId: id }, textContent: name, title: 'Уровень ' + lvl, className: 'l2-tvt-nick l2-tvt-nick--team1', id: 'nick-' + name });
  const roster = [nick('ex', 'Existence', 80), nick('gn', 'gnom2', 43), nick('am', 'ambi-spoil', 27)];
  const env = baseEnv(), fired = [], logs = [];
  const ps = { title: 'Power Strike', cd: 'power_strike', id: 'ps' }, atk = { title: 'Атака', cd: 'attack', id: 'atk' }, pet = { id: 'pet', shown: true, disabled: false };
  const els = { '#tvt-summon-attack-btn': pet, '#tvt-target-name': { textContent: 'ambi-spoil' }, '#tvt-target-hp': { textContent: '2487 / 2487' }, '#tvt-battle-target-block': { shown: true } };
  Object.assign(env, { cfg: { tvtOn: true, nPower: 'Power Strike', nAttack: 'Атака', tvtPet: true }, rt: { tvtIn: 'e1' },
    TVT: { eventId: 'e1', phase: 'ACTIVE', isRegistered: true, myTeam: 2, startsAt: now - 5000, endsAt: now + 600000, t: now, serverNow: now },
    TVTC: { t: now, actN: 0, selectedTarget: { characterId: 'am', name: 'ambi-spoil', hp: 2487, maxHp: 2487, cp: 943, alive: true } },
    TVTS: { skills: [{ skillId: 3, action: 'power_strike', nameUk: 'Power Strike', mpCost: 19 }], t: now },
    $q: s => els[s] || null, rec: (...a) => logs.push(a.join(' ')), meMp: () => ({ cur: 6, max: 234 }),
    slotsBy: n => /power/i.test(n) ? [ps] : /атака/i.test(n) ? [atk] : [],
    waitX: async () => true,                       // ответ сервера на удар пришёл
    fire: e => { fired.push(e.id); if (fired.length >= 4) env.on = false; } });
  const T = load({ querySelectorAll: () => roster }, { pathname: '/tvt-arena.html', search: '' }).L2V7Factories.tvt(env);
  (async () => {
    await T.tvtFight();
    assert.ok(!fired.includes('ps'), 'MP 6 < 19 — Power Strike не жмём: ' + fired.join(','));
    assert.equal(fired[0], 'atk', 'бьём обычной атакой: ' + fired.join(','));
    assert.ok(fired.includes('pet'), 'после своего удара — «Атака питомца»: ' + fired.join(','));
    assert.ok(logs.some(l => /MP 6 — на силовые не хватает/.test(l)), 'в журнале — почему обычная атака: ' + logs.join(' | '));
    // 4) MP хватает, но клик по Power Strike игра не отправляет (нет ответа 2 раза) → слот залип, бьём атакой
    env.meMp = () => ({ cur: 200, max: 234 }); env.on = true; fired.length = 0; let n = 0;
    env.waitX = async () => (fired[fired.length - 1] === 'ps' ? null : true);   // на Power Strike ответа нет, на атаку — есть
    env.fire = e => { fired.push(e.id); if (++n >= 6) env.on = false; };
    await T.tvtFight();
    const own = fired.filter(x => x !== 'pet');
    assert.deepEqual(own.slice(0, 2), ['ps', 'ps'], 'две попытки Power Strike без ответа: ' + fired.join(','));
    assert.equal(own[2], 'atk', 'после двух кликов без ответа — обычная атака: ' + fired.join(','));
    assert.ok(logs.some(l => /клик «Power Strike» игра не отправляет/.test(l)), 'залипший клик — в журнал');
    // 6) цель без цифр HP — младший по уровню (ambi-spoil 27), не Existence 80
    env.TVTC = { t: now, actN: 0, selectedTarget: null }; els['#tvt-target-name'] = { textContent: '—' };
    env.on = true; fired.length = 0; env.fire = e => { fired.push(e.id); env.on = false; };
    await T.tvtFight();
    assert.equal(fired[0], 'nick-ambi-spoil', 'первая цель — самый младший (27), а не Existence (80): ' + fired.join(','));
    // 7) content.js: TvT раньше паузы «один РБ», окно TvT в главном цикле, скиллы арены и ответы ударов из сети, настройки
    const src = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
    assert.ok(src.indexOf('await tvtStep()') < src.indexOf('raid.rbOneStep()'), 'tvtStep раньше rbOneStep');
    assert.match(src, /L2V7Modules\.tvt\.tvtHold\(\)\) \{ taskPolicyNote\('tvt'\); await L2V7Modules\.tvt\.tvtWait\(\); return true; \}/);
    assert.match(src, /path === '\/game\/tvt\/skills'/); assert.match(src, /TVTC\.actN = \(TVTC\.actN \|\| 0\) \+ 1/);
    assert.match(src, /tvtHoldMin: 3, tvtOverRb: true, tvtPet: true/);
    const pj = fs.readFileSync(path.join(root, 'popup.js'), 'utf8'), ph = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
    assert.match(pj, /tvtHoldMin: 3, tvtOverRb: true, tvtPet: true/); assert.match(pj, /const NUM  = \[[^\]]*'tvtHoldMin'/); assert.match(pj, /const BOOL = \[[^\]]*'tvtPet'/);
    for (const id of ['tvtHoldMin', 'tvtPet']) assert.ok(ph.includes(`id="${id}"`), 'popup.html: ' + id);
    const bp = JSON.parse(fs.readFileSync(path.join(root, 'base-profile.json'), 'utf8')).cfg;
    assert.equal(bp.tvtHoldMin, 3); assert.equal(bp.tvtOverRb, true); assert.equal(bp.tvtPet, true);
    console.log('PASS: 10.0.11 TvT — окно TvT, выход из PvE-боя, удары по MP и ответам сервера, питомец, цель по уровню');
  })().catch(e => { console.error(e); process.exit(1); });
}
