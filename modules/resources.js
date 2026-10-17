/* L2wap v7: isolated resources feature module. Dependencies are injected lazily.
   All game actions remain under the central lease and dispatcher in content.js. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.resources = function create_resources(env) {
function bar(curSel, maxSel) {
  const c = env.numOf(curSel), m = env.numOf(maxSel);
  return c == null || !m ? null : { cur: c, max: m, pct: 100 * c / m };
}

const meHp = () => bar('#l2-hud-hp-cur', '#l2-hud-hp-max');

const meMp = () => bar('#l2-hud-mp-cur', '#l2-hud-mp-max');

async function potWatch(b) {                     // после глотка 4,5 с собираем строки лечения из журнала
  const context = () => JSON.stringify([env.rt.char, env.rt.classCur]);
  const captured = context();
  const key = env.potKey(b), name = env.potName(b), t0 = Date.now(), before = env.logLines();
  if (!key) return;
  env.POT_LAST = t0;
  let sum = 0, pulses = 0, pulse = 0, every = 0, kind = /мани|маны|mana|\bmp\b/i.test(name) ? 'mp' : 'hp';
  while (Date.now() - t0 < 4500 && env.isBattle() && env.POT_LAST === t0) {
    await env.sleep(300);
    if (context() !== captured) return;
    for (const l of env.newLines(before, env.logLines())) {
      let m = l.match(/(?:імпульсами по|импульсами по|by)\s*(\d+)\s*(HP|MP)\s*(?:кожні|каждые|every)\s*(\d+)/i);
      if (m && l.toLowerCase().includes(key.split(' (')[0].slice(0, 8))) { pulse = +m[1]; kind = m[2].toLowerCase(); every = +m[3]; }
      m = l.match(/(?:Зілля|Зелье|Potion)\s*\+\s*(\d+)\s*(HP|MP)/i);
      if (m && m[2].toLowerCase() === kind) { sum += +m[1]; pulses++; }
    }
    before.length = 0; before.push(...env.logLines());
  }
  if (context() !== captured) return;
  const heal = Math.max(sum, pulse);
  if (!heal) return;
  const P = env.rt.pots?.[key] || {};
  const H = P.heal ? Math.round(P.heal * 0.7 + heal * 0.3) : heal;
  await env.setRt({ pots: { ...(env.rt.pots || {}), [key]: { ...P, name, kind, heal: H, pulse: pulse || P.pulse, every: every || P.every, pulses, n: env.potBag(b) ?? P.n, uses: (P.uses || 0) + 1, t: Date.now() } } });
  if (!P.heal || Math.abs(P.heal - heal) > heal * 0.2) env.rec('B', 'зелья', `${name}: лечит ${heal} ${kind.toUpperCase()}${pulses > 1 ? ` (${pulses} × ${pulse || Math.round(heal / pulses)})` : ''}${every ? `, импульс раз в ${every} с` : ''} · в сумке ${env.potBag(b) ?? '?'}`);
}

function potInventory() {                        // банки на панели → база (тип, сколько в сумке); вызывается в начале боя
  const P = { ...(env.rt.pots || {}) }; let ch = false;
  for (const b of document.querySelectorAll(env.SLOT)) {
    if (env.slotKind(b) !== 'предмет' || !/зілля|зелье|potion|elixir|еліксир|эликсир/i.test(b.title || '')) continue;
    const k = env.potKey(b), n = env.potBag(b);
    if (!k) continue;
    const kind = /мани|маны|mana|\bmp\b/i.test(k) ? 'mp' : 'hp';
    if (!P[k] || P[k].n !== n) { P[k] = { name: env.potName(b), kind, ...(P[k] || {}), n, t: Date.now() }; ch = true; }
  }
  // Legacy potion timers (from Interlude reuse) must never survive an upgrade.
  const cd = { ...(env.rt.cdUntil || {}) }, skills = { ...(env.rt.skills || {}) };
  let cdChanged = false;
  for (const b of document.querySelectorAll(env.SLOT)) if (env.slotKind(b) === 'предмет' &&
      /зілля|зелье|potion|elixir|еліксир|эликсир/i.test(b.title || '')) {
    const k = env.skKey(b);
    if (k && (cd[k] || skills[k]?.cdFloor || skills[k]?.cd || skills[k]?.cdNet)) {
      delete cd[k]; cdChanged = true;
      if (skills[k]) skills[k] = { ...skills[k], cdFloor: 0, cd: 0, cdNet: 0 };
    }
  }
  if (ch || cdChanged) env.setRt({ ...(ch ? { pots: P } : {}), ...(cdChanged ? { cdUntil: cd, skills } : {}) });
}

function hpPots() {
  const own = env.slotsBy(env.cfg.nHpPot || '').filter(b => !/ман|mana|\bmp\b/i.test(b.title || ''));   // 7.2.1: банку маны как лечебную не пьём
  const auto = [...document.querySelectorAll(env.SLOT)].filter(b => env.slotKind(b) === 'предмет' && env.HP_POT_RE.test(b.title || '') && !/ман|mana|\bmp\b/i.test(b.title || ''));
  return [...new Set([...own, ...auto])].filter(b => env.qty(b) !== 0).map(b => {
    const P = env.rt.pots?.[env.potKey(b)], p = env.rt.skills?.[env.skKey(b)] || {};
    return { b, key: env.potKey(b), name: env.potName(b),
      heal: P?.pulse || Math.min(P?.heal || p.heal || (/велик|greater/i.test(b.title) ? 2500 : 600), /велик|greater/i.test(b.title) ? 2500 : 600),
      est: !(P?.pulse || P?.heal), cd: 0, ready: env.ready(b) }; // Для банок действует только серверный GCD
  });
}

function hpPotByDeficit(deficit) {               // v4.46: недостача ≥1500 — самая сильная, иначе самая слабая (меньше перелива)
  const L = hpPots().filter(x => x.ready).sort((a, b) => a.heal - b.heal);
  return (deficit >= 1500 ? L[L.length - 1] : L.find(x => x.heal <= deficit * 1.2) || L[0])?.b || null;
}

function hpPotPick(urgent) {                     // аварийно — самая сильная; обычно — самая слабая (их больше и они дешевле)
  const L = hpPots().filter(x => x.ready).sort((a, b) => a.heal - b.heal);
  return (urgent ? L[L.length - 1] : L[0])?.b || null;
}

function mpPotSlot() {
  return env.slotsBy(`${env.cfg.nMpPot || ''}, Велике зілля MP, Велике зілля мани`).find(b => env.qty(b) !== 0) || null;
}

function longFightMp(ctx, mp, hp) {
  if (!mp?.max || !hp) return null;
  const atkD = env.expDmg('атака');
  if (!ctx.rb && hp < atkD * 12) return null;    // обычный моб — решает скорость, не мана
  const potB = mpPotSlot(), potN = env.qty(potB);
  if (ctx.rb && env.cfg.rbMpPots !== false && potB && (potN == null || potN > (env.cfg.rbPotReserve || 0))) return { pots: true };
  const chMp = env.skillMp(env.names(env.cfg.nCharge)[0] || 'focused force') || 5;
  const cdOf = n => env.rt.skills?.[n]?.cd || env.rt.skillDb?.[n]?.cd || (env.ilOf(n)?.reuse || 12000) / 1000;
  const all = [...env.names(env.cfg.nPower).map(n => ({ n, mp: env.skillMp(n), dmg: env.expDmg(n) })),
               ...env.forceCosts().map(c => ({ n: c.name.toLowerCase(), mp: env.skillMp(c.name) + c.cost * chMp, dmg: env.expDmg(c.name) }))]
    .filter(x => env.slotsBy(x.n).length && x.dmg > 0 && x.mp > 0 && !env.isChargeName(x.n));
  if (!all.length) return null;
  all.forEach(x => { x.cd = cdOf(x.n); x.eff = x.dmg / x.mp; });
  const best = Math.max(...all.map(x => x.eff));
  const cheap = all.filter(x => x.eff >= best * 0.85);
  const atkCd = cdOf('атака') || 4;
  const dps = atkD / Math.max(1, atkCd) + cheap.reduce((a, x) => a + x.dmg / x.cd, 0);
  const Tr = hp / Math.max(1, dps);                // оценка оставшегося боя, с
  const free = mp.cur + env.MP_REGEN * Tr - cheap.reduce((a, x) => a + x.mp / x.cd, 0) * Tr;
  return { cheap: new Set(cheap.map(x => x.n)), free, capSoon: mp.cur + env.MP_REGEN * 6 >= mp.max, costOf: n => all.find(x => x.n === n)?.mp || env.skillMp(n), Tr };
}

// 20.13 (ревизия 17.10, шаг 7, services/CQ-1): удалён rest() — простой до HP без предела по времени нигде не вызывался

// 7.2.1 (лог 10.10 21:07–21:08): оружие сменилось C → B (Sprite's Staff), бот купил 3000 B-зарядов, а на панели остались C-заряды
// (то же имя «Благословенний заряд духу», ×3886) — игра их не включает, бот жал слот каждые 5 с впустую; игрок переставил руками.
// Грейд слота: «#3950 — …» в подписи или цвет иконки (white NG, blue D, green C, red B, silver A, gold S — снимок 10.10: C green, B red)
const SHOT_ID_G = { 3947: 'NG', 3948: 'D', 3949: 'C', 3950: 'B', 3951: 'A', 3952: 'S', 2509: 'NG', 2510: 'D', 2511: 'C', 2512: 'B', 2513: 'A', 2514: 'S',
  1835: 'NG', 1463: 'D', 1464: 'C', 1465: 'B', 1466: 'A', 1467: 'S' };
const SHOT_COLOR = { white: 'NG', blue: 'D', green: 'C', red: 'B', silver: 'A', gold: 'S' };
function shotGradeOf(el) {
  const id = String(el?.title || '').match(/^#(\d+)/)?.[1];
  if (id && SHOT_ID_G[id]) return SHOT_ID_G[id];
  const src = el?.querySelector?.('img')?.getAttribute('src') || '';
  const m = src.match(/(?:shot|bullet)_(white|blue|green|red|silver|gold)\b|_(white|blue|green|red|silver|gold)_i\d/i);
  return m ? SHOT_COLOR[(m[1] || m[2]).toLowerCase()] : null;
}
const shotQty = b => +((b.title || '').match(/×\s*([\d\s]+)$/)?.[1] || '0').replace(/\D/g, '');
// окно выбора слота: пустой слот на панели → вкладка (consumable = «Розхідники», remove = «Прибрати»)
const slotModalClose = async () => { const c = env.$q('#l2-bh-modal-close'); if (c && env.shown(c)) { env.fire(c); await env.sleep(300); } };
const emptySlot = () => [...document.querySelectorAll('.l2-battle-hotbar-slot--empty')].find(x => env.shown(x)) || null;
async function slotModalTab(key) {
  const empty = emptySlot();
  if (!empty) return false;
  env.fire(empty);
  if (!(await env.waitFor(() => env.$q('.l2-battle-hotbar-modal #l2-bh-modal-tabs') ? 1 : null, 3000, 100))) return false;
  const tab = env.$q(`.l2-battle-hotbar-tab[data-tab-key="${key}"]`);
  if (!tab) return false;
  if (!tab.classList.contains('l2-battle-hotbar-tab--on')) { env.fire(tab); await env.sleep(400); }
  return !!(await env.waitFor(() => document.querySelector('.l2-battle-hotbar-pick') ? 1 : null, 2000, 100));
}
const slotPicks = () => [...document.querySelectorAll('.l2-battle-hotbar-pick')].filter(x => env.shown(x));
// слот зарядов не того грейда → «Прибрати» старый, на свободный слот — заряды нужного грейда из «Розхідники» (раз в 2 мин)
async function shotSlotSwap(b) {
  const want = env.rt.weaponsT ? env.shotGrade?.()?.g : null, have = shotGradeOf(b);
  const re = env.shotsMage?.() ? SHOT_BSPS_RE : SHOT_SS_RE;
  const matches = x => shotGradeOf(x) === want && re.test(String(x.title || '').replace(/^#\d+\s*[—–-]\s*/, ''));
  if (!want || !have || matches(b) || shotSlots().some(matches)) return false;
  const now = Date.now();
  if (now - (env.rt.shotSwapT || 0) < 120000) return false;
  env.rt.shotSwapT = now; env.setRt({ shotSwapT: now });
  const close = slotModalClose, openTab = slotModalTab, picks = slotPicks;
  // 1) нужный грейд в сумке есть?
  if (!(await openTab('consumable'))) { await close(); env.rec('B', 'внимание', `заряды на панели ${have}-грейда, а оружие ${want} — свободного слота нет, переставь вручную`); return false; }
  const good = picks().find(x => matches(x) && shotQty(x) > 0);
  if (!good) { await close(); return false; }    // ещё не куплены — докупит магазин, потом поставим
  const gq = shotQty(good);
  env.fire(good);
  await env.waitFor(() => !env.shown(env.$q('.l2-battle-hotbar-modal__panel')) ? 1 : null, 3000, 100);
  await close();
  // 2) старые убрать с панели («Прибрати»), чтобы бот не жал их
  let removed = false;
  if (await openTab('remove')) {
    const old = picks().find(x => shotGradeOf(x) === have && !matches(x));
    if (old) { env.fire(old); removed = !!(await env.waitFor(() => !b.isConnected || !env.shown(env.$q('.l2-battle-hotbar-modal__panel')) ? 1 : null, 3000, 100)); }
  }
  await close();
  env.rec('B', 'панель', `оружию нужны ${env.shotsMage?.() ? 'заряды духа' : 'заряды души'} ${want}, на панели другие заряды ${have} — поставил подходящие (×${gq})${removed ? ', старые убрал' : ' (старые убери с панели вручную)'}`);
  return true;
}

