/* L2wap v7: isolated raid feature module. Dependencies are injected lazily.
   All game actions remain under the central lease and dispatcher in content.js. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.raid = function create_raid(env) {
const rbDue = () => env.cfg.rbMode && ((env.rt.rbPending && (env.meHp()?.pct ?? 0) >= env.cfg.rbRestHp) || (env.rt.sinceRb ?? 999) >= 20
  || (env.cfg.rbTour !== false && !env.campActive() && Date.now() >= (env.rt.rbTourNext || 0)));

function raidList() {                          // метки РБ на карте: title «Око Белефа · ур. 35 · рейд-босс»
  const ids = env.aroundSig().ids;
  return [...document.querySelectorAll('.l2-map-mob-pin--raid[data-spawn-id]')].map(b => {
    const t = b.getAttribute('title') || b.getAttribute('aria-label') || '', m = t.match(env.LV_RE);
    return { id: b.dataset.spawnId, name: m ? m[2].trim() : t, lvl: m ? +m[3] : 0, idx: ids.indexOf(b.dataset.spawnId) };
  });
}

function rbVerdictBlocks(id) {
  const d = env.rt.rbDb?.[id];
  return !!d && d.verdict === 'no' && d.heroLvl >= env.heroLvl();
}

const rbLo = h => h - Math.min(env.cfg.rbMaxBelow > 0 ? env.cfg.rbMaxBelow : env.RB_WIN, env.RB_WIN);

const rbHi = h => h + Math.min(env.cfg.rbMaxAbove ?? env.RB_WIN, env.RB_WIN);

const farmRbOn = () => !!env.rt.farmRb && Date.now() - (env.rt.farmRb.t || 0) < 15 * 60000;

function rbCandidates() {                      // окно уровня: ниже героя на rbMaxBelow (0 = любые), выше — на rbMaxAbove
  const h = env.heroLvl();
  const want = env.rt.rbWant && raidList().find(r => r.id === env.rt.rbWant);   // прилетели к нему по списку РБ — он первый (v4.30: и без места в списке — через метку)
  if (!env.cfg.rbMode) return farmRbOn() && want && want.id === env.rt.farmRb.id && !rbVerdictBlocks(want.id) ? [want] : [];   // v5.6: фарм ресурса с РБ — только этот РБ
  // v5.6: «мало банок» (rbPreSkip) тоже пропускаем 30 мин — раньше такой РБ выбирался снова и снова, и бот не фармил мобов
  const skip = id => !!env.rt.rbList?.[id]?.deny || Date.now() - (env.rt.rbSkip?.[id] || 0) < 30 * 60000 || Date.now() - preSkip(id).t < 30 * 60000;
  if (want && !rbVerdictBlocks(want.id) && !skip(want.id)) return [want];
  return raidList().filter(r => r.lvl >= rbLo(h) && r.lvl <= rbHi(h) && !rbVerdictBlocks(r.id) && !skip(r.id))
    .sort((a, b) => (b.id === env.rt.rbCur) - (a.id === env.rt.rbCur)
      || (env.cfg.rbOrder === 'down' ? b.lvl - a.lvl : a.lvl - b.lvl)                      // v4.39: сначала самые слабые; v4.45 — или сильные
      || (env.rt.rbDb?.[b.id]?.verdict === 'ok') - (env.rt.rbDb?.[a.id]?.verdict === 'ok')   // при равном уровне — проверенные «по силам»
      || (b.idx >= 0) - (a.idx >= 0) || a.idx - b.idx);
}

async function rbPinAttack(r, label) {
  const pin = env.$q(`.l2-map-mob-pin[data-spawn-id="${CSS.escape(r.id)}"]`);   // v5.5: и метка эпика
  if (!pin || !env.on) return false;
  env.setStatus(label);
  env.rec('B', 'РБ', `${r.name} (${r.lvl}): в списке мобов нет — через метку на карте`);
  env.fire(pin);
  const go = await env.waitFor(() => { const a = env.$q('#map-mob-modal-battle'); return env.shown(a) ? a : null; }, 3000, 100);
  await env.setRt({ target: { name: r.name, champ: true, quest: false, rb: true }, mobClickAt: Date.now(), via: 'map' });
  if (go) env.fire(go); else location.href = '/battle.html?spawnId=' + encodeURIComponent(r.id);
  await env.waitFor(env.isBattle, 10000);
  return true;
}

function rbModalStats() {                          // 8.0.3 (эпики, снимок 75dac78f): окно босса на странице «Эпик боссы» — #rb-modal-stats
  const o = {};
  document.querySelectorAll('#map-mob-modal-stats dt[data-stat], #rb-modal-stats dt[data-stat]').forEach(dt => { const v = +(dt.nextElementSibling?.textContent || '').replace(/\D/g, ''); if (v) o[dt.dataset.stat] = v; });
  return o.hp ? o : null;
}

// 7.2.1 (лог 10.10 21:32–21:46: «много РБ на 8–9 ур. ниже, а бот пропускает»): спецудар незнакомого РБ считался как 6,8 × обычный удар,
// а у Орка Тимака Госмоса (45) реально 1344 при обычном ≈313 — ×4,3. Множитель — по реальным боям (спецудар / обычный удар по P.Atk),
// с запасом 15 %; замеров нет — ×5,5
function rbSpK() {
  const k = env.rt.rbK || 0.109, S = env.rt.rbStats || {};
  const r = Object.entries(env.rt.rbDb || {}).map(([id, d]) => d.sp > 0 && S[id]?.patk ? d.sp / (S[id].patk * k) : 0).filter(x => x > 1 && x < 20).sort((a, b) => a - b);
  return r.length ? Math.min(6.8, Math.max(3, r[r.length >> 1] * 1.15)) : 5.5;
}
// 8.0 (аудит РБ, логи 10.10 21:31–23:30): спецудар РБ — магический, считать его от P.Atk было ошибкой. Замеры: спецудар / M.Atk
// РБ = 0,71–0,90 у 11 РБ (Верфа 2600 при M.Atk 3110, Селян 1853 при 2217), а от P.Atk — разброс 2,2–7,2. Оценка «на глаз»
// давала Верфе 1055 (реально 2600 — 60 % HP героя), Голему ≈24 % при M.Atk 4204. Множитель — по своим боям (p75 × 1,15), нет — 1,05
function rbSpM() {
  const S = env.rt.rbStats || {};
  const r = Object.entries(env.rt.rbDb || {}).map(([id, d]) => d.sp > 0 && S[id]?.matk > 0 ? d.sp / S[id].matk : 0).filter(x => x > 0.2 && x < 3).sort((a, b) => a - b);
  if (r.length < 3) return 1.05;
  return Math.min(1.4, Math.max(0.9, r[Math.floor(r.length * 0.75)] * 1.15, r[r.length >> 1] * 1.25));
}
// 8.0.3 (эпики): dpsOver — свой ДПС по этому боссу (эпики: осторожная оценка до первого замера), hpOver — макс. HP героя, известное
// вызывающему (у эпиков без него вердикт «неизвестно» — запасные 6000 HP решать не должны: на 6000 Королева «по силам»)
// 8.0.3 (лог 11.10 11:42–11:44, Орфен): эпик — l2dop_rb_290xx, есть в списке эпиков / epicDb или игра назвала его kind 'epic'
// 8.0.3 (ревью): в 290xx есть и обычные РБ тура — эпики только по списку эпиков игры (8 штук) и kind 'epic'
const EPIC_IDS = new Set(['29001', '29006', '29014', '29019', '29020', '29022', '29028', '29045']);
const isEpicId = id => EPIC_IDS.has(String(id || '').replace(/^l2dop_rb_/i, '')) || !!env.epicById?.(id) || env.rt.rbStats?.[id]?.kind === 'epic'
  || Object.values(env.rt.epicDb || {}).some(e => e && e.id === id);
// 10.0.2: ожидаемый ДПС по этому РБ — свой замер (rbDb.dps), иначе общий ДПС по РБ с поправкой на уровни выше героя (лог 12.10: +8 ур. ≈0,6,
// +14 ур. ≈0,55 от урона по РБ своего уровня) — −5 % за уровень, не меньше половины
function rbDpsOn(id) {
  const d = env.rt.rbDb?.[id] || {};
  if (d.dps > 0) return d.dps;
  const lvl = env.rt.rbList?.[id]?.lvl || d.lvl || 0, gap = lvl && env.heroLvl() ? lvl - env.heroLvl() : 0;
  return Math.max(1, (env.rt.rbDps || 1150) * (gap > 0 ? Math.max(0.5, 1 - 0.05 * gap) : 1));
}
// 10.0.2: недобитый — HP с последнего замера в бою (rbWound, 30 мин), а не только после своего отхода
const rbHpNow = (id, hp) => { const w = env.rt.rbWound?.[id]; return Math.min(hp, env.rt.rb?.[id]?.hpAfter || hp, w && Date.now() - (w.t || 0) < 30 * 60000 && w.cur > 0 ? w.cur : hp); };
function rbPreCheck(id, st, slack = 1, dpsOver, hpOver) {
  const me = env.meHp(), maxHp = hpOver > 0 ? hpOver : me?.max || 6000;
  const historical = env.rt.rbDb?.[id] || {};
  const k = env.rt.rbK || 0.109, base0 = Math.max(0, st.patk || 0) * k;
  // 8.0.3 (лог 11.10 11:42–11:44): Орфен бил КАЖДЫМ ударом 2508–2885 (0,64–0,74 × P.Atk 3920, крит почти не больше), а модель —
  // «обычный ≈218» (rbK выучен на обычных РБ). У эпика, пока на нём нет своего замера (hitP90), обычный удар ≈0,7 × max(P.Atk, M.Atk),
  // разброс ×1,1, потеря ≈ удар раз в 4 с (реально ≈650 HP/с: удар раз в 1,6–2,5 с, ≈60 % попаданий)
  const epic = isEpicId(id), epicHit = epic ? (historical.hitP90 > 0 ? historical.hitP90 : 0.7 * Math.max(st.patk || 0, st.matk || 0)) : 0;
  const base = Math.max(base0, epicHit);
  const curHp = st.hpExact ? st.hp || 0 : rbHpNow(id, st.hp || 0);   // 8.0.3: эпики передают HP сами (свежесть раны — epicWoundHp)
  const dps = Math.max(1, dpsOver || rbDpsOn(id)), t = curHp / dps;
  const pot = env.potModel(), pool = pot?.pool || 0;
  const p90 = historical.hitP90 || historical.p90 || (epic ? Math.max(150, base * 1.1) : Math.max(150, base * 1.65));
  // An observed special is authoritative; otherwise use a deliberately conservative estimate.
  const sp = historical.sp > 0 ? historical.sp : Math.max(base0 * rbSpK(), (st.matk || 0) * rbSpM());
  const measured = historical.sp > 0;
  let loss = st.loss || (env.rt.rbLossK ? st.patk * env.rt.rbLossK : Math.max(0, base * 0.876 - 90));
  if (epic && !(env.rt.rbStats?.[id]?.loss > 0)) loss = Math.max(loss, base * 0.25);   // 8.0.3: своего замера потерь на эпике нет
  const need = loss * t;
  const potRate = pot?.rate || 0;
  const info = `спецудар ${Math.round(sp)} HP${measured ? ' (из боёв)' : ' (оценка)'}, обычный ≈${Math.round(base)}, ` +
    `потеря ≈${Math.round(loss)} HP/с, РБ HP ${env.fmtK(curHp)} ≈${env.fmtT(t)}, ` +
    `банки ≈${env.fmtK(need)} из ${env.fmtK(pool)}`;
  // по прикидке (РБ ни разу не видели — цифры по другим РБ) отсекаем только явно неподъёмных; на месте решат настоящие цифры из окна карты
  const lim = st.est ? 1.5 : 1;
  const x = { sp: Math.round(sp), spPct: Math.round(sp / maxHp * 100), p90: Math.round(p90), t: Math.round(t), need: Math.round(need), pool };   // 8.0.3: цифры — для таблицы эпиков
  const no = r => probeOk(id, st, sp, maxHp, measured, epic, r) || r;
  // 10.0.2 (игрок 12.10: «плохо фармит РБ, особенно сильных»; лог 22:16–22:46: Галлате 73 и Голконда 79 — по ≈25–43 мин боя каждый, ни один
  // не убит, две смерти): бой дольше предела (cfg.rbMaxKillMin, 20 мин; 0 — без предела) — не сейчас (пропуск 30 мин, не «не по силам»).
  // Эпики (свой ДПС от вызывающего) — по своим правилам
  const maxMin = env.cfg.rbMaxKillMin ?? 20;
  if (!epic && !dpsOver && maxMin > 0 && t > maxMin * 60) return { ok: false, kind: 'slow', why: `долгий бой ≈${env.fmtT(t)} (урон ≈${Math.round(dps)}/с${historical.dps > 0 ? ', свой замер' : ''}, предел ${maxMin} мин) · ${info}`, ...x };
  if (sp >= maxHp * 0.45 * lim) return no({ ok: false, kind: 'strong', why: `спецудар ${Math.round(sp / maxHp * 100)}% HP героя · ${info}`, ...x });
  if (sp + 2 * p90 >= maxHp * 0.60 * lim) return no({ ok: false, kind: 'strong', why: `опасная комбинация спецудара и двух обычных ударов · ${info}`, ...x });
  if (loss > potRate * 0.8 * slack && loss > 0) return no({ ok: false, kind: 'strong', why: `банки не успевают: максимум ${Math.round(potRate)} HP/с · ${info}`, ...x });
  if (need * 1.15 > pool * slack) return { ok: false, kind: 'pots', why: `${pool ? 'недостаточный резерв банок' : 'нет подтверждённого запаса банок'} · ${info}`, ...x };
  return { ok: true, confidence: measured ? 'observed' : 'estimated', why: `Предварительная оценка, не гарантия победы · ${info}`, ...x };
}

// 9.2.5 (игрок 12.10: «скинул список РБ, в которых бот не уверен, а он всё равно не шёл всех проверять»): «не по силам» по ОЦЕНКЕ спецудара
// (0,9–1,4 × M.Atk РБ, свой спецудар этого РБ ни разу не видели) не проверялось никогда: оценка не даёт идти — нет боя — нет замера. Пробный
// заход (cfg.rbProbe, по умолчанию ВКЛ): обычный РБ, цифры игры (не прикидка по другим РБ), оценка спецудара < 80 % макс. HP (полное HP
// его переживает, банки держат HP выше оценки), один раз на уровень героя (rbDb.probe; заход повторяется 3 ч — телепорт, отдых). В бою rbFlee держит HP выше
// оценки × 1,1, пока спецудар не замерен; замерили — дальше решают настоящие цифры (rbFlee / «не по силам» до нового уровня)
const PROBE_MS = 3 * 3600000;
function probeOk(id, st, sp, maxHp, measured, epic, r) {
  if (env.cfg.rbProbe === false || measured || epic || st.est || !(maxHp > 0) || sp >= maxHp * 0.8 || rbVerdictBlocks(id)) return null;
  const pr = env.rt.rbDb?.[id]?.probe;
  if (pr && pr.lvl >= env.heroLvl() && Date.now() - (pr.t || 0) > PROBE_MS) return null;   // на этом уровне уже пробовали
  return { ...r, ok: true, probe: true, confidence: 'probe', why: `🧪 пробный заход — свой спецудар не видел, оценка: ${r.why}` };
}
// бой-проба (3 ч с начала): «не убить» / отход — выходим штатной кнопкой, а не «бьюсь до конца на банках»
// 10.0.2 (лог 12.10 22:12–22:35: «Предварительная оценка» по замеренному спецудару, а бой всё равно шёл как проба — выход после каждого
// спецудара): проба кончается, когда спецудар замерен (как у probeGuard), а не через 3 ч
const probeFight = id => { const d = env.rt.rbDb?.[id] || {}, pr = d.probe; return !!pr && !(d.sp > 0) && Date.now() - (pr.t || 0) < PROBE_MS; };
// бой-проба: спецудар этого РБ ещё не замерен — порог HP героя (оценка × 1,1), ниже — выходим из боя
function probeGuard(id) {
  const d = env.rt.rbDb?.[id] || {}, pr = d.probe;
  return pr && !(d.sp > 0) && Date.now() - (pr.t || 0) < PROBE_MS && pr.sp > 0 ? Math.round(pr.sp * 1.1) : 0;
}

// 7.2.1 (лог 10.10 21:32:54–21:33:09, смерть): окно карты ещё показывало «Розпалений Голем · ур. 44 · NPC 25431» (HP 273k, удар ≈110),
// бот прочёл его как «Король Тарлк» (48, 920k HP) — «иду: спецудар 747» — и героя с 4022 HP убили одним ударом через 7 с.
// Данные Тарлка пришли через 0,3 с после решения. Теперь окно должно показать ИМЕННО этого РБ (номер NPC из spawnId или имя)
const nmNorm = s => String(s || '').toLowerCase().replace(/[’'`ʼ]/g, '').replace(/\s+/g, ' ').trim();
function rbModalIs(r) {
  const m = env.$q('#map-mob-modal');
  if (!m || !env.shown(m)) return false;
  const npc = String(env.$q('#map-mob-modal-sub')?.textContent || '').match(/NPC\s*(\d+)/i)?.[1], idN = String(r.id || '').match(/(\d+)$/)?.[1];
  if (npc && idN) return npc === idN;
  const t = nmNorm(env.$q('#map-mob-modal-title')?.textContent), n = nmNorm(r.name);
  return !!t && !!n && (t.includes(n) || n.includes(t));
}
async function rbScout(r) {
  const pin = env.$q(`.l2-map-mob-pin[data-spawn-id="${CSS.escape(r.id)}"]`);   // v5.5: и метка эпика
  if (!pin) return null;
  if (env.shown(env.$q('#map-mob-modal')) && !rbModalIs(r)) { closeMobModal(); await env.sleep(250); }
  env.fire(pin);
  const st = await env.waitFor(() => rbModalIs(r) ? rbModalStats() : null, 4000, 100);
  if (!st) return null;
  // 8.0: сливаем с прошлой записью — раньше повторный осмотр стирал замер потерь HP по этому РБ (loss)
  const merged = { ...(env.rt.rbStats?.[r.id] || {}), ...st, t: Date.now() };
  await env.setRt({ rbStats: { ...(env.rt.rbStats || {}), [r.id]: merged } });
  return rbPreCheck(r.id, merged);
}

const closeMobModal = () => { const c = env.$q('#map-mob-modal-close'); if (env.shown(c)) env.fire(c); };

async function rbEngage(r, label, opt = {}) {
  let chk = await rbScout(r);
  // v5.5: эпик бьём заходами (смерть → хил → снова) — оценку «не по силам» не применяем, если её не включили
  if (opt.epic && chk && !chk.ok && !env.cfg.epicCheck && chk.kind !== 'strong') { env.rec('B', 'эпики', `${r.name}: предупреждение «${chk.why}» — разрешаю пробный заход`); chk = { ok: true, why: 'эпик: пробный заход' }; }
  if (chk && !chk.ok) {
    closeMobModal();
    // v5.2: «мало банок» — не приговор РБ: закупим банки — снова можно. Такой РБ пропускаем 30 мин, «не по силам» не пишем
    // 7.2.1: «не по силам» по ОЦЕНКЕ — не вечный приговор (оценка бывает по чужим цифрам: лог 21:32 — окно карты от другого РБ);
    // пропуск на 30 мин, цифры РБ сохранены — следующая проверка до телепорта увидит их сама. Вечный «не по силам» — только по бою
    await env.setRt({ rbPreSkip: { ...(env.rt.rbPreSkip || {}), [r.id]: { t: Date.now(), kind: chk.kind === 'pots' || chk.kind === 'slow' ? chk.kind : 'strong' } } });   // 8.0: с видом — «сильный» больше не пишется как «мало банок»
    if (chk.kind !== 'pots' && chk.kind !== 'slow') await rbNote(r.id, { name: r.name, lvl: r.lvl, note: 'оценка до боя: ' + chk.why });
    env.rec('B', 'РБ', `${r.name} (${r.lvl}): не полезу — ${chk.why}`);
    return 'skip';
  }
  if (chk) env.rec('B', 'РБ', `${r.name} (${r.lvl}): иду — ${chk.why}`);
  if (chk?.probe && !probeFight(r.id)) await rbNote(r.id, { name: r.name, lvl: r.lvl, probe: { t: Date.now(), lvl: env.heroLvl(), sp: chk.sp } });   // 9.2.5: начало пробы
  await env.setRt({ rbPlan: { name: `${r.name} (${r.lvl})`, ok: chk ? chk.ok : null, why: chk ? chk.why : 'окна РБ нет — без оценки', t: Date.now() } });
  const go = env.$q('#map-mob-modal-battle');
  if (chk && env.shown(go)) {
    env.setStatus(label);
    await env.setRt({ target: { name: r.name, champ: true, quest: false, rb: true }, mobClickAt: Date.now(), via: 'map' });
    await env.pause(); env.fire(go);
    if (await env.waitFor(env.isBattle, 10000)) return true;
  }
  closeMobModal();
  if (r.idx >= 0 && await env.attackSpawn({ ...r, rb: true, champ: true, rank: 0 }, () => label)) return true;
  return rbPinAttack(r, label);
}

// 8.0.3 (эпики, разбор 11.10): разбор ответа GET /game/spawn/<id>/info — и своего запроса (rbInfo), и того, что шлёт сама игра
// (нажатие на РБ на карте, окно босса на странице «Эпик боссы»: пассивно из сети). Любой ответ сервера — src:'api' (по нему тур РБ
// проверяет РБ ДО платного телепорта: st.src === 'api'), откуда он — в from ('api' свой запрос / 'page' игра). Массив drops hook.js
// режет до 8 (последний элемент — строка «…ещё N») — берём только объекты
async function rbInfoNote(id, j, from = 'api') {
  const s = j?.stats; if (!id || !(s?.maxHp > 0)) return null;
  const have = env.rt.rbStats?.[id] || {}, drops = (Array.isArray(j.drops) ? j.drops : []).filter(d => d && typeof d === 'object');
  const ad = drops.find(d => d.kind === 'adena');
  const top = env.epicById?.(id) ? drops.filter(d => d.kind !== 'adena').sort((a, b) => (+b.chance || 0) - (+a.chance || 0)).slice(0, 3)
    .map(d => ({ n: String(d.displayName || d.name || d.l2ItemId || '').slice(0, 40), c: +d.chance || 0 })) : null;
  const st = { ...have, hp: s.maxHp, patk: s.pAtk || 0, pdef: s.pDef || 0, matk: s.mAtk || 0, mdef: s.mDef || 0, t: Date.now(), src: 'api', from, ...(j.kind ? { kind: String(j.kind).slice(0, 12) } : {}),
    ...(ad ? { adena: Math.round(((+ad.min || 0) + (+ad.max || 0)) / 2 * (ad.chance ?? 1)) } : {}),
    ...(+j.rewardExp > 0 ? { exp: +j.rewardExp } : {}), ...(+j.rewardSp > 0 ? { sp: +j.rewardSp } : {}), ...(top?.length ? { top } : {}),
    ...(typeof j.canAttackRaidBoss === 'boolean' ? { canAttack: j.canAttackRaidBoss } : {}), ...(+j.minRaidBossLevelForAttack > 0 ? { minLvl: +j.minRaidBossLevelForAttack } : {}) };
  await env.setRt({ rbStats: { ...(env.rt.rbStats || {}), [id]: st } });
  return st;
}

// 8.0 (аудит РБ C1: 3 из 18 телепортов по 100 000 аден впустую — «не полезу» уже после прилёта): цифры РБ (HP, P.Atk, M.Atk,
// адена) отдаёт GET /game/spawn/<id>/info — тот же запрос, что игра шлёт при нажатии на РБ на карте. Спрашиваем ДО телепорта,
// раз на РБ (цифры РБ постоянные); не ответил — 6 ч не спрашиваем, решаем как раньше (на месте)
// 8.0.3 (логи 10–11.10: 100 000 аден за Тарлка трижды — после переустановки цифр нет, проверка до телепорта молча пропускалась):
// цифры РБ/эпиков из ответов /game/spawn/<id>/info (постоянные) — [HP, P.Atk, P.Def, M.Atk, M.Def]; ключ — номер из l2dop_rb_<N>
// 9.0 (база знаний kb/, снято с игры 11.10): все 197 РБ из /game/raid-bosses + /game/spawn/<id>/info (kb/data/game-raid-bosses.json),
// по уровню; в конце эпики Ядро и Орфен. У 5 РБ 60–66 (Гекатон, Кастор, Древний Дрейк, Фальстон, Тимініель) цифры 8.0.3 были неточны —
// заменены ответами игры. Остальных эпиков здесь нет — их цифры бот спрашивает сам (rbInfo из epics)
const RB_KNOWN = {
  '25372': [175392, 256, 283, 62, 307], '25375': [87696, 127, 283, 13, 307], '25378': [87696, 127, 283, 13, 307], '25146': [90169, 141, 295, 21, 319],
  '25357': [90169, 141, 295, 21, 319], '25373': [90169, 141, 295, 21, 319], '25380': [90169, 141, 295, 21, 319], '25001': [95986, 168, 320, 22, 345],
  '25362': [95986, 168, 320, 22, 345], '25366': [95986, 168, 320, 22, 345], '25060': [99367, 186, 284, 29, 361], '25127': [198734, 373, 284, 127, 361],
  '25019': [206185, 409, 347, 136, 377], '25076': [103092, 204, 347, 30, 377], '25149': [103092, 204, 347, 30, 377], '25166': [134813, 382, 347, 121, 377],
  '25369': [103092, 204, 347, 30, 377], '25426': [103092, 204, 347, 30, 377], '25429': [103092, 204, 347, 30, 377], '25360': [107186, 223, 362, 38, 390],
  '25365': [214372, 449, 362, 154, 390], '25038': [116581, 267, 390, 48, 423], '25272': [233163, 537, 390, 192, 423], '25095': [121941, 292, 407, 48, 440],
  '25004': [168366, 601, 422, 207, 457], '25079': [168366, 601, 422, 207, 457], '25112': [127782, 320, 359, 58, 457], '25169': [336732, 1202, 422, 829, 457],
  '25188': [255564, 641, 422, 232, 457], '25352': [127782, 320, 422, 58, 457], '25501': [127782, 320, 422, 58, 457], '25392': [141034, 382, 454, 85, 491],
  '25401': [141034, 382, 454, 85, 491], '25128': [148507, 415, 401, 95, 511], '25391': [297015, 833, 472, 383, 511], '25404': [148507, 415, 472, 95, 511],
  '25020': [156584, 451, 416, 106, 529], '25023': [208019, 848, 489, 363, 529], '25189': [156584, 451, 489, 106, 529], '25383': [156584, 451, 489, 106, 529],
  '25041': [165289, 491, 508, 108, 550], '25063': [330579, 985, 508, 459, 550], '25098': [330579, 985, 508, 459, 550], '25118': [330579, 985, 432, 459, 550],
  '25152': [165289, 491, 508, 108, 550], '25185': [165289, 491, 432, 108, 550], '25223': [165289, 491, 508, 108, 550], '25354': [165289, 491, 508, 108, 550],
  '25388': [165289, 491, 508, 108, 550], '25398': [165289, 491, 508, 108, 550], '25211': [174646, 534, 526, 128, 568], '25385': [174646, 534, 526, 128, 568],
  '25506': [184670, 581, 545, 139, 590], '25170': [195371, 629, 480, 151, 611], '25394': [390743, 1262, 565, 604, 611], '25082': [206753, 681, 584, 163, 633],
  '25504': [206753, 681, 584, 163, 633], '25064': [218810, 739, 514, 175, 655], '25115': [294846, 1382, 605, 623, 655], '25134': [218810, 739, 514, 175, 655],
  '25155': [294846, 1382, 605, 623, 655], '25208': [218810, 739, 605, 175, 655], '25214': [218810, 739, 605, 175, 655], '25410': [218810, 739, 605, 175, 655],
  '25415': [218810, 739, 605, 175, 655], '25487': [218810, 739, 605, 175, 655], '25490': [218810, 739, 605, 175, 655], '25007': [331522, 1617, 647, 934, 700],
  '25088': [702418, 3493, 669, 4204, 723], '25192': [258849, 933, 669, 295, 723], '25085': [371721, 1884, 691, 1170, 747], '25099': [273375, 1008, 691, 331, 747],
  '25418': [273375, 1008, 691, 331, 747], '25431': [273375, 1008, 691, 331, 747], '25438': [273375, 1008, 691, 331, 747], '25057': [288415, 1084, 714, 368, 773],
  '25102': [576831, 2171, 714, 1493, 773], '25173': [288415, 1084, 714, 368, 773], '25260': [392985, 2028, 714, 1293, 773], '25395': [288415, 1084, 714, 368, 773],
  '25437': [576831, 2171, 714, 1493, 773], '25441': [288415, 1084, 714, 368, 773], '25498': [288415, 1084, 714, 368, 773], '25044': [319791, 1255, 760, 454, 824],
  '25412': [319791, 1255, 760, 454, 824], '25158': [920790, 5043, 785, 7287, 848], '25420': [335987, 1348, 785, 516, 848], '25026': [352421, 1445, 808, 568, 876],
  '25047': [352421, 1445, 808, 568, 876], '25456': [352421, 1445, 808, 568, 876], '25013': [507285, 2894, 833, 2217, 904], '25119': [507285, 2894, 833, 2217, 904],
  '25131': [369009, 1546, 833, 633, 904], '25217': [369009, 1546, 708, 633, 904], '25273': [507285, 2894, 833, 2217, 904], '25277': [507285, 2894, 708, 2217, 904],
  '25484': [369009, 1546, 833, 633, 904], '25050': [771340, 3310, 859, 3110, 929], '25460': [385670, 1653, 859, 769, 929], '25067': [865238, 4302, 3008, 3844, 2600],
  '25473': [627618, 2297, 3008, 1104, 2600], '25496': [627618, 2297, 3008, 1104, 2600], '25512': [1255236, 4596, 3008, 4434, 2600], '25029': [901976, 4588, 3129, 4282, 2824],
  '25481': [653444, 2449, 3129, 1227, 2824], '25509': [653444, 2449, 3129, 1227, 2824], '25159': [678999, 2610, 2600, 1353, 3047], '25010': [974164, 5195, 3375, 5114, 3279],
  '25070': [704170, 2774, 3375, 1468, 3279], '25103': [704170, 2774, 2707, 1468, 3279], '25137': [704170, 2774, 3375, 1468, 3279], '25176': [704170, 2774, 3375, 1468, 3279],
  '25241': [974164, 5195, 3375, 5114, 3279], '25259': [1498714, 7995, 2596, 2762, 2522], '25280': [1948328, 2945, 3375, 1608, 3279], '25434': [704170, 2774, 3375, 1468, 3279],
  '25475': [704170, 2774, 2707, 1468, 3279], '25493': [704170, 2774, 3375, 1468, 3279], '25122': [728846, 2945, 2818, 1600, 3510], '25463': [728846, 2945, 3510, 1600, 3510],
  '25230': [784307, 3127, 4143, 1736, 3510], '25032': [1121770, 6195, 4178, 6547, 3764], '25089': [832316, 3497, 4185, 2033, 4026], '25182': [832316, 3497, 4185, 2033, 4026],
  '25238': [832316, 3497, 4185, 2033, 4026], '29060': [255965, 4969, 4534, 5220, 4026], '25016': [1187804, 6910, 4157, 4808, 4287], '25106': [855105, 3695, 4190, 2248, 4287],
  '25162': [2375607, 4723, 2890, 3986, 4287], '25179': [855105, 3695, 4190, 2248, 4287], '25234': [1710209, 7389, 4190, 5625, 4287], '25256': [855105, 3695, 4190, 2248, 4287],
  '25407': [855105, 3695, 4190, 2248, 4287], '29056': [306111, 6010, 4550, 6335, 4287], '25423': [1877023, 3895, 4195, 2569, 4550], '25226': [1298827, 7660, 4550, 4339, 4550],
  '25467': [2974878, 4519, 5641, 3011, 5015], '25051': [2384041, 8830, 5780, 5941, 5256], '25125': [2768081, 4663, 5780, 4784, 5256], '25140': [3384041, 8830, 5780, 5941, 5256],
  '25255': [2768081, 4663, 4480, 4784, 5256], '25444': [1993950, 4733, 5780, 3159, 5256], '25478': [2293950, 4733, 5780, 3159, 5256], '25322': [2409850, 9229, 5924, 3413, 5517],
  '25470': [1012137, 4949, 5924, 3292, 5517], '25263': [2434454, 9629, 5149, 5950, 5758], '25073': [2480352, 10426, 6356, 5170, 6253], '25233': [2123774, 11210, 6356, 6280, 6253],
  '25035': [1501832, 10819, 5333, 8600, 6465], '25092': [1501832, 9519, 5516, 4200, 7540], '25163': [3003666, 8642, 3279, 5820, 4714], '25198': [3003666, 8642, 4524, 8420, 6266],
  '25252': [1501832, 6919, 5516, 8600, 6326], '25269': [1501832, 9519, 5512, 6005, 6829], '25281': [3003666, 8642, 5239, 5820, 7228], '25325': [1501832, 10819, 5226, 6200, 6656],
  '25453': [1501832, 8219, 5343, 7300, 6206], '25328': [1522465, 11210, 6990, 8493, 8762], '25447': [1091661, 6035, 6990, 4502, 8739], '25199': [5542351, 11596, 7268, 8043, 8764],
  '25235': [1542351, 11596, 7268, 5543, 9268], '25248': [3084705, 10197, 7255, 5515, 8244], '25220': [3561598, 11974, 7539, 5663, 8676], '25523': [3123197, 10950, 6239, 6894, 7131],
  '25109': [5580306, 12337, 5850, 7213, 7800], '25202': [3580306, 11037, 7618, 7213, 9663], '25296': [1580306, 12337, 5850, 8213, 7800], '25054': [3660055, 12697, 8991, 7774, 10608],
  '25229': [3320110, 12396, 7691, 6357, 8553], '25244': [3320110, 8496, 6391, 10057, 7500], '25249': [2660055, 12697, 8991, 8774, 9906], '25266': [2660055, 12697, 7150, 5774, 9327],
  '25276': [3320110, 12396, 8991, 7457, 10264], '25282': [3320110, 12396, 7691, 6657, 8801], '25205': [1678641, 11735, 7948, 4505, 8795], '25524': [3678641, 11735, 7948, 9505, 10079],
  '25143': [5485037, 4972, 9529, 8425, 11687], '25245': [1715037, 13673, 8515, 14525, 10154], '25290': [2715037, 13673, 9750, 9725, 11554], '25293': [3015037, 12373, 8450, 9725, 9815],
  '25126': [6194391, 9953, 9087, 5139, 10200], '25450': [3797195, 10972, 7943, 9349, 9049], '25283': [2983245, 8783, 9511, 9698, 10874], '25286': [2983245, 9083, 5611, 9398, 6971],
  '25299': [5500896, 7714, 9511, 6088, 10842], '25302': [2407866, 8029, 11512, 7001, 13325], '25305': [5584736, 8744, 7777, 6606, 8845], '25306': [12741708, 8806, 5915, 6718, 7564],
  '25309': [6300896, 7714, 9511, 6088, 11462], '25312': [3407866, 8029, 11512, 7001, 12672], '25315': [2084736, 11344, 6487, 7606, 8142], '25316': [10661708, 8806, 6616, 6718, 8181],
  '25319': [12403812, 9985, 8099, 9596, 9150], '25514': [14300896, 7714, 9511, 6088, 10270], '25527': [10727566, 12479, 8600, 9729, 9949], '29095': [6766049, 11920, 7865, 11385, 9942],
  '25517': [9874965, 3868, 8685, 9566, 9657], '29006': [876883, 3920, 2001, 3192, 2124], '29014': [487686, 3920, 1601, 3192, 1924] };
const rbKnown = id => { const k = RB_KNOWN[String(id || '').replace(/^l2dop_rb_/, '')]; return k ? { hp: k[0], patk: k[1], pdef: k[2], matk: k[3], mdef: k[4], src: 'api', from: 'known' } : null; };
const rbInfoNotes = new Map();
// 9.2.5 (игрок 12.10: «скинул список РБ, в которых бот не уверен, а он всё равно не шёл проверять»; лог 12.10 11:29): у 4 РБ 60–66
// (Кастор, Фальстон, Тимініель, Гекатон) в памяти лежали неточные цифры базового профиля 8.0.3 (from 'base803': M.Atk Кастора 9339 при
// настоящих 4339) — и шли ВПЕРЁД встроенных цифр игры (RB_KNOWN 11.10): «спецудар 131 % HP» вместо 61 %. Встроенные цифры теперь важнее
// записи base803 (once rbStats925 правит и саму память)
const staleStats = m => !m || !(m.hp > 0) || m.from === 'base803';
const rbStatsOf = id => { const mine = env.rt.rbStats?.[id], kn = rbKnown(id); return kn && staleStats(mine) ? { ...(mine || {}), ...kn } : mine; };
async function rbInfo(id) {
  const have = rbStatsOf(id);   // 8.0.3: и встроенные цифры (замеры — loss и т. п. — сохраняем)
  if (have?.matk > 0 && have?.hp > 0) return have;
  // 8.0.3: после ошибки — повтор через 10 мин (было 6 ч: весь тур шёл без проверки до телепорта)
  if (Date.now() - ((env.rt.rbInfoFail || {})[id] || 0) < 10 * 60000) return have || null;
  try {
    const c = new AbortController(), tm = setTimeout(() => c.abort(), 6000);
    // 9.0: с токеном страницы (без него сервер отвечает 401 — см. content.gameAuth)
    const r = await fetch(`/game/spawn/${encodeURIComponent(id)}/info`, { credentials: 'include', cache: 'no-store', headers: env.gameAuth?.() || {}, signal: c.signal }).finally(() => clearTimeout(tm));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const st = await rbInfoNote(id, j, 'api');
    if (!st) throw new Error('нет stats');
    return st;
  } catch (e) {
    await env.setRt({ rbInfoFail: { ...(env.rt.rbInfoFail || {}), [id]: Date.now() } });
    // 8.0.3: свой запрос бота журнал сети не видит — причину пишем сами (раз в 30 мин на РБ)
    if (Date.now() - (rbInfoNotes.get(id) || 0) > 30 * 60000) { rbInfoNotes.set(id, Date.now()); env.rec('B', 'РБ', `цифры ${env.rt.rbList?.[id]?.name || id} у игры не получены: ${String(e?.message || e).slice(0, 80)}`); }
    return have || null;
  }
}

// 8.0.3 (лог 11.10 11:43:34, шапка «Ядро(50)=?@bee_hive»): зона РБ писалась из rt.zone сразу после телепорта — там ещё прежняя зона фарма.
// Теперь телепорт к РБ/эпику и смерть сбрасывают rt.zone (content.zoneMoveNet, survival.onDeath), а перелёт по «Телепорту» (zonePend, 2 мин)
// — не повод писать зону: пишем только зону, которую карта определила уже на месте
const rbZoneNow = () => !(env.rt.zonePend && Date.now() - (env.rt.zonePend.t || 0) < 120000) && env.rt.zone || null;
async function rbNote(id, patch) {
  const prev = env.rt.rbDb?.[id] || { tries: 0, kills: 0 };
  await env.setRt({ rbDb: { ...(env.rt.rbDb || {}), [id]: { ...prev, ...patch, t: Date.now(), heroLvl: env.heroLvl(), zone: rbZoneNow() || prev.zone || null } } });
}

function rbTourPick() {
  const L = env.heroLvl(), lo = rbLo(L), hi = rbHi(L), now = Date.now();
  const visit = env.rt.rbZoneVisit || {}, cat = env.rt.zoneCat || {}, cur = env.rt.zone;
  const recent = z => now - (visit[z] || 0) < 40 * 60000;
  const out = [];
  const known = {};
  for (const [id, s] of Object.entries({ ...(env.rt.rbSeen || {}) })) {
    const d = env.rt.rbDb?.[id] || {}, z = d.zone || s.zone, lvl = d.lvl || s.lvl;
    if (!z || z === cur || /^out:/.test(z) || !lvl || lvl < lo || lvl > hi || rbVerdictBlocks(id) || recent(z)) continue;
    (known[z] ||= []).push(`${d.name || s.name} (${lvl})${d.verdict === 'ok' ? ' ✅' : ''}`);
    out.push({ id: z, score: d.verdict === 'ok' ? 0 : 1, why: `знакомые РБ: ${known[z].join(', ')}` });
  }
  for (const f of Object.values(env.rt.rbForum || {})) {
    if (!f.tp || f.tp === cur || !f.lvl || f.lvl < lo || f.lvl > hi || recent(f.tp)) continue;
    if (Object.values(env.rt.rbDb || {}).some(d => d.verdict === 'no' && d.heroLvl >= L && env.nameLike(d.name || '', f.name))) continue;
    out.push({ id: f.tp, url: f.url, score: 2, why: `по форуму: ${f.name} (${f.lvl})` });
  }
  for (const [id, c] of Object.entries(cat)) {
    if (id === cur || /^out:/.test(id) || c.town || !c.lo || c.hi < lo || c.lo > hi + 5 || recent(id)) continue;
    const scouted = Object.values(env.rt.rbSeen || {}).some(s => s.zone === id);  // уже была: РБ там есть, но тогда не по силам/убит — ниже в очереди
    out.push({ id, score: (scouted ? 4 : 3) + Math.abs((c.lo + c.hi) / 2 - L) / 100 + (c.price || 0) / 1e7, why: `${scouted ? 'повторная проверка' : 'разведка'} (мобы ${c.lo}-${c.hi}${c.price ? ', ' + c.price.toLocaleString('ru') + ' аден' : ''})` });
  }
  out.sort((a, b) => a.score - b.score);
  return out[0] || null;
}

const isRbPage = () => /\/rb-bosses\.html/i.test(location.pathname);

const rbPageNow = () => +((env.$q('#rb-pager-ind')?.textContent || '').match(/^\s*(\d+)\s*\//)?.[1] || new URLSearchParams(location.search).get('page') || 1);

// 8.0.3 (эпики, ревью): у страницы «Рейдовые боссы» та же строка, что у эпиков, где цена — «1 Coin of Luck». Цена РБ (снимок 23:00) —
// «(Аден 100000)». Валюта — как epics.unitOf; телепорт только за адену или бесплатно, иначе не летим (Coin of Luck бот не тратит)
const unitOf = t => /coin|luck|монет|удач|\bcol\b/i.test(t || '') ? 'Coin of Luck' : /аден|adena/i.test(t || '') ? 'аден' : '';
const rbPriceWhy = r => r && r.price > 0 && r.unit != null && r.unit !== 'аден' ? `телепорт не за адену («${r.priceText || r.price}») — Coin of Luck бот не тратит` : '';
const btnPrice = b => { const t = (b?.closest?.('.l2-rb-row')?.querySelector('.l2-rb-row__price')?.textContent || '').replace(/\s+/g, ' ').trim(); return { price: +(t.replace(/\D/g, '') || 0), unit: unitOf(t), priceText: t.slice(0, 40) }; };
function rbRowsParse() {
  const page = rbPageNow();
  const out = {};
  let i = 0;
  for (const r of document.querySelectorAll('#rb-list .l2-rb-row')) {
    const b = r.querySelector('.l2-rb-row__tp[data-spawn-id]'); if (!b) continue;
    const ord = page * 1000 + i++;                 // порядок в списке игры — тур идёт строго по нему
    const st = r.querySelector('.l2-rb-row__status');
    const hint = (r.querySelector('.l2-rb-row__attack-hint')?.textContent || '').trim();
    out[b.dataset.spawnId] = {
      name: (r.querySelector('.l2-rb-row__label')?.textContent || '').trim(),
      lvl: +((r.querySelector('.l2-rb-row__level')?.textContent || '').match(/\d+/) || [0])[0],
      alive: !!st && /--alive/.test(st.className), status: (st?.textContent || '').replace(/^\s*·\s*/, '').trim().slice(0, 40),
      price: +((r.querySelector('.l2-rb-row__price')?.textContent || '').replace(/\D/g, '') || 0),
      unit: unitOf(r.querySelector('.l2-rb-row__price')?.textContent), priceText: (r.querySelector('.l2-rb-row__price')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      deny: /недоступ|unavailable/i.test(hint) ? hint.replace(/^Недоступно:\s*/i, '').slice(0, 60) : '', page, ord, t: Date.now(),
    };
  }
  return out;
}

