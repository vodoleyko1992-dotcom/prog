/* L2wap v7: isolated loot feature module. Dependencies are injected lazily.
   All game actions remain under the central lease and dispatcher in content.js. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.loot = function create_loot(env) {
// 20.6 (лог 16.10 23:21): массовый спойл проверяем отдельно: префикс «Spoil» также находит Spoil Festival.
const isMassSpoil = b => /festival|спойл[- ]фестиваль/i.test(env.cleanTitle(b?.title || ''));
// 20.43 (лог 21.10 22:07–22:08, FS с Elysian; настройки John nSpoil «Spoil»): префикс роли «Spoil» находит и Spoil, и Spoil Crush, но
// порядок и crushFirst смотрели имя роли (bn = «spoil»), а не кнопку — Crush ни разу не шёл первым. Теперь — по названию кнопки;
// блок ctx.block — на кнопку («spoil:spoil crush»), а не на роль: отказ Crush не запрещает обычный Spoil до конца боя.
const isCrush = b => /crush|розтрощ|сокруш/i.test(env.cleanTitle(b?.title || ''));
const spoilKey = b => 'spoil:' + env.cleanTitle(b?.title || '').toLowerCase();
function spoilPick(ctx) {
  // Crush — только с дубиной (игра отвечает «скилл зараз недоступний»): подтверждённая не-дубина — без Crush, неизвестное оружие —
  // Crush после обычного Spoil (как раньше), дубина — Crush первым. Оружие без типа в справочнике (wt «—»: weaponEquipNote,
  // equipment.stats) — тоже неизвестное, а не «не дубина»: иначе при Spoil на откате Crush не шёл бы и запасным
  const w = env.weaponNow?.(), bl = blunt(), wtKnown = !!w && !!w.wt && w.wt !== '—', seen = new Set();
  const all = env.names(env.cfg.nSpoil).flatMap(bn => env.slotsBy(bn).map(b => ({ bn, b })))
    .filter(x => !seen.has(x.b) && seen.add(x.b) && !isMassSpoil(x.b) && !(isCrush(x.b) && wtKnown && !bl) && env.ready(x.b) && (ctx.block[spoilKey(x.b)] || 0) < Date.now());
  const rank = x => isCrush(x.b) ? (bl ? 0 : 2) : 1;
  return all.sort((a, b) => rank(a) - rank(b))[0] || null;
}

function massSpoilPick(ctx, ok = env.ready) {
  // Старые настройки могли содержать только nSpoil=Spoil. Ищем изученный Festival на панели,
  // даже если автороли ещё не заполнили nSpoilMass; при выключенных обеих ролях спойл не включаем.
  if (!env.names(env.cfg.nSpoilMass || '').length && !env.names(env.cfg.nSpoil || '').length) return null;
  const list = [...new Set([...env.names(env.cfg.nSpoilMass || ''),
    ...env.names(env.cfg.nSpoil || '').filter(n => /festival/i.test(n)), 'spoil festival'])];
  for (const bn of list) {
    const b = env.slotsBy(bn).find(b => ok(b) && (ctx.block[spoilKey(b)] || 0) < Date.now());
    if (b) return { bn, b };
  }
  return null;
}

const festLineOf = lines => lines.find(l => /^(?:spoil festival|спойл[- ]фестиваль)\s*:/i.test(String(l || '').trim()));
function festivalParse(lines) {                   // → [{ name, ok, ch, was }] из строки «Spoil Festival: Моб: успіх (63%); Моб2: промах (51%)»
  const L = festLineOf(lines); if (!L) return [];
  return L.replace(/^[^:]+:\s*/, '').split(/\s*;\s*/).map(part => {
    // 20.43 (лог 21.10 21:39:20): «Моб: вже заспойлено» — метка уже висела (ok, was): не новый успех в статистике
    const w = part.match(/^(.+?)\s*:\s*(?:вже|уже)\s+заспойл|^(.+?)\s*:\s*already\s+spoil/i);
    if (w) return { name: (w[1] || w[2]).trim(), ok: true, ch: 0, was: true };
    const m = part.match(/^(.+?)\s*:\s*(успіх|успех|success|ok|промах|провал|fail|miss)\s*(?:\((\d+)\s*%\))?/i);
    return m ? { name: m[1].trim(), ok: /усп|success|ok/i.test(m[2]), ch: +m[3] || 0 } : null;
  }).filter(Boolean);
}