// 9.2.2 (скрин игрока 12.10, спойлер WestSPOIL 33 ур.): магазин купил заряды души D, а слота зарядов на панели боя не было вовсе —
// keepShots и shotSlotSwap работали только с уже стоящим слотом, и заряды лежали в сумке. Нет слота зарядов → пустой слот →
// «Розхідники» → заряды нужного типа (по надетому оружию) и грейда, больше всего штук (раз в 2 мин; не куплены — ждём магазин)
const SHOT_BSPS_RE = /благословенн\S* заряд\S* дух|blessed spiritshot/i, SHOT_SS_RE = /заряд\S* душ\S* во(?:їна|ина)|^soulshot/i;
async function shotSlotAdd() {
  const want = env.rt.weaponsT ? env.shotGrade?.()?.g : null;
  if (!want || shotSlots().length || !emptySlot()) return false;
  const now = Date.now();
  if (now - (env.rt.shotAddT || 0) < 120000) return false;
  env.rt.shotAddT = now; env.setRt({ shotAddT: now });
  const re = env.shotsMage?.() ? SHOT_BSPS_RE : SHOT_SS_RE;
  const slotNm = (emptySlot()?.title || '').match(/слот \d+/)?.[0] || 'пустой слот';
  if (!(await slotModalTab('consumable'))) { await slotModalClose(); return false; }
  const good = slotPicks().filter(x => re.test(String(x.title || '')) && shotGradeOf(x) === want && shotQty(x) > 0).sort((a, b) => shotQty(b) - shotQty(a))[0];
  if (!good) { await slotModalClose(); return false; }
  const nm = String(good.title || '').replace(/\s*×.*$/, ''), q = shotQty(good);
  env.fire(good);
  const ok = await env.waitFor(() => shotSlots().length || !env.shown(env.$q('.l2-battle-hotbar-modal__panel')) ? 1 : null, 3000, 100);
  await slotModalClose();
  env.rec('B', 'панель', ok ? `зарядов на панели не было — поставил «${nm}» ${want} (×${q}) в ${slotNm}` : `не удалось поставить «${nm}» ${want} на панель`);
  return !!ok;
}