async function rbListScan() {                     // все страницы списка (≈14), бесплатно
  env.setStatus('РБ: читаю список рейд-боссов (Меню → Рейдовые боссы)');
  await env.waitX(() => env.$q('#rb-list .l2-rb-row'), 10000, 200);
  let all = {}, complete = false, pages = 0;
  for (let i = 0; i < 25 && env.on; i++) {
    all = { ...all, ...rbRowsParse() }; pages++;
    const nx = env.$q('#rb-pager-next');
    if (!nx || nx.disabled) { complete = true; break; }
    const sig = env.$q('#rb-pager-ind')?.textContent;
    env.fire(nx);
    if (!(await env.waitX(() => env.$q('#rb-pager-ind')?.textContent !== sig && env.$q('#rb-list .l2-rb-row'), 5000, 150))) break;
    await env.sleep(env.rnd(150, 300));
  }
  const L = env.heroLvl(), n = Object.values(all), ok = n.filter(x => x.alive && !x.deny);
  env.rbTimer?.domNote(all)?.catch?.(() => {});   // 10.0.2: таймеры боссов — кто жив / убит
  if (!n.length) {                                 // страница не загрузилась / не та — повтор через 3 мин, а не через 15
    env.rec('B', 'РБ', 'список рейд-боссов пуст (страница не загрузилась?) — повторю через 3 мин');
    await env.setRt({ rbScan: null, rbListT: Date.now() - 12 * 60000 });
    location.href = '/map.html'; await env.sleep(3000); return;
  }
  // 8.0.3 (лог 11.10 09:04:36: пауза на 9-й странице из 14 — 135 РБ из 197 записались как полный свежий список на 15 мин): прочитан не до
  // конца (пауза/страница не догрузилась) — дописываем к старому и перечитаем через 3 мин
  if (!complete) {
    await env.setRt({ rbList: { ...(env.rt.rbList || {}), ...all }, rbListT: Date.now() - 12 * 60000, rbScan: null });
    env.rec('B', 'РБ', `список игры прочитан частично (${pages} стр.) — дописал ${n.length} РБ к прежнему, перечитаю через 3 мин`);
    return;
  }
  await env.setRt({ rbList: all, rbListT: Date.now(), rbScan: null });
  env.rec('B', 'РБ', `список игры: ${n.length} РБ · живых ${n.filter(x => x.alive).length} · доступно мне ${ok.length}`
    + (ok.length ? ` (${ok.sort((a, b) => Math.abs(a.lvl - L) - Math.abs(b.lvl - L)).slice(0, 6).map(x => `${x.name} ${x.lvl}`).join(', ')}…)` : ''));
}

