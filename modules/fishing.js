/* L2wap v7: isolated fishing feature module. Dependencies are injected lazily.
   All game actions remain under the central lease and dispatcher in content.js. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.fishing = function create_fishing(env) {
async function fishSoft(msg) {
  if (!fishNow()) return env.halt(msg);
  const n = Date.now() - (env.rt.fishSoftT || 0) < 15 * 60000 ? (env.rt.fishSoftN || 0) + 1 : 1;
  const STEPS = [5, 10, 20, 30, 40, 60, 120, 180, 240, 300];   // с: 5 → 10 → 20 → 30 → 40 с → 1 → 2 → 3 → 4 → 5 мин (дальше 5 мин)
  const wait = STEPS[Math.min(n - 1, STEPS.length - 1)] * 1000;
  await env.setRt({ fishSoftN: n, fishSoftT: Date.now() });
  env.rec('B', 'рыбалка: пауза', `${msg} — повтор через ${wait / 1000} с (попытка ${n})`);
  await env.idle(wait, `⏸ ${msg} — повтор`);
  if (!env.on) return;
  await commit();
  location.href = '/fishing.html';
  await env.sleep(6000);
}

const isFishing = () => /\/fishing\.html/i.test(location.pathname);

const fSlot = n => env.$q(`.l2-fishing-hotbar-slot[data-slot="${n}"]`);

const fOk = b => !!b && !b.disabled && !env.cdBusy(b);

function fishState() {
  const t = env.$q('#fishing-target');
  if (!t || !env.shown(t) || !t.textContent.trim()) return null;
  const nm = t.querySelector('[class*="fishing-target__name"]');
  const hp = (t.querySelector('[class*="fishing-target__hp"]')?.textContent || '').match(/(\d+)\s*\/\s*(\d+)/);
  const st = (t.querySelector('[class*="fishing-target__state"]')?.textContent || '').trim();
  return { name: nm?.textContent.trim() || '', cur: hp ? +hp[1] : 0, max: hp ? +hp[2] : 0, st,
           need: /Pumping/i.test(st) ? 'pumping' : /Reeling/i.test(st) ? 'reeling' : null };
}

function fishLog() {
  return [...document.querySelectorAll('#fishing-log .l2-fishing-log-line')]
    .map(el => ({ cls: el.className, t: el.textContent.replace(/\s+/g, ' ').trim(), fish: el.querySelector('[class*="fish-name"]')?.textContent.trim() }));
}

function fishNewLines(before) {
  const now = fishLog();
  if (!before || !before.length) return now;
  const key = x => x.cls + '|' + x.t;
  for (let k = 0; k <= now.length; k++) {           // сдвиг k: now[k..] совпадает с началом before
    const n = Math.min(4, before.length, now.length - k);
    if (n <= 0) return now.slice(0, k);
    let ok = true;
    for (let i = 0; i < n; i++) if (key(now[k + i]) !== key(before[i])) { ok = false; break; }
    if (ok) return now.slice(0, k);
  }
  // v5.6: журнал перерисован целиком (совпадения нет) — раньше ВСЕ строки считались новыми, и старая «перезаряджається»
  // давала ложный «на откате» (и рост отката). Теперь новые — только строки, которых не было до нажатия
  const old = new Set(before.map(key));
  return now.filter(x => !old.has(key(x)));
}

// Paid fishing time. Reads actual game UI and waits for a confirmed increase; never purchases in a loop.
function fishingTimeRemainingMs(raw) {
  const m = String(raw || '').trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return ((+m[1] || 0) * 3600 + (+m[2]) * 60 + (+m[3])) * 1000;
}
async function fishTimeTopUp() {
  if (!env.cfg.fishTimeAuto || !env.on || fishState()) return false;
  const ms = fishingTimeRemainingMs(env.$q('#fishing-time-remaining')?.textContent);
  if (ms == null || ms > Math.min(60, Math.max(0, +env.cfg.fishTimeMin || 0)) * 60000) return false;
  const now = Date.now();
  if (now - (env.rt.fishTimeBuyAt || 0) < 180000 || now - (env.rt.fishTimeFailAt || 0) < 300000) return false;
  // 8.0 (аудит рыбалки): пакет по умолчанию — 6 ч (2,33 млн/ч против 3 млн/ч у 1 ч, на 22 % дешевле)
  const ORDER = ['1h','2h','3h','6h'];
  let pack = ORDER.includes(env.cfg.fishTimePack) ? env.cfg.fishTimePack : '6h';
  const prices = {'1h':3000000,'2h':5500000,'3h':7500000,'6h':14000000};
  const moneyText = env.$q('#fishing-time-adena')?.textContent;
  if (!moneyText || !/\d/.test(moneyText)) return false;
  const adena = +(moneyText.replace(/[^\d]/g, '') || 0);
  const reserve = Math.max(0, +env.cfg.shopReserve || 0);
  if (adena - reserve < prices[pack]) {
    // 8.0: на выбранный пакет аден не хватает — берём самый большой из меньших, который по карману (иначе время кончится и рыбалка встанет)
    const alt = ORDER.slice(0, ORDER.indexOf(pack)).reverse().find(k => adena - reserve >= prices[k] && env.$q(`[data-fishing-time-package="${k}"]`));
    if (!alt) {
      env.rec('B','рыбалка: время', `не покупаю ${pack}: ${adena} аден, резерв ${reserve}, цена ${prices[pack]}`);
      await env.setRt({ fishTimeFailAt: now });
      return false;
    }
    env.rec('B','рыбалка: время', `на ${pack} не хватает (${adena} аден, резерв ${reserve}) — беру ${alt}`);
    pack = alt;
  }
  const button = env.$q(`[data-fishing-time-package="${pack}"]`);
  if (!button || button.disabled) return false;
  await env.setRt({ fishTimeBuyAt: now });  // persist before click: guards reloads and races
  env.setStatus(`Рыбалка: докупаю время (${pack})`);
  env.fire(button);
  const ok = await env.waitFor(() => {
    const next = fishingTimeRemainingMs(env.$q('#fishing-time-remaining')?.textContent);
    return next != null && next >= ms + 300000;
  }, 8000, 200);
  env.rec('B','рыбалка: время', ok ? `докуплено ${pack}: время увеличилось` : `покупка ${pack} не подтверждена; пауза повторов`);
  if (!ok) await env.setRt({ fishTimeFailAt: Date.now() });
  return ok;
}

// 7.2.1 (лог 10.10 18:32–19:35): учёт после поимки — три записи в память подряд (≈0,2 с на рыбу перед следующим забросом).
// Память в вкладке меняется сразу, запись в хранилище идёт фоном (очередь патчей) — заброс её не ждёт
// 8.0 (аудит рыбалки, тот же лог): ≈8 записей на рыбу (заброс, поклёвка, наживка ×2–3, улов, сессия, урон, откат). Теперь счётчики
// меняются только в памяти вкладки (statPut), а в хранилище уходят ОДНОЙ записью на исход заброса: поймана / сорвалась / не клюнула
let statDirty = {};
const statPut = (k, v) => { env.rt[k] = v; statDirty[k] = v; };
function statTake(extra) {                         // накопленное + extra → один патч; очередь очищается
  const p = {};
  // меню могло сбросить статистику (rt из хранилища заменил память) — старое значение не возвращаем
  for (const [k, v] of Object.entries(statDirty)) if (env.rt[k] === v) p[k] = v;
  statDirty = {};
  return { ...p, ...(extra || {}) };
}
function statFlush() { const p = statTake(); return Object.keys(p).length ? bg(env.setRt(p)) : undefined; }
function fishStat(patch, fishName) {
  const F = { casts: 0, bites: 0, nobite: 0, caught: 0, lost: 0, byFish: {}, t0: Date.now(), ...(env.rt.fish || {}) };
  for (const [k, v] of Object.entries(patch)) F[k] = (F[k] || 0) + v;
  if (fishName) F.byFish = { ...F.byFish, [fishName]: (F.byFish[fishName] || 0) + 1 };
  statPut('fish', F);
}
const bg = p => { try { p?.catch?.(e => console.warn(env.TAG, 'рыбалка: запись', e)); } catch (e) {} return p; };
// 8.0 (аудит рыбалки, лог 10.10 18:48:52–57 и 19:21:25–30): перед переходом на другую страницу — дождаться, что запись дошла до
// хранилища (иначе новая страница читает старое fishService и уводит обратно: fishing ↔ char по кругу)
async function commit() { statFlush(); try { if (env.rtCommit) await env.rtCommit(); } catch (e) {} }

// ---------- 7.2.1: экономика рыбалки ----------
// Proof с рыбы по видам: из итогов разделки («Вы разрезали Black Fish ×110. Получено: Fish Oil ×327, …») и курсов обмена магазина рыбака
// (снимок 10.10: Fish Oil 25 → 1, Fish Gem 4 → 1, Fish Scale 5 → 1, Greater Fish Oil 2 → 1, Thin Fish Bone 4 → 1, Shiny Gem/Scale и Thick Bone 1 → 2,
// Premium Fish Oil 1 → 5). Лог 18:48/19:21: White Fish ≈0,36 Proof (≈3,6 подсечки), Black ≈0,28 (≈5,7), Fat ≈0,30 (≈9,3)
const FISH_RATE_DEF = { fish_oil: [25, 1], fish_gem: [4, 1], fish_scale: [5, 1], greater_fish_oil: [2, 1], thin_fish_bone: [4, 1],
  shiny_fish_gem: [1, 2], shiny_fish_scale: [1, 2], thick_fish_bone: [1, 2], premium_fish_oil: [1, 5] };
const matKey = n => String(n || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
function fishCutValue(res) {                       // → { name, n, proof } или null
  const m = String(res).match(/(?:разрезали|розрізали)\s+(.+?)\s*×\s*(\d+)\.?\s*(?:Получено|Отримано):\s*(.+)$/i);
  if (!m) return null;
  const R = { ...FISH_RATE_DEF, ...(env.rt.fishRates || {}) };
  let proof = 0;
  for (const it of m[3].split(',')) {
    const x = it.match(/(.+?)\s*×\s*(\d+)/); if (!x) continue;
    const r = R[matKey(x[1])]; if (r) proof += +x[2] / r[0] * r[1];
  }
  return { name: m[1].trim(), n: +m[2], proof };
}
async function fishValNote(res) {
  const v = fishCutValue(res); if (!v || !(v.n > 0)) return;
  const V = { ...(env.rt.fishVal || {}) }, o = V[v.name] || { n: 0, proof: 0 };
  const k = o.n > 2000 ? 0.5 : 1;                  // свежие разделки весят больше
  V[v.name] = { n: Math.round(o.n * k) + v.n, proof: +(o.proof * k + v.proof).toFixed(2) };
  await env.setRt({ fishVal: V });
}
const fishValOf = name => { const V = env.rt.fishVal || {}, v = V[name]; if (v?.n) return v.proof / v.n;
  const all = Object.values(V).reduce((a, x) => [a[0] + x.proof, a[1] + x.n], [0, 0]); return all[1] ? all[0] / all[1] : 0.33; };
// замер по наживке: забросы, поклёвки, пойманные, время (от заброса до конца вываживания) и Proof по видам
const curBait = () => fSlot('goodBait')?.className.includes('toggle-on') ? 'good' : 'basic';
function baitNote(kind, patch) {
  const S = { ...(env.rt.fishBaitStat || {}) }, o = { casts: 0, bites: 0, caught: 0, ms: 0, proof: 0, ...(S[kind] || {}) };
  for (const [k, v] of Object.entries(patch)) o[k] = +((o[k] || 0) + v).toFixed(3);
  S[kind] = o; statPut('fishBaitStat', S);           // 8.0: в хранилище — вместе с исходом заброса
}
const baitPph = o => o?.ms > 60000 ? o.proof / o.ms * 3600000 : 0;   // Proof в час
// «Якісна наживка» (Good Fishing Lure ×10 = 3 Proof, т.е. 0,3 Proof за заброс; бесплатно — из Old Box). В игре описания нет —
// решаем по замеру: по 60+ забросов на каждой, сравниваем Proof/ч. Хорошая лучше ≥ 3 % — ловим на ней, пока есть (бесплатные из Old Box);
// покупать её за Proof выгодно, только если прибавка на заброс больше 0,3 Proof (пишем в журнал, сами не покупаем)
function baitAuto() {
  const S = env.rt.fishBaitStat || {}, g = S.good || {}, b = S.basic || {};
  if ((g.casts || 0) < 60) return 'goodBait';        // нет хорошей — fishPrepare сам перейдёт на обычную (и вернётся через 30 мин)
  if ((b.casts || 0) < 60) return 'basicBait';
  return baitPph(g) > baitPph(b) * 1.03 ? 'goodBait' : 'basicBait';
}
const baitWant = () => env.cfg.fishBait === 'good' ? 'goodBait' : env.cfg.fishBait === 'auto' ? baitAuto() : 'basicBait';
function baitVerdict() {                            // текст для журнала/меню
  const S = env.rt.fishBaitStat || {}, g = S.good || {}, b = S.basic || {};
  if ((g.casts || 0) < 60 || (b.casts || 0) < 60) return `замер наживки: обычная ${b.casts || 0}/60, хорошая ${g.casts || 0}/60 забросов`;
  const pg = baitPph(g), pb = baitPph(b), perCast = (g.proof / g.casts) - (b.proof / b.casts);
  return `хорошая ${pg.toFixed(1)} Proof/ч против ${pb.toFixed(1)} у обычной (${pg > pb * 1.03 ? 'лучше' : 'не лучше'}); на заброс ${perCast >= 0 ? '+' : ''}${perCast.toFixed(2)} Proof — покупать за Proof (0,3 за шт.) ${perCast > 0.3 ? 'выгодно' : 'невыгодно'}`;
}

function fishWatch() {
  if (env.fishObs || !document.body) return;
  env.fishObs = new MutationObserver(ms => {
    for (const m of ms) {
      const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      // «Навичка ще перезаряджається» — всплывающее сообщение вне журнала: ловим сразу, а не ждём таймаут
      if ([...m.addedNodes].some(n => (n.nodeType === 3 || n.nodeType === 1) && env.CD_RE.test(n.textContent || '')) || (m.type === 'characterData' && env.CD_RE.test(m.target.textContent || ''))) env.fishCdMsg++;
      for (const n of m.addedNodes) { const t = (n.textContent || '').trim(); if (t.length < 160 && env.GEAR_RE.test(t)) env.fishGearMsg = { t, at: Date.now() }; }
      if (t && (t.id === 'fishing-log' || t.closest?.('#fishing-log') || [...m.addedNodes].some(n => n.nodeType === 1 && (n.id === 'fishing-log' || n.querySelector?.('#fishing-log'))))) { env.fishMut++; return; }
    }
  });
  env.fishObs.observe(document.body, { childList: true, subtree: true, characterData: true });
}

const fishTop = () => fishLog()[0] || null;

// 8.0 (аудит рыбалки, лог 10.10 18:32–19:35): сервер принимал то же умение через 1,03–1,09 с (отказ «action_cooldown» — один за
// 1,5 ч, и тот из-за лага 2,9 с). Нижняя граница пробы отката — 1,05 с (было 1,12); отказ по-прежнему отодвигает откат
// 8.0.3 (лог 11.10 10:44:51 и 11:24:32): откат раздувался от ЛАГА сервера (1,21 → 1,69 → 1,80 с, назад — по 10 мс на 40 нажатий, ≈40 мин,
// и 1,61 с осталось в памяти). Ответ на reeling шёл 1,4 / 2,5 с: сервер отметил нажатие поздно (serverNowMs), а бот считал откат от своего
// клика — нажал через 0,13 с после ответа, сервер увидел повтор через 0,2–0,3 с → «action_cooldown», и этот отказ учил откат «gap + 60 мс».
// Теперь: (1) опоздание нажатия на сервер сверх обычного (отметка serverNowMs ответа в наших часах — сдвиг часов по минимуму
// «приход ответа − serverNowMs» за последние 64 ответа) сдвигает отсчёт отката этого умения (fishNet); (2) отказ учит откат (+30 мс,
// потолок 1,5 с) только чистый: жали ровно по своему откату, прошлый ответ этого умения и сам отказ — быстрее 1 с; иначе это лаг —
// откат не трогаем, повтор через 150 мс; (3) вниз — быстро: −50 мс на 10 чистых нажатий выше 1,3 с, −10 мс ниже (до 1,05 с)
const FCD_MIN = 1.05, FCD_MAX = 1.5;
const fishCdLen = () => Math.min(FCD_MAX, Math.max(FCD_MIN, env.rt.fishCdLen || 1.22)) * 1000;
// sent — время своего клика по умению; over — {t0, over}: на сколько этот клик дошёл до сервера позже обычного; ms — время ответа (DOM)
// прошлого принятого нажатия умения; off — «приход − serverNowMs» (минимум = сдвиг часов + самая быстрая доставка ответа); lat — обычное
// «клик → отметка сервера»
const FNET = { off: [], lat: 0, n: 0, sent: {}, over: {}, ms: {}, cdsLog: false };
function fishNet(nf) {                           // из сетевого обработчика content.js: ответ на POST /game/fishing/action
  if (!nf || !nf.ok || !(nf.srv > 0) || !(nf.t > 0)) return;
  // структура fishing.cooldowns неизвестна (журнал режет ответ на 800 знаков, поле дальше) — первый непустой образец раз за сессию вкладки
  // в журнал, чтобы по следующему логу брать откат прямо у сервера. Пока откат — своя модель с поправкой по serverNowMs (ниже)
  if (!FNET.cdsLog && nf.cds != null && JSON.stringify(nf.cds).length > 2) {
    FNET.cdsLog = true;
    try { if (!sessionStorage.getItem('l2bot.fishCds')) { sessionStorage.setItem('l2bot.fishCds', '1'); env.rec('B', 'рыбалка', `откаты сервера (fishing.cooldowns, раз за сессию) после ${nf.act}: ${JSON.stringify(nf.cds).slice(0, 300)} · serverNowMs ${nf.srv}`); } } catch (e) {}
  }
  const off = nf.t - nf.srv;
  FNET.off.push(off); if (FNET.off.length > 64) FNET.off.shift();
  const a = nf.act, sent = FNET.sent[a];
  if ((a !== 'pumping' && a !== 'reeling') || !(nf.ms > 0) || !sent || nf.t - nf.ms < sent - 150 || FNET.over[a]?.t0 === sent) return;   // не наш клик / уже учтён
  const up = Math.max(0, nf.ms - Math.max(0, off - Math.min(...FNET.off)));   // клик → отметка сервера (задержка обратного пути сверх обычной вычтена)
  // обычный разброс доставки (до 80 мс) покрывает запас выученного отката — сдвигаем только на опоздание сверх него
  // (лог 10:44–11:41: сдвиг у 140 из 2820 нажатий, ≈31 с/ч — почти всё на лагах 1–5 с, где без сдвига был бы отказ)
  const over = FNET.n ? Math.min(3000, Math.max(0, Math.round(up - FNET.lat - 80))) : 0;
  FNET.lat = FNET.n++ ? FNET.lat * 0.9 + Math.min(up, FNET.lat + 300) * 0.1 : Math.min(up, 400);
  FNET.over[a] = { t0: sent, over };
  if (over && env.FCD[a] === sent) env.FCD[a] = sent + over;   // fishAct уже засчитал нажатие (экран обновился раньше, чем пришла сводка сети)
}

const fishCdLeft = name => Math.max(0, (env.FCD[name] || 0) + fishCdLen() - Date.now());

async function fishAct(name) {                   // нажать рыболовный скилл и дождаться ответа в журнале
  fishWatch();
  const before = fishLog(), m0 = env.fishMut, c0 = env.fishCdMsg, hp0 = fishState()?.cur, t0 = Date.now();
  const hint = () => env.$q('.l2-fishing-combat-hint')?.textContent.trim() || '', h0 = hint();
  env.fishLastPre = before;
  if (name === 'pumping' || name === 'reeling') FNET.sent[name] = t0;   // 8.0.3: по нему fishNet узнаёт ответ на ЭТОТ клик
  env.fire(fSlot(name));
  let rej = false;
  // ответ — только настоящий: у рыбы сменилось HP / рыба пропала / в журнале строка удара, улова, срыва или отказ
  // «перезаряджається». Раньше ответом считалась любая перерисовка журнала, а без ответа через 1,5 с бот жал снова —
  // при лагах сервера (журнал 07.10, 02:27–02:29: ответы по 8–15 с) второе нажатие доходило, когда подсказка уже
  // сменилась, и игра засчитывала его как неверное: «Pumping — неверно. Рыба сорвалась!» — 6 срывов подряд.
  // Теперь ждём ответ до 15 с и повторно не жмём, пока его нет.
  const RESP_RE = /урон|неверно|сорвал|зірвал|вытащ|витягл|не сопротивляется/i;
  let tmo = false;
  // v5.3: сервер ответил (видно по сети), а страница не перерисовалась — лог 08.10 14:26: ответ через 0,3 с, экран стоял 16 с.
  // Ждём перерисовку 2,5 с после ответа, потом перезагружаем страницу рыбалки (она подтянет состояние с сервера)
  let stuck = false;
  // 8.0.3 (лог 11.10 11:19:44, 11:34:40): игра сама оборвала запрос через ≈9 с («signal is aborted without reason»), а бот ждал ещё 6 с
  // до своих 15 с. Обрыв ЭТОГО клика (ошибка сети из hook.js, запрос ушёл не раньше клика) — сразу к повтору по свежему состоянию
  let aborted = false;
  const got = await env.waitFor(() => {
    const nf = env.NET_FISH;
    if (nf.t > t0 && nf.err && nf.act === name && !(nf.ms > 0 && nf.t - nf.ms < t0 - 150)) return (aborted = true);
    if (env.NET_FISH.t > t0 && env.NET_FISH.ok && Date.now() - env.NET_FISH.t > 2500) return (stuck = true);
    if (env.fishCdMsg !== c0 || (hint() !== h0 && env.CD_RE.test(hint()))) return (rej = true);
    const f = fishState();
    if (!f || (hp0 != null && f.cur !== hp0)) return true;
    return fishNewLines(before).some(l => RESP_RE.test(l.t) || env.CD_RE.test(l.t) || /catch|lost|fail|hit/.test(l.cls));
  }, 15000, 25);
  if (stuck && env.on) {
    let rl = []; try { rl = JSON.parse(sessionStorage.getItem('l2bot.fishReload') || '[]').filter(t => Date.now() - t < 600000); } catch (e) {}
    if (rl.length >= 3) { stuck = false; await env.sleep(1500); }   // 7.1.30: не чаще 3 перезагрузок за 10 мин (общий счётчик со сторожем)
    else try { sessionStorage.setItem('l2bot.fishReload', JSON.stringify([...rl, Date.now()])); } catch (e) {}
  }
  if (stuck && env.on) {
    const f = fishState(); env.rec('B', 'рыбалка', `${name}: сервер ответил, а экран не обновился 2,5 с${f ? ` (рыба ${f.cur}/${f.max})` : ''} — перезагружаю страницу`);
    statFlush(); location.reload(); await env.sleep(6000); const L = []; L.rej = false; L.tmo = true; return L;
  }
  if (aborted) {                                 // откат и счётчик чистых нажатий не трогаем: нажатие, скорее всего, не дошло
    env.rec('B', 'рыбалка', `${name}: запрос оборвался (${String(env.NET_FISH.err).slice(0, 60)} · ${((Date.now() - t0) / 1000).toFixed(1)} с) — жму снова по свежему состоянию`);
    // игра сама перечитывает GET /game/fishing/state через 0,7–0,85 с после обрыва — ждём её (до 1,2 с), а не 15 с
    await env.waitFor(() => { const f = fishState(); return !f || f.cur !== hp0 || hint() !== h0; }, 1200, 50);
    const L = []; L.rej = false; L.tmo = true; return L;
  }
  if (!got && env.on) { tmo = true; env.rec('B', 'рыбалка', `нет ответа на ${name} 15 с (лаг сервера) — жму снова`); }
  // 8.0 (аудит рыбалки): журнал перерисовывается вместе с ответом — 20 мс вместо 60 (поздний улов ловит fishFight по fishLastPre)
  const lines = rej ? [] : (await env.sleep(20), fishNewLines(before));
  if (!rej && lines.some(l => env.CD_RE.test(l.t))) rej = true;
  const lag = Date.now() - t0;
  if (!rej && got) statPut('fishLag', Math.round((env.rt.fishLag || lag) * 0.9 + lag * 0.1));
  if (name === 'pumping' || name === 'reeling') {
    const gap = t0 - (env.FCD[name] || 0);
    const F = { ok: 0, rej: 0, ...(env.rt.fishCdStat || {}) };
    // 8.0: запись — с исходом заброса (statPut), нажатия её не ждут; откат в памяти меняется сразу
    if (rej) {
      F.rej++;
      // 8.0.3: учим только чистый отказ (жали по своему откату, без лага) — +30 мс; отказ после лага откат не раздувает, повтор через 150 мс
      const cd = fishCdLen();
      if (gap >= cd - 30 && gap < 3000 && (FNET.ms[name] || 0) <= 1000 && lag <= 1000) statPut('fishCdLen', +Math.min(FCD_MAX, cd / 1000 + 0.03).toFixed(3));
      else env.FCD[name] = Math.max(env.FCD[name] || 0, Date.now() + 150 - cd);
    } else if (got && !tmo) {
      // 8.0.3: отсчёт отката — с поправкой на опоздание клика на сервер (fishNet; если сводка сети придёт позже — поправит она)
      const o = FNET.over[name];
      env.FCD[name] = t0 + (o && o.t0 === t0 ? o.over : 0); F.ok++; FNET.ms[name] = lag;
      // пробуем откат короче: каждые 10 чистых нажатий −50 мс выше 1,3 с, −10 мс ниже (до 1,05 с); было −10 мс на 40 (≈40 мин с 1,69 с)
      if (F.ok % 10 === 0 && fishCdLen() > FCD_MIN * 1000 + 5) statPut('fishCdLen', +Math.max(FCD_MIN, fishCdLen() / 1000 - (fishCdLen() > 1300 ? 0.05 : 0.01)).toFixed(3));
    }
    statPut('fishCdStat', F);
  }
  lines.rej = rej; lines.tmo = tmo;
  return lines;
}

function fishQty(kind) {                         // kind: 'basicBait' | 'goodBait' | 'soulshot'
  const n = env.qty(fSlot(kind));
  if (n != null && !isNaN(n)) return n;
  const icon = kind === 'soulshot' ? /fishing_soulshot/ : kind === 'goodBait' ? /bait_good/ : /bait_basic/;
  const it = [...document.querySelectorAll('#fishing-gear-row .l2-fishing-gear-item')].find(e => icon.test(e.querySelector('img')?.getAttribute('src') || ''));
  const m = it && (it.textContent || '').match(/\d[\d\s]*/);
  if (m) return parseInt(m[0].replace(/\s/g, ''), 10);
  // страница загружена, если строка снаряжения уже показывает числа (кончившееся там — «0 OFF», а не пусто)
  const loaded = [...document.querySelectorAll('#fishing-gear-row .l2-fishing-gear-item')].some(e => /\d/.test(e.textContent));
  const u = fSlot(kind)?.querySelector('.l2-battle-hotbar-slot-uqty');
  return loaded && u && !/\d/.test(u.textContent) ? 0 : null;
}

