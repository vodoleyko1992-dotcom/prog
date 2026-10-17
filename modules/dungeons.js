/* L2wap v7: isolated dungeons feature module. Dependencies are injected lazily.
   All game actions remain under the central lease and dispatcher in content.js. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.dungeons = function create_dungeons(env) {
const location = env.routeLocation || root.location;
const isCatPage = () => location.pathname === env.CAT_URL;

const isDungeon = () => /\/dungeon\.html/i.test(location.pathname);

const dungeonHere = () => new URLSearchParams(location.search).get('dungeonId') || '';
// 15.10, ревизия: таймаут native-телепорта не доказывает отказ. Только точный
// ответ отправленного запроса снимает запрет повторной оплаты после reload.
// 20.12 (ревизия 17.10, аудит H2): отказ — по общему правилу payments (в т. ч. 423/429 и 2xx с error);
// без квитанции — сверка по GET /character: герой в подземелье — прибыл; через ≥2 мин дважды «не в подземелье,
// без смерти» — телепорт не применился (запрос с expectedRevision: старый уже не спишет адену поверх нового).
async function paymentReconcile() {
  const P = env.payments?.pending(); if (!P || P.kind !== 'cat-teleport') return !P;
  const A = env.catPaymentNet?.(), E = P.evidence || {};
  const bound = A && A.t >= P.at && A.id === E.id && A.paymentId === P.id && A.expectedAdenaCost === P.quote.amount;
  if (bound && !((A.ok && A.characterName !== P.char) || (A.characterId && E.actorId && A.characterId !== E.actorId))) {
    const out = A.outcome || (A.ok ? 'applied' : env.payments.REJECT?.includes(A.status) ? 'rejected' : 'unknown');
    if (out === 'applied') return env.payments.confirm(P, { kind: 'server-receipt', id: A.id, status: A.status });
    if (out === 'rejected') return env.payments.confirm(P, { kind: 'server-rejected', id: A.id, status: A.status, spent: 0 });
  }
  const char = env.rt.char, lease = env.leaseEpoch, valid = () => env.tabOwner !== false && env.leaseEpoch === lease && env.rt.char === char && char === P.char && env.payments.pending()?.id === P.id;
  if (env.gameGet && env.payments.probeDue?.(P)) {
    let ch = null;
    try { const r = await env.gameGet('/character'), j = r.ok ? await r.json() : null; ch = j?.character || j; } catch (_) {}
    if (!valid()) return false;
    if (ch?.name === P.char && (!E.actorId || ch.id === E.actorId) && Number.isSafeInteger(ch.revision)) {
      const here = ch.activeDungeonId != null && String(ch.activeDungeonId) === String(E.id);
      if (here && ch.revision > E.revision) { env.payments.probeNote(P, false); return env.payments.confirm(P, { kind: 'target-arrival', id: E.id, revision: ch.revision }); }
      const died = (env.rt.deathLog || []).some(t => t >= P.at);
      if (env.payments.probeNote(P, !here && !died && Number.isSafeInteger(E.revision) && ch.revision >= E.revision))
        return env.payments.confirm(P, { kind: 'state-not-applied', id: E.id, revision: ch.revision, spent: 0 });
    }
  }
  env.setStatus('Катакомбы: результат телепорта неизвестен; повторно не плачу, сверяю состояние героя'); return false;
}

let catQuoteWait = null;
// 20.6 (лог 16.10 23:54): отказ проверки не должен запускать запросы и ложный «телепорт» каждый тик.
const catQuoteContext = id => JSON.stringify([id, env.rt.char, env.rt.manualKickAt, env.cfg.catDungeon, env.cfg.shopReserve, env.cfg.shopMaxSpend]);
async function catQuoteReject(id, why) {
  catQuoteWait = { key: catQuoteContext(id), until: Date.now() + 15000, why };
  env.setStatus(`Катакомбы: ${why}; повторная проверка через 15 с`);
  return false;
}
async function catTeleport(id, active) {
  // У старых автономных DOM-fixture нет платежного модуля; основной runtime всегда передаёт его.
  if (!env.payments) return null;
  let ch, row;
  try {
    const [cr, lr] = await Promise.all([env.gameGet('/character'), env.gameGet('/game/catacombs')]);
    const [c, l] = await Promise.all([cr.json(), lr.json()]);
    if (!active()) return false;
    ch = cr.ok && c?.character; row = lr.ok && l?.dungeons?.find(x => x?.dungeonId === id);
  } catch (_) { if (active()) return catQuoteReject(id, 'не удалось получить цену и персонажа'); return false; }
  const price = row?.adenaCost, adena = typeof ch?.adena === 'string' && /^\d+$/.test(ch.adena) ? +ch.adena : ch?.adena;
  const why = !ch ? 'сервер не подтвердил персонажа' : ch.name !== env.rt.char || !ch.id ? 'персонаж ответа не совпадает с текущим'
    : !Number.isSafeInteger(ch.revision) ? 'сервер не подтвердил ревизию персонажа'
    : ch.inBattle !== false ? 'сервер не подтвердил выход из боя'
    : !Number.isSafeInteger(price) || price < 0 ? 'сервер не подтвердил цену телепорта'
    : !Number.isSafeInteger(adena) || adena < 0 ? 'сервер не подтвердил запас адены'
    : price > 0 && adena - price < Math.max(0, env.cfg.shopReserve ?? 200000) ? 'после телепорта не останется заданного запаса адены'
    : price > 0 && price > (env.cfg.shopMaxSpend ?? 2000000) ? 'цена телепорта превышает лимит расходов' : '';
  if (why) return catQuoteReject(id, why);
  const button = () => env.$q(`.l2-rb-row__tp[data-dungeon-id="${CSS.escape(id)}"]`);
  const quoted = el => {
    const txt = el?.closest('.l2-rb-row')?.querySelector('.l2-rb-row__price-gold, .l2-rb-row__price')?.textContent || '';
    if (/coin|luck|монет|удач|\bcol\b/i.test(txt)) return false;
    const m = txt.match(/\d[\d\s\u00a0\u202f]*/);
    return !!el && !el.disabled && env.shown(el) && (price === 0 && /бесплат|безкоштов|\bfree\b/i.test(txt) || /аден|adena/i.test(txt) && m && +m[0].replace(/\s/g, '') === price);
  };
  if (!quoted(button())) return catQuoteReject(id, 'кнопка телепорта или её цена не подтверждены');
  catQuoteWait = null;
  const P = await env.payments.prepare({ key: `cat:${id}`, kind: 'cat-teleport', quote: { amount: price, currency: 'Adena' }, evidence: { id, revision: ch.revision, actorId: ch.id } });
  if (!P) return false;
  const patch = { catTpT: Date.now(), catCur: id, catBackTried: 0 };
  const before = Object.fromEntries(Object.keys(patch).map(k => [k, env.rt[k] ?? null]));
  const rollback = async () => { if (env.payments.matchesContext(P) && Object.keys(patch).every(k => env.rt[k] === patch[k])) await env.setRt(before); };
  const saved = await env.setRt(patch);
  if (saved?.ok !== true || !await env.rtCommit() || !active() || !quoted(button()) || !env.payments.sent(P)) { await rollback(); await env.payments.cancel(P); return false; }
  if (env.fire(button()) === false) { await rollback(); await env.payments.cancel(P, { notSent: true }); return false; }
  // Запись и разрешение отправки завершены до native-клика: сама страница может сразу исчезнуть.
  return true;
}