function rbStatsGuess(id, lvl) {
  const S = env.rt.rbStats || {}, own = rbStatsOf(id);
  if (own?.patk && own?.hp) return { ...own, est: false };   // свои цифры игры, иначе встроенные (8.0.3: переживают переустановку)
  const pts = Object.entries(S).map(([k, v]) => ({ ...v, lvl: env.rt.rbList?.[k]?.lvl || env.rt.rbDb?.[k]?.lvl || 0 })).filter(x => x.lvl && x.patk && x.hp);
  if (!pts.length || !lvl) return null;
  // v5.2.2: медиана по всем замерам, а не ближайший по уровню: один «выброс» (Король Тарлк 48 ур.: P.Atk 5043 при обычных
  // 1100–1450) делал «мало банок» для всех РБ 47–50 ур. — лог 08.10 13:42: 47 РБ отброшены при 198 банках
  const med = a => { a = a.slice().sort((x, y) => x - y); return a[a.length >> 1]; }, c3 = l => Math.pow(lvl / l, 3);
  const pm = pts.filter(x => x.matk > 0);   // 8.0: и M.Atk — от него спецудар
  return { hp: Math.round(med(pts.map(x => x.hp * c3(x.lvl)))), patk: Math.round(med(pts.map(x => x.patk * c3(x.lvl)))),
    ...(pm.length ? { matk: Math.round(med(pm.map(x => x.matk * c3(x.lvl)))) } : {}), est: true, n: pts.length };
}

