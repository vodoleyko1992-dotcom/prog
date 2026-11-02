/*
 * Reference parsing recipes for OgameX messages (see specs/messages.md).
 * Plain ES2020, DOM only, no dependencies. Verified by tools/check_messages.js
 * against fixtures/messages-*.html; expected output: fixtures/messages-expected-parse.json.
 *
 * Module authors: copy what you need into your module (window.OGX namespace).
 * Every function takes a Document or Element produced by DOMParser from the raw
 * HTML of the endpoint (never insert it into the live page: it contains <script>s).
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ numbers
  /** "1,468,279" -> 1468279 (AppUtil::formatNumber, also formatNumberLong below 1Mn). */
  function intFull(s) {
    const m = String(s).replace(/\s+/g, '').match(/^-?[\d,.]+/);
    if (!m) return null;
    return parseInt(m[0].replace(/[,.]/g, ''), 10);
  }
  /**
   * Lossy display formats -> approximate number.
   * formatNumberLong: "1.468Mn" | "2Mn" | "500,451" | "999"
   * formatNumberShort: "107K" | "5,5K" (decimal comma!) | "3Mn" | "999"
   */
  function intApprox(s) {
    s = String(s).trim();
    let m;
    if ((m = s.match(/^(-?\d+(?:[.,]\d+)?)Mn$/))) return Math.round(parseFloat(m[1].replace(',', '.')) * 1e6);
    if ((m = s.match(/^(-?\d+(?:,\d+)?)K$/))) return Math.round(parseFloat(m[1].replace(',', '.')) * 1e3);
    return intFull(s);
  }
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const COORDS_RE = /\[(\d+):(\d+):(\d+)\]/;
  function coordsOf(s) { const m = String(s).match(COORDS_RE); return m ? [+m[1], +m[2], +m[3]] : null; }
  /** "30.10.2026 00:41:05" (d.m.Y H:i:s, APP_TIMEZONE, default UTC) -> epoch ms (assumes UTC). */
  function msgDate(s) {
    const m = String(s).match(/(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})/);
    return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]) : null;
  }

  // ------------------------------------------------------------------ planet links
  /**
   * A [planet]id[/planet] placeholder renders as
   *   <a href="/galaxy?galaxy=G&system=S&position=P" class="txt_link"><img ... title="Planet"> NAME [G:S:P]</a>     (planet)
   *   <a ... class="txt_link"><figure class="planetIcon moon ..." title="Moon"></figure> NAME [G:S:P]</a>          (moon)
   * [coordinates]G:S:P[/coordinates] -> <a ...><figure class="planetIcon planet ..."></figure> [G:S:P]</a>
   * [debrisfield]G:S:P[/debrisfield] -> <a ...><figure class="planetIcon tf ..."></figure> debris field [G:S:P]</a>
   */
  function parsePlaceLink(a) {
    if (!a) return null;
    const coords = coordsOf(a.textContent);
    const fig = a.querySelector('figure.planetIcon');
    let type = 'planet';
    if (fig && fig.classList.contains('moon')) type = 'moon';
    else if (fig && fig.classList.contains('tf')) type = 'debris';
    else if (fig && fig.classList.contains('planet')) type = 'coordinates';
    const name = txt(a).replace(COORDS_RE, '').replace(/^debris field\s*/, '').trim() || null;
    return { coords, type, planetType: type === 'moon' ? 3 : type === 'debris' ? 2 : 1, name };
  }

  // ------------------------------------------------------------------ list items
  /** All messages of a subtab response (GET /ajax/messages?tab=..&subtab=..). */
  function parseMessageList(doc) {
    const items = [...doc.querySelectorAll('li.msg[data-msg-id]')];
    const cur = txt(doc.querySelector('ul.pagination li.curPage')).match(/(\d+)\/(\d+)/);
    return {
      page: cur ? +cur[1] : 1,
      totalPages: cur ? +cur[2] : 1,
      messages: items.map((li) => ({
        id: parseInt(li.dataset.msgId, 10),
        unread: li.classList.contains('msg_new'),
        title: txt(li.querySelector('.msg_head .msg_title')),
        titleClass: (li.querySelector('.msg_head .msg_title') || { className: '' }).className.replace('msg_title', '').trim(),
        date: txt(li.querySelector('.msg_head .msg_date')),
        ts: msgDate(txt(li.querySelector('.msg_head .msg_date'))),
        from: txt(li.querySelector('.msg_head .msg_sender')),
        detailsUrl: (li.querySelector('message-footer-details a.overlay') || {}).getAttribute
          ? li.querySelector('message-footer-details a.overlay').getAttribute('href') : null,
      })),
    };
  }

  // ------------------------------------------------------------------ classification
  /** Expedition texts table: fixtures/messages-expedition-texts.json (`texts`). */
  const norm = (s) => String(s).replace(/<br\s*\/?>/g, ' ').replace(/\s+/g, ' ').trim();
  function buildExpeditionIndex(textsJson) {
    const idx = new Map(); // normalized first paragraph -> [{key, variation, locale}]
    for (const [loc, keys] of Object.entries(textsJson.texts)) {
      for (const [key, vars] of Object.entries(keys)) {
        if (key.startsWith('_')) continue;
        for (const [vid, t] of Object.entries(vars)) {
          const k = norm(t);
          if (!idx.has(k)) idx.set(k, []);
          idx.get(k).push({ key, variation: +vid, locale: loc });
        }
      }
    }
    return idx;
  }

  /**
   * key detection for one li.msg. `subtab` = the subtab you requested
   * (espionage|combat_reports|expeditions|transport|other|economy|universe|...).
   * Language-independent where the markup allows it; text rules are for the en locale.
   */
  function classify(li, subtab, expIndex) {
    const c = li.querySelector('.msg_content');
    const body = txt(c);
    const title = txt(li.querySelector('.msg_title'));
    switch (subtab) {
      case 'espionage':
        return c.querySelector('.compacting') ? 'espionage_report' : 'espionage_detected';
      case 'combat_reports':
        if (c.querySelector('.combatInfo')) return 'battle_report';
        if (/^\d+ missiles? from your planet /.test(body)) return 'missile_attack_report'; // hard-coded English in PHP
        if (/^Your planet .* has been attacked by interplanetary missiles from /.test(body)) return 'missile_defense_report';
        if (li.querySelector('.msg_title.blue_txt')) return 'fleet_lost_contact'; // only non-middlemark title in this subtab
        return 'moon_destruction'; // moon_destruction_* / moon_destroyed: tell apart by subject text
      case 'expeditions': {
        const first = norm(c.innerHTML.split(/<br\s*\/?>\s*<br\s*\/?>/)[0].replace(/<[^>]+>/g, ''));
        const hit = expIndex && expIndex.get(first);
        if (!hit) return 'expedition_unknown';
        // body texts shared by expedition_battle / _pirates / _aliens all mean "battle"
        const keys = [...new Set(hit.map((h) => h.key))];
        if (keys.length === 1) return keys[0];
        if (keys.every((k) => k.startsWith('expedition_battle'))) {
          return keys.includes('expedition_battle_aliens') && !keys.includes('expedition_battle_pirates') ? 'expedition_battle_aliens'
            : keys.includes('expedition_battle_pirates') && !keys.includes('expedition_battle_aliens') ? 'expedition_battle_pirates'
              : 'expedition_battle';
        }
        return keys[0];
      }
      default: {
        // en subjects/bodies from resources/lang/en/t_messages.php
        if (/^Your fleet is returning from .* delivered its goods/.test(body)) return 'return_of_fleet_with_resources';
        if (/^Your fleet is returning from /.test(body)) return 'return_of_fleet';
        if (/^One of your fleets from .* delivered its goods/.test(body)) return 'fleet_deployment_with_resources';
        if (/^One of your fleets from /.test(body)) return 'fleet_deployment';
        if (/^Your fleet from .* reaches .* delivers its goods/.test(body)) return 'transport_arrived';
        if (/^An incoming fleet from .* has reached your planet /.test(body)) return 'transport_received';
        if (/^Your .+ \([\d,]+ ships\) have a total storage capacity of /.test(body)) return 'debris_field_harvest';
        if (/^A fleet has arrived at /.test(body)) return txt(li.querySelector('.msg_sender')) === 'Space Monitoring' ? 'acs_defend_arrival_host' : 'acs_defend_arrival_sender';
        if (/invited you to mission .* against /.test(body)) return 'fleet_union_invite';
        if (/^The fleet has arrived at the assigned coordinates .* found a new planet/.test(body)) return 'colony_established';
        if (/knowledge of astrophysics is not sufficient/.test(body)) return 'colony_establish_fail_astrophysics';
        if (/^Your repair request on planet /.test(body)) return 'wreck_field_repair_completed';
        if (/relocated from the coordinates/.test(body)) return 'planet_relocation_success';
        if (/^Greetings Emperor /.test(body)) return 'welcome_message';
        return 'unknown:' + title;
      }
    }
  }

  // ------------------------------------------------------------------ espionage (list)
  function parseEspionageShort(li) {
    const c = li.querySelector('.msg_content');
    const link = parsePlaceLink(li.querySelector('.msg_title a.txt_link'));
    const res = {};
    c.querySelectorAll('.resspan').forEach((s) => {
      const m = txt(s).match(/^(.*?):\s*(\S+)$/);
      if (!m) return;
      const i = [...c.querySelectorAll('.resspan')].indexOf(s); // order: metal, crystal, deuterium
      res[['metal', 'crystal', 'deuterium'][i]] = intApprox(m[2]);
    });
    const total = [...c.querySelectorAll('.compacting > span.fright.tooltipRight')].map(txt).find((t) => /\d/.test(t));
    const ce = txt(c.querySelector('.compacting > span.fright:not(.ctn)')).match(/(\d+)%/);
    return {
      id: parseInt(li.dataset.msgId, 10),
      target: link,
      player: txt(c.querySelector('.status_abbr_active')),
      resourcesApprox: res,
      resourcesTotalInclEnergy: total ? intFull(total.split(':').pop()) : null,
      counterEspionage: ce ? +ce[1] : null,
      detailsUrl: li.querySelector('message-footer-details a.overlay').getAttribute('href'),
    };
  }

  // ------------------------------------------------------------------ espionage (full, GET /ajax/messages/{id})
  function parseEspionageFull(doc) {
    const d = doc.querySelector('.detail_msg');
    const head = d.querySelector('.detail_msg_head');
    const target = parsePlaceLink(head.querySelector('.msg_title a.txt_link'));
    const atk = head.querySelector('a.icon_nf_link[href*="mission=1"]');
    let attackParams = null;
    if (atk) {
      const u = new URL(atk.getAttribute('href'), 'http://x');
      attackParams = { galaxy: +u.searchParams.get('galaxy'), system: +u.searchParams.get('system'), position: +u.searchParams.get('position'), type: +u.searchParams.get('type') };
    }
    const lists = [...d.querySelectorAll('.detail_msg_ctn > ul.detail_list')];
    const titles = [...d.querySelectorAll('.detail_msg_ctn > .section_title .title_txt')].map(txt);
    const resUl = lists.filter((u) => u.dataset.type === 'resources');
    const resOf = (ul) => {
      const o = {};
      ul.querySelectorAll('li.resource_list_el').forEach((li) => {
        const k = ['metal', 'crystal', 'deuterium', 'energy'].find((r) => li.querySelector('.resourceIcon.' + r));
        o[k] = intFull(li.getAttribute('title')); // exact (getFormattedFull)
      });
      return o;
    };
    const units = (type, prefix) => {
      const ul = lists.find((u) => u.dataset.type === type);
      if (!ul) return { shown: false, items: {} };
      const items = {};
      ul.querySelectorAll('li.detail_list_el').forEach((li) => {
        const img = li.querySelector('img');
        const id = parseInt((img.className.match(new RegExp('^' + prefix + '(\\d+)')) || [])[1], 10);
        items[id] = intFull(txt(li.querySelector('span.fright')));
      });
      return { shown: ul.querySelector('li.detail_list_el') !== null, items };
    };
    const ships = units('ships', 'tech');
    const defense = units('defense', 'defense');
    const buildings = units('buildings', 'building');
    const research = units('research', 'research');
    // Empty list = "no reliable information" OR "revealed and zero": the HTML is identical.
    // Reveal thresholds are monotone (ships < defense < buildings < research), so a later
    // non-empty section proves the earlier empty ones are real zeros.
    const known = {
      research: research.shown,
      buildings: buildings.shown || research.shown,
      defense: defense.shown || buildings.shown || research.shown,
      ships: ships.shown || defense.shown || buildings.shown || research.shown,
    };
    const ce = txt([...d.querySelectorAll('.detail_txt')].find((x) => /%/.test(x.textContent))).match(/(\d+)%/);
    return {
      id: parseInt(d.dataset.msgId, 10),
      title: txt(head.querySelector('.msg_title')),
      date: txt(head.querySelector('.msg_date')),
      ts: msgDate(txt(head.querySelector('.msg_date'))),
      target,
      attackParams,
      player: txt(d.querySelector('.detail_txt .status_abbr_active')),
      counterEspionage: ce ? +ce[1] : null,
      resources: resUl[0] ? resOf(resUl[0]) : null,
      debris: titles.length && resUl[1] ? resOf(resUl[1]) : { metal: 0, crystal: 0, deuterium: 0 },
      ships: ships.items, defense: defense.items, buildings: buildings.items, research: research.items,
      known,
    };
  }

  // ------------------------------------------------------------------ battle report (list)
  function parseBattleShort(li) {
    const c = li.querySelector('.msg_content .combatInfo');
    const spans = c.querySelectorAll('.msg_ctn');
    const side = (el) => {
      const m = txt(el).match(/^[^:]+: \((.*)\): (\S+)$/);
      const cls = ['undermark', 'overmark', 'middlemark'].find((k) => el.classList.contains(k));
      return { name: m ? m[1] : null, lossesApprox: m ? intApprox(m[2]) : null, mark: cls };
    };
    const attacker = side(c.querySelector('.basicInfo .msg_ctn2'));
    const defender = side(c.querySelector('.miscInfo .msg_ctn2'));
    const lootM = txt(c.querySelectorAll('.basicInfo .msg_ctn3')[0]).match(/: (\S+), [^:]+: (\d+)%$/);
    const debris = txt(c.querySelectorAll('.basicInfo .msg_ctn3')[1]).split(': ').pop();
    const misc = [...c.querySelectorAll('.miscInfo .msg_ctn3')].map(txt);
    const moon = misc[1] ? misc[1].match(/(\d+)%/) : null;
    return {
      id: parseInt(li.dataset.msgId, 10),
      defenderPlace: parsePlaceLink(li.querySelector('.msg_title a.txt_link')),
      attacker, defender,
      winner: attacker.mark === 'undermark' ? 'attacker' : attacker.mark === 'middlemark' ? 'draw' : 'defender',
      lootApprox: lootM ? intApprox(lootM[1]) : null,
      lootPercent: lootM ? +lootM[2] : null,
      debrisTotalApprox: intApprox(debris),
      repaired: intFull(misc[0].split(': ').pop()),
      moonChance: moon ? +moon[1] : null, // null: target already had a moon (row omitted)
      detailsUrl: li.querySelector('message-footer-details a.overlay').getAttribute('href'),
    };
  }

  // ------------------------------------------------------------------ battle report (full)
  /** `var combatData = {...};` is a JS literal with // comments and trailing commas. */
  function extractCombatData(html) {
    const m = html.match(/var combatData = (\{[\s\S]*?\n\s*\});\s*\n\s*var attackerJson/);
    if (!m) return null;
    const json = m[1]
      .replace(/^\s*\/\/.*$/gm, '')          // full-line comments only (no URLs in this block)
      .replace(/,(\s*[}\]])/g, '$1');         // trailing commas
    return JSON.parse(json);
  }
  function parseBattleFull(doc, rawHtml) {
    const d = doc.querySelector('.detail_msg');
    const resRow = (ul) => {
      const o = {};
      ul.querySelectorAll('li.resource_list_el_small').forEach((li) => {
        const k = ['metal', 'crystal', 'deuterium'].find((r) => li.querySelector('.resourceIconSmall.' + r));
        if (k) o[k] = intApprox(li.querySelector('.res_value').dataset.tooltipTitle); // formatNumberLong: exact < 1Mn
      });
      return o;
    };
    const lootUl = d.querySelector('.resourcedisplay.loot ul.detail_list');
    const tfUl = d.querySelector('.resourcedisplay.tf ul.detail_list');
    const tfTitle = [...d.querySelectorAll('.resourcedisplay.tf .section_title')][0];
    const recM = txt(tfTitle).match(/=> (\d+) /);
    const sideInfo = (cls) => {
      const p = d.querySelector('.combat_participant.' + cls);
      const label = p.querySelector('.participant_label');
      const sel = p.querySelector('#' + cls + '_select_combatreport');
      const pct = (k) => intFull(txt(p.querySelector('li.' + cls + k)).split(': ').pop());
      return {
        name: sel ? sel.dataset.memberName : null,
        origin: txt(sel), // attacker: "NAME from Planet|Moon PLANETNAME [g:s:p]" (NPC: "Pirates from  Deep space [g:s:16]")
        mark: ['undermark', 'overmark', 'middlemark'].find((k) => label.classList.contains(k)),
        characterClass: txt(p.querySelector('li.' + cls + 'CharacterClass')).split(':').slice(1).join(':').trim() || null,
        weapons: pct('Weapon'), shields: pct('Shield'), armour: pct('Cover'),
      };
    };
    const cd = rawHtml ? extractCombatData(rawHtml) : null;
    let rounds = null; let start = null; let end = null;
    if (cd) {
      const flat = (o) => { const r = {}; for (const v of Object.values(o || {})) Object.assign(r, v); return r; };
      const flatArr = (a) => Object.assign({}, ...(a || []));
      const s = cd.combatRounds[0];
      start = { attacker: flat(s.attackerShips), defender: flatArr(s.defenderShips) };
      const last = cd.combatRounds[cd.combatRounds.length - 1];
      end = cd.combatRounds.length > 1 ? { attacker: flat(last.attackerShips), defender: flatArr(last.defenderShips) } : start;
      rounds = cd.combatRounds.length - 1;
      for (const sd of ['attacker', 'defender']) for (const k of Object.keys(start[sd])) start[sd][k] = +start[sd][k];
    }
    const lost = (sd) => {
      if (!start) return null;
      const r = {};
      for (const [k, v] of Object.entries(start[sd])) { const left = +(end[sd][k] || 0); if (v - left) r[k] = v - left; }
      return r;
    };
    const head = d.querySelector('.detail_msg_head .msg_title');
    return {
      id: parseInt(d.dataset.msgId, 10),
      defenderPlanet: { coords: coordsOf(txt(head)) }, // name/type: use the list view title link
      date: txt(d.querySelector('.detail_msg_head .msg_date')),
      loot: lootUl ? resRow(lootUl) : null,
      debris: tfUl ? resRow(tfUl) : null,
      recyclersNeeded: recM ? +recM[1] : null,
      moonCreated: !!d.querySelector('.og_video video'),
      attacker: sideInfo('attacker'),
      defender: sideInfo('defender'),
      rounds, start, end,
      unitsLost: { attacker: lost('attacker'), defender: lost('defender') }, // defender incl. defence (before repair)
    };
  }

  // ------------------------------------------------------------------ expeditions
  function parseExpedition(li, expIndex) {
    const c = li.querySelector('.msg_content');
    const key = classify(li, 'expeditions', expIndex);
    const html = c.innerHTML;
    const parts = html.split(/<br\s*\/?>\s*<br\s*\/?>/);
    const tail = parts.length > 1 ? parts.slice(1).join('\n') : '';
    const out = { id: parseInt(li.dataset.msgId, 10), ts: msgDate(txt(li.querySelector('.msg_date'))), key, outcome: OUTCOME[key] || 'unknown' };
    let m;
    if (key === 'expedition_gain_resources' && (m = tail.match(/(Metal|Crystal|Deuterium) ([\d,]+)/))) {
      out.resources = { [m[1].toLowerCase()]: intFull(m[2]) }; // label is hard-coded English (ResourceType::getTranslation)
    }
    if (key === 'expedition_gain_dark_matter' && (m = tail.match(/(\d[\d,]*)/))) out.darkMatter = intFull(m[1]);
    if (key === 'expedition_gain_ships') {
      out.shipsByName = {};
      tail.split(/<br\s*\/?>/).slice(1).forEach((line) => {
        const mm = line.replace(/<[^>]+>/g, '').trim().match(/^(.+): ([\d,]+)$/);
        if (mm) out.shipsByName[mm[1]] = intFull(mm[2]); // map localized title -> id via messages-object-titles.json
      });
    }
    return out;
  }
  const OUTCOME = {
    expedition_gain_resources: 'resources', expedition_gain_ships: 'ships', expedition_gain_dark_matter: 'dark_matter',
    expedition_gain_item: 'item', expedition_merchant_found: 'merchant', expedition_failed: 'nothing',
    expedition_failed_and_delay: 'delay', expedition_failed_and_speedup: 'speedup', expedition_battle_pirates: 'pirates',
    expedition_battle_aliens: 'aliens', expedition_battle: 'battle', expedition_loss_of_fleet: 'fleet_lost',
  };

  // ------------------------------------------------------------------ transport / return / harvest
  function parseFleetMessage(li, key) {
    const c = li.querySelector('.msg_content');
    const body = txt(c);
    const links = [...c.querySelectorAll('a.txt_link')].map(parsePlaceLink);
    const res = {};
    let m;
    const re = /(Metal|Crystal|Deuterium): ([\d,]+)/g;
    while ((m = re.exec(body))) res[m[1].toLowerCase()] = intFull(m[2]);
    const out = { id: parseInt(li.dataset.msgId, 10), key, ts: msgDate(txt(li.querySelector('.msg_date'))), from: links[0] || null, to: links[1] || null };
    if (Object.keys(res).length) out.resources = res;
    if (key === 'debris_field_harvest') {
      m = body.match(/^Your (.+) \(([\d,]+) ships\) have a total storage capacity of ([\d,]+)\. At the target .*?, ([\d,]+) Metal, ([\d,]+) Crystal and ([\d,]+) Deuterium are floating in space\. You have harvested ([\d,]+) Metal, ([\d,]+) Crystal and ([\d,]+) Deuterium\./);
      if (m) {
        out.ship = m[1]; out.shipAmount = intFull(m[2]); out.capacity = intFull(m[3]);
        out.field = { metal: intFull(m[4]), crystal: intFull(m[5]), deuterium: intFull(m[6]) };
        out.harvested = { metal: intFull(m[7]), crystal: intFull(m[8]), deuterium: intFull(m[9]) };
      }
      out.from = null; out.to = links[0] || null;
    }
    if (/^acs_defend_arrival/.test(key)) { out.from = null; out.to = links[0] || null; }
    return out;
  }

  // ------------------------------------------------------------------ espionage detected (incoming spy)
  function parseEspionageDetected(li) {
    const c = li.querySelector('.msg_content');
    const links = [...c.querySelectorAll('a.txt_link')].map(parsePlaceLink);
    const name = txt(c).match(/\]\s*\((.*?)\)/);
    const ch = txt(c).match(/(\d+)%\s*$/);
    return { id: parseInt(li.dataset.msgId, 10), ts: msgDate(txt(li.querySelector('.msg_date'))), from: links[0] || null, attackerName: name ? name[1] : null, target: links[1] || null, counterEspionage: ch ? +ch[1] : null };
  }

  root.OGXMsgRecipes = { intFull, intApprox, msgDate, coordsOf, parsePlaceLink, parseMessageList, buildExpeditionIndex, classify, parseEspionageShort, parseEspionageFull, parseBattleShort, parseBattleFull, extractCombatData, parseExpedition, parseFleetMessage, parseEspionageDetected, OUTCOME };
})(typeof window !== 'undefined' ? window : globalThis);
