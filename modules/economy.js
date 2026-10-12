/* L2wap v7: isolated economy feature module. Dependencies are injected lazily.
   All game actions remain under the central lease and dispatcher in content.js. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.economy = function create_economy(env) {
// 7.1.16-fix: какие заряды и какого грейда. Скриншот 10.10 00:19: маг с Staff of Life (D) купил «Заряды души NG +3000» —
// в момент закупки не было данных о надетом оружии (список оружия пуст после смены персонажа/перезапуска) и профессии.
// Грейд: надетое оружие → оружие из настроек «Основное» в списке → по уровню героя (D с 20, C с 40…).
// Маг: класс по профессии/профилю → или на панели/в настройках уже Blessed Spiritshot
function shotGrade() {
  // 7.2 (лог 10.10 20:08): после новой установки память об оружии пришла из базового профиля («надето: Посох життя D») — куплено 3000
  // D-зарядов при Demon's Staff C. Списку оружия верим, только если инвентарь читали в этой установке (rt.weaponsT), иначе — сначала чтение
  const W = env.rt.weaponsT ? env.rt.weapons || [] : [], ok = g => g && g !== '—' && /^(NG|D|C|B|A|S)$/i.test(g);
  const eq = W.find(w => w.where === 'надето');
  if (ok(eq?.g)) return { g: eq.g.toUpperCase(), src: `надето: ${eq.name || eq.en}` };
  const main = String(env.cfg.nWeaponMain || '').toLowerCase().trim();
  const mw = main && W.find(w => (w.name || w.en || '').toLowerCase().startsWith(main));
  if (ok(mw?.g)) return { g: mw.g.toUpperCase(), src: `оружие из настроек: ${mw.name || mw.en}` };
  const lv = env.heroLevel?.() || env.rt.lvl || 0, GL = env.GRADE_LV || { NG: 0, D: 20, C: 40, B: 52, A: 61, S: 76 };
  const g = Object.entries(GL).filter(([, l]) => lv >= l).sort((a, b) => b[1] - a[1])[0]?.[0] || 'NG';
  return { g, src: `по уровню ${lv || '?'} (надетое оружие ещё не прочитано)` };
}
// Тип зарядов — по надетому оружию: магическое → Благословенные заряды духа, физическое → Заряды души.
// По базе Interlude у магического оружия M.Atk близок к P.Atk: одноручное ≥ 0,7 (Staff of Life 0,97, Arcana Mace 0,78,
// Sword of Miracles 0,82), посохи ≥ 0,6 (Imperial Staff 0,64); у физического ≤ 0,65 (Saber 0,65, Damascus 0,51,
// двуручные 0,40–0,44). Луки, кастеты, дуалы, древковое, двуручные мечи — всегда физическое.
// NG-оружие (слабые числа, неразличимо) и неизвестное — по классу персонажа
function weaponIsMage(w) {
  if (!w) return null;
  const pa = +w.pa || 0, ma = +w.ma || 0, wt = String(w.wt || '').toLowerCase();
  if (/лук|кастет|дуал|древков|двуруч\S* меч|арбалет|рапир/.test(wt)) return false;
  if (!pa || !ma || pa < 30 || !w.g || /^(NG|—)$/i.test(w.g)) return null;
  return ma / pa >= (/двуруч/.test(wt) ? 0.6 : 0.7);
}
function equippedWeapon() {
  const W = env.rt.weaponsT ? env.rt.weapons || [] : [];   // 7.2: не прочитан в этой установке — не знаем
  const eq = W.find(w => w.where === 'надето');
  if (eq) return eq;
  const main = String(env.cfg.nWeaponMain || '').toLowerCase().trim();
  return main ? W.find(w => (w.name || w.en || '').toLowerCase().startsWith(main)) || null : null;
}
function shotsMage() {
  const byWeapon = weaponIsMage(equippedWeapon());
  if (byWeapon != null) return byWeapon;
  if (env.classWeaponTypes().types[0] === env.MAGE) return true;
  if (env.combatProfileKind?.() === 'mage_summoner') return true;
  if (/благослов|blessed|spiritshot|заряд\S* дух/i.test(env.cfg.nShots || '')) return true;
  return [...document.querySelectorAll(env.SLOT || '.l2-battle-hotbar-slot')].some(b => /благословенн\S* заряд дух|blessed spiritshot/i.test(b.title || ''));
}
function shopPlan() {
  const sg = shotGrade(), g = sg.g;
  const mage = shotsMage();   // тип по надетому оружию, грейд — грейд оружия (C-оружие → C-заряды, S → S …)
  const list = [
    { key: 'hp', label: 'Банки HP', ids: [1061], name: /^(Зілля зцілення|Зелье исцеления|Healing Potion)$/i, grade: 'NG', mm: env.pair(env.cfg.shopHp, '300/1000') },
    { key: 'mp', label: 'Банки MP', ids: [728], name: /велика банка|большая банка|^Mana Potion$/i, grade: 'NG', mm: env.pair(env.cfg.shopMp, '200/1000') },
    { key: 'shots', label: mage ? `Благосл. заряды духа ${g}` : `Заряды души ${g}`, ids: [(mage ? env.BSPS_IDS : env.SHOT_IDS)[g] || env.SHOT_IDS.NG],
      name: mage ? /Благословенн\S* заряд дух|Blessed Spiritshot/i : /Заряд душ\S* во(?:їна|ина)|^Soulshot/i, grade: g, mm: env.pair(env.cfg.shopShots, '1000/5000') },
    { key: 'spirit', label: 'Spirit Ore', ids: [3031], name: /^Spirit Ore$/i, grade: 'NG', mm: env.pair(env.cfg.shopSpirit, '0/1000') },
    { key: 'soul', label: 'Soul Ore', ids: [1785], name: /^Soul Ore$/i, grade: 'NG', mm: env.pair(env.cfg.shopSoul, '0/1000') },
    { key: 'bait', label: 'Наживка', ids: [6519], name: /^(Наживка|Fishing Lure|Bait)$/i, grade: 'NG', mm: env.pair(env.cfg.shopBait, '0/0') },   // в сумке — «Fishing Lure» (6519), иконка та же
  ];
  // 7.1.30: после покупки «не тех» зарядов — сутки заряды не покупаем, пока игрок не проверит
  // 7.1.30 (лог 10.10 14:11): надетое оружие не прочитано — грейд «по уровню 50» дал C, куплено 3000 C-зарядов при посохе D.
  // Без надетого оружия заряды не покупаем вовсе: сначала чтение инвентаря, потом закупка
  const bad = env.rt.shopShotBad && Date.now() - env.rt.shopShotBad.t < 86400000;
  const guess = /^по уровню/.test(sg.src);
  if (guess && env.rt.weaponsT && Date.now() - (env.rt.shotGuessScanT || 0) > 1800000) { env.rt.shotGuessScanT = Date.now(); env.rt.weaponsT = 0; env.setRt({ weaponsT: 0, shotGuessScanT: env.rt.shotGuessScanT }); }   // 7.1.30: не чаще раза в 30 мин
  if (guess && Date.now() - (env.rt.shotGuessLogT || 0) > 600000) { env.rt.shotGuessLogT = Date.now(); env.rec('B', 'закупка', 'заряды пропускаю: надетое оружие ещё не прочитано — сначала смотрю инвентарь'); }
  return list.filter(x => x.mm[1] > 0 && !((bad || guess) && x.key === 'shots'));
}

function shopNeedByPanel() {
  if (!env.cfg.shopAuto) return '';
  const low = [];
  // 7.2.3 (лог 10.10 23:19–23:30: B-зарядов 310 → 139 при минимуме 500, закупки не было): количество — из сумки по ответам
  // сервера (не зависит от того, есть ли на экране панель боя), иначе — со счётчика кнопки на панели
  const chk = (slot, mm, label, id) => { const nq = id ? env.invQty?.(id) : null, q = nq ?? (slot ? env.qty(slot) : null);
    if (q != null && mm[1] > 0 && q < mm[0]) low.push(`${label} ${q} < ${mm[0]}`); };
  chk(env.slotsBy(env.cfg.nHpPot || 'Зілля зцілення, Зелье исцеления, Healing Potion').find(b => /зцілен|исцелен|healing/i.test(b.title) && !/велик|больш|greater/i.test(b.title)), env.pair(env.cfg.shopHp, '300/1000'), 'банки HP', 1061);
  chk(env.slotsBy(env.cfg.nMpPot).find(b => /велик|больш/i.test(b.title)) || env.slotsBy(env.cfg.nMpPot)[0], env.pair(env.cfg.shopMp, '200/1000'), 'банки MP', 728);
  // заряды — грейд и тип по надетому оружию (как в закупке); оружие не прочитано — только счётчик на панели
  const sp = shopPlan().find(x => x.key === 'shots');
  chk(env.shotSlot?.(), env.pair(env.cfg.shopShots, '1000/5000'), sp ? sp.label.replace(/^Благосл\. заряды духа/, 'заряды') : 'заряды', sp?.ids[0]);
  return low.join(', ');
}

async function bagCounts() {                     // инвентарь «Все», все страницы: itemId → количество
  await env.waitX(() => env.$q('#char-bag-list'), 8000, 200);
  const all = env.$q('[data-inv-all-items]');
  if (all && all.getAttribute('aria-selected') !== 'true') { env.fire(all); await env.sleep(env.rnd(400, 600)); }
  const pager = () => [...document.querySelectorAll('#char-bag-pager .l2-char-bag-pager__btn')];
  for (let i = 0; i < 30 && pager()[0] && !pager()[0].disabled; i++) { env.fire(pager()[0]); await env.sleep(env.rnd(200, 350)); }
  const cnt = {};
  await env.itemsDb();                               // v5.2: имя по itemId, если игра показала «#1061» вместо названия
  const bagNm = (r, j) => { const t = (r.querySelector('.l2-char-bag-name')?.textContent || '').replace(/\s*×\s*[\d\s]+$/, '').trim();
    return /^#?\d*$/.test(t) && j.itemId && env.ITEMS?.[j.itemId]?.n ? env.ITEMS[j.itemId].n : t; };
  // 7.1.19: строки сумки дорисовываются после открытия — ждём, пока их число перестанет меняться (как при чтении оружия)
  { let n = -1, same = 0; const t0 = Date.now();
    while (Date.now() - t0 < 3000 && same < 3) { const k = document.querySelectorAll('.l2-char-bag-row[data-item-json]').length; same = k === n && k > 0 ? same + 1 : 0; n = k; await env.sleep(150); } }
  // имена в строках сумки дорисовываются позже самих строк — ждём до 3 с, пока не уйдут «#id»
  await env.waitX(() => ![...document.querySelectorAll('.l2-char-bag-row[data-item-json] .l2-char-bag-name')].some(e => /^#\d+/.test(e.textContent.trim())), 3000, 150);
  for (let page = 0; page < 40; page++) {
    for (const r of document.querySelectorAll('.l2-char-bag-row[data-item-json]')) {
      const j = env.itemJson(r), q = +j.qty || 1, nm = 'n:' + bagNm(r, j);
      if (j.itemId) cnt[j.itemId] = (cnt[j.itemId] || 0) + q;
      if (nm.length > 2) cnt[nm] = (cnt[nm] || 0) + q;
    }
    const next = pager()[1];
    if (!next || next.disabled || !env.shown(next)) break;
    const sig = [...document.querySelectorAll('.l2-char-bag-row[data-item-json]')].map(r => r.dataset.itemJson).join('|');
    env.fire(next);
    if (!(await env.waitX(() => [...document.querySelectorAll('.l2-char-bag-row[data-item-json]')].map(r => r.dataset.itemJson).join('|') !== sig, 3000, 100))) break;
  }
  try { await env.noteBag(cnt); } catch (e) {}
  return cnt;
}

const shopAdena = () => +((env.$q('.l2-gm-shop-adena__amount')?.textContent || '').replace(/\D/g, '') || 0);

async function shopBuyOne(it, qtyWant, spentSoFar = 0) {          // на открытой вкладке грейда: найти строку по имени (листая), купить qtyWant
  const pager = () => [...document.querySelectorAll('.l2-gm-shop-pager-btn')];
  // 7.1.16-fix: магазин помнит последний подраздел «Розхідників». После покупки зарядов он открывался на «Заряды», и банки HP
  // искались там — «нет в магазине (видел: Благословенний заряд духу…)» (лог 09.10 23:38, 23:48). Ищем в нужном подразделе:
  // банки — «Банки», заряды — «Заряды», иное — «Все»
  // 7.1.16-fix: грейд — по активной вкладке страницы, а не по параметру ссылки: игра открывает последний выбранный грейд
  // (скриншот 10.10: ссылка grade=D, а активна вкладка NG — куплены заряды NG)
  // 7.1.18: сначала дождаться, пока магазин дорисуется (вкладки и строки появляются после ответа /game/drops-shop ~1 с).
  // Лог 10.10 01:13: вкладки искались сразу после перехода — их ещё не было, и банки HP снова искались в «Заряды».
  // Вкладку ищем заново после клика — игра перерисовывает кнопки, старая ссылка на элемент «не становится» активной
  const namesReady = () => [...document.querySelectorAll('.l2-gm-shop-name')].some(e => e.textContent.trim().length > 2);
  await env.waitX(() => namesReady() && env.$q('[data-grade]'), 10000, 150);
  const active = sel => { const el = env.$q(sel); return !!el && (el.getAttribute('aria-selected') === 'true' || el.classList.contains('l2-drops-shop-tab--active')); };
  const sig = () => [...document.querySelectorAll('.l2-gm-shop-name')].map(e => e.textContent.trim()).join('|');
  const pick = async sel => {
    if (!env.$q(sel)) return null;
    if (active(sel)) return true;
    const s0 = sig(); env.fire(env.$q(sel));
    const ok = await env.waitX(() => active(sel), 4000, 100);
    await env.waitX(() => sig() !== s0 && namesReady(), 3000, 100);
    await env.sleep(env.rnd(300, 500));
    return !!ok;
  };
  if (it.grade && (await pick(`[data-grade="${it.grade}"]`)) === false) return { ok: false, why: `не открылась вкладка грейда ${it.grade}` };
  const SUB = { hp: 'vials', mp: 'vials', shots: 'charges', spirit: 'resources', soul: 'resources' };
  const sub = SUB[it.key] || (/заряд|shot/i.test(String(it.name)) ? 'charges' : /зілл|зель|potion|банк/i.test(String(it.name)) ? 'vials' : 'all');
  if ((await pick(`[data-consumablesub="${sub}"]`)) === false) await pick('[data-consumablesub="all"]');
  // v4.22: строки появляются раньше названий — ждём, пока имена заполнятся (иначе «нет в магазине» через 1 мс)
  await env.waitX(() => [...document.querySelectorAll('.l2-gm-shop-name')].some(e => e.textContent.trim().length > 2) && pager().length, 8000, 150);
  await env.sleep(env.rnd(300, 500));
  for (let i = 0; i < 15 && pager()[0] && !pager()[0].disabled; i++) { env.fire(pager()[0]); await env.sleep(env.rnd(300, 450)); }
  for (let page = 0; page < 15; page++) {
    const row = [...document.querySelectorAll('.l2-gm-shop-row')].find(r => it.name.test((r.querySelector('.l2-gm-shop-name')?.textContent || '').trim()));
    if (row) {
      // 7.1.30 (покупка игрока 10.10 14:09): у строки есть грейд — «l2-gm-shop-row--grade-d», путь «Розхідники › D › Заряды».
      // Строка не того грейда (вкладка не переключилась) — не покупаем: так раньше брались NG-заряды вместо D
      const rg = ((String(row.className || '').match(/l2-gm-shop-row--grade-(\w+)/) || [])[1] || '');
      if (it.grade && rg && rg.toUpperCase() !== String(it.grade).toUpperCase()) return { ok: false, why: `в списке грейд ${rg.toUpperCase()}, а нужен ${it.grade} — не покупаю` };
      // 8.0.3 (эпики, разбор 11.10): Coin of Luck — ценная валюта (донат, немного падает из Old Box и за TvT). Товар с ценой в Coin of Luck
      // (шлемы B в gm-shop — по 30 CoL) бот не покупает никогда. 8.0.3 (ревью, снимки gm-shop 23:00): разметка игры — «l2-gm-shop-price
      // --adena» «124 200 Adena» и «--coin» «30 Coin of Luck». Покупаем только известное «за адену» (класс --adena или подпись Adena/аден);
      // признак CoL (класс --coin, «Coin of Luck»/«CoL», значок 4037, .l2-gm-shop-coin в строке) — отказ; непонятная валюта — тоже отказ.
      // Обычное слово «coin»/«монети» у значка адены (класс --adena) покупку не останавливает
      const prEl = row.querySelector('.l2-gm-shop-price'), prCls = String(prEl?.className || ''), prT = String(prEl?.textContent || '');
      const marks = [...(prEl?.querySelectorAll?.('img, [title]') || [])].map(i => [i.getAttribute?.('alt'), i.getAttribute?.('title')].join(' ')).join(' ');
      const srcs = [...(prEl?.querySelectorAll?.('img') || [])].map(i => i.getAttribute?.('src') || '').join(' ');
      const isAd = /l2-gm-shop-price--adena\b/.test(prCls), lbl = prT + ' ' + marks;
      const isCol = /--(coin|col|luck)\b/.test(prCls) || /coin\s*of\s*luck|монет\S*\s+удач|\bcol\b/i.test(lbl) || /(^|\D)4037(\D|$)|luck/i.test(srcs) || !!row.querySelector?.('.l2-gm-shop-coin') || (!isAd && /coin|luck|монет|удач/i.test(lbl));
      if (isCol) return { ok: false, why: 'цена в Coin of Luck — бот донат не тратит' };
      if (!isAd && !/adena|аден/i.test(lbl)) return { ok: false, why: `валюта цены не распознана («${prT.replace(/\s+/g, ' ').trim().slice(0, 30)}») — не покупаю` };
      const unit = +((prEl?.textContent || '').replace(/\D/g, '') || 0);
      if (!unit) return { ok: false, why: 'цена не прочитана — не покупаю (резерв и лимит не проверить)' };   // v5.6
      const money = shopAdena() - (env.cfg.shopReserve ?? 200000), cap = Math.min(qtyWant, 9999, unit ? Math.floor(Math.max(0, money) / unit) : qtyWant, unit ? Math.floor(Math.max(0, (env.cfg.shopMaxSpend ?? 2000000) - spentSoFar) / unit) : qtyWant);
      if (cap <= 0) return { ok: false, why: money < unit ? `не хватает адены (резерв ${(env.cfg.shopReserve ?? 200000).toLocaleString('ru')})` : 'исчерпан лимит трат за раз' };
      env.fire(row.querySelector('.l2-gm-shop-buy'));
      const modal = await env.waitX(() => { const m = env.$q('#l2-drops-shop-buy-qty-modal'); return m && env.shown(m.querySelector('[data-buy-qty-confirm]')) ? m : null; }, 4000, 100);
      if (!modal) return { ok: false, why: 'окно покупки не открылось' };
      const inp = modal.querySelector('#l2-drops-buy-qty-input, [data-buy-qty-input]');
      if (inp) { inp.focus(); env.setVal(inp, String(cap)); }
      await env.sleep(env.rnd(300, 500));
      const a0 = shopAdena(), a0T = Date.now(), msg0 = env.$q('#drops-shop-msg')?.textContent || '';
      env.fire(modal.querySelector('[data-buy-qty-confirm]'));
      const ok = await env.waitX(() => shopAdena() < a0 || ((env.$q('#drops-shop-msg')?.textContent || '') !== msg0 && env.shown(env.$q('#drops-shop-msg'))), 5000, 150);
      const m = env.shown(env.$q('#drops-shop-msg')) ? env.$q('#drops-shop-msg').textContent.trim().slice(0, 100) : '';
      if (env.shown(env.$q('#l2-drops-shop-buy-qty-modal [data-buy-qty-confirm]'))) { env.fire(env.$q('#l2-drops-shop-buy-qty-modal .l2-drops-stats-modal__close')); await env.sleep(300); }
      // 7.1.30: сверка с запросом к серверу: {"shopKey":"consumable/blessed_spiritshot_d","qty":3000}
      const nb = env.shopBuyNet?.();
      const wantType = /благосл/i.test(it.label || '') ? /spiritshot/i : /soulshot/i;
      if (nb && nb.t >= a0T && it.key === 'shots' && it.grade && nb.key && ((String(it.grade).toUpperCase() !== 'NG' && !new RegExp(`_${String(it.grade).toLowerCase()}$`).test(nb.key)) || (String(it.grade).toUpperCase() === 'NG' && /_(?:d|c|b|a|s)$/i.test(nb.key)) || !wantType.test(nb.key))) {
        env.rec('B', 'закупка', `⚠ куплено не то: ${nb.key} ×${nb.qty}, нужны ${it.label} — заряды больше не покупаю до проверки`);
        await env.setRt({ shopShotBad: { t: Date.now(), key: nb.key, want: it.grade } });
      }
      return { ok: !!ok && shopAdena() < a0, qty: cap, unit, spent: a0 - shopAdena(), msg: m, key: nb && nb.t >= a0T ? nb.key : '' };
    }
    const next = pager()[1];
    if (!next || next.disabled) break;
    const sig = [...document.querySelectorAll('.l2-gm-shop-name')].map(e => e.textContent).join('|');
    env.fire(next);
    if (!(await env.waitX(() => [...document.querySelectorAll('.l2-gm-shop-name')].map(e => e.textContent).join('|') !== sig, 3000, 100))) break;
  }
  const seen = [...document.querySelectorAll('.l2-gm-shop-name')].map(e => e.textContent.trim()).filter(Boolean);
  return { ok: false, why: `нет в магазине (видел: ${seen.slice(0, 6).join(', ') || 'пусто'})` };
}

async function shopStep() {
  const st = env.rt.shop;
  if (st.step === 'count') {
    if (!env.isChar()) { location.href = '/char.html'; await env.sleep(4000); return; }
    env.setStatus('Закупка: считаю запасы в инвентаре');
    const cnt = await bagCounts();
    const have0 = x => x.ids.length ? x.ids.reduce((a, id) => a + (cnt[id] || 0), 0) : Object.entries(cnt).reduce((a, [k, v]) => a + (k.startsWith('n:') && x.name.test(k.slice(2)) ? v : 0), 0);
    const plan0 = shopPlan();
    const need = plan0.map(x => { const have = have0(x); return { key: x.key, label: x.label, have, buy: have < x.mm[0] || (st.force && x.mm[1] - have >= Math.max(5, x.mm[1] * 0.1)) ? x.mm[1] - have : 0, grade: x.grade }; }).filter(x => x.buy > 0);
    // 7.1.19: какие заряды бот считает «своими» и сколько их в сумке — всегда в журнал (лог 10.10 01:13: заряды D не купились, а почему — не видно)
    const sh = plan0.find(x => x.key === 'shots'), sg = shotGrade(), w = equippedWeapon();
    const shNote = sh ? ` · заряды: ${sh.label} (id ${sh.ids.join(',')}) в сумке ${have0(sh)} из мин. ${sh.mm[0]} — грейд ${sg.g}: ${sg.src}; оружие ${w ? (w.name || w.en) + ' ' + (w.g || '?') : 'не прочитано'}` : '';
    env.rec('B', 'закупка', (need.length ? `нужно: ${need.map(x => `${x.label} ${x.have} → +${x.buy}`).join(' · ')}` : 'всё есть — закупка не нужна') + shNote);
    if (!need.length) { await env.setRt({ shop: null, shopT: Date.now(), shopLast: { t: Date.now(), text: 'всё есть, покупать не нужно' } }); location.href = st.back || '/map.html'; await env.sleep(4000); return; }
    await env.setRt({ shop: { ...st, step: 'buy', need } });
    location.href = `/gm-shop.html?cat=consumable&grade=${need[0].grade}`; await env.sleep(4000); return;
  }
  if (st.step === 'buy') {
    if (!/\/gm-shop\.html/i.test(location.pathname)) { location.href = `/gm-shop.html?cat=consumable&grade=${st.need[0]?.grade || 'NG'}`; await env.sleep(4000); return; }
    await env.waitX(() => env.$q('.l2-gm-shop-row') && shopAdena(), 10000, 200);
    if (shopAdena()) env.setRt({ adenaSeen: { v: shopAdena(), t: Date.now() } });
    const plan = shopPlan(), done = [...(st.done || [])];
    let spent = st.spent || 0;
    for (const n of st.need) {
      if (!env.on) return;
      if (done.some(d => d.key === n.key)) continue;
      const g = (new URLSearchParams(location.search).get('grade') || 'NG').toUpperCase();
      if (g !== n.grade) { await env.setRt({ shop: { ...st, done, spent, t: Date.now() } }); location.href = `/gm-shop.html?cat=consumable&grade=${n.grade}`; await env.sleep(4000); return; }
      const it = plan.find(x => x.key === n.key);
      if (n.key === 'shots' && !st.gradeNote) { st.gradeNote = 1; const sg = shotGrade(), w = equippedWeapon(), wm = weaponIsMage(w); env.rec('B', 'закупка', `${n.label}: грейд ${sg.g} — ${sg.src}; тип — ${wm == null ? 'по классу персонажа' : (wm ? 'магическое' : 'физическое') + ' оружие ' + (w?.name || w?.en || '')}`); }
      env.setStatus(`Закупка: ${n.label} +${n.buy}`);
      const r = it ? await shopBuyOne(it, n.buy, spent) : { ok: false, why: 'нет в списке' };
      if (r.ok) spent += r.spent || 0;
      env.rec('B', 'закупка', `${n.label}: ${r.ok ? `куплено ${r.qty} × ${r.unit} = ${r.spent.toLocaleString('ru')} аден` : 'не куплено — ' + (r.why || r.msg || '?')}`);
      done.push({ key: n.key, ok: r.ok, label: n.label, qty: r.qty, why: r.ok ? '' : (r.why || r.msg || '?') });
      await env.setRt({ shop: { ...st, done, spent, t: Date.now() } });   // v5.6: сразу — иначе после сбоя/перезагрузки покупка повторится
      await env.sleep(env.rnd(500, 900));
    }
    const text = done.map(d => d.ok ? `${d.label} +${d.qty}` : `${d.label}: ✗ ${d.why}`).join(' · ') + (spent ? ` · потрачено ${spent.toLocaleString('ru')} аден` : '');
    await env.setRt({ shop: null, shopT: Date.now(), shopLast: { t: Date.now(), text } });
    env.setStatus('Закупка завершена — возвращаюсь');
    location.href = st.back || (env.autonomyMode() === 'fish' ? '/fishing.html' : '/map.html'); await env.sleep(4000);
  }
}

function hpPotStock() {
  const b = env.isBattle() ? env.slotsBy(env.cfg.nHpPot || 'Зілля зцілення').find(x => env.HP_SHOP_RE.test(x.title) && !env.HP_BIG_RE.test(x.title)) : null;
  if (b && env.qty(b) != null) return env.potBag(b) ?? env.qty(b);
  const e = Object.values(env.rt.pots || {}).find(x => x.kind === 'hp' && env.HP_SHOP_RE.test(x.name || '') && !env.HP_BIG_RE.test(x.name || ''));
  return e ? e.n : null;
}

async function shopStart(why, force) {
  await env.setRt({ shop: { step: 'count', back: env.autonomyMode() === 'fish' ? '/fishing.html' : '/map.html', t: Date.now(), force: !!force } });
  env.rec('B', 'закупка', `иду за расходниками: ${why}`);
}
 return { shopPlan, shotGrade, shotsMage, weaponIsMage, shopNeedByPanel, bagCounts, shopAdena, shopBuyOne, shopStep, hpPotStock, shopStart };
 };
})(globalThis);