const rbSkipNotices = new Map();
const preSkip = id => { const v = env.rt.rbPreSkip?.[id]; return typeof v === 'number' ? { t: v, kind: '' } : v && v.t ? v : { t: 0, kind: '' }; };   // 8.0: старый формат — число
function rbTeleportCheck(id, x) {                 // → null (можно лететь) или причина «не полетим»
  const cw = rbPriceWhy(x?.unit != null ? x : env.rt.rbList?.[id]); if (cw) { noteRbSkip(id, cw); return cw; }   // 8.0.3: только за адену
  const ps = preSkip(id);
  const whySkip = rbVerdictBlocks(id) ? 'ранее не по силам при этом уровне' :
    now_() - ps.t < 30 * 60000 ? (ps.kind === 'pots' ? 'мало банок (недавно)' : ps.kind === 'strong' ? 'не по силам по оценке (недавно)' : ps.kind === 'unknown' ? 'нет цифр игры (недавно)' : ps.kind === 'slow' ? 'долгий бой (недавно)' : 'пропуск после осмотра (недавно)') : '';
  if (whySkip) { noteRbSkip(id, whySkip); return whySkip; }
  // История действительно измеренного спецудара имеет приоритет даже если статистика P.Atk ещё отсутствует.
  const maxHp = env.meHp()?.max || 0;
  const knownSp = env.rt.rbDb?.[id]?.sp || 0;
  if (maxHp > 0 && knownSp >= maxHp * 0.45) {
    const why = `известный спецудар ${Math.round(knownSp / maxHp * 100)}% HP`;
    noteRbSkip(id, why);
    return why;
  }
  const st = rbStatsGuess(id, x?.lvl || env.rt.rbList?.[id]?.lvl || 0);
  if (!st) return null;                            // ни одного замера — оценим на месте (как раньше)
  const chk = rbPreCheck(id, st, st.est ? 1.6 : 1);   // по прикидке (РБ не видели) — отсеиваем только явно неподъёмных
  const why = chk.ok ? null : (chk.kind === 'pots' ? 'мало банок' : chk.kind === 'slow' ? 'долгий бой' : 'не по силам (оценка)');
  if (why) noteRbSkip(id, why + ': ' + chk.why);
  return why;
}
function noteRbSkip(id, reason) {
  // 7.2.1 (лог 21:36–21:46: 452 строки «не полетел к …» за 10 мин): метка «уже писал» жила только до перезагрузки страницы
  const seen = Math.max(rbSkipNotices.get(id) || 0, env.rt.rbSkipNote?.[id] || 0);
  if (Date.now() - seen > 1800000) {
    rbSkipNotices.set(id, Date.now());
    const keep = Object.fromEntries(Object.entries(env.rt.rbSkipNote || {}).filter(([, t]) => Date.now() - t < 1800000));
    try { env.setRt?.({ rbSkipNote: { ...keep, [id]: Date.now() } })?.catch?.(() => {}); } catch (e) {}
    env.rec('B', 'РБ-тур', `не полетел к ${env.rt.rbList?.[id]?.name || id}: ${reason}`);
  }
}

const now_ = () => Date.now();

function rbValueScore(id, x) {
  const stats = env.rt.rbDb?.[id] || {};
  const heroHp = env.meHp()?.max || 0;
  const special = stats.sp || 0;
  const rate = special && heroHp ? special / heroHp : null;
  if (rate != null && rate >= .45) return -Infinity;
  // Lasting history of failure must not be hidden by an earlier successful kill.
  const win = rate == null ? (stats.verdict === 'ok' && stats.kills ? .90 : .65) :
    rate < .30 ? .97 : Math.max(.15, .97 - (rate - .30) / .15 * .82);
  const bossHp = env.rt.rbStats?.[id]?.hp || stats.maxHp || 0;
  const dps = rbDpsOn(id);
  const tFight = stats.fightS > 0 ? stats.fightS : bossHp > 0 ? bossHp / Math.max(1,dps) : 420;
  const travel = 90;
  // Valuations are configurable economic assumptions, not server-provided exchange rates.
  const adena = Math.max(0, stats.adenaPerKill ?? stats.adena ?? 196000);
  const exp = Math.max(0, stats.expPerKill ?? stats.xp ?? 637000);
  const reward = adena + exp * Math.max(0, env.cfg.rbExpValue ?? .20);
  const teleport = Math.max(0, x.price || 100000);
  const healing = Math.max(0, (tFight / 10) * (env.cfg.rbPotCost ?? 500));
  const risk = Math.max(0, 1-win) * Math.max(0, env.cfg.rbDeathPenalty || 0);
  const net = reward*win - teleport - healing - risk;
  return net <= 0 ? -Infinity : net/(tFight+travel);
}

function rbEligible() {                           // живые РБ в окне уровней, которых можно бить сейчас
  const L = env.heroLvl(), lo = rbLo(L), hi = rbHi(L);
  return Object.entries(env.rt.rbList || {}).filter(([id, x]) => x.alive && !x.deny && x.lvl >= lo && x.lvl <= hi
    && !rbVerdictBlocks(id) && (id !== env.rt.rbCur || rbWounded(id)) && !rbTeleportCheck(id, x));   // 8.0: «не по силам» — только до нового уровня (rbVerdictBlocks)
}
function rbListPick() {
  const L = env.heroLvl(), lo = rbLo(L), hi = rbHi(L), now = Date.now(), tried = env.rt.rbGoTried || {};
  if (env.cfg.rbValueTour && now - (env.rt.rbListT || 0) > 10 * 60000) return null;
  const base = rbEligible();
  // 10.0 (аудит фарма): «не больше 3 платных телепортов к одному РБ в час» — для любого выбора (раньше только для повтора по кругу:
  // проба, недобитый и РБ квеста могли лететь к одному боссу раз в 10 мин)
  const hourN = id => ((env.rt.rbGoCnt || {})[id] || []).filter(t => now - t < 3600000).length;
  // 7.2.2: недобитый нами РБ (HP с прошлого захода, не «не по силам») — первым, сначала тот, у кого меньше HP
  const wd = base.filter(([id]) => rbWounded(id) && hourN(id) < 3).sort((a, b) => env.rt.rbWound[a[0]].cur / env.rt.rbWound[a[0]].max - env.rt.rbWound[b[0]].cur / env.rt.rbWound[b[0]].max);
  if (wd[0]) return { id: wd[0][0], ...wd[0][1], wounded: env.rt.rbWound[wd[0][0]] };
  // 9.0: РБ квеста сабкласса (Cabrio, Hallate, Kernon, Golkonda) и части Noblesse (Barakiel) — следующими, если в окне уровней и по силам
  const qIds = env.storyRbIds ? env.storyRbIds() : [];
  const qb = base.filter(([id]) => qIds.includes(id) && now - (tried[id] || 0) > env.RB_TRY_MS && hourN(id) < 3).sort((a, b) => a[1].lvl - b[1].lvl);
  if (qb[0]) return { id: qb[0][0], ...qb[0][1], quest: true };
  const dir = env.cfg.rbOrder === 'down' ? -1 : 1;
  const ord = env.cfg.rbValueTour
    ? (a, b) => rbValueScore(b[0],b[1]) - rbValueScore(a[0],a[1])
    : (a, b) => dir * (a[1].lvl - b[1].lvl) || dir * ((a[1].ord ?? 1e9) - (b[1].ord ?? 1e9));
  const candidates = env.cfg.rbValueTour ? base.filter(([id,x]) => rbValueScore(id,x) > 0) : base;
  const fresh = candidates.filter(([id]) => now - (tried[id] || 0) > env.RB_TRY_MS && hourN(id) < 3).sort(ord);
  if (fresh[0]) return { id: fresh[0][0], ...fresh[0][1] };
  const again = candidates.filter(([id]) => now - (tried[id] || 0) > env.RB_RETRY_MS && hourN(id) < 3).sort(ord);    // все недавно пробованы — по кругу
  return again[0] ? { id: again[0][0], ...again[0][1], retry: true } : null;
}

