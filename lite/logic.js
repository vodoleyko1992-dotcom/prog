// ===== L2wap Lite — чистая логика (без страницы и без хранилища; её проверяют Node-тесты tests/lite-*.test.js) =====
// 20.10.2026, тред «Упрошенка под Дестра»: облегчённый автономный бот для Destroyer/Titan — фарм в выбранной локации до N мобов,
// TvT по расписанию, возврат на место охоты, свои скиллы. Здесь: таблица скиллов воина-орка, выбор хода в бою, решения TvT,
// счётчик убитых мобов по серверному character.mobsKilled, выбор моба на карте, цена телепорта.
// Lite 1.5 (21.10, John: «это дестр, есть сабкласс Лука, хотим бота и Луку научить», «отдельный профиль на дестра, отдельный
// профиль на лука»): лучники (Hawkeye/Sagittarius, Silver Ranger/Moonlight Sentinel, Phantom Ranger/Ghost Sentinel) и два профиля настроек.
(function (root) {
  'use strict';

  // Скиллы воина-орка и общие воинские (Interlude, из skills-il.js основного бота; описания L2WAP местами отличаются).
  // [имя, тип, сила (для порядка ударов), MP на макс. ранге, цена в HP, откат с, длительность с].
  // Тип: attack — удар; buff — бафф на себя; lowhp — бафф только при HP ≤ 30 % (Frenzy/Guts/Zealot); heal — лечение себя;
  // toggle — стойка (вкл./выкл. одним нажатием); other — по умолчанию не жмём (агро, дебафф вокруг себя, урон по CP).
  const SK = {
    3: ['Power Strike', 'attack', 70, 19, 0, 13, 0], 36: ['Whirlwind', 'attack', 2283, 83, 0, 17, 0],
    48: ['Thunder Storm', 'attack', 1735, 113, 0, 20, 5], 75: ['Detect Insect Weakness', 'buff', 0, 14, 0, 10, 600],
    78: ['War Cry', 'buff', 0, 19, 0, 180, 60], 87: ['Detect Animal Weakness', 'buff', 0, 18, 0, 10, 600],
    94: ['Rage', 'buff', 0, 25, 0, 300, 90], 100: ['Stun Attack', 'attack', 109, 34, 0, 13, 9],
    104: ['Detect Plant Weakness', 'buff', 0, 21, 0, 10, 600], 116: ['Howl', 'other', 40, 53, 0, 8, 15],
    121: ['Battle Roar', 'heal', 26, 33, 0, 600, 600], 130: ['Thrill Fight', 'buff', 0, 25, 0, 10, 300],
    139: ['Guts', 'lowhp', 0, 24, 0, 600, 90], 176: ['Frenzy', 'lowhp', 0, 25, 0, 600, 90],
    190: ['Fatal Strike', 'attack', 3044, 83, 0, 12, 0], 245: ['Wild Sweep', 'attack', 326, 37, 0, 17, 0],
    255: ['Power Smash', 'attack', 326, 37, 0, 13, 0], 260: ['Hammer Crush', 'attack', 2009, 76, 0, 13, 5],
    286: ['Provoke', 'other', 500, 89, 0, 15, 0], 287: ['Lionheart', 'buff', 0, 29, 0, 900, 60],
    312: ['Vicious Stance', 'toggle', 0, 0, 0, 0, 5], 315: ['Crush of Doom', 'attack', 7635, 0, 290, 26, 0],
    317: ['Focus Attack', 'buff', 0, 34, 0, 270, 120], 320: ['Wrath', 'other', 1, 83, 0, 120, 0],
    347: ['Earthquake', 'attack', 4040, 87, 340, 30, 1], 361: ['Shock Blast', 'attack', 2486, 53, 507, 30, 5],
    362: ['Armor Crush', 'attack', 3077, 35, 338, 15, 9], 396: ['Heroic Berserker', 'buff', 0, 72, 0, 1200, 120],
    420: ['Zealot', 'lowhp', 0, 136, 204, 900, 60], 422: ['Polearm Accuracy', 'toggle', 0, 14, 0, 0, 2],
    424: ['War Frenzy', 'toggle', 0, 0, 0, 0, 3], 440: ['Braveheart', 'heal', 1000, 57, 0, 120, 0],
    452: ['Shock Stomp', 'attack', 80, 55, 0, 13, 5], 1001: ['Soul Cry', 'toggle', 0, 0, 0, 0, 3],
    // Lite 1.5: лучник (Interlude из skills-il.js; на L2WAP номера и описания проверяет тред «Изучение лука»). Fatal Counter —
    // сила при полном HP (у L2 растёт, когда своего HP мало); Ultimate Evasion (откат 30 мин) — запас при HP ≤ 30 %.
    19: ['Double Shot', 'attack', 4870, 166, 0, 25, 0], 24: ['Burst Shot', 'attack', 1218, 249, 0, 25, 0],
    56: ['Power Shot', 'attack', 865, 74, 0, 25, 0], 101: ['Stunning Shot', 'attack', 2192, 117, 0, 10, 9],
    314: ['Fatal Counter', 'attack', 2908, 164, 0, 20, 0], 343: ['Lethal Shot', 'attack', 5132, 170, 0, 30, 0],
    354: ['Hamstring Shot', 'attack', 1973, 86, 0, 60, 30], 369: ['Evade Shot', 'attack', 2020, 122, 0, 300, 30],
    99: ['Rapid Shot', 'buff', 0, 20, 0, 10, 1200], 112: ['Deflect Arrow', 'buff', 0, 22, 0, 10, 1200],
    131: ['Hawk Eye', 'buff', 0, 27, 0, 10, 300], 303: ['Soul of Sagittarius', 'buff', 0, 0, 364, 6, 1200],
    313: ['Snipe', 'buff', 0, 34, 0, 180, 120], 413: ['Rapid Fire', 'buff', 0, 34, 0, 180, 120],
    414: ['Dead Eye', 'buff', 0, 35, 0, 180, 120], 415: ['Spirit of Sagittarius', 'buff', 0, 34, 0, 180, 1200],
    416: ['Blessing of Sagittarius', 'buff', 0, 34, 0, 6, 1200], 111: ['Ultimate Evasion', 'lowhp', 0, 25, 0, 1800, 30],
    58: ['Elemental Heal', 'heal', 546, 191, 0, 10, 0], 256: ['Accuracy', 'toggle', 0, 1, 0, 0, 5],
    4: ['Dash', 'other', 0, 21, 0, 80, 15], 230: ['Sprint', 'other', 0, 19, 0, 10, 1200], 51: ['Lure', 'other', 500, 44, 0, 10, 0],
    102: ['Entangle', 'other', 80, 28, 0, 7, 30], 15: ['Charm', 'other', 0, 28, 0, 60, 60], 221: ['Silent Move', 'other', 0, 7, 0, 0, 3],
    417: ['Pain of Sagittarius', 'other', 46, 0, 387, 20, 0], 323: ['Quiver of Arrow: Grade A', 'other', 0, 366, 0, 1800, 0],
    324: ['Quiver of Arrow: Grade S', 'other', 0, 398, 0, 1800, 0],
    // Изученные у Phantom Ranger (тред «Изучение лука» 21.10): ауры — баффы; дебаффы, яд и смятение — по умолчанию не жмём;
    // приёмы кинжала и меча с луком не работают (WEAPON ниже), Freezing Strike — слабый маг. урон.
    77: ['Attack Aura', 'buff', 0, 10, 0, 6, 1200], 91: ['Defense Aura', 'buff', 0, 8, 0, 6, 1200],
    359: ['Eye of Hunter', 'buff', 0, 70, 0, 10, 600], 360: ['Eye of Slayer', 'buff', 0, 71, 0, 10, 600],
    2: ['Confusion', 'other', 80, 28, 0, 20, 4], 115: ['Power Break', 'other', 80, 28, 0, 8, 15], 122: ['Hex', 'other', 80, 35, 0, 6, 15],
    129: ['Poison', 'other', 70, 28, 0, 9, 3], 105: ['Freezing Strike', 'other', 65, 55, 0, 8, 30], 28: ['Aggression', 'other', 1963, 68, 0, 3, 3],
    16: ['Mortal Blow', 'attack', 977, 34, 0, 11, 0], 30: ['Backstab', 'attack', 5479, 125, 0, 11, 0], 263: ['Deadly Blow', 'attack', 5479, 75, 0, 12, 0],
    344: ['Lethal Blow', 'attack', 5773, 77, 0, 15, 0], 223: ['Sting', 'attack', 609, 83, 0, 11, 3], 96: ['Bleed', 'other', 100, 99, 0, 13, 3],
    356: ['Focus Chance', 'buff', 0, 36, 0, 120, 120], 357: ['Focus Power', 'buff', 0, 36, 0, 120, 120], 358: ['Bluff', 'other', 100, 35, 0, 30, 5],
    12: ['Switch', 'other', 80, 34, 0, 12, 1], 60: ['Fake Death', 'other', 0, 200, 0, 0, 3], 27: ['Unlock', 'other', 100, 67, 0, 120, 0],
  };
  // 1.5: оружие приёма (skills-il.js, «только: лук / кинжал / меч…»). В профиле лука приёмы ближнего боя по умолчанию не жмём,
  // в профиле Дестра — выстрелы: с чужим оружием сервер их не примет, а бот терял бы на них ходы. Галкой игрок включит сам.
  const BOW_ONLY = new Set([19, 24, 56, 101, 313, 314, 343, 354, 369, 413, 414]);
  const MELEE_ONLY = new Set([3, 12, 16, 30, 96, 223, 263, 344, 356, 357, 358]);
  // L2WAP у части воинских скиллов шлёт именованный actionId вместо l2_<id> (основной бот, NATIVE_SKILL_IL, лог 16.10 07:15).
  // 1.5: вся таблица игры L2_BATTLE_ID_TO_ACTION (battle-hotbar.js, тред «Изучение лука» 21.10; у лучника выстрелы приходят только
  // так: power_shot, double_shot, stun_shot, soul_of_sagittarius).
  const NATIVE = {
    power_strike: 3, mortal_blow: 16, power_shot: 56, double_shot: 19, burst_shot: 24, war_cry: 78, dash: 4,
    rapid_shot: 99, hawk_eye: 131, soul_of_sagittarius: 303, stun_shot: 101, snipe: 313, lethal_shot: 343, hamstring_shot: 354,
    stun_attack: 100, wild_sweep: 245, power_smash: 255, whirlwind: 36, thunder_storm: 48, provoke: 286, accuracy_stance: 256,
    vicious_stance: 312, parry_stance: 339, riposte_stance: 340, detect_insect_weakness: 75, detect_monster_weakness: 80, detect_animal_weakness: 87, detect_dragon_weakness: 88,
    detect_plant_weakness: 104, howl: 116, battle_roar: 121, thrill_fight: 130, revival: 181, lionheart: 287, focus_attack: 317,
    wrath: 320, earthquake: 347, eye_hunter: 359, eye_slayer: 360, shock_blast: 361, backstab: 30, deadly_blow_dagger: 263,
    switch_target: 12, unlock: 27, lure: 51, fake_death: 60, ultimate_evasion: 111, silent_move: 221, lethal_blow_adv: 344,
    focus_chance: 356, focus_power: 357, bluff: 358, aggression: 28, divine_heal: 45, holy_blessing: 262, sacrifice: 69,
    iron_will: 72, hate_aura: 18, remedy: 44, holy_strike: 49, drain_health: 70, majesty: 82, shield_stun: 92,
    shield_slam: 353, ultimate_defense: 110, deflect_arrow: 112, sanctuary: 97, aegis_stance: 318, horror: 65, reflect_damage: 86,
    corpse_plague: 103, hamstring_slash: 127, summon_dark_panther: 283, shield_fortress: 322, fortitude: 335, touch_of_life: 341, touch_of_death: 342,
    physical_mirror: 350, vengeance: 368, zealot: 420, triple_slash: 1, double_sonic_slash: 5, sonic_blaster: 6, sonic_storm: 7,
    sonic_focus: 8, sonic_buster: 9, fatal_strike: 190, hammer_crush: 260, triple_sonic_slash: 261, sonic_guard: 442, sonic_rage: 345,
    sonic_move: 451
  };
  const TYPES = ['attack', 'buff', 'lowhp', 'trance', 'heal', 'toggle', 'other'];
  const TYPE_RU = { attack: 'Удар', buff: 'Бафф', lowhp: 'При HP ≤ 30 %', trance: 'Транс → лимиты', heal: 'Лечение', toggle: 'Стойка', other: 'Не жать' };
  const LOW_ORDER = [176, 420, 139];              // после транса: Frenzy → Zealot → Guts (как PR #297 основного бота)

  const cleanTitle = t => String(t || '').split(/\s+[—–-]\s+|\s*\(|\n/)[0].trim();
  // Незнакомый скилл: тип по подсказке слота «Имя — описание». По умолчанию он выключен — игрок включает сам.
  function guessType(title) {
    const t = String(title || '').toLowerCase();
    if (/hp\s*(?:≤|<=|<|до)\s*30|при\s+hp|якщо\s+hp/.test(t)) return 'lowhp';
    if (/стойк|стійк|тоггл|toggle|включить и держать/.test(t)) return 'toggle';
    if (/лечит|лікує|восстан|віднов|heal/.test(t)) return 'heal';
    if (/урон|шкод|damage|удар|атак/.test(t)) return 'attack';
    if (/бафф|баф|buff|на себя|на себе|\+\d+\s*%/.test(t)) return 'buff';
    return 'attack';
  }
  function skillInfo(action, title) {
    const a = String(action || '').trim().toLowerCase(), name = cleanTitle(title);
    const base = { pow: 0, mp: 0, hp: 0, cd: 0, dur: 0 };
    if (a === 'attack') return { ...base, key: 'attack', id: null, name: name || 'Атака', type: 'basic', known: true };
    if (a === 'battle_trance' || /^battle trance(?:\s|$)/i.test(name)) return { ...base, key: a || 'battle_trance', id: null, name: name || 'Battle Trance', type: 'trance', known: true };
    const m = a.match(/^l2_(\d+)$/), id = m ? +m[1] : (Object.prototype.hasOwnProperty.call(NATIVE, a) && NATIVE[a]) || null, row = id ? SK[id] : null;
    if (row) return { key: a, id, name: name || row[0], type: row[1], pow: row[2], mp: row[3], hp: row[4], cd: row[5], dur: row[6], known: true };
    return { ...base, key: a || 'name:' + name.toLowerCase(), id, name: name || a, type: guessType(title), known: false };
  }
  // Что жмём, пока игрок сам не решил: известные удары, баффы, лимиты, транс и лечение — да; стойки и прочее — нет.
  // 1.5: kind — профиль (destr/archer): приёмы чужого оружия по умолчанию выключены.
  const offWeapon = (info, kind) => !!info && (kind === 'archer' ? MELEE_ONLY.has(info.id) : kind === 'destr' ? BOW_ONLY.has(info.id) : false);
  const defaultOn = (info, kind) => !!info && info.known && ['attack', 'buff', 'lowhp', 'trance', 'heal'].includes(info.type) && !offWeapon(info, kind);
  // Выбор игрока поверх таблицы: {on, type}. Тип «basic» (обычная атака) не меняется — она всегда запасной ход.
  function skillUse(info, choice, kind) {
    if (!info) return null;
    if (info.type === 'basic') return { ...info, on: true };
    const type = choice && TYPES.includes(choice.type) ? choice.type : info.type;
    const on = choice && typeof choice.on === 'boolean' ? choice.on : defaultOn(info, kind);
    return { ...info, type, on: on && type !== 'other' };
  }

  // Быстрый удар (Lite 1.2, порт основного бота 20.42): метку для hook.js получают только обычная атака и известный удар по цели
  // из таблицы (l2_<id> с типом attack в SK) — не банки, баффы, лимиты, транс, стойки, лечение и не скилл, которому игрок сам сменил тип.
  // 1.5: и выстрелы лучника под именем игры (power_shot = l2_56 по NATIVE) — то же правило «известный удар из таблицы».
  // Прочие именованные удары (power_smash, whirlwind у воина) — как в основном боте, без метки; hook.js пропускает только *_shot.
  const FAST_NAMED = /^[a-z]+_shot$/;
  function fastHit(s) {
    if (!s || s.pot || s.type === 'item') return false;
    if (s.type === 'basic') return s.action === 'attack';
    const a = String(s.action || ''), m = a.match(/^l2_(\d+)$/), id = m ? +m[1] : FAST_NAMED.test(a) && Object.prototype.hasOwnProperty.call(NATIVE, a) ? NATIVE[a] : null;
    const row = id ? SK[id] : null;
    return s.type === 'attack' && !!row && row[1] === 'attack';
  }
  // HP/MP героя: панель игры или ответ на ход — что свежее (Lite 1.2: после быстрого удара игра до 5 с не перечитывает персонажа,
  // и панель может отставать). hud — числа с панели, hudT — когда они в последний раз менялись, resp — {hp, maxHp, mp, maxMp, t}.
  function meMerge(hud, resp, hudT, now) {
    const h = { ...(hud || {}) };
    if (!resp || !Number.isFinite(resp.hp) || !(now - resp.t <= 4000) || resp.t < hudT) return h;
    return { hp: resp.hp, maxHp: resp.maxHp > 0 ? resp.maxHp : h.maxHp, mp: Number.isFinite(resp.mp) ? resp.mp : h.mp, maxMp: resp.maxMp > 0 ? resp.maxMp : h.maxMp };
  }

  // Банки по номеру предмета (TvT-арена подписывает их «#728 — зілля …») и по названию.
  const POT_MP = [726, 728], POT_HP = [725, 727, 1060, 1061, 1073, 1539, 1540];
  function potKind(title) {
    const t = String(title || ''), id = +((t.match(/^#(\d+)\b/) || [])[1] || 0);
    if (POT_MP.includes(id)) return 'mp';
    if (POT_HP.includes(id)) return 'hp';
    if (!/зілля|зелье|potion|банк/i.test(t)) return null;
    if (/ман[аиы]|mana|\bmp\b/i.test(t)) return 'mp';
    if (/\bhp\b|зцілен|исцелен|лікуван|лечен|healing|здоров/i.test(t)) return 'hp';
    return null;
  }

  // ---------- ход в бою ----------
  // slots: [{key, name, type ('basic'|attack|buff|lowhp|trance|heal|toggle|other), on, ready, active (бафф/стойка висит;
  //   у стойки null — состояние неизвестно), pot ('hp'|'mp'|null), qty, mp, hp, pow, id, i (порядок на панели), tvtOk}]
  // me: {hp, maxHp, mp, maxMp}; mob: {hp, maxHp} | null; opt: {now, hpPot, mpPot, lastPot: {hp, mp}, tvt}
  function planTurn(slots, me, mob, opt = {}) {
    const pct = (a, b) => (b > 0 && Number.isFinite(a) ? a * 100 / b : 100);
    const hpP = pct(me?.hp, me?.maxHp), mpKnown = Number.isFinite(me?.mp) && me?.maxMp > 0, mpP = pct(me?.mp, me?.maxMp);
    const now = opt.now || Date.now(), tvt = !!opt.tvt;
    const can = s => !!s && s.ready && s.on !== false && (s.qty == null || s.qty > 0) && (!tvt || s.tvtOk !== false);
    const mpOk = s => !(s.mp > 0) || !mpKnown || me.mp >= s.mp;
    const hpOk = s => !(s.hp > 0) || !(me?.maxHp > 0) || me.hp - s.hp > me.maxHp * 0.1;
    const potGap = k => now - ((opt.lastPot || {})[k] || 0) >= 1100;
    const pick = (slot, why) => ({ slot, why });
    const hpPot = slots.find(s => s.pot === 'hp' && can(s)), mpPot = slots.find(s => s.pot === 'mp' && can(s));
    const hpTrig = Number.isFinite(+opt.hpPot) ? +opt.hpPot : 50, mpTrig = Number.isFinite(+opt.mpPot) ? +opt.mpPot : 25;
    const lowOrd = s => { const i = LOW_ORDER.indexOf(s.id); return i < 0 ? 9 : i; };
    const lowReady = tvt ? [] : slots.filter(s => s.type === 'lowhp' && s.on && !s.active && can(s) && mpOk(s) && hpOk(s)).sort((a, b) => lowOrd(a) - lowOrd(b));
    // 1. Ниже 15 % — сначала банка, даже если лимиты готовы (основной бот: ниже 20 % аварийное восстановление раньше лимитов).
    if (hpP < 15 && hpPot && potGap('hp')) return pick(hpPot, `банка HP (HP ${Math.round(hpP)} %)`);
    // 2. HP ≤ 30 % (после транса или само) — готовые Frenzy/Zealot/Guts раньше банок: потом их не включить.
    if (hpP <= 30 && lowReady.length) return pick(lowReady[0], `лимит при HP ${Math.round(hpP)} %`);
    if (hpP <= hpTrig && hpPot && potGap('hp')) return pick(hpPot, `банка HP (HP ${Math.round(hpP)} %)`);
    if (hpP <= hpTrig) { const h = slots.find(s => s.type === 'heal' && s.on && can(s) && mpOk(s)); if (h && !tvt) return pick(h, `лечение (HP ${Math.round(hpP)} %)`); }
    if (mpKnown && mpP <= mpTrig && mpPot && potGap('mp')) return pick(mpPot, `банка MP (MP ${Math.round(mpP)} %)`);
    if (!tvt) {
      // Стойку жмём, только когда игра подтвердила, что она выключена (active === false): второе нажатие её бы сняло.
      const tg = slots.find(s => s.type === 'toggle' && s.on && s.active === false && can(s) && mpOk(s));
      if (tg) return pick(tg, 'включаю стойку');
      const bf = slots.find(s => s.type === 'buff' && s.on && !s.active && can(s) && mpOk(s) && hpOk(s));
      if (bf) return pick(bf, 'бафф');
      // Battle Trance (L2WAP: HP до 25 %) — только когда сразу после него есть что включить и хватит MP и HP на цену лимитов.
      const tr = slots.find(s => s.type === 'trance' && s.on && can(s));
      if (tr && hpP >= 50 && lowReady.length) {
        const mpNeed = lowReady.reduce((a, s) => a + (s.mp || 0), 0) + (tr.mp || 0), hpNeed = lowReady.reduce((a, s) => a + (s.hp || 0), 0);
        const after = (me?.maxHp || 0) * 0.25 - hpNeed;
        if ((!mpKnown || me.mp >= mpNeed) && (!(me?.maxHp > 0) || after > me.maxHp * 0.1)) return pick(tr, `транс → ${lowReady.map(s => s.name).join(', ')}`);
      }
    }
    const basic = slots.find(s => s.type === 'basic' && can(s));
    const mobP = mob && mob.maxHp > 0 ? pct(mob.hp, mob.maxHp) : 100;
    if (basic && mobP <= 8) return pick(basic, 'добиваю обычной атакой');
    const atk = slots.filter(s => s.type === 'attack' && s.on && can(s) && mpOk(s) && hpOk(s))
      .sort((a, b) => (b.pow || 0) - (a.pow || 0) || (a.i || 0) - (b.i || 0))[0];
    if (atk) return pick(atk, 'удар');
    if (basic) return pick(basic, 'атака');
    return null;
  }

  // ---------- TvT ----------
  const ms = v => (typeof v === 'number' ? v : (v && Date.parse(v)) || 0);
  const FIN = /FINISH|RESULT|ENDED|IDLE|CANCEL/i;
  // T — ответ /game/tvt + t (когда получен) и off (часы сервера − свои). Логика как у основного бота (modules/tvt.js tvtState).
  function tvtView(T) {
    if (!T || typeof T !== 'object' || typeof T.phase !== 'string') return null;
    const nx = (T.schedule && T.schedule.next) || {}, phase = T.phase.toUpperCase(), regEnd = ms(T.registrationEndsAt);
    // 20.17 основного бота: во время регистрации schedule.next может показывать уже следующий слот — старт от конца регистрации.
    const nxStart = ms(nx.battleStartsAt), regStart = regEnd && /REGISTRATION/.test(phase) ? regEnd + 30000 : 0;
    return { phase, id: String(T.eventId || nx.slotKey || ''), reg: !!(T.isRegistered || T.myTeam),
      start: ms(T.startsAt) || (regStart && !(nxStart >= regEnd && nxStart - regEnd < 600000) ? regStart : nxStart),
      end: ms(T.endsAt), regEnd, regOpen: ms(nx.registrationOpensAt), count: +T.registeredCount || 0, max: +T.maxPlayers || 20,
      eliminated: !!T.isRegistered && /^(ACTIVE|FINISHED)$/.test(phase) && !!T.selfCombat && T.selfCombat.alive === false,
      enabled: !(T.schedule && T.schedule.enabled === false), t: +T.t || 0, off: +T.off || 0 };
  }
  // «Бой идёт» верна только до конца события: известный endsAt + 5 мин или 20 мин от старта (основной бот, TVT-6).
  const phaseLive = (V, now) => /ACTIVE|PREPAR|STARTING|COMBAT/.test(V.phase) && !(V.end && now > V.end + 300000)
    && !(V.start && now - V.start > 1200000 && !(V.end && now < V.end));
  // Что делать сейчас: register — записаться; hold — запись есть, бой через ≤ 3 мин (новых PvE-боёв не начинаем);
  // fight — бой через ≤ 90 с или идёт (на арену, PvE бросаем); leave — событие кончилось/выбыли — итог и назад к охоте.
  // st: {done — отыгранное событие, skip — {id, until} пропуск записи, inTvt — событие, на которое пришли}
  function tvtDecide(V, now, st = {}) {
    if (!V || !V.enabled) return null;
    const done = !!st.done && st.done === (V.id || String(V.start || ''));
    if (st.inTvt && (V.eliminated || FIN.test(V.phase) || (!V.reg && !/REGISTRATION/.test(V.phase)))) return 'leave';
    if (V.eliminated) return null;
    const skip = !!st.skip && st.skip.id === V.id && now < (+st.skip.until || 0);
    if (/REGISTRATION/.test(V.phase) && !V.reg && (!V.regEnd || now < V.regEnd) && V.count < V.max && !skip) return 'register';
    if (V.reg && !FIN.test(V.phase) && !done) {
      if (phaseLive(V, now) || (V.start && V.start - now < 90000 && now - V.start < 660000)) return 'fight';
      if (V.start && V.start - now < 180000 && now - V.start < 660000) return 'hold';
    }
    return null;
  }
  // Как часто читать /game/tvt: окна регистрации и боя — часто, в остальное время редко (свой GET не долбит сервер).
  function tvtPollGap(V, now, fails = 0) {
    if (!V) return fails < 3 ? 5000 : fails < 6 ? 30000 : 300000;
    if (!V.enabled) return 600000;
    if (/REGISTRATION|ACTIVE|PREPAR|STARTING|COMBAT/.test(V.phase)) return 5000;
    if (V.reg && V.start && V.start - now < 300000 && now - V.start < 1200000) return 5000;
    if (V.regOpen && now >= V.regOpen - 120000 && now < V.regOpen + 600000) return 3000;
    if (V.regOpen && V.regOpen > now) return Math.min(300000, Math.max(5000, V.regOpen - now - 90000));
    return 120000;
  }

  // ---------- счётчик убитых мобов ----------
  // Серверный character.mobsKilled (он же считает AoE). Считаем прирост только пока бот включён и только у того же героя;
  // поздний ответ (меньшая revision), сброс счётчика игры и скачок больше maxJump (герой играл без бота) — новая точка отсчёта.
  function killStep(st, snap, on, maxJump = 40) {
    st = st || {};
    if (!snap || !Number.isSafeInteger(snap.k) || snap.k < 0 || typeof snap.name !== 'string') return { st, add: 0, why: 'none' };
    const base = { ...st, name: snap.name, lastK: snap.k, rev: Number.isSafeInteger(snap.rev) ? snap.rev : st.rev };
    if (st.name !== snap.name || !Number.isSafeInteger(st.lastK)) return { st: { ...base, kills: st.kills || 0 }, add: 0, why: 'base' };
    if (Number.isSafeInteger(snap.rev) && Number.isSafeInteger(st.rev) && snap.rev < st.rev) return { st, add: 0, why: 'old' };
    const d = snap.k - st.lastK;
    if (d < 0) return { st: base, add: 0, why: 'reset' };
    if (!on) return { st: base, add: 0, why: 'off' };
    if (d > maxJump) return { st: base, add: 0, why: 'jump' };
    return { st: { ...base, kills: (st.kills || 0) + d }, add: d, why: d ? 'kill' : 'same' };
  }
  const limitDone = (kills, limit) => +limit > 0 && +kills >= +limit;

  // ---------- карта ----------
  // Метки «чемпион»/«босс» — только в приписке после имени (основной бот 7.2: «Hatar Ratman Boss · ур. 48» — обычный моб).
  const LV_RE = /^([^\p{L}\d]*)(.+?)\s*[·•]\s*ур\.?\s*(\d+)/iu;
  function mobRow(text, id, cls = '', marker = '') {
    const t = String(text || '').trim(), m = t.match(LV_RE), tail = t.split(/\s*[·•]\s*/).slice(1).join(' · ').toLowerCase();
    const c = String(cls || ''), mk = String(marker || '');
    return { id: String(id || ''), text: t, name: m ? m[2].trim() : t, lvl: m ? +m[3] : 0,
      champ: /чемпион|чемпіон/.test(tail) || /--champion/.test(c) || /champion/i.test(mk) || /^champ_/i.test(id || ''),
      boss: /босс|boss|рейд/.test(tail) || /--raid|--epic_guard/.test(c) || /raid|epic/i.test(mk) || /^l2dop_(?:rb|eg)_/i.test(id || ''),
      npc: /--npc/.test(c) };
  }
  // Ближайший обычный моб (список карты уже по дистанции). РБ, охрану эпиков, чемпионов и NPC не трогаем;
  // моб сильно выше героя (> +10) — тоже нет: бот рассчитан на автономную охоту без присмотра.
  function pickMob(rows, opt = {}) {
    const above = Number.isFinite(+opt.above) ? +opt.above : 10;
    return rows.find(r => r.id && !r.boss && !r.champ && !r.npc && !(opt.skip && opt.skip.has(r.id))
      && !(opt.hero > 0 && r.lvl > 0 && r.lvl > opt.hero + above)) || null;
  }

  // ---------- класс героя ----------
  // Lite 1.3 (21.10, John: «это сборка под БХ, а нужна под дестра»): Lite ведёт только воина-орка ветки Дестра — Orc Fighter →
  // Orc Raider → Destroyer → Titan. Профессия — character.l2Profession («orc_titan», «dwarf_bounty_hunter»); у героя до четырёх
  // классов (основной + сабклассы, character.classSlots), активен один, панель скиллов у каждого своя. Другой класс (сабкласс
  // Bounty Hunter, другой герой аккаунта) Lite не ведёт и его скиллы в меню не показывает.
  // Lite 1.5 (21.10, John: «есть сабкласс Лука, хотим бота и Луку научить»): ещё лучники — 2-я профессия Hawkeye / Silver Ranger /
  // Phantom Ranger и 3-я Sagittarius / Moonlight Sentinel / Ghost Sentinel (сабкласс берётся уже со 2-й профессией, kb/raw/subclasses.json).
  // Первая профессия Rogue/Scout/Assassin — общая с кинжальщиками, её не берём.
  const profKey = p => String(p || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const isDestr = p => /^(?:orc_)?(?:raider|destroyer|titan)$|^orc_fighter$/.test(profKey(p));
  const isArcher = p => /^(?:(?:human|elf|dark_elf)_)?(?:hawkeye|sagittarius|silver_ranger|moonlight_sentinel|phantom_ranger|ghost_sentinel)$/.test(profKey(p));
  const clsKind = p => (isDestr(p) ? 'destr' : isArcher(p) ? 'archer' : null);
  const KINDS = ['destr', 'archer'];
  const KIND_RU = { destr: 'Дестр', archer: 'Лук' };
  const profName = p => profKey(p).split('_').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  // ok: true — Дестр/Титан или лучник, false — другой класс, null — профессия не прочитана (не мешаем); kind — чей профиль.
  // alt — слот Дестра или лучника у этого же героя (первый), alts — все такие слоты.
  function heroClass(prof, slots, slot) {
    const p = profKey(prof), kind = p ? clsKind(p) : null;
    const alts = (Array.isArray(slots) ? slots : []).filter(s => s && s.slot !== slot && clsKind(s.prof))
      .map(s => ({ slot: s.slot, name: profName(s.prof), lvl: s.lvl ?? null, kind: clsKind(s.prof) }));
    return { ok: p ? !!kind : null, kind, name: profName(p), alt: alts[0] || null, alts };
  }
  const slotRu = s => (s === 0 ? 'основной класс' : Number.isInteger(s) && s > 0 ? 'сабкласс ' + s : 'класс');
  // Стрелы по номеру предмета (тред «Изучение лука» 21.10) и строка для меню: «Fine Steel (C) 221 · Mithril (A) 497».
  const ARROWS = { 17: 'Wooden (NG)', 1341: 'Bone (D)', 1342: 'Fine Steel (C)', 1343: 'Silver (B)', 1344: 'Mithril (A)', 1345: 'Shining (S)' };
  const arrowsText = by => Object.entries(by || {}).filter(([, q]) => +q > 0).sort((a, b) => +a[0] - +b[0])
    .map(([id, q]) => `${ARROWS[id] || '#' + id} ${q}`).join(' · ');

  // ---------- профили настроек (1.5): у Дестра и у лучника свои ----------
  // В хранилище lite.cfg: on — общий; поля профиля — в p.destr / p.archer. Настройки до 1.5 лежат прямо в lite.cfg —
  // это профиль Дестра (Lite до 1.5 вёл только его), профиль лука начинается с умолчаний.
  const PROF_KEYS = ['zone', 'zoneName', 'killLimit', 'tvt', 'skills', 'hpPot', 'mpPot', 'maxDeaths', 'fastTurn'];
  const DEF_PROF = { zone: '', zoneName: '', killLimit: 0, tvt: true, skills: {}, hpPot: 50, mpPot: 25, maxDeaths: 3, fastTurn: true };
  const kindOf = k => (KINDS.includes(k) ? k : 'destr');
  const pickProf = o => Object.fromEntries(PROF_KEYS.filter(k => o && o[k] !== undefined).map(k => [k, o[k]]));
  function profCfg(raw, kind) {
    const r = raw && typeof raw === 'object' ? raw : {}, k = kindOf(kind), own = r.p && typeof r.p === 'object' ? r.p[k] : null;
    return { ...DEF_PROF, ...(k === 'destr' ? pickProf(r) : {}), ...pickProf(own), on: !!r.on, kind: k };
  }
  // Запись из меню: поля профиля — в его p.<kind>, остальное (on) — наверх. Старые поля Дестра наверху не трогаем: p.destr важнее.
  function profPatch(raw, kind, patch) {
    const r = { ...(raw && typeof raw === 'object' ? raw : {}) }, k = kindOf(kind), p = { ...(r.p || {}) };
    for (const [key, v] of Object.entries(patch || {})) {
      if (PROF_KEYS.includes(key)) p[k] = { ...(p[k] || {}), [key]: v };
      else if (key !== 'p' && key !== 'kind') r[key] = v;
    }
    return { ...r, p };
  }
  // Память профиля в lite.rt: у активного — прямо в rt (zone, k.kills, limitNoted, bar, barCls), у другого — в rt.by[kind].
  // rt.kind — чей профиль сейчас в rt (до 1.5 — Дестр).
  const rtKind = rt => kindOf(rt && rt.kind);
  function profRt(rt, kind) {
    const r = rt || {}, k = kindOf(kind);
    if (k === rtKind(r)) return { zone: r.zone || null, kills: (r.k && r.k.kills) || 0, limitNoted: r.limitNoted || 0, bar: r.bar || [], barCls: r.barCls || '' };
    const b = (r.by && r.by[k]) || {};
    return { zone: b.zone || null, kills: b.kills || 0, limitNoted: b.limitNoted || 0, bar: b.bar || [], barCls: b.barCls || '' };
  }
  // Смена активного класса Дестр ↔ лук: память старого профиля — в rt.by, нового — в rt. Новая точка отсчёта счётчика (lastK)
  // и сброс дороги к месту охоты; место охоты нового профиля — его запомненное, иначе выбранное в его настройках, иначе
  // «где стоит герой» (бот запомнит при первом снимке). cfgTo — настройки нового профиля (profCfg).
  function profSwap(rt, to, cfgTo) {
    const r = rt || {}, from = rtKind(r), k = kindOf(to);
    if (k === from) return null;
    const keep = profRt(r, from), next = profRt(r, k), c = cfgTo || {};
    // Место, выбранное в настройках профиля, важнее запомненного (его могли сменить в меню, пока профиль спал).
    const zone = c.zone && !(next.zone && next.zone.id === c.zone) ? { id: c.zone, name: c.zoneName || c.zone } : next.zone;
    const by = { ...(r.by || {}), [from]: keep };
    delete by[k];
    return { kind: k, by, zone, k: { ...(r.k || {}), kills: next.kills, lastK: null },
      limitNoted: next.limitNoted, bar: next.bar, barCls: next.barCls, goZone: '', tpTry: [], zoneBlockT: 0 };
  }

  // ---------- телепорт ----------
  // Цена из строки «Телепорт» (основной бот, navigation.teleportCost): Coin of Luck никогда, неизвестная валюта/цена — не летим.
  function teleportCost(rowText, priceText, curText) {
    const txt = String(rowText || '').replace(/\s+/g, ' '), cur = String(curText || '');
    const col = /coin|luck|монет|удач|\bcol\b/i.test(cur), aden = /аден|adena/i.test(cur);
    const free = /бесплат|безкоштов|\bfree\b/i.test(txt), raw = priceText == null ? null : String(priceText).trim();
    const price = raw != null && /^[\d\s.,]+$/.test(raw) && /\d/.test(raw) ? Number(raw.replace(/\D/g, '')) : free ? 0 : null;
    const why = price == null ? 'цена не прочитана' : col ? 'Coin of Luck бот не тратит'
      : price > 0 && !aden ? 'валюта не подтверждена как адена' : price === 0 && !free && !aden ? 'бесплатный переход не подтверждён' : '';
    return { price, why };
  }

  const fmtLeft = msLeft => { const s = Math.max(0, Math.round(msLeft / 1000)); return s < 90 ? s + ' с' : Math.round(s / 60) + ' мин'; };

  const api = { SK, NATIVE, TYPES, TYPE_RU, cleanTitle, guessType, skillInfo, defaultOn, skillUse, fastHit, meMerge, potKind, planTurn,
    tvtView, phaseLive, tvtDecide, tvtPollGap, killStep, limitDone, mobRow, pickMob, teleportCost, fmtLeft, ms, BOW_ONLY, MELEE_ONLY, offWeapon, isDestr, isArcher, clsKind, KINDS, KIND_RU, profName, heroClass, slotRu, ARROWS, arrowsText,
    PROF_KEYS, DEF_PROF, profCfg, profPatch, rtKind, profRt, profSwap };
  root.L2Lite = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
