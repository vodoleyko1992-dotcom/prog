'use strict';
// Lite 1.0 (20.10, тред «Упрошенка под Дестра»): настоящий MV3 облегчённого бота (lite/) в headless Chromium на локальной модели игры.
// Сценарий A: меню → место охоты и 5 мобов → охота цепочкой (чемпион из цепочки — выход) → Battle Trance → Frenzy/Zealot →
//   лимит → TvT: запись, бой на арене, итог → игра выкинула в город → телепорт за адену обратно → после лимита не охотится.
// Сценарий B: «где стоит герой» → смерть → город → статуя (бафф + восстановление) → телепорт назад → проверка активности
//   (бот замирает, ни одного клика) → игрок прошёл её → охота дальше; Стоп.
// Сценарий C (Lite 1.1): задержки сервера (ход 150 мс, GET /character 300 мс, откат атаки 200 мс): удар→удар без лишних пауз
//   (медиана < 600 мс, Lite 1.0 — 530–585 мс), клики не теряются, второй ход не уходит, пока первый ждёт ответа 7 с.
// В C же (1.4): окно меню на странице игры — свёрнуто на узком экране, «—» сворачивает в плавающую кнопку, кнопка и окно
//   перетаскиваются и помнят место после перезагрузки, поджимаются при сужении окна, «⧉» — меню во вкладке, Старт из окна → «Lite ▶».
// Сценарий D (Lite 1.2): быстрый удар — галка ВКЛ по умолчанию; ВЫКЛ → ВКЛ на модели основного 20.42 (ход 0,4 с, GET /character 0,35 с).
// Сценарий E (Lite 1.3, John: «это сборка под БХ, а нужна под дестра»): у героя активен класс, который Lite не ведёт (с 1.6 —
//   маг Arcana Lord, слот 0), Титан — слот 2: меню предупреждает и не показывает скиллы мага, после Старта бот ничего не жмёт;
//   в игре переключили на Титана — охота пошла, в меню скиллы Титана; снова маг — панель Титана в меню остаётся, бот ждёт.
// Сценарий F (Lite 1.5, John: «есть сабкласс Лука, хотим бота и Луку научить», «отдельный профиль на дестра, отдельный профиль
//   на лука»): у героя активен Phantom Ranger (слоты как на аккаунте из разбора лука). Меню — вкладки «Дестр»/«Лук» со своими
//   лимитами (старые настройки 1.4 — профиль Дестра); лук бьёт выстрелами под именем игры, баффы — да, Hex/стойка — нет;
//   стрелы кончились (сервер: battle_no_arrows, как в пробном бою 21.10) — выход из боя и ожидание; стрелы появились — охота до 3; в игре Титан —
//   профиль Дестра (свой лимит 4, Fatal Strike, без выстрелов); снова лук — его 3 из 3 уже выполнены, бот стоит.
// Сценарий G (Lite 1.5.1, John: «Vicious Stance то включает то выключает», «привел куда надо мне, не бьет мобов»): Старт в бою —
//   место охоты сразу; стойку, которой игра не показывает, бот жмёт один раз; миг без полоски HP моба — не повод уходить из боя.
// Сценарий H (Lite 1.6, John: «Сверстай еще в боте сектор "споил", возьми все данные из основного проекта Бот»): активен
//   Bounty Hunter — вкладка «⛏ Споил» сама, раздел спойла с ресурсом и местами; с пикой каждый бой начинается со Spoil Festival
//   (или Spoil, пока Festival на откате), Spoil Crush не жмётся, Sweeper — никогда; добыча «Спойл: X ×N» — в счёт и в меню;
//   надели дубину — Whirlwind игра не даёт (пауза 5 мин), бой начинается со Spoil Crush; «Сбросить счёт» — с нуля.
// В E (с 1.6) «другой класс» — основной маг Arcana Lord: Bounty Hunter стал своим профилем.
// Сценарий I (Lite 1.7, John: «изучи мага в бастионе, массухи юзаем… создай доп модуль МАГ… автоопределение Дестр\лук\маг»):
//   активен Storm Screamer в Ashen Bastion (разметка и правила — kb/lite-mage-study.md): вкладка «🔮 Маг» сама; первый бой —
//   самый толстый моб (соседи ещё не известны), массовые бьют троих, соседи узнаны; дальше — главный не тоньше соседей, после
//   победы сразу следующий из списка игры (не «Охотиться дальше»); Elemental Crash — только когда соседи толще главного;
//   Arcane Power включается один раз; 9 мобов — цель выполнена.
// node tests/lite-browser.cjs   (CHROMIUM=…, PLAYWRIGHT_NODE=… при нестандартных путях)
// 20.54 (прогон смоуков 23.10): все 7 сценариев идут 285–321 с даже в одиночку — внешний «timeout 300» убивает Chromium посреди G
//   (DIAG с rt:{} и «не дождался: окно «СТРЕЛ НЕТ»» — следствие убитого браузера, не ошибка Lite). Давать ≥ 600 с или делить: LITE_ONLY=ABCD / EFGH.
const path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_NODE || '/opt/node-tools/node_modules/playwright');
const EXT = path.resolve(process.env.LITE_EXT || path.join(__dirname, '..', 'lite'));   // LITE_EXT — распакованный ZIP для проверки сборки
const L = require('../lite/logic.js');           // 1.5: настройки профиля (lite.cfg p.destr / p.archer) — L.profCfg
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 30000, what = 'условие') {
  const t0 = Date.now();
  for (;;) { let v; try { v = await fn(); } catch (e) { v = null; } if (v) return v; if (Date.now() - t0 > ms) throw new Error('не дождался: ' + what); await delay(150); }
}