function rbListWhy() {
  const L = env.heroLvl(), lo = rbLo(L), hi = rbHi(L), now = Date.now(), tried = env.rt.rbGoTried || {};
  const all = Object.entries(env.rt.rbList || {});
  const win = all.filter(([, x]) => x.lvl >= lo && x.lvl <= hi);
  const c = { below: all.filter(([, x]) => x.lvl < lo).length, above: all.filter(([, x]) => x.lvl > hi).length, dead: 0, deny: 0, no: 0, tried: 0 };
  let soon = Infinity;
  for (const [id, x] of win) {
    let skipReason;
    if (!x.alive) c.dead++;
    else if (x.deny) c.deny++;
    else if (rbVerdictBlocks(id)) c.no++;
    else if ((skipReason = rbTeleportCheck(id, x))) { if (/банок/.test(skipReason)) c.pots = (c.pots || 0) + 1; else if (/долгий бой/.test(skipReason)) c.slow = (c.slow || 0) + 1; else c.no++; }
    else if (now - (tried[id] || 0) <= env.RB_RETRY_MS) { c.tried++; soon = Math.min(soon, env.RB_RETRY_MS - (now - tried[id])); }
  }
  const pm = env.potModel();
  const parts = [c.dead && `мертвы ${c.dead}`, c.deny && `игра не пускает ${c.deny}`, c.no && `не по силам ${c.no}`, c.slow && `бой дольше ${env.cfg.rbMaxKillMin ?? 20} мин ${c.slow}`,
    c.pots && `мало банок HP ${c.pots} (сверх резерва ${env.cfg.rbPotReserve || 0}: ${pm ? pm.n + ' шт.' : 'нет'})`, c.tried && `только что пробовал ${c.tried}`].filter(Boolean);
  const nx = c.dead ? env.rbTimer?.nextUp?.(lo, hi) : null;   // 10.0.2: таймеры боссов — кто воскреснет первым
  return `в окне ${lo}–${hi} ур. ${win.length} РБ${parts.length ? ': ' + parts.join(', ') : ''}${c.below ? ` · слабее окна ${c.below}` : ''}${c.above ? ` · сильнее ${c.above}` : ''}`
    + (nx ? ` · первым воскреснет ${nx.n} (${nx.l}): ${nx.txt.replace(/\s*\(через[^)]*\)/, '')}` : '');
}

async function rbGoStep() {                       // список РБ → нужная страница → «Телепорт» → карта (там его найдёт фарм РБ)
  const g = env.rt.rbGo;
  if (env.cfg.rbValueTour && now_() - (env.rt.rbListT || 0) > 10 * 60000) {
    env.rec('B', 'РБ-тур', `${g.name}: данные списка старше 10 мин — обновляю перед платным телепортом`);
    await env.setRt({ rbGo: null, rbListT: 0 }); return;
  }
  if (rbVerdictBlocks(g.id) || rbTeleportCheck(g.id, g)) {
    await env.setRt({ rbGo: null, rbWant: null });
    return;
  }
  if (!isRbPage() && await env.townBuffStart(`перед РБ ${g.name}`, true)) { await env.setRt({ rbGo: { ...g, t: Date.now() } }); return; }   // v5.3
  // страховка (v4.30): к этому РБ уже нажимали «Телепорт» меньше 2 мин назад — не платим второй раз, идём на карту искать его
  // (лог 08.10 00:53: «телепорт к Баріон · 100 000 аден» ×5 за 8 с — бот возвращался в список после каждого перелёта)
  if (Date.now() - (env.rt.rbGoTried?.[g.id] || 0) < 120000) {
    env.rec('B', 'РБ-тур', `${g.name}: телепорт уже был — ищу на карте`);
    await env.setRt({ rbGo: null, rbWant: g.id });
    if (!env.isMap()) { location.href = '/map.html'; await env.sleep(3000); }
    return;
  }
  if (!isRbPage() || !(await env.waitX(() => rbPageNow() === g.page, 4000, 200))) { env.setStatus(`РБ: лечу к ${g.name} (${g.lvl})`); location.href = `/rb-bosses.html?page=${g.page}`; await env.sleep(4000); return; }
  const b = await env.waitX(() => env.$q(`.l2-rb-row__tp[data-spawn-id="${g.id}"]`), 8000, 200);
  const cnt = [...((env.rt.rbGoCnt || {})[g.id] || []), Date.now()].filter(t => Date.now() - t < 3600000);   // платные телепорты к этому РБ за час
  if (b) await env.setRt({ rbGoTried: { ...(env.rt.rbGoTried || {}), [g.id]: Date.now() }, rbGoCnt: { ...(env.rt.rbGoCnt || {}), [g.id]: cnt }, zoneGoT: Date.now() });   // v5.6: только если кнопка есть (телепорт будет)
  if (!b) { env.rec('B', 'РБ-тур', `${g.name}: на странице ${g.page} нет — обновлю список`); await env.setRt({ rbGo: null, rbListT: 0 }); return; }
  const row = rbRowsParse()[g.id];
  if (row && (!row.alive || row.deny || rbPriceWhy(row))) { env.rec('B', 'РБ-тур', `${g.name}: ${row.deny || rbPriceWhy(row) || row.status} — пропускаю`); await env.setRt({ rbGo: null, rbList: { ...env.rt.rbList, [g.id]: row } }); location.href = '/map.html'; await env.sleep(3000); return; }
  if (!row && rbPriceWhy(btnPrice(b))) { env.rec('B', 'РБ-тур', `${g.name}: ${rbPriceWhy(btnPrice(b))} — пропускаю`); await env.setRt({ rbGo: null }); location.href = '/map.html'; await env.sleep(3000); return; }
  env.rec('B', 'РБ-тур', `телепорт к ${g.name} (${g.lvl})${g.price ? ' · ' + g.price.toLocaleString('ru') + ' аден' : ''}`);
  // v4.30: rbGo снимаем ДО нажатия: телепорт уводит со страницы и скрипт умирает, не дойдя до «rbGo: null» внизу.
  // Раньше бот на новой странице видел rbGo, возвращался в список и телепортировался снова — 90 с подряд, за аден.
  // zonePend «rb:<id>» больше не ставим: он создавал мусорную зону, зона определится по мобам на карте
  await env.setRt({ rbWant: g.id, rbGo: null });
  await env.pause(); env.fire(b);
  await env.waitX(() => !isRbPage(), 6000, 200);
  if (isRbPage()) {
    const msg = (env.$q('#rb-load-err')?.textContent || env.$q('.l2-rb-row__attack-hint, [role="alert"], [class*="toast"]')?.textContent || '').trim().slice(0, 80);
    env.rec('B', 'РБ-тур', `${g.name}: не улетели${msg ? ' — ' + msg : ''}`);
    location.href = '/map.html'; await env.sleep(3000);
  }
  await env.setRt({ rbGo: null });
}

const huntOn = () => !!env.cfg.rbHuntMode;

async function huntSet(p) { await env.setRt({ rbHunt: { ...(env.rt.rbHunt || {}), ...p, t: Date.now() } }); }

async function huntDone(id, why) {                 // с этим РБ закончили (убит / отошли / не нашли) — 30 мин его не выбираем
  if (id) await env.setRt({ rbGoTried: { ...(env.rt.rbGoTried || {}), [id]: Date.now() }, rbWant: null, rbCur: null });
  env.rec('B', 'тур РБ', why);
  await huntSet({ step: 'pick', id: null, last: why });
}

// ---------- 7.2.1: РБ-сессия с баффом за FA (игрок 10.10: «бафф работает 3 часа — за это время можно ништяк РБ нафармить») ----------
// Снимок баффера 22:27: обычный бафф 1 FA, Greater 5 FA, всё на 3 ч (и «Дар Серафима» — откат −30 % — тоже 3 ч). FA падает с мобов.
// Старт (кнопка в меню): баффер → баффы сессии (rbSessBuffs) → тур по РБ. Смерть снимает баффы, если нет Noblesse Blessing; с ним
// слетает только он — бот сразу покупает его снова (5 FA). Баффы слетели совсем — сессия окончена (не тратим FA по новой).
// Бафф кончается (за 2 мин) — итог в журнал, режим «Автофарм», ждём игрока
// 9.2.5: список сессии — фулл бафф (buffs.faFullIds: «auto» = набор под класс, без пар, что снимают друг друга)
const sessIds = () => env.faFullIds ? env.faFullIds() : env.faIdsOf ? env.faIdsOf(env.cfg.rbSessBuffs) : String(env.cfg.rbSessBuffs || '').split(/[,\s]+/).map(Number).filter(x => x > 0);
const sessTime = t => new Date(t).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
async function rbSessTick() {
  const S = env.rt.rbSess; if (!S?.on) return false;
  const now = Date.now(), H = env.hudBuffs?.() || null, gone = env.rt.faGone || {};
  const need = sessIds().filter(id => !(gone[id] && now - gone[id] < 6 * 3600000));   // чего у баффера нет — не ждём
  if (!S.bought) {
    const have = H ? need.filter(id => H[id] && H[id] - now > 30 * 60000 && !env.faLow?.(id)) : [];   // 9.2.5: городской Lv.2 вместо FA Lv.3 — ещё не куплен
    if (need.length && have.length === need.length) {
      const until = Math.min(...need.map(id => H[id]));
      await env.setRt({ rbSess: { ...S, bought: true, until, t0: now, k0: env.rt.rbKills || 0, e0: env.rt.exp || 0, a0: env.rt.adena || 0, d0: (env.rt.deaths || []).length, fa: env.rt.faBal?.v ?? null } });
      env.rec('B', 'РБ-сессия', `баффы на месте (${need.length}) — до ${sessTime(until)} бью РБ${env.rt.faBal ? ` · FA осталось ${env.rt.faBal.v}` : ''}`);
      return false;
    }
    if (now - (S.start || now) > 15 * 60000) return rbSessEnd(`баффы так и не купились за 15 мин (есть ${have.length} из ${need.length}) — FA хватает?`);
    return !!(await env.townBuffStart('РБ-сессия: баффы за FA', true));   // к бафферу (тот же путь, что баффы перед РБ)
  }
  if (now >= S.until - 120000) return rbSessEnd('бафф заканчивается');
  if (H && need.filter(id => id !== 1323).length && need.filter(id => id !== 1323).every(id => !H[id])) return rbSessEnd('баффы слетели (смерть без Noblesse Blessing)');
  return false;
}
async function rbSessEnd(why) {
  const S = env.rt.rbSess || {}, min = S.t0 ? Math.round((Date.now() - S.t0) / 60000) : 0;
  const kills = (env.rt.rbKills || 0) - (S.k0 || 0), exp = (env.rt.exp || 0) - (S.e0 || 0), ad = (env.rt.adena || 0) - (S.a0 || 0), deaths = (env.rt.deaths || []).length - (S.d0 || 0);
  const sum = { kills, exp, adena: ad, deaths, min, why, faLeft: env.rt.faBal?.v ?? null };
  await env.setRt({ rbSess: { ...S, on: false, end: Date.now(), sum }, rbHunt: { step: 'pick', t: Date.now(), last: 'РБ-сессия окончена' }, rbGo: null });
  await env.setCfg({ rbHuntMode: false, rbMode: !!env.cfg.rbBetween, epicMode: false, fishMode: false, catMode: false, zoneAuto: true, chain: true });   // 8.0.3: «РБ между мобами» — по выбору игрока
  env.rec('B', 'РБ-сессия', `окончена: ${why} · ${min} мин · РБ убито ${kills} · EXP +${exp.toLocaleString('ru')} · аден ${ad >= 0 ? '+' : ''}${ad.toLocaleString('ru')}${deaths ? ` · смертей ${deaths}` : ''}${sum.faLeft != null ? ` · FA осталось ${sum.faLeft}` : ''} → режим «Автофарм», жду игрока`);
  env.setStatus('РБ-сессия окончена — автофарм');
  return true;
}

// 8.0.3 (игрок 11.10: «убить одного РБ и ждать команды, после команды убить ещё РБ, и так каждый раз»): режим «🎯 По одному РБ».
// rt.rbOne = { on, k0 } — k0 = счётчик убитых РБ на момент команды. Тур работает как обычно (выбор, телепорт, банки, недобитый —
// первым), но как только убитых стало больше k0 — бот встаёт на паузу и ждёт: «🎯 Ещё один РБ» или «▶ Продолжить» = ещё один РБ
const rbOneHit = () => { const o = env.rt.rbOne; return !!o?.on && o.k0 != null && (env.rt.rbKills || 0) > o.k0; };
async function rbOnePause(name) {
  const o = env.rt.rbOne || {}, n = (o.n || 0) + 1;
  await env.setRt({ rbOne: { ...o, k0: env.rt.rbKills || 0, n, last: Date.now(), lastName: name || '' }, rbHunt: { step: 'pick', t: Date.now(), last: 'один РБ убит — жду команды' } });
  return env.pauseBot(`🎯 По одному РБ: ${name ? name + ' убит' : 'РБ убит'} (${n}-й по команде) — жду команды: «🎯 Ещё один РБ» или «▶ Продолжить»`);
}