const catGuard = () => {
  const context = () => JSON.stringify([env.rt.char, env.rt.manualKickAt, env.cfg.catMode, env.cfg.catDungeon]);
  const saved = context();
  return () => env.on !== false && env.tabOwner !== false && env.cfg.catMode !== false && env.canAct?.() !== false && env.canRun?.() !== false && context() === saved;
};

const catLv = id => { const k = env.rt.catLv?.[id]; return k?.n >= 3 ? [k.lo, k.hi, true] : [env.CAT_LIST[id]?.[1] || 0, env.CAT_LIST[id]?.[2] || 0, false]; };

function catTarget() {                            // какое подземелье: выбранное в меню или «авто» — по уровню героя
  if (env.cfg.catDungeon && env.cfg.catDungeon !== 'auto' && env.CAT_LIST[env.cfg.catDungeon]) return env.cfg.catDungeon;
  const L = env.heroLvl(); if (!L) return env.rt.catCur || null;
  const bad = env.rt.catBad || {}, now = Date.now();
  const c = Object.keys(env.CAT_LIST).filter(id => now - (bad[id] || 0) > 3600000).map(id => { const [lo, hi, seen] = catLv(id); return { id, lo, hi, seen, d: L < lo ? lo - L + 5 : L > hi ? L - hi : 0 }; })
    .sort((a, b) => a.d - b.d || (b.seen - a.seen) || (a.id === env.rt.catCur ? -1 : b.id === env.rt.catCur ? 1 : 0));
  // 10.0.7 (лог 13.10 13:21): герой уже стоит в подземелье по уровню (character.activeDungeonId) — «авто» не уводит его в другое такое же
  // (Devotion/Martyrdom/Witch для 67 равны по уровню; раньше решал порядок списка — после боя могли улететь в соседнее за адену)
  const at = env.heroAt?.()?.dung, here = at && c.find(x => x.id === at);
  if (here && here.d === c[0].d) return at;
  return c[0]?.id || null;
}

function dungeonMobs() {                          // строки списка мобов подземелья (текущая страница)
  return [...document.querySelectorAll('#dungeon-mob-list li')].map(li => {
    const a = li.querySelector('a[href*="battle"], a.l2-map-mob-link, a'), t = (a?.textContent || li.textContent || '').replace(/\s+/g, ' ').trim();
    const m = t.match(/^(★\s*)?(.+?)\s*·\s*ур\.?\s*(\d+)/i);   // 9.0: «★ » — цель квеста профессии (игра ставит перед именем)
    const id = decodeURIComponent((a?.getAttribute('href') || '').match(/spawnId=([^&]+)/)?.[1] || '');
    return a && m ? { a, name: m[2].trim(), lvl: +m[3], quest: !!m[1] || /quest-target/.test(a.className), rb: /рейд|raid/i.test(t) || /--raid/.test(a.className), champ: /чемп|champion/i.test(t) || /--champion/.test(a.className) || /^champ_[or]_/.test(id),
      id, tier: env.champTier?.(id, a, '') || '', info: li.querySelector('[data-spawn-id]') } : null;
  }).filter(Boolean);
}