// ---------- модель сервера игры ----------
function makeServer() {
  const S = {
    hero: { id: 'h1', name: 'Dstr', level: 76, l2Profession: 'orc_titan', currentZoneId: 'giran_harbor', currentZoneNameUk: 'Гавань Гірана', locationType: 'field',
      inBattle: false, battleSpawnId: null, hp: 20000, maxHp: 20000, mp: 3000, maxMp: 3000, mobsKilled: 1000, revision: 1, adena: '5000000', pveDefeat: null,
      activeBuffs: [], toggleStances: [],
      battleHotbarSlots: [{ k: 'a', a: 'attack' }, { k: 'a', a: 'l2_190' }, { k: 'a', a: 'battle_trance' }, { k: 'a', a: 'l2_176' }, { k: 'a', a: 'l2_420' }, { k: 'a', a: 'l2_286' }, { k: 'u', id: 1539 }],
      learnedBattleSkillsDetail: [{ battleId: 'l2_190', nameUk: 'Fatal Strike' }, { battleId: 'battle_trance', nameUk: 'Battle Trance' }, { battleId: 'l2_176', nameUk: 'Frenzy' }, { battleId: 'l2_420', nameUk: 'Zealot' }, { battleId: 'l2_286', nameUk: 'Provoke' }] },
    battle: null, spawnN: 0, chainN: 0, champAt: 2, cd: {}, gcd: 0, pots: 50, acts: [], tvtActs: [], tp: [], leaves: 0, antibot: 0, abActs: 0, killHero: false,
    mobHp: 4000, lat: { action: 0, character: 0 }, slowNext: 0, actT: [], pending: 0, overlap: 0, charN: 0,
    tvt: { phase: 'IDLE', eventId: 'tvt-0800', isRegistered: false, registeredCount: 4, maxPlayers: 20, schedule: { enabled: true, next: { slotKey: 'tvt-0800', registrationOpensAt: Date.now() + 100000 } } },   // запись скоро — бот опрашивает часто
    enemies: [{ characterId: 'e1', name: 'Enemy1', level: 70, hp: 3000, maxHp: 3000, cp: 0, alive: true }, { characterId: 'e2', name: 'Enemy2', level: 72, hp: 2000, maxHp: 2000, cp: 0, alive: true }],
    target: null, buffer: [], ash: [], ashDead: {}, locations: [
      { teleportId: 'giran_harbor', labelUk: 'Гавань Гірана', adenaCost: 2500, mobLevelMin: 25, mobLevelMax: 51 },
      { teleportId: 'forge_gods', labelUk: 'Кузня богів', adenaCost: 20000, mobLevelMin: 70, mobLevelMax: 80 } ],
  };
  const CD = { attack: 600, l2_190: 2500, battle_trance: 120000, l2_176: 120000, l2_420: 120000, l2_286: 5000,
    double_shot: 2500, power_shot: 2500, stun_shot: 1500, soul_of_sagittarius: 1000, l2_77: 1000, l2_91: 1000, l2_122: 1000, vicious_stance: 1000,
    l2_254: 1500, l2_302: 2700, l2_348: 2100, l2_36: 1700, l2_42: 500, l2_1176: 600, l2_1181: 600, l2_1292: 30000, l2_337: 500 };   // 1.6: спойлер (Festival ≈2,7 с, Crush ≈2,1 с — логи основного бота 21.10)
  // 1.6: оружие спойлера — Club (4) дубина, Short Spear (15) древковое; Spoil Crush — только с дубиной, Whirlwind — только с древковым:
  // иначе 400 battle_skill_not_allowed «Цей скилл зараз недоступний…» (основной бот, combat.js). Итог спойла — строки лога (logTail).
  const BLUNT_W = [4, 89, 6579];
  // 1.5 / 1.5.1 (пробный бой лука 21.10, archer-study.md §6, §6a): выстрел тратит 2 стрелы, атака — 1; стрел нет — 400 battle_no_arrows.
  // Выстрелы GCD не ставят; их откат сервер присылает под каноническим номером (l2_19 / l2_56 / l2_101), ранний выстрел —
  // 400 {code:'skill_cooldown', skillId, remainingMs} без serverNowMs.
  const ARROW_NEED = { attack: 1, power_shot: 2, stun_shot: 2, double_shot: 2 };
  const CANON = { double_shot: 'l2_19', power_shot: 'l2_56', stun_shot: 'l2_101' };
  // 1.5.1: стойку лука (Vicious Stance, 312) игра показывает по-разному: нигде (S.stanceReport 'none', как, видимо, у John),
  // в баффах героя ('buff') или в toggleStances ('list'). S.stanceStuck — нажатие принимается, но стойка не включается.
  const ch = () => { S.hero.revision++; const now = Date.now(), buffs = S.hero.activeBuffs.filter(b => b.expiresAt > now);
    if (S.stance && S.stanceReport === 'buff') buffs.push({ skillId: 312, expiresAt: now + 3600000 });
    return { ...S.hero, activeBuffs: buffs,
      toggleStances: S.stanceReport === 'list' ? [{ battleId: 'vicious_stance', skillId: 312, level: 8, active: !!S.stance }] : S.hero.toggleStances,
      ...(S.arrows != null || S.weapon !== undefined ? { inventory: { stacks: [...(S.arrows > 0 ? [{ itemId: 1342, qty: S.arrows }] : []), { itemId: 728, qty: 50 }],   // 0 стрел — стопки нет (§6a)
        ...(S.weapon !== undefined ? { eq: { l1: S.weapon == null ? null : { itemId: S.weapon, objectId: 'w1' } } } : {}) } } : {}) }; };   // 1.6: надетое оружие (спойлер)
  const mob = (spawnId, name, kind = 'aggressive', tier = '') => ({ spawnId, mobName: name, mobLevel: 75, kind, championTier: tier, mobHp: S.mobHp, mobMaxHp: S.mobHp, log: [] });
  function action(body) {
    const now = Date.now(), a = String(body.action || '');
    S.acts.push(a); S.actT.push(now);
    if (a === 'vicious_stance') (S.stanceAll = S.stanceAll || []).push([now % 100000, now < S.gcd ? 'gcd' : now < (S.cd[a] || 0) ? 'cd' : 'ok']);
    if (S.antibot) { S.abActs++; return [423, { error: 'anti_bot_challenge', code: 'anti_bot_challenge' }]; }
    const b = S.battle;
    if (!b || !S.hero.inBattle) return [400, { error: 'no_battle' }];
    if (now < S.gcd) return [400, { error: 'global_cooldown', blockedBy: 'global', serverNowMs: now, globalCooldownUntilMs: S.gcd }];
    if (CANON[a] && now < (S.cd[a] || 0)) { S.shotRej = (S.shotRej || 0) + 1; return [400, { code: 'skill_cooldown', skillId: CANON[a], remainingMs: S.cd[a] - now }]; }
    if (a !== 'battle_potion_use' && now < (S.cd[a] || 0)) return [400, { error: 'skill_cooldown', blockedBy: 'skill', serverNowMs: now, cooldownUntilMs: S.cd[a] }];
    const h = S.hero, bow = /ranger|hawkeye|sagittarius|sentinel/.test(h.l2Profession);
    if (bow && ARROW_NEED[a] && (S.arrows || 0) < ARROW_NEED[a]) return [400, { error: 'battle_no_arrows', messageRu: 'Немає стріл потрібного грейду для лука' }];
    if (bow && ARROW_NEED[a]) S.arrows -= ARROW_NEED[a];
    if ((a === 'l2_348' && !BLUNT_W.includes(S.weapon)) || (a === 'l2_36' && BLUNT_W.includes(S.weapon))) { (S.refused = S.refused || []).push(a); return [400, { error: 'battle_skill_not_allowed', message: 'Цей скилл зараз недоступний для твого персонажа' }]; }
    (b.ok = b.ok || []).push(a);
    const lines = [];
    if (!CANON[a]) S.gcd = now + (S.gcdMs || 250);
    if (a === 'attack') b.mobHp -= 700;
    else if (a === 'double_shot') { b.mobHp -= 1500; h.mp -= 98; }
    else if (a === 'power_shot') { b.mobHp -= 1000; h.mp -= 70; }
    else if (a === 'stun_shot') { b.mobHp -= 800; h.mp -= 98; }
    else if (a === 'soul_of_sagittarius') { h.activeBuffs.push({ skillId: 303, expiresAt: now + 1200000 }); h.hp -= 185; }
    else if (a === 'l2_77' || a === 'l2_91') h.activeBuffs.push({ skillId: +a.slice(3), expiresAt: now + 1200000 });
    else if (a === 'l2_190') { b.mobHp -= 1800; h.mp -= 83; }
    else if (a === 'battle_trance') h.hp = Math.round(h.maxHp * 0.25);
    else if (a === 'l2_176') h.activeBuffs.push({ skillId: 176, expiresAt: now + 90000 });
    else if (a === 'l2_420') { h.activeBuffs.push({ skillId: 420, expiresAt: now + 60000 }); h.hp -= 204; h.mp -= 136; }
    else if (a === 'battle_potion_use') { S.pots--; h.hp = Math.min(h.maxHp, h.hp + 3000); }
    else if (a === 'l2_286') {}
    else if (a === 'vicious_stance') { (S.stanceT = S.stanceT || []).push([now % 100000, S.stance, S.stanceReport]); if (!S.stanceStuck) S.stance = !S.stance; }
    else if (a === 'l2_302') { h.mp -= 73; lines.push(`Spoil Festival: ${b.mobName}: ${b.spoiled ? 'вже заспойлено' : S.festFail ? 'промах (40%)' : 'успіх (100%)'}`); if (!S.festFail) b.spoiled = true; }
    else if (a === 'l2_254') { h.mp -= 50; const ok = (S.spoilSeq || []).length ? S.spoilSeq.shift() : true; lines.push(ok ? 'Спойл успішний (59%)' : 'Спойл не вдався (56%)'); if (ok) b.spoiled = true; }
    else if (a === 'l2_348') { b.mobHp -= 1200; h.mp -= 70; lines.push(`Ви завдаєте ${b.mobName} 1 200 урону`, 'Спойл успішний (61%)'); b.spoiled = true; }
    else if (a === 'l2_36') { b.mobHp -= 1500; h.mp -= 40; }
    // 1.7: маг в Ashen (kb/lite-mage-study.md) — массовый бьёт главного и двух соседей одинаково, умерший сосед +1 к счёту и снова полный
    else if (a === 'l2_1176' || a === 'l2_1181') {
      const dmg = a === 'l2_1176' ? 500 : 400; b.mobHp -= dmg; h.mp -= 70;
      if (b.ex) { for (const x of b.ex) { x.mobHp -= dmg; if (x.mobHp <= 0) { h.mobsKilled++; S.exKills = (S.exKills || 0) + 1; lines.push(`Додаткова ціль повалена: ${x.name}.`); x.mobHp = x.mobMaxHp; } }
        lines.push(`Буря: додаткові цілі — ${b.ex.map(x => x.name + ' −' + dmg).join(', ')}.`); b.wx = b.ex.map(x => ({ name: x.name, mobHp: x.mobHp, mobMaxHp: x.mobMaxHp })); }
    }
    else if (a === 'l2_1292') { (S.crash = S.crash || []).push({ main: b.mobHp, ex: (b.ex || []).map(x => x.mobHp) }); b.mobHp -= 1500; h.mp -= 200; }
    else if (a === 'l2_337') { const t = S.hero.toggleStances.find(x => x.skillId === 337); if (t) t.active = !t.active; S.apN = (S.apN || 0) + 1; }
    if (a !== 'battle_potion_use') S.cd[a] = now + ((S.cdSet || CD)[a] || 1000);
    h.hp -= S.killHero ? 9000 : 150;
    if (h.hp <= 0) { h.hp = 0; h.inBattle = false; h.pveDefeat = { at: now }; return [200, { defeat: { spawnId: b.spawnId }, delta: { characterHp: 0, serverNowMs: now } }]; }
    if (b.mobHp <= 0) {
      b.mobHp = 0; h.inBattle = false; h.mobsKilled++;
      (S.done = S.done || []).push({ spoiled: !!b.spoiled, acts: b.ok.slice(), w: S.weapon, sp: b.spawnId });
      if (b.ex) S.ashDead[b.spawnId] = now + 30000;                // 1.7: Ashen — главный возрождается ≈30 с
      if (b.spoiled) lines.push('Спойл: Mithril Ore ×2', 'Спойл: Coal ×1');
      return [200, { victory: { spawnId: b.spawnId, mobName: b.mobName }, delta: { mobHp: 0, serverNowMs: now }, logTail: lines }];
    }
    // Как настоящая игра (battle-action-result.js): почти каждый ответ на ход несёт hotbarStale — страница перечитывает персонажа.
    return [200, { kind: 'delta', delta: { mobHp: b.mobHp, mobMaxHp: b.mobMaxHp, characterHp: h.hp, characterMaxHp: h.maxHp, characterMp: h.mp, characterMaxMp: h.maxMp,
      hotbarStale: true, serverNowMs: now, globalCooldownUntilMs: S.gcd, skillCooldowns: { [CANON[a] || a]: S.cd[a] }, ...(b.wx ? { whirlwindExtras: b.wx } : {}) }, logTail: lines, mobEffectsSig: b.spoiled ? 'spoil:1' : '' }];
  }
  function tvtState() {
    const t = S.tvt, now = Date.now();
    return { ...t, serverNow: now, combatRoster: S.enemies.map(e => ({ ...e })), selfCombat: { alive: true } };
  }
  async function api(p, method, body) {
    const now = Date.now();
    if (p === '/character') { S.charN++; return [200, { character: ch() }]; }
    if (p === '/game/teleport/locations') return [200, { locations: S.locations }];
    if (p === '/game/battle' && method === 'GET') return [200, { battle: S.battle && { ...S.battle }, character: ch(), serverNowMs: now }];
    if (p === '/game/battle/start') {
      if (S.hero.inBattle) return [400, { error: 'already_in_battle' }];
      const sp = body.spawnId; S.spawnN++;
      const am = (S.ash || []).find(m => m.id === sp);
      if (am) {                                                     // 1.7: Ashen — соседи массового удара: первые два моба списка, кроме главного
        if ((S.ashDead[sp] || 0) > now) return [400, { error: 'mob_respawning' }];
        (S.ashStarts = S.ashStarts || []).push(sp);
        S.battle = { spawnId: sp, mobName: am.name, mobLevel: 85, kind: 'aggressive', championTier: '', mobHp: am.maxHp, mobMaxHp: am.maxHp, log: [],
          ex: S.ash.filter(m => m.id !== sp).slice(0, 2).map(m => ({ name: m.name, mobHp: m.maxHp, mobMaxHp: m.maxHp })) };
      } else S.battle = mob(sp, sp.startsWith('champ_') ? 'Yeti' : 'Grave Robber', sp.startsWith('champ_') ? 'champion' : 'aggressive', sp.startsWith('champ_') ? 'orange' : '');
      S.hero.inBattle = true; S.hero.battleSpawnId = sp; return [200, { battle: S.battle }];
    }
    if (p === '/game/battle/action') return action(body);
    if (p === '/game/ashen-bastion/mobs') { S.ashGet = (S.ashGet || 0) + 1; return [200, { location: 'ashen_bastion', total: S.ash.length, offset: 0, limit: 25,
      mobs: S.ash.map(m => ({ ...m, level: 85, respawnSeconds: Math.max(0, Math.ceil(((S.ashDead[m.id] || 0) - now) / 1000)) })) }]; }
    if (p === '/game/battle/hunt-continue') {
      if (S.hero.inBattle) return [400, { error: 'in_battle' }];
      S.chainN++; S.spawnN++;
      S.battle = S.chainN === S.champAt ? mob('m' + S.spawnN, 'Hot Springs Yeti', 'champion', 'orange') : mob('m' + S.spawnN, 'Grave Robber');
      S.hero.inBattle = true; return [200, { battle: S.battle, serverNowMs: now }];
    }
    if (p === '/game/battle/leave') { S.leaves++; S.hero.inBattle = false; S.battle = null; return [200, { ok: true }]; }
    if (p === '/game/battle/defeat/to-city') { Object.assign(S.hero, { hp: 1, pveDefeat: null, inBattle: false, currentZoneId: 'giran', currentZoneNameUk: 'Місто Гіран', locationType: 'city' }); S.battle = null; return [200, { ok: true }]; }
    if (p === '/game/teleport') {
      const loc = S.locations.find(l => l.teleportId === body.teleportId); if (!loc) return [400, { error: 'unknown' }];
      S.tp.push(body.teleportId); S.hero.adena = String(+S.hero.adena - loc.adenaCost);
      Object.assign(S.hero, { currentZoneId: loc.teleportId, currentZoneNameUk: loc.labelUk, locationType: 'field' }); return [200, { ok: true }];
    }
    if (p === '/game/world/outskirts') { Object.assign(S.hero, { locationType: 'field', currentZoneId: S.hero.currentZoneId === 'giran' ? 'giran_out' : S.hero.currentZoneId }); return [200, { ok: true }]; }
    if (p === '/game/town-buffer/apply-set') { S.buffer.push('basic'); return [200, { ok: true }]; }
    if (p === '/game/town-buffer/restore') { S.buffer.push('restore'); S.hero.hp = S.hero.maxHp; S.hero.mp = S.hero.maxMp; return [200, { ok: true }]; }
    if (p === '/game/antibot/challenge') { S.antibot = 0; return [200, { passed: true }]; }
    if (p === '/game/tvt') return [200, tvtState()];
    if (p === '/game/tvt/skills') return [200, { skills: [{ skillId: 0, action: 'attack', nameUk: 'Атака', mpCost: 0, targetType: 'enemy', usable: true }, { skillId: 190, action: 'l2_190', nameUk: 'Fatal Strike', mpCost: 83, targetType: 'enemy', usable: true }] }];
    if (p === '/game/tvt/register') { S.tvt.isRegistered = true; S.tvt.registeredCount++; return [200, tvtState()]; }
    if (p === '/game/tvt/target') { const e = S.enemies.find(x => x.characterId === body.targetCharacterId); S.target = e || null; return [200, { selectedTarget: e ? { ...e } : null, combatRoster: S.enemies, selfMp: S.hero.mp, selfMaxMp: S.hero.maxMp }]; }
    if (p === '/game/tvt/action') {
      S.tvtActs.push(body.action); const e = S.target;
      if (!e || !e.alive) return [400, { error: 'tvt_target_dead' }];
      e.hp = Math.max(0, e.hp - (body.action === 'l2_190' ? 1500 : 600)); if (!e.hp) e.alive = false;
      if (S.enemies.every(x => !x.alive)) S.tvt.phase = 'RESULT';
      return [200, { targetHp: e.hp, targetCp: 0, targetDead: !e.alive, targetCharacterId: e.characterId, selfMp: S.hero.mp, nextBasicAttackAt: now + 500 }];
    }
    return [200, {}];
  }
  return { S, api };
}