const RB_IDLE_MS = 5 * 60000;                     // 8.0 (аудит фарма A5): подходящих РБ нет — 5 мин фармим мобов (было 90 с + перечитка списка)
async function rbHuntStep() {
  if (await rbSessTick()) return;                   // 7.2.1: РБ-сессия — сначала баффы, в конце — автофарм
  const H = env.rt.rbHunt || { step: 'pick' };
  if (rbOneHit() && H.step !== 'fight') return rbOnePause(H.name);   // 8.0.3: РБ убит по команде «один РБ» (и вне шага боя)
  if (H.step === 'fight') {                         // снова не в бою — бой закончен, итог боя уже в базе РБ
    const d = env.rt.rbDb?.[H.id] || {}, w = env.rt.rb?.[H.id];
    // 7.2.3: недобитый РБ (пауза/отход/магазин) — не «следующий»: rbListPick вернёт к нему первым
    const wd = rbWounded(H.id) ? env.rt.rbWound[H.id] : null, pct = wd ? Math.round(wd.cur / wd.max * 100) : 0;
    const res = await huntDone(H.id, `${H.name}: ${d.verdict === 'no' ? '❌ не по силам → следующий' : w ? `отошёл, у него ${w.hpAfter}/${w.max}${wd ? ' — вернусь добить' : ' → следующий'}` : wd ? `бой прерван, у него ${pct}% — возвращаюсь добить` : d.kills ? `✅ убит (всего ${d.kills}×) → следующий` : 'бой окончен → следующий'}`);
    if (rbOneHit()) return rbOnePause(H.name);       // 8.0.3: «один РБ» — убит, ждём команды
    return res;
  }
  if (H.step === 'go') {
    const g = env.rt.rbList?.[H.id] || H;
    const reason = rbTeleportCheck(H.id, g);
    if (reason || (env.cfg.rbValueTour && Date.now() - (env.rt.rbListT || 0) > 10 * 60000)) {
      await env.setRt({ rbListT: 0 });
      return huntDone(H.id, `${H.name}: перед телепортом ${reason || 'список устарел'} — проверю повторно`);
    }
    if (!isRbPage() || !(await env.waitX(() => rbPageNow() === H.page, 4000, 200))) {
      env.setStatus(`Тур РБ: к ${H.name} (${H.lvl}) — список, стр. ${H.page}`);
      location.href = `/rb-bosses.html?page=${H.page}`; await env.sleep(4000); return;
    }
    const b = await env.waitX(() => env.$q(`.l2-rb-row__tp[data-spawn-id="${CSS.escape(H.id)}"]`), 8000, 200);
    if (!b) { await env.setRt({ rbListT: 0 }); return huntDone(H.id, `${H.name}: нет на странице ${H.page} — перечитаю список`); }
    const row = rbRowsParse()[H.id];
    if (row) env.rbTimer?.domNote({ [H.id]: row })?.catch?.(() => {});
    if (row && (!row.alive || row.deny || rbPriceWhy(row))) { await env.setRt({ rbList: { ...(env.rt.rbList || {}), [H.id]: row } }); return huntDone(H.id, `${H.name}: ${row.deny || rbPriceWhy(row) || row.status} — пропускаю`); }
    if (!row && rbPriceWhy(btnPrice(b))) return huntDone(H.id, `${H.name}: ${rbPriceWhy(btnPrice(b))} — пропускаю`);
    // шаг «прилёт» записываем ДО нажатия: телепорт уводит со страницы, и скрипт обрывается на полуслове
    await huntSet({ step: 'arrive', at: Date.now() });
    const cntH = [...((env.rt.rbGoCnt || {})[H.id] || []), Date.now()].filter(t => Date.now() - t < 3600000);   // v5.6: платные телепорты тура — в общий счётчик «≤3 в час»
    // 8.0.3 (лог 11.10 09:16: 26 боёв у Тотема записались в статистику прежней зоны «Vanor Silenos» на 55 ур.): после телепорта зона
    // неизвестна — её определит карта по мобам (zoneHere), а EXP/ч не попадёт в чужую зону
    await env.setRt({ rbWant: H.id, zoneGoT: Date.now(), zone: null, zonePend: null, rbGoCnt: { ...(env.rt.rbGoCnt || {}), [H.id]: cntH } });
    env.rec('B', 'тур РБ', `телепорт к ${H.name} (${H.lvl})${H.price ? ' · ' + H.price.toLocaleString('ru') + ' аден' : ''}`);
    await env.pause(); env.fire(b);
    if (await env.waitX(() => !isRbPage() || (env.$q('#rb-load-err')?.textContent || '').trim() || null, 8000, 200) && !isRbPage()) return;
    const msg = (env.$q('#rb-load-err')?.textContent || '').trim().slice(0, 80);
    // 10.0 (аудит фарма): страница не сменилась за 8 с, но ошибки игры нет — переход медленный, а не отказ: шаг «прилёт» (уже записан) сам
    // отведёт на карту и поищет РБ; раньше — «следующий РБ» и второй платный телепорт
    if (!msg) return;
    return huntDone(H.id, `${H.name}: телепорт не сработал — ${msg}`);
  }
  if (H.step === 'arrive') {
    if (!env.isMap()) {
      if (Date.now() - (H.at || 0) > 60000) return huntDone(H.id, `${H.name}: после телепорта не попал на карту`);
      location.href = '/map.html'; await env.sleep(3000); return;
    }
    await env.mapReady(15000, `Тур РБ: ищу ${H.name} на карте`);
    const r = await env.waitX(() => raidList().find(x => x.id === H.id), 5000, 300);
    if (!r) {
      if (Date.now() - (H.at || 0) < 25000) { await env.sleep(1500); return; }   // карта ещё догружается
      if (env.rt.rbList?.[H.id]) await env.setRt({ rbList: { ...env.rt.rbList, [H.id]: { ...env.rt.rbList[H.id], alive: false } } });   // v5.6: до перечитки списка — мёртв
      env.rbTimer?.domNote({ [H.id]: { name: H.name, lvl: H.lvl, alive: false } }, 'нет на карте')?.catch?.(() => {});   // 10.0.2: убит другими — окно смерти «видел живым → нет на карте»
      return huntDone(H.id, `${H.name}: на карте нет (убит другими?)`);
    }
    if (rbVerdictBlocks(r.id)) return huntDone(H.id, `${H.name}: в базе «не по силам» — пропускаю`);
    const bw = env.buffWaitBeforeRb();                  // v4.41: тотем на откате ≤60 с — ждём, бой с РБ начинаем с баффом
    if (bw) { env.setRt({ status: `Тур РБ: жду откат «${bw.who}» ${bw.s} с, потом ${H.name}` }); env.draw(); await env.sleep(Math.min(bw.s, 10) * 1000); await huntSet({ at: Date.now() }); return; }
    if (await env.townBuffStart(`перед РБ ${H.name}`, true)) { await huntSet({ at: Date.now() + 30000 }); return; }   // v5.3: бафф слетел — сначала баффер
    await huntSet({ step: 'fight' });
    await env.setRt({ rbCur: r.id });
    const res = await rbEngage(r, `Тур РБ: бой с ${r.name} (${r.lvl})`);
    // 8.0.3 (лог 11.10 10:32:30–10:32:53: четыре платных телепорта подряд, каждый — «не по силам» на месте): два отказа на месте подряд за
    // 10 мин — тур 5 мин фармит мобов здесь, а не платит дальше
    if (res === 'skip') {
      const run = Date.now() - (env.rt.rbRefuse?.t || 0) < 10 * 60000 ? (env.rt.rbRefuse?.n || 0) + 1 : 1;
      await env.setRt({ rbRefuse: { n: run, t: Date.now() }, ...(run >= 2 ? { rbHuntIdle: Date.now() + RB_IDLE_MS, rbIdleMark: { lvl: env.heroLvl() || 0, pots: env.potModel()?.n || 0, t: Date.now() } } : {}) });
      if (run >= 2) env.rec('B', 'тур РБ', `${run} отказа на месте подряд — 5 мин фармлю мобов здесь, не плачу за телепорты`);
      return huntDone(H.id, `${H.name}: ❌ оценка до боя — не по силам`);
    }
    if (res && env.rt.rbRefuse?.n) await env.setRt({ rbRefuse: null });
    if (res) return;
    return huntDone(H.id, `${H.name}: бой не открылся`);
  }
  // step 'pick' (и всё непонятное): свежий список → выбор → HP/MP → полёт
  // v5.2.2: подходящих РБ не было — фармим мобов, пока не придёт время перечитать список (раньше: карта ↔ список РБ
  // каждые 20 с без единого боя, лог 08.10 13:41–13:44 — «петля туда-сюда»)
  if ((env.rt.rbHuntIdle || 0) > Date.now()) {
    // 10.0.2 (таймеры боссов): опрос списка увидел, что подходящий РБ воскрес, — простой не досиживаем
    const up = env.rbTimer?.revivedSince?.(env.rt.rbIdleMark?.t || 0) || [], ok = up.length ? new Set(rbEligible().map(([id]) => id)) : null, hit = up.find(id => ok?.has(id));
    if (hit) {
      env.rec('B', 'тур РБ', `${env.rt.rbList?.[hit]?.name || hit} (${env.rt.rbList?.[hit]?.lvl || '?'}) воскрес — заканчиваю простой`);
      await env.setRt({ rbHuntIdle: 0, rbIdleN: 0, rbIdleMark: null, rbRefuse: null }); return;
    }
    if (!env.isMap()) { location.href = '/map.html'; await env.sleep(3000); return; }
    env.setStatus(`Тур РБ: ${String(H.last || 'подходящих РБ нет').slice(0, 140)} — фармлю мобов, проверю снова через ${Math.ceil((env.rt.rbHuntIdle - Date.now()) / 1000)} с`);
    return env.map();
  }
  // 8.0 (аудит фарма A5, лог 10.10 21:39–21:46): конец простоя сбрасывал rbListT — список (≈14 страниц) перечитывался каждые ≈105 с,
  // цепочка стояла ≈18–20 с на каждое чтение (21:41:09 → 21:41:29 вместо ≈3 с между боями), а в окне — те же мёртвые / «не по силам». Теперь список живёт свои 15 мин (простой — 5 мин);
  // раньше перечитываем, только если вырос уровень героя (окно и «не по силам» меняются) или прибавилось банок / был магазин
  // (РБ могли отсеиваться из-за нехватки банок)
  if (env.rt.rbHuntIdle) {
    const m = env.rt.rbIdleMark || {}, L = env.heroLvl();
    const early = (!!m.lvl && !!L && L !== m.lvl) || (env.potModel()?.n || 0) > (m.pots || 0) || (env.rt.shopT || 0) > (m.t || 0);
    await env.setRt({ rbHuntIdle: 0, rbIdleMark: null, ...(early ? { rbListT: 0 } : {}) });
  }
  if (!env.rt.rbListT || Date.now() - env.rt.rbListT > (env.cfg.rbValueTour ? 10 : 15) * 60000) {
    if (!isRbPage()) { env.setStatus('Тур РБ: открываю список рейд-боссов'); location.href = '/rb-bosses.html'; await env.sleep(4000); return; }
    return rbListScan();
  }
  const p = rbListPick();
  if (!p) {
    if (!env.isMap()) { location.href = '/map.html'; await env.sleep(3000); return; }
    const why = `подходящих РБ нет — ${rbListWhy()}`;
    // v5.2.2: не стоим и не гоняем список по кругу — фармим мобов здесь (8.0: 5 мин, список — из кэша, если не устарел), потом снова выбор
    // (в журнал пишем только смену причины)
    if (/мало банок/.test(why) && await rbShopFirst('')) return;   // РБ отсеяны из-за банок — сначала магазин
    // 10.0 (лог 12.10: 7 проверок за 35 мин, каждая 7–19 с с цепочки на карту/список, итог тот же «не по силам / мертвы»): та же причина —
    // простой растёт 5 → 10 → 20 мин (рост уровня или банок сбрасывает его раньше, rbIdleMark)
    const idleN = H.last === why ? Math.min(2, (env.rt.rbIdleN || 0) + 1) : 0, idleMs = RB_IDLE_MS * [1, 2, 4][idleN];
    if (H.last !== why) { await huntSet({ last: why }); env.recBot(`Тур РБ: ${why} — фармлю мобов, проверю снова через ${idleMs / 60000} мин`); }
    await env.setRt({ rbHuntIdle: Date.now() + idleMs, rbIdleN: idleN, rbIdleMark: { lvl: env.heroLvl() || 0, pots: env.potModel()?.n || 0, t: Date.now() } });
    return env.map();
  }
  if (await rbShopFirst(p.name)) return;             // v5.2.2: сначала банки (минимум «Банки HP»), потом РБ
  if (await env.townBuffStart(`перед РБ ${p.name}`, true)) return;   // v5.3: все баффы на месте — перед РБ это важнее всего
  const me = env.meHp(), mp = env.meMp();                    // перед вылетом — полное HP/MP (баффер «Восстановить»)
  if (me && (me.pct < env.cfg.rbRestHp || (mp && mp.cur < mp.max * 0.6)) && await env.restoreVitals(`перед РБ ${p.name}: HP ${me.pct | 0}%`)) return;
  // v4.34: восстановиться не вышло — к РБ с неполным HP не летим (так погибали), лечимся на обычных мобах: вампирик + банки
  if (me && me.pct < env.cfg.rbRestHp) {
    if (!env.isMap()) { location.href = '/map.html'; await env.sleep(3000); return; }
    if (H.last !== 'лечусь на мобах') { env.rec('B', 'тур РБ', `HP ${me.pct | 0}% < ${env.cfg.rbRestHp}% — лечусь на мобах, потом ${p.name}`); await huntSet({ last: 'лечусь на мобах' }); }
    env.setStatus(`Тур РБ: HP ${me.pct | 0}% — лечусь на мобах до ${env.cfg.rbRestHp}%, потом ${p.name}`);
    return env.map();
  }
  // 10.0 (аудит фарма): после перечитки списка бот стоит на странице РБ — проверка «он здесь, на этой карте» пропускалась, и бот платил
  // 100 000 за телепорт туда, где уже стоит. Сначала карта
  if (!env.isMap()) { location.href = '/map.html'; await env.sleep(3000); return; }
  // 8.0 (аудит РБ B1): РБ на ЭТОЙ карте (бесплатное восстановление не уводит с карты) — бьём без телепорта за 100 000:
  // 22:31 Злий Дух Сиріон стоял на карте Келбара, бот через 3 мин летел к нему за деньги
  if (env.isMap()) {
    const ok = new Set(rbEligible().map(([id]) => id)), tried = env.rt.rbGoTried || {};
    const here = raidList().filter(r => ok.has(r.id) && (Date.now() - (tried[r.id] || 0) > env.RB_TRY_MS || rbWounded(r.id)));
    const h = here.find(r => r.id === p.id) || here.find(r => rbWounded(r.id)) || here[0];
    if (h) {
      env.rec('B', 'тур РБ', `цель: ${h.name} (${h.lvl}) — он здесь, на этой карте: без телепорта`);
      await env.setRt({ rbWant: h.id });
      await huntSet({ step: 'arrive', id: h.id, name: h.name, lvl: h.lvl, page: env.rt.rbList?.[h.id]?.page || 0, at: Date.now() });
      return;
    }
  }
  // 8.0 (C1): до платного телепорта — настоящие цифры РБ; не по силам — пропуск без полёта
  // 8.0.3 (логи 11.10: Тарлк 09:17 и РБ 60–66 в 10:32 — 5 × 100 000 аден, отказ каждый раз уже на месте): цифры из окна карты (без src) —
  // тоже цифры игры; цифр нет совсем (запрос не удался) — вслепую платим только за знакомого (убивали / «по силам») или не чаще раза в 30 мин
  if (!p.wounded) {
    const st = await rbInfo(p.id), real = !!st && st.hp > 0 && (st.matk > 0 || st.patk > 0) && !st.est;
    if (real && !rbVerdictBlocks(p.id)) {
      const chk = rbPreCheck(p.id, { ...st, est: false });
      if (!chk.ok) {
        await env.setRt({ rbPreSkip: { ...(env.rt.rbPreSkip || {}), [p.id]: { t: Date.now(), kind: chk.kind === 'pots' ? 'pots' : 'strong' } } });
        return huntDone(p.id, `${p.name} (${p.lvl}): до телепорта по цифрам игры — не полезу: ${chk.why}`);
      }
    } else if (!real) {
      const d = env.rt.rbDb?.[p.id];
      if (!(d?.verdict === 'ok' || d?.kills > 0)) {
        if (Date.now() - (env.rt.rbBlindT || 0) < 30 * 60000) {
          await env.setRt({ rbPreSkip: { ...(env.rt.rbPreSkip || {}), [p.id]: { t: Date.now(), kind: 'unknown' } } });
          return huntDone(p.id, `${p.name} (${p.lvl}): цифр игры нет — второй полёт вслепую за 30 мин не делаю`);
        }
        await env.setRt({ rbBlindT: Date.now() });
      }
    }
  }
  env.rec('B', 'тур РБ', `цель: ${p.name} (${p.lvl})${p.wounded ? ` · недобит: у него ${Math.round(p.wounded.cur / p.wounded.max * 100)}% — добиваю` : ''}${env.rt.rbDb?.[p.id]?.verdict === 'ok' ? ' ✅ уже убивали' : ''} · стр. ${p.page}`);
  await huntSet({ step: 'go', id: p.id, name: p.name, lvl: p.lvl, page: p.page, price: p.price });
}

