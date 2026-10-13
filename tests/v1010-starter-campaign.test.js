'use strict';
// 10.0.10 (лог 13.10 18:17–18:58, alt1 Human Fighter 12→17): сюжетный квест новичка бот ведёт сам (кампания авто),
// «Взять квест» жмётся со страницы главы, чемпион не метит вид «не по зубам»
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const src = f => fs.readFileSync(path.join(root, f), 'utf8');

function el(o) { return { textContent: '', disabled: false, dataset: {}, hidden: false, classList: { contains: () => false }, querySelector: () => null, querySelectorAll: () => [], closest: () => null, ...o }; }
function makeDoc(state) {
  const qsa = sel => sel.includes('starter-story-target') ? state.targets
    : sel.includes('button[data-action]') || sel.includes('captain-andrei-btn') ? state.actions
    : sel.includes('data-quest-teleport-id') ? state.tps
    : sel.includes('objective-line') || sel.includes('starter-story-resource') || sel.includes('-npc') ? [] : [];
  return { querySelectorAll: qsa, querySelector: sel => sel.includes('quest-body') ? el({ textContent: state.body }) : qsa(sel)[0] || null, body: el({ innerText: '' }) };
}
function quests(state, envExtra = {}) {
  const location = { pathname: '/starter-story-quest.html', search: '', href: 'https://l2wap.com/starter-story-quest.html', origin: 'https://l2wap.com' };
  const sandbox = { document: makeDoc(state), console, Date, location, URL };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(src('modules/quests.js'), sandbox, { filename: 'quests.js' });
  const recs = [], fired = [];
  const env = { rt: {}, cfg: { campAuto: true, campaign: false, campaignEvery: 25 }, on: true, QLINE: /^$/, TAG: 't',
    heroLvl: () => 15, isCampaign: () => true, isMail: () => false, shown: e => !!e && !e.hidden, logLines: () => [], noticeText: () => '',
    $q: sel => sandbox.document.querySelector(sel), setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.join(' ')), setStatus: () => {},
    fire: b => { fired.push(b.dataset.action || b.dataset.questTeleportId); b.onfire && b.onfire(); }, pause: async () => {}, sleep: async () => {}, rnd: () => 100,
    goOutskirts: async () => { env.outs = (env.outs || 0) + 1; },
    waitFor: async (fn) => { for (let i = 0; i < 3; i++) { const r = fn(); if (r) return r; } return null; }, ...envExtra };
  return { q: sandbox.L2V7Factories.quests(env), env, recs, fired, location };
}
const saga = { questId: 'starter_story_first_steps', titleRu: 'Путь новичка: Первые испытания', minLevel: 10, effectiveLevel: 15, stage: 'hunt_1', completed: false, scout: { teleportId: 'elven_ruins' } };

