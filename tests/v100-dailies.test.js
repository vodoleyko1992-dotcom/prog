'use strict';
// 20.13 (ревизия 17.10, шаг 7, defaults/D12): заводские умолчания движка и меню теперь в defaults.js — литералы умолчаний ищем и там.
// 10.0 (игрок 12.10: «клановые задания — делать на авто и получать бонусы; есть квесты общие ежедневные, типо дейлики»)
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const src = read('modules/dailies.js'), clanRaw = JSON.parse(read('kb/data/game-clan-tasks.json')), dailyRaw = JSON.parse(read('kb/raw/daily-quests.json')).data;
const clanView = () => ({ clan: clanRaw.clan, me: { characterId: 'me1', activeTaskId: null }, taskDefinitions: JSON.parse(JSON.stringify(clanRaw.taskDefinitions)), activeClanTasks: [] });
const mk = ({ rt = {}, cfg = {}, posts = {}, gets = {} } = {}) => {
  // 15.10: ежедневный detour разрешён только на уже открытой и оплаченной рыбалке.
  gets = { '/game/fishing/state': { unlocked:true, fishingSpot:{purchased:true}, fishingTime:{canFish:true,remainingMs:3600000} }, ...gets };
  const recs = [], posted = [], cfgs = [], loc = { pathname: '/map.html', href: '' };
  const sb = { console, Date, Math, JSON, Object, Number, String, Array, Set, Map, RegExp, location: loc, sessionStorage: { getItem: () => null, setItem: () => {} } };
  sb.globalThis = sb; vm.runInNewContext(src, sb);
  const env = { rt: { lvl: 64, ...rt }, cfg: { dailyAuto: true, clanTasks: true, ...cfg }, recs, posted, cfgs, loc,
    setRt: async p => Object.assign(env.rt, p), setCfg: async p => { cfgs.push(p); Object.assign(env.cfg, p); }, rec: (...a) => recs.push(a.join(' ')),
    gameGet: async p => gets[p] ? { ok: true, status: 200, json: async () => gets[p] } : { ok: false, status: 404, json: async () => ({}) },
    gamePost: async (p, b) => { posted.push(p); const r = posts[p] || { ok: true, status: 200, body: clanView() }; return { ok: r.ok, status: r.status, json: async () => r.body }; },
    awayFree: () => true, isBattle: () => false, fishNow: () => false, heroLevel: () => env.rt.lvl, sleep: async () => {}, setStatus: () => {} };
  return { env, D: sb.L2V7Factories.dailies(env), recs, posted, cfgs, loc };
};
(async () => {
  // 1. дейлики из ответа игры: 8 заданий, «✓» при выполнении — в журнал, новый день — в журнал
  { const { env, D, recs } = mk(); assert.equal(D.dailyNote(dailyRaw), true); assert.equal(env.rt.daily.day, '20261012'); assert.equal(Object.keys(env.rt.daily.tasks).length, 8);
    assert.equal(env.rt.daily.tasks.fishing_catch_50.done, true); assert.equal(env.rt.daily.tasks.chat_social_10.have, 0); assert.ok(recs.some(r => /✓ 50 рыб/.test(r)));
    const n0 = recs.length; D.dailyNote(dailyRaw); assert.equal(recs.length, n0, 'same day, same state → silent');
    D.dailyNote({ ...dailyRaw, dayKey: '20261013' }); assert.ok(recs.some(r => /новый игровой день 20261013/.test(r))); }
  // 2. клановые задания: определения с откатами, моё активное, алмазы; нет клана
  { const { env, D } = mk(); assert.equal(D.clanNote(clanView()), true); assert.equal(env.rt.clanTasks.defs.length, 5); assert.equal(env.rt.clanTasks.clan.name, 'BlackLotus');
    const km = env.rt.clanTasks.defs.find(d => d.id === 'kill_monsters'); assert.equal(km.canTake, false); assert.equal(km.why, 'cooldown'); assert.ok(km.cdAt > 0); assert.equal(km.reward.coinOfLuck, 1); assert.equal(km.diamonds, 4);
    D.clanNote({ error: 'clan_required' }); assert.equal(env.rt.clanTasks.noClan, true); }
  // 3. план: берём лучшее доступное (kill_raid_boss и штурм стены — canTake, но стена никогда; РБ — только если РБ разрешены)
  // 20.12 (решение игрока 17.10 10:56: «тур по РБ не должен быть авто включённым»): клановый «Вызов рейдового босса» — только при включённом игроком «Туре РБ»
  { const { env, D, posted } = mk({ cfg: { rbHuntMode: true } }); D.clanNote(clanView()); let p = D.clanPlan(); assert.equal(p.kind, 'take'); assert.equal(p.def.id, 'kill_raid_boss', 'РБ разрешён включённым туром');
    const e1 = mk({ cfg: { dailyAuto: true, rbHuntMode: false } }); e1.D.clanNote(clanView()); assert.equal(e1.D.clanPlan(), null, 'dailyAuto без тура РБ больше не разрешает РБ');
    const e2 = mk({ cfg: { dailyAuto: false, rbBetween: false, rbHuntMode: false } }); e2.D.clanNote(clanView()); assert.equal(e2.D.clanPlan(), null, 'без РБ — только стена, её не берём');
    const v = clanView(); v.taskDefinitions.find(d => d.id === 'kill_monsters').canTake = true; v.taskDefinitions.find(d => d.id === 'kill_monsters').blockedReason = null; D.clanNote(v);
    p = D.clanPlan(); assert.equal(p.def.id, 'kill_monsters', 'Coin of Luck важнее РБ'); assert.match(p.why, /\+1 CoL/);
    assert.equal(await D.clanStep(), true); assert.deepEqual(posted, ['/game/clan-tasks/kill_monsters/take']); assert.ok(env.recs.some(r => /✓ взять «Большая охота»/.test(r)));
    assert.equal(await D.clanStep(), false, 'не чаще раза в минуту'); }
  // 4. моё задание активно → ничего не берём; готово → сдаём; у соклановца — помогаем, если своего нет
  { const { env, D, posted } = mk(); const v = clanView(); v.me.activeTaskId = 't1';
    v.activeClanTasks = [{ id: 't1', taskType: 'kill_monsters', progress: 120, target: 500, owner: { id: 'me1', name: 'Warlock' }, canHelp: false, canClaim: false, canCancel: true, clanRewardDiamonds: 4 }];
    D.clanNote(v); assert.equal(D.clanPlan(), null); assert.equal(await D.clanStep(), false);
    v.activeClanTasks[0].progress = 500; v.activeClanTasks[0].canClaim = true; D.clanNote(v); const p = D.clanPlan(); assert.equal(p.kind, 'claim'); assert.match(p.why, /сдать «Большая охота» \(500\/500\)/);
    assert.equal(await D.clanStep(), true); assert.deepEqual(posted, ['/game/clan-tasks/t1/claim']); assert.ok(env.recs.some(r => /клану \+4 алмазов/.test(r)));
    const e2 = mk(); const v2 = clanView(); v2.taskDefinitions.forEach(d => { d.canTake = false; });
    v2.activeClanTasks = [{ id: 't9', taskType: 'earn_sp_from_monsters', progress: 10, target: 100000, owner: { id: 'u2', name: 'Teddy' }, canHelp: true, canClaim: false }];
    e2.D.clanNote(v2); const h = e2.D.clanPlan(); assert.equal(h.kind, 'help'); assert.match(h.why, /помочь Teddy/); await e2.D.clanStep(); assert.deepEqual(e2.posted, ['/game/clan-tasks/t9/help']); }
  // 5. ошибка игры → запись и пауза 30 мин; 409 → перечитать
  { const { env, D, recs } = mk({ cfg: { rbHuntMode: true }, posts: { '/game/clan-tasks/kill_raid_boss/take': { ok: false, status: 409, body: { messageRu: 'Состояние изменилось' } } } }); D.clanNote(clanView());
    assert.equal(await D.clanStep(), true); assert.ok(recs.some(r => /✗ взять «Вызов рейдового босса»: Состояние изменилось — повтор через 30 мин/.test(r))); assert.ok(env.rt.clanTaskFail.t);
    const e2 = mk({ rt: { clanTaskFail: { t: Date.now() } } }); e2.D.clanNote(clanView()); assert.equal(await e2.D.clanStep(), false); }
  // 6. дейлик «50 рыб»: не хватает → рыбалка с сохранением режимов; улов считается; добрали → режимы назад, на карту
  { const dq = JSON.parse(JSON.stringify(dailyRaw)); Object.assign(dq.tasks.fishing_catch_50, { have: 47, need: 50, done: false, claimed: false }); Object.assign(dq.tasks.strong_enemy_20, { done: true }); Object.assign(dq.tasks.raid_boss_participate, { done: true });
    const { env, D, cfgs, loc } = mk({ cfg: { zoneAuto: true, chain: true, fishMode: false, rbHuntMode: false } }); D.dailyNote(dq); assert.equal(D.fishLack(), 3);
    assert.equal(await D.dailyStep(), true); assert.equal(env.rt.dailyFish.need, 3); assert.deepEqual(env.rt.dailyFish.prev, { fishMode: false, rbHuntMode: false, epicMode: false, catMode: false, zoneAuto: true }); assert.equal(cfgs[0].fishMode, true); assert.equal(env.rt.dailyDone.fish, '20261012');
    assert.equal(await D.dailyStep(), false, 'ловим'); await D.fishNote(); await D.fishNote(); assert.equal(env.rt.dailyFish.got, 2); assert.equal(await D.dailyStep(), false);
    await D.fishNote(); loc.pathname = '/fishing.html'; assert.equal(await D.dailyStep(), true); assert.equal(env.rt.dailyFish, null); assert.equal(env.cfg.fishMode, false); assert.equal(env.cfg.zoneAuto, true); assert.equal(loc.href, '/map.html');
    assert.ok(env.recs.some(r => /рыба на дейлик поймана \(3\/3\)/.test(r)));
    assert.equal(await D.dailyStep(), false, 'раз в день'); }
  // 7. 20.12 (решение игрока 17.10 10:56: «тур по РБ не должен быть авто включённым»): дейлик «1 РБ» сам тур РБ не включает,
  // rt.dailyRb не создаётся; заход, начатый старой версией, заканчивается сразу с возвратом прежних режимов
  { const dq = JSON.parse(JSON.stringify(dailyRaw)); Object.assign(dq.tasks.strong_enemy_20, { have: 0, done: false }); Object.assign(dq.tasks.raid_boss_participate, { have: 0, done: false });
    const { env, D, cfgs } = mk({ rt: { rbKills: 5 }, cfg: { zoneAuto: true, rbHuntMode: false } }); D.dailyNote(dq); assert.equal(D.rbWanted(), true);
    assert.equal(await D.dailyStep(), false, 'дейлик РБ не запускает тур'); assert.equal(env.cfg.rbHuntMode, false); assert.equal(env.rt.dailyRb, undefined); assert.equal(cfgs.length, 0);
    assert.equal(env.rt.dailyDone?.rb, undefined, 'дейлик РБ не помечается выполненным ботом');
    const old = mk({ rt: { rbKills: 5, dailyRb: { day: '20261012', k0: 5, t: Date.now(), prev: { rbHuntMode: false, fishMode: false, epicMode: false, catMode: false, zoneAuto: true }, entering: false, kick: 0 } }, cfg: { zoneAuto: false, rbHuntMode: true } });
    old.D.dailyNote(dq); assert.equal(await old.D.dailyStep(), true, 'старый заход заканчивается');
    assert.equal(old.env.rt.dailyRb, null); assert.equal(old.env.cfg.rbHuntMode, false); assert.equal(old.env.cfg.zoneAuto, true); assert.equal(old.env.rt.rbHunt.step, 'pick');
    assert.ok(old.recs.some(r => /тур РБ по дейлику больше не включается сам — возвращаюсь к прежнему режиму/.test(r)));
    assert.equal(await old.D.dailyStep(), false, 'повторно тур не включается'); assert.equal(old.env.cfg.rbHuntMode, false);
    const e2 = mk({ cfg: { fishMode: true }, rt: { lvl: 64 } }); e2.env.fishNow = () => true; e2.D.dailyNote(dq); assert.equal(await e2.D.dailyStep(), false, 'режим рыбалки — не прерываем');
    const e3 = mk({ rt: { lvl: 35 } }); e3.D.dailyNote(dq); assert.equal(await e3.D.dailyStep(), false, 'ниже 40 — РБ нет'); }
  // 8. опрос фоном: раз в 10 мин, 403 на клане → noClan; выключено — не опрашиваем
  { const { env, D } = mk({ gets: { '/game/daily-quests': dailyRaw } }); env.gameGet = async p => p === '/game/daily-quests' ? { ok: true, status: 200, json: async () => dailyRaw } : { ok: false, status: 403, json: async () => ({ error: 'clan_required' }) };
    await D.tick(); assert.equal(env.rt.daily.day, '20261012'); assert.equal(env.rt.clanTasks.noClan, true); assert.equal(await D.tick(), null, 'throttled');
    const e2 = mk({ cfg: { dailyAuto: false, clanTasks: false } }); assert.equal(await e2.D.tick(), null); assert.equal(e2.env.rt.daily, undefined); }
  // 9. текст меню
  { const { D } = mk(); D.dailyNote(dailyRaw); D.clanNote(clanView()); const t = D.text(); assert.match(t, /✓ 50 рыб/); assert.match(t, /○ 10 сообщений в чате 0\/10/); assert.match(t, /BlackLotus: алмазов 18 · задания нет/); assert.match(t, /✓ Вызов рейдового босса \(\+7💎, 140\s000 EXP\)/); assert.match(t, /⏳ \d\d:\d\d Большая охота \(\+4💎, 1 CoL\)/); }
  // 10. ядро и меню
  const content = (read('defaults.js') + '\n' + read('content.js')), popup = (read('defaults.js') + '\n' + read('popup.js')), html = read('popup.html'), manifest = read('manifest.json'), fishing = read('modules/fishing.js');
  assert.match(manifest, /"modules\/dailies\.js"/); assert.match(html, /<script src="modules\/dailies\.js"><\/script>/);
  assert.match(content, /dailyAuto: true, clanTasks: true, chain: true,/); assert.match(popup, /dailyAuto: true, clanTasks: true, chain: true,/); assert.match(popup, /const BOOL = \['sealAuto', 'tsBuy', 'dailyAuto', 'clanTasks',/);
  assert.match(content, /async function gamePost\(path, body, ms = 8000\)/);
  // 15.10: между await теперь проверяется активность режима; сохраняем порядок tick → клан → дейлик и проверяем отсечение старого цикла.
  const dispatchStart = content.indexOf('L2V7Modules.dailies.tick().catch(() => {});');
  const dispatchEnd = content.indexOf('if (rt.petBufferTrip', dispatchStart);
  assert.ok(dispatchStart >= 0 && dispatchEnd > dispatchStart);
  for (const changed of ['none', 'handled', 'stop', 'lease', 'enchant']) {
    const calls = [], box = { on: true, tabOwner: true, mode: 'farm', sleep: async () => {} };
    box.autonomyMode = () => box.mode;
    box.L2V7Modules = { dailies: {
      tick: async () => { calls.push('tick'); },
      clanStep: async () => {
        calls.push('clan');
        if (changed === 'stop') box.on = false;
        if (changed === 'lease') box.tabOwner = false;
        if (changed === 'enchant') box.mode = 'enchant';
        return changed === 'handled';
      },
      dailyStep: async () => { calls.push('daily'); return false; }
    } };
    vm.createContext(box);
    vm.runInContext(content.match(/^const loopStale = .*$/m)[0], box);   // 20.13 (шаг 7): охрана цикла — общий помощник ядра
    vm.runInContext('this.run=async()=>{for(let i=0;i<1;i++){\n' + content.slice(dispatchStart, dispatchEnd) + '\n}};', box);
    await box.run();
    assert.deepEqual(calls, changed === 'none' ? ['tick', 'clan', 'daily'] : ['tick', 'clan'], 'daily dispatch after clan await: ' + changed);
  }
  assert.match(content, /path === '\/game\/daily-quests' && tabOwner && d\.res\?\.tasks\) try \{ L2V7Modules\.dailies\.dailyNote\(d\.res\); \}/); assert.match(content, /path === '\/game\/clan-tasks' && tabOwner/);
  assert.match(content, /get dailyFishNote\(\) \{ return \(\) => L2V7Modules\.dailies\?\.fishNote\?\.\(\); \}/); assert.match(fishing, /if \(env\.dailyFishNote\) bg\(env\.dailyFishNote\(\)\);/);
  assert.match(html, /data-auto-task="dailies"/); assert.match(html, /data-auto-task="clan"/); assert.match(html, /<input id="dailyAuto" type="checkbox">/); assert.match(html, /<input id="clanTasks" type="checkbox">/); assert.match(html, /id="dqBox"/);
  assert.match(popup, /renderTvtShop\(rt, d\); renderDailies\(rt, d\);/);
  console.log('PASS: 10.0 dailies — daily quests parsed (8 tasks, ✓/new day logged), clan tasks (defs with cooldown, take best → CoL first, siege wall never, RB only with RB tour on; claim ready; help a clanmate; 409/error → 30 min pause), daily fish detour (modes saved/restored, catches counted, back to map), daily RB never starts the RB tour (old detour ended, modes restored), background polls, menu wired');
})().catch(e => { console.error(e); process.exit(1); });