// 20.43 (лог 21.10 21:39:00–21:39:20, BH 75 с пикой): Festival пометил всех 4 (✅4), следующий ход — 423 «Проверка активности»; после
// капчи бой открылся заново (новый ctx без massTried), и Festival ушёл второй раз — «вже заспойлено» у всех 4: потерянный ход и MP.
// Помним Festival этого боя (spawnId адреса + имена из ответа) в памяти вкладки (sessionStorage, как aoeProbe) до победы, не дольше 2 мин.
// 20.43 (ревью): spawnId — точка появления, через ≈1 мин там тот же вид (dense_12178 снова через 72 с), а бой мог кончиться без победы
// бота (Stop и ручное добивание, смерть, «итог не подтверждён», отход от чемпиона) — память сняла бы спойл всей новой пачки. Тот же бой
// узнаём и по строке итога Festival в логе боя (после капчи — на странице, после перезагрузки — в полном battle.log сервера; у нового
// боя её нет); бой на другом spawnId стирает память сразу.
const FEST_KEY = 'l2bot.festDone', FEST_MS = 120000;
let festMem = null;
const urlSpawn = () => { try { return new URLSearchParams(root.location?.search || '').get('spawnId') || ''; } catch (e) { return ''; } };
function festRead() {
  try { const v = JSON.parse(root.sessionStorage.getItem(FEST_KEY) || 'null'); return v && typeof v === 'object' ? v : null; } catch (e) { return festMem; }
}
function festSave(v) { festMem = v; try { if (v) root.sessionStorage.setItem(FEST_KEY, JSON.stringify(v)); else root.sessionStorage.removeItem(FEST_KEY); } catch (e) { /* хранилище вкладки недоступно — память модуля */ } }
const festNorm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
function festRestore(ctx) {
  if (ctx.festChecked) return;
  ctx.festChecked = true;
  const r = festRead(), sp = urlSpawn();
  if (!r) return;
  if (sp && r.sp !== sp) { festSave(null); return; }               // другой бой — прошлый окончен
  if (ctx.rb || ctx.massTried) return;
  const age = Date.now() - (+r.t || 0);
  if (!sp || !(age >= 0 && age < FEST_MS) || !r.line || !(r.names || []).some(n => env.nameLike(n, ctx.name || ''))
    || !env.logLines().some(l => festNorm(l) === festNorm(r.line))) return;
  ctx.massTried = true;
  if ((r.ok || []).some(n => env.nameLike(n, ctx.name || ''))) ctx.spoiled = true;
  env.rec('B', 'спойл', `${ctx.name}: масс-спойл в этом бою уже был (${Math.round(age / 1000)} с назад, до перерыва) — повторно не жму`);
}

// 20.15 (лог 18.10 18:41–18:47): у РБ соседи гибнут за секунды и подходят новые — из 290 убитых соседей спойл дали 10.
// Помним, сколько живых соседей каждого вида (имя|макс. HP) уже помечено; исчезнувшие — убиты, новые — не помечены.
const nearKey = x => (x.name || '') + '|' + x.max;
function nearCount(alive) { const c = {}; for (const x of alive) c[nearKey(x)] = (c[nearKey(x)] || 0) + 1; return c; }
function nearUnspoiled(ctx, alive) {
  const c = nearCount(alive), S = ctx.nearSpoiledKeys ||= {};
  let spoiled = 0, fresh = 0;
  for (const k of Object.keys(S)) { S[k] = Math.min(S[k], c[k] || 0); if (!S[k]) delete S[k]; else spoiled += S[k]; }
  for (const k of Object.keys(c)) fresh += c[k] - (S[k] || 0);
  ctx.nearSpoiled = spoiled;
  return fresh;
}

