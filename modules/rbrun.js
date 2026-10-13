/* L2wap 10.0.6 (игрок 13.10 02:02: «создай кнопочку, чтобы можно было смотреть, что выпало в результате серии РБ, после нового
   запуска серии данные собираются снова»): «📦 Серия РБ» — учёт наград и дропа с рейдовых боссов и эпиков с момента запуска серии.
   Серия = запуск режима «Тур РБ», «🐉 Эпики», кнопка «🎯 Убить один РБ» (когда тур ещё не шёл), тур по дейлику или «↺ Новая серия»
   в окне бота. Пауза, «▶ Продолжить» и перезагрузка страницы серию не прерывают. Память: rt.rbRun = { t0, mode, kills, adena, exp,
   sp, fa, deaths, items:{имя: шт}, bosses:[{n, l, t, a, e}] } — в памяти персонажа, переживает перезагрузку. Пишет сюда только combat
   (убит РБ) и survival (смерть); окно бота (content.draw) показывает кнопку и сводку. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.rbrun = function create_rbrun(env) {
const MODE_NAME = { tour: 'тур РБ', one: 'один РБ', epic: 'эпики', daily: 'РБ по дейлику', manual: 'вручную', auto: 'бой с РБ' };
const MAX_ITEMS = 80, MAX_BOSSES = 60;
const FA_RE = /^fast\s*ad[eé]n/i;
const fmt = n => Math.round(+n || 0).toLocaleString('ru');
const blank = (mode, t0 = Date.now()) => ({ t0, mode: mode || 'auto', kills: 0, adena: 0, exp: 0, sp: 0, fa: 0, deaths: 0, items: {}, bosses: [] });
// память могла быть записана меню (только t0 и mode) — недостающие поля считаем нулями
const norm = r => r && typeof r === 'object' ? { ...blank(r.mode, r.t0), ...r, items: { ...(r.items || {}) }, bosses: [...(r.bosses || [])] } : null;
const active = () => !!(env.cfg.rbHuntMode || env.cfg.epicMode || env.rt.rbOne?.on || env.rt.rbSess?.on);
const modeNow = () => env.cfg.epicMode ? 'epic' : env.rt.rbOne?.on ? 'one' : env.cfg.rbHuntMode ? 'tour' : 'auto';

async function start(mode, why) {
  const r = blank(mode || modeNow());
  await env.setRt({ rbRun: r });
  env.rec('B', 'серия РБ', `📦 новая серия (${MODE_NAME[r.mode] || r.mode}${why ? ', ' + why : ''}) — добыча и награды считаются заново`);
  return r;
}

// строки журнала боя после победы → { имя: шт } (как loot.trackLoot: «Spellbook: Blaze ×1», «Випало Fast Aden +1»); награда (EXP/SP/аден) и квест — не вещи
function parseItems(lines) {
  const out = {};
  for (const l0 of lines || []) {
    const l = String(l0 || '').replace(/\s+/g, ' ').trim();
    if (!l || /квест|\bEXP\b|\bSP\b|аден/i.test(l)) continue;
    let m = l.match(env.SPECIAL_RE), name, q;
    if (m) { name = m[1].trim(); q = +m[2]; }
    else { m = l.match(env.LOOT_RE); if (!m) continue; name = m[1].replace(/^\s*(?:Спойл|Spoil)\s*:?\s*/i, '').trim(); q = +m[2]; }
    if (!name || name.length > 64 || !(q > 0)) continue;
    out[name] = (out[name] || 0) + q;
  }
  return out;
}