async function fishBuy(offer, packs, what) {
  const open = env.$q('#fishing-shop-open');
  if (!open) return false;
  env.fire(open);
  const NAME = { starter_rod: /fishing rod|удочк|вудк/i, bait_x10: /fishing lure(?! *\(good)|(?<!good )lure|наживк|приманк/i, soulshot_x50: /soulshot|заряд/i, good_bait_x10: /good.*lure|хорош/i }[offer] || /$^/;
  const ICON = { starter_rod: /fishing_rod/, bait_x10: /bait_basic/, soulshot_x50: /fishing_soulshot/, good_bait_x10: /bait_good/ }[offer] || /$^/;
  const findRow = () => {
    const box = env.$q('#fishing-starter-offers') || document;
    const byOffer = box.querySelector(`[data-offer="${offer}"]`);
    if (byOffer && env.shown(byOffer)) return byOffer.closest('[class*="row"], li, tr') || byOffer.parentElement;
    // строка товара = ближайший к кнопке контейнер, где есть иконка или название (до 4 уровней вверх)
    const rows = [...box.querySelectorAll('button')].filter(env.shown).map(b => {
      let r = b.parentElement;
      for (let i = 0; i < 4 && r && r !== box; i++, r = r.parentElement) if (r.querySelector('img') || NAME.test(r.textContent)) return r;
      return b.parentElement;
    }).filter((r, i, a) => r && a.indexOf(r) === i);
    return rows.find(r => ICON.test(r.querySelector('img')?.getAttribute('src') || '')) || rows.find(r => NAME.test(r.textContent)) || null;
  };
  const row = await env.waitX(findRow, 6000, 150);   // 7.1.30: waitFor обрывался сразу (вкладка ещё не «хозяин») → «не нашёл товар», хотя он был
  if (!row) {
    env.rec('B', 'рыбалка: покупка', `${what}: не нашёл товар в «Магазине рыбака» · внутри: ${(env.$q('#fishing-starter-offers')?.innerText || '—').replace(/\s+/g, ' ').slice(0, 300)}`);
    env.fire(env.$q('#fishing-shop-close')); await env.sleep(400);
    return false;
  }
  const kind = offer === 'soulshot_x50' ? 'soulshot' : offer === 'good_bait_x10' ? 'goodBait' : 'basicBait';
  const before = fishQty(kind);
  // v4.53: ПРИЧИНА «2000+»: в строке товара кнопка MAX (тоже с data-offer) стоит раньше «Купити» — v4.52 жала MAX,
  // поле заполнялось максимумом, а покупки не было. Разметка (снимок 08.10 06:54): input.l2-fishing-starter-qty-input,
  // button.l2-fishing-starter-max-btn, button.l2-fishing-starter-buy-btn «Купити», превью [data-preview=receive|cost]. Теперь:
  // цена пакета из строки (по умолчанию 1 000 / 5 000), пакетов не больше, чем позволяют 80 % аден; после ввода
  // перечитываем поле; если игра показывает итог/количество больше задуманного — НЕ покупаем; разметку строки — в журнал.
  const num = t => parseInt(String(t || '').replace(/[\s ]/g, ''), 10);
  const rowTxt = () => row.textContent.replace(/\s+/g, ' ').trim();
  const pm = rowTxt().match(/(\d{1,3}(?:[\s ]\d{3})+|\d+)\s*(аден|adena|адени)/i);
  let price = pm ? num(pm[1]) : (offer === 'soulshot_x50' ? 5000 : 1000);
  // v5.6: адена — только цифры; не прочитали баланс — берём 1 пакет (раньше без баланса покупалось сколько угодно, до 2 млн)
  const digits = t => +String(t || '').replace(/\D/g, '') || 0;
  const adena = digits(env.$q('#fishing-starter-adena')?.textContent) || digits((document.body.innerText.match(/Adena:?[ \u00a0]*([\d \u00a0]+)/i) || [])[1]);
  let n = Math.max(1, Math.round(packs));
  if (adena > 0) n = Math.min(n, Math.floor(adena * 0.8 / price));
  else { n = 1; env.rec('B', 'рыбалка: покупка', `${what}: баланс адены не прочитан — беру 1 пакет`); }
  const html = row.outerHTML.replace(/\s+/g, ' ').replace(/src="[^"]*"/g, '').slice(0, 700);
  if (n < 1) {
    env.rec('B', 'рыбалка: покупка', `${what}: не хватает аден (${adena} при цене ${price} за пакет) · строка: ${html}`);
    env.fire(env.$q('#fishing-shop-close')); await env.sleep(400);
    return false;
  }
  const inps = [...row.querySelectorAll('input')].filter(i => !/hidden|checkbox|radio/i.test(i.type));
  const inp = row.querySelector('input.l2-fishing-starter-qty-input') || inps.find(i => /number/i.test(i.type)) || inps.find(i => /qty|count|amount|кол/i.test(i.className + i.name + i.id)) || inps[0];
  if (inp) {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const put = v => { inp.focus(); set.call(inp, String(v)); inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); inp.blur(); };
    if (inp.max && num(inp.max) > 0) n = Math.min(n, num(inp.max));
    put(n);
    await env.sleep(env.rnd(300, 500));
    if (num(inp.value) !== n) { put(n); await env.sleep(400); }
    if (num(inp.value) !== n) {
      env.rec('B', 'рыбалка: покупка', `${what}: поле количества не принимает ${n} (стало «${inp.value}») — не покупаю · строка: ${html}`);
      env.fire(env.$q('#fishing-shop-close')); await env.sleep(400);
      return false;
    }
  } else n = 1;                                   // поля нет — кнопка покупает один пакет
  // итог, который показывает игра, не должен превышать задуманное (+10 %)
  // «Вартість: <span data-preview="cost">5 000 Adena</span>» — превью цены от игры
  const costEl = row.querySelector('[data-preview="cost"]');
  const tm = costEl ? [0, 0, costEl.textContent] : rowTxt().match(/(итого|всего|сумма|стоимость|вартість|разом|усього|total|cost)\D{0,12}(\d{1,3}(?:[\s ]\d{3})+|\d+)/i);
  // v5.6: цену в строке не прочитали (удочка: «по умолчанию 1 000» неверно) — для одной штуки верим превью игры, но в пределах 80 % аден
  if (!pm && tm && n === 1 && num(tm[2]) > 0) {
    price = num(tm[2]);
    if (adena > 0 && price > adena * 0.8) { env.rec('B', 'рыбалка: покупка', `${what}: стоит ${price}, аден ${adena} — не покупаю`); env.fire(env.$q('#fishing-shop-close')); await env.sleep(400); return false; }
  }
  if (tm && num(tm[2]) > n * price * 1.1) {
    env.rec('B', 'рыбалка: покупка', `${what}: игра показывает стоимость ${num(tm[2])} вместо ${n * price} — не покупаю · строка: ${html}`);
    env.fire(env.$q('#fishing-shop-close')); await env.sleep(400);
    return false;
  }
  const msg0 = env.$q('#fishing-starter-success')?.textContent || '';
  const btn = row.querySelector('button.l2-fishing-starter-buy-btn') || [...row.querySelectorAll('button')].find(b => /куп|buy|придб/i.test(b.textContent) && !/max|макс/i.test(b.className + b.textContent))
    || [...row.querySelectorAll('button')].find(b => !/^[+\-−–]$|^\d+$|max|макс/i.test(b.textContent.trim()));
  if (!btn) { env.rec('B', 'рыбалка: покупка', `${what}: нет кнопки «Купить» · строка: ${html}`); env.fire(env.$q('#fishing-shop-close')); return false; }
  env.fire(btn);
  let ok = await env.waitFor(() => { const m = env.$q('#fishing-starter-success'); return (env.shown(m) && m.textContent !== msg0) || null; }, 1500, 150);
  if (!ok) {                                      // окно подтверждения покупки — подтверждаем, только если в нём наше количество
    const dlg = [...document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="confirm"]')].find(d => env.shown(d) && !d.contains(row) && /подтверд|підтверд|confirm|купить|придбати/i.test(d.textContent));
    const yes = dlg && [...dlg.querySelectorAll('button')].find(b => /^(да|так|ok|ок|подтвердить|підтвердити|купить|придбати|yes)$/i.test(b.textContent.trim()));
    const dn = dlg && (dlg.textContent.match(/(\d[\d\s ]*)\s*(шт|пак|×|x\b)/i) || [])[1];
    if (yes && (!dn || num(dn) <= n * 50)) { env.fire(yes); ok = await env.waitFor(() => { const m = env.$q('#fishing-starter-success'); return (env.shown(m) && m.textContent !== msg0) || null; }, 3000, 150); }
    else if (dlg) env.rec('B', 'рыбалка: покупка', `${what}: окно подтверждения непонятное — не подтверждаю: «${dlg.textContent.replace(/\s+/g, ' ').trim().slice(0, 160)}»`);
    if (!ok) ok = await env.waitFor(() => { const m = env.$q('#fishing-starter-success'); return (env.shown(m) && m.textContent !== msg0) || null; }, 2500, 150);
  }
  const txt = ok ? env.$q('#fishing-starter-success').textContent.replace(/\s+/g, ' ').trim().slice(0, 100) : 'без подтверждения';
  await env.sleep(env.rnd(400, 700));
  env.fire(env.$q('#fishing-shop-close'));
  await env.sleep(env.rnd(500, 800));
  const after = fishQty(kind);
  const got = (after != null && before != null && after > before) || (ok && !/недостат|не хват|не вистач|not enough|ошиб|помил/i.test(txt));
  env.rec('B', 'рыбалка: покупка', `${what}: ${n} пак. × ${price} = ${n * price} аден (аден было ${adena || '?'}) — ${txt}${after != null ? ` · теперь ${after}` : ''}${got ? '' : ` ⚠ не куплено · строка: ${html}`}`);
  return !!got;
}