async function massSpoilStep(ctx, act, mob) {
  festRestore(ctx);
  if ((ctx.massTried && !ctx.rb) || !mob?.max || mob.cur <= 0) return false;
  const alive = env.extraMobs().filter(x => x.cur > 0), near = alive.length;
  // 20.14 (просьба игрока 18.10): на РБ сам Festival не действует (новость игры 11.10), но метит обычных мобов
  // рядом с РБ — их добыча спойла собирается, когда они гибнут от АОЕ/копья. Только при видимых живых соседях;
  // галка «Спойлить и РБ» по-прежнему про обычный Spoil по самому РБ.
  // 20.15 (просьба игрока 18.10): на РБ — повтор по откату умения, как только рядом есть непомеченные соседи.
  if (ctx.rb && (env.cfg.rbNearMobs === false || !near || !nearUnspoiled(ctx, alive))) return false;
  // Festival выгоднее и по одной цели: гарантированная метка вместо повторов Spoil.
  // Соседи могут появиться в DOM только после первого хода.
  if (!near && (ctx.spoiled || env.mobSpoiled())) return false;
  const x = massSpoilPick(ctx); if (!x) return false;
  const mp = env.meMp(), need = env.skillMp(env.cleanTitle(x.b.title)) || 0;
  if (mp && need && mp.cur < need) return false;  // маны мало — обойдёмся обычным Spoil
  const before = env.logLines(), waited = waitedMs(ctx, x.b);
  const r = await act(x.b, `Масс-спойл: ${env.cleanTitle(x.b.title)} (мобов ${near + 1}${waited >= 0 ? `, ждал откат ${(waited / 1000).toFixed(1)} с` : ''})`);
  if (r === 'unavail') { ctx.block[spoilKey(x.b)] = Infinity; env.rec('B', 'спойл', `«${env.cleanTitle(x.b.title)}»: ${env.noticeText() || 'недоступен'} — до конца боя не использую`); return true; }
  if (r === 'cd' || r === 'noforce') return true;
  if (r !== true) return true; // потерянный клик не подтверждает применение
  ctx.massTried = true;
  await env.waitFor(() => env.mobSpoiled() || env.newLines(before, env.logLines()).some(l => env.SPOIL_OK.test(l) || env.SPOIL_FAIL.test(l) || festivalParse([l]).length), 1500, 80);
  const fresh = env.newLines(before, env.logLines());
  // v5.5.9: игра пишет итог по каждому мобу: «Spoil Festival: Enku Orc Shaman: промах (64%); Roughly Hewn Rock Golem: успіх (51%); …»
  const res = festivalParse(fresh), mainR = res.find(x => env.nameLike(x.name, ctx.name));
  const oks = res.length ? res.filter(x => x.ok && !x.was).length : fresh.filter(l => env.SPOIL_OK.test(l)).length;
  const bads = res.length ? res.filter(x => !x.ok).length : fresh.filter(l => env.SPOIL_FAIL.test(l)).length;
  if (env.mobSpoiled() || mainR?.ok || (!res.length && oks && !bads && !ctx.rb)) ctx.spoiled = true;
  ctx.nearSpoiled = res.length ? res.filter(x => x.ok && !env.nameLike(x.name, ctx.name)).length : ctx.rb ? oks : Math.max(0, oks - 1);
  const festLine = festLineOf(fresh);
  if (!ctx.rb && urlSpawn() && festLine) festSave({ sp: urlSpawn(), t: Date.now(), line: festLine, names: [...new Set([ctx.name || '', ...res.map(x => x.name)])].filter(Boolean),
    ok: [...new Set([...(ctx.spoiled ? [ctx.name || ''] : []), ...res.filter(x => x.ok).map(x => x.name)])].filter(Boolean) });
  // Festival метит всех живых в зоне со 100 %: на РБ помечаем соседей, видимых в момент нажатия (без ответа игры — тоже,
  // чтобы не жать по кругу; новые соседи после этого снова разрешат нажатие)
  if (ctx.rb) { const S = ctx.nearSpoiledKeys ||= {}; for (const [k, n] of Object.entries(nearCount(alive))) S[k] = Math.max(S[k] || 0, n); ctx.nearSpoiled = Math.max(ctx.nearSpoiled, near); }
  // Лог20.10 10:43UTC: локальный счётчик уже обновляется setRt; запись статистики не держит следующий удар.
  const S = { ...(env.rt.spoilStat || {}) }; S.mass = (S.mass || 0) + 1; S.massOk = (S.massOk || 0) + oks; S.massFail = (S.massFail || 0) + bads; env.setRt({ spoilStat: S });
  env.rec('B', 'спойл', `${ctx.name} +${near} рядом: масс-спойл → ${oks || bads || res.length ? `✅${oks} ✗${bads}${res.length ? ' (' + res.map(x => `${x.name} ${x.was ? 'уже' : x.ok ? '✅' : '✗'}${x.ch ? x.ch + '%' : ''}`).join(', ') + ')' : ''}` : 'нажат'}${ctx.rb ? ' · РБ масс-спойл не берёт, метим мобов рядом' : ctx.spoiled ? ' · главный помечен' : ' · главного добью обычным Spoil'}${fresh.length && !oks && !bads && !res.length ? ' · лог: ' + fresh.slice(0, 3).join(' ⏎ ').slice(0, 160) : ''}`);
  return true;
}

// 20.43 (бой из облака 21.10: Fortune Seeker 76 с Elysian — Spoil Crush 14 747 урона, Buffalo 70 убит с одного удара, «Spoil успішний (59%)»;
// John 21.10 12:47: «давай действовать от того какое я оружие одел»): надета дубина — первым жмём Spoil Crush (удар + спойл за один ход),
// пика и другое оружие — первым Festival, как раньше. Не прошёл спойл Crush'ем, а моб жив — следующий ход снова через Festival (100 %);
// соседи, появившиеся после первого хода, тоже идут под Festival. Оружие — только подтверждённое сканом сумки (combat.combatWeapon).
const BLUNT = /^(?:двуруч\. )?дубина$|^(?:big)?blunt$/i;
const blunt = () => BLUNT.test(String(env.weaponNow?.()?.wt || ''));
const crushFirst = (ctx, mob) => !ctx.rb && !ctx.spoilTry && !ctx.spoiled && !ctx.massTried && mob?.max > 0 && mob.cur > 0
  && blunt() && isCrush(spoilPick(ctx)?.b);