// ---------- страницы игры (упрощённая разметка с теми же селекторами, что у настоящей) ----------
const HUD = `<div id="l2-hud-legacy-name">Dstr</div><div id="l2-hud-legacy-lvl">76</div>
<div>HP <span id="l2-hud-hp-cur">0</span>/<span id="l2-hud-hp-max">0</span> MP <span id="l2-hud-mp-cur">0</span>/<span id="l2-hud-mp-max">0</span></div>
<div id="l2-hud-active-buffs"></div>`;
const COMMON = `<script>
const $=s=>document.querySelector(s);
const post=(u,b)=>fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b||{})}).then(r=>r.json().then(j=>({status:r.status,j})));
async function ch(){const r=await fetch('/character');const c=(await r.json()).character;$('#l2-hud-hp-cur').textContent=c.hp;$('#l2-hud-hp-max').textContent=c.maxHp;$('#l2-hud-mp-cur').textContent=c.mp;$('#l2-hud-mp-max').textContent=c.maxMp;
 $('#l2-hud-active-buffs').innerHTML=(c.activeBuffs||[]).map(b=>'<span data-skill-id="'+b.skillId+'" data-expires-at="'+b.expiresAt+'"></span>').join('');return c;}
ch();setInterval(ch,2500);
</script>`;
const NAV = `<nav id="l2-nav-bottom"><a data-nav-role="outskirts" href="#" onclick="event.preventDefault();post('/game/world/outskirts').then(()=>location.href='/map.html')">Окрестности</a></nav>`;
function page(title, body) { return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${HUD}${COMMON}${body}${NAV}</body></html>`; }
const TITLES = { attack: 'Атака', l2_190: 'Fatal Strike — сильный удар', battle_trance: 'Battle Trance — HP до 25 %', l2_176: 'Frenzy — при HP ≤ 30 %', l2_420: 'Zealot', l2_286: 'Provoke — агро',
  double_shot: 'Double Shot — две стрелы', power_shot: 'Power Shot', stun_shot: 'Stun Shot — оглушение', l2_122: 'Hex', l2_77: 'Attack Aura', l2_91: 'Defense Aura',
  soul_of_sagittarius: 'Soul of Sagittarius', vicious_stance: 'Vicious Stance',
  l2_254: 'Spoil — спойл', l2_302: 'Spoil Festival', l2_348: 'Spoil Crush', l2_36: 'Whirlwind', l2_42: 'Sweeper', l2_1177: 'Wind Strike', l2_1184: 'Ice Bolt',
  l2_1176: 'Blizzard — до 3 целей', l2_1181: 'Flame Strike', l2_1292: 'Elemental Crash', l2_337: 'Arcane Power — стойка' };
function hotbar(H, pots) {
  const slots = H.battleHotbarSlots.map(s => s.k === 'a'
    ? `<button class="l2-battle-hotbar-slot" title="${TITLES[s.a]}" data-slot-cd="${s.a}">${s.a === 'attack' ? '' : `<img src="/skills/${s.a}.gif">`}<span class="l2-battle-hotbar-slot-cd" hidden><span class="l2-battle-hotbar-slot-cd__timer"></span></span></button>`
    : `<button class="l2-battle-hotbar-slot" title="Зілля зцілення ×${pots}" data-slot-cd="battle_potion_use" data-item="${s.id}"><span class="l2-battle-hotbar-slot-uqty">${pots}</span><span class="l2-battle-hotbar-slot-cd" hidden></span></button>`).join('');
  return `<div class="l2-battle-hotbar" data-visible-rows="3"><div class="l2-battle-hotbar__row">${slots}</div></div>`;
}
// Бой: клик во время своего запроса игра теряет (как настоящая); после ответа — GET /character; откат рисуется на слоте.
const BATTLE_JS = `<script>
let busy=false;window.__lost=0;const sid=new URLSearchParams(location.search).get('spawnId');
function render(b){if(!b)return;$('#battle-mob-title').textContent=b.mobName+' · ур. '+b.mobLevel+(b.kind==='champion'?' · чемпион':'');$('#battle-mob-hp-val').textContent=b.mobHp+' / '+b.mobMaxHp;}
function logAdd(lines){for(const t of lines||[]){const d=document.createElement('div');d.className='l2-battle-log-line';const m=t.match(/^Спойл: (.+) (×\d+)$/);
 if(m)d.innerHTML='<span class="l2-battle-log-line__spoil-prefix">Спойл:</span><span class="l2-battle-log-line__body"><span>'+m[1]+'</span><span>'+m[2]+'</span></span>';
 else{const s=document.createElement('span');s.className='l2-battle-log-line__body';s.textContent=t;d.append(s);}$('#battle-log').append(d);}}
fetch('/game/battle?spawnId='+sid).then(r=>r.json()).then(async j=>{const b=j.battle;
 if(/^ashen_/.test(sid)&&!(b&&b.spawnId===sid&&b.mobHp>0)){const s=await post('/game/battle/start',{spawnId:sid});render(s.j.battle);return;}render(b);});
document.querySelectorAll('.l2-battle-hotbar-slot').forEach(el=>el.onclick=async()=>{
 if(busy){window.__lost++;return;}busy=true;const a=el.dataset.slotCd;
 const {status,j}=await post('/game/battle/action',a==='battle_potion_use'?{action:a,itemId:+el.dataset.item}:{action:a});
 logAdd(j.logTail);if(j.mobEffectsSig!=null)$('#battle-mob-effects-row').dataset.effectsSig=j.mobEffectsSig;
 const wx=j.delta&&j.delta.whirlwindExtras;if(wx){const r=$('#battle-whirlwind-extras');r.hidden=false;r.innerHTML=wx.map(x=>'<div class="l2-battle-whirlwind-extra"><span class="l2-battle-whirlwind-extra__name">'+x.name+'</span><div class="l2-battle-whirlwind-extra__bar"><span class="l2-battle-bar-innertext">'+x.mobHp+' / '+x.mobMaxHp+'</span></div></div>').join('');}
 if(j.victory){$('#battle-mob-hp-val').textContent='0 / 4000';$('#battle-victory-inline').hidden=false;$('#battle-victory-hunt').hidden=false;}
 else if(j.defeat){$('#battle-defeat-root').hidden=false;}
 else if(j.delta){$('#battle-mob-hp-val').textContent=j.delta.mobHp+' / '+(j.delta.mobMaxHp||4000);const cd=el.querySelector('.l2-battle-hotbar-slot-cd');const until=(j.delta.skillCooldowns||{})[a];
  if(cd&&until){cd.hidden=false;cd.classList.add('l2-battle-hotbar-slot-cd--on');const tick=()=>{const left=until-Date.now();const tm=cd.querySelector('.l2-battle-hotbar-slot-cd__timer');if(left<=0){cd.hidden=true;cd.classList.remove('l2-battle-hotbar-slot-cd--on');return;}if(tm)tm.textContent=(left/1000).toFixed(1);setTimeout(tick,100);};tick();}}
 if(j.victory||j.defeat||status!==200||(j.delta&&j.delta.hotbarStale))await ch();busy=false;});
$('#battle-victory-hunt').onclick=async()=>{const {j}=await post('/game/battle/hunt-continue');if(j.battle){$('#battle-victory-inline').hidden=true;$('#battle-victory-hunt').hidden=true;$('#battle-log').textContent='';$('#battle-mob-effects-row').dataset.effectsSig='';render(j.battle);}};
$('#battle-back-map').onclick=async()=>{if($('#battle-victory-inline').hidden)await post('/game/battle/leave',{battleSpawnId:sid});location.href=/^ashen_/.test(sid)?'/ashen-bastion.html':'/map.html';};
$('#battle-defeat-tocity').onclick=async()=>{await post('/game/battle/defeat/to-city');location.href='/city.html';};
</script>`;
function battlePage(sv) {
  return page('Бой', `<div id="battle-mob-title"></div><div id="battle-mob-hp-val"></div><div id="battle-whirlwind-extras" hidden></div><div id="battle-mob-effects-row" data-effects-sig=""></div>${hotbar(sv.S.hero, sv.S.pots)}
<div id="battle-log"></div>
<div id="battle-victory-inline" hidden>Победа</div><button id="battle-victory-hunt" hidden>Охотиться дальше</button><button id="battle-back-map">Назад на карту</button>
<div id="battle-defeat-root" hidden><button id="battle-defeat-tocity">Вернуться в город</button></div>${BATTLE_JS}`);
}
function mapPage(sv) {
  const H = sv.S.hero, n = sv.S.spawnN + 1;
  if (H.currentZoneId !== 'giran_harbor' && H.currentZoneId !== 'giran_out') return page('Карта', `<div id="map-list-mode-mobs" class="is-active">Мобы</div><ul id="map-mob-list"></ul>`);
  const rows = [['l2dop_rb_25234', 'Ancient Weird Drake · ур. 60 · рейд-босс', '--raid'], ['champ_o_' + n, 'Yeti · ур. 76', '--champion'], ['n' + n, 'Grave Robber · ур. 75', ''], ['n' + (n + 1), 'Grave Robber · ур. 75', '']];
  const sig = '4|' + rows.map(r => r[0] + ':' + (r[2] === '--raid' ? 'raid' : r[2] === '--champion' ? 'champion' : 'aggressive')).join(',');
  return page('Карта', `<div id="map-list-mode-mobs" class="is-active">Мобы</div><div id="map-mob-markers" data-l2-marker-sig="${sig}"></div>
<ul id="map-mob-list">${rows.map(r => `<li><a class="l2-map-mob-link ${r[2] ? 'l2-map-mob-link' + r[2] : ''}" href="/battle.html?spawnId=${r[0]}">${r[1]}</a></li>`).join('')}</ul>
<div id="map-defeat-root" hidden></div>
<script>document.querySelectorAll('a.l2-map-mob-link').forEach(a=>a.onclick=async e=>{e.preventDefault();const id=new URL(a.href).searchParams.get('spawnId');const {status}=await post('/game/battle/start',{spawnId:id});if(status===200)location.href=a.getAttribute('href');});</script>`);
}
function teleportPage(sv) {
  const rows = sv.S.locations.map(l => `<div class="l2-teleport-miru-surroundings-row">${l.labelUk} <span class="l2-teleport-miru-price-num">${l.adenaCost.toLocaleString('ru')}</span> <span class="l2-teleport-miru-price-currency">аден</span>
<button class="l2-teleport-miru-tp-btn" data-teleport-id="${l.teleportId}">Телепорт</button></div>`).join('');
  return page('Телепорт', `<button class="l2-teleport-miru-city-btn" data-surroundings-key="giran">Гіран</button><div id="tp-rows" hidden>${rows}</div>
<script>document.querySelector('.l2-teleport-miru-city-btn').onclick=()=>{$('#tp-rows').hidden=false;};
document.querySelectorAll('.l2-teleport-miru-tp-btn').forEach(b=>b.onclick=async()=>{await post('/game/teleport',{teleportId:b.dataset.teleportId});location.href='/map.html';});</script>`);
}
// 1.7: Ashen Bastion — карты нет, список мобов на своей странице (разметка как у игры, kb/lite-mage-study.md §2); «Бій» — переход в бой
function ashenPage(sv) {
  const now = Date.now(), fmt = n => n.toLocaleString('uk-UA');
  const rows = sv.S.ash.map(m => { const left = Math.ceil(((sv.S.ashDead[m.id] || 0) - now) / 1000);
    return `<article class="ashen-mob"><div class="ashen-details"><button type="button" class="ashen-name ashen-name-button">${m.name} · Lv 85</button>
<div class="ashen-meta"><span class="ashen-meta__hp">HP ${fmt(m.maxHp)}</span><span class="ashen-meta__sep"> · </span><span class="ashen-meta__exp">EXP ${fmt(m.exp)}</span></div></div>
<button type="button" class="l2-town-btn ashen-fight" data-id="${m.id}"${left > 0 ? ' disabled' : ''}>${left > 0 ? '⏳ ' + left + 'с' : 'Бій'}</button></article>`; }).join('');
  return page('Ashen Bastion', `<a href="/city.html" id="ashen-exit-city">Вийти в місто (Aden) →</a><span id="ashen-page-counter">${sv.S.ash.length} монстрів · 85 рівень</span>
<button type="button" id="ashen-reload">Оновити</button><p class="err" id="ashen-error" hidden></p><div id="ashen-mobs">${rows}</div>
<div class="ashen-pager"><button id="ashen-prev" disabled>←</button><span id="ashen-page-number">1 / 1</span><button id="ashen-next" disabled>→</button></div>
<script>document.querySelectorAll('.ashen-fight').forEach(b=>b.onclick=()=>{location.href='/battle.html?spawnId='+encodeURIComponent(b.dataset.id);});$('#ashen-reload').onclick=()=>location.reload();</script>`);
}
const cityPage = () => page('Город', `<a class="l2-town-miru-item--buffer-statue" href="/town-buffer.html">Магическая статуя</a>`);
const bufferPage = () => page('Баффер', `<div id="town-buffer-sets"><button class="l2-town-buffer-set-apply" data-set-id="basic">Базовый</button></div>
<div id="town-buffer-result-title"></div><div id="town-buffer-result-text"></div><button id="town-buffer-restore-btn">Восстановить</button><div id="town-buffer-msg"></div>
<script>$('.l2-town-buffer-set-apply').onclick=async()=>{await post('/game/town-buffer/apply-set',{setId:'basic'});$('#town-buffer-result-title').textContent='Набор накладено';};
$('#town-buffer-restore-btn').onclick=async()=>{await post('/game/town-buffer/restore');await ch();$('#town-buffer-msg').textContent='HP и MP восстановлены';};</script>`);
function arenaPage(sv) {
  const t = sv.S.tvt;
  const en = sv.S.enemies.map(e => `<span class="l2-tvt-nick${e.alive ? '' : ' l2-tvt-nick--dead'}" data-target-kind="enemy" data-character-id="${e.characterId}" title="${e.level} ур.">${e.name}</span>`).join(' ');
  return page('TvT', `<div id="tvt-phase-label">${t.phase}</div><div id="tvt-message"></div>
${!t.isRegistered && t.phase === 'REGISTRATION' ? '<button id="tvt-register-btn">Зарегистрироваться</button>' : ''}
<div id="tvt-roster">${en}</div><div id="tvt-battle-target-block" hidden><span id="tvt-target-name">—</span> <span id="tvt-target-hp"></span><button id="tvt-back-roster-btn">← Вернуться на TvT</button></div>
${hotbar({ battleHotbarSlots: sv.S.hero.battleHotbarSlots.filter(s => s.a === 'attack' || s.a === 'l2_190') }, 0)}
<div id="tvt-result-section" hidden><div class="l2-tvt-result__headline">Победа синих</div><div class="l2-tvt-result__score">2 : 0</div><div class="l2-tvt-result__reward-text">TvT-жетон ×3</div></div>
<script>
let tgt=null;
async function poll(){const j=await (await fetch('/game/tvt')).json();$('#tvt-phase-label').textContent=j.phase;if(j.phase==='RESULT')$('#tvt-result-section').hidden=false;}
setInterval(poll,1000);poll();
if($('#tvt-register-btn'))$('#tvt-register-btn').onclick=async()=>{await post('/game/tvt/register');$('#tvt-register-btn').remove();$('#tvt-message').textContent='Вы записаны';};
document.querySelectorAll('.l2-tvt-nick').forEach(n=>n.onclick=async()=>{const {j}=await post('/game/tvt/target',{targetCharacterId:n.dataset.characterId});tgt=j.selectedTarget;
 if(tgt){$('#tvt-battle-target-block').hidden=false;$('#tvt-target-name').textContent=tgt.name;$('#tvt-target-hp').textContent=tgt.hp+' / '+tgt.maxHp;}});
$('#tvt-back-roster-btn').onclick=async()=>{await post('/game/tvt/target/clear');tgt=null;$('#tvt-battle-target-block').hidden=true;};
document.querySelectorAll('.l2-battle-hotbar-slot').forEach(el=>el.onclick=async()=>{if(!tgt)return;const {j}=await post('/game/tvt/action',{action:el.dataset.slotCd,targetCharacterId:tgt.characterId});
 if(j.targetHp!=null){$('#tvt-target-hp').textContent=j.targetHp+' / '+tgt.maxHp;if(j.targetDead){document.querySelector('[data-character-id="'+tgt.characterId+'"]').classList.add('l2-tvt-nick--dead');}}});
</script>`);
}

async function launch() {
  const sv = makeServer();
  const ctx = await chromium.launchPersistentContext('', { headless: true, executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  const errors = [], logs = [];
  await ctx.route('https://l2wap.com/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname;
    // S.noPoll (сценарий D): страница не перечитывает героя по таймеру — только после хода, как настоящая игра в бою
    const html = b => route.fulfill({ contentType: 'text/html; charset=utf-8', body: sv.S.noPoll ? b.replace('setInterval(ch,2500);', '') : b }).catch(() => {});
    if (p === '/map.html') return html(mapPage(sv));
    if (p === '/battle.html') return html(battlePage(sv));
    if (p === '/ashen-bastion.html') return html(ashenPage(sv));
    if (p === '/teleport.html') return html(teleportPage(sv));
    if (p === '/city.html') return html(cityPage(sv));
    if (p === '/town-buffer.html') return html(bufferPage(sv));
    if (p === '/tvt-arena.html') return html(arenaPage(sv));
    if (/\.(gif|png|jpg|ico)$/.test(p)) return route.fulfill({ status: 404, body: '' }).catch(() => {});
    let body = {}; try { body = req.postDataJSON() || {}; } catch (e) {}
    const S = sv.S, isAct = p === '/game/battle/action';
    if (isAct) { if (++S.pending > 1) S.overlap++; }
    let status, json;
    try {
      const lat = isAct ? S.lat.action + (S.slowNext ? S.slowNext : 0) : p === '/character' ? S.lat.character : 0;
      if (isAct && S.slowNext) S.slowNext = 0;
      // S.latSplit (сценарий D): половина задержки до сервера, половина — обратно (откаты сервер считает от момента обработки)
      const pre = S.latSplit ? Math.round(lat / 2) : lat;
      if (pre) await delay(pre);
      [status, json] = await sv.api(p, req.method(), body);
      if (lat > pre) await delay(lat - pre);
    } finally { if (isAct) S.pending--; }
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) }).catch(() => {});
  });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  const game = await ctx.newPage();
  game.on('pageerror', e => errors.push('game: ' + e.message));
  game.on('console', m => { if (/L2wap Lite/.test(m.text())) logs.push(m.text()); if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  const store = keys => sw.evaluate(k => chrome.storage.local.get(k), keys);
  const rt = async () => (await store(['lite.rt']))['lite.rt'] || {};
  const cfg = async () => (await store(['lite.cfg']))['lite.cfg'] || {};
  const pcfg = async (kind = 'destr') => L.profCfg(await cfg(), kind);
  async function popup() {
    const pp = await ctx.newPage(); pp.on('pageerror', e => errors.push('popup: ' + e.message));
    await pp.goto(`chrome-extension://${id}/popup.html`); await until(() => pp.evaluate(() => !!document.getElementById('run').onclick), 5000, 'меню');
    return pp;
  }
  return { sv, S: sv.S, ctx, sw, game, store, rt, cfg, pcfg, popup, errors, logs, id };
}
const logText = r => (r.log || []).map(x => x.x).join('\n');
// 1.5.1: окно «СТРЕЛ НЕТ» на странице игры (shadow DOM окна Lite) — видно ли, текст и цвета; close — нажать «Закрыть»
const arwBox = game => game.evaluate(() => {
  const r = document.getElementById('l2lite-dock')?.shadowRoot?.querySelector('.arw'); if (!r) return null;
  const b = r.getBoundingClientRect();
  return { shown: !r.hidden && b.width > 300 && b.height > 100, text: r.textContent, bg: getComputedStyle(r).backgroundColor, color: getComputedStyle(r.querySelector('.h')).color, size: parseFloat(getComputedStyle(r.querySelector('.h')).fontSize) };
});
const arwClose = (game, sel = '.ok') => game.evaluate(s => document.getElementById('l2lite-dock').shadowRoot.querySelector('.arw ' + s).click(), sel);