// 7.2.2 (игрок 10.10 23:18: «не продолжил добивать РБ, которого я протупил на паузе»): HP РБ на сервере сохраняется между заходами,
// а бот помнил его только при своём отходе. Теперь в бою раз в 8 с запоминаем HP (rt.rbWound); недобитый РБ в туре — первым
function rbWoundNote(ctx) {
  const S = ctx.rb, mob = env.mobHp?.(); if (!S?.id || !mob?.max || !(mob.cur > 0) || Date.now() - (S.woundT || 0) < 8000) return;
  S.woundT = Date.now();
  const W = Object.fromEntries(Object.entries(env.rt.rbWound || {}).filter(([, w]) => Date.now() - (w.t || 0) < 3600000));
  W[S.id] = { cur: mob.cur, max: mob.max, t: Date.now(), name: ctx.name };
  env.setRt({ rbWound: W });
}
const rbWounded = id => { const w = env.rt.rbWound?.[id]; return !!w && Date.now() - (w.t || 0) < 30 * 60000 && w.cur < w.max * 0.99 && !rbVerdictBlocks(id); };   // 10.0.2: 95 → 99 % (лог 12.10 22:16: Рахха 96,7 % — «бой окончен → следующий», урон по 4 РБ вразброс)
function rbLearn(ctx) {                          // v4.46: k = обычный удар РБ (без Ogre) / P.Atk — для оценки до боя
  try { rbWoundNote(ctx); } catch (e) {}
  const S = ctx.rb, lines = env.logLines(), fresh = S.lp ? env.newLines(S.lp, lines) : [];
  S.lp = lines;
  const nm = (ctx.name || '').toLowerCase(), ogre = env.activeBuffs().some(x => x.id === 109 && (!x.exp || x.exp > Date.now()));
  for (const line of fresh) {
    const l = String(line).trim();
    const m = l.match(/^\[(.+?)\] ударив тебе (?:\(крит!\)\s*)?[−-](\d+) HP/i);
    if (m && m[1].trim().toLowerCase() === nm) {
      (S.hits ||= []).push(Math.round(+m[2] * (ogre ? 1.3 : 1)));
      if (S.hits.length > 120) S.hits.splice(0, S.hits.length - 120);
    }
    const sp = l.match(/^(.+?)\s*·\s*(.+?)\s+(\d+)\s*(?:HP|урона|шкоди)?\s*$/i);
    if (sp && sp[1].trim().toLowerCase() === nm && !/^(?:ударив|ударил)$/i.test(sp[2].trim())) {
      const spike = Math.round(+sp[3] * (ogre ? 1.3 : 1));
      if (spike > (S.sp || 0)) {
        S.sp = spike; S.spName = sp[2].trim();
        if (spike > (env.rt.rbDb?.[S.id]?.sp || 0))
          env.rec('B', 'РБ', `спецудар ${ctx.name}: ${S.spName} ${spike} HP`);
      }
    }
  }
  const p90 = S.hits?.length >= 3 ? [...S.hits].sort((a,b)=>a-b)[Math.min(S.hits.length-1,Math.floor(S.hits.length*.9))] : 0;
  const db = env.rt.rbDb?.[S.id] || {};
  // 8.0.3 (лог 11.10 11:42, Орфен): hitP90 — только от ≥ 3 ударов, и бой после 1–2 ударов (выход, смерть) знание о 57 % ударе терял —
  // самый сильный одиночный обычный удар помним отдельно (maxHit), по нему аварийный выход в следующем бою с этим боссом
  const mx = S.hits?.length ? Math.max(...S.hits) : 0;
  if ((S.sp || 0) > (db.sp || 0) || p90 > (db.hitP90 || 0) || mx > (db.maxHit || 0)) {
    env.rbNote(S.id, { sp: Math.max(db.sp || 0, S.sp || 0), hitP90: Math.max(db.hitP90 || 0, p90), maxHit: Math.max(db.maxHit || 0, mx) });
  }
  const st = env.rt.rbStats?.[S.id];
  // 8.0.3: удары эпика (Орфен k ≈0,65 против ≈0,056 у обычных РБ) общий rbK не учат — иначе «обычный удар» всех РБ вырос бы в 3–5 раз
  // и тур браковал бы почти всех; свои hitP90/sp эпика в базу пишутся как раньше (по ним его вердикт)
  if (st?.patk && (S.hits?.length || 0) >= 12 && !S.kDone && isEpicId(S.id)) S.kDone = 1;
  if (st?.patk && (S.hits?.length || 0) >= 12 && !S.kDone) {
    S.kDone = 1;
    const h = [...S.hits].sort((a, b) => a - b)[S.hits.length >> 1], k = h / st.patk;
    env.setRt({ rbK: +(env.rt.rbK ? env.rt.rbK * 0.6 + k * 0.4 : k).toFixed(4) });
    env.rec('B', 'РБ', `сила РБ: удар ≈${Math.round(h)} при P.Atk ${st.patk} → k ${k.toFixed(3)} (для оценки до боя)`);
  }
}

function rbAssess(ctx, me, mob) {
  const S = ctx.rb, now = Date.now();
  S.t0 ||= now;
  if (!env.rbLive || env.rbLive.name !== ctx.name || env.rbLive.t0 !== S.t0 || now - env.rbLive.t > 60000) env.rbLive = { name: ctx.name, cur: mob.cur, max: mob.max, t0: S.t0, t: now, verdict: 'measuring', win: false };
  else Object.assign(env.rbLive, { cur: mob.cur, max: mob.max, t: now });
  try { rbLearn(ctx); } catch (e) {}
  if (!S.last || now - S.last >= 1000) {
    S.samples.push({ t: now, me: me.cur, mob: mob.cur });
    S.last = now;
    S.samples = S.samples.filter(x => now - x.t <= 30000);
  }
  const a = S.samples[0], b = S.samples[S.samples.length - 1];
  const dt = (b.t - a.t) / 1000;
  // смертельный удар (Церберон 55 ур. снял 4200 из 5060 одним ударом — смерть за 4 с): один шаг ≥ 30 % макс. HP —
  // уходим сразу, не дожидаясь оценки, и помечаем «не по силам» (v4.24)
  // 10.0.2 (лог 12.10 22:12–22:35, тур РБ: 30 выходов из боя за 35 мин, убиты 2 РБ из 6): спецудар 2396–2954 = 29–36 % HP героя (Сірра,
  // Рахха, Гекатон, Галлате, Голконда) давал «смертельно» при HP 55–65 % → выход, восстановление, новый заход через 10–25 с; Сірра (у неё 8 %)
  // добивалась 5 заходами за 2:18 вместо ≈35 с. Скачок ≥ 30 % — смертельно, только если второй такой нас добьёт (HP < скачок × 1,2) или он
  // ≥ 60 % HP; иначе это спецудар: бьём дальше (банки по «цене хода», настоящую опасность ловит rbFlee)
  const p = S.samples[S.samples.length - 2], jump = p ? p.me - b.me : 0;
  if (p && jump >= me.max * 0.30 && (b.me < jump * 1.2 || jump >= me.max * 0.60)) {
    S.lethal = Math.round(jump);
    return { abort: true, lethal: true, why: `удар на ${S.lethal} HP (${Math.round(S.lethal / me.max * 100)} % моего HP) — смертельно опасен` };
  }
  if (p && jump >= me.max * 0.30 && !S.bigSaid) { S.bigSaid = 1; env.rec('B', 'РБ', `${ctx.name}: удар на ${Math.round(jump)} HP (${Math.round(jump / me.max * 100)} %), у меня ${b.me} — второй такой переживу, бьюсь дальше`); }
  if (dt < 8) {                                   // мало данных — только жёсткий порог
    S.note = 'оценка…';
    return { retreat: me.pct <= env.cfg.rbRetreatHp, why: `HP ${me.pct | 0}% до оценки — отход` };   // отдых и новый заход
  }
  const dealt = Math.max(0, a.mob - b.mob);
  const dps  = Math.max(0, dealt / dt);                    // урон по РБ, HP/с
  // 10.0.2: свой ДПС по ЭТОМУ РБ (с котом) — для выбора цели: на 8–14 ур. выше героя урон вдвое меньше (лог 12.10: Рахха 65 ≈4,3k/с,
  // Галлате 73 ≈2,5k/с, Голконда 79 ≈2,4k/с при общем «≈4k/с») — по общему ДПС тур ждал от Голконды 25 мин, реально ≈43 мин и две смерти
  if (dt >= 8 && dealt > 0 && now - (S.dpsNoteT || 0) > 15000) { S.dpsNoteT = now; const od = env.rt.rbDb?.[S.id]?.dps; rbNote(S.id, { dps: Math.round(od > 0 ? od * 0.6 + dps * 0.4 : dps) }).catch(() => {}); }
  // Не объявляем победу по 1–2 случайным значениям HP или кратковременному лечению персонажа.
  // Для эпика прежний аварийный выход по нулевому урону продолжает действовать.
  const reliable = dt >= 15 && S.samples.length >= 5 && dealt >= Math.max(1, mob.max * 0.001);
  if (!reliable) {
    S.note = `замер: ${Math.round(dps)} HP/с, ${(100 * dealt / Math.max(1, mob.max)).toFixed(2)}% за ${Math.round(dt)} с`;
    if (env.epicOn() && env.epicById(S.id) && dt >= 8 && (dps <= 0 || mob.cur / dps > 1800))
      return { abort: true, hopeless: true, why: `эпик: недостаточный урон, прогноз >30 мин (≈${Math.round(dps)} HP/с)` };
    return { retreat: me.pct <= env.cfg.rbRetreatHp, why: 'данных для достоверного прогноза победы ещё недостаточно' };
  }
  if (dt >= 20 && dps > 0 && now - (S.dpsT || 0) > 30000) { S.dpsT = now; env.setRt({ rbDps: Math.round(env.rt.rbDps ? env.rt.rbDps * 0.8 + dps * 0.2 : dps) }); }   // v4.46: наш ДПС по РБ — для оценки до боя
  // чистая потеря HP героя без банок: банки, выпитые в окне, возвращаем в расчёт (их лечение не «держится» само)
  const pm = env.potModel();
  const potsIn = (S.potT || []).filter(t => t >= a.t).length;
  const loss = (a.me - b.me) / dt + (pm ? potsIn * pm.H / dt : 0);   // HP/с (≤0 — держимся без банок)
  // v5.3: настоящая потеря HP (HP/с с учётом выпитого) на единицу P.Atk РБ — для оценки ДО боя. Лог 08.10 14:13–14:16:
  // оценка брала удар ×0,876 (≈220 HP/с у Берун 50 ур.), а реально с критами и спецударами уходило 300–600 HP/с — две смерти
  const stL = env.rt.rbStats?.[S.id];
  if (dt >= 20 && stL?.patk && loss > 0 && now - (S.lossT || 0) > 30000) {
    S.lossT = now; const k = loss / stL.patk, epicL = isEpicId(S.id);   // 8.0.3: потери на эпике — только в его цифры, не в общий rbLossK
    env.setRt({ ...(epicL ? {} : { rbLossK: +(env.rt.rbLossK ? env.rt.rbLossK * 0.7 + k * 0.3 : k).toFixed(4) }), rbStats: { ...(env.rt.rbStats || {}), [S.id]: { ...stL, loss: Math.round(stL.loss ? stL.loss * 0.6 + loss * 0.4 : loss) } } });
  }
  const tKill = dps > 0 ? mob.cur / dps : Infinity;
  const B = me.cur - me.max * env.cfg.stopHp / 100;              // запас HP до аварийного порога
  const tDie0 = loss > 0 ? B / loss : Infinity;              // без банок
  // с банками: лечение pm.H раз в pm.C с, пока не кончатся (резерв не трогаем)
  let tDie = tDie0, need = 0;
  if (pm && pm.n > 0 && loss > 0) {
    // v4.47: банки пьются по мере потери HP. Если пить успеваем (потеря ≤ скорости лечения), их хватит на (запас + HP) / потеря.
    // Раньше считалось «пьём без перерыва» — 212k банок «кончались» за 110 с, и бот писал «не успею пить» при 1923 против 77 HP/с
    const hr = pm.rate || pm.H / pm.C, pool = pm.pool || pm.n * pm.H;
    if (loss <= hr) tDie = (B + pool) / loss;
    else { const tp = pool / hr, tDrain = B / (loss - hr); tDie = tDrain <= tp ? tDrain : tp + (B - (loss - hr) * tp) / loss; }
    need = Math.max(0, Math.ceil((loss * tKill * 1.25 - B) / pm.H));   // банок на всё убийство с запасом 25 %
  }
  const win0 = tKill < tDie0 * 0.8;                          // без банок, запас 20 %
  const potsOk = !pm || need <= pm.n && need * pm.C <= tKill + pm.C;  // хватит и по количеству, и по скорости питья
  const speedOk = !!pm && tKill < tDie * 0.8;                // лечение банками успевает за потерей HP
  const epicBoss = env.epicOn() && !!env.epicById(S.id);
  const unrealisticEpic = epicBoss && (tKill > 1800 || !Number.isFinite(tKill));
  // v7.1.2: прогноз победы нельзя подтверждать без наблюдения ударов босса,
  // включая критические. Даже долгий период с полным HP не означает отсутствие урона.
  const hitCount = (S.hits || []).length;
  const worstHit = Math.max(0, ...(S.hits || []));
  const observedDamageTicks = S.samples.slice(1).filter((v, i) => S.samples[i].me - v.me >= me.max * 0.02).length;
  const enoughCombatData = dt >= 25 && S.samples.length >= 12 && dealt >= mob.max * 0.01
    && (hitCount >= 3 || observedDamageTicks >= 4);
  const historicalSpike = env.rt.rbDb?.[S.id]?.sp || S.sp || 0;
  const spikeRisk = worstHit >= me.max * 0.35 || worstHit >= me.cur * 0.65 ||
    historicalSpike >= me.max * 0.33;
  // Реальное лечение должно быть измерено: оценка расхода неизвестной банки не подтверждает победу.
  const potReliable = win0 || !pm || (!pm.est && pm.items.every(x => !x.est));
  const enoughReserve = win0 || !pm || need <= pm.n * 0.75;
  const enduranceMargin = win0 ? tKill * 1.35 < tDie0 : tKill * 1.35 < tDie;
  const candidateWin = !unrealisticEpic && (win0 || (speedOk && potsOk));
  const win = candidateWin && enoughCombatData && !spikeRisk && potReliable && enoughReserve
    && enduranceMargin && (loss > 0 || hitCount >= 4);
  const pending = candidateWin && !win && !spikeRisk && enoughReserve;
  // v4.31: лечение банки ещё не измерено (300 HP — догадка) — не сдаёмся, пока не выпьем банку и не узнаем, сколько она лечит
  // (лог 08.10 00:55, Карте 49: «нужно ≈73, есть 75 → хватит», а бот ушёл через 24 с, не выпив ни одной)
  const probePot = !unrealisticEpic && !win && !!pm && pm.est && pm.n > 0 && need <= pm.n && me.pct > env.cfg.rbRetreatHp;
  // 10.0.2 (лог 12.10 22:45:30–22:46:00, Голконда: HP 22–45 % минуту подряд, смерть): «победа не подтверждена» выключала банки в полосе —
  // пили только аварийно, хотя уйти нельзя (выход заходами выключен). Банки в полосе — всегда, кроме «убьём и без банок» (win0)
  S.usePots = !win0;
  const verdict = win ? 'likely' : pending || probePot ? 'measuring' : 'risk';
  const verdictLabel = win ? '✅ победа вероятна' : pending || probePot ? '🧪 данных недостаточно' : '⚠ победа не подтверждена';
  const risk = spikeRisk ? `крупный удар ≈${Math.round(worstHit)} HP` : !enoughCombatData
    ? `замер ${Math.round(dt)} с, ударов ${hitCount}, снято ${(100 * dealt / Math.max(1, mob.max)).toFixed(1)}%`
    : !potReliable ? 'лечение банок не измерено' : !enoughReserve ? 'малый резерв банок'
    : !enduranceMargin ? 'недостаточный запас выживаемости' : 'ожидаю подтверждения устойчивости';
  S.note = `${verdictLabel} · РБ ≈${env.fmtT(tKill)} при текущем DPS, до опасного HP ≈${env.fmtT(tDie0)}`
    + (loss > 0 && pm ? ` · банки: нужно ≈${need}, доступно ${pm.n}` : '')
    + (!win ? ` · ${risk}` : ' · измерения подтверждены');
  S.stat = `урон ${Math.round(dps)}/с, потеря ${Math.round(loss)} HP/с, ударов ${hitCount}, макс. удар ${Math.round(worstHit)} HP`;
  env.rbLive = { name: ctx.name, cur: mob.cur, max: mob.max, dps, tKill, tDie0, tDie, loss, win, verdict,
    reason: risk, hits: hitCount, worstHit, samples: S.samples.length, duration: dt,
    potsOk, need: pm ? Math.round(need * pm.H) : 0, pool: pm?.pool || 0, t0: S.t0, t: now };
  // Отдельное краткое состояние доступно в Control Center и переживает переход между вкладками.
  if (!S.forecastAt || now - S.forecastAt > 6000 || S.forecastVerdict !== verdict) {
    S.forecastAt = now; S.forecastVerdict = verdict;
    env.setRt({ rbForecast: { id: S.id, name: ctx.name, t: now, status: verdict,
      note: S.note, dps: Math.round(dps), tKill: Number.isFinite(tKill) ? Math.round(tKill) : null,
      hpPct: Math.round(mob.cur / Math.max(1, mob.max) * 100), samples: S.samples.length, hits: hitCount,
      worstHit: Math.round(worstHit), loss: Math.round(loss) } });
  }
  // ясно, что не убьём (прогноз «❌» держится 5 с подряд) — бросаем этого РБ
  S.badSince = win || pending || probePot ? 0 : (S.badSince || now);
  // При реальном уроне << HP эпика бесполезно ждать смертельной серии ударов.
  // Решение опирается только на измеренный DPS, а не на статистику обычных мобов.
  if (unrealisticEpic && dt >= 8 && a.mob - b.mob < mob.max * 0.01) {
    return { abort: true, hopeless: true, why: `эпик: урон ≈${dps.toFixed(1)} HP/с, убийство ≈${env.fmtT(tKill)} (>30 мин)` };
  }
  // РБ не лечится между заходами (или лечится медленнее, чем мы бьём) — убиваем заходами: бьём до порога, отходим,
  // лечимся на мобах (вампирик), возвращаемся. Банки на РБ в этом режиме бережём.
  const chip = !win && S.persist && dps > 0 && (S.regen == null || S.regen < dps * 0.1);
  if (chip) {
    const lossPer = loss > 0 ? me.max * Math.max(10, env.cfg.rbRestHp - env.cfg.rbRetreatHp) / 100 / loss : Infinity;   // длительность полного захода (от «пробую» до «отход»), с
    const perTry = Math.min(lossPer, 1800) * dps;                                          // урон за заход
    S.chip = true; if (env.cfg.rbChipRetreat === true || probeFight(S.id)) S.usePots = false;   // 10.0.2: банки бережём, только если правда отойдём
    S.note = `⚠ заходами: снимем ≈${Math.round(perTry / 1000)}k за заход, нужно ≈${Math.max(1, Math.ceil(mob.cur / Math.max(perTry, 1)))} заход(а)`;
    if (me.pct <= env.cfg.rbRetreatHp) return { retreat: true, why: 'конец захода — лечусь на мобах и вернусь' };
    return { retreat: false };
  }
  if (!win && !pending && !probePot && S.badSince && now - S.badSince >= 5000) return { abort: true, why: `не убить: ${S.note}` };
  if (me.pct <= env.cfg.rbRetreatHp && !win && !pending) return { abort: true, why: `HP ${me.pct | 0}% и сил не хватит` };
  return { retreat: false };
}

