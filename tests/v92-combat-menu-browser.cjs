'use strict';
// 9.2 (игрок: «раздел «Бой и кот» — сборная солянка; раздел за функции боя, кот — подраздел Варлока, подразделы под мои классы»):
// браузерный смоук меню (node tests/v92-combat-menu-browser.cjs; CHROMIUM=…). Раздел «⚔ Бой»: «Анализ боя» (класс и профиль, память боя),
// «Общие правила боя», подразделы «Warlock — маг с котом», «Маг», «Спойлер», «Воин», «Герой». Показ по классу: Warlock → Warlock+Маг,
// спойлер → Спойлер+Воин, Spellsinger → Маг без кота, незнакомая профессия с веткой mystic → маг. На 760 и 375 px без горизонтальной прокрутки
const { chromium } = require(process.env.PLAYWRIGHT_NODE || '/opt/node-tools/node_modules/playwright');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const py = read('tests/v715-ui-browser.py');
let mock = py.slice(py.indexOf('mock=r"""') + 9); mock = mock.slice(0, mock.indexOf('"""'));
const fightMem = {
  'rb:l2dop_rb_25050': { nm: 'Verfa', k: 'rb', n: 2, w: 1, l: 0, lv: 60, hp: 771340, dps: 2500, a: { blaze: { n: 40, s: [3000, 3100, 2950, 3050] }, 'energy bolt': { n: 50, s: [2579, 2600, 2550] } }, h: [180, 180, 190, 200, 180], sp: { mx: 1995, nm: 'Гідроудар', g: [10, 10.2, 9.8], n: 6 }, pot: 12, t: 1000 },
  'm:banshee': { nm: 'Banshee', k: 'm', n: 5, w: 5, l: 0, lv: 63, hp: 3060, sec: 1.8, tu: 2, a: { blaze: { n: 5, s: [3550, 3570, 3590, 3610] }, 'energy bolt': { n: 5, s: [2950, 2960, 2970, 2980, 2990] } }, h: [12], t: 900 },
};
const fightLast = { key: 'rb:l2dop_rb_25050', name: 'Verfa', rb: true, outcome: 'win', sec: 252, turns: 180, dealt: 450000, pet: 180000, pots: 12, lost: 3, dps: 2500, t: 1000 };
const CASES = [
  { id: 'warlock', rt: { char: 'Warlock', lvl: 61, prof: 'Warlock', classCur: { prof: 'human_warlock', slot: 0 }, classBranch: 'mystic', fightMem, fightLast, petStat: { kai: { fights: 30 } }, skills: { blaze: { name: 'Blaze', dmg: 30000, dmgN: 10, kind: 'скилл' } }, turnMs: 820 },
    cls: ['cls-mage', 'cls-summoner'], notCls: ['cls-fighter', 'cls-spoil'], shown: ['tab-mage'], hidden: ['tab-spoil', 'tab-fighter'], box: /Профессия: Warlock 61 ур\. · основной класс · ветка маг\nПрофиль боя: саммонер \(авто\) · кот — основной урон/, fight: /Последний бой: Verfa \(РБ\) — победа за 252 с, ходов 180, урон 450000 \+ кот 180000 \(≈2500\/с\), банок 12, потерянных ходов 3\nЦелей в памяти: 2 \(РБ 1, чемпионов 0, видов мобов 1\)[\s\S]*\nРБ:\n• Verfa: боёв 2 \(побед 1\), ДПС ≈2500 · blaze ≈3050, energy bolt ≈2579 · бьёт ≈200 \(P90\) · спецудар до 1995 раз в ≈10 с/ },
  { id: 'spoiler', rt: { char: 'WestSPOIL', lvl: 32, classCur: { prof: 'dwarf_bounty_hunter', slot: 0 }, classBranch: 'fighter' },
    cls: ['cls-fighter', 'cls-spoil'], notCls: ['cls-mage', 'cls-summoner'], shown: ['tab-spoil', 'tab-fighter'], hidden: ['tab-mage'], box: /Профиль боя: спойлер \(авто\) · спойл в начале боя/, fight: /Боёв с анализом ещё нет/ },
  { id: 'spellsinger', rt: { char: 'SS', lvl: 40, classCur: { prof: 'elf_spellsinger', slot: 1 }, classBranch: 'mystic' },
    cls: ['cls-mage'], notCls: ['cls-summoner', 'cls-fighter', 'cls-spoil'], shown: ['tab-mage'], hidden: ['tab-spoil', 'tab-fighter'], box: /· саб 1 · ветка маг\nПрофиль боя: нюкер \(авто\)/ },
  { id: 'destroyer', rt: { char: 'D', lvl: 50, classCur: { prof: 'orc_destroyer', slot: 0 } },
    cls: ['cls-fighter'], notCls: ['cls-mage', 'cls-spoil'], shown: ['tab-fighter'], hidden: ['tab-mage', 'tab-spoil'], box: /Профиль боя: Дестр \(авто\) · Frenzy\/Guts при низком HP/ },
  { id: 'unknown-mystic', rt: { char: 'X', lvl: 20, classBranch: 'mystic' },
    cls: ['cls-mage', 'cls-summoner'], notCls: ['cls-fighter'], shown: ['tab-mage'], hidden: ['tab-fighter'], box: /Профессия: профессия неизвестна 20 ур\. · ветка маг\nПрофиль боя: маг \(по ветке класса\) \(авто\)/ },
];
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  for (const w of [760, 375]) for (const c of CASES) {
    const page = await b.newPage({ viewport: { width: w, height: 1100 } }); const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.goto('about:blank');
    const m = mock.replace("rt:{char:'West',lvl:56,fishProof:850,fish:{casts:10,caught:5}}", `rt:${JSON.stringify({ ...c.rt, fightGroups: c.id === 'warlock' ? { 'cat:disciples|flame strike': { t: Date.now(), samples: [{ kills: 2 }] } } : {} })}`);
    if (m === mock) { console.error('FAIL: popup mock not patched'); process.exit(1); }
    await page.evaluate(m);
    const html = read('popup.html').replace(/<link rel="stylesheet" href="[^"]+">/g, '').replace(/<script src="[^"]+"><\/script>/g, '');
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    for (const s of ['ui-v7.css', 'ui-game.css', 'enchant-ui.css', 'warlock-ui.css']) await page.addStyleTag({ content: read(s) });
    for (const j of ['modules/fightlab.js', 'modules/enchant.js', 'enchant-ui.js', 'modules/warlock.js', 'warlock-ui.js', 'pvp-ui.js', 'defaults.js', 'popup.js', 'ui-v7.js']) await page.addScriptTag({ content: read(j) });
    await page.evaluate(() => document.querySelector('nav button[data-tab="panel"]').click());
    await page.waitForTimeout(900);
    const r = await page.evaluate(() => {
      const vis = id => { const el = document.getElementById(id)?.parentElement; return !!el && getComputedStyle(el).display !== 'none'; };
      // 14.10: старый якорь кота теперь в отдельном Warlock, не дублируется в Бою.
      // 20.12 (ревизия 17.10): кот — подраздел «Боя и класса» (#tab-warlock), поле одно.
      const pa = document.querySelectorAll('#petAuto'); if (pa.length !== 1 || !(document.getElementById('tab-warlock').compareDocumentPosition(pa[0]) & 4)) throw Error('pet controls must move exactly once');
      return { cls: [...document.documentElement.classList], box: document.getElementById('clsBox').innerText, fight: document.getElementById('fightBox').innerText,
        note: document.getElementById('clsNote').innerText, nav: document.querySelector('nav button[data-tab="panel"] .lb').textContent.trim(),
        sub: Object.fromEntries(['tab-analyze', 'tab-roles', 'tab-mage', 'tab-spoil', 'tab-fighter', 'tab-fight'].map(id => [id, vis(id)])),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, dps: document.getElementById('dpsBox').innerText.slice(0, 40) };
    });
    const ok = c.cls.every(x => r.cls.includes(x)) && c.notCls.every(x => !r.cls.includes(x)) && c.shown.every(id => r.sub[id]) && c.hidden.every(id => !r.sub[id])
      && (c.id !== 'warlock' || /дополнительных убийств 2/.test(r.fight)) && r.sub['tab-analyze'] && r.sub['tab-roles'] && r.sub['tab-fight'] && c.box.test(r.box) && (!c.fight || c.fight.test(r.fight)) && /Бой и класс$/.test(r.nav) && !r.overflow && !errs.length;
    if (!ok) { console.error('FAIL', w, c.id, JSON.stringify({ r, errs }, null, 1)); process.exit(1); }
    await page.close();
  }
  console.log('PASS browser 760/375px: «⚔ Бой» — Анализ боя (класс/профиль, память боя: Verfa с ритмом спецудара), общие правила; подразделы по классу: Warlock → отдельный кот + маг в Бою, спойлер → спойл+воин, Spellsinger → маг без кота, Дестр → воин, незнакомая профессия → по ветке; без горизонтальной прокрутки');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