async function scenarioA() {
  const h = await launch(), { S } = h;
  try {
    await h.game.goto('https://l2wap.com/map.html');
    await until(async () => (await h.rt()).locs?.length === 2 && (await h.rt()).bar?.length >= 5, 20000, 'локации и панель в памяти');
    const pp = await h.popup();
    // меню: локация из списка игры, 5 мобов, скиллы из панели (Provoke по умолчанию выключен), Fatal Strike выключим и включим обратно
    await until(() => pp.evaluate(() => [...document.querySelectorAll('#zone option')].some(o => o.value === 'giran_harbor')), 5000, 'список локаций в меню');
    await pp.selectOption('#zone', 'giran_harbor');
    await pp.fill('#limit', '5'); await pp.dispatchEvent('#limit', 'change');
    const skillRows = await pp.$$eval('#skills .sk', els => els.map(e => [e.dataset.key, e.querySelector('input').checked, e.querySelector('select').value]));
    assert.deepEqual(skillRows.map(r => r[0]), ['l2_190', 'battle_trance', 'l2_176', 'l2_420', 'l2_286']);
    assert.deepEqual(skillRows.find(r => r[0] === 'l2_286').slice(1), [false, 'other']);
    assert.deepEqual(skillRows.find(r => r[0] === 'battle_trance').slice(1), [true, 'trance']);
    await until(async () => (await h.pcfg()).killLimit === 5 && (await h.pcfg()).zone === 'giran_harbor', 5000, 'настройки записаны');
    assert.equal((await h.pcfg()).zoneName, 'Гавань Гірана');
    assert.equal((await h.cfg()).p.destr.killLimit, 5, '1.5: в профиль Дестра (в игре Титан)');
    await pp.click('#run');
    await until(async () => (await h.cfg()).on === true, 5000, 'Старт');
    await h.game.bringToFront();
    // охота: карта → обычный моб (не РБ, не чемпион) → бой → цепочка; второй бой цепочки — чемпион → выход на карту
    await until(async () => S.acts.length > 0, 20000, 'первый ход');
    assert.ok(!S.acts.includes('l2_286'), 'Provoke выключен');
    await until(async () => S.leaves >= 1, 60000, 'выход из боя с чемпионом');
    await until(async () => (await h.rt()).k?.kills >= 5, 120000, '5 мобов');
    const r1 = await h.rt();
    assert.equal(r1.k.kills, 5);
    assert.match(logText(r1), /чемпион — не моя цель/);
    assert.match(logText(r1), /цель выполнена: убито 5 из 5/);
    assert.ok(S.acts.includes('battle_trance') && S.acts.includes('l2_176') && S.acts.includes('l2_420'), 'транс → Frenzy → Zealot: ' + S.acts.join(','));
    const ti = S.acts.indexOf('battle_trance'), fi = S.acts.indexOf('l2_176'), zi = S.acts.indexOf('l2_420');
    assert.ok(ti < fi && fi < zi, 'порядок транс → Frenzy → Zealot');
    assert.ok(!S.acts.some(a => a.startsWith('champ')), 'чемпиона с карты не выбирал');
    const killsAt = S.hero.mobsKilled, actsAt = S.acts.length;
    await delay(6000);
    assert.equal(S.hero.mobsKilled, killsAt, 'после лимита не охотится');
    assert.ok(S.acts.length - actsAt <= 1, 'после лимита ходов нет');
    // TvT: открылась запись → бот идёт на арену и записывается, потом обратно на карту
    Object.assign(S.tvt, { phase: 'REGISTRATION', registrationEndsAt: Date.now() + 8 * 60000, schedule: { enabled: true, next: { slotKey: 'tvt-0800', battleStartsAt: Date.now() + 8.5 * 60000 } } });
    await until(() => S.tvt.isRegistered, 40000, 'запись на TvT');
    await until(() => /\/map\.html$/.test(new URL(h.game.url()).pathname), 20000, 'после записи — на карту');
    // старт боя TvT → арена → бой по врагам → итог → игра перенесла в город → телепорт назад
    Object.assign(S.tvt, { phase: 'ACTIVE', startsAt: Date.now(), endsAt: Date.now() + 10 * 60000 });
    await until(() => S.enemies.every(e => !e.alive), 60000, 'враги TvT повержены');
    assert.ok(S.tvtActs.length >= 3);
    Object.assign(S.hero, { currentZoneId: 'giran', currentZoneNameUk: 'Місто Гіран', locationType: 'field' });
    await until(async () => /TvT: итог/.test(logText(await h.rt())), 30000, 'итог TvT в журнале');
    await until(() => S.tp.includes('giran_harbor'), 40000, 'телепорт назад на место охоты');
    await until(() => S.hero.currentZoneId === 'giran_harbor' && /\/map\.html$/.test(new URL(h.game.url()).pathname), 20000, 'на месте охоты');
    const r2 = await h.rt();
    assert.match(logText(r2), /лечу обратно/);
    assert.match(logText(r2), /телепорт → «Гавань Гірана» за 2500 аден/);
    assert.equal(r2.tvtDone, 'tvt-0800');
    await delay(4000);
    assert.equal(S.hero.mobsKilled, killsAt, 'после TvT лимит держится');
    // Стоп из меню
    await pp.click('#run'); await until(async () => (await h.cfg()).on === false, 5000, 'Стоп');
    assert.deepEqual(h.errors, []);
    if (process.env.LITE_LOG) console.log(logText(await h.rt()), '\nходы:', S.acts.join(','), '\nTvT:', S.tvtActs.join(','));
    console.log('PASS A: меню → охота цепочкой, выход от чемпиона, транс → Frenzy → Zealot, лимит 5, TvT запись/бой/итог, телепорт назад, Стоп');
  } catch (e) { console.error('DIAG A', { acts: h.S.acts.join(','), tvtActs: h.S.tvtActs, tp: h.S.tp, url: h.game.url(), log: logText(await h.rt().catch(() => ({}))), errors: h.errors }); throw e; }
  finally { await h.ctx.close(); }
}

async function scenarioB() {
  const h = await launch(), { S } = h;
  try {
    S.champAt = 99; S.locations[0].adenaCost = 0;    // VIP: телепорт к месту охоты за 0 аден
    await h.game.goto('https://l2wap.com/map.html');
    await until(async () => (await h.rt()).locs?.length === 2, 20000, 'локации');
    const pp = await h.popup();
    await pp.click('#run');                                   // место — «где стоит герой», без лимита
    await until(async () => (await h.rt()).zone?.id === 'giran_harbor', 15000, 'место охоты запомнено');
    await h.game.bringToFront();
    await until(() => S.hero.mobsKilled >= 1002, 60000, 'охота');
    // смерть: следующий удар моба убивает → «Вернуться в город» → статуя → бесплатный набор и «Восстановить»
    S.killHero = true;
    await until(() => S.buffer.includes('restore'), 60000, 'статуя: восстановление');
    S.killHero = false;
    assert.ok(S.buffer.includes('basic'), 'бесплатный бафф наложен');
    assert.match(logText(await h.rt()), /герой погиб \(1 за 30 мин\)/);
    // назад на место охоты: «0 аден» — валюта подтверждена, телепорт бесплатный
    await until(() => S.tp.includes('giran_harbor'), 40000, 'телепорт назад');
    await until(() => S.hero.currentZoneId === 'giran_harbor', 20000, 'вернулся');
    const k0 = S.hero.mobsKilled;
    await until(() => S.hero.mobsKilled > k0, 60000, 'охота после возврата');
    // проверка активности: сервер отвечает 423 — бот замирает, никаких кликов, пока игрок не пройдёт её
    S.antibot = 1;
    await until(() => S.abActs >= 1, 30000, 'капча выдана');
    // 1.4: окно Lite не закрывает «Проверку активности» — пока она на экране, окно свёрнуто в кнопку, потом снова развёрнуто
    const win = h.game.locator('#l2lite-dock .win'), fab = h.game.locator('#l2lite-dock .fab');
    await win.waitFor({ state: 'visible', timeout: 5000 });
    await h.game.evaluate(() => { const d = document.createElement('div'); d.id = 'l2-antibot-layer'; d.innerHTML = '<div class="l2-antibot-card__options">Перевірка: натисніть символи</div>'; document.body.appendChild(d); });
    await fab.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await win.isVisible(), false, 'окно поверх проверки активности');
    const n0 = S.acts.length;
    await delay(5000);
    assert.equal(S.acts.length, n0, 'во время проверки активности ни одного хода');
    assert.match((await h.rt()).status, /КАПЧА/);
    await h.game.evaluate(() => document.getElementById('l2-antibot-layer').remove());
    await win.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await h.game.evaluate(() => JSON.parse(localStorage.getItem('l2lite-dock') || 'null')), null, 'капча не меняет выбор игрока');
    await h.game.evaluate(() => fetch('/game/antibot/challenge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
    const k1 = S.hero.mobsKilled;
    await until(() => S.hero.mobsKilled > k1, 60000, 'охота после проверки');
    assert.match(logText(await h.rt()), /проверка активности пройдена/);
    await pp.click('#run'); await until(async () => (await h.cfg()).on === false, 5000, 'Стоп');
    const n1 = S.acts.length; await delay(3000); assert.ok(S.acts.length - n1 <= 1, 'после Стопа ходов нет');
    assert.deepEqual(h.errors, []);
    if (process.env.LITE_LOG) console.log(logText(await h.rt()), '\nходы:', S.acts.join(','));
    console.log('PASS B: «где стоит герой» → смерть → город → статуя (бафф + восстановление) → телепорт назад → капча: бот замер, окно Lite свёрнуто, пока она на экране → пройдена → охота; Стоп');
  } catch (e) { console.error('DIAG B', { acts: h.S.acts.slice(-30).join(','), buffer: h.S.buffer, tp: h.S.tp, url: h.game.url(), log: logText(await h.rt().catch(() => ({}))), errors: h.errors }); throw e; }
  finally { await h.ctx.close(); }
}

