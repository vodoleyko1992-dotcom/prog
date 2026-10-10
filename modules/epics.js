/* L2wap v7: isolated epics feature module. Dependencies are injected lazily.
   All game actions remain under the central lease and dispatcher in content.js. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.epics = function create_epics(env) {
const isEpicPage = () => location.pathname === env.EPIC_URL;

const epicOn = () => !!env.cfg.epicMode;

const epicNum = id => +((String(id || '').match(/_rb_(\d+)$/) || [])[1] || 0);

const epicById = id => { const n = epicNum(id); return n ? env.EPICS.find(e => e.ids.includes(n)) || null : null; };

const epicByName = nm => { const t = String(nm || '').split(/[·•(]/)[0].trim(); return t ? env.EPICS.find(e => e.re.test(t)) || null : null; };

const epicOf = k => env.EPICS.find(e => e.k === k) || null;

const epicWant = () => String(env.cfg.epicList ?? '').split(',').map(s => s.trim()).filter(k => epicOf(k));

function epicPins() {
  const ids = env.aroundSig().ids;
  return [...document.querySelectorAll('.l2-map-mob-pin[data-spawn-id]')].map(b => {
    const t = b.getAttribute('title') || b.getAttribute('aria-label') || '', m = t.match(env.LV_RE), id = b.dataset.spawnId;
    const e = /--epic(?!_)/.test(b.className) || /эпик-босс|epic boss/i.test(t) ? (epicById(id) || epicByName(m ? m[2] : t)) : epicById(id);
    return e && !/--epic_guard/.test(b.className) ? { id, k: e.k, name: m ? m[2].trim() : e.nm, lvl: m ? +m[3] : 0, idx: ids.indexOf(id) } : null;
  }).filter(Boolean);
}

function epicGuards() {                             // миньоны зоны эпика: метки l2-map-mob-pin--epic_guard
  const ids = env.aroundSig().ids;
  return [...document.querySelectorAll('.l2-map-mob-pin--epic_guard[data-spawn-id]')].map(b => {
    const t = b.getAttribute('title') || b.getAttribute('aria-label') || '', m = t.match(env.LV_RE);
    return { id: b.dataset.spawnId, name: m ? m[2].trim() : t, lvl: m ? +m[3] : 0, idx: ids.indexOf(b.dataset.spawnId) };
  });
}

function epicRowsParse() {
  const out = {};
  const rowOf = n => n.parentElement?.closest('.l2-rb-row, li, tr, article, [class*="row"]:not(button):not(a), [class*="card"], [class*="item"]') || n.parentElement;   // не сама кнопка (её класс «…row__tp»)
  const put = (e, row, id, btn) => {
    if (!e || !row || out[e.k]) return;
    const txt = (row.innerText || row.textContent || '').replace(/\s+/g, ' ').trim();
    const st = row.querySelector('[class*="status"]');
    const stT = (st?.textContent || '').replace(/^\s*[·•]\s*/, '').trim();
    const dead = st ? !(/--alive/.test(st.className) || /жив|alive/i.test(stT)) && /--dead|--respawn|мертв|мёртв|вбит|убит|dead|killed|респ|відрод|возрожд|через/i.test(st.className + ' ' + stT)
                    : /(мертв|мёртв|вбит|убит|dead|killed|респаун|відродж|возрожд)/i.test(txt) && !/жив|alive/i.test(txt);
    const hint = (row.querySelector('[class*="hint"], [class*="reason"]')?.textContent || '').trim();
    out[e.k] = { k: e.k, id: id || '', name: (row.querySelector('[class*="label"], [class*="name"], [class*="title"]')?.textContent || e.nm).trim().slice(0, 40),
      lvl: +((txt.match(/(?:ур\.?|lv\.?|level|рів\.?)\s*(\d+)/i) || [])[1] || 0), alive: !dead, status: (stT || (dead ? 'мёртв' : '')).slice(0, 60),
      deny: /недоступ|unavailable/i.test(hint) ? hint.replace(/^Недоступно:\s*/i, '').slice(0, 80) : '',
      priceKnown: !!row.querySelector('[class*="price"]'), price: +((row.querySelector('[class*="price"]')?.textContent || '').replace(/\D/g, '') || 0),
      priceUnit: /coin of luck/i.test(row.querySelector('[class*="price"]')?.textContent || '') ? 'Coin of Luck' : 'аден', tp: !!btn, page: +(new URLSearchParams(location.search).get('page') || 1), t: Date.now() };
  };
  for (const n of document.querySelectorAll('[data-spawn-id]')) {
    const row = rowOf(n), e = epicById(n.dataset.spawnId) || epicByName(row?.querySelector('[class*="label"], [class*="name"]')?.textContent);
    const btn = [n, ...(row?.querySelectorAll('button, a[href]') || [])].find(b => /телепорт|teleport/i.test((b.textContent || '').trim()) && !b.disabled);
    put(e, row, n.dataset.spawnId, btn);
  }
  for (const b of document.querySelectorAll('button, a')) {      // запасной разбор: «Телепорт» рядом с именем эпика
    if (!/телепорт|teleport/i.test(b.textContent || '')) continue;
    const row = rowOf(b); if (!row) continue;
    const e = epicByName(row.querySelector('[class*="label"], [class*="name"], [class*="title"]')?.textContent) || env.EPICS.find(x => x.re.test(((row.innerText || '').split(/[·•\n]/)[0] || '').trim()));
    put(e, row, b.dataset?.spawnId || '', b);
  }
  return out;
}

