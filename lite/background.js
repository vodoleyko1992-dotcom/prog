// ===== L2wap Lite — фон (service worker в Chrome, фоновая страница в Firefox) =====
// 20.10.2026, тред «Упрошенка под Дестра»: одна вкладка игры ведёт бота (хозяин); значок ON; уведомления;
// сторож: вкладка-хозяин 3 мин молчит при включённом боте (ошибка сети, «Опаньки», зависла) — перезагрузить её.
'use strict';
const K_CFG = 'lite.cfg', K_OWN = 'lite.owner', STALE = 20000, SILENT = 180000;
const GAME = /^https:\/\/(?:[\w-]+\.)?l2wap\.com\//;
let ownMem = null;                                                   // запасной вариант, если storage.session нет
const sessArea = () => (chrome.storage && chrome.storage.session) || null;
async function ownGet() { const s = sessArea(); if (!s) return ownMem; try { return (await s.get(K_OWN))[K_OWN] || null; } catch (e) { return ownMem; } }
async function ownSet(v) { ownMem = v; const s = sessArea(); if (s) try { await s.set({ [K_OWN]: v }); } catch (e) {} }
// strict — адрес виден (у вкладок игры он виден по host_permissions) и это игра: чужой сайт сторож не перезагружает.
async function tabAlive(id, strict) { try { const t = await chrome.tabs.get(id); return !!t && (t.url ? GAME.test(t.url) : !strict); } catch (e) { return false; } }

// Очередь, чтобы две вкладки не стали хозяевами одновременно.
let q = Promise.resolve();
function beat(tabId, on) {
  const r = q.then(async () => {
    const now = Date.now(), cur = await ownGet();
    if (cur && cur.tab === tabId) { await ownSet({ ...cur, t: now, on: !!on }); return { owner: true }; }
    if (cur && now - cur.t < STALE && await tabAlive(cur.tab)) return { owner: false };
    await ownSet({ tab: tabId, t: now, on: !!on });
    return { owner: true };
  });
  q = r.catch(() => {});
  return r;
}
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (!m || typeof m !== 'object') return;
  if (m.cmd === 'beat') {
    const id = sender.tab && sender.tab.id;
    if (id == null || !GAME.test(sender.url || (sender.tab && sender.tab.url) || '')) { reply({ owner: false }); return; }
    beat(id, m.on).then(reply, () => reply({ owner: false }));
    return true;
  }
  // 1.2.1: кнопка «Lite» на странице игры — меню во вкладке (открытое уже — просто показать); всплывающее окно отсюда открыть нельзя.
  if (m.cmd === 'menu') { openMenu(sender.tab).then(() => reply({ ok: true }), () => reply({ ok: false })); return true; }
  if (m.cmd === 'notify') {
    try {
      chrome.notifications && chrome.notifications.create('lite-' + String(m.id || 'x').slice(0, 20), {
        type: 'basic', iconUrl: 'icons/128.png', title: String(m.title || 'L2wap Lite').slice(0, 80), message: String(m.text || '').slice(0, 200), priority: 2 }, () => void chrome.runtime.lastError);
    } catch (e) {}
    return;
  }
});
chrome.tabs.onRemoved.addListener(async id => { const cur = await ownGet(); if (cur && cur.tab === id) await ownSet(null); });
let menuTab = null;
async function openMenu(from) {
  if (menuTab != null) try { const t = await chrome.tabs.get(menuTab); if (t) { await chrome.tabs.update(menuTab, { active: true }); return; } } catch (e) { menuTab = null; }
  const opt = { url: chrome.runtime.getURL('popup.html#tab'), active: true };
  if (from && from.index != null) opt.index = from.index + 1;
  if (from && from.windowId != null) opt.windowId = from.windowId;
  const t = await chrome.tabs.create(opt); menuTab = t && t.id != null ? t.id : null;
}

function badge(on) {
  try {
    if (!chrome.action || !chrome.action.setBadgeText) return;
    chrome.action.setBadgeText({ text: on ? 'ON' : '' });
    chrome.action.setBadgeBackgroundColor && chrome.action.setBadgeBackgroundColor({ color: '#2e7d32' });
  } catch (e) {}
}
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch[K_CFG]) badge(!!(ch[K_CFG].newValue && ch[K_CFG].newValue.on)); });

async function watchdog() {
  const cfg = (await chrome.storage.local.get(K_CFG))[K_CFG] || {};
  badge(!!cfg.on);
  if (!cfg.on) return;
  const cur = await ownGet();
  if (!cur || Date.now() - cur.t < SILENT) return;
  if (!(await tabAlive(cur.tab, true))) { await ownSet(null); return; }
  await ownSet({ ...cur, t: Date.now() });                           // следующая проверка — не раньше чем через 3 мин
  try { await chrome.tabs.reload(cur.tab); } catch (e) {}
}
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'lite-wd') watchdog(); });
function setup() { try { chrome.alarms.create('lite-wd', { periodInMinutes: 1 }); } catch (e) {} watchdog(); }
chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup && chrome.runtime.onStartup.addListener(setup);
setup();