// 20.43 (John 21.10 12:48: «у крафта тоже есть СОЛО споил, юзаем если одета булава, с пикой нафиг»): у крафтера (Artisan/Warsmith/Maestro)
// спойл — только с подтверждённой дубиной. С пикой Warsmith 42 кладёт мобов с одного удара (бой из облака 21.10: 20 тыс. по площади),
// ход на Spoil — потерянный ход. Спойлер (Fortune Seeker) с пикой по-прежнему спойлит Festival'ом.
let noSpoilKey = '';
const crafterPike = () => env.roleNow?.() === 'crafter' && !blunt();      // чистая проверка: и для выбора точки фарма (content.canSpoil)
function crafterNoSpoil() {
  if (!crafterPike()) { noSpoilKey = ''; return false; }
  const w = env.weaponNow?.(), key = (env.rt.char || '') + '|' + (w?.id || '?');
  if (key !== noSpoilKey) { noSpoilKey = key; env.rec('B', 'спойл', `крафтер ${w ? 'с оружием «' + (w.wt || w.name || '?') + '»' : 'без подтверждённого оружия'} — спойл не жму (только с дубиной)`); }
  return true;
}
// 20.43 (лог 21.10 21:35–22:00, BH 75 с пикой, 329 боёв): Festival (откат ≈2,7 с) дольше боя цепочки (≈2,3–3 с), и каждый второй бой
// начинался с обычного Spoil — до готовности Festival оставалось ≈0,1–0,6 с; следующий Whirlwind клал пачку, ≈360 мобов из ≈470 без спойла.
// Соседей в начале боя игра не показывает (extras пуст до Festival/АОЕ), поэтому ждём по оружию: не дубина, не РБ, первый спойл боя,
// Festival откатится не позже чем через MASS_WAIT_S (cdLeft: экран, свой откат и откат сервера) и MP хватает — ждём его, а не жмём Spoil.
// Удар (АОЕ) в это время не идёт: шаг возвращает новый круг, лечение/банки идут раньше. Не больше MASS_WAIT_MAX за бой (застывший рисунок КД).
// 20.43 (ревью): то же у дубины — Spoil Crush (откат 2,1 с) после убийства с одного удара ещё ≈0,7 с на откате к первому ходу следующего
// боя цепочки (ход-убийство → первый ход нового боя ≈1,3–1,4 с): бот жал готовый Festival (ход без урона), Crush первым шёл через бой.
// Дубина — ждём Crush, если он откатится не позже чем через MASS_WAIT_S. Откат, который не идёт (застывший RAF-рисунок, cdBusy 15.10:
// таймер «0.6» стоит), ожидание обрывает через STALL_MS: упал меньше чем на половину проспанного — дальше обычный Spoil, до конца боя не ждём.
const MASS_WAIT_S = 1, MASS_WAIT_MAX = 1500, STALL_MS = 300;
let stallNoteT = 0;
const crushSoon = (ctx, ok) => env.names(env.cfg.nSpoil || '').flatMap(bn => env.slotsBy(bn)).find(b => isCrush(b) && ok(b) && (ctx.block[spoilKey(b)] || 0) < Date.now()) || null;
async function spoilWait(ctx, mob) {
  if (ctx.rb || ctx.spoilTry || ctx.spoiled || ctx.massTried || ctx.spoilWaitOff || !(mob?.max > 0) || !(mob.cur > 0) || !env.cdLeft || env.mobSpoiled()) return false;
  const soon = b => { const s = env.cdLeft(b); return s > 0 && s <= MASS_WAIT_S; };
  const b = blunt() ? crushSoon(ctx, soon) : massSpoilPick(ctx, soon)?.b; if (!b) return false;
  const mp = env.meMp(), need = env.skillMp(env.cleanTitle(b.title)) || 0;
  if (mp && need && mp.cur < need) return false;
  const now = Date.now(), left = env.cdLeft(b); ctx.massWaitT0 ||= now;
  if (now - ctx.massWaitT0 > MASS_WAIT_MAX) return false;
  let w = ctx.spoilWait;
  if (!w || w.k !== spoilKey(b)) w = ctx.spoilWait = { k: spoilKey(b), t0: now, left0: left, slept: 0, lastT: now };   // по названию: панель могла перерисоваться
  else if (left > w.left0 + 0.05) { w.left0 = left; w.slept = 0; }   // сервер уточнил откат в большую сторону — считаем от нового
  else if (w.slept >= STALL_MS && w.left0 - left < w.slept / 2000) {
    ctx.spoilWaitOff = true; ctx.spoilWait = null;
    if (now - stallNoteT > 600000) { stallNoteT = now; env.rec('B', 'спойл', `«${env.cleanTitle(b.title)}»: откат не идёт (${left.toFixed(1)} с после ${(w.slept / 1000).toFixed(1)} с ожидания — застыл рисунок?) — не жду, жму обычный спойл`); }
    return false;
  }
  const ms = Math.max(30, Math.min(150, Math.round(left * 1000)));
  await env.sleep(ms); w.slept += ms; w.lastT = Date.now();
  return true;
}
// 20.43 (ревью): «ждал откат N с» — только у нажатия этой кнопки сразу после её ожидания, счёт от начала этого ожидания
// (раньше — от первого ожидания боя: после неудачного Spoil поздний Festival получал «ждал 2,1 с»)
function waitedMs(ctx, b) { const w = ctx.spoilWait; ctx.spoilWait = null; return w && w.k === spoilKey(b) && Date.now() - w.lastT < 250 ? Math.max(0, Date.now() - w.t0) : -1; }
async function spoilStep(ctx, act, mob) {
  if (crafterNoSpoil()) return false;
  festRestore(ctx);
  if (blunt() && await spoilWait(ctx, mob)) return true;            // дубина: Crush вот-вот откатится — ждём его, а не Festival
  if (!crushFirst(ctx, mob) && await massSpoilStep(ctx, act, mob)) return true;
  if (!blunt() && await spoilWait(ctx, mob)) return true;           // пика: Festival вот-вот откатится — ждём его, а не Spoil
  if (!env.cfg.nSpoil || ctx.spoiled || (ctx.rb && !env.cfg.spoilRb) || !mob?.max || mob.cur <= 0) return false;
  if (env.mobSpoiled()) { ctx.spoiled = true; return false; }           // уже висит значок спойла — не жмём (раньше жали ещё раз: «моб уже заспойлений»)
  // неудача — пробуем снова, пока моб жив и не слишком побит (спойл с шансом ~50–60 %): до 4 попыток, пока HP моба > 30 %
  if ((ctx.spoilTry || 0) >= 4 || (ctx.spoilTry && mob.cur < mob.max * 0.3)) return false;
  const x = spoilPick(ctx); if (!x) return false;
  const before = env.logLines(), waited = waitedMs(ctx, x.b); ctx.spoilTry = (ctx.spoilTry || 0) + 1; ctx.block[spoilKey(x.b)] = Date.now() + 700;
  const r = await act(x.b, `Спойл (${ctx.spoilTry}): ${env.cleanTitle(x.b.title)}${waited >= 0 ? ` (ждал откат ${(waited / 1000).toFixed(1)} с)` : ''}`);
  if (r === 'unavail') { ctx.block[spoilKey(x.b)] = Infinity; env.rec('B', 'спойл', `«${env.cleanTitle(x.b.title)}»: ${env.noticeText() || 'недоступен'} — до конца боя не использую${isCrush(x.b) ? ' (Spoil Crush — только с дубиной)' : ''}`); return true; }
  if (r === 'cd' || r === 'noforce') { ctx.spoilTry--; return true; }
  // 20.41: клик не ушёл ('lock' — окно занятости игры, 'nomp' — нет MP) — строки итога спойла не будет, 1,5 с не ждём
  // 20.43 (ревью): 'lock' снимает и блок 0,7 с этой кнопки — повтор её же сразу, как в остальных шагах боя (было: дубина → Festival
  // вместо повтора Crush; пика → Spoil заблокирован, Crush исключён, спойла в этот ход нет — Whirlwind клал пачку без спойла)
  if (r === 'lock' || r === 'nomp') { ctx.spoilTry--; ctx.block[spoilKey(x.b)] = r === 'nomp' ? Date.now() + 1500 : 0; return true; }   // 1,5 с — как NOMP_MS боя
  await env.waitFor(() => env.mobSpoiled() || env.newLines(before, env.logLines()).some(l => env.SPOIL_OK.test(l) || env.SPOIL_FAIL.test(l)), 1500, 80);
  const fresh = env.newLines(before, env.logLines()), ok = fresh.find(l => env.SPOIL_OK.test(l)), bad = !ok && fresh.find(l => env.SPOIL_FAIL.test(l));
  const S = { ...(env.rt.spoilStat || {}) };
  if (ok || env.mobSpoiled()) { ctx.spoiled = true; S.ok = (S.ok || 0) + 1; }
  else if (bad) { S.fail = (S.fail || 0) + 1; const ch = +(bad.match(/(\d+)\s*%/) || [])[1]; if (ch) S.chance = ch; ctx.block[spoilKey(x.b)] = Date.now() + 300; }
  else if (r !== true) ctx.spoilTry--;            // нажатие не прошло (ответа нет) — попытку не считаем
  else if (!env.rt.spoilMsgKnown && ctx.spoilTry >= 2) ctx.spoiled = true;   // игра молчит (другой язык?) — после 2 нажатий считаем помеченным
  if (ok && !env.rt.spoilMsgKnown) S.known = 1;
  env.setRt({ spoilStat: S, ...(ok && !env.rt.spoilMsgKnown ? { spoilMsgKnown: 1 } : {}) });
  env.rec('B', 'спойл', `${ctx.name}: ${ctx.spoiled ? '✅ ' + (ok || 'значок спойла').slice(0, 60) : bad ? '✗ ' + bad.slice(0, 60) + (ctx.spoilTry < 4 && mob.cur >= mob.max * 0.3 ? ' — пробую ещё' : '') : 'нажат' + (fresh.length ? ' · лог: ' + fresh.slice(0, 3).join(' ⏎ ').slice(0, 160) : '')}`
    + (S.ok || S.fail ? ` · всего ✅${S.ok || 0} ✗${S.fail || 0}${S.chance ? ' · шанс ' + S.chance + '%' : ''}` : ''));
  return true;
}