async function scenarioC() {
  const h = await launch(), { S } = h;
  try {
    S.champAt = 99; S.mobHp = 60000; S.lat = { action: 150, character: 300 }; S.cdSet = { attack: 200, l2_190: 2500 };
    S.hero.battleHotbarSlots = S.hero.battleHotbarSlots.filter(x => x.a === 'attack' || x.a === 'l2_190');
    await h.game.goto('https://l2wap.com/map.html');
    await until(async () => (await h.rt()).locs?.length === 2, 20000, 'локации');
    // 1.4 (John: «кнопка сворачивающая окно бота… как плавающая кнопка, захотел свернул, захотел развернул»): окно меню на странице игры
    const g = h.game, win = g.locator('#l2lite-dock .win'), fab = g.locator('#l2lite-dock .fab'), hd = g.locator('#l2lite-dock .hd');
    const box = async l => { const b = await l.boundingBox(); return b && { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
    const mem = () => g.evaluate(() => JSON.parse(localStorage.getItem('l2lite-dock') || 'null'));
    const dockFrame = async () => { const el = await until(() => g.$('#l2lite-dock iframe'), 5000, 'iframe меню'); return el.contentFrame(); };
    const menuReady = fr => until(() => fr.evaluate(() => document.documentElement.classList.contains('dock') && !!document.getElementById('run').onclick), 8000, 'меню в окне');
    async function drag(l, dx, dy) {
      const b = await l.boundingBox(), x = b.x + Math.min(40, b.width / 2), y = b.y + b.height / 2;
      await g.mouse.move(x, y); await g.mouse.down(); await g.mouse.move(x + dx, y + dy, { steps: 8 }); await g.mouse.up();
    }
    // узкий экран (телефон) — сначала свёрнуто в кнопку; на широком — окно открыто
    await g.setViewportSize({ width: 600, height: 800 });
    await g.evaluate(() => localStorage.removeItem('l2lite-dock')); await g.reload();
    await fab.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await fab.textContent(), 'Lite'); assert.equal(await win.isVisible(), false);
    assert.equal(await g.$('#l2lite-dock iframe'), null, 'свёрнутое окно не грузит меню');
    await g.setViewportSize({ width: 1280, height: 720 }); await g.reload();
    await win.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await fab.isVisible(), false);
    let wb = await box(win);
    assert.ok(wb.x + wb.w <= 1280 && wb.x + wb.w >= 1240 && wb.y <= 10 && wb.w === 392 && wb.h === 640, 'окно у правого края ' + JSON.stringify(wb));
    await menuReady(await dockFrame());
    // поиск кнопок бота по тексту окна не видит (shadow DOM), стиль игры — тоже
    assert.equal(await g.evaluate(() => [...document.querySelectorAll('a,button,[role=button]')].some(e => /Lite|⧉|—/.test(e.textContent))), false);
    // «—» → плавающая кнопка; меню выгружено; запомнено
    await g.locator('#l2lite-dock .min').click();
    await fab.waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(await win.isVisible(), false); assert.equal(await g.$('#l2lite-dock iframe'), null);
    assert.equal((await mem()).open, false);
    // перетащили кнопку — окно не открылось, место запомнено
    const f0 = await box(fab);
    await drag(fab, -300, -150);
    const f1 = await box(fab);
    assert.ok(Math.abs(f1.x - (f0.x - 300)) <= 3 && Math.abs(f1.y - (f0.y - 150)) <= 3, 'кнопка перетащена ' + JSON.stringify([f0, f1]));
    assert.equal(await win.isVisible(), false, 'перенос кнопки не разворачивает окно');
    assert.deepEqual((await mem()).fab, { x: f1.x, y: f1.y });
    // нажали кнопку — окно снова, перетащили окно за шапку
    await fab.click();
    await win.waitFor({ state: 'visible', timeout: 3000 });
    await menuReady(await dockFrame());
    wb = await box(win);
    await drag(hd, -500, 40);
    const w1 = await box(win);
    assert.ok(Math.abs(w1.x - (wb.x - 500)) <= 3 && Math.abs(w1.y - (wb.y + 40)) <= 3, 'окно перетащено ' + JSON.stringify([wb, w1]));
    assert.deepEqual((await mem()).win, { x: w1.x, y: w1.y }); assert.equal((await mem()).open, true);
    // после перезагрузки страницы — там же и развёрнуто; окно браузера сузили — окно поджалось и осталось на экране
    await g.reload();
    await win.waitFor({ state: 'visible', timeout: 5000 });
    assert.deepEqual(await box(win), w1);
    const frT = Date.now(), fr = await dockFrame();
    await menuReady(fr);
    await g.setViewportSize({ width: 700, height: 500 }); await delay(300);
    const w2 = await box(win);
    assert.ok(w2.x >= 0 && w2.y >= 0 && w2.x + w2.w <= 700 && w2.y + w2.h <= 500 && w2.h === 484, 'окно в пределах экрана ' + JSON.stringify(w2));
    await g.setViewportSize({ width: 1280, height: 720 }); await delay(300);
    // «⧉» — то же меню во вкладке; второй раз — та же вкладка
    const [menu] = await Promise.all([h.ctx.waitForEvent('page', { timeout: 5000 }), g.locator('#l2lite-dock .tab').click()]);
    await menu.waitForLoadState();
    assert.ok(menu.url().endsWith('/popup.html#tab'), menu.url());
    const nPages = h.ctx.pages().length;
    await g.bringToFront(); await g.locator('#l2lite-dock .tab').click(); await delay(1000);
    assert.equal(h.ctx.pages().length, nPages, 'второй клик открыл ещё одну вкладку');
    await menu.close(); await g.bringToFront();
    // меню в окне ответило «готово» — подсказки «не загрузилось» нет и через 8 с
    await delay(Math.max(0, 9000 - (Date.now() - frT)));
    assert.equal(await g.locator('#l2lite-dock .fail').isVisible(), false, 'подсказка «меню не загрузилось» при работающем меню');
    // Старт прямо из окна на странице, свернули — кнопка зелёная «Lite ▶»
    await fr.click('#run');
    await until(async () => (await h.cfg()).on === true, 5000, 'Старт из окна');
    await g.locator('#l2lite-dock .min').click();
    await until(async () => (await fab.textContent()) === 'Lite ▶' && /\bon\b/.test(await fab.getAttribute('class')), 5000, 'кнопка «включён»');
    const pp = await h.popup();
    await g.bringToFront();
    await until(() => S.acts.length >= 25, 60000, '25 ходов');
    // ход по ответу сервера: удар→удар внутри одного боя (без победы между ходами)
    const gaps = S.actT.slice(1).map((t, i) => t - S.actT[i]).filter(x => x < 3000).sort((a, b) => a - b), med = gaps[gaps.length >> 1];
    // второй ход не уходит, пока первый 7 с ждёт ответа сервера
    const n0 = S.acts.length; S.slowNext = 7000;
    await until(() => S.acts.length > n0, 10000, 'медленный ход');
    await until(() => S.acts.length > n0 + 3, 20000, 'ходы после медленного');
    assert.equal(S.overlap, 0, 'второй ход ушёл до ответа на первый');
    const lost = await h.game.evaluate(() => window.__lost || 0);
    assert.ok(lost <= 1, 'потерянных кликов ' + lost);
    assert.ok(med < 600, 'удар→удар, медиана ' + med + ' мс (Lite 1.0 на этой модели — 530–585 мс и 2 потерянных клика)');
    await pp.click('#run'); await until(async () => (await h.cfg()).on === false, 5000, 'Стоп');
    assert.deepEqual(h.errors, []);
    console.log(`PASS C: окно Lite на странице игры: свёрнуто на узком экране, «—» → плавающая кнопка, перенос кнопки/окна запомнен, поджимается при сужении, «⧉» — вкладка, Старт из окна → «Lite ▶»; ход 150 мс + GET /character 300 мс → удар→удар медиана ${med} мс, потерянных кликов ${lost}; второй ход не ушёл, пока первый 7 с ждал ответа`);
  } catch (e) { console.error('DIAG C', { acts: h.S.acts.slice(-30).join(','), overlap: h.S.overlap, url: h.game.url(), log: logText(await h.rt().catch(() => ({}))), errors: h.errors }); throw e; }
  finally { await h.ctx.close(); }
}

// D (Lite 1.2, быстрый удар из основного 20.42): модель основного бота — ход 0,4 с, свой GET /character игры 0,35 с после каждого
// ответа с hotbarStale. Сначала галка «⚡ Быстрый удар» выключена, потом включена; меряем удар→удар и число GET /character.
async function scenarioD() {
  const h = await launch(), { S } = h;
  const run = async (n, what) => {
    const a0 = S.actT.length, c0 = S.charN, l0 = await h.game.evaluate(() => window.__lost || 0);
    await until(() => S.actT.length >= a0 + n, 90000, what);
    const t = S.actT.slice(a0, a0 + n), gaps = t.slice(1).map((x, i) => x - t[i]).filter(x => x < 3000).sort((a, b) => a - b);
    return { med: gaps[gaps.length >> 1], chars: S.charN - c0, lost: (await h.game.evaluate(() => window.__lost || 0)) - l0, sec: (t[t.length - 1] - t[0]) / 1000 };
  };
  try {
    S.noPoll = true; S.latSplit = true; S.champAt = 99; S.mobHp = 200000; S.lat = { action: 400, character: 350 }; S.gcdMs = 60; S.cdSet = { attack: 60, l2_190: 2500 };
    S.hero.battleHotbarSlots = S.hero.battleHotbarSlots.filter(x => x.a === 'attack' || x.a === 'l2_190' || x.k === 'u');
    await h.game.goto('https://l2wap.com/map.html');
    await until(async () => (await h.rt()).locs?.length === 2, 20000, 'локации');
    const pp = await h.popup();
    assert.equal(await pp.evaluate(() => document.getElementById('fastTurn').checked), true, 'по умолчанию ВКЛ');
    await pp.click('details > summary'); await pp.click('#fastTurn');
    await until(async () => (await h.pcfg()).fastTurn === false, 5000, 'галка ВЫКЛ');
    await pp.click('#run');
    await h.game.bringToFront();
    await until(() => S.acts.length >= 3, 30000, 'бой начат');
    const off = await run(20, '20 ударов ВЫКЛ');
    assert.equal(await h.game.evaluate(() => document.documentElement.dataset.l2liteFastN), undefined, 'при ВЫКЛ ответы не трогаются');
    await pp.click('#fastTurn');
    await until(async () => (await h.pcfg()).fastTurn === true, 5000, 'галка ВКЛ');
    await run(3, 'переход');
    const on = await run(20, '20 ударов ВКЛ');
    const fastN = +(await h.game.evaluate(() => document.documentElement.dataset.l2liteFastN || 0));
    console.log('D замер', { off, on, fastN });
    assert.ok(fastN >= 10, 'быстрых ответов ' + fastN);
    assert.ok(on.med < off.med - 150, `удар→удар ВКЛ ${on.med} мс против ВЫКЛ ${off.med} мс`);
    assert.ok(on.chars <= Math.ceil(on.sec / 30) + 2 && off.chars >= 15, `GET /character: ВЫКЛ ${off.chars}, ВКЛ ${on.chars} за ${on.sec} с`);
    assert.ok(off.lost <= 1 && on.lost <= 1, `потерянные клики ВЫКЛ ${off.lost}, ВКЛ ${on.lost}`);
    // HP героя падает сразу после собственного GET /character игры: панель отстанет до 30 с (1.5.1, было 5), банку бот пьёт по ответу на ход
    const c1 = S.charN; await until(() => S.charN > c1, 35000, 'GET /character игры');
    const p0 = S.acts.filter(a => a === 'battle_potion_use').length, tDrop = Date.now(); S.hero.hp = 6000;
    await until(() => S.acts.filter(a => a === 'battle_potion_use').length > p0, 6000, 'банка HP по ответу на ход');
    const potMs = Date.now() - tDrop, hud = await h.game.evaluate(() => document.getElementById('l2-hud-hp-cur').textContent);
    assert.ok(potMs < 2500, `банка через ${potMs} мс (панель героя показывала ${hud})`);
    assert.equal(S.overlap, 0, 'второй ход ушёл до ответа на первый');
    await pp.click('#run'); await until(async () => (await h.cfg()).on === false, 5000, 'Стоп');
    assert.deepEqual(h.errors, []);
    console.log(`PASS D: ход 0,4 с + GET /character 0,35 с → удар→удар ВЫКЛ ${off.med} мс (GET ${off.chars} на 20 ударов) → ВКЛ ${on.med} мс (GET ${on.chars}), потерянных кликов ${off.lost}/${on.lost}; банка HP через ${potMs} мс после падения HP (панель ещё ${hud})`);
  } catch (e) { console.error('DIAG D', { acts: h.S.acts.slice(-30).join(','), overlap: h.S.overlap, url: h.game.url(), log: logText(await h.rt().catch(() => ({}))), errors: h.errors }); throw e; }
  finally { await h.ctx.close(); }
}

