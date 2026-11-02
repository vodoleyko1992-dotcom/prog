/* GALAXYZ / 2Moons messages recipes, variant B (spec companion of messages.md, sections 3-9).
 * NOTE: a parallel agent wrote messages-recipes.js (GZMessages.parse*). This file exposes window.GZMessagesB so both can be
 * loaded side by side; tools/run_messages_snippets.js and tools/check_messages_gz.js use THIS file.
 * Plain browser JS, no dependencies. Works on a live document, a DOMParser document, or an element/fragment
 * (the AJAX view `page=messages&mode=view` returns an HTML FRAGMENT: parse it with DOMParser, pass the doc).
 *   GZMessagesB.categories(doc)      category table: id, name, color, unread, total        [REAL messages-*.html]
 *   GZMessagesB.headerUnread(doc)    topnav unread badge                                     [REAL]
 *   GZMessagesB.list(root)           messages table: messcat, page, pages, items[]          [REAL + UPSTREAM view.tpl]
 *   GZMessagesB.classify(item)       'spy_report', 'combat_report', 'transport_own', 'expedition_ships', ...
 *   GZMessagesB.spyReport(el)        div.spyRaport -> target, resources, ships, defense, buildings, research   [REAL]
 *   GZMessagesB.combatShort(el)      div.raportMessage (combat message body)                [UPSTREAM]
 *   GZMessagesB.combatFull(doc)      page=raport popup                                      [UPSTREAM]
 *   GZMessagesB.fleetText(item)      transport / return / recycle / stay / missile / expedition / colonisation (en) [UPSTREAM]
 *   GZMessagesB.urls                 URL / POST body builders (no network here)
 */