(async () => {
  // 1. ответ /game/story-quests/starter-saga → rt.storySaga; кампания авто у молодого героя, не у Warlock 67, не при снятой галке
  { const { q, env, recs } = quests({ targets: [], actions: [], tps: [] });
    q.sagaNote(saga);
    assert.equal(env.rt.storySaga.stage, 'hunt_1'); assert.equal(env.rt.storySaga.title, 'Путь новичка: Первые испытания'); assert.equal(env.rt.storySaga.minLevel, 10);
    assert.equal(q.campAuto(), true, 'герой 15, квест не пройден → кампания авто');
    assert.equal(q.campEnabled(), true); assert.equal(q.campOn(), true);
    assert.equal(env.rt.campaignDue, true, 'первое включение → сразу проверить главу');
    assert.ok(recs.some(r => /веду кампанию сам/.test(r)), 'в журнал');
    env.heroLvl = () => 67; assert.equal(q.campAuto(), false, 'Warlock 67 → без кампании (квесты сам)');
    env.heroLvl = () => 7; assert.equal(q.campAuto(), false, 'ниже minLevel 10 → ещё нельзя взять');
    env.heroLvl = () => 15; env.cfg.campAuto = false; assert.equal(q.campAuto(), false, 'галка снята → как раньше');
    env.cfg.campAuto = true; q.sagaNote({ ...saga, completed: true }); assert.equal(q.campAuto(), false, 'квест пройден → не ведём');
    env.cfg.campaign = true; assert.equal(q.campEnabled(), true, 'кнопка «Кампания» в меню работает как прежде');
  }
  // 2. страница главы без целей, кнопка «Взять квест» → жмём; появились цели → ok, счётчик попыток сброшен
  { const state = { targets: [], actions: [], tps: [], body: 'intro' };
    const accept = el({ textContent: 'Взять квест', dataset: { action: 'accept' } });
    accept.onfire = () => { state.targets = [el({ textContent: '★ Skeleton 0 / 20 Локация: Elven Ruins', querySelector: s => s === 'strong' ? el({ textContent: 'Skeleton' }) : s.includes('progress') ? el({ textContent: '0 / 20' }) : s.includes('small') ? el({ textContent: 'Локация: Elven Ruins' }) : null })]; state.actions = []; };
    state.actions = [accept];
    const { q, env, fired, recs } = quests(state);
    env.rt.storySaga = { title: 'x', stage: 'not_started', completed: false, minLevel: 10 };
    await q.campaign();
    assert.equal(JSON.stringify(fired), '["accept"]', '«Взять квест» нажата со страницы главы (раньше — «глава без целей», пауза 10 мин)');
    assert.equal(env.rt.campActTry, 0); assert.ok(!env.rt.campSkipUntil, 'кампания не приостановлена');
    assert.ok(recs.some(r => /жму «Взять квест»/.test(r)));
    // следующий проход: цели читаются, телепорт к точке главы
    state.tps = [el({ textContent: 'Телепорт', dataset: { questTeleportId: 'elven_ruins' } })];
    state.targets[0].querySelector = s => s === 'strong' ? el({ textContent: 'Skeleton' }) : s.includes('progress') ? el({ textContent: '0 / 20' }) : s.includes('small') ? el({ textContent: 'Локация: Elven Ruins' }) : s.includes('data-quest-teleport-id') ? state.tps[0] : null;
    await q.campaign();
    assert.equal(env.rt.campaign.targets[0].name, 'Skeleton'); assert.equal(env.rt.campaign.targets[0].total, 20);
    assert.ok(fired.includes('elven_ruins'), 'телепорт к точке главы'); assert.equal(env.rt.lastTeleport, 'elven_ruins');
    assert.equal(JSON.stringify(q.campMobOpen()), '["skeleton"]', 'Skeleton — цель карты');
    assert.equal(q.isQuestName('Skeleton'), true);
    assert.equal(q.campActive(), true, 'автофарм с точки не уводит (mobfarm смотрит campActive)');
  }
  // 3. кнопка 4 раза не помогла → кампания на 10 мин в сторону, не вечный цикл
  { const state = { targets: [], actions: [el({ textContent: 'Взять квест', dataset: { action: 'accept' } })], tps: [], body: 'intro' };
    const { q, env } = quests(state);
    env.rt.campActTry = 4;
    await q.campaign();
    assert.ok(env.rt.campSkipUntil > Date.now() + 9 * 60000); assert.equal(env.outs, 1);
  }
  // 4. адрес главы не запомнен, квест новичка идёт → сразу /starter-story-quest.html
  { const { q, env, location } = quests({ targets: [], actions: [], tps: [] }, { isCampaign: () => false });
    location.pathname = '/map.html'; location.href = 'https://l2wap.com/map.html';
    env.rt.storySaga = { title: 'x', stage: 'hunt_1', completed: false, minLevel: 10 };
    await q.goCampaign();
    assert.equal(location.href, '/starter-story-quest.html');
  }
  // 5. проводка: сеть → sagaNote, геттер heroLvl у quests, campEnabled в ядре и mobfarm, DEF_CFG/меню/базовый профиль
  const content = src('content.js'), mobfarm = src('modules/mobfarm.js'), combat = src('modules/combat.js'), html = src('popup.html'), popup = src('popup.js');
  assert.match(content, /starter-saga[^\n]*L2V7Modules\.quests\.sagaNote\(d\.res\.quest\)/);
  assert.match(content, /L2V7Modules\.quests = L2V7Factories\.quests\(\{[^\n]*get heroLvl\(\)/);
  assert.match(content, /campAuto: true/);
  assert.match(content, /function farmGoal\(\) \{\n  if \(campEnabled\(\)\)/);
  assert.match(content, /campaign: campEnabled\(\), tasks/);
  assert.match(mobfarm, /env\.campEnabled\(\)/); assert.match(content, /get campEnabled\(\) \{ return campEnabled; \}/);
  assert.doesNotMatch(mobfarm, /env\.cfg\.campaign\b/, 'mobfarm — только через campEnabled');
  assert.doesNotMatch(html, /id="campToggle" class="mod" hidden/, 'кнопка «📜 Кампания» снова видна');
  assert.match(html, /id="campAuto" type="checkbox"/); assert.match(popup, /const BOOL = \['sealAuto', 'tsBuy', 'dailyAuto', 'clanTasks', 'campAuto',/); assert.match(popup, /, campAuto: true \};/);
  assert.match(popup, /function paintModes\(d, on, rt = \{\}\)/); assert.match(popup, /paintModes\(d, on, rt\)/);
  assert.equal(JSON.parse(src('base-profile.json')).cfg.campAuto, true);
  // 6. чемпион «не пробиваю» за 15 с — вид не метим (combat.battle)
  const i = combat.indexOf("const hopeless = el >= 15");
  const blk = combat.slice(i, i + 2200);
  // (слито с PR #87: чемпион уходит через champs.learn, метка по имени вида не ставится)
  assert.match(blk, /if \(ctx\.champ && !ctx\.rb && env\.champs\) \{/, 'чемпион: свой учёт, без hardMobs');
  assert.ok(blk.indexOf('ctx.champ && !ctx.rb && env.champs') < blk.indexOf('hardMobs: { ...(env.rt.hardMobs'), 'ветка чемпиона раньше записи hardMobs');
  console.log('v1010-starter-campaign: PASS');
})().catch(e => { console.error(e); process.exit(1); });