const rodText = () => { const it = env.$q('.l2-fishing-gear-item--rod'); if (!it) return null; const c = it.cloneNode(true); c.querySelectorAll('button').forEach(b => b.remove()); return c.textContent.replace(/\s+/g, ' ').trim(); };

async function fishRod() {
  const notSel = () => { const t = rodText(); return t != null && (env.ROD_NONE_RE.test(t) || t === '' || t === '—'); };
  // «не выбрана» мелькает, пока страница не получила данные — ждём до 6 с, прежде чем выбирать
  if (notSel() && !env.rt.fishRodForce) await env.waitFor(() => !notSel(), 6000, 200);
  if (!notSel() && !env.rt.fishRodForce) return true;
  const why = env.rt.fishRodForce ? `игра просит удочку («${env.rt.fishRodForce}»)` : `«${rodText()}»`;
  env.setStatus('Рыбалка: выбираю удочку');
  const btn = env.$q('.l2-fishing-gear-item--rod [data-action="open-rod-select"]') || env.$q('[data-action="open-rod-select"]') || env.byText(/^Выбрать$|^Обрати$|^Select$/i, 'button');
  env.fire(btn);
  const listReady = () => {
    const L = env.$q('#fishing-rod-select-list');
    if (!L || !env.shown(env.$q('#fishing-rod-select-overlay') || L)) return null;
    const rows = [...L.children].filter(r => r.nodeType === 1 && r.textContent.trim());
    if (rows.length) return rows;
    const msg = env.$q('#fishing-rod-select-msg');
    return env.shown(msg) && msg.textContent.trim() ? [] : null;
  };
  const rows = await env.waitFor(listReady, 5000, 150);
  const close = async () => { const cl = env.$q('#fishing-rod-select-close'); if (env.shown(cl)) { env.fire(cl); await env.sleep(300); } };
  if (!rows || !rows.length) {
    const msg = (env.$q('#fishing-rod-select-msg')?.textContent || '').trim();
    env.rec('B', 'рыбалка: удочка', `не выбрана (${why}) · в окне выбора удочек нет${msg ? ` — «${msg.slice(0, 80)}»` : ''}`);
    await close();
    // удочек нет — в «Магазине рыбака» есть Fishing Rod (1 шт. — 25 000 Adena): покупаем одну и выбираем (не чаще раза в 10 мин)
    // 7.1.30 (10.10: игрок продал все удочки): без удочки рыбалка невозможна — одну покупаем всегда (не только с «докупать наживку»),
    // повтор через 2 мин. Выключить: fishRodBuy: false
    if (env.cfg.fishRodBuy !== false && Date.now() - (env.rt.fishRodBuyT || 0) > 2 * 60000) {
      await env.setRt({ fishRodBuyT: Date.now() });
      env.rec('B', 'рыбалка: удочка', 'удочек нет совсем — покупаю одну Fishing Rod в «Магазине рыбака» и надеваю');
      env.setStatus('Рыбалка: удочки нет — покупаю Fishing Rod');
      if (await fishBuy('starter_rod', 1, 'Fishing Rod')) return fishRod();
    }
    await fishSoft('Рыбалка: удочка не выбрана, а выбрать не из чего (купите Fishing Rod в «Магазине рыбака»)');
    return false;
  }
  const score = r => { const t = r.textContent; return (+(t.match(/\+(\d+)/) || [])[1] || 0) * 1000 + (+(t.match(/Old Box[^\d]*([\d.]+)/i) || [])[1] || 0) * 10 + (/выбран|обран|вибран|selected|✓/i.test(t) ? 0 : 1); };
  const best = rows.slice().sort((a, b) => score(b) - score(a));
  const pickBtn = r => [...r.querySelectorAll('button')].find(b => !b.disabled && !/закр|close/i.test(b.textContent)) || (r.tagName === 'BUTTON' && !r.disabled ? r : null);
  const row = best.find(pickBtn);
  const name = (row?.querySelector('[class*="name"]')?.textContent || row?.textContent || '?').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (row) { env.fire(pickBtn(row)); await env.sleep(env.rnd(600, 900)); }
  await close();
  const okSel = await env.waitFor(() => !notSel() || null, 4000, 200);
  await env.setRt({ fishRodForce: null, fishRodName: name });
  env.rec('B', 'рыбалка: удочка', `${why} → выбрал «${name}» из ${rows.length}${okSel ? '' : ' (подтверждения нет)'} · варианты: ${rows.map(r => r.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)).join(' | ')}`);
  return true;
}