// 9.0 (живой ответ 11.10, Catacomb of the Witch: 190 мобов 60–72 ур., игра показывает по 15 на странице по возрастанию уровня): бот видел
// только открытую страницу — герою 66 ур. на первой были мобы 60–61, «Авто» решало «подходящих нет» и бросало подземелье на час. Тип моба
// (чемпион, РБ) в разметке не виден вовсе. Теперь — весь список из ответа игры (hook.js → env.dungNet), разметка — запасной путь
const BOSS_KIND = /raid|epic|boss/i;
function mobList(id) {
  const N = env.dungNet?.(), dom = dungeonMobs();
  if (N && N.id === id && Date.now() - N.t < 30000 && Array.isArray(N.mobs)) {
    const q = new Set(dom.filter(x => x.quest).map(x => x.id));
    return { net: true, list: N.mobs.map((x, i) => ({ id: x[0], kind: x[1], name: x[2], lvl: +x[3] || 0, aggr: !!x[4], i,
      rb: BOSS_KIND.test(x[1]), champ: /champ/i.test(x[1]) || /^champ_[or]_/.test(x[0]), tier: x[5] || env.champTier?.(x[0], null, '') || '',
      quest: q.has(x[0]) || dom.some(d => d.quest && d.name === x[2]) })).filter(x => x.id && x.lvl) };
  }
  return { net: false, list: dom.map((x, i) => ({ ...x, i })) };
}
const mobLink = sid => [...document.querySelectorAll('#dungeon-mob-list a[href*="spawnId="]')].find(a => decodeURIComponent((a.getAttribute('href') || '').match(/spawnId=([^&]+)/)?.[1] || '') === sid) || null;
// 20.7 (лог17.10 01:02): защита от Cancel не должна открывать карту после каждой победы.
// Свежий список читаем без перехода; штатная страница выбранного боя сама запускает его.
async function catNext() {
  const guard = catGuard(), href = location.href, search = location.search;
  const sid = new URLSearchParams(search).get('spawnId') || '', id = sid.match(/^sdms_(.+)_\d+$/)?.[1];
  const active = () => guard() && (!env.autonomyMode || env.autonomyMode() === 'cat') && env.cfg.chain !== false && location.href === href && location.search === search && env.victory?.() === true;
  if (!id || !/\/battle\.html$/i.test(location.pathname) || !active()) return true;
  let d;
  try { const r = await env.gameGet('/game/dungeon/view?dungeonId=' + encodeURIComponent(id)); if (r.ok) d = (await r.json())?.dungeon; } catch (_) {}
  if (!active()) return true;
  if (!d || d.id !== id || !Array.isArray(d.mobs)) return false;
  // Как штатная цепочка: только обычные мобы; чемпионов проверяет отдельный поиск.
  const list = d.mobs.filter(x => x && typeof x.id === 'string' && x.id !== sid && x.id.startsWith('sdms_' + id + '_') && /^\d+$/.test(x.id.slice(('sdms_' + id + '_').length)) && x.inBattleRange !== false && !/champ|raid|epic|boss/i.test(x.kind || ''))
    .map(x => ({ id: x.id, name: x.name, lvl: +x.level || 0, rb: false, champ: false })).filter(x => x.name && x.lvl > 0);
  const pick = catPick(list, env.heroLvl());
  if (!pick) return false;
  await env.setRt({ target: { name: pick.name, champ: false, rb: false }, mobClickAt: Date.now(), via: 'dungeon', catInT: Date.now() });
  if (!active() || !catPick([pick], env.heroLvl())) return true;
  env.setStatus(`Катакомбы: следующий бой с ${pick.name} (${pick.lvl})`);
  location.href = '/battle.html?spawnId=' + encodeURIComponent(pick.id);
  return true;
}
// 9.0: ссылка на моба — свежая, прямо перед кликом. Игра перерисовывает список каждые 5 с (опрос /game/dungeon/view, innerHTML = ''), а клик по
// старой, уже удалённой из страницы ссылке не делает ничего («клик не открыл бой», 6 с впустую и вход заново). Моб на другой странице
// списка — листаем «‹ / ›» (#dungeon-mob-page-prev/next) до нужной (≤ 20 нажатий)
async function showMob(sid, idx, active = catGuard()) {
  for (let k = 0; k < 20 && active(); k++) {
    const a = mobLink(sid); if (a) return a;
    const ind = (env.$q('#dungeon-mob-page-ind')?.textContent || '').match(/(\d+)\s*\/\s*(\d+)/), cur = ind ? +ind[1] - 1 : 0, want = idx >= 0 ? Math.floor(idx / 15) : -1;
    const btn = want >= 0 && want < cur ? env.$q('#dungeon-mob-page-prev') : env.$q('#dungeon-mob-page-next');
    if (!btn || btn.disabled || !env.shown(btn) || (want >= 0 && want === cur)) return null;
    env.fire(btn); await env.sleep(120);
  }
  return active() ? mobLink(sid) : null;
}