function epicTpBtn(k) {                             // кнопка «Телепорт» нужного эпика на странице «Эпик боссы»
  const e = epicOf(k); if (!e) return null;
  const rowOf = n => n.parentElement?.closest('.l2-rb-row, li, tr, article, [class*="row"]:not(button):not(a), [class*="card"], [class*="item"]') || n.parentElement;   // не сама кнопка (её класс «…row__tp»)
  const valid = b => b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' &&
    /телепорт|teleport/i.test((b.textContent || '').trim());
  // Название босса тоже является button[data-spawn-id]; клик по нему НЕ телепортирует.
  // Приоритет: собственно .l2-rb-row__tp в строке нужного spawnId.
  for (const n of document.querySelectorAll('[data-spawn-id]')) {
    if (epicById(n.dataset.spawnId) !== e) continue;
    const row = rowOf(n);
    const b = [n, ...(row?.querySelectorAll('button, a[href]') || [])].find(valid);
    if (b) return b;
  }
  for (const b of document.querySelectorAll('button, a')) {
    if (!valid(b)) continue;
    const row = rowOf(b);
    if (row && (epicByName(row.querySelector('[class*="label"], [class*="name"], [class*="title"]')?.textContent) === e || e.re.test(((row.innerText || '').split(/[·•\n]/)[0] || '').trim()))) return b;
  }
  return null;
}

async function epicListScan() {
  env.setStatus('Эпики: читаю список (Меню → Эпик боссы)');
  await env.waitX(() => document.querySelector('[data-spawn-id], .l2-rb-row') || [...document.querySelectorAll('button')].some(b => /телепорт|teleport/i.test(b.textContent)), 10000, 200);
  await env.sleep(600);
  let all = epicRowsParse();
  for (let i = 0; i < 5 && env.on; i++) {                 // вдруг список в несколько страниц (как у РБ)
    const nx = env.$q('#epic-pager-next, #rb-pager-next, [id*="pager-next"]');
    if (!nx || nx.disabled) break;
    const sig = document.body.innerText.length; env.fire(nx);
    if (!(await env.waitX(() => document.body.innerText.length !== sig, 4000, 150))) break;
    all = { ...epicRowsParse(), ...all };
  }
  const n = Object.values(all), db = { ...(env.rt.epicDb || {}) };
  for (const x of n) db[x.k] = { ...(db[x.k] || {}), id: x.id || db[x.k]?.id || '', name: x.name, lvl: x.lvl || db[x.k]?.lvl || 0, alive: x.alive, status: x.status, deny: x.deny, price: x.price, priceUnit: x.priceUnit, page: x.page, tp: x.tp, seenT: Date.now() };
  await env.setRt({ epicDb: db, epicListT: Date.now(), epicPageOk: n.length > 0 });
  if (!n.length) {
    // разметку не узнали — пишем кусок страницы в журнал (по нему разметку доучим), летим через логово
    const main = ((['main', '#app', '.l2-page'].map(x => env.$q(x)).find(Boolean) || document.body)?.innerHTML || '').replace(/\s+/g, ' ').slice(0, 1500);   // v5.6: раньше всегда body (шапка и меню)
    env.rec('B', 'эпики', `страница «Эпик боссы»: эпиков не нашёл — полечу через телепорт в логово. Разметка: ${main}`);
  } else env.rec('B', 'эпики', `список: ${n.map(x => `${x.name}${x.lvl ? ' ' + x.lvl : ''} ${x.alive ? '✅ жив' : '💀 ' + (x.status || 'мёртв')}${x.deny ? ' (' + x.deny + ')' : ''}`).join(' · ')}`);
}

