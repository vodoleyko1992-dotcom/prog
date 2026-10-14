/* L2wap v7: isolated equipment feature module. Dependencies are injected lazily.
   All game actions remain under the central lease and dispatcher in content.js. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.equipment = function create_equipment(env) {
function equipBy(str) {                         // только слоты снаряжения
  const alts = env.names(str);
  if (!alts.length) return null;
  const slots = [...document.querySelectorAll(env.SLOT)].filter(env.isEquip);
  return slots.find(b => alts.some(a => (b.title || '').toLowerCase().startsWith(a)))
    // имя из инвентаря могло прийти по-английски («Scallop Jamadhr») — сверяем по значку слота с базой предметов
    || slots.find(b => { const en = (env.itemByIcon(b.querySelector('img')?.getAttribute('src')) || {}).n?.toLowerCase(); return en && alts.some(a => en.startsWith(a)); })
    || null;
}

async function equip(w) {
  if (!w) return false;
  const before = env.noticeText();
  env.fire(w);
  const ok = !!(await env.waitFor(() => { const n = env.noticeText(); return n !== before && env.EQUIP_OK.test(n); }, 1500, 50));
  await env.setRt({ weaponNow: env.cleanTitle(w.title) });
  env.rec('B', 'оружие', `надето «${w.title}»${ok ? '' : ' (без подтверждения игры)'}`);
  await env.pause();
  return ok;
}


const POT_MP = /мани|маны|mana|\bmp\b/i, POT_HP = /зцілен|исцелен|здоров|лікув|лечен|healing|life|scarlet|\bhp\b/i;
function suggestRoles() {
  const inv = env.rt.panel?.length && !env.isBattle() ? env.rt.panel : env.panelInventory();
  const P = env.rt.skills || {}, pr = n => P[n.toLowerCase()] || {};
  const avg = p => p.dmgN ? p.dmg / p.dmgN : 0;
  const skills = inv.filter(s => s.kind === 'скилл');
  const mage = env.combatProfileKind() === 'mage_summoner';
  const il = s => env.ilOf(s);
  const isPetOnly = s => il(s)?.target === 'PET' || /^(?:(?:servitor|warrior servitor|final servitor)(?:\s|$)|heal servitor)/i.test(s.name);
  // 9.2: «Summon Feline Queen» на L2WAP — бафф кота (IL_FIX 1331: target PET), не призыв
  const isSummon = s => il(s)?.target !== 'PET' && (il(s)?.c === 'Призыв' || il(s)?.t === 'SUMMON' || /^(?:mass )?summon\b|^feline (?:queen|king)\b/i.test(s.name));
  const isBuff = s => !isPetOnly(s) && !isSummon(s) && (il(s) ? il(s).c === 'Бафф' : pr(s.name).buffSec > 0 || /totem|spirit|might|shield|haste|rage|frenzy|guts|zealot|бафф|аура/i.test(s.name));
  // v4.42: в «станы» — только оглушение/паралич (Sleep снимается первым же ударом, Root не мешает бить в ближнем бою)
  const isStun = s => il(s) ? il(s).c === 'Контроль' && /^(STUN|PARALYZE|PDAM)$/.test(il(s).t || 'STUN') : !isBuff(s) && (pr(s.name).stun > 0 || /stun|оглуш|shock|bash/i.test(s.name));
  // «урон + стан» (Soul Breaker: сила 406, Stunning Fist: 45): сильный стан — ещё и ударный скилл в ротации урона
  const powIL = s => { const v = il(s)?.pow; return Array.isArray(v) ? v[0] : v || 0; };
  const strongStun = s => isStun(s) && (powIL(s) >= 250 || avg(pr(s.name)) >= env.expDmg('атака') * 2);
  const isCharge = s => il(s) ? il(s).t === 'CHARGE' : env.isChargeName(s.name);
  const isForce = s => !isCharge(s) && (il(s) ? !!il(s).charges : env.isForceName(s.name));
  const isIdle = s => ['PASSIVE', 'TOGGLE', 'CHANCE'].includes(il(s)?.o);
  const isUltra = s => { const v = il(s); const p = Array.isArray(v?.pow) ? v.pow[v.pow.length - 1] : v?.pow || 0; return !!v && /атака/.test(v.c) && ((v.reuse || 0) >= 25000 && (p >= 3000 || /vortex/i.test(v.n)) || /of doom/i.test(v.n)); };   // пассив/тоггл/проц — не «силовой»
  // 7.1.31: «в бою эффекта нет» (L2WAP: Servitor Wind Walk, Body To Mind) — ни в одну роль; труп-цель (Corpse Life Drain) — не удар
  const live = s => !env.noEffect?.(s.name);
  const buffsAll = skills.filter(isBuff).filter(live);
  const buffsMine = buffsAll.filter(s => pr(s.name).usesU > 0);
  const items = inv.filter(s => s.kind === 'предмет');
  const out = {
    nAttack: mage ? '' : inv.find(s => s.kind === 'атака')?.name || '',
    nShots:  (() => { const shots = inv.filter(s => s.kind === 'заряды');
      const mage = shotsForMageWeapon();     // 7.1.16-fix: тип зарядов — по надетому оружию (маг. оружие → духа, физ. → души)
      const want = mage ? /благослов|blessed.*spiritshot|spiritshot|заряд\S* дух/i : /заряд\S* душ|soulshot/i;
      return shots.find(s => want.test(s.name))?.name || shots[0]?.name || ''; })(),
    // 7.2.1 (скрин игрока): в «Банка HP» попала «Зілля мани» — у банки маны в замере было «HP +136» (реген в момент глотка).
    // Сначала — по названию; по замеру — только если банка явно HP (лечит больше, чем даёт MP) и в названии нет «мана»
    nMpPot:  (items.find(s => /мани|маны|mana/i.test(s.title)) || items.find(s => !POT_HP.test(s.title + ' ' + s.img) && (pr(s.name).mpGain || 0) > (pr(s.name).heal || 0) * 2))?.name || '',
    nHpPot:  (items.find(s => POT_HP.test(s.title + ' ' + s.img) && !POT_MP.test(s.title)) || items.find(s => !POT_MP.test(s.title) && (pr(s.name).heal || 0) > (pr(s.name).mpGain || 0) * 2))?.name || '',
    nStun:   skills.filter(s => !isPetOnly(s) && !isSummon(s) && isStun(s)).map(s => s.name).join(', '),
    nCharge: skills.filter(isCharge).map(s => s.name).join(', '),
    nForce:  skills.filter(isForce).map(s => `${s.name}=${(il(s) && env.ilNum(il(s).charges)) || env.skillCost(s.name)}`).join(', '),
    nPower:  skills.filter(live).filter(s => il(s)?.target !== 'CORPSE_MOB').filter(s => mage ? (il(s)?.c === 'Маг. атака' || il(s)?.t === 'MDAM' || (!il(s)?.c && pr(s.name).dmgN >= 2 && !isPetOnly(s) && !isSummon(s))) : (!isPetOnly(s) && !isSummon(s) && !isUltra(s) && !isBuff(s) && (!isStun(s) || strongStun(s)) && !isCharge(s) && !isForce(s) && !isIdle(s) && !env.rt.skillDb?.[s.name.toLowerCase()]?.passive && (!il(s) || /атака/.test(il(s).c) || strongStun(s)))).sort((a,b)=> avg(pr(b.name))-avg(pr(a.name))).map(s=>s.name).join(', '),
    nBuffs:  (buffsMine.length ? buffsMine : buffsAll).filter(s => !il(s)?.pc?.hp).map(s => s.name).join(', '),
    // v5.3: важные (аварийные HP ≤ 30 %: Frenzy, Guts, Zealot…) и постоянные (тогглы) — отдельными ролями
    nKeyBuffs: buffsAll.filter(s => !isPetOnly(s) && il(s)?.pc?.hp).map(s => s.name).join(', '),
    nUltra: skills.filter(s => !isPetOnly(s) && !isSummon(s) && isUltra(s)).map(s => s.name).join(', '),
    nDrain: skills.filter(s => !isPetOnly(s) && il(s)?.t === 'DRAIN' && !/труп моба/.test(il(s)?.L || '')).map(s => s.name).join(', '),
    nSpoil: skills.filter(s => (il(s)?.t === 'SPOIL' || /^spoil/i.test(s.name)) && !(il(s)?.target === 'AREA' || /festival/i.test(s.name))).map(s => s.name).join(', '),
    nSpoilMass: skills.filter(s => (il(s)?.t === 'SPOIL' || /^spoil/i.test(s.name)) && (il(s)?.target === 'AREA' || /festival/i.test(s.name))).map(s => s.name).join(', '),
    nSweep: '',   // 7.2: свип в игре автоматический — роль не назначаем
    nToggles: skills.filter(live).filter(s => !isPetOnly(s) && il(s)?.o === 'TOGGLE' && !/fake death|silent move|relax|chameleon|^quest/i.test(s.name)).map(s => s.name).join(', '),
    // v4.42: лечащие скиллы (маг/клерик: Heal, Battle Heal; Дестроер: Battle Roar) — раньше банок, они бесплатны
    // 7.1.31: баффы на кота (Servitor Haste/Magic Shield/Physical Shield…, когда появятся) — роль «Баффы кота»
    // 7.2.1 (лог 10.10 21:17:42): Servitor Ultimate Defense — «слуга нерухомий ~30 с», откат 30 мин: аварийная защита, не бафф на каждый бой
    nPetBuffs: skills.filter(live).filter(s => isPetOnly(s) && il(s)?.eff !== 'ImobilePetBuff' && !/ultimate defen/i.test(s.name) && (il(s) ? il(s).c === 'Бафф' : /^(?:servitor|fast servitor)\s/i.test(s.name) && !/heal|recharge|cure|bless|ultimate/i.test(s.name))).map(s => s.name).join(', '),
    nHeal:   skills.filter(live).filter(s => !isPetOnly(s) && il(s)?.c === 'Лечение' && /^(HEAL|HEAL_PERCENT|HOT|HEAL_STATIC)$/.test(il(s).t || '')).map(s => s.name).join(', '),
    nWeaponMain: weaponMainSuggest(inv)
  };
  for (const k of ['nPower', 'nStun', 'nBuffs', 'nCharge', 'nForce', 'nHeal', 'nKeyBuffs', 'nToggles', 'nSpoil', 'nSpoilMass', 'nUltra', 'nDrain', 'nPetBuffs'])
    out[k] = [...new Set((out[k] || '').split(',').map(x => x.trim()).filter(Boolean))].join(', ');
  const why = skills.map(s => { const p = pr(s.name);
    return `• ${s.name} (слот ${s.idx}): ${isCharge(s) ? 'копит энергию силы' : isForce(s) ? `тратит ${env.skillCost(s.name)} эн. силы` : isBuff(s) ? 'бафф' : isStun(s) ? 'стан' : 'урон'}`
      + (il(s) ? ` · [IL #${il(s).id} ${il(s).n}: ${il(s).c}${il(s).reuse ? ', откат ' + il(s).reuse / 1000 + ' с' : ''}${il(s).dur ? ', ' + il(s).dur + ' с' : ''}${il(s).w ? ', ' + il(s).w : ''}]` : '')
      + (p.uses ? ` · исп. ${p.uses} (ваших ${p.usesU || 0})` : ' · ещё не применялся')
      + (p.dmgN ? ` · урон ≈${Math.round(avg(p))}` : '') + (p.mpN ? ` · MP ≈${Math.round(p.mp / p.mpN)}` : '')
      + (p.cd ? ` · КД ${p.cd} с` : '') + (p.buffSec ? ` · бафф ${p.buffSec} с` : '') + (p.stun ? ' · станит' : ''); });
  return { roles: out, why, buffsNote: buffsMine.length ? 'баффы — по вашему использованию' : 'баффы — все найденные (вы их ещё не применяли)' };
}

function weaponMainSuggest(inv) {
  const eqs = inv.filter(s => s.kind === 'снаряжение');
  const rec = (env.rt.weaponRec?.main || '').toLowerCase();
  const byRec = rec && eqs.find(s => s.name.toLowerCase().startsWith(rec) || rec.startsWith(s.name.toLowerCase()));
  if (byRec) return byRec.name;
  const types = classWeaponTypes().types;
  const byType = types.length && eqs.find(s => types.includes(env.itemOf(env.iconStem(s.img))?.wt || ''));
  if (byType) return byType.name;
  return eqs.find(s => /пик|глеф|копь|алебард|spear|glaive|pole|halberd|lance|трезуб/i.test(s.name))?.name || '';
}

async function autoRoles() {
  if (!env.cfg.autoRoles || !env.isBattle()) return;
  await env.itemsDb(); // рейтинг оружия по виду из справочника; не загружаем базу на каждой карте
  const sug = suggestRoles().roles, fix = {};
  const mage = env.combatProfileKind() === 'mage_summoner';
  if (mage && env.names(env.cfg.nAttack || '').some(n => /^(?:атака|attack)$/.test(n) || env.slotsBy(n).some(b => env.slotKind(b) === 'атака'))) fix.nAttack = '';
  // Only obsolete, positively identified fighter skills are migrated; preserve custom roles.
  if (mage) for (const k of ['nCharge', 'nForce', 'nStun']) {
    const names = env.names(env.cfg[k] || '').map(n => n.split('=')[0].trim());
    if (names.length && names.every(n => /^(?:focused force|hurricane assault|force blaster|stunning fist|iron punch)$/i.test(n))) fix[k] = '';
  }
  // 7.2.1 (скрин игрока): «Банка HP» = «Зілля мани» — роль с банкой маны заменяем (и наоборот)
  { const hp = env.names(env.cfg.nHpPot || ''), mpn = env.names(env.cfg.nMpPot || '');
    if (hp.length && hp.every(n => POT_MP.test(n))) fix.nHpPot = sug.nHpPot && !POT_MP.test(sug.nHpPot) ? sug.nHpPot : '';
    if (mpn.length && mpn.every(n => POT_HP.test(n) && !POT_MP.test(n))) fix.nMpPot = sug.nMpPot || ''; }
  // 7.1.31 (лог 10.10 19:35: «проверка баффов totem spirit bear: нет на панели боя»): тотемы воина в «Баффах» мага — заводское
  // значение, у мага их нет. Только если ВСЕ баффы в списке — тотемы и ни одного нет на панели (свои настройки игрока не трогаем)
  if (mage && !fix.nBuffs) { const bs = env.names(env.cfg.nBuffs || ''); if (bs.length && bs.every(n => /^totem\b/i.test(n) && !env.slotsBy(n).length)) fix.nBuffs = sug.nBuffs || ''; }
  for (const [k, v] of Object.entries(sug)) {
    if (!v) continue;
    const cur = env.cfg[k] || '';
    const inInv = n => !!n && (env.rt.weapons || []).some(w => (w.name || '').toLowerCase().startsWith(String(n).toLowerCase().trim()));
    // Switching to a mage must migrate Soulshots to the observed Blessed Spiritshot,
    // even when the old fighter Soulshot slot is still visible on the bar.
    const mageShots = k === 'nShots' && v && (shotsForMageWeapon() ? /благослов|blessed.*spiritshot/i.test(v) : /заряд\S* душ|soulshot/i.test(v));
    const found = mageShots ? env.names(cur).includes(v.toLowerCase())
      : k === 'nWeaponMain' ? (!!equipBy(cur) || inInv(cur) || (!!cur && !!env.cfg.weaponManual))
      // v5.2: список баффов игрока НЕ заменяем никогда (раньше один бафф, не найденный на панели — например, ряд панели
      // не успел открыться, — и весь список подменялся «распознанным»: назначенные баффы пропадали). Пустой — заполняем.
      : k === 'nBuffs' || k === 'nKeyBuffs' || k === 'nToggles' || k === 'nSpoil' || k === 'nSpoilMass' || k === 'nSweep' || k === 'nUltra' || k === 'nDrain' || k === 'nPetBuffs' ? env.names(cur).length > 0
      : k === 'nPower' || k === 'nStun' || k === 'nCharge' || k === 'nHeal'
      ? env.names(cur).length && env.names(cur).every(n => env.slotsBy(n).length)
      // v5.6: список «тратит энергию» игрока не перезаписываем, пока его скиллы есть на панели (раньше подменялся каждый бой)
      : k === 'nForce' ? (() => { const ns = String(cur || '').split(',').map(x => x.split('=')[0].trim()).filter(Boolean); return ns.length > 0 && ns.every(n => env.slotsBy(n).length); })()
      : env.slotsBy(cur).length > 0;
    if (!found) fix[k] = v;
  }
  // For a mage, the currently observed offensive hotbar is authoritative:
  // include every newly learned spell and discard stale fighter roles.
  if (mage && sug.nPower && env.names(sug.nPower).join('|') !== env.names(fix.nPower ?? env.cfg.nPower).join('|'))
    fix.nPower = sug.nPower;
  // новые скиллы на панели (выучен Burning Fist, Soul Breaker…) — дописываем в их роль. «Новый» = не было на панели
  // при прошлой проверке: так не возвращаем скиллы, которые игрок сам убрал из роли
  const panelNames = env.panelInventory().filter(x => x.kind === 'скилл').map(x => x.name.toLowerCase());
  if (Array.isArray(env.rt.panelKnown)) {
    const fresh = panelNames.filter(n => !env.rt.panelKnown.includes(n));
    for (const k of ['nPower', 'nStun', 'nBuffs', 'nCharge', 'nHeal', 'nKeyBuffs', 'nToggles', 'nPetBuffs']) {
      if (fix[k]) continue;
      const add = env.names(sug[k] || '').filter(n => fresh.includes(n) && !env.names(env.cfg[k] || '').includes(n));
      if (add.length) fix[k] = [env.cfg[k], ...add.map(n => env.panelInventory().find(x => x.name.toLowerCase() === n)?.name || n)].filter(Boolean).join(', ');
    }
  }
  if (JSON.stringify(env.rt.panelKnown) !== JSON.stringify(panelNames)) await env.setRt({ panelKnown: panelNames });
  // v4.16: удары, которые раньше считались «за энергию», но её не тратят (Burning Fist, Soul Breaker) — в силовые
  const freeHits = env.names(sug.nPower || '').filter(n => (env.FREE_HIT.test(n) || env.rt.forceFree?.[n]) && !env.names(fix.nPower || env.cfg.nPower || '').includes(n));
  if (freeHits.length && !(env.rt.forceFix416 || []).join(',').includes(freeHits.join(','))) {
    const disp = n => env.panelInventory().find(x => x.name.toLowerCase() === n)?.name || n;
    fix.nPower = [fix.nPower || env.cfg.nPower, ...freeHits.map(disp)].filter(Boolean).join(', ');
    const nf = (fix.nForce || env.cfg.nForce || '').split(',').map(x => x.trim()).filter(x => x && !freeHits.includes(x.split('=')[0].trim().toLowerCase())).join(', ');
    if (nf !== (env.cfg.nForce || '')) fix.nForce = nf;
    await env.setRt({ forceFix416: [...new Set([...(env.rt.forceFix416 || []), ...freeHits])] });
  }
  if (Object.keys(fix).length) {
    const { cfg: c = {} } = await chrome.storage.local.get('cfg');
    await env.setCfg(fix);
    env.rec('B', 'автороли', Object.entries(fix).map(([k, v]) => `${k}=${v}`).join(' · '));
    console.log(env.TAG, 'автоназначение ролей:', fix);
  }
}

// 7.1.16-fix: заряды под надетое оружие. Магическое: M.Atk/P.Atk ≥ 0,7 (посохи ≥ 0,6); физическое ≤ 0,65; луки, кастеты, дуалы,
// древковое, двуручные мечи — физическое. NG/неизвестное — по классу персонажа
function shotsForMageWeapon() {
  const W = env.rt.weapons || [], main = String(env.cfg.nWeaponMain || '').toLowerCase().trim();
  const w = W.find(x => x.where === 'надето') || (main && W.find(x => (x.name || x.en || '').toLowerCase().startsWith(main)));
  if (w) {
    const pa = +w.pa || 0, ma = +w.ma || 0, wt = String(w.wt || '').toLowerCase();
    if (/лук|кастет|дуал|древков|двуруч\S* меч|арбалет|рапир/.test(wt)) return false;
    if (pa >= 30 && ma && w.g && !/^(NG|—)$/i.test(w.g)) return ma / pa >= (/двуруч/.test(wt) ? 0.6 : 0.7);
  }
  return env.combatProfileKind() === 'mage_summoner';
}

function classWeaponTypes() {
  const prof = env.normalizeProfession(env.rt.prof);
  const kind = env.combatProfileKind();
  if (kind === 'mage_summoner') return { types: [env.MAGE], src: `профессия ${env.rt.prof || 'магический профиль'}` };
  if (env.CLASS_W[prof] && env.CLASS_W[prof][0] !== env.MAGE) return { types: env.CLASS_W[prof], src: `профессия ${env.rt.prof}` };
  const votes = {};
  for (const s of (env.rt.panel || [])) {
    const il = s.kind === 'скилл' && env.ilOf(s);
    if (!il?.w || /без оружия|щит/.test(il.w) || il.c === 'Бафф') continue;
    const ws = il.w.split(',').map(x => x.trim());
    if (ws.length <= 2) ws.forEach(w => votes[w] = (votes[w] || 0) + 1);
  }
  const top = Object.entries(votes).sort((a, b) => b[1] - a[1]).map(x => x[0]);
  return top.length ? { types: top, src: 'по скиллам на панели' } : { types: [], src: 'класс неизвестен' };
}

function weaponOf(id, extra = {}) {
  const it = env.itemOf(+id);
  if (!it || it.k !== 'W' || /удочка|питомца/.test(it.wt || '')) return null;
  return { id: +id, en: it.n, wt: it.wt || '—', g: it.g || 'NG', pa: (it.pa || 0) + (extra.pb || 0), ma: typeof it.ma === 'number' ? it.ma + (extra.mb || 0) : null, spd: it.spd || 0, two: !!it.two, ...extra };
}

const GRADE_RANK = { NG: 0, D: 1, C: 2, B: 3, A: 4, S: 5 };
function rankWeapons(list) {
  const { types, src } = classWeaponTypes(), lv = env.heroLevel() || env.rt.lvl || 99, mage = types[0] === env.MAGE;
  const score = w => {
    const okLv = lv >= (env.GRADE_LV[w.g] ?? 0);
    const ti = mage ? 0 : types.indexOf(w.wt);
    const atk = mage ? (Number.isFinite(w.ma) ? w.ma : -1) : (Number.isFinite(w.pa) ? w.pa : -1);
    // 7.1.30: грейд важнее цифр: у надетого оружия статы иногда не читаются (P.Atk null) — и посох D проигрывал кукле NG
    const gr = GRADE_RANK[String(w.g || 'NG').toUpperCase()] ?? 0;
    return (okLv ? 1e6 : 0) + (mage || ti >= 0 ? (10 - Math.max(ti, 0)) * 1e4 : 0) + gr * 2000 + atk + (w.ench || 0) * 5;
  };
  const sorted = [...list].sort((a, b) => score(b) - score(a));
  const inClass = w => mage ? true : types.includes(w.wt);
  const main = sorted.find(w => inClass(w) && lv >= (env.GRADE_LV[w.g] ?? 0)) || null;
  return { types, src, mage, main, inClass, lv };
}

async function readWeaponsPage() {               // текущая страница сумки
  const out = [];
  for (const r of document.querySelectorAll('.l2-char-bag-row[data-item-json]')) {
    const j = env.itemJson(r);
    const w = weaponOf(j.itemId, { ench: +j.enchant || 0, pb: +j.enchantPAtkBonus || 0, mb: +j.enchantMAtkBonus || 0, where: 'сумка',
      name: env.baseName(r.querySelector('.l2-char-bag-name')?.textContent), inst: j.targetInstanceId || '' });
    if (w) out.push(w);
  }
  return out;
}

async function equippedWeapon() {                // надетое: иконка → база; имя на языке игры — с панели или из окна предмета
  const img = env.$q('img[data-l2-slot="weapon"]');
  if (!img || !/--filled/.test(img.className)) return null;
  const src = img.getAttribute('src') || '', file = src.split('/').pop();
  let it = env.itemByIcon(src);
  // имя на языке игры: тот же значок на панели навыков («Джамадхр мушлі D-grade.»)
  const onPanel = (env.rt.panel || []).find(s => s.kind === 'снаряжение' && s.img && s.img === file);
  let name = onPanel?.name || '';
  if (!name || !it) {
    const hit = img.closest('.l2-char-equip-slot-hit') || img;
    env.fire(hit);
    // окно сначала может показать «#262» (номер предмета) — ждём имя, но номер тоже пригодится
    let t = await env.waitX(() => { const m = env.$q('#char-bag-modal-title'); const x = env.shown(m) && m.textContent.trim(); return x && !/^#\d+$/.test(x) ? x : null; }, 1500, 100);
    const raw = env.$q('#char-bag-modal-title')?.textContent.trim() || '';
    const idm = (t || raw).match(/^#(\d+)$/);
    if (!it && idm) it = env.itemOf(+idm[1]);
    if (!name && t) name = env.baseName(t);
    if (env.shown(env.$q('#char-bag-modal-close'))) { env.fire(env.$q('#char-bag-modal-close')); await env.sleep(env.rnd(250, 400)); }
  }
  if (!name || /^#\d+$/.test(name)) name = it?.n || '';
  if (!name) {   // 7.1.30: не распознано — не «пусто в руке» (иначе надевалась первая попавшаяся из сумки), а надетое с грейдом из последнего запроса/неизвестным
    env.rec('B', 'оружие', `надетое не распознано (значок ${file})`);
    const eq = env.rt.weaponEq?.id ? weaponOf(env.rt.weaponEq.id, { where: 'надето', name: env.itemOf(env.rt.weaponEq.id)?.n || '' }) : null;
    return eq || { id: 0, en: '', wt: '—', g: env.rt.weaponEq?.g || 'NG', pa: null, ma: null, where: 'надето', name: '?', icon: file, unknown: true };
  }
  let w = it ? weaponOf(it.id, { where: 'надето', name }) : null;
  // 7.1.30: значок не нашёлся в базе — берём надетое из запроса к серверу (бот видел, что именно надели)
  if (!w && env.rt.weaponEq?.id) w = weaponOf(env.rt.weaponEq.id, { where: 'надето', name });
  return w || { id: 0, en: '', wt: '—', g: (name.match(/\b([DCBAS])-grade/i)?.[1] || 'NG').toUpperCase(), pa: null, ma: null, where: 'надето', name, icon: file };
}

// 10.0.13 (аудит 14.10): char.js теперь рисует номера и переходы между группами по пять вместо двух стрелок.
async function bagPageTurn(next) {
  const buttons = [...document.querySelectorAll('#char-bag-pager .l2-compact-pages__btn')], current = () => +(env.$q('#char-bag-pager [aria-current="page"]')?.textContent || 0);
  const p = current(), old = buttons.length ? [] : [...document.querySelectorAll('#char-bag-pager .l2-char-bag-pager__btn')];
  const b = buttons.length ? (next ? buttons.find(x => x.textContent.trim() === String(p + 1)) || buttons.find(x => x.textContent.trim() === '>>')
    : p > 1 ? buttons.find(x => x.textContent.trim() === '1') || buttons.find(x => x.textContent.trim() === '<<') : null) : old[next ? 1 : 0];
  if (!b || b.disabled || !env.shown(b)) return false;
  const sig = () => [...document.querySelectorAll('.l2-char-bag-row[data-item-json]')].map(r => r.dataset.itemJson).join('|'), before = sig();
  env.fire(b);
  return !!await env.waitX(() => (p && current() !== p) || sig() !== before, 3000, 100);
}

async function scanInventoryWeapons() {
  await env.itemsDb();
  await env.waitX(() => env.$q('#char-bag-list') || env.$q('img[data-l2-slot="weapon"]'), 8000, 200);
  const all = [];
  const eq = await equippedWeapon();
  if (eq) all.push(eq);
  const cat = env.$q('[data-inv-cat="weapon"]');
  if (cat && cat.getAttribute('aria-selected') !== 'true') { env.fire(cat); await env.sleep(env.rnd(400, 600)); }
  const gAll = env.$q('[data-inv-grade="all"]');
  if (gAll && gAll.getAttribute('aria-selected') !== 'true') { env.fire(gAll); await env.sleep(env.rnd(300, 500)); }
  for (let i = 0; i < 30 && await bagPageTurn(false); i++) {}   // на первую страницу
  // 7.1.17: строки сумки дорисовываются после переключения вкладки. Лог 10.10 00:50: прочитали сумку раньше — «найдено 1: Voodoo Doll»,
  // а Staff of Life (D, M.Atk 72) лежал в сумке и бот его не увидел. Ждём, пока число строк перестанет меняться (до 3 с)
  { let n = -1, same = 0; const t0 = Date.now();
    while (Date.now() - t0 < 3000 && same < 3) { const k = document.querySelectorAll('.l2-char-bag-row[data-item-json]').length; same = k === n && k > 0 ? same + 1 : 0; n = k; await env.sleep(150); } }
  for (let page = 0; page < 30; page++) {
    all.push(...await readWeaponsPage());
    if (!await bagPageTurn(true)) break;
  }
  const seen = new Set(), list = all.filter(w => { const k = w.where + '|' + (w.inst || w.name) + '|' + w.ench; if (seen.has(k)) return false; seen.add(k); return true; });
  return list;
}

async function wearFromBag(w) {
  for (let i = 0; i < 30 && await bagPageTurn(false); i++) {}
  for (let page = 0; page < 30; page++) {
    const row = [...document.querySelectorAll('.l2-char-bag-row[data-item-json]')].find(r => { const j = env.itemJson(r); return +j.itemId === w.id && (!w.inst || j.targetInstanceId === w.inst); });
    const btn = row?.querySelector('.l2-char-bag-equip--wear');
    if (btn) {
      const before = env.$q('img[data-l2-slot="weapon"]')?.getAttribute('src') || '';
      await env.pause(); env.fire(btn);
      const ok = await env.waitX(() => (env.$q('img[data-l2-slot="weapon"]')?.getAttribute('src') || '') !== before || env.EQUIP_OK.test(env.noticeText()), 4000, 150);
      env.rec('B', 'оружие', `надето из сумки «${w.name}» (${w.wt}, ${w.g})${ok ? '' : ' — без подтверждения игры'}`);
      return !!ok;
    }
    if (!await bagPageTurn(true)) break;
  }
  return false;
}

async function invScanStep() {
  let st = env.rt.invScan;
  if (!st) return false;
  if (st.step === 'prof') {
    if (!st.back) { st = { ...st, back: location.pathname + location.search }; await env.setRt({ invScan: st }); }
    if (!env.isCharacter()) { location.href = '/character.html'; await env.sleep(4000); return true; }
    const p = await env.waitX(() => env.$q('#character-profession')?.textContent.trim(), 5000, 150);
    await env.setRt({ prof: p || env.rt.prof || '', lvl: env.heroLevel() || env.rt.lvl, invScan: { ...st, step: 'inv' } });
    env.setStatus(`Оружие: профессия ${p || '?'} — смотрю инвентарь`);
    location.href = '/char.html'; await env.sleep(4000); return true;
  }
  if (st.step === 'inv') {
    if (!env.isChar()) { location.href = '/char.html'; await env.sleep(4000); return true; }
    env.setStatus('Оружие: читаю инвентарь');
    const list = await scanInventoryWeapons();
    const R = rankWeapons(list);
    const eq = list.find(w => w.where === 'надето');
    const fix = {};
    // надеваем «в класс», только если не теряем больше 15 % атаки (S-копьё не меняем на C-двуручник)
    const atk = w => R.mage ? w.ma : w.pa;
    // 7.1.30 (лог 15:38): статы надетого не прочитались (null) → «28 > null» и бот надел куклу NG вместо посоха D.
    // Никогда не меняем на оружие ниже грейдом; если статы надетого неизвестны — меняем только на оружие выше грейдом
    const gR = w => GRADE_RANK[String(w?.g || 'NG').toUpperCase()] ?? 0;
    const eqKnown = eq && Number.isFinite(atk(eq));
    const better = R.main && (!eq || (gR(R.main) >= gR(eq) && (gR(R.main) > gR(eq) && !eqKnown
      || eqKnown && (R.inClass(eq) ? atk(R.main) > atk(eq) * 1.05 : atk(R.main) >= atk(eq) * 0.85))));
    // выбор в меню: если поле пустое или такого оружия нет — подставляем «в класс» (или надетое, если «в класс» слабее)
    const has = n => n && list.some(w => (w.name || '').toLowerCase().startsWith(String(n).toLowerCase().split(',')[0].trim()));
    if (env.cfg.weaponClassPick !== false) {
      const mainPick = (better ? R.main : eq) || R.main || eq;
      const curMain = list.find(w => has(env.cfg.nWeaponMain) && (w.name || '').toLowerCase().startsWith(String(env.cfg.nWeaponMain).toLowerCase().split(',')[0].trim()));
      const offClass = curMain && R.main && !R.inClass(curMain) && !env.cfg.weaponManual;   // выбор не «в класс» и игрок его не ставил сам
      if (mainPick && (!env.cfg.nWeaponMain || !has(env.cfg.nWeaponMain) || offClass)) fix.nWeaponMain = mainPick.name;
    }
    let wore = '';
    // 10.0.2 (Life Stone): на надетом оружии полезный ЛС (умение или бонус, rt.weaponAug от сервера) — сам не переодеваем:
    // ЛС остаётся на старом оружии, умение пропадёт. Рекомендация в меню остаётся, надеть может игрок
    const aw = env.rt.weaponAug, augHold = !!(aw && aw.o && (aw.k === 'active' || aw.k === 'positive') && (!eq?.id || !aw.w || +eq.id === +aw.w));
    // 7.1.30 (лог 15:38:22→24): игрок нажал «Стоп», а бот через 2 с всё равно переодел оружие — после остановки не надеваем
    if (env.on && env.cfg.weaponClassEquip !== false && R.main && R.main.where !== 'надето' && better && !augHold) {
      if (await wearFromBag(R.main)) { wore = R.main.name; R.main.where = 'надето'; if (eq) eq.where = 'сумка'; }
    }
    await env.setRt({ weapons: list, weaponsT: Date.now(), weaponRec: { main: R.main?.name || '', types: R.types, src: R.src, lv: R.lv, wore,
      eqInClass: eq ? R.inClass(eq) : null, keptEq: !!(R.main && R.main.where !== 'надето' && !wore && !better), keptAug: !!(augHold && better && !wore) }, invScan: null });
    if (Object.keys(fix).length) await env.setCfg(fix);
    env.rec('B', 'оружие', `класс: ${R.src} → ${R.types.join(' / ') || '?'} · найдено ${list.length}: ` + list.map(w => `${w.name} [${w.wt}, ${w.g}${w.ench ? ' +' + w.ench : ''}, P.Atk ${w.pa}${w.where === 'надето' ? ', надето' : ''}${R.inClass(w) ? ', в класс' : ''}]`).join(' · ')
      + (R.main ? ` · рекомендую: ${R.main.name}` : ' · оружия «в класс» нет') + (wore ? ` · надел ${wore}` : '') + (Object.keys(fix).length ? ` · в меню: ${Object.entries(fix).map(([k, v]) => k + '=' + v).join(', ')}` : ''));
    env.setStatus(`Оружие: ${list.length} шт. · в класс: ${R.main?.name || 'нет'}${wore ? ' · надето' : ''}`);
    if (st.back && !/\/char\.html/i.test(st.back)) { location.href = st.back; await env.sleep(4000); }
    return true;
  }
  await env.setRt({ invScan: null });
  return false;
}

// 9.2.3 (игрок 11.10: «оружие в класс делалось давно и на коленке»): сумка читалась один раз на установку — новое оружие
// (дроп, Маммон, кузнец) и новый грейд (52 — B, 61 — A, 76 — S) бот не замечал, пока игрок не нажмёт «Проверить инвентарь».
// Повод перечитать: в сумке (ответ сервера, bag = { itemId → qty }) есть оружие, которого нет в rt.weapons, или уровень героя
// перешёл порог грейда с прошлого чтения. Один и тот же повод — один раз (rt.weapRescan.sig), не чаще раза в 10 мин
function weaponRescanWhy(bag, lv) {
  if (!env.rt.weaponsT) return '';
  const R = env.rt.weaponRec || {}, why = [];
  const g = lv && R.lv ? Object.entries(env.GRADE_LV).find(([, L]) => R.lv < L && lv >= L) : null;
  if (g) why.push(`открыт грейд ${g[0]} (${lv} ур.)`);
  if (bag) {
    const known = new Set((env.rt.weapons || []).map(w => +w.id));
    // мелочь с дропа (грейд ниже надетого или выше уровня) — не повод: надеть её бот всё равно не станет
    const eq = (env.rt.weapons || []).find(w => w.where === 'надето'), gr = g => GRADE_RANK[String(g || 'NG').toUpperCase()] ?? 0;
    const fresh = Object.keys(bag).map(Number).filter(id => { const w = bag[id] > 0 && !known.has(id) && weaponOf(id);
      return w && gr(w.g) >= gr(eq?.g) && (lv || 99) >= (env.GRADE_LV[w.g] ?? 0); });
    if (fresh.length) why.push('новое оружие в сумке: ' + fresh.map(id => env.itemOf(id)?.n || '#' + id).join(', '));
  }
  const sig = why.join(' · '), last = env.rt.weapRescan || {};
  if (!sig || sig === last.sig || Date.now() - (last.t || 0) < 600000) return '';
  return sig;
}

async function invScanDrive() {                  // кнопка меню при выключенном боте / продолжение после перехода страницы
  if (env.invBusy || env.running) return;
  env.invBusy = true;
  try {
    for (let i = 0; i < 6 && env.rt.invScan && Date.now() - (env.rt.invScan.t || 0) < 120000 && !env.running; i++) {
      if (!(await invScanStep())) break;
      await env.sleep(300);
    }
  } catch (e) { console.warn(env.TAG, 'оружие', e); }
  env.invBusy = false;
}

async function invScanStart(back) {
  await env.setRt({ invScan: { step: 'prof', back: back || location.pathname + location.search, t: Date.now() } });
  return invScanStep();
}
 return { weaponRescanWhy, equipBy, equip, suggestRoles, weaponMainSuggest, autoRoles, classWeaponTypes, weaponOf, rankWeapons, readWeaponsPage, equippedWeapon, scanInventoryWeapons, wearFromBag, invScanStep, invScanDrive, invScanStart };
 };
})(globalThis);