async function sweepStep(ctx) {                   // после победы: собрать спойл
  festSave(null);                                 // 20.43: бой окончен — память Festival этого боя больше не нужна
  if (!ctx.spoiled) return;
  // v5.5.3: в этой игре добыча спойла приходит сама — «Спойл: Coal ×5» в логе победы. Тогда Sweeper не нужен, только учёт
  const sl = env.newLines(ctx.logStart || [], env.logLines()).map(l => l.match(env.SPOIL_LOOT)).filter(Boolean);
  if (sl.length) {
    const S = { ...(env.rt.spoilStat || {}) }, it = { ...(S.items || {}) };
    for (const m of sl) it[m[1]] = (it[m[1]] || 0) + +m[2];
    S.items = it; S.loots = (S.loots || 0) + 1; env.setRt({ spoilStat: S });
    env.rec('B', 'спойл', `${ctx.name}: добыча спойла — ${sl.map(m => `${m[1]} ×${m[2]}`).join(', ')}`);
    return;
  }
  // 7.2 (игрок): «свип нам не нужен, это делается автоматом в игре» — Sweeper не жмём никогда (раньше без строки «Спойл: …» жал его
  // до 2 раз по ~1 с после каждой победы). Только отметка в журнале, если игра пишет, что спойл не сработал
  if (/не спрацю|не сработ/i.test(env.$q('#battle-victory-inline, #battle-victory-root')?.textContent || '')) env.rec('B', 'спойл', `${ctx.name}: игра пишет «спойл не сработал»`);
}