(function (root) {
  'use strict';

  // ---------- helpers ----------
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  // pretty_number(): '.' thousands, ',' decimals; may be negative (energy). "2.684.939.750.000" -> 2684939750000
  function num(s) {
    if (s == null) return null;
    const m = String(s).replace(/[\s ]/g, '').match(/-?\d[\d.]*(?:,\d+)?/);
    return m ? parseFloat(m[0].replace(/\./g, '').replace(',', '.')) : null;
  }
  function coords(s) {
    const m = /\[\s*(\d+):(\d+):(\d+)\s*\]/.exec(s || '') || /(\d+):(\d+):(\d+)/.exec(s || '');
    return m ? [+m[1], +m[2], +m[3]] : null;
  }
  const docOf = (r) => (r && r.nodeType === 9 ? r : (r && r.ownerDocument) || document);
  const qp = (href) => { try { return new URL(href, 'https://x.invalid/').searchParams; } catch (e) { return new URLSearchParams(); } };

  // _date('d. M Y, H:i:s', ts, USER timezone) e.g. "30. Oct 2026, 09:53:36". Month names follow the user language:
  // read them from the page's `var months = [...]` when available, else en/de/ru fallbacks.
  const MONTHS = ['jan|янв|jän', 'feb|фев', 'mar|мар|mär|mrz', 'apr|апр', 'may|май|mai', 'jun|июн', 'jul|июл', 'aug|авг',
    'sep|сен', 'oct|окт|okt', 'nov|ноя', 'dec|дек|dez'];
  function pageMonths(doc) {
    const src = [...(doc.scripts || [])].map((s) => s.textContent).join('\n');
    const m = src.match(/var\s+months\s*=\s*\[([^\]]*)\]/);
    return m ? m[1].split(',').map((x) => x.trim().replace(/^["']|["']$/g, '').toLowerCase()) : null;
  }
  function parseTdDate(s, months) {
    const m = /(\d{1,2})\.\s*([^\s\d.,]+)\.?\s+(\d{4}),?\s+(\d{1,2}):(\d{2}):(\d{2})/.exec(s || '');
    if (!m) return null;
    const mon = m[2].toLowerCase();
    let mi = months ? months.indexOf(mon) : -1;
    if (mi < 0) mi = MONTHS.findIndex((alts) => alts.split('|').some((a) => mon.startsWith(a)));
    if (mi < 0) return null;
    // wall clock of the USER timezone, stored as if it were UTC (same convention as layout serverTime)
    return { text: m[0], wall: Date.UTC(+m[3], mi, +m[1], +m[4], +m[5], +m[6]) };
  }

  // ---------- categories [REAL] ----------
  // td > a[onclick="Message.getMessages(N);return false;"] NAME <br> span#unread_N / span#total_N
  function categories(doc) {
    doc = docOf(doc);
    return [...doc.querySelectorAll('span[id^="total_"]')].map((t) => {
      const id = +t.id.slice(6), td = t.closest('td');
      const a = td && td.querySelector('a[onclick*="getMessages"]');
      const u = doc.getElementById('unread_' + id);
      return { id, name: txt(a), color: td ? td.style.color || null : null, unread: u ? +txt(u) : null, total: +txt(t) };
    });
  }
  function headerUnread(doc) {
    const el = docOf(doc).querySelector('.messages-section .new-msg-count');
    return el ? +txt(el) || 0 : 0;
  }

  // ---------- list [REAL + UPSTREAM page.messages.view.tpl] ----------
  function list(rootEl) {
    const d = docOf(rootEl), scope = rootEl && rootEl.querySelector ? rootEl : d;
    const table = scope.querySelector('table#messagestable');   // unique; the full page may hold a 2nd EMPTY form (see spec)
    if (!table) return null;
    const form = table.closest('form');
    const fv = (n) => { const i = form && form.querySelector('input[name="' + n + '"]'); return i ? i.value : null; };
    const messcat = +fv('messcat');
    // pager: td.right "Page: [1] ..." (top and bottom; the bottom one's « » point to first/last)
    const pagerLinks = [...table.querySelectorAll('td.right a[onclick*="getMessages"]')];
    const pageNums = pagerLinks.map((a) => +((a.getAttribute('onclick').match(/getMessages\(\s*\d+\s*,\s*(\d+)/) || [])[1] || 0));
    const cur = pagerLinks.find((a) => a.querySelector('b'));
    const page = cur ? +(txt(cur).match(/\d+/) || [fv('side')])[0] : +fv('side') || 1;
    const months = pageMonths(d);
    const items = [...table.querySelectorAll('tr.message_head[id^="message_"]')].map((tr) => {
      const id = +tr.id.slice(8), tds = tr.children;
      const body = tr.nextElementSibling && tr.nextElementSibling.classList.contains('messages_body')
        ? tr.nextElementSibling.querySelector('td') : null;
      const subjCell = tds[3];
      const reply = subjCell && subjCell.querySelector('a[onclick*="Dialog.PM("]');
      const subject = subjCell ? [...subjCell.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').replace(/\s+/g, ' ').trim() : '';
      const date = parseTdDate(txt(tds[1]), months);
      return {
        id, unread: tr.classList.contains('mes_unread'), checkbox: !!tr.querySelector('input[name="messageID[' + id + ']"]'),
        date: txt(tds[1]), wall: date ? date.wall : null, from: txt(tds[2]), subject,
        senderId: reply ? +(reply.getAttribute('onclick').match(/PM\((\d+)/) || [])[1] : null,
        messcat, body,
      };
    });
    return { messcat, page, pages: Math.max(page, ...pageNums, 1), outbox: messcat === 999,
      actions: [...(form ? form.querySelectorAll('select[name="actionTop"] option') : [])].map((o) => o.value), items };
  }

  // ---------- classify ----------
  // Structure first (language independent), then en texts, then the category (when listing one category).
  const TEXT_KEYS = [
    ['spy_activity', /^A hostile fleet of the planet /],
    ['missile', /^Interplanetary rockets \(\d+\) from /],
    ['attack_return', /^One of your fleets returns from a attack at the planet /],
    ['recycle', /^Having arrived at there destination your Recyclers collect /],
    ['transport_own', /^One of your fleets reaches the planet .* and delivers /],
    ['transport_foreign', /^A peaceful fleet of .* reached .* and delivers /],
    ['fleet_return', /^One of your fleets returns from the planet /],
    ['stay', /^Your fleet reaches the planet .* and delivers /],
    ['expedition_back_home', /^Your fleet has returned from the expedition\./],
    ['colonisation_ok', /^One of your fleets reaches the coordinates .*The settlers start to colonise/],
    ['colonisation_fail', /^One of your fleets reache[sd] the coordinates /],
  ];
  // sys_expe_* texts (language/en/FLEET.php:84-157): sentence fragments -> outcome (first match wins)
  const EXPE = [
    ['ships', /spaceships which were in perfect condition|remains of a predecessor expedition|deserted pirate base|almost completly destroyed by wars|old starbase|remains of an armada|automatic shipyard|gigantic ship cemetery|remains of a civilization/],
    ['resources', /asteroids cluster|easily accessible resource fields|contaminated by radiation|ancient freighter convoy|raw material deposits on a little moon|small convoy of civilian ships|gigantic alien shipwreck|asteroid belt around an unknown planet|planet rich in raw materials/],
    ['darkmatter', /dark matter/i],
    ['lost', /radio message: Zzzrrt|close-ups of an opening black hole|nuclear breach|has not returned from the hyperspacejump|black hole and was destroyed completely/],
    ['blackhole_partial', /black hole and was partly destroyed/],
    ['delay', /miscalculation of the navigator|missed it`s target|new navigation module|amplified particle storms|collided with a strange ship|star wind of a red giant/],
    ['early', /unforeseen relay|unstable wormhole|got into a solar wind/],
    ['pirates', /pirate|barbarians|Moa Tikarr/i],
    ['aliens', /aliens?\b|unknown ships|unknown specie|alien invasion|crystalline ships|aggressors could not be identified|strange ships have attacked/i],
    ['nothing', /.*/],
  ];
  function classify(item) {
    const b = item.body;
    if (b && b.querySelector('.spyRaport')) return 'spy_report';
    if (b && b.querySelector('.raportMessage')) return 'combat_report';
    if (item.senderId) return 'player_message';
    const t = txt(b);
    for (const [k, re] of TEXT_KEYS) if (re.test(t)) return k;
    if (item.messcat === 15 || /^Expedition report$/.test(item.subject)) {
      for (const [k, re] of EXPE) if (re.test(t)) return 'expedition_' + k;
    }
    return { 0: 'spy_other', 1: 'player_message', 2: 'alliance_message', 3: 'combat_other', 4: 'system', 5: 'transport_other',
      15: 'expedition_other', 50: 'game', 99: 'construction' }[item.messcat] || 'unknown';
  }

  // ---------- spy report [REAL messages-spy.html, UPSTREAM shared.mission.spyReport.tpl] ----------
  const SECTION = { 900: 'resources', 200: 'ships', 400: 'defense', 0: 'buildings', 100: 'research' };
  const RES_KEY = { 901: 'metal', 902: 'crystal', 903: 'deuterium', 911: 'energy' };
  // names: optional { 'Light Cargo': 202, ... } used only when the Simulate link is missing
  function spyReport(el, names) {
    const sr = el && (el.matches && el.matches('.spyRaport') ? el : el.querySelector('.spyRaport'));
    if (!sr) return null;
    const head = sr.querySelector('.spyRaportHead a');
    const title = txt(head);
    // sys_mess_head 'Spy Report %s [%d:%d:%d] on %s' (localized prefix/word; the name may contain anything)
    const hm = /^(.*)\[(\d+):(\d+):(\d+)\]\s*(.*)$/.exec(title) || [];
    const rd = parseTdDate(hm[5] || '');
    const sim = sr.querySelector('.spyRaportFooter a[href*="battleSimulator"]');
    const simList = sim ? [...qp(sim.getAttribute('href')).entries()].filter(([k]) => /^im\[\d+\]$/.test(k))
      .map(([k, v]) => [+k.slice(3, -1), +v]) : [];
    let si = 0, simOk = true;
    const out = { title, target: { name: hm[1] ? hm[1].replace(/^Spy Report\s+/i, '').trim() : null,
      coords: hm[2] ? [+hm[2], +hm[3], +hm[4]] : null },
      reportDate: rd ? rd.text : null, reportWall: rd ? rd.wall : null,
      resources: null, ships: null, defense: null, buildings: null, research: null, exact: {} };
    for (const c of sr.querySelectorAll('.spyRaportContainer')) {
      const h = c.querySelector('.spyRaportContainerHead');
      const cls = +((h && h.className.match(/spyRaportContainerHeadClass(\d+)/)) || [])[1];
      // ONLY this container's own cells: an odd element count leaves a row open, so the NEXT section and the footer are
      // nested inside this container (REAL report 1: footer inside the ships container).
      const cells = [...c.querySelectorAll('.spyRaportContainerCell')].filter((x) => x.closest('.spyRaportContainer') === c);
      const sec = {};
      for (let i = 0; i + 1 < cells.length; i += 2) {
        const name = txt(cells[i]), shown = num(txt(cells[i + 1]));
        let id = null, exact = shown;
        if (si < simList.length) { [id, exact] = simList[si++]; } else { simOk = simList.length === 0 && simOk; id = names ? names[name] ?? null : null; }
        if (cls === 900) { sec[RES_KEY[id] || name] = shown; out.exact[id || name] = exact; }
        else sec[id != null ? id : name] = shown;
      }
      if (SECTION[cls]) out[SECTION[cls]] = sec;
    }
    if (si !== simList.length) simOk = false;
    out.simulateMatches = sim ? simOk : null;   // false -> ids are unreliable (GALAXYZ changed the template?)
    // revealed sections are rendered, hidden ones are ABSENT (thresholds: ships < defense < buildings < research)
    out.known = { ships: !!out.ships, defense: !!out.defense, buildings: !!out.buildings, research: !!out.research };
    const foot = sr.querySelector('.spyRaportFooter');
    const ft = txt(foot);
    const ch = ft.match(/(-?\d+)\s*%/);
    out.probesDestroyed = !!(foot && foot.querySelector('font[color="red"]'));
    out.counterEspionage = ch ? +ch[1] : null;
    const atk = foot && foot.querySelector('a[href*="target_mission=1"]');
    if (atk) {
      const q = qp(atk.getAttribute('href'));
      out.attackParams = { galaxy: +q.get('galaxy'), system: +q.get('system'), planet: +q.get('planet'), planettype: +q.get('planettype') };
      out.target.planetType = out.attackParams.planettype;   // 1 planet, 3 moon
    }
    out.simulateHref = sim ? sim.getAttribute('href') : null;
    return out;
  }

  // ---------- combat message body [UPSTREAM MissionCaseAttack.class.php:51-70, MissionCaseExpedition.class.php:220-239] ----------
  function combatShort(el) {
    const r = el && (el.matches && el.matches('.raportMessage') ? el : el.querySelector('.raportMessage'));
    if (!r) return null;
    // attack/ACS/moon destruction link game.php?page=raport&raport=<md5>; expedition battles link CombatReport.php?raport=<md5>
    const a = r.querySelector('a[href*="raport="]');
    const head = a && a.querySelector('span');
    const resultClass = head ? (head.className.match(/raport(Win|Lose|Draw)/) || [])[1] : null;   // from MY side
    const rows = r.querySelectorAll('tr');
    const lossSpans = rows[1] ? rows[1].querySelectorAll('td:nth-child(2) > span') : [];
    const n = (sel) => { const x = r.querySelector(sel); return x ? num(txt(x)) : null; };
    return {
      reportId: a ? qp(a.getAttribute('href')).get('raport') : null,
      expedition: !!(a && /CombatReport\.php/i.test(a.getAttribute('href'))),
      url: a ? a.getAttribute('href') : null,
      result: resultClass ? resultClass.toLowerCase() : null,   // win | lose | draw
      coords: coords(txt(head)), planetTypeShort: ((txt(head).match(/\]\s*\(([^)]*)\)\s*$/) || [])[1]) || null,
      losses: { attacker: lossSpans[0] ? num(txt(lossSpans[0]).split(':').pop()) : null,
        defender: lossSpans[1] ? num(txt(lossSpans[1]).split(':').pop()) : null },
      // class reportSteal/reportDebris (MissionCaseAttack) but raportSteal/raportDebris (MissionCaseExpedition)
      loot: { metal: n('.reportSteal.element901,.raportSteal.element901'), crystal: n('.reportSteal.element902,.raportSteal.element902'),
        deuterium: n('.reportSteal.element903,.raportSteal.element903') },
      debris: { metal: n('.reportDebris.element901,.raportDebris.element901'), crystal: n('.reportDebris.element902,.raportDebris.element902') },
    };
  }

  // ---------- combat report popup [UPSTREAM shared.mission.raport.tpl] ----------
  function combatFull(doc) {
    doc = docOf(doc);
    const box = doc.querySelector('#content > div[style*="text-align"]') || doc.body;
    const all = txt(box);
    // one td per player block: its first child is the text node "Attacker NAME ([g:s:p] (P))"
    const sides = [...box.querySelectorAll('td')].filter((td) => td.firstChild && td.firstChild.nodeType === 3 &&
      /\(\[[\dX]+:[\dX]+:[\dX]+\]/.test(td.firstChild.textContent));   // battle hall prints [XX:XX:XX]
    const players = sides.map((td) => {
      const head = td.firstChild.textContent.replace(/\s+/g, ' ').trim();
      const m = /^(\S+)\s+(.*?)\s+\(\[(\d+|XX):(\d+|XX):(\d+|XX)\](?:\s*\((\w*)\))?\)/.exec(head) || [];   // "(P)", "(M)" or "()"
      const t = txt(td).match(/(\d+)%\D+(\d+)%\D+(\d+)%/) || [];
      const tb = td.querySelector('table'), ships = {};
      if (tb && tb.rows.length >= 2) {
        const names = [...tb.rows[0].cells].slice(1).map(txt), amounts = [...tb.rows[1].cells].slice(1).map((c) => num(txt(c)));
        names.forEach((nm, i) => { ships[nm] = amounts[i]; });
      }
      return { role: m[1] === 'Attacker' ? 'attacker' : m[1] === 'Defender' ? 'defender' : m[1], name: m[2] || null,
        coords: m[3] && m[3] !== 'XX' ? [+m[3], +m[4], +m[5]] : null, planetTypeShort: m[6] || null,
        tech: t[1] ? [+t[1], +t[2], +t[3]] : null, ships, destroyed: !tb || tb.rows.length < 2 };
    });
    const rounds = [];
    for (const p of players) {
      let r = rounds[rounds.length - 1];
      if (!r || (p.role === 'attacker' && r.defender.length)) rounds.push(r = { attacker: [], defender: [] });
      if (r[p.role]) r[p.role].push(p);
    }
    const after = (label) => { const m = all.match(new RegExp(label + '\\s*([\\d.]+)')); return m ? num(m[1]) : null; };
    const loot = all.match(/He captures ([\d.]+) \S+, ([\d.]+) \S+ and ([\d.]+)/);
    const debris = all.match(/At the coordinates are now:\s*([\d.]+) \S+ and ([\d.]+)/);
    const moon = all.match(/Moon Chance:\s*(\d+)\s*%/);
    return {
      time: (all.match(/(\d{1,2}\. \S+ \d{4}, \d{2}:\d{2}:\d{2})/) || [])[1] || null,
      result: /attacker has won/.test(all) ? 'attacker' : /defender has won/.test(all) ? 'defender' : /draw/.test(all) ? 'draw' : null,
      rounds, loot: loot ? { metal: num(loot[1]), crystal: num(loot[2]), deuterium: num(loot[3]) } : null,
      lostUnits: { attacker: after('The attackers losses:'), defender: after('The defenders losses:') },
      debris: debris ? { metal: num(debris[1]), crystal: num(debris[2]) } : null,
      moonChance: moon ? +moon[1] : null, moonBuilt: /A moon formed at the planet/.test(all),
      notFound: /Invalid Battle Report ID|contact to the attacking fleet was lost/.test(all),
    };
  }

  // ---------- fleet texts [UPSTREAM language/en/FLEET.php + MissionCase*.class.php] ----------
  // Resources are printed by pretty_number() next to localized names; read "NUMBER NAME" or "NAME NUMBER" pairs
  // (sys_expe_back_home passes NAME first: "It deliveres Metal 812.000, ...").
  function resPairs(t) {
    const out = {}, NAMES = { Metal: 'metal', Crystal: 'crystal', Deuterium: 'deuterium', 'Dark Matter': 'darkmatter' };
    for (const m of t.matchAll(/([\d.]+)\s+(Metal|Crystal|Deuterium|Dark Matter)\b/g)) out[NAMES[m[2]]] = num(m[1]);
    for (const m of t.matchAll(/\b(Metal|Crystal|Deuterium|Dark Matter)\s+([\d.]+)/g)) if (!(NAMES[m[1]] in out)) out[NAMES[m[1]]] = num(m[2]);
    return out;
  }
  function fleetText(item) {
    const b = item.body, t = txt(b), key = item.key || classify(item);
    const links = b ? [...b.querySelectorAll('a[href*="page=galaxy"]')].map((a) => coords(txt(a))) : [];
    const out = { key, text: t, coords: links.length ? links : (coords(t) ? [coords(t)] : []), resources: resPairs(t) };
    if (key === 'missile' && b) {
      // sys_irak_mess + sys_irak_def|no_att|no_def + "<br>NAME (- N)" per destroyed defence (MissionCaseMIP.class.php:86-147)
      out.missiles = num((t.match(/^Interplanetary rockets \((\d+)\)/) || [])[1]);
      const ic = t.match(/(\d+) Rockets of yours were intercepted/);
      out.intercepted = ic ? +ic[1] : /All your rockets were intercepted/.test(t) ? out.missiles : 0;
      out.destroyedByName = {};
      for (const seg of b.innerHTML.split(/<br\s*\/?>/i)) {        // textContent glues "<br>" segments together
        const m = /^\s*([^<>()]+?)\s*\(-\s*([\d.]+)\)\s*$/.exec(seg);
        if (m) out.destroyedByName[m[1]] = num(m[2]);
      }
    }
    if (key === 'expedition_ships' && b) {
      // "<br>Light Cargo: 1.200<br>Cruiser: 35" (MissionCaseExpedition.class.php:203)
      out.shipsByName = {};
      for (const m of b.innerHTML.split(/<br\s*\/?>/i).slice(1).join('\n').matchAll(/^\s*([^:<\n]+):\s*([\d.]+)\s*$/gm)) out.shipsByName[m[1].trim()] = num(m[2]);
      out.noShipsFound = /No ships could be found/.test(t);   // sys_expe_found_ships_nothing
    }
    return out;
  }

  // ---------- URLs (relative to location.origin + location.pathname, i.e. .../Aeternum/game.php) ----------
  const urls = {
    page: (category, side) => 'game.php?page=messages' + (category != null ? '&category=' + category + '&side=' + (side || 1) : ''),
    // AJAX list (Message.getMessages): HTML fragment. SIDE EFFECT: marks the listed messages as read (except 999).
    view: (messcat, site) => 'game.php?page=messages&mode=view&messcat=' + messcat + '&site=' + (site || 1) + '&ajax=1',
    // POST body for the action form; send only on an explicit user click. Response: 302 to page=messages&category=..
    actionBody: (action, messcat, ids) => {
      const p = new URLSearchParams({ mode: 'action', ajax: '1', messcat: String(messcat), side: '1', actionTop: action, submitTop: 'Confirm' });
      (ids || []).forEach((id) => p.append('messageID[' + id + ']', '1'));
      return p.toString();
    },
    raport: (id) => 'game.php?page=raport&raport=' + id,
    write: (userId, subject) => 'game.php?page=messages&mode=write&id=' + userId + (subject ? '&subject=' + encodeURIComponent(subject) : ''),
  };

  root.GZMessagesB = { txt, num, coords, parseTdDate, pageMonths, categories, headerUnread, list, classify, spyReport,
    combatShort, combatFull, fleetText, urls, SECTION };
})(typeof window !== 'undefined' ? window : globalThis);