async function catGo(id) {                        // в подземелье: если уже стоим у входа — «Войти», иначе телепорт со страницы катакомб
  if (env.payments?.blocked()) { await paymentReconcile(); return; }
  const active = catGuard();
  if (!active()) return;
  id ||= catTarget();
  if (!id) {
    // 20.13 (ревизия 17.10, шаг 5, farm/DG-1): все подземелья в часовом бане — это не «не знаю уровень героя»: честный статус и простой
    const bad = env.rt.catBad || {}, ids = Object.keys(env.CAT_LIST || {}), now = Date.now();
    const until = env.heroLvl() && ids.length ? Math.min(...ids.map(k => (bad[k] || 0) + 3600000)) : 0;
    if (until > now) { const hh = new Date(until).toTimeString().slice(0, 5); await env.idle(Math.min(60000, until - now), `Катакомбы: все подземелья на паузе до ${hh} (см. журнал) — жду`); return; }
    env.setStatus('Катакомбы: не знаю уровень героя — жду'); await env.sleep(3000); return;
  }
  const nm = env.CAT_LIST[id]?.[0] || id;
  if (isCatPage() && catQuoteWait?.key === catQuoteContext(id) && Date.now() < catQuoteWait.until) {
    env.setStatus(`Катакомбы: ${catQuoteWait.why}; жду повторной проверки`); await env.sleep(1000); return;
  }
  // Квитанция пришла, но native redirect мог потеряться. Не оплачиваем снова
  // при следующем тике/перезагрузке той же страницы: сначала смотрим вход на карте.
  const receipt = env.rt.actionPayments?.history?.[0];
  if (isCatPage() && receipt?.kind === 'cat-teleport' && receipt.evidence?.id === id
      && receipt.char === env.rt.char && receipt.kick === (+env.rt.manualKickAt || 0)
      && receipt.confirmation?.kind === 'server-receipt' && Date.now() - receipt.confirmedAt < 60000) {
    location.href = '/map.html'; await env.sleep(3000); return;
  }
  // v5.6: выбранное вручную подземелье недоступно (нет в списке / ошибка входа 2 раза) — не летаем по кругу за адену, ждём
  if (Date.now() - ((env.rt.catBad || {})[id] || 0) < 3600000 && env.cfg.catDungeon === id) { await env.idle(60000, `Катакомбы: «${nm}» сейчас недоступно (${env.rt.catBadWhy?.[id] || 'см. журнал'}) — выберите другое или «авто»`); return; }
  if (isDungeon() && dungeonHere() === id) return catHunt(id);
  // 9.0: где герой — по последнему снимку игры (character.activeDungeonId). Ещё внутри этого подземелья (после боя, магазина, обмена камней) —
  // прямо на его страницу, без «входа» и телепорта. Снимок свежее ошибки «не в подземелье» (catGoneT) — иначе ходили бы по кругу
  const at = env.heroAt?.();
  if (at && at.t > (env.rt.catGoneT || 0)) {
    if (at.dung === id) { env.setStatus(`Катакомбы: назад в ${nm}`); location.href = `/dungeon.html?dungeonId=${encodeURIComponent(id)}`; await env.sleep(4000); return; }
    if (!at.dung && env.rt.catIn === id && !env.rt.catBackTried && at.t > (env.rt.catInT || 0)) await env.setRt({ catBackTried: 1 });   // игра: герой уже снаружи — сразу телепорт
  }
  if (!active()) return;
  const enter = env.$q('#map-dungeon-enter:not([hidden]) #map-dungeon-enter-link, #map-dungeon-enter-link');
  if (env.isMap() && enter && env.shown(enter) && (enter.getAttribute('href') || '').includes('dungeonId=' + id)) {
    env.setStatus(`Катакомбы: вхожу в ${nm}`); await env.pause();
    if (!active() || !env.fire(enter)) return;
    if (!(await env.waitFor(isDungeon, 8000)) && active()) location.href = `/dungeon.html?dungeonId=${id}&enter=1`;
    await env.sleep(1500); return;
  }
  // уже внутри (после боя): сначала пробуем вернуться прямо в подземелье — без телепорта
  if (env.rt.catIn === id && Date.now() - (env.rt.catInT || 0) < 15 * 60000 && !env.rt.catBackTried) {
    // v5.3.1: назад — всегда с «&enter=1» (вход заново). Без него после магазина/баффера сервер считал героя снаружи:
    // «Підійди ближче до моба на карті» (battle_too_far), бот стоял (лог 08.10 15:03–15:04)
    await env.setRt({ catBackTried: 1 }); if (!active()) return; env.setStatus(`Катакомбы: назад в ${nm}`); location.href = `/dungeon.html?dungeonId=${id}&enter=1`; await env.sleep(4000); return;
  }
  if (Date.now() - (env.rt.catTpT || 0) < 25000 && env.isMap()) {            // только что прилетели — вход ещё не прорисовался
    if (Date.now() - env.rt.catTpT > 12000) { location.href = `/dungeon.html?dungeonId=${id}&enter=1`; await env.sleep(4000); return; }
    env.setStatus(`Катакомбы: жду вход в ${nm}`); await env.sleep(1000); return;
  }
  if (!isCatPage()) { env.setStatus(`Катакомбы: лечу в ${nm}`); location.href = env.CAT_URL; await env.sleep(4000); return; }
  const b = await env.waitX(() => env.$q(`.l2-rb-row__tp[data-dungeon-id="${CSS.escape(id)}"]`), 8000, 200);
  if (!active()) return;
  if (!b) { env.rec('B', 'катакомбы', `${nm}: нет в списке «Катакомбы — Некрополи»`); await env.setRt({ catBad: { ...(env.rt.catBad || {}), [id]: Date.now() }, catBadWhy: { ...(env.rt.catBadWhy || {}), [id]: 'нет в списке катакомб' } }); location.href = '/map.html'; await env.sleep(3000); return; }
  const price = (b.closest('.l2-rb-row')?.querySelector('.l2-rb-row__price-gold, .l2-rb-row__price')?.textContent || '').replace(/\s+/g, ' ').trim();
  // 15.10: отсутствие цифр не означает бесплатный вход; Coin of Luck и неизвестную валюту не оплачиваем.
  const unit = /coin|luck|монет|удач|\bcol\b/i.test(price) ? 'Coin of Luck' : /аден|adena/i.test(price) ? 'аден' : '';   // как epics.unitOf
  if (unit === 'Coin of Luck' || unit !== 'аден' && !/бесплат|безкоштов|\bfree\b/i.test(price)) {
    const why = `телепорт не за адену («${price.slice(0, 40)}») — Coin of Luck бот не тратит`;
    env.rec('B', 'катакомбы', `${nm}: ${why}`);
    await env.setRt({ catBad: { ...(env.rt.catBad || {}), [id]: Date.now() }, catBadWhy: { ...(env.rt.catBadWhy || {}), [id]: why.slice(0, 60) }, catIn: null });
    location.href = '/map.html'; await env.sleep(3000); return;
  }
  if (env.payments) {
    await env.pause(); if (!active()) return;
    if (!await catTeleport(id, active)) return;
    env.rec('B', 'катакомбы', `телепорт в ${nm}${price ? ' (' + price + ')' : ''}`);
    await env.waitX(() => !isCatPage() || env.catPaymentNet?.()?.t >= (env.payments.pending()?.at || Infinity), 8000, 200);
    await paymentReconcile(); return;
  }
  env.rec('B', 'катакомбы', `телепорт в ${nm}${price ? ' (' + price + ')' : ''}`);
  await env.setRt({ catTpT: Date.now(), catCur: id, catBackTried: 0 });
  if (!active()) return;
  const t0 = Date.now(); await env.pause(); if (!active() || !env.fire(b)) return;
  if (!(await env.waitX(() => !isCatPage(), 8000, 200))) {
    // 9.0: отказ телепорта игра показывает окном alert (hook.js пересылает его текст). 3 отказа подряд — подземелье пропускаю на час
    const A = env.gameAlert?.(), why = (A?.t >= t0 ? A.text : '') || (env.$q('#catacombs-load-err')?.textContent || '').trim() || 'без ответа';
    const n = ((env.rt.catTpErr || {})[id] || 0) + 1;
    env.rec('B', 'катакомбы', `${nm}: телепорт не сработал — ${why.slice(0, 100)} (${n}/3)`);
    await env.setRt({ catTpT: 0, catTpErr: { ...(env.rt.catTpErr || {}), [id]: n >= 3 ? 0 : n }, ...(n >= 3 ? { catBad: { ...(env.rt.catBad || {}), [id]: Date.now() }, catBadWhy: { ...(env.rt.catBadWhy || {}), [id]: why.slice(0, 60) } } : {}) });
    await env.sleep(3000); return;   // следующий круг нажмёт снова (игра после отказа сама обновляет список и цену)
  }
  if ((env.rt.catTpErr || {})[id]) env.setRt({ catTpErr: { ...env.rt.catTpErr, [id]: 0 } });
}