// 8.0 (аудит рыбалки, снимки 10.10: строка снаряжения «Вудка +1», «Вудка +2», без «+» — заточки нет): уровень заточки удочки —
// прямо на рыбалке. Раньше ради него шли в инвентарь (лишний круг fishing ↔ char перед покупкой свитков). Только по устоявшейся
// странице (в строке снаряжения уже числа) и только по точному виду «Вудка [+N]» — иначе null (тогда, как раньше, — инвентарь)
function rodLvlGear() {
  const loaded = [...document.querySelectorAll('#fishing-gear-row .l2-fishing-gear-item')].some(e => /\d/.test(e.textContent));
  const t = rodText();
  if (!loaded || !t || env.ROD_NONE_RE.test(t)) return null;
  const m = t.match(/^(?:вудка|удочка|fishing rod|rod)\s*(?:\+\s*(\d{1,2}))?$/i);
  if (!m) return null;
  const n = m[1] == null ? 0 : +m[1];
  return n >= 0 && n <= 10 ? n : null;
}

let shotBuyT = 0;                               // 8.0: время последней удачной покупки зарядов (страховка от повторов)
async function fishPrepare() {                  // удочка, наживка выбрана и есть, заряды включены
  if (!(await fishRod())) return false;
  const want = baitWant();
  if (env.cfg.fishBait === 'auto' && want !== env.rt.baitAutoWant) {   // 7.2.1: смена решения «Авто» — в журнал с причиной
    await env.setRt({ baitAutoWant: want, baitSwapTo: null });
    env.rec('B', 'рыбалка', `наживка «Авто»: ${want === 'goodBait' ? 'хорошая' : 'обычная'} — ${baitVerdict()}`);
  }
  // сразу после загрузки страницы счётчики ещё пусты — ждём, пока панель/строка снаряжения покажет число
  await env.waitFor(() => fishQty(want) != null, 8000, 150);
  { const rl = rodLvlGear(); if (rl != null && rl !== env.rt.rodLvl) bg(env.setRt({ rodLvl: rl })); }   // 8.0: заточка удочки — из строки снаряжения
  // журнал 08.10 07:00–07:04: «Купити» молча не срабатывала ни у бота, ни у игрока (ни сообщения, ни списания аден),
  // пока персонаж оставался в бою (HP/MP 3 мин не восстанавливались); в 07:04 те же покупки прошли («Придбано ×10»).
  // Поэтому неудачу повторяем скоро — 30 с → 1 → 2 → 5 мин, а если не прошла покупка N пакетов — сразу пробуем 1 пакет.
  const F = () => env.rt.fishBuyFail || {};
  const buyOk = k => { const f = F()[k]; if (!f) return true; const t = typeof f === 'number' ? f : f.t, n = f.n || 1; return Date.now() - t > [30, 60, 120, 300][Math.min(n - 1, 3)] * 1000; };
  const buy = async (k, offer, packs, what) => {
    const cap = (env.rt.fishPackCap || {})[offer];
    const useCap = cap && Date.now() - cap.t < 30 * 60000;          // «много пакетов не проходит» — помним 30 мин
    let ok = await fishBuy(offer, useCap ? cap.n : packs, what);
    if (!ok && !useCap && packs > 1 && env.on) {
      ok = await fishBuy(offer, 1, what + ' (1 пакет — проверка)');
      if (ok) { await env.setRt({ fishPackCap: { ...(env.rt.fishPackCap || {}), [offer]: { n: 1, t: Date.now() } } }); env.rec('B', 'рыбалка: покупка', `${what}: ${packs} пак. не проходит, 1 пакет — да. 30 мин покупаю по 1 пакету, потом снова пробую ${packs}`); }
    }
    const f = F()[k];
    await env.setRt({ fishBuyFail: { ...F(), [k]: ok ? null : { t: Date.now(), n: (f?.n || 0) + 1 } } });
    if (!ok) env.rec('B', 'рыбалка: покупка', `${what}: магазин не ответил — возможно, персонаж ещё в бою; повтор через ${[30, 60, 120, 300][Math.min((f?.n || 0), 3)]} с`);
    return ok;
  };
  // 7.1.30 (лог 10.10 17:26): кончилась «Якісна наживка» (выбрана игрой из Old Box), а обычной в сумке 1094 — бот читал счётчик
  // невыбранной наживки как 0, пытался купить и вставал на паузу. Теперь: нужная наживка не выбрана — сначала выбираем её
  // и перечитываем счётчик; нужной нет, а другая есть — ловим на другой, а не стоим
  // 7.1.30: счётчик НЕвыбранной наживки читается как 0 — поэтому сначала выбираем, ждём, пока игра переключит (toggle-on),
  // и только потом читаем количество
  const isOn = kind => !!fSlot(kind)?.className.includes('toggle-on');
  const pick = async kind => {
    const sl = fSlot(kind); if (!sl) return false;
    if (isOn(kind)) return true;
    if (!fOk(sl)) return false;
    env.fire(sl);
    const ok = await env.waitFor(() => isOn(kind) ? 1 : null, 5000, 150);   // ответ сервера под лагом — до 5 с
    await env.sleep(env.rnd(300, 500));
    return !!ok;
  };
  // 8.0 (аудит рыбалки): решаем, на какой наживке ловить, ПО НАЛИЧИЮ. Раньше «Авто» (меньше 60 забросов на хорошей) просил хорошую,
  // а её 0 — fishPrepare выходил досрочно (в окне «30 мин на другой» и сразу после перехода на обычную), и блок зарядов не
  // выполнялся вовсе: заряды не докупались и не включались, «⚠ заряды кончились» не писалось. Обычная докупалась, только если
  // нужной была обычная — при «Авто»/«хорошая» и пустой обычной бот вставал на паузу. Теперь: хорошая — только если есть,
  // иначе обычная; кончилась обычная — покупаем обычную (хорошую — никогда, она за Proof); блок зарядов выполняется всегда.
  // Счётчик не прочитан (null) — как раньше, считаем «есть» и не покупаем: отказ игры в забросе разберёт ветка 'gear'
  const avail = async kind => { if (!fSlot(kind) || !(await pick(kind))) return false; const n = fishQty(kind); return n == null || n > 0; };
  const RU = k => k === 'basicBait' ? 'обычной' : 'хорошей';
  let use = null, bought = false;
  const buyBasic = async () => {                   // одна попытка за подготовку; повторы — по лесенке buyOk
    if (bought || !env.cfg.fishAutoBuy || !buyOk('bait')) return false;
    bought = true;
    env.setStatus('Рыбалка: обычная наживка кончилась — покупаю');
    await buy('bait', 'bait_x10', env.cfg.fishBuyPacks || 100, 'Fishing Lure ×10');
    return env.on && avail('basicBait');
  };
  // уже перешли на другую наживку — 30 мин ловим на ней, не переключая туда-сюда перед каждым забросом
  const sw = env.rt.baitSwapTo;
  if (sw && sw !== want && Date.now() - (env.rt.baitSwapT || 0) < 1800000 && isOn(sw) && (fishQty(sw) || 0) > 0) use = sw;
  if (!use && await avail(want)) use = want;
  if (!use && want === 'basicBait' && await buyBasic()) use = 'basicBait';   // нужна обычная — сперва докупить её, хорошую не тратить
  if (!use) {
    const other = want === 'basicBait' ? 'goodBait' : 'basicBait';
    if (await avail(other)) {
      use = other;
      bg(env.setRt({ baitSwapTo: other, baitSwapT: Date.now() }));
      if (Date.now() - (env.rt.baitSwapLogT || 0) > 600000) { env.rt.baitSwapLogT = Date.now(); env.rec('B', 'рыбалка', `${RU(want)} наживки нет — ловлю на ${RU(other)} (${fishQty(other) ?? '?'} шт.)`); }
    }
  }
  if (!use && await buyBasic()) use = 'basicBait';  // нет ни хорошей, ни обычной — покупаем обычную
  if (!use) { if (env.on) await fishSoft(env.cfg.fishAutoBuy ? 'Рыбалка: наживка кончилась, купить не вышло (хватает ли аден?)' : 'Рыбалка: кончилась наживка (включите «докупать» или купите в магазине рыбака)'); return false; }
  const ss = fSlot('soulshot');
  if (ss && env.cfg.fishShots) {
    // 8.0 (аудит рыбалки): заряды докупаем заранее — при ≤ 20 (раньше ровно при 0: забросы до покупки шли без зарядов, урон ≈35
    // вместо ≈70). Не чаще раза в 2 мин после удачной покупки (страховка от неверно прочитанного счётчика) и не во время лесенки неудач
    const sq = fishQty('soulshot');
    if (sq != null && sq <= 20 && env.cfg.fishAutoBuy && buyOk('shot') && Date.now() - shotBuyT > 120000) {
      env.setStatus(sq ? `Рыбалка: зарядов ${sq} — докупаю` : 'Рыбалка: кончились заряды — покупаю');
      // v4.56: соотношение — зарядов столько, чтобы кончились вместе с наживкой (по замеру расхода: наживки и зарядов на рыбу)
      let sp = env.cfg.fishShotPacks || 750, why = '';
      if (env.cfg.fishShotAuto !== false) {
        const F = env.rt.fish || {}, S = env.rt.fishSess || {};
        const baitPerFish = F.caught >= 30 ? Math.min(3, Math.max(1.1, F.casts / F.caught)) : 1.47;
        const shotPerFish = S.n >= 30 && S.shots ? Math.min(12, Math.max(3, S.shots / S.n)) : 5.5;
        const baitNow = fishQty(use) || 0;
        const fishLeft = baitNow / baitPerFish;
        sp = Math.max(5, Math.min(1000, Math.ceil(fishLeft * shotPerFish / 50)));   // 7.2.4: до 1000 пак. — под 1000 пакетов наживки (было 400)
        why = ` (под наживку: ${baitNow} шт. ≈ ${Math.round(fishLeft)} рыб × ${shotPerFish.toFixed(1)} заряда)`;
      }
      if (await buy('shot', 'soulshot_x50', sp, 'Fishing Soulshot ×50' + why)) shotBuyT = Date.now();
    }
    const s2 = fSlot('soulshot'), n2 = fishQty('soulshot');
    if (s2 && n2 > 0 && !/soulshot-on|toggle-on/.test(s2.className)) { env.fire(s2); await env.sleep(env.rnd(300, 500)); }
    // журнал 08.10: заряды кончились в 06:13 — бот не видел (пустой счётчик) и ловил без них: урон 35 вместо 70, ≈340 рыб/ч вместо ≈540
    const noShots = n2 === 0;
    if (noShots !== !!env.rt.fishNoShots) {
      await env.setRt({ fishNoShots: noShots });
      if (noShots) env.rec('B', 'рыбалка', `⚠ заряды кончились${env.cfg.fishAutoBuy ? ' и купить не вышло — ловлю без них, покупку повторю' : ' — ловлю без них (включите «докупать»)'} (урон ≈35 вместо ≈70)`);
    }
  }
  return true;
}

