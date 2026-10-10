/* L2wap v7: isolated dungeons feature module. Dependencies are injected lazily.
   All game actions remain under the central lease and dispatcher in content.js. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.dungeons = function create_dungeons(env) {
const isCatPage = () => location.pathname === env.CAT_URL;

const isDungeon = () => /\/dungeon\.html/i.test(location.pathname);

const dungeonHere = () => new URLSearchParams(location.search).get('dungeonId') || '';

const catLv = id => { const k = env.rt.catLv?.[id]; return k?.n >= 3 ? [k.lo, k.hi, true] : [env.CAT_LIST[id]?.[1] || 0, env.CAT_LIST[id]?.[2] || 0, false]; };

function catTarget() {                            // какое подземелье: выбранное в меню или «авто» — по уровню героя
  if (env.cfg.catDungeon && env.cfg.catDungeon !== 'auto' && env.CAT_LIST[env.cfg.catDungeon]) return env.cfg.catDungeon;
  const L = env.heroLvl(); if (!L) return env.rt.catCur || null;
  const bad = env.rt.catBad || {}, now = Date.now();
  const c = Object.keys(env.CAT_LIST).filter(id => now - (bad[id] || 0) > 3600000).map(id => { const [lo, hi, seen] = catLv(id); return { id, lo, hi, seen, d: L < lo ? lo - L + 5 : L > hi ? L - hi : 0 }; })
    .sort((a, b) => a.d - b.d || (b.seen - a.seen) || (a.id === env.rt.catCur ? -1 : b.id === env.rt.catCur ? 1 : 0));
  return c[0]?.id || null;
}

function dungeonMobs() {                          // строки списка мобов подземелья
  return [...document.querySelectorAll('#dungeon-mob-list li')].map(li => {
    const a = li.querySelector('a[href*="battle"], a.l2-map-mob-link, a'), t = (a?.textContent || li.textContent || '').replace(/\s+/g, ' ').trim();
    const m = t.match(/^(.+?)\s*·\s*ур\.?\s*(\d+)/i);
    return a && m ? { a, name: m[1].trim(), lvl: +m[2], rb: /рейд|raid/i.test(t) || /--raid/.test(a.className), champ: /чемп|champion/i.test(t) || /--champion/.test(a.className),
      id: (a.getAttribute('href') || '').match(/spawnId=([^&]+)/)?.[1] || '', info: li.querySelector('[data-spawn-id]') } : null;
  }).filter(Boolean);
}

async function catGo(id) {                        // в подземелье: если уже стоим у входа — «Войти», иначе телепорт со страницы катакомб
  id ||= catTarget(); if (!id) { env.setStatus('Катакомбы: не знаю уровень героя — жду'); await env.sleep(3000); return; }
  const nm = env.CAT_LIST[id]?.[0] || id;
  // v5.6: выбранное вручную подземелье недоступно (нет в списке / ошибка входа 2 раза) — не летаем по кругу за адену, ждём
  if (Date.now() - ((env.rt.catBad || {})[id] || 0) < 3600000 && env.cfg.catDungeon === id) { await env.idle(60000, `Катакомбы: «${nm}» сейчас недоступно (${env.rt.catBadWhy?.[id] || 'см. журнал'}) — выберите другое или «авто»`); return; }
  if (isDungeon() && dungeonHere() === id) return catHunt(id);
  const enter = env.$q('#map-dungeon-enter:not([hidden]) #map-dungeon-enter-link, #map-dungeon-enter-link');
  if (env.isMap() && enter && env.shown(enter) && (enter.getAttribute('href') || '').includes('dungeonId=' + id)) {
    env.setStatus(`Катакомбы: вхожу в ${nm}`); await env.pause(); env.fire(enter);
    if (!(await env.waitFor(isDungeon, 8000))) location.href = `/dungeon.html?dungeonId=${id}&enter=1`;
    await env.sleep(1500); return;
  }
  // уже внутри (после боя): сначала пробуем вернуться прямо в подземелье — без телепорта
  if (env.rt.catIn === id && Date.now() - (env.rt.catInT || 0) < 15 * 60000 && !env.rt.catBackTried) {
    // v5.3.1: назад — всегда с «&enter=1» (вход заново). Без него после магазина/баффера сервер считал героя снаружи:
    // «Підійди ближче до моба на карті» (battle_too_far), бот стоял (лог 08.10 15:03–15:04)
    await env.setRt({ catBackTried: 1 }); env.setStatus(`Катакомбы: назад в ${nm}`); location.href = `/dungeon.html?dungeonId=${id}&enter=1`; await env.sleep(4000); return;
  }
  if (Date.now() - (env.rt.catTpT || 0) < 25000 && env.isMap()) {            // только что прилетели — вход ещё не прорисовался
    if (Date.now() - env.rt.catTpT > 12000) { location.href = `/dungeon.html?dungeonId=${id}&enter=1`; await env.sleep(4000); return; }
    env.setStatus(`Катакомбы: жду вход в ${nm}`); await env.sleep(1000); return;
  }
  if (!isCatPage()) { env.setStatus(`Катакомбы: лечу в ${nm}`); location.href = env.CAT_URL; await env.sleep(4000); return; }
  const b = await env.waitX(() => env.$q(`.l2-rb-row__tp[data-dungeon-id="${CSS.escape(id)}"]`), 8000, 200);
  if (!b) { env.rec('B', 'катакомбы', `${nm}: нет в списке «Катакомбы — Некрополи»`); await env.setRt({ catBad: { ...(env.rt.catBad || {}), [id]: Date.now() }, catBadWhy: { ...(env.rt.catBadWhy || {}), [id]: 'нет в списке катакомб' } }); location.href = '/map.html'; await env.sleep(3000); return; }
  const price = (b.closest('.l2-rb-row')?.querySelector('.l2-rb-row__price-gold')?.textContent || '').trim();
  env.rec('B', 'катакомбы', `телепорт в ${nm}${price ? ' (' + price + ')' : ''}`);
  await env.setRt({ catTpT: Date.now(), catCur: id, catBackTried: 0 });
  await env.pause(); env.fire(b);
  if (!(await env.waitX(() => !isCatPage(), 8000, 200))) { env.rec('B', 'катакомбы', `${nm}: телепорт не сработал — ${(env.$q('#catacombs-load-err')?.textContent || '').trim().slice(0, 80) || 'без ответа'}`); await env.sleep(5000); }
}

async function catHunt(id) {                      // внутри подземелья: список мобов → бой
  const nm = env.CAT_LIST[id]?.[0] || id;
  const ok = await env.waitX(() => dungeonMobs().length || env.shown(env.$q('#dungeon-load-err')) ? 1 : 0, 10000, 250);
  const err = env.shown(env.$q('#dungeon-load-err')) ? (env.$q('#dungeon-load-err').textContent || '').trim() : '';
  if (err) {                                       // «вы не в подземелье» и т.п. — входим заново через телепорт
    // v5.6: та же ошибка 2 раза подряд — подземелье недоступно на 1 ч (раньше: платный телепорт каждые 15–20 с бесконечно)
    const en = ((env.rt.catErrN || {})[id] || 0) + 1;
    if (en >= 2) {
      env.rec('B', 'катакомбы', `${nm}: ${err.slice(0, 100)} — ${en}-й раз подряд, подземелье пропускаю на 1 ч`);
      await env.setRt({ catErrN: { ...(env.rt.catErrN || {}), [id]: 0 }, catIn: null, catBad: { ...(env.rt.catBad || {}), [id]: Date.now() }, catBadWhy: { ...(env.rt.catBadWhy || {}), [id]: err.slice(0, 60) } });
      location.href = env.cfg.catDungeon === id ? '/map.html' : env.CAT_URL; await env.sleep(4000); return;
    }
    env.rec('B', 'катакомбы', `${nm}: ${err.slice(0, 100)} — вхожу заново`);
    await env.setRt({ catIn: null, catBackTried: 1, catTpT: 0, catErrN: { ...(env.rt.catErrN || {}), [id]: en } }); location.href = env.CAT_URL; await env.sleep(4000); return;
  }
  if ((env.rt.catErrN || {})[id]) env.setRt({ catErrN: { ...env.rt.catErrN, [id]: 0 } });
  await env.setRt({ catIn: id, catInT: Date.now(), catBackTried: 0, catCur: id });
  const list = dungeonMobs(), L = env.heroLvl();
  if (!ok || !list.length) {
    const n = (env.rt.catEmpty || 0) + 1; await env.setRt({ catEmpty: n });
    env.setStatus(`Катакомбы ${nm}: мобов нет — жду респаун (${n})`);
    if (n >= 6) { env.rec('B', 'катакомбы', `${nm}: мобов нет 6 раз подряд — другое подземелье на 1 ч`); await env.setRt({ catEmpty: 0, catBad: { ...(env.rt.catBad || {}), [id]: Date.now() } }); location.href = env.CAT_URL; await env.sleep(4000); return; }
    await env.sleep(8000); location.reload(); await env.sleep(4000); return;
  }
  if (env.rt.catEmpty) await env.setRt({ catEmpty: 0 });
  // уровни подземелья — по тому, что видим (для автовыбора)
  const lv = list.filter(x => !x.rb).map(x => x.lvl);
  if (lv.length) { const k = env.rt.catLv?.[id] || { n: 0 }, lo = Math.min(...lv), hi = Math.max(...lv);
    if (k.lo !== lo || k.hi !== hi || (k.n || 0) < 3) { await env.setRt({ catLv: { ...(env.rt.catLv || {}), [id]: { lo: Math.min(lo, k.lo ?? lo), hi: Math.max(hi, k.hi ?? hi), n: (k.n || 0) + 1, t: Date.now() } } });
      if (!k.n) env.rec('B', 'катакомбы', `${nm}: мобы ${lo}–${hi} ур. (${[...new Set(list.map(x => x.name))].slice(0, 8).join(', ')})`); } }
  // «Авто» — окно уровня (выше героя +8 не лезем); подземелье выбрано вручную — бьём его мобов любого уровня (v5.3.1:
  // выбрал высокую зону — бот стоял и «ждал мобов по уровню», лог 08.10 14:47)
  const auto = !env.cfg.catDungeon || env.cfg.catDungeon === 'auto';
  const lo = auto ? L - (env.cfg.lvlBelow ?? 3) : 0, hi = auto ? L + (env.cfg.lvlAbove ?? 99) : 999;   // v5.3.1: потолка +8 больше нет — верх из меню
  const pick = list.filter(x => (!x.rb || env.cfg.rbMode) && x.lvl >= lo && x.lvl <= hi)
    .sort((a, b) => Math.abs(a.lvl - L - 1) - Math.abs(b.lvl - L - 1) || (a.champ - b.champ))[0];
  if (!pick) {
    env.setStatus(`Катакомбы ${nm}: мобов ${lo}–${hi} ур. нет (есть ${Math.min(...list.map(x => x.lvl))}–${Math.max(...list.map(x => x.lvl))})${auto ? ' — ищу другое подземелье' : ' — жду'}`);
    if (auto) { await env.setRt({ catBad: { ...(env.rt.catBad || {}), [id]: Date.now() }, catIn: null }); location.href = env.CAT_URL; await env.sleep(4000); return; }
    await env.sleep(10000); location.reload(); await env.sleep(4000); return;
  }
  env.setStatus(`Катакомбы ${nm}: бой с ${pick.name} (${pick.lvl})`);
  await env.pause(); if (!env.on) return;
  await env.setRt({ target: { name: pick.name, champ: pick.champ, quest: false, rb: pick.rb }, mobClickAt: Date.now(), via: 'dungeon' });
  env.fire(pick.a);
  if (await env.waitFor(env.isBattle, 6000)) { if (env.rt.catFar) env.setRt({ catFar: 0 }); return; }
  // ссылка не открыла бой — через окно моба и «В бой»
  if (pick.info) { env.fire(pick.info); const go = await env.waitFor(() => { const g = env.$q('#dungeon-mob-modal-battle'); return env.shown(g) ? g : null; }, 3000, 100); if (go) { env.fire(go); if (await env.waitFor(env.isBattle, 8000)) return; } }
  // бой не открылся: «подойди ближе» (герой снаружи подземелья) — входим заново; два раза подряд не помогло — через телепорт
  const far = /ближ|too_far|далеко/i.test(env.noticeText() + ' ' + (env.$q('#dungeon-load-err')?.textContent || '')) || env.NET_ERR.err === 'battle_too_far' && Date.now() - env.NET_ERR.t < 8000;
  const n = (env.rt.catFar || 0) + 1;
  if (n >= 3) { env.rec('B', 'катакомбы', `${nm}: бой не открывается${far ? ' («подойди ближе»)' : ''} — захожу заново через телепорт`); await env.setRt({ catFar: 0, catIn: null, catTpT: 0, catBackTried: 1 }); location.href = env.CAT_URL; await env.sleep(4000); return; }
  await env.setRt({ catFar: n });
  env.rec('B', 'катакомбы', `${nm}: клик по «${pick.name}» не открыл бой${far ? ' — «подойди ближе»: вхожу в подземелье заново' : ' — обновляю'} (${n}/2)`);
  location.href = `/dungeon.html?dungeonId=${id}&enter=1`; await env.sleep(5000);
}
 return { isCatPage, isDungeon, dungeonHere, catLv, catTarget, dungeonMobs, catGo, catHunt };
 };
})(globalThis);