async function catHunt(id) {
  const active = catGuard(); if (!active()) return;                      // внутри подземелья: список мобов → бой
  const nm = env.CAT_LIST[id]?.[0] || id;
  const netOk = () => { const N = env.dungNet?.(); return N && N.id === id && Date.now() - N.t < 30000; };
  const ok = await env.waitX(() => netOk() || dungeonMobs().length || env.shown(env.$q('#dungeon-load-err')) ? 1 : 0, 10000, 250);
  if (!active()) return;
  const err = env.shown(env.$q('#dungeon-load-err')) ? (env.$q('#dungeon-load-err').textContent || '').trim() : '';
  if (err) {                                       // «вы не в подземелье» и т.п. — входим заново через телепорт
    // v5.6: та же ошибка 2 раза подряд — подземелье недоступно на 1 ч (раньше: платный телепорт каждые 15–20 с бесконечно)
    const en = ((env.rt.catErrN || {})[id] || 0) + 1;
    if (en >= 2) {
      env.rec('B', 'катакомбы', `${nm}: ${err.slice(0, 100)} — ${en}-й раз подряд, подземелье пропускаю на 1 ч`);
      await env.setRt({ catErrN: { ...(env.rt.catErrN || {}), [id]: 0 }, catIn: null, catGoneT: Date.now(), catBad: { ...(env.rt.catBad || {}), [id]: Date.now() }, catBadWhy: { ...(env.rt.catBadWhy || {}), [id]: err.slice(0, 60) } });
      if (!active()) return; location.href = env.cfg.catDungeon === id ? '/map.html' : env.CAT_URL; await env.sleep(4000); return;
    }
    env.rec('B', 'катакомбы', `${nm}: ${err.slice(0, 100)} — вхожу заново`);
    await env.setRt({ catIn: null, catGoneT: Date.now(), catBackTried: 1, catTpT: 0, catErrN: { ...(env.rt.catErrN || {}), [id]: en } }); if (!active()) return; location.href = env.CAT_URL; await env.sleep(4000); return;
  }
  if ((env.rt.catErrN || {})[id]) env.setRt({ catErrN: { ...env.rt.catErrN, [id]: 0 } });
  await env.setRt({ catIn: id, catInT: Date.now(), catBackTried: 0, catCur: id });
  if (!active()) return;
  const { net, list } = mobList(id), L = env.heroLvl();
  if (!ok || !list.length) {
    const n = (env.rt.catEmpty || 0) + 1; await env.setRt({ catEmpty: n });
    env.setStatus(`Катакомбы ${nm}: мобов нет — жду респаун (${n})`);
    if (n >= 6) { env.rec('B', 'катакомбы', `${nm}: мобов нет 6 раз подряд — другое подземелье на 1 ч`); await env.setRt({ catEmpty: 0, catBad: { ...(env.rt.catBad || {}), [id]: Date.now() } }); if (!active()) return; location.href = env.CAT_URL; await env.sleep(4000); return; }
    // 9.0: игра сама обновляет список раз в 5 с — ждём новый ответ, без перезагрузки страницы
    const t0 = env.dungNet?.()?.t || 0;
    if (!(await env.waitX(() => (env.dungNet?.()?.t || 0) > t0 && env.dungNet().mobs.length ? 1 : 0, 12000, 300))) { if (!active()) return; location.reload(); await env.sleep(4000); }
    return;
  }
  if (env.rt.catEmpty) await env.setRt({ catEmpty: 0 });
  // уровни подземелья — по тому, что видим (для автовыбора); 9.0: по всему списку из ответа игры — сразу «видел» (n = 3)
  const lv = list.filter(x => !x.rb).map(x => x.lvl);
  if (lv.length) { const k = env.rt.catLv?.[id] || { n: 0 }, lo = Math.min(...lv), hi = Math.max(...lv);
    if (k.lo !== lo || k.hi !== hi || (k.n || 0) < 3) { await env.setRt({ catLv: { ...(env.rt.catLv || {}), [id]: { lo: net ? lo : Math.min(lo, k.lo ?? lo), hi: net ? hi : Math.max(hi, k.hi ?? hi), n: net ? Math.max(3, (k.n || 0) + 1) : (k.n || 0) + 1, t: Date.now() } } });
      if (!k.n || (net && (k.lo !== lo || k.hi !== hi))) env.rec('B', 'катакомбы', `${nm}: мобы ${lo}–${hi} ур.${net ? `, ${list.length} шт.` : ''} (${[...new Set(list.map(x => x.name))].slice(0, 8).join(', ')})`); } }
  if (!active()) return;
  const pick = catPick(list, L);
  if (!pick) {
    const auto = !env.cfg.catDungeon || env.cfg.catDungeon === 'auto', w = catWin(L);
    // 20.13 (ревизия 17.10, шаг 5, farm/DG-1): мобы по уровню есть, но все отфильтрованы («не по зубам», снятие баффов, цвет/отказ чемпиона) —
    // раньше подземелье банилось на час как «нет мобов по уровню» и бот платил за телепорт в следующее, там то же самое, по кругу.
    // Теперь: настоящая причина в журнал (раз в 10 мин), без бана и без перелёта — ждём, пока список/метки обновятся
    const inLvl = list.filter(x => !x.rb && x.lvl >= w.lo && x.lvl <= w.hi);
    if (inLvl.length) {
      const hardOf = x => { const h = env.rt.hardMobs?.[(x.name || '').toLowerCase()]; return !!h && Date.now() - h.t < 7200000; };
      const why = [[inLvl.filter(hardOf).length, '«не по зубам»'], [inLvl.filter(x => !hardOf(x) && env.cfg.noCancelMobs !== false && env.cancelRisk?.(x.name, x.champ, x.tier)).length, 'снимают баффы'],
        [inLvl.filter(x => x.champ && !hardOf(x)).length, 'чемпионы вне выбранных цветов/отложены']].filter(([n]) => n > 0).map(([n, t]) => `${n} ${t}`).join(', ') || 'отфильтрованы';
      env.setStatus(`Катакомбы ${nm}: мобы ${w.lo}–${w.hi} ур. есть (${inLvl.length}), но не цели: ${why} — жду`);
      let lastT = 0; try { lastT = +sessionStorage.getItem('l2bot.catFiltRec') || 0; } catch (e) {}
      if (Date.now() - lastT > 600000) { try { sessionStorage.setItem('l2bot.catFiltRec', String(Date.now())); } catch (e) {}
        env.rec('B', 'катакомбы', `${nm}: мобов ${w.lo}–${w.hi} ур. ${inLvl.length}, но все не цели (${why}) — остаюсь и жду, подземелье не бросаю`); }
      const t0 = env.dungNet?.()?.t || 0;
      if (!(await env.waitX(() => (env.dungNet?.()?.t || 0) > t0 ? 1 : 0, 15000, 500))) { if (!active()) return; location.reload(); await env.sleep(4000); }
      return;
    }
    env.setStatus(`Катакомбы ${nm}: мобов ${w.lo}–${w.hi} ур. нет (есть ${Math.min(...list.map(x => x.lvl))}–${Math.max(...list.map(x => x.lvl))})${auto ? ' — ищу другое подземелье' : ' — жду'}`);
    if (auto) { if (net) env.rec('B', 'катакомбы', `${nm}: мобов ${w.lo}–${w.hi} ур. нет — другое подземелье на 1 ч`); await env.setRt({ catBad: { ...(env.rt.catBad || {}), [id]: Date.now() }, catBadWhy: { ...(env.rt.catBadWhy || {}), [id]: 'нет мобов по уровню' }, catIn: null }); if (!active()) return; location.href = env.CAT_URL; await env.sleep(4000); return; }
    await env.sleep(10000); if (!active()) return; location.reload(); await env.sleep(4000); return;
  }
  env.setStatus(`Катакомбы ${nm}: бой с ${pick.name} (${pick.lvl})${pick.champ ? ' — чемпион' : ''}`);
  await env.pause(); if (!active() || !catPick([pick], env.heroLvl())) return;
  await env.setRt({ target: { name: pick.name, champ: pick.champ, quest: !!pick.quest, rb: pick.rb,
    ...(pick.champ ? { tier: pick.tier || '', lvl: pick.lvl, lim: pick.chLim || 0, exp: pick.exp || 0, fa: pick.fa, valueT: Date.now(), probe: !!pick.chProbe } : {}) }, mobClickAt: Date.now(), via: 'dungeon' });
  if (!active()) return;
  const a = await showMob(pick.id, net ? pick.i : -1, active);
  // Пауза и перелистывание асинхронны: запреты могли измениться до самого клика.
  if (!active() || !catPick([pick], env.heroLvl())) { if (active()) await env.setRt({ target: null }); return; }
  if (a) { env.fire(a); if (await env.waitFor(env.isBattle, 6000)) { if (!active()) return; if (env.rt.catFar) env.setRt({ catFar: 0 }); return; } }
  // ссылка не открыла бой (или моба не нашли на страницах) — через окно моба и «В бой»
  const info = a?.closest('li')?.querySelector('[data-spawn-id]') || [...document.querySelectorAll('#dungeon-mob-list [data-spawn-id]')].find(x => x.dataset.spawnId === pick.id);
  if (!active() || !catPick([pick], env.heroLvl())) { if (active()) await env.setRt({ target: null }); return; }
  if (info) { env.fire(info); const go = await env.waitFor(() => { const g = env.$q('#dungeon-mob-modal-battle'); return env.shown(g) ? g : null; }, 3000, 100); if (go) { if (!active() || !catPick([pick], env.heroLvl())) { if (active()) await env.setRt({ target: null }); return; } env.fire(go); if (await env.waitFor(env.isBattle, 8000)) return; } }
  if (!active()) return;
  // бой не открылся: «подойди ближе» (герой снаружи подземелья) — входим заново; два раза подряд не помогло — через телепорт
  const far = /ближ|too_far|далеко/i.test(env.noticeText() + ' ' + (env.$q('#dungeon-load-err')?.textContent || '')) || env.NET_ERR.err === 'battle_too_far' && Date.now() - env.NET_ERR.t < 8000;
  const n = (env.rt.catFar || 0) + 1;
  if (n >= 3) { env.rec('B', 'катакомбы', `${nm}: бой не открывается${far ? ' («подойди ближе»)' : ''} — захожу заново через телепорт`); await env.setRt({ catFar: 0, catIn: null, catGoneT: Date.now(), catTpT: 0, catBackTried: 1 }); if (!active()) return; location.href = env.CAT_URL; await env.sleep(4000); return; }
  await env.setRt({ catFar: n });
  env.rec('B', 'катакомбы', `${nm}: ${a ? `клик по «${pick.name}» не открыл бой` : `«${pick.name}» нет в списке на странице`}${far ? ' — «подойди ближе»: вхожу в подземелье заново' : ' — обновляю'} (${n}/2)`);
  if (!active()) return; location.href = `/dungeon.html?dungeonId=${encodeURIComponent(id)}&enter=1`; await env.sleep(5000);
}