// убит РБ/эпик (combat после победы): награда с экрана победы (adena/exp/sp), вещи — из новых строк журнала боя
async function kill({ id = '', name = '', lvl = 0, adena = 0, exp = 0, sp = 0, lines = [], epic = false, fightS = 0 } = {}) {
  let r = norm(env.rt.rbRun);
  if (!r) { r = blank(modeNow()); env.rec('B', 'серия РБ', `📦 серия начата с этого боя (${MODE_NAME[r.mode] || r.mode})`); }
  const got = parseItems(lines);
  let fa = 0;
  for (const [n, q] of Object.entries(got)) {
    if (FA_RE.test(n)) { fa += q; continue; }
    r.items[n] = (r.items[n] || 0) + q;
  }
  if (Object.keys(r.items).length > MAX_ITEMS) r.items = Object.fromEntries(Object.entries(r.items).sort((a, b) => b[1] - a[1]).slice(0, MAX_ITEMS));
  r.kills++; r.adena += +adena || 0; r.exp += +exp || 0; r.sp += +sp || 0; r.fa += fa; r.last = Date.now();
  r.bosses.push({ id, n: name, l: +lvl || 0, t: Date.now(), a: +adena || 0, e: +exp || 0, ...(epic ? { ep: 1 } : {}), ...(fightS ? { s: Math.round(fightS) } : {}) });
  if (r.bosses.length > MAX_BOSSES) r.bosses = r.bosses.slice(-MAX_BOSSES);
  await env.setRt({ rbRun: r });
  const its = Object.entries(got).filter(([n]) => !FA_RE.test(n)).map(([n, q]) => `${n} ×${q}`);
  env.rec('B', 'серия РБ', `📦 ${name}${lvl ? ` (${lvl})` : ''}: аден +${fmt(adena)} · EXP +${fmt(exp)}${fa ? ` · FA +${fa}` : ''}${its.length ? ' · ' + its.join(', ') : ' · вещей не выпало'}`
    + ` · за серию: РБ ${r.kills}, аден +${fmt(r.adena)}, EXP +${fmt(r.exp)}${r.fa ? `, FA +${r.fa}` : ''}, вещей ${Object.values(r.items).reduce((a, x) => a + x, 0)}`);
  return r;
}

async function death() {                           // смерть героя в серии (survival.onDeath) — только пока идёт режим РБ/эпиков
  const r = norm(env.rt.rbRun); if (!r || !active()) return false;
  r.deaths++; await env.setRt({ rbRun: r }); return true;
}

function summary(now = Date.now()) {               // данные для окна бота и меню
  const r = norm(env.rt.rbRun); if (!r) return null;
  const items = Object.entries(r.items).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'));
  const byBoss = {};
  for (const b of r.bosses) { const k = `${b.n}${b.l ? ` (${b.l})` : ''}`; byBoss[k] = (byBoss[k] || 0) + 1; }
  const bosses = Object.entries(byBoss).map(([n, c]) => c > 1 ? `${n} ×${c}` : n);
  return { ...r, items, bosses, nItems: items.reduce((a, [, q]) => a + q, 0), modeTxt: MODE_NAME[r.mode] || r.mode, active: active(), min: Math.max(0, Math.round((now - r.t0) / 60000)) };
}

function lines(wide, now = Date.now()) {           // строки сводки (без кнопок); окно узкое — короче
  const S = summary(now); if (!S) return ['серия РБ ещё не начиналась — запусти «Тур РБ», «Эпики» или «🎯 Убить один РБ»'];
  const hm = new Date(S.t0).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  const L = [`серия с ${hm} (${S.modeTxt}${S.active ? '' : ', режим выключен'}) · РБ убито ${S.kills}${S.deaths ? ` · смертей ${S.deaths}` : ''}`];
  L.push(`аден +${fmt(S.adena)} · EXP +${fmt(S.exp)} · SP +${fmt(S.sp)}${S.fa ? ` · 💎 FA +${S.fa}` : ''}`);
  if (S.bosses.length) L.push(`убиты: ${S.bosses.join(', ')}`);
  const top = wide ? S.items : S.items.slice(0, 12);
  L.push(top.length ? `выпало (${S.nItems} шт.): ${top.map(([n, q]) => `${n} ×${q}`).join(', ')}${top.length < S.items.length ? ` … ещё ${S.items.length - top.length} видов` : ''}` : 'вещей пока не выпало');
  return L;
}
 return { MODE_NAME, blank, norm, active, modeNow, start, parseItems, kill, death, summary, lines };
 };
})(globalThis);