// 8.0.3 (лог 11.10 11:42–11:44, Орфен — оба боя начал игрок): удар 2508–2885 = 40–57 % HP героя, бот «из боя уйти нельзя, бьюсь до
// конца» — две смерти за 2 мин (вторая сняла купленный бафф), хотя выход из боя работает (POST /game/battle/leave → 200 в 11:41:53,
// 11:42:05). Аварийное правило в бою с боссом: замеренный одиночный удар (обычный или спецудар; и из прошлых боёв с ним)
// ≥ 45 % макс. HP, а HP меньше двух таких — kind 'strong'; обычный удар ≥ 35 % и следующий убьёт (HP ≤ удар × 1,15) — kind 'brink'.
// Босс почти добит (≤ 5 % HP) — добиваем. Возвращает { kind, worst, pct, why } или null
// 8.0.3 (ревью; лог 10.10 23:23 Селян, бой ВЫИГРАН в 23:25:06): спецудар «Крижана блискавка» 1853 + обычный ≈318 в одном шаге замера —
// S.lethal 2171 (46 % от 4710) давал 'strong' и «не по силам» до нового уровня, а спецудар 1853 при HP 1644 — 'brink'. Скачок HP между
// замерами (S.lethal) — не одиночный удар (спецудар + удары, конец баффа на макс. HP; аудит 8.0 вердикты по нему уже убирал) — здесь
// не считается. 'strong' — по одиночным ударам (обычный и спецудар, свои и из прошлых боёв); 'brink' — только по обычному удару:
// спецудар на откате и следующим ходом не прилетит
function rbFlee(ctx, me, mob) {
  const S = ctx?.rb; if (!S || !(me?.max > 0) || !(me.cur > 0) || !(mob?.max > 0) || mob.cur <= mob.max * 0.05) return null;
  try { rbLearn(ctx); } catch (e) {}
  const d = env.rt.rbDb?.[S.id] || {};
  const hit = Math.round(Math.max(0, ...(S.hits || []), d.hitP90 || 0, d.maxHit || 0));
  const worst = Math.max(hit, Math.round(Math.max(S.sp || 0, d.sp || 0)));
  // 9.2.5: бой-проба — спецудар не замерен, HP героя ниже оценки × 1,1 → выходим (пропуск 30 мин, не «не по силам»)
  const pg = !(S.sp > 0) ? probeGuard(S.id) : 0;
  if (pg && me.cur < pg) return { kind: 'probe', worst: pg, pct: Math.round(pg / me.max * 100),
    why: `пробный заход: спецудар ещё не видел, оценка ≈${Math.round(pg / 1.1)} HP, у меня ${me.cur} < ${pg} — выхожу, пока цел` };
  if (!worst) return null;
  const pct = worst / me.max, strong = pct >= 0.45 && me.cur < 2 * worst, brink = !strong && hit >= me.max * 0.35 && me.cur <= hit * 1.15;
  if (!strong && !brink) return null;
  const w = strong ? worst : hit, wp = Math.round(w / me.max * 100);
  return { kind: strong ? 'strong' : 'brink', worst: w, pct: wp,
    why: `удар ${w} HP = ${wp} % моего макс. HP, у меня ${me.cur} — ${strong ? 'двух таких ударов я не переживу' : 'следующий удар убьёт'}` };
}

// verdict (8.0.3, аварийный выход rbFlee): 'no' — «не по силам» до нового уровня героя, 'skip' — пропуск 30 мин; оба — без возврата
// к нему после отдыха (rbPending), обычный отход (без verdict) — как раньше
async function rbRetreat(ctx, mob, why, verdict) {
  const prev = env.rt.rb?.[ctx.rb.id] || { attempts: 0 };
  const rec = { ...prev, name: ctx.name, max: mob.max, hpAfter: mob.cur, chip: ctx.rb.start - mob.cur,
                attempts: prev.attempts + 1, t: Date.now() };
  await env.setRt({ rb: { ...(env.rt.rb || {}), [ctx.rb.id]: rec }, target: null, rbPending: !verdict,
    ...(verdict ? { rbPreSkip: { ...(env.rt.rbPreSkip || {}), [ctx.rb.id]: { t: Date.now(), kind: 'strong' } } } : {}) });
  await rbNote(ctx.rb.id, { verdict: verdict === 'no' ? 'no' : env.rt.rbDb?.[ctx.rb.id]?.verdict === 'ok' ? 'ok' : 'chip',
                            note: `${verdict ? 'аварийный выход: ' + why + ' · ' : ''}отход: снято ${rec.chip}, у него ${mob.cur}/${mob.max}${ctx.rb.stat ? ' · ' + ctx.rb.stat : ''}` });
  env.setStatus(`РБ ${ctx.name}: ${why} · снято ${rec.chip}, у него ${mob.cur}/${mob.max}`);
  console.log(env.TAG, `РБ ${ctx.name}: ${why}`, rec);
  await env.sleep(env.rnd(300, 700));
  if (await rbShopFirst(ctx.name, true)) return;      // 7.2.3: расходники на исходе — магазин сейчас, потом к этому же РБ
  await env.toOutskirts();                            // дальше — мобы (лечение вампириком) и новый заход при полном HP
}

async function rbAbort(ctx, mob, why) {
  // первый неудачный заход: ещё неизвестно, сохраняется ли HP РБ — отходим «пробно» и проверим при следующем заходе
  const d0 = env.rt.rbDb?.[ctx.rb.id] || {};
  if (!ctx.rb.lethal && !ctx.rb.persist && d0.regen == null && !d0.probed) {   // смертельный удар — без «пробного захода»
    await rbNote(ctx.rb.id, { probed: true });
    return rbRetreat(ctx, mob, `${why} · пробный заход: проверю, сохранится ли HP РБ`);
  }
  const rb = { ...(env.rt.rb || {}) }; delete rb[ctx.rb.id];
  await env.setRt({ rb, rbCur: null, target: null, sinceRb: 0 });
  await rbNote(ctx.rb.id, { verdict: 'no', note: `${why}${ctx.rb.stat ? ' · ' + ctx.rb.stat : ''} · у него ${mob.cur}/${mob.max}` });
  env.setStatus(`РБ ${ctx.name}: ❌ ${why} → выход, в базу «не по силам»`);
  console.info(env.TAG, `РБ ${ctx.name} не по силам: ${why}`, `HP РБ ${mob.cur}/${mob.max}`);
  await env.sleep(env.rnd(300, 700));
  await env.toOutskirts();
}

// 7.2.3 (игрок 10.10: «не срываться посреди РБ докупать соски — покупать после убийства РБ или сходить купить все нужные
// расходники и бить дальше того же РБ»): в бою закупки нет никогда. Проверка — только между боями: перед следующим РБ
// и при отходе от РБ; раз уж идём в магазин — докупаем всё до максимума (force), недобитый РБ после магазина — первым (rbWounded)
async function rbShopFirst(label, retreat) {
  if (!env.cfg.shopAuto || env.rt.shop || Date.now() - (env.rt.shopT || 0) < 600000) return false;
  const [mn] = env.pair(env.cfg.shopHp, '300/1000'), n = env.hpPotStock();
  const low = (env.shopNeedByPanel?.() || '').split(', ').filter(Boolean);
  if (mn && n != null && n < mn && !low.some(x => /^банки HP/.test(x))) low.unshift(`банки HP ${n} < ${mn}`);
  if (!low.length) return false;
  await env.shopStart(`${retreat ? 'отход от РБ' : 'перед РБ'}${label ? ' ' + label : ''}: ${low.join(', ')} — докупаю всё${retreat ? ', потом обратно к нему' : ''}`, true);
  location.href = '/char.html'; await env.sleep(4000);
  return true;
}
 return { isEpicId, rbDpsOn, rbHpNow, probeOk, probeGuard, probeFight, rbFlee, unitOf, rbPriceWhy, rbKnown, rbInfo, rbInfoNote, rbEligible, rbSpM, rbWoundNote, rbWounded, rbSessTick, rbSessEnd, sessIds, rbSpK, rbModalIs, rbValueScore, rbDue, raidList, rbVerdictBlocks, rbLo, rbHi, farmRbOn, rbCandidates, rbPinAttack, rbModalStats, rbPreCheck, rbScout, closeMobModal, rbEngage, rbNote, rbTourPick, isRbPage, rbPageNow, rbRowsParse, rbListScan, rbStatsGuess, rbTeleportCheck, now_, rbListPick, rbListWhy, rbGoStep, huntOn, huntSet, huntDone, rbHuntStep, rbLearn, rbAssess, rbRetreat, rbAbort, rbShopFirst };
 };
})(globalThis);