async function epicSet(p) { await env.setRt({ epic: { ...(env.rt.epic || {}), ...p, t: Date.now() } }); }

async function epicDbSet(k, p) { await env.setRt({ epicDb: { ...(env.rt.epicDb || {}), [k]: { ...((env.rt.epicDb || {})[k] || {}), ...p } } }); }

const epicLvl = k => (env.rt.epicDb || {})[k]?.lvl || epicOf(k)?.lvl || 0;

function epicLvlWhy(k) {
  const L = epicLvl(k), h = env.heroLvl(); if (!L || !h) return '';
  if (h > L + 10) return `герой ${h} ур. — эпик ${L} ур., выше верхней границы ${L + 10}`;
  if (h < L - 10) return `герой ${h} ур. — эпик ${L} ур., ниже нижней границы ${L - 10}`;
  return '';
}

function epicPick() {
  const want = epicWant(), db = env.rt.epicDb || {}, now = Date.now(), E = env.rt.epic || {};
  const okK = k => { const d = db[k] || {}; return !(d.skipT > now) && !(d.leaveBadUntil > now) && !d.deny && !epicLvlWhy(k) && !(d.alive === false && now - (d.seenT || 0) < 15 * 60000); };
  if (E.k && want.includes(E.k) && okK(E.k)) return epicOf(E.k);
  const available = want.filter(okK);
  const preferred = available.filter(k => env.heroLvl() >= epicLvl(k) + Math.min(10, Math.max(0, +env.cfg.epicLvlUp || 0)));
  return epicOf((preferred[0] || available[0]) || '');
}

function epicWhyNone() {
  const db = env.rt.epicDb || {}, now = Date.now();
  return epicWant().map(k => { const d = db[k] || {}, e = epicOf(k);
    const lw = epicLvlWhy(k); if (lw) return `${e.nm}: ${lw}`;
    return `${e.nm}: ${d.leaveBadUntil > now ? `выход из боя не подтвердился, пауза ${Math.ceil((d.leaveBadUntil - now)/60000)} мин` : d.skipT > now ? `отложен на ${Math.ceil((d.skipT - now) / 60000)} мин (${d.why || ''})` : d.deny ? d.deny : d.alive === false ? '💀 ' + (d.status || 'мёртв') : '?'}`; }).join(' · ');
}

async function epicGiveUp(k, min, why) {
  const e = epicOf(k);
  await epicDbSet(k, { skipT: Date.now() + min * 60000, why });
  env.rec('B', 'эпики', `${e?.nm || k}: ${why} — откладываю на ${min >= 60 ? min / 60 + ' ч' : min + ' мин'}, дальше следующий`);
  await env.setRt({ epic: { step: 'pick', t: Date.now(), last: `${e?.nm || k}: ${why}` }, rbCur: null, rbWant: null, target: null });
}

function epicTpBudgetQuote(row, now = Date.now()) {
  const limits = { 'Coin of Luck': Math.max(0, +env.cfg.epicCoinDailyMax || 0), 'аден': Math.max(0, +env.cfg.epicAdenaDailyMax || 0) };
  const records = (env.rt.epicTpBudget || []).filter(x => x && Number.isFinite(x.t) && x.t > now - 86400000 && x.t <= now);
  if (!row || !row.priceKnown || !row.priceUnit || !Number.isFinite(row.price) || row.price < 0) {
    return (limits['Coin of Luck'] || limits['аден']) ? { ok: false, why: 'не удалось установить цену телепорта при включённом лимите' } : { ok: true, records, cost: 0 };
  }
  const cost = row.price, unit = row.priceUnit, limit = limits[unit] || 0;
  const used = records.filter(x => x.unit === unit).reduce((a, x) => a + x.cost, 0);
  if (limit && used + cost > limit) return { ok: false, why: `${unit}: лимит ${limit} за 24 ч, использовано/зарезервировано ${used}, телепорт ${cost}` };
  return { ok: true, records, cost, unit, limit, used };
}