const shotSlots = () => [...document.querySelectorAll('.l2-hotbar-shot--enabled, .l2-hotbar-shot--disabled')];
async function keepShots() {
  if (env.rt.shotMismatchPending || env.shotGrade?.()?.blocked) return;
  const wanted = () => env.rt.weaponsT ? env.shotGrade?.()?.g : null;
  const pick = () => { const g = wanted(), re = env.shotsMage?.() ? SHOT_BSPS_RE : SHOT_SS_RE;
    return (g && shotSlots().find(x => shotGradeOf(x) === g && re.test(String(x.title || '').replace(/^#\d+\s*[—–-]\s*/, '')))) || env.shotSlot(); };
  let b = pick();
  if (!b) { await shotSlotAdd(); b = pick(); }
  // 10.0.19 (игрок 15.10: S-кастер, старые заряды на панели): включённый старый слот
  // тоже нужно заменить. Его состояние ON относится к старому предмету, а не к нужным зарядам.
  if (b) { await shotSlotSwap(b); b = pick(); }
  // После неудачной замены слота старый грейд не включаем. Оружие может смениться, пока открыто окно.
  const want = wanted(), have = shotGradeOf(b), type = env.shotsMage?.() ? SHOT_BSPS_RE : SHOT_SS_RE;
  if (env.on === false || env.tabOwner === false || env.shotGrade?.()?.blocked || (want && have && want !== have) || (want && !type.test(String(b?.title || '').replace(/^#\d+\s*[—–-]\s*/, '')))) return;
  if (!b || b.isConnected === false || env.shotsOn(b) || env.qty(b) === 0 || Date.now() - env.lastShotTry < 5000) return;
  env.lastShotTry = Date.now();
  console.log(env.TAG, 'соски выключены → включаю');
  env.fire(b);
  if (await env.waitFor(() => env.shotsOn(b), 2000, 100)) env.setStatus('Соски включены');
  else console.info(env.TAG, 'соски не включились');
}
 return { bar, meHp, meMp, potWatch, potInventory, hpPots, hpPotByDeficit, hpPotPick, mpPotSlot, longFightMp, keepShots, shotGradeOf, shotSlotSwap, shotSlotAdd };
 };
})(globalThis);