async function scenarioE() {
  const h = await launch(), { S } = h;
  const SLOTS = act => ({ activeSlot: act, slots: [
    { slot: 0, owned: true, active: act === 0, profession: 'human_arcana_lord', race: 'Human', level: 78 },
    { slot: 1, owned: true, active: act === 1, profession: 'dwarf_bounty_hunter', race: 'Dwarf', level: 70 },
    { slot: 2, owned: true, active: act === 2, profession: 'orc_titan', race: 'Orc', level: 76 },
    { slot: 3, owned: false, active: false, profession: null, race: null, level: null }] });
  const titan = { l2Profession: 'orc_titan', level: 76, classSlots: SLOTS(2), battleHotbarSlots: S.hero.battleHotbarSlots, learnedBattleSkillsDetail: S.hero.learnedBattleSkillsDetail };
  // 1.6: «чужой» класс — основной маг (БХ теперь свой профиль «Споил», сценарий H)
  const bh = { l2Profession: 'human_arcana_lord', level: 78, classSlots: SLOTS(0),
    battleHotbarSlots: [{ k: 'a', a: 'attack' }, { k: 'a', a: 'l2_1177' }, { k: 'a', a: 'l2_1184' }],
    learnedBattleSkillsDetail: [{ battleId: 'l2_1177', nameUk: 'Wind Strike' }, { battleId: 'l2_1184', nameUk: 'Ice Bolt' }] };
  const BH_ACT = /^(?:l2_1177|l2_1184)$/;
  try {
    S.champAt = 99;
    Object.assign(S.hero, bh);
    await h.game.goto('https://l2wap.com/map.html');
    await until(async () => (await h.rt()).char?.prof === 'human_arcana_lord' && (await h.rt()).locs?.length === 2, 20000, 'герой-маг в памяти');
    const pp = await h.popup();
    await until(() => pp.evaluate(() => !document.getElementById('cls').hidden), 5000, 'предупреждение в меню');
    const warn = await pp.textContent('#cls');
    assert.match(warn, /Сейчас в игре Dstr — Human Arcana Lord/);
    assert.match(warn, /переключите в игре класс на Dwarf Bounty Hunter \(сабкласс 1, 70 ур\.\) или Orc Titan \(сабкласс 2, 76 ур\.\)/);
    assert.match(await pp.textContent('#hero'), /Dstr, 78 ур\. · Human Arcana Lord/);
    assert.equal(await pp.$$eval('#skills .sk', e => e.length), 0, 'скиллы мага в меню');
    assert.match(await pp.textContent('#skills'), /когда в игре будет активен Дестр\/Титан/);
    assert.deepEqual((await h.rt()).bar || [], [], 'панель мага в памяти');
    await pp.click('#run');
    await until(async () => /Lite ведёт только Дестра\/Титана, лучника, спойлера и мага/.test((await h.rt()).status || ''), 10000, 'статус «жду Дестра»');
    await delay(6000);
    assert.equal(S.spawnN, 0, 'начат бой'); assert.deepEqual(S.acts, []); assert.deepEqual(S.tp, []); assert.equal(S.tvt.isRegistered, false);
    assert.equal(h.game.url(), 'https://l2wap.com/map.html');
    const r1 = await h.rt();
    assert.match(r1.status, /Сейчас в игре Dstr — Human Arcana Lord\. Lite ведёт только Дестра\/Титана, лучника, спойлера и мага: переключите в игре класс на Dwarf Bounty Hunter \(сабкласс 1\) или Orc Titan \(сабкласс 2\)/);
    assert.equal(logText(r1).match(/Lite только для Дестра, лучника, спойлера и мага/g)?.length, 1, 'запись в журнале одна');
    // игрок переключил в игре сабкласс на Титана (слот 2): игра перечитала героя → Lite охотится, меню без предупреждения, скиллы Титана
    Object.assign(S.hero, titan);
    await until(() => S.acts.length >= 5, 30000, 'охота на Титане');
    await until(() => pp.evaluate(() => document.getElementById('cls').hidden && document.querySelectorAll('#skills .sk').length === 5), 5000, 'меню Титана');
    const r2 = await h.rt();
    assert.match(logText(r2), /активен Orc Titan \(Dstr\) — продолжаю/);
    assert.equal(r2.barCls, 'orc_titan');
    assert.ok(!S.acts.some(a => BH_ACT.test(a)), 'жал скилл мага: ' + S.acts.join(','));
    // Стоп, в игре снова маг: в меню — предупреждение и панель Титана (панель мага её не затирает); после Старта — снова ждёт
    await pp.click('#run'); await until(async () => (await h.cfg()).on === false, 5000, 'Стоп');
    Object.assign(S.hero, bh, { inBattle: false }); S.battle = null;
    await until(async () => (await h.rt()).char?.prof === 'human_arcana_lord', 10000, 'снова маг');
    await until(() => pp.evaluate(() => !document.getElementById('cls').hidden), 5000, 'предупреждение снова');
    assert.deepEqual(await pp.$$eval('#skills .sk', els => els.map(e => e.dataset.key)), ['l2_190', 'battle_trance', 'l2_176', 'l2_420', 'l2_286']);
    assert.equal((await h.rt()).barCls, 'orc_titan');
    const n = S.acts.length;
    await pp.click('#run');
    await until(async () => /Lite ведёт только Дестра\/Титана, лучника, спойлера и мага/.test((await h.rt()).status || ''), 10000, 'статус «жду Дестра» после Старта');
    await delay(4000);
    assert.equal(S.acts.length, n, 'ходы на маге');
    await pp.click('#run'); await until(async () => (await h.cfg()).on === false, 5000, 'Стоп');
    assert.deepEqual(h.errors, []);
    console.log(`PASS E: активен маг — предупреждение «переключите на Dwarf Bounty Hunter (сабкласс 1) или Orc Titan (сабкласс 2)», скиллов мага нет, 0 боёв/ходов/телепортов за 6 с; Титан — охота (${n} ходов), скиллы Титана; снова маг — панель Титана в меню, бот ждёт`);
  } catch (e) { console.error('DIAG E', { acts: h.S.acts.slice(-30).join(','), url: h.game.url(), rt: await h.rt().then(r => ({ status: r.status, char: r.char, barCls: r.barCls, bar: r.bar, log: logText(r) })).catch(() => ({})), errors: h.errors }); throw e; }
  finally { await h.ctx.close(); }
}


// Герой с четырьмя классами (как на аккаунте из разбора лука): act — активный слот; лучник — панель и навыки Phantom Ranger.
const SLOTS = act => ({ activeSlot: act, slots: [
  { slot: 0, owned: true, active: act === 0, profession: 'dark_elf_storm_screamer', race: 'DarkElf', level: 78 },
  { slot: 1, owned: true, active: act === 1, profession: 'dark_elf_spectral_master', race: 'DarkElf', level: 76 },
  { slot: 2, owned: true, active: act === 2, profession: 'orc_titan', race: 'Orc', level: 77 },
  { slot: 3, owned: true, active: act === 3, profession: 'dark_elf_phantom_ranger', race: 'DarkElf', level: 70 }] });
const ARCHER_BAR = ['double_shot', 'power_shot', 'stun_shot', 'l2_122', 'l2_77', 'l2_91', 'soul_of_sagittarius', 'vicious_stance'];
const ARCHER_NAMES = { double_shot: 'Double Shot', power_shot: 'Power Shot', stun_shot: 'Stun Shot', l2_122: 'Hex', l2_77: 'Attack Aura', l2_91: 'Defense Aura', soul_of_sagittarius: 'Soul of Sagittarius', vicious_stance: 'Vicious Stance' };
const archerOf = () => ({ l2Profession: 'dark_elf_phantom_ranger', level: 70, classSlots: SLOTS(3),
  battleHotbarSlots: [{ k: 'a', a: 'double_shot' }, { k: 'a', a: 'power_shot' }, { k: 'a', a: 'stun_shot' }, { k: 'a', a: 'attack' }, ...ARCHER_BAR.slice(3).map(a => ({ k: 'a', a })), { k: 'u', id: 1539 }],
  learnedBattleSkillsDetail: ARCHER_BAR.map(a => ({ battleId: a, nameUk: ARCHER_NAMES[a] })) });

async function scenarioF() {
  const h = await launch(), { S } = h;
  const titan = { l2Profession: 'orc_titan', level: 77, classSlots: SLOTS(2), battleHotbarSlots: S.hero.battleHotbarSlots, learnedBattleSkillsDetail: S.hero.learnedBattleSkillsDetail };
  const archer = archerOf();
  const SHOT = /^(?:double_shot|power_shot|stun_shot)$/;
  const sel = pp => pp.evaluate(() => [...document.querySelectorAll('#profs button')].map(b => [b.dataset.kind, b.classList.contains('sel'), b.querySelector('i').textContent]));
  try {
    S.champAt = 99; S.arrows = 6;
    Object.assign(S.hero, archer);
    // настройки Lite 1.4 (до профилей): место и лимит Дестра, TvT выкл.
    await h.sw.evaluate(() => chrome.storage.local.set({ 'lite.cfg': { on: false, zone: 'giran_harbor', zoneName: 'Гавань Гірана', killLimit: 7, tvt: false } }));
    await h.game.goto('https://l2wap.com/map.html');
    await until(async () => (await h.rt()).kind === 'archer' && (await h.rt()).bar?.length === 9 && (await h.rt()).locs?.length === 2, 20000, 'профиль лука и его панель в памяти');
    const pp = await h.popup();
    // меню: открыт «Лук · в игре», скиллы лука с галками по умолчанию, стрелы в сумке
    await until(() => pp.evaluate(() => document.querySelectorAll('#skills .sk').length === 8), 5000, 'скиллы лука в меню');
    assert.deepEqual(await sel(pp), [['destr', false, ''], ['archer', true, ' · в игре'], ['spoil', false, ''], ['mage', false, '']]);   // 1.6: и вкладка спойлера, 1.7 — мага
    assert.equal(await pp.evaluate(() => document.getElementById('cls').hidden), true, 'лук — не «чужой класс»');
    const rows = await pp.$$eval('#skills .sk', els => els.map(e => [e.dataset.key, e.querySelector('input').checked]));
    assert.deepEqual(rows, [['double_shot', true], ['power_shot', true], ['stun_shot', true], ['l2_122', false], ['l2_77', true], ['l2_91', true], ['soul_of_sagittarius', true], ['vicious_stance', false]]);
    assert.equal(await pp.textContent('#arw'), 'Стрелы: Fine Steel (C) 6');
    assert.equal(await pp.inputValue('#limit'), '0', 'у лука свой лимит (умолчание)');
    await pp.fill('#limit', '3'); await pp.dispatchEvent('#limit', 'change');
    // вкладка Дестра: старые настройки 1.4 — его; лимит 4 пишется в его профиль
    await pp.click('#profs button[data-kind="destr"]');
    await until(async () => (await sel(pp))[0][1] === true, 3000, 'вкладка Дестра');
    assert.equal(await pp.inputValue('#limit'), '7'); assert.equal(await pp.inputValue('#zone'), 'giran_harbor'); assert.equal(await pp.isChecked('#tvt'), false);
    assert.match(await pp.textContent('#profNote'), /бот возьмёт его сам, когда в игре станет активен Дестр\/Титан/);
    assert.match(await pp.textContent('#skills'), /когда в игре будет активен Дестр\/Титан/);
    assert.equal(await pp.isVisible('#arw'), false);
    await pp.fill('#limit', '4'); await pp.dispatchEvent('#limit', 'change');
    await until(async () => (await h.cfg()).p?.destr?.killLimit === 4 && (await h.cfg()).p?.archer?.killLimit === 3, 5000, 'лимиты в своих профилях');
    assert.equal((await h.cfg()).killLimit, 7, 'старое поле не тронуто');
    await pp.click('#profs button[data-kind="archer"]');
    await until(async () => (await pp.inputValue('#limit')) === '3', 3000, 'вкладка лука');
    await pp.click('#run');
    await until(async () => (await h.cfg()).on === true, 5000, 'Старт');
    await h.game.bringToFront();
    // лук: баффы и выстрелы; 6 стрел кончаются — отказ сервера → выход из боя → ожидание (новых боёв нет)
    await until(async () => (await h.rt()).arrowOut, 60000, 'стрелы кончились');
    await until(async () => /Нет стрел/.test((await h.rt()).status || ''), 20000, 'статус «нет стрел»');
    const sp = S.spawnN, a0 = S.acts.length;
    await delay(4000);
    assert.equal(S.spawnN, sp, 'без стрел начал бой'); assert.ok(S.acts.length - a0 <= 1, 'без стрел ходы: ' + S.acts.slice(a0).join(','));
    assert.ok(!S.hero.inBattle, 'вышел из боя');
    await until(() => pp.evaluate(() => /Нет стрел/.test(document.getElementById('arw').textContent)), 5000, 'меню: нет стрел');
    // 1.5.1 (John: «сообщение большое с возможностью его закрыть СТРЕЛ НЕТ. красным текстом на белом фоне»)
    const box = await until(async () => { const b = await arwBox(h.game); return b?.shown ? b : null; }, 8000, 'окно «СТРЕЛ НЕТ»');
    if (process.env.LITE_SHOT) await h.game.screenshot({ path: process.env.LITE_SHOT });
    assert.match(box.text, /СТРЕЛ НЕТ/); assert.equal(box.bg, 'rgb(255, 255, 255)'); assert.equal(box.color, 'rgb(209, 0, 0)'); assert.ok(box.size >= 40, 'крупно: ' + box.size);
    await arwClose(h.game);
    await until(async () => !(await arwBox(h.game)).shown, 3000, 'окно закрыто');
    await delay(2500);
    assert.equal((await arwBox(h.game)).shown, false, 'закрытое окно вернулось, хотя стрел всё ещё нет');
    const r1 = await h.rt();
    assert.match(logText(r1), /сервер не дал выстрелить: «battle_no_arrows»/);
    assert.match(logText(r1), /нет стрел — охоту остановил/);
    // стрелы появились в сумке — охота до 3 мобов лука
    S.arrows = 500;
    let fastMax = 0;                                // счётчик быстрых ответов живёт на странице боя (цепочка — та же страница)
    await until(async () => { fastMax = Math.max(fastMax, +(await h.game.evaluate(() => document.documentElement.dataset.l2liteFastN || 0).catch(() => 0))); return (await h.rt()).k?.kills >= 3; }, 90000, '3 моба лука');
    await until(async () => /Цель выполнена: убито 3 из 3/.test((await h.rt()).status || ''), 20000, 'лимит лука');
    const archerActs = S.acts.slice();
    for (const a of ['double_shot', 'power_shot', 'stun_shot', 'soul_of_sagittarius', 'l2_77', 'l2_91']) assert.ok(archerActs.includes(a), a + ': ' + archerActs.join(','));
    assert.ok(!archerActs.some(a => /^(?:l2_122|vicious_stance|l2_190)$/.test(a)), 'Hex/стойка/удар Дестра: ' + archerActs.join(','));
    assert.ok(fastMax >= 3, 'быстрых ответов ' + fastMax);
    const r2 = await h.rt();
    assert.match(logText(r2), /стрелы есть \(500\) — продолжаю охоту/);
    assert.equal((await arwBox(h.game)).shown, false, 'окно «СТРЕЛ НЕТ» при стрелах');
    assert.equal(r2.k.kills, 3);
    // в игре переключили на Титана: профиль Дестра — свой лимит 4 и место, Fatal Strike, выстрелов нет
    const n1 = S.acts.length;
    Object.assign(S.hero, titan);
    await until(async () => (await h.rt()).kind === 'destr', 15000, 'профиль Дестра');
    await until(async () => (await h.rt()).k?.kills >= 4 && /Цель выполнена: убито 4 из 4/.test((await h.rt()).status || ''), 90000, '4 моба Дестра');
    const destrActs = S.acts.slice(n1);
    assert.ok(destrActs.includes('l2_190') && !destrActs.some(a => SHOT.test(a)), 'ходы Дестра: ' + destrActs.join(','));
    const r3 = await h.rt();
    assert.match(logText(r3), /в игре Orc Titan \(Dstr\) — профиль «Дестр» вместо «Лук»: место охоты «Гавань Гірана», цель 4 мобов \(убито 0\)/);
    assert.equal(r3.by.archer.kills, 3); assert.equal(r3.by.archer.bar.length, 9); assert.equal(r3.barCls, 'orc_titan');
    // меню само перешло на Дестра; во вкладке лука — его 3 из 3 и его скиллы
    await until(async () => JSON.stringify(await sel(pp)) === JSON.stringify([['destr', true, ' · в игре'], ['archer', false, ''], ['spoil', false, ''], ['mage', false, '']]), 5000, 'меню: Дестр в игре');
    await until(async () => (await pp.textContent('#kills')) === '4 / 4 ✔', 5000, 'счётчик Дестра');
    await pp.click('#profs button[data-kind="archer"]');
    await until(async () => (await pp.textContent('#kills')) === '3 / 3 ✔', 3000, 'счётчик лука');
    assert.equal(await pp.$$eval('#skills .sk', els => els.length), 8);
    assert.match(await pp.textContent('#profNote'), /Профиль лука — бот возьмёт его сам/);
    await pp.click('#profs button[data-kind="destr"]');
    // снова лук: его цель уже выполнена — бот стоит
    Object.assign(S.hero, archer);
    await until(async () => (await h.rt()).kind === 'archer', 15000, 'снова профиль лука');
    await until(async () => /Цель выполнена: убито 3 из 3/.test((await h.rt()).status || ''), 15000, 'лимит лука держится');
    const n2 = S.acts.length, s2 = S.spawnN;
    await delay(4000);
    assert.equal(S.spawnN, s2); assert.ok(S.acts.length - n2 <= 1);
    await until(async () => (await sel(pp))[1][1] === true, 5000, 'меню снова на луке');
    await pp.click('#run'); await until(async () => (await h.cfg()).on === false, 5000, 'Стоп');
    assert.deepEqual(h.errors, []);
    if (process.env.LITE_LOG) console.log(logText(await h.rt()), '\nходы:', S.acts.join(','));
    console.log(`PASS F: лук (Phantom Ranger) — вкладки профилей, свои лимиты (3 у лука, 4 у Дестра из настроек 1.4), выстрелы/баффы (${archerActs.length} ходов), Hex и стойка не жмутся; стрелы кончились — выход из боя и ожидание, появились — охота до 3; Титан — профиль Дестра до 4; снова лук — стоит`);
  } catch (e) { console.error('DIAG F', { acts: h.S.acts.slice(-40).join(','), arrows: S.arrows, url: h.game.url(), rt: await h.rt().then(r => ({ status: r.status, kind: r.kind, k: r.k, by: r.by, arrowOut: r.arrowOut, log: logText(r) })).catch(() => ({})), errors: h.errors }); throw e; }
  finally { await h.ctx.close(); }
}

