// ===== L2wap Lite — меню (один экран) =====
// 20.10.2026, тред «Упрошенка под Дестра»: Старт/Стоп, место охоты и число мобов, TvT, выбор скиллов, журнал.
// Меню пишет только настройки (lite.cfg) и разовые команды (lite.cmd); память бота (lite.rt) пишет вкладка игры.
// Lite 1.3 (21.10, John: «это сборка под БХ, а нужна под дестра»): в игре другой класс — предупреждение; скиллы — только панель Дестра.
// Lite 1.4 (21.10): то же меню — окном на странице игры (#dock), сворачивается в плавающую кнопку.
// Lite 1.5 (21.10, John: «отдельный профиль на дестра, отдельный профиль на лука»): вкладки профилей «Дестр» и «Лук» — у каждого
// свои место, лимит, TvT, скиллы и «Ещё»; открыт профиль активного в игре класса, другой можно настроить заранее.
// Lite 1.6 (23.10, John: «Сверстай еще в боте сектор "споил"»): третий профиль «Споил» и его раздел — спойл, ресурс, места, счёт.
// Lite 1.8 (24.10, John: «спойл фестивалем масс или соло спойлом, полностью автономный режим; раздел со скоростью работы бота»):
// режим спойла и автономный спойлер в разделе «Споил»; раздел «⚡ Скорость» — пауза между действиями, реакция, замер.
'use strict';
if (location.hash === '#tab') document.documentElement.classList.add('tab');   // 1.2.1: меню, открытое кнопкой «Lite» со страницы игры
// 1.4: меню в окне на странице игры (bot.js, кнопка «—» сворачивает его в плавающую «Lite»): во всю ширину окна; странице — «готово»,
// иначе через 8 с там появится подсказка открыть меню во вкладке.
if (location.hash === '#dock') { document.documentElement.classList.add('dock'); try { parent.postMessage({ __l2liteDock: 'ready' }, '*'); } catch (e) {} }
const L = globalThis.L2Lite;
const K_CFG = 'lite.cfg', K_RT = 'lite.rt', K_CMD = 'lite.cmd';
const $ = id => document.getElementById(id);
// RAW — lite.cfg как есть; cfg — настройки открытого в меню профиля; pick — профиль, выбранный вкладкой (null — активный в игре).
let RAW = {}, cfg = L.profCfg({}, 'destr'), rt = {}, pick = null;
const kindAct = () => L.clsKind(rt.char?.prof) || L.rtKind(rt);
const kindView = () => pick || kindAct();
const syncCfg = () => { cfg = L.profCfg(RAW, kindView()); };
const tm = t => new Date(t).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const hm = t => new Date(t).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
const cmdId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Запись по одному полю: в хранилище всегда свежие настройки + это поле (два меню не затирают друг друга целиком).
// Поле профиля пишется в профиль, открытый в меню (L.profPatch), on — общий.
async function save(patch, cmd) {
  const kind = kindView();                         // профиль — на момент правки (вкладку могли сменить, пока читаем хранилище)
  const cur = (await chrome.storage.local.get(K_CFG))[K_CFG] || {};
  RAW = L.profPatch(cur, kind, patch); syncCfg();
  await chrome.storage.local.set(cmd ? { [K_CFG]: RAW, [K_CMD]: { id: cmdId(), type: cmd, kind, t: Date.now() } } : { [K_CFG]: RAW });
  paint();
}
const clampNum = (v, lo, hi, d) => { const n = Math.round(+v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

function paintRun() {
  const b = $('run');
  b.textContent = cfg.on ? '■ Стоп' : '▶ Старт';
  b.classList.toggle('on', !!cfg.on);
}
function paintStatus() {
  const old = rt.statusT && Date.now() - rt.statusT > 120000;
  $('status').textContent = cfg.on ? (rt.status || 'Жду вкладку игры l2wap.com') + (old ? ` (обновлено в ${hm(rt.statusT)} — открыта ли вкладка игры?)` : '') : 'Выключен';
  const c = rt.char, prof = L.profName(c?.prof);
  $('hero').textContent = c && c.name ? `${c.name}${c.lvl ? ', ' + c.lvl + ' ур.' : ''}${prof ? ' · ' + prof : ''}` : '';
  const hc = c && c.name ? L.heroClass(c.prof, c.slots, c.slot) : null, w = $('cls');
  w.hidden = hc?.ok !== false;
  w.textContent = hc?.ok === false ? `⚠ Сейчас в игре ${c.name} — ${hc.name}. Lite ведёт только Дестра/Титана, лучника, спойлера и мага: `
    + (hc.alts?.length ? `переключите в игре класс на ${hc.alts.map(a => `${a.name} (${L.slotRu(a.slot)}${a.lvl ? ', ' + a.lvl + ' ур.' : ''})`).join(' или ')}.`
      : 'войдите в игру Дестром/Титаном, лучником, спойлером или магом либо переключите на него сабкласс.')
    + ' Пока активен другой класс, бот ничего не жмёт.' : '';
  paintProfs();
  const P = L.profRt(rt, kindView()), k = P.kills, lim = +cfg.killLimit || 0;
  $('kills').textContent = lim > 0 ? `${k} / ${lim}${k >= lim ? ' ✔' : ''}` : String(k);
  // 1.5: у лука — стрелы в сумке (бот их не покупает; кончились — охота стоит до новых).
  const arw = $('arw'), atxt = L.arrowsText(rt.char?.arrows), out = kindView() === 'archer' && L.rtKind(rt) === 'archer' && (rt.arrowOut || rt.arrowNote);
  arw.hidden = kindView() !== 'archer' || (!atxt && !out && !(rt.char?.arrows && L.clsKind(rt.char?.prof) === 'archer'));
  arw.textContent = out ? `⚠ Нет стрел — охота стоит${atxt ? ' (в сумке: ' + atxt + ')' : ''}` : atxt ? `Стрелы: ${atxt}` : 'Стрел в сумке нет';
  $('now').textContent = P.zone ? `Место охоты: ${P.zone.name}${P.zone.auto ? ' (выбрал сам)' : ''}` : autoView() ? 'Место охоты выберу сам при Старте' : cfg.zone ? `Место охоты: ${cfg.zoneName || cfg.zone}` : cfg.on && kindView() === L.rtKind(rt) ? '' : 'Место охоты запомнится при Старте';
  const V = rt.tvt;
  let tv = '';
  if (cfg.tvt && V) {
    const now = Date.now() + (V.off || 0);
    if (/REGISTRATION/.test(V.phase)) tv = V.reg ? 'Записан на TvT' : 'Идёт запись на TvT';
    else if (/ACTIVE|PREPAR|STARTING|COMBAT/.test(V.phase)) tv = 'TvT идёт';
    if (V.start && V.start > now) tv = (tv ? tv + ' · ' : '') + `бой в ${hm(V.start - (V.off || 0))}`;
    else if (!tv && V.regOpen && V.regOpen > now) tv = `Следующая запись в ${hm(V.regOpen - (V.off || 0))}`;
  }
  $('tvtInfo').textContent = cfg.tvt ? tv : 'TvT выключен';
}
// Разметку строим через DOM, без innerHTML: имена скиллов и строки журнала приходят из игры.
function el(tag, props = {}, kids = []) {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of [].concat(kids)) if (k != null) e.append(k);
  return e;
}
function paintLog() {
  const lg = (rt.log || []).slice(-40).reverse(), box = $('log');
  const sig = lg.length + ':' + (lg[0]?.t || 0);
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  box.replaceChildren(...(lg.length ? lg.flatMap((x, i) => [el('b', { textContent: tm(x.t) }), ' ' + x.x + (i < lg.length - 1 ? '\n' : '')]) : ['Пусто']));
}
// 1.8: автономный спойлер — место выбирает бот, список места из меню не действует.
const autoView = () => kindView() === 'spoil' && cfg.spoilAuto === true;
function paintZone() {
  const za = $('zoneAuto'), auto = autoView(), P = L.profRt(rt, kindView());
  za.hidden = !auto;
  if (auto) za.textContent = `Место выбирает автономный спойлер${P.zone?.auto ? ': сейчас «' + P.zone.name + '»' : ''}. Выбранное здесь не действует, пока режим включён (раздел «Споил»).`;
  $('zone').disabled = auto;
  const sel = $('zone'), locs = [...(rt.locs || [])].sort((a, b) => (a.lo ?? 999) - (b.lo ?? 999) || String(a.name).localeCompare(String(b.name)));
  const want = cfg.zone || '';
  const opts = [['', 'Где стоит герой при Старте']];
  if (want && !locs.some(x => x.id === want)) opts.push([want, cfg.zoneName || want]);
  for (const x of locs) opts.push([x.id, `${x.name}${x.lo != null ? ` (${x.lo}–${x.hi ?? '?'})` : ''}`]);
  const sig = JSON.stringify(opts);
  if (sel.dataset.sig !== sig) { sel.replaceChildren(...opts.map(([value, textContent]) => el('option', { value, textContent }))); sel.dataset.sig = sig; }
  sel.value = want;
  sel.title = locs.length ? '' : 'Список локаций появится, когда бот откроет игру';
}
// 1.5: вкладки профилей. Активный в игре класс помечен «в игре»; выбор вкладки живёт, пока открыто меню.
function paintProfs() {
  const act = kindAct(), view = kindView(), inGame = L.clsKind(rt.char?.prof);
  for (const b of $('profs').querySelectorAll('button')) {
    const k = b.dataset.kind;
    b.classList.toggle('sel', k === view);
    b.setAttribute('aria-selected', String(k === view));
    b.querySelector('i').textContent = k === inGame ? ' · в игре' : '';
  }
  $('profNote').textContent = view === act
    ? (inGame ? `Бот работает по этому профилю: в игре ${WHO[view].now}.` : 'Последний профиль, по которому работал бот.')
    : `Профиль ${WHO[view].of} — бот возьмёт его сам, когда в игре станет активен ${WHO[view].who}. Здесь можно настроить его заранее.`;
}
// Кто в профиле: «в игре лучник», «профиль лука», «станет активен лучник».
const WHO = { destr: { now: 'Дестр', of: 'Дестра', who: 'Дестр/Титан' }, archer: { now: 'лучник', of: 'лука', who: 'лучник' },
  spoil: { now: 'спойлер', of: 'спойлера', who: 'спойлер (Scavenger / Bounty Hunter / Fortune Seeker)' },
  mage: { now: 'маг', of: 'мага', who: 'маг-нюкер (Sorcerer / Necromancer / Spellsinger / Spellhowler и их 3-я профессия)' } };
// 1.7: раздел «Маг» — у профиля мага. Кого задевает массовый удар в Ashen Bastion — из боёв (rt.aoeEx).
function paintMage() {
  const box = $('mageBox'), on = kindView() === 'mage';
  box.hidden = !on;
  if (!on) return;
  const A = (rt.aoeEx || {}).ashen_bastion, list = A && Array.isArray(A.list) ? A.list : [], mx = Math.max(0, ...list.map(x => +x.maxHp || 0));
  const t = list.length ? `Соседи в Ashen: ${list.map(x => `${x.name} (HP ${x.maxHp})`).join(', ')} — цель беру с HP не меньше ${mx}.` : 'Кого задевает массовый удар в Ashen, бот узнает в первом бою там.';
  if ($('mageEx').textContent !== t) $('mageEx').textContent = t;
  // 1.8.1: банки в сумке — из ответа игры (бот пишет rt.pots, когда счёт заметно меняется)
  const P = rt.pots, pt = P && Number.isFinite(+P.mp) ? `Банки в сумке: MP ${P.mp}${P.mp > 0 ? ` (≈${Math.max(1, Math.round(P.mp / 9))} мин боя)` : ' — нет, маг бьёт экономно и отдыхает'}, HP ${P.hp}.` : 'Сколько банок в сумке, бот узнает из ответа игры.';
  if ($('magePots').textContent !== pt) $('magePots').textContent = pt;
}
// 1.6: раздел «Споил» — только у профиля спойлера. Уровень героя для мест под ресурс — активного спойлера или его слота у героя.
function spoilLvl() {
  const c = rt.char || {};
  if (L.clsKind(c.prof) === 'spoil') return +c.lvl || 0;
  return +((c.slots || []).find(s => L.clsKind(s.prof) === 'spoil')?.lvl) || 0;
}
const MODE_HINT = {
  auto: 'С дубиной первым Spoil Crush (удар и спойл за один ход), с пикой и другим оружием — Spoil Festival раз за бой; не прошёл — Spoil.',
  mass: 'Spoil Festival первым, даже с дубиной: в начале боя бот ждёт его откат до 3 с и не бьёт, пока пачка не помечена. Подошли или возродились мобы без метки, которые умрут вместе с целью, — Festival ещё раз (до 3 за бой). Добычу соседей игра даёт, когда они гибнут: с пикой Whirlwind / Wild Sweep бьют всю пачку.',
  solo: 'Только Spoil по цели (с дубиной — Spoil Crush), Spoil Festival не жмём: его MP и ход уходят на удар. Для мобов, что ходят по одному.' };
function paintSpoil() {
  const box = $('spoilBox'), on = kindView() === 'spoil';
  box.hidden = !on;
  if (!on) return;
  $('spoilOn').checked = cfg.spoilOn !== false;
  const mode = L.spoilMode(cfg.spoilMode);
  $('spoilMode').value = mode;
  if ($('spoilModeHint').textContent !== MODE_HINT[mode]) $('spoilModeHint').textContent = MODE_HINT[mode];
  $('spoilAuto').checked = cfg.spoilAuto === true;
  if (document.activeElement !== $('spoilTries')) $('spoilTries').value = cfg.spoilTries;
  const sel = $('spoilRes'), lvl = spoilLvl();
  const opts = [['', 'Любые ресурсы — бить ближайших'], ...L.SPOIL_RES.map(r => [r.name, `${r.name} — мобы ${L.spoilMin(r)}+ ур. (до ${Math.max(...r.bands.map(b => b[2]))} %)`])];
  const sig = JSON.stringify(opts);
  if (sel.dataset.sig !== sig) { sel.replaceChildren(...opts.map(([value, textContent]) => el('option', { value, textContent }))); sel.dataset.sig = sig; }
  sel.value = L.spoilRes(cfg.spoilRes) ? L.spoilRes(cfg.spoilRes).name : '';
  // Места под ресурс: локации телепорта с мобами героя ±5 ур., у которых он спойлится (L.spoilSpots).
  // 1.8: автономный режим — места, из которых бот выбирает сам (L.spoilAutoSpots: и без ресурса — по уровню), выбранное помечено.
  const res = L.spoilRes(cfg.spoilRes), auto = cfg.spoilAuto === true, sp = $('spoilSpots');
  const P = L.profRt(rt, 'spoil'), cur = P.zone?.auto ? P.zone.id : '', bad = Object.entries(rt.spotBad || {}).filter(([, t]) => t > Date.now()).map(([id]) => id);
  const spots = auto ? L.spoilAutoSpots(rt.locs, res, lvl, 5) : res ? L.spoilSpots(rt.locs, res, lvl) : [];
  const ssig = JSON.stringify([res?.name, lvl, cfg.zone, auto, cur, bad, spots]);
  if (sp.dataset.sig !== ssig && auto) {
    sp.dataset.sig = ssig;
    sp.replaceChildren(...(!lvl ? [el('p', { className: 'hint', textContent: 'Места подберу, когда бот увидит уровень спойлера.' })]
      : !spots.length ? [el('p', { className: 'hint', textContent: (rt.locs || []).length ? `Нет мест с мобами ${Math.max(1, lvl - 5)}–${lvl + 5} ур.${res ? ', с которых спойлится ' + res.name : ''} — бот охотится там, где стоит.` : 'Список мест появится, когда бот откроет игру.' })]
      : [el('span', { className: 'dim', textContent: `Выбираю сам из мест для ${lvl} ур. ±5${res ? ' под ' + res.name : ' по ценности сырья'}:` }),
        ...spots.map(x => el('div', { className: x.id === cur ? 'cur' : 'dim', textContent: `${x.id === cur ? '✔ ' : bad.includes(x.id) ? '⏸ ' : '· '}${x.name} (${x.lo}–${x.hi ?? '?'})${res ? ' · до ' + x.v + ' %' : ''}${bad.includes(x.id) ? ' — отложено' : ''}` }))]));
  } else if (sp.dataset.sig !== ssig) {
    sp.dataset.sig = ssig;
    sp.replaceChildren(...(!res ? [] : !lvl ? [el('p', { className: 'hint', textContent: 'Места подберу, когда бот увидит уровень спойлера.' })]
      : !spots.length ? [el('p', { className: 'hint', textContent: (rt.locs || []).length ? `Нет мест с мобами ${Math.max(1, lvl - 5)}–${lvl + 5} ур., с которых спойлится ${res.name}.` : 'Список мест появится, когда бот откроет игру.' })]
      : [el('span', { className: 'dim', textContent: `Где спойлить ${res.name} (${lvl} ур. ±5):` }),
        ...spots.map(x => { const b = el('button', { type: 'button', className: 'small' + (x.id === cfg.zone ? ' sel' : ''), textContent: `${x.id === cfg.zone ? '✔ ' : ''}${x.name} (${x.lo}–${x.hi ?? '?'}) · до ${x.ch} %` });
          b.dataset.id = x.id; b.dataset.name = x.name; b.title = 'Охотиться здесь'; return b; })]));
  }
  // Счёт спойла: заспойлено из убитых, удачи одиночного спойла, Festival, добыча (выбранный ресурс — первым).
  const S = rt.spoil || {}, it = Object.entries(S.items || {}).sort((a, b) => (res && b[0] === res.name) - (res && a[0] === res.name) || b[1] - a[1]);
  const lines = [S.mobs ? `Заспойлено ${S.sp || 0} из ${S.mobs} мобов (${Math.round((S.sp || 0) * 100 / S.mobs)} %)${S.t0 ? ' с ' + hm(S.t0) : ''}` : 'Счёт спойла пуст — начнётся с первого боя спойлера.'];
  if (S.ok || S.fail) lines.push(`Spoil: ✅ ${S.ok || 0} ✗ ${S.fail || 0}${S.ch ? ` · шанс по игре ${S.ch} %` : ''}`);
  if (S.mass) lines.push(`Spoil Festival: ${S.mass} раз · помечено ${S.massOk || 0}, промахов ${S.massFail || 0}`);
  if (it.length) lines.push('Добыча: ' + it.slice(0, 10).map(([n, q]) => `${n} ${q}`).join(', ') + (it.length > 10 ? ` и ещё ${it.length - 10}` : ''));
  const st = $('spoilStat'), tsig = lines.join('\n');
  if (st.dataset.sig !== tsig) { st.dataset.sig = tsig; st.replaceChildren(...lines.map(t => el('div', { textContent: t }))); }
}
function paintSkills() {
  // Панель другого класса (память 1.2.1 у сабкласса БХ) не показываем: rt.barCls — класс, у которого она прочитана.
  // 1.5: у Дестра и у лука панели свои (L.profRt: активный профиль — в rt, другой — в rt.by).
  const view = kindView(), P = L.profRt(rt, view);
  const mine = P.barCls ? L.clsKind(P.barCls) === view : view === L.rtKind(rt) && (!rt.char?.prof || L.clsKind(rt.char.prof) === view);
  const box = $('skills'), bar = mine ? (P.bar || []).filter(x => x && x.a && x.a !== 'attack') : [];
  const who = WHO[view].who;
  if (!bar.length) { box.replaceChildren(el('p', { className: 'hint', textContent: L.clsKind(rt.char?.prof) !== view
    ? `Скиллы появятся, когда в игре будет активен ${who}: бот прочитает его панель.` : `Откройте игру с включённым расширением — бот прочитает панель скиллов (${who}).` })); box.dataset.sig = ''; return; }
  const rows = bar.map(x => {
    const info = L.skillInfo(x.a, x.n), ch = (cfg.skills || {})[info.key], use = L.skillUse(info, ch, view);
    return { key: info.key, name: x.n || info.name, use, known: info.known };
  });
  const sig = view + JSON.stringify(rows.map(r => [r.key, r.name, r.use.on, r.use.type]));
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  box.replaceChildren(...rows.map(r => {
    const row = el('div', { className: 'sk' + (r.use.on ? '' : ' off') }, [
      el('input', { type: 'checkbox', checked: r.use.on, disabled: r.use.type === 'other', title: 'Жать этот скилл' }),
      el('span', { className: 'n', title: r.name + (r.known ? '' : ' — бот его не знает: проверьте тип'), textContent: r.name + (r.known ? '' : ' ?') }),
      el('select', {}, L.TYPES.map(t => el('option', { value: t, textContent: L.TYPE_RU[t], selected: t === r.use.type }))),
    ]);
    row.dataset.key = r.key;
    return row;
  }));
}
// 1.8: раздел «Скорость» — пауза между действиями и реакция (общие), замер скорости с Старта (rt.spd, L.speedStats).
const secTxt = ms => (ms ? `${(ms / 1000).toLocaleString('ru', { maximumFractionDigits: 1 })} с` : 'без паузы');
function paintSpeed(fresh) {
  const P = L.paceCfg(cfg);
  if (fresh || document.activeElement !== $('delayMs')) $('delayMs').value = P.delay;
  $('delayVal').textContent = secTxt(+$('delayMs').value);
  if (fresh || document.activeElement !== $('reactMin')) $('reactMin').value = P.lo;
  if (fresh || document.activeElement !== $('reactMax')) $('reactMax').value = P.hi;
  const S = L.speedStats(rt.spd, Date.now()), lines = [];
  if (!rt.spd || !rt.spd.t0) lines.push('Замер начнётся со Старта.');
  else {
    lines.push(`Замер с ${hm(rt.spd.t0)} (${S.min < 1 ? 'меньше минуты' : Math.round(S.min) + ' мин'}): ходов ${S.acts}, побед ${S.wins}, мобов ${S.kills}`);
    const parts = [];
    if (S.gap != null) parts.push(`ход каждые ${S.gap.toLocaleString('ru', { maximumFractionDigits: 2 })} с`);
    if (S.apm != null) parts.push(`${S.apm} ходов в минуту`);
    if (S.cyc != null) parts.push(`моб каждые ${S.cyc.toLocaleString('ru')} с`);
    if (S.kph != null) parts.push(`≈${S.kph} мобов в час`);
    if (parts.length) lines.push(parts.join(' · '));
  }
  const st = $('spdStat'), sig = lines.join('\n');
  if (st.dataset.sig !== sig) { st.dataset.sig = sig; st.replaceChildren(...lines.map(t => el('div', { textContent: t }))); }
}
let painted = '';                                  // 1.5: чей профиль на экране — сменился, поля перерисовываем и под курсором
function paint() { syncCfg(); paintRun(); paintStatus(); paintLog(); paintZone(); paintSkills(); paintSpoil(); paintMage(); paintSpeed(painted !== cfg.kind);
  const fresh = painted !== cfg.kind; painted = cfg.kind;
  for (const k of ['hpPot', 'mpPot', 'maxDeaths']) if (fresh || document.activeElement !== $(k)) $(k).value = cfg[k];
  if (fresh || document.activeElement !== $('limit')) $('limit').value = cfg.killLimit;
  $('tvt').checked = !!cfg.tvt;
  $('fastTurn').checked = cfg.fastTurn !== false;
  $('ver').textContent = chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version;
}

$('run').onclick = () => (cfg.on ? save({ on: false }) : save({ on: true }, 'start'));
$('reset').onclick = () => save({}, 'reset');
$('zone').onchange = e => { const o = e.target.selectedOptions[0]; save({ zone: e.target.value, zoneName: e.target.value ? o.textContent.replace(/\s*\(\d+–[\d?]+\)$/, '') : '' }); };
$('limit').onchange = e => save({ killLimit: clampNum(e.target.value, 0, 100000, 0) });
$('tvt').onchange = e => save({ tvt: e.target.checked });
$('fastTurn').onchange = e => save({ fastTurn: e.target.checked });
$('hpPot').onchange = e => save({ hpPot: clampNum(e.target.value, 10, 95, 50) });
$('mpPot').onchange = e => save({ mpPot: clampNum(e.target.value, 5, 95, 25) });
$('maxDeaths').onchange = e => save({ maxDeaths: clampNum(e.target.value, 1, 20, 3) });
$('spoilOn').onchange = e => save({ spoilOn: e.target.checked });
$('spoilMode').onchange = e => save({ spoilMode: L.spoilMode(e.target.value) });
$('spoilAuto').onchange = e => save({ spoilAuto: e.target.checked });
$('delayMs').oninput = e => { $('delayVal').textContent = secTxt(+e.target.value); };
$('delayMs').onchange = e => save({ delayMs: L.paceCfg({ delayMs: e.target.value }).delay });
$('reactMin').onchange = e => save({ reactMin: clampNum(e.target.value, 0, 3000, 60) });
$('reactMax').onchange = e => save({ reactMax: clampNum(e.target.value, 0, 3000, 140) });
$('spdReset').onclick = () => save({}, 'spdReset');
$('spoilTries').onchange = e => save({ spoilTries: clampNum(e.target.value, 1, 10, 4) });
$('spoilRes').onchange = e => save({ spoilRes: e.target.value });
$('spoilReset').onclick = () => save({}, 'spoilReset');
$('spoilSpots').addEventListener('click', e => {           // «охотиться здесь»: место охоты профиля спойлера
  const b = e.target.closest('button[data-id]'); if (!b) return;
  save({ zone: b.dataset.id, zoneName: b.dataset.name });
});
$('skills').addEventListener('change', e => {
  const row = e.target.closest('.sk'); if (!row) return;
  const key = row.dataset.key, on = row.querySelector('input').checked, type = row.querySelector('select').value;
  const skills = { ...(cfg.skills || {}) };
  // Новый тип «Не жать» снимает галку; включённый заново тип — галку ставит.
  skills[key] = { on: e.target.tagName === 'SELECT' ? type !== 'other' : on && type !== 'other', type };
  save({ skills });
});
$('profs').addEventListener('click', e => {
  const b = e.target.closest('button[data-kind]'); if (!b) return;
  pick = b.dataset.kind === kindAct() ? null : b.dataset.kind;
  $('skills').dataset.sig = '';
  paint();
});
$('dl').onclick = () => {
  const txt = (rt.log || []).map(x => `${new Date(x.t).toLocaleString('ru')}  ${x.x}`).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt + '\n'], { type: 'text/plain' }));
  a.download = `l2lite-log-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`;
  document.body.appendChild(a); a.click(); a.remove();
};

chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local') return;
  if (ch[K_CFG]) RAW = ch[K_CFG].newValue || {};
  if (ch[K_RT]) rt = ch[K_RT].newValue || {};
  if (ch[K_CFG] || ch[K_RT]) paint();
});
chrome.storage.local.get([K_CFG, K_RT]).then(s => { RAW = s[K_CFG] || {}; rt = s[K_RT] || {}; paint(); });
setInterval(() => { paintStatus(); paintSpeed(false); }, 5000);