function fishDmgNote(lines) {
  for (const l of lines) {
    const m = l.t.match(/(Pumping|Reeling)(\s*\+\s*\S+)?\s*[—-]\s*(\d+)\s*урон/i);
    if (!m) continue;
    const k = m[2] ? 'shot' : 'plain', D = env.rt.fishDmg || {};
    const o = D[k] || { n: 0, sum: 0 };
    statPut('fishDmg', { ...D, [k]: { n: o.n + 1, sum: o.sum + +m[3] } });   // 8.0: в хранилище — с исходом заброса
    if (k === 'shot') env.fishShotsSess++;
  }
}

async function fishCaught(name) {
  const old = env.rt.fishSess, sess = old && Date.now() - (old.last || 0) < 15 * 60000 ? { ...old } : { t0: Date.now() - 6000, n: 0 };   // пауза > 15 мин — новая сессия
  sess.n++; sess.last = Date.now(); sess.shots = (sess.shots || 0) + env.fishShotsSess; env.fishShotsSess = 0;
  if (env.fishCast) { baitNote(env.fishCast.bait, { caught: 1, ms: Date.now() - env.fishCast.t, proof: fishValOf(name) }); env.fishCast = null; }
  // 8.0: весь учёт рыбы (заброс, поклёвка, наживка, улов, сессия, урон, откат, лаг) — одной записью, без ожидания
  fishStat({ caught: 1 }, name);
  bg(env.setRt(statTake({ fishSinceProc: (env.rt.fishSinceProc || 0) + 1, fishSinceProcN: (env.rt.fishSinceProcN || 0) + 1, fishSess: sess })));
  const tg = env.rt.fishTgt; if (tg && !tg.done && tg.type === 'fish') await fishTgtAdd('fish', 1);   // цель «N рыб» — может остановить бота, это ждём
  env.rec('B', 'рыбалка', `поймана ${name} · ${fishRateTxt()}`);
}