// 9.0: окно уровней. «Авто» — от героя −«ниже» до +«выше» (меню «Желаемый уровень мобов»); подземелье выбрано вручную — его мобы любого уровня
// (v5.3.1: выбрал высокую зону — бот стоял и «ждал мобов по уровню», лог 08.10 14:47)
function catWin(L) {
  const auto = !env.cfg.catDungeon || env.cfg.catDungeon === 'auto';
  return auto ? { lo: L - Math.min(+env.cfg.lvlBelow > 0 ? +env.cfg.lvlBelow : 5, 5),   // 10.0.5: не ниже героя −5 (FA)
     hi: L + (env.cfg.lvlAbove ?? 99) } : { lo: 0, hi: 999 };
}
// 9.0: кого бить. В катакомбах РБ нет; неожиданные raid/epic-строки здесь не выбираем, РБ — только в туре;
// первыми ★-цели квеста, затем чемпионы (≈×10 EXP и адены за ×2 HP — kb/README), затем ближе к «герой +1». Среди равных — случайный
// (с одним и тем же spawnId чаще сталкиваешься с другими игроками)
function catPick(list, L) {
  const w = catWin(L);
  const ok = list.filter(x => {
    if (x.rb || x.lvl < w.lo || x.lvl > w.hi) return false;
    if (x.champ && env.champs?.tierOff?.(x, true)) return false;   // выбранные цвета соблюдаем и для квестовых чемпионов
    const quest = x.quest || (x.champ && env.campActive?.() && env.campChampOpen?.());
    // 14.10, аудит Astra: выбор должен соблюдать отказ боя «жду роста силы» и минимальный уровень героя.
    if (x.champ && !x.rb && !quest) {
      if (env.champs?.tierOff?.(x) || env.champs?.held?.(x)) return false;
      const j = env.champs?.judge?.(x);
      if (j && !j.ok) return false;
      if (j) Object.assign(x, { chLim: j.lim || 0, chProbe: !!j.probe });
    }
    // 14.10: catPick игнорировал запреты карты: «не по зубам» снова начинал бой, а Cancel снова отправлял к бафферу.
    const hard = env.rt.hardMobs?.[(x.name || '').toLowerCase()];
    if (!x.rb && !quest && hard && Date.now() - hard.t < 7200000) return false;
    if (!quest && env.cfg.noCancelMobs !== false && env.cancelRisk?.(x.name, x.champ, x.tier)) return false;
    return true;
  });
  if (!ok.length) return null;
  const key = x => [x.quest ? 0 : 1, x.champ ? 0 : 1, Math.abs(x.lvl - L - 1)];
  ok.sort((a, b) => { const A = key(a), B = key(b); return A[0] - B[0] || A[1] - B[1] || A[2] - B[2]; });
  const k0 = JSON.stringify(key(ok[0])), best = ok.filter(x => JSON.stringify(key(x)) === k0);
  return best[Math.floor(Math.random() * best.length)];
}

