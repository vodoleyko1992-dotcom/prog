/* L2wap v7: isolated combat feature module. Dependencies are injected lazily.
   All game actions remain under the central lease and dispatcher in content.js. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.combat = function create_combat(env) {
function mobHp() {
  const m = (env.$q('#battle-mob-hp-val')?.textContent || '').match(/(\d+)\s*\/\s*(\d+)/);
  return m ? { cur: +m[1], max: +m[2], pct: +m[2] ? 100 * m[1] / m[2] : 0 } : null;
}

function extraMobs() {
  const box = env.$q('#battle-whirlwind-extras');
  if (!env.shown(box)) return [];
  return [...box.textContent.matchAll(/([^\d\/]+?)\s*(\d+)\s*\/\s*(\d+)/g)]
    .map(m => ({ name: m[1].replace(/\s+/g, ' ').trim(), cur: +m[2], max: +m[3] })).filter(x => x.name);
}

const noticeText = () => ['#battle-toast', '#l2-hud-notice'].map(x => env.$q(x)).filter(env.shown).map(e => e.textContent.trim()).join(' | ');

const mobTitle = () => env.$q('#battle-mob-title')?.textContent.trim() || '';

const mobName  = () => mobTitle().split('·')[0].trim();

const victory  = () => env.shown(env.$q('#battle-victory-inline'));

const defeat   = () => env.shown(env.$q('#battle-defeat-root'));

const loadErr  = () => env.shown(env.$q('#battle-load-err'));

function slotsBy(str) {                       // кнопки панели, чей title начинается с одного из названий
  const alts = env.names(str);
  if (!alts.length) return [];
  return [...document.querySelectorAll(env.SLOT)]
    .filter(b => { const t = (b.title || '').toLowerCase(); return alts.some(a => t.startsWith(a)) && !env.isEquip(b); })
    .sort((a, b) => env.shown(b) - env.shown(a));      // видимый ряд — первым
}

let overlayBusySeen = new WeakMap(), overlayReadySeen = new WeakSet(), overlaySpawn = '';
function cdBusy(b) {
  const spawn = (env.cdSpawn || env.battleSpawn)();
  if (overlaySpawn !== spawn) { overlaySpawn = spawn; overlayBusySeen = new WeakMap(); overlayReadySeen = new WeakSet(); }
  const cd = env.slotCd(b);
  const t = parseFloat((cd?.querySelector('.l2-battle-hotbar-slot-cd__timer')?.textContent || '').replace(',', '.'));
  const busy = !!cd && !cd.hidden && cd.classList.contains('l2-battle-hotbar-slot-cd--on') && !(t <= 0.1);
  if (busy) { overlayBusySeen.set(b, true); overlayReadySeen.delete(b); }
  else if (overlayBusySeen.get(b)) { overlayBusySeen.delete(b); overlayReadySeen.add(b); }
  return busy;
}
function localCdLeft(b) {
  const action = env.slotAction(b), spawn = (env.cdSpawn || env.battleSpawn)();
  if (action && env.combatCooldown.skillKnown?.(action, spawn)) return env.combatCooldown.skillWait(action, spawn) / 1000;
  if (overlayReadySeen.has(b)) return 0; // observed busy -> ready; an absent overlay alone is not evidence
  return env.memLeft(b);
}

const uiReady = b => !!b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' && !cdBusy(b);

// Items used as HP/MP potions have no local skill cooldown in this game.
const potionSlot = b => !!b && env.slotKind(b) === 'предмет' &&
  /зілля|зелье|potion|elixir|еліксир|эликсир/i.test(b.title || '') &&
  (env.HP_POT_RE.test(b.title || '') || /ман[аиы]|mana|\bmp\b|elixir|еліксир|эликсир/i.test(b.title || ''));
const ready  = b => uiReady(b) && (potionSlot(b) || localCdLeft(b) <= 0) &&
  (!env.slotAction(b) || env.combatCooldown.skillWait(env.slotAction(b), (env.cdSpawn || env.battleSpawn)()) <= 0);

function cdLeft(b) {
  if (ready(b)) return 0;
  const v = uiReady(b) ? NaN : env.uiTimer(b);
  return Math.max(isNaN(v) ? 0 : v, potionSlot(b) ? 0 : localCdLeft(b), (env.slotAction(b) ? env.combatCooldown.skillWait(env.slotAction(b), (env.cdSpawn || env.battleSpawn)()) / 1000 : 0)) || 99;
}

async function rememberCd(b, how) {             // how: 'used' — нажат и ушёл в КД; 'cd' — игра сказала «на перезарядке»
  const k = env.skKey(b); if (!k) return;
  // Successful potions are gated by the server global cooldown, not Interlude reuse=10000.
  if (potionSlot(b)) {
    if (env.rt.cdUntil?.[k] || env.rt.skills?.[k]?.cdFloor || env.rt.skills?.[k]?.cd || env.rt.skills?.[k]?.cdNet) {
      const u = { ...(env.rt.cdUntil || {}) }, skills = { ...(env.rt.skills || {}) };
      delete u[k];
      if (skills[k]) skills[k] = { ...skills[k], cdFloor: 0, cd: 0, cdNet: 0 };
      await env.setRt({ cdUntil: u, skills });
    }
    return;
  }
  const now = Date.now(), use = { ...(env.rt.cdUse || {}) }, until = { ...(env.rt.cdUntil || {}) };
  // «нижняя граница» КД: игра ответила «на перезарядке» через N с после прошлого нажатия ⇒ КД ≥ N с.
  // (лог РБ 07.10: Focused Force/Атака жались раньше времени 35 раз — кнопка уже «готова», а игра — нет)
  let floor = now - (env.rt.skills?.[k]?.cdFloorAt || 0) < 30000 ? (env.rt.skills?.[k]?.cdFloor || 0) : 0;
  // v5.5.1: для атаки «нижнюю границу» не учим — нажатие атаки в use[] не пишется, и граница считалась от старого нажатия
  // (росла до 4–6 с: с луком бот стрелял раз в ~5 с). Темп атаки теперь берётся из ответа сервера (ATK_NET)
  if (env.slotKind(b) === 'атака') {
    if (env.rt.skills?.[k]?.cdFloor) await env.setRt({ skills: { ...env.rt.skills, [k]: { ...env.rt.skills[k], cdFloor: 0 } } });
    if (how === 'cd' && !(env.ATK_NET && Date.now() - env.ATK_NET.t < 1500)) { until[k] = now + 300; await env.setRt({ cdUntil: until }); }   // сервер молчит — короткая пауза
    return;
  }
  if (how === 'cd' && use[k] && now - use[k] < 30000 && (now - use[k]) / 1000 + 0.3 > floor) {
    floor = Math.min(30, (now - use[k]) / 1000 + 0.3);
    await env.setRt({ skills: { ...(env.rt.skills || {}), [k]: { ...(env.rt.skills?.[k] || {}), cdFloor: +floor.toFixed(1), cdFloorAt: now } } });
  }
  if (how === 'used' && env.slotKind(b) === 'атака' && !floor) return;   // атака: готовность видна по кнопке, память — только если игра «спорила»
  const meas = (env.rt.skills?.[k]?.cd || 0) * 1000, net = (env.rt.skills?.[k]?.cdNet || 0) * 1000;
  // v5.5.5: откат, который назвал сервер (cdNet), важнее справочника Interlude (Spoil: справочник 10 с, в игре отката нет)
  const learned = net || Math.max(meas, floor * 1000); // observed game only; Interlude reuse is not authoritative
  if (env.SK_NET[k] && now - env.SK_NET[k] < 2500) { if (how === 'used') { use[k] = now; await env.setRt({ cdUse: use }); } return; }   // сервер только что сказал точное время
  if (how === 'used') {
    overlayReadySeen.delete(b);
    const tv = uiReady(b) ? NaN : env.uiTimer(b);
    const ms = Math.max(isNaN(tv) ? 0 : tv * 1000, learned);
    use[k] = now;
    until[k] = ms > 0 ? now + ms + 150 : 0;
  } else {
    const fromLast = use[k] && learned ? use[k] + learned + 300 : 0;
    until[k] = Math.max(fromLast, now + Math.max(250, learned ? learned * 0.2 : 500));
  }
  for (const x in until) if (until[x] < now - 60000) delete until[x];
  await env.setRt({ cdUse: use, cdUntil: until });
}

// Mage/summoner profile is opt-in until profession metadata is available.
// Only observed hotbar actions can enter the offensive rotation.
// Future Warlock skills: never feed summon, servitor, cubic or personal
// maintenance buttons into a direct-damage slot, even without IL metadata.
function nonOffenseSkill(b) {
  if (!b) return true;
  const il = env.ilOf(b) || {};
  if (il.c === 'Призыв' || il.t === 'SUMMON' || il.target === 'PET' || il.o === 'PASSIVE' || il.o === 'TOGGLE') return true;
  const n = env.cleanTitle(b.title || '').toLowerCase();
  return /^(?:summon\b|mass summon\b|servitor\b|warrior servitor\b|final servitor\b|transfer pain\b|arcane agility\b|cubic mastery\b|mage bane\b|warrior bane\b|skill mastery\b|spell force\b|heal\b|battle heal\b|servitor bless)/i.test(n);
}

const petNote = { name: '', t: 0 }, emptyPanel = { since: 0, last: 0, logT: 0 };

// ---------- 7.1.31: кот Warlock — замер урона, статистика по котам, добивание с учётом кота, баффы кота ----------
// Удары слуги в логе боя (лог 10.10 19:35–19:45, Kai the Cat Lv.3: 150 ударов ≈1300–1670, 4 крита, 30 промахов из 184):
//   «Слуга [Kai the Cat] атакує [Unicorn] 1 409 урону.» · «Слуга [Kai the Cat] завдає критичного удару [Valley Treant Elder] 5 721 урону.»
//   «Слуга [Kai the Cat] промахнувся…». Кот бьёт «разом із власником» — на каждое действие хозяина (в т. ч. на бесплатную «Атаку»)
const PET_HIT_RE = /^(?:Слуга|Servitor)\s*\[([^\]]+)\]\s*(атаку[єе]|завда[єе]\s+критичн\S*\s+удар\S*|наносит\s+критическ\S*\s+удар\S*)\s*\[[^\]]*\][^\d]*?(\d[\d\s  ]*)\s*урон/i;
const PET_MISS_RE = /^(?:Слуга|Servitor)\s*\[([^\]]+)\]\s*промахну/i;
const petKeyOf = n => String(n || '').trim().toLowerCase().replace(/\s+/g, '_');
function petHits(lines) {
  return (lines || []).map(l => {
    const t = String(l), m = t.match(PET_HIT_RE);
    if (m) return { name: m[1].trim(), dmg: +m[3].replace(/\D/g, '') || 0, crit: /критич/i.test(m[2]), miss: false };
    const x = t.match(PET_MISS_RE);
    return x ? { name: x[1].trim(), dmg: 0, crit: false, miss: true } : null;
  }).filter(h => h && (h.miss || h.dmg > 0));
}
// новые удары кота в логе с прошлого вызова — в счётчик текущего боя (обычные удары, криты, промахи — раздельно)
function petTick(ctx) {
  if (!ctx.pet) return;
  const cur = env.logLines(), fresh = env.newLines(ctx.petLines || ctx.logStart || [], cur);
  ctx.petLines = cur;
  for (const h of petHits(fresh)) {
    const p = ctx.pet; p.name = h.name; p.key = petKeyOf(h.name);
    if (h.miss) p.misses = (p.misses || 0) + 1;
    else if (h.crit) { p.crits = (p.crits || 0) + 1; p.dmg += h.dmg; }
    else { p.hits++; p.dmg += h.dmg; p.hitDmg = (p.hitDmg || 0) + h.dmg; }
  }
}
// кот жив: свежий ответ сервера (activeSummon), иначе шапка «Активний слуга» (#l2-hud-companion: «Kai the CatLv.3HP1 880/1 880…»)
function petAlive() {
  const P = env.petState?.();
  if (P && Date.now() - (P.t || 0) < 20000) return !!P.has && !(P.maxHp && P.hp <= 0);
  const box = env.$q('#l2-hud-companion'), m = box && env.shown(box) ? box.textContent.replace(/\s+/g, '').match(/HP(\d+)\/(\d+)/i) : null;
  return !!m && +m[1] > 0;
}
// сколько кот снимет за следующее действие хозяина: средний ОБЫЧНЫЙ удар (криты — случайность, не в счёт; текущего боя, если уже
// ≥ 2 удара) × 0,85 (самый слабый удар в логе ≈0,87 среднего). Только если кот действует почти на каждое действие хозяина (≥ 80 %),
// промахивается не чаще 25 % (в логе 16 %) и замеров ≥ 5 — иначе 0 (на кота не рассчитываем)
function petExpect(ctx) {
  if (!petAlive()) return 0;
  const P = env.petState?.(), k = P?.key || ctx?.pet?.key || '', S = env.rt.petStat?.[k] || {}, c = ctx?.pet || {};
  const sum = f => (S[f] || 0) + (c[f] || 0);
  const hits = sum('hits'), acts = sum('acts'), swings = hits + sum('crits') + sum('misses');
  if (hits < 5 || acts < 5 || swings / acts < 0.8 || sum('misses') / swings > 0.25) return 0;
  const avg = c.hits >= 2 ? (c.hitDmg || 0) / c.hits : sum('hitDmg') / hits;
  return avg > 0 ? avg * 0.85 : 0;
}
// рекомендация «какого кота держать»: урон кота за действие хозяина с поправкой на ходы, потраченные на призыв/перепризыв.
// Сравниваем только котов с ≥ 30 боями; разница < 10 % — «почти равны». Уровни героя показываем: кот сильнее с M.Atk хозяина
function petAdvice(S) {
  const MIN = 30;
  const rows = Object.entries(S || {}).map(([k, s]) => {
    const per = s.acts ? s.dmg / s.acts : 0, cost = s.acts ? ((s.summons || 0) + (s.resummons || 0)) / s.acts : 0;
    return { k, name: s.name || k, n: s.fights || 0, score: per * Math.max(0, 1 - cost), lv: s.lvMin && s.lvMax ? (s.lvMin === s.lvMax ? `${s.lvMin} ур.` : `${s.lvMin}–${s.lvMax} ур.`) : '' };
  });
  const ok = rows.filter(r => r.n >= MIN).sort((a, b) => b.score - a.score);
  if (!ok.length) {
    const top = rows.sort((a, b) => b.n - a.n)[0];
    return { best: '', text: top ? `мало данных: ${top.name} — ${top.n}/${MIN} боёв` : 'кот ещё не замерен' };
  }
  if (ok.length === 1) return { best: ok[0].k, text: `замерен только ${ok[0].name} (${ok[0].n} боёв${ok[0].lv ? ', ' + ok[0].lv : ''}). Для сравнения призови другого кота на ~${MIN} боёв` };
  const [a, b] = ok, gain = b.score > 0 ? a.score / b.score - 1 : 1;
  const lv = a.lv && b.lv && a.lv !== b.lv ? ` (замеры на разных уровнях: ${a.name} ${a.lv}, ${b.name} ${b.lv} — сравнение примерное)` : '';
  return gain >= 0.1
    ? { best: a.k, text: `держи ${a.name}: урона за ход ≈${Math.round(a.score)} против ≈${Math.round(b.score)} у ${b.name} (+${Math.round(gain * 100)} %)${lv}` }
    : { best: '', text: `${a.name} и ${b.name} почти равны (разница ${Math.round(gain * 100)} %) — держи любого${lv}` };
}
// итог боя → rt.petStat[кот]. Больше 2000 боёв — счётчики пополам (свежие замеры весят больше: ранг кота и M.Atk растут)
async function petFlush(ctx, dealt) {
  const p = ctx.pet;
  if (!p || (!p.hits && !p.crits && !p.misses && !p.deaths && !p.summons && !p.resummons)) return;
  const k = p.key || env.petState?.()?.key || ''; if (!k) return;
  const S = { ...(env.rt.petStat || {}) };
  const F = ['fights', 'hits', 'hitDmg', 'crits', 'misses', 'dmg', 'acts', 'dealt', 'deaths', 'summons', 'resummons'];
  let s = { name: '', ...Object.fromEntries(F.map(f => [f, 0])), ...(S[k] || {}) };
  if (s.fights >= 2000) for (const f of F) s[f] = Math.round((s[f] || 0) / 2);
  const lv = env.heroLvl?.() || 0, swung = (p.hits || 0) + (p.crits || 0) + (p.misses || 0);
  s = { ...s, ...Object.fromEntries(F.filter(f => f !== 'fights' && f !== 'dealt').map(f => [f, (s[f] || 0) + (p[f] || 0)])),
    name: p.name || s.name || k.replace(/_/g, ' '), fights: s.fights + 1, dealt: s.dealt + (swung && dealt > 0 ? dealt : 0), t: Date.now(),
    ...(lv ? { lvMin: Math.min(s.lvMin || lv, lv), lvMax: Math.max(s.lvMax || 0, lv) } : {}) };
  S[k] = s;
  await env.setRt({ petStat: S, petAdvice: petAdvice(S) });
}
// бафф кота (роль «Баффы кота»): кот жив, моб не при смерти (на бафф уходит ход), MP хватает с запасом. Бафф держится dur с
// (справочник, иначе petBuffSec = 1200) и слетает при новом призыве/смерти кота (rt.petBornT). «В бою эффекта нет» — никогда
function petBuffPick(ctx, me, mp, mob) {
  const list = env.names(env.cfg.nPetBuffs || '');
  if (!list.length || env.cfg.petBuffAuto === false) return null;
  const now = Date.now();
  if (!petAlive()) return null;
  if (me && me.pct <= (env.cfg.hpPotAt ?? 50)) return null;
  if (mob && !ctx.rb && mob.cur < 2 * (spellAvg() + petExpect(ctx))) return null;   // осталось < 2 ходов — бафф в следующем бою
  for (const n of list) {
    const b = slotsBy(n)[0];
    if (!b || env.noEffect?.(b) || !ready(b) || (ctx.block['petbuff:' + n] || 0) > now) continue;
    const at = (env.rt.petBuffAt || {})[n] || 0, dur = ((env.ilOf(b) || {}).dur || env.cfg.petBuffSec || 1200) * 1000;
    if (at > (env.rt.petBornT || 0) && now - at < dur - 5000) continue;
    const reserve = mp?.max ? mp.max * (env.cfg.mageMpPct ?? 25) / 100 : 0;
    if (mp && mp.cur < (env.skillMp(env.cleanTitle(b.title)) || 0) + reserve) continue;
    return { b, n };
  }
  return null;
}

// Вернуть банку на панель боя: пустой слот → вкладка «Розхідники» → банка с наибольшим запасом нужного вида
async function potSlotRestore(kind) {
  const tk = kind + 'PotFixT', now = Date.now();
  if (now - (env.rt[tk] || 0) < 120000) return false;
  env.rt[tk] = now; env.setRt({ [tk]: now });   // 7.1.30: пауза переживает перезагрузку страницы боя
  const want = kind === 'mp' ? /зілля мани|зелье маны|mana potion/i : /^(?:зілля зцілення|зелье исцеления|healing potion|greater healing potion|зілля сильного зцілення)/i;
  const pref = kind === 'mp' ? /велик|больш|greater/i : /^(?:зілля зцілення|зелье исцеления|healing potion)\b/i;
  const label = kind === 'mp' ? 'маны' : 'HP';
  const warn = why => { if (now - (env.rt[kind + 'PotWarnT'] || 0) > 1800000) { env.rt[kind + 'PotWarnT'] = now; env.setRt({ [kind + 'PotWarnT']: now }); env.rec('B', 'внимание', `банки ${label} нет на панели боя — ${why}`); } return false; };
  const empty = [...document.querySelectorAll('.l2-battle-hotbar-slot--empty')].find(b => env.shown(b));
  if (!empty) return warn('свободного слота нет, поставь банку вручную');
  const slotNm = (empty.title || '').match(/слот \d+/)?.[0] || 'пустой слот';
  const close = async () => { const c = env.$q('#l2-bh-modal-close'); if (c && env.shown(c)) { env.fire(c); await env.sleep(300); } };
  env.fire(empty);
  if (!(await env.waitFor(() => env.$q('.l2-battle-hotbar-modal #l2-bh-modal-tabs') ? 1 : null, 3000, 100))) { await close(); return warn('окно выбора слота не открылось'); }
  const tab = env.$q('.l2-battle-hotbar-tab[data-tab-key="consumable"]');
  if (tab && !tab.classList.contains('l2-battle-hotbar-tab--on')) { env.fire(tab); await env.sleep(400); }
  await env.waitFor(() => document.querySelector('.l2-battle-hotbar-pick') ? 1 : null, 2000, 100);
  const qtyOf = b => +((b.title || '').match(/×\s*([\d\s]+)$/)?.[1] || '0').replace(/\D/g, '');
  const picks = [...document.querySelectorAll('.l2-battle-hotbar-pick')].filter(b => want.test(b.title || '') && qtyOf(b) > 0)
    .sort((a, b) => (pref.test(b.title) ? 1 : 0) - (pref.test(a.title) ? 1 : 0) || qtyOf(b) - qtyOf(a));
  if (!picks.length) { await close(); return warn('в сумке их тоже нет (докупит магазин)'); }
  const pk = picks[0], nm = (pk.title || '').replace(/\s*×.*$/, '');
  env.fire(pk);
  const ok = await env.waitFor(() => !env.shown(env.$q('.l2-battle-hotbar-modal__panel')) || !empty.isConnected || !empty.classList.contains('l2-battle-hotbar-slot--empty') ? 1 : null, 3000, 100);
  await close();
  env.rec('B', 'панель', ok ? `банка ${label} кончилась на панели — поставил «${nm}» (×${qtyOf(pk)}) в ${slotNm}` : `не удалось поставить «${nm}» на панель`);
  return !!ok;
}

function mageCombat() { return env.combatProfileKind?.() === 'mage_summoner'; }

// ---------- дебаффы мага: по механике L2WAP и по ЗАМЕРУ выгоды (7.2.1) ----------
// L2WAP (скрин магистра 10.10): Surrender to Fire = M.Def −10 %, Curse Chaos = M.Def −10 % и P.Atk −12 %, Curse Weakness = P.Atk −20 % на 10 с,
// Curse Poison = P.Atk −12 %. Атакующие (M.Def) прибавляют урон только заклинаниям мага (кот бьёт физикой), защитные (P.Atk) — моб бьёт слабее.
// Логи 10.10: чемпионы с 2 дебаффами — 6,5 с и ДПС 832, без дебаффов — 4,6 с и ДПС 1268 (Blaze по чемпиону под дебаффами 1447, без — 1535):
// на коротком бою ход на дебафф только теряется. Поэтому:
//  • атакующий — если по HP моба (с ударом кота) бою осталось ≥ N действий, N = 1 / (прибавка − 1) по замеру (без замера — debuffMinActs, 10); РБ — всегда;
//  • бот САМ меряет прибавку: в долгом бою сперва 2 заклинания без дебаффа, потом дебафф — урон тех же заклинаний по той же цели до/после
//    (rt.debuffGain — последние 30 отношений). Замер показал < +3 % — атакующие дебаффы выключены (кроме режима «каждый моб»);
//  • защитный — на РБ или когда героя реально бьют (HP < 70 %), с обновлением по длительности (Weakness — 10 с);
//  • не прошёл («опір», «не пройшов») — цель не считается обработанной; из 6+ попыток прошло < 30 % — дебафф на час выключен.
const dbfIl = b => { const il = env.ilOf(b) || {}; return { ...il, off: il.st === 'mDefDown', def: il.st === 'pAtkDown' || il.st2 === 'pAtkDown' }; };
function dbfOn(ctx) {                                      // атакующий дебафф (M.Def) сейчас висит на цели
  const now = Date.now();
  return Object.entries(ctx?.debuffed || {}).some(([k, t]) => { const il = dbfIl(k); return il.off && now - t < (il.dur || 15) * 1000; });
}
// урон заклинания в этом бою — с M.Def-дебаффом и без (зовётся из observeSlot ядра)
function spellSample(ctx, key, dmg) {
  if (!ctx || !(dmg > 0) || !key) return;
  const s = ((ctx.spellDmg ||= {})[key] ||= { off: [0, 0], on: [0, 0] }), w = dbfOn(ctx) ? s.on : s.off;
  w[0] += dmg; w[1]++;
}
// итог боя: отношение «под дебаффом / без» по каждому заклинанию, где есть оба замера → rt.debuffGain
async function debuffGainFlush(ctx) {
  const r = Object.values(ctx?.spellDmg || {}).filter(s => s.off[1] && s.on[1]).map(s => (s.on[0] / s.on[1]) / (s.off[0] / s.off[1]));
  if (!r.length) return;
  const all = [...(env.rt.debuffGain || []), ...r.map(x => Math.round(x * 1000) / 1000)].slice(-30);
  await env.setRt({ debuffGain: all });
  const g = debuffGain();
  if (g) env.rec('B', 'дебафф', `замер выгоды: урон заклинаний под M.Def-дебаффом ×${g.ratio.toFixed(2)} (${g.n} замеров) → ${g.ratio < 1.03 ? 'прибавки нет — атакующие дебаффы выключены' : 'окупается, если бою ещё ≥ ' + g.minActs + ' действий'}`);
}
function debuffGain() {                                   // медиана отношений; null — замеров меньше 6
  const a = [...(env.rt.debuffGain || [])].filter(x => x > 0).sort((x, y) => x - y);
  if (a.length < 6) return null;
  const ratio = a[a.length >> 1];
  return { ratio, n: a.length, minActs: ratio > 1.001 ? Math.ceil(1 / (ratio - 1)) + 1 : Infinity };
}
function debuffPlan(ctx, mp, me) {
  if (env.cfg.debuffAuto === false) return null;
  const mob = mobHp(); if (!mob || mob.cur <= 0) return null;
  const avg = spellAvg(), mode = env.cfg.debuffMode || 'auto', g = debuffGain();
  const actsLeft = mob.cur / Math.max(1, avg + petExpect(ctx));
  const needActs = g ? g.minActs : (env.cfg.debuffMinActs ?? 10);
  const noGain = !!g && g.ratio < 1.03 && mode !== 'always';                 // замер: прибавки нет
  const longFight = actsLeft >= needActs, boss = !!(ctx.rb || ctx.champ), hurt = !!me && me.pct < 70;
  // на РБ без замера — сперва 2 заклинания без дебаффа (чтобы было с чем сравнить), потом дебафф
  const offSamples = Object.values(ctx.spellDmg || {}).reduce((s, x) => s + x.off[1], 0);
  const learnWait = !g && !!ctx.rb && offSamples < 2;
  const offOk = !noGain && !learnWait && (mode !== 'auto' || longFight || !!ctx.rb);
  if (mode === 'boss' ? !boss : !offOk && !hurt && !ctx.rb) return null;
  const list = env.names(env.cfg.nDebuff || '');            // свой список в «Бой → Дебаффы»: только они, в этом порядке
  const stat = env.rt.debuffStat || {}, now = Date.now();
  const opts = [...document.querySelectorAll(env.SLOT)].filter(b => env.slotKind(b) === 'скилл' && env.ilOf(b)?.c === 'Дебафф' && ready(b)).map(b => {
    const il = dbfIl(b), n = env.cleanTitle(b.title), k = n.toLowerCase(), s = stat[k] || {};
    const defOk = !!ctx.rb || hurt || (mode !== 'auto' && boss);
    let pr = 0;
    if (il.off && il.def) pr = offOk ? 95 : defOk ? 70 : 0;      // Curse Chaos: и урон, и защита
    else if (il.off) pr = offOk ? 90 : 0;                       // Surrender to Fire
    else if (il.def) pr = defOk ? (/weakness/i.test(k) ? 75 : 60) : 0;   // Curse Weakness (−20 %) раньше Poison (−12 %)
    else if (il.t === 'POISON') pr = ctx.rb ? 30 : 0;
    else pr = ctx.rb && !/^slow\b/i.test(k) ? 20 : 0;          // прочие — только РБ; Slow (скорость) в пошаговом бою не нужен
    if (list.length) pr = list.includes(k) && (pr > 0 || mode === 'always') ? 100 - list.indexOf(k) : 0;
    if (s.offUntil > now || (ctx.block['debuff:' + k] || 0) > now) pr = 0;
    const last = (ctx.debuffed || {})[k] || 0, dur = (il.dur || 15) * 1000;
    if (last && !(ctx.rb || mob.cur >= avg * 6)) pr = 0;          // обычный моб — один раз
    if (last && now - last < dur) pr = 0;
    if (mp && mp.cur < (env.skillMp(n) || 10) + 30) pr = 0;       // мана — сначала на урон
    return { b, n, k, pr };
  }).filter(o => o.pr > 0).sort((a, b) => b.pr - a.pr);
  return opts[0] || null;
}

// средний замеренный урон заклинаний с панели (≥ 2 замера), без замеров — 600
function spellAvg() {
  const known = mageSpellSlots().map(b => env.rt.skills?.[env.cleanTitle(b.title).toLowerCase()]).filter(p => p?.dmgN >= 2).map(p => p.dmg / p.dmgN);
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : 600;
}

function mageSpellSlots() {
  // Only confirmed direct-damage magic or a skill with measured positive damage.
  // Never click summoning, healing, support or unknown abilities as attacks.
  return [...document.querySelectorAll(env.SLOT)].filter(b => {
    if (!b || env.slotKind(b) !== 'скилл' || env.isEquip(b) || nonOffenseSkill(b)) return false;
    const il = env.ilOf(b) || {}, n = env.cleanTitle(b.title || '');
    // 7.1.31 (скрин магистра 10.10): Corpse Life Drain на L2WAP лечит («Power 0»), урона нет; по справочнику — «Маг. атака» по трупу.
    // Не в ротацию: цель-труп, «в бою эффекта нет», или 5+ нажатий без единого замера урона
    if (il.target === 'CORPSE_MOB' || /труп моба/.test(il.L || '') || env.noEffect?.(b)) return false;
    const p = env.rt.skills?.[n.toLowerCase()];
    if (p && (p.uses || 0) >= 5 && !p.dmgN) return false;
    if (il.c && il.c !== 'Маг. атака' && il.t !== 'MDAM' && il.t !== 'MDAMDOT') return false;
    return il.c === 'Маг. атака' || il.t === 'MDAM' || il.t === 'MDAMDOT' ||
      ((env.rt.skills?.[n.toLowerCase()]?.dmgN || 0) >= 2 && !il.c);
  });
}

function magePlan(ctx, mp) {
  const mob = mobHp(), hp = mob?.cur || Infinity;
  // 7.1.16-fix: у моба осталось меньше, чем снимает обычная атака (лог 09.10: атака мага 80–84, а на 1–4 HP тратилось заклинание) —
  // добиваем атакой. И если маны нет совсем (банки нет/на откате) — атака лучше, чем стоять
  const atk = [...document.querySelectorAll(env.SLOT)].find(b => env.slotKind(b) === 'атака' && ready(b) && (ctx.block.attack || 0) <= Date.now());
  // только по реальному замеру атаки (≥ 3 удара): без замера expDmg даёт 600 по умолчанию, и бот бил атакой (1 урон) по мобу с 134 HP
  const aS = env.rt.skills?.['атака'], atkD = aS?.dmgN >= 3 ? aS.dmg / aS.dmgN : 0;
  if (atk && mob && mob.cur > 0 && atkD > 0 && mob.cur <= atkD * 0.8 && !ctx.rb)
    return { key: 'attack', name: 'атака', b: atk, dmg: atkD, why: `магия: добиваю атакой (${mob.cur} HP ≤ атака ≈${Math.round(atkD)})` };
  // 7.1.31 (просьба игрока): кот бьёт вместе с хозяином (Kai Lv.3 ≈1500). Моб умрёт от удара кота — жмём бесплатную «Атаку»
  // (кот ударит с ней), заклинание за 22 MP не тратим. Атака на откате — ниже «добивание» само возьмёт самое дешёвое заклинание.
  // Только когда мана тратится (MP < petFinishMp, 80 %): кот промахивается ≈16 % (лог 10.10 19:35–19:45) — при полной мане
  // сэкономленные MP всё равно сгорят на регене, а промах кота стоил бы лишнего хода.
  // По умолчанию ВЫКЛ (просьба игрока: банки MP дешёвые, MP не экономим — важен ДПС). Включить: «Слуга → Учитывать удар кота при добивании»
  const mpLow = !mp?.max || mp.cur / mp.max * 100 < (env.cfg.petFinishMp ?? 80);
  const petN = env.cfg.petFinish === true && !ctx.rb && mpLow ? petExpect(ctx) : 0;
  if (atk && mob && mob.cur > 0 && petN > 0 && mob.cur <= petN)
    return { key: 'attack', name: 'атака', b: atk, dmg: petN, pet: true, why: `кот добьёт (${mob.cur} HP ≤ удар кота ≈${Math.round(petN)}) — бесплатная атака` };
  // 7.1.30 (ночь 09→10.10): 75 % времени боя маг сидел почти без MP (банки на панели не было) и бил атакой по 1 урону.
  // Реген ≈7 MP/с — когда мана кончилась, урон упирается в «урон за 1 MP»: Energy Bolt ≈60/MP против Blaze ≈35/MP.
  // Поэтому: банки нет и MP < mageEcoPct (30 %) — режим экономии: заклинание с лучшим уроном на 1 MP; ниже порога
  // skillMpMin — всё равно колдуем, если хватает на самое дешёвое (атака мага по мобам ≈0)
  const potB = env.mpPotSlot?.(), potOk = !!(potB && ready(potB) && env.qty(potB) !== 0);
  const eco = !!mp && !potOk && mp.max > 0 && mp.cur / mp.max * 100 < (env.cfg.mageEcoPct ?? 30);
  if (mp && mp.cur < (env.cfg.skillMpMin ?? 35)) {
    const cheap = Math.min(Infinity, ...mageSpellSlots().filter(ready).map(b => {
      const il = env.ilOf(b) || {}; return env.skillMp(env.cleanTitle(b.title)) || (Array.isArray(il.mp) ? il.mp[0] : il.mp) || 30; }));
    if (!(cheap <= mp.cur - 1)) {
      if (potOk) return null;                     // 7.1.30: ни на что не хватает, банка есть — её выпьет блок банок
      if (atk && mob && mob.cur > 0) return { key: 'attack', name: 'атака', b: atk, dmg: atkD, why: `магия: MP ${mp.cur} — нет маны, бью атакой` };
      return null;
    }
  }
  const priority = env.names(env.cfg.nPower || '');
  const opts = mageSpellSlots().filter(b => ready(b) && (ctx.block['power:' + b.title] || 0) <= Date.now())
    .map(b => {
      const n = env.cleanTitle(b.title), il = env.ilOf(b) || {}, k = env.skKey(b);
      const mpCost = env.skillMp(n) || (Array.isArray(il.mp) ? il.mp[0] : il.mp) || 0;
      const dmg = env.expDmg(k) || env.expDmg(n) || 0;
      const base = Array.isArray(il.pow) ? il.pow[0] : il.pow || 0;
      return { key:'power:' + b.title, name:n, b, dmg:dmg || base, mpCost,
        cd: env.rt.skills?.[k]?.cdNet || env.rt.skills?.[k]?.cd || (il.reuse || 5000)/1000,
        order:priority.indexOf(n.toLowerCase()) };
    }).filter(o => !mp || o.mpCost <= Math.max(0, mp.cur - 1));
  if (!opts.length) return null;
  // 7.1.16-fix: новые заклинания — учим в игре. Урон/КД/MP в L2WAP не как в Interlude, а без замера бот брал
  // «≈900 по умолчанию» и мог считать новое заклинание добивающим. Заклинание с < 3 замерами сначала пробуется на «толстом»
  // мобе (HP заметно больше любого известного удара — чтобы урон не обрезался смертью моба), затем встаёт в очередь по замеру
  const meas = o => env.rt.skills?.[o.name.toLowerCase()]?.dmgN || 0;
  const known = opts.filter(o => meas(o) >= 3), maxKnown = Math.max(0, ...known.map(o => o.dmg));
  if (env.cfg.mageProbe !== false && !ctx.rb && mob && mob.cur > 0) {
    const probe = opts.filter(o => meas(o) < 3).sort((a, b) => meas(a) - meas(b) || a.mpCost - b.mpCost)[0];
    if (probe && hp > Math.max(maxKnown, 300) * 1.3) return { ...probe, probe: true, why: `магия: пробую новое заклинание (замер ${meas(probe)}/3)` };
  }
  // Cheap finishing move > observed damage per cast > configured order.
  // 7.1.31: удар кота в этом же ходу — часть добивания: заклинанию нужно снять только остаток (Energy Bolt 8 MP вместо Blaze 22 MP)
  const hpK = Math.max(1, hp - petN);
  const kill = (known.length ? known : opts).filter(o => o.dmg && o.dmg >= hpK * 1.08)
    .sort((a,b)=>a.mpCost-b.mpCost || b.dmg-a.dmg)[0];
  if (kill) return { ...kill, why: petN > 0 && hpK < hp ? `магия: добивание вместе с котом (${hp} HP, кот ≈${Math.round(petN)})` : `магия: добивание (${hp} HP)` };
  if (eco) {
    const per = o => o.dmg / Math.max(1, o.mpCost);
    const e = opts.sort((a, b) => per(b) - per(a) || b.dmg - a.dmg)[0];
    return { ...e, why: `магия: экономия MP (${mp.cur}/${mp.max}, банки нет) · ≈${Math.round(per(e))} урона/MP` };
  }
  const best = opts.sort((a,b) => b.dmg-a.dmg || b.cd-a.cd ||
    (a.order === -1 ? 999 : a.order)-(b.order === -1 ? 999 : b.order))[0];
  return { ...best, why:`магия: цепочка · урон ≈${Math.round(best.dmg)}` };
}

function dpsPlan(ctx, mp) {
  const free = k => (ctx.block[k] || 0) <= Date.now();
  const mpOk = !mp || mp.cur >= env.cfg.skillMpMin;
  const hp = mobHp()?.cur || 0, fN = env.forceNow();
  const opts = [];
  const atk = mageCombat() ? null : slotsBy(env.cfg.nAttack).find(ready);
  if (atk && free('attack')) opts.push({ key: 'attack', name: 'атака', b: atk, dmg: env.expDmg('атака'), cd: 0 });
  if (mpOk) {
    for (const n of env.names(env.cfg.nPower).filter(n => !env.names(env.cfg.nUltra).includes(n))) {   // v5.3: сверхсильные — только через ultPick
      const b = slotsBy(n)[0];
      const il = b && env.ilOf(b);
      if (nonOffenseSkill(b)) continue;
      if (!b || !ready(b) || !free('power:' + b.title) || env.isChargeName(env.cleanTitle(b.title)) || env.isForceName(env.cleanTitle(b.title))) continue;
      opts.push({ key: 'power:' + b.title, name: env.cleanTitle(b.title), b, dmg: env.expDmg(env.skKey(b)), cd: env.rt.skills?.[env.skKey(b)]?.cd || env.rt.skillDb?.[env.skKey(b)]?.cd || (env.ilOf(b)?.reuse || 5000) / 1000 });
    }
    for (const c of env.forceCosts()) {
      const b = slotsBy(c.name)[0], k = c.name.toLowerCase();
      if (!b || !ready(b) || !free('force:' + c.name) || fN < c.cost) continue;
      opts.push({ key: 'force:' + c.name, name: `${c.name} (−${c.cost} эн.)`, b, dmg: env.expDmg(c.name), force: c.cost, cost: c.cost,
                  cd: env.rt.skills?.[k]?.cd || env.rt.skillDb?.[k]?.cd || 10 });
    }
  }
  // RB: prefer major single-target damage on cooldown. Respect existing configured roles,
  // but recognize these three skills from hotbar when autoRoles did not fill nPower.
  if (ctx.rb && mpOk) for (const n of ['Burning Fist', 'Soul Breaker', 'Iron Punch']) {
    const b = slotsBy(n)[0];
    if (!b || !ready(b) || !free('power:' + b.title) || opts.some(o => o.b === b)) continue;
    if (mp && mp.cur < (env.skillMp(n) || 0) + 5) continue;
    opts.push({ key: 'power:' + b.title, name: env.cleanTitle(b.title), b,
      dmg: env.expDmg(env.skKey(b)) || env.expDmg(n) || 0,
      cd: env.rt.skills?.[env.skKey(b)]?.cd || (env.ilOf(b)?.reuse || 11000) / 1000 });
  }
  // РБ без банок MP: дорогие удары — только из излишка маны (см. longFightMp)
  const lf = env.longFightMp(ctx, mp, hp);
  let lfCut = '';
  if (lf && !lf.pots) {
    for (let i = opts.length - 1; i >= 0; i--) {
      const o = opts[i], n = o.name.replace(/\s*\(.*$/, '').toLowerCase();
      if (o.key === 'attack' || lf.cheap.has(n) || lf.capSoon || lf.free >= lf.costOf(n)) continue;
      lfCut = `${o.name.replace(/\s*\(.*$/, '')} — бережём MP (излишек ${Math.round(lf.free)})`; opts.splice(i, 1);
    }
  }
  ctx.lfHold = !!lfCut;
  const chargeB = env.names(env.cfg.nCharge).map(n => slotsBy(n)[0]).find(b => b && ready(b) && free('charge'));
  // v4.46 (симуляция 350 000 боёв): на РБ ход Focused Force проигрывает обычной атаке с вампиризмом — энергию не копим,
  // уже накопленную тратим (HA/FB). Побед при нехватке банок 26 % → 53 %, бой на 16 % быстрее, банок на 58 % меньше
  const rbDamageNames = ['Burning Fist', 'Soul Breaker', 'Iron Punch'];
  // cdLeft() returns SECONDS. Comparing it with 1500 (instead of 1.5) used
  // to suppress Focused Force for virtually every RB fight.
  const rbPowerSoon = ctx.rb && rbDamageNames.some(n => {
    const b = slotsBy(n)[0]; return b && cdLeft(b) < 1.5;
  });
  const canCharge = (!ctx.rb || (env.cfg.rbCharge !== false && !rbPowerSoon &&
    opts.every(o => !/burning fist|soul breaker|iron punch/i.test(o.name))))
    && env.cfg.fightMode !== 'kpd' && !!chargeB && (!env.forceMax() || fN < env.forceMax()) && env.forceCosts().some(c => slotsBy(c.name).length);
  const chargeAct = canCharge ? { key: 'charge', name: `${env.cleanTitle(chargeB.title)} (+1 эн., ${fN}→${fN + 1})`, b: chargeB, charge: true } : null;
  // v5.5: режим «КПД» (симуляция 1 008 000 боёв Тирана): моба добивает одна атака — бьём атакой (ждём её отката, скилл бережём);
  // энергию не копим. Темп −12 %, MP на моба −36 %, банок MP −53 %. «ДПС» (по умолчанию) — как было: самый быстрый
  if (env.cfg.fightMode === 'kpd' && !ctx.rb) {
    const aD = env.expDmg('атака');
    if (aD && aD * 0.85 >= hp) { const a0 = opts.find(o => o.key === 'attack'); if (a0) return { ...a0, why: `КПД: добиваю атакой (${hp} HP)` }; return null; }
  }
  // 1) добивание
  const kill = opts.filter(o => o.dmg * 0.85 >= hp).sort((a, b) => env.actCost(a) - env.actCost(b) || b.dmg - a.dmg)[0];
  if (kill) return { ...kill, why: `добивание (${hp} HP)` };
  if (ctx.rb) {
    const atkD = env.expDmg('атака'), me = env.meHp();
    // v4.46: на РБ — без скиллов с уроном < 1,6 атаки (Force Buster: урона почти как атака, а MP вдвое больше)
    for (let i = opts.length - 1; i >= 0; i--) if (opts[i].key !== 'attack' && !opts[i].force &&
      !/^(burning fist|soul breaker|iron punch)$/i.test(opts[i].name) &&
      atkD > 0 && opts[i].dmg < atkD * 1.6) opts.splice(i, 1);
    // v4.46: HP < 60 % — бьём обычной атакой: она лечит вампиризмом (~8 % урона), скиллы — нет
    const a0 = opts.find(o => o.key === 'attack');
    const availablePot = me && env.hpPotByDeficit(Math.max(0, me.max - me.cur));
    if (a0 && !mageCombat() && me && me.pct < (env.cfg.rbVampHp ?? 60) && !availablePot)
      return { ...a0, why: `HP ${me.pct | 0}% — банка недоступна, атака ради вампиризма` };
  }
  if (ctx.rb) {
    const major = opts.filter(o => /^(burning fist|soul breaker|iron punch)$/i.test(o.name))
      .sort((a,b)=>b.dmg-a.dmg);
    if (major.length) return { ...major[0], why: 'РБ: мощный скилл по готовности' };
  }
  // 2) один заряд до мощного удара, а цель не умрёт от атаки
  const spNear = env.forceCosts().map(c => ({ ...c, b: slotsBy(c.name)[0] })).find(c => c.b && fN + 1 === c.cost && cdLeft(c.b) <= env.turnSec() && mpOk
    && (!lf || lf.pots || lf.cheap.has(c.name.toLowerCase()) || lf.free > 0));
  if (chargeAct && spNear && hp > env.expDmg('атака') * 1.2) return { ...chargeAct, why: `ещё 1 заряд → ${spNear.name}` };
  // 2б) экономия маны: MP мало, а банки нет/на откате — оставляем только скиллы с лучшей отдачей
  //     «урон сверх обычной атаки на 1 MP» (атака бесплатна; Hurricane с 2 зарядами часто хуже Iron Punch)
  const mpMax = mp?.max || 0, potB = env.mpPotSlot(), potOk = !!potB && ready(potB);
  if (!lf && mp && mpMax && mp.cur < mpMax * 0.35 && !potOk && opts.length > 1) {
    const atkD = env.expDmg('атака'), effOf = o => o.key === 'attack' ? Infinity : (o.dmg - atkD * (1 + (o.force || 0))) / Math.max(1, env.skillMp(o.name));
    const bestEff = Math.max(0, ...opts.filter(o => o.key !== 'attack').map(effOf));
    for (let i = opts.length - 1; i >= 0; i--) if (opts[i].key !== 'attack' && effOf(opts[i]) < bestEff * 0.6) opts.splice(i, 1);
  }
  // 3) максимум урона из готового; рядом ещё мобы — массовые удары считаем с уроном по соседям
  const near = extraMobs().filter(x => x.cur > 0).length;
  const total = o => { const p = env.rt.skills?.[(o.name || '').replace(/\s*\(.*$/, '').toLowerCase()]; return o.dmg + (near && p?.aoe && p.splN ? p.spl / p.splN : 0); };
  const best = opts.sort((a, b) => total(b) - total(a) || (b.cd || 0) - (a.cd || 0))[0];   // при равенстве — скилл с КД (раньше откатится)
  // готова только атака, а заряд ценнее удара (моб сильно выше по уровню: атака 1–3 урона) — копим энергию
  if (best?.key === 'attack' && chargeAct) {
    const vE = env.chargeValue();
    if (vE > total(best) * 1.15) return { ...chargeAct, why: `заряд ценнее атаки (≈${Math.round(vE)} против ≈${Math.round(total(best))})` };
  }
  if (best) return { ...best, why: `урон ≈${Math.round(best.dmg)}${lf ? (lf.pots ? ' · MP с банками' : ` · ${ctx.rb ? 'РБ' : 'долгий бой'}: MP на ≈${Math.round(lf.Tr)} с`) : ''}` };
  // 4) всё на КД — копим энергию (РБ без банок: только под «дешёвый» удар или из излишка MP)
  if (chargeAct && (!lf || lf.pots || lf.free > 20 || lf.capSoon || env.forceCosts().some(c => lf.cheap.has(c.name.toLowerCase()) && fN < c.cost)))
    return { ...chargeAct, why: 'пауза КД — копим энергию' };
  if (lfCut) return null;                          // ждём атаку/дешёвый удар, мана копится
  return null;
}

function ultPick(ctx, mp) {
  const L = env.names(env.cfg.nUltra); if (!L.length) return null;
  const mob = mobHp(), me = env.meHp(), mode = env.cfg.ultMode || 'big';
  if (!mob || mob.cur <= 0) return null;
  const boss = !!(ctx.rb || ctx.champ);
  for (const n of L) {
    const b = slotsBy(n)[0]; const skillInfo = b && env.ilOf(b);
    if (nonOffenseSkill(b)) continue;
    if (!b || !ready(b) || (ctx.block['ult:' + b.title] || 0) > Date.now()) continue;
    const il = env.ilOf(b), hpCost = /HP −/.test(il?.L || '') || /of doom/i.test(n);
    // касты в l2wap мгновенные (между скиллами — общая задержка хода + свой откат), поэтому Vortex — такой же сверхсильный удар
    if (hpCost && (me?.pct ?? 100) < 40) continue;
    if (mp && mp.cur < (env.skillMp(env.cleanTitle(b.title)) || 0) + 5) continue;
    const dmg = env.expDmg(env.skKey(b)) || 0, atk = env.expDmg('атака') || 0;
    // урон удара ещё не замерен — тогда только по «толстым» по проценту: моб почти целый (≥ 60 %)
    const ok = mode === 'always' || boss || (mode === 'big' && (dmg ? mob.cur >= Math.max(dmg * 0.7, atk * 4) && (!mob.max || mob.cur / mob.max >= 0.3) : (!mob.max || mob.cur / mob.max >= 0.6) && mob.cur >= atk * 4));
    if (!ok) continue;
    return { key: 'ult:' + b.title, name: env.cleanTitle(b.title), b, why: boss ? 'сверхсильный — РБ/чемпион' : `сверхсильный — у моба ${mob.cur} HP` };
  }
  return null;
}

function frenzyDive(ctx, me) {                    // «сливаться под Frenzy»: Frenzy на панели, готов, не висит, HP ещё выше порога
  if (!env.cfg.rbFrenzyDive || !ctx.rb || !me) return false;
  const b = slotsBy('Frenzy')[0]; if (!b) return false;
  const lim = env.ilOf(b)?.pc?.hp || 30;
  return me.pct > lim && ready(b) && !env.buffActive('frenzy', b) && me.pct > (env.cfg.stopHp || 25);
}

function drainPick(ctx, mp) {                     // готовый скилл с поглощением HP из роли «Вампиризм» (порядок = приоритет)
  for (const n of env.names(env.cfg.nDrain)) {
    const b = slotsBy(n)[0];
    if (!b || !ready(b) || (ctx.block['drain:' + b.title] || 0) > Date.now()) continue;
    if (mp && mp.cur < (env.skillMp(env.cleanTitle(b.title)) || 0) + 5) continue;
    if (env.ilOf(b)?.L && /труп моба/.test(env.ilOf(b).L)) continue;      // Life Scavenge / Corpse Life Drain — только по трупу
    return b;
  }
  return null;
}

function chooseAction(ctx, mp) {
  if (mageCombat()) return magePlan(ctx, mp);
  const free = k => (ctx.block[k] || 0) <= Date.now();
  const mpOk = !mp || mp.cur >= env.cfg.skillMpMin;
  // силовые и станы — списки через запятую, порядок = приоритет (каждое название — отдельный скилл)
  const list = str => env.names(str).map(n => slotsBy(n)[0]).filter(Boolean);
  const powers = mpOk ? env.names(env.cfg.nPower).filter(n => !env.names(env.cfg.nUltra).includes(n)).map(n => slotsBy(n)[0]).filter(Boolean).filter(b => { const il = env.ilOf(b); return !nonOffenseSkill(b) && free('power:' + b.title); }) : [];
  const longFight = (mobHp()?.cur || 0) > env.expDmg('атака') * 2 + Math.max(0, ...powers.filter(ready).map(b => env.expDmg(env.skKey(b))));
  const stuns  = mpOk && ctx.champ && !ctx.rb && longFight && Date.now() - ctx.lastStun >= env.cfg.stunEvery * 1000
               ? list(env.cfg.nStun).filter(b => free('stun:' + b.title)) : [];
  const st = stuns.find(ready);
  const ult = ultPick(ctx, mp);                   // v5.3: 💥 сверхсильный скилл (Punch of Doom, Crush of Doom, Vortex…)
  if (ult) return ult;
  const plan = dpsPlan(ctx, mp);                 // расчёт ДПС: добивание / заряд / сильнейший готовый / копим энергию
  // стан (урон ~160) полезен, только когда больше нечем бить: урон и энергия для мощного удара важнее
  if (plan && (!st || !plan.charge || env.forceNow() < env.forceMax())) return plan;
  if (st) return { key: 'stun:' + st.title, name: 'стан', b: st, why: 'долгий бой, остальное на КД' };
  if (plan) return plan;
  if (ctx.rb) return null;                        // v4.46: на РБ — только план (без запасного Force Buster и т. п.), иначе ждём атаку
  if (env.cfg.fightMode === 'kpd' && env.expDmg('атака') * 0.85 >= (mobHp()?.cur || Infinity)) return null;   // КПД: ждём откат атаки
  if (ctx.lfHold) return null;                    // РБ без банок: дорогие удары придержаны ради маны — ждём атаку
  if (env.forceCosts().some(c => { const b = slotsBy(c.name)[0]; return b && env.forceNow() >= c.cost && cdLeft(b) <= 0.6; })) return null;
  const pw = powers.find(ready);
  if (pw) return { key: 'power:' + pw.title, name: pw.title, b: pw };
  if (powers.some(b => cdLeft(b) <= 0.6) || stuns.some(b => cdLeft(b) <= 0.6)) return null;   // вот-вот откатится — ждём
  const atk = slotsBy(env.cfg.nAttack).find(ready);
  if (free('attack') && atk) return { key: 'attack', name: 'атака', b: atk };
  return null;
}

async function hotbarRows3() {
  const hb = env.$q('.l2-battle-hotbar');
  if (!hb) return;
  const rows = () => document.querySelectorAll('.l2-battle-hotbar__row').length;
  const vis = () => +(hb.dataset.visibleRows || 0) || document.querySelectorAll('.l2-battle-hotbar__row:not([hidden])').length;
  for (let i = 0; i < 3 && vis() < Math.min(3, rows()); i++) {
    const down = env.$q('.l2-battle-hotbar__row-nav--down');
    if (!down || down.disabled) return;
    const v = vis();
    env.fire(down);
    await env.waitX(() => vis() > v, 1500, 50);
  }
  if (vis() >= 3 && !env.rt.rows3) { env.rec('B', 'панель', 'открыты все 3 ряда панели скиллов'); env.setRt({ rows3: 1 }); }
}

async function battle() {
  env.setStatus('Бой: загрузка');
  const bUrl = location.pathname + location.search;   // v4.43: экран поражения — на странице боя; после смерти вернёмся сюда
  if (env.rt.lastBattle !== bUrl) env.setRt({ lastBattle: bUrl });
  const st = await env.waitFor(() => env.serverDown() ? 'down' : victory() ? 'win' : defeat() ? 'dead' : loadErr() ? 'err' : mobHp() ? 'fight' : null, 10000);
  if (!env.on || st === 'down') return;
  if (!st) {                                     // не загрузилась — обновить (2 раза), потом на карту
    const n = (env.rt.battleReload || 0) + 1;
    await env.setRt({ battleReload: n });
    env.rec('B', 'бой', `страница боя не загрузилась за 10 с — ${n <= 2 ? `обновляю (${n}/2)` : 'ухожу на карту'}`);
    if (n <= 2) { location.reload(); await env.sleep(8000); return; }
    await env.setRt({ battleReload: 0 }); return env.toMap();
  }
  if (env.rt.battleReload) await env.setRt({ battleReload: 0 });
  if (st === 'dead') return env.onDeath();
  if (st === 'err') return env.toMap();
  await hotbarRows3();                           // все 3 ряда панели открыты — там могут быть нужные скиллы и банки
  if (st === 'win') return env.nextFight();                     // открыт уже экран победы
  const clickedAt = env.rt.mobClickAt, cameVia = env.rt.via;   // v5.6: запомнить ДО сброса — по ним видно, открыл ли бой бот/игрок или цепочка
  if (env.rt.bounce || env.rt.mobClickAt) await env.setRt({ bounce: 0, mobClickAt: 0 });   // бой открылся — счётчик петли сброшен

  // панель: инвентаризация (в журнал — при изменении) и автоназначение ролей
  const inv = env.panelInventory(), invSig = inv.map(x => x.idx + ':' + x.name).join('|');
  if (invSig !== env.rt.panelSig) {
    await env.setRt({ panel: inv, panelSig: invSig });
    env.rec('S', 'панель', inv.map(x => `#${x.idx} ${x.name} (${x.kind}${x.qty != null ? ' ×' + x.qty : ''})`).join(' · '));
  }
  await env.autoRoles();
  if (mageCombat()) {
    const pet = env.$q('#l2-hud-companion');
    const pn = pet && env.shown(pet) ? pet.textContent.trim().replace(/HP.*$/, '') : '';
    // 7.1.16-fix: раньше — запись в журнал каждый бой (95 строк за 15 мин); теперь при смене слуги или раз в 10 мин
    // 7.1.31 (лог 10.10 19:35–19:45: 29 записей за 10 мин): каждый бой — новая страница, память модуля обнулялась. Помним во вкладке
    try { const s = JSON.parse(sessionStorage.getItem('l2bot.petNote') || 'null'); if (s && !petNote.t) Object.assign(petNote, s); } catch (e) {}
    if (pn && (petNote.name !== pn || Date.now() - petNote.t > 600000)) { petNote.name = pn; petNote.t = Date.now(); try { sessionStorage.setItem('l2bot.petNote', JSON.stringify(petNote)); } catch (e) {} env.rec('B', 'питомец', 'Обнаружен питомец: ' + pet.textContent.trim().slice(0, 120)); }
  }
  // 7.1.30: банка кончилась — игра убирает её слот с панели (ночь 10.10: мала банка кончилась ≈02:08, велика ≈02:58), а докупленные
  // лежат в сумке. Бот сам ставит банку обратно: пустой слот → «Розхідники» → банка (как вручную, лог 07:38). Не вышло — предупреждение
  if (env.cfg.potSlotAuto !== false) {
    if (mageCombat() && !env.mpPotSlot()) await potSlotRestore('mp');
    if (document.querySelector(env.SLOT) && ![...document.querySelectorAll(env.SLOT)].some(b => potionSlot(b) && env.HP_POT_RE.test(b.title || ''))) await potSlotRestore('hp');
  }
  try { env.potInventory(); } catch (e) {}
  const hf = env.hudForce();                           // энергия силы сохраняется между боями: берём точное число из шапки
  if (hf != null && hf !== env.forceNow()) await env.forceSet(hf, Math.max(hf, env.forceMax()), 'по шапке');
  else if (hf != null) await env.setRt({ force: { ...(env.rt.force || {}), hud: hf, t: Date.now() } });
  env.trySnap(300);                                    // снимок боя — когда панель уже отрисована
  const hasDamageSlot = () => mageCombat() ? mageSpellSlots().length > 0 :
    (slotsBy(env.cfg.nAttack).length > 0 || env.names(env.cfg.nPower).some(n => slotsBy(n).some(b => !nonOffenseSkill(b))));
  if (!hasDamageSlot()) {
    // In a newly created mage the hotbar may load after the DOM/battle UI.
    // Never permanently disable the whole bot for this recoverable state.
    const loaded = await env.waitX(hasDamageSlot, 5000, 150);
    if (!loaded) {
      // 7.1.14-fix: запись в журнал раз в минуту (раньше — каждые ~6 с); через 3 мин статус подсказывает проверить названия
      const now = Date.now();
      if (!emptyPanel.since || now - emptyPanel.last > 60000) emptyPanel.since = now;
      if (now - (emptyPanel.logT || 0) > 60000) { emptyPanel.logT = now; env.rec('B', 'панель', `Нет атаки или магического удара на панели — жду интерфейс, не выключаю бота (${Math.round((now - emptyPanel.since) / 1000)} с)`); }
      emptyPanel.last = now;
      env.setStatus(now - emptyPanel.since > 180000 ? 'Бой: 3+ мин нет атаки/удара на панели — проверьте названия в меню «Боевой движок»' : 'Бой: ожидаю атакующие слоты на панели');
      await env.sleep(1200);
      return;
    }
  }
  emptyPanel.since = 0;

  const title = mobTitle();
  const spawnId = new URLSearchParams(location.search).get('spawnId') || '';
  const isRb = env.isBoss(title) || /^l2dop_rb_/i.test(spawnId || '');
  const rbLvl = +(title.match(/ур\.?\s*(\d+)/i)?.[1] || 0);
  const campRb = isRb && env.campRbOpen().some(t => env.nameLike(t.name, title.split('·')[0]));
  // РБ, которого открыл сам игрок (бот запущен уже в бою, цели у бота нет) — бьём, окно уровня не проверяем (v4.22)
  // v5.6: «открыт вами» — только если ни бот, ни цепочка «Охотиться дальше» его не открывали (раньше mobClickAt уже был сброшен
  // строкой выше, и любой РБ из цепочки считался «вашим» — бот бил РБ вне окна уровня). Эпик в режиме эпиков — свой
  const epicFight = isRb && env.epicOn() && !!env.epicById(spawnId);
  const manualRb = isRb && !env.rt.target && !clickedAt && cameVia !== 'chain';
  if (isRb && !manualRb && !epicFight && !((env.cfg.rbMode || env.huntOn() || campRb) && rbLvl >= env.rbLo(env.heroLvl()) && rbLvl <= (campRb ? env.heroLvl() + Math.max(env.cfg.rbMaxAbove, 5) : env.rbHi(env.heroLvl())))) {
    console.info(env.TAG, 'босс в бою:', title);                // цепочка выдала босса — уходим до удара
    await env.setRt({ target: null, sinceDeep: 999, rbSkip: { ...(env.rt.rbSkip || {}), [spawnId]: Date.now() } });
    return env.toMap();
  }
  if (manualRb) env.rec('B', 'РБ', `${title.split('·')[0].trim()} (${rbLvl}) открыт вами — бью, оцениваю по ходу боя`);

  // чемпион: метка с карты, слово в заголовке или HP ≥ N× обычного для этого вида
  const nm = mobName().toLowerCase();
  const mob0 = mobHp();
  const known = env.rt.hpMin?.[nm];
  const t = env.rt.target;
  const same = !!t && nm === t.name.toLowerCase();
  const hpChamp = !!known && !!mob0 && mob0.max >= known * env.cfg.champHpMult;
  const blockW = {};
  for (const [k, v] of Object.entries(env.rt.unavailW || {}))
    if (v.w === (env.rt.weaponNow || '?') && Date.now() - v.t < 1800000) blockW[k] = Infinity;
  const ctx = { lastStun: 0, block: blockW, killed: [], seq: [], max: mob0?.max || 0, logStart: env.logLines(), champ: (same && t.champ) || env.isChamp(title) || hpChamp,
                name: mobName(),
                questKill: (same && !!t.quest) || env.isQuestName(nm), goalsAt: env.goalLines() };
  if (mageCombat()) { ctx.pet = { hits: 0, hitDmg: 0, crits: 0, misses: 0, dmg: 0, acts: 0, deaths: 0, summons: 0, resummons: 0, key: '', name: '', alive: false }; ctx.petLines = ctx.logStart; }   // 7.1.31: замер кота
  if (nm && mob0 && !(same && t.champ))
    await env.setRt({ hpMin: { ...(env.rt.hpMin || {}), [nm]: Math.min(known || Infinity, mob0.max) } });
  if (ctx.champ) console.log(env.TAG, 'чемпион:', title, hpChamp ? `(по HP ${mob0.max} vs ${known})` : '');
  // v5.5.1: «Охотиться дальше» сам подсовывает моба — если этот вид уже «не по зубам» (урон ≈0), не бьём его (лог 08.10 16:31–16:38:
  // после конца «Бонуса новачка» урон упал до 1–3, бот 3 раза подряд заходил к Tracker Skeleton Leader и погиб)
  { const hd = !isRb && !ctx.questKill && env.rt.hardMobs?.[nm]; if (hd && Date.now() - hd.t < 7200000 && mob0 && mob0.cur >= mob0.max * 0.98 && !extraMobs().some(x => x.cur > 0)) {
    env.rec('B', 'цели', `${ctx.name}: «не по зубам» (${hd.why || 'долгий бой'}) — не бью, на карту`); await env.setRt({ target: null }); return env.toMap(); } }
  ctx.hp0 = mob0?.cur || 0; ctx.hp0T = Date.now(); ctx.hp0N = nm;
  if (isRb) {
    ctx.champ = false;                                      // «Оглушення не діє на РБ» (лог 07.10) — стан по РБ не используем
    ctx.rb = { id: spawnId || nm, start: mob0.cur, samples: [], note: 'оценка…' };
    if (env.epicOn() && env.epicById(ctx.rb.id) && env.rt.epic?.k === env.epicById(ctx.rb.id).k && mob0?.max) {   // 🐉 заход к эпику: сохранилось ли его HP после смерти
      const L = env.rt.epic.hpLog || [], last = L[L.length - 1];
      const reset = !!last && last.cur < last.max * 0.95 && mob0.cur >= mob0.max * 0.99;
      await env.setRt({ epic: { ...env.rt.epic, startHp: mob0.cur, resetN: reset ? (env.rt.epic.resetN || 0) + 1 : 0 } });
      env.rec('B', 'эпики', `${ctx.name}: заход ${(env.rt.epic.deaths || 0) + 1} · у него ${Math.round(mob0.cur / mob0.max * 1000) / 10} % (${env.fmtK(mob0.cur)}/${env.fmtK(mob0.max)})${reset ? ' — HP восстановилось полностью!' : ''}`);
    }
    // HP РБ сохраняется между заходами: «Моб ще поранений: HP 143526 / 148507» (через 13 мин — ровно столько же)
    const prevR = env.rt.rb?.[ctx.rb.id], dbR = env.rt.rbDb?.[ctx.rb.id] || {};
    const wounded = env.logLines().some(l => /(?:Моб ще поранений|Моб ещё ранен|still wounded)/i.test(l)) || mob0.cur < mob0.max;
    let regen = dbR.regen;
    if (prevR?.hpAfter && prevR.t && mob0.cur >= prevR.hpAfter) {
      const dtR = (Date.now() - prevR.t) / 1000;
      if (dtR > 30) regen = +((mob0.cur - prevR.hpAfter) / dtR).toFixed(2);      // HP/с, 0 — не лечится
    }
    ctx.rb.persist = !!(dbR.persist || wounded) && !(regen > 0 && mob0.cur >= mob0.max);   // ранен при входе ⇒ HP хранится
    ctx.rb.regen = regen;
    if (ctx.rb.persist || regen != null) await env.rbNote(ctx.rb.id, { persist: ctx.rb.persist, regen: regen ?? dbR.regen });
    if (ctx.rb.persist) env.rec('B', 'РБ', `${nm}: HP сохранилось с прошлого захода ${mob0.cur}/${mob0.max}${regen != null ? ` · восстановление ${regen} HP/с` : ''}`);
    await env.rbNote(ctx.rb.id, { name: ctx.name, lvl: rbLvl, tries: (env.rt.rbDb?.[ctx.rb.id]?.tries || 0) + 1 });
    const prev = env.rt.rb?.[ctx.rb.id];
    if (prev?.hpAfter != null) {
      const regen = mob0.cur - prev.hpAfter;                // сколько РБ отхилился, пока мы отдыхали
      console.log(env.TAG, `РБ ${ctx.name}: был ${prev.hpAfter}, сейчас ${mob0.cur} (реген ${regen}), прошлый заход снял ${prev.chip}`);
      if (prev.attempts >= 2 && prev.chip > 0 && regen >= prev.chip * 0.9 && !env.epicById(ctx.rb.id)) {   // эпик: решает epicStep
        await env.rbNote(ctx.rb.id, { verdict: 'no', note: `отхиливается быстрее (реген ${regen} ≥ снимаем ${prev.chip})` });
        await env.setRt({ rbCur: null, target: null });
        env.setStatus(`РБ ${ctx.name}: ❌ отхиливается быстрее, чем мы бьём — в базу «не по силам»`);
        return env.toOutskirts();
      }
    }
  }

  let extraSeen = env.extraKillsInLog().length;       // уже в логе до начала (бой без перезагрузки страницы)
  const countExtras = async () => {
    const ks = env.extraKillsInLog();
    if (ks.length <= extraSeen) return;
    const fresh = ks.slice(0, ks.length - extraSeen);   // новые — сверху
    extraSeen = ks.length;
    const sum = f => fresh.reduce((a, k) => a + k[f], 0);
    await env.setRt({ kills: env.rt.kills + fresh.length, exp: env.rt.exp + sum('exp'), sp: env.rt.sp + sum('sp'), adena: env.rt.adena + sum('adena') });
    for (const k of fresh) {
      env.rec('B', 'доп. цель', `${k.name}: EXP +${k.exp} · SP +${k.sp} · аден +${k.adena}${k.items.length ? ' · ' + k.items.join(', ') : ''}`);
      if (env.isQuestName(k.name)) await env.trackQuest(k.name, true);
      ctx.killed.push(k.name);
    }
  };
  let lastHpPot = 0, lastMpPot = 0, lastAct = Date.now(), lastActT = 0;
  const turnSamples = [];
  // результат: true — сработал; false — не ушёл в КД; 'unavail' — игра ответила «скилл недоступен» (неподходящее оружие)
  const act = async (b, status) => {
    // Серверная общая пауза распространяется на все действия, включая банки и спойл.
    // Не полагаемся на визуально готовую кнопку, когда сервер сообщил blockedBy=global.
    while (env.combatCooldown.globalWait() > 0) {
      if (!env.on || !env.tabOwner || !env.isBattle() || victory() || defeat()) return false;
      await env.sleep(Math.min(850, env.combatCooldown.globalWait() + 60));
    }
    if (!env.on || !env.tabOwner || !env.isBattle() || victory() || defeat()) return false;
    const exact = env.slotAction(b);
    if (exact && env.combatCooldown.skillWait(exact, (env.cdSpawn || env.battleSpawn)()) > 0) return 'cd';
    env.observeSlot(b, 'B');
    const before = noticeText();
    const firedAt = Date.now();
    const net0 = env.actNet?.().start || 0;
    if (!env.fire(b)) return false;
    lastAct = Date.now();
    if (ctx.pet && env.petState?.()?.has !== false) ctx.pet.acts++;   // 7.1.31: действие хозяина, пока кот жив (кот бьёт вместе с ним)
    // 7.1.17: ждём, пока игра отправит ход (до 0,6 с) и получит ответ сервера (до 6 с) — иначе следующий клик теряется
    const sent = !!env.actNet && !!(await env.waitFor(() => env.actNet().start > net0 ? 1 : null, 600, 40));
    if (sent) await env.waitFor(() => env.actNet().done >= env.actNet().start || victory() || defeat() ? 1 : null, 6000, 40);
    env.setStatus(status);
    // 7.2.1 (лог 10.10 21:07–21:14, 9 из 44 боёв): 1) первый клик сразу после «Охотиться дальше» игра не принимает (запрос не уходит),
    // а бот ещё секунду ждал, не уйдёт ли кнопка в КД; 2) ход принят сервером, но игра перерисовала панель (ответ «full») — кнопка
    // не показала откат, бот счёл ход несработавшим и жал то же заклинание снова («Blaze: урон 0», «ещё на КД — бью другим», +2–3 с).
    // Теперь: ход ушёл и сервер ответил 2xx на это действие — нажатие засчитано; запрос не ушёл (а хук работает) — без секундного ожидания
    const netOk = sent && env.actNet().ok && (!exact || env.actNet().action === exact);
    const lost = !!env.actNet && net0 > 0 && !sent && !victory() && !defeat();
    // v5.4: моб умер от этого удара — победа приходит вместо отката, не ждём 1 с «ушёл ли слот в КД» (лог 08.10 15:05:
    // удар Soul Breaker → «итог боя» через 1,7 с, хотя моб умирал с первого удара; на цепочке это ~1,2 с лишних на моба)
    const dead = () => victory() || (mobHp()?.cur ?? 1) === 0;
    let done = lost ? false : env.slotCd(b) ? !!(await env.waitFor(() => !uiReady(b) || dead() || netOk, 1000, 40)) : true;
    // ответ игры: «скилл недоступен» (оружие) или «Скіл на перезарядці»
    const ans = dead() ? null : await env.waitFor(() => { const n = noticeText(); return n !== before && (env.FORCE_NEED.test(n) ? 'noforce' : env.UNAVAIL.test(n) ? 'unavail' : env.CD_RE.test(n) ? 'cd' : null); }, done ? 250 : lost ? 300 : 600, 50);
    if (lastActT && Date.now() - lastActT < 3000) turnSamples.push(Date.now() - lastActT);   // длина хода — для расчёта ДПС
    lastActT = Date.now();
    if (turnSamples.length >= 10) { const avg = turnSamples.reduce((x, y) => x + y, 0) / turnSamples.length; turnSamples.length = 0;
      await env.setRt({ turnMs: Math.round(env.rt.turnMs ? env.rt.turnMs * 0.7 + avg * 0.3 : avg) }); }
    if (ans) done = ans;
    if (env.combatCooldown.recentlyGlobalRejected(firedAt)) done = 'cd';
    if (done === true) await rememberCd(b, 'used');
    else if (done === 'cd') {
      if (!env.combatCooldown.recentlyGlobalRejected(firedAt)) await rememberCd(b, 'cd');
      env.rec('B', 'перезарядка', `«${env.cleanTitle(b.title)}» ещё на КД — жду ${env.memLeft(b).toFixed(1)} с, бью другим`);
      console.info(env.TAG, `${b.title}: на перезарядке, ещё ≈${env.memLeft(b).toFixed(1)} с`);
      await env.sleep(env.rnd(80, 160));
      return 'cd';
    }
    if (!victory() && !((mobHp()?.cur ?? 1) === 0)) await env.pause();   // добили — без «реакции», сразу к итогу
    return done;
  };

  const t0 = Date.now();
  let progSig = '', progT = Date.now();          // последний «признак жизни» боя: HP моба/героя, журнал
  if (!ctx.rb && env.totemSlots().length >= 2) { ctx.tot = {}; ctx.totT = Date.now(); }   // замер тотемов (кроме РБ)
  while (env.on && env.tabOwner) {
    if (env.antibotState()) return;                  // v5.5.6: проверка активности / блок PvE — в главный цикл (там ждём)
    if (env.rt.shop?.urgent) {                        // «🛒 Закупить сейчас»: бросаем бой (в игре он идёт дальше без нас)
      env.rec('B', 'закупка', `«Закупить сейчас» — ухожу из боя${ctx.rb ? ' с РБ' : ''} в магазин`);
      env.setStatus('🛒 Закупка сейчас — бросаю бой'); location.href = '/char.html'; await env.sleep(4000); return;
    }
    if (ctx.tot) { const tn = Date.now(), k = env.totemActive()?.bn || '—'; ctx.tot[k] = (ctx.tot[k] || 0) + tn - ctx.totT; ctx.totT = tn; }
    if (defeat()) return env.onDeath();
    if (env.rt.epic?.step === 'retreatVerify' && ctx.rb && env.rt.epic.id === ctx.rb.id) {
      // После команды выхода боевой цикл ждёт смены страницы. HTTP 2xx без
      // ухода из боя не считаем доказательством выхода на сервере.
      if (Date.now() - (env.rt.epic.retreatT || 0) < 12000) {
        env.setStatus('Эпики: проверяю завершение боя после отступления');
        await env.sleep(350); continue;
      }
      const E = env.rt.epic;
      await env.epicDbSet(E.k, { leaveBadUntil: Date.now() + 3600000 });
      await env.setRt({ epic: { ...E, step: 'fight', retreatFailed: true } });
      env.rec('B', 'эпики', 'Не удалось подтвердить выход из боя за 12 с — продолжаю текущий бой, повторное отступление запрещено');
    }
    const me = env.meHp(), mp = env.meMp(), mob = mobHp();
    if (me && me.cur === 0) return env.onDeath();
    if (ctx.pet) petTick(ctx);
    // v5.6: урон по ВСЕМ мобам боя (главный + «рядом»): сумма их HP падает — это наш урон. Раньше ДПС и «не по зубам» считались
    // как HP первого моба / время всего боя (с соседями и переключением цели) — Captain «31 с, ДПС 51» при реальных ~150
    { const sum = (mob?.cur || 0) + extraMobs().reduce((a, x) => a + x.cur, 0);
      if (ctx.hpSum != null && sum < ctx.hpSum) ctx.dealt = (ctx.dealt || 0) + ctx.hpSum - sum;
      ctx.hpSum = sum; ctx.mobLast = mob?.cur ?? ctx.mobLast; }
    await countExtras();
    if (victory()) break;
    if (mob && mob.cur === 0) {                   // главная цель умерла: ждём победу или следующую цель (соседи живы)
      // 7.1.16-fix: временная обходка ошибки сервера (её исправит администрация). Моб 0 HP, а победы нет: бой «висел» 5–6 с,
      // бот уходил на карту без засчитанного убийства и шёл на того же моба (лог 10.10: 33 из 47 боёв). Ручное нажатие «Атака»
      // в этот момент завершало бой сразу. Ждём 1 с, потом одна атака (до 2 раз). Выключить: zeroHpNudge: false
      let nx = await env.waitFor(() => victory() ? 'win' : ((mobHp()?.cur || 0) > 0 ? 'next' : null), env.cfg.zeroHpNudge === false ? 3000 : 1000, 100);
      for (let k = 0; !nx && k < 2 && env.cfg.zeroHpNudge !== false; k++) {
        const fin = [...document.querySelectorAll(env.SLOT)].find(b => env.slotKind(b) === 'атака' && uiReady(b));
        if (!fin) break;
        if (!ctx.zeroNote) { ctx.zeroNote = 1; env.rec('B', 'бой', 'моб 0 HP, а победы нет — жму «Атака», чтобы сервер завершил бой'); }
        await act(fin, 'Бой: моб 0 HP — завершаю атакой');
        nx = await env.waitFor(() => victory() ? 'win' : ((mobHp()?.cur || 0) > 0 ? 'next' : null), 1500, 100);
      }
      if (nx === 'win' || !nx) break;
      if (mobName() !== ctx.name) {               // бой переключился на соседа
        ctx.name = mobName(); ctx.champ = env.isChamp(mobTitle());
        ctx.questKill = env.isQuestName(ctx.name);
        console.log(env.TAG, 'следующая цель в том же бою:', mobTitle());
      }
      continue;
    }
    // v4.42: «аварийные» баффы (Frenzy, Guts, Zealot — действуют только при HP ≤ 30 %): у Дестроера это главный урон и защита,
    // раньше их перебивала банка HP (при 50 % пили — до 30 % не доходило, а при 25 % первой срабатывала аварийная банка)
    // v5.3: + раздел «Важные баффы» (cfg.nKeyBuffs). Порядок: Guts (защита ×2) → Frenzy (атака ×2–3) → прочие → Zealot.
    // Zealot режет получаемое лечение на 50 % — в бою с РБ (живём на банках) только на добивании (РБ ≤ 15 %).
    if (me) {
      let low = null;
      const KEY_ORD = { 139: 0, 176: 1, 420: 9 }, mobP = mob?.max ? mob.cur / mob.max * 100 : 100;
      const em = [...new Set([...env.names(env.cfg.nKeyBuffs), ...env.names(env.cfg.nBuffs)])].map(bn => ({ bn, b: slotsBy(bn)[0] })).filter(x => x.b)
        .sort((a, b) => (KEY_ORD[env.ilOf(a.b)?.id] ?? 5) - (KEY_ORD[env.ilOf(b.b)?.id] ?? 5));
      for (const { bn, b } of em) {
        const il = env.ilOf(b), pc = il?.pc;
        if (!pc?.hp || me.pct > pc.hp || !ready(b) || env.buffActive(bn, b) || (ctx.block['buff:' + bn] || 0) > Date.now()) continue;
        if (il.id === 420 && ctx.rb && mobP > 15) continue;
        // v5.3 (симуляция 1000 РБ × 6 классов): на РБ при HP ≤ 30 % сначала банка (если готова) — каст баффа 1,5 с без лечения убивал
        if (ctx.rb && !env.cfg.rbFrenzyDive && env.hpPotPick(true) && Date.now() - lastHpPot > 1100) continue;
        low = [bn, b]; break;
      }
      if (low) {
        ctx.block['buff:' + low[0]] = Date.now() + 5000;
        const r = await act(low[1], `Аварийный бафф (HP ${me.pct | 0}%): ${low[1].title}`);
        if (r === true) await env.setRt({ buffAt: { ...(env.rt.buffAt || {}), [low[0]]: Date.now() } });
        continue;
      }
    }
    // v4.44: из боя в этой игре уйти нельзя — бой идёт до конца (уход со страницы бой не прекращает: «Во время бою відновлення
    // недоступне», и РБ добивал героя у баффера, лог 01:48). Поэтому мало HP — банки как можно чаще (вкл. резерв), а если
    // банка на откате — бьём дальше (вампирик тоже лечит), а не стоим и не уходим
    if (me && me.pct <= Math.max(env.cfg.stopHp, 25)) {
      const pot = env.hpPotPick(true);
      if (pot && Date.now() - lastHpPot > 1100) {
        lastHpPot = Date.now();
        if (ctx.rb) (ctx.rb.potT ||= []).push(Date.now());
        await act(pot, `Мало HP (${me.pct | 0}%) — банка: ${env.cleanTitle(pot.title)} (×${(env.qty(pot) ?? 1) - 1})`); continue;
      }
      if (!pot && !ctx.noPotSaid && !env.hpPots().length) { ctx.noPotSaid = 1; env.rec('B', 'мало HP', `HP ${me.pct | 0}%, банок HP нет — из боя уйти нельзя, бьюсь до конца`); }
    }
    ctx.emWait = 0;                                  // HP выше порога — ожидание банки с нуля
    if (!mob) {                                   // v5.6: полоски HP моба нет 15 с (окно ошибки, недогруз) — раньше цикл ждал вечно
      ctx.noMobT ||= Date.now();
      if (Date.now() - ctx.noMobT > 15000) { env.rec('B', 'бой', 'полоски HP моба нет 15 с — обновляю страницу'); location.reload(); await env.sleep(8000); return; }
      await env.sleep(100); continue;
    }
    ctx.noMobT = 0;
    if (ctx.rb) {
      const ep = env.epicOn() && env.epicById(ctx.rb.id) && env.rt.epic?.k === env.epicById(ctx.rb.id).k && env.rt.epic?.step === 'fight';
      const v = me ? env.rbAssess(ctx, me, mob) : { retreat: false };
      // Выходим только штатной кнопкой, подтверждаем 2xx POST /game/battle/leave.
      // Для каждого эпика свой флаг непригодности выхода; глобальный epicLeaveBad больше не используется.
      if (ep && me && !ctx.rb.retreated && !((env.rt.epicDb?.[env.epicById(ctx.rb.id).k]?.leaveBadUntil || 0) > Date.now()) &&
          env.cfg.epicRetreatHp > 0 && (me.pct <= env.cfg.epicRetreatHp || v.hopeless || v.lethal)) {
        const leave = env.$q('#battle-back-map') || env.$q('#l2-nav-bottom a[data-nav-role="outskirts"]');
        if (!leave) {
          await env.epicDbSet(env.epicById(ctx.rb.id).k, { leaveBadUntil: Date.now() + 3600000 });
          env.rec('B', 'эпики', `${ctx.name}: не нашёл штатную кнопку выхода из боя — режим отхода отключён для этого эпика`);
        } else {
          ctx.rb.retreated = true;
          const E = env.rt.epic || {}, el = Math.max(1, (Date.now() - t0) / 1000);
          const chip = Math.max(0, (ctx.rb.start ?? mob.max) - mob.cur);
          const att = { t: Date.now(), cur: mob.cur, max: mob.max, chip, sec: Math.round(el), dps: Math.round(chip / el), me: me.pct | 0, how: v.hopeless ? 'бесперспективно' : 'отход' };
          try { sessionStorage.removeItem('l2bot.epicLeave'); } catch (er) {}
          await env.setRt({ epic: { ...E, step: 'retreatVerify', retreatT: Date.now(), retreatAttempt: att }, target: null });
          env.rec('B', 'эпики', `${ctx.name}: ${v.hopeless ? v.why : 'отход по HP'} · снял ${env.fmtK(chip)} (${(chip / mob.max * 100).toFixed(2)} %) — подтверждаю выход у сервера`);
          env.fire(leave);
          await env.waitFor(() => !env.isBattle(), 8000, 150);
          return;
        }
      }
      // Optional attrition retreat on normal RBs. Navigation is permitted only
      // after an explicit leave acknowledgement from the game's API/DOM.
      const canAttrit = !ep && env.cfg.rbChipRetreat === true && (v.abort || v.retreat || v.lethal);
      if (canAttrit && !ctx.rb.retreated && me && Date.now() > (env.rt.rbDb?.[ctx.rb.id]?.leaveBadUntil || 0)) {
        const attempts = (env.rt.rbGoCnt?.[ctx.rb.id] || []).filter(t => Date.now() - t < 3600000).length;
        const leave = env.$q('#battle-back-map');
        if (attempts < Math.max(1, env.cfg.rbChipMaxAttempts || 3) && env.shown(leave)) {
          ctx.rb.retreated = true;
          env.rec('B', 'РБ', `${ctx.name}: пытаюсь выйти (сервер должен подтвердить завершение боя)`);
          env.fire(leave);
          const ended = await env.waitFor(() => !env.isBattle(), 8000, 150);
          if (ended) {
            await env.rbRetreat(ctx, mob, v.why || 'отступление');
            return;
          }
          await env.rbNote(ctx.rb.id, { leaveBadUntil: Date.now() + 3600000 });
          env.rec('B', 'РБ', `${ctx.name}: выход не подтверждён, повторный выход запрещён на 1 час`);
        }
      }
      if ((v.abort || v.retreat) && !ctx.rb.allIn) {
        ctx.rb.allIn = true;
        env.rec('B', 'РБ', `${ctx.name}: ${v.why} — ${ep ? 'выход не подтверждён, бой продолжается' : 'из боя уйти нельзя, бьюсь до конца на банках (резерв тоже)'}`);
        if (v.lethal) await env.rbNote(ctx.rb.id, { verdict: 'no', note: v.why });
      }
    } else {
      // v5.5.1: урон не пробивает (лог 08.10: после «Бонуса новачка» 1–3 урона за удар, моб 1044 HP) — за 15 с видно, что бой
      // не выиграть: прогноз > 90 с, а HP героя уходит. Уходим, вид моба — «не по зубам» на 2 ч, дальше — восстановление
      const nmNow = mobName().toLowerCase();
      if (nmNow !== ctx.hp0N) { ctx.hp0N = nmNow; ctx.hp0 = mob.cur; ctx.hp0T = Date.now(); ctx.me0 = me?.cur; }
      ctx.me0 ??= me?.cur;
      const el = (Date.now() - ctx.hp0T) / 1000, dmg = ctx.hp0 - mob.cur, dps = el > 0 ? dmg / el : 0, ttk = dps > 0 ? mob.cur / dps : Infinity;
      const losing = me && ctx.me0 != null && me.cur < ctx.me0 && me.cur - (ctx.me0 - me.cur) / el * ttk < 0;   // HP кончится раньше моба
      const hopeless = el >= 15 && !ctx.questKill && !((env.rt.pveBlockUntil || 0) > Date.now() - 120000) && !env.antibotState() && (ttk > 180 || (ttk > 90 && losing));   // v5.5.8: в блоке фарма урон 0 — это не «не пробиваю»
      if (hopeless || Date.now() - t0 > 180000) {
        const why = hopeless ? `урон ≈${dps.toFixed(1)}/с, моба убить ≈${isFinite(ttk) ? Math.round(ttk) + ' с' : 'никогда'}` : 'бой дольше 3 мин';
        await env.setRt({ hardMobs: { ...(env.rt.hardMobs || {}), [nmNow]: { t: Date.now(), ttk: isFinite(ttk) ? Math.round(ttk) : 9999, lvl: env.heroLvl(), why } }, target: null });
        env.rec('B', 'цели', `${mobName()}: не пробиваю — ${why} → ухожу, этот вид 2 ч не бью`);
        if (me && me.pct < 60) { if (await env.restoreVitals(`после неподъёмного моба HP ${me.pct | 0}%`)) return; }
        return env.toMap();
      }
    }
    // сервер «завис»: удары уходят, а HP моба и журнал боя не меняются 20 с — обновить страницу боя
    const sig = mob.cur + '|' + (me?.cur ?? '') + '|' + env.logLines().length + '|' + (env.logLines()[0] || '');
    if (sig !== progSig) { progSig = sig; progT = Date.now(); }
    else if (Date.now() - progT > 20000) {
      let rl = []; try { rl = JSON.parse(sessionStorage.getItem('l2bot.mageReload') || '[]').filter(t => Date.now() - t < 600000); } catch (e) {}
      if (rl.length < 3) {   // 7.1.30: не чаще 3 перезагрузок за 10 мин (общий счётчик)
        try { sessionStorage.setItem('l2bot.mageReload', JSON.stringify([...rl, Date.now()])); } catch (e) {}
        env.rec('B', 'бой', `нет ответа игры 20 с (моб ${mob.cur}/${mob.max}) — обновляю страницу`);
        location.reload(); await env.sleep(8000); return;
      }
      progT = Date.now();
    }

    await env.keepShots();
    const ex = extraMobs().filter(x => x.cur > 0);
    const tc = (ctx.rb ? ` [РБ ${ctx.rb.note}]` : ctx.champ ? ' [чемп]' : '') + (ex.length ? ` +${ex.length} рядом` : '');

    // 7.1.16-fix: слуга мага. Призыв — только если сервер явно сказал «слуги нет» (activeSummon: null) не дольше 10 с назад,
    // не чаще раза в 60 с; лечение слуги — скиллом с целью PET при HP слуги ≤ petHealAt (50 %). Без скилла на панели — ничего
    if (mageCombat() && env.cfg.petAuto !== false) {
      // HP кота: из ответа сервера (activeSummon), иначе из шапки «Активний слуга» (#l2-hud-companion: «Mew the CatLv.1HP479/750MP320/320»).
      // Окно кота («Відкликати слугу») бот не открывает и не нажимает
      // по просьбе игрока: кот мёртв/не призван — призыв ПЕРВЫМ действием боя. В начале боя ждём до 1,5 с ответа сервера о слуге
      if (!ctx.petChecked) { ctx.petChecked = 1; await env.waitFor(() => { const q = env.petState?.(); return q && Date.now() - q.t < 10000 ? q : null; }, 1500, 100); }
      let P = env.petState?.(), fresh = P && Date.now() - P.t < 10000;
      if (!fresh) {
        const box = env.$q('#l2-hud-companion'), tx = box && env.shown(box) ? box.textContent.replace(/\s+/g, '') : '';
        const m = tx.match(/HP(\d+)\/(\d+)/i);
        if (m) { P = { t: Date.now(), has: +m[1] > 0, key: P?.key || '', hp: +m[1], maxHp: +m[2], hud: true }; fresh = true; }
        else if (box && !env.shown(box) && P?.key) { P = { ...P, t: Date.now(), has: false, hud: true }; fresh = true; }   // шапка слуги пропала — кота нет
      }
      if (fresh && P.has && P.hp <= 0) P = { ...P, has: false };   // HP 0 — мёртв
      // 7.1.31: статистика кота — смерть в бою (был жив в этом бою, а теперь нет); баффы кота слетают вместе с ним
      if (ctx.pet && fresh) {
        if (P.has) { ctx.pet.alive = true; if (P.key && !ctx.pet.key) ctx.pet.key = P.key; }
        else if (ctx.pet.alive) { ctx.pet.alive = false; ctx.pet.deaths++; env.setRt({ petBornT: Date.now() }); env.rec('B', 'питомец', `кот погиб в бою (${ctx.name})`); }
      }
      if (fresh && !P.has && Date.now() - (env.rt.petSummonT || 0) > 15000) {
        const want = (P.key || '').replace(/_/g, ' ');
        const sums = [...document.querySelectorAll(env.SLOT)].filter(b => env.slotKind(b) === 'скилл' && /^summon\b/i.test(env.cleanTitle(b.title)));
        const sb = (env.cfg.petSummon && slotsBy(env.cfg.petSummon)[0]) || sums.find(b => want && env.cleanTitle(b.title).toLowerCase().includes(want)) || sums[0];
        if (sb && ready(sb) && (!mp || mp.cur >= (env.skillMp(env.cleanTitle(sb.title)) || 0) + 10)) {
          await env.setRt({ petSummonT: Date.now() });
          env.rec('B', 'питомец', `кота нет (умер или не призван) — призываю первым действием: ${env.cleanTitle(sb.title)}`);
          const sr = await act(sb, `Призыв слуги: ${env.cleanTitle(sb.title)}`);
          if (sr === true) { if (ctx.pet) { ctx.pet.summons++; ctx.pet.key = petKeyOf(env.cleanTitle(sb.title).replace(/^summon\s+/i, '')); } await env.setRt({ petBornT: Date.now() }); }   // 7.1.31
          continue;
        }
      }
      // 7.1.16-fix: Servitor Heal лечит кота мало (жалоба игрока), а призыв в бою работает и даёт полное HP
      // (лог 10.10 00:20: «Покликання Mew the Cat — слугу призвано» в бою, MP −19, затем 736/750). Поэтому: HP кота ≤ petHealAt —
      // перепризыв того же кота; если перепризыв HP не поднял (сервер не обновляет того же слугу) — запоминаем и лечим Servitor Heal
      // по просьбе игрока: перепризыв — «под конец HP» кота (≤ petResummonAt, 25 %), не раньше; лишних действий на карте нет
      const petPct = P && P.maxHp ? P.hp / P.maxHp * 100 : 100, reOk = !!P?.key && (env.rt.petResummon || {})[P.key] !== false && env.cfg.petResummon !== false;
      if (fresh && P.has && P.maxHp && petPct <= (reOk ? (env.cfg.petResummonAt ?? 25) : (env.cfg.petHealAt ?? 50)) && (ctx.block['petheal'] || 0) <= Date.now()) {
        const slots = [...document.querySelectorAll(env.SLOT)].filter(b => env.slotKind(b) === 'скилл');
        const want = (P.key || '').replace(/_/g, ' ');
        const sb = (env.cfg.petSummon && slotsBy(env.cfg.petSummon)[0]) || slots.find(b => /^summon\b/i.test(env.cleanTitle(b.title)) && want && env.cleanTitle(b.title).toLowerCase().includes(want));
        const hb = slots.find(b => /^(?:servitor heal|heal servitor)/i.test(env.cleanTitle(b.title)) || (env.ilOf(b)?.target === 'PET' && env.ilOf(b)?.c === 'Лечение'));
        const mpOk = b => !mp || mp.cur >= (env.skillMp(env.cleanTitle(b.title)) || 0) + 10;
        const re = env.rt.petResummon || {};
        const useSummon = sb && ready(sb) && mpOk(sb) && re[P.key] !== false && env.cfg.petResummon !== false;
        const pick = useSummon ? sb : hb && ready(hb) && mpOk(hb) ? hb : null;
        if (pick) {
          ctx.block['petheal'] = Date.now() + 3000;
          const hp0 = P.hp, max0 = P.maxHp, t0 = Date.now(), name = env.cleanTitle(pick.title);
          const pr = await act(pick, `${useSummon ? 'Перепризыв' : 'Лечение'} слуги (${hp0}/${max0}): ${name}`);
          if (useSummon && pr === true) { if (ctx.pet) ctx.pet.resummons++; await env.setRt({ petBornT: Date.now() }); }   // 7.1.31: новый кот — без баффов
          const P2 = await env.waitFor(() => { const q = env.petState?.(); return q && q.t > t0 && q.has ? q : null; }, 2500, 150);
          if (!P2) ctx.block['petheal'] = Date.now() + 20000;   // 7.1.30: сервер не прислал слугу — не долбим призыв/лечение каждые 3 с
          if (P2) {
            const gain = P2.hp - hp0;
            if (useSummon && re[P.key] == null) {
              const works = P2.hp >= max0 * 0.9;
              await env.setRt({ petResummon: { ...re, [P.key]: works } });
              env.rec('B', 'питомец', `перепризыв ${name}: HP слуги ${hp0} → ${P2.hp}/${P2.maxHp} — ${works ? 'работает, лечу кота так' : 'не лечит, дальше Servitor Heal'}`);
            } else if (!useSummon) {
              const h = env.rt.petHealGain || [];
              await env.setRt({ petHealGain: [...h, gain].slice(-10) });
            }
          }
          continue;
        }
      }
    }
    // v4.42: лечащий скилл (роль «Лечение») — раньше банки: бесплатно. Хватает MP — лечимся им
    // 7.2: у мага Vampiric Touch (≈665 урона + ≈266 HP) выгоднее лечащего хода (Corpse Life Drain 178 HP без урона мага, Heal ≈430):
    // вампирик готов и HP не критичное — лечащий скилл пропускаем, ниже сработает вампиризм
    const drainFirst = mageCombat() && me && me.pct > (env.cfg.stopHp || 25) + 10 && !!drainPick(ctx, mp);
    if (me && me.pct <= env.cfg.hpPotAt && !drainFirst) {
      const hs = env.names(env.cfg.nHeal || '').map(n => slotsBy(n)[0]).find(b => b && env.ilOf(b)?.target !== 'PET' && !env.noEffect?.(b) && ready(b) && (ctx.block['heal:' + b.title] || 0) <= Date.now() && (!mp || mp.cur >= env.skillMp(env.cleanTitle(b.title)) + 10));
      if (hs) { ctx.block['heal:' + hs.title] = Date.now() + 2500; await act(hs, `Лечение скиллом (HP ${me.pct | 0}%): ${env.cleanTitle(hs.title)}`); continue; }
    }
    // v5.3: 🩸 вампиризм (Vampiric Claw, Drain Health, Life Leech, Steal Essence, Dark Vortex…): HP ≤ «вампиризм при» —
    // сначала скилл с поглощением HP (лечит и бьёт, банка не тратится); банка — если вампирик на откате, нет MP
    // или HP уже опасно низкое (≤ стоп-HP + 10 %)
    const drainB = me && me.pct <= (env.cfg.drainHp ?? 85) && me.pct > (env.cfg.stopHp || 25) + 10 ? drainPick(ctx, mp) : null;
    if (drainB) { ctx.block['drain:' + drainB.title] = Date.now() + 1500; ctx.seq.push('🩸'); await act(drainB, `Вампиризм (HP ${me.pct | 0}%): ${env.cleanTitle(drainB.title)}`); continue; }
    // банка HP (если задана)
    // v4.46: на РБ — при HP ≤ 45 % и по недостаче (≥1500 — большая); на мобах как было
    // v5.3: на РБ держим HP около 80 % (по просьбе игрока): начинаем пить при HP ≤ «с» (75 %) и пьём, пока не поднимется до «до» (80 %) —
    // симуляция 1000 РБ: побед Дестроер 80 → 97 %, Гладиатор 74 → 88 %, Тиран 85 → 100 %.
    // «Сливаться под Frenzy» (Дестроер): пока Frenzy готов — банок не пьём (кроме аварийных ≤ стоп-HP), HP падает до 30 %,
    // жмём Frenzy (+Guts/Zealot по правилам), дальше снова держим 90 %. Симуляция: бой на 21 % быстрее, банок на 31 % меньше.
    let potAt = env.cfg.hpPotAt;
    if (ctx.rb) {
      const d = env.rt.rbDb?.[ctx.rb.id] || {};
      const ordinaryP90 = d.hitP90 || (ctx.rb.hits?.length >= 3
        ? [...ctx.rb.hits].sort((a,b)=>a-b)[Math.floor(ctx.rb.hits.length*0.9)] : Math.max(150, me.max * 0.06));
      const spike = d.sp || Math.max(ctx.rb.sp || 0, me.max * 0.30);
      const emergencyFloor = Math.min(me.max * 0.96, spike + 2 * ordinaryP90);
      // Measured spikes + two ordinary hits determine an adaptive safety band.
      // The revised RB tactic uses an 80% floor, with a 20 pp reserve over the
      // estimated lethal combination. Manual thresholds remain available.
      const adaptive = env.cfg.rbBandAuto !== false;
      const from = adaptive
        ? Math.min(95, Math.max(80, env.cfg.rbPotAt ?? 75, emergencyFloor / me.max * 100 + 20))
        : Math.min(96, Math.max(1, env.cfg.rbPotAt ?? 75));
      const to = adaptive
        ? Math.min(98, Math.max(from + 3, env.cfg.rbPotTo ?? 80, from + 10))
        : Math.min(98, Math.max(from + 1, env.cfg.rbPotTo ?? 80));
      if (me && me.pct <= from) ctx.rb.potOn = true;
      if (me && me.pct >= to) ctx.rb.potOn = false;
      potAt = ctx.rb.potOn ? 100 : -1;
      if (frenzyDive(ctx, me)) { potAt = -1; if (!ctx.rb.diveNote) { ctx.rb.diveNote = 1; env.rec('B', 'РБ', `слив под Frenzy: банки не пью, пока HP не упадёт до ${env.ilOf(slotsBy('Frenzy')[0])?.pc?.hp || 30} % — там Frenzy`); } }
    }
    const hpPot = me && me.pct <= potAt ? (ctx.rb ? env.hpPotByDeficit(me.max - me.cur) : env.hpPotPick(me.pct <= (env.cfg.stopHp || 25) + 10)) : null;
    const potLeft = env.qty(hpPot);
    const potReserveHit = ctx.rb && !ctx.rb.allIn && me && me.pct > 35 && potLeft != null && potLeft <= (env.cfg.rbPotReserve || 0);   // v4.44: резерв бережём, пока не припёрло   // на РБ резерв не трогаем; в режиме заходов банки бережём
    // v5.3: на РБ банки — чаще: у банки в l2wap нет своего отката (только общий ~0,2 с; лог 08.10 14:14), а пили раз в 2–5 с —
    // 600 HP за глоток против потери 300–600 HP/с у РБ 50 ур. Теперь, пока держим полосу HP, — раз в 1,1 с
    if (hpPot && potLeft !== 0 && !potReserveHit && me && me.pct <= potAt && Date.now() - lastHpPot > (ctx.rb ? 1100 : 2000)) {
      lastHpPot = Date.now();
      if (ctx.rb) (ctx.rb.potT ||= []).push(Date.now());    // для оценки «хватит ли банок»
      await act(hpPot, `Банка HP${ctx.rb ? ` (РБ: осталось ${potLeft - 1}${ctx.rb.usePots ? ', убиваем с банками' : ''})` : ''}`); continue;
    }
    // банка MP — когда маны мало для скиллов
    // на РБ (модель 50 000 боёв): банка MP при MP < 80 сокращает бой ≈в 2 раза (≈1,7 банки на РБ); резерв банок не трогаем
    const mpPot = env.mpPotSlot();
    const rbMpAt = ctx.rb && env.cfg.rbMpPots !== false && (mobHp()?.cur || 0) > 20000 && (env.qty(mpPot) == null || env.qty(mpPot) > (env.cfg.rbPotReserve || 0)) ? 80 : 0;
    // v4.42: порог MP — не меньше полутора самых дешёвых ударов роли «Силовые» (у мага ядерка 50–100 MP, а порог был 70 ед.)
    const hitMp = Math.min(...env.names(env.cfg.nPower).filter(n => slotsBy(n).length).map(n => env.skillMp(n)), Infinity);
    // 7.1.16-fix: у мага мана — весь урон. Порог 70 MP из 928 (лог 09.10: MP падал до 51–71, бой шёл рывками) — держим ≥ 25 % MP
    const mageMp = mageCombat() && mp?.max ? Math.round(mp.max * (env.cfg.mageMpPct ?? 25) / 100) : 0;
    const mpNeed = Math.max(env.cfg.mpPotAt, rbMpAt, mageMp, isFinite(hitMp) ? Math.round(hitMp * 1.5) : 0);
    const mpPulse = (() => { const p = env.rt.pots?.[env.cleanTitle(mpPot?.title || '').toLowerCase()]; return p && p.pulses > 1 ? Math.max(3000, p.pulses * (p.every || 1) * 1000) : 3000; })();   // 7.1.30: банка «пульсами» — не пить поверх ещё идущей
    if (mpPot && env.qty(mpPot) !== 0 && mp && mp.cur < mpNeed && Date.now() - lastMpPot > mpPulse && ready(mpPot)) {
      lastMpPot = Date.now(); await act(mpPot, `Банка MP (MP ${mp.cur} < ${mpNeed})`); continue;
    }
    const b2m = mp && mp.cur < mpNeed && me && me.pct > 60 ? [...document.querySelectorAll(env.SLOT)].find(b => env.ilOf(b)?.t === 'MANAHEAL' && !env.noEffect?.(b) && ready(b)) : null;   // 7.1.31: Body To Mind на L2WAP «в бою эффекта нет» — не жмём
    if (b2m) { await act(b2m, `MP из HP: ${env.cleanTitle(b2m.title)} (MP ${mp.cur})`); continue; }
    // 7.1.31: баффы кота (роль «Баффы кота»)
    if (mageCombat() && env.cfg.petAuto !== false) {
      const pb = petBuffPick(ctx, me, mp, mob);
      if (pb) {
        ctx.block['petbuff:' + pb.n] = Date.now() + 5000;
        const r = await act(pb.b, `Бафф кота: ${env.cleanTitle(pb.b.title)}`);
        if (r === true) { await env.setRt({ petBuffAt: { ...(env.rt.petBuffAt || {}), [pb.n]: Date.now() } }); env.rec('B', 'питомец', `бафф кота: ${env.cleanTitle(pb.b.title)}`); }
        else if (r === 'unavail') { ctx.block['petbuff:' + pb.n] = Infinity; env.rec('B', 'питомец', `бафф кота «${env.cleanTitle(pb.b.title)}»: ${noticeText() || 'недоступен'} — до конца боя не трогаю`); }
        continue;
      }
    }
    // баффы: по строке активных баффов (если она их показывает) или по таймеру
    if (Date.now() - (ctx.auditT || 0) > 15000) { ctx.auditT = Date.now(); try { await env.buffAuditStep(ctx, me); } catch (e) { console.warn(env.TAG, 'проверка баффов', e); } }
    let buffed = false;
    env.BUFF_CTX = ctx;
    if (await env.spoilStep(ctx, act, mob)) continue;      // v5.3: ⛏ спойл в начале боя
    if (await env.toggleStep(ctx, me, act)) continue;           // v5.3: постоянные баффы (тогглы) — вкл/выкл по MP
    for (const bn of env.buffList(ctx)) {
      const b = slotsBy(bn)[0];
      if (!ready(b) || env.noEffect?.(b) || (ctx.block['buff:' + bn] || 0) > Date.now()) continue;   // 7.1.31: «в бою эффекта нет» — не жмём
      const pcIL = env.ilOf(b)?.pc;                   // Frenzy/Zealot/Guts: только при HP ≤ 30 % — аварийные
      if (pcIL?.hp && (me?.pct ?? 100) > pcIL.hp) continue;
      if (env.buffActive(bn, b)) {
        if (!env.rt.buffSeen?.[bn]) await env.setRt({ buffSeen: { ...(env.rt.buffSeen || {}), [bn]: true } });
        continue;
      }
      const since = Date.now() - (env.rt.buffAt?.[bn] || 0);
      const durIL = env.ilOf(b)?.dur;                 // длительность из справочника Interlude (тотем 120 с, Vampiric Rage 1200 с)
      if (since < (env.rt.buffSeen?.[bn] ? 3000 : (durIL ? Math.max(10, durIL - 3) : env.cfg.buffSec) * 1000)) continue;
      // v4.37: время баффа пишем только после того, как скилл сработал. Раньше писали ДО нажатия: сбой между записью
      // и нажатием (лог 01:02, weaponWt) — и бот 2 мин считал тотем наложенным, а его не было
      ctx.block['buff:' + bn] = Date.now() + 5000;        // пока идёт нажатие — повторно не берём
      // через кастеты сразу — только если точно известно, что сейчас надето другое оружие
      const needFist = /кастет/.test(env.ilOf(b)?.w || '') && !env.isFistName(env.rt.weaponNow || env.cfg.nWeaponMain || '');
      const viaSwap = env.canSwap() && (env.rt.buffSwap?.[bn] || needFist) && !!env.rt.weaponNow && env.rt.weaponNow !== env.cleanTitle(env.equipBy(env.cfg.nWeaponBuff).title);
      if (viaSwap) await env.equip(env.equipBy(env.cfg.nWeaponBuff));
      let r = await act(b, `Бафф${viaSwap ? ' (через ' + env.cfg.nWeaponBuff + ')' : ''}: ${b.title}`); buffed = true;
      if (r === true) { await env.setRt({ buffAt: { ...(env.rt.buffAt || {}), [bn]: Date.now() } }); ctx.block['buff:' + bn] = 0; }
      if (r === 'unavail' && !viaSwap && env.canSwap()) {     // недоступен с этим оружием — пробуем через кастеты и запоминаем
        await env.setRt({ buffSwap: { ...(env.rt.buffSwap || {}), [bn]: true } });
        await env.equip(env.equipBy(env.cfg.nWeaponBuff));
        r = await act(b, `Бафф (через ${env.cfg.nWeaponBuff}): ${b.title}`);
        if (r === true) { env.rec('B', 'бафф через смену оружия', `«${b.title}» работает только с «${env.cfg.nWeaponBuff}» — запомнено`); await env.setRt({ buffAt: { ...(env.rt.buffAt || {}), [bn]: Date.now() } }); ctx.block['buff:' + bn] = 0; }
        await env.equip(env.equipBy(env.cfg.nWeaponMain));
      } else if (viaSwap) await env.equip(env.equipBy(env.cfg.nWeaponMain));
      if (r === 'unavail') {                      // с этим оружием бафф не работает — до конца боя не трогаем
        ctx.block['buff:' + bn] = Infinity;
        env.rec('B', 'недоступно', `бафф «${b.title}»: ${noticeText() || 'недоступен'}`);
        console.info(env.TAG, `бафф ${b.title}: недоступен (неподходящее оружие?) — до конца боя не используется`);
      } else if (r === 'cd') await env.setRt({ buffAt: { ...(env.rt.buffAt || {}), [bn]: 0 } });   // на КД — повторим, когда откатится (память КД)
      else if (!r) ctx.block['buff:' + bn] = Date.now() + 5000;   // не ушёл в КД — повтор не раньше чем через 5 с
      break;
    }
    if (buffed) continue;

    // удар
    if (mageCombat()) {
      const dbf = debuffPlan(ctx, mp, me);
      if (dbf) {
        const before = env.logLines();
        const dr = await act(dbf.b, `Бой${tc}: дебафф ${dbf.n} · моб ${mob.pct | 0}%`);
        if (dr === true) (ctx.debuffed ||= {})[dbf.k] = Date.now(); else ctx.block['debuff:' + dbf.k] = Date.now() + 3000;   // 7.1.30: не прошёл клик — короткая пауза, цель не считается «обработанной»
        ctx.seq.push('✦');
        await env.sleep(500);
        const added = env.newLines(before, env.logLines()).join(' ⏎ ');
        const ok = /Ефект пройшов|Эффект прош[её]л/i.test(added), fail = /не пройшов|не прош[её]л|опір|сопротивл|resist|не подіяв|не подействовал/i.test(added);
        if (fail && !ok && ctx.debuffed) delete ctx.debuffed[dbf.k];   // 7.2.1: не прошёл — цель не под дебаффом (иначе замер выгоды врёт)
        if (ok || fail) {
          const S = { ...(env.rt.debuffStat || {}) }, s = { ok: 0, fail: 0, ...(S[dbf.k] || {}) };
          if (ok) s.ok++; else s.fail++;
          if (s.ok + s.fail >= 6 && s.ok / (s.ok + s.fail) < 0.3) { s.offUntil = Date.now() + 3600000; s.ok = 0; s.fail = 0; env.rec('B', 'дебафф', `${dbf.n}: почти не проходит — выключаю на час`); }
          S[dbf.k] = s; await env.setRt({ debuffStat: S });
        }
        continue;
      }
    }
    const a = chooseAction(ctx, mp);
    if (a) {
      if (a.key.startsWith('stun')) ctx.lastStun = Date.now();
      const logBefore = new Set(env.logLines());
      const logArr = env.logLines();
      const done = await act(a.b, `Бой${tc}: ${a.name} · моб ${mob.pct | 0}%${a.why ? ' · ' + a.why : ''}`);
      if (a.probe && done === true) await env.sleep(950);   // замер нового заклинания — без других нажатий в окне (урон, MP, имя в логе)
      ctx.seq.push(a.charge ? '⚡' : a.key === 'attack' ? 'А' : a.key.startsWith('stun') ? 'стан' : env.cleanTitle(a.b.title).split(' ').map(w => w[0]).join(''));
      if (a.charge || a.cost) {                     // энергия силы: по новым строкам лога, иначе свой учёт
        await env.sleep(150);
        if (done === 'noforce') { await env.forceSet(0, 0, `«${env.cleanTitle(a.b.title)}»: не хватает энергии`); ctx.block[a.key] = Date.now() + 1500; continue; }
        const added = env.newLines(logArr, env.logLines());
        const got = await env.forceFromLog(added);
        const skName = env.cleanTitle(a.b.title), skLine = added.find(l => l.toLowerCase().startsWith(env.logName(skName) + ':'));
        if (!got && a.cost && skLine && !env.FORCE_SPEND.test(skLine)) {   // удар прошёл без «−N енергії» — скилл энергию не тратит
          await env.setRt({ forceFree: { ...(env.rt.forceFree || {}), [skName.toLowerCase()]: true } });
          env.rec('B', 'энергия', `«${skName}» не тратит энергию силы — теперь это обычный силовой удар`);
        } else if (!got && done === true) {
          if (a.charge) {                             // игра молчит на «Концентрации» — заряды уже на максимуме
            await env.forceSet(Math.max(env.forceMax() || 3, env.forceNow()), Math.max(env.forceMax(), env.forceNow()), env.forceNow() < (env.forceMax() || 3) ? 'заряд без ответа — значит максимум' : '');
            ctx.block.charge = Date.now() + 3000;
          } else await env.forceSet(env.forceNow() - a.cost);
        }
      }
      // «обычный» силовой удар (без энергии по нашим данным), а игра ответила «не хватает энергии» — значит, тратит: учим
      if (done === 'noforce' && !a.charge && !a.cost && !a.mpCost && !mageCombat()) {
        const k = env.cleanTitle(a.b.title).toLowerCase(), need = env.ilNum(env.ilOf(k)?.charges) || env.FORCE_KNOWN[env.logName(k)] || 1;
        const ff = { ...(env.rt.forceFree || {}) }; delete ff[k];
        await env.setRt({ forceFree: ff, forceNeed: { ...(env.rt.forceNeed || {}), [k]: need } });
        env.rec('B', 'энергия', `«${env.cleanTitle(a.b.title)}» требует ${need} эн. — перевожу в удары за энергию`);
        ctx.block[a.key] = Date.now() + 15000; continue;
      }
      if (a.key.startsWith('stun') && env.logLines().some(l => !logBefore.has(l) && /не\s+ді[єе]|не\s+действ|immune|иммун/i.test(l))) {
        ctx.block[a.key] = Infinity;              // цель невосприимчива к стану — до конца боя не станим
        env.rec('B', 'стан не действует', `${ctx.name}: ${a.b.title}`);
      }
      if (done === 'unavail') {                   // с этим оружием скилл не работает — до конца боя не трогаем
        ctx.block[a.key] = Infinity;
        await env.setRt({ unavailW: { ...(env.rt.unavailW || {}), [a.key]: { w: env.rt.weaponNow || '?', t: Date.now() } } });
        if (a.key.startsWith('stun')) ctx.lastStun = 0;
        env.rec('B', 'недоступно', `«${a.b.title}»: ${noticeText() || 'скилл недоступен'}`);
        console.info(env.TAG, `${a.b.title}: недоступен (неподходящее оружие?) — до конца боя не используется`);
      } else if (done === 'cd') {                 // «на перезарядке» — сразу другим скиллом/атакой (ready() учтёт память КД)
        if (a.key.startsWith('stun')) ctx.lastStun = 0;
      } else if (!done) {                            // слот не ушёл в КД — нет MP / отказ игры
        ctx.block[a.key] = Date.now() + (a.key === 'attack' ? 1000 : 3000);
        if (a.key.startsWith('stun')) ctx.lastStun = 0;
        console.info(env.TAG, `${a.name} не сработал — пауза для слота`);
      }
      continue;
    }
    if (mageCombat() && Date.now() - (ctx.mageWaitNoteAt || 0) >= 4500) {
      const gcdMs = env.combatCooldown.globalWait();
      const reasons = mageSpellSlots().map(b => {
        const name = env.cleanTitle(b.title), id = env.slotAction(b);
        const serverMs = id ? env.combatCooldown.skillWait(id, (env.cdSpawn || env.battleSpawn)()) : 0;
        const key = 'power:' + b.title;
        const blockMs = Math.max(0, (ctx.block[key] || 0) - Date.now());
        const localMs = localCdLeft(b) * 1000;
        const reason = !uiReady(b) ? 'интерфейс' : gcdMs > 0 ? 'сервер GCD' : serverMs > 0 ? 'сервер навыка' : blockMs > 0 ? 'после неудачи' : localMs > 0 ? 'резервный таймер' : 'готов';
        return `${name}: ${reason}${reason === 'готов' ? '' : ` ${Math.ceil(Math.max(gcdMs, serverMs, blockMs, localMs))} мс`}`;
      });
      // 7.1.30: и атака — при MP ≈ 0 маг живёт атакой, а в журнале было видно только заклинания («все готовы», но бот стоит)
      const atkB = [...document.querySelectorAll(env.SLOT)].find(b => env.slotKind(b) === 'атака');
      if (atkB) reasons.push(`Атака: ${!uiReady(atkB) ? 'интерфейс' : (ctx.block.attack || 0) > Date.now() ? 'после неудачи' : localCdLeft(atkB) > 0 ? 'резервный таймер' : 'готов'}`);
      if (mp) reasons.push(`MP ${mp.cur}`);
      const rs = reasons.join(' · '), rsk = rs.replace(/\d+ мс/g, '').replace(/MP \d+/, '');
      ctx.mageWaitNoteAt = Date.now();
      if (reasons.length && (rsk !== ctx.mageWaitSig || Date.now() - (ctx.mageWaitLogT || 0) > 60000)) { ctx.mageWaitSig = rsk; ctx.mageWaitLogT = Date.now(); env.rec('B', 'ожидание навыков', rs); }   // 7.1.30: без спама
    }
    // 7.1.30 (лог 09.10 07:35): маг на MP 20, банки на панели нет, заклинания «готовы», а атака не жмётся — бот простоял 20 с до
    // перезагрузки (после неё атака и MP 174 появились сразу: страница боя перестала обновляться). Теперь: 6 с без действий у мага —
    // атака, если её кнопка свободна; если сервер КД не держит, а кнопка «занята» — интерфейс завис, обновляем страницу сразу
    if (mageCombat() && Date.now() - lastAct > 6000 && env.combatCooldown.globalWait() <= 0) {
      const atkB = [...document.querySelectorAll(env.SLOT)].find(b => env.slotKind(b) === 'атака');
      const act0 = atkB && env.slotAction(atkB), srvBusy = act0 && env.combatCooldown.skillWait(act0, (env.cdSpawn || env.battleSpawn)()) > 0;
      if (atkB && uiReady(atkB) && !srvBusy) { console.info(env.TAG, 'маг: 6 с без действий — атака'); ctx.block.attack = 0; await act(atkB, 'Атака (простой мага)'); continue; }
      let rl = []; try { rl = JSON.parse(sessionStorage.getItem('l2bot.mageReload') || '[]').filter(t => Date.now() - t < 600000); } catch (e) {}
      if (atkB && !srvBusy && Date.now() - lastAct > 9000 && Date.now() - progT > 9000 && rl.length < 2) {   // 7.1.30: только если бой стоит, не чаще 2 раз за 10 мин
        try { sessionStorage.setItem('l2bot.mageReload', JSON.stringify([...rl, Date.now()])); } catch (e) {}
        env.rec('B', 'бой', `маг стоит 9 с: кнопки «заняты», а сервер откат не держит — интерфейс завис, обновляю страницу`);
        location.reload(); await env.sleep(8000); return;
      }
    }
    if (Date.now() - lastAct > 10000) {
      const atk = mageCombat() ? null : slotsBy(env.cfg.nAttack)[0];
      if (atk && ready(atk) && env.combatCooldown.globalWait() <= 0) { console.info(env.TAG, '10 с ничего не готово — принудительная атака'); await act(atk, 'Принудительная атака'); continue; }
    }
    await env.sleep(100);
  }
  if (!env.on) return;

  // победа: «+N аден, +N EXP, +N SP»
  await env.waitFor(() => victory(), 3000, 40);
  try { await env.sweepStep(ctx); } catch (e) { console.info(env.TAG, 'свип', e); }   // v5.3: ⛏ собрать спойл
  await countExtras();
  env.trySnap(300);                                   // экран победы (в т.ч. с квестовой строкой) — новый снимок, если структура новая
  const loot = env.$q('#battle-victory-lootline')?.textContent || '';
  if (ctx.max) {                                  // расчёт ДПС: время до убийства и урон в секунду
    const ttk = (Date.now() - t0) / 1000;
    const dealt = Math.max(ctx.max, (ctx.dealt || 0) + (victory() ? ctx.mobLast || 0 : 0));   // победа — главный добит (соседи живы — их остаток не наш)
    const dps = Math.round(dealt / Math.max(ttk, 0.5)), ttkOne = ctx.max / Math.max(dps, 1);   // время на одного такого моба
    const d = env.rt.dps || { n: 0 }, k = d.n < 20 ? 1 / (d.n + 1) : 0.05;
    await env.setRt({ dps: { n: d.n + 1, dps: Math.round((d.dps || dps) * (1 - k) + dps * k), ttk: +((d.ttk || ttk) * (1 - k) + ttk * k).toFixed(1), last: dps, lastTtk: +ttk.toFixed(1) } });
    env.rec('B', 'итог боя', `${ctx.name}${ctx.champ ? ' [чемп]' : ''}: ${ctx.max} HP за ${ttk.toFixed(1)} с · ДПС ${dps}${dealt > ctx.max * 1.05 ? ` (урон по всем мобам ${dealt})` : ''} · ${ctx.seq.join('→')}`);
    if (ctx.tot) await env.totemNote(ctx, dps);
    if (!ctx.rb && ttkOne > 45) {                  // обычный моб дольше 45 с (на одного, без соседей) — не по зубам, 2 часа не выбираем
      await env.setRt({ hardMobs: { ...(env.rt.hardMobs || {}), [ctx.name.toLowerCase()]: { t: Date.now(), ttk: +ttkOne.toFixed(0), lvl: env.heroLvl() } } });
      env.rec('B', 'цели', `${ctx.name}: ≈${ttkOne.toFixed(0)} с на моба — слишком долго, 2 часа не выбираю`);
    }
  }
  try { await debuffGainFlush(ctx); } catch (e) { console.warn(env.TAG, 'выгода дебаффов', e); }   // 7.2.1
  if (ctx.pet) { try { petTick(ctx); await petFlush(ctx, Math.max(ctx.max || 0, (ctx.dealt || 0) + (victory() ? ctx.mobLast || 0 : 0))); } catch (e) { console.warn(env.TAG, 'статистика кота', e); } }   // 7.1.31
  const pick = re => { const m = loot.match(re); return m ? parseInt(m[1].replace(/\D/g, ''), 10) || 0 : 0; };
  await env.trackEfficiency(pick(/([\d\s.,]+)\s*EXP/i), ctx);
  await env.trackLoot(env.newLines(ctx.logStart || [], env.logLines()), ctx.name);
  await env.setRt({
    kills: env.rt.kills + 1, sinceDeep: env.rt.sinceDeep + 1, target: null,
    adena: env.rt.adena + pick(/([\d\s.,]+)\s*аден/i), exp: env.rt.exp + pick(/([\d\s.,]+)\s*EXP/i), sp: env.rt.sp + pick(/([\d\s.,]+)\s*SP/i)
  });

  if (ctx.rb && env.campRbOpen().some(t => env.nameLike(t.name, ctx.name))) {   // РБ главы убит — отметить и сверить главу
    const C = env.rt.campaign;
    await env.setRt({ campaign: { ...C, targets: C.targets.map(t => t.rb && env.nameLike(t.name, ctx.name) ? { ...t, done: t.total || 1, ok: true } : t), live: Date.now() }, campaignDue: true, campRbSeen: '' });
    env.rec('B', 'РБ главы', `${ctx.name} убит — цель главы выполнена, сверяю главу`);
  }
  if (ctx.rb) {
    const rb = { ...(env.rt.rb || {}) }; delete rb[ctx.rb.id];
    await env.setRt({ rb, rbCur: null, sinceRb: 999, rbKills: (env.rt.rbKills || 0) + 1, ...(env.rt.rbList?.[ctx.rb.id] ? { rbList: { ...env.rt.rbList, [ctx.rb.id]: { ...env.rt.rbList[ctx.rb.id], alive: false } } } : {}) });   // v5.6: убит — в списке «мёртв»
    // Actual per-boss rewards and fight duration: economic RB tour uses these
    // in preference to guesses from other bosses. Do not overwrite with zero
    // when the victory screen has no readable reward line.
    const d0 = env.rt.rbDb?.[ctx.rb.id] || {}, kills = (d0.kills || 0) + 1;
    const adena = pick(/([\d\s.,]+)\s*аден/i), exp = pick(/([\d\s.,]+)\s*EXP/i);
    const fightS = (Date.now() - t0) / 1000;
    const avg = (old, next) => old > 0 ? Math.round(old * .6 + next * .4) : next;
    await env.rbNote(ctx.rb.id, { verdict: 'ok', kills,
      ...(adena > 0 ? { adenaPerKill: avg(d0.adenaPerKill, adena) } : {}),
      ...(exp > 0 ? { expPerKill: avg(d0.expPerKill, exp) } : {}),
      fightS: d0.fightS > 0 ? Math.round(d0.fightS * .6 + fightS * .4) : Math.round(fightS),
      heroMaxHp: env.meHp()?.max || d0.heroMaxHp || 0,
      note: `убит за ${env.fmtT(fightS)}` });
    console.log(env.TAG, `РБ ${ctx.name} убит за ${env.fmtT((Date.now() - t0) / 1000)}`);
  }
  if (env.cfg.campaign) {
    // условия главы: строки «★ Квест · <цель> N / M · осталось K» в логе боя → модель целей
    const r = await env.applyQuestLog([ctx.name, ...ctx.killed], ctx.champ);
    if (r.changes.length) env.rec('B', 'квест', r.changes.join(' · '));
    const goalNew = env.goalLines() > ctx.goalsAt;   // новая строка «Цель выполнена!» (старые в логе не считаются)
    const allDone = env.campActive() && !env.campOpen().length;
    if (r.closed.length) env.setStatus(`✓ Цель главы выполнена: ${r.closed.join(', ')}`);
    await env.setRt({ sinceCamp: (env.rt.sinceCamp || 0) + 1,
                  campaignDue: env.rt.campaignDue || allDone || goalNew || r.verify || (env.rt.sinceCamp || 0) + 1 >= env.cfg.campaignEvery });
    if (allDone) env.setStatus('Все цели главы выполнены — иду сдавать главу');
  }
  // квест: прогресс с экрана победы («26 / 35 · осталось 9»), частота дропа, прогноз боёв
  const qDone = await env.trackQuest(ctx.name, ctx.questKill);
  if (qDone && env.cfg.questStop) return env.halt(`Квест выполнен: ${qDone}`);
  await env.nextFight(ctx);
}

function potModel() {                           // v4.40: все банки HP с панели (резерв не трогаем): запас лечения и скорость питья
  if (!env.cfg.rbUsePots) return null;
  let items = env.hpPots().map(x => ({ ...x, n: Math.max(0, env.potBag(x.b) ?? 0) })).filter(x => x.n > 0);
  // Единый резерв, а не вычет резерва по каждому типу банки.
  let sharedReserve = Math.max(0, env.cfg.rbPotReserve || 0);
  items = items.map(x => { const k = Math.min(x.n, sharedReserve); sharedReserve -= k; return { ...x, n: x.n - k }; }).filter(x => x.n > 0);
  // v5.1: на карте панели боя нет — берём запомненный запас банок (rt.pots). Раньше тут был 0, и оценка до боя
  // («банками ≈3k из 0 → не полезу») браковала всех РБ уже ПОСЛЕ платного телепорта (журнал 08:39: 5 × 100 000 аден за минуту)
  // v5.2: и банки, которые ещё ни разу не пили (лечение не замерено) — по той же оценке, что в бою: «велике» 2500, обычная 600.
  // Лог 08.10: «Зілля зцілення» 290 шт. в бою считались (174k), а вне боя выпадали — запас «0», и все РБ браковались
  if (!items.length && !env.isBattle()) {
    const bag = env.rt.bagAll;
    // Prefer last real inventory scan (rather than an absent battle hotbar).
    if (bag?.n && Date.now() - bag.t < 6 * 3600000) {
      items = Object.entries(bag.n).filter(([name,qty]) => Number(qty) > 0 &&
          /зілля\s*(?:зцілення|лікування|hp)|зелье\s*(?:исцеления|лечения|hp)|healing potion|greater healing/i.test(name))
        .map(([name, qty]) => {
          const historical = Object.values(env.rt.pots || {}).find(p => p.kind === 'hp' && (p.name || '').toLowerCase() === name.toLowerCase());
          return { name, heal: historical?.pulse || Math.min(historical?.heal || (/велик|greater/i.test(name) ? 2500 : 600), /велик|greater/i.test(name) ? 2500 : 600),
            n: +qty, est: !historical?.heal, cd: 0 };
        });
      const reserve = Math.max(0, env.cfg.rbPotReserve || 0);
      // Deduct one shared reserve, not once for each type of potion.
      let remainingReserve = reserve;
      items = items.map(x => { const deduct = Math.min(x.n, remainingReserve); remainingReserve -= deduct;
        return { ...x, n: x.n - deduct }; }).filter(x => x.n > 0);
    } else {
      items = Object.values(env.rt.pots || {}).filter(x => x.kind === 'hp' && x.n > 0)
        .map(x => ({ ...x, heal: x.pulse || Math.min(x.heal || (/велик|greater/i.test(x.name || '') ? 2500 : 600), /велик|greater/i.test(x.name || '') ? 2500 : 600),
          n: x.n, cd: 0, est: !(x.pulse || x.heal) })).filter(x => x.n > 0);
      let reserve = Math.max(0, env.cfg.rbPotReserve || 0);
      items = items.map(x => { const d = Math.min(x.n, reserve); reserve -= d; return { ...x, n: x.n - d }; }).filter(x => x.n > 0);
    }
  }
  if (!items.length) return null;
  const n = items.reduce((a, x) => a + x.n, 0), pool = items.reduce((a, x) => a + x.n * x.heal, 0);
  // Реально сервер принимал банки примерно раз в 2.2–2.4 с.
  // Верхняя граница 2.2 с консервативнее 1.1 с: не обещаем победу из-за идеальной скорости.
  const rate = Math.max(...items.map(x => x.heal / Math.max(x.cd || 0, 2.2))); // HP/с верхняя оценка
  const H = pool / n;
  return { n, H: Math.round(H), C: H / rate, pool, rate, est: items.every(x => x.est), items };
}
 return { spellSample, debuffGain, debuffGainFlush, dbfOn, petHits, petExpect, petAdvice, petFlush, petBuffPick, mageSpellSlots, magePlan, debuffPlan, potSlotRestore, mobHp, extraMobs, noticeText, mobTitle, mobName, victory, defeat, loadErr, slotsBy, cdBusy, uiReady, ready, cdLeft, rememberCd, dpsPlan, ultPick, frenzyDive, drainPick, chooseAction, hotbarRows3, battle, potModel };
 };
})(globalThis);