function resQuests() {
  return (env.cfg.resQuests || '').split('\n').map(l => l.match(/^\s*(.+?)\s*[=:×x]\s*(\d+)\s*$/i)).filter(Boolean)
    .map(m => ({ name: m[1].trim(), key: m[1].trim().toLowerCase(), need: +m[2] }));
}

function resHave(key) {
  const b = env.rt.bagSeen?.[key], got = env.rt.resGot?.[key] || 0;
  return (b?.n || 0) + got;                       // resGot обнуляется при каждом пересчёте сумки
}

// 10.0.5 (обновление игры 13.10): учёт Fast Aden с мобов — сколько боёв и сколько FA по видам: чемпион синий/оранжевый/красный
// (шанс 10/20/60 %), обычный моб (1 %), «низкий» — ниже героя больше чем на 5 ур. (FA не падает). rt.faDrop = { t0, k:{вид:боёв}, f:{вид:FA} }
const FA_RE = /^fast\s*ad[eé]n/i, FA_TIER = { blue: 'синий', orange: 'оранжевый', red: 'красный' };
const faKind = info => {
  const hl = env.heroLvl?.() || env.rt.lvl || 0;
  if (hl && info.lvl && info.lvl < hl - 5) return 'low';
  return info.champ ? (FA_TIER[info.tier] ? info.tier : 'blue') : 'mob';
};
// сколько Fast Aden в строках добычи победы (и «Спойл: Fast Aden ×N»)
const faQty = lines => { let q = 0; for (const l of lines) { const m = l.match(env.LOOT_RE); if (m && FA_RE.test(m[1].replace(/^\s*(?:Спойл|Spoil)\s*:?\s*/i, '').trim())) q += +m[2] || 0; } return q; };
function faNote(lines, mob, info) {
  if (!info) return null;                          // РБ — не считаем (у них свой дроп)
  const q = faQty(lines);
  const kind = faKind(info), D = env.rt.faDrop || {}, k = { ...(D.k || {}) }, f = { ...(D.f || {}) };
  k[kind] = (k[kind] || 0) + 1;
  if (q) f[kind] = (f[kind] || 0) + q;
  const fd = { t0: D.t0 || Date.now(), k, f };
  const sum = ks => ks.reduce((a, x) => a + (f[x] || 0), 0), cnt = ks => ks.reduce((a, x) => a + (k[x] || 0), 0);
  const tot = `всего: чемпионы ${sum(['blue', 'orange', 'red'])} FA за ${cnt(['blue', 'orange', 'red'])} боёв, мобы ${sum(['mob'])} FA за ${cnt(['mob'])}`;
  const who = info.champ ? `чемпион, ${FA_TIER[info.tier] || 'синий'}` : 'моб';
  if (q) env.rec('B', 'FA', `💎 Fast Aden +${q} — ${mob} (${info.lvl || '?'}, ${who}) · ${tot}`);
  else if (info.champ && kind !== 'blue' && kind !== 'mob') env.rec('B', 'FA', `${mob} (${info.lvl || '?'}, ${who}): FA не выпал${kind === 'low' ? ' — ниже героя больше чем на 5 ур., FA с него не падает' : ''} · ${tot}`);
  return fd;
}
// 20.43 (разбор 21.10, ночной лог alt2 Warlord 48: 40 FA за 572 боя): шанс FA за бой — свой у класса (агро собирает пачку, у Warlock
// одиночные цели). rt.faDrop остаётся общим (buffs.faDropSum/raid.faDropNow сверяют его сумму с балансом FA — «FA пополнились»), а
// цена чемпионов считается по rt.faRate[класс] = { k: {вид: боёв}, f: {вид: FA}, t } (champs.faRate). «Низкие» бои FA не дают — не считаем
function faRateNote(lines, info) {
  if (!info) return null;
  const kind = faKind(info); if (kind === 'low') return null;
  const q = faQty(lines), C = root.L2EngineCore, cls = C?.faClass ? C.faClass(env.rt.classCur?.prof || env.rt.prof) : String(env.rt.prof || '?').toLowerCase();
  const R = { ...(env.rt.faRate || {}) }, o = R[cls] || {}, k = { ...(o.k || {}) }, f = { ...(o.f || {}) };
  k[kind] = (k[kind] || 0) + 1; if (q) f[kind] = (f[kind] || 0) + q;
  R[cls] = { k, f, t: Date.now() };
  const ks = Object.keys(R); if (ks.length > 12) ks.sort((a, b) => (R[a].t || 0) - (R[b].t || 0)).slice(0, ks.length - 12).forEach(x => delete R[x]);
  return R;
}