async function epicTpBudgetReserve(k, row) {
  const q = epicTpBudgetQuote(row);
  if (!q.ok) return q;
  if (q.cost > 0) {
    const reservationAt = Date.now();
    q.reservationAt = reservationAt;
    await env.setRt({ epicTpBudget: [...q.records, { t: reservationAt, k, cost: q.cost, unit: q.unit }] });
    env.rec('B', 'эпики', `бюджет: резерв ${q.cost} ${q.unit}${q.limit ? ` · за 24 ч ${q.used + q.cost}/${q.limit}` : ''}`);
  }
  return q;
}

async function epicTpBudgetRelease(k, reservedAt) {
  if (!reservedAt) return;
  const next = (env.rt.epicTpBudget || []).filter(x => !(x.k === k && x.t === reservedAt));
  await env.setRt({ epicTpBudget: next });
  env.rec('B', 'эпики', `телепорт к ${k} не подтвердился — резерв бюджета отменён`);
}

async function epicStep() {
  const E = env.rt.epic || { step: 'pick' }, e = E.k ? epicOf(E.k) : null, now = Date.now();
  if (!env.cfg.autoRevive && !E.warned) { env.rec('B', 'эпики', 'внимание: «После смерти — в город и продолжать» выключено — после первой смерти бот остановится'); await epicSet({ warned: true }); }
  if (E.step === 'retreatVerify' && e) {
    let ack = null;
    try { ack = JSON.parse(sessionStorage.getItem('l2bot.epicLeave') || 'null'); } catch (er) {}
    if (ack && ack.id === E.id && ack.at >= (E.retreatT || 0) && ack.at - E.retreatT < 30000) {
      try { sessionStorage.removeItem('l2bot.epicLeave'); } catch (er) {}
      if (!ack.ok) {
        await epicDbSet(E.k, { leaveBadUntil: Date.now() + 3600000 });
        return epicGiveUp(E.k, 60, 'сервер отказал в выходе из боя');
      }
      const a = E.retreatAttempt;
      const L = a ? [...(E.hpLog || []).slice(-9), a] : (E.hpLog || []);
      await epicDbSet(E.k, { leaveBadUntil: 0 });
      env.rec('B', 'эпики', `${e.nm}: выход из боя подтверждён сервером — восстанавливаюсь`);
      await env.setRt({ epic: { ...E, step: 'prep', hpLog: L, retreats: (E.retreats || 0) + 1,
        retreatAttempt: null, leaveChecked: true, retreatT: 0, t: now }, rbCur: null, rbWant: null });
      return;
    }
    if (now - (E.retreatT || 0) < 12000) { await env.sleep(700); return; }
    await epicDbSet(E.k, { leaveBadUntil: Date.now() + 3600000 });
    return epicGiveUp(E.k, 60, 'нет подтверждения выхода из боя от сервера');
  }
  // ---- бой закончился (мы не на странице боя) — итог захода ----
  if (E.step === 'fight' && e) {
    const d = env.rt.rbDb?.[E.id] || {}, killed = (d.kills || 0) > (E.kills0 || 0);
    if (killed) {
      const tries = (E.deaths || 0) + 1;
      env.rec('B', 'эпики', `🏆 ${e.nm} убит! Заходов: ${tries}, смертей: ${E.deaths || 0}`);
      await epicDbSet(E.k, { kills: ((env.rt.epicDb || {})[E.k]?.kills || 0) + 1, alive: false, status: 'убит мной', seenT: now, best: null });
      await env.setRt({ epic: { step: 'pick', t: now, last: `${e.nm} убит` }, rbCur: null, rbWant: null, epicListT: 0 });
      return;
    }
    if (!E.died) {                                  // бой закончился без победы и без смерти (бой не открылся / страница сменилась)
      if (E.retreatFailed) return epicGiveUp(E.k, 60, 'сервер не подтвердил выход из боя');
      await epicSet({ step: 'arrive', at: now, tries: (E.tries || 0) + 1 });
      return;
    }
    // погибли: смерть уже обработана (город → статуя → бафф → «Восстановить»); решаем — добивать или отложить
    const deaths = (E.deaths || 0) + 1, L = [...(E.hpLog || [])];
    if (E.retreatFailed) return epicGiveUp(E.k, 60, 'не удалось завершить бой отступлением');
    await epicDbSet(E.k, { deaths: ((env.rt.epicDb || {})[E.k]?.deaths || 0) + 1 });
    const last = L[L.length - 1];
    const pct = last?.max ? Math.round(last.cur / last.max * 1000) / 10 : null;
    if (deaths >= Math.max(1, env.cfg.epicMaxDeaths || 10)) return epicGiveUp(E.k, 180, `${deaths} смертей подряд${pct != null ? `, у него осталось ${pct} %` : ''}`);
    const attemptChip = last?.cur != null && last?.max && E.startHp != null ? Math.max(0, E.startHp - last.cur) / last.max : null;
    if (attemptChip != null && attemptChip < 0.005) return epicGiveUp(E.k, 120, `за последний заход снято только ${(attemptChip * 100).toFixed(2)} % HP эпика — повторять смерти нецелесообразно`);
    if (L.length >= 3) {
      const a = L[L.length - 3], b = last;
      if (a.max && b.max && a.cur - b.cur < a.max * 0.01) return epicGiveUp(E.k, 60, `3 захода почти не снимают ему HP (${Math.round(a.cur / a.max * 100)} % → ${Math.round(b.cur / b.max * 100)} %) — отхиливается быстрее`);
    }
    if ((E.resetN || 0) >= 2) return epicGiveUp(E.k, 180, 'HP эпика восстанавливается полностью после каждой смерти — заходами не добить');
    env.rec('B', 'эпики', `${e.nm}: смерть ${deaths}/${env.cfg.epicMaxDeaths || 10}${pct != null ? ` · у него ${pct} %` : ''} → хил, банки, бафф и снова к нему`);
    await env.setRt({ epic: { ...E, step: 'prep', deaths, died: false, at: now, t: now }, rbCur: null, rbWant: null, target: null });
    return;
  }
  // ---- выбор цели ----
  if (E.step === 'pick' || !e) {
    // эпики + рыбалка: пока подходящего эпика нет — рыбачим (иначе «нет эпиков → фармлю мобов» уводит с рыбалки на карту).
    // Список эпиков — раз в 30 мин и не посреди вываживания
    const listAge = env.cfg.fishMode ? 30 * 60000 : 10 * 60000;
    if ((!env.rt.epicListT || now - env.rt.epicListT > listAge) && !(env.cfg.fishMode && env.isFishing() && env.fishState())) {
      if (!isEpicPage()) { env.setStatus('Эпики: открываю «Эпик боссы»'); location.href = env.EPIC_URL; await env.sleep(4000); return; }
      return epicListScan();
    }
    const p = epicPick();
    if (!p) {
      if (!env.isMap() && !env.cfg.fishMode) { location.href = '/map.html'; await env.sleep(3000); return; }   // с рыбалкой — не на карту (было: карта ↔ рыбалка по кругу)
      const why = epicWant().length ? `подходящих эпиков нет — ${epicWhyNone()}` : 'в меню не выбран ни один эпик';
      if (E.last !== why) { await epicSet({ last: why }); env.recBot(`Эпики: ${why} — ${env.cfg.fishMode ? 'рыбачу, список перечитаю через 30 мин' : 'фармлю мобов, список перечитаю через 10 мин'}`); }
      if (env.cfg.fishMode) {
        env.setStatus(`Эпики: ${why.slice(0, 120)} — рыбачу`);
        if (env.rt.fishService === 'cut') return env.isChar() ? env.fishCut() : (location.href = '/char.html', env.sleep(5000));
        if (env.rt.fishService === 'exchange') return env.isFishShop() ? env.fishExchange() : (location.href = '/fishing-shop.html', env.sleep(5000));
        if (env.rt.fishService === 'rod') return env.isChar() ? env.rodEnchant() : (location.href = '/char.html', env.sleep(5000));
        return env.isFishing() ? env.fishing() : env.goFishing();
      }
      env.setStatus(`Эпики: ${why.slice(0, 160)} — фармлю мобов`);
      return env.map();
    }
    env.rec('B', 'эпики', `цель: ${p.nm}${(env.rt.epicDb || {})[p.k]?.lvl ? ' (' + env.rt.epicDb[p.k].lvl + ')' : ''}`);
    await env.setRt({ epic: { step: 'prep', k: p.k, id: (env.rt.epicDb || {})[p.k]?.id || '', name: p.nm, deaths: 0, hpLog: [], tries: 0, at: now, t: now } });
    return;
  }
  // ---- подготовка: банки → бафф → хил (полные HP/MP) ----
  if (E.step === 'prep') {
    if (await env.rbShopFirst(e.nm)) return;
    if (await env.townBuffStart(`перед эпиком ${e.nm}`, true)) return;
    const me = env.meHp(), mp = env.meMp(), need = Math.max(90, env.cfg.rbRestHp || 95);
    if (me && (me.pct < need || (mp && mp.cur < mp.max * 0.8)) && await env.restoreVitals(`хил перед эпиком ${e.nm}: HP ${me.pct | 0}%`)) return;
    if (me && me.pct < 70) {                        // баффер не вылечил (откат) — подлечиваемся на мобах
      if (!env.isMap()) { location.href = '/map.html'; await env.sleep(3000); return; }
      env.setStatus(`Эпики: HP ${me.pct | 0}% — подлечиваюсь на мобах, потом ${e.nm}`);
      return env.map();
    }
    const L3 = (E.hpLog || []).slice(-3);
    if (L3.length >= 3 && L3[0].max && L3[0].cur - L3[2].cur < L3[0].max * 0.01) return epicGiveUp(E.k, 60, `3 захода почти не снимают ему HP (${(L3[0].cur / L3[0].max * 100).toFixed(1)} % → ${(L3[2].cur / L3[2].max * 100).toFixed(1)} %) — отхиливается быстрее`);
    await epicSet({ step: 'go', at: now, via: null });
    return;
  }
  // ---- полёт: «Эпик боссы» → «Телепорт»; иначе — логово через «Телепорт» ----
  if (E.step === 'go') {
    const d = (env.rt.epicDb || {})[E.k] || {};
    const byPage = env.rt.epicPageOk !== false && d.tp !== false && E.via !== 'zone';
    if (byPage) {
      if (!isEpicPage()) { env.setStatus(`Эпики: лечу к ${e.nm}`); location.href = env.EPIC_URL; await env.sleep(4000); return; }
      const b = await env.waitX(() => epicTpBtn(E.k), 8000, 200);
      const row = epicRowsParse()[E.k];
      if (row) await epicDbSet(E.k, { ...row, seenT: now });
      if (row && !row.alive) { await epicDbSet(E.k, { alive: false }); return epicGiveUp(E.k, 15, `мёртв (${row.status || 'по списку'})`); }
      if (row?.deny) return epicGiveUp(E.k, 60, row.deny);
      if (b) {
        // Не оплачиваем телепорт, если в известном запасе недостаточно лечебных банок.
        // Проверка включается только пользователем; при отсутствии данных об инвентаре — отказ.
        const minPots = Math.max(0, Math.floor(+env.cfg.epicMinHpPots || 0));
        if (minPots > 0) {
          const pots = env.potModel();
          if (!pots || pots.n < minPots) return epicGiveUp(E.k, 30,
            `до телепорта нужно ≥${minPots} банок HP сверх резерва, известно ${pots?.n ?? 'неизвестно'}`);
        }
        const budget = epicTpBudgetQuote(row);
        if (!budget.ok) return epicGiveUp(E.k, 60, `платный телепорт отменён: ${budget.why}`);
        await epicSet({ step: 'arrive', at: Date.now(), via: 'page', id: row?.id || E.id });   // до нажатия: телепорт уводит со страницы
        await env.setRt({ rbWant: row?.id || E.id || null, zoneGoT: Date.now() });
        env.rec('B', 'эпики', `телепорт к ${e.nm}${row?.price ? ' · ' + row.price.toLocaleString('ru') + ' ' + (row.priceUnit || 'аден') : ''}`);
        // Безопасно резервируем сумму прямо перед нажатием. Неизвестная стоимость при лимите — стоп.
        const reservation = await epicTpBudgetReserve(E.k, row);
        if (!reservation.ok) return epicGiveUp(E.k, 60, 'достигнут лимит телепортов');
        await env.pause();
        if (!env.fire(b)) { await epicTpBudgetRelease(E.k, reservation.reservationAt); return; }
        env.transitionMonitor.expect('epicTp', location.pathname, 8000);
        if (await env.waitX(() => env.transitionMonitor.check('epicTp', location.pathname) === 'complete', 8000, 200)) return;
        env.transitionMonitor.clear('epicTp');
        await epicTpBudgetRelease(E.k, reservation.reservationAt);
        const msg = (env.$q('[role="alert"], [class*="toast"], [class*="err"]')?.textContent || '').trim().slice(0, 80);
        env.rec('B', 'эпики', `${e.nm}: телепорт со страницы не сработал${msg ? ' — ' + msg : ''}`);
        await epicSet({ step: 'go', via: 'zone' });
      }
      if (!e.tp) return epicGiveUp(E.k, 60, 'кнопки телепорта нет, а логово не знаю');
      await epicSet({ via: 'zone' });
      return;
    }
    if (!e.tp) return epicGiveUp(E.k, 60, 'на странице «Эпик боссы» его нет, а логово не знаю');
    await epicSet({ step: 'arrive', at: Date.now(), via: 'zone' });
    await env.setRt({ zoneGo: { id: e.tp, t: Date.now(), why: `эпик ${e.nm}` }, zoneGoT: 0 });
    location.href = '/teleport.html'; await env.sleep(4000);
    return;
  }
  // ---- прилёт: ищем метку эпика, в бой ----
  if (E.step === 'arrive') {
    if (!env.isMap()) {
      if (now - (E.at || 0) > 90000) { await epicSet({ step: 'go', via: E.via === 'page' && e.tp ? 'zone' : E.via }); return; }
      location.href = '/map.html'; await env.sleep(3000); return;
    }
    await env.mapReady(15000, `Эпики: ищу ${e.nm} на карте`);
    const r = await env.waitX(() => epicPins().find(x => x.k === E.k), 5000, 300);
    if (!r) {
      if (now - (E.at || 0) < 25000) { await env.sleep(1500); return; }
      if (E.via === 'page' && e.tp) { env.rec('B', 'эпики', `${e.nm}: после телепорта на карте нет — пробую через логово`); await epicSet({ step: 'go', via: 'zone' }); return; }
      await epicDbSet(E.k, { alive: false, status: 'нет на карте', seenT: now });
      return epicGiveUp(E.k, 15, 'на карте нет (убит другими или ещё не возродился)');
    }
    if (r.lvl) await epicDbSet(E.k, { id: r.id, lvl: r.lvl });
    if ((E.tries || 0) >= 4) return epicGiveUp(E.k, 30, 'бой с ним 4 раза не открылся');
    // бой не открылся раньше — мешают миньоны зоны: бьём ближайшего и пробуем снова
    if ((E.tries || 0) >= 1 && E.guardT !== E.tries) {
      const g = epicGuards().filter(x => x.idx >= 0).sort((a, b) => a.idx - b.idx)[0] || epicGuards()[0];
      if (g) {
        await epicSet({ guardT: E.tries });
        env.rec('B', 'эпики', `${e.nm}: бой не открылся — бью миньона ${g.name} (${g.lvl})`);
        await env.setRt({ target: { name: g.name, champ: true, quest: false, rb: false }, mobClickAt: Date.now(), via: 'map' });
        if (g.idx >= 0 && await env.attackSpawn({ ...g, champ: true, rank: 0 }, () => `Эпики: миньон ${g.name}`)) return;
        location.href = '/battle.html?spawnId=' + encodeURIComponent(g.id); await env.sleep(4000); return;
      }
    }
    const bw = env.buffWaitBeforeRb();
    if (bw) { env.setStatus(`Эпики: жду откат «${bw.who}» ${bw.s} с, потом ${e.nm}`); await env.sleep(Math.min(bw.s, 10) * 1000); return; }
    const kills0 = env.rt.rbDb?.[r.id]?.kills || 0;
    await epicSet({ step: 'fight', id: r.id, kills0, died: false, retreatT: 0, leaveChecked: false });
    await env.setRt({ rbCur: r.id, rbWant: r.id });
    const res = await env.rbEngage(r, `Эпик: бой с ${e.nm}${E.deaths ? ` (заход ${E.deaths + 1})` : ''}`, { epic: true });
    if (res === 'skip') return epicGiveUp(E.k, 180, 'оценка до боя: не по силам');
    if (res) return;
    await epicSet({ step: 'arrive', at: Date.now() - 20000, tries: (E.tries || 0) + 1 });
    return;
  }
  await epicSet({ step: 'pick' });
}
 return { isEpicPage, epicOn, epicNum, epicById, epicByName, epicOf, epicWant, epicPins, epicGuards, epicRowsParse, epicTpBtn, epicListScan, epicSet, epicDbSet, epicLvl, epicLvlWhy, epicPick, epicWhyNone, epicGiveUp, epicTpBudgetQuote, epicTpBudgetReserve, epicTpBudgetRelease, epicStep };
 };
})(globalThis);
