// ===== L2wap Lite — меню (один экран) =====
// 20.10.2026, тред «Упрошенка под Дестра»: Старт/Стоп, место охоты и число мобов, TvT, выбор скиллов, журнал.
// Меню пишет только настройки (lite.cfg) и разовые команды (lite.cmd); память бота (lite.rt) пишет вкладка игры.
'use strict';
const L = globalThis.L2Lite;
const K_CFG = 'lite.cfg', K_RT = 'lite.rt', K_CMD = 'lite.cmd';
const DEF_CFG = { on: false, zone: '', zoneName: '', killLimit: 0, tvt: true, skills: {}, hpPot: 50, mpPot: 25, maxDeaths: 3, fastTurn: true };
const $ = id => document.getElementById(id);
let cfg = { ...DEF_CFG }, rt = {};
const tm = t => new Date(t).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const hm = t => new Date(t).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
const cmdId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Запись по одному полю: в хранилище всегда свежие настройки + это поле (два меню не затирают друг друга целиком).
async function save(patch, cmd) {
  const cur = (await chrome.storage.local.get(K_CFG))[K_CFG] || {};
  cfg = { ...DEF_CFG, ...cur, ...patch };
  await chrome.storage.local.set(cmd ? { [K_CFG]: cfg, [K_CMD]: { id: cmdId(), type: cmd, t: Date.now() } } : { [K_CFG]: cfg });
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
  const c = rt.char;
  const prof = String(c?.prof || '').split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  $('hero').textContent = c && c.name ? `${c.name}${c.lvl ? ', ' + c.lvl + ' ур.' : ''}${prof ? ' · ' + prof : ''}` : '';
  const k = rt.k?.kills || 0, lim = +cfg.killLimit || 0;
  $('kills').textContent = lim > 0 ? `${k} / ${lim}${k >= lim ? ' ✔' : ''}` : String(k);
  $('now').textContent = rt.zone ? `Место охоты: ${rt.zone.name}` : cfg.on ? '' : 'Место охоты запомнится при Старте';
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
function paintZone() {
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
function paintSkills() {
  const box = $('skills'), bar = (rt.bar || []).filter(x => x && x.a && x.a !== 'attack');
  if (!bar.length) { box.replaceChildren(el('p', { className: 'hint', textContent: 'Откройте игру с включённым расширением — бот прочитает панель скиллов героя.' })); box.dataset.sig = ''; return; }
  const rows = bar.map(x => {
    const info = L.skillInfo(x.a, x.n), ch = (cfg.skills || {})[info.key], use = L.skillUse(info, ch);
    return { key: info.key, name: x.n || info.name, use, known: info.known };
  });
  const sig = JSON.stringify(rows.map(r => [r.key, r.name, r.use.on, r.use.type]));
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
function paint() { paintRun(); paintStatus(); paintLog(); paintZone(); paintSkills();
  for (const k of ['hpPot', 'mpPot', 'maxDeaths']) if (document.activeElement !== $(k)) $(k).value = cfg[k];
  if (document.activeElement !== $('limit')) $('limit').value = cfg.killLimit;
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
$('skills').addEventListener('change', e => {
  const row = e.target.closest('.sk'); if (!row) return;
  const key = row.dataset.key, on = row.querySelector('input').checked, type = row.querySelector('select').value;
  const skills = { ...(cfg.skills || {}) };
  // Новый тип «Не жать» снимает галку; включённый заново тип — галку ставит.
  skills[key] = { on: e.target.tagName === 'SELECT' ? type !== 'other' : on && type !== 'other', type };
  save({ skills });
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
  if (ch[K_CFG]) cfg = { ...DEF_CFG, ...(ch[K_CFG].newValue || {}) };
  if (ch[K_RT]) rt = ch[K_RT].newValue || {};
  if (ch[K_CFG] || ch[K_RT]) paint();
});
chrome.storage.local.get([K_CFG, K_RT]).then(s => { cfg = { ...DEF_CFG, ...(s[K_CFG] || {}) }; rt = s[K_RT] || {}; paint(); });
setInterval(paintStatus, 5000);
