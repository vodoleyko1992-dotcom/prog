/* L2wap v7: isolated combat feature module. Dependencies are injected lazily.
   All game actions remain under the central lease and dispatcher in content.js. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.combat = function create_combat(env) {
const location = env.routeLocation || root.location;
// 20.71: мобы, чемпион и выбранный РБ похода подтверждаются модулем Rebirth, без правил обычной охоты.
const rebirthMode = () => env.rebirthSelected?.() === true;
const rebirthBig = ctx => !!ctx?.rebirth && ctx.rebirth.role !== 'mob';
const bigTarget = ctx => !!(ctx?.rb || ctx?.champ || rebirthBig(ctx));
const raidTarget = ctx => !!ctx?.rb || ctx?.rebirth?.role === 'raid';
const battleReturn = ctx => ctx?.rebirth || rebirthMode() ? env.rebirthReturn?.(() => killOwnerValid(ctx || {})) : env.toMap();
// 8.0.3: шлюз нажатий — запас после ответа на ход (A) и после конца GET /character игры (B), мс: [мин, макс, начальный]
const LOCK_A = [60, 500, 120], LOCK_B = [30, 200, 50];
// 10.0.12 (игрок 14.10: разрешены только зелёные/синие): в цепочке URL хранит первого моба, а цвет нужен текущего.
function battleColor(name, urlSpawn, mobMax, cameVia, target, same) {
  const m = env.battleInfo?.(), age = Date.now() - (+m?.t || 0), fresh = !!m && age >= 0 && age < 60000 && String(m.name || '').trim().toLowerCase() === String(name || '').trim().toLowerCase() && (!(+m.max > 0 && +mobMax > 0) || +m.max === +mobMax);
  const spawn = fresh ? String(m.spawn || '') : cameVia !== 'chain' ? urlSpawn : '';
  const ordinary = fresh && /^(?:normal|passive|neutral|aggressive)$/.test(m.kind || '') && !m.tier && !/^champ_[or]_/i.test(spawn);
  const raw = ordinary ? '' : (fresh && m.tier) || (spawn && env.champTier?.(spawn, null, '')) || (cameVia !== 'chain' && same && target?.tier) || '';
  const tier = ({ green: 'blue', yellow: 'orange' })[String(raw).toLowerCase()] || String(raw).toLowerCase();
  return { spawn, tier, ordinary, lvl: fresh ? +m.lvl || 0 : 0, champ: !ordinary && (!!(fresh && m.kind === 'champion') || /^champ_[or]_/i.test(spawn) || !!tier) };
}
// 10.0.22 (лог 15.10 05:17): три минуты простоя и один удар слуги после 167 с
// не доказывают нехватку урона. Силу оцениваем только по непрерывно принятым ходам.
function strengthSample(now, net = {}) {
  return { start: now, lastT: now, firstN: net.okN, lastN: net.okN, stalled: false };
}
function strengthReliable(sample, now, net = {}) {
  const known = Number.isSafeInteger(net.okN) && Number.isSafeInteger(sample.firstN);
  if (!known || net.okN < sample.lastN || now - sample.lastT > 20000 || (net.slowT || 0) >= sample.start) sample.stalled = true;
  if (known && net.okN > sample.lastN) sample.lastT = now;
  sample.lastN = net.okN;
  return known && !sample.stalled && net.okN - sample.firstN >= 5;
}
function mobHp() {
  const m = (env.$q('#battle-mob-hp-val')?.textContent || '').match(/(\d+)\s*\/\s*(\d+)/);
  return m ? { cur: +m[1], max: +m[2], pct: +m[2] ? 100 * m[1] / m[2] : 0 } : null;
}

// 9.2.4 (снимок боя 12.10 21:29, спойлер с Glaive): урон героя по строкам журнала боя — «Ты нанёс [ X ] 22 урона.», «Древко розсікло
// ворогів поруч: A −1, B −35.», «Дикий розмах: power 191 597». Цель удара бывает не тем мобом, чьё HP показано вверху (бой с соседями:
// вверху Guardian Basilisk 1789/1908, а «Ты нанёс [ Breka Orc Shaman ]»), — по HP одного моба урон занижался в разы
const dmgNum = s => +String(s || '').replace(/[^\d]/g, '') || 0;
const PROBE_USES = 8;   // 10.0.11: проба нового удара воина — не больше стольких нажатий без 3 замеров урона
function logDmg(lines) {
  let sum = 0;
  for (const raw of lines || []) {
    const l = String(raw || ''); let m;
    if ((m = l.match(/(?:Ты|Ти|Вы)\s+(?:нан[её]с(?:ли)?|завда(?:в|ли))\s*\[[^\]]*\]\s*([\d\s\u00a0\u202f]+?)\s*урон/i))) sum += dmgNum(m[1]);
    if ((m = l.match(/розсікло ворогів поруч\s*:\s*(.+)$/i))) for (const x of m[1].matchAll(/[−-]\s*(\d[\d\u00a0\u202f]*)/g)) sum += dmgNum(x[1]);
    if ((m = l.match(/^\s*(?:Дикий розмах|Wild Sweep)\s*:\s*power\s+\d+\s+([\d\s\u00a0\u202f]+)$/i))) sum += dmgNum(m[1]);
  }
  return sum;
}
function extraMobs() {
  const box = env.$q('#battle-whirlwind-extras');
  if (!env.shown(box)) return [];
  // В текущей панели имя находится в alt иконки, текст строки содержит только HP.
  const rows = [...(box.querySelectorAll?.('.l2-battle-whirlwind-extra') || [])];
  if (rows.length) return rows.map(row => {
    const m = (row.querySelector('.l2-battle-bar-innertext')?.textContent || '').replace(/[\s\u00a0\u202f]/g, '').match(/^(\d+)\/(\d+)$/);
    const icon = row.querySelector('.l2-battle-whirlwind-extra__icon');
    return m ? { name: icon?.alt || icon?.title || '', cur: +m[1], max: +m[2] } : null;
  }).filter(x => x && x.max > 0);
  return [...box.textContent.matchAll(/([^\d\/]+?)\s*(\d+)\s*\/\s*(\d+)/g)]
    .map(m => ({ name: m[1].replace(/\s+/g, ' ').trim(), cur: +m[2], max: +m[3] })).filter(x => x.name);
}

// 20.13 (ревизия 17.10, шаг 7, аудит combat/C7): env.damageSkills — геттер ядра, на каждое обращение заново строит словарь всех навыков.
// Внутри одной синхронной функции словарь не меняется — берём его один раз (DS = skillView()) вместо обращения на каждый слот/вариант
const skillView = () => env.damageSkills || env.rt.skills;
// 20.43 (лог 21.10 15:47–15:51: «АОЕ: проверяю дополнительную добычу» в каждом бою катакомб, модель группы так и не появилась):
// не больше 3 проб одного умения в одном месте без модели группы, затем 10 мин без проб. Память вкладки (sessionStorage) переживает
// переход к следующему мобу катакомб.
const AOE_PROBE_KEY = 'l2bot.aoeProbe', AOE_PROBE_MAX = 3, AOE_PROBE_MS = 600000;
const aoeProbeId = name => String(name || '').replace(/\s*\(.*$/, '').toLowerCase() + '|' + (env.cfg.catMode ? 'cat:' + (env.rt.catIn || env.cfg.catDungeon || '') : 'map:' + (env.rt.zone || ''));
let aoeProbeMem = {};
function aoeProbeRead() { try { const v = JSON.parse(sessionStorage.getItem(AOE_PROBE_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (e) { return { ...aoeProbeMem }; } }
function aoeProbeCapped(name) { const r = aoeProbeRead()[aoeProbeId(name)]; return !!r && r.n >= AOE_PROBE_MAX && Date.now() - r.t < AOE_PROBE_MS && Date.now() >= r.t; }
function aoeProbeNote(name) {
  const all = aoeProbeRead(), k = aoeProbeId(name), now = Date.now(), r = all[k] && now - all[k].t < AOE_PROBE_MS && now >= all[k].t ? all[k] : { n: 0, t: now };
  all[k] = { n: r.n + 1, t: r.n + 1 >= AOE_PROBE_MAX ? now : r.t };
  aoeProbeMem = Object.fromEntries(Object.entries(all).filter(([, x]) => now - x.t < AOE_PROBE_MS).slice(-20));
  try { sessionStorage.setItem(AOE_PROBE_KEY, JSON.stringify(aoeProbeMem)); } catch (e) { /* хранилище вкладки недоступно — счёт остаётся в aoeProbeMem */ }
}
// Общая оценка группового хода для мага и бойца. Оверкилл основной цели не даёт
// преимущества над дополнительными убийствами; личный откат готового умения — не время каста.
function groupPlan(ctx, opts, eco = false) {
  const mob = mobHp();
  if (eco || rebirthBig(ctx) || !(mob?.cur > 0)) return null;
  const targets = extraMobs(), visible = targets.length > 0;
  const near = targets.filter(x => x.cur > 0), bestSingle = Math.max(0, ...opts.map(o => Math.min(mob.cur, o.dmg || 0)));
  // 20.14 (просьба игрока 18.10): на РБ АОЕ (Whirlwind и др.) — только по видимым живым обычным мобам рядом
  // (РБ остаётся основной целью). Урон по РБ теряем не больше 15 %, а при проспойленных соседях — до 40 %.
  const rbK = ctx.rb ? (ctx.nearSpoiled > 0 ? .6 : .85) : .6;
  if (ctx.rb && (env.cfg.rbNearMobs === false || !near.length)) return null;
  const ranked = [], DS = skillView();
  for (const o of opts) {
    if (o.charge || o.force || !(o.dmg > 0)) continue;
    const name = o.name.replace(/\s*\(.*$/, '').toLowerCase(), p = DS?.[name];
    const model = env.fightGroupOn?.(name, mob.max);
    // На РБ своей модели группы нет (другая полоса HP): АОЕ по каталогу (AREA/AURA) бьёт каждого соседа
    // примерно как основную цель — так пишет игра у Whirlwind («до 4 цілей … 6138», соседи по −6138).
    const ilArea = ctx.rb && /^(?:AREA|AURA|MULTIFACE)$/.test(env.ilOf?.(o.b)?.target || '');
    if (!(p?.aoe || model?.targets > 0 || ilArea)) continue;
    const probability = env.fightKillP?.(o.name, mob.cur);
    const reliable = probability != null ? probability >= .85 : (p?.dmgN || 0) >= 3 && o.dmg >= mob.cur * 1.08;
    const each = Math.min(o.dmg, model?.damage || (near.length && p?.splN && p.spl ? p.spl / p.splN / near.length : ilArea ? o.dmg : 0));
    const sideKills = visible ? near.filter(x => each * .85 >= x.cur).length : model?.kills || 0;
    const useful = Math.min(mob.cur, o.dmg) + (visible ? near.reduce((s, x) => s + Math.min(x.cur, each), 0) : 0);
    const probe = !visible && !model && reliable && !!p?.aoe && !aoeProbeCapped(o.name);
    if (!(!ctx.rb && reliable && sideKills > .25 || bestSingle < mob.cur && visible && near.length && useful > bestSingle * 1.15 && o.dmg >= bestSingle * rbK || !ctx.rb && probe)) continue;
    ranked.push({ ...o, group: true, sideKills, useful, probe,
      why: ctx.rb ? `РБ: АОЕ по мобам рядом · живых ${near.length}${ctx.nearSpoiled > 0 ? ' · проспойлено ' + ctx.nearSpoiled : ''} · доп. убийств ≈${sideKills.toFixed(1)}` : probe ? 'АОЕ: проверяю дополнительную добычу; основной моб добивается одним ходом'
        : `АОЕ: ${visible ? 'живых соседей ' + near.length : 'по свежим боям'} · доп. убийств ≈${sideKills.toFixed(1)} · полезный урон ≈${Math.round(useful)}` });
  }
  return ranked.sort((a, b) => b.sideKills - a.sideKills || b.useful - a.useful || b.dmg - a.dmg || (b.cd || 0) - (a.cd || 0) || (a.mpCost || 0) - (b.mpCost || 0))[0] || null;
}

// Награды всех целей из свежего журнала — один итог. Lootline служит запасным
// источником, а уже зачисленные награды соседей вычитаются при финальном учёте.
function battleRewards(lines, loot = '', credited = {}) {
  const result = {};
  for (const [key, label] of [['exp', 'EXP'], ['sp', 'SP'], ['adena', 'аден(?:а|и)?']]) {
    const before = new RegExp('^' + label + '\\s*\\+\\s*([\\d\\s  ]+)[.!]?$', 'i');
    const after = new RegExp('^\\+?\\s*([\\d\\s  ]+)\\s*' + label + '[.!]?$', 'i');
    const values = lines.map(x => String(x).trim().match(before) || String(x).trim().match(after)).filter(Boolean).map(m => dmgNum(m[1]));
    const fallback = dmgNum(loot.match(new RegExp('([\\d\\s.,]+)\\s*' + label, 'i'))?.[1]);
    const total = values.length ? Math.max(fallback, values.reduce((s, n) => s + n, 0)) : fallback + (credited[key] || 0);
    result[key] = Math.max(0, total - (credited[key] || 0));
  }
  return result;
}
// Сохраняем одинаковые новые EXP/предметы в цепочке: разность множеств/счётчиков
// теряет их, когда из ограниченного хвоста одновременно выпали такие же старые строки.
function freshBattleLines(before, after) {
  for (let n = Math.min(before.length, after.length); n > 0; n--) {
    if (after.slice(-n).every((x, i) => x === before[i])) return after.slice(0, after.length - n);
    if (before.slice(-n).every((x, i) => x === after[i])) return after.slice(n);
  }
  return after.slice();
}

// 18.10, журнал 23:31: добыча вытесняла строки смертей из DOM. Сравниваем мультимножества:
// две Cave Maiden — два моба; одна смерть в DOM и в полном ответе — одно убийство.
const killOwner = () => JSON.stringify([env.rt.char||'',env.rt.classCur?.prof||'',env.rt.classCur?.slot??'',env.battleExitContext?.()||'']);
const killOwnerValid = ctx => env.on&&env.tabOwner!==false&&env.canAct?.()!==false&&(!ctx.killOwner||ctx.killOwner===killOwner());
function serverKillNames(spawn,since=0) {
  const s=env.battleKills?.(spawn,since);
  return s?.spawn===spawn&&Number.isSafeInteger(s.t)&&s.t>=since&&Array.isArray(s.extras)?s.extras.filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim()).slice(0,200):[];
}
function missingKillNames(wanted,credited) {
  const left=new Map();for(const name of credited)left.set(name,(left.get(name)||0)+1);
  return wanted.filter(name=>{const n=left.get(name)||0;if(n){left.set(name,n-1);return false;}return true;});
}
const resultKills = lost => (lost?0:1)+serverKillNames(new URLSearchParams(location.search).get('spawnId')||'').length;
async function battleDeath(ctx,countExtras) {
  await countExtras(true); if(!killOwnerValid(ctx))return;
  const ticket=await ctx.quotaTicket();if(!killOwnerValid(ctx))return;
  await env.finishFarmQuota?.(ticket,true,ctx.killed.length);
  if(killOwnerValid(ctx))return env.onDeath();
}

// 20.6 (лог17.10 00:04): строки Cancel вытесняются наградами AoE ещё до победы.
// Собираем их по ходу боя, сохраняя повторы между ходами, а не только последний хвост.
function cancelCollect(ctx, current = env.logLines()) {
  const added = freshBattleLines(ctx.cancelLog || ctx.logStart || [], current);
  ctx.cancelLog = current.slice();
  const lines = added.filter(l => /\]\s*(?:зняв з вас|сн[яи]л с вас|cancell?ed)\s*\d+\s*(?:баф|buff)/i.test(l));
  if (lines.length) (ctx.cancelLines ||= []).push(...lines);
}

const noticeText = () => ['#battle-toast', '#l2-hud-notice'].map(x => env.$q(x)).filter(env.shown).map(e => e.textContent.trim()).join(' | ');

const mobTitle = () => env.$q('#battle-mob-title')?.textContent.trim() || '';

// 20.66 (лог 26.10 21:52): «Rebirth · Имя» — полное имя API, разделитель метаданных начинается перед уровнем.
const mobName = () => {
  const title = mobTitle(), m = title.match(/^(.*?)\s*[·•]\s*ур\.?\s*\d+(?:\b|$)/i);
  return m ? m[1].trim() : /^Rebirth\s*[·•]\s*/i.test(title) ? title : title.split(/[·•]/)[0].trim();
};

const victory  = () => env.shown(env.$q('#battle-victory-inline'));

const defeat   = () => env.shown(env.$q('#battle-defeat-root'));

const loadErr  = () => env.shown(env.$q('#battle-load-err'));

function slotsBy(str) {                       // кнопки панели, чей title начинается с одного из названий
  const alts = env.names(str);
  if (!alts.length) return [];
  const exact = b => alts.includes(env.cleanTitle(b.title || '').toLowerCase());
  return [...document.querySelectorAll(env.SLOT)]
    .filter(b => { const t = (b.title || '').toLowerCase(); return alts.some(a => t.startsWith(a) && (t.length === a.length || /[\s(:.—–-]/.test(t[a.length]))) && !env.isEquip(b); })
    .sort((a, b) => exact(b) - exact(a) || env.shown(b) - env.shown(a)); // Heal раньше Heal Servitor, даже на другом ряду
}

let overlayBusySeen = new WeakMap(), overlayReadySeen = new WeakSet(), overlaySpawn = '';
let frozenSince = new WeakMap(), frozenLost = new WeakMap(), frozenNoted = new WeakSet();   // застывший рисунок КД навыка (см. cdBusy)
const FROZEN_GRACE = 1200, FROZEN_MAX_LOST = 2;
function cdBusy(b) {
  const spawn = (env.cdSpawn || env.battleSpawn)();
  if (overlaySpawn !== spawn) { overlaySpawn = spawn; overlayBusySeen = new WeakMap(); overlayReadySeen = new WeakSet(); frozenSince = new WeakMap(); frozenLost = new WeakMap(); frozenNoted = new WeakSet(); }
  const cd = env.slotCd(b);
  const t = parseFloat((cd?.querySelector('.l2-battle-hotbar-slot-cd__timer')?.textContent || '').replace(',', '.'));
  let busy = !!cd && !cd.hidden && cd.classList.contains('l2-battle-hotbar-slot-cd--on') && !(t <= 0.1);
  // 15.10 (лог09:46): RAF таймер панели может застыть после перерисовки/в фоне.
  // Только свежий серверный дедлайн именно атаки разрешает игнорировать рисунок КД.
  // disabled/aria-disabled проверяет uiReady; неподтверждённый ход и старый ответ не подходят.
  if (busy && env.slotAction(b) === 'attack') {
    const net = env.actNet?.(), since = Math.max(pressAt.get(env.skKey(b)) || 0, net?.doneT || 0);
    if (!(net && net.start > net.done) && env.combatCooldown.skillKnown?.('attack', spawn, since)
        && env.combatCooldown.skillWait('attack', spawn) <= 0) busy = false;
  }
  // 17.10.2026 (ночной журнал alt1 05:28–08:10: 20 боёв воина дольше 30 с, навыки не нажимались, бой шёл одной
  // принудительной атакой раз в 10 с): застывший RAF-рисунок КД держал не только атаку, но и навыки, а 10.0.26 доверял
  // серверу лишь для атаки. Теперь и для навыка: сервер прислал откат именно ЭТОГО нажатия (delta.skillCooldowns),
  // он истёк, запросов в полёте нет, потерянного клика нет, а рисунок «занят» ещё ≥ FROZEN_GRACE — жмём по серверу.
  // 19.10 (20.22, смерти Barakiel/Skylancer/Sheshark): нативные whirlwind/wild_sweep тоже имеют точные серверные ID.
  // Отказ игры «ещё на КД» или потеря клика после такого нажатия считается; после двух за бой рисунку этого слота снова верим.
  if (busy && env.slotKind(b) === 'скилл' && /^[a-z][a-z0-9_]*$/i.test(String(env.slotAction(b) || ''))) {
    const id = env.slotAction(b), k = env.skKey(b), net = env.actNet?.();
    const serverReady = !(net && net.start > net.done) && !((lostUntil.get(k) || 0) > Date.now())
      && env.combatCooldown.skillKnown?.(id, spawn, pressAt.get(k) || 0) && env.combatCooldown.skillWait(id, spawn) <= 0;
    if (serverReady && (frozenLost.get(b) || 0) < FROZEN_MAX_LOST) {
      if (!frozenSince.has(b)) frozenSince.set(b, Date.now());
      if (Date.now() - frozenSince.get(b) >= FROZEN_GRACE) {
        busy = false;
        if (!frozenNoted.has(b)) { frozenNoted.add(b); env.rec?.('B', 'бой', `рисунок отката «${env.cleanTitle?.(b.title) || b.title}» застыл: сервер считает навык готовым — жму по серверному дедлайну`); }
      }
    } else frozenSince.delete(b);
  } else frozenSince.delete(b);
  if (busy) { overlayBusySeen.set(b, true); overlayReadySeen.delete(b); }
  else if (overlayBusySeen.get(b)) { overlayBusySeen.delete(b); overlayReadySeen.add(b); }
  return busy;
}
// 7.2.1 (лог 10.10 22:19, РБ Гниле Дерево Репіро): сервер считал Blaze готовым через 1,4 с после нажатия, игра на экране клик
// отклоняла («ещё на КД — жду 0.0 с») — 11 раз за бой, по ≈1 с. Свой откат по нажатию (последние 5 с) тоже учитываем: берём больший
// (серверные откаты переписывают rt.cdUntil, поэтому свой — от нажатия: 85 % замеренного отката; Blaze 3,1 → 2,6 с — столько сервер и принял)
// 7.2.2 (лог 10.10 22:31–23:07, РБ под «Даром Серафима»): 53 клика не ушли в игру (Blaze 18, Vampiric Touch 18, Aura Burn 15) — игра
// считала заклинание на откате, а бот после потерянного клика жал его же снова. Потерянный клик — заклинание «занято» 0,7 с, бьём другим
const lostUntil = new Map();
const NOMP_MS = 1500;   // 20.12 (ревизия 17.10): сколько держим слот после отказа act() «не хватает MP»
const PET_RESUMMON_GAP = 60000;   // 20.63: перепризыв не раньше чем через 60 с после прошлого призыва (лог 25.10 16:12: два за 4 с)
let petHealSkipT = 0;
const mpUntil = new Map(); // 20.36: нехватка MP — отдельная причина, свежая банка снимает только её.
// 20.63 (лог 25.10 15:16–16:11, Warlock + Feline King в Ashen Bastion): Warrior Servitor / Final Servitor тратят Spirit Ore. Руда кончилась —
// сервер 55 мин отвечал 400 battle_no_spirit_ore «Недостаточно Spirit Ore.» на оба баффа в начале КАЖДОГО боя (981 отказ, ≈1,5 с на бой
// до первого удара, кот без баффов), закупка ждала плановой проверки раз в час. Теперь отказ «нет руды» держит слот, пока руды в сумке
// (ответы сервера) не станет больше, чем было при отказе (не дольше 30 мин), и пишет rt.oreOut — закупка берёт руду на ближайшей проверке
const ORE_IDS = { spirit: 3031, soul: 1785 }, ORE_MS = 1800000;
const oreUntil = new Map();
function oreKind(r) {
  const e = `${r?.error || ''} ${r?.code || ''}`, m = String(r?.message || '');
  const k = e.match(/no_(spirit|soul)_ore/i)?.[1] || m.match(/(?:недостат|не вистача|не хвата|not enough)[^.|]{0,20}\b(spirit|soul) ore/i)?.[1];
  return k ? k.toLowerCase() : null;
}
function oreBlocked(b) {
  const k = env.skKey(b), h = k && oreUntil.get(k); if (!h) return false;
  const q = env.invQty?.(ORE_IDS[h.kind]);
  if (Date.now() > h.until || (q != null && q > h.q)) { oreUntil.delete(k); return false; }
  return true;
}
const pressAt = new Map();                         // 8.0.3: skKey → время клика (откат сервера, полученный раньше, об этом нажатии не знает)
const ownLeft = b => {
  const k = env.skKey(b), lost = Math.max(Math.max(0, (lostUntil.get(k) || 0) - Date.now()) / 1000, mpLeft(b));
  const u = env.rt.cdUse?.[k] || 0, S = env.rt.skills?.[k] || {};
  if (!k || !u || Date.now() - u > 5000 || env.slotKind(b) !== 'скилл') return lost;
  // 8.0 (аудит боя, лог 13-30): «нижняя граница» cdFloor жила в памяти вечно (Aura Burn 3,4 с при настоящих 1,1 с; Vampiric Touch
  // 3,9 с) — свой откат держал Aura Burn 3,75 с, VT ≥ 4,1 с, на Селяне треть ходов уходила на банки. Теперь граница — только свежая
  // (≤ 30 с, как в rememberCd), откат — по ПОСЛЕДНЕМУ замеру с экрана (баффы вроде «Дара Серафима» его сокращают)
  const floor = Date.now() - (S.cdFloorAt || 0) < 30000 ? S.cdFloor || 0 : 0;
  const last = Array.isArray(S.cdS) && S.cdS.length ? S.cdS[S.cdS.length - 1] : 0;
  const cd = (S.cdNet || Math.max(last || S.cd || 0, floor)) * 1000 * 0.85;
  return Math.max(lost, Math.max(0, u + cd - Date.now()) / 1000);
};
// 8.0.2 (игрок 11.10: «откат может сильно меняться от моих баффов»): игра на экране показала откат ЭТОГО нажатия и он кончился —
// верим экрану сразу (баффы вроде «Дара Серафима» −30 % уже учтены игрой). Своя оценка (ownLeft) — только пока откат на экране
// ещё не появился после нажатия; потерянный клик по-прежнему держит заклинание «занятым» 0,7 с (lostUntil)
function mpLeft(b) { const k=env.skKey(b),hold=mpUntil.get(k),until=hold?.until||hold||0;if(!until)return 0;
  const mp=env.meMp?.(),enough=mp&&affordable(b,mp,0);
  if(until<=Date.now()||enough&&(!hold.server||mp.cur!==hold.mp)){mpUntil.delete(k);return 0;}
  if(hold.server&&mp&&!enough)hold.mp=mp.cur;return (until-Date.now())/1000; }
const lostLeft = b => Math.max(Math.max(0, (lostUntil.get(env.skKey(b)) || 0) - Date.now()) / 1000,mpLeft(b));
function localCdLeft(b) {
  const action = env.slotAction(b), spawn = (env.cdSpawn || env.battleSpawn)();
  const own = overlayReadySeen.has(b) ? lostLeft(b) : ownLeft(b);
  // 8.0.3 (разбор откатов 11.10): сервер знает откат ЭТОГО нажатия (получен не раньше него; с 11.10 — в каждом ответе на ход,
  // delta.skillCooldowns, с учётом баффов) — только он и потерянный клик; своя оценка (застывшие «Blaze 3,1 с») его не удлиняет.
  // Откат из sync, пришедший ДО нажатия (лог 10.10 22:19: «готов» через 1,4 с, игра отказала), — не знание, а запасной путь
  const pressT = pressAt.get(env.skKey(b)) || 0;
  if (action && env.combatCooldown.skillKnown?.(action, spawn, pressT)) return Math.max(env.combatCooldown.skillWait(action, spawn) / 1000, lostLeft(b));
  if (action && env.combatCooldown.skillKnown?.(action, spawn)) return Math.max(env.combatCooldown.skillWait(action, spawn) / 1000, own);
  if (overlayReadySeen.has(b)) return own; // observed busy -> ready; an absent overlay alone is not evidence
  return Math.max(env.memLeft(b), ownLeft(b));
}

const uiReady = b => !!b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' && !cdBusy(b);

// Items used as HP/MP potions have no local skill cooldown in this game.
const potionSlot = b => !!b && env.slotKind(b) === 'предмет' &&
  /зілля|зелье|potion|elixir|еліксир|эликсир/i.test(b.title || '') &&
  (env.HP_POT_RE.test(b.title || '') || /ман[аиы]|mana|\bmp\b|elixir|еліксир|эликсир|^#(?:726|728|920045)\b/i.test(b.title || ''));
// 20.49: относительные Focus/Vicious не являются ударом/обычным баффом даже в старой ошибочной роли.
const ready = (b, allowToggle = false) => {
  allowToggle = allowToggle === true; // Array.find/filter передают сюда числовой index, это не разрешение тоггла.
  const il = b && env.ilOf?.(b), toggle = [312,317].includes(il?.id), spawn = (env.cdSpawn || env.battleSpawn)();
  return (!toggle || allowToggle) && (il?.autoUse !== false || allowToggle && il?.managedToggle === true) && uiReady(b) && !oreBlocked(b)
    && (potionSlot(b) || localCdLeft(b) <= 0) && (!env.slotAction(b) || env.combatCooldown.skillWait(env.slotAction(b), spawn) <= 0)
    && (!toggle || env.combatCooldown.skillWait('l2_' + il.id, spawn) <= 0);
};

function cdLeft(b) {
  if (ready(b)) return 0;
  const v = uiReady(b) ? NaN : env.uiTimer(b);
  return Math.max(isNaN(v) ? 0 : v, potionSlot(b) ? 0 : localCdLeft(b), (env.slotAction(b) ? env.combatCooldown.skillWait(env.slotAction(b), (env.cdSpawn || env.battleSpawn)()) / 1000 : 0)) || 99;
}

// 20.41 (лог 20.10 21:09, память 1,3 МБ: каждая запись ≈0,5 с и подвисание страницы): память откатов и замеры боя пишутся отложенно
// (content.setRtSoon — пакетом раз в 8 с, с любой обычной записью или при уходе со страницы); память вкладки обновлена сразу
const rtSoon = p => (env.setRtSoon || env.setRt)(p)?.catch?.(() => {});
async function rememberCd(b, how) {             // how: 'used' — нажат и ушёл в КД; 'cd' — игра сказала «на перезарядке»; 'lost' — клик потерян
  // 17.10: отказ/потеря после нажатия «по серверному дедлайну» при застывшем рисунке — после двух рисунку слота снова верим (cdBusy)
  if ((how === 'cd' || how === 'lost') && frozenSince.has(b)) frozenLost.set(b, (frozenLost.get(b) || 0) + 1);
  if (how === 'lost') return;
  const k = env.skKey(b); if (!k) return;
  // Successful potions are gated by the server global cooldown, not Interlude reuse=10000.
  if (potionSlot(b)) {
    if (env.rt.cdUntil?.[k] || env.rt.skills?.[k]?.cdFloor || env.rt.skills?.[k]?.cd || env.rt.skills?.[k]?.cdNet) {
      const u = { ...(env.rt.cdUntil || {}) }, skills = { ...(env.rt.skills || {}) };
      delete u[k];
      if (skills[k]) skills[k] = { ...skills[k], cdFloor: 0, cd: 0, cdNet: 0 };
      rtSoon({ cdUntil: u, skills });
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
    if (env.rt.skills?.[k]?.cdFloor) rtSoon({ skills: { ...env.rt.skills, [k]: { ...env.rt.skills[k], cdFloor: 0 } } });
    if (how === 'cd' && !(env.ATK_NET && Date.now() - env.ATK_NET.t < 1500)) { until[k] = now + 300; rtSoon({ cdUntil: until }); }   // сервер молчит — короткая пауза
    return;
  }
  if (how === 'cd' && use[k] && now - use[k] < 30000 && (now - use[k]) / 1000 + 0.3 > floor) {
    floor = Math.min(30, (now - use[k]) / 1000 + 0.3);
    rtSoon({ skills: { ...(env.rt.skills || {}), [k]: { ...(env.rt.skills?.[k] || {}), cdFloor: +floor.toFixed(1), cdFloorAt: now } } });
  }
  if (how === 'used' && env.slotKind(b) === 'атака' && !floor) return;   // атака: готовность видна по кнопке, память — только если игра «спорила»
  const meas = (env.rt.skills?.[k]?.cd || 0) * 1000, net = (env.rt.skills?.[k]?.cdNet || 0) * 1000;
  // v5.5.5: откат, который назвал сервер (cdNet), важнее справочника Interlude (Spoil: справочник 10 с, в игре отката нет)
  const learned = net || Math.max(meas, floor * 1000); // observed game only; Interlude reuse is not authoritative
  if (env.SK_NET[k] && now - env.SK_NET[k] < 2500) { if (how === 'used') { use[k] = now; rtSoon({ cdUse: use }); } return; }   // сервер только что сказал точное время
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
  rtSoon({ cdUse: use, cdUntil: until });   // 8.0: без ожидания записи (≈0,1 с на каждом ходе; память вкладки обновлена сразу); 20.41: отложенно
}

// Mage/summoner profile is opt-in until profession metadata is available.
// Only observed hotbar actions can enter the offensive rotation.
// Future Warlock skills: never feed summon, servitor, cubic or personal
// maintenance buttons into a direct-damage slot, even without IL metadata.
function nonOffenseSkill(b) {
  if (!b) return true;
  const il = env.ilOf(b) || {};
  if (il.autoUse === false || env.noEffect?.(b) || env.slotAction?.(b) === 'battle_trance' || /^battle trance(?:\s|$)/i.test(env.cleanTitle(b.title || ''))) return true;
  if (il.c === 'Призыв' || il.t === 'SUMMON' || (il.target === 'PET' || il.target === 'CORPSE_MOB') || ['PASSIVE','TOGGLE','CHANCE'].includes(il.o)) return true;
  // 20.3: прежняя nPower Warlord содержит поддержку. Подтверждённые прямые/совмещённые удары сохраняем.
  if (['Бафф','Дебафф','Агро','Лечение','Расход HP'].includes(il.c) && !il.l2Damage && !/^(?:PDAM|MDAM|MDAMDOT|DRAIN|DAM)$/.test(il.t || '')) return true;
  const n = env.cleanTitle(b.title || '').toLowerCase();
  return /^(?:summon\b|mass summon\b|servitor\b|warrior servitor\b|final servitor\b|transfer pain\b|arcane agility\b|cubic mastery\b|mage bane\b|warrior bane\b|skill mastery\b|spell force\b|heal\b|battle heal\b|servitor bless)/i.test(n);
}

// 17.10.2026, реворк боя: реген может свести замер расхода к нулю. Стоимость
// текущего ранга сервера важнее дельты MP; все пути выбора используют одну проверку.
function actionMp(b) {
  if (!b || env.slotKind?.(b) === 'атака' || env.slotKind?.(b) === 'предмет' || env.slotAction?.(b) === 'attack') return 0;
  const n = env.cleanTitle(b.title || '').toLowerCase(), il = env.ilOf?.(b) || {};
  const learned = env.rt.skillDb?.[n] || env.rt.skillDb?.[String(il.n || '').toLowerCase()];
  if (learned && (learned.mpKnown || learned.mp > 0) && Number.isFinite(learned.mp) && learned.mp >= 0) return learned.mp;
  if (il.mp === 0) return 0; // IL_FIX: бесплатный Corpse Life Drain; общий skillMp иначе подставит30
  const measured = env.skillMp?.(env.cleanTitle(b.title || ''));
  if (Number.isFinite(measured) && measured > 0) return measured;
  const v = Array.isArray(il.mp) ? il.mp[Math.min(il.mp.length - 1, 10)] : il.mp;
  return Number.isFinite(v) && v > 0 ? v : 0;
}
function affordable(b, mp, reserve = 1) {
  const cost = actionMp(b);
  return !mp || Number.isFinite(mp.cur) && mp.cur >= cost + (cost > 0 ? reserve : 0);
}
function heroHealSkill(b, drain = false) {
  if (!b) return false;
  const il = env.ilOf(b) || {};
  if (il.autoUse === false || env.noEffect?.(b) || (il.target === 'PET' || il.target === 'CORPSE_MOB') || ['PASSIVE','TOGGLE','CHANCE'].includes(il.o)) return false;
  return drain ? il.t === 'DRAIN' || !il.c && !il.t : /^(?:HEAL|HEAL_PERCENT|HOT|HEAL_STATIC|DRAIN)$/.test(il.t || '') || !il.c && !il.t;
}

const petNote = { name: '', t: 0 }, emptyPanel = { since: 0, last: 0, logT: 0 };

// ---------- 7.1.31: кот Warlock — замер урона, статистика по котам, добивание с учётом кота, баффы кота ----------
// Удары слуги в логе боя (лог 10.10 19:35–19:45, Kai the Cat Lv.3: 150 ударов ≈1300–1670, 4 крита, 30 промахов из 184):
//   «Слуга [Kai the Cat] атакує [Unicorn] 1 409 урону.» · «Слуга [Kai the Cat] завдає критичного удару [Valley Treant Elder] 5 721 урону.»
//   «Слуга [Kai the Cat] промахнувся…». Кот бьёт «разом із власником» — на каждое действие хозяина (в т. ч. на бесплатную «Атаку»)
const PET_HIT_RE = /^(?:Слуга|Servitor)\s*\[([^\]]+)\]\s*(атаку(?:ет|[єе])|завда[єе]\s+критичн\S*\s+удар\S*|наносит\s+критическ\S*\s+удар\S*)\s*\[[^\]]*\][^\d]*?(\d[\d\s  ]*)\s*урон/i;
const PET_MISS_RE = /^(?:Слуга|Servitor)\s*\[([^\]]+)\]\s*промахну/i;
const petKeyOf = n => String(n || '').trim().toLowerCase().replace(/\s+/g, '_');
// 8.0.3 (лог 11.10 10:40: выучена Summon Feline Queen, слот #4 — раньше Kai #24): кота, которого не знаем (новая страница, телепорт,
// смерть, перезагрузка), бот брал первым на панели — теперь это королева. Порядок: выбор в меню → кот этой страницы → последний живой
// кот (rt.petLast — в т. ч. призванный игроком руками) → лучший по замерам (petAdvice) → множитель магистра L2WAP «+N % от M.Atk хозяина»
// 9.2 (игрок 11.10): Feline Queen больше не кот — слот «Summon Feline Queen» стал баффом кота Blessing of Queen (IL_FIX 1331, роль «Баффы кота»)
const PET_MUL = { feline_king: 55, kai_the_cat: 25, mew_the_cat: 20, kat_the_cat: 15 };
const isPetBuffSlot = b => env.ilOf?.(b)?.target === 'PET';
const summonKey = b => petKeyOf(env.cleanTitle(b?.title || '').replace(/^summon\s+/i, ''));
// 20.13 (ревизия 17.10, шаг 7, аудит combat/C4): «Summon … Cubic» (Life/Storm/Vampiric Cubic у Paladin/Shillien Knight и т. п.) — не слуга:
// кубик не приходит в activeSummon, и бот раз в 15 с жал «кота нет — призываю» по кубику. Призыв слуги — «Summon …», кроме кубиков и баффа кота
const NOT_SERVITOR_RE = /\bcubic\b/i;
const servitorSummonSlot = b => /^summon\b/i.test(env.cleanTitle?.(b?.title) || b?.title || '') && !NOT_SERVITOR_RE.test(env.cleanTitle?.(b?.title) || b?.title || '') && !isPetBuffSlot(b);
function petMul(k) {
  const d = env.rt.skillDb?.['summon ' + String(k || '').replace(/_/g, ' ')]?.desc || '';
  const m = d.match(/\+\s*(\d+)\s*%\s*(?:від|от)\s+(?:поточного\s+|текущего\s+)?M\.?\s*Atk/i);
  return m ? +m[1] : PET_MUL[k] || 0;
}
function petPick(sums, curKey) {
  sums = sums.filter(servitorSummonSlot);
  const by = k => k && sums.find(b => summonKey(b) === k);
  return by(curKey) || by(env.rt.petLast) || by(env.rt.petAdvice?.best) || [...sums].sort((a, b) => petMul(summonKey(b)) - petMul(summonKey(a)))[0] || null;
}
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
  env.warlock?.capture?.(ctx);
  const act = env.actNet?.(), actor = JSON.stringify([env.rt.char || '',env.rt.classCur?.slot,env.rt.classCur?.prof,(env.cdSpawn || env.battleSpawn)?.()]);
  // Все принятые ходы текущего боя, включая ручные; UI-клики и отказанные запросы не считаем.
  if (ctx.petActsKnown && actor === ctx.petActActor && Number.isSafeInteger(act?.okN) && act.okN >= ctx.petActN) ctx.pet.acts += act.okN - ctx.petActN;
  else { ctx.petActsKnown = false; ctx.petCohortMixed = true; }
  ctx.petActN = act?.okN;

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
  const P = env.petState?.(), born = +env.rt.petSummonOkT || 0;
  // 20.43 (лог 21.10 15:50:24): призыв принят после последнего «кота нет» — кот жив до нового ответа сервера; баффы кота — в этом же бою.
  // Ревью: отдельная отметка принятого призыва (petSummonOkT), не petBornT — его пишет и смерть кота в бою.
  if (P && !P.has && (P.t || 0) < born && Date.now() - born < 20000) return true;
  if (P && Date.now() - (P.t || 0) < 20000) return !!P.has && !(P.maxHp && P.hp <= 0);
  const box = env.$q('#l2-hud-companion'), m = box && env.shown(box) ? box.textContent.replace(/\s+/g, '').match(/HP(\d+)\/(\d+)/i) : null;
  return !!m && +m[1] > 0;
}
// сколько кот снимет за следующее действие хозяина: средний ОБЫЧНЫЙ удар (криты — случайность, не в счёт; текущего боя, если уже
// ≥ 2 удара) × 0,85 (самый слабый удар в логе ≈0,87 среднего). Только если кот действует почти на каждое действие хозяина (≥ 80 %),
// промахивается не чаще 25 % (в логе 16 %) и замеров ≥ 5 — иначе 0 (на кота не рассчитываем)
function petExpect(ctx) {
  if (!petAlive()) return 0;
  const measured = env.warlock?.petExpected?.(ctx);
  if (measured != null) return measured;
  const P = env.petState?.(), k = P?.key || ctx?.pet?.key || '', S = env.rt.petStat?.[k] || {}, c = ctx?.pet || {};
  const sum = f => (S[f] || 0) + (c[f] || 0);
  const hits = sum('hits'), acts = sum('acts'), swings = hits + sum('crits') + sum('misses');
  if (hits < 5 || acts < 5 || swings / acts < 0.8 || sum('misses') / swings > 0.25) return 0;
  const avg = c.hits >= 2 ? (c.hitDmg || 0) / c.hits : sum('hitDmg') / hits;
  return avg > 0 ? avg * 0.85 : 0;
}
// 20.63 (лог 25.10, Feline King): кот бьёт не на каждое действие, а по своему таймеру ≈2,5 с — на первый атакующий ход хозяина после него
// (Curse Chaos первым ходом боя — удар кота в 97 %, Blaze через 0,5–1,5 с после удара кота — 0–3 %). petExpect (для добивания) тогда 0,
// и дебафф считал, что весь урон — заклинания героя (доля 100 % вместо ≈25 %): Curse Chaos/Surrender шли первым ходом в 40 % боёв на
// мобах, которых кот убивал за 1–2 удара. Для доли урона берём средний урон кота (с критами) на принятое действие хозяина
function petPerAct(ctx) {
  if (!petAlive()) return 0;
  const k = env.petState?.()?.key || ctx?.pet?.key || '', S = env.rt.petStat?.[k] || {}, c = ctx?.pet || {};
  const dmg = (+S.dmg || 0) + (+c.dmg || 0), acts = (+S.acts || 0) + (+c.acts || 0);
  return acts >= 10 && dmg > 0 ? dmg / acts : 0;
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
  if (env.pvpPending?.()) return;
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
  if (env.pvpPending?.()) return;
  await env.warlock?.noteBattle?.(ctx);
}
// бафф кота (роль «Баффы кота»): кот жив, моб не при смерти (на бафф уходит ход), MP хватает с запасом. Бафф держится dur с
// (справочник, иначе petBuffSec = 1200) и слетает при новом призыве/смерти кота (rt.petBornT). «В бою эффекта нет» — никогда
function petBuffPick(ctx, me, mp, mob) {
  const list = env.names(env.cfg.nPetBuffs || '');
  if (!list.length || env.cfg.petBuffAuto === false) return null;
  const now = Date.now();
  if (!petAlive()) return null;
  if (me && me.pct <= (env.cfg.hpPotAt ?? 50)) return null;
  // 9.2.2 (ответ админа 11.10 21:21): Blessing of Queen теперь +30 % шанса крита и +25 % урона крита кота на 20 мин (было +20 % крит-урона
  // на 2 мин). По замерам (крит кота ≈3 % ударов, ≈3,9 обычного) кот бьёт в среднем ≈×2,1 → весь урон ≈+40 % за один ход раз в 20 мин —
  // ставим всегда, как только истёк, и в цепочке тоже (прежнее правило 9.2 «только на РБ и толстых мобах» — для баффа на 2 мин — снято)
  for (const n of list) {
    const b = slotsBy(n)[0];
    if (!b || env.noEffect?.(b) || !ready(b) || (ctx.block['petbuff:' + n] || 0) > now) continue;
    const at = (env.rt.petBuffAt || {})[n] || 0, dur = ((env.ilOf(b) || {}).dur || env.cfg.petBuffSec || 1200) * 1000;
    let confirmedMissing = false;
    // 20.43: бафф уже поставлен вне боя (подготовка после Старта/перед РБ) — по свежему снимку сервера не повторяем.
    const nativeRow = env.slotAction(b) !== 'l2_1331' && (env.rt.petRaidSkills?.rows || []).find(r => String(r?.name || '').trim().toLowerCase() === String(n).trim().toLowerCase());
    if (nativeRow && +nativeRow.effectId > 0 && env.warlock?.petBuffState?.(+nativeRow.effectId, at) === true) continue;
    if (env.slotAction(b) === 'l2_1331') {
      // Подтверждённый бафф слуги важнее локального таймера, в том числе оплаченный набор.
      const petBuff = env.warlock?.petBuffState?.(4699, at) ?? (env.warlock?.petBuffActive?.(4699) ? true : null);
      if (petBuff === true) continue;
      confirmedMissing = petBuff === false;
      // 15.10: эффект4699 героя после слота1331 живёт20мин. Его наличие останавливает
      // повтор при неизвестном состоянии слуги; подтверждённое отсутствие у пета или новый призыв требует баффа.
      const hero = env.activeBuffs?.().find(x => +x.id === 4699 && +x.exp > now + 5000);
      const born = +env.rt.petBornT || 0, applied = Math.max(at, hero ? +hero.exp - dur : 0);
      if (petBuff == null && hero && (!born || applied >= born && applied <= now + 5000)) continue;
    }
    // Свежий полный снимок после Cancel важнее старой локальной отметки успешного баффа.
    if (!confirmedMissing && at > (env.rt.petBornT || 0) && now - at < dur - 5000) continue;
    // 10.0 (аудит боя): Blessing of Queen ≈ +40 % урона на 20 мин — резерв 25 % MP не держим (MP не экономим), хватает на сам бафф — ставим
    // 20.12 (ревизия 17.10): цена — та же actionMp(), что проверяет act(); средний замер расхода занижен регеном,
    // и бафф выбирался при MP ниже серверной цены → act() отказывал, цикл боя крутился без паузы
    if (mp && (mp.cur < (env.skillMp(env.cleanTitle(b.title)) || 0) || !affordable(b, mp, 0))) continue;
    return { b, n };
  }
  return null;
}

// Вернуть банку на панель боя: пустой слот → вкладка «Розхідники» → банка с наибольшим запасом нужного вида
async function potSlotRestore(kind) {
  const tk = kind + 'PotFixT', now = Date.now();
  if (now - (env.rt[tk] || 0) < 120000) return false;
  env.rt[tk] = now; env.setRt({ [tk]: now });   // 7.1.30: пауза переживает перезагрузку страницы боя
  // 20.76+ (ревизия 28.10): усиленные «Велике зілля HP/MP» (#920044/#920045, 18.10 — пьются первыми, признаки как resources.bigPot) и
  // «Зілля слабкого зцілення» фильтр не проходили: при пустом слоте и только усиленных в сумке — «в сумке их тоже нет», бой без банок. Усиленные — первыми
  const big = kind === 'mp' ? /^(?:велике зілля|большое зелье)\s*(?:mp|ман)|^large mp potion|^#920045\b/i : /^(?:велике зілля|большое зелье)\s*hp|^large hp potion|^#920044\b/i;
  const want = kind === 'mp' ? /зілля мани|зелье маны|mana potion/i : /^(?:зілля (?:слабкого |сильного )?зцілення|зелье (?:слабого |сильного )?исцеления|(?:lesser |greater )?healing potion)/i;
  const pref = kind === 'mp' ? /велик|больш|greater/i : /^(?:зілля зцілення|зелье исцеления|healing potion)\b/i;
  const rank = b => big.test(b.title || '') ? 2 : pref.test(b.title || '') ? 1 : 0;
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
  const picks = [...document.querySelectorAll('.l2-battle-hotbar-pick')].filter(b => (big.test(b.title || '') || want.test(b.title || '')) && qtyOf(b) > 0)
    .sort((a, b) => rank(b) - rank(a) || qtyOf(b) - qtyOf(a));
  if (!picks.length) { await close(); return warn('в сумке их тоже нет (докупит магазин)'); }
  const pk = picks[0], nm = (pk.title || '').replace(/\s*×.*$/, '');
  env.fire(pk);
  const ok = await env.waitFor(() => !env.shown(env.$q('.l2-battle-hotbar-modal__panel')) || !empty.isConnected || !empty.classList.contains('l2-battle-hotbar-slot--empty') ? 1 : null, 3000, 100);
  await close();
  env.rec('B', 'панель', ok ? `банка ${label} кончилась на панели — поставил «${nm}» (×${qtyOf(pk)}) в ${slotNm}` : `не удалось поставить «${nm}» на панель`);
  return !!ok;
}

function mageCombat() { return env.combatProfileKind?.() === 'mage_summoner'; }
// Dark Avenger и другие бойцы тоже держат боевого слугу. Управление им зависит от
// умения призыва на панели, а не от магического профиля хозяина.
function summonCombat() {
  return mageCombat() || [...document.querySelectorAll(env.SLOT)].some(b => (!env.slotKind || env.slotKind(b) === 'скилл') && servitorSummonSlot(b));
}

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
const spellOwner = () => env.evidenceOwner?.() ?? JSON.stringify([env.rt.char || '', env.rt.classCur?.prof || '', env.rt.classCur?.slot ?? '', env.rt.classSwT || env.rt.classCur?.t || 0]);
function spellSample(ctx, key, dmg) {
  if (!ctx || !(dmg > 0) || !key) return;
  const owner = spellOwner();
  if (ctx.spellOwner == null) ctx.spellOwner = owner;
  if (ctx.spellOwner !== owner) ctx.spellInvalid = true;
  if (ctx.spellInvalid) return;
  const s = ((ctx.spellDmg ||= {})[key] ||= { off: [0, 0], on: [0, 0] }), w = dbfOn(ctx) ? s.on : s.off;
  w[0] += dmg; w[1]++;
}
// итог боя: отношение «под дебаффом / без» по каждому заклинанию, где есть оба замера → rt.debuffGain
async function debuffGainFlush(ctx) {
  if (!ctx || ctx.spellInvalid) return;
  if (ctx.spellOwner !== spellOwner()) { ctx.spellInvalid = true; return; }
  const r = Object.values(ctx?.spellDmg || {}).filter(s => s.off[1] && s.on[1]).map(s => (s.on[0] / s.on[1]) / (s.off[0] / s.off[1]));
  if (!r.length) return;
  const samples = r.map(x => Math.round(x * 1000) / 1000);
  const all = [...(Array.isArray(env.rt.debuffGain) ? env.rt.debuffGain : []), ...samples].slice(-30);
  const fresh = env.rt.debuffEvidence?.v === 1 ? env.rt.debuffEvidence.ratios || [] : [];
  await env.setRt({ debuffGain: all, debuffEvidence: { v: 1, ratios: [...fresh, ...samples].slice(-30) } });
  const g = debuffGain();
  if (g) env.rec('B', 'дебафф', `замер выгоды: урон заклинаний под M.Def-дебаффом ×${g.ratio.toFixed(2)} (${g.n} замеров) → ${g.ratio < 1.03 ? 'прибавки нет — атакующие дебаффы выключены' : 'окупается, если бою ещё ≥ ' + g.minActs + ' действий'}`);
}
function debuffGain() {                                   // медиана отношений; null — замеров меньше 6
  const a = [...(env.rt.debuffEvidence?.v === 1 ? env.rt.debuffEvidence.ratios || [] : [])].filter(x => x > 0).sort((x, y) => x - y);
  if (a.length < 6) return null;
  const ratio = a[a.length >> 1];
  return { ratio, n: a.length, minActs: ratio > 1.001 ? Math.ceil(1 / (ratio - 1)) + 1 : Infinity };
}
// 20.43 (разбор 21.10): иммунитет к дебаффам — у РБ общий флаг (7.2.1), у мобов/чемпионов — по виду цели на 24 ч, потом одна проба.
// Старые общие флаги .mob/.champ не действуют (миграция dbfImm2043 их снимает; у других классов в classStash они просто лежат)
const IMM_MS = 24 * 3600000, immKey = ctx => (ctx?.champ ? 'ч:' : '') + String(ctx?.name || '?').trim().toLowerCase();
const dbfImmune = ctx => ctx.rebirth ? ctx.rebirthImmune === true : ctx.rb ? !!env.rt.debuffImmune?.rb : Date.now() - (+env.rt.debuffImmune?.sp?.[immKey(ctx)] || 0) < IMM_MS;
function debuffPlan(ctx, mp, me) {
  if (env.cfg.debuffAuto === false) return null;
  if (dbfImmune(ctx)) return null;   // 7.2.1: «має імунітет до негативних ефектів»; 20.43: мобы/чемпионы — по виду и со сроком
  const mob = mobHp(); if (!mob || mob.cur <= 0) return null;
  const avg = spellAvg(), mode = env.cfg.debuffMode || 'auto', g = debuffGain();
  const pet = Math.max(petExpect(ctx), petPerAct(ctx)), actsLeft = mob.cur / Math.max(1, avg + pet);   // 20.63: и средний удар кота на ход
  // 10.0.7 (игрок 13.10 03:11: «бот стал усиленно дебафать мобов — на сколько это даёт прирост?»; лог 13.10 12:25–13:12: на чемпионах
  // 35 ходов на дебаффы, Ghost of Rebellion Soldier — 6 из 18 ходов, 12 из 44 дебаффов не прошли, «замер выгоды» ни разу — дебафф шёл
  // первым ходом, сравнивать было не с чем). Цена хода на дебафф против выигрыша теперь по той же модели, что и баффы:
  // M.Def −10 % → заклинания ≈×1,11 (урон ∝ 1/M.Def), кот от M.Def цели не зависит → прибавка только на долю заклинаний в уроне;
  // шанс пройти — по своей статистике (rt.debuffStat, ≥ 6 попыток; на чемпионах 13.10 — 73 %); окупается, если за время действия
  // дебаффа (dur ÷ ход) и за остаток боя набегает ≥ 1 ход выигрыша. Без замера — модель, замер rt.debuffGain её заменяет
  const share = avg / Math.max(1, avg + pet), ratio = g ? g.ratio : DBF_MODEL;
  const st0 = Object.values(env.rt.debuffStat || {}).reduce((a, s) => [a[0] + (s.ok || 0), a[1] + (s.fail || 0)], [0, 0]);
  const pass = st0[0] + st0[1] >= 6 ? Math.max(0.2, st0[0] / (st0[0] + st0[1])) : 1;
  const eff = (ratio - 1) * share * pass, turnS = Math.max(0.6, (env.rt.turnMs || 1000) / 1000);
  const needActs = Math.max(g ? 0 : (env.cfg.debuffMinActs ?? 10), eff > 0.001 ? Math.ceil(1 / eff) + 1 : Infinity);
  const noGain = !!g && g.ratio < 1.03 && mode !== 'always';                 // замер: прибавки нет
  const longFight = actsLeft >= needActs, boss = bigTarget(ctx), hurt = !!me && me.pct < 70;
  // на РБ и чемпионе без замера — сперва 2 заклинания без дебаффа (чтобы было с чем сравнить), потом дебафф
  const offSamples = Object.values(ctx.spellDmg || {}).reduce((s, x) => s + x.off[1], 0);
  const learnWait = !g && !!(ctx.rb || (ctx.champ && mode === 'auto')) && offSamples < 2;
  // 10.0.7: проба на чемпионе ради замера — один M.Def-дебафф раз в 3 мин, даже если модель говорит «не окупится» (иначе замера не будет)
  const now0 = Date.now(), probe = !g && !!ctx.champ && !learnWait && !ctx.dbfProbe && actsLeft >= 6 && now0 - (env.rt.dbfProbeT || 0) > 180000;
  const offOk = !noGain && !learnWait && (mode !== 'auto' || longFight || !!ctx.rb || probe);
  const mdefOn = dbfOn(ctx) && !ctx.rb;                                      // 10.0.7: второй M.Def-дебафф поверх первого — только на РБ (стакаются ли — не знаем)
  if (mode === 'boss' ? !boss : !offOk && !hurt && !ctx.rb) return null;
  const list = env.names(env.cfg.nDebuff || '');            // свой список в «Бой → Дебаффы»: только они, в этом порядке
  const stat = env.rt.debuffStat || {}, now = Date.now();
  const opts = [...document.querySelectorAll(env.SLOT)].filter(b => env.slotKind(b) === 'скилл' && env.ilOf(b)?.c === 'Дебафф' && ready(b)).map(b => {
    const il = dbfIl(b), n = env.cleanTitle(b.title), k = n.toLowerCase(), s = stat[k] || {};
    const defOk = !!ctx.rb || hurt || (mode !== 'auto' && boss);
    let pr = 0;
    if (il.off && il.def) pr = offOk && !mdefOn ? 95 : defOk ? 70 : 0;      // Curse Chaos: и урон, и защита
    else if (il.off) pr = offOk && !mdefOn ? 90 : 0;                       // Surrender to Fire
    else if (il.def) pr = defOk ? (/weakness/i.test(k) ? 75 : 60) : 0;   // Curse Weakness (−20 %) раньше Poison (−12 %)
    else if (il.t === 'POISON') pr = ctx.rb ? 30 : 0;
    else pr = ctx.rb && !/^slow\b/i.test(k) ? 20 : 0;          // прочие — только РБ; Slow (скорость) в пошаговом бою не нужен
    if (list.length) pr = list.includes(k) && (pr > 0 || mode === 'always') ? 100 - list.indexOf(k) : 0;
    if (s.offUntil > now || (ctx.block['debuff:' + k] || 0) > now) pr = 0;
    const last = (ctx.debuffed || {})[k] || 0, dur = (il.dur || 15) * 1000;
    // 10.0.7: атакующий дебафф не успеет окупиться за своё время действия (dur ÷ ход < нужных ходов) — не жмём (кроме РБ/пробы/«всегда»)
    if (il.off && !ctx.rb && !probe && mode === 'auto' && dur / 1000 / turnS < needActs) pr = il.def && defOk ? 70 : 0;
    if (last && !(ctx.rb || mob.cur >= avg * 6)) pr = 0;          // обычный моб — один раз
    if (last && now - last < dur) pr = 0;
    if (mp && (mp.cur < (env.skillMp(n) || 10) + 30 || !affordable(b, mp, 0))) pr = 0;       // мана — сначала на урон; 20.12 (ревизия 17.10): и не ниже цены act()
    return { b, n, k, pr };
  }).filter(o => o.pr > 0).sort((a, b) => b.pr - a.pr);
  const pick = opts[0] || null;
  if (pick && probe && dbfIl(pick.b).off) { ctx.dbfProbe = 1; env.setRt({ dbfProbeT: now0 }); env.rec('B', 'дебафф', `проба на чемпионе: ${pick.n} — замерю прибавку урона заклинаний (модель: ≈×${ratio.toFixed(2)}, проходит ${Math.round(pass * 100)} %)`); }
  return pick;
}
// 10.0.7: модель без замера — M.Def −10 % → урон заклинаний ×1,11 (Interlude: урон ∝ 1/M.Def); замер rt.debuffGain важнее
const DBF_MODEL = 1.11;

// средний замеренный урон заклинаний с панели (≥ 2 замера), без замеров — 600
function spellAvg() {
  const DS = skillView(), known = mageSpellSlots().map(b => DS?.[env.cleanTitle(b.title).toLowerCase()]).filter(p => p?.dmgN >= 2).map(p => p.dmg / p.dmgN);
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : 600;
}

function mageSpellSlots() {
  // Only confirmed direct-damage magic or a skill with measured positive damage.
  // Never click summoning, healing, support or unknown abilities as attacks.
  const DS = skillView();
  return [...document.querySelectorAll(env.SLOT)].filter(b => {
    if (!b || env.slotKind(b) !== 'скилл' || env.isEquip(b) || nonOffenseSkill(b)) return false;
    const il = env.ilOf(b) || {}, n = env.cleanTitle(b.title || '');
    // 7.1.31 (скрин магистра 10.10): Corpse Life Drain на L2WAP лечит («Power 0»), урона нет; по справочнику — «Маг. атака» по трупу.
    // Не в ротацию: цель-труп, «в бою эффекта нет», или 5+ нажатий без единого замера урона
    if (il.target === 'CORPSE_MOB' || /труп моба/.test(il.L || '') || env.noEffect?.(b)) return false;
    const p = DS?.[n.toLowerCase()];
    if (p && (p.uses || 0) - (p.unknown || 0) >= 5 && !p.dmgN) return false;
    if (il.c && il.c !== 'Маг. атака' && il.t !== 'MDAM' && il.t !== 'MDAMDOT') return false;
    return il.c === 'Маг. атака' || il.t === 'MDAM' || il.t === 'MDAMDOT' ||
      ((DS?.[n.toLowerCase()]?.dmgN || 0) >= 2 && !il.c);
  });
}

function magePlan(ctx, mp) {
  const mob = mobHp(), hp = mob?.cur || Infinity;
  // 7.1.16-fix: у моба осталось меньше, чем снимает обычная атака (лог 09.10: атака мага 80–84, а на 1–4 HP тратилось заклинание) —
  // добиваем атакой. И если маны нет совсем (банки нет/на откате) — атака лучше, чем стоять
  const atk = [...document.querySelectorAll(env.SLOT)].find(b => env.slotKind(b) === 'атака' && ready(b) && (ctx.block.attack || 0) <= Date.now());
  // только по реальному замеру атаки (≥ 3 удара): без замера expDmg даёт 600 по умолчанию, и бот бил атакой (1 урон) по мобу с 134 HP
  const DS = skillView(), aS = DS?.['атака'], atkD = aS?.dmgN >= 3 ? aS.dmg / aS.dmgN : 0;

  // 7.1.31 (просьба игрока): кот бьёт вместе с хозяином (Kai Lv.3 ≈1500). Моб умрёт от удара кота — жмём бесплатную «Атаку»
  // (кот ударит с ней), заклинание за 22 MP не тратим. Атака на откате — ниже «добивание» само возьмёт самое дешёвое заклинание.
  // Только когда мана тратится (MP < petFinishMp, 80 %): кот промахивается ≈16 % (лог 10.10 19:35–19:45) — при полной мане
  // сэкономленные MP всё равно сгорят на регене, а промах кота стоил бы лишнего хода.
  // По умолчанию ВЫКЛ (просьба игрока: банки MP дешёвые, MP не экономим — важен ДПС). Включить: «Слуга → Учитывать удар кота при добивании»
  const mpLow = !mp?.max || mp.cur / mp.max * 100 < (env.cfg.petFinishMp ?? 80);
  const petN = env.cfg.petFinish === true && !ctx.rb && mpLow ? petExpect(ctx) : 0;

  const freeFinish = () => {
    if (atk && mob && mob.cur > 0 && atkD > 0 && mob.cur <= atkD * 0.8 && !ctx.rb)
      return { key: 'attack', name: 'атака', b: atk, dmg: atkD, why: `магия: добиваю атакой (${mob.cur} HP ≤ атака ≈${Math.round(atkD)})` };
    if (atk && mob && mob.cur > 0 && petN > 0 && mob.cur <= petN)
      return { key: 'attack', name: 'атака', b: atk, dmg: petN, pet: true, why: `кот добьёт (${mob.cur} HP ≤ удар кота ≈${Math.round(petN)}) — бесплатная атака` };
    return null;
  };
  // 7.1.30 (ночь 09→10.10): 75 % времени боя маг сидел почти без MP (банки на панели не было) и бил атакой по 1 урону.
  // Реген ≈7 MP/с — когда мана кончилась, урон упирается в «урон за 1 MP»: Energy Bolt ≈60/MP против Blaze ≈35/MP.
  // Поэтому: банки нет и MP < mageEcoPct (30 %) — режим экономии: заклинание с лучшим уроном на 1 MP; ниже порога
  // skillMpMin — всё равно колдуем, если хватает на самое дешёвое (атака мага по мобам ≈0)
  // 10.0 (правило игрока «MP не экономим», аудит боя): экономия — только когда банки MP нет совсем; банка на откате — не повод (раньше ready(potB))
  const potB = env.mpPotSlot?.(), potOk = !!(potB && env.qty(potB) !== 0);
  const eco = !!mp && !potOk && mp.max > 0 && mp.cur / mp.max * 100 < (env.cfg.mageEcoPct ?? 30);
  if (mp && mp.cur < (env.cfg.skillMpMin ?? 35)) {
    const cheap = Math.min(Infinity, ...mageSpellSlots().filter(ready).map(actionMp));
    if (!(cheap <= mp.cur - 1)) {
      if (freeFinish()) return freeFinish();
      if (potOk) return null;                     // 7.1.30: ни на что не хватает, банка есть — её выпьет блок банок
      if (atk && mob && mob.cur > 0) return { key: 'attack', name: 'атака', b: atk, dmg: atkD, why: `магия: MP ${mp.cur} — нет маны, бью атакой` };
      return null;
    }
  }
  const priority = env.names(env.cfg.nPower || '');
  const opts = mageSpellSlots().filter(b => ready(b) && (ctx.block['power:' + b.title] || 0) <= Date.now())
    .map(b => {
      const n = env.cleanTitle(b.title), il = env.ilOf(b) || {}, k = env.skKey(b);
      const mpCost = actionMp(b);
      // 9.2: урон по ЭТОЙ цели (анализатор боя: прошлые бои с ней + этот бой) важнее общего среднего по всем мобам
      const observed = env.fightDmgOn?.(n);
      const dmg = observed?.mean ?? (env.expDmg(k) || env.expDmg(n) || 0);
      const base = Array.isArray(il.pow) ? il.pow[0] : il.pow || 0;
      return { key:'power:' + b.title, name:n, b, dmg:observed ? dmg : dmg || base, mpCost,
        cd: env.rt.skills?.[k]?.cdNet || env.rt.skills?.[k]?.cd || (il.reuse || 5000)/1000,
        order:priority.indexOf(n.toLowerCase()) };
    }).filter(o => affordable(o.b, mp));
  if (!opts.length) return freeFinish();
  // До одиночного добивания сравниваем дополнительную добычу: текущие HP соседей
  // либо свежую подтверждённую отдачу АОЕ в этой же зоне.
  const group = groupPlan(ctx, opts, eco);
  if (group) return group;
  if (freeFinish()) return freeFinish();
  // 7.1.16-fix: новые заклинания — учим в игре. Урон/КД/MP в L2WAP не как в Interlude, а без замера бот брал
  // «≈900 по умолчанию» и мог считать новое заклинание добивающим. Заклинание с < 3 замерами сначала пробуется на «толстом»
  // мобе (HP заметно больше любого известного удара — чтобы урон не обрезался смертью моба), затем встаёт в очередь по замеру
  const meas = o => DS?.[o.name.toLowerCase()]?.dmgN || 0;
  const known = opts.filter(o => meas(o) >= 3), maxKnown = Math.max(0, ...known.map(o => o.dmg));
  if (env.cfg.mageProbe !== false && !ctx.rb && mob && mob.cur > 0) {
    const probe = opts.filter(o => meas(o) < 3).sort((a, b) => meas(a) - meas(b) || a.mpCost - b.mpCost)[0];
    if (probe && hp > Math.max(maxKnown, 300) * 1.3) return { ...probe, probe: true, why: `магия: пробую новое заклинание (замер ${meas(probe)}/3)` };
  }
  // Cheap finishing move > observed damage per cast > configured order.
  // 7.1.31: удар кота в этом же ходу — часть добивания: заклинанию нужно снять только остаток (Energy Bolt 8 MP вместо Blaze 22 MP)
  const hpK = Math.max(1, hp - petN);
  // 9.2: добивание по замерам урона по этой цели — доля ударов, которых хватило бы (а не «среднее ≥ HP × 1,08»): самое дешёвое из
  // надёжных (≥ 85 %). Надёжного среди готовых нет, а надёжное откатится раньше, чем через полхода, — ждём его, а не тратим ход на
  // удар, который не добьёт (лог 12.10 01:42:30: Energy Bolt 2940 по Banshee 3060 → 120 HP, ещё ход на Vampiric Touch)
  if (mob && mob.cur > 0 && env.fightKillP) {
    const sure = opts.map(o => ({ o, p: env.fightKillP(o.name, hpK) })).filter(x => x.p != null && x.p >= 0.85)
      .sort((a, b) => a.o.mpCost - b.o.mpCost || b.p - a.p)[0];
    if (sure) return { ...sure.o, why: `магия: добивание (${hp} HP) · по этой цели добивает в ${Math.round(sure.p * 100)} % ударов` };
    const wk = mob.max + '/' + mobTitle();
    if (ctx.waitKillMob !== wk) { ctx.waitKillMob = wk; ctx.waitKillT = 0; }   // новый моб (цепочка) — заново
    const expired = !!ctx.waitKillT && Date.now() - ctx.waitKillT > 1500;
    const soon = expired ? null : mageSpellSlots().filter(b => !ready(b) && cdLeft(b) > 0 && cdLeft(b) <= env.turnSec() * 0.5 && affordable(b, mp))
      .map(b => ({ n: env.cleanTitle(b.title), p: env.fightKillP(env.cleanTitle(b.title), hpK) })).filter(x => x.p != null && x.p >= 0.85)[0];
    const nowKill = opts.some(o => { const p = env.fightKillP(o.name, hpK); return p != null ? p >= 0.5 : o.dmg >= hpK * 1.08; });
    if (soon && !nowKill && !ctx.rb) { ctx.waitKillT ||= Date.now(); ctx.waitWhy = `жду ${soon.n}: откатится через полхода и добьёт (${Math.round(soon.p * 100)} %)`; return null; }
    if (!expired) ctx.waitKillT = 0;               // ждём не дольше 1,5 с на моба — дальше бьём тем, что готово
  }
  // Подтверждённые промахи не обходятся запасным правилом среднего урона.
  const kill = (known.length ? known : opts).filter(o => { const p = env.fightKillP?.(o.name, hpK); return p != null ? p >= 0.85 : o.dmg && o.dmg >= hpK * 1.08; })
    .sort((a,b)=>a.mpCost-b.mpCost || b.dmg-a.dmg)[0];
  if (kill) return { ...kill, why: petN > 0 && hpK < hp ? `магия: добивание вместе с котом (${hp} HP, кот ≈${Math.round(petN)})` : `магия: добивание (${hp} HP)` };
  if (eco) {
    const per = o => o.dmg / Math.max(1, o.mpCost);
    const e = opts.sort((a, b) => per(b) - per(a) || b.dmg - a.dmg)[0];
    return { ...e, why: `магия: экономия MP (${mp.cur}/${mp.max}, банки нет) · ≈${Math.round(per(e))} урона/MP` };
  }
  const best = opts.sort((a,b) => b.dmg-a.dmg || b.cd-a.cd ||
    (a.order === -1 ? 999 : a.order)-(b.order === -1 ? 999 : b.order))[0];
  const sustain = raidDrainPlan(ctx, opts, best);
  if (sustain) return sustain;
  return { ...best, why:`магия: цепочка · урон ≈${Math.round(best.dmg)}` };
}

// 10.0.21, лог 15.10 10:40–10:42: Hekaton вручную убит через VT без банок, HP не падало ниже 87 %.
// Порог 85 % пропускал полезное раннее восстановление. Сравниваем потерю урона с ценой отдельного
// хода банки; кот на атакующем ходу сохраняется, но его крит/урон не прибавляем к выгоде повторно.
function raidDrainPlan(ctx, opts, best) {
  if (!ctx.rb || ctx.rb.usePots === false || env.cfg.rbTurnPrice === false || env.cfg.rbUsePots === false || (env.cfg.drainHp ?? 85) <= 0 || !(best?.dmg > 0)) return null;
  const me = env.meHp(), missing = me ? me.max - me.cur : 0;
  if (!(missing > 0)) return null;
  // Заканчиваем короткий остаток боя уроном. Слуга здесь — только подтверждённый обычный удар.
  if ((mobHp()?.cur || 0) <= 3 * (best.dmg + petExpect(ctx))) return null;
  const stock = hpPotStock(), reserve = ctx.rb.allIn ? 0 : env.cfg.rbPotReserve || 0;
  const pots = hpReserveBlocked(stock[0]?.b, reserve) ? [] : stock.filter(p => env.potBag(p.b) > 0);
  // Для цены банки учитываем всё известное лечение, а не только один импульс регенерации.
  const potHeal = Math.max(0, ...pots.map(p => Math.max(p.heal || 0, env.rt.pots?.[p.key]?.heal || 0)));
  if (!(potHeal > 0)) return null;
  const drains = env.names(env.cfg.nDrain), now = Date.now(), DS = skillView();
  const candidates = opts.filter(o => o.b !== best.b && drains.includes(o.name.toLowerCase()) &&
    (ctx.block['drain:' + o.b.title] || 0) <= now && (DS?.[o.name.toLowerCase()]?.dmgN || 0) >= 3).map(o => {
    // 40 % VT подтверждены каталогом игры (kb/data/game-skills-warlock.json). Это только оценка
    // для безопасного раннего хода; аварийную банку по-прежнему заменяет лишь фактическое лечение.
    const desc = env.rt.skillDb?.[o.name.toLowerCase()]?.desc || '';
    const ratio = env.slotAction(o.b) === 'l2_1147' ? 0.4 : +(desc.match(/вамп[иі]ризм\s*(\d+(?:[.,]\d+)?)\s*%/i)?.[1]?.replace(',', '.') || 0) / 100;
    const observed = env.fightHealOn?.(o.name), damage = env.fightDmgOn?.(o.name);
    const estimated = ratio > 0 && ratio <= 1 ? (damage?.p20 || o.dmg) * ratio : 0;
    const heal = observed?.n >= 2 ? observed.p20 : estimated;
    // Малые фактические +HP у полной полоски не делают частичный долив бесплатным: ждём
    // места под полный ожидаемый вампирик, чтобы ранний каст не создавал лишних лечащих ходов.
    const capacity = Math.max(heal || 0, ratio > 0 && ratio <= 1 ? o.dmg * ratio : 0);
    const loss = best.dmg - o.dmg, saved = best.dmg * Math.min(1, heal / potHeal);
    return heal > 0 && missing >= capacity && loss <= saved ? { ...o, heal, gain: saved - loss } : null;
  }).filter(Boolean).sort((a,b) => b.gain - a.gain || b.dmg - a.dmg);
  const pick = candidates[0];
  return pick ? { ...pick, raidDrain: true, why: `РБ: ранний вампиризм (≈${Math.round(pick.heal)} HP), выгоднее отдельного хода банки` } : null;
}

function dpsPlan(ctx, mp) {
  const free = k => (ctx.block[k] || 0) <= Date.now();
  const mpOk = !mp || mp.cur >= env.cfg.skillMpMin;
  const hp = mobHp()?.cur || 0, fN = env.forceNow(), DS = skillView();
  const opts = [];
  const atk = mageCombat() ? null : slotsBy(env.cfg.nAttack).find(ready);
  if (atk && free('attack')) opts.push({ key: 'attack', name: 'атака', b: atk, dmg: env.expDmg('атака'), cd: 0 });
  if (mpOk) {
    for (const n of env.names(env.cfg.nPower).filter(n => !env.names(env.cfg.nUltra).includes(n))) {   // v5.3: сверхсильные — только через ultPick
      const b = slotsBy(n)[0];
      const il = b && env.ilOf(b);
      if (nonOffenseSkill(b) || weaponBarred(b)) continue;   // 20.43: навык не под надетое оружие
      if (!b || !ready(b) || !free('power:' + b.title) || env.isChargeName(env.cleanTitle(b.title)) || env.isForceName(env.cleanTitle(b.title))) continue;
      // 10.0.11 (лог 13.10 22:03–22:12, Knight alt1): Drain Health — в логе игры без цифры урона («Витягування життя: темний урон…»),
      // 26 нажатий, урон засчитан 1 раз. Как у мага (mageSpellSlots): 5+ нажатий без единого замера урона — удара в ротации нет
      { const k = env.skKey(b), pS = DS?.[k];
        if (il?.l2Damage && !pS?.dmgN) { // старые нули были следствием ошибочного типа «дебафф»; даём до трёх новых замеров в бою
          const starts = ctx.damageProbeStart ||= {}, start = starts[k] ??= pS?.uses || 0;
          if (Math.max((pS?.uses || 0) - start, ctx.damageProbeActs?.[k] || 0) >= 3) continue;
        } else if (pS && (pS.uses || 0) - (pS.unknown || 0) >= 5 && !pS.dmgN) continue;
      }
      opts.push({ key: 'power:' + b.title, name: env.cleanTitle(b.title), b, damageProbe: !!il?.l2Damage && !DS?.[env.skKey(b)]?.dmgN, dmg: env.fightDmgOn?.(env.cleanTitle(b.title))?.mean ?? env.expDmg(env.skKey(b)), cd: DS?.[env.skKey(b)]?.cd || env.rt.skillDb?.[env.skKey(b)]?.cd || (env.ilOf(b)?.reuse || 5000) / 1000 });
    }
    for (const c of env.forceCosts()) {
      const b = slotsBy(c.name)[0], k = c.name.toLowerCase();
      if (!b || nonOffenseSkill(b) || weaponBarred(b) || !ready(b) || !free('force:' + c.name) || fN < c.cost) continue;
      opts.push({ key: 'force:' + c.name, name: `${c.name} (−${c.cost} эн.)`, b, dmg: env.expDmg(c.name), force: c.cost, cost: c.cost,
                  cd: env.rt.skills?.[k]?.cd || env.rt.skillDb?.[k]?.cd || 10 });
    }
  }
  // RB: prefer major single-target damage on cooldown. Respect existing configured roles,
  // but recognize these three skills from hotbar when autoRoles did not fill nPower.
  if (ctx.rb && mpOk) for (const n of ['Burning Fist', 'Soul Breaker', 'Iron Punch']) {
    const b = slotsBy(n)[0];
    if (!b || weaponBarred(b) || !ready(b) || !free('power:' + b.title) || opts.some(o => o.b === b)) continue;
    if (mp && mp.cur < (env.skillMp(n) || 0) + 5) continue;
    opts.push({ key: 'power:' + b.title, name: env.cleanTitle(b.title), b,
      dmg: env.expDmg(env.skKey(b)) || env.expDmg(n) || 0,
      cd: env.rt.skills?.[env.skKey(b)]?.cd || (env.ilOf(b)?.reuse || 11000) / 1000 });
  }
  // Готовый откат ещё не означает доступный каст: проверяем стоимость каждого кандидата.
  for (let i = opts.length - 1; i >= 0; i--) {
    const o = opts[i];
    o.mpCost = o.key === 'attack' ? 0 : actionMp(o.b);
    if (!affordable(o.b, mp)) opts.splice(i, 1);
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
  const chargeB = env.names(env.cfg.nCharge).map(n => slotsBy(n)[0]).find(b => b && !nonOffenseSkill(b) && !weaponBarred(b) && ready(b) && free('charge') && affordable(b, mp));
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
  const group = groupPlan(ctx, opts, !!mp && mp.cur < mp.max * .35 && !(env.mpPotSlot?.() && env.qty(env.mpPotSlot()) !== 0));
  if (group) return group;
  // v5.5: режим «КПД» (симуляция 1 008 000 боёв Тирана): моба добивает одна атака — бьём атакой (ждём её отката, скилл бережём);
  // энергию не копим. Темп −12 %, MP на моба −36 %, банок MP −53 %. «ДПС» (по умолчанию) — как было: самый быстрый
  if (env.cfg.fightMode === 'kpd' && !ctx.rb) {
    const aD = env.expDmg('атака');
    if (aD && aD * 0.85 >= hp) { const a0 = opts.find(o => o.key === 'attack'); if (a0) return { ...a0, why: `КПД: добиваю атакой (${hp} HP)` }; return null; }
  }
  // 9.2 (незнакомый класс/новый удар): удар с < 3 замерами урона сначала пробуем на «толстом» мобе (HP заметно больше любого
  // известного удара), как у мага (mageProbe) — иначе новый удар стоял бы в ротации с уроном «по справочнику» или не жался вовсе
  if (env.cfg.mageProbe !== false && !ctx.rb && hp > 0) {
    const meas = o => DS?.[o.name.replace(/\s*\(.*$/, '').toLowerCase()]?.dmgN || 0;
    const known = opts.filter(o => o.key !== 'attack' && !o.charge && meas(o) >= 3), maxKnown = Math.max(env.expDmg('атака') || 0, ...known.map(o => o.dmg));
    // 10.0.11 (лог 13.10 22:03–22:12): «пробую новый удар (замер 1/3)» 16 раз подряд — Drain Health не даёт цифры урона в логе игры,
    // замер не растёт. Проба — не больше PROBE_USES нажатий: дальше удар живёт по тому, что намерено (или по справочнику)
    const used = o => DS?.[o.name.replace(/\s*\(.*$/, '').toLowerCase()]?.uses || 0;
    const probe = opts.filter(o => o.key !== 'attack' && !o.charge && !o.force && meas(o) < 3 && used(o) < PROBE_USES).sort((a, b) => meas(a) - meas(b))[0];
    if (probe && probe.dmg >= maxKnown && hp > Math.max(maxKnown, 300) * 1.3) return { ...probe, probe: true, why: `пробую новый удар (замер ${meas(probe)}/3)` };
  }
  // 1) добивание
  // 9.2: по этой цели есть замеры — «добьёт» = добивало в ≥ 85 % ударов (анализатор боя), иначе — как раньше, 85 % среднего
  const killOk = o => { const p = o.key === 'charge' ? null : env.fightKillP?.(o.name.replace(/\s*\(.*$/, ''), hp); return p != null ? p >= 0.85 : o.dmg * 0.85 >= hp; };
  // ДПС: готовый сильный удар первым, в том числе при добивании. Личный КД — не время хода.
  // Экономия и ограничения рейда сохраняют прежний выбор дешёвого добивания.
  const cheapFinish = env.cfg.fightMode === 'kpd' || !!ctx.rb ||
    !!mp && mp.cur < mp.max * .35 && !(env.mpPotSlot?.() && env.qty(env.mpPotSlot()) !== 0);
  const kill = opts.filter(killOk).sort((a, b) => cheapFinish
    ? env.actCost(a) - env.actCost(b) || b.dmg - a.dmg
    : b.dmg - a.dmg || (b.cd || 0) - (a.cd || 0))[0];
  if (kill) return { ...kill, why: `добивание (${hp} HP)` };
  if (ctx.rb) {
    const atkD = opts.some(o => o.key === 'attack') ? env.expDmg('атака') : 0, me = env.meHp();
    // 19.10: недоступная атака не вытесняет готовый удар — иначе воин простаивал с готовым Wild Sweep.
    // v4.46: на РБ — без скиллов с уроном < 1,6 доступной атаки (Force Buster: урона почти как атака, а MP вдвое больше)
    for (let i = opts.length - 1; i >= 0; i--) if (opts[i].key !== 'attack' && !opts[i].force &&
      !/^(burning fist|soul breaker|iron punch)$/i.test(opts[i].name) &&
      !(env.ilOf(opts[i].b)?.l2Damage && !DS?.[env.skKey(opts[i].b)]?.dmgN) &&
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
  const mpMax = mp?.max || 0, potB = env.mpPotSlot(), potOk = !!potB && env.qty(potB) !== 0;   // 10.0: банка есть (пусть на откате) — без экономии
  if (!lf && mp && mpMax && mp.cur < mpMax * 0.35 && !potOk && opts.length > 1) {
    const atkD = env.expDmg('атака'), effOf = o => o.key === 'attack' ? Infinity : (o.dmg - atkD * (1 + (o.force || 0))) / Math.max(1, env.skillMp(o.name));
    const bestEff = Math.max(0, ...opts.filter(o => o.key !== 'attack').map(effOf));
    for (let i = opts.length - 1; i >= 0; i--) if (opts[i].key !== 'attack' && effOf(opts[i]) < bestEff * 0.6) opts.splice(i, 1);
  }
  // 3) максимум урона из готового; рядом ещё мобы — массовые удары считаем с уроном по соседям
  const near = extraMobs().filter(x => x.cur > 0).length;
  const total = o => { const p = DS?.[(o.name || '').replace(/\s*\(.*$/, '').toLowerCase()]; return o.dmg + (near && p?.aoe && p.splN ? p.spl / p.splN : 0); };
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
  const boss = bigTarget(ctx);
  for (const n of L) {
    const b = slotsBy(n)[0]; const skillInfo = b && env.ilOf(b);
    if (nonOffenseSkill(b) || weaponBarred(b)) continue;
    if (!b || !ready(b) || (ctx.block['ult:' + b.title] || 0) > Date.now()) continue;
    const il = env.ilOf(b), hpCost = /HP −/.test(il?.L || '') || /of doom/i.test(n);
    // касты в l2wap мгновенные (между скиллами — общая задержка хода + свой откат), поэтому Vortex — такой же сверхсильный удар
    if (hpCost && (me?.pct ?? 100) < 40) continue;
    if (!affordable(b, mp, 5)) continue;
    const dmg = env.expDmg(env.skKey(b)) || 0, atk = env.expDmg('атака') || 0;
    // урон удара ещё не замерен — тогда только по «толстым» по проценту: моб почти целый (≥ 60 %)
    const ok = mode === 'always' || boss || (mode === 'big' && (dmg ? mob.cur >= Math.max(dmg * 0.7, atk * 4) && (!mob.max || mob.cur / mob.max >= 0.3) : (!mob.max || mob.cur / mob.max >= 0.6) && mob.cur >= atk * 4));
    if (!ok) continue;
    return { key: 'ult:' + b.title, name: env.cleanTitle(b.title), b, why: boss ? 'сверхсильный — РБ/чемпион' : `сверхсильный — у моба ${mob.cur} HP` };
  }
  return null;
}

// 9.0 «цена хода» (разбор боя, лог 11.10 00:47–01:40: на РБ 255 банок из 1 283 ходов, 96 из 234 банок HP — при HP ≥ 80 %):
// банка — целый ход без урона (≈1 500–2 000 у мага). У знакомого РБ (спецудар и удары замерены) пьём, только если после ещё одного
// ударного хода худший обычный удар (P90) опустит HP ниже «спецудар + 2 удара»; без «долива до верхней границы» полосы.
// Пересчёт по логу: 156 из 234 банок были не нужны. Аварийный порог (стоп-HP + 10 %) — всегда лечимся
// 19.10 (аудит20.22 по жалобе на смерти): прогноз держал один резерв HP, а ход боя — отдельный у каждого типа.
// Например,10 усиленных и1000обычных при резерве10 блокировали выбранную усиленную.
function hpPotStock(pot) {
  const seen = new Set();
  return (env.hpPots?.() || (pot ? [{ b: pot }] : [])).filter(p => {
    const key = p.key || p.b;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
function hpReserveBlocked(pot, reserve) {
  reserve = Math.max(0, reserve || 0);
  if (!pot || !reserve) return false;
  const count = b => env.potBag?.(b) ?? env.qty(b);
  const counts = hpPotStock(pot).map(p => count(p.b));
  const known = counts.reduce((sum, n) => sum + (n == null ? 0 : Math.max(0, n)), 0);
  if (known > reserve) return false;
  // Неизвестный остаток не доказывает наличие банок сверх резерва. Старое правило выбранной банки сохраняется.
  if (counts.some(n => n == null)) { const n = count(pot); return n != null && n <= reserve; }
  return known <= reserve;
}

function rbTurnHeal(o) {                          // o: { cur, max, spike, p90, stopPct } → { need, floor, at }
  const floor = Math.min(o.max * 0.96, o.spike + 2 * o.p90), at = floor + o.p90;
  // 20.51 (лог23.10 11:47): запас под сильный удар может быть выше MaxHP, но при полном HP банка не лечит.
  const need = o.cur < o.max && (o.cur < at || o.cur / o.max * 100 <= (o.stopPct || 25) + 10);
  return { need, floor: Math.round(floor), at: Math.round(at) };
}

function frenzyDive(ctx, me) {                    // «сливаться под Frenzy»: Frenzy на панели, готов, не висит, HP ещё выше порога
  if (!env.cfg.rbFrenzyDive || !ctx.rb || !me) return false;
  const b = slotsBy('Frenzy')[0]; if (!b) return false;
  const lim = env.ilOf(b)?.pc?.hp || 30;
  return me.pct > lim && ready(b) && !env.buffActive('frenzy', b) && me.pct > (env.cfg.stopHp || 25);
}

// 20.10, журнал11:28–11:31: вампиризм держит Titan на95–100%, ожидание урона не включает лимиты.
// Battle Trance остаётся запрещён в общих ролях; только этот план разрешает точный native-навык.
// 20.54 (John 23.10 02:44, Orc Raider с Claymore: руками Battle Trance → HP 4859 → 1214 = 25 %, затем Frenzy; «будем юзать на эпиках,
// чемпионах и РБ»): та же связка для любого класса с Battle Trance на панели, но только на крупной цели (РБ, эпик, чемпион) —
// Frenzy с откатом 600 с на обычном мобе пропадает зря. Дестроер/Титан на обычных мобах — как в 20.31 (cfg.destroyerLimits).
// Защита крупной цели: известны удары по нам и спецудар РБ, после слива HP переживает спецудар + несколько ударов,
// у цели ещё есть что бить; усиленные чемпионы 73+ (атака ×4) — никогда
function limitBigTarget(ctx, mob) {
  if (env.cfg.limitBig === false || !bigTarget(ctx)) return false;
  if (ctx.champ && !ctx.rb && env.champs?.isHard?.(ctx)) return false;
  const left = mob?.max > 0 ? mob.cur / mob.max : 1;
  return left >= (raidTarget(ctx) ? 0.1 : 0.3);
}
function limitHitsIn(ctx) {                       // удары цели по нам: РБ — память РБ + этот бой; чемпион — память боя по имени + этот бой
  if (ctx.rb) return (ctx.rb.hits || []).filter(n => Number.isFinite(n) && n > 0);
  const h = env.fightHitsIn?.() || [];
  return h.filter(n => Number.isFinite(n) && n > 0);
}
// Своё снижение HP под Frenzy — не повод для отхода по проценту HP 10 с (банки за это время поднимают HP; смертельные проверки остаются)
// 20.54 (лог John 02:55–02:56): Guts l2_139 — «При HP 30% або нижче на 90 с: P.Def +100%», MP 16, откат 600 с. После слива первым
// (защита на время низкого HP), затем Frenzy, затем Zealot
const LIMIT_ORD = { 139: 0, 176: 1, 420: 2 };
const limitDiveFresh = ctx => !!ctx?.limitDiveT && Date.now() - ctx.limitDiveT < 10000;
// 20.59 (John 24.10: «на эпиках сливайся под френзи и фарми их под френзи»; лог 19:13–19:15 Queen Ant, герой 47, MaxHP 10293:
// удары 1577–1915, Trance не жался — «HP после Battle Trance не покрывает запас под удары РБ», банки держали HP 80–100 %).
// На эпике (cfg.epicFrenzy, ВКЛ): слив, если HP после Trance переживёт один замеренный удар до Guts (P.Def +150 %); 90 с после слива
// HP держим в зоне Frenzy (≤ 30 %): банка только когда до смерти остаётся меньше 1,3 свежего удара, процентный отход эпика не срабатывает
const epicFrenzyOn = ctx => env.cfg.epicFrenzy !== false && !!ctx?.rb && !!env.epicById?.(ctx.rb.id);
// 20.64 (лог 25.10 22:46–22:48, Destroyer): Frenzy после нажатия держит урон и при полном HP — на Core банки подняли HP до 10785/10785,
// а атака била 10 756 (без Frenzy ≈400) все 90 с. HP ≤ 30 % нужен только для нажатия: держим его низким, пока выбранные лимиты
// (Guts/Frenzy/Zealot) не нажаты, но не дольше 15 с от слива; дальше обычные банки (QA за ход бьёт до 5 раз по 1 600–2 000)
const FRENZY_HOLD_MS = 15000;
function limitBuffs(ctx) {                        // выбранные лимиты на панели: готовы и ещё не висят
  const selected = [...new Set([...env.names(env.cfg.nKeyBuffs), ...env.names(env.cfg.nBuffs)])];
  return selected.map(bn => ({ bn, b: slotsBy(bn)[0] })).filter(x => x.b)
    .map(x => ({ ...x, il: env.ilOf(x.b) })).filter(x => [139,176,420].includes(x.il?.id) && x.il?.pc?.hp >= 25 && x.il.pc.hp <= 30)
    .filter(x => !env.buffActive(x.bn, x.b) && ready(x.b) && (ctx.block?.['buff:' + x.bn] || 0) <= Date.now())
    .sort((a,b) => LIMIT_ORD[a.il.id] - LIMIT_ORD[b.il.id]);
}
const epicFrenzyHold = ctx => epicFrenzyOn(ctx) && !!ctx.limitDiveT && Date.now() - ctx.limitDiveT < FRENZY_HOLD_MS
  && limitBuffs(ctx).some(x => x.il.id !== 139);
function epicFrenzyFloor(ctx, me) {               // HP, ниже которого под Frenzy на эпике пьём банку: 1,3 свежего удара (после слива), не меньше 8 %
  const all = (ctx.rb?.hits || []).filter(n => Number.isFinite(n) && n > 0), fresh = all.slice(ctx.limitDiveHits ?? 0);
  const hit = Math.max(0, ...(fresh.length ? fresh : all));
  return Math.round(Math.max(me.max * 0.08, hit * 1.3));
}
function limitPlan(ctx, me, mp, mob) {
  ctx.limitSkip = ''; ctx.limitUnsafe = false;
  const prof = String((env.rt.classCur ? env.rt.classCur.prof : env.rt.prof) || '').replace(/[_-]/g, ' ');
  const destr = env.cfg.destroyerLimits !== false && /^(?:orc )?(?:destroyer|titan)$/i.test(prof), big = limitBigTarget(ctx, mob);
  if (!(big || destr && !ctx.champ) || !me || ![me.cur,me.max,me.pct,mp?.cur].every(Number.isFinite) || !(me.cur > 0 && me.max > 0)
    || env.on === false || env.tabOwner === false || env.canAct?.() === false || env.pvpPending?.() || ctx.rb?.retreated || ctx.chOut || env.rt.epic?.step === 'retreatVerify') return null;
  const buffs = limitBuffs(ctx);
  if (!buffs.length) return null;
  const d = ctx.rb ? env.rt.rbDb?.[ctx.rb.id] || {} : {}, hits = limitHitsIn(ctx);
  const sorted = [...hits].sort((a, b) => a - b), champHit = !ctx.rb && sorted.length ? sorted[Math.floor(sorted.length * 0.9)] : 0;
  const hit = Math.max(d.hitP90 || 0, ...(ctx.rb ? hits : [champHit]), 0), spike = Math.max(d.sp || 0, d.probe?.sp || 0, ctx.rb?.sp || 0);
  const bigOnly = big && (!destr || !ctx.rb);     // не Дестроер (и любой класс на чемпионе): строже — без замера ударов (и спецудара РБ) HP не сливаем
  const hpCost = x => Math.max(0, ...(Array.isArray(x.il.hp) ? x.il.hp : [x.il.hp]).filter(Number.isFinite));
  const low = buffs.find(x => me.pct <= x.il.pc.hp && affordable(x.b, mp, 0));
  if (low) {
    // Ниже20% или перед смертельным ударом сначала обычное аварийное восстановление.
    // 20.59: на эпике под Frenzy — достаточно пережить один удар (Guts первым режет урон)
    if (epicFrenzyOn(ctx) ? me.pct < 12 || me.cur - hpCost(low) <= hit : me.pct < 20 || me.cur - hpCost(low) <= spike + 2 * hit) { ctx.limitUnsafe = true; return null; }
    return { kind: 'buff', b: low.b, bn: low.bn };
  }
  // Guts (P.Def +100 %) — только вместе с атакующим лимитом: ради одной защиты HP не сливаем
  if (me.pct <= 30 || !buffs.some(x => x.il.id !== 139) || ctx.limitTranceUnverified || (ctx.block?.['limit:trance'] || 0) > Date.now()) return null;
  const b = [...document.querySelectorAll(env.SLOT)].find(b => env.slotAction(b) === 'battle_trance');
  if (!b || !uiReady(b) || localCdLeft(b) > 0 || env.combatCooldown.skillWait('battle_trance', (env.cdSpawn || env.battleSpawn)()) > 0) return null;
  const need = actionMp(b) + buffs.reduce((sum,x) => sum + actionMp(x.b), 0);
  if (!mp || mp.cur < need) { ctx.limitSkip = 'не хватает MP на Battle Trance и готовые лимиты'; return null; }
  const after = Math.floor(me.max * .25) - buffs.reduce((sum,x) => sum + hpCost(x), 0);
  if (epicFrenzyOn(ctx)) {                        // 20.59: эпик — слив, если после Trance переживу один замеренный удар (×1,15)
    if (!(hit > 0)) { ctx.limitSkip = 'Frenzy на эпике: удары эпика ещё не замерены — HP не сливаю'; return null; }
    if (after < me.max * .20 || after <= hit * 1.15) { ctx.limitSkip = `Frenzy на эпике: после Battle Trance ${after} HP — удар ${Math.round(hit)} не переживу`; return null; }
    return { kind: 'trance', b };
  }
  if (after < me.max * .20 || ctx.rb && (!(hit > 0 || spike > 0) || after <= spike + hit * (buffs.length + 2))) {
    ctx.limitSkip = 'HP после Battle Trance не покрывает запас под удары РБ или замер ударов неизвестен'; return null;
  }
  if (bigOnly && ctx.rb && !(spike > 0 && (d.hitP90 > 0 || hits.length >= 3))) { ctx.limitSkip = 'Frenzy на РБ: спецудар и обычные удары этого РБ ещё не замерены — HP не сливаю'; return null; }
  if (bigOnly && !ctx.rb && (hits.length < 3 || after <= hit * (buffs.length + 3))) {
    ctx.limitSkip = hits.length < 3 ? 'Frenzy на чемпионе: мало замеров его ударов — HP не сливаю' : 'Frenzy на чемпионе: после Battle Trance HP не хватит на его удары'; return null;
  }
  return { kind: 'trance', b };
}

// Принятый вампирик ждёт реального КД. Потерянный/неподтверждённый клик имеет короткий повтор.
function drainBackoff(ctx, b, result) {
  const net = env.actNet?.(), exact = env.slotAction(b);
  const accepted = result === true && net?.ok && net.done >= net.start && Date.now() - (net.doneT || 0) <= 2000 && (!exact || net.action === exact);
  const known = exact && env.combatCooldown.skillKnown?.(exact, (env.cdSpawn || env.battleSpawn)(), pressAt.get(env.skKey(b)) || 0) || overlayReadySeen.has(b);
  const until = result === 'lock' || accepted && known ? 0 : Date.now() + (result === true ? 800 : 500);
  ctx.block['drain:' + b.title] = until;
  if (until > Date.now()) lostUntil.set(env.skKey(b), Math.max(lostUntil.get(env.skKey(b)) || 0, until)); // ротация DPS тоже уважает защиту от повторов
}
function drainPreferred(ctx, me, b, pot) {
  if (!pot || !ready(pot) || env.qty(pot) === 0) return true;
  if (ctx.rb && !ctx.rb.allIn && me.pct > 35 && hpReserveBlocked(pot, env.cfg.rbPotReserve)) return true;
  const h = env.fightHealOn?.(env.cleanTitle(b.title));
  const heal = h?.n >= 2 ? Math.max(0, Math.min(me.max-me.cur, h.p20)) : 0;
  const item = env.hpPots?.().find(x => x.b === pot);
  const potHeal = Math.max(0, Math.min(me.max-me.cur, item?.heal || 0));
  if (!(heal > 0)) return false; // неизвестное лечение не вытесняет доступную аварийную банку
  if (!(potHeal > 0) || heal >= potHeal) return true;
  const d = ctx.rb ? env.rt.rbDb?.[ctx.rb.id] || {} : {};
  const hits = ctx.rb?.hits || [], p90 = Math.max(d.hitP90 || 0, hits.length ? [...hits].sort((a,b)=>a-b)[Math.floor(hits.length*.9)] : 0);
  const danger = Math.max(me.max * (env.cfg.stopHp || 25) / 100, d.sp || 0, ctx.rb?.sp || 0) + 2*p90;
  return me.cur + heal > danger; // достаточно для ближайшего опасного сочетания — сохраняем атакующий ход
}

function drainPick(ctx, mp) {                     // готовый скилл с поглощением HP из роли «Вампиризм» (порядок = приоритет)
  for (const n of env.names(env.cfg.nDrain)) {
    const b = slotsBy(n)[0];
    if (!heroHealSkill(b, true) || !ready(b) || (ctx.block['drain:' + b.title] || 0) > Date.now()) continue;
    if (!affordable(b, mp, 5)) continue;
    if (env.ilOf(b)?.L && /труп моба/.test(env.ilOf(b).L)) continue;      // Life Scavenge / Corpse Life Drain — только по трупу
    return b;
  }
  return null;
}

// 20.48 (живой РБ 22.10): повтор Battle Roar принят при HP6958/11035, но HP не выросло.
// Даже последние 4 с эффекта — ещё активный MaxHP-бафф, а не готовое экстренное лечение.
function battleRoarActive(b) {
  if (env.ilOf?.(b)?.id !== 121) return false;
  const row = env.activeBuffs?.().find(x => +x.id === 121);
  if (row) return !(+row.exp > 0) || +row.exp > Date.now();
  return env.buffActive?.(env.cleanTitle(b.title).toLowerCase(), b) === true;
}
function healPick(ctx, mp) {                      // готовый лечащий скилл на себя из роли «Лечение» (порядок = приоритет)
  return env.names(env.cfg.nHeal || '').map(n => slotsBy(n)[0]).find(b => heroHealSkill(b) && !(env.ilOf?.(b)?.id === 121 && (ctx.roarPrepTried || battleRoarActive(b))) && ready(b) &&
    (ctx.block['heal:' + b.title] || 0) <= Date.now() && affordable(b, mp, 10)) || null;
}

const healSlot = b => !!b && heroHealSkill(b) && (env.ilOf(b)?.t === 'DRAIN' || [...env.names(env.cfg.nDrain), ...env.names(env.cfg.nHeal || '')].some(n => slotsBy(n)[0] === b));   // 10.0.5: ход лечит героя

// Отказ оружия принадлежит подтверждённой экипировке и активному классу,
// а не имени последнего ручного клика. После реальной смены пробуем навык заново.
function combatWeapon() {
  const equipped = (env.rt.weapons || []).filter(w => w.where === 'надето');
  const w = env.rt.weaponsT && !env.rt.weaponMetaPending && equipped.length === 1 && equipped[0];
  const p = env.rt.weaponEq, freshProof = p?.id && (!p.t || +p.t >= +env.rt.weaponsT);
  return w && !w.unknown && !(freshProof && +p.id !== +w.id) ? w : null;
}
function weaponContext() {
  const w = combatWeapon();
  return w?.id ? JSON.stringify([env.rt.char || '',env.rt.classCur?.slot ?? '',env.rt.classCur?.prof || env.rt.prof || '',+w.id,w.inst || '',w.ench ?? '']) : '';
}
function weaponBlocks() {
  const context = weaponContext(), block = {};
  if (context) for (const [k,v] of Object.entries(env.rt.unavailW || {}))
    if (v.context === context && Date.now() - v.t >= 0 && Date.now() - v.t < 1800000) block[k] = Infinity;
  return block;
}
// 20.43 (лог 21.10 22:07 Fortune Seeker с Elysian, 23:15–23:20 Warsmith с Yaksa Mace в туре РБ): Whirlwind и Wild Sweep (в справочнике
// только «древковое») жались с дубиной — 400 «Цей скилл зараз недоступний», ход теряется заново после каждой смены/заточки оружия.
// Требование навыка к оружию (поле w базы IL) сверяем с подтверждённым надетым оружием: вид другой — навык не выбираем.
// Оружие не подтверждено, вид неизвестен или w — не вид оружия («без оружия», «щит») — как раньше: учит отказ сервера (unavailW)
const WT_ALIAS = { 'дуалы': 'парные мечи', dual: 'парные мечи', pole: 'древковое', polearm: 'древковое', blunt: 'дубина', bigblunt: 'двуруч. дубина',
  sword: 'меч', bigsword: 'двуруч. меч', dagger: 'кинжал', bow: 'лук', fist: 'кастеты' };
const WT_KNOWN = new Set(['меч', 'двуруч. меч', 'дубина', 'двуруч. дубина', 'кинжал', 'лук', 'древковое', 'кастеты', 'парные мечи']);
const wtKind = s => { const t = String(s || '').trim().toLowerCase(), k = WT_ALIAS[t] || t; return WT_KNOWN.has(k) ? k : ''; };
function weaponNeed(b) { return b ? weaponNeedIl(env.ilOf?.(b)) : null; }
function weaponNeedIl(il) {
  const w = il?.w; if (!w) return null;
  const need = String(w).split(',').map(wtKind);
  return need.length && need.every(Boolean) ? need : null;
}
// 20.54 (лог 23.10 16:11, Orc Raider с Claymore): автомагистр тратил SP на Iron Punch («Лише з кастетами»), Wild Sweep и
// Polearm Mastery (только древковое), а на Two-handed Weapon Mastery SP уже не хватило. Навык под вид оружия, которого нет ни в руке,
// ни в сумке (rt.weapons после скана), не учим. Сумка не прочитана или вид неизвестен — как раньше, решает каталог сервера
function learnWeaponBarred(il) {
  const need = weaponNeedIl(il); if (!need || !env.rt.weaponsT) return false;
  const kinds = (env.rt.weapons || []).filter(w => !w.unknown).map(w => wtKind(w.wt)).filter(Boolean);
  return kinds.length > 0 && !kinds.some(k => need.includes(k));
}
// 20.43 (ревью): запись rt.weapons «надето» устаревает без POST смены, который видит бот (смена руками до старта, вторая вкладка,
// облачная сессия). Правая рука из GET /character игры (hook aug → rt.weaponAug.w = eq.l1, приходит и после каждого хода) другая
// и не старше записи — записи не верим: навык не прячем, решает отказ сервера (unavailW), как до 20.43. Старше записи — верим записи:
// свой POST набора крафтера (gamePost) мимо hook, rt.weaponAug догонит на первом GET игры (content.augNote освежает t при расхождении)
// 20.44 (ревью): запись «надето» устарела — игра (свой GET /character, rt.weaponAug.w) показывает в руке другое, и не раньше записи:
// оружие неизвестно (так же считают и спойл, и запрет умений по виду оружия)
function combatWeaponLive() {
  const w = combatWeapon(), live = env.rt.weaponAug;
  return w && live?.w != null && +live.w !== +w.id && +(live.t || 0) >= +(env.rt.weaponsT || 0) ? null : w;
}
// 20.49 (просьба 22.10): выбранные Focus/Vicious у Warlord только включаем, никогда не экономим MP выключением.
// OFF — явная строка свежего собственного GET /character. Пустой HUD и старая память OFF не доказывают.
const TOGGLE_FRESH_MS = 30000, managedToggleIds = [317,312];
let toggleSnapshot = null, togglePositive = null, toggleBattleRevision = null, toggleUnknown = null;
const toggleActor = () => JSON.stringify([env.rt.char || '',env.rt.classCur?.prof || '',env.rt.classCur?.slot ?? null,
  env.rt.classSwT || env.rt.classCur?.t || 0,env.rt.manualKickAt || 0,env.evidenceOwner?.()]);
const toggleKey = id => JSON.stringify([env.rt.char || '',env.rt.classCur?.prof || '',env.rt.classCur?.slot ?? null,id]);
function managedToggleClass() {
  return /^(?:human )?(?:warlord|dreadnought)$/i.test(String(env.rt.classCur?.prof || env.rt.prof || '').replace(/[_-]/g,' '));
}
const toggleBuffOn = (rows,id) => Array.isArray(rows) && rows.some(x => +(x?.skillId ?? x?.id) === id &&
  (!(+(x.expiresAtMs ?? x.expiresAt ?? x.exp) > 0) || +(x.expiresAtMs ?? x.expiresAt ?? x.exp) > Date.now()));
function noteToggleSnapshot(ch) {
  const now = Date.now(), actor = toggleActor(), at = ch?.requestStartedAt, generated = ch?.snapshotGeneratedAt;
  if (!ch || !env.rt.char || ch.name !== env.rt.char || !env.rt.classCur?.prof || ch.l2Profession !== env.rt.classCur.prof
      || !Number.isSafeInteger(ch.classSlots?.activeSlot) || ch.classSlots.activeSlot !== env.rt.classCur.slot
      || !Number.isSafeInteger(ch.revision) || ch.revision < 0 || !Number.isFinite(at) || at > now || now-at > TOGGLE_FRESH_MS
      || at < Math.max(+env.rt.classSwT || +env.rt.classCur?.t || 0,+env.rt.manualKickAt || 0) || !Number.isFinite(generated) || now-generated > TOGGLE_FRESH_MS || generated-now > 5000) return false;
  const old = toggleSnapshot?.actor === actor ? toggleSnapshot : null;
  if (old && ch.revision < old.revision) return false;
  const on = managedToggleIds.filter(id => toggleBuffOn(ch.activeBuffs,id) || ch.toggleStances?.some(x => +x.skillId === id && x.active === true));
  const off = Array.isArray(ch.activeBuffs) && Array.isArray(ch.toggleStances)
    ? managedToggleIds.filter(id => !on.includes(id) && ch.toggleStances.some(x => +x.skillId === id && x.active === false)) : [];
  // Повтор равной ревизии не освежает OFF; противоречивый положительный ON сильнее отрицательного.
  toggleSnapshot = { actor, revision:ch.revision, at:old?.revision === ch.revision ? Math.min(old.at,at) : at,
    generated:old?.revision === ch.revision ? Math.min(old.generated,generated) : generated,
    on:old?.revision === ch.revision ? [...new Set([...old.on,...on])] : on, off,
    hand:Number.isSafeInteger(ch.inventory?.eq?.l1?.itemId) && ch.inventory.eq.l1.itemId > 0 ? ch.inventory.eq.l1.itemId : null };
  return true;
}
function noteToggleBattle(d, startedAt = Date.now()) {
  const b = d?.be, revision = b?.revision, actor = toggleActor();
  if (!env.rt.char || b?.prof && b.prof !== env.rt.classCur?.prof || b?.slot != null && b.slot !== env.rt.classCur?.slot) return;
  noteMonsterPositive(d);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    // В полёте/без payload неизвестно даже направление ручного relative toggle. Ждём новый собственный OFF, удары не держим.
    const base = Math.max(toggleSnapshot?.actor === actor ? toggleSnapshot.revision : -1,toggleBattleRevision?.actor === actor ? toggleBattleRevision.revision : -1,
      Number.isSafeInteger(d?.req?.expectedRevision) ? d.req.expectedRevision : -1);
    const at = Number.isFinite(startedAt) ? Math.min(startedAt,Date.now()) : Date.now();
    toggleUnknown = { actor, at:Math.max(toggleUnknown?.actor === actor ? toggleUnknown.at : 0,at),baseRevision:base };
    if(d?.path==='/game/battle/action'&&Number.isSafeInteger(d.rid))monsterRequest={actor:monsterActor(),rid:d.rid,at,baseRevision:base};
    return;
  }
  if (toggleSnapshot?.actor === actor && revision < toggleSnapshot.revision) return;
  if(monsterRequest?.actor===monsterActor()&&d.rid===monsterRequest.rid)monsterRequest={...monsterRequest,doneRevision:revision,doneAt:Date.now()};
  // Более новый ход мог изменить относительную стойку даже при обрезанном payload: старое OFF больше не разрешает клик.
  toggleBattleRevision = { actor, revision:Math.max(toggleBattleRevision?.actor === actor ? toggleBattleRevision.revision : -1,revision) };
  const mods = d.res?.delta?.battleMods || d.res?.battle?.battleMods || {}, yes = v => v === true || v === 1 || v === '1';
  const icons = d.res?.delta?.battleBuffIcons || d.res?.battle?.battleBuffIcons || [];
  const on = managedToggleIds.filter(id => (id === 317 ? yes(mods.focusAttackActive) : yes(mods.stanceVicious))
    || d.hero?.buffs?.includes(id) || toggleBuffOn(d.res?.character?.activeBuffs,id)
    || Array.isArray(icons) && icons.some(x => +x.l2SkillId === id));
  if (on.length) {
    const revisions = togglePositive?.actor === actor ? { ...togglePositive.revisions } : {};
    for (const id of on) revisions[id] = Math.max(revisions[id] ?? -1,revision);
    togglePositive = { actor, revisions };
  }
}
function managedToggleState(b,id) {
  // Положительные живые HUD/слот/пакет перекрывают известный start-баг toggleStances.active:false.
  if (toggleBuffOn(env.activeBuffs?.(),id) || b.getAttribute('aria-pressed') === 'true' || /--(active|on|toggled|toggle-on|enabled)\b/.test(b.className || '')) return true;
  const actor = toggleActor(), s = toggleSnapshot?.actor === actor ? toggleSnapshot : null;
  if (s?.on.includes(id) || togglePositive?.actor === actor && togglePositive.revisions[id] != null && (!s || togglePositive.revisions[id] >= s.revision)) return true;
  if (!s || Date.now()-s.at > TOGGLE_FRESH_MS || Date.now()-s.generated > TOGGLE_FRESH_MS || !s.off.includes(id)
      || toggleBattleRevision?.actor === actor && toggleBattleRevision.revision > s.revision
      || toggleUnknown?.actor === actor && !(s.revision > toggleUnknown.baseRevision && s.at > toggleUnknown.at)) return null;
  return false;
}
function managedTogglePlan(ctx, id, ownIntent = null) {
  if (!managedToggleClass() || env.on === false || env.tabOwner === false || env.canAct?.() === false || env.isBattle?.() !== true || env.pvpPending?.()) return null;
  // Роль может быть английской, панель украинской; только точные известные имена, затем native ID слота.
  const aliases = { 'жорстка стійка':312,'зосереджений удар':317,'фокусована атака':317 };
  const selected = env.names(env.cfg.nToggles).some(n => (env.ilOf(n)?.id || aliases[n]) === id);
  const b = selected && [...document.querySelectorAll(env.SLOT)].find(b => env.ilOf(b)?.id === id && env.slotKind(b) === 'скилл' && env.shown(b));
  if (!b || managedToggleState(b,id) !== false || !ready(b,true) || env.noEffect?.(b) || env.combatCooldown.globalWait() > 0
      || (ctx.block?.['managed:' + id] || 0) > Date.now()) return null;
  const mp = env.meMp?.(), s = toggleSnapshot, il = env.ilOf(b), n = env.cleanTitle(b.title).toLowerCase();
  const row = env.rt.skillDb?.[n] || env.rt.skillDb?.[String(il.n || '').toLowerCase()];
  const cost = row && (row.mpKnown || row.mp > 0) && Number.isFinite(row.mp) && row.mp >= 0 ? row.mp : null;
  // Не переносим цену старого ACTIVE Interlude. Неизвестная цена — одна защищённая попытка; серверный nomp важнее.
  if (!mp || !Number.isFinite(mp.cur) || !(mp.cur > 0) || cost != null && mp.cur < cost) return null;
  const w = id === 317 ? combatWeaponLive() : null;
  if (id === 317 && (!w || !/^(?:древковое|polearm)$/i.test(w.wt || '') || s.hand !== +w.id)) return null;
  const intent = env.rt.managedToggleIntent?.[toggleKey(id)];
  const own = intent && ownIntent && ['char','prof','slot','id','baseRevision','at'].every(k => intent[k] === ownIntent[k]);
  if (intent && !own && !(s.revision > intent.baseRevision && s.at > intent.at)) return null;
  return { b, revision:s.revision, actor:toggleActor(), hand:s.hand };
}
async function managedToggleStep(ctx, me, act) {
  for (const id of managedToggleIds) {
    const plan = managedTogglePlan(ctx,id); if (!plan) continue;
    const key = toggleKey(id), intent = { char:env.rt.char, prof:env.rt.classCur.prof, slot:env.rt.classCur.slot,id,baseRevision:plan.revision,at:Date.now() };
    let saved;
    try { saved = await env.setRt({ managedToggleIntent:{ ...(env.rt.managedToggleIntent || {}),[key]:intent } }); }
    catch (_) { ctx.block['managed:' + id] = Date.now()+5000; return false; }
    // Сбой записи не держит обычные атаки новым выбором несохранённого плана на каждом круге.
    if (saved?.ok !== true) { ctx.block['managed:' + id] = Date.now()+5000; return false; }
    let cancelled = false;
    const needed = () => {
      const p = managedTogglePlan(ctx,id,intent), ok = p?.b === plan.b && p.actor === plan.actor && p.hand === plan.hand && p.revision === plan.revision;
      if (!ok) cancelled = true; return ok;
    };
    const start = env.actNet?.().start || 0;
    if (!needed()) return false;
    const result = await act(plan.b,`Включаю постоянно: ${env.cleanTitle(plan.b.title)}`,false,needed,true);
    // Отказ до отправки не является неизвестным кастом. Отправленный/неясный исход ждёт новой OFF-ревизии, бой продолжается.
    if (toggleActor() === plan.actor && (env.actNet?.().start || 0) === start && (cancelled || result === 'nomp' || result === 'cd')) {
      const intents = { ...(env.rt.managedToggleIntent || {}) }; delete intents[key];
      await env.setRt({ managedToggleIntent:intents });
    }
    if (result === 'unavail') ctx.block['managed:' + id] = Infinity;
    return true;
  }
  return false;
}
// 23.10, Firefox20.51/логи10:22 и10:40: Monster80 и Dragon88 подтверждены штатными боевыми action. Outside-политика отдельная.
let monsterSnapshots = Object.create(null), monsterPositive = null, monsterSerial = 0, monsterClaim = null, monsterRequest = null;
const MONSTER_FRESH = 30000, MONSTER_UNKNOWN = 630000, NATIVE_DETECT_IDS = [80,88,359,360];
const NATIVE_DETECT = {80:{action:'detect_monster_weakness',name:'Вразливість монстрів',aliases:['вразливість монстрів','detect monster weakness','l2_80']},
  88:{action:'detect_dragon_weakness',name:'Вразливість драконів',aliases:['вразливість драконів','detect dragon weakness','l2_88']},
  // 24.10 (лог 10:54, Dreadnought): Eye of Hunter/Slayer — тот же самобафф 10 мин штатной боевой кнопкой, outside не проверен.
  // Каталог/магистр не даёт их цену (learned без mpCost, в подсказке «MP 0»): без цены служба не ставила Око вовсе.
  // Тогда берём верх справочника Interlude (70/71 MP, живой расход ≈40) — завышенная цена только требует запаса MP.
  359:{action:'eye_hunter',name:'Око мисливця',aliases:['око мисливця','eye of hunter','eye of the hunter','l2_359'],ilMp:true},
  360:{action:'eye_slayer',name:'Око вбивці',aliases:['око вбивці','eye of slayer','eye of the slayer','l2_360'],ilMp:true}};
const monsterActor = () => JSON.stringify([toggleActor(),env.actionGeneration?.(),env.battleExitContext?.()]);
const monsterRow = (x,id) => +x?.l2SkillId===id||+x?.skillId===id||['l2_'+id,NATIVE_DETECT[id].action,String(id)].includes(String(x?.battleId||''));
function noteMonsterSnapshot(ch) {
  const now=Date.now(),at=ch?.requestStartedAt,actor=monsterActor();
  // Полный owned battle.character — ответ собственного запроса, не частичный delta. Его свежесть по requestStartedAt, без выдуманного серверного времени.
  const generated=ch?.nativeBattleSnapshot===true&&!Number.isFinite(ch.snapshotGeneratedAt)?at:ch?.snapshotGeneratedAt;
  if(!ch||!env.on||!env.tabOwner||!env.rt.char||env.heroNick?.()!==env.rt.char||ch.name!==env.rt.char||ch.l2Profession!==env.rt.classCur?.prof
    ||ch.classSlots?.activeSlot!==env.rt.classCur?.slot||ch.inBattle!==true||!Number.isSafeInteger(ch.revision)||ch.revision<0
    ||!Number.isFinite(at)||at>now||now-at>MONSTER_FRESH||at<Math.max(+env.rt.classSwT||+env.rt.classCur?.t||0,+env.rt.manualKickAt||0)
    ||!Number.isFinite(generated)||now-generated>MONSTER_FRESH||generated-now>5000||!Array.isArray(ch.monsterBuffs))return false;
  if(NATIVE_DETECT_IDS.some(id=>monsterSnapshots[id]?.actor===actor&&ch.revision<monsterSnapshots[id].revision))return false;
  for(const id of NATIVE_DETECT_IDS){
    const old=monsterSnapshots[id]?.actor===actor?monsterSnapshots[id]:null;
    const learned=ch.learnedBattleSkillsDetail?.find(x=>monsterRow(x,id)&&x.level>0),castable=ch.castableSelfBuffs?.find(x=>monsterRow(x,id));
    let cost=null;
    for(const row of [castable,learned])if(Number.isFinite(row?.mpCost)&&row.mpCost>=0){cost=row.mpCost;break;}
    if(cost===null&&learned&&![castable,learned].some(row=>row?.mpCost!=null)){
      const match=String(learned.hintUk||learned.hintRu||'').match(/\bMP\s*(\d+(?:[.,]\d+)?)/i);
      if(match&&ch.skillMpCostMul===1)cost=+match[1].replace(',','.');
      else {const row=Object.entries(env.rt.skillDb||{}).find(([name])=>env.ilOf?.(name)?.id===id)?.[1];if(row?.mpKnown===true&&Number.isFinite(row.mp)&&row.mp>=0)cost=row.mp;}
    }
    const carry=!Array.isArray(ch.learnedBattleSkillsDetail)&&old&&now-old.costAt<=MONSTER_FRESH;
    if(carry&&cost===null)cost=old.cost;
    if(cost===null&&learned&&NATIVE_DETECT[id].ilMp){const v=[].concat(env.ilOf?.({cdKey:NATIVE_DETECT[id].action,name:''})?.mp).filter(x=>Number.isFinite(x)&&x>0);if(v.length)cost=Math.max(...v);}
    const on=toggleBuffOn(ch.monsterBuffs,id);
    monsterSnapshots[id]={actor,revision:ch.revision,at:old?.revision===ch.revision?Math.min(old.at,at):at,
      generated:old?.revision===ch.revision?Math.min(old.generated,generated):generated,observedAt:at,fromBattle:ch.nativeBattleSnapshot===true,requestRid:ch.requestRid,
      on:on||old?.revision===ch.revision&&old.on,learned:!!learned||!!carry&&old.learned,cost,costAt:carry?old.costAt:at};
  }
  return true;
}
function noteMonsterPositive(d) {
  const revision=d?.be?.revision;if(!Number.isSafeInteger(revision)||revision<0)return;
  const icons=d.res?.delta?.battleBuffIcons||d.res?.battle?.battleBuffIcons,actor=monsterActor();
  const revisions=monsterPositive?.actor===actor?{...monsterPositive.revisions}:{};
  for(const id of NATIVE_DETECT_IDS)if(d.hero?.buffs?.includes(id)||toggleBuffOn(d.res?.character?.activeBuffs,id)||Array.isArray(icons)&&icons.some(x=>+x.l2SkillId===id))revisions[id]=Math.max(revisions[id]??-1,revision);
  monsterPositive={actor,revisions};
}
function managedMonsterPlan(ctx, ownIntent=null, id=null) {
  if(id==null){for(const next of ownIntent?[ownIntent.id]:NATIVE_DETECT_IDS){const plan=managedMonsterPlan(ctx,ownIntent,next);if(plan)return plan;}return null;}
  const meta=NATIVE_DETECT[id];if(!meta)return null;
  if(!managedToggleClass()||env.on!==true||env.tabOwner!==true||env.canAct?.()===false||env.isBattle?.()!==true||env.pvpPending?.()||env.heroNick?.()!==env.rt.char)return null;
  const selected=env.names(env.cfg.nBuffs).some(n=>(env.ilOf(n)?.id|| (meta.aliases.includes(n)?id:0))===id);
  const b=selected&&[...document.querySelectorAll(env.SLOT)].find(b=>env.ilOf(b)?.id===id&&env.slotKind(b)==='скилл'&&env.shown(b)&&[meta.action,'l2_'+id].includes(env.slotAction(b)));
  const s=monsterSnapshots[id],now=Date.now(),actor=monsterActor(),baseActor=toggleActor(),mp=env.meMp?.(),spawn=(env.cdSpawn||env.battleSpawn)();
  const request=monsterRequest?.actor===actor?monsterRequest:null;
  const ownFull=!!(s?.fromBattle&&request&&s.requestRid===request.rid&&s.observedAt===request.at&&Number.isSafeInteger(request.doneRevision)&&s.revision>=request.doneRevision&&s.revision>request.baseRevision);
  const afterRequest=!!(request&&Number.isFinite(request.doneAt)&&s?.observedAt>request.doneAt&&s.revision>=request.doneRevision);
  if(!b||!s||s.actor!==actor||!s.learned||now-s.costAt>MONSTER_FRESH||s.on||now-s.at>MONSTER_FRESH||now-s.generated>MONSTER_FRESH||toggleBuffOn(env.activeBuffs?.(),id)
    ||monsterPositive?.actor===actor&&(monsterPositive.revisions[id]??-1)>=s.revision||toggleBattleRevision?.actor===baseActor&&toggleBattleRevision.revision>s.revision
    ||toggleUnknown?.actor===baseActor&&!(s.revision>toggleUnknown.baseRevision&&(s.observedAt>toggleUnknown.at||ownFull))
    ||request&&!ownFull&&!afterRequest||(ctx.block?.['monster'+id]||0)>now||env.noEffect?.(b)||!uiReady(b)||localCdLeft(b)>0||env.combatCooldown.globalWait()>0
    ||[meta.action,'l2_'+id].some(k=>env.combatCooldown.skillWait(k,spawn)>0)||!mp||!Number.isFinite(mp.cur)||!Number.isFinite(s.cost)||s.cost<0||mp.cur<s.cost)return null;
  const key=toggleKey(id),outside=env.rt.detectOutsideIntent?.[key],intent=env.rt.monsterNativeIntent?.[key],own=intent&&ownIntent&&intent.token===ownIntent.token;
  if(outside&&!['confirmed','rejected','notSent'].includes(outside.phase)){const end=Math.max(+outside.at||0,+outside.requestAt||0)+MONSTER_UNKNOWN;
    if(!Number.isFinite(outside.at)||now<end||s.at<end||s.generated<end||s.revision<=outside.baseRevision)return null;}
  if(intent&&!own){
    const fence=intent.phase==='answered'?+intent.answeredAt+3000:+intent.until;
    if(!Number.isFinite(fence)||now<fence||s.at< (intent.phase==='answered'?intent.answeredAt:fence)||s.generated<(intent.phase==='answered'?intent.answeredAt:fence)||s.revision<=intent.baseRevision||intent.phase==='answered'&&s.revision<intent.answeredRevision)return null;
  }
  return {id,b,actor,revision:s.revision,key,cost:s.cost};
}
function armMonsterRequest(intent) {
  if(intent.actor!==monsterActor()||env.rt.monsterNativeIntent?.[toggleKey(intent.id)]?.token!==intent.token)return false;
  try{document.documentElement.dataset.l2botMonster=JSON.stringify({token:intent.token,revision:intent.baseRevision,action:NATIVE_DETECT[intent.id].action,at:Date.now()});}
  catch(_){return false;}
  monsterClaim={intent,actor:monsterActor(),at:Date.now(),rid:null};return true;
}
function clearMonsterMarker(){try{delete document.documentElement.dataset.l2botMonster;}catch(e){env.quietErr?.('метка Detect',e);}}
function monsterRequestToken(d) {
  const claim=monsterClaim,i=claim?.intent;if(!i||claim.actor!==monsterActor()||!env.on||!env.tabOwner||Date.now()-claim.at>15000
    ||d?.monsterToken!==i.token||claim.rid!=null||d?.path!=='/game/battle/action'||d.method!=='POST'||!Number.isSafeInteger(d.rid)||!NATIVE_DETECT[i.id]||![NATIVE_DETECT[i.id].action,'l2_'+i.id].includes(d.req?.action)
    ||d.req.expectedRevision!==i.baseRevision||env.rt.monsterNativeIntent?.[toggleKey(i.id)]?.token!==i.token)return '';
  claim.rid=d.rid;return i.token;
}
async function managedMonsterStep(ctx, act) {
  const plan=managedMonsterPlan(ctx);if(!plan)return false;
  const intent={char:env.rt.char,prof:env.rt.classCur.prof,slot:env.rt.classCur.slot,id:plan.id,baseRevision:plan.revision,at:Date.now(),until:Date.now()+MONSTER_UNKNOWN,
    token:JSON.stringify([plan.actor,Date.now(),++monsterSerial]),actor:plan.actor,phase:'prepared'};
  const same=()=>env.rt.char===intent.char&&env.rt.classCur?.prof===intent.prof&&env.rt.classCur?.slot===intent.slot&&env.rt.monsterNativeIntent?.[plan.key]?.token===intent.token;
  const clear=async()=>{if(!same())return;const all={...(env.rt.monsterNativeIntent||{})};delete all[plan.key];try{await env.setRt({monsterNativeIntent:all});}catch(e){env.quietErr?.('отмена намерения Detect',e);}};
  try {const saved=await env.setRt({monsterNativeIntent:{...(env.rt.monsterNativeIntent||{}),[plan.key]:intent}});
    if(saved?.ok!==true||!await env.rtCommit()){ctx.block['monster'+plan.id]=Date.now()+5000;return false;}
  }catch(_){ctx.block['monster'+plan.id]=Date.now()+5000;return false;}
  const needed=()=>{const next=managedMonsterPlan(ctx,intent);return next?.b===plan.b&&next.actor===plan.actor&&next.revision===plan.revision&&next.cost===plan.cost;};
  if(!needed()){await clear();return false;}
  const before=env.actNet?.().start||0;needed.monsterIntent=intent;
  let result;try{result=await act(plan.b,'Бафф в бою: '+NATIVE_DETECT[plan.id].name,false,needed,true);}finally{monsterClaim=null;}
  const net=env.actNet?.();
  if((net?.start||0)===before){await clear();ctx.block['monster'+plan.id]=result==='unavail'?Infinity:Date.now()+700;return true;}
  // Без точной квитанции свой отправленный ход неизвестен630с, в том числе после перезагрузки и смены аренды.
  const receipt=env.actReceipt?.(net?.startRid),answered=net?.start===before+1&&receipt?.rid===net.startRid&&receipt.owner===net.startOwner&&receipt.owner===env.evidenceOwner?.()
    &&receipt.action===env.slotAction(plan.b)&&receipt.ok===true&&receipt.monsterToken===intent.token&&receipt.expectedRevision===intent.baseRevision
    &&Number.isFinite(receipt.requestStartedAt)&&receipt.requestStartedAt>=intent.at&&Number.isSafeInteger(receipt.revision)&&receipt.revision>intent.baseRevision;
  if(same())try{await env.setRt({monsterNativeIntent:{...(env.rt.monsterNativeIntent||{}),[plan.key]:{...intent,phase:answered?'answered':'unknown',...(answered?{answeredAt:Date.now(),answeredRevision:receipt.revision}: {})}}});}catch(e){env.quietErr?.('квитанция Detect',e);}
  if(result==='unavail')ctx.block['monster'+plan.id]=Infinity;
  return true;
}
// MaxHP в начале текущего боя РБ: только выбранный игроком навык, подтверждённая пика и живые MP/КД/HUD.
// Первое применение на раненом герое ещё не измерено полностью: роль «Лечение» и модель Interlude не меняем.
function battleRoarPlan(ctx, me, mp) {
  const prof = String(env.rt.classCur?.prof || env.rt.prof || '').replace(/[_-]/g, ' '), weapon = combatWeaponLive();
  if (!ctx.rb || ctx.rb.retreated || env.epicById?.(ctx.rb.id) || ctx.roarPrepTried || ctx.seq?.length || env.on === false || env.tabOwner === false || env.canAct?.() === false
      || env.isBattle?.() !== true || env.pvpPending?.() || !/^(?:human )?(?:warlord|dreadnought)$/i.test(prof) || !/^(?:древковое|polearm)$/i.test(weapon?.wt || '')) return null;
  if (!me || ![me.cur, me.max, me.pct, mp?.cur].every(Number.isFinite) || !(me.cur > 0 && me.max > 0) || me.pct <= Math.max(+env.cfg.hpPotAt || 50, (+env.cfg.stopHp || 25) + 10)) return null;
  const buffs = env.activeBuffs?.();
  if (!Array.isArray(buffs) || !buffs.length || !env.shown(env.$q('#l2-hud-active-buffs'))) return null;
  const selected = [...new Set([...env.names(env.cfg.nHeal), ...env.names(env.cfg.nBuffs), ...env.names(env.cfg.nKeyBuffs)])];
  const b = selected.flatMap(slotsBy).find(b => env.ilOf(b)?.id === 121 && env.slotKind(b) === 'скилл' && env.shown(b) && ['battle_roar','l2_121'].includes(env.slotAction(b)));
  if (!b || battleRoarActive(b) || env.noEffect?.(b) || !ready(b)) return null;
  // Готовый навык сервер может опустить из skillCooldowns. Как у обычных баффов, ready проверяет UI/local и любой положительный серверный КД;
  // неизвестный ready-КД допускает одну попытку, отправленный/неизвестный исход закрывает повтор до следующего боя.
  const bn = env.cleanTitle(b.title).toLowerCase(), row = env.rt.skillDb?.[bn] || env.rt.skillDb?.['battle roar'];
  if (!row || !Number.isFinite(row.mp) || !(row.mp > 0) || mp.cur < row.mp + 10
      || (ctx.block['buff:' + bn] || 0) > Date.now() || (ctx.block['heal:' + b.title] || 0) > Date.now()) return null;
  return { b, bn };
}
function weaponBarred(b) {
  const need = weaponNeed(b); if (!need) return false;
  const w = combatWeaponLive();
  if (!w) return false;
  const wt = wtKind(w.wt);
  return !!wt && !need.includes(wt);
}
function refreshWeaponBlocks(ctx) {
  const context = weaponContext();
  if (ctx.weaponContext != null && ctx.weaponContext !== context) {
    for (const key of ctx.weaponBlocked || []) delete ctx.block[key];
    const fresh = weaponBlocks(); Object.assign(ctx.block, fresh); ctx.weaponBlocked = Object.keys(fresh);
  }
  ctx.weaponContext = context;
}

// 20.5 (логи16.10 12:21): Provoke → AoE дал награду за31моба; поддержка
// не входит в nPower. Собираем один раз за бой, заранее резервируем MP на массовый удар.
function warlordPullTarget() { return location.search + '|' + mobName() + '|' + (mobHp()?.max || 0); }
function warlordPullCost(b) {
  const n = env.cleanTitle(b.title).toLowerCase(), il = env.ilOf(b) || {};
  const row = env.rt.skillDb?.[n] || env.rt.skillDb?.[String(il.n || '').toLowerCase()];
  // Чистое MP из rt.skills занижается регеном: для сбора берём каталог, затем верх справочника.
  if (row && Number.isFinite(row.mp) && row.mp > 0) return row.mp;
  const values = (Array.isArray(il.mp) ? il.mp : [il.mp]).filter(x => Number.isFinite(x) && x > 0);
  return values.length ? Math.max(...values) : null;
}
function warlordPullReady(b) { return uiReady(b) && localCdLeft(b) <= 0 && env.combatCooldown.skillWait(env.slotAction(b), (env.cdSpawn || env.battleSpawn)()) <= 0; }
function warlordPullPlan(ctx, mp) {
  const skip = why => { ctx.warlordPullSkip = why; return null; }; ctx.warlordPullSkip = '';
  const prof = String(env.rt.classCur?.prof || env.rt.prof || '').replace(/[_-]/g, ' ');
  if (env.cfg.warlordAggro === false || !/^(?:human )?(?:warlord|dreadnought)$/i.test(prof) || mageCombat() || bigTarget(ctx) || env.pvpPending?.()) return null;
  const info = env.battleInfo?.(), age = Date.now() - (+info?.t || 0);
  if (!info || age < 0 || age > 60000 || String(info.name || '').toLowerCase() !== mobName().toLowerCase() || !(info.max > 0) || +info.max !== mobHp()?.max || !/^(normal|passive|neutral|aggressive)$/.test(info.kind || '') || info.tier) return skip('нет свежего подтверждения обычной цели');
  // 17.10.2026, журнал00:52–00:57: weaponNow — имя последнего клика, equip/скан его не подтверждают.
  // Надетое берём из проверенного инвентаря; незавершённая смена и противоречивые ID запрещают сбор.
  // 20.46 (приём 22.10): свежая рука игры могла опровергнуть старую запись пики. Это запрещает и новое агро, и follow;
  // повторный chooseAction в act перед кликом замечает смену оружия за время ожидания. Более старый native-снимок новое надевание не отменяет.
  const weapon = combatWeaponLive();
  if (!weapon || !/^(?:древковое|polearm)$/i.test(weapon.wt || '')) return skip('не подтверждена надетая пика');
  const me = env.meHp(), mob = mobHp(), target = warlordPullTarget();
  if (!me || !(me.cur > 0 && me.max > 0) || !mob?.cur || !mp || !Number.isFinite(mp.cur) || mp.cur < (+env.cfg.skillMpMin || 0)) return null;
  const slots = [...document.querySelectorAll(env.SLOT)], free = k => (ctx.block[k] || 0) <= Date.now();
  const powers = new Set(env.names(env.cfg.nPower).map(n => n.toLowerCase()));
  const aoes = slots.filter(b => ['whirlwind','thunder_storm','earthquake','shock_blast'].includes(env.slotAction(b)) && powers.has(env.cleanTitle(b.title).toLowerCase()) && !weaponBarred(b) && ready(b) && free('power:' + b.title))
    .map(b => { const cost=warlordPullCost(b),name=env.cleanTitle(b.title),damage=env.expDmg(name),model=env.fightGroupOn?.(name,mob.max),each=Math.min(damage||0,model?.damage||0);
      const near=extraMobs().filter(x=>x.cur>0),useful=Math.min(mob.cur,damage||0)+near.reduce((s,x)=>s+Math.min(x.cur,each),0),kills=(damage>=mob.cur?1:0)+near.filter(x=>each*.85>=x.cur).length;
      return {b,cost,useful,kills}; }).filter(x => x.cost != null && mp.cur > x.cost).sort((a,b) => b.kills-a.kills || b.useful-a.useful || a.cost-b.cost);
  if (!aoes.length) return skip('нет готового массового удара из выбранных силовых или MP на него');
  const hit = aoes[0], previous = ctx.warlordPull;
  if (previous) {
    if (!previous.follow || previous.target !== target) return null;
    return { key: 'power:' + hit.b.title, name: env.cleanTitle(hit.b.title), b: hit.b, mpCost: hit.cost, warlordPull: 'hit', target, why: 'массовый удар после агро' };
  }
  const advice=env.packAdvice?.(mobName(),mob.max,{hp:100*me.cur/me.max,mp:mp.max>0?100*mp.cur/mp.max:null})||{blocked:[],minHp:75};
  if (100 * me.cur / me.max < Math.max(75, (+env.cfg.stopHp || 25) + 25, advice.minHp || 75)) return skip('мало HP для сбора группы по наблюдаемым боям');
  if (extraMobs().filter(x => x.cur > 0).length >= 3) return skip('группа уже собрана — бью массовыми');
  // 16.10, лог13:43: Howl тоже добавил соседей. Он запасной сбор, когда Provoke на КД
  // или дороже доступного MP. Раненая главная цель не мешает собрать новых полных соседей.
  const pulls = ['provoke', 'howl'].flatMap(action => slots.filter(b => env.slotAction(b) === action && warlordPullReady(b) && free('aggro:' + b.title)))
    .map(b => ({ b, cost: warlordPullCost(b) })).filter(x => x.cost != null);
  const available=pulls.filter(x=>!advice.blocked?.includes(env.slotAction(x.b))).sort((a,b)=>Number(env.slotAction(b.b)===advice.preferred)-Number(env.slotAction(a.b)===advice.preferred));
  const pick = available.find(x => mp.cur >= x.cost + Math.max(hit.cost, +env.cfg.skillMpMin || 0) + 10);
  if(!pick&&pulls.length&&!available.length)return skip('агро уступало обычным боям или давало повторные смерти в этих условиях');
  if (!pick) return skip(pulls.length ? 'не хватает MP на агро и массовый удар с запасом' : 'Provoke и Howl недоступны: панель, откат или неизвестная цена');
  return { key: 'aggro:' + pick.b.title, name: env.cleanTitle(pick.b.title), b: pick.b, mpCost: pick.cost, warlordPull: 'pull', target, why: 'собираю группу под массовый удар; MP на связку есть' };
}
function warlordPullResult(ctx, a, result) {
  if (!a?.warlordPull || result === 'lock' || result === 'nomp') return;   // 20.12: 'nomp' — нажатия не было
  // Явный отказ до применения разрешает запасной навык, но не повтор того же агро.
  if (a.warlordPull === 'pull' && (result === 'cd' || result === 'unavail')) { ctx.block[a.key] = Infinity; return; }
  if (a.warlordPull === 'hit' && (result === 'cd' || result === 'unavail')) return; // удар не принят: сохраняем намерение, выбираем другой AoE
  // Неизвестный ответ: повторное агро в этом бою не спамим.
  if (a.warlordPull === 'pull') ctx.warlordPull = { target: a.target, follow: true };
  else if (ctx.warlordPull) ctx.warlordPull.follow = false;
}

// 20.13 (ревизия 17.10, шаг 7, аудит combat/C6): причина пропуска сбора Warlord писалась на первом тике каждого боя (≈650 строк в час
// на цепочке, и часто временная — AoE на откате). Теперь — в итоге боя, только если сбор за бой так и не состоялся, и не чаще раза
// в 10 мин для одной и той же причины (память вкладки в sessionStorage, как «Обнаружен питомец»)
function warlordSkipNote(ctx, now = Date.now()) {
  const why = ctx?.warlordPullWhy; if (!why || ctx.warlordPull) return false;
  let s = null; try { s = JSON.parse(sessionStorage.getItem('l2bot.aggroNote') || 'null'); } catch (e) {}
  if (s && s.why === why && now - (+s.t || 0) < 600000) return false;
  try { sessionStorage.setItem('l2bot.aggroNote', JSON.stringify({ why, t: now })); } catch (e) {}
  env.rec?.('B', 'агро', why);
  return true;
}
function chooseAction(ctx, mp) {
  refreshWeaponBlocks(ctx);
  if (mageCombat()) return magePlan(ctx, mp);
  const pull = warlordPullPlan(ctx, mp); if (pull) return pull;
  if (ctx.warlordPullSkip) ctx.warlordPullWhy = ctx.warlordPullSkip;   // 20.13 (шаг 7, combat/C6): в журнал — в итоге боя (warlordSkipNote)
  const free = k => (ctx.block[k] || 0) <= Date.now();
  const mpOk = !mp || mp.cur >= env.cfg.skillMpMin;
  // силовые и станы — списки через запятую, порядок = приоритет (каждое название — отдельный скилл)
  const list = str => env.names(str).map(n => slotsBy(n)[0]).filter(Boolean);
  const powers = mpOk ? env.names(env.cfg.nPower).filter(n => !env.names(env.cfg.nUltra).includes(n)).map(n => slotsBy(n)[0]).filter(Boolean).filter(b => !nonOffenseSkill(b) && !weaponBarred(b) && free('power:' + b.title)) : [];
  const longFight = (mobHp()?.cur || 0) > env.expDmg('атака') * 2 + Math.max(0, ...powers.filter(ready).map(b => env.expDmg(env.skKey(b))));
  const stuns  = mpOk && (ctx.champ || ctx.rebirth?.role === 'champion') && !raidTarget(ctx) && longFight && Date.now() - ctx.lastStun >= env.cfg.stunEvery * 1000
               ? list(env.cfg.nStun).filter(b => !nonOffenseSkill(b) && !weaponBarred(b) && free('stun:' + b.title) && affordable(b, mp)) : [];
  const st = stuns.find(ready);
  const ult = ultPick(ctx, mp);                   // v5.3: 💥 сверхсильный скилл (Punch of Doom, Crush of Doom, Vortex…)
  if (ult) return ult;
  const plan = dpsPlan(ctx, mp);                 // расчёт ДПС: добивание / заряд / сильнейший готовый / копим энергию
  // стан (урон ~160) полезен, только когда больше нечем бить: урон и энергия для мощного удара важнее
  if (plan && (!st || !plan.charge || env.forceNow() < env.forceMax())) return plan;
  if (st) return { key: 'stun:' + st.title, name: 'стан', b: st, why: 'долгий бой, остальное на КД' };
  if (plan) return plan;
  if (raidTarget(ctx)) return null;               // На РБ похода тоже не подставляем запасной стан вместо плана урона.
  if (env.cfg.fightMode === 'kpd' && env.expDmg('атака') * 0.85 >= (mobHp()?.cur || Infinity)) return null;   // КПД: ждём откат атаки
  if (ctx.lfHold) return null;                    // РБ без банок: дорогие удары придержаны ради маны — ждём атаку
  if (env.forceCosts().some(c => { const b = slotsBy(c.name)[0]; return b && env.forceNow() >= c.cost && cdLeft(b) <= 0.6; })) return null;
  const pw = powers.filter(ready).filter(b => affordable(b, mp))
    .sort((a, b) => env.expDmg(env.skKey(b)) - env.expDmg(env.skKey(a)))[0];
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

// 10.0.10 (лог 13.10 19:39–20:57, alt1 18–19 ур.): обычная атака 1 урона 112 ударов из 112, Power Strike 0–3 (Elf Ghost 20, Lesser Dark
// Horror 15) — кончился «Бонус новичка» (так же лог 08.10 16:31), герой с NG-оружием не пробивает мобов 15–20 ур. Бот метил виды «не по зубам»
// по одному и молчал о причине. Теперь при «не по зубам» раз в час — понятная строка: что с уроном и что делать (оружие бот сам не покупает)
async function lowDmgNote() {
  const aS = (env.damageSkills || env.rt.skills)?.['атака'], atk = aS?.dmgN >= 5 ? aS.dmg / aS.dmgN : 0;
  if (!atk || atk > 5 || Date.now() - (env.rt.lowDmgNoteT || 0) < 3600000) return;
  await env.setRt({ lowDmgNoteT: Date.now() });
  env.rec('B', 'цели', `⚠ обычная атака ≈${atk.toFixed(0)} урона за удар (${aS.dmgN} ударов) — герой почти не пробивает: кончился «Бонус новичка» или оружие слабое/снято. `
    + `Нужны оружие по уровню (с 20 ур. — D-grade) и заряды под него; пока — мобы слабее или другая зона. Оружие бот сам не покупает`);
}

// 16.10, Rudelto: реальная смена документа после leave уничтожает продолжение battle().
// Запрет повторного захода и актуальные HP должны попасть в storage ДО нажатия выхода.
async function probeExitCommit(ctx, mob, why, safety = false) {
  const id = ctx.rb.id, at = Date.now();
  const result = await env.setRt({ rbPending: false,
    rbPreSkip: { ...(env.rt.rbPreSkip || {}), [id]: { t: at, kind: safety ? 'safety' : 'strong', observed: true, probeExit: true, ...(safety ? {safety:true} : {}), why } },
    rbWound: { ...(env.rt.rbWound || {}), [id]: { cur: mob.cur, max: mob.max, name: ctx.name, t: at } } });
  return result?.ok === true;
}

// 20.12 (ревизия 17.10): запись запрета перед выходом — не дольше 1,5 с (как champQuickExitCommit); дальше считаем неудачей
const EXIT_COMMIT_TRIES = 2, EXIT_COMMIT_MS = 1500;
async function exitCommitBounded(ctx, mob, why, safety) {
  let timer;
  try { return !!(await Promise.race([probeExitCommit(ctx, mob, why, safety), new Promise(resolve => { timer = typeof setTimeout === 'function' ? setTimeout(() => resolve(false), EXIT_COMMIT_MS) : null; })])); }
  catch (e) { return false; }
  finally { if (timer) clearTimeout(timer); }
}

async function rbTryExit(ctx, me, mob, v, ep) {
  const actor = () => env.battleExitContext?.() ?? JSON.stringify([env.rt.char || '', env.rt.manualKickAt || 0]);
  const beforeActor = actor(), identity = () => JSON.stringify([actor(), location.pathname, location.search]);
  const before = identity();
  const ordinary = !ep && env.ordinaryLiveTour?.(ctx.rb.id), safety = ordinary && v.safety === true;
  const probe = !ordinary && !ep && !!env.probeFight?.(ctx.rb.id);   // 9.2.5: бой-проба — плохой прогноз = выход (пропуск 30 мин), не бой до конца
  const canAttrit = !ep && (ordinary ? safety : env.cfg.rbChipRetreat === true || probe) && (v.abort || v.retreat || v.lethal);
  if (canAttrit && !ctx.rb.retreated && me && Date.now() > (env.rt.rbDb?.[ctx.rb.id]?.leaveBadUntil || 0)) {
    const attempts = (env.rt.rbGoCnt?.[ctx.rb.id] || []).filter(t => Date.now() - t < 3600000).length;
    const leave = env.$q('#battle-back-map');
    if ((safety || probe || attempts < Math.max(1, env.cfg.rbChipMaxAttempts || 3)) && env.shown(leave)) {
      // 20.12 (ревизия 17.10, аудит combat/C5): отказ записи запрета (statePatch/rtWriter) раньше давал вечное 'wait' — цикл боя
      // каждые 250 мс пытался сохранить rbPreSkip и не доходил до банок/лечения, пока РБ не убивал героя. Теперь запись ограничена
      // 1,5 с, и после двух неудач подряд жмём выход без сохранённого запрета (вердикт допишет rbRetreat, если страница не сменится)
      const committed = !(probe || safety) || await exitCommitBounded(ctx, mob, v.why || 'опасность в бою', safety);
      if (!env.on || env.tabOwner === false || !env.isBattle() || identity() !== before) return 'done';
      if (!committed) {
        ctx.rb.exitCommitFail = (ctx.rb.exitCommitFail || 0) + 1;
        if (ctx.rb.exitCommitFail < EXIT_COMMIT_TRIES) { await env.sleep(250); return identity() === before ? 'wait' : 'done'; }
        env.rec('B', 'РБ', `${ctx.name}: запрет повторного захода сохранить не удалось (${ctx.rb.exitCommitFail} раза) — выхожу без записи, жизнь героя важнее`);
      }
      ctx.rb.retreated = true;
      env.rec('B', 'РБ', `${ctx.name}: пытаюсь выйти — ${v.why || (v.lethal ? 'опасный удар' : 'прогноз боя требует отхода')} (сервер должен подтвердить завершение боя)`);
      env.leaveMark?.(ctx.rb.id, ctx.name);
      env.fire(leave);
      const ended = await env.waitFor(() => !env.isBattle(), 8000, 150);
      if (!env.on || env.tabOwner === false || actor() !== beforeActor) return 'done';
      if (ended) {
        await env.rbRetreat(ctx, mob, (probe ? 'пробный заход: ' : '') + (v.why || 'отступление'), safety ? 'danger' : probe ? 'skip' : undefined);
        return 'done';
      }
      env.leaveMark?.(null);
      await env.rbNote(ctx.rb.id, { leaveBadUntil: Date.now() + 3600000 });
      env.rec('B', 'РБ', `${ctx.name}: выход не подтверждён, повторный выход запрещён на 1 час`);
    }
  }
  return null;
}

// 16.10: навигация уничтожает продолжение; hold короткой пробы пишем до native leave.
// Сбой storage не должен бесконечно удерживать героя в опасном бою.
async function champQuickExitCommit(ctx, outcome, dealt, sec) {
  let timer;
  try { return !!(await Promise.race([env.champs.learn(ctx, outcome, dealt, sec), new Promise(resolve => { timer = setTimeout(() => resolve(null), 1200); })])); }
  catch (e) { return false; }
  finally { clearTimeout(timer); }
}

// 20.13 (ревизия 17.10, шаг 7): бой разрезан на именованные шаги без смены поведения — тот же порядок проверок, те же записи rt.
// battleOpen — загрузка страницы, панель, проверки входа и ctx; круг боя — шаги ниже (функции внутри battle: им нужны его
// замыкания act/lastHpPot/progT…); battleWin — итог победы. Шаг круга возвращает NEXT (дальше по кругу), AGAIN (новый круг, бывший
// continue), END (выход из круга к итогу, бывший break) или любое другое значение — выход из battle с этим значением (бывший return).
async function battle() {
  const open = await battleOpen();
  if (!open?.[BATTLE_OPEN]) return open;
  const { ctx, spawnId, manualRb } = open;
  if (ctx.hpProofCurrent && !ctx.hpProofCurrent() || ctx.rebirth && !ctx.rebirth.current()) return;

  // Сравниваем сами строки, а не число маркеров: хвост журнала ограничен,
  // и новый сосед мог заменить старого при неизменном количестве строк.
  let extraLog = ctx.logStart || [];
  // 20.41 (лог 20.10 21:09, Krokian Padisha Sobekk 74: удар → удар 2,7–3,0 с при разрешённых сервером ≈1,2 с): учёт соседей РБ
  // (19.10) перед КАЖДЫМ ударом ждал всю очередь записи и ещё один полный statePatch — при памяти 1,3 МБ это +0,6–1,5 с на ход.
  // Теперь в бою запись идёт в фоне строго по одной: новый ответ сервера во время записи — ещё один проход после неё (курсор
  // журнала тот же, повтор безопасен). Итог боя (победа/смерть) ждёт фоновую запись и делает последнюю — как раньше.
  let raidCountP = null, raidCountAgain = false;
  const raidCount = (sp, begin = false) => {
    if (raidCountP) { raidCountAgain = true; return raidCountP; }
    return raidCountP = (async () => {
      try {
        raidCountAgain = !begin;
        if (begin) await env.noteRaidMobKills(sp, true);   // начало: снимок курсора берётся синхронно при вызове (RAID_MOB_BASE)
        while (raidCountAgain && killOwnerValid(ctx)) { raidCountAgain = false; await env.noteRaidMobKills(sp); }
      } catch (e) { /* следующий круг или итог боя повторят запись с тем же курсором */ } finally { raidCountP = null; }
    })();
  };
  const countExtras = async (final = false) => {
    if(!killOwnerValid(ctx))return;
    const current = env.logLines(), added = freshBattleLines(extraLog, current);
    extraLog = current;
    cancelCollect(ctx, current);
    const fresh = env.extraKillsInLog(added);
    const sum = f => fresh.reduce((a, k) => a + k[f], 0);
    ctx.extraCredited ||= { exp: 0, sp: 0, adena: 0 };
    for (const k of ['exp', 'sp', 'adena']) ctx.extraCredited[k] += sum(k);
    (ctx.domKilled||=[]).push(...fresh.map(k=>k.name));
    const server=serverKillNames(ctx.spawnId||spawnId,t0),wanted=[...ctx.domKilled,...missingKillNames(server,ctx.domKilled)];
    const missing=missingKillNames(wanted,ctx.killed);
    const raidCounted=!!ctx.rb&&typeof env.noteRaidMobKills==='function';
    if(raidCounted){const sp=ctx.spawnId||spawnId;if(!final)void raidCount(sp);else{while(raidCountP)await raidCountP;await env.noteRaidMobKills(sp);}}
    if(!killOwnerValid(ctx))return;
    if(!fresh.length&&!missing.length)return;
    // Лог20.10 10:43UTC: не ставим дисковую запись статистики между подтверждённой победой и её обработкой.
    // setRt меняет локальную память сразу; обязательные квоты и сохранение перед навигацией ждут общую очередь ниже.
    env.setRt({ ...(raidCounted?{}:{kills:env.rt.kills+missing.length}), exp: env.rt.exp + sum('exp'), sp: env.rt.sp + sum('sp'), adena: env.rt.adena + sum('adena') });
    if(!killOwnerValid(ctx))return;
    for (const k of fresh) {
      env.rec('B', 'доп. цель', `${k.name}: ${k.exp || k.sp || k.adena ? `EXP +${k.exp} · SP +${k.sp} · аден +${k.adena}` : 'повержена; награды учитываю в общем итоге боя'}${k.items.length ? ' · ' + k.items.join(', ') : ''}`);
    }
    if(missing.length>fresh.length)env.rec('B','учёт мобов',`Полный ответ боя подтвердил дополнительные убийства: ${missing.length} · всего соседей ${ctx.killed.length+missing.length}`);
    ctx.killed.push(...missing);
    for(const name of missing){if(!killOwnerValid(ctx))return;if(env.isQuestName(name))await env.trackQuest(name,true);}
  };
  // 20.12 (ревизия 17.10, аудит H1/F1): отметка лимита мобов больше не держит героя в уже открытом бою. Есть свежий счётчик из ответа
  // игры — запись идёт параллельно с ударами; нет — ждём только свой снимок (без него билет «неточно»). Неудача — бой продолжается.
  if (!ctx.rb && env.beginFarmQuota) {
    // 20.41 (лог 20.10, память 1,3 МБ): без свежего счётчика ждём только снимок точки начала, не запись 'begin' (итог ждёт её в quotaTicket)
    let baseR = null; const baseP = new Promise(r => { baseR = r; });
    ctx.farmQuotaP = Promise.resolve().then(() => env.beginFarmQuota(ctx.spawnId || spawnId, baseR)).then(t => t || null, () => null);
    if (!env.farmQuotaCached?.()) await Promise.race([baseP, ctx.farmQuotaP]);
  }
  ctx.quotaTicket = async () => { if (ctx.farmQuotaP) { ctx.farmQuota = await ctx.farmQuotaP; ctx.farmQuotaP = null; } return ctx.farmQuota || null; };
  // 20.41 (замер цикла катакомб: список подземелья ≈0,3 с после победы ждал «Охотиться дальше»): список для следующего моба читаем уже
  // в начале боя; на победе он переиспользуется, если не старше 4 с (долгий бой — читаем заново)
  if (!ctx.rb && !ctx.rebirth) try { env.catPrefetch?.(); } catch (e) {}
  if(ctx.rb&&env.noteRaidMobKills){
    if(env.raidMobReady&&!env.raidMobReady(ctx.spawnId||spawnId))await env.waitFor(()=>env.raidMobReady(ctx.spawnId||spawnId),1000,20);
    if(!killOwnerValid(ctx))return;
    // 20.41: запись начала тоже не держит первый удар (лог 21:09: ответ start → первый удар 4,9 с); курсор взят сразу при вызове.
    void raidCount(ctx.spawnId||spawnId,true);
  }
  let lastHpPot = 0, lastMpPot = 0, lastAct = Date.now(), lastActT = 0;
  const actionContext=()=>JSON.stringify([env.evidenceOwner?.(),env.battleExitContext?.(),env.rt.char||'',env.rt.classCur?.prof,env.rt.classCur?.slot,env.rt.manualKickAt||0,env.routeLocation?.href||env.routeLocation?.search||'']);
  const battleOwner=actionContext(),recoveryGeneration=env.actionGeneration?.(),pulse=ms=>env.combatPulse?env.combatPulse(ms):env.sleep(ms),waitNet=(fn,ms,step)=>env.combatWait?env.combatWait(fn,ms,step):env.waitFor(fn,ms,step);
  // 20.81 (лог 29.10 20:08:10): reload обогнал позднюю победу и повторил start уже убитого spawn. Поход сверяет свой этап сам.
  const recoverRebirth = async () => {
    if (!ctx.rebirth) return false;
    const valid = () => actionContext() === battleOwner && env.actionGeneration?.() === recoveryGeneration && killOwnerValid(ctx) && rebirthMode() && env.isBattle() && !env.pvpPending?.() && !env.antibotState?.();
    if (valid()) { if (typeof env.rebirthRecover === 'function') await env.rebirthRecover(valid); else await env.sleep(300); }
    return true; // Отмена/неизвестность похода не разрешает запасной reload старого spawn.
  };
  let pendingTurn=null; // 20.36: таймаут ожидания не разрешает второй ход до ответа на первый.
  const turnAnswered=n=>env.actReceipt&&n.rid!=null?!!env.actReceipt(n.rid):env.actNet().done>=n.count;
  // 7.1.30: перезагрузка страницы боя — не чаще 3 раз за 10 мин (общий счётчик вкладки); 8.0.3: и для зависшего хода
  const reloadSlot = () => { let rl = []; try { rl = JSON.parse(sessionStorage.getItem('l2bot.mageReload') || '[]').filter(t => Date.now() - t < 600000); } catch (e) {}
    if (rl.length >= 3) return false; try { sessionStorage.setItem('l2bot.mageReload', JSON.stringify([...rl, Date.now()])); } catch (e) {} return true; };
  const turnSamples = [];
  // 8.0.3 (логи 11.10 09:11–10:37, 10 боёв с РБ: 1302 потерянных нажатия на 1689 ходов, ДПС 1436 против ≈3300 в тех же баффах на 7.2.1):
  // после ответа на ход игра шлёт свой GET /character (через ≈8 мс, идёт 0,25–0,56 с) и, пока он в полёте и ≈30 мс после, молча теряет
  // клик по панели. 8.0 убрал паузу 250 мс после принятого хода — бот жал через 0,1–0,3 с, почти каждый первый клик терялся.
  // Теперь клик — когда игра свободна: нет её запросов в полёте, прошёл запас A после ответа на ход и запас B после конца её GET /character
  // (лог 23:35: и без записанного GET клики через 100–300 мс после ответа терялись — 300 из 306; журнал пишет GET не чаще раза в 3 с).
  // Запасы подстраиваются отдельно: клик потерян — растёт тот, что решал (A +30, B +15), дошёл впритык — тот же −2 / −1
  const clampL = (v, L) => Math.min(L[1], Math.max(L[0], +v || L[2]));
  let lockA = clampL(env.rt.clickLockA, LOCK_A), lockB = clampL(env.rt.clickLockB, LOCK_B);
  // 20.41 (лог 20.10 21:09, память 1,3 МБ: каждая запись — полный get+set памяти в фоне и рассылка её всем страницам): запасы клика —
  // только подстройка этой же функции (других читателей нет); память вкладки обновлена сразу, запись — отложенным пакетом (до 8 с, уход со страницы его досылает)
  const lockSave = () => { if (Math.abs(lockA - clampL(env.rt.clickLockA, LOCK_A)) >= 20 || Math.abs(lockB - clampL(env.rt.clickLockB, LOCK_B)) >= 10) (env.setRtSoon || env.setRt)({ clickLockA: lockA, clickLockB: lockB })?.catch?.(() => {}); };
  const gameFree = async (valid = () => true) => { // → { dT, gE } — ответ на ход и конец GET после него
    const t0 = Date.now();
    for (;;) {
      const g = env.gameBusy ? env.gameBusy() : { busy: false, end: 0 }, dT = env.actNet?.().doneT || 0, gE = g.end > dT ? g.end : 0;
      const need = g.busy ? 40 : Math.max(dT ? dT + lockA - Date.now() : 0, gE ? gE + lockB - Date.now() : 0);
      if (need <= 0 || Date.now() - t0 > 1500) return { dT, gE };
      await pulse(Math.min(need, 60));
      if (!valid() || !env.on || !env.tabOwner || !env.isBattle() || env.pvpPending?.() || victory() || defeat()) return null;
    }
  };
  // 20.42 (быстрый удар, решение John 20.10): одноразовая метка для hook.js — после ответа на обычный удар игра не ждёт свой GET /character.
  // Только атака и урон/дебафф по цели; банки, заряды, тогглы, призыв, баффы и лечение идут как прежде
  const FAST_T = new Set(['PDAM', 'MDAM', 'BLOW', 'CHARGEDAM', 'DRAIN', 'DOT', 'MDOT', 'DEATHLINK', 'MANADAM', 'CPDAM', 'FATALCOUNTER', 'DEBUFF', 'WEAKNESS', 'POISON', 'BLEED']);
  const fastHit = (b, exact) => { if (exact === 'attack') return true; if (!/^l2_\d+$/.test(exact || '')) return false; const il = env.ilOf?.(b); return !!il && il.o !== 'TOGGLE' && FAST_T.has(il.t) && !healSlot(b); };
  const fastMark = (b, exact) => { try { const d = document.documentElement.dataset; if (env.cfg.fastTurn !== false && fastHit(b, exact)) d.l2botFast = exact + '|' + Date.now(); else delete d.l2botFast; } catch (_) {} };
  // результат: true — сработал; false — не ушёл в КД; 'unavail' — игра ответила «скилл недоступен» (неподходящее оружие)
  // mpFree: выключение тоггла бесплатно либо цену включения уже перепроверяет отдельный ON-plan, без старой IL-цены.
  const act = async (b, status, hpGuard = false, stillNeeded = null, mpFree = false) => {
    const owner=actionContext(),valid=()=>owner===battleOwner&&owner===actionContext()&&env.on&&env.tabOwner&&env.canAct?.()!==false&&env.isBattle()&&!env.pvpPending?.()&&(!ctx.hpProofCurrent||ctx.hpProofCurrent())&&(!ctx.rebirth||ctx.rebirth.current()),canSend=()=>valid()&&!victory()&&!defeat();
    if(pendingTurn&&!turnAnswered(pendingTurn)){
      await waitNet(()=>turnAnswered(pendingTurn)||!canSend(),1000,40);
      if(!canSend())return false;if(!turnAnswered(pendingTurn))return 'lock';
    }
    pendingTurn=null;
    // 23.10: общий темп ждём до снимков запроса и последних проверок HP/КД; отложенный клик не накапливаем.
    if (env.actionWait && !await env.actionWait(canSend) || !canSend()) return false;
    // Серверная общая пауза распространяется на все действия, включая банки и спойл.
    // Не полагаемся на визуально готовую кнопку, когда сервер сообщил blockedBy=global.
    while (env.combatCooldown.globalWait() > 0) {
      if (!canSend()) return false;
      await pulse(Math.min(850, env.combatCooldown.globalWait()));
      if(stillNeeded&&!stillNeeded())return 'lock';
    }
    if (!canSend()) return false;
    const exact = env.slotAction(b);
    if (exact && env.combatCooldown.skillWait(exact, (env.cdSpawn || env.battleSpawn)()) > 0) return 'cd';
    const free = await gameFree(canSend);
    if (!free || !canSend()) return false;
    // Ответ во время gameFree мог назначить новый КД. Сначала новый выбор, затем клик.
    if(env.combatCooldown.globalWait()>0||exact&&env.combatCooldown.skillWait(exact,(env.cdSpawn||env.battleSpawn)())>0)return 'lock';
    if (stillNeeded && !stillNeeded()) return 'lock';
    // 20.49: GET после Focus мог подтвердить OFF Vicious, пока обычный удар ждал gameFree. Сначала новый выбор подготовки.
    // При unknown/pending плана нет — атаку не задерживаем, она даст следующую родную ревизию.
    if (exact === 'attack' && (managedToggleIds.some(id => managedTogglePlan(ctx,id)) || typeof managedMonsterPlan === 'function' && managedMonsterPlan(ctx))) return 'lock';
    // 20.12 (ревизия 17.10): MP не хватает — не 'lock' (тот значит «клик потерян в окне занятости», вызывающий повторяет сразу,
    // и цикл боя крутился без единой паузы — вкладка замирала), а 'nomp': слот «занят» 1,5 с, цикл идёт к банкам/другим действиям
    if (!mpFree && env.meMp && !affordable(b, env.meMp(), 0)) { if (env.skKey(b)) mpUntil.set(env.skKey(b), Date.now() + NOMP_MS); return 'nomp'; } // MP мог измениться за ожидание ответа игры
    // 10.0.5 (лог 13.10 10:51:56): удар выбран при HP 55 %, а пока ждали ответ хода после лага, HP стал 19 % — бот всё равно нажал Blaze.
    // Удар (hpGuard) не жмём, если за время ожидания HP упал до опасного: 'lock' — цикл сразу решает заново (банка, вампирик, лечение)
    if (hpGuard && !healSlot(b)) { const m2 = env.meHp(), p0 = ctx.mePct0;
      if (m2 && p0 != null && m2.pct <= 50 && m2.pct < p0 - 15) { env.rec('B', 'мало HP', `HP упал ${p0 | 0} → ${m2.pct | 0} % за время ожидания хода — вместо «${env.cleanTitle(b.title)}» лечусь`); return 'lock'; } }
    // За ожидание gameFree входящий удар мог изменить лучший способ восстановления.
    if (env.names(env.cfg.nDrain).some(n => slotsBy(n)[0] === b)) {
      const m2 = env.meHp();
      if (m2 && m2.pct <= Math.max(env.cfg.stopHp,25) && Date.now() - lastHpPot > 1100 && !drainPreferred(ctx,m2,b,env.hpPotPick(true))) return 'lock';
    }
    env.observeSlot(b, 'B');
    const before = noticeText();
    const firedAt = Date.now(), slackA = free.dT ? firedAt - (free.dT + lockA) : 1e9, slackB = free.gE ? firedAt - (free.gE + lockB) : 1e9;
    const bindB = slackB < slackA, gap = Math.min(slackA, slackB);   // какой запас решал и насколько впритык
    const net0 = env.actNet?.().start || 0;
    fastMark(b, exact);
    // Метку native80 ставим только в синхронном окне собственного клика, после всех ожиданий/повторных guards.
    if(stillNeeded?.monsterIntent&&(!canSend()||!stillNeeded()||!armMonsterRequest(stillNeeded.monsterIntent)))return 'lock';
    let fired;try{fired=env.fire(b);}finally{if(stillNeeded?.monsterIntent)clearMonsterMarker();}
    if (!fired) { try { delete document.documentElement.dataset.l2botFast; } catch (_) {} return false; }
    if (ctx.hpProofCurrent && fastHit(b, exact)) ctx.hpProofCurrent = null; // первый разрешённый боевой клик; дальше обычные guards круга
    lastAct = Date.now();
    if (env.skKey(b)) pressAt.set(env.skKey(b), firedAt);
    const petActAlive = ctx.pet && env.petState?.()?.has !== false;   // 7.1.31: действие хозяина, пока кот жив (кот бьёт вместе с ним)
    // 7.1.17: ждём, пока игра отправит ход (до 0,6 с) и получит ответ сервера (до 6 с) — иначе следующий клик теряется
    // 8.0.3: запрос уходит сразу после клика — ждём 400 мс (было 600: потерянный клик стоил лишние 0,2 с)
    let ownStart=null;
    const sent = !!env.actNet && !!(await waitNet(() => {const n=env.actNet();if(n.start>net0){ownStart={count:n.start,rid:n.startRid,owner:n.startOwner};return 1;}return !valid()?1:null;}, 400, 40))&&!!ownStart;
    if(sent)pendingTurn=ownStart;
    if (sent) await waitNet(() => (ownStart.rid!=null&&env.actReceipt?env.actReceipt(ownStart.rid):env.actNet().done>=env.actNet().start)||!valid()||victory()||defeat()?1:null,6000,40);
    // Stop запрещает следующий клик; уже полученный ответ своего героя можно учесть. Смена контекста отменяет и учёт.
    if(owner!==actionContext()||!env.tabOwner||!env.isBattle())return false;
    if(sent&&!turnAnswered(ownStart)&&!victory()&&!defeat())return 'lock';
    pendingTurn=null;
    const receipt=sent&&ownStart.rid!=null?env.actReceipt?.(ownStart.rid):null;
    const matched=receipt&&ownStart.count===net0+1&&receipt.owner===ownStart.owner&&receipt.owner===env.evidenceOwner?.()&&(!exact||receipt.action===exact);
    env.setStatus(status);
    // 7.2.1 (лог 10.10 21:07–21:14, 9 из 44 боёв): 1) первый клик сразу после «Охотиться дальше» игра не принимает (запрос не уходит),
    // а бот ещё секунду ждал, не уйдёт ли кнопка в КД; 2) ход принят сервером, но игра перерисовала панель (ответ «full») — кнопка
    // не показала откат, бот счёл ход несработавшим и жал то же заклинание снова («Blaze: урон 0», «ещё на КД — бью другим», +2–3 с).
    // Теперь: ход ушёл и сервер ответил 2xx на это действие — нажатие засчитано; запрос не ушёл (а хук работает) — без секундного ожидания
    const netOk = sent && (env.actReceipt&&ownStart.rid!=null?!!matched&&receipt.ok:env.actNet().done>=env.actNet().start&&env.actNet().ok&&(!exact||env.actNet().action===exact));
    const confirmed=!!(netOk&&matched&&receipt.rid===ownStart.rid&&env.actNet().start===ownStart.count&&env.actNet().startRid===ownStart.rid&&owner===actionContext());
    // 20.13 (ревизия 17.10, шаг 7, аудит combat/C11): на свежей странице боя счётчик ходов ещё 0 — первый потерянный клик не распознавался
    // (net0 > 0), и лучший удар блокировался на 3 с вместо 0,7 с. Хук считается живым и по другим признакам: ответ боя/«Охотиться
    // дальше» (doneT) или конец запроса игры (gameBusy().end); без признаков хука — как раньше, по рисунку отката
    const hookSeen = net0 > 0 || (env.actNet?.().doneT || 0) > 0 || (env.gameBusy?.().end || 0) > 0;
    const lost = !!env.actNet && hookSeen && !sent && !victory() && !defeat();
    // 8.0.3: потерян сразу после освобождения игры (≤ запас + 0,25 с) — запас больше, а сам скилл не «занят»: его же жмём снова (так
    // Vampiric Touch прошёл 4 раза из 60 — после потери он блокировался, и бот пил банки); дошёл быстро — запас меньше
    const lockLost = lost && gap < 250;
    if (lockLost) { if (bindB) lockB = Math.min(LOCK_B[1], lockB + 15); else lockA = Math.min(LOCK_A[1], lockA + 30); lockSave(); }
    else if (sent && gap < 60) { if (bindB) lockB = Math.max(LOCK_B[0], lockB - 1); else lockA = Math.max(LOCK_A[0], lockA - 2); lockSave(); }   // на границе теряется ≈6 % нажатий
    if (lost && !lockLost && env.skKey(b)) lostUntil.set(env.skKey(b), Date.now() + 700);   // 7.2.2: не жать его же сразу снова
    if (lost) void rememberCd(b, 'lost');          // 17.10: нажатие «по серверу» при застывшем рисунке потеряно — считаем (см. cdBusy)
    ctx.lastLost = lost && !lockLost;             // 10.0 (аудит боя): потерянный клик — слот «занят» 0,7 с (lostUntil), а не 3 с паузы вызывающего
    // 10.0 (аудит боя): сервер уже ответил отказом на этот ход — не ждём по экрану до 1 с, откат учтён моделью (combatCooldown)
    const refused = sent && !netOk && (env.actReceipt&&ownStart.rid!=null?matched:env.actNet().done >= env.actNet().start && (!exact || env.actNet().action === exact)) && !victory() && !defeat();
    if (lockLost) return 'lock';
    // v5.4: моб умер от этого удара — победа приходит вместо отката, не ждём 1 с «ушёл ли слот в КД» (лог 08.10 15:05:
    // удар Soul Breaker → «итог боя» через 1,7 с, хотя моб умирал с первого удара; на цепочке это ~1,2 с лишних на моба)
    const dead = () => victory() || (mobHp()?.cur ?? 1) === 0;
    let done = lost || refused ? false : env.slotCd(b) ? !!(await env.waitFor(() => !uiReady(b) || dead() || netOk, 1000, 40)) : true;
    // ответ игры: «скилл недоступен» (оружие) или «Скіл на перезарядці»
    // 8.0: сервер принял именно этот ход (2xx) — «на перезарядке»/«недоступен» к нему не относится, 250 мс не ждём
    // 20.43 (лог 21.10 22:07:37): 400 battle_skill_not_allowed «Цей скилл зараз недоступний…» не узнавался по коду; второй отказ
    // подряд (Wild Sweep после Whirlwind) давал тот же тост, ожидание «новый текст» молчало — 3 с паузы вместо запрета, и в
    // следующем бою снова 400. Текст сервера проверяем тем же UNAVAIL, что и тост; «боя нет» (battle_none/not_in_battle) — не «недоступно»
    const code=receipt?.code||'',refuseMsg=String(receipt?.message||''),fightGone=receipt?.error==='battle_none'||receipt?.reason==='not_in_battle';
    const ore=matched&&!receipt.ok?oreKind(receipt):null;   // 20.63: «Недостаточно Spirit Ore» — не «недоступно до конца боя», а до пополнения руды
    const serverAnswer=ore?'noore':matched&&!receipt.ok?(receipt.blockedBy==='global'||receipt.blockedBy==='skill'||/cooldown/i.test(code)?'cd':/(?:^|_)(?:mp|mana)(?:_|$)/i.test(code)?'nomp'
      :!fightGone&&(/unavail|weapon|not_learned/i.test(code)||!env.FORCE_NEED?.test(refuseMsg)&&env.UNAVAIL?.test(refuseMsg))?'unavail':null):null;
    // 20.43: текст отказа сервера «недоступно» — в строки журнала боя, баффов, спойла (loot) и тогглов (content) через ctx
    ctx.refuseText=serverAnswer==='unavail'?refuseMsg:'';
    const ans = serverAnswer || (dead() || (done === true && netOk) ? null : await waitNet(() => { const n = noticeText(); return n !== before && (env.FORCE_NEED.test(n) ? 'noforce' : env.UNAVAIL.test(n) ? 'unavail' : env.CD_RE.test(n) ? 'cd' : null); }, done ? 250 : lost || refused ? 300 : 600, 50));
    if (lastActT && Date.now() - lastActT < 3000) turnSamples.push(Date.now() - lastActT);   // длина хода — для расчёта ДПС
    lastActT = Date.now();
    if (turnSamples.length >= 10) { const avg = turnSamples.reduce((x, y) => x + y, 0) / turnSamples.length; turnSamples.length = 0;
      rtSoon({ turnMs: Math.round(env.rt.turnMs ? env.rt.turnMs * 0.7 + avg * 0.3 : avg) }); }   // 20.41: отложенно
    if (ans) done = ans;
    if(done==='nomp'&&env.skKey(b))mpUntil.set(env.skKey(b),{until:Date.now()+NOMP_MS,server:true,mp:env.meMp?.()?.cur});
    if(done==='noore'&&env.skKey(b)){
      oreUntil.set(env.skKey(b),{until:Date.now()+ORE_MS,kind:ore,q:env.invQty?.(ORE_IDS[ore])??0});
      const O=env.rt.oreOut||{},lbl=ore==='spirit'?'Spirit Ore':'Soul Ore';
      if(Date.now()-(+O[ore]||0)>600000)env.rec('B','закупка',`«${env.cleanTitle(b.title)}»: сервер — недостаточно ${lbl}; не жму, пока руда не пополнится, докуплю на ближайшей проверке запасов`);
      env.rt.oreOut={...O,[ore]:Date.now()};rtSoon({oreOut:env.rt.oreOut});
    }
    if (env.combatCooldown.recentlyGlobalRejected(firedAt)) done = 'cd';
    if (petActAlive && !ctx.petActsKnown && (netOk || (!env.actNet && done === true))) ctx.pet.acts++;
    if (done === true) await rememberCd(b, 'used');
    else if (done === 'cd') {
      if (!env.combatCooldown.recentlyGlobalRejected(firedAt)) await rememberCd(b, 'cd');
      // 8.0.3: отказ «на перезарядке» держит именно этот скилл (ветка «сервер знает откат» rt.cdUntil не читает — иначе жал бы его снова и снова)
      if (env.skKey(b)&&!env.combatCooldown.recentlyGlobalRejected(firedAt)&&!(exact&&env.combatCooldown.skillKnown?.(exact,(env.cdSpawn||env.battleSpawn)(),firedAt))) lostUntil.set(env.skKey(b), Date.now() + Math.max(300, env.memLeft(b) * 1000));
      env.rec('B', 'перезарядка', `«${env.cleanTitle(b.title)}» ещё на КД — жду ${env.memLeft(b).toFixed(1)} с, бью другим`);
      console.info(env.TAG, `${b.title}: на перезарядке, ещё ≈${env.memLeft(b).toFixed(1)} с`);
      if(!receipt)await env.sleep(env.rnd(80, 160));
      return 'cd';
    }
    if (!confirmed && !serverAnswer && !victory() && !((mobHp()?.cur ?? 1) === 0)) await env.pause(); // точный ответ: следующий круг ждёт только сервер/готовность игры
    if (env.names(env.cfg.nDrain).some(n => slotsBy(n)[0] === b)) drainBackoff(ctx,b,done);
    return done;
  };

  if (ctx.pet) { const n = env.actNet?.(); ctx.petActsKnown = Number.isSafeInteger(n?.okN); ctx.petActN = n?.okN; ctx.petActActor = JSON.stringify([env.rt.char || '',env.rt.classCur?.slot,env.rt.classCur?.prof,(env.cdSpawn || env.battleSpawn)?.()]); env.warlock?.capture?.(ctx); }
  if (!ctx.rebirth) env.champs?.observe?.(ctx);
  const t0 = Date.now();
  let progSig = '', progT = Date.now();          // последний «признак жизни» боя: HP моба/героя, журнал
  const strength = strengthSample(t0, env.actNet?.() || {});
  if (!ctx.rb && env.totemSlots().length >= 2) { ctx.tot = {}; ctx.totT = Date.now(); }   // замер тотемов (кроме РБ)
  // 20.12 (ревизия 17.10): страховка от петли на микрозадачах — ветка, которая делает continue без единого таймера ('lock' без
  // нажатия, шаг модуля, сразу вернувший true), раньше крутила цикл без макрозадач: страница замирала, Stop и сторож не доходили.
  // Настоящий круг боя всегда где-то спит (≥ 35 мс); SPIN_N кругов подряд короче SPIN_MS — петля, спим 50 мс (уступаем странице).
  // Таймер-метка не годится: в фоновой вкладке таймеры страницы тормозятся до 1 с, а сон идёт через фон (bgSleep)
  const SPIN_N = 10, SPIN_MS = 3;
  let spinN = 0, spinT = Date.now();
  // 20.13 (шаг 7): ответ шага круга (NEXT/AGAIN/END/выход). Прямо в круге оставлены короткие сторожа (бой кончился на сервере, ход
  // висит), выход от РБ (rbFlee), «мало HP», полоса банок HP на РБ и сама банка HP — тесты выполняют эти куски как тело цикла
  let s;
  while (env.on && env.tabOwner) {
    if(actionContext()!==battleOwner||ctx.hpProofCurrent&&!ctx.hpProofCurrent()||ctx.rebirth&&!victory()&&!defeat()&&!ctx.rebirth.current())return;
    if (!ctx.rebirth) env.champs?.observe?.(ctx);
    // 20.6: смена задач запрещает клики старого frame — продолжаем бой со следующего тика main.
    if (env.canAct?.() === false) return;
    strengthReliable(strength, Date.now(), env.actNet?.() || {});
    { const tI = Date.now(); spinN = tI - spinT < SPIN_MS ? spinN + 1 : 0; spinT = tI;
      if (spinN >= SPIN_N) { spinN = 0; await env.sleep(50); spinT = Date.now(); } }   // 20.12: круги без сна подряд — уступаем странице
    if (env.pvpPending?.()) return env.pvpRecoveryStep();
    if (env.antibotState()) return;                  // v5.5.6: проверка активности / блок PvE — в главный цикл (там ждём)
    if (!ctx.rebirth && env.rt.shop?.urgent) {         // Поход Rebirth не прерывается старым маршрутом магазина.
      env.rec('B', 'закупка', `«Закупить сейчас» — ухожу из боя${ctx.rb ? ' с РБ' : ''} в магазин`);
      env.setStatus('🛒 Закупка сейчас — бросаю бой'); location.href = '/char.html'; await env.sleep(4000); return;
    }
    if (ctx.tot) { const tn = Date.now(), k = env.totemActive()?.bn || '—'; ctx.tot[k] = (ctx.tot[k] || 0) + tn - ctx.totT; ctx.totT = tn; }
    if (defeat()) { if (ctx.champ && !ctx.rb) env.champs?.learn(ctx, 'death', Math.max(0, (ctx.chHp0 || 0) - (ctx.mobLast || 0)), (Date.now() - t0) / 1000)?.catch?.(() => {}); return battleDeath(ctx,countExtras); }
    if ((s = await epicRetreatWait()) !== NEXT) { if (s === AGAIN) continue; if (s === END) break; return s; }
    const me = env.meHp(), mp = env.meMp(), mob = mobHp();
    ctx.mePct0 = me ? me.pct : null;                 // 10.0.5: HP на момент решения — для act(..., hpGuard)
    if (me && me.cur === 0) return battleDeath(ctx,countExtras);
    // 9.0 (лог 12.10 01:08:28–01:31:22): Fairy Queen Timiniel на 7 092 из 1,9 млн HP — её добили другие игроки, ход → 400 «Немає активного
    // бою», игра больше ходов не шлёт, а страница боя стоит. Бот 23 мин жал «урон 0 · MP 0» (HP героя от регена менялся — сторож «нет ответа
    // 20 с» не срабатывал), пока игрок не увёл героя в город. Теперь: сервер сказал «боя нет» после начала этого боя — бой окончен, на карту
    { const g = env.actNet?.().gone;
      if (g && g.t >= t0 && !victory() && !defeat()) {
        const pc = mob && mob.max ? Math.round(mob.cur / mob.max * 1000) / 10 : null;
        env.rec('B', 'бой', `сервер: «Немає активного бою» — бой с ${ctx.name || mobName()} уже закончен${pc != null ? ` (у него ${pc} %)` : ''}${ctx.rb ? ', РБ, видимо, добили другие' : ''} → ухожу на карту`);
        env.actNet().gone = null;
        // недобитым не считаем (иначе тур платил бы за телепорт «добить» к уже мёртвому РБ); жив ли он — покажет список РБ
        const W = ctx.rb && env.rt.rbWound?.[ctx.rb.id] ? { ...env.rt.rbWound } : null; if (W) delete W[ctx.rb.id];
        await env.setRt({ target: null, ...(ctx.rb ? { rbCur: null } : {}), ...(W ? { rbWound: W } : {}) });
        return battleReturn(ctx);
      } }
    // 8.0.3 (лог 11.10 10:31:48–10:32:17, Барда 55): ход ушёл, а ответа нет 28,6 с — пока игра ждёт ответ, нажатия она не отправляет; бот
    // 20 с жал вслепую («урон 0» ×12) при «✅ победа вероятна» по замёрзшим HP, потом герой погиб. Теперь ход без ответа > 8 с (до 60 с) —
    // не жмём, отметка «сервер завис» (смерть сейчас — не «не по силам»), один раз спрашиваем сервер (/game/time): отвечает — завис только
    // этот запрос, обновляем страницу; не отвечает — ждём, ≥ 20 с без ответа — обновляем (не чаще 3 раз за 10 мин, общий счётчик)
    { const an = env.actNet?.(), hangMs = an && an.start > an.done && an.t ? Date.now() - an.t : 0;
      if (hangMs > 8000 && hangMs < 60000) {
        const hs = Math.round(hangMs / 1000);
        env.srvHangMark?.(`ход без ответа ${hs} с`);
        env.setStatus(`Бой: ход висит ${hs} с без ответа сервера — не жму, жду`);
        if (ctx.hangN !== an.start) {
          ctx.hangN = an.start;
          env.rec('B', 'бой', `ход висит ${hs} с без ответа сервера${ctx.rb ? ` (РБ ${ctx.name}, у него ${mob ? Math.round(mob.cur / Math.max(1, mob.max) * 100) : '?'} %)` : ''} — не жму вслепую, проверяю сервер`);
          const up = env.srvUp ? await env.srvUp() : false;
          if (!env.on || !env.tabOwner) return;
          if (env.actNet().done >= env.actNet().start) continue;   // ответ пришёл, пока спрашивали
          if (up) {
            if (await recoverRebirth()) return;
            if (reloadSlot()) { env.rec('B', 'бой', 'сервер игры отвечает — завис только этот ход: обновляю страницу'); location.reload(); await env.sleep(8000); return; }
          }
          if (!up) env.rec('B', 'бой', 'сервер игры не отвечает — жду ответа, не жму');
        }
        if (hangMs > 20000) {
          if (await recoverRebirth()) return;
          if (reloadSlot()) { env.rec('B', 'бой', `ход без ответа ${hs} с — обновляю страницу`); location.reload(); await env.sleep(8000); return; }
        }
        await env.sleep(300); continue;
      } }
    if (ctx.pet) petTick(ctx);
    // v5.6: урон по ВСЕМ мобам боя (главный + «рядом»): сумма их HP падает — это наш урон. Раньше ДПС и «не по зубам» считались
    // как HP первого моба / время всего боя (с соседями и переключением цели) — Captain «31 с, ДПС 51» при реальных ~150
    { const sum = (mob?.cur || 0) + extraMobs().reduce((a, x) => a + x.cur, 0);
      if (ctx.hpSum != null && sum < ctx.hpSum) ctx.dealt = (ctx.dealt || 0) + ctx.hpSum - sum;
      ctx.hpSum = sum; ctx.mobLast = mob?.cur ?? ctx.mobLast; }
    await countExtras();
    if (!env.on || !env.tabOwner) return;
    if (env.pvpPending?.()) return env.pvpRecoveryStep();
    if (!ctx.rebirth && !victory() && await env.tvtStep?.()) return;
    if (victory()) break;
    if ((s = await mainTargetDead(mob)) !== NEXT) { if (s === AGAIN) continue; if (s === END) break; return s; }
    if ((s = await limitStep(me, mp, mob)) !== NEXT) { if (s === AGAIN) continue; if (s === END) break; return s; }
    if ((s = await emergencyBuffStep(me, mp, mob)) !== NEXT) { if (s === AGAIN) continue; if (s === END) break; return s; }
    if ((s = await champFleeStep(me, mob)) !== NEXT) { if (s === AGAIN) continue; if (s === END) break; return s; }
    if (ctx.rb && me && mob && !ctx.rb.retreated) {
      const epChain = env.epicOn() && env.epicById(ctx.rb.id) && env.rt.epic?.k === env.epicById(ctx.rb.id).k && env.rt.epic?.step === 'fight';
      const fl = !epChain && env.rbFlee ? env.rbFlee(ctx, me, mob) : null;
      if (fl && env.ordinaryLiveTour?.(ctx.rb.id)) {
        const exit=await rbTryExit(ctx,me,mob,{...fl,abort:true},false);
        if(exit==='wait')continue;
        if(exit==='done')return;
      } else if (fl) {
        const leave = env.$q('#battle-back-map');
        if (env.shown(leave) && Date.now() > (env.rt.rbDb?.[ctx.rb.id]?.leaveBadUntil || 0)) {
          ctx.rb.retreated = true;
          // сервер недавно висел (l2bot.srvHang) — скачок HP мог накопиться за простой: без вердикта «не по силам», только пропуск 30 мин
          let hang = null; try { hang = JSON.parse(sessionStorage.getItem('l2bot.srvHang') || 'null'); } catch (e) {}
          const verdict = fl.kind === 'strong' && !(hang && Date.now() - (+hang.t || 0) < 60000) ? 'no' : 'skip';
          env.rec('B', 'РБ', `${ctx.name}: ⚠ ${fl.why} — ухожу из боя${manualRb ? ' (бой начат вами — смерть хуже, чем уйти)' : ''}${verdict === 'no' ? ', «не по силам» до нового уровня' : ', пропуск 30 мин'}`);
          env.leaveMark?.(ctx.rb.id, ctx.name);
          env.fire(leave);
          if (await env.waitFor(() => !env.isBattle(), 8000, 150)) { await env.rbRetreat(ctx, mob, fl.why, verdict); return; }
          env.leaveMark?.(null);
          await env.rbNote(ctx.rb.id, { leaveBadUntil: Date.now() + 3600000 });
          env.rec('B', 'РБ', `${ctx.name}: выход не подтверждён — бьюсь дальше, повторный выход запрещён на 1 час`);
        } else if (!ctx.rb.fleeSaid) { ctx.rb.fleeSaid = 1; env.rec('B', 'РБ', `${ctx.name}: ⚠ ${fl.why}, но выйти нельзя (нет кнопки или выход не работал) — бьюсь до конца на банках`); }
      }
    }
    // v4.44: из боя в этой игре уйти нельзя — бой идёт до конца (уход со страницы бой не прекращает: «Во время бою відновлення
    // недоступне», и РБ добивал героя у баффера, лог 01:48). Поэтому мало HP — банки как можно чаще (вкл. резерв), а если
    // банка на откате — бьём дальше (вампирик тоже лечит), а не стоим и не уходим
    // 8.0.3: уход СО СТРАНИЦЫ бой не прекращает, а штатная кнопка выхода — прекращает (см. выше: аварийный выход от смертельных ударов)
    // 20.59: на эпике в окне Frenzy HP 25 % — цель слива, не авария; банка только у края (epicFrenzyFloor, полоса банок ниже)
    if (me && me.pct <= Math.max(env.cfg.stopHp, 25) && !(epicFrenzyHold(ctx) && me.cur > epicFrenzyFloor(ctx, me))) {
      const pot = env.hpPotPick(true);
      // 10.0.5 (лог 13.10 10:51:56–10:52:06, Fierce Tiger King Angel): после лага HP 6–24 %, бот 10 с чередовал банку (+600 HP) и Blaze,
      // а Vampiric Touch (+1 880 HP за ход) и Corpse Life Drain не жал — вампиризм был запрещён ниже стоп-HP + 10 %, лечение на РБ отдано
      // банке; игрок жал вампирик руками. Теперь при критическом HP ход — только лечению: у мага сначала вампирик (лечит втрое больше
      // глотка), банка, а пока банка на паузе 1,1 с — вампирик или лечащий скилл, удар — только если лечить нечем
      const emDrain = drainPick(ctx, mp);
      if (emDrain && mageCombat() && (Date.now() - lastHpPot <= 1100 || drainPreferred(ctx, me, emDrain, pot))) { ctx.seq.push('💉'); const r = await act(emDrain, `Мало HP (${me.pct | 0}%) — вампиризм: ${env.cleanTitle(emDrain.title)}`);  continue; }
      if (pot && me.cur < me.max && Date.now() - lastHpPot > 1100) {
        // 8.0.3 (лог 11.10 09:59:55 и 10:00:06.8, Тимініель: клик аварийной банки потерян в окне занятости игры, повтор — только через
        // 1,1–1,3 с, за 2,3 с до смерти): потерян в окне ('lock') — отметку банки откатываем, следующий цикл жмёт её снова сразу
        const prevPot = lastHpPot; lastHpPot = Date.now();
        if (ctx.rb) (ctx.rb.potT ||= []).push(Date.now());
        const r = await act(pot, `Мало HP (${me.pct | 0}%) — банка: ${env.cleanTitle(pot.title)} (×${(env.qty(pot) ?? 1) - 1})`, false, () => { const h = env.meHp(); return !!h && h.cur < h.max; });
        if (r === 'lock') { lastHpPot = prevPot; ctx.rb?.potT?.pop(); }
        continue;
      }
      if (emDrain) { ctx.seq.push('💉'); const r = await act(emDrain, `Мало HP (${me.pct | 0}%) — вампиризм: ${env.cleanTitle(emDrain.title)}`);  continue; }
      const emHeal = healPick(ctx, mp);
      if (emHeal) { ctx.block['heal:' + emHeal.title] = Date.now() + 2500; const r = await act(emHeal, `Мало HP (${me.pct | 0}%) — лечение скиллом: ${env.cleanTitle(emHeal.title)}`); if (r === 'lock') ctx.block['heal:' + emHeal.title] = 0; continue; }
      if (!pot && !ctx.noPotSaid && !env.hpPots().length) { ctx.noPotSaid = 1; env.rec('B', 'мало HP', `HP ${me.pct | 0}%, банок HP нет — из боя уйти нельзя, бьюсь до конца`); }
    }
    ctx.emWait = 0;                                  // HP выше порога — ожидание банки с нуля
    if (!mob) {                                   // v5.6: полоски HP моба нет 15 с (окно ошибки, недогруз) — раньше цикл ждал вечно
      ctx.noMobT ||= Date.now();
      if (Date.now() - ctx.noMobT > 15000) {
        if (await recoverRebirth()) return;
        env.rec('B', 'бой', 'полоски HP моба нет 15 с — обновляю страницу'); location.reload(); await env.sleep(8000); return;
      }
      await env.sleep(100); continue;
    }
    ctx.noMobT = 0;
    if ((s = await exitCheckStep(me, mob)) !== NEXT) { if (s === AGAIN) continue; if (s === END) break; return s; }
    if ((s = await stallStep(me, mob)) !== NEXT) { if (s === AGAIN) continue; if (s === END) break; return s; }

    // 20.43 (лог 21.10 15:49): призыв кота — первым действием боя, раньше включения зарядов.
    if ((s = await petStep(me, mp)) !== NEXT) { if (s === AGAIN) continue; if (s === END) break; return s; }
    await env.keepShots();
    const ex = extraMobs().filter(x => x.cur > 0);
    const tc = (ctx.rebirth ? ` [поход: ${ctx.rebirth.role === 'raid' ? 'РБ' : ctx.rebirth.role === 'champion' ? 'чемпион' : 'моб'}]` : ctx.rb ? ` [РБ ${ctx.rb.note}]` : ctx.champ ? ' [чемп]' : '') + (ex.length ? ` +${ex.length} рядом` : '');

    if ((s = await healStep(me, mp)) !== NEXT) { if (s === AGAIN) continue; if (s === END) break; return s; }
    // банка HP (если задана)
    // v4.46: на РБ — при HP ≤ 45 % и по недостаче (≥1500 — большая); на мобах как было
    // v5.3: на РБ держим HP около 80 % (по просьбе игрока): начинаем пить при HP ≤ «с» (75 %) и пьём, пока не поднимется до «до» (80 %) —
    // симуляция 1000 РБ: побед Дестроер 80 → 97 %, Гладиатор 74 → 88 %, Тиран 85 → 100 %.
    // «Сливаться под Frenzy» (Дестроер): пока Frenzy готов — банок не пьём (кроме аварийных ≤ стоп-HP), HP падает до 30 %,
    // жмём Frenzy (+Guts/Zealot по правилам), дальше снова держим 90 %. Симуляция: бой на 21 % быстрее, банок на 31 % меньше.
    let potAt = rebirthBig(ctx) ? Math.max(env.cfg.hpPotAt || 0, 75) : env.cfg.hpPotAt;
    if (ctx.rb && me) {                            // 10.0 (аудит боя): HUD не отдал HP (me = null) — без TypeError на me.max
      const d = env.rt.rbDb?.[ctx.rb.id] || {};
      // 20.51 (лог23.10, Rahha11:31): старый P90≈635 не скрывает уже полученный в этом бою удар10576.
      const ordinaryP90 = Math.max(d.hitP90 || (ctx.rb.hits?.length >= 3
        ? [...ctx.rb.hits].sort((a,b)=>a-b)[Math.floor(ctx.rb.hits.length*0.9)] : Math.max(150, me.max * 0.06)), 0,
        ...(ctx.rb.hits || []).filter(n => Number.isFinite(n) && n > 0));
      const spike = d.sp || Math.max(ctx.rb.sp || 0, d.probe?.sp || 0, me.max * 0.30);   // 9.2.5: бой-проба — оценка спецудара держит полосу банок
      const emergencyFloor = Math.min(me.max * 0.96, spike + 2 * ordinaryP90);
      // Measured spikes + two ordinary hits determine an adaptive safety band.
      // The revised RB tactic uses an 80% floor, with a 20 pp reserve over the
      // estimated lethal combination. Manual thresholds remain available.
      const adaptive = env.cfg.rbBandAuto !== false;
      // 8.0 (аудит РБ: Селян 23:19 — 105 из 322 ходов на банки, 33 %): спецудар этого РБ замерен и обычных ударов ≥ 12 — запас
      // 15 п.п. над опасной комбинацией (спецудар + 2 удара), не ниже 60 %; незнакомый РБ — как раньше, от 80 %
      const known = d.sp > 0 && (d.hitP90 || ctx.rb.hits?.length >= 12);
      const from = adaptive
        ? (known ? Math.min(95, Math.max(60, emergencyFloor / me.max * 100 + 15))
                 : Math.min(95, Math.max(80, env.cfg.rbPotAt ?? 75, emergencyFloor / me.max * 100 + 20)))
        : Math.min(96, Math.max(1, env.cfg.rbPotAt ?? 75));
      const to = adaptive
        ? Math.min(98, Math.max(from + 3, env.cfg.rbPotTo ?? 80, from + 10))
        : Math.min(98, Math.max(from + 1, env.cfg.rbPotTo ?? 80));
      // 9.2 (анализатор боя): ритм спецудара (≥ 3 пауз, разброс ≤ 30 %) замеряется; с 14.10 (ниже) запас под спецудар держим всегда
      const sEta = adaptive && known && env.cfg.rbSpikeRhythm !== false ? env.fightSpikeEta?.() : null;
      // Лог 14.10 23:35, Gorgolos: оценка ритма сочла спецудар далёким, но при HP 3k
      // следующий вихрь на 2916 HP оставил 621 HP. Цена ошибки прогноза выше цены банки:
      // держим запас под спецудар даже между замеренными импульсами.
      // 20.13 (ревизия 17.10, шаг 7, аудит combat/C8): мёртвая ветка spikeFar (всегда false) убрана; ритм (cfg.rbSpikeRhythm) только
      // пишет строку в журнал — на запас HP не влияет
      if (sEta && !ctx.rb.rhythmNote) { ctx.rb.rhythmNote = 1; env.rec('B', 'РБ', `ритм спецудара: раз в ≈${sEta.gap} с — запас HP держу постоянно`); }
      const price = adaptive && known && env.cfg.rbTurnPrice !== false && me ? rbTurnHeal({ cur: me.cur, max: me.max, spike, p90: ordinaryP90, stopPct: env.cfg.stopHp }) : null;
      if (price) {                                // 9.0: знакомый РБ — «цена хода» вместо полосы from…to
        ctx.rb.potOn = price.need;
        if (!ctx.rb.priceNote) { ctx.rb.priceNote = 1; env.rec('B', 'РБ', `цена хода: банка/лечение только при HP < ${price.at} = спецудар ${Math.round(spike)} + 3 обычных удара по ≈${Math.round(ordinaryP90)}), иначе бью`); }
      } else {
        if (me && me.pct <= from) ctx.rb.potOn = true;
        if (me && me.pct >= to) ctx.rb.potOn = false;
      }
      potAt = ctx.rb.potOn ? 100 : -1;
      // 8.0.3 (лог 11.10 09:15:35: прогноз «РБ ≈0:16, банки: нужно ≈0», РБ 6 %, а бот выпил 5 банок подряд — 7 с без урона): прогноз решил,
      // что РБ умрёт раньше опасного HP без банок (usePots=false) — в полосе не пьём, только аварийно (HP ниже спецудар + 2 удара)
      if (potAt > 0 && ctx.rb.usePots === false && me.cur > emergencyFloor) potAt = -1;
      // 20.59: эпик под Frenzy — HP держим в зоне Frenzy, банка только у края (epicFrenzyFloor)
      if (epicFrenzyHold(ctx)) {
        const floor = epicFrenzyFloor(ctx, me);
        potAt = me.cur <= floor ? 100 : -1;
        if (!ctx.rb.frenzyHoldNote) { ctx.rb.frenzyHoldNote = 1; env.rec('B', 'эпики', `${ctx.name}: слив под Frenzy — до нажатия лимитов банка только при HP ≤ ${floor}, после Frenzy лечусь как обычно`); }
      } else if (frenzyDive(ctx, me)) { potAt = -1; if (!ctx.rb.diveNote) { ctx.rb.diveNote = 1; env.rec('B', 'РБ', `слив под Frenzy: банки не пью, пока HP не упадёт до ${env.ilOf(slotsBy('Frenzy')[0])?.pc?.hp || 30} % — там Frenzy`); } }
    }
    const hpPot = me && me.pct <= potAt && me.cur < me.max ? (ctx.rb ? env.hpPotByDeficit(me.max - me.cur) : env.hpPotPick(me.pct <= (env.cfg.stopHp || 25) + 10)) : null;
    const potLeft = env.qty(hpPot);
    const potReserveHit = ctx.rb && !ctx.rb.allIn && me && me.pct > 35 && hpReserveBlocked(hpPot, env.cfg.rbPotReserve);   // v4.44: резерв бережём, пока не припёрло   // на РБ резерв не трогаем; в режиме заходов банки бережём
    // v5.3: на РБ банки — чаще: у банки в l2wap нет своего отката (только общий ~0,2 с; лог 08.10 14:14), а пили раз в 2–5 с —
    // 600 HP за глоток против потери 300–600 HP/с у РБ 50 ур. Теперь, пока держим полосу HP, — раз в 1,1 с
    if (hpPot && potLeft !== 0 && !potReserveHit && me && me.pct <= potAt && Date.now() - lastHpPot > (bigTarget(ctx) ? 1100 : 2000)) {
      const prevPot = lastHpPot; lastHpPot = Date.now();
      if (ctx.rb) (ctx.rb.potT ||= []).push(Date.now());    // для оценки «хватит ли банок»
      const r = await act(hpPot, `Банка HP${ctx.rb ? ` (РБ: осталось ${potLeft - 1}${ctx.rb.usePots ? ', убиваем с банками' : ''})` : ''}`, false, () => { const h = env.meHp(); return !!h && h.cur < h.max; });
      if (r === 'lock') { lastHpPot = prevPot; ctx.rb?.potT?.pop(); }   // 8.0.3: клик потерян в окне занятости игры — банка не выпита, повтор сразу
      continue;
    }
    if ((s = await mpPotStep(me, mp)) !== NEXT) { if (s === AGAIN) continue; if (s === END) break; return s; }
    if ((s = await petBuffStep(me, mp, mob)) !== NEXT) { if (s === AGAIN) continue; if (s === END) break; return s; }
    if ((s = await buffStep(me, mp, mob)) !== NEXT) { if (s === AGAIN) continue; if (s === END) break; return s; }

    if ((s = await debuffStep(me, mp, mob, tc)) !== NEXT) { if (s === AGAIN) continue; if (s === END) break; return s; }
    if ((s = await strikeStep(mp, mob, tc)) !== NEXT) { if (s === AGAIN) continue; if (s === END) break; return s; }
    if ((s = await idleStep(mp)) !== NEXT) { if (s === AGAIN) continue; if (s === END) break; return s; }
    await env.sleep(100);
  }
  return battleWin(ctx, t0, spawnId, strength, countExtras);

  // ---------- шаги круга боя (объявления функций поднимаются; замыкают act, lastHpPot, lastMpPot, lastAct, progSig/progT, t0) ----------

  // шаг: эпик после команды отступления — ждём подтверждения выхода (смены страницы) до 12 с
  async function epicRetreatWait() {
    if (env.rt.epic?.step === 'retreatVerify' && ctx.rb && env.rt.epic.id === ctx.rb.id) {
      // После команды выхода боевой цикл ждёт смены страницы. HTTP 2xx без
      // ухода из боя не считаем доказательством выхода на сервере.
      if (Date.now() - (env.rt.epic.retreatT || 0) < 12000) {
        env.setStatus('Эпики: проверяю завершение боя после отступления');
        await env.sleep(350); return AGAIN;
      }
      const E = env.rt.epic;
      await env.epicDbSet(E.k, { leaveBadUntil: Date.now() + 3600000 });
      await env.setRt({ epic: { ...E, step: 'fight', retreatFailed: true } });
      env.rec('B', 'эпики', 'Не удалось подтвердить выход из боя за 12 с — продолжаю текущий бой, повторное отступление запрещено');
    }
    return NEXT;
  }

  // шаг: главная цель умерла — ждём победу, поражение или живую следующую цель
  async function mainTargetDead(mob) {
    if (mob && mob.cur === 0) {                   // главная цель умерла: ждём победу или следующую цель (соседи живы)
      // 14.10, расширенный аудит: 0 HP может опередить итог сервера или смену цели. Дополнительный удар здесь
      // уже относится к неизвестному состоянию боя; только ограниченно ждём победу, поражение или живую следующую цель.
      const nx = await env.waitFor(() => defeat() ? 'dead' : victory() ? 'win' : ((mobHp()?.cur || 0) > 0 ? 'next' : null), 3000, 100);
      if (!env.on || !env.tabOwner) return;
      if (nx === 'dead') return battleDeath(ctx,countExtras);
      if (nx !== 'next') return END;
      if (ctx.rebirth && mobName() !== ctx.name) return; // Новый этап сначала заново подтверждает модуль похода.
      if (mobName() !== ctx.name) {               // бой переключился на соседа
        ctx.name = mobName(); ctx.champ = env.isChamp(mobTitle());
        ctx.questKill = env.isQuestName(ctx.name);
        console.log(env.TAG, 'следующая цель в том же бою:', mobTitle());
      }
      return AGAIN;
    }
    return NEXT;
  }

  // Подготовка лимитов идёт раньше банок/Battle Roar и старого ограничения Zealot на добивании РБ.
  async function limitStep(me, mp, mob) {
    if (me?.pct <= 30) ctx.limitTranceUnverified = false;
    // 20.59 (лог 24.10 19:23:24, Core): Battle Trance нажат руками — бот принял слив за удар Core «5220 HP — смертельно» и сразу пил
    // банку на 24 %. Принятый сервером Trance (любой, и ручной) в этом бою = свой слив: замер ударов РБ заново, на эпике — окно Frenzy.
    ctx.born ||= Date.now();
    const tranceT = env.actNet?.()?.tranceT || 0;
    if (tranceT >= ctx.born && tranceT > (ctx.limitDiveT || 0)) { ctx.limitDiveT = tranceT; if (ctx.rb) { ctx.limitDiveHits = (ctx.rb.hits || []).length; ctx.rb.frenzyHoldNote = 0; } }
    const plan = limitPlan(ctx, me, mp, mob);
    if (!plan) {
      if (ctx.limitSkip && ctx.limitSkip !== ctx.limitSaid) { ctx.limitSaid = ctx.limitSkip; env.rec('B', 'лимиты', ctx.limitSkip); }
      return NEXT;
    }
    const actor = () => JSON.stringify([env.rt.char, env.rt.classCur?.slot, env.rt.classCur?.prof || env.rt.prof, (env.cdSpawn || env.battleSpawn)()]);
    const before = actor(), key = plan.kind === 'trance' ? 'limit:trance' : 'buff:' + plan.bn, netStart = env.actNet?.().start || 0;
    const needed = () => actor() === before && limitPlan(ctx, env.meHp(), env.meMp(), mobHp())?.b === plan.b;
    const result = await act(plan.b, plan.kind === 'trance'
      ? 'Лимиты: Battle Trance — снижаю HP до 25% для Guts/Frenzy/Zealot'
      : `Лимиты (HP ${me.pct | 0}%): ${env.cleanTitle(plan.b.title)}`, false, needed);
    if (actor() !== before || env.canAct?.() === false || !env.on || !env.tabOwner) return AGAIN;
    if (plan.kind === 'trance' && (result === true || (env.actNet?.().start || 0) > netStart && !['cd','nomp','unavail'].includes(result))) { ctx.limitTranceUnverified = true; ctx.limitDiveT = Date.now(); if (ctx.rb) { ctx.limitDiveHits = (ctx.rb.hits || []).length; ctx.rb.frenzyHoldNote = 0; } }
    // Не предполагаем25% после клика: следующий круг читает настоящее HP. Неизвестный исход не повторяем сразу.
    ctx.block[key] = result === 'unavail' ? Infinity : Date.now() + (result === true ? (plan.kind === 'trance' ? 30000 : 5000) : result === 'nomp' ? NOMP_MS : 3000);
    if (result === true && plan.kind === 'buff') env.setRt({ buffAt: { ...(env.rt.buffAt || {}), [plan.bn]: Date.now() } })?.catch?.(() => {});   // 20.41: без ожидания записи (память вкладки обновлена сразу)
    return AGAIN;
  }

  // шаг: аварийные баффы при низком HP (Guts → Frenzy → прочие → Zealot)
  async function emergencyBuffStep(me, mp, mob) {
    if (ctx.limitUnsafe) return NEXT; // После неожиданно глубокого сниженияHP сначала спасение, не старый путь баффов.
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
        if (!affordable(b, mp, 0)) continue;   // 20.12 (ревизия 17.10): MP ниже цены — не выбираем (act() откажет), идём к банкам
        if (il.id === 420 && ctx.rb && mobP > 15) continue;
        // v5.3 (симуляция 1000 РБ × 6 классов): на РБ при HP ≤ 30 % сначала банка (если готова) — каст баффа 1,5 с без лечения убивал
        if (ctx.rb && !env.cfg.rbFrenzyDive && env.hpPotPick(true) && Date.now() - lastHpPot > 1100) continue;
        low = [bn, b]; break;
      }
      if (low) {
        ctx.block['buff:' + low[0]] = Date.now() + 5000;
        const r = await act(low[1], `Аварийный бафф (HP ${me.pct | 0}%): ${low[1].title}`);
        if (r === 'lock') ctx.block['buff:' + low[0]] = 0;   // 8.0.3: клик потерян в окне занятости игры — повтор сразу, а не через 5 с
        if (r === 'nomp') ctx.block['buff:' + low[0]] = Date.now() + NOMP_MS;   // 20.12: не хватило MP — пауза слота, не повтор сразу
        // 20.76+ (ревизия 28.10): отказ сервера «недоступно» (400 battle_skill_not_allowed) — до конца боя, как buffStep/limitStep/petBuffStep;
        // раньше блок 5 с истекал и при низком HP тот же бафф снова уходил на заведомый отказ каждые 5 с, без причины в журнале
        if (r === 'unavail') { ctx.block['buff:' + low[0]] = Infinity; env.rec('B', 'недоступно', `аварийный бафф «${env.cleanTitle(low[1].title)}»: ${ctx.refuseText || noticeText() || 'недоступен'} — до конца боя не трогаю`); }
        if (r === true) env.setRt({ buffAt: { ...(env.rt.buffAt || {}), [low[0]]: Date.now() } })?.catch?.(() => {});   // 20.41: без ожидания записи
        return AGAIN;
      }
    }
    return NEXT;
  }

  // шаг: отход от чемпиона (не пробиваю / долго / мало HP) штатным выходом
  async function champFleeStep(me, mob) {
    // 8.0.3 (лог 11.10 11:42–11:44, Орфен — бой начал игрок): удар босса 2508–2885 = 40–57 % HP героя, а бот «из боя уйти нельзя, бьюсь
    // до конца» — две смерти за 2 мин, вторая сняла купленный бафф. Штатный выход «Назад на карту» (POST /game/battle/leave → 200) в этой
    // игре бой завершает (11:41:53, 11:42:05). Аварийное правило (raid.rbFlee) — и в бою, начатом игроком: смерть хуже, чем уйти.
    // Своя эпик-цепочка (rt.epic, шаг «бой») — по своим правилам ниже (epicRetreatHp)
    // 10.0.5 (игрок 13.10: «отход, если мы его не пробиваем или его бить нецелесообразно по времени — по отношению к фарму ФА»):
    // чемпион не пробивается (за 8 с < 3 %), бой выходит дольше его цены ×1,3 или HP героя < 30 % при живом чемпионе — выход «Назад на карту»
    // (тот же штатный выход, что у РБ: POST /game/battle/leave бой завершает); вердикт — до роста силы (champs.learn)
    if (ctx.champ && !ctx.rb && !ctx.chOut && env.champs && env.cfg.champLeave !== false) {
      const fl = env.champs.fleeCheck(ctx, me, mob, (Date.now() - t0) / 1000);
      const leave = fl && env.$q('#battle-back-map');
      if (fl && env.shown(leave)) {
        const quickActor = ctx.chQuestQuick ? env.battleExitContext?.() : null;
        ctx.chOut = true;
        const sec = (Date.now() - t0) / 1000, dealt = Math.max(0, (ctx.chHp0 || mob.max) - mob.cur);
        env.rec('B', 'чемпионы', `${ctx.name} (${ctx.lvl || '?'}, ${env.champs.tierRu(ctx.tier)}): ⚠ ${fl.why} — ухожу из боя, снято ${dealt} из ${mob.max} за ${sec.toFixed(0)} с; снова попробую, когда вырастет сила`);
        if (ctx.chQuestQuick) {
          const before = env.battleExitContext?.(), beforeUrl = location.pathname + location.search;
          const saved = await champQuickExitCommit(ctx, fl.kind, dealt, sec);
          if (!env.on || env.tabOwner === false || !env.isBattle() || before !== env.battleExitContext?.() || beforeUrl !== location.pathname + location.search) return;
          if (!saved) env.rec('B', 'чемпионы', 'Пауза после короткой пробы не подтверждена в памяти; штатный выход не задерживаю');
        }
        if (ctx.spawnId) env.leaveMark?.(ctx.spawnId, ctx.name);   // spawnId известен точно — иначе «вернуться в бой» не к кому
        env.fire(leave);
        const ended = await env.waitFor(() => !env.isBattle(), 8000, 150);
        if (ctx.chQuestQuick && (!env.on || env.tabOwner === false || quickActor !== env.battleExitContext?.())) return;
        if (ended) {
          if (!ctx.chQuestQuick || !ctx.chLearnDone) await env.champs.learn(ctx, fl.kind, dealt, sec);
          if (ctx.chQuestQuick && (!env.on || env.tabOwner === false || quickActor !== env.battleExitContext?.())) return;
          await env.setRt({ target: null, sinceDeep: 999 });
          return;
        }
        env.leaveMark?.(null);
        env.rec('B', 'чемпионы', `${ctx.name}: выход не подтверждён — бьюсь дальше`);
      }
    }
    return NEXT;
  }

  // шаг: проверки выхода — РБ (оценка, отход эпика, rbTryExit) или «не по зубам» / предел боя обычного моба
  async function exitCheckStep(me, mob) {
    if (ctx.rebirth) return NEXT; // У похода нет цены чемпиона/чип-рейда и общего предела обычного моба в 180 с.
    if (ctx.rb) {
      const ep = env.epicOn() && env.epicById(ctx.rb.id) && env.rt.epic?.k === env.epicById(ctx.rb.id).k && env.rt.epic?.step === 'fight';
      const v = me ? env.rbAssess(ctx, me, mob) : { retreat: false };
      // Выходим только штатной кнопкой, подтверждаем 2xx POST /game/battle/leave.
      // Для каждого эпика свой флаг непригодности выхода; глобальный epicLeaveBad больше не используется.
      if (ep && me && !ctx.rb.retreated && !((env.rt.epicDb?.[env.epicById(ctx.rb.id).k]?.leaveBadUntil || 0) > Date.now()) &&
          env.cfg.epicRetreatHp > 0 && (me.pct <= env.cfg.epicRetreatHp && !limitDiveFresh(ctx) && !epicFrenzyHold(ctx) || v.hopeless || v.lethal)) {
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
      const exit = await rbTryExit(ctx, me, mob, v, ep);
      if (exit === 'wait') return AGAIN;
      if (exit === 'done') return;
      if ((v.abort || v.retreat) && !ctx.rb.allIn) {
        ctx.rb.allIn = true;
        env.rec('B', 'РБ', `${ctx.name}: ${v.why} — ${ep ? 'выход не подтверждён, бой продолжается' : 'из боя уйти нельзя, бьюсь до конца на банках (резерв тоже)'}`);
        // 8.0 (аудит РБ: Госмос 21:33/22:38, Селян 23:19 получили «не по силам» посреди боя и потом были убиты): смертельный удар
        // сам по себе не приговор — его величина уже в базе (rbLearn), до боя проверку сделает rbPreCheck; приговор даёт смерть героя
        if (v.lethal) await env.rbNote(ctx.rb.id, { note: v.why });
      }
    } else {
      // v5.5.1: урон не пробивает (лог 08.10: после «Бонуса новачка» 1–3 урона за удар, моб 1044 HP) — за 15 с видно, что бой
      // не выиграть: прогноз > 90 с, а HP героя уходит. Уходим, вид моба — «не по зубам» на 2 ч, дальше — восстановление
      const nmNow = mobName().toLowerCase();
      // 9.2.4 (игрок 12.10: «чар убивает моба, он явно ему ПО СИЛАМ»; лог 07:2x — Guardian Basilisk «урон ≈4.6/с, убить ≈402 с»):
      // урон считался только по HP главного моба. Спойлер бьёт Wild Sweep по всем мобам боя (главный + «рядом») — урон расходится
      // по соседям, HP главного падает медленно, и вид получал «не по зубам». Теперь — весь урон боя (ctx.dealt, главный + соседи)
      // против HP всех живых мобов боя; и урон по строкам журнала (logDmg) — удар по мобу, чьё HP вверху не показано
      if (nmNow !== ctx.hp0N) { ctx.hp0N = nmNow; ctx.hp0 = mob.cur; ctx.hp0T = Date.now(); ctx.me0 = me?.cur; ctx.dealt0 = ctx.dealt || 0; ctx.logAt = env.logLines(); ctx.okN0 = env.actNet?.()?.okN || 0; }
      ctx.me0 ??= me?.cur;
      const left = mob.cur + extraMobs().reduce((a, x) => a + x.cur, 0);
      const el = (Date.now() - ctx.hp0T) / 1000, dmg = Math.max(ctx.hp0 - mob.cur, (ctx.dealt || 0) - (ctx.dealt0 || 0), logDmg(env.newLines(ctx.logAt || ctx.logStart || [], env.logLines()))), dps = el > 0 ? dmg / el : 0, ttk = dps > 0 ? left / dps : Infinity;
      const losing = me && ctx.me0 != null && me.cur < ctx.me0 && me.cur - (ctx.me0 - me.cur) / el * ttk < 0;   // HP кончится раньше моба
      // 10.0.8 (лог 13.10 17:17:41–57, Necropolis of Martyrdom): банка MP отвечала 8,4 с, после неё 6 нажатий не ушли на сервер («урон 0 · MP 0»,
      // ни одного POST /game/battle/action) — через 15 с Purgatory Gargoyle (3444 HP, такие бот убивает за 1 с) получил «не пробиваю — урон ≈0,0/с»
      // на 2 ч, а «Охотиться дальше» в подземелье подсовывал его снова и снова → 51 уход на страницу подземелья за 8 мин. Вердикт — только по
      // ударам, которые сервер принял (≥ 5 за это время) и без зависания сервера (ответ > 5 с) в окне замера; иначе это не «не по зубам», а лаг
      const N = env.actNet?.() || {}, okHits = (N.okN || 0) - (ctx.okN0 || 0), lagged = (N.slowT || 0) >= ctx.hp0T;
      const hopeless = el >= 15 && okHits >= 5 && !lagged && !ctx.questKill && !((env.rt.pveBlockUntil || 0) > Date.now() - 120000) && !env.antibotState() && (ttk > 180 || (ttk > 90 && losing));   // v5.5.8: в блоке фарма урон 0 — это не «не пробиваю»
      // 20.13 (ревизия 17.10, шаг 5, аудит combat/C2): у чемпиона свой предел боя (ctx.chLim, до ≈390 с) и свой отход (champs.fleeCheck выше).
      // Общий предел «бой дольше 3 мин» обрывал почти убитого чемпиона на 181-й секунде внутри его же лимита — теперь для чемпиона под
      // присмотром fleeCheck предел не короче chLim × 1,3 (тот же запас, что в fleeCheck); у обычного моба и при champLeave=false — прежние 180 с
      const capMs = ctx.champ && !ctx.rb && env.champs && env.cfg.champLeave !== false ? Math.max(180, (ctx.chLim || 0) * 1.3) * 1000 : 180000;
      if (hopeless || Date.now() - t0 > capMs) {
        if (!strengthReliable(strength, Date.now(), env.actNet?.() || {})) {
          env.rec('B', 'бой', `${mobName()}: бой затянулся без непрерывных принятых ходов — возвращаюсь на карту, силу моба не оцениваю`);
          await env.setRt({ target: null });
          return env.toMap();
        }
        const why = hopeless ? `урон ≈${dps.toFixed(1)}/с, моба убить ≈${isFinite(ttk) ? Math.round(ttk) + ' с' : 'никогда'}` : capMs > 180000 ? `бой дольше ${Math.round(capMs / 1000)} с` : 'бой дольше 3 мин';
        // 10.0.10 (лог 13.10 18:31:07, Elven Ruins): красный Tracker Skeleton 17 (29 880 HP, предел чемпиона 188 с) через 15 с получил общее «не пробиваю
        // (убить ≈134 с)» с меткой «этот вид 2 ч не бью» по ИМЕНИ — и обычные Tracker Skeleton 996 HP (цель ★ квеста рядом) бот дважды отказался бить.
        // У чемпиона свой предел (champs.fleeCheck/learn по цвету) — метка по имени вида не ставится, вердикт «долго» идёт в память чемпионов
        if (ctx.champ && !ctx.rb && env.champs) {
          ctx.chOut = true;
          const secC = (Date.now() - t0) / 1000, dealtC = Math.max(0, (ctx.chHp0 || mob.max) - mob.cur);
          env.rec('B', 'чемпионы', `${ctx.name} (${ctx.lvl || '?'}, ${env.champs.tierRu(ctx.tier)}): ⚠ ${why} — ухожу из боя, снято ${dealtC} из ${mob.max} за ${secC.toFixed(0)} с; снова попробую, когда вырастет сила`);
          await env.setRt({ target: null });
          await env.champs.learn(ctx, losing ? 'danger' : 'slow', dealtC, secC);
        } else {
        await env.setRt({ hardMobs: { ...(env.rt.hardMobs || {}), [nmNow]: { t: Date.now(), ttk: isFinite(ttk) ? Math.round(ttk) : 9999, lvl: env.heroLvl(), why } }, target: null });
        env.rec('B', 'цели', `${mobName()}: не пробиваю — ${why} → ухожу, этот вид 2 ч не бью`);
        await lowDmgNote();
        }
        // 10.0 (аудит боя): уход со страницы бой не завершает — моб бьёт дальше, баффер отвечает «Во время бою відновлення недоступне». Сначала выходим из боя.
        // 20.13 (ревизия 17.10, шаг 5, аудит combat/C2): штатный выход «Назад на карту» — всегда, а не только при HP < 60 %: без него серверный бой
        // продолжался, следующий клик по карте возвращал в тот же бой, и отсчёт «3 мин» начинался заново. Ждём конца боя, как ветка fleeCheck
        const leave = env.$q('#battle-back-map');
        if (leave) {
          env.fire(leave);
          if (!(await env.waitFor(() => !env.isBattle() || null, 8000, 150))) env.rec('B', 'бой', `${mobName()}: выход из боя не подтверждён — ухожу на карту`);
        }
        if (me && me.pct < 60) {
          if (await env.restoreVitals(`после неподъёмного моба HP ${me.pct | 0}%`)) return;
        }
        return env.toMap();
      }
    }
    return NEXT;
  }

  // шаг: сторож «нет ответа игры 20 с» — перезагрузка страницы боя
  async function stallStep(me, mob) {
    // сервер «завис»: удары уходят, а HP моба и журнал боя не меняются 20 с — обновить страницу боя
    // 9.0 (лог 12.10 01:08–01:31): HP героя от регена менялось и без боя — признак жизни теперь ответ сервера на ход, а не HP героя
    // (удар моба по герою и так виден в журнале боя)
    const sig = mob.cur + '|' + (env.actNet?.().done ?? me?.cur ?? '') + '|' + env.logLines().length + '|' + (env.logLines()[0] || '');
    if (sig !== progSig) { progSig = sig; progT = Date.now(); }
    else if (Date.now() - progT > 20000) {
      const pending = env.actNet?.();
      const waiting = pending && pending.start > pending.done;
      env.srvHangMark?.(waiting ? 'нет ответа игры 20 с' : 'бой не обновляется 20 с без отправленного хода', waiting ? 'network' : 'interface');   // 8.0.3: смерть сразу после — не «не по силам»
      if (await recoverRebirth()) return;
      if (reloadSlot()) {   // 7.1.30: не чаще 3 перезагрузок за 10 мин (общий счётчик)
        env.rec('B', 'бой', `${waiting ? 'нет ответа игры' : 'нет боевых действий'} 20 с (моб ${mob.cur}/${mob.max}) — обновляю страницу`);
        location.reload(); await env.sleep(8000); return;
      }
      progT = Date.now();
    }
    return NEXT;
  }

  // шаг: слуга — призыв, лечение, перепризыв
  async function petStep(me, mp) {
    // 7.1.16-fix: слуга мага. Призыв — только если сервер явно сказал «слуги нет» (activeSummon: null) не дольше 10 с назад,
    // лечение слуги — скиллом с целью PET при HP слуги ≤ petHealAt (50 %). Без скилла на панели — ничего
    if (summonCombat() && env.cfg.petAuto !== false) {
      // HP кота: из ответа сервера (activeSummon), иначе из шапки «Активний слуга» (#l2-hud-companion: «Mew the CatLv.1HP479/750MP320/320»).
      // Окно кота («Відкликати слугу») бот не открывает и не нажимает
      // по просьбе игрока: кот мёртв/не призван — призыв ПЕРВЫМ действием боя. В начале боя ждём до 1,5 с ответа сервера о слуге
      if (!ctx.petChecked) { ctx.petChecked = 1; await env.waitFor(() => { const q = env.petState?.(); return q && Date.now() - q.t < 10000 ? q : null; }, 1500, 100); }
      let P = env.petState?.(), fresh = P && Date.now() - P.t >= 0 && Date.now() - P.t < 10000;
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
      // 20.46 (John 22.10): голем разрешён и на фарме/в катах; остаются обычные условия petAuto/MP/готовности/перепризыва.
      // 20.81 (лог 29.10 20:39:28): свежая смерть после успешного призыва не должна ждать оставшиеся 8–15 с.
      // Ранний повтор — только по запросу, начатому после призыва, и готовому навыку: поздний старый GET не доказывает новую смерть.
      // Без причинной метки/HUD сохраняется прежний 15-секундный запас после последнего призыва.
      const summonT = Math.max(+env.rt.petSummonT || 0, +env.rt.petSummonOkT || 0), summonAge = Date.now() - summonT;
      const causal = fresh && Number.isFinite(P.requestStartedAt) && P.requestStartedAt > 0;
      const ordered = !causal || P.requestStartedAt > summonT && P.requestStartedAt <= P.t;
      const serverGone = fresh && ordered && causal && P.hud !== true && Number.isFinite(P.t) && P.t <= Date.now();
      if (fresh && !P.has && ordered && (ctx.block.petsummon || 0) <= Date.now() && (summonAge > 15000 || serverGone && summonAge >= 2000) && !env.crafterKit?.noSummon?.(raidTarget(ctx))) {
        const sums = [...document.querySelectorAll(env.SLOT)].filter(b => env.slotKind(b) === 'скилл' && servitorSummonSlot(b));   // 9.2: Feline Queen — бафф, не кот; 20.13 (C4): и не кубик
        const sb = (env.cfg.petSummon && slotsBy(env.cfg.petSummon)[0]) || petPick(sums, P.key);   // 8.0.3: не «первый на панели»
        if (sb && ready(sb) && (!mp || mp.cur >= (env.skillMp(env.cleanTitle(sb.title)) || 0) + 10 && affordable(sb, mp, 10))) {   // 20.12: и цена act()
          const needed = () => {
            if (env.cfg.petAuto === false || env.antibotState?.() || env.crafterKit?.noSummon?.(raidTarget(ctx)) || !ready(sb)) return false;
            const q = env.petState?.(), age = q ? Date.now() - q.t : Infinity;
            if (q && age >= 0 && age < 10000) {
              const stamp = q.requestStartedAt, known = Number.isFinite(stamp) && stamp > 0;
              if (known && (stamp <= summonT || stamp > q.t) || summonAge < 15000 && !known) return false;
              return q.has === false || q.has === true && q.hp <= 0;
            }
            if (!P.hud) return false;
            const box = env.$q('#l2-hud-companion'), text = box && env.shown(box) ? box.textContent.replace(/\s+/g, '') : '';
            const hp = text.match(/HP(\d+)\/(\d+)/i);
            return !!box && (!env.shown(box) || !!hp && +hp[1] === 0);
          };
          ctx.block.petsummon = Date.now() + 2000; // Потерянный клик не превращает один снимок отсутствия в непрерывный повтор.
          env.setRt({ petSummonT: Date.now() })?.catch?.(() => {});   // 20.41: таймеры призыва — без ожидания записи (память вкладки обновлена сразу)
          env.rec('B', 'питомец', `кота нет (умер или не призван) — призываю первым действием: ${env.cleanTitle(sb.title)}`);
          const sr = await act(sb, `Призыв слуги: ${env.cleanTitle(sb.title)}`, false, needed);
          if (sr === true) { if (ctx.pet) { ctx.pet.summons++; ctx.pet.key = petKeyOf(env.cleanTitle(sb.title).replace(/^summon\s+/i, '')); } env.rt.petSummonOkT = env.rt.petBornT = Date.now(); env.setRt({ petBornT: env.rt.petBornT, petSummonOkT: env.rt.petSummonOkT })?.catch?.(() => {}); }   // 7.1.31; 20.43: в памяти сразу
          // 7.2.2 (лог 10.10 23:18:59): клик призыва не ушёл в игру (сразу после включения зарядов) — раньше следующая попытка через 15 с,
          // и игрок призвал кота сам. Теперь повтор через ≈2 с; 8.0.3 (лог 11.10 10:00:45, 10:33:01): потерян в окне занятости игры ('lock') — сразу
          else { if (sr === 'lock') ctx.block.petsummon = 0; env.setRt({ petSummonT: sr === 'lock' ? 0 : Date.now() - 13000 })?.catch?.(() => {}); }   // 20.12: 'nomp' — повтор через ≈2 с, как непрошедший клик
          return AGAIN;
        }
      }
      // Независимые пороги: лечение при petHealAt, перепризыв только при petResummonAt.
      // 15.10: ручной перепризыв сохранил баффы и поднял HP 2898/7491 → 3805/6528; полного HP не предполагаем.
      const petPct = P && P.maxHp ? P.hp / P.maxHp * 100 : 100;
      const healAt = env.cfg.petHealAt ?? 50, summonAt = env.cfg.petResummonAt ?? 25;
      const re = env.rt.petResummon || {}, reOk = !!P?.key && re[P.key] !== false && env.cfg.petResummon !== false;
      if (fresh && P.has && P.maxHp && (petPct <= healAt || reOk && petPct <= summonAt) && (ctx.block['petheal'] || 0) <= Date.now()) {
        const slots = [...document.querySelectorAll(env.SLOT)].filter(b => env.slotKind(b) === 'скилл');
        const want = (P.key || '').replace(/_/g, ' ');
        const sb = (env.cfg.petSummon && slotsBy(env.cfg.petSummon)[0]) || slots.find(b => /^summon\b/i.test(env.cleanTitle(b.title)) && want && env.cleanTitle(b.title).toLowerCase().includes(want));
        const hb = slots.find(b => /^(?:servitor heal|heal servitor)/i.test(env.cleanTitle(b.title)) || (env.ilOf(b)?.target === 'PET' && env.ilOf(b)?.c === 'Лечение'));
        const mpOk = b => !mp || mp.cur >= (env.skillMp(env.cleanTitle(b.title)) || 0) + 10 && affordable(b, mp, 10);   // 20.12: и цена act()
        // 20.63 (лог 25.10 15:16–16:16, Feline King 17 618/25 370 HP): кот бьёт только на атакующий ход хозяина, а призыв, лечение и баффы
        // кота — ходы без его удара. Новый King приходит с ≈10 268 HP без баффов (призыв + 3 баффа = 4 хода), Servitor Heal даёт +1 200 HP
        // за ход, а перепризыв при 25 % заменял ещё живого кота (5 982/25 370 → 10 268/17 618, +4 286) и тут же требовал те же 3 баффа:
        // 46 перепризывов за час, в бою 16:12:01 — два подряд за 4 с (11 с на моба вместо ≈3). Теперь по замерам: перепризыв не раньше 60 с
        // после прошлого призыва и только если новый кот (rt.petSummonHp) даст ≥ 30 % макс. HP сверх текущего; лечение вне РБ — только
        // если оно за ход даёт не меньше HP, чем новый кот за свои ходы (призыв + баффы кота); иначе кот добивает, пока жив
        const now = Date.now(), sumHp = +env.rt.petSummonHp?.[P.key] || 0;
        const lastSum = Math.max(+env.rt.petSummonOkT || 0, +env.rt.petResummonT || 0);
        const nPB = env.names(env.cfg.nPetBuffs || '').filter(n => slotsBy(n).length).length;
        const HG = env.rt.petHealGain || [], healAvg = HG.length >= 3 ? HG.reduce((a, x) => a + x, 0) / HG.length : 0;
        const healWeak = !raidTarget(ctx) && sumHp > 0 && healAvg > 0 && healAvg < sumHp / (1 + nPB); // 20.81: РБ Rebirth тоже лечит кота, как обычный РБ.
        const reSoon = now - lastSum < PET_RESUMMON_GAP, reLow = sumHp > 0 && sumHp - P.hp < 0.3 * P.maxHp;
        if (healWeak && petPct <= healAt && hb && now - petHealSkipT > 1800000) { petHealSkipT = now;
          env.rec('B', 'питомец', `лечение слуги ≈+${Math.round(healAvg)} HP за ход меньше, чем новый кот (≈${sumHp} HP за ${1 + nPB} ход.) — вне РБ не лечу, кот бьёт, пока жив`); }
        const canHeal = petPct <= healAt && hb && ready(hb) && mpOk(hb) && !healWeak;
        const canSummon = petPct <= summonAt && reOk && sb && ready(sb) && mpOk(sb) && !env.crafterKit?.noSummon?.(raidTarget(ctx)) && !reSoon && !reLow;
        const useSummon = !!canSummon && (env.cfg.petHealPrefer === 'resummon' || !canHeal);
        const pick = useSummon ? sb : canHeal ? hb : null;
        if (pick) {
          ctx.block['petheal'] = Date.now() + 3000;
          const hp0 = P.hp, max0 = P.maxHp, t0 = Date.now(), name = env.cleanTitle(pick.title), key0 = P.key;
          const needed = () => {
            let q = env.petState?.();
            if (P.hud && (!q || Date.now() - q.t >= 10000)) {
              const box = env.$q('#l2-hud-companion'), tx = box && env.shown(box) ? box.textContent.replace(/\s+/g, '') : '';
              const m = tx.match(/HP(\d+)\/(\d+)/i);
              if (m) q = {t: Date.now(), has: +m[1] > 0, key: key0, hp: +m[1], maxHp: +m[2]};
            }
            if (env.antibotState?.() || !q || Date.now() - q.t >= 10000 || !q.has || q.hp <= 0 || !q.maxHp || q.key !== key0 || env.cfg.petAuto === false) return false;
            if (q.hp / q.maxHp * 100 > (useSummon ? (env.cfg.petResummonAt ?? 25) : (env.cfg.petHealAt ?? 50))) return false;
            return !useSummon || env.cfg.petResummon !== false && (env.rt.petResummon || {})[key0] !== false;
          };
          const pr = await act(pick, (useSummon ? 'Перепризыв' : 'Лечение') + ' слуги (' + hp0 + '/' + max0 + '): ' + name, false, needed);
          if (pr === 'lock') { ctx.block['petheal'] = 0; return AGAIN; }
          if (pr === 'nomp') { ctx.block['petheal'] = Date.now() + NOMP_MS; return AGAIN; }   // 20.12: не хватило MP — пауза, не повтор сразу
          if (pr !== true) return AGAIN; // Непринятое действие не даёт измерения лечения или запрета перепризыва.
          if (useSummon) { if (ctx.pet) ctx.pet.resummons++; env.rt.petResummonT = Date.now(); env.setRt({ petBornT: Date.now(), petResummonT: env.rt.petResummonT })?.catch?.(() => {}); }
          const P2 = await env.waitFor(() => { const q = env.petState?.(); return q && q.t > t0 && q.has && q.key === key0 && q.maxHp > 0 ? q : null; }, 2500, 150);
          if (!P2) ctx.block['petheal'] = Date.now() + 20000;
          if (P2) {
            const gain = P2.hp - hp0;
            if (useSummon) {
              // Один ранний снимок без роста HP не доказывает, что перепризыв больше никогда не лечит.
              if (gain > 0 && re[key0] == null) await env.setRt({ petResummon: { ...re, [key0]: true } });
              env.rt.petSummonHp = { ...(env.rt.petSummonHp || {}), [key0]: P2.hp }; rtSoon({ petSummonHp: env.rt.petSummonHp });   // 20.63: HP нового кота
              env.rec('B', 'питомец', 'перепризыв ' + name + ': HP слуги ' + hp0 + '/' + max0 + ' → ' + P2.hp + '/' + P2.maxHp + ' — ' + (gain > 0 ? 'наблюдаемый прирост +' + gain : 'прирост HP не подтверждён'));
            } else if (gain > 0) {
              const h = env.rt.petHealGain || [];
              await env.setRt({ petHealGain: [...h, gain].slice(-10) });
            }
          }
          return AGAIN;
        }
      }
    }
    return NEXT;
  }

  // шаг: лечение скиллом и вампиризм
  async function healStep(me, mp) {
    // v4.42: лечащий скилл (роль «Лечение») — раньше банки: бесплатно. Хватает MP — лечимся им
    // 7.2: у мага Vampiric Touch (≈665 урона + ≈266 HP) выгоднее лечащего хода (Corpse Life Drain 178 HP без урона мага, Heal ≈430):
    // вампирик готов и HP не критичное — лечащий скилл пропускаем, ниже сработает вампиризм
    // 10.0.5: и при низком HP — вампирик лечит больше лечащего скилла (раньше ниже стоп-HP + 10 % он был запрещён)
    const drainFirst = mageCombat() && me && !!drainPick(ctx, mp);
    // 9.0 «цена хода» (лог 11.10 01:40, Gigantic Chaos Golem: Corpse Life Drain +225 HP за ход, банка +600): на РБ, пока банка HP есть,
    // ход лечения отдаём банке — лечащий скилл только без банок
    const rbPotHas = !!ctx.rb && env.cfg.rbTurnPrice !== false && (() => { const p = env.hpPotPick(false); const q = p ? env.qty(p) : 0; return !!p && q !== 0 && (ctx.rb.allIn || me?.pct <= 35 || !hpReserveBlocked(p, env.cfg.rbPotReserve)); })();
    if (me && me.pct <= env.cfg.hpPotAt && !drainFirst && !rbPotHas) {
      const hs = healPick(ctx, mp);
      if (hs) { ctx.block['heal:' + hs.title] = Date.now() + 2500; const r = await act(hs, `Лечение скиллом (HP ${me.pct | 0}%): ${env.cleanTitle(hs.title)}`); if (r === 'lock') ctx.block['heal:' + hs.title] = 0; return AGAIN; }   // 8.0.3: 'lock' — повтор сразу
    }
    // v5.3: 🩸 вампиризм (Vampiric Claw, Drain Health, Life Leech, Steal Essence, Dark Vortex…): HP ≤ «вампиризм при» —
    // сначала скилл с поглощением HP (лечит и бьёт, банка не тратится); банка — если вампирик на откате, нет MP
    // или HP уже опасно низкое (≤ стоп-HP + 10 %)
    // 8.0 (аудит боя, лог 13-30: 18 из 105 банок на РБ выпиты при HP > 85 %): на РБ, пока включена «полоса банок», вампирик готов —
    // он раньше банки при любом HP (лечит почти столько же и бьёт ≈1400); банка — когда он на откате или HP опасно низкое
    // 10.0.5 (лог 13.10 10:51:57): нижняя граница «HP > стоп-HP + 10 %» снята — при HP 25–35 % вампирик не жался вовсе
    const drainB = me && me.pct <= (ctx.rb?.potOn ? 100 : env.cfg.drainHp ?? 85) ? drainPick(ctx, mp) : null;
    // 8.0.3 (лог 11.10 09:13–09:16: VT ушёл 4 раза из 60 решений, 17 банок сериями): блок 1,5 с — только по результату; клик, потерянный
    // в окне блокировки ('lock'), повторяется сразу (после окна), а не уступает банке
    if (drainB && (!ctx.rb || me.cur > Math.max(env.rt.rbDb?.[ctx.rb.id]?.sp || 0, ctx.rb.sp || 0) + 2*(env.rt.rbDb?.[ctx.rb.id]?.hitP90 || 0) || drainPreferred(ctx, me, drainB, Date.now() - lastHpPot > 1100 ? env.hpPotPick(false) : null))) { ctx.seq.push('💉'); const r = await act(drainB, `Вампиризм (HP ${me.pct | 0}%): ${env.cleanTitle(drainB.title)}`);  return AGAIN; }
    return NEXT;
  }

  // шаг: банка MP и «MP из HP»
  async function mpPotStep(me, mp) {
    // банка MP — когда маны мало для скиллов
    // на РБ (модель 50 000 боёв): банка MP при MP < 80 сокращает бой ≈в 2 раза (≈1,7 банки на РБ); резерв банок не трогаем
    const mpPot = env.mpPotSlot();
    const rbMpAt = ctx.rb && env.cfg.rbMpPots !== false && (mobHp()?.cur || 0) > 20000 && (env.qty(mpPot) == null || env.qty(mpPot) > (env.cfg.rbPotReserve || 0)) ? 80 : 0;
    // v4.42: порог MP — не меньше полутора самых дешёвых ударов роли «Силовые» (у мага ядерка 50–100 MP, а порог был 70 ед.)
    const hitMp = Math.min(...env.names(env.cfg.nPower).filter(n => slotsBy(n).length).map(n => env.skillMp(n)), Infinity);
    // 7.1.16-fix: у мага мана — весь урон. Порог 70 MP из 928 (лог 09.10: MP падал до 51–71, бой шёл рывками) — держим ≥ 25 % MP
    const mageMp = mageCombat() && mp?.max ? Math.round(mp.max * (env.cfg.mageMpPct ?? 25) / 100) : 0;
    // 20.13 (ревизия 17.10, шаг 5, defaults/D16): у воина (и любого профиля, кроме мага с котом) порог был max(70 MP, 1,5 удара) — Warlord с MP ≈1500 пил банку лишь у дна,
    // и связка Provoke + массовый удар пропускалась «MP мало». Теперь и воин держит ≥ fighterMpPct (25 %) MP; 0 — прежнее правило.
    // шаг 5 (defaults, ревью): на РБ доля воина не лезет в резерв банок MP (rbPotReserve) — как прежний порог rbMpAt; при allIn резерв не держим.
    const mpReserveHit = !!ctx.rb && !ctx.rb.allIn && env.qty(mpPot) != null && env.qty(mpPot) <= (env.cfg.rbPotReserve || 0);
    const fighterMp = !mageCombat() && !mpReserveHit && mp?.max ? Math.round(mp.max * Math.max(0, +(env.cfg.fighterMpPct ?? 25) || 0) / 100) : 0;
    const mpNeed = Math.max(env.cfg.mpPotAt, rbMpAt, mageMp, fighterMp, isFinite(hitMp) ? Math.round(hitMp * 1.5) : 0);
    const mpPulse = (() => { const p = env.rt.pots?.[env.cleanTitle(mpPot?.title || '').toLowerCase()]; return p && p.pulses > 1 ? Math.max(3000, p.pulses * (p.every || 1) * 1000) : 3000; })();   // 7.1.30: банка «пульсами» — не пить поверх ещё идущей
    if (mpPot && env.qty(mpPot) !== 0 && mp && mp.cur < mpNeed && Date.now() - lastMpPot > mpPulse && ready(mpPot)) {
      const prevMp = lastMpPot; lastMpPot = Date.now(); if (await act(mpPot, `Банка MP (MP ${mp.cur} < ${mpNeed})`) === 'lock') lastMpPot = prevMp; return AGAIN;   // 8.0.3: 'lock' — повтор сразу
    }
    const b2m = mp && mp.cur < mpNeed && me && me.pct > 60 ? [...document.querySelectorAll(env.SLOT)].find(b => env.ilOf(b)?.t === 'MANAHEAL' && !env.noEffect?.(b) && ready(b)) : null;   // 7.1.31: Body To Mind на L2WAP «в бою эффекта нет» — не жмём
    if (b2m) { await act(b2m, `MP из HP: ${env.cleanTitle(b2m.title)} (MP ${mp.cur})`); return AGAIN; }
    return NEXT;
  }

  // шаг: баффы кота
  async function petBuffStep(me, mp, mob) {
    // 7.1.31: баффы кота (роль «Баффы кота»)
    if (mageCombat() && env.cfg.petAuto !== false) {
      const pb = petBuffPick(ctx, me, mp, mob);
      if (pb) {
        ctx.block['petbuff:' + pb.n] = Date.now() + 5000;
        const r = await act(pb.b, `Бафф кота: ${env.cleanTitle(pb.b.title)}`, true);
        if (r === 'lock') ctx.block['petbuff:' + pb.n] = 0;   // 8.0.3: клик потерян в окне занятости игры — повтор сразу
        if (r === 'nomp') ctx.block['petbuff:' + pb.n] = Date.now() + NOMP_MS;   // 20.12: не хватило MP — пауза слота
        if (r === true) { env.setRt({ petBuffAt: { ...(env.rt.petBuffAt || {}), [pb.n]: Date.now() } })?.catch?.(() => {}); env.rec('B', 'питомец', `бафф кота: ${env.cleanTitle(pb.b.title)}`); }
        else if (r === 'unavail') { ctx.block['petbuff:' + pb.n] = Infinity; env.rec('B', 'питомец', `бафф кота «${env.cleanTitle(pb.b.title)}»: ${ctx.refuseText || noticeText() || 'недоступен'} — до конца боя не трогаю`); }
        return AGAIN;
      }
    }
    return NEXT;
  }

  // шаг: проверка баффов, спойл, тогглы, обычные баффы
  async function buffStep(me, mp, mob) {
    // баффы: по строке активных баффов (если она их показывает) или по таймеру
    if (Date.now() - (ctx.auditT || 0) > 15000) { ctx.auditT = Date.now(); try { await env.buffAuditStep(ctx, me); } catch (e) { console.warn(env.TAG, 'проверка баффов', e); } }
    let buffed = false;
    env.BUFF_CTX = ctx;
    if (await managedMonsterStep(ctx, act)) return AGAIN;
    if (!raidTarget(ctx) && await env.spoilStep(ctx, act, mob)) return AGAIN; // РБ похода не считается обычным мобом для спойла.
    if (await env.toggleStep(ctx, me, act)) return AGAIN;           // v5.3: постоянные баффы (тогглы) — вкл/выкл по MP
    const roar = battleRoarPlan(ctx, me, mp);
    if (roar) {
      const start = env.actNet?.().start || 0;
      const result = await act(roar.b, 'РБ: Battle Roar — увеличиваю Max HP в начале боя', false,
        () => battleRoarPlan(ctx, env.meHp(), env.meMp())?.b === roar.b);
      // 'lock' бывает и после отправленного хода без ответа: неизвестный исход не разрешает повтор.
      if ((env.actNet?.().start || 0) > start || !['lock','nomp'].includes(result)) ctx.roarPrepTried = true;
      return AGAIN;
    }
    for (const bn of env.buffList(ctx)) {
      const b = slotsBy(bn)[0];
      if (!ready(b) || env.noEffect?.(b) || (ctx.block['buff:' + bn] || 0) > Date.now()) continue;   // 7.1.31: «в бою эффекта нет» — не жмём
      if (env.ilOf(b)?.id === 121 && (ctx.roarPrepTried || battleRoarActive(b))) continue;
      const pcIL = env.ilOf(b)?.pc;                   // Frenzy/Zealot/Guts: только при HP ≤ 30 % — аварийные
      if (pcIL?.hp && (me?.pct ?? 100) > pcIL.hp) continue;
      if (!affordable(b, mp, 0)) continue;           // 20.12 (ревизия 17.10): MP ниже цены — act() откажет; не крутим цикл на этом баффе
      if (env.buffActive(bn, b)) {
        if (!env.rt.buffSeen?.[bn]) env.setRt({ buffSeen: { ...(env.rt.buffSeen || {}), [bn]: true } })?.catch?.(() => {});
        continue;
      }
      const since = Date.now() - (env.rt.buffAt?.[bn] || 0);
      const durIL = env.ilOf(b)?.dur;                 // длительность из справочника Interlude (тотем 120 с, Vampiric Rage 1200 с)
      if (since < (env.rt.buffSeen?.[bn] ? 3000 : (durIL ? Math.max(10, durIL - 3) : env.cfg.buffSec) * 1000)) continue;
      // v4.37: время баффа пишем только после того, как скилл сработал. Раньше писали ДО нажатия: сбой между записью
      // и нажатием (лог 01:02, weaponWt) — и бот 2 мин считал тотем наложенным, а его не было
      ctx.block['buff:' + bn] = Date.now() + 5000;        // пока идёт нажатие — повторно не берём
      // 9.2.3 (игрок 11.10: «на кастетах уже не играем, функция писалась ради Тирана с копьём»): смена оружия ради баффа убрана —
      // Тиран носит кастеты основным, остальным она только тратила клики в бою. Бафф, недоступный с этим оружием, — до конца боя не жмём
      let r = await act(b, `Бафф: ${b.title}`); buffed = true;
      if (r === true) { env.setRt({ buffAt: { ...(env.rt.buffAt || {}), [bn]: Date.now() } })?.catch?.(() => {}); ctx.block['buff:' + bn] = 0; }   // 20.41: без ожидания записи
      if (r === 'unavail') {                      // с этим оружием бафф не работает — до конца боя не трогаем
        ctx.block['buff:' + bn] = Infinity;
        env.rec('B', 'недоступно', `бафф «${b.title}»: ${ctx.refuseText || noticeText() || 'недоступен'}`);
        console.info(env.TAG, `бафф ${b.title}: недоступен (неподходящее оружие?) — до конца боя не используется`);
      } else if (r === 'cd') env.setRt({ buffAt: { ...(env.rt.buffAt || {}), [bn]: 0 } })?.catch?.(() => {});   // на КД — повторим, когда откатится (память КД)
      else if (r === 'lock') ctx.block['buff:' + bn] = 0;          // 8.0.3: клик потерян в окне занятости игры — повтор сразу, а не через 5 с
      else if (r === 'nomp') ctx.block['buff:' + bn] = Date.now() + NOMP_MS;   // 20.12: не хватило MP — пауза слота
      else if (!r) ctx.block['buff:' + bn] = Date.now() + 5000;   // не ушёл в КД — повтор не раньше чем через 5 с
      break;
    }
    if (buffed) return AGAIN;
    return NEXT;
  }

  // шаг: дебафф мага (удар — следующим шагом)
  async function debuffStep(me, mp, mob, tc) {
    // удар
    if (mageCombat()) {
      const dbf = debuffPlan(ctx, mp, me);
      if (dbf) {
        const before = env.logLines();
        const dr = await act(dbf.b, `Бой${tc}: дебафф ${dbf.n} · моб ${mob.pct | 0}%`, true);
        if (dr === 'lock') return AGAIN;   // 8.0.3: клик не дошёл до игры — без паузы 0,5 с и разбора журнала, повтор сразу
        if (dr === true) (ctx.debuffed ||= {})[dbf.k] = Date.now(); else if (dr !== 'lock') ctx.block['debuff:' + dbf.k] = Date.now() + (ctx.lastLost ? 700 : 3000);   // 7.1.30: не прошёл клик — короткая пауза, цель не считается «обработанной»
        ctx.seq.push('✦');
        // 10.0 (аудит боя): не фиксированные 0,5 с после каждого дебаффа — ждём строку результата в журнале (до 0,5 с), не прошёл клик — не ждём
        if (dr === true) await env.waitFor(() => /Ефект|Эффект|опір|опира|сопротивл|resist|не подіяв|не подействовал|імунітет|иммунитет/i.test(env.newLines(before, env.logLines()).join(' ')) ? 1 : null, 500, 40);
        const added = env.newLines(before, env.logLines()).join(' ⏎ ');
        const ok = /Ефект пройшов|Эффект прош[её]л/i.test(added), fail = /не пройшов|не прош[её]л|опір|опира|сопротивл|resist|не подіяв|не подействовал/i.test(added);   // 8.0.3: и «Ціль опирається ефекту» (34 строки 10.10, fail = 0)
        if (fail && !ok && ctx.debuffed) delete ctx.debuffed[dbf.k];   // 7.2.1: не прошёл — цель не под дебаффом (иначе замер выгоды врёт)
        // 7.2.1 (лог 10.10 21:32–21:39): «Raid Boss має імунітет до негативних ефектів» — 3 хода на каждый заход к РБ (и Surrender снова
        // каждые 15 с) впустую. Запоминаем: на этот вид целей дебаффы не вешаем (rt.debuffImmune.rb)
        // 20.43 (разбор 21.10): общий флаг .mob/.champ без срока выключал дебаффы на ВСЕХ мобах/чемпионах навсегда из-за одного вида
        // (особый моб катакомб или рядом с РБ). Теперь моб/чемпион — по виду цели на сутки (rt.debuffImmune.sp, потом одна проба);
        // «Raid Boss» прямо в тексте — РБ при любом ctx (и вид этой цели, чтобы в бою не вешать снова)
        if (/імунітет|иммунитет|immune/i.test(added)) {
          if (ctx.rebirth) {
            ctx.rebirthImmune = true;
            if (ctx.debuffed) delete ctx.debuffed[dbf.k];
            env.rec('B', 'Rebirth', `${ctx.name}: иммунитет к дебаффам в текущем бою — продолжаю ударами`);
            return AGAIN;
          }
          const line = (added.match(/[^⏎]*(?:імунітет|иммунитет|immune)[^⏎]*/i) || [''])[0].trim(), rb = ctx.rb || /raid\s*boss|рейд-?бос/i.test(line);
          if (ctx.debuffed) delete ctx.debuffed[dbf.k];
          const I0 = env.rt.debuffImmune || {}, { mob: _m, champ: _c, ...I } = I0, k = immKey(ctx), was = !ctx.rb && +I.sp?.[k] || 0, now = Date.now();   // старые общие флаги при записи не переносим
          if (rb && !I.rb) { I.rb = now; env.rec('B', 'дебафф', `рейд-боссы невосприимчивы к дебаффам («${line}») — больше не вешаю`); }
          if (!ctx.rb) {
            const sp = Object.fromEntries(Object.entries(I.sp || {}).filter(([, t]) => now - t < 7 * IMM_MS).sort((a, b) => b[1] - a[1]).slice(0, 59));
            sp[k] = now; I.sp = sp;
            env.rec('B', 'дебафф', `${ctx.name || 'цель'}${ctx.champ ? ' (чемпион)' : ''}: невосприимчив к дебаффам («${line}») — ${was && now - was >= IMM_MS ? 'проба после суток: всё ещё иммунитет, ' : ''}не вешаю на этот вид 24 ч, на остальных — как обычно`);
          }
          if (I.rb !== env.rt.debuffImmune?.rb || !ctx.rb || _m || _c) rtSoon({ debuffImmune: I });
          return AGAIN;
        }
        if (ok || fail) {
          const S = { ...(env.rt.debuffStat || {}) }, s = { ok: 0, fail: 0, ...(S[dbf.k] || {}) };
          if (ok) s.ok++; else s.fail++;
          if (s.ok + s.fail >= 6 && s.ok / (s.ok + s.fail) < 0.3) { s.offUntil = Date.now() + 3600000; s.ok = 0; s.fail = 0; env.rec('B', 'дебафф', `${dbf.n}: почти не проходит — выключаю на час`); }
          S[dbf.k] = s; rtSoon({ debuffStat: S });   // 20.41: статистика дебаффа — отложенно, удар не ждёт записи 1,3 МБ
        }
        return AGAIN;
      }
    }
    return NEXT;
  }

  // шаг: удар — выбор действия (chooseAction) и разбор ответа
  async function strikeStep(mp, mob, tc) {
    const a = chooseAction(ctx, mp);
    if (a) {
      const logBefore = new Set(env.logLines());
      const logArr = env.logLines();
      const done = await act(a.b, `Бой${tc}: ${a.name} · моб ${mob.pct | 0}%${a.why ? ' · ' + a.why : ''}`, true,
        () => { const fresh=chooseAction(ctx,env.meMp());return fresh?.b===a.b&&fresh.key===a.key&&fresh.warlordPull===a.warlordPull&&fresh.target===a.target; });
      if(actionContext()!==battleOwner)return;
      warlordPullResult(ctx, a, done);
      if(done==='lock'||done==='nomp')return AGAIN;
      if(a.key.startsWith('stun')&&done===true)ctx.lastStun=Date.now();
      if (a.damageProbe && done === true) { const k = env.skKey(a.b), counts = ctx.damageProbeActs ||= {}; counts[k] = (counts[k] || 0) + 1; }
      if (a.probe && done === true) aoeProbeNote(a.name);
      // замер нового заклинания — без других нажатий в окне (урон, MP, имя в логе). 20.43 (лог 21.10 15:47–15:51: 13 из 13 боёв Arcana
      // Lord в катакомбах — Flame Strike убивал с одного хода, и ещё 950 мс стояли после победы): бой окончен/моб мёртв — не ждём
      if ((a.probe || a.damageProbe) && done === true) await env.waitFor(() => victory() || defeat() || !(mobHp()?.cur > 0), 950, 30);
      ctx.seq.push(a.charge ? '⚡' : a.key === 'attack' ? 'А' : a.key.startsWith('stun') ? 'стан' : env.cleanTitle(a.b.title).split(' ').map(w => w[0]).join(''));
      if (a.charge || a.cost) {                     // энергия силы: по новым строкам лога, иначе свой учёт
        // 20.41: строка энергии обычно уже пришла с ответом хода — не ждём лишние 150 мс; без строки — те же 150 мс
        if (done !== 'noforce') await env.waitFor(() => env.newLines(logArr, env.logLines()).some(l => env.FORCE_CNT.test(l) || env.FORCE_SPEND.test(l)), 150, 30);
        if (done === 'noforce') { await env.forceSet(0, 0, `«${env.cleanTitle(a.b.title)}»: не хватает энергии`); ctx.block[a.key] = Date.now() + 1500; return AGAIN; }
        const added = env.newLines(logArr, env.logLines());
        const got = await env.forceFromLog(added);
        const skName = env.cleanTitle(a.b.title), skLine = added.find(l => l.toLowerCase().startsWith(env.logName(skName) + ':'));
        if (!got && a.cost && skLine && !env.FORCE_SPEND.test(skLine)) {   // удар прошёл без «−N енергії» — скилл энергию не тратит
          env.setRt({ forceFree: { ...(env.rt.forceFree || {}), [skName.toLowerCase()]: true } })?.catch?.(() => {});
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
        env.setRt({ forceFree: ff, forceNeed: { ...(env.rt.forceNeed || {}), [k]: need } })?.catch?.(() => {});
        env.rec('B', 'энергия', `«${env.cleanTitle(a.b.title)}» требует ${need} эн. — перевожу в удары за энергию`);
        ctx.block[a.key] = Date.now() + 15000; return AGAIN;
      }
      if (a.key.startsWith('stun') && env.logLines().some(l => !logBefore.has(l) && /не\s+ді[єе]|не\s+действ|immune|иммун/i.test(l))) {
        ctx.block[a.key] = Infinity;              // цель невосприимчива к стану — до конца боя не станим
        env.rec('B', 'стан не действует', `${ctx.name}: ${a.b.title}`);
      }
      if (done === 'unavail') {                   // с этим оружием скилл не работает — до конца боя не трогаем
        ctx.block[a.key] = Infinity;
        (ctx.weaponBlocked ||= []).push(a.key);
        await env.setRt({ unavailW: { ...(env.rt.unavailW || {}), [a.key]: { context: weaponContext(), t: Date.now() } } });
        if (a.key.startsWith('stun')) ctx.lastStun = 0;
        env.rec('B', 'недоступно', `«${a.b.title}»: ${ctx.refuseText || noticeText() || 'скилл недоступен'}`);
        console.info(env.TAG, `${a.b.title}: недоступен (неподходящее оружие?) — до конца боя не используется`);
      } else if (done === 'cd') {                 // «на перезарядке» — сразу другим скиллом/атакой (ready() учтёт память КД)
        if (a.key.startsWith('stun')) ctx.lastStun = 0;
      } else if (!done) {                            // слот не ушёл в КД — нет MP / отказ игры
        ctx.block[a.key] = Date.now() + (ctx.lastLost ? 700 : a.key === 'attack' ? 1000 : 3000);   // 10.0: потерянный клик — 0,7 с, не 3 с без лучшего заклинания
        if (a.key.startsWith('stun')) ctx.lastStun = 0;
        console.info(env.TAG, `${a.name} не сработал — пауза для слота`);
      }
      return AGAIN;
    }
    return NEXT;
  }

  // шаг: простой — причины ожидания навыков, атака мага/воина при простое, перезагрузка зависшего интерфейса
  async function idleStep(mp) {
    // 17.10.2026 (ночной журнал alt1: 20 долгих боёв воина без объяснения в журнале): причины ожидания пишем и для воина,
    // когда он 6 с ничего не нажал — иначе следующий разбор снова гадает, почему навыки не шли
    const fighterIdle = !mageCombat() && Date.now() - lastAct > 6000;
    if ((mageCombat() || fighterIdle) && Date.now() - (ctx.mageWaitNoteAt || 0) >= 4500) {
      const gcdMs = env.combatCooldown.globalWait();
      const waitSlots = mageCombat() ? mageSpellSlots()
        : [...env.names(env.cfg.nPower), ...env.names(env.cfg.nStun)].map(n => slotsBy(n)[0]).filter(b => b && !nonOffenseSkill(b));
      const reasons = waitSlots.map(b => {
        const name = env.cleanTitle(b.title), id = env.slotAction(b);
        const serverMs = id ? env.combatCooldown.skillWait(id, (env.cdSpawn || env.battleSpawn)()) : 0;
        const key = 'power:' + b.title;
        const blockMs = Math.max(0, (ctx.block[key] || 0) - Date.now());
        const localMs = localCdLeft(b) * 1000;
        const needMp = mp && !affordable(b, mp);
        const reason = weaponBarred(b) ? 'нужно ' + weaponNeed(b).join('/') : !uiReady(b) ? 'интерфейс' : gcdMs > 0 ? 'сервер GCD' : serverMs > 0 ? 'сервер навыка' : blockMs > 0 ? (blockMs > 1e12 ? 'недоступно до конца боя' : 'после неудачи') : localMs > 0 ? 'резервный таймер' : needMp ? `не хватает MP (${actionMp(b)})` : 'готов';
        return `${name}: ${reason}${reason === 'готов' || /MP|недоступно|нужно/.test(reason) ? '' : ` ${Math.ceil(Math.max(gcdMs, serverMs, Math.min(blockMs, 1e9), localMs))} мс`}`;
      });
      // 7.1.30: и атака — при MP ≈ 0 маг живёт атакой, а в журнале было видно только заклинания («все готовы», но бот стоит)
      const atkB = [...document.querySelectorAll(env.SLOT)].find(b => env.slotKind(b) === 'атака');
      if (atkB) reasons.push(`Атака: ${!uiReady(atkB) ? 'интерфейс' : (ctx.block.attack || 0) > Date.now() ? 'после неудачи' : localCdLeft(atkB) > 0 ? 'резервный таймер' : 'готов'}`);
      if (mp) reasons.push(`MP ${mp.cur}`);
      const rs = reasons.join(' · '), rsk = rs.replace(/\d+ мс/g, '').replace(/MP \d+/, '');
      ctx.mageWaitNoteAt = Date.now();
      if (reasons.length && (rsk !== ctx.mageWaitSig || Date.now() - (ctx.mageWaitLogT || 0) > 60000)) { ctx.mageWaitSig = rsk; ctx.mageWaitLogT = Date.now(); const waitText = (fighterIdle ? `воин ${Math.round((Date.now() - lastAct) / 1000)} с без действий · ` : '') + rs; env.rec('B', 'ожидание навыков', waitText);
        // 7.1.30: без спама; 17.10: причина видна и в «Обзоре» меню. 20.41 (лог 20.10 21:09, память 1,3 МБ: каждая запись — полный get+set
        // памяти в фоне): это только строка «Обзора» (меню показывает её 120 с), бой её не читает — отложенной записью до 8 с
        rtSoon({ combatWait: { t: Date.now(), text: waitText.slice(0, 200) } }); }
    }
    // 19.10 (20.22): воин тоже застывал с «интерфейс 0 мс» на 20–47 с до поражения.
    // Не обходим disabled/запрет игры кликом: если сервер не держит КД и нет запроса в полёте,
    // через6с без действий и прогресса перечитываем страницу. Лимит перезагрузок общий с остальными сторожами.
    const pending = env.actNet?.();
    if (Date.now() - lastAct > 6000 && env.combatCooldown.globalWait() <= 0 && !(pending && pending.start > pending.done)) {
      const atkB = [...document.querySelectorAll(env.SLOT)].find(b => env.slotKind(b) === 'атака');
      const act0 = atkB && env.slotAction(atkB), srvBusy = act0 && env.combatCooldown.skillWait(act0, (env.cdSpawn || env.battleSpawn)()) > 0;
      if (atkB && ready(atkB) && !srvBusy) { ctx.block.attack = 0; await act(atkB, `Атака (простой ${mageCombat() ? 'мага' : 'воина'})`); return AGAIN; }
      if (atkB && !uiReady(atkB) && !srvBusy && Date.now() - progT > 6000) {
        if (await recoverRebirth()) return;
        if (reloadSlot()) {
          if (!killOwnerValid(ctx)) return;
          env.srvHangMark?.('кнопки боя заняты без серверного отката', 'interface');
          env.rec('B', 'бой', `6 с без действий: кнопки заняты, серверный КД истёк — обновляю интерфейс боя`);
          location.reload(); await env.sleep(8000); return;
        }
      }
    }
    if (Date.now() - lastAct > 10000) {
      const atk = mageCombat() ? null : slotsBy(env.cfg.nAttack)[0];
      if (atk && ready(atk) && env.combatCooldown.globalWait() <= 0) { console.info(env.TAG, '10 с ничего не готово — принудительная атака'); await act(atk, 'Принудительная атака'); return AGAIN; }
    }
    return NEXT;
  }
}

// 20.13 (шаг 7): ответы шагов круга боя и признак «бой открыт» (см. battle)
const NEXT = Symbol('дальше'), AGAIN = Symbol('новый круг'), END = Symbol('итог боя'), BATTLE_OPEN = Symbol('бой открыт');

// После map → battle краткая сетевая метка остаётся в прежнем документе. Старый минимум HP вида
// (например, до Rebirth) сам по себе не доказывает чемпиона: сначала сверяем текущий собственный бой.
let hpProofWait = null;
async function hpChampionProof(name, urlSpawn, max, cameVia) {
  const char = env.rt.char, prof = env.rt.classCur?.prof, slot = env.rt.classCur?.slot, page = location.href;
  const title = mobTitle(), level = env.heroLvl?.() || env.rt.lvl || 0, mobLevel = +(title.match(/ур\.?\s*(\d+)/i)?.[1] || 0);
  const target = () => JSON.stringify([env.rt.target?.id, env.rt.target?.spawnId, env.rt.target?.name, !!env.rt.target?.champ, env.rt.target?.tier]);
  const target0 = target(), tier = () => cameVia === 'chain' ? '' : env.champTier?.(urlSpawn, null, '') || '';
  const owner = env.evidenceOwner?.(), exit = env.battleExitContext?.(), generation = env.actionGeneration?.();
  const meta = JSON.stringify(env.battleInfo?.() || null), key = JSON.stringify([char, prof, slot, owner, exit, generation, page, name, max, title, level, target0]);
  const current = (clearedTarget = false) => env.on && env.tabOwner === true && env.canAct?.() !== false && env.heroNick?.() === char
    && env.rt.char === char && env.rt.classCur?.prof === prof && env.rt.classCur?.slot === slot && location.href === page
    && env.evidenceOwner?.() === owner && env.battleExitContext?.() === exit && env.actionGeneration?.() === generation
    && !env.antibotState?.() && !env.pvpPending?.() && !victory() && !defeat()
    && (env.heroLvl?.() || env.rt.lvl || 0) === level && mobTitle() === title && !env.isChamp(mobTitle()) && !tier()
    && (target() === target0 || clearedTarget && !env.rt.target)
    && mobName().toLowerCase() === name && mobHp()?.max === max && JSON.stringify(env.battleInfo?.() || null) === meta;
  const wait = async () => {
    if (current()) { env.setStatus('Бой: тип цели по HP не подтверждён — жду серверную сверку'); await env.sleep(1000); }
    return null;
  };
  if (!current()) return null;
  if (hpProofWait?.key === key && (hpProofWait.busy || Date.now() < hpProofWait.until)) return wait();
  // 20.68 (разбор лога 27.10 12:45): один сбой собственного GET мог держать бой 60 с без повтора и причины в журнале.
  // Временные ошибки повторяем через 3/6/12 с; неполные данные по-прежнему не разрешают удар и ждут 15 с.
  const previous = hpProofWait?.key === key ? hpProofWait : null;
  const probe = hpProofWait = { key, until: Date.now() + 15000, busy: true, failures: previous?.failures || 0, notes: { ...previous?.notes } };
  const reject = async (code, reason, transient = false) => {
    // Старый ответ после нового поколения/цели не меняет ожидание и диагностику новой сверки.
    if (hpProofWait !== probe || !current()) return null;
    if (transient) { probe.failures = Math.min(3, probe.failures + 1); probe.until = Date.now() + 3000 * 2 ** (probe.failures - 1); }
    if (!(code in probe.notes) || Date.now() - probe.notes[code] >= 60000) {
      probe.notes[code] = Date.now();
      try { env.rec?.('B', 'сверка боя', `Тип цели по HP не подтверждён: ${reason} — повтор через ${Math.max(1, Math.ceil((probe.until - Date.now()) / 1000))} с`); }
      catch (_) { env.quietErr?.('диагностика сверки боя', new Error('Не удалось записать причину сверки боя')); }
    }
    return wait();
  };
  const http = r => Number.isInteger(r?.status) && r.status >= 100 && r.status <= 599 ? ' HTTP ' + r.status : '';
  let reading = 'памяти';
  const special = x => !!x && (['pvp', 'isPvp', 'inPvp', 'tvt', 'isTvt', 'inTvt'].some(k => x[k] === true)
    || ['battleMode', 'battleType', 'mode', 'kind', 'type'].some(k => /^(?:pvp|tvt)(?:_|-|:|$)/i.test(String(x[k] || ''))));
  const own = (c, min, id) => c?.name === char && (!id || c.id === id) && c.l2Profession === prof && c.classSlots?.activeSlot === slot && c.level === level
    && Number.isSafeInteger(c.revision) && c.revision >= min && c.inBattle === true && !special(c);
  try {
    if (!char || !prof || !Number.isInteger(slot) || slot < 0 || !(level > 0 && mobLevel > 0) || !owner || !exit || !Number.isFinite(generation)
        || typeof env.gameGet !== 'function') return reject('context', 'контекст героя или цели неполный');
    if (!await env.rtCommit?.()) return reject('storage', 'состояние не сохранено');
    if (!current()) return null;
    reading = 'персонажа';
    const first = await env.gameGet('/character', 4000);
    if (!current()) return null;
    if (!first.ok) return reject('http-character' + http(first), 'ответ персонажа' + http(first), true);
    const snapshot = await first.json();
    if (!current()) return null;
    const ch = snapshot?.character || snapshot, sid = ch?.battleSpawnId, id = ch?.id;
    if (snapshot?.error || snapshot?.ok === false) return reject('character-error', 'сервер не подтвердил состояние персонажа');
    if (special(snapshot) || !own(ch, 0) || typeof id !== 'string' || !id) return reject('character-identity', 'герой, класс, ревизия или активный PvE-бой не совпали');
    if (typeof sid !== 'string' || !/^[a-z0-9][a-z0-9_.:-]{0,199}$/i.test(sid)
        || /^(?:pvp|tvt)(?:_|-|:|$)/i.test(sid) || cameVia !== 'chain' && sid !== urlSpawn) return reject('character-spawn', 'текущая цель персонажа не подтверждена');
    reading = 'боя';
    const response = await env.gameGet('/game/battle?characterId=' + encodeURIComponent(id) + '&spawnId=' + encodeURIComponent(sid), 4000);
    if (!current()) return null;
    if (!response.ok) return reject('http-battle' + http(response), 'ответ боя' + http(response), true);
    const data = await response.json();
    if (!current()) return null;
    const c = data?.character, b = data?.battle;
    if (data?.error || data?.ok === false) return reject('battle-error', 'сервер не подтвердил состояние боя');
    if (!own(c, ch.revision, id) || c.battleSpawnId != null && c.battleSpawnId !== '' && c.battleSpawnId !== sid) return reject('battle-identity', 'снимок боя не подтвердил героя, ревизию или его цель');
    if (!b || b.spawnId !== sid || String(b.mobName || '').trim().toLowerCase() !== name || b.mobMaxHp !== max || b.mobLevel !== mobLevel
        || !Number.isFinite(b.mobHp) || b.mobHp <= 0 || b.mobHp > max) return reject('battle-target', 'цель, уровень или HP в снимке боя не совпали');
    if (b.ended === true || b.finished === true || data.victory || data.defeat || /^(?:ended|finished|victory|defeat)$/i.test(String(b.status || b.state || ''))
        || special(data) || special(b)) return reject('battle-state', 'живой PvE-бой не подтверждён');
    // 20.69 (лог 27.10 14:16): Rebirth Wyrm16740HP против старого минимума11160 — это dungeon, не новый чемпион.
    // Только точный обычный моб своего свежего Rebirth-боя; произвольные dungeon, champion/raid и неизвестный цвет не разрешаем.
    const rebirthMob = sid.match(/^rebirth_raid_[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}_[1-9]\d*_[1-9]\d*_[1-9]\d*_lv([1-9]\d*)_mob_[1-9]\d*$/i);
    const rebirthOrdinary = b.kind === 'dungeon' && !!rebirthMob && +rebirthMob[1] === b.mobLevel && /^rebirth\s*[·•]\s*\S/i.test(name)
      && Number.isSafeInteger(ch.rebirthStage) && ch.rebirthStage > 0 && c.rebirthStage === ch.rebirthStage && c.battleSpawnId === sid;
    const ordinary = /^(?:normal|passive|neutral|aggressive)$/.test(b.kind || '') || rebirthOrdinary;
    if (!ordinary && b.kind !== 'champion') return reject('battle-kind', 'серверный тип цели неизвестен');
    const raw = String(b.championTier || '').toLowerCase(), tier = ({ green: 'blue', yellow: 'orange' })[raw] || raw
      || (/^champ_o_/i.test(sid) ? 'orange' : /^champ_r_/i.test(sid) ? 'red' : '');
    const champ = b.kind === 'champion' || !!tier || /^champ_[or]_/i.test(sid);
    if (champ && !['blue', 'orange', 'red'].includes(tier)) return reject('champion-tier', 'цвет чемпиона неизвестен');
    if (hpProofWait !== probe) return null;
    probe.failures = 0; probe.until = 0;
    return { spawn: sid, tier, ordinary: ordinary && !champ, lvl: b.mobLevel, champ, current };
  } catch (_) { return reject('read-' + reading, 'ошибка чтения ' + reading, true); }
  finally { probe.busy = false; }
}

// 20.76+ (ревью ревизии 28.10): реген РБ между заходами — только по записи отхода этой же «жизни» РБ (raid.rbRetreatRec: время записи,
// моложе минимального респа, таймеры не видели его мёртвым после неё). Раньше бралась любая rt.rb[id]: на возродившемся РБ (бот не видел
// смерти/воскрешения или запись осталась от прошлой жизни) «реген = полный − старый hpAfter» учил rbDb.regen, а при attempts ≥ 2 ставил ложное
// «отхиливается быстрее» — вердикт «не по силам» до нового уровня. rate — HP/с для rbDb.regen, healed — сколько отхилился, no — вердикт
function rbRegenCheck(id, cur, now = Date.now()) {
  const prev = typeof env.rbRetreatRec === 'function' ? env.rbRetreatRec(id, now) || null : null;
  if (!prev || prev.hpAfter == null) return { prev, rate: undefined, healed: null, no: false };
  const dt = (now - prev.t) / 1000, healed = cur - prev.hpAfter;
  const rate = prev.hpAfter && cur >= prev.hpAfter && dt > 30 ? +(healed / dt).toFixed(2) : undefined;   // HP/с, 0 — не лечится
  const no = !env.ordinaryLiveTour?.(id) && prev.attempts >= 2 && prev.chip > 0 && healed >= prev.chip * 0.9 && !env.epicById?.(id);
  return { prev, rate, healed, no };
}
// 20.13 (шаг 7): начало боя — загрузка страницы, панель, слуга/банки на панели, проверки входа (РБ вне окна, цвета и предел чемпиона,
// «не по зубам», выше героя), ctx и заход к РБ/эпику. Ранний выход — значение для battle (как прежний return); иначе { [BATTLE_OPEN] }
async function battleOpen() {
  if (env.pvpPending?.()) return env.pvpRecoveryStep();
  env.setStatus('Бой: загрузка');
  const bUrl = location.pathname + location.search;   // v4.43: экран поражения — на странице боя; после смерти вернёмся сюда
  const openOwner = killOwner(), openEvidence = env.evidenceOwner?.(), openGeneration = env.actionGeneration?.(), openKick = env.rt.manualKickAt || 0, openPage = location.href, openRebirth = rebirthMode();
  if (env.rt.lastBattle !== bUrl) env.setRt({ lastBattle: bUrl });
  const st = await env.waitFor(() => env.serverDown() ? 'down' : victory() ? 'win' : defeat() ? 'dead' : loadErr() ? 'err' : mobHp() ? 'fight' : null, 10000, 50);   // 10.0: опрос 50 мс (было 250 — в среднем +125 мс на бой)
  if (!env.on || st === 'down') return;
  if (env.pvpPending?.()) return env.pvpRecoveryStep();
  if (!st) {                                     // не загрузилась — обновить (2 раза), потом на карту
    if (openRebirth) {
      const valid = () => killOwnerValid({killOwner:openOwner}) && env.evidenceOwner?.() === openEvidence && env.actionGeneration?.() === openGeneration && (env.rt.manualKickAt || 0) === openKick
        && location.href === openPage && rebirthMode() && env.isBattle() && !env.pvpPending?.() && !env.antibotState?.();
      if (valid()) { if (typeof env.rebirthRecover === 'function') await env.rebirthRecover(valid); else await env.sleep(300); }
      return;
    }
    const n = (env.rt.battleReload || 0) + 1;
    await env.setRt({ battleReload: n });
    env.rec('B', 'бой', `страница боя не загрузилась за 10 с — ${n <= 2 ? `обновляю (${n}/2)` : 'ухожу на карту'}`);
    if (n <= 2) { location.reload(); await env.sleep(8000); return; }
    await env.setRt({ battleReload: 0 }); return battleReturn();
  }
  if (env.rt.battleReload) await env.setRt({ battleReload: 0 });
  if (st === 'dead') { const char = env.rt.char, owner=killOwner(); if(!rebirthMode())await env.noteRaidMobKills?.(new URLSearchParams(location.search).get('spawnId')||''); if(!killOwnerValid({killOwner:owner}))return; await env.finishFarmQuota?.(null, true, resultKills(true)); if (env.on && env.tabOwner && env.rt.char === char && env.canAct?.() !== false) return env.onDeath(); return; }
  if (st === 'err') {                            // 10.0.7 (лог 13.10 13:21: «Возврат на карту» из боя в подземелье без причины в журнале): текст ошибки игры — в журнал
    const txt = (env.$q('#battle-load-err')?.textContent || '').replace(/\s+/g, ' ').trim();
    if (Date.now() - (env.rt.battleErrNoteT || 0) > 60000) { env.rec('B', 'бой', `бой не открылся: «${txt.slice(0, 120) || 'без текста'}»${/spawnId=sdms_/i.test(location.search) ? ' — назад в подземелье' : ' — на карту'}`); env.setRt({ battleErrNoteT: Date.now() }); }
    return battleReturn();
  }
  await hotbarRows3();                           // все 3 ряда панели открыты — там могут быть нужные скиллы и банки
  if (st === 'win') { const owner=killOwner(); if(!rebirthMode())await env.noteRaidMobKills?.(new URLSearchParams(location.search).get('spawnId')||''); if(!killOwnerValid({killOwner:owner}))return; if (await env.finishFarmQuota?.(null,false,resultKills(false))) return; return env.nextFight(); } // открыт уже экран победы
  const clickedAt = env.rt.mobClickAt, cameVia = env.rt.via;   // v5.6: запомнить ДО сброса — по ним видно, открыл ли бой бот/игрок или цепочка
  // бой открылся — счётчик петли сброшен. 8.0: без ожидания; 20.43 (лог 21.10 15:47–15:51): отложенной записью — полная запись
  // памяти ≈960 КБ в начале каждого боя катакомб стояла в очереди фона перед записями победы
  if (env.rt.bounce || env.rt.mobClickAt) rtSoon({ bounce: 0, mobClickAt: 0 });

  // панель: инвентаризация (в журнал — при изменении) и автоназначение ролей
  const inv = env.panelInventory(), invSig = inv.map(x => x.idx + ':' + x.name).join('|');
  if (invSig !== env.rt.panelSig) {
    // 20.41 (лог 20.10 21:09: от ответа battle/start до первого удара 4,9 с — подряд ждались 7 полных записей памяти 1,3 МБ):
    // опись панели — сведения для меню; память вкладки обновлена сразу, запись идёт в фоне и не держит первый удар
    env.setRt({ panel: inv, panelSig: invSig })?.catch?.(() => {});
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
  else if (hf != null) env.setRt({ force: { ...(env.rt.force || {}), hud: hf, t: Date.now() } });
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
  if (rebirthMode()) {
    const name = mobName(), max = mobHp()?.max, page = location.href, owner = killOwner();
    const valid = () => killOwnerValid({ killOwner: owner }) && rebirthMode() && location.href === page
      && mobTitle() === title && mobHp()?.max === max && !env.pvpPending?.() && !env.antibotState?.();
    const proof = await env.rebirthBattleProof?.({ name, max, title, valid });
    if (!proof || !valid() || !proof.current?.()) return;
    const blockW = weaponBlocks(), mob0 = mobHp();
    const ctx = { lastStun: 0, block: blockW, weaponContext: weaponContext(), weaponBlocked: Object.keys(blockW), killed: [], seq: [],
      max, logStart: env.logLines(), champ: false, name, killOwner: owner, questKill: false, goalsAt: 0,
      lvl: proof.lvl, spawnId: proof.spawn, rebirth: proof, hp0: mob0?.cur || 0, hp0T: Date.now(), hp0N: name.toLowerCase(), okN0: env.actNet?.()?.okN || 0 };
    if (summonCombat()) { ctx.pet = { hits: 0, hitDmg: 0, crits: 0, misses: 0, dmg: 0, acts: 0, deaths: 0, summons: 0, resummons: 0, key: '', name: '', alive: false }; ctx.petLines = ctx.logStart; }
    env.setStatus(`Rebirth: ${proof.role === 'raid' ? 'РБ похода' : proof.role === 'champion' ? 'чемпион похода' : 'моб похода'} — бой подтверждён`);
    return { [BATTLE_OPEN]: true, ctx, spawnId: proof.spawn, manualRb: false };
  }
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
  let color = battleColor(nm, spawnId, mob0?.max, cameVia, t, same);
  const hpChamp = !!known && !!mob0 && mob0.max >= known * env.cfg.champHpMult;
  if (!isRb && hpChamp && !color.ordinary && !color.champ && !color.tier && !(same && (t.champ || t.tier)) && !env.isChamp(title)) {
    color = await hpChampionProof(nm, spawnId, mob0.max, cameVia);
    if (!color || !color.current()) return;
  }
  const blockW = weaponBlocks();
  const ctx = { lastStun: 0, block: blockW, weaponContext: weaponContext(), weaponBlocked: Object.keys(blockW), killed: [], seq: [], max: mob0?.max || 0, logStart: env.logLines(), champ: !color.ordinary && (color.champ || (same && t.champ) || env.isChamp(title) || hpChamp),
                name: mobName(), killOwner:killOwner(),
                questKill: (same && !!t.quest) || env.isQuestName(nm), goalsAt: env.goalLines() };
  if (color.current) ctx.hpProofCurrent = color.current;
  if (summonCombat()) { ctx.pet = { hits: 0, hitDmg: 0, crits: 0, misses: 0, dmg: 0, acts: 0, deaths: 0, summons: 0, resummons: 0, key: '', name: '', alive: false }; ctx.petLines = ctx.logStart; }   // замер слуги, включая пантеру воина
  // 20.41: минимальное HP вида пишем только при новом минимуме (раньше — полная запись памяти на каждом бою, ≈0,5 с при 1,3 МБ)
  if (nm && mob0 && !(same && t.champ) && !(known <= mob0.max))
    env.setRt({ hpMin: { ...(env.rt.hpMin || {}), [nm]: Math.min(known || Infinity, mob0.max) } });
  if (ctx.champ) console.log(env.TAG, 'чемпион:', title, hpChamp ? `(по HP ${mob0.max} vs ${known})` : '');
  // 10.0.5 (FA с чемпионов): цвет чемпиона и уровень моба — для учёта выпавших Fast Aden (loot.faNote)
  // (в цепочке «Охотиться дальше» spawnId в адресе — от первого боя: верим ему, только если имя в кэше спавнов совпало)
  const spOk = !!spawnId && (env.rt.spawns?.[spawnId]?.[0] || '').toLowerCase() === nm;
  ctx.lvl = rbLvl || color.lvl || (spOk && cameVia !== 'chain' ? env.rt.spawns[spawnId][1] : 0) || 0;
  ctx.spawnId = color.spawn;
  if (ctx.champ) ctx.tier = color.tier;
  // 10.0.12: выбор цветов — жёсткий запрет игрока, действует и на квест/кампанию, и после первого удара слуги.
  if (ctx.champ && !isRb) {
    // 20.54 (лог John 02:56:49, Hatu Weird Bee 30): игрок начал бой с синим чемпионом руками (dense_*, цвет из карты потерян при смене
    // страницы), снял 18 %, нажал ▶ — бот ушёл «цвет неизвестен — на карту». Неизвестный цвет в уже начатом бою — не повод бросать бой;
    // запрещённый известный цвет и нетронутый бой — как раньше. Опасность бою оценивает отход (champs.fleeCheck)
    const unknownStarted = !env.champs?.TIER_RU?.[({ green: 'blue', yellow: 'orange' })[String(ctx.tier || '').toLowerCase()] || String(ctx.tier || '').toLowerCase()]
      && mob0?.max > 0 && mob0.cur < mob0.max * 0.98;
    const off = !unknownStarted && env.champs?.tierOff?.(ctx, true);
    if (off) { env.rec('B', 'чемпионы', `${ctx.name}${ctx.lvl ? ` (${ctx.lvl})` : ''}: ${off} — на карту`); await env.setRt({ target: null }); if (ctx.hpProofCurrent && !ctx.hpProofCurrent(true)) return; return env.toMap(); }
  }
  // 10.0.5: чемпион — предел боя (его цена в секундах обычного фарма, mobfarm → champs.judge) и HP на входе — для отхода (champs.fleeCheck)
  if (ctx.champ) { ctx.lvl = ctx.lvl || (same && t.lvl) || 0; ctx.chHp0 = mob0?.cur || mob0?.max || 0; ctx.heroLvl0 = env.heroLvl() || env.rt.lvl || 0;   // 10.0.10: уровень героя на входе — для вердикта (champs.learn)
    ctx.chLim = (same && t.lim) || env.champs?.limitS({ tier: ctx.tier, lvl: ctx.lvl, exp: 0 }) || 40; }
  const chapterChamp = ctx.champ && env.campActive() && env.campChampOpen() && ctx.lvl >= (env.campChampMin?.() || 0);
  const quickQuest = (ctx.questKill || chapterChamp) && ctx.lvl > 0 && (env.heroLvl() || env.rt.lvl || 0) - ctx.lvl >= 20;
  if (ctx.champ && !isRb && (env.champs?.valueMode?.(ctx) || quickQuest)) {
    // Экономический допуск с карты не переносим на следующего одноимённого моба цепочки.
    const fresh = same && ['map', 'dungeon'].includes(cameVia) && Date.now() - (t.valueT || 0) < 60000;
    const j = env.champs.judge({ ...ctx, hp: mob0?.max || 0, exp: fresh ? t.exp : 0, fa: fresh ? t.fa : undefined }, ctx.questKill || chapterChamp);
    if (!j.ok) { env.rec('B', 'чемпионы', `${ctx.name}: ${j.why} — на карту`); await env.setRt({ target: null }); return env.toMap(); }
    ctx.chLim = j.lim; ctx.chQuestQuick = !!j.questQuick;
  }
  // v5.5.1: «Охотиться дальше» сам подсовывает моба — если этот вид уже «не по зубам» (урон ≈0), не бьём его (лог 08.10 16:31–16:38:
  // после конца «Бонуса новачка» урон упал до 1–3, бот 3 раза подряд заходил к Tracker Skeleton Leader и погиб)
  // 9.2.2: исключения «не по зубам» — как в mobfarm.candidates (★ квест и чемпион главы; источник ресурса — нет)
  { const hd = !isRb && !ctx.questKill && !(ctx.champ && env.campActive() && env.campChampOpen()) && env.rt.hardMobs?.[nm]; if (hd && Date.now() - hd.t < 7200000 && mob0 && mob0.cur >= mob0.max * 0.98 && !extraMobs().some(x => x.cur > 0)) {
    env.rec('B', 'цели', `${ctx.name}: «не по зубам» (${hd.why || 'долгий бой'}) — не бью, на карту`); await env.setRt({ target: null }); return env.toMap(); } }
  // 10.0.7 (игрок 13.10 03:16: «бот пытается бить моба больше чем на 5 лвл старше» — Warlock 67 против Tomb Guard 75): цепочка «Охотиться
  // дальше» подсовывает моба без выбора по карте — выше героя на > lvlAbove (по умолчанию +5) не бьём, идём на карту. Исключения — как в
  // mobfarm.candidates: ★ квест, источник ресурса, чемпион главы; РБ — свои пределы. Только нетронутый бой (HP ≥ 98 %, соседей нет)
  // 20.61 (лог 25.10 09:11, John «на спойле не хочет бить бастион, хотя может справиться»): в Ashen Bastion все мобы 85 ур., место
  // выбрал игрок, ashenStep уже отобрал моба по окну lvlMin/lvlMax — предел +5 там не действует (иначе бой → список → тот же бой по кругу)
  { const hl = env.heroLvl() || env.rt.lvl || 0, up = env.cfg.lvlAbove ?? 5, lv = rbLvl || ctx.lvl || 0, farmT = !!nm && (env.farmRules?.() || []).some(x => x.farm && x.name === nm);
    const ashen = ctx.ashen = /^ashen_bastion_mob_/i.test(String(spawnId || '')) || /^ashen_bastion_mob_/i.test(String(ctx.spawnId || ''));
    if (!isRb && !ashen && hl && lv && up < 99 && lv > hl + up && !ctx.questKill && !farmT && !(ctx.champ && env.campActive() && env.campChampOpen())
        && mob0 && mob0.cur >= mob0.max * 0.98 && !extraMobs().some(x => x.cur > 0)) {
      env.rec('B', 'цели', `${ctx.name} (${lv} ур.): выше героя на ${lv - hl} (предел +${up}) — не бью, на карту`); await env.setRt({ target: null }); return env.toMap(); } }
  // 15.10: слабого случайного моба цепочки добиваем, даже без FA; нижний порог остаётся при выборе с карты.
  // 10.0.10 (игрок 13.10 11:33): «Охотиться дальше» подсовывает чемпиона цвета, который выключен в «Каких чемпионов бить» (или герой ниже
  // порога уровня), — нетронутый бой не начинаем, на карту. ★ квест и чемпион главы — бьём
  if (ctx.champ && !isRb && !ctx.questKill && !(env.campActive() && env.campChampOpen()) && mob0 && mob0.cur >= mob0.max * 0.98 && !extraMobs().some(x => x.cur > 0)) {
    const hl = env.heroLvl() || env.rt.lvl || 0;
    // 20.60 (лог 24.10 20:46: West с HP 29 % сразу шёл к следующему чемпиону): цепочка тоже не начинает чемпиона с полупустым HP
    const off = env.champs?.tierOff?.(ctx) || env.champs?.held?.(ctx)   // и вердикт прошлого отхода («жду роста силы»)
      || (!(ctx.lvl > 0 && hl - ctx.lvl >= 20) && env.champs?.hpLow?.(env.meHp?.()));
    if (off) { env.rec('B', 'чемпионы', `${ctx.name}${ctx.lvl ? ` (${ctx.lvl})` : ''}: ${off} — на карту`); await env.setRt({ target: null }); return env.toMap(); }
  }
  ctx.hp0 = mob0?.cur || 0; ctx.hp0T = Date.now(); ctx.hp0N = nm; ctx.okN0 = env.actNet?.()?.okN || 0;   // 10.0.8: принятые ходы на старте замера «не по зубам»
  if (isRb) {
    ctx.champ = false;                                      // «Оглушення не діє на РБ» (лог 07.10) — стан по РБ не используем
    ctx.rb = { id: spawnId || nm, start: mob0.cur, samples: [], note: 'оценка…' };
    if (env.epicOn() && env.epicById(ctx.rb.id) && env.rt.epic?.k === env.epicById(ctx.rb.id).k && mob0?.max) {   // 🐉 заход к эпику: сохранилось ли его HP после смерти
      const L = env.rt.epic.hpLog || [], last = L[L.length - 1];
      const reset = !!last && last.cur < last.max * 0.95 && mob0.cur >= mob0.max * 0.99;
      await env.setRt({ epic: { ...env.rt.epic, startHp: mob0.cur, resetN: reset ? (env.rt.epic.resetN || 0) + 1 : 0 } });
      // 8.0.3 (эпики): сохраняется ли HP эпика между заходами — замер на повторном входе: восстановилось полностью → нет; через ≥60 с
      // у него не больше, чем было + 2 % → да. Без подтверждения после смерти бот ждёт следующего появления (epicStep)
      const ek = env.epicById(ctx.rb.id).k, keep = !reset && last?.max && last.cur != null && last.cur < last.max * 0.99 && Date.now() - (last.t || 0) >= 60000 && mob0.cur <= last.cur + mob0.max * 0.02;
      if (reset || keep) await env.epicDbSet(ek, { persist: !!keep, persistT: Date.now() });
      env.rec('B', 'эпики', `${ctx.name}: заход ${(env.rt.epic.deaths || 0) + 1} · у него ${Math.round(mob0.cur / mob0.max * 1000) / 10} % (${env.fmtK(mob0.cur)}/${env.fmtK(mob0.max)})${reset ? ' — HP восстановилось полностью!' : keep ? ' — HP с прошлого захода сохранилось' : ''}`);
    }
    // 7.2.1 (лог 10.10 21:32: у Короля Тарлка сохранились цифры окна карты другого РБ — HP 273k при настоящих 920k): HP из окна карты
    // не совпадает с HP в бою больше чем на 10 % — цифры чужие, стираем (по ним оценивались и другие РБ)
    { const st0 = env.rt.rbStats?.[ctx.rb.id];
      if (st0?.hp && mob0.max && Math.abs(st0.hp - mob0.max) > mob0.max * 0.1) {
        const S = { ...env.rt.rbStats }; delete S[ctx.rb.id];
        await env.setRt({ rbStats: S });
        env.rec('B', 'РБ', `${nm}: в памяти были чужие цифры (HP ${env.fmtK(st0.hp)} вместо ${env.fmtK(mob0.max)}) — стёр, оценю заново`);
      } }
    // HP РБ сохраняется между заходами: «Моб ще поранений: HP 143526 / 148507» (через 13 мин — ровно столько же)
    const RG = rbRegenCheck(ctx.rb.id, mob0.cur), dbR = env.rt.rbDb?.[ctx.rb.id] || {};
    const wounded = env.logLines().some(l => /(?:Моб ще поранений|Моб ещё ранен|still wounded)/i.test(l)) || mob0.cur < mob0.max;
    let regen = RG.rate ?? dbR.regen;
    ctx.rb.persist = !!(dbR.persist || wounded) && !(regen > 0 && mob0.cur >= mob0.max);   // ранен при входе ⇒ HP хранится
    ctx.rb.regen = regen;
    // 20.41: статистика РБ (сохраняется ли HP, число заходов) — без ожидания записи перед первым ударом; rbNote меняет память вкладки сразу
    if (ctx.rb.persist || regen != null) env.rbNote(ctx.rb.id, { persist: ctx.rb.persist, regen: regen ?? dbR.regen })?.catch?.(() => {});
    if (ctx.rb.persist) env.rec('B', 'РБ', `${nm}: HP сохранилось с прошлого захода ${mob0.cur}/${mob0.max}${regen != null ? ` · восстановление ${regen} HP/с` : ''}`);
    env.rbNote(ctx.rb.id, { name: ctx.name, lvl: rbLvl, tries: (env.rt.rbDb?.[ctx.rb.id]?.tries || 0) + 1 })?.catch?.(() => {});
    const prev = RG.prev;
    if (prev?.hpAfter != null) {
      const regen = RG.healed;                              // сколько РБ отхилился, пока мы отдыхали
      console.log(env.TAG, `РБ ${ctx.name}: был ${prev.hpAfter}, сейчас ${mob0.cur} (реген ${regen}), прошлый заход снял ${prev.chip}`);
      if (RG.no) {   // эпик: решает epicStep
        await env.rbNote(ctx.rb.id, { verdict: 'no', note: `отхиливается быстрее (реген ${regen} ≥ снимаем ${prev.chip})` });
        await env.setRt({ rbCur: null, target: null });
        env.setStatus(`РБ ${ctx.name}: ❌ отхиливается быстрее, чем мы бьём — в базу «не по силам»`);
        return env.toOutskirts();
      }
    }
  }
  return { [BATTLE_OPEN]: true, ctx, spawnId, manualRb };
}

// 20.13 (шаг 7): итог боя после круга — победа подтверждена сервером, награды, ДПС, РБ/кампания/квест, следующий бой
async function battleWin(ctx, t0, spawnId, strength, countExtras) {
  if (!env.on || !env.tabOwner) return;

  // победа: «+N аден, +N EXP, +N SP»
  // 14.10, расширенный аудит: нулевое HP — ещё не победа. Сервер может задержать итог, переключить цель или прислать поражение.
  const result = await env.waitFor(() => defeat() ? 'dead' : victory() ? 'win' : null, 3000, 40);
  if (!env.on || !env.tabOwner) return;
  if (env.pvpPending?.()) return env.pvpRecoveryStep();
  if (result === 'dead') return battleDeath(ctx,countExtras);
  if (result !== 'win') {
    env.rec('B', 'бой', `${ctx.name}: итог боя не подтверждён — сверяю состояние на карте, убийство и добычу не засчитываю`);
    return battleReturn(ctx);
  }
  if (!ctx.rb && !ctx.rebirth) try { env.catPrefetch?.(4000); } catch (e) {}   // 20.41: список подземелья для следующего моба — параллельно с учётом победы
  try { await env.sweepStep(ctx); } catch (e) { console.info(env.TAG, 'свип', e); }   // v5.3: ⛏ собрать спойл
  if (env.pvpPending?.()) return env.pvpRecoveryStep();
  await countExtras(true);
  if(!killOwnerValid(ctx))return;
  if (env.pvpPending?.()) return env.pvpRecoveryStep();
  env.trySnap(300);                                   // экран победы (в т.ч. с квестовой строкой) — новый снимок, если структура новая
  const loot = env.$q('#battle-victory-lootline')?.textContent || '';
  const rewardLines = freshBattleLines(ctx.logStart || [], env.logLines());
  const rewards = battleRewards(rewardLines, loot, ctx.extraCredited);
  if (!ctx.rebirth) env.champs?.observe?.(ctx);
  if (ctx.max) {                                  // расчёт ДПС: время до убийства и урон в секунду
    const ttk = (Date.now() - t0) / 1000;
    // 7.2.2 (лог 10.10 22:38: «Орк Тимак Госмос: 576831 HP за 32 с · ДПС 18026» — у РБ оставалось 87 359 HP с прошлого захода):
    // у раненого РБ снято не полное HP, а то, что было на входе
    const base = ctx.rb && ctx.hp0 > 0 ? Math.min(ctx.max, ctx.hp0) : ctx.champ && ctx.chHp0 > 0 ? Math.min(ctx.max,ctx.chHp0) : ctx.max;
    const measured = env.fightDamage?.(ctx.name, ctx.spawnId || spawnId, t0);
    const dealt = Math.max(base, (ctx.dealt || 0) + (victory() ? ctx.mobLast || 0 : 0), measured?.removed || 0);   // победа — главный добит (соседи живы — их остаток не наш)
    const dps = Math.round(base / Math.max(ttk, 0.5)), totalDps = Math.round(dealt / Math.max(ttk, 0.5)), ttkOne = ctx.max / Math.max(ctx.ashen ? Math.max(dps, totalDps) : dps, 1);   // время на одного такого моба
    // 20.61: в Ashen Bastion мобы 85 ур. толстые и стоят пачкой — бьём массовыми, «долго на одного» считаем по урону по всем, иначе вид на 2 ч выпадает
    if (!ctx.rebirth) env.champs?.noteDamage?.(ctx,base,ttk)?.catch?.(e=>console.warn(env.TAG,'состав боя',e));
    const d = env.rt.dps?.singleTarget ? env.rt.dps : { n: 0 }, k = d.n < 20 ? 1 / (d.n + 1) : 0.05;
    // 8.0 (аудит боя/ядра: 6–8 записей подряд по ≈0,1 с перед «Охотиться дальше», −0,6 с на моба): учёт после победы — без ожидания
    // записи; память вкладки обновлена сразу, очередь сохраняет порядок, при уходе со страницы недописанное уходит по pagehide
    env.setRt({ dps: { singleTarget: true, all: totalDps, allPartial: !!measured?.unknownSides, n: d.n + 1, dps: Math.round((d.dps || dps) * (1 - k) + dps * k), ttk: +((d.ttk || ttk) * (1 - k) + ttk * k).toFixed(1), last: dps, lastTtk: +ttk.toFixed(1) } });
    env.rec('B', 'итог боя', `${ctx.name}${ctx.champ ? ' [чемп]' : ''}: ${base < ctx.max ? `${base} из ${ctx.max}` : ctx.max} HP за ${ttk.toFixed(1)} с · ДПС ${dps}${dealt > ctx.max * 1.05 ? ` (урон по всем мобам ${dealt}, ДПС ${totalDps})` : ''}${measured?.unknownSides ? ' · HP части соседей неизвестны' : ''} · ${ctx.seq.join('→')}`);
    if (ctx.tot) await env.totemNote(ctx, dps);
    // 10.0.5: чемпион — свой учёт (champs.learn: ДПС, итог по цвету, вердикт снимается); метка «не по зубам» по имени вида закрыла бы
    // и обычных мобов того же вида (красный Kookaburra ≈145 тыс. HP → обычные Kookaburra 3,4 тыс. HP на 2 ч не цели)
    if (ctx.champ && !ctx.rb) env.champs?.learn(ctx, victory() ? 'win' : 'left', base, ttk)?.catch?.(e => console.warn(env.TAG, 'чемпионы', e));
    else if (!ctx.rebirth && !ctx.rb && ttkOne > 45 && strengthReliable(strength, Date.now(), env.actNet?.() || {})) {                  // обычный моб дольше 45 с (на одного, без соседей) — не по зубам, 2 часа не выбираем
      await env.setRt({ hardMobs: { ...(env.rt.hardMobs || {}), [ctx.name.toLowerCase()]: { t: Date.now(), ttk: +ttkOne.toFixed(0), lvl: env.heroLvl() } } });
      env.rec('B', 'цели', `${ctx.name}: ≈${ttkOne.toFixed(0)} с на моба — слишком долго, 2 часа не выбираю`);
      await lowDmgNote();
    }
  }
  debuffGainFlush(ctx).catch(e => console.warn(env.TAG, 'выгода дебаффов', e));   // 7.2.1
  try { warlordSkipNote(ctx); } catch (e) { env.quietErr?.('агро Warlord', e); }   // 20.13 (шаг 7, combat/C6); 20.43 (разбор 21.10): ошибка — в журнал
  if (ctx.pet) { try { petTick(ctx); petFlush(ctx, Math.max(ctx.max || 0, (ctx.dealt || 0) + (victory() ? ctx.mobLast || 0 : 0))).catch(e => console.warn(env.TAG, 'статистика кота', e)); } catch (e) { console.warn(env.TAG, 'статистика кота', e); } }   // 7.1.31
  const pick = re => { const m = loot.match(re); return m ? parseInt(m[1].replace(/\D/g, ''), 10) || 0 : 0; };
  env.trackEfficiency(rewards.exp + (ctx.extraCredited?.exp || 0), ctx)?.catch?.(e => console.warn(env.TAG, 'эффективность', e));
  env.trackLoot(rewardLines, ctx.name, ctx.rb ? null : { champ: !!ctx.champ, tier: ctx.tier || '', lvl: ctx.lvl || 0 })?.catch?.(e => console.warn(env.TAG, 'добыча', e));
  try { env.cancelNote?.(ctx.cancelLines || [], ctx.name, { champ: !!ctx.champ, tier: ctx.tier || '', dungeon: (location.search || '').match(/[?&]spawnId=sdms_([^&]+)_\d+(?:&|$)/)?.[1] || '' }); } catch (e) { console.warn(env.TAG, 'снятие баффов', e); }   // 10.0.7: «[моб] зняв з вас N бафи»
  env.setRt({
    kills: env.rt.kills + 1, sinceDeep: env.rt.sinceDeep + (ctx.rebirth ? 0 : 1), target: null,
    adena: env.rt.adena + rewards.adena, exp: env.rt.exp + rewards.exp, sp: env.rt.sp + rewards.sp
  });

  if (ctx.rb && env.campRbOpen().some(t => env.nameLike(t.name, ctx.name))) {   // РБ главы убит — отметить и сверить главу
    const C = env.rt.campaign;
    await env.setRt({ campaign: { ...C, targets: C.targets.map(t => t.rb && env.nameLike(t.name, ctx.name) ? { ...t, done: t.total || 1, ok: true } : t), live: Date.now() }, campaignDue: true, campRbSeen: '' });
    env.rec('B', 'РБ главы', `${ctx.name} убит — цель главы выполнена, сверяю главу`);
  }
  if (ctx.rb) {
    const rb = { ...(env.rt.rb || {}) }; delete rb[ctx.rb.id];
    // 20.41 (лог 20.10 21:09: после победы над РБ 4 записи памяти 1,3 МБ подряд, 2–4 с): одна точка ожидания — вердикт rbNote ниже
    // (очередь FIFO дописывает и эту запись, и учёт серии/раны); память вкладки обновлена сразу
    env.setRt({ rb, rbCur: null, sinceRb: 999, rbKills: (env.rt.rbKills || 0) + 1, ...(env.rt.rbList?.[ctx.rb.id] ? { rbList: { ...env.rt.rbList, [ctx.rb.id]: { ...env.rt.rbList[ctx.rb.id], alive: false } } } : {}) });   // v5.6: убит — в списке «мёртв»
    env.rbTimerKill?.(ctx.rb.id, ctx.name, ctx.rb.lvl || env.rt.rbList?.[ctx.rb.id]?.lvl || 0)?.catch?.(() => {});   // 10.0.2: таймеры боссов — время смерти точно
    // Actual per-boss rewards and fight duration: economic RB tour uses these
    // in preference to guesses from other bosses. Do not overwrite with zero
    // when the victory screen has no readable reward line.
    const d0 = env.rt.rbDb?.[ctx.rb.id] || {}, kills = (d0.kills || 0) + 1;
    const adena = pick(/([\d\s.,]+)\s*аден/i), exp = pick(/([\d\s.,]+)\s*EXP/i);
    // 8.0: РБ был ранен (HP с прошлого захода) — время пересчитываем на полный бой (Госмос: 33 с за 87k из 577k записывались как полный)
    const fightS = (Date.now() - t0) / 1000 * (ctx.hp0 > 0 && ctx.max > ctx.hp0 ? Math.min(20, ctx.max / ctx.hp0) : 1);
    const avg = (old, next) => old > 0 ? Math.round(old * .6 + next * .4) : next;
    const rc = env.warlock?.raidContext?.(ctx.rb.id, env.rt.rbStats?.[ctx.rb.id] || {});
    const fightContext = rc?.managed && !ctx.rb.contextMixed && ctx.rb.contextKey === rc.key && rc.key ? rc.key : null;
    const oldFight = !rc?.managed || (fightContext && d0.fightContext === fightContext) ? d0.fightS : 0;
    await env.rbNote(ctx.rb.id, { verdict: 'ok', kills,
      ...(rc?.managed ? { fightContext } : {}),
      ...(adena > 0 ? { adenaPerKill: avg(d0.adenaPerKill, adena) } : {}),
      ...(exp > 0 ? { expPerKill: avg(d0.expPerKill, exp) } : {}),
      fightS: oldFight > 0 ? Math.round(oldFight * .6 + fightS * .4) : Math.round(fightS),
      heroMaxHp: env.meHp()?.max || d0.heroMaxHp || 0,
      note: `убит за ${env.fmtT(fightS)}` });
    console.log(env.TAG, `РБ ${ctx.name} убит за ${env.fmtT((Date.now() - t0) / 1000)}`);
    // 10.0.6 (игрок 13.10: «кнопочка — что выпало в результате серии РБ»): награда и вещи этого РБ — в «📦 Серию РБ» (rt.rbRun)
    try { env.rbRun?.kill({ id: ctx.rb.id, name: ctx.name, lvl: ctx.rb.lvl || env.rt.rbList?.[ctx.rb.id]?.lvl || ctx.lvl || 0, adena, exp, sp: pick(/([\d\s.,]+)\s*SP/i), lines: env.newLines(ctx.logStart || [], env.logLines()), epic: !!env.epicById?.(ctx.rb.id), fightS })?.catch?.(e => console.warn(env.TAG, 'серия РБ', e)); } catch (e) { console.warn(env.TAG, 'серия РБ', e); }
    if (env.rt.rbWound?.[ctx.rb.id]) { const W = { ...env.rt.rbWound }; delete W[ctx.rb.id]; env.setRt({ rbWound: W }); }   // 7.2.2; 20.41: без ожидания
  }
  if (!ctx.rebirth && env.cfg.campaign) {
    // условия главы: строки «★ Квест · <цель> N / M · осталось K» в логе боя → модель целей
    const r = await env.applyQuestLog([ctx.name, ...ctx.killed], ctx.champ);
    if (r.changes.length) env.rec('B', 'квест', r.changes.join(' · '));
    const goalNew = env.goalLines() > ctx.goalsAt;   // новая строка «Цель выполнена!» (старые в логе не считаются)
    const allDone = env.campActive() && !env.campOpen().length;
    if (r.closed.length) env.setStatus(`✓ Цель главы выполнена: ${r.closed.join(', ')}`);
    env.setRt({ sinceCamp: (env.rt.sinceCamp || 0) + 1,
                  campaignDue: env.rt.campaignDue || allDone || goalNew || r.verify || (env.rt.sinceCamp || 0) + 1 >= env.cfg.campaignEvery })?.catch?.(() => {});   // 20.41: следующий шаг читает память вкладки
    if (allDone) env.setStatus('Все цели главы выполнены — иду сдавать главу');
  }
  // квест: прогресс с экрана победы («26 / 35 · осталось 9»), частота дропа, прогноз боёв
  const qDone = ctx.rebirth ? null : await env.trackQuest(ctx.name, ctx.questKill);
  if (qDone && env.cfg.questStop) return env.halt(`Квест выполнен: ${qDone}`);
  { const qT = await ctx.quotaTicket(); if (qT && await env.finishFarmQuota?.(qT, false, 1 + ctx.killed.length)) return; }
  await env.nextFight(ctx);
}

function potModel() {                           // v4.40: все банки HP с панели (резерв не трогаем): запас лечения и скорость питья
  if (!env.cfg.rbUsePots) return null;
  let items = hpPotStock().map(x => ({ ...x, n: Math.max(0, env.potBag(x.b) ?? 0) })).filter(x => x.n > 0);
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
          /зілля\s*(?:зцілення|лікування|hp)|зелье\s*(?:исцеления|лечения|hp)|healing potion|greater healing|^#920044$/i.test(name))
        .map(([name, qty]) => {
          const historical = Object.values(env.rt.pots || {}).find(p => p.kind === 'hp' && (p.name || '').toLowerCase() === name.toLowerCase());
          return { name, heal: historical?.pulse || Math.min(historical?.heal || (/велик|больш|greater|^#920044$/i.test(name) ? 2500 : 600), /велик|больш|greater|^#920044$/i.test(name) ? 2500 : 600),
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
 return { rbRegenCheck, limitDiveFresh, epicFrenzyOn, epicFrenzyHold, epicFrenzyFloor, armMonsterRequest, monsterRequestToken, noteMonsterSnapshot, managedMonsterPlan, managedMonsterStep, limitPlan, managedToggleClass, managedToggleStep, noteToggleSnapshot, noteToggleBattle, battleRoarActive, battleRoarPlan, aoeProbe: { note: aoeProbeNote, capped: aoeProbeCapped }, warlordSkipNote, summonCombat, actionMp, affordable, healPick, healSlot, combatWeapon, combatWeaponLive, weaponContext, weaponBlocks, cancelCollect, warlordPullPlan, warlordPullResult, champQuickExitCommit, rbTryExit, probeExitCommit, strengthSample, strengthReliable, logDmg, groupPlan, battleRewards, freshBattleLines, lostUntil, pressAt, petPick, petMul, spellSample, debuffGain, debuffGainFlush, dbfOn, petHits, petExpect, petAdvice, petFlush, petBuffPick, mageSpellSlots, magePlan, debuffPlan, dbfImmune, immKey, IMM_MS, potSlotRestore, mobHp, extraMobs, noticeText, mobTitle, mobName, victory, defeat, loadErr, slotsBy, cdBusy, uiReady, ready, cdLeft, rememberCd, dpsPlan, ultPick, frenzyDive, hpReserveBlocked, rbTurnHeal, drainBackoff, drainPreferred, drainPick, chooseAction, hotbarRows3, battle, potModel, learnWeaponBarred };
 };
})(globalThis);