// ---------- 9.0 (просьба игрока 11.10: «добавь кнопку — автообмен камней на AA»): камни печати → Ancient Adena ----------
// Ancient Trader — NPC города (Город → Ancient Trader, /ancient-trader.html). Курс (GET /game/ancient-trader/offers, 11.10): зелёный 6360 → 5 AA,
// синий 6361 → 3 AA, красный 6362 → 10 AA. Строки .l2-ancient-trader-exchange[data-stone=green|blue|red]: «У тебе: N» (.l2-ancient-trader-owned__value),
// поле количества, кнопка «Обміняти»; итог — #ancient-trader-result, ошибка строки — .l2-ancient-trader-exchange__err. Запрос игры —
// POST /game/ancient-trader/exchange {stone, qty, expectedRevision} (env.sealNet — ответ). Камни больше ни на что не нужны, адена/CoL не тратятся
const SEAL = { green: [6360, 'зелёных', 5], blue: [6361, 'синих', 3], red: [6362, 'красных', 10] };
const isSealPage = () => location.pathname === '/ancient-trader.html';
// сколько камней в сумке по ответам игры (null — сумку давно не видели)
function sealStones() {
  const q = Object.values(SEAL).map(([id]) => env.invQty?.(id));
  return q.some(x => x == null) ? null : q.reduce((a, b) => a + b, 0);
}
// пора ли менять: кнопка «Обменять сейчас» (rt.sealEx, 15 мин) или автообмен (cfg.sealAuto) — камни есть (≥ cfg.sealMin), не чаще раза в 20 мин,
// и, если сервер уже ответил «только в городе» (rt.sealTown), — только когда герой в городе
function sealDue() {
  if (env.rt.sealEx && Date.now() - (env.rt.sealEx.t || 0) < 15 * 60000) return 'по кнопке';
  if (!env.cfg.sealAuto || Date.now() - (env.rt.sealT || 0) < 20 * 60000) return '';
  const n = sealStones(); if (n == null || n < Math.max(1, +env.cfg.sealMin || 1)) return '';
  if (env.rt.sealTown && env.heroAt?.()?.loc !== 'city') return '';
  return 'автообмен';
}
async function sealDone(why, back = true) {
  const S = env.rt.sealEx;
  await env.setRt({ sealEx: null, sealT: Date.now(), sealLast: { t: Date.now(), why: String(why).slice(0, 200) } });
  env.rec('B', 'камни печати', why);
  if (S?.stopAfter) { env.setStatus(`Обмен камней: ${why} — бот остановлен, как и был`); await chrome.storage.local.set({ on: false }); return; }
  if (back && env.on) { await env.rtCommit?.(); location.href = env.cfg.catMode && env.rt.catCur ? env.CAT_URL : '/map.html'; await env.sleep(4000); }
}
async function sealStep() {
  if (!isSealPage()) { env.setStatus('Камни печати: иду к Ancient Trader'); await env.rtCommit?.(); location.href = '/ancient-trader.html'; await env.sleep(4000); return; }
  const rows = () => [...document.querySelectorAll('.l2-ancient-trader-exchange[data-stone]')];
  // курс и «У тебе» подставляет игра после ответа offers — ждём, пока в строках появится число
  const ready = await env.waitX(() => rows().length && rows().every(r => /\d/.test(r.querySelector('.l2-ancient-trader-owned__value')?.textContent || '')) ? 1 : 0, 10000, 250);
  if (!ready) {
    const n = (env.rt.sealErrN || 0) + 1; await env.setRt({ sealErrN: n >= 3 ? 0 : n });
    if (n >= 3) return sealDone('страница Ancient Trader не загрузилась 3 раза — обмен отложен на 20 мин');
    location.reload(); await env.sleep(4000); return;
  }
  const done = [], fail = [];
  for (const r of rows()) {
    const st = r.dataset.stone, [, nm, rate0] = SEAL[st] || [0, st, 0];
    const own = parseInt((r.querySelector('.l2-ancient-trader-owned__value')?.textContent || '').replace(/\D/g, ''), 10) || 0;
    if (own < 1) continue;
    const inp = r.querySelector('.l2-ancient-trader-exchange__input'), btn = r.querySelector('.l2-ancient-trader-exchange__btn');
    if (!inp || !btn) { fail.push(`${nm}: нет поля/кнопки`); continue; }
    await env.pause(); if (!env.on) return;
    inp.value = String(own); inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true }));
    await env.waitX(() => !btn.disabled ? 1 : 0, 2000, 100);
    const t0 = Date.now(); env.fire(btn);
    const ans = await env.waitX(() => { const N = env.sealNet?.(); return N && N.t >= t0 ? N : null; }, 10000, 150);
    const errEl = r.querySelector('.l2-ancient-trader-exchange__err'), errTxt = env.shown(errEl) ? (errEl.textContent || '').trim() : '';
    if (ans?.ok) { const rate = parseInt(r.getAttribute('data-aa-rate') || '', 10) || rate0; done.push(`${own} ${nm} → ${own * rate} AA`); await env.sleep(env.rnd ? env.rnd(400, 700) : 500); continue; }
    const msg = ans?.msg || errTxt || (ans ? `ответ ${ans.status}` : 'нет ответа');
    fail.push(`${nm}: ${msg}`);
    // сервер просит быть в городе / у торговца — автообмен дальше только в городе
    if (/міст|город|city|town|ближч|подойд|підійд|npc/i.test(msg) && !env.rt.sealTown) await env.setRt({ sealTown: true });
  }
  if (done.length && env.rt.sealTown && env.heroAt?.()?.loc !== 'city') await env.setRt({ sealTown: false });   // обмен прошёл вне города — ограничения нет
  await env.setRt({ sealErrN: 0 });
  await sealDone(done.length || fail.length ? `обмен на Ancient Adena: ${done.join(', ') || '—'}${fail.length ? ' · не вышло: ' + fail.join('; ') : ''}` : 'камней печати нет — менять нечего');
}

 return { paymentReconcile, isCatPage, isDungeon, dungeonHere, catLv, catTarget, dungeonMobs, mobList, mobLink, showMob, catNext, catWin, catPick, catGo, catHunt, BOSS_KIND, SEAL, isSealPage, sealStones, sealDue, sealStep };
 };
})(globalThis);
