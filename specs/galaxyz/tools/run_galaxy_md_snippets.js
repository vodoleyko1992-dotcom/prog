// Runs the copy-paste recipes of specs/galaxyz/galaxy.md against the REAL saved pages
// (eu/pages/galaxy.html, eu/pages/tournament.html) in Chromium with page JS disabled.
// Usage: node specs/galaxyz/tools/run_galaxy_md_snippets.js   (needs require('playwright'))
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const PAGES = path.resolve(__dirname, '../../../../eu/pages');

// ---- recipes (copied verbatim into galaxy.md) ----
const RECIPES = String.raw`
// number "1.234.567" / "102" / "-27" -> 1234567 / 102 / -27 (GALAXYZ uses "." as thousands separator)
const gzInt = (s) => { const m = String(s || '').match(/-?\d[\d.]*/); return m ? parseInt(m[0].replace(/\./g, ''), 10) : null; };
const gzText = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
// tooltip HTML lives in the title attribute (Tipped/new_tooltip.js), older widgets use data-tooltip-content
const gzTip = (el) => {
  const html = el ? (el.getAttribute('title') || el.getAttribute('data-tooltip-content') || '') : '';
  return new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
};
// parse any game href (absolute after "Save page as", relative "?page=" / "game.php?page=" live)
const gzParams = (href) => new URLSearchParams(String(href || '').replace(/^[^?]*\?/, '').replace(/#.*$/, ''));

function gzGalaxyHeader(doc) {
  const form = doc.querySelector('form#galaxy_form');
  const info = doc.querySelector('#galaxytableHead tr.info_header');
  const pick = (re) => { const m = gzText(info).match(re); return m ? gzInt(m[1]) : null; };
  const slots = gzText(doc.querySelector('#slotValue')).match(/(\d+)\s*\/\s*(\d+)/);
  return {
    galaxy: gzInt(form && form.elements.galaxy.value),
    system: gzInt(form && form.elements.system.value),
    probes: pick(/([\d.]+)\s+Spy Probes/),
    recyclers: pick(/([\d.]+)\s+Recycler(?!\w)/),
    gigaRecyclers: pick(/([\d.]+)\s+Giga Recycler/),
    missiles: pick(/([\d.]+)\s+Available Missiles/),
    slotsUsed: slots ? +slots[1] : null,
    slotsMax: slots ? +slots[2] : null,
    existingPlanets: gzInt(gzText(doc.querySelector('#colonized'))),
    expeditionHref: (doc.querySelector('#expeditionbutton a') || {}).href || null,
  };
}

function gzGalaxyRows(doc) {
  const rows = [...doc.querySelectorAll('#galaxytableHead > tbody > tr.row')];
  return rows.map((tr, i) => {
    const posCell = tr.querySelector('td.position');
    const position = gzInt(gzText(posCell)) || i + 1;
    const planetCell = tr.querySelector('td[class^="microplanet"]');
    if (!planetCell) {                                     // free slot: colonize link + fields/temperature hint
      const a = posCell && posCell.querySelector('a[href*="target_mission=7"]');
      const t = a ? (a.getAttribute('title') || '') : '';
      const f = t.match(/fields:\s*(\d+)-(\d+)/i);
      const c = t.match(/(-?\d+)°C\s*to\s*(-?\d+)°C/i);
      return { position, empty: true, colonizeHref: a ? a.getAttribute('href') : null,
        fieldsMin: f ? +f[1] : null, fieldsMax: f ? +f[2] : null, tempMin: c ? +c[1] : null, tempMax: c ? +c[2] : null };
    }
    const pTip = gzTip(planetCell.querySelector('a'));
    const links = [...pTip.querySelectorAll('ul.ListLinks a')].map((a) => {
      const href = a.getAttribute('href') || '';
      const doit = href.match(/doit\((\d+)\s*,\s*(\d+)/);            // upstream one-click: doit(6|8, planetId)
      const q = gzParams(href);
      return { label: gzText(a), href, mission: doit ? +doit[1] : gzInt(q.get('target_mission')),
        planetId: doit ? +doit[2] : null, planettype: gzInt(q.get('planettype')) };
    });
    const nameCell = tr.querySelector('td[class^="planetname"]');
    const nameRaw = gzText(nameCell);
    const act = nameRaw.match(/\((\*|\d+\s*min)\)\s*$/);
    const playerA = tr.querySelector('td.playername a');
    const userSpan = tr.querySelector('td.playername .galaxy-username');
    const plTip = gzTip(playerA);
    const pcard = (playerA && playerA.getAttribute('title') || '').match(/Playercard\((\d+)/);
    const rank = plTip.querySelector('li.rank');
    const flags = userSpan ? [...userSpan.classList].filter((c) => c.startsWith('galaxy-username-')).map((c) => c.slice(16)) : [];
    const short = [...tr.querySelectorAll('td.playername .galaxy-short')].map(gzText);
    const ally = tr.querySelector('td.allytag .galaxy-alliance');
    const debrisTip = gzTip(tr.querySelector('td.debris a'));
    const dbTxt = gzText(debrisTip.body);
    const dm = dbTxt.match(/Metal:?\s*([\d.]+)/i), dc = dbTxt.match(/Crystal:?\s*([\d.]+)/i);
    return {
      position, empty: false,
      coords: gzText(pTip.querySelector('#pos-planet')) || null,
      planetName: nameRaw.replace(/\s*\((\*|\d+\s*min)\)\s*$/, ''),
      activity: act ? (act[1] === '*' ? 0 : gzInt(act[1])) : null,          // 0 = <15 min, N = N min, null = >=60 min
      planetImg: (pTip.querySelector('img.planetTooltip') || {}).className || null,
      missions: links.filter((l) => l.mission != null),
      player: userSpan ? gzText(userSpan) : null,
      playerId: pcard ? +pcard[1] : null,
      rank: rank ? gzInt(gzText(rank)) : null,
      statsHref: (plTip.querySelector('a[href*="page=statistics"]') || { getAttribute: () => null }).getAttribute('href'),
      flags, short,
      own: !!userSpan && !flags.length && links.some((l) => l.mission === 4),
      moon: !!tr.querySelector('td.moon a, td.moon img'),
      debris: dm || dc ? { metal: dm ? gzInt(dm[1]) : 0, crystal: dc ? gzInt(dc[1]) : 0 } : (tr.querySelector('td.debris a, td.debris img') ? {} : null),
      ally: ally ? gzText(ally) : (gzText(tr.querySelector('td.allytag')) || null),
      actions: [...tr.querySelectorAll('td.action a')].map((a) => a.getAttribute('href') + ' ' + (a.getAttribute('onclick') || '')),
    };
  });
}

function gzTournament(doc) {
  const out = { endsInSec: gzInt((doc.querySelector('.countdown2') || { getAttribute: () => null }).getAttribute('secs')), boards: [] };
  doc.querySelectorAll('div.ach_content_box[id^="skils"]').forEach((box) => {
    const n = box.id.replace('skils', '');
    const menu = doc.querySelector('.ach_menu li.skils' + n + ' a');
    const rows = [...box.querySelectorAll('tr')].filter((tr) => tr.querySelector('span.ticket_row_linck_id')).map((tr) => {
      const a = tr.querySelector('span.ticket_row_linck_subject a');
      const m = (a && a.getAttribute('onclick') || '').match(/Playercard\((\d+)/);
      return { pos: gzInt(gzText(tr.querySelector('.ticket_row_linck_id'))), playerId: m ? +m[1] : null,
        name: gzText(a), points: gzInt(gzText(tr.querySelector('.ticket_row_linck_status'))) };
    });
    out.boards.push({ id: box.id, tab: gzText(menu), title: gzText(box.querySelector('center b')),
      prizes: [...box.querySelectorAll('.record_name_utits')].map(gzText), rows });
  });
  return out;
}
`;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ javaScriptEnabled: false });
  const p = await ctx.newPage();
  await p.route('**/*', (r) => r.abort());
  const run = async (file, expr) => {
    await p.setContent(fs.readFileSync(path.join(PAGES, file), 'utf8'), { waitUntil: 'domcontentloaded' });
    return p.evaluate(RECIPES + ';' + expr);
  };
  const out = {};
  out.header = await run('galaxy.html', 'JSON.stringify(gzGalaxyHeader(document))');
  const rows = JSON.parse(await run('galaxy.html', 'JSON.stringify(gzGalaxyRows(document))'));
  out.rowCount = rows.length;
  out.row1 = rows[0];
  out.row5 = rows[4];
  out.row6 = rows[5];
  out.dupIds = await run('galaxy.html', `JSON.stringify(['recycler','planetList','pos-planet','player'].map(id => id + ':' + document.querySelectorAll('[id="' + id + '"]').length))`);
  const t = JSON.parse(await run('tournament.html', 'JSON.stringify(gzTournament(document))'));
  out.tournament = { endsInSec: t.endsInSec, boards: t.boards.map((x) => ({ id: x.id, tab: x.tab, title: x.title, prizes: x.prizes, n: x.rows.length, first: x.rows[0], me: x.rows.find((r) => r.playerId === 4377) })) };
  if (process.argv[2] === '--recipes') console.log(RECIPES); else console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