function fishRateTxt() {
  const S = env.rt.fishSess; if (!S || !S.n) return '';
  const h = Math.max(1, (S.last || Date.now()) - S.t0) / 3600000;
  const C = env.rt.fishCdStat || {};
  return (env.rt.fishNoShots && env.cfg.fishShots ? '⚠ нет зарядов · ' : '') + `${S.n} рыб · ${Math.round(S.n / h)}/ч · откат ${(fishCdLen() / 1000).toFixed(2)} с` + (C.rej ? ` · отказов ${C.rej}` : '')
    + (env.rt.fishLag ? ` · ответ ${env.rt.fishLag} мс${env.rt.fishLag > 1000 ? ' ⚠ лаг' : ''}` : '')
    // 8.0.3 (лог 11.10 11:01:56–11:37): в фоновой вкладке игра снимает «disabled» с кнопок умений только на своём секундном тике
    // (88 нажатий опоздали, ≈48 с за час) — жать недоступную кнопку нельзя, поэтому только предупреждение: держать окно рыбалки видимым
    + (typeof document !== 'undefined' && document.hidden ? ' · ⚠ вкладка в фоне — кнопки игры оживают раз в 1 с' : '');
}

// 7.1.30 (лог 10.10 17:29:37): pumping ушёл, сервер ответил 200, а страница так и не перерисовалась — кнопка осталась «в полёте»
// (disabled), подсказка прежняя; бот крутился «жду кнопку» 2,5 мин без единого действия, пока игрок не перезапустил.
// Сторож: рыба на экране, а ни нажатия, ни изменения HP/подсказки 8 с — перезагружаем страницу (максимум 3 раза за 10 мин)
let fishProgT = Date.now(), fishProgSig = '';
function fishProgress(f) { const sig = f ? `${f.name}|${f.cur}|${f.need}` : '-'; if (sig !== fishProgSig) { fishProgSig = sig; fishProgT = Date.now(); } }
async function fishStallCheck(f) {
  fishProgress(f);
  if (!f || Date.now() - fishProgT < 8000) return false;
  let rl = []; try { rl = JSON.parse(sessionStorage.getItem('l2bot.fishReload') || '[]').filter(t => Date.now() - t < 600000); } catch (e) {}
  if (rl.length >= 3) { if (Date.now() - fishProgT > 60000) { fishProgT = Date.now(); env.rec('B', 'рыбалка', 'экран рыбалки снова завис — 3 перезагрузки за 10 мин, жду'); } return false; }
  try { sessionStorage.setItem('l2bot.fishReload', JSON.stringify([...rl, Date.now()])); } catch (e) {}
  env.rec('B', 'рыбалка', `экран завис: ${f.name} ${f.cur}/${f.max}, кнопка «${f.need || '—'}» недоступна 8 с — перезагружаю страницу`);
  fishProgT = Date.now(); statFlush(); location.reload(); await env.sleep(6000); return true;
}

// 8.0: учёт вываживания уходит в хранилище одной записью в конце (поймана — уже в fishCaught; сорвалась / скрылась / прервали — здесь)
async function fishFight() { try { return await fishFightLoop(); } finally { statFlush(); } }
async function fishFightLoop() {
  let fishName = fishState()?.name || '';
  let lastNeed = null, needT = Date.now();       // «реакция» отсчитывается от момента, когда подсказка стала известна
  const react = () => env.rnd(env.cfg.reactMin * 0.3, env.cfg.reactMax * 0.3);
  let reactMs = react();
  for (let guard = 0; guard < 300 && env.on && !env.rt.shop?.urgent; guard++) {   // «Закупить сейчас» — бросаем рыбу
    const f = fishState();
    if (!f) {                                    // рыба вытащена или сорвалась — цель скрылась
      const late = guard && env.fishLastPre ? fishNewLines(env.fishLastPre).find(l => /catch/.test(l.cls) || /Вы вытащили|Ви витягли/i.test(l.t)) : null;
      if (late) await fishCaught(late.fish || fishName);
      return;
    }
    fishName = f.name || fishName;
    if (await fishStallCheck(f)) return;
    if (!f.need) { await env.sleep(40); continue; }
    if (f.need !== lastNeed) { lastNeed = f.need; needT = Date.now(); reactMs = react(); }
    const b = fSlot(f.need);
    if (!b || b.disabled) { await env.sleep(30); continue; }
    // ждём ровно до конца своего отката (оверлей панели не ждём — он гаснет позже реального отката)
    const left = Math.max(fishCdLeft(f.need), reactMs - (Date.now() - needT));
    if (left > 0) { await env.sleep(Math.min(left, 400)); continue; }
    const f2 = fishState();                      // подсказка могла смениться — читаем прямо перед нажатием
    if (!f2 || f2.need !== f.need) continue;
    env.setStatus(`Рыбалка: ${f2.name} ${f2.cur}/${f2.max} — ${f2.need === 'pumping' ? 'Pumping' : 'Reeling'}`);
    fishProgT = Date.now();
    const lines = await fishAct(f2.need);
    fishProgT = Date.now();   // 7.1.30: лаг сервера (15 с ожидания в fishAct) — не зависание экрана
    if (lines.rej) { lastNeed = null; continue; }   // отказ «на откате»: откат уже переучен — ждём и жмём снова
    needT = Date.now(); reactMs = react();
    fishDmgNote(lines);
    const txt = lines.map(l => l.t).join(' ⏎ ');
    const caught = lines.find(l => /catch/.test(l.cls) || /Вы вытащили|Ви витягли/i.test(l.t));
    if (caught) { await fishCaught(caught.fish || fishName); return; }
    if (/сорвалась|зірвалась/i.test(txt)) {
      fishStat({ lost: 1 });
      if (env.fishCast) { baitNote(env.fishCast.bait, { ms: Date.now() - env.fishCast.t }); env.fishCast = null; }
      env.rec('B', 'рыбалка', `сорвалась ${fishName}: «${f2.st}» → нажат ${f2.need} · ${txt.slice(0, 120)}`);
      return;
    }
  }
}

// 7.1.30: новый персонаж — рыбалку «открывает» сам бот (лог 10.10 07:46: игрок делал это руками): изучить Fishing/Pumping/Reeling
// у рыбака (по 100 000 SP), купить рыболовное место (10 000 000 Adena, один раз — только если после покупки останется резерв
// закупок). Удочку, наживку, заряды и время бот уже покупает сам. Выключить: fishAutoSetup: false
async function fishSetup() {
  if (env.cfg.fishAutoSetup === false || !/\/fishing\.html/.test(location.pathname)) return false;
  if (env.rt.fishSetupDone && Date.now() - env.rt.fishSetupDone < 6 * 3600000) return false;   // 7.1.30: не каждый заброс
  if (!(await env.waitX(() => env.$q('button.l2-fishing-trainer-learn-btn, #fishing-spot-buy, [data-slot="fishing"]'), 8000, 200))) return false;
  await env.sleep(1500);                                   // блоки дорисовываются по данным сервера — решаем по устоявшейся картине
  const anyLearn = [...document.querySelectorAll('button.l2-fishing-trainer-learn-btn')].some(b => env.shown(b));
  if (!anyLearn && !env.shown(env.$q('#fishing-spot-buy'))) { await env.setRt({ fishSetupDone: Date.now() }); return false; }
  const learn = [...document.querySelectorAll('button.l2-fishing-trainer-learn-btn')].find(b => env.shown(b) && !b.disabled);
  if (learn) {
    const sk = learn.dataset.skill || learn.closest('[class*="trainer"]')?.textContent.trim().slice(0, 20);
    env.setStatus(`Рыбалка: изучаю навык ${sk}`); env.fire(learn);
    const gone = await env.waitX(() => !learn.isConnected || learn.disabled || !env.shown(learn), 4000, 150);
    if (!gone) { await fishSoft(`Рыбалка: навык ${sk} не изучился (не хватает SP?)`); return true; }   // 7.1.30: без бесконечных кликов
    env.rec('B', 'рыбалка', `изучен рыболовный навык ${sk} (100 000 SP)`); await env.sleep(800); return true;
  }
  const spot = env.$q('#fishing-spot-buy');
  if (spot && env.shown(spot) && !spot.disabled) {
    const txt = document.body.textContent, price = +((spot.closest('[class*="spot"]')?.textContent || txt).match(/Стоимость:\s*([\d\s]+)\s*Adena/i)?.[1] || '10000000').replace(/\D/g, '');
    const ad = +((txt.match(/Adena:\s*([\d\s]+)/i) || [])[1] || '').replace(/\D/g, '') || env.rt.adenaSeen?.v || 0;
    const reserve = env.cfg.shopReserve ?? 200000;
    if (!ad) { await fishSoft('Рыбалка: не вижу, сколько Adena — рыболовное место не покупаю'); return true; }   // 7.1.30
    if (ad - price < reserve) { await fishSoft(`Рыбалка: на рыболовное место нужно ${price.toLocaleString('ru')} Adena, есть ${ad.toLocaleString('ru')}`); return true; }
    env.setStatus('Рыбалка: покупаю рыболовное место'); env.fire(spot);
    if (!(await env.waitX(() => !env.shown(env.$q('#fishing-spot-buy')), 5000, 150))) { await fishSoft('Рыбалка: место не купилось — игра отказала'); return true; }
    env.rec('B', 'рыбалка', `куплено рыболовное место за ${price.toLocaleString('ru')} Adena (было ${ad ? ad.toLocaleString('ru') : '?'})`);
    await env.sleep(800); return true;
  }
  return false;
}