async function trackLoot(lines, mob, info) {
  const char=env.rt.char,lease=env.leaseEpoch;
  await env.itemsDb();
  if(env.rt.char!==char||env.leaseEpoch!==lease||env.tabOwner===false)return;
  const faDrop = faNote(lines, mob, info), faRate = faRateNote(lines, info);
  const L = { ...(env.rt.loot || {}) }, S = { ...(env.rt.lootSpecial || {}) };
  const LS = { ...(env.rt.lootStat || {}) }, MK = { ...(env.rt.mobKills || {}) }, RG = { ...(env.rt.resGot || {}) };
  const mk = (mob || '?').trim();
  MK[mk] = (MK[mk] || 0) + 1;
  const rq = resQuests(), campaign=env.cfg.campaign&&env.rt.campaign?{...env.rt.campaign,targets:(env.rt.campaign.targets||[]).map(t=>({...t}))}:null, camp = campaign ? campaign.targets.filter(t => t.res && !t.ok) : [];
  const farmGot={...(env.rt.farmGot||{})},recipeGot={...(env.rt.recipeGot||{})};let farmChanged=false,recipeChanged=false;
  let campCh = false;
  let got = 0, value = 0;
  for (const l of lines) {
    if (/квест|\bEXP\b|\bSP\b|аден/i.test(l)) continue;   // 7.1.30: «SP» без границ слова выкидывал Spirit Ore / Spider Leg / Spellbook
    let m = l.match(env.SPECIAL_RE);
    if (m) { S[m[1].trim()] = (S[m[1].trim()] || 0) + +m[2]; got++; env.rec('B', 'особая добыча', `${m[1].trim()} +${m[2]}`); continue; }
    m = l.match(env.LOOT_RE);
    // 7.2: «Спойл: Coal ×5» — это Coal (раньше считался предмет «Спойл: Coal» — спойл не шёл в фарм ресурса, квесты и главу)
    if (m) m = [m[0], m[1].replace(/^\s*(?:Спойл|Spoil)\s*:?\s*/i, ''), m[2]];
    if (m && m[1].length < 64) {                   // v5.1: 40 → 64 — «Recipe: Elven Long Sword (100%)» и длинные кейматы
      L[m[1].trim()] = (L[m[1].trim()] || 0) + +m[2]; got++;
      const fk = m[1].trim().toLowerCase(), q = +m[2];
      const e = LS[m[1].trim()] ? { ...LS[m[1].trim()], k: { ...LS[m[1].trim()].k } } : { n: 0, d: 0, k: {} };
      e.n += q; e.d++; e.k[mk] = (e.k[mk] || 0) + q;
      if (Object.keys(e.k).length > 12) delete e.k[Object.entries(e.k).sort((a, b) => a[1] - b[1])[0][0]];
      LS[m[1].trim()] = e;
      const r = rq.find(x => x.key === fk);
      if (r) {
        const before = resHave(fk); RG[fk] = (RG[fk] || 0) + q;
        if (before < r.need && before + q >= r.need) env.rec('B', 'квест', `📦 ${r.name}: ${before + q}/${r.need} — собрано!`);
      }
      const ct = camp.find(t => t.name.toLowerCase() === fk);     // ресурс главы («Нужно сдать») — прибавляем сразу, не ждём проверки главы
      if (ct) { ct.done = Math.min(ct.total, ct.done + q); ct.est = true; campCh = true; if (ct.done >= ct.total) { ct.ok = true; env.rec('B', 'кампания', `${ct.name}: ${ct.done}/${ct.total} — собрано, иду сдавать`); } }
      if (env.cfg.farmRes && fk === env.cfg.farmRes.trim().toLowerCase()) {
        const fg=farmGot; fg[fk] = (fg[fk] || 0) + +m[2]; farmChanged=true;
        if (env.cfg.farmNeed && fg[fk] >= env.cfg.farmNeed && fg[fk] - +m[2] < env.cfg.farmNeed) env.rec('B', 'фарм', `${m[1].trim()}: собрано ${fg[fk]}/${env.cfg.farmNeed} — цель выполнена`);
      }
      if (env.cfg.recipeRes && env.recipeKey(fk) === env.recipeKey(env.cfg.recipeRes)) {   // охота на рецепт: считаем выпавшие
        const rg=recipeGot, rk = env.recipeKey(fk); rg[rk] = (rg[rk] || 0) + q; recipeChanged=true;
        env.rec('B', 'рецепт', `📜 ${m[1].trim()} +${q} (всего ${rg[rk]}${env.cfg.recipeNeed ? '/' + env.cfg.recipeNeed : ''})`);
      }
      const it = env.itemOf(m[1].trim());
      if (it?.pr) value += Math.floor(it.pr / 2) * +m[2];
    }
  }
  if (Object.keys(LS).length > 120) for (const [k] of Object.entries(LS).sort((a, b) => a[1].n - b[1].n).slice(0, 20)) delete LS[k];
  if (Object.keys(MK).length > 120) for (const [k] of Object.entries(MK).sort((a, b) => a[1] - b[1]).slice(0, 20)) delete MK[k];
  const patch = { lootStat: LS, mobKills: MK, lootStatT0: env.rt.lootStatT0 || Date.now(), ...(faDrop ? { faDrop } : {}), ...(faRate ? { faRate } : {}) };
  // 10.0 (аудит): у словаря «имя → число» поля .n нет — сортировка не работала, и после 200 видов каждый новый предмет отрезался сразу
  const cv = x => typeof x === 'number' ? x : +x?.n || 0;
  const cap = (o, n) => { const k = Object.keys(o); if (k.length <= n) return o; return Object.fromEntries(Object.entries(o).sort((a, b) => cv(b[1]) - cv(a[1])).slice(0, n)); };   // v5.6: без бесконечного роста
  if (got) Object.assign(patch, { loot: cap(L, 200), lootSpecial: cap(S, 120), lootValue: (env.rt.lootValue || 0) + value, resGot: RG });
  if(farmChanged)patch.farmGot=farmGot;if(recipeChanged)patch.recipeGot=recipeGot;
  if (campCh) Object.assign(patch, { campaign: { ...campaign, live: Date.now() }, campaignDue: campaign.targets.some(t => t.res && t.ok && t.est) || env.rt.campaignDue });
  await env.setRt(patch);
}
 return { BLUNT, crushFirst, isCrush, spoilWait, festRestore, crafterPike, crafterNoSpoil, faKind, faNote, faRateNote, spoilPick, massSpoilPick, festivalParse, massSpoilStep, spoilStep, sweepStep, resQuests, resHave, trackLoot };
 };
})(globalThis);