// Сценарий G (Lite 1.5.1, журналы John 21.10 19:55–20:05: «Vicious Stance то включает то выключает туда сюда»,
// «привел куда надо мне, не бьет мобов»). Лук, стойка включена галкой, место — «где стоит герой».
// 1) Старт, когда герой уже в долгом бою: место охоты запоминается сразу (1.5 ждал конца боя, а цепочка его не давала).
// 2) Стойку игра нигде не показывает (ни toggleStances, ни баффы): за всю охоту — одно нажатие (1.5 жал её снова и снова).
// 3) Полоска HP моба на 2 с пропала на странице боя, открытой дольше 15 с: бот не уходит на карту (1.5 уходил сразу).
// 4) Стойка видна в баффах героя, игра её сняла — бот включает снова (одно нажатие).
// 5) Сервер принимает нажатие, но стойка не включается (список игры: active:false) — после двух нажатий подряд пауза 30 мин.
// Всё время: откат выстрела сервер присылает под номером игры (l2_56…), на панели его не видно — бот не жмёт выстрел раньше времени.
async function scenarioG() {
  const h = await launch(), { S } = h;
  const presses = () => (S.stanceT || []).length;          // принятые сервером нажатия стойки (отказ по откату — не нажатие)
  try {
    S.champAt = 99; S.arrows = 5000; S.stance = false; S.stanceReport = 'none';
    Object.assign(S.hero, archerOf());
    await h.sw.evaluate(() => chrome.storage.local.set({ 'lite.cfg': { on: false, tvt: false, p: { archer: { killLimit: 0, tvt: false, skills: { vicious_stance: { on: true } } } } } }));
    // герой уже бьётся с толстым мобом (игрок сам начал бой), бот выключен
    S.mobHp = 80000; await h.sv.api('/game/battle/start', 'POST', { spawnId: 'g1' }); S.mobHp = 4000;
    await h.game.goto('https://l2wap.com/battle.html?spawnId=g1');
    await until(async () => (await h.rt()).kind === 'archer' && (await h.rt()).bar?.length === 9, 20000, 'профиль лука');
    const k0 = S.hero.mobsKilled, tStart = Date.now();
    await h.sw.evaluate(() => chrome.storage.local.set({ 'lite.cfg': { on: true, tvt: false, p: { archer: { killLimit: 0, tvt: false, skills: { vicious_stance: { on: true } } } } },
      'lite.cmd': { id: 'g-start', type: 'start', kind: 'archer', t: Date.now() } }));
    await until(async () => (await h.rt()).zone?.id === 'giran_harbor', 5000, 'место охоты запомнено при Старте');
    assert.ok(S.hero.inBattle && S.hero.mobsKilled === k0, 'место запомнено ещё в первом бою');
    const zl = (await h.rt()).log.find(x => /место охоты — где стоит герой: «Гавань Гірана»/.test(x.x));
    assert.ok(zl && zl.t - tStart < 5000, 'строка о месте охоты');
    S.battle.mobHp = Math.min(S.battle.mobHp, 3000);       // первый бой — к концу, дальше обычные мобы цепочкой
    // (2) охота цепочкой; страница боя та же — ждём, пока ей станет больше 16 с
    await until(async () => S.hero.mobsKilled >= k0 + 4 && Date.now() - tStart > 17000, 60000, 'охота цепочкой 17 с');
    assert.equal(presses(), 1, 'стойку жал ' + presses() + ' раз: ' + S.acts.join(','));
    assert.equal(S.stance, true, 'стойка включена');
    // (3) полоска HP моба на 2 с пропала — бот ждёт, а не уходит на карту
    const leaves0 = S.leaves, url0 = h.game.url();
    await h.game.evaluate(() => { const el = document.querySelector('#battle-mob-hp-val'), v = el.textContent; el.textContent = ''; setTimeout(() => { if (!el.textContent) el.textContent = v; }, 2000); });
    const k1 = S.hero.mobsKilled;
    await until(() => S.hero.mobsKilled >= k1 + 2, 30000, 'охота после пропажи полоски HP');
    assert.equal(S.leaves, leaves0, 'вышел из боя'); assert.equal(h.game.url(), url0, 'ушёл со страницы боя');
    assert.doesNotMatch(logText(await h.rt()), /страница боя без моба/);
    assert.equal(presses(), 1, 'стойку жал повторно: ' + presses());
    // (4) игра показывает стойку в баффах; потом сняла её — бот включает снова одним нажатием
    S.stanceReport = 'buff'; S.phaseT = [['buff', Date.now() % 100000]];
    await delay(3500);
    S.stance = false; S.phaseT.push(['off', Date.now() % 100000]);
    await until(() => presses() === 2 && S.stance === true, 20000, 'стойку включил снова');
    const k2 = S.hero.mobsKilled;
    await until(() => S.hero.mobsKilled >= k2 + 3, 30000, 'охота со стойкой');
    assert.equal(presses(), 2, 'лишние нажатия стойки: ' + presses());
    // (5) нажатие проходит, а стойка не включается — третьего нажатия нет, пауза 30 мин
    S.stanceReport = 'list'; S.stanceStuck = true; S.stance = false;
    await until(async () => /Vicious Stance: включал дважды, а игра снова показывает стойку выключенной — 30 мин её не трогаю/.test(logText(await h.rt())), 20000, 'пауза стойки');
    const k3 = S.hero.mobsKilled;
    await until(() => S.hero.mobsKilled >= k3 + 3, 30000, 'охота без стойки');
    assert.equal(presses(), 2, 'стойку жал после паузы: ' + presses());
    assert.ok((S.shotRej || 0) <= 2, 'выстрелов раньше отката: ' + S.shotRej);
    // (6) стрелы кончились (стопка исчезла из сумки) — окно «СТРЕЛ НЕТ»; закрыли (крестиком), положили стрелы — охота; кончились снова — окно опять
    for (const round of [1, 2]) {
      S.arrows = 0;
      await until(async () => (await arwBox(h.game))?.shown, 20000, 'окно «СТРЕЛ НЕТ», раз ' + round);
      await arwClose(h.game, round === 1 ? '.x' : '.ok');
      await until(async () => !(await arwBox(h.game)).shown, 3000, 'окно закрыто, раз ' + round);
      S.arrows = 300; const kr = S.hero.mobsKilled;
      await until(() => S.hero.mobsKilled >= kr + 2, 40000, 'охота со стрелами, раз ' + round);
    }
    assert.equal((logText(await h.rt()).match(/нет стрел — охоту остановил/g) || []).length, 2, 'журнал: оба раза без стрел');
    for (const a of ['double_shot', 'power_shot', 'stun_shot']) assert.ok(S.acts.includes(a), a);
    await h.sw.evaluate(() => chrome.storage.local.get('lite.cfg').then(o => chrome.storage.local.set({ 'lite.cfg': { ...o['lite.cfg'], on: false } })));
    await until(async () => /■ Стоп/.test(logText(await h.rt())), 5000, 'Стоп');
    const txt = logText(await h.rt());
    assert.equal((txt.match(/Vicious Stance: стойку включил/g) || []).length, 2, txt);
    assert.deepEqual(h.errors, []);
    if (process.env.LITE_LOG) console.log(txt, '\nходы:', S.acts.join(','));
    console.log(`PASS G: Старт в долгом бою — место охоты запомнено сразу; выстрелов раньше отката: ${S.shotRej || 0}; стрелы кончились дважды — оба раза окно «СТРЕЛ НЕТ», закрывается; стойку, которую игра не показывает, жал 1 раз за ${S.hero.mobsKilled - k0} мобов; полоска HP пропала на 2 с — бой продолжен; игра сняла стойку — включил снова; не включается — после 2 нажатий пауза 30 мин`);
  } catch (e) { console.error('DIAG G', { acts: h.S.acts.slice(-40).join(','), stance: S.stance, presses: presses(), stanceT: JSON.stringify(S.stanceT), stanceAll: JSON.stringify(S.stanceAll), phaseT: JSON.stringify(S.phaseT), url: h.game.url(), rt: await h.rt().then(r => ({ status: r.status, kind: r.kind, zone: r.zone, k: r.k, log: logText(r) })).catch(() => ({})), errors: h.errors }); throw e; }
  finally { await h.ctx.close(); }
}

