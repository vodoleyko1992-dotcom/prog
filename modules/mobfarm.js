/* L2wap v7: isolated mobfarm feature module. Dependencies are injected lazily.
   All game actions remain under the central lease and dispatcher in content.js. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.mobfarm = function create_mobfarm(env) {
// 7.1.30: «Риба · ур. 48 · миньоны зоны эпика» (spawnId l2dop_eg_…) — охрана эпика, не обычный моб
const EPIC_GUARD = /миньон|мін[ьй]он|epic guard|зоны эпика|зони епіка/i;
function pageItems() {
  return [...document.querySelectorAll('#map-mob-list a.l2-map-mob-link')].map(a => {
    const id = (a.getAttribute('href') || '').match(/spawnId=([^&#]+)/)?.[1] || '';
    const text = a.textContent.trim(), m = text.match(env.LV_RE);
    return { a, id, text, name: m ? m[2].trim() : text, lvl: m ? +m[3] : 0,
             quest: a.classList.contains('l2-map-mob-link--quest-target') || env.QUEST.test(text),
             champ: env.isChamp(text), boss: env.isBoss(text) || env.isRaidId(id) || a.classList.contains('l2-map-mob-link--raid') || EPIC_GUARD.test(text) || /--epic_guard/.test(a.className) };
  }).filter(x => x.id);
}

function pagerInfo() {                         // «5 / 27 (398)»
  const m = (env.$q('#map-mob-page-ind')?.textContent || '').match(/(\d+)\s*\/\s*(\d+)\s*\(\s*(\d+)\s*\)/);
  return m ? { cur: +m[1], total: +m[2], count: +m[3] } : null;
}

const pageKey = () => (env.$q('#map-mob-page-ind')?.textContent || '') + '|' + pageItems().map(i => i.id).join(',');

function aroundSig() {
  const parts = (env.$q('#map-mob-list')?.dataset.l2AroundSig || '').split('|');
  const ids = (parts[1] || '').split(',').map(x => x.split(':')[0]).filter(Boolean);
  // «q…» — отдельное поле после «pN|lvN». Список мобов (поле 1) тоже может начинаться с «q» (spawnId «quest_…») — его не берём
  const q = (parts.slice(2).find(p => /^q/.test(p) && !/[:]\d/.test(p)) || 'q').slice(1).split(',').map(x => x.trim()).filter(Boolean);
  return { ids, quest: q };
}

function markerTypes() {
  const t = {};
  // v5.6: тип моба (passive/aggressive/champion…) — из ответа сервера /game/map/spawns: метки карты теперь только у РБ
  if (env.NET_SPAWNS && Date.now() - env.NET_SPAWNS.t < 10 * 60000) Object.assign(t, env.NET_SPAWNS.kind);
  (env.$q('#map-mob-markers')?.dataset.l2MarkerSig || '').split('|')[1]?.split(',').forEach(x => {
    const [id, ty] = x.split(':'); if (id) t[id] = ty;
  });
  return t;
}

async function netSpawns(list) {
  const kind = {}, sp = { ...(env.rt.spawns || {}) };
  let added = 0;
  for (const [id, k, name, lvl] of list) {
    if (!id) continue;
    if (k) kind[id] = k;
    if (name && !env.isRaidId(id) && (!sp[id] || sp[id][0] !== name || sp[id][1] !== lvl)) { sp[id] = [name, lvl]; added++; }
  }
  env.NET_SPAWNS = { t: Date.now(), kind };
  const ch = list.filter(x => x[1] === 'champion'), key = ch.map(x => x[0]).join(',');
  if (key !== (env.rt.netChampKey || '')) {
    env.rt.netChampKey = key;
    if (!env.tabIdle) env.setRt({ netChampKey: key }).catch(() => {});
    if (ch.length) env.rec('B', 'чемпионы', `в списке локации (сервер): ${ch.slice(0, 5).map(x => `${x[2]} (${x[3]})`).join(', ')}${ch.length > 5 ? ` …ещё ${ch.length - 5}` : ''}`);
  }
  if (added && !env.tabIdle) await env.setRt({ spawns: Object.keys(sp).length > 4000 ? Object.fromEntries(list.filter(x => x[2] && !env.isRaidId(x[0])).map(x => [x[0], [x[2], x[3]]])) : sp });
}

function parseRules() {
  // кампания с открытыми мобами-целями: ★ цели главы всегда первые — даже если «Искать квестовых» выключено
  // (так было: галочка снята → правило [квест] выпало → бот бил ближайших Shooter/Marksman вместо ★ Guerilla рядом)
  const campQuest = env.campMobOpen().length > 0;
  const rules = env.cfg.priority.split('\n').map(s => s.trim()).filter(Boolean).map(line => {
    const neg = line.startsWith('-');
    const t = neg ? line.slice(1).trim() : line;
    return {
      neg, line,
      quest: /\[квест\]/i.test(t), champ: /\[чемп\]/i.test(t), all: /\[все\]/i.test(t),
      name: t.replace(/\[(квест|чемп|все)\]/gi, '').trim().toLowerCase()
    };
  }).filter(x => x.neg || ((!x.quest || env.cfg.searchQuest || campQuest) && (!x.champ || champRuleOn())));
  if (campQuest && !rules.some(x => x.quest && !x.neg))
    rules.unshift({ neg: false, line: '[квест] (кампания)', quest: true, champ: false, all: false, name: '' });
  const fr = [...env.farmRules(), ...env.recipeRules()];  // фарм ресурса и охота на рецепт: мобы-источники — сразу после квестовых
  if (fr.length) rules.splice(rules.findIndex(x => !x.neg && x.quest) + 1, 0, ...fr);
  // глава ждёт «★ Чемпионы N/M»: чемпионы редкие, а мобы-цели есть всегда — увиденный чемпион идёт первым
  // (так было: [квест] выше [чемп] → бот бил Marsh Stakato, а чемпионов главы не трогал вовсе)
  if (env.campActive() && env.campChampOpen()) {
    const i = rules.findIndex(x => !x.neg && x.champ && !x.quest && !x.name);
    const r = i >= 0 ? rules.splice(i, 1)[0] : { neg: false, line: '[чемп] (глава)', quest: false, champ: true, all: false, name: '' };
    rules.unshift(r);
  }
  return rules;
}

function champRuleOn() {
  if (env.campActive() && env.campChampOpen()) return true;
  if (env.campActive() && env.campMobOpen().length) return false;
  // v4.30: галочка «Искать чемпионов» решает сама. Раньше бот молча выключал чемпионов, если цепочка давала на 10 % больше
  // EXP/мин, — игрок видел «Чемп» в приоритете, а чемпионов бот не искал
  return !!env.cfg.searchChamp;
}

function chainBetter() {
  const E = env.rt.eff || {}, c = E.chain, m = E.map;
  return !!c && !!m && c.n >= 5 && m.n >= 5 && c.rate > m.rate * 1.1;
}

function chainCarries() {
  const q = env.rt.chainQ || [];
  if (q.length < 6 || (!(+env.cfg.deepEvery > 0) && !env.farmMapOn?.())) return false;   // 7.2: на точке фарма ресурса карта есть и при 0   // 7.1.31: 0 = карту не проверять — откладывать нечего   // v4.28: deepHot больше не отключает цепочку — решает доля целей
  if (env.campActive() && env.campChampOpen() && !env.rt.champSeen?.startsWith('0:')) return false;   // чемпионы главы видны на карте — не откладываем
  return q.reduce((a, b) => a + b, 0) / q.length >= 0.5 && (env.rt.sinceDeep || 0) < env.deepN() * 3;
}

function ruleMatch(x, r) {
  if (!x.quest && !x.champ && !x.all && !x.name) return false;
  if (x.quest && !r.quest) return false;
  if (x.champ && !r.champ) return false;
  if (x.name && !r.name.toLowerCase().includes(x.name)) return false;
  if (x.all && (r.lvl < env.cfg.lvlMin || r.lvl > env.cfg.lvlMax)) return false;
  return true;
}

function rank(r, rules) {
  if (r.boss) return -1;
  if (rules.some(x => x.neg && ruleMatch(x, r))) return -1;
  return rules.filter(x => !x.neg).findIndex(x => ruleMatch(x, r));
}

async function nextFight(ctx) {
  if (env.tvtSoon() && !ctx?.rb) { env.rec('B', 'TvT', 'бой TvT скоро — после этого моба на арену'); location.href = '/tvt-arena.html'; await env.sleep(4000); return; }
  await env.sleep(env.rnd(40, 120));                      // после победы — сразу дальше (v5.4: было 150–350 мс)
  if (!env.on) return;
  // v5.2.2: в «Туре РБ» проверка расходников раньше не доходила (выход на карту стоял выше) — банки не докупались
  if (env.huntOn() && env.cfg.shopAuto && !env.rt.shop && Date.now() - (env.rt.shopT || 0) > 600000) { const low0 = env.shopNeedByPanel(); if (low0) { await env.shopStart(low0); location.href = '/char.html'; await env.sleep(4000); return; } }
  if (env.huntOn() && !((env.rt.rbHuntIdle || 0) > Date.now())) return env.toMap();
  if (env.epicOn() && env.rt.epic?.step && env.rt.epic.step !== 'pick') return env.toMap();   // 🐉 эпики: после миньона/моба — снова к эпику   // тур по РБ: дальше решает rbHuntStep (следующий РБ); пока РБ нет — цепочкой
  // расходники на исходе (по панели) или пора проверить руду (раз в час) — сначала в магазин
  // (не чаще раза в 10 мин — если адены не хватило, не бегаем в магазин после каждого боя)
  if (env.rt.shop) { location.href = '/char.html'; await env.sleep(4000); return; }   // «Закупить сейчас» нажали во время боя
  if (env.rt.bagCheck) { location.href = '/char.html'; await env.sleep(4000); return; }   // «Пересчитать в сумке» из меню
  if (env.rt.zoneGo) { location.href = '/teleport.html'; await env.sleep(4000); return; }   // «Лететь» в меню локаций
  if (!ctx?.rb && await env.townBuffStart('баффы кончились')) return;            // городской бафф слетел (смерть/24 ч)
  const since = Date.now() - (env.rt.shopT || 0);
  const low = since > 600000 ? env.shopNeedByPanel() : '';
  const oreDue = env.cfg.shopAuto && env.shopPlan().some(x => ['spirit', 'soul', 'bait'].includes(x.key)) && since > 3600000;
  if (low || (oreDue && !ctx?.rb)) { await env.shopStart(low || 'плановая проверка запасов'); location.href = '/char.html'; await env.sleep(4000); return; }
  if (env.autonomyMode() === 'fish') return env.goFishing();
  if (env.cfg.catMode && !env.campOn() && !env.huntOn()) {    // 🏛 фарм катакомб: после боя — «Охотиться дальше» внутри подземелья
    // v5.3.1: раньше после каждого моба бот уходил на страницу подземелья и выбирал заново (≈3 с на моба, лог 08.10 14:49).
    // «Охотиться дальше» в подземелье даёт следующего моба оттуда же — цепочкой, как на карте
    if (env.cfg.chain !== false && (env.rt.catIn || /spawnId=sdms_/i.test(location.search))) {
      const hunt = await env.waitFor(() => { const h = env.$q('#battle-victory-hunt'); return env.shown(h) ? h : null; }, 2500, 50);
      if (hunt) {
        env.setStatus('Катакомбы: охотиться дальше'); await env.setRt({ via: 'chain', catInT: Date.now() });
        const href = location.href; env.fire(hunt);
        if (await env.waitFor(() => location.href !== href || (!env.victory() && (env.mobHp()?.cur || 0) > 0), 8000) || !env.on) return;
      }
    }
    return env.catGo();
  }
  if (env.campOn() && env.rt.campaignDue) return env.goCampaign();
  // фарм ресурса (меню или «Нужно сдать» главы): не в той зоне — летим с форума «Фарм ресурсов»
  if ((env.cfg.farmRes || env.cfg.campaign || env.resQuests().length) && !env.cfg.rbMode && !ctx?.rb && !env.campMobOpen().length && await env.farmStep()) return;
  if (env.cfg.recipeRes && !env.cfg.rbMode && !ctx?.rb && !env.campMobOpen().length && await env.recipeStep()) return;   // охота на рецепт
  // сам подбирает локацию для кача (не в кампании/РБ/рыбалке): проба новых подходящих зон, затем лучшая по EXP/ч
  if (env.cfg.zoneAuto && !env.cfg.campaign && !env.cfg.rbMode && !ctx?.rb && !env.lootGoal?.() && Date.now() - (env.rt.zoneGoT || 0) > 600000) {   // 7.2: цель ресурса/рецепта держит на месте
    if ((!env.rt.zoneCatT || env.zoneCatThin() || Date.now() - env.rt.zoneCatT > 24 * 3600000) && ((env.rt.zoneCatFail || 0) < 3 || Date.now() - (env.rt.zoneCatFailT || 0) > 3600000)) { await env.setRt({ zoneScan: true }); location.href = '/teleport.html'; await env.sleep(4000); return; }
    const pick = env.zonePick();
    if (pick) { await env.setRt({ zoneGo: { ...pick, t: Date.now() }, zoneGoT: 0 }); location.href = '/teleport.html'; await env.sleep(4000); return; }
  }
  // глава: «Охотиться дальше» даёт случайного соседа. Чужой моб в цепочке — не повод уходить на карту:
  // уходим, только если цепочка приносит цели реже, чем окупается дорога через карту
  // (время на цель цепочкой = с/моб ÷ доля целей; через карту ≈ с/моб карты — там бот сам выбирает цель).
  const rules = parseRules();
  // 7.2: моб-источник ресурса/рецепта — тоже «цель» (по доле таких в цепочке решаем, нужна ли карта)
  const tgt = !!ctx && (env.isQuestName(ctx.name) || ctx.killed.some(n => env.isQuestName(n)) || (!!ctx.champ && rules.some(x => x.champ && !x.neg))
    || rules.some(x => x.farm && x.name === String(ctx.name || '').toLowerCase()));
  const camp = !!ctx && env.campMobOpen().length > 0;
  if (ctx && (camp || env.searchActive(rules)) && env.rt.via === 'chain') await env.setRt({ chainQ: [...(env.rt.chainQ || []), tgt ? 1 : 0].slice(-12) });
  let offQuest = false;
  if (camp && !tgt) {
    const q = env.rt.chainQ || [], share = (q.reduce((a, b) => a + b, 0) + 1) / (q.length + 2);
    const cs = env.rt.eff?.chain?.sec || 9, ms = env.rt.eff?.map?.sec || 20, perTgt = cs / share;
    offQuest = q.length >= 6 && perTgt > ms * 1.1;           // решаем по 6+ боям цепочки, не по одному чужому мобу
    const why = `цепочка: целей ${Math.round(share * 100)} % · ≈${perTgt.toFixed(0)} с на цель против ≈${ms.toFixed(0)} с через карту`;
    if (env.rt.chainWhy !== (offQuest ? 'map' : 'chain')) env.rec('B', 'цепочка', `${ctx.name} — не цель главы; ${why} → ${offQuest ? 'на карту за целью' : 'продолжаю цепочку'}`);
    await env.setRt({ chainWhy: offQuest ? 'map' : 'chain' });
  }
  // 7.1.30 (10.10 14:01): ★ квестовые мобы на локации (квест профессии: Giant Fungus/Dire Wyrm), а «Охотиться дальше» дал чужого —
  // цепочка 10 боёв била кого попало до плановой проверки карты. Есть открытые ★ цели и этот моб не цель — сразу на карту за целью
  // только если такая цель есть на ЭТОЙ локации (подпись карты «q…» перечисляет цели квеста на любой локации)
  const zM = (env.rt.zoneMobs?.[env.rt.zone] || []).map(n => n.toLowerCase());
  const pqFresh = Date.now() - (env.rt.profQuest?.t || 0) < 3600000;   // 7.1.30: квест профессии — только свежий (≤ 1 ч)
  const qNames = [...(pqFresh ? env.rt.profQuest?.open || [] : []), ...(env.rt.questTargets || []).map(n => n.toLowerCase())].filter(n => env.isQuestName(n));
  // и только если правило [квест] вообще может выбрать цель (иначе карта после каждого боя ни к чему)
  const qRule = rules.some(x => x.quest && !x.neg);
  // 7.1.31: «Проверять карту каждые 0 боёв» = никогда — за ★ целью на карту тоже не ходим (бьём то, что даёт цепочка)
  const qOpen = qRule && env.cfg.searchQuest !== false && !camp && +env.cfg.deepEvery > 0 && qNames.some(n => !zM.length || zM.includes(n));
  if (ctx && qOpen && !tgt && !ctx.rb) {
    offQuest = true;
    if (env.rt.chainWhy !== 'qmap') { env.rec('B', 'цепочка', `${ctx.name} — не ★ цель квеста; иду на карту за целью`); await env.setRt({ chainWhy: 'qmap' }); }
  } else if (ctx && qOpen && tgt && env.rt.chainWhy === 'qmap') await env.setRt({ chainWhy: 'chain' });
  let due = env.mapDue(rules);
  // v4.28: цель далеко по списку карты (deepHot), но цепочка только что дала цель (★/чемпион) — соседи такие же, продолжаем
  // цепочку. Так было: Leto Lizardman Archer на 8-й странице → после КАЖДОГО боя карта (+5–8 с на бой)
  if (due && tgt && env.rt.deepHot && !env.rbDue() && !env.campRbOpen().length && (+env.cfg.deepEvery > 0 || env.farmMapOn?.())) {
    if (env.rt.chainWhy !== 'hot') env.rec('B', 'цепочка', `${ctx.name} — цель; цепочка приносит цели, карту не проверяю`);
    await env.setRt({ chainWhy: 'hot', sinceDeep: Math.min(env.rt.sinceDeep || 0, env.deepN() - 1) });
    due = false;
  }
  if (due && !env.rbDue() && !env.campRbOpen().length && chainCarries()) {
    if (env.rt.chainWhy !== 'carry') env.rec('B', 'цепочка', `цели идут цепочкой (${Math.round((env.rt.chainQ.reduce((a, b) => a + b, 0) / env.rt.chainQ.length) * 100)} % боёв) — плановую проверку карты откладываю`);
    await env.setRt({ chainWhy: 'carry' });
    due = false;
  }
  if (env.cfg.chain && !offQuest && !due) {
    // кнопка «Охотиться дальше» появляется на экране победы не сразу (иногда через 0,3–1 с) —
    // ждём её, а не уходим на карту (v4.6–4.13: бот уходил через 0,2 с, «цепочка не работает»)
    const hunt = await env.waitFor(() => { const h = env.$q('#battle-victory-hunt'); return env.shown(h) ? h : null; }, 2500, 50);
    if (hunt) {
      env.setStatus('Охотиться дальше');
      await env.setRt({ via: 'chain' });
      const href = location.href;
      env.fire(hunt);
      const ok = await env.waitFor(() => (location.href !== href && !env.victory()) || (!env.victory() && (env.mobHp()?.cur || 0) > 0), 8000);   // 7.1.30: пока экран победы виден, бой не «начат» — иначе «Охотиться дальше» жмётся дважды
      if (ok || !env.on) return;
      console.info(env.TAG, '«Охотиться дальше» не сработало — иду на карту');
    }
  }
  await env.toMap();
}

async function mapReady(timeout = 30000, label = '') {   // список мобов отрисован и не меняется (игра грузит его до ~10–20 с)
  let prev = '', same = 0;
  const t0 = Date.now(); let sec0 = -1;
  return env.waitFor(() => {
    const sec = (Date.now() - t0) / 1000 | 0;
    if (label && sec >= 2 && sec !== sec0) { sec0 = sec; env.rt = { ...env.rt, status: `${label} · ${sec} с` }; env.draw(); }   // только индикатор, без записи в журнал
    if (env.serverDown()) return 'down';           // страница ошибки сервера — ждать список бессмысленно
    if (!env.$q('#map-mob-list')?.dataset.l2AroundSig || !pagerInfo() || !pageItems().length) { same = 0; return false; }
    const k = (env.$q('#map-mob-page-ind')?.textContent || '') + '|' + pageItems().length;   // порядок строк не учитываем
    same = k === prev ? same + 1 : 0;
    prev = k;
    return same >= 2;
  }, timeout, 250);
}

let farRecT = 0;
function candidates(rules, sig, types, limitIdx) {
  const out = [];
  sig.ids.forEach((id, idx) => {
    if (idx >= limitIdx || env.isRaidId(id) || types[id] === 'raid' || types[id] === 'epic_guard') return;
    const c = env.rt.spawns?.[id];
    const minL = env.campChampMin();
    const champ = types[id] === 'champion' && !(minL && c && c[1] && c[1] < minL);
    if (!c && !champ) return;                  // имя неизвестно и не чемпион — оценить нельзя
    const name = c ? c[0] : '', lvl = c ? c[1] : 0;
    const r = { id, idx, name, lvl, champ, boss: !!name && env.isBoss(name),
                quest: !!name && env.isQuestName(name, sig.quest) };
    // моб на 7+ ур. выше: атака почти не попадает (лог 20:20: Bloody Banshee 74 при герое 41 — атака 1–2 урона,
    // бой 26 с вместо 3). Такие — не цели, даже если чемпионы. Цели квеста — до +10
    const hl = env.heroLvl();
    // v5.6: чемпион открытой главы — цель квеста: окно «не ниже героя на N» и «не по зубам» к нему не применяем
    // (глава «Champions · Lv.24» при герое 31 — все чемпионы 24–27 отсекались окном lvlBelow 3)
    // 7.2: моб-источник ресурса/рецепта (правило farm) — как цель квеста: зона выбрана под него (до −10 ур.), окно уровней не отсекает
    const farmT = !!name && rules.some(x => x.farm && x.name === name.toLowerCase());
    const qLike = r.quest || farmT || (champ && env.campActive() && env.campChampOpen());
    // v4.58: «мягкое окно» — улететь в зону своего уровня не вышло, а тут все выше: 20 мин бьём самых слабых из тех, что есть
    const relax = env.rt.lvlRelax && Date.now() - env.rt.lvlRelax.t < 20 * 60000 ? env.rt.lvlRelax.up : 0;
    if (hl && lvl && lvl > hl + Math.max(qLike ? 10 : 0, env.cfg.lvlAbove ?? 15, relax)) return;
    // v4.44: и не ниже героя больше чем на lvlBelow (по умолчанию 5): после смерти бот бил пауков 15 ур. героем 49
    const relaxDown = env.rt.lvlRelaxDown && Date.now() - env.rt.lvlRelaxDown.t < 20 * 60000;   // 7.1.30: и при автофарме, если улететь не вышло
    if (hl && lvl && !qLike && !relaxDown && env.cfg.lvlBelow !== 0 && lvl < hl - (env.cfg.lvlBelow ?? 3)) return;
    // «не по зубам» по опыту: бой с этим видом шёл дольше 45 с (или урон ≈0) — пропускаем 2 часа (v4.23)
    const hard = env.rt.hardMobs?.[(name || '').toLowerCase()];
    if (hard && Date.now() - hard.t < 7200000 && !qLike) return;
    const k = rank(r, rules);
    if (k >= 0) out.push({ ...r, rank: k });
  });
  return out.sort((a, b) => a.rank - b.rank || a.idx - b.idx);   // приоритет, затем ближе
}

async function attackSpawn(c, label) {
  const page = Math.floor(c.idx / env.PAGE_SIZE) + 1;
  const sel = `#map-mob-list a[href*="spawnId=${CSS.escape(c.id)}"]`;
  if (!(await env.gotoPage(page)) || !env.on) return false;
  let a = env.$q(sel);
  for (const d of [1, -1]) { if (a || !env.on) break; if (await env.gotoPage(page + d)) a = env.$q(sel); }
  if (!a || !env.on) return false;
  const it = pageItems().find(x => x.id === c.id);
  if (it) Object.assign(c, { name: c.name || it.name, lvl: c.lvl || it.lvl, quest: c.quest || it.quest, champ: c.champ || it.champ });
  env.setStatus(label(c));
  console.log(env.TAG, 'цель:', c.id, c.name, '| поз.', c.idx);
  await env.pause();
  if (!env.on) return true;
  await env.setRt({ target: { name: c.name, champ: c.champ, quest: c.quest, rb: !!c.rb }, mobClickAt: Date.now(), via: 'map' });
  env.fire(a);
  if (!(await env.waitFor(env.isBattle, 10000)) && env.on) {   // бой не открылся — обновляем карту; стоп только после 3 раз подряд
    const n = (env.rt.clickFail || 0) + 1;
    if (n >= 3) { await env.setRt({ clickFail: 0 }); await env.halt('Клик по мобу 3 раза подряд не открыл бой — проверьте игру'); return true; }
    await env.setRt({ clickFail: n });
    env.rec('B', 'карта', `клик по «${c.name}» не открыл бой — обновляю карту (${n}/3)`);
    location.reload(); await env.sleep(8000);
  } else if (env.rt.clickFail) await env.setRt({ clickFail: 0 });
  return true;
}

async function map() {
  // защита от петли «клик по мобу → снова карта»
  if (env.rt.mobClickAt && Date.now() - env.rt.mobClickAt < 8000) {
    const n = (env.rt.bounce || 0) + 1;
    await env.setRt({ bounce: n, mobClickAt: 0 });
    if (n >= 3) return env.halt('Клик по мобу 3 раза вернул на карту — пришлите лог');
    env.setStatus(`Бой не открылся (${n}/3), пауза 5 с`);
    await env.sleep(5000);
    if (!env.on) return;
  }
  if (env.shown(env.$q('#map-defeat-root'))) return env.onDeath();
  if (await env.townBuffStart('баффов нет')) return;

  env.setStatus('Карта: жду список мобов');
  await env.sleep(env.rnd(150, 300));
  if (!env.on) return;
  const tab = env.$q('#map-list-mode-mobs');        // открыта вкладка NPC — переключаем на «Мобы»
  if (tab && !tab.classList.contains('is-active')) { env.fire(tab); await env.sleep(500); }
  const mr = await mapReady(30000, 'Карта: жду список мобов');
  if (mr === 'down' || env.serverDown()) return;     // ошибка сервера — разберётся главный цикл (ожидание без остановки)
  if (!mr && env.on && !pageItems().length) {
    const n = (env.rt.mapReload || 0) + 1;
    if (n > 3) {                                 // сервер/интернет лежит: ждём и пробуем снова; стоп — если так 15 мин
      const down = env.rt.mapDownT || Date.now();
      if (Date.now() - down > 15 * 60000) { await env.setRt({ mapReload: 0, mapDownT: 0 }); return env.halt('Список мобов не грузится 15 минут — проверьте игру/интернет'); }
      await env.setRt({ mapReload: 0, mapDownT: down });
      env.rec('B', 'карта', 'список мобов не грузится — жду 2 мин и пробую снова');
      await env.idle(120000, 'Игра не отвечает — жду и пробую снова');
      location.reload(); await env.sleep(8000); return;
    }
    await env.setRt({ mapReload: n });
    env.rec('B', 'карта', `список мобов не загрузился за 30 с — перезагрузка ${n}/3`);
    env.setStatus(`Список мобов не загрузился — обновляю карту (${n}/3)`);
    location.reload(); await env.sleep(8000); return;
  }
  if (!env.on) return;
  if (!pageItems().length) {                     // пустой список — как «не загрузился»: обновить (до 3 раз)
    const n = (env.rt.mapReload || 0) + 1;
    if (n > 3) { await env.setRt({ mapReload: 0 }); return env.halt('Не вижу список мобов — проверьте игру'); }
    await env.setRt({ mapReload: n }); location.reload(); await env.sleep(8000); return;
  }
  if (env.rt.mapReload || env.rt.mapDownT) await env.setRt({ mapReload: 0, mapDownT: 0 });

  if (env.cfg.rbMode || env.farmRbOn()) {
    // все РБ локации — в базу (видно игроку, даже вне уровня)
    const seen = { ...(env.rt.rbSeen || {}) };
    env.raidList().forEach(r => { seen[r.id] = { name: r.name, lvl: r.lvl, inRange: r.lvl >= env.rbLo(env.heroLvl()) && r.lvl <= env.rbHi(env.heroLvl()), zone: env.rt.zone || seen[r.id]?.zone || null, seenT: Date.now() }; });
    const rbs = env.rbCandidates(), me = env.meHp();
    await env.setRt({ rbSeen: seen, rbPending: rbs.length > 0, sinceRb: 0 });
    const bw = rbs.length && me && me.pct >= env.cfg.rbRestHp ? env.buffWaitBeforeRb() : null;
    if (bw) { env.setRt({ status: `РБ ${rbs[0].name}: жду откат «${bw.who}» ${bw.s} с` }); env.draw(); await env.sleep(Math.min(bw.s, 10) * 1000); return; }
    if (rbs.length && me && me.pct >= env.cfg.rbRestHp) {
      const r = rbs[0];
      await env.setRt({ rbCur: r.id });
      const d = env.rt.rbDb?.[r.id];
      const lbl = c => `РБ: ${c.name} (${c.lvl})${d?.verdict === 'ok' ? ' ✅' : d?.verdict === 'chip' ? ' ⚠' : ' ❔'}`
          + (env.rt.rb?.[c.id]?.hpAfter ? ` · у него ${env.rt.rb[c.id].hpAfter}/${env.rt.rb[c.id].max}` : '');
      if (await env.townBuffStart(`перед РБ ${r.name}`, true)) return;   // v5.3: бафф слетел — сначала баффер, потом РБ
      const res = await env.rbEngage(r, lbl(r));              // v4.46: оценка до боя по окну РБ
      if (res === true) return;
      if (res === 'skip') { await env.setRt({ rbCur: null }); return; }
    } else if (rbs.length) {
      env.setStatus(`РБ ждёт: HP ${me ? me.pct | 0 : '?'}% < ${env.cfg.rbRestHp}% — лечусь на мобах`);
      await env.sleep(600);
    } else {
      env.setStatus(`РБ по силам нет (ур. ${env.rbLo(env.heroLvl())}–${env.rbHi(env.heroLvl())}) — фармлю обычных`);
      await env.setRt({ rbCur: null, rbZoneVisit: { ...(env.rt.rbZoneVisit || {}), [env.rt.zone || '?']: Date.now() } });
      // тур по РБ (v4.23): здесь РБ нет — не фармим, а сразу летим дальше. Сначала — список зон из «Телепорта»
      // (бесплатно), потом по очереди: знакомые РБ → РБ с форума → разведка зон по уровню. Мобов фармим,
      // только когда все подходящие зоны уже обойдены за последние 40 мин
      if (env.cfg.rbMode && env.cfg.rbTour !== false && !env.campActive() && Date.now() - (env.rt.zoneGoT || 0) > 8000) {   // v5.6: тур — только в «Фарм РБ», не при походе за ресурсом
        // v4.27: главный источник — список РБ игры (Меню → Рейдовые боссы): живые, разрешённые, с телепортом прямо к ним
        if (!env.rt.rbListT || Date.now() - env.rt.rbListT > 15 * 60000) { await env.setRt({ rbScan: true }); location.href = '/rb-bosses.html'; await env.sleep(4000); return; }
        const rp = env.rbListPick();
        if (rp) { await env.setRt({ rbGo: { id: rp.id, name: rp.name, lvl: rp.lvl, page: rp.page, price: rp.price, t: Date.now() }, rbTourWhy: '', rbTourNext: 0 }); return; }
        if (!env.rt.zoneCatT) { env.rec('B', 'РБ-тур', 'списка зон ещё нет — читаю «Телепорт»'); await env.setRt({ zoneScan: true }); location.href = '/teleport.html'; await env.sleep(4000); return; }
        const pick = env.rbTourPick();
        if (pick) {
          env.rec('B', 'РБ-тур', `здесь (${env.zoneName(env.rt.zone)}) РБ по силам нет → ${env.zoneName(pick.id)}: ${pick.why}`);
          await env.setRt({ zoneGo: { id: pick.id, url: pick.url || null, t: Date.now(), why: 'РБ-тур: ' + pick.why }, zoneGoT: 0, rbTourWhy: '' });
          return;
        }
        if (env.rt.rbTourWhy !== 'none') env.rec('B', 'РБ-тур', `все подходящие зоны (${Object.keys(env.rt.rbZoneVisit || {}).length}) обойдены за 40 мин — фармлю обычных здесь, проверяю снова через 3 мин`);
        await env.setRt({ rbTourWhy: 'none', rbTourNext: Date.now() + 180000 });
      }
      await env.sleep(600);
    }
  }

  // глава требует убить РБ («★ Рейдовый босс: Емісар Нурки»): ищем его метку на карте и идём, когда HP полное.
  // Бой — та же логика, что в «Фарм РБ»: оценка «убьём ли», банки, отход и заходы, если не по силам за раз
  if (env.campRbOpen().length) {
    const want = env.campRbOpen()[0], me = env.meHp();
    const r = env.raidList().find(x => x.idx >= 0 && env.nameLike(x.name, want.name));
    const key = r ? 'see:' + r.id : 'none';
    if (env.rt.campRbSeen !== key) { env.rec('B', 'РБ главы', r ? `«${want.name}» на карте (ур. ${r.lvl}) — иду, когда HP ≥ ${env.cfg.rbRestHp}%` : `«${want.name}» на карте не виден (убит/не появился) — фармлю, проверяю карту каждые 3 боя`); await env.setRt({ campRbSeen: key }); }
    if (r && env.rbVerdictBlocks(r.id)) env.setStatus(`РБ главы ${want.name}: не по силам на ур. ${env.heroLvl()} — фармлю и расту`);
    else if (r && me && me.pct >= env.cfg.rbRestHp) {
      await env.setRt({ rbCur: r.id });
      const d = env.rt.rbDb?.[r.id];
      const done = await attackSpawn({ ...r, rb: true, champ: true, rank: 0 },
        c => `РБ главы: ${c.name} (${c.lvl})${d?.verdict === 'ok' ? ' ✅' : d?.verdict === 'chip' ? ' ⚠ заходами' : ''}`
          + (env.rt.rb?.[c.id]?.hpAfter ? ` · у него ${env.rt.rb[c.id].hpAfter}/${env.rt.rb[c.id].max}` : ''));
      if (done) return;
      // в списке не нашёлся — через метку на карте: «Емісар Нурки · ур. 33 · рейд-босс» → окно → «В бой»
      const pin = env.$q(`.l2-map-mob-pin--raid[data-spawn-id="${CSS.escape(r.id)}"]`);
      if (pin && env.on) {
        env.fire(pin);
        const go = await env.waitFor(() => { const a = env.$q('#map-mob-modal-battle'); return env.shown(a) ? a : null; }, 3000, 100);
        await env.setRt({ target: { name: r.name, champ: true, quest: true, rb: true }, mobClickAt: Date.now(), via: 'map' });
        if (go) env.fire(go); else location.href = '/battle.html?spawnId=' + encodeURIComponent(r.id);
        await env.waitFor(env.isBattle, 10000);
        return;
      }
    } else if (r) env.setStatus(`РБ главы ${want.name}: жду HP ${me ? me.pct | 0 : '?'}% → ${env.cfg.rbRestHp}% — фармлю`);
  }

  const rules = parseRules();
  if (!rules.some(x => !x.neg)) return env.halt('Список приоритетов пуст');
  // 7.1.30: «Автофарм» включили / нажали «Старт» с ним — сразу проверяем локации, не дожидаясь 10 мин после боя:
  // каталог зон «Телепорта» (устарел — перечитать), мобов своего уровня тут нет — в зону своего уровня, иначе — лучшая/пробная зона
  // 7.2: есть цель «ресурс»/«рецепт» — при старте сразу к её источнику (раньше — сначала в зону для опыта, потом обратно)
  const lg = !env.campActive() && !env.cfg.rbMode && !env.cfg.fishMode ? env.lootGoal?.() : null;
  if (lg && env.rt.zone !== lg.zone) {
    if (env.rt.zoneAutoKick) await env.setRt({ zoneAutoKick: null });
    if (lg.kind === 'farm' ? await env.farmStep() : await env.recipeStep()) return;
  }
  if (env.cfg.zoneAuto && env.rt.zoneAutoKick && !lg && !env.campActive() && !env.cfg.rbMode && !env.cfg.fishMode) {
    if ((!env.rt.zoneCatT || env.zoneCatThin() || Date.now() - env.rt.zoneCatT > 24 * 3600000) && ((env.rt.zoneCatFail || 0) < 3 || Date.now() - (env.rt.zoneCatFailT || 0) > 3600000)) {
      env.rec('B', 'локации', 'автофарм: при старте читаю список зон «Телепорта»');
      await env.setRt({ zoneScan: true }); location.href = '/teleport.html'; await env.sleep(4000); return;   // kick остаётся — после чтения выбор зоны
    }
    await env.setRt({ zoneAutoKick: null, zoneLvlT: 0 });
    await mapReady(15000);
    if (await env.zoneForLevel()) return;
    const pick = env.zonePick();
    if (pick) { env.rec('B', 'локации', `автофарм: при старте → ${pick.name || pick.id}`); await env.setRt({ zoneGo: { ...pick, t: Date.now() }, zoneGoT: 0 }); location.href = '/teleport.html'; await env.sleep(4000); return; }
    env.rec('B', 'локации', `автофарм: проверил локации — остаюсь здесь (${env.rt.zone || 'текущая зона'})`);
    await env.setRt({ zoneGoT: Date.now() });
  }

  let sig = aroundSig();
  await env.absorb();
  // ★ цели: из подписи карты + ★ в строках списка (несюжетные квесты); в «оригинальном» написании имён
  // только свежие (до 6 ч, как в isQuestName) и только мобы текущей зоны: раньше ★ из прошлой локации
  // (Leto Lizardman Warrior в Hot Springs) висела в «На локации» и считалась квестовой целью бесконечно
  const zMobs = (env.rt.zoneMobs?.[env.rt.zone] || []).map(n => n.toLowerCase());
  const seenQ = Object.entries(env.rt.questSeen || {}).filter(([k, t]) => Date.now() - t < 6 * 3600000 && (!zMobs.length || zMobs.includes(k)))
    .map(([k]) => Object.values(env.rt.spawns || {}).find(v => v[0].toLowerCase() === k)?.[0] || k);
  await env.setRt({ questTargets: [...new Set([...sig.quest, ...seenQ])] });

  // цели главы (мобы и чемпионы) ищем по всему списку локации, а не только на первых страницах
  // 7.1.30: и открытые цели квеста профессии (Giant Fungus лежал на 25-й стр. списка из 26)
  const zMq = (env.rt.zoneMobs?.[env.rt.zone] || []).map(n => n.toLowerCase());
  const profOpen = ((env.rt.profQuest?.open || []).length > 0 && Date.now() - (env.rt.profQuest.t || 0) < 3600000)
    || (sig.quest || []).some(n => zMq.includes(String(n).toLowerCase()) && env.isQuestName(n));   // 7.1.30: ★ цель есть на этой локации — ищем по всему списку
  const deep = env.mapDue(rules) || env.campMobOpen().length > 0 || (env.campActive() && env.campChampOpen()) || profOpen;
  const limitIdx = deep ? sig.ids.length : env.cfg.maxPages * env.PAGE_SIZE;

  // изучить страницы с ещё неизвестными мобами (только если цели высшего приоритета пока нет)
  const unknownPages = [...new Set(sig.ids.map((id, i) => [id, i])
    .filter(([id, i]) => i < limitIdx && !env.isRaidId(id) && !env.rt.spawns?.[id])
    .map(([, i]) => Math.floor(i / env.PAGE_SIZE) + 1))].sort((a, b) => a - b);
  // изучать имена незачем, если уже есть цель лучшего «именного» правила (чемпионов видно по меткам и без имён)
  const pos = rules.filter(x => !x.neg), named = Math.max(0, pos.findIndex(x => !(x.champ && !x.quest && !x.name)));
  const best0 = candidates(rules, sig, markerTypes(), limitIdx)[0];
  if (unknownPages.length && !(best0 && best0.rank <= named)) {
    const cap = env.campMobOpen().length ? 30 : 6;     // ищем цели главы — изучаем локацию целиком за один заход
    for (const [k, p] of unknownPages.slice(0, cap).entries()) {
      env.setStatus(`Изучаю список локации: стр. ${p} (${k + 1}/${Math.min(cap, unknownPages.length)} из ${unknownPages.length})`);
      if (!(await env.gotoPage(p)) || !env.on) break;
      await env.absorb();
    }
    if (!env.on) return;
    sig = aroundSig();
  }
  // глава: открытые мобы-цели должны быть в списке ЭТОЙ локации. Подпись карты «q…» тут не помогает —
  // она перечисляет цели квеста на любой локации. Смотрим имена мобов (кэш спавнов), когда список изучен ≥85 %.
  // Так было: телепорт «без сообщения» → 15 мин фарма Plains of Dion вместо Fortress of Resistance.
  const open = env.campMobOpen();
  if (open.length) {
    const ids = sig.ids.filter(id => !env.isRaidId(id) && !/^dung_/.test(id));
    const known = ids.filter(id => env.rt.spawns?.[id]).length / Math.max(1, ids.length);
    const here = ids.some(id => open.includes((env.rt.spawns?.[id]?.[0] || '').toLowerCase()));
    if (!here && known >= 0.85 && (env.rt.wrongLoc || 0) < 3) {
      await env.setRt({ wrongLoc: (env.rt.wrongLoc || 0) + 1, lastTeleport: '', campaignDue: true });
      env.rec('B', 'локация', `целей главы (${open.join(', ')}) в списке локации нет (изучено ${Math.round(known * 100)} %) — телепорт заново ${env.rt.wrongLoc}/3`);
      env.setStatus(`Цели главы не на этой локации — телепорт заново (${env.rt.wrongLoc}/3)`);
      return env.goCampaign();
    }
    if (here && env.rt.wrongLoc) await env.setRt({ wrongLoc: 0 });
  }

  let cands = candidates(rules, sig, markerTypes(), limitIdx);
  // 7.2.1 (лог 10.10 21:17:34): после города «В Окрестности» ближе всего — мобы 69–78 ур., и бот улетел в Pavel Ruins (≈2,6 M EXP/ч),
  // хотя в этой же локации дальше по списку — мобы 54–63 ур. (замер тут ≈4,45 M EXP/ч на 52 ур.). Ближние страницы без своих —
  // сперва свои по всей локации (имена из кэша спавнов), телепорт — только если их нет нигде
  if (!cands.length && !deep && limitIdx < sig.ids.length) {
    const far = candidates(rules, sig, markerTypes(), sig.ids.length);
    if (far.length) {
      if (Date.now() - farRecT > 600000) { farRecT = Date.now(); env.rec('B', 'локации', `рядом мобов своего уровня нет — иду к ${far[0].name || '?'} (${far[0].lvl || '?'}) на стр. ${Math.floor(far[0].idx / env.PAGE_SIZE) + 1} этой же локации, без телепорта`); }
      cands = far;
    }
  }
  if (env.campActive() && env.campChampOpen()) {          // сколько чемпионов главы сейчас на локации — в журнал при изменении
    const ch = cands.filter(c => c.champ), key = ch.length + ':' + (ch[0]?.id || '');
    if (env.rt.champSeen !== key) {
      const ct = env.campOpen().find(t => t.champ);
      env.rec('B', 'чемпионы', ch.length ? `на локации ${ch.length}: ${ch.slice(0, 3).map(c => `${c.name || '?'} (${c.lvl || '?'})`).join(', ')} — иду к ближайшему (глава: ${ct.done}/${ct.total})`
        : `чемпионов на локации сейчас нет (глава: ${ct.done}/${ct.total}) — бью цели главы, проверяю карту чаще`);
      await env.setRt({ champSeen: key });
    }
  }
  if (deep) {
    const near = cands.find(c => c.idx < env.cfg.maxPages * env.PAGE_SIZE);
    // «горячая» карта (идти на неё после каждого боя) — только для ★ квестовых целей и чемпионов главы.
    // Обычные чемпионы ([чемп] по галочке) — плановая проверка раз в N боёв, между ними цепочка (v4.28:
    // лог 23:08–23:10 — 6 чемпионов подряд через карту, по 15–17 с на каждый, цепочка простаивала)
    const hot = !!cands[0] && (cands[0].quest || (env.campActive() && env.campChampOpen() && cands[0].champ)) && (!near || cands[0].rank < near.rank);
    await env.setRt({ sinceDeep: 0, deepHot: hot });
  }
  // 7.1.30: «Сам подбирать локацию» выключен — с локации НЕ улетаем никогда (лог 14:12: бот улетел из Sea of Spores в Enchanted Valley).
  // Мобы тут ниже окна уровня — бьём их (окно снизу снимается на 20 мин, продлевается)
  if (!cands.length && !env.campActive() && env.cfg.zoneAuto && !(env.lootGoal?.()?.zone === env.rt.zone) && await env.zoneForLevel()) return;
  if (!cands.length && !env.campActive()) {   // 7.1.30: автофарм включён, а улететь некуда — тоже бьём, что есть, а не «Целей нет» до остановки
    const hl = env.heroLvl(), lv = pageItems().filter(i => !i.champ && !i.boss && i.lvl).map(i => i.lvl);
    const downOn = env.rt.lvlRelaxDown && Date.now() - env.rt.lvlRelaxDown.t < 20 * 60000;
    const lo = hl - (env.cfg.lvlBelow ?? 3);   // 7.1.30: РБ/охрана эпика не считаются; хватит того, что есть мобы ниже окна
    if (hl && lv.length && lv.some(l => l < lo) && !downOn) {
      env.rec('B', 'локации', `мобы тут ${Math.min(...lv)}–${Math.max(...lv)} ур. (герой ${hl}) — подбор локации выключен, остаюсь и бью их`);
      await env.setRt({ lvlRelaxDown: { t: Date.now() } });
      return;
    }
  }   // v4.44: мобов своего уровня нет — в зону своего уровня
  // v4.58: улететь не вышло (нет подходящей зоны / нет кнопки / недавно пробовали), а все мобы тут выше окна —
  // не стоим на «Целей нет»: 20 мин бьём самых слабых из этих (бои > 45 с всё равно отсекаются как «не по зубам»)
  if (!cands.length && !env.campActive()) {
    const hl = env.heroLvl(), lv = pageItems().filter(i => !i.champ && i.lvl).map(i => i.lvl);
    const relaxOn = env.rt.lvlRelax && Date.now() - env.rt.lvlRelax.t < 20 * 60000;
    if (hl && lv.length && Math.min(...lv) > hl + (env.cfg.lvlAbove ?? 10) && !relaxOn) {
      const up = Math.min(...lv) - hl;
      env.rec('B', 'локации', `мобов своего уровня нет, в зону своего уровня улететь не вышло — 20 мин бью самых слабых здесь (${Math.min(...lv)} ур., +${up} к герою)`);
      await env.setRt({ lvlRelax: { t: Date.now(), up } });
      return;                                      // следующий проход выберет цель с «мягким окном»
    }
  }
  if (!cands.length) {
    env.setStatus('Целей нет, обновлю карту через 15 с');
    for (let i = 0; i < 15 && env.on && !env.rt.shop?.urgent; i++) await env.sleep(1000);
    if (env.on) { location.href = '/map.html'; await env.sleep(5000); }
    return;
  }

  // цель могла погибнуть/сдвинуться — пробуем до 5 лучших
  for (const c of cands.slice(0, 5)) {
    if (await attackSpawn(c, c => `Цель: ${c.name || 'чемпион'} (${c.lvl || '?'})${env.tags(c)} · приоритет ${c.rank + 1} · стр. ${pagerInfo()?.cur}`)) return;
    if (!env.on) return;
  }
  env.setStatus('Цели исчезли из списка, ищу заново');
  await env.sleep(1500);
}
 return { pageItems, pagerInfo, pageKey, aroundSig, markerTypes, netSpawns, parseRules, champRuleOn, chainBetter, chainCarries, ruleMatch, rank, nextFight, mapReady, candidates, attackSpawn, map };
 };
})(globalThis);