async function fishing() {
  if (await fishSetup()) return;
  // страница рыбалки дорисовывается скриптом игры: в первые секунды блоки «купите место» / «изучите навыки» /
  // «недоступно» могут мелькнуть до загрузки данных — раньше бот на этом останавливался (журнал 07.10: стоп через
  // 0,5–1,7 с после прихода на /fishing.html). Теперь решаем только по устоявшейся картине и без остановки.
  const blocker = () => env.shown(env.$q('#fishing-spot-buy')) ? 'Рыбалка: сначала купите рыболовное место'
    : env.shown(env.$q('#fishing-locked-msg')) ? 'Рыбалка недоступна: ' + env.$q('#fishing-locked-msg').textContent.trim().slice(0, 80)
    : (env.shown(env.$q('#fishing-trainer-details')) && /\d+\s*\/\s*\d+/.test(env.$q('#fishing-trainer-progress')?.textContent || '')
       && !/(\d+)\s*\/\s*\1\b/.test(env.$q('#fishing-trainer-progress').textContent)) ? 'Рыбалка: изучите Fishing, Pumping и Reeling у рыбака' : null;
  const ready = await env.waitFor(() => fSlot('fishing') || fishState(), 15000, 200);
  if (!env.on) return;
  if (!ready) {
    await env.sleep(3000);                            // помеха должна держаться, а не мелькнуть
    if (!env.on || fSlot('fishing')) return;
    return fishSoft(blocker() || 'Рыбалка: панель рыбалки не загрузилась');
  }
  if (fishState()) return fishFight();
  await fishTimeTopUp();
  if (!env.on) return;
  const T = env.rt.fishTgt && !env.rt.fishTgt.done ? env.rt.fishTgt : null;
  if (T && (T.got || 0) >= T.n) return fishTgtReached();
  // цель «Proof»: менять улов, как только по прогнозу хватит (а не ждать N рыб до разделки)
  if (T?.type === 'proof' && (env.rt.fishSinceProc || 0) > 0) {
    const per = env.rt.fishProofFish ? (env.rt.fishProofGain || 0) / env.rt.fishProofFish : 0;
    if (per && (T.got || 0) + env.rt.fishSinceProc * per >= T.n) {
      env.setStatus(`Рыбалка: цель ${T.n} Proof — улова хватает (≈${Math.floor((T.got || 0) + env.rt.fishSinceProc * per)}), иду менять`);
      await env.setRt({ fishService: 'cut' }); return;
    }
  }
  if ((env.cfg.fishProcess || T?.type === 'proof' || env.rt.rodGoalActive) && (env.rt.fishSinceProc || 0) >= (env.rt.rodGoalActive ? Math.max(100, env.cfg.fishProcessEvery || 100) : (env.cfg.fishProcessEvery || 100))) {   // 7.1.30: заточка — не чаще раза в 100 рыб; обычная разделка — как в настройках
    env.setStatus(`Рыбалка: поймано ${env.rt.fishSinceProc} — иду разделывать улов`);
    await env.setRt({ fishService: 'cut' });
    return;
  }
  if (!(await fishPrepare()) || !env.on) return;
  const fb = fSlot('fishing');
  if (!fOk(fb)) { await env.sleep(300); return; }
  if (env.cfg.fishMaxCasts && (env.rt.fish?.casts || 0) >= env.cfg.fishMaxCasts) return env.halt(`Рыбалка: сделано ${env.rt.fish.casts} забросов — лимит`, true);
  env.setStatus('Рыбалка: заброс');
  // 8.0 (аудит рыбалки, лог 10.10: ≈0,4 с накладных на заброс): «реакция» перед забросом 20–60 мс (было 50–150 мс)
  await env.sleep(env.rnd(20, 60));
  // снимок журнала и счётчика ДО нажатия: быстрый «Рыба не клюнула» может прийти вместе с забросом
  fishWatch();
  const pre = fishLog(), m0 = env.fishMut, castT = Date.now();
  const preTop = pre[0];
  const bait = curBait(), baitSlot = () => fSlot(bait + 'Bait');   // 7.2.1: та наживка, что выбрана в игре (а не в настройках)
  const bait0 = env.qty(baitSlot());                 // наживка тратится на заброс — надёжный признак, что заброс принят
  env.fire(fb);
  let castSeen = false, gearMsg = '';
  fishStat({ casts: 1 });
  env.fishCast = { bait, t: castT };
  const res = await env.waitFor(() => {
    if (fishState()) return 'bite';
    const changed = env.fishMut !== m0;
    const fresh = fishNewLines(pre);
    if (fresh.some(env.isNoBite)) return 'none';
    const gl = fresh.find(l => env.GEAR_RE.test(l.t)) || (env.fishGearMsg && env.fishGearMsg.at >= castT ? env.fishGearMsg : null);
    if (gl) { gearMsg = gl.t; return 'gear'; }
    if (fresh.some(env.isBite)) return fishState() ? 'bite' : null;   // поклёвка — ждём, пока появится цель
    const top = fishTop();
    if (env.isCast(top) && (changed || fresh.length)) castSeen = true;
    if (bait0 > 0 && env.qty(baitSlot()) < bait0) castSeen = true;
    // повторяющийся журнал: текстом новое не отличить, но журнал перерисовался и сверху «не клюнула»
    if (changed && env.isNoBite(top) && (castSeen || !env.isNoBite(preTop) || Date.now() - castT > 1000)) return 'none';
    // запасной признак: поклёвки нет 3,5 с, «Fishing» снова доступен, рыбы нет.
    // 8.0 (аудит рыбалки, лог 10.10 19:00:04.677 → 19:00:08.440): под лагом ответ на заброс пришёл через 3,9 с, а бот уже через 3,5 с
    // решил «не клюнула» и забросил снова, не узнав исход. Теперь запасной признак — только когда ответ на заброс уже пришёл (сеть)
    // и экран успел обновиться (300 мс); без ответа — жёсткий предел 8 с
    const nf = env.NET_FISH || {}, castResp = nf.t > castT && (!nf.act || nf.act === 'cast') && Date.now() - nf.t > 300;
    if (Date.now() - castT > 3500 && castResp && fOk(fSlot('fishing')) && !fishState() && !env.isCast(top)) return 'none';
    if (Date.now() - castT > 8000 && fOk(fSlot('fishing')) && !fishState()) return 'none';
    return null;
  }, 25000, 40);
  if (res === 'gear') {                           // игра отказала в забросе: удочка / наживка
    fishStat({ casts: -1 }); env.fishCast = null;
    env.rec('B', 'рыбалка', `заброс отклонён: «${gearMsg.slice(0, 100)}» — ${env.ROD_RE.test(gearMsg) ? 'выбираю удочку' : 'проверяю наживку'}`);
    statFlush();
    if (env.ROD_RE.test(gearMsg)) await env.setRt({ fishRodForce: gearMsg.slice(0, 60) });
    else if (env.cfg.fishAutoBuy) await env.setRt({ fishBuyFail: { ...(env.rt.fishBuyFail || {}), bait: 0 } });
    if (++env.fishGearN >= 4) { env.fishGearN = 0; return fishSoft(`Рыбалка: игра не даёт забросить — «${gearMsg.slice(0, 60)}»`); }
    await env.sleep(800);
    return;
  }
  env.fishGearN = 0;
  if (res) { env.fishNoResp = 0; if (env.rt.fishSoftN) statPut('fishSoftN', 0); }   // заброс прошёл — лесенка пауз заново с 5 с (8.0: без ожидания записи)
  if (res === 'bite' || res === 'none') baitNote(bait, { casts: 1, ...(res === 'bite' ? { bites: 1 } : {}) });
  if (res === 'bite') { fishStat({ bites: 1 }); return fishFight(); }
  if (res === 'none') {
    fishStat({ nobite: 1 });
    if (env.fishCast) { baitNote(bait, { ms: Date.now() - env.fishCast.t }); env.fishCast = null; }
    statFlush();                                   // 8.0: учёт заброса — одной записью
    env.setStatus('Рыбалка: не клюнула — перезабрасываю');
    // 7.2.1: сразу, как только удочка доступна; «реакция» и так есть перед самим забросом (раньше — ещё 50–150 мс сверху)
    await env.waitFor(() => fOk(fSlot('fishing')) || fishState(), 3000, 30);
    return;
  }
  // заброс без ответа 25 с: лаг, нет наживки или страница «уснула» — после 3 подряд перезагружаем рыбалку
  statFlush();
  if (++env.fishNoResp >= 3) { env.fishNoResp = 0; return fishSoft('Рыбалка: 3 заброса подряд без ответа (нет наживки? лаг?)'); }
  await env.sleep(300);
}

async function fishCut() {
  env.setStatus('Рыбалка: разделка улова в инвентаре');
  const tab = await env.waitFor(() => env.$q('button[data-fishing-inventory-tab]'), 10000, 200);
  if (!env.on) return;
  if (!tab) { env.rec('B', 'рыбалка: разделка', 'нет вкладки «Рибалка» в инвентаре'); await env.setRt({ fishService: 'exchange' }); return; }
  if (tab.getAttribute('aria-selected') !== 'true') { env.fire(tab); await env.sleep(env.rnd(900, 1300)); }
  const done = new Set(), got = [];
  for (let guard = 0; guard < 40 && env.on; guard++) {
    const row = [...document.querySelectorAll('.l2-char-bag-row[data-fishing-inventory-row]')]
      .find(r => { const j = env.itemJson(r); return j.itemId && !done.has(j.itemId); });
    if (!row) break;
    const j = env.itemJson(row); done.add(j.itemId);
    const name = (row.querySelector('.l2-char-bag-name')?.textContent || '').replace(/\s*×\s*\d+.*$/, '').trim();
    if (env.MATERIAL_RE.test(name)) continue;          // материалы и снаряжение не трогаем
    env.fire(row.querySelector('.l2-char-bag-icon--stats') || row);
    const kind = await env.waitFor(() => env.shown(env.$q('#char-bag-modal-cut-row')) ? 'cut' : env.shown(env.$q('#char-bag-modal-oldbox-row')) ? 'box' : (env.shown(env.$q('#char-bag-modal-overlay')) ? 'none' : null), 3000, 100);
    if (kind === 'cut' || (kind === 'box' && env.cfg.fishOpenBoxes)) {
      const [maxSel, actSel] = kind === 'cut' ? ['#char-bag-modal-cut-max', '#char-bag-modal-cut'] : ['#char-oldbox-open-max', '#char-bag-modal-open-oldbox'];
      await env.waitFor(() => env.$q(maxSel) && !env.$q(maxSel).disabled, 2000, 100);
      env.fire(env.$q(maxSel)); await env.sleep(env.rnd(300, 500));
      const before = env.$q('#char-bag-modal-overlay')?.textContent || '';
      if (env.$q(actSel) && !env.$q(actSel).disabled) {
        env.fire(env.$q(actSel));
        await env.waitFor(() => { const t = env.$q('#char-bag-modal-overlay')?.textContent || ''; return t !== before && /разрезали|розрізали|открыли|відкрили/i.test(t); }, 5000, 150);
        const res = (env.$q('#char-bag-modal-overlay')?.textContent || '').replace(/\s+/g, ' ').match(/(Вы|Ви)\s+(разрезали|розрізали|открыли|відкрили)[^]*?(?=Информация|Закрыть|$)/i)?.[0] || '';
        got.push(`${name}: ${res.slice(0, 140)}`);
        env.rec('B', 'рыбалка: разделка', `${name} ×${j.qty || '?'} → ${res.slice(0, 160)}`);
        try { await fishValNote(res); } catch (e) {}   // 7.2.1: Proof с рыбы по видам — для замера наживки
      }
    }
    env.fire(env.$q('#char-bag-modal-close')); await env.sleep(env.rnd(500, 800));
  }
  await env.setRt({ fishService: 'exchange', fishSinceProc: 0 });
  env.setStatus(`Рыбалка: разделано ${got.length} видов — иду менять на Proof`);
}