// Сценарий H (Lite 1.6): спойлер — вкладка «⛏ Споил», места под ресурс, порядок спойла по оружию, добыча, Sweeper не жмётся.
const BH_BAR = ['l2_254', 'l2_302', 'l2_348', 'l2_36', 'l2_42'];
const BH_NAMES = { l2_254: 'Spoil', l2_302: 'Spoil Festival', l2_348: 'Spoil Crush', l2_36: 'Whirlwind', l2_42: 'Sweeper' };
async function scenarioH() {
  const h = await launch(), { S } = h;
  const sel = pp => pp.evaluate(() => [...document.querySelectorAll('#profs button')].map(b => [b.dataset.kind, b.classList.contains('sel'), b.querySelector('i').textContent]));
  const SP = /^(?:l2_254|l2_302|l2_348)$/;
  const first = d => d.acts.find(a => a !== 'battle_potion_use');
  try {
    S.champAt = 99; S.weapon = 15; S.mobHp = 6000;                    // пика (Short Spear): Spoil Crush игра не даёт
    Object.assign(S.hero, { l2Profession: 'dwarf_bounty_hunter', level: 70, classSlots: { activeSlot: 1, slots: [
      { slot: 0, owned: true, active: false, profession: 'orc_titan', race: 'Orc', level: 76 },
      { slot: 1, owned: true, active: true, profession: 'dwarf_bounty_hunter', race: 'Dwarf', level: 70 }] },
      battleHotbarSlots: [{ k: 'a', a: 'attack' }, ...BH_BAR.map(a => ({ k: 'a', a })), { k: 'u', id: 1539 }],
      learnedBattleSkillsDetail: BH_BAR.map(a => ({ battleId: a, nameUk: BH_NAMES[a] })) });
    await h.sw.evaluate(() => chrome.storage.local.set({ 'lite.cfg': { on: false, tvt: false, p: { spoil: { tvt: false, killLimit: 0, spoilRes: 'Mithril Ore' } } } }));
    await h.game.goto('https://l2wap.com/map.html');
    await until(async () => (await h.rt()).kind === 'spoil' && (await h.rt()).locs?.length === 2, 20000, 'профиль спойлера');
    const pp = await h.popup();
    // меню: открыт «Споил · в игре», скиллы БХ (Sweeper без галки), раздел спойла с ресурсом и местом под него
    await until(() => pp.evaluate(() => document.querySelectorAll('#skills .sk').length === 5), 8000, 'скиллы спойлера в меню');
    assert.deepEqual(await sel(pp), [['destr', false, ''], ['archer', false, ''], ['spoil', true, ' · в игре'], ['mage', false, '']]);
    assert.equal(await pp.evaluate(() => document.getElementById('cls').hidden), true, 'спойлер — не «чужой класс»');
    const rows = await pp.$$eval('#skills .sk', els => els.map(e => [e.dataset.key, e.querySelector('input').checked, e.querySelector('select').value]));
    assert.deepEqual(rows, [['l2_254', true, 'spoil'], ['l2_302', true, 'spoil'], ['l2_348', true, 'spoil'], ['l2_36', true, 'attack'], ['l2_42', false, 'other']]);
    assert.equal(await pp.isVisible('#spoilBox'), true);
    assert.equal(await pp.inputValue('#spoilRes'), 'Mithril Ore');
    assert.equal(await pp.isChecked('#spoilOn'), true); assert.equal(await pp.inputValue('#spoilTries'), '4');
    await until(async () => /Кузня богів \(70–80\) · до 47 %/.test(await pp.textContent('#spoilSpots')), 5000, 'место под Mithril Ore');
    assert.doesNotMatch(await pp.textContent('#spoilSpots'), /Гавань Гірана/, 'гавань (25–51) — не для 70 ур.');
    await pp.click('#spoilSpots button[data-id="forge_gods"]');
    await until(async () => (await h.pcfg('spoil')).zone === 'forge_gods', 3000, 'место из списка → место охоты');
    await until(async () => /✔ Кузня богів/.test(await pp.textContent('#spoilSpots')), 3000, 'место отмечено');
    await pp.selectOption('#zone', 'giran_harbor');                     // охотимся в гавани (мобы модели — только там)
    await until(async () => (await h.pcfg('spoil')).zone === 'giran_harbor', 3000, 'место — гавань');
    await pp.click('#run');
    await until(async () => (await h.cfg()).on === true, 5000, 'Старт');
    await h.game.bringToFront();
    // (1) пика: каждый бой начинается со спойла (Festival, пока он готов, иначе Spoil), Spoil Crush не жмётся, все мобы заспойлены
    await until(() => (S.done || []).length >= 4, 90000, '4 боя с пикой');
    const pole = S.done.filter(d => d.w === 15);
    for (const d of pole) { assert.match(first(d) || '', /^(?:l2_302|l2_254)$/, 'бой начат не со спойла: ' + d.acts.join(',')); assert.ok(d.spoiled, 'моб не заспойлен: ' + d.acts.join(',')); }
    assert.ok(pole.some(d => first(d) === 'l2_302'), 'ни одного Festival первым');
    assert.ok(!S.acts.includes('l2_348'), 'жал Spoil Crush с пикой');
    let r = await until(async () => { const x = await h.rt(); return x.spoil?.mobs >= 4 && x; }, 5000, 'победы в счёте спойла');   // победа учитывается после ответа
    assert.ok(r.spoil.sp === r.spoil.mobs, 'счёт: ' + JSON.stringify(r.spoil));
    assert.ok(r.spoil.items['Mithril Ore'] >= 8 && r.spoil.items.Coal >= 4, 'добыча: ' + JSON.stringify(r.spoil.items));
    assert.ok(r.spoil.mass >= 1 && r.spoil.massOk >= 1);
    assert.match(logText(r), /Spoil Festival: Grave Robber ✅ 100%/);
    await until(async () => /Заспойлено \d+ из \d+ мобов \(100 %\)/.test(await pp.textContent('#spoilStat')) && /Добыча: Mithril Ore \d+, Coal \d+/.test(await pp.textContent('#spoilStat')), 5000, 'счёт в меню');
    // (2) Festival промахнулся, первый Spoil не прошёл — Spoil ещё раз (HP моба выше 30 %)
    S.festFail = true; S.spoilSeq = [false, true];
    const n1 = S.done.length;
    await until(() => S.done.length >= n1 + 3 && !S.spoilSeq.length, 60000, 'бои с промахом Festival');
    const miss = S.done.slice(n1).find(d => d.acts.filter(a => a === 'l2_254').length >= 2);
    assert.ok(miss && miss.spoiled, 'повтор Spoil после промаха: ' + S.done.slice(n1).map(d => d.acts.join(',')).join(' | '));
    r = await h.rt();
    assert.ok(r.spoil.fail >= 1 && r.spoil.massFail >= 1, 'счёт промахов: ' + JSON.stringify(r.spoil));
    S.festFail = false;
    // (3) надели дубину (Club): Whirlwind игра не даёт — один отказ и пауза; бой начинается со Spoil Crush
    S.weapon = 4; S.refused = [];
    const n2 = S.done.length;
    await until(() => S.done.filter((d, i) => i >= n2 && d.w === 4).length >= 4, 90000, '4 боя с дубиной');
    const blunt = S.done.slice(n2).filter(d => d.w === 4);
    assert.ok(blunt.some(d => first(d) === 'l2_348'), 'Spoil Crush первым — ни разу: ' + blunt.map(d => d.acts.join(',')).join(' | '));
    for (const d of blunt.slice(1)) { assert.match(first(d) || '', SP, 'бой с дубиной начат не со спойла: ' + d.acts.join(',')); assert.ok(d.spoiled); }
    assert.ok(!S.refused.includes('l2_348'), 'Spoil Crush с дубиной отказан');
    assert.equal(S.refused.filter(a => a === 'l2_36').length, 1, 'Whirlwind жал после отказа: ' + S.refused.join(','));
    assert.match(logText(await h.rt()), /Whirlwind: игра не даёт \(battle_skill_not_allowed\) — 5 мин не жму \(приём под другое оружие\)/);
    assert.ok(!S.acts.includes('l2_42'), 'жал Sweeper');
    // (4) «Сбросить счёт» — с нуля
    const tR = Date.now();
    await pp.click('#spoilReset');
    await until(async () => (await h.rt()).spoil?.t0 >= tR && /счёт спойла сброшен/.test(logText(await h.rt())), 5000, 'сброс счёта');
    assert.ok(((await h.rt()).spoil.mobs || 0) <= 1);
    await pp.click('#run'); await until(async () => (await h.cfg()).on === false, 5000, 'Стоп');
    assert.deepEqual(h.errors, []);
    if (process.env.LITE_LOG) console.log(logText(await h.rt()), '\nходы:', S.acts.join(','));
    const sum = r.spoil;
    console.log(`PASS H: спойлер — вкладка «Споил · в игре», место под Mithril Ore «Кузня богів · до 47 %»; пика: ${pole.length} боёв начаты со спойла (Festival первым ${pole.filter(d => first(d) === 'l2_302').length}), Spoil Crush/Sweeper не жал; промах Festival → Spoil ×2; дубина: Crush первым, Whirlwind — 1 отказ и пауза; добыча Mithril Ore ${sum.items['Mithril Ore']}, Coal ${sum.items.Coal}; сброс счёта`);
  } catch (e) { console.error('DIAG H', { acts: h.S.acts.slice(-40).join(','), done: JSON.stringify((S.done || []).slice(-6)), refused: S.refused, url: h.game.url(), rt: await h.rt().then(r => ({ status: r.status, kind: r.kind, zone: r.zone, spoil: r.spoil, spoilW: r.spoilW, log: logText(r) })).catch(() => ({})), errors: h.errors }); throw e; }
  finally { await h.ctx.close(); }
}

// 1.7: маг в Ashen Bastion (живой список 24.10, HP ÷ 100: соседи — Dark Reaper 2674 и Infernal Knight 2663)
const ASH = [['Dark Reaper', 2674], ['Infernal Knight', 2663], ['Cursed Warlock', 2696], ['Abyss Walker', 2685], ['Doom Bringer', 2631], ['Ashen Guardian', 2620],
  ['Dark Reaper', 2652], ['Infernal Knight', 2642], ['Abyss Walker', 2587], ['Ashen Guardian', 2576], ['Cursed Warlock', 3925], ['Abyss Walker', 3935]]
  .map(([name, maxHp], i) => ({ id: 'ashen_bastion_mob_' + String(i + 1).padStart(3, '0'), name, maxHp, exp: 540 }));
const MAGE_BAR = ['l2_1176', 'l2_1181', 'l2_1292', 'l2_337'];
async function scenarioI() {
  const h = await launch(), { S } = h;
  const sel = pp => pp.evaluate(() => [...document.querySelectorAll('#profs button')].map(b => [b.dataset.kind, b.classList.contains('sel'), b.querySelector('i').textContent]));
  try {
    S.ash = ASH.map(m => ({ ...m })); S.ashDead = {};
    S.locations.push({ teleportId: 'ashen_bastion', labelUk: 'Ashen Bastion', adenaCost: 0, mobLevelMin: null, mobLevelMax: null });
    Object.assign(S.hero, { l2Profession: 'dark_elf_storm_screamer', level: 78, currentZoneId: 'ashen_bastion', currentZoneNameUk: 'Ashen Bastion', locationType: 'zone',
      mp: 6000, maxMp: 6000, toggleStances: [{ battleId: 'l2_337', skillId: 337, level: 1, active: false }],
      classSlots: { activeSlot: 0, slots: [{ slot: 0, owned: true, active: true, profession: 'dark_elf_storm_screamer', race: 'Dark Elf', level: 78 },
        { slot: 2, owned: true, active: false, profession: 'orc_titan', race: 'Orc', level: 77 }] },
      battleHotbarSlots: [{ k: 'a', a: 'attack' }, ...MAGE_BAR.map(a => ({ k: 'a', a }))],
      learnedBattleSkillsDetail: MAGE_BAR.map(a => ({ battleId: a, nameUk: TITLES[a].split(' — ')[0] })) });
    await h.sw.evaluate(() => chrome.storage.local.set({ 'lite.cfg': { on: false, p: { mage: { tvt: false, killLimit: 9 } } } }));
    await h.game.goto('https://l2wap.com/ashen-bastion.html');
    await until(async () => (await h.rt()).kind === 'mage' && (await h.rt()).bar?.length >= 4, 20000, 'профиль мага и панель');
    const pp = await h.popup();
    await until(() => pp.evaluate(() => document.querySelectorAll('#skills .sk').length === 4), 8000, 'скиллы мага в меню');
    assert.deepEqual(await sel(pp), [['destr', false, ''], ['archer', false, ''], ['spoil', false, ''], ['mage', true, ' · в игре']]);
    assert.equal(await pp.evaluate(() => document.getElementById('cls').hidden), true, 'маг — не «чужой класс»');
    const rows = await pp.$$eval('#skills .sk', els => els.map(e => [e.dataset.key, e.querySelector('input').checked, e.querySelector('select').value]));
    assert.deepEqual(rows, [['l2_1176', true, 'aoe'], ['l2_1181', true, 'aoe'], ['l2_1292', true, 'attack'], ['l2_337', true, 'toggle']]);
    assert.equal(await pp.isVisible('#mageBox'), true);
    assert.match(await pp.textContent('#mageEx'), /узнает в первом бою/);
    assert.equal(await pp.inputValue('#limit'), '9');
    await pp.click('#run');
    await until(async () => (await h.cfg()).on === true, 5000, 'Старт');
    await h.game.bringToFront();
    await until(async () => (await h.rt()).k?.kills >= 9, 120000, '9 убитых');
    await until(async () => /Цель выполнена/.test((await h.rt()).status || ''), 20000, 'цель выполнена');
    const r = await h.rt();
    // первый бой — самый толстый (соседи не известны), дальше — не тоньше соседей; три убийства за каждый бой
    assert.equal(S.ashStarts[0], 'ashen_bastion_mob_012', 'первый главный: ' + S.ashStarts.join(','));
    for (const id of S.ashStarts.slice(1)) assert.ok(ASH.find(m => m.id === id).maxHp >= 2674 && !/_00[12]$/.test(id), 'главный тоньше соседей или сам сосед: ' + S.ashStarts.join(','));
    assert.equal(S.ashStarts[1], 'ashen_bastion_mob_004', 'лучший главный — самый тонкий из не тоньше соседей (EXP одинаковый)');
    assert.equal(S.done.length, 3, 'боёв: ' + S.done.length); assert.equal(S.exKills, 6, 'соседей убито: ' + S.exKills);
    assert.equal(S.chainN, 0, 'жал «Охотиться дальше» в Ashen');
    assert.ok(S.ashGet >= 2, 'следующий главный — своим GET списка');
    // Elemental Crash — только когда соседи толще главного (иначе обогнал бы их); обычной атакой маг не бьёт
    for (const c of S.crash || []) assert.ok(c.ex.some(x => x > c.main), 'Crash при соседях не толще главного: ' + JSON.stringify(c));
    assert.ok(!S.acts.includes('attack'), 'маг жал обычную атаку');
    assert.equal(S.apN, 1, 'Arcane Power — один раз');
    assert.deepEqual(r.aoeEx.ashen_bastion.list, [{ name: 'Dark Reaper', maxHp: 2674 }, { name: 'Infernal Knight', maxHp: 2663 }]);
    assert.match(logText(r), /массовый удар задевает ещё 2: Dark Reaper \(HP 2674\), Infernal Knight \(HP 2663\) — в Ashen беру цель не тоньше их/);
    assert.match(logText(r), /Ashen: после победы — следующий главный из списка, не «Охотиться дальше»/);
    await until(async () => /Соседи в Ashen: Dark Reaper \(HP 2674\), Infernal Knight \(HP 2663\) — цель беру с HP не меньше 2674/.test(await pp.textContent('#mageEx')), 5000, 'соседи в меню');
    await pp.click('#run'); await until(async () => (await h.cfg()).on === false, 5000, 'Стоп');
    assert.deepEqual(h.errors, []);
    if (process.env.LITE_LOG) console.log(logText(r), '\nходы:', S.acts.join(','));
    console.log(`PASS I: маг в Ashen — вкладка «Маг · в игре», 3 боя (${S.ashStarts.join(', ')}), по 3 убийства за бой (соседей ${S.exKills}), «Охотиться дальше» не жал, Arcane Power — 1 раз, Crash ${(S.crash || []).length} раз при соседях толще главного; соседи в меню`);
  } catch (e) { console.error('DIAG I', { acts: S.acts.slice(-40).join(','), starts: S.ashStarts, done: JSON.stringify((S.done || []).slice(-4)), url: h.game.url(), rt: await h.rt().then(r => ({ status: r.status, kind: r.kind, zone: r.zone, k: r.k, aoeEx: r.aoeEx, log: logText(r) })).catch(() => ({})), errors: h.errors }); throw e; }
  finally { await h.ctx.close(); }
}

// LITE_ONLY=AC — только эти сценарии
const ONLY = process.env.LITE_ONLY || 'ABCDEFGHI';
(async () => { if (ONLY.includes('A')) await scenarioA(); if (ONLY.includes('B')) await scenarioB(); if (ONLY.includes('C')) await scenarioC(); if (ONLY.includes('D')) await scenarioD(); if (ONLY.includes('E')) await scenarioE(); if (ONLY.includes('F')) await scenarioF(); if (ONLY.includes('G')) await scenarioG(); if (ONLY.includes('H')) await scenarioH(); if (ONLY.includes('I')) await scenarioI(); })().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
