// GALAXYZ (ogamex.eu, fork of 2Moons 1.8) build-page parsers. Recipes for specs/galaxyz/buildings.md.
// Primary target: the REAL fork markup (eu/pages/{buildings,research,shipyard-fleet,shipyard-defense,resources,techtree}.html).
// Fallbacks for upstream 2Moons markup are kept for the build queue (#buildlist), which no real page has shown yet.
// Every function takes a Document (live page or DOMParser result) and never throws on missing parts. No dependencies.
(function (root) {
  'use strict';

  // ---------- number / time helpers ----------
  // pretty_number(): number_format(n, 0, ',', '.') -> "1.234.567" (2Moons GeneralFunctions.php:237-240). REAL on every page.
  const num = (s) => {
    if (s == null) return 0;
    const neg = /^\s*-/.test(String(s));
    const t = String(s).replace(/[^\d]/g, '');
    return t ? (neg ? -1 : 1) * Number(t) : 0;
  };
  // pretty_time(): "[Nd ]HHh MMm SSs" (GeneralFunctions.php:191-211); unit letters are localized, so read numbers right-to-left.
  const secs = (s) => {
    if (!s) return 0;
    const n = (String(s).match(/\d+/g) || []).map(Number).reverse();
    const [s0 = 0, m0 = 0, h0 = 0, d0 = 0] = n;
    return d0 * 86400 + h0 * 3600 + m0 * 60 + s0;
  };
  const stripTitle = (t) => String(t || '').split(/<br\s*\/?>/i)[0].trim();

  // ---------- page detection (REAL: <body id="{page}">, var queryString = "page=...") ----------
  function pageInfo(doc = document, loc = (typeof location !== 'undefined' ? location : null)) {
    let qs = loc ? loc.search.replace(/^\?/, '') : '';
    if (!qs) for (const s of doc.querySelectorAll('script:not([src])')) {
      const m = s.textContent.match(/var\s+queryString\s*=\s*"([^"]*)"/);
      if (m) { qs = m[1]; break; }
    }
    const q = new URLSearchParams(qs);
    return { page: doc.body?.id || q.get('page') || 'overview', mode: q.get('mode'), cp: q.get('cp') ? +q.get('cp') : null };
  }

  // ---------- REAL list markup ----------
  /**
   * Items of page=buildings | research | shipyard (mode=fleet|defense). REAL markup:
   *  buildings: li.technology.has_details[data-technology] > button.upgrade? + div.icon.<db_key>[title][data-status?]
   *             > form.build_form#build_form<ID>[action=...page=buildings] (cmd=insert, building=<ID>) + span.level[data-value]
   *  research : li.technology.has_details#button<ID>[data-technology][title] > div.premium > div.icon.<db_key>
   *             > button.upgrade? + form#build_form<ID> (cmd=insert, tech=<ID>)? + a.detail_button[data-technology] span.level (text only)
   *  shipyard : li.technology.has_details[data-technology] > div.icon.<ID>[title][data-status?]
   *             > form#build_form<ID>[action=...page=shipyard] (cmd=insert, fmenge[<ID>]=1)? + span.level[data-value] (= amount)
   */
  function parseTechList(doc = document) {
    const out = [];
    const seen = new Set();
    for (const li of doc.querySelectorAll('#technologies ul.icons li.technology[data-technology]')) {
      const id = +li.getAttribute('data-technology');
      if (seen.has(id)) continue; seen.add(id);
      const icon = li.querySelector('div.icon');
      const lv = li.querySelector('span.level');
      const raw = lv?.getAttribute('data-value');
      const value = raw != null ? Number(raw) : num(lv?.textContent);
      const form = li.querySelector('form.build_form');
      const fields = form ? Object.fromEntries([...form.querySelectorAll('input[name]')].map((i) => [i.name, i.value])) : null;
      const off = icon?.getAttribute('data-status') === 'off' || li.getAttribute('data-status') === 'off';
      const btn = li.querySelector('button.upgrade');
      const title = icon?.getAttribute('title') || li.querySelector('a.detail_button')?.getAttribute('title') || li.getAttribute('title') || '';
      const kind = fields && 'tech' in fields ? 'research' : (fields && Object.keys(fields).some((k) => k.startsWith('fmenge[')) ? 'unit'
        : (fields && 'building' in fields ? 'building' : (id >= 100 && id < 200 ? 'research' : id >= 200 ? 'unit' : 'building')));
      out.push({
        id,
        name: stripTitle(title),
        kind,
        cssKey: icon ? [...icon.classList].find((c) => !/^(icon|sprite|sprite_medium|medium|tooltipTop|hideOthers|js_hideTipOnMobile)$/.test(c)) || null : null,
        value,                                 // level (buildings/research) or amount (ships/defense)
        requirementsMet: !off,                 // data-status="off" + title "...<br>Requirements are not met!"
        hasForm: !!form,
        canStart: kind === 'unit' ? (!!form && !off) : !!btn, // buildings/research: button.upgrade only when buyable & not busy
        reason: off ? 'requirements' : (kind !== 'unit' && !btn ? 'unavailable' : null), // unavailable = resources/busy/fields/queue (not distinguished on the list)
        form: form ? { action: form.getAttribute('action'), method: (form.getAttribute('method') || 'post').toLowerCase(), fields } : null,
      });
    }
    return out;
  }

  /** Queue box on list pages: "#technologies h3 + .bottom-side .largebox". REAL only empty so far. */
  function parseQueueBox(doc = document) {
    const box = [...doc.querySelectorAll('#technologies')].find((t) => /under construction/i.test(t.querySelector('h3')?.textContent || ''))
      || doc.querySelector('#technologies .largebox')?.closest('#technologies');
    const large = box?.querySelector('.largebox');
    if (!large) return null;
    const empty = !large.textContent.trim() && !large.querySelector('*');
    return {
      title: box.querySelector('h3')?.textContent.trim() || null,
      empty,
      // When non-empty the markup is unknown; try the generic timer conventions of the fork JS (base.js .countdown / overview.js .timer)
      timers: [...large.querySelectorAll('[data-time]')].map((e) => ({ cls: e.className, dataTime: +e.getAttribute('data-time'), text: e.textContent.trim() })),
      upstream: large.querySelector('#buildlist') ? parseUpstreamQueue(large) : null,
      html: empty ? '' : large.innerHTML,
    };
  }

  /** Overview: three .content-box-s boxes (Buildings / Research / Hangar), REAL idle state: table.construction td.idle a[href*=page=...] */
  function parseOverviewBoxes(doc = document) {
    const out = {};
    for (const box of doc.querySelectorAll('.content-box-s')) {
      const link = box.querySelector('a[href*="page="]');
      const page = link ? new URL(link.getAttribute('href'), 'https://x/').searchParams.get('page') : null;
      const key = page === 'buildings' ? 'building' : page === 'research' ? 'research' : page === 'shipyard' ? 'shipyard' : (box.querySelector('h3')?.textContent.trim() || '?');
      const idle = !!box.querySelector('td.idle');
      const t = box.querySelector('.timer[data-time], .countdown[data-time]');
      out[key] = { idle, title: box.querySelector('h3')?.textContent.trim(), text: idle ? null : box.querySelector('.content')?.textContent.replace(/\s+/g, ' ').trim(), restSeconds: t ? +t.getAttribute('data-time') : null };
    }
    return out;
  }

  /** Planet list: i.buildingIco inside a planet entry = that planet has a running building queue (inferred, see spec). */
  function planetsBuilding(doc = document) {
    return [...doc.querySelectorAll('#planetList a.planetlink')].map((a) => ({
      cp: +(new URL(a.getAttribute('href'), 'https://x/').searchParams.get('cp')),
      building: !!a.querySelector('i.buildingIco'),
    }));
  }

  /** page=resources: production % (REAL: form#resourceSettings select[name="prod[<ID>]"] value 0..10) + table rows */
  function parseResources(doc = document) {
    const settings = {};
    for (const sel of doc.querySelectorAll('select[name^="prod["]')) settings[+sel.name.match(/\d+/)[0]] = +sel.value * 10;
    const rows = [];
    for (const tr of doc.querySelectorAll('table.listOfResourceSettingsPerPlanet tr')) {
      const label = tr.querySelector('td.label')?.textContent.trim();
      if (!label) continue;
      const tds = [...tr.querySelectorAll('td')].slice(1, 5).map((td) => td.textContent.trim());
      const sel = tr.querySelector('select[name^="prod["]');
      const m = label.match(/^(.*)\s+\((\D+)\s+([\d.]+)\)$/);    // "Metal Mine (Level 38)" / "Solar Satellite (Quantity 797)"
      rows.push({ label, id: sel ? +sel.name.match(/\d+/)[0] : null, name: m ? m[1] : label, level: m ? num(m[3]) : null,
        metal: num(tds[0]), crystal: num(tds[1]), deuterium: num(tds[2]), energy: num(tds[3]), percent: sel ? +sel.value * 10 : null, rawCells: tds });
    }
    return { settings, rows };
  }

  /** page=techtree (REAL): requirement rows; ids for required elements must be mapped by name (links carry the OWNER id). */
  function parseTechtree(doc = document) {
    const items = [];
    for (const tr of doc.querySelectorAll('#tabs table tr')) {
      const a = tr.querySelector('a.main[onclick*="Dialog.info("]');
      if (!a) continue;
      const id = +a.getAttribute('onclick').match(/\((\d+)\)/)[1];
      const name = [...tr.querySelectorAll('a.main')].map((x) => x.textContent.trim()).find(Boolean) || '';
      const reqs = [...tr.querySelectorAll('td:nth-child(3) span[style*="color"]')].map((s) => {
        const m = s.textContent.match(/^(.*?)\s*\(\D*?(\d+)\s*\/\s*(\d+)\)/);
        return m && { name: m[1].trim(), have: +m[2], need: +m[3], met: /lime/i.test(s.getAttribute('style')) };
      }).filter(Boolean);
      items.push({ id, name, tab: tr.closest('[id^="tabs-"]')?.id || null, reqs });
    }
    const byName = new Map(items.map((i) => [i.name, i.id]));
    for (const it of items) for (const r of it.reqs) r.id = byName.get(r.name) ?? null;
    return items;
  }

  // ---------- details AJAX (REAL endpoints from inline JS; response body not yet seen) ----------
  const DETAILS_PAGE = { buildings: 'TechnologyDetailsAjax', research: 'ResearchDetailsAjax', shipyard: 'ShipDetailsAjax' };
  async function fetchDetails(page, id, cp) {
    const u = `game.php?page=${DETAILS_PAGE[page]}&technology=${id}${cp ? `&cp=${cp}` : ''}`;
    const r = await fetch(u, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    const json = JSON.parse(await r.text());            // page code uses $.parseJSON(data)
    const html = json.content[json.target];
    const d = new DOMParser().parseFromString(html, 'text/html');
    return { json, panels: parseForkPanels(d) };
  }
  /**
   * Details panel, inferred from the REAL fork base.js "[buildlist.js]" block (selectors it reads):
   *   #technologydetails .costs[data-tech-id][data-level][data-max][data-factor] > li.cost-item[data-res][data-base][data-have] .res-amount|.amount
   *   form.build_form[data-tech-ok][data-room-ok][data-max-reached][data-buyable][data-busy] .build-it_wrap .upgrade
   *   input#b_input_<id> | input.upgrade-input (target level)
   */
  function parseForkPanels(doc = document) {
    const out = [];
    for (const costs of doc.querySelectorAll('.costs')) {
      const card = costs.closest('#technologydetails') || costs.parentElement;
      const id = +costs.getAttribute('data-tech-id') || null;
      const forms = [...card.querySelectorAll('form.build_form')];
      const form = forms.find((f) => f.querySelector('.build-it_wrap .upgrade')) || forms[forms.length - 1] || null;
      const flag = (n) => { const v = form?.getAttribute('data-' + n); return v == null ? null : Number(v) === 1; };
      const input = (id && doc.getElementById('b_input_' + id)) || card.querySelector('input.upgrade-input, [id^="b_input_"]');
      out.push({
        id,
        level: +costs.getAttribute('data-level') || 0,
        maxLevel: +costs.getAttribute('data-max') || 255,
        factor: +costs.getAttribute('data-factor') || 1,
        cost: Object.fromEntries([...costs.querySelectorAll('li.cost-item')].map((li) => [li.getAttribute('data-res'), {
          base: +li.getAttribute('data-base') || 0,
          have: li.hasAttribute('data-have') ? +li.getAttribute('data-have') : null,
          shown: num(li.querySelector('.res-amount, .amount')?.textContent),
        }])),
        flags: { techOk: flag('tech-ok'), roomOk: flag('room-ok'), maxReached: flag('max-reached'), buyable: flag('buyable'), busy: flag('busy') },
        targetLevel: input ? +input.value : null,
        buttonDisabled: form ? !!form.querySelector('.build-it_wrap .upgrade[disabled], .build-it_wrap .upgrade.is-disabled') : null,
        form: form ? { action: form.getAttribute('action'), fields: Object.fromEntries([...form.querySelectorAll('input[name]')].map((i) => [i.name, i.value])) } : null,
      });
    }
    return out;
  }

  // ---------- UPSTREAM 2Moons markup (fallback; never seen on the fork yet) ----------
  /** #buildlist queue of page=buildings / research (2Moons templates :3-42 / :3-47). */
  function parseUpstreamQueue(scope = document) {
    const rows = [...scope.querySelectorAll('#buildlist > table > tbody > tr, #buildlist > table > tr')];
    return rows.map((tr, i) => {
      const td = tr.querySelector('td');
      const text = td.textContent.replace(/\s+/g, ' ').replace(/^\s*\d+\.:\s*/, '').trim();
      const idInput = tr.querySelector('input[name=building], input[name=tech]');
      const m = text.match(/^(.*?)\s+(\d+)(?:\s+@\s+(.*?))?(?:\s+(\S+))?$/);
      const end = tr.querySelector('.timer[data-time]');
      const doc = scope.ownerDocument || scope;
      return {
        position: i + 1,
        id: idInput ? +idInput.value : null,
        name: m ? m[1] : text, level: m ? +m[2] : null,
        planet: (text.match(/@\s+(.+)$/) || [])[1] || null,
        endUnix: end ? +end.getAttribute('data-time') : null,
        restSeconds: i === 0 ? +(doc.querySelector('#progressbar')?.getAttribute('data-time') || 0) : null,
        totalSeconds: i === 0 ? +(doc.querySelector('#time')?.getAttribute('data-time') || 0) : null,
        cancel: i === 0 ? { cmd: 'cancel' } : { cmd: 'remove', listid: i + 1 },
      };
    });
  }
  /** Upstream shipyard queue: inline `data = {"Queue":[[name,count,secsPerUnit,id],...],"b_hangar_id_plus":N,...};` */
  function parseUpstreamShipyardQueue(doc = document) {
    for (const s of doc.querySelectorAll('script:not([src])')) {
      const m = s.textContent.match(/^\s*data\s*=\s*(\{.*\}|\[\])\s*;\s*$/m);
      if (!m) continue;
      const d = JSON.parse(m[1]);
      if (Array.isArray(d) || !d.Queue) return { items: [], elapsedOnCurrent: 0, totalSeconds: 0 };
      const items = d.Queue.map(([name, count, perUnit, id], index) => ({ index, id: +id, name, count: +count, perUnitSeconds: +perUnit }));
      const total = items.reduce((a, x) => a + x.count * x.perUnitSeconds, 0) - (+d.b_hangar_id_plus || 0);
      return { items, elapsedOnCurrent: +d.b_hangar_id_plus || 0, totalSeconds: Math.max(total, 0) };
    }
    return null;
  }

  // ---------- actions: plain form POSTs, answered by 302 back to the list page. No CSRF token exists. ----------
  async function post(url, fields) {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) (Array.isArray(v) ? v : [v]).forEach((x) => body.append(k, String(x)));
    const r = await fetch(url, { method: 'POST', body, credentials: 'same-origin', redirect: 'follow' });
    return { ok: r.ok, url: r.url, html: await r.text() };   // re-rendered list page: parse it to confirm the result
  }
  const at = (page, cp, extra = '') => `game.php?page=${page}${extra}${cp ? `&cp=${cp}` : ''}`;
  const actions = {
    build:          (id, cp) => post(at('buildings', cp), { cmd: 'insert', building: id }),           // REAL form fields
    demolish:       (id, cp) => post(at('buildings', cp), { cmd: 'destroy', building: id }),          // UPSTREAM
    cancelBuilding: (cp) => post(at('buildings', cp), { cmd: 'cancel' }),                              // UPSTREAM: first queue item
    removeBuilding: (listid, cp) => post(at('buildings', cp), { cmd: 'remove', listid }),             // UPSTREAM: listid = 1-based position >= 2
    research:       (id, cp) => post(at('research', cp), { cmd: 'insert', tech: id }),                // REAL form fields
    cancelResearch: (cp) => post(at('research', cp), { cmd: 'cancel' }),                              // UPSTREAM
    removeResearch: (listid, cp) => post(at('research', cp), { cmd: 'remove', listid }),              // UPSTREAM
    units: (amounts, cp) => post(at('shipyard', cp), Object.assign({ cmd: 'insert' },                  // REAL form: fmenge[<id>]=1; any N accepted upstream
      ...Object.entries(amounts).map(([id, n]) => ({ [`fmenge[${id}]`]: Math.floor(n) })))),
    cancelUnits:    (indexes, cp) => post(at('shipyard', cp), { action: 'delete', 'auftr[]': indexes }), // UPSTREAM: 0-based queue indexes, 60% refund
    setProduction:  (pcts, cp) => post(at('resources', cp), Object.assign({ mode: 'send' },           // REAL form#resourceSettings
      ...Object.entries(pcts).map(([id, p]) => ({ [`prod[${id}]`]: Math.round(p / 10) })))),
  };

  /** UPSTREAM price formula: cost of reaching `level` (buildings/research); units: costLevel1 * amount. */
  function priceAt(el, level) {
    const out = {};
    for (const [r, v] of Object.entries(el.costLevel1)) out[r] = (el.factor && el.factor !== 1) ? Math.floor(v * Math.pow(el.factor, level - 1)) : v;
    return out;
  }

  const api = { num, secs, pageInfo, parseTechList, parseQueueBox, parseOverviewBoxes, planetsBuilding, parseResources, parseTechtree,
    fetchDetails, parseForkPanels, parseUpstreamQueue, parseUpstreamShipyardQueue, actions, priceAt, DETAILS_PAGE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GZBuild = api;
})(typeof window !== 'undefined' ? window : globalThis);