async function fishExchange() {
  env.setStatus('Рыбалка: обмен продуктов разделки на Proof');
  await env.waitFor(() => env.$q('#fishing-shop-exchange .l2-fshop-row--exchange') || env.$q('#fishing-shop-tab-resources'), 10000, 200);
  if (!env.on) return;
  const res = env.$q('#fishing-shop-tab-resources');
  if (res && !res.classList.contains('l2-fishing-special-shop-tab--active')) { env.fire(res); await env.sleep(env.rnd(600, 900)); }
  const ex = env.$q('#fishing-shop-tab-exchange');
  if (ex && !ex.classList.contains('l2-fishing-special-shop-tab--active')) { env.fire(ex); await env.sleep(env.rnd(600, 900)); }
  const proof = () => +(env.$q('#fishing-shop-proof-qty')?.textContent.replace(/\D/g, '') || 0);
  // магазин дорисовывается после загрузки: ждём строки обмена и число Proof (раньше бот уходил с «нечего менять, Proof 0 → 0»)
  const loaded = () => /\d/.test(env.$q('#fishing-shop-proof-qty')?.textContent || '') && !!env.$q('#fishing-shop-exchange .l2-fshop-row--exchange');
  if (!(await env.waitFor(loaded, 10000, 200))) {
    if (!env.on) return;
    const n = (env.rt.fishShopRetry || 0) + 1;
    if (n <= 2) { await env.setRt({ fishShopRetry: n }); await commit(); env.rec('B', 'рыбалка: обмен', `магазин не загрузился — обновляю страницу (${n}/2)`); location.reload(); await env.sleep(5000); return; }
    env.rec('B', 'рыбалка: обмен', 'магазин не загрузился 3 раза — обмен пропущен, вернусь позже');
    await env.setRt({ fishService: null, fishShopRetry: 0 });
    if (await fishSvcDone('магазин не загрузился')) return;
    await commit(); location.href = fishNow() ? '/fishing.html' : '/map.html'; await env.sleep(4000); return;
  }
  if (env.rt.fishShopRetry) await env.setRt({ fishShopRetry: 0 });
  await env.sleep(env.rnd(300, 500));
  const p0 = proof(), keys = [...document.querySelectorAll('#fishing-shop-exchange .l2-fshop-row--exchange')].map(r => r.dataset.exchange);
  { const R = {};   // 7.2.1: курсы обмена «N → Proof M» — для оценки Proof с рыбы
    for (const r of document.querySelectorAll('#fishing-shop-exchange .l2-fshop-row--exchange')) { const m = (r.querySelector('.l2-fshop-row__rate')?.textContent || r.textContent).match(/(\d+)\s*→\s*Proof\s*(\d+)/i); if (m && r.dataset.exchange) R[r.dataset.exchange] = [+m[1], +m[2]]; }
    if (Object.keys(R).length && JSON.stringify(R) !== JSON.stringify(env.rt.fishRates || {})) await env.setRt({ fishRates: R }); }
  const made = [];
  for (const k of keys) {
    if (!env.on) return;
    const row = env.$q(`#fishing-shop-exchange .l2-fshop-row--exchange[data-exchange="${k}"]`);
    if (!row) continue;
    const owned = +(row.querySelector('.l2-fshop-row__owned-qty')?.textContent.replace(/\D/g, '') || 0);
    const need = +((row.querySelector('.l2-fshop-row__rate')?.textContent.match(/(\d+)\s*→/) || [])[1] || 1);
    if (owned < need) continue;
    // 8.0 (аудит рыбалки, лог 10.10 18:48:31–42, 19:21:09–20): ≈1,6 с на материал из-за постоянных пауз. Теперь ждём ответ игры:
    // после «макс» — пока поле заполнится и «Обменять» станет активной, после обмена — сообщение игры, и короткая пауза
    // (следующий запрос несёт expectedRevision — страница должна успеть принять новое состояние)
    const btnQ = () => env.$q(`#fishing-shop-exchange .l2-fshop-exchange-btn[data-exchange="${k}"]`);
    const inpQ = () => env.$q(`#fishing-shop-exchange .l2-fshop-qty-input[data-exchange="${k}"]`);
    env.fire(row.querySelector('.l2-fshop-max-btn'));
    await env.waitFor(() => { const b = btnQ(), i = inpQ(); return !!b && !b.disabled && (!i || +i.value > 0); }, 1500, 40);
    await env.sleep(env.rnd(60, 120));
    const btn = btnQ();
    if (!btn || btn.disabled) continue;
    const before = env.$q('#fishing-shop-success')?.textContent || '';
    env.fire(btn);
    await env.waitFor(() => (env.$q('#fishing-shop-success')?.textContent || '') !== before, 4000, 50);
    made.push(`${row.querySelector('.l2-fshop-row__name')?.textContent.trim() || k} ×${owned - owned % need}`);
    await env.sleep(env.rnd(200, 300));
  }
  if (made.length) await env.waitFor(() => proof() !== p0, 1500, 50);   // 8.0: пауз меньше — число Proof дождаться явно
  let p1 = proof();
  env.rec('B', 'рыбалка: обмен', `${made.join(', ') || 'нечего менять'} → Proof ${p0} → ${p1}`);
  // учёт: сколько Proof даёт одна рыба (для прогноза до цели)
  const gain = Math.max(0, p1 - p0), fishN = env.rt.fishSinceProcN || 0;
  await env.setRt({ fishProofGain: (env.rt.fishProofGain || 0) + gain, fishProofFish: (env.rt.fishProofFish || 0) + fishN, fishSinceProcN: 0 });
  // цель: плащ / тату / пояс за Proof + аден — покупаем по очереди, когда кнопка «Купить» активна
  const bought = new Set(env.rt.fishGearBought || []);
  for (const g of env.names(env.cfg.fishGoal || '')) {
    if (!env.on || bought.has(g)) continue;
    const kind = g.split('_')[0];               // cloak | tattoo | belt
    const tab = env.$q(`#fishing-shop-tab-${kind}s`);
    if (tab && !tab.classList.contains('l2-fishing-special-shop-tab--active')) { env.fire(tab); await env.sleep(env.rnd(700, 1000)); }
    const btn = await env.waitFor(() => env.$q(`.l2-fshop-buy-gear-btn[data-gear="${g}"]`), 3000, 150);
    // v5.6: кнопки нет — «уже куплено» только если вкладка магазина загрузилась (кнопки других вещей видны). Раньше вкладка
    // не успевала за 3 с — и цель навсегда помечалась купленной
    if (!btn) { if (env.$q('.l2-fshop-buy-gear-btn')) { bought.add(g); env.rec('B', 'рыбалка', `${g}: кнопки покупки нет — считаю купленным`); } continue; }
    if (btn.disabled) { env.setStatus(`Рыбалка: цель ${g} — копим Proof (${p1})`); break; }   // не хватает — дальше по списку не идём
    const before = env.$q('#fishing-shop-success')?.textContent || '';
    env.fire(btn);
    const ok = await env.waitFor(() => (env.$q('#fishing-shop-success')?.textContent || '') !== before, 5000, 150);
    env.rec('B', 'рыбалка: покупка за Proof', `${g}: ${ok ? env.$q('#fishing-shop-success').textContent.trim().slice(0, 100) : 'без подтверждения'}`);
    if (ok) { bought.add(g); p1 = proof(); }
    await env.sleep(env.rnd(800, 1200));
  }
  // 🎣 заточка удочки до +N: свитки «Fishing Rod Enchant Scroll x1» по 100 Proof («Ресурсы → Товары»), потом — в инвентарь точить
  const rodTo = Math.min(10, Math.max(0, +env.cfg.rodEnchantTo || 0));
  if (env.on && rodTo > 0 && !Number.isFinite(env.rt.rodLvl)) {
    // Do not buy scrolls using a guessed +0 level. Inspect the actual rod first.
    env.rec('B', 'удочка', 'уровень заточки неизвестен — проверяю удочку в инвентаре до покупки свитков');
    await env.setRt({ fishService: 'rod', fishProof: p1, fishGearBought: [...bought] });
    await commit(); location.href = '/char.html'; await env.sleep(4000); return;
  }
  if (env.on && rodTo > (env.rt.rodLvl ?? 0)) {
    const r = await env.rodScrollsBuy(rodTo, proof);
    p1 = proof();
    if (r.have > 0 || r.bought > 0) { await env.setRt({ fishService: 'rod', fishProof: p1, fishGearBought: [...bought] }); await commit(); location.href = '/char.html'; await env.sleep(4000); return; }
  }
  await env.setRt({ fishService: null, fishProof: p1, fishGearBought: [...bought], rodGoalWaitingProof: !!env.rt.rodGoalActive && rodTo > (env.rt.rodLvl ?? 0) });
  if (await fishSvcDone(`Proof ${p1} (+${Math.max(0, p1 - p0)})`)) return;
  if (env.rt.fishTgt?.final && !env.rt.fishTgt.done) return fishTgtReached();   // цель «рыба»: улов сдан — стоп
  await fishTgtAdd('proof', gain);
  if (env.rt.fishTgt?.done && !env.on) return;
  env.setStatus(`Рыбалка: Proof ${p1} (+${Math.max(0, p1 - p0)}) — ${fishNow() ? 'возвращаюсь рыбачить' : 'возвращаюсь к охоте'}`);
  await env.sleep(env.rnd(800, 1200));
  if (env.on) { await commit(); location.href = fishNow() ? '/fishing.html' : '/map.html'; await env.sleep(4000); }
}

async function fishSvcDone(why) {
  const S = env.rt.fishSvc;
  if (!S) return false;
  await env.setRt({ fishSvc: null });
  env.rec('B', 'рыбалка', `«Разделать всю рыбу» из меню — готово${why ? ': ' + why : ''}`);
  if (S.stopAfter) { env.setStatus(`Разделка готова${why ? ' · ' + why : ''} — бот остановлен, как и был`); await chrome.storage.local.set({ on: false }); return true; }
  return false;
}

async function fishTgtAdd(kind, k) {
  const T = env.rt.fishTgt;
  if (!T || T.done || T.type !== kind || !(k > 0)) return;
  const got = (T.got || 0) + k;
  await env.setRt({ fishTgt: { ...T, got } });
  if (got >= T.n) await fishTgtReached();
}

async function fishTgtReached() {
  const T = env.rt.fishTgt;
  // «рыба»: если разделка включена — сначала разделать и сдать улов на Proof, стоп после обмена
  if (T.type === 'fish' && env.cfg.fishProcess && (env.rt.fishSinceProc || 0) > 0 && !T.final) {
    env.rec('B', 'рыбалка', `🎯 поймано ${T.got}/${T.n} — разделываю и сдаю улов на Proof, потом стоп`);
    await env.setRt({ fishTgt: { ...T, final: true }, fishService: 'cut' });
    return;
  }
  const msg = T.type === 'fish' ? `поймано ${T.got} рыб (цель ${T.n})` : `собрано ${T.got} Proof (цель ${T.n}), всего Proof: ${env.rt.fishProof ?? '?'}`;
  await env.setRt({ fishTgt: { ...T, done: true, doneT: Date.now() } });
  env.rec('B', 'рыбалка', `🎯 цель выполнена: ${msg}`);
  return env.halt(`🎯 Рыбалка: цель выполнена — ${msg}`, true);
}

async function goFishing() {
  env.setStatus('Рыбалка: иду к рыбаку');
  location.href = '/fishing.html';
  await env.sleep(5000);
}

const fishNow = () => { const m = env.autonomyMode(); return m === 'fish' || (m === 'epic' && !!env.cfg.fishMode && (!env.rt.epic || env.rt.epic.step === 'pick' || !env.rt.epic.step)); };
 return { statFlush, rodLvlGear, fishCutValue, fishValOf, baitAuto, baitWant, baitVerdict, baitPph, fishingTimeRemainingMs, fishTimeTopUp, fishSoft, isFishing, fSlot, fOk, fishState, fishLog, fishNewLines, fishStat, fishWatch, fishTop, fishCdLen, fishCdLeft, fishNet, fishAct, fishQty, fishBuy, rodText, fishRod, fishPrepare, fishDmgNote, fishCaught, fishRateTxt, fishFight, fishing, fishCut, fishExchange, fishSvcDone, fishTgtAdd, fishTgtReached, goFishing, fishNow };
 };
})(globalThis);
