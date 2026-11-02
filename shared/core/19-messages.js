/* shared/core/19-messages.js — message list/detail fetch, watcher, report parsers. Owner: core.
 * OgameX: the parser section below is tools/messages_recipes.js ported WITHOUT behaviour changes (verified against
 * fixtures/messages-expected-parse.json). OGX.messages.parse.* wraps it with DESIGN §2.18 names and a few added
 * aliases (isNew, sender, li, lootSum, ...).
 * GALAXYZ (specs/galaxyz/messages.md): specs/galaxyz/messages-recipes.js ported verbatim (OGX.messages.gz, raw shapes), and the
 * same public parse.* / classify / fetchList / watch return the OgameX shapes. Spy reports and the list are [REAL]; combat,
 * expedition and fleet texts are [UPSTREAM] (unverified: `unverified: true`, never throw, null on unknown markup).
 * Messages owns no storage keys. */
(function (OGX) {
  'use strict';
  const messages = (OGX.messages = OGX.messages || {});
  const log = OGX.log.create('messages');

  // ================================================================== recipes (tools/messages_recipes.js, verbatim)

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

  // ------------------------------------------------------------------ fleet message texts (all locales)
  /**
   * Bodies of the transport / return / deployment / harvest / ACS-hold messages per locale, copied from OgameX
   * resources/lang/{en,fr,zh-TW}/t_messages.php (<key>.body, whitespace collapsed). nl and it have no such keys
   * (nl/t_messages.php uses another layout) and Laravel falls back to en for them. ':placeholders' become capture groups.
   */
  const FLEET_TEXTS = {"en": {"return_of_fleet_with_resources": "Your fleet is returning from :from to :to and delivered its goods: Metal: :metal Crystal: :crystal Deuterium: :deuterium", "return_of_fleet": "Your fleet is returning from :from to :to. The fleet doesn't deliver goods.", "fleet_deployment_with_resources": "One of your fleets from :from has reached :to and delivered its goods: Metal: :metal Crystal: :crystal Deuterium: :deuterium", "fleet_deployment": "One of your fleets from :from has reached :to. The fleet doesn`t deliver goods.", "transport_arrived": "Your fleet from :from reaches :to and delivers its goods: Metal: :metal Crystal: :crystal Deuterium: :deuterium", "transport_received": "An incoming fleet from :from has reached your planet :to and delivered its goods: Metal: :metal Crystal: :crystal Deuterium: :deuterium", "debris_field_harvest": "Your :ship_name (:ship_amount ships) have a total storage capacity of :storage_capacity. At the target :to, :metal Metal, :crystal Crystal and :deuterium Deuterium are floating in space. You have harvested :harvested_metal Metal, :harvested_crystal Crystal and :harvested_deuterium Deuterium.", "acs_defend_arrival_host": "A fleet has arrived at :to.", "_spaceMonitoring": "Space Monitoring"}, "fr": {"return_of_fleet_with_resources": "Votre flotte revient du :from au :to et a livré sa marchandise : Métal : :metal Cristal : :crystal Deutérium : :deuterium", "return_of_fleet": "Votre flotte revient du :from au :to. La flotte ne livre pas de marchandises.", "fleet_deployment_with_resources": "Une de vos flottes de :from a atteint :to et a livré ses marchandises : Métal : :metal Cristal : :crystal Deutérium : :deuterium", "fleet_deployment": "Une de vos flottes de :from a atteint :to. La flotte ne livre pas de marchandises.", "transport_arrived": "Votre flotte de :from atteint :to et livre ses marchandises : Métal : :metal Cristal : :crystal Deutérium : :deuterium", "transport_received": "Une flotte arrivant de :from a atteint votre planète :to et a livré ses marchandises : Métal : :metal Cristal : :crystal Deutérium : :deuterium", "debris_field_harvest": "Vos :ship_name (:ship_amount vaisseaux) ont une capacité de stockage totale de :storage_capacity. Sur la cible :to, :metal Métal, :crystal Cristal et :deuterium Deutérium flottent dans l'espace. Vous avez récolté :harvested_metal Métal, :harvested_crystal Cristal et :harvested_deuterium Deutérium.", "acs_defend_arrival_host": "Une flotte est arrivée à :to.", "_spaceMonitoring": "Surveillance de l'espace"}, "zh-TW": {"return_of_fleet_with_resources": "您的艦隊正在從 :from 返回 :to，並運送了貨物： 金屬：:metal 晶體：:crystal 重氫：:deuterium", "return_of_fleet": "您的艦隊正在從 :from 返回 :to。 艦隊沒有運送貨物。", "fleet_deployment_with_resources": "您的一支來自 :from 的艦隊已到達 :to 並運送了貨物： 金屬：:metal 晶體：:crystal 重氫：:deuterium", "fleet_deployment": "您的一支來自 :from 的艦隊已到達 :to。艦隊沒有運送貨物。", "transport_arrived": "您來自 :from 的艦隊到達 :to 並運送了貨物： 金屬：:metal 晶體：:crystal 重氫：:deuterium", "transport_received": "一支來自 :from 的來襲艦隊已到達您的星球 :to 並運送了貨物： 金屬：:metal 晶體：:crystal 重氫：:deuterium", "debris_field_harvest": "您的 :ship_name（:ship_amount 艘船）總儲存容量為 :storage_capacity。在目標 :to 太空中漂浮著 :metal 金屬、:crystal 晶體和 :deuterium 重氫。您收穫了 :harvested_metal 金屬、:harvested_crystal 晶體和 :harvested_deuterium 重氫。", "acs_defend_arrival_host": "一支艦隊已到達 :to。", "_spaceMonitoring": "太空監控"}};
  const NUM_PARAMS = new Set(['metal', 'crystal', 'deuterium', 'harvested_metal', 'harvested_crystal', 'harvested_deuterium', 'storage_capacity', 'ship_amount']);
  let fleetMatchers = null;
  function buildFleetMatchers() {
    const out = [];
    for (const [locale, keys] of Object.entries(FLEET_TEXTS)) {
      for (const [key, tpl] of Object.entries(keys)) {
        if (key.startsWith('_')) continue;
        const names = [];
        let src = '';
        let last = 0;
        const re = /:([a-z_]+)/g;
        let m;
        const lit = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
        while ((m = re.exec(tpl))) {
          src += lit(tpl.slice(last, m.index));
          names.push(m[1]);
          src += NUM_PARAMS.has(m[1]) ? '([\\d,]+)' : '(.+?)';
          last = m.index + m[0].length;
        }
        src += lit(tpl.slice(last));
        out.push({ locale, key, names, re: new RegExp('^\\s*' + src) });
      }
    }
    return out;
  }
  /** Matches a fleet message body (text) against every locale: -> { key, locale, params } | null. */
  function matchFleetText(body) {
    if (!fleetMatchers) fleetMatchers = buildFleetMatchers();
    const t = String(body || '').replace(/\s+/g, ' ').trim();
    for (const f of fleetMatchers) {
      const m = f.re.exec(t);
      if (!m) continue;
      const params = {};
      f.names.forEach((n, i) => { params[n] = NUM_PARAMS.has(n) ? intFull(m[i + 1]) : String(m[i + 1]).trim(); });
      return { key: f.key, locale: f.locale, params };
    }
    return null;
  }
  const SPACE_MONITORING = new Set(Object.values(FLEET_TEXTS).map((k) => k._spaceMonitoring).filter(Boolean));

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
        // fleet messages: every locale with its own t_messages.php texts (en, fr, zh-TW; nl/it fall back to en)
        const fm = matchFleetText(body);
        if (fm) {
          if (fm.key === 'acs_defend_arrival_host') return SPACE_MONITORING.has(txt(li.querySelector('.msg_sender'))) ? 'acs_defend_arrival_host' : 'acs_defend_arrival_sender';
          return fm.key;
        }
        // en subjects/bodies from resources/lang/en/t_messages.php (lenient fallbacks)
        if (/^Your fleet is returning from .* delivered its goods/.test(body)) return 'return_of_fleet_with_resources';
        if (/^Your fleet is returning from /.test(body)) return 'return_of_fleet';
        if (/^One of your fleets from .* delivered its goods/.test(body)) return 'fleet_deployment_with_resources';
        if (/^One of your fleets from /.test(body)) return 'fleet_deployment';
        if (/^Your fleet from .* reaches .* delivers its goods/.test(body)) return 'transport_arrived';
        if (/^An incoming fleet from .* has reached your planet /.test(body)) return 'transport_received';
        if (/^Your .+ \([\d,]+ ships\) have a total storage capacity of /.test(body)) return 'debris_field_harvest';
        if (/^A fleet has arrived at /.test(body)) return SPACE_MONITORING.has(txt(li.querySelector('.msg_sender'))) ? 'acs_defend_arrival_host' : 'acs_defend_arrival_sender';
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
    const fm = matchFleetText(body);
    const P = fm && (fm.key === key || (/^acs_defend_arrival/.test(key) && /^acs_defend_arrival/.test(fm.key))) ? fm.params : null;
    if (P && key !== 'debris_field_harvest') {
      for (const r of ['metal', 'crystal', 'deuterium']) if (P[r] !== undefined && P[r] !== null) res[r] = P[r];
    } else if (!P) {
      const re = /(Metal|Crystal|Deuterium): ([\d,]+)/g;
      while ((m = re.exec(body))) res[m[1].toLowerCase()] = intFull(m[2]);
    }
    const out = { id: parseInt(li.dataset.msgId, 10), key, ts: msgDate(txt(li.querySelector('.msg_date'))), from: links[0] || null, to: links[1] || null };
    if (Object.keys(res).length) out.resources = res;
    if (key === 'debris_field_harvest' && P && P.harvested_metal !== undefined) {
      out.ship = P.ship_name; out.shipAmount = P.ship_amount; out.capacity = P.storage_capacity;
      out.field = { metal: P.metal, crystal: P.crystal, deuterium: P.deuterium };
      out.harvested = { metal: P.harvested_metal, crystal: P.harvested_crystal, deuterium: P.harvested_deuterium };
      out.from = null; out.to = links[0] || null;
    } else if (key === 'debris_field_harvest') {
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

  // ================================================================== end of recipes

  // ================================================================== GALAXYZ recipes (specs/galaxyz/messages-recipes.js, GZMessages)
  // Ported verbatim (helpers .. parseItem); the fetch helpers are replaced by OGX.api / OGX.http below. Output = the recipe's
  // shapes (coords as { galaxy, system, planet }, resources keyed by id) — checked against specs/galaxyz/fixtures/messages-expected-parse.json.
  // [REAL] messages-spy.html / messages-all.html: list, categories, spy report (ids + exact values from the Simulate link im[ID]).
  // [UPSTREAM] only (unverified on the live server): combat message + page=raport, expedition, transport/recycle/return texts.
  const GZ = (function () {
    // ---------- helpers ----------
    const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
    const norm = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    // pretty_number(): '.' thousands, ',' decimals (includes/GeneralFunctions.php:237). Also accepts raw '1700557697522.1' via rawNum.
    const NUM_RE = /-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:,\d+)?/g;
    function num(s) {
      if (s == null) return null;
      const m = String(s).replace(/ /g, ' ').match(NUM_RE);
      return m ? parseFloat(m[0].replace(/\./g, '').replace(',', '.')) : null;
    }
    const nums = (s) => (String(s || '').replace(/ /g, ' ').match(NUM_RE) || []).map(num);
    function coords(s) {
      const m = /\[\s*(\d+):(\d+):(\d+)\s*\]/.exec(s || '');
      return m ? { galaxy: +m[1], system: +m[2], planet: +m[3] } : null;
    }
    const cstr = (c) => (c ? c.galaxy + ':' + c.system + ':' + c.planet : null);
    function qs(href) {                                   // works for absolute, relative and DOMParser (about:blank) hrefs
      const h = String(href || '');
      const i = h.indexOf('?');
      return new URLSearchParams(i < 0 ? '' : h.slice(i + 1).replace(/#.*$/, ''));
    }
    // php_tdformat 'd. M Y, H:i:s' (language/*/L18N.php) -> wall-clock ms (fields as UTC) in the zone the server used.
    const MONTHS = ['jan|янв|jän', 'feb|фев', 'mar|мар|mär|mrz', 'apr|апр', 'may|май|mai', 'jun|июн', 'jul|июл', 'aug|авг', 'sep|сен', 'oct|окт|okt', 'nov|ноя', 'dec|дек|dez'];
    function parseTdDate(s) {
      const m = /(\d{1,2})\.\s*([^\s\d.,]+)\.?\s+(\d{4}),?\s+(\d{1,2}):(\d{2}):(\d{2})/.exec(s || '');
      if (!m) return null;
      const mon = m[2].toLowerCase().slice(0, 3);
      const mi = MONTHS.findIndex((alts) => alts.split('|').includes(mon));
      if (mi < 0) return null;
      return Date.UTC(+m[3], mi, +m[1], +m[4], +m[5], +m[6]);
    }
    // <a href="game.php?page=galaxy&galaxy=G&system=S">[G:S:P]</a> links inside message bodies (GetStart/TargetAddressLink)
    const galaxyLinks = (el) => [...el.querySelectorAll('a[href*="page=galaxy"]')].map((a) => ({ a, coords: coords(a.textContent) })).filter((x) => x.coords);
    function textAfter(el, node) {                        // text of `el` after `node` (document order)
      const r = (el.ownerDocument || el).createRange ? (el.ownerDocument || el).createRange() : null;
      if (r) { r.setStartAfter(node); r.setEndAfter(el.lastChild || el); return r.toString(); }
      return el.textContent.split(node.textContent).slice(1).join(node.textContent);
    }

    // Category ids, colours and names: ShowMessagesPage.class.php:375, language/en/INGAME.php:508-518 [REAL messages-spy.html]
    const CATEGORIES = { 0: 'spy', 1: 'player', 2: 'alliance', 3: 'combat', 4: 'system', 5: 'transport', 15: 'expedition', 50: 'game', 99: 'construction', 100: 'all', 999: 'outbox' };

    // Lower-cased element/resource name -> id, en + ru (elements.json name/nameRu + language/*/TECH.php shortNames). Fork names are REAL for en.
    const NAMES = {"metal mine":1,"рудник металла":1,"crystal mine":2,"рудник кристалла":2,"deuterium refinery":3,"синтезатор дейтерия":3,"solar power plant":4,"солнечная электростанция":4,"university":6,"технополис":6,"deuterium power plant":12,"термоядерная электростанция":12,"robot factory":14,"фабрика роботов":14,"nanite factory":15,"фабрика нанитов":15,"shipyard":21,"верфь":21,"metal storage":22,"хранилище металла":22,"crystal storage":23,"хранилище кристалла":23,"deuterium storage":24,"ёмкость для дейтерия":24,"research lab":31,"исследовательская лаборатория":31,"terraformer":33,"терраформер":33,"alliance depot":34,"склад альянса":34,"moon base":41,"лунная база":41,"phalax sensor":42,"сенсорная фаланга":42,"jumpgate":43,"телепорт":43,"missile silo":44,"ракетная шахта":44,"light conveyor":71,"average conveyor":72,"heavy conveyor":73,"spy technology":106,"шпионаж":106,"computer technology":108,"компьютерная технология":108,"weapons technology":109,"оружейная технология":109,"shield technology":110,"щитовая технология":110,"armour technology":111,"броня космических кораблей":111,"energy technology":113,"энергетическая технология":113,"hyperspace technology":114,"гиперпространственная технология":114,"combustion engine":115,"реактивный двигатель":115,"impulse engine":117,"импульсный двигатель":117,"hyperspace engine":118,"гиперпространственный двигатель":118,"laser technology":120,"лазерная технология":120,"ion technology":121,"ионная технология":121,"plasma technology":122,"плазменная технология":122,"intergalactic research network":123,"межгалактическая исследовательская сеть":123,"expedition research":124,"астрофизика":124,"mineral research":131,"технология добычи металла":131,"semi-crystals research":132,"технология добычи кристалла":132,"fuel research":133,"технология добычи дейтерия":133,"graviton research":199,"гравитационная технология":199,"light cargo":202,"малый транспорт":202,"heavy cargo":203,"большой транспорт":203,"light fighter":204,"лёгкий истребитель":204,"heavy fighter":205,"тяжёлый истребитель":205,"cruiser":206,"крейсер":206,"battleship":207,"линкор":207,"colony ship":208,"колонизатор":208,"recycler":209,"переработчик":209,"spy probe":210,"шпионский зонд":210,"planet bomber":211,"бомбардировщик":211,"solar satellite":212,"солнечный спутник":212,"star fighter":213,"уничтожитель":213,"battle fortress":214,"звезда смерти":214,"battle cruiser":215,"линейный крейсер":215,"black moon":216,"сверхновая звезда":216,"battle transporter":217,"улучшенный транспорт":217,"avatar":218,"аватар":218,"battle recycler":219,"мега переработчик":219,"dark matter collector":220,"сборщик тёмной материи":220,"missile launcher":401,"ракетная установка":401,"light laser turret":402,"лёгкий лазер":402,"heavy laser turret":403,"тяжёлый лазер":403,"gauss cannon":404,"пушка гаусса":404,"ion cannon":405,"ионное орудие":405,"plasma cannon":406,"плазменное орудие":406,"small shield dome":407,"малый щитовой купол":407,"large shield dome":408,"большой щитовой купол":408,"atmospheric shield":409,"планетарный щитовой купол":409,"gravitons cannon":410,"гравитонное орудие":410,"orbital defence platform":411,"орбитальная база":411,"interceptor":502,"ракета-перехватчик":502,"interplanetary missiles":503,"межпланетная ракета":503,"м. трансп.":202,"б. трансп.":203,"л. истр.":204,"т. истр.":205,"шп. зонд":210,"бомб.":211,"солн. спутник":212,"уничт.":213,"зс":214,"лин. кр.":215,"сверхн. звезда":216,"ул. трансп.":217,"мега перераб.":219,"сборщик тм":220,"ру":401,"лёг. лазер":402,"тяж. лазер":403,"гаусс":404,"ион":405,"плазма":406,"м. купол":407,"б. купол":408,"п. купол":409,"гравитонка":410,"орб. база":411,"metal":901,"crystal":902,"deuterium":903,"energy":911,"dark matter":921,"металл":901,"кристалл":902,"дейтерий":903,"энергия":911,"тёмная материя":921};
    const idOf = (name) => { const k = String(name || '').replace(/\s+/g, ' ').trim().toLowerCase(); return k in NAMES ? NAMES[k] : null; };

    // Subjects / senders (language/{en,ru}/FLEET.php, INGAME.php). Only used when the category is unknown (cat 100 "All").
    const S = {
      spyReport: ['Intelligence report', 'Шпионский доклад'],            // sys_mess_spy_report, sender sys_mess_qg
      spyActivity: ['Spying activity', 'Шпионаж'],                        // sys_mess_spy_activity, sender sys_mess_spy_control
      attack: ['Fight report', 'Боевой доклад'],                          // sys_mess_attack_report
      missile: ['Rocket impact', 'Ракетная атака'],                       // sys_irak_subject
      transport: ['Transportmessage', 'Транспортировка'],                 // sys_mess_transport
      recycle: ['Recycling Report', 'Доклад переработчиков'],             // sys_recy_report
      stay: ['Located fleet', 'Удерживающийся флот'],                     // sys_stat_mess_stay
      fleetback: ['Fleet return', 'Возвращение флота'],                   // sys_mess_fleetback
      expedition: ['Expedition report', 'Доклад экспедиции'],             // sys_expe_report
      colo: ['Colonisation report', 'Доклад поселенцев'],                 // sys_colo_mess_report (sender sys_colo_mess_from)
      buildFail: ['Impossible to build', 'Строительство невозможно'],     // sys_buildlist_fail
      won: { a: ['The attacker has won the battle!', 'Атакующий выиграл битву.'], r: ['The defender has won the battle!', 'Обороняющийся выиграл битву.'], w: ['The fight ends in a draw!', 'Битва окончилась вничью'] },
      destruc: ['The following fleets face each other for a moon destruction:', 'Cледующие флоты участвовали в уничтожении луны:'],
      moonTag: ['(Moon)', '(Луна)'],
    };
    const isOne = (list, s) => list.some((x) => norm(x).toLowerCase() === norm(s).toLowerCase());

    // ---------- page=messages: categories ----------
    // <td style="color:#FFFF00"><a onclick="Message.getMessages(0);return false;">Spy messages</a><br><span id="unread_0">0</span>/<span id="total_0">2</span></td>
    function parseCategories(doc) {
      const out = [];
      for (const a of doc.querySelectorAll('a[onclick*="Message.getMessages("]')) {
        const m = /Message\.getMessages\((\d+)\)\s*;/.exec(a.getAttribute('onclick') || '');
        if (!m) continue;                                  // page links have two arguments
        const cat = +m[1];
        const u = doc.querySelector('[id="unread_' + cat + '"]');
        const t = doc.querySelector('[id="total_' + cat + '"]');
        out.push({ cat, key: CATEGORIES[cat] || null, name: txt(a), color: (a.getAttribute('style') || '').replace(/^.*color:\s*([^;]+).*$/, '$1') || null,
          unread: u ? num(u.textContent) : null, total: t ? num(t.textContent) : null });
      }
      return out;
    }

    // topnav badge on every page [REAL]: <a class="messages-button"><span class="new-msg-count">2</span></a>; no span = 0.
    // Server value ($USER['messages']); the game's JS does not update it after a category click.
    function parseHeaderUnread(doc) {
      const el = doc.querySelector('.messages-section .new-msg-count');
      return el ? num(el.textContent) || 0 : 0;
    }

    // ---------- message list (page.messages.view.tpl) ----------
    function parseList(rootEl) {
      const table = rootEl.querySelector('table#messagestable, table[id="messagestable"]');
      if (!table) return null;
      const form = table.closest('form');
      const val = (n) => { const i = form && form.querySelector('input[name="' + n + '"]'); return i ? i.value : null; };
      // paging row: td.right "Page: [1] [2] ..." with <b>[current]</b>; « and » are prev/next (view.tpl:30)
      const pageTd = table.querySelector('td.right');
      const pageNums = pageTd ? [...pageTd.querySelectorAll('a')].map((a) => /^\[(\d+)\]$/.exec(txt(a))).filter(Boolean).map((m) => +m[1]) : [];
      const cur = pageTd && pageTd.querySelector('b') ? num(pageTd.querySelector('b').textContent) : 1;
      const items = [];
      for (const head of table.querySelectorAll('tr.message_head[id^="message_"]')) {
        const tds = head.children;
        const bodyTr = head.nextElementSibling && head.nextElementSibling.matches('tr.messages_body') ? head.nextElementSibling : null;
        const subjTd = tds[3];
        const reply = subjTd && subjTd.querySelector('a[onclick*="Dialog.PM("]');
        let subject = '';
        if (subjTd) { const c = subjTd.cloneNode(true); c.querySelectorAll('a[onclick*="Dialog.PM("]').forEach((x) => x.remove()); subject = txt(c); }
        const date = txt(tds[1]);
        items.push({
          id: +head.id.replace('message_', ''),
          unread: head.classList.contains('mes_unread'),      // unread BEFORE this view: the view itself marks the page read (ShowMessagesPage:130-135)
          selectable: !!head.querySelector('input[type=checkbox][name^="messageID["]'),
          date, wall: parseTdDate(date),
          from: txt(tds[2]), subject,
          senderId: reply ? +(/Dialog\.PM\((\d+)/.exec(reply.getAttribute('onclick')) || [0, 0])[1] : null,
          body: bodyTr ? bodyTr.querySelector('td') : null,
        });
      }
      return { cat: val('messcat') != null ? +val('messcat') : null, page: cur || 1, pages: pageNums.length ? Math.max(...pageNums) : 1, items };
    }

    // ---------- classification ----------
    function guessCat(item) {
      const b = item.body;
      if (!b) return null;
      if (b.querySelector('.spyRaport')) return 0;
      if (b.querySelector('.raportMessage')) return 3;
      const s = item.subject;
      if (isOne(S.spyActivity, s) || isOne(S.spyReport, s)) return 0;
      if (isOne(S.attack, s) || isOne(S.missile, s)) return 3;
      if (isOne(S.transport, s) || isOne(S.recycle, s) || isOne(S.stay, s)) return 5;
      if (isOne(S.expedition, s)) return 15;
      if (isOne(S.fleetback, s) || isOne(S.colo, s)) return 4;
      if (isOne(S.buildFail, s)) return 99;
      if (item.senderId) return 1;                           // reply link only on type 1 (view.tpl:47)
      return null;
    }
    function classify(item, cat) {
      const b = item.body;
      if (!b) return 'unknown';
      if (b.querySelector('.spyRaport')) return 'spy_report';
      const rm = b.querySelector('.raportMessage');
      if (rm) return rm.querySelector('a[href*="CombatReport.php"]') ? 'combat_expedition' : 'combat';
      if (cat == null || cat === 100) cat = guessCat(item);
      const links = galaxyLinks(b);
      switch (cat) {
        case 0: return 'spy_detected';
        case 3: return 'missile';
        case 15: return 'expedition';
        case 5:
          if (!links.length) return 'recycle';
          if (links.length >= 2) return 'transport_received';
          return isOne(S.stay, item.subject) ? 'deploy_arrival' : 'transport_arrival';
        case 4:
          if (isOne(S.fleetback, item.subject) || (!isOne(S.colo, item.subject) && links.length <= 1)) {
            if (!links.length) return nums(b.textContent).length >= 4 ? 'return_expedition' : 'return_expedition_dm';
            return nums(textAfter(b, links[links.length - 1].a)).length >= 3 ? 'return' : 'return_empty';
          }
          return isOne(S.colo, item.subject) ? 'colonisation' : 'system';
        case 99: return 'construction';
        case 1: return 'player';
        case 2: return 'alliance';
        case 50: return 'game';
        case 999: return 'outbox';
        default: return 'unknown';
      }
    }

    // ---------- espionage report (shared.mission.spyReport.tpl, MissionCaseSpy.class.php:88-161) ----------
    const SECTION = { 900: 'resources', 200: 'fleet', 400: 'defense', 0: 'buildings', 100: 'research' };
    // PHP sprintf('%.0f') = correctly rounded, exact .5 ties to EVEN (php -r 'printf("%.0f",1210500000.5)' -> 1210500000)
    function fmt0(x) { if (!Number.isFinite(x)) return x; return Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : Math.round(x); }
    function parseSpyReport(el) {
      const sr = el.matches && el.matches('.spyRaport') ? el : el.querySelector('.spyRaport');
      if (!sr) return null;
      const headA = sr.querySelector('.spyRaportHead a');
      const title = txt(headA);
      const c = coords(title);
      const name = title.replace(/\s*\[\d+:\d+:\d+\][\s\S]*$/, '').replace(/^(Spy Report|Сканирование)\s+/, '');
      const footer = sr.querySelector('.spyRaportFooter');
      const attack = footer && footer.querySelector('a[href*="target_mission=1"]');
      const sim = footer && footer.querySelector('a[href*="page=battleSimulator"]');
      // im[ID]=raw value, in the same order as the cells (template line 19 iterates the same $spyData)
      const simList = [];
      if (sim) for (const [k, v] of qs(sim.getAttribute('href'))) { const m = /^im\[(\d+)\]$/.exec(k); if (m) simList.push([+m[1], parseFloat(v)]); }
      const out = { title, targetName: name, coords: c, coordsStr: cstr(c),
        planetType: attack ? +qs(attack.getAttribute('href')).get('planettype') : null,
        reportDateText: (/\d{1,2}\.\s*\S+\s+\d{4},\s*\d{1,2}:\d{2}:\d{2}/.exec(title) || [null])[0],
        reportWall: parseTdDate(title),                   // fleet RETURN time in the TARGET's timezone (MissionCaseSpy:151) - not the arrival
        destroyed: !!(footer && footer.querySelector('font[color="red"], font[color=red]')),
        discoveryChance: null, revealed: {}, resources: null, fleet: null, defense: null, buildings: null, research: null,
        exact: !!sim, unknownNames: [] };
      if (footer && !out.destroyed) { const m = /(\d+)\s*%/.exec(footer.textContent); out.discoveryChance = m ? +m[1] : null; }
      // containers may be NESTED (an odd cell count leaves a row unclosed: real messages-spy.html report 520244) -> scope cells per container
      const cells = [];
      for (const box of sr.querySelectorAll('.spyRaportContainer')) {
        const head = [...box.children].find((x) => x.classList.contains('spyRaportContainerHead'));
        const m = head && /spyRaportContainerHeadClass(\d+)/.exec(head.className);
        if (!m) continue;
        const cls = +m[1];
        const key = SECTION[cls] || 'class' + cls;
        out[key] = {};
        out.revealed[key] = true;
        const own = [...box.querySelectorAll('.spyRaportContainerCell')].filter((x) => x.closest('.spyRaportContainer') === box);
        for (let i = 0; i + 1 < own.length; i += 2) cells.push({ key, name: txt(own[i]), value: num(own[i + 1].textContent) });
      }
      const useSim = simList.length === cells.length;
      cells.forEach((cell, i) => {
        const id = useSim ? simList[i][0] : idOf(cell.name);
        if (id == null) { out.unknownNames.push(cell.name); return; }
        // the cell shows pretty_number() = sprintf('%.0f') = ROUNDED (GeneralFunctions.php:237,330): round the raw im[] float the same way
        out[cell.key][id] = useSim ? fmt0(simList[i][1]) : cell.value;
      });
      out.exact = useSim;
      // probes reveal in a fixed order (fleet < defense < buildings < research, MissionCaseSpy:82-85): a revealed later section implies the earlier ones
      const order = ['fleet', 'defense', 'buildings', 'research'];
      const last = Math.max(-1, ...order.map((k, i) => (out.revealed[k] ? i : -1)));
      order.forEach((k, i) => { out.revealed[k] = i <= last; });
      out.revealed.resources = !!out.resources;
      return out;
    }

    // "A hostile fleet of the planet NAME[(Moon) ]<a>[g:s:p]</a> was sighted near your planet\n NAME <a>[g:s:p]</a> sighted" (MissionCaseSpy:163-188)
    function parseSpyDetected(item) {
      const L = galaxyLinks(item.body);
      const before = L[0] ? norm(item.body.innerHTML.split(L[0].a.outerHTML)[0]) : '';
      return { from: L[0] ? L[0].coords : null, target: L[1] ? L[1].coords : null, fromText: before,
        fromMoon: S.moonTag.some((t) => before.includes(t)), wall: item.wall };
    }

    // ---------- combat message in the list (MissionCaseAttack.class.php:51-69, 395-476; Expedition :220-464) ----------
    const RES = { raportWin: 'win', raportLose: 'loss', raportDraw: 'draw' };
    const clsRes = (el) => { for (const c of (el ? el.classList : [])) if (RES[c]) return RES[c]; return null; };
    function parseCombatMessage(item) {
      const rm = (item.body || item).querySelector('.raportMessage');
      if (!rm) return null;
      const a = rm.querySelector('a[href*="raport="]');
      const href = a ? a.getAttribute('href') : '';
      const rid = qs(href).get('raport');
      const titleSpan = a && a.querySelector('span');
      const title = txt(titleSpan);
      const rows = rm.querySelectorAll('tr');
      const lossSpans = rows[1] ? rows[1].querySelectorAll('td:nth-child(2) > span') : [];
      const att = clsRes(lossSpans[0]);
      const pick = (cls, id) => { const e = rm.querySelector('.' + cls[0] + '.element' + id + ', .' + cls[1] + '.element' + id); return e ? num(e.textContent) : null; };
      const st = ['reportSteal', 'raportSteal'], de = ['reportDebris', 'raportDebris'];
      const mine = clsRes(titleSpan);
      const winner = att === 'win' ? 'attacker' : att === 'loss' ? 'defender' : att === 'draw' ? 'draw' : null;
      return {
        reportId: rid, url: rid ? 'game.php?page=raport&raport=' + rid : null, viaCombatReportPhp: /CombatReport\.php/.test(href),
        isExpedition: /CombatReport\.php/.test(href),     // only the expedition heredoc links CombatReport.php (redirects to page=raport)
        coords: coords(title), coordsStr: cstr(coords(title)), planetTypeShort: (/\(([^()]*)\)\s*$/.exec(title) || [null, null])[1],
        myResult: mine, winner,
        myRole: winner === 'draw' || !mine ? null : (mine === att ? 'attacker' : 'defender'),
        lost: { attacker: lossSpans[0] ? num(txt(lossSpans[0]).replace(/^[^:]*:/, '')) : null, defender: lossSpans[1] ? num(txt(lossSpans[1]).replace(/^[^:]*:/, '')) : null },
        loot: { 901: pick(st, 901), 902: pick(st, 902), 903: pick(st, 903) },
        debris: { 901: pick(de, 901), 902: pick(de, 902) },
        wall: item.wall != null ? item.wall : null,
      };
    }

    // ---------- full combat report: page=raport (shared.mission.raport.tpl) ----------
    function parseSide(table) {
      const out = [];
      const tr = table.querySelector(':scope > tbody > tr, :scope > tr');
      for (const td of tr ? tr.children : []) {
        const cell = td.querySelector('td');
        if (!cell) continue;
        const lines = cell.innerHTML.split(/<table/i)[0].split(/<br\s*\/?>/i).map(norm).filter(Boolean);
        const head = lines[0] || '';
        const m = /^(\S+)\s+(.*?)\s*\((\[(?:\d+:\d+:\d+|XX:XX:XX)\])(?:\s*\(([^()]*)\))?\)\s*$/.exec(head);
        const tech = nums(lines[1] || '');
        const inner = cell.querySelector('table');
        const rows = inner ? [...inner.querySelectorAll('tr')].map((r) => [...r.children].slice(1).map(txt)) : [];
        const units = {};
        const unknown = [];
        if (rows.length >= 5) {
          rows[0].forEach((n, i) => {
            const id = idOf(n);
            const u = { name: n, count: num(rows[1][i]), weapon: num(rows[2][i]), shield: num(rows[3][i]), armour: num(rows[4][i]) };
            if (id == null) unknown.push(u); else units[id] = u;
          });
        }
        out.push({ role: m ? m[1] : null, name: m ? m[2] : head, coords: m ? coords(m[3]) : null, planetTypeShort: m ? (m[4] || null) : null,
          tech: { weapon: tech[0], shield: tech[1], armour: tech[2] }, destroyed: rows.length < 5, units, unknown });
      }
      return out;
    }
    function parseCombatReport(doc) {
      const content = doc.querySelector('#content') || doc.body;
      const box = [...content.children].find((x) => x.tagName === 'DIV' && /text-align:\s*center/.test(x.getAttribute('style') || '')) || content;
      const tables = [...box.children].filter((x) => x.tagName === 'TABLE');
      if (!tables.length) {
        const err = content.querySelector('table td p');
        return { error: err ? txt(err) : txt(content) };   // sys_raport_not_found / sys_raport_lost_contact (printMessage)
      }
      const html = box.innerHTML;
      const head = norm(html.split(/<table/i)[0]);
      const hofTable = [...content.children].find((x) => x.tagName === 'TABLE' && /\bVS\b/.test(x.textContent));
      const rounds = [];
      for (let i = 0; i + 1 < tables.length; i += 2) {
        // fire text between this pair and the next: info[0] info[3] / info[2] info[1] (raport.tpl:131-134)
        let n = tables[i + 1].nextSibling, fire = '';
        while (n && n.nodeName !== 'TABLE') { fire += n.nodeType === 3 ? n.textContent : (n.outerHTML || ''); n = n.nextSibling; }
        const f = i + 2 < tables.length ? nums(norm(fire)) : [];
        rounds.push({ attackers: parseSide(tables[i]), defenders: parseSide(tables[i + 1]),
          fire: f.length >= 4 ? { attackerPower: f[0], defenderShieldAbsorbed: f[1], defenderPower: f[2], attackerShieldAbsorbed: f[3] } : null });
      }
      // tail after the last table: result, [loot], losses x2, debris, moon chance, [moon built]
      const tailHtml = html.slice(html.toLowerCase().lastIndexOf('</table>') + 8);
      const lines = tailHtml.split(/<br\s*\/?>/i).map(norm).filter(Boolean);
      const res = Object.keys(S.won).find((k) => S.won[k].some((t) => lines[0] && lines[0].toLowerCase().startsWith(norm(t).toLowerCase())));
      let i = 1;
      const out = { mode: S.destruc.some((t) => head.startsWith(norm(t))) ? 1 : 0, hallOfFame: !!hofTable, time: (/\d{1,2}\.\s*\S+\s+\d{4},\s*\d{1,2}:\d{2}:\d{2}/.exec(head) || [null])[0],
        wall: parseTdDate(head), result: res || null, resultText: lines[0] || null, loot: null, lost: {}, debris: {}, moonChance: null, moonCreated: false, rounds, tailLines: lines };
      if (hofTable && !out.result) {                       // HoF header colours: lime = winner (raport.tpl:6-8)
        const tds = hofTable.querySelectorAll('td');
        const col = (td) => ((td && td.getAttribute('style')) || '').match(/color:\s*(\w+)/);
        const a = col(tds[0]);
        out.result = a && a[1] === 'lime' ? 'a' : a && a[1] === 'red' ? 'r' : 'w';
      }
      if (out.result === 'a' || (!out.result && nums(lines[1]).length === 3)) { const l = nums(lines[i++]); out.loot = { 901: l[0], 902: l[1], 903: l[2] }; if (!out.result) out.result = 'a'; }
      out.lost.attacker = nums(lines[i++])[0];
      out.lost.defender = nums(lines[i++])[0];
      const d = nums(lines[i++]);
      out.debris = { 901: d[0], 902: d[1] };
      if (out.mode === 0) {
        out.moonChance = nums(lines[i++])[0];
        out.moonCreated = lines.slice(i).some((l) => /\[(\d+:\d+:\d+|XX:XX:XX)\]/.test(l));
      }
      out.roundsFought = Math.max(0, rounds.length - 1);
      out.start = rounds[0] || null;
      out.end = rounds[rounds.length - 1] || null;
      return out;
    }

    // ---------- page=battleHall (page.battleHall.default.tpl) ----------
    function parseBattleHall(doc) {
      return [...doc.querySelectorAll('tr[class^="day"]')].map((tr) => {
        const td = tr.children;
        const a = td[1] && td[1].querySelector('a[href*="raport="]');
        const spans = a ? a.querySelectorAll('span') : [];
        const green = (s) => /#00FF00/i.test(s.getAttribute('style') || '');
        return { rank: num(txt(td[0])), reportId: a ? qs(a.getAttribute('href')).get('raport') : null,
          attacker: spans[0] ? txt(spans[0]) : (txt(a).split(' VS ')[0] || null), defender: spans[1] ? txt(spans[1]) : (txt(a).split(' VS ')[1] || null),
          result: spans.length ? (green(spans[0]) ? 'a' : 'r') : 'w', date: txt(td[2]), wall: parseTdDate(txt(td[2])), units: num(txt(td[3])) };
      });
    }

    // ---------- expedition result (MissionCaseExpedition.class.php:60-513) ----------
    let TEXTS = null;
    function setTexts(json) { TEXTS = json; }
    function expeditionIndex(texts) {
      if (!texts) return [];
      if (texts.__idx) return texts.__idx;
      const idx = [];
      for (const lang of Object.keys(texts)) {
        const e = texts[lang] && texts[lang].expedition;
        if (e) for (const [key, v] of Object.entries(e)) idx.push({ key, lang, outcome: v.outcome, text: expKey(v.text) });
      }
      Object.defineProperty(texts, '__idx', { value: idx, enumerable: false });
      return idx;
    }
    // comparison form of a flavour text: no tags/punctuation, lower case, ё folded to е (an edited ru text often drops the ё)
    const expKey = (s) => norm(String(s || '').replace(/<[^>]*>/g, ' ')).toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    // a prefix match needs this many characters on the shorter side: an empty/short first segment (body starting with <br>)
    // must never match the first table entry (sys_expe_blackholl_1 -> 'fleet_lost' -> botexpo counts the ships as lost)
    const EXP_PREFIX_MIN = 20;
    // keyword fallback for a flavour text the table does not know (edited/Aeternum-specific variant), ru/en. Only dark matter:
    // over the 142 table texts any wider keyword list misfires (a "deserted pirate base" is a ships find, a "black hole" word is
    // not the only fleet loss), and a wrong 'fleet_lost' closes a live trip in botexpo — an unmatched text stays null instead.
    const EXP_FALLBACK = [['darkmatter', /темн\p{L}* матери|dark matter/u]];
    function expeditionFallback(flavor) {
      if (flavor.length < EXP_PREFIX_MIN) return null;
      const f = EXP_FALLBACK.find(([, re]) => re.test(flavor));
      return f ? f[0] : null;
    }
    function parseExpedition(item, texts) {
      texts = texts || TEXTS;
      const b = item.body;
      const parts = b.innerHTML.split(/<br\s*\/?>/i);
      const fi = Math.max(0, parts.findIndex((p) => expKey(p)));   // a body may start with <br>: the flavour is the first non-empty segment
      const flavor = expKey(parts[fi]);
      const idx = expeditionIndex(texts);
      const hit = (flavor && idx.find((x) => x.text === flavor)) || idx.find((x) => x.text && Math.min(x.text.length, flavor.length) >= EXP_PREFIX_MIN && (flavor.startsWith(x.text) || x.text.startsWith(flavor)));
      const fb = hit ? null : expeditionFallback(flavor);
      const out = { outcome: hit ? hit.outcome : fb, key: hit ? hit.key : fb ? 'fallback:' + fb : null, lang: hit ? hit.lang : null, wall: item.wall, ships: null, shipsByName: null };
      if (!hit) {
        // the raw text is the only way to complete the table: keep a sample and raise one learn alert per text
        out.textSample = norm(String(parts[fi] || '').replace(/<[^>]*>/g, ' ')).slice(0, 160);
        if (out.textSample && typeof OGX !== 'undefined' && OGX.learn && OGX.learn.alert) {
          let h = 0; for (const ch of flavor) h = (h * 31 + ch.codePointAt(0)) >>> 0;
          try {
            OGX.learn.alert('expedition-text:' + h.toString(36), `неизвестный текст экспедиции${fb ? ' (по ключевым словам: ' + fb + ')' : ''}: «${out.textSample}»`,
              { kind: 'expedition-text-unknown', data: { text: out.textSample, fallback: fb } });
          } catch (e) { /* learn is optional */ }
        }
      }
      // ships found: "<br>NAME: N" lines; nothing repairable: "<br><br>No ships could be found." (Expedition:194-213)
      const lines = parts.slice(fi + 1).map(norm).filter(Boolean);
      const shipLines = lines.map((l) => /^(.+?):\s*(\d{1,3}(?:\.\d{3})*)$/.exec(l)).filter(Boolean);
      if (shipLines.length || out.outcome === 'ships') {
        out.outcome = out.outcome || 'ships';
        out.ships = {}; out.shipsByName = {};
        for (const m of shipLines) { out.shipsByName[m[1]] = num(m[2]); const id = idOf(m[1]); if (id != null) out.ships[id] = num(m[2]); }
      }
      // amounts of resources / dark matter are NOT in this message; they arrive in the fleet-return message (classify -> 'return_expedition')
      return out;
    }

    // ---------- transport / recycle / stay / returns (FLEET.php sys_tran_mess_*, sys_recy_gotten, sys_stat_mess, sys_fleet_won, sys_expe_back_home) ----------
    function parseFleetText(item, kind) {
      kind = kind || classify(item, null);
      const b = item.body;
      const L = galaxyLinks(b);
      const after = L.length ? textAfter(b, L[L.length - 1].a) : b.textContent;   // planet names (before links) may contain digits
      const n = nums(after);
      const out = { kind, links: L.map((x) => x.coords), wall: item.wall, resources: null, raw: n };
      if (kind === 'missile') return Object.assign(out, parseMissileText(b, L));
      if (kind === 'recycle') out.resources = { 901: n[0], 902: n[1] };
      else if (kind === 'return_expedition') out.resources = { 901: n[0], 902: n[1], 903: n[2], 921: n[3] };
      else if (n.length >= 3) out.resources = { 901: n[n.length - 3], 902: n[n.length - 2], 903: n[n.length - 1] };
      if (kind === 'transport_received') { out.from = L[0] && L[0].coords; out.to = L[1] && L[1].coords; }
      else if (L.length) out.target = L[L.length - 1].coords;
      return out;
    }

    /** Missile impact [UPSTREAM MissionCaseMIP.class.php:86-147, FLEET.php sys_irak_*], the same text for both players:
     * "Interplanetary rockets (N) from NAME [g:s:p] are on the planet NAME [g:s:p]<br><br>K Rockets of yours were intercepted.<br><br>
     * Missile Launcher (- 300)<br>..." -> { missiles, intercepted, destroyed: { defenceId: n }, unknownTitles, from, to } (no resources). */
    function parseMissileText(b, L) {
      const text = b.textContent.replace(/\s+/g, ' ');
      const toN = (x) => +String(x).replace(/[.,\s]/g, '');
      const cnt = /\((\d[\d.,]*)\)/.exec(text);
      const missiles = cnt ? toN(cnt[1]) : null;
      const destroyed = {}, unknownTitles = [];
      const re = /(?:^|<br\s*\/?>)\s*([^<>()]+?)\s*\(\s*-\s*([\d.,]+)\s*\)/g;
      let m;
      while ((m = re.exec(b.innerHTML || ''))) {
        const title = m[1].replace(/&nbsp;/g, ' ').trim();
        const id = idOf(title);
        if (id) destroyed[id] = (destroyed[id] || 0) + toN(m[2]);
        else unknownTitles.push(title);
      }
      let intercepted = null;
      const icp = /(\d[\d.,]*)\s+\D{0,60}?(?:intercepted|сбиты)/i.exec(text);
      if (icp) intercepted = toN(icp[1]);
      else if (/All your rockets were intercepted|Все Ваши межпланетные ракеты были сбиты/i.test(text)) intercepted = missiles;
      else if (Object.keys(destroyed).length || /does not have defences|нет обороны/i.test(text)) intercepted = 0;
      return { resources: null, missiles, intercepted, destroyed, unknownTitles, from: L[0] && L[0].coords, to: L[1] && L[1].coords };
    }

    function parseItem(item, cat, texts) {
      const kind = classify(item, cat);
      let data = null;
      if (kind === 'spy_report') data = parseSpyReport(item.body);
      else if (kind === 'spy_detected') data = parseSpyDetected(item);
      else if (kind === 'combat' || kind === 'combat_expedition') data = parseCombatMessage(item);
      else if (kind === 'expedition') data = parseExpedition(item, texts);
      else if (/^(transport_|recycle|deploy_|return|missile)/.test(kind)) data = parseFleetText(item, kind);
      return { id: item.id, kind, unread: item.unread, date: item.date, wall: item.wall, from: item.from, subject: item.subject, data };
    }

    return { CATEGORIES, NAMES, idOf, num, nums, coords, parseTdDate, setTexts, parseCategories, parseHeaderUnread, parseList, classify, parseSpyReport,
      parseSpyDetected, parseCombatMessage, parseCombatReport, parseBattleHall, parseExpedition, parseFleetText, parseItem };
  })();

  const R = { intFull, intApprox, msgDate, coordsOf, parsePlaceLink, parseMessageList, buildExpeditionIndex, classify, parseEspionageShort,
    parseEspionageFull, parseBattleShort, parseBattleFull, extractCombatData, parseExpedition, parseFleetMessage, parseEspionageDetected, OUTCOME };
  messages._recipes = R;
  messages._matchFleetText = matchFleetText;

  let expIndex = null;
  function expeditionIndex() {
    if (!expIndex) expIndex = buildExpeditionIndex(messages._expTexts || { texts: {} });
    return expIndex;
  }
  messages._expeditionIndex = expeditionIndex;
  /** Server wall text -> ServerMs through OGX.time (tz aware); falls back to the recipe's UTC reading. */
  const wallMs = (s) => { const v = OGX.time && OGX.time.parseServerWall ? OGX.time.parseServerWall(s) : null; return v === null || v === undefined ? msgDate(s) : v; };
  const coordsStr = (c) => (Array.isArray(c) ? c.join(':') : null);
  const withCoordsStr = (p) => (p ? Object.assign({}, p, { coordsStr: coordsStr(p.coords) }) : p);
  const asDoc = (x) => (typeof x === 'string' ? new DOMParser().parseFromString(x, 'text/html') : x);

  // ================================================================== GALAXYZ boundary (core shapes: coords arrays + coordsStr, ts = ServerMs)
  const gz = (messages.gz = {});
  GZ.setTexts(messages._gzTexts || null);
  // numeric messcat; OgameX tab/subtab names map onto the closest category so module calls keep working
  const CAT_BY_NAME = { spy: 0, espionage: 0, player: 1, messages: 1, communication: 1, alliance: 2, combat: 3, combat_reports: 3, system: 4, other: 4,
    transport: 5, expedition: 15, expeditions: 15, game: 50, information: 50, construction: 99, all: 100, fleets: 100, outbox: 999 };
  gz.catOf = (x) => {
    if (x === null || x === undefined || x === '') return null;
    if (Number.isFinite(+x)) return +x;
    const k = String(x).toLowerCase();
    return k in CAT_BY_NAME ? CAT_BY_NAME[k] : null;
  };
  // GALAXYZ kind -> the OgameX classify key modules already know (messages.md §8; kinds without an OgameX twin keep their name)
  const KEY_BY_KIND = {
    spy_report: 'espionage_report', spy_detected: 'espionage_detected', combat: 'battle_report', combat_expedition: 'battle_report',
    missile: 'missile_defense_report', transport_arrival: 'transport_arrived', transport_received: 'transport_received', recycle: 'debris_field_harvest',
    deploy_arrival: 'fleet_deployment_with_resources', return: 'return_of_fleet_with_resources', return_empty: 'return_of_fleet',
    return_expedition: 'return_of_fleet_with_resources', return_expedition_dm: 'return_of_fleet',
  };
  const EXP_KEY = { resources: 'expedition_gain_resources', darkmatter: 'expedition_gain_dark_matter', ships: 'expedition_gain_ships', nothing: 'expedition_failed',
    delay: 'expedition_failed_and_delay', speedup: 'expedition_failed_and_speedup', battle_pirates: 'expedition_battle_pirates', battle_aliens: 'expedition_battle_aliens',
    fleet_lost: 'expedition_loss_of_fleet' };
  /** Recipe { galaxy, system, planet } -> [g, s, p]. */
  const arr = (c) => (c ? [c.galaxy, c.system, c.planet] : null);
  const place = (c, planetType = 1, name = null) => (c ? { coords: arr(c), coordsStr: c.galaxy + ':' + c.system + ':' + c.planet,
    type: planetType === 3 ? 'moon' : planetType === 2 ? 'debris' : 'planet', planetType, name } : null);
  const gameMs = (date) => {
    if (!date) return null;
    const v = OGX.time && OGX.time.parseGameDate ? OGX.time.parseGameDate(date) : null;
    return v === null || v === undefined ? GZ.parseTdDate(date) : v;
  };
  const byRes = (r) => (r ? { metal: r[901] ?? null, crystal: r[902] ?? null, deuterium: r[903] ?? null } : null);
  /** Never throws on unknown markup: logs and returns the fallback (messages.md: UPSTREAM shapes are unverified). */
  const safe = (where, fn, fallback = null) => function (...a) {
    try { return fn.apply(this, a); } catch (e) { log.warn('gz ' + where + ' not parsed:', e && e.message); return fallback; }
  };
  /** true when x is GALAXYZ message markup (or this tab is GALAXYZ). */
  function isGzInput(x) {
    if (OGX.page && OGX.page.isGz && OGX.page.isGz()) return true;
    if (!x || typeof x !== 'object') return typeof x === 'string' && /messagestable|spyRaport|raportMessage|message_head/.test(x);
    if (x.body !== undefined && x.subject !== undefined && x.id !== undefined) return true;   // a gz list item
    const el = x.documentElement || x;
    try {
      return !!(el.matches && el.matches('tr.message_head, tr.messages_body, .spyRaport, .raportMessage'))
        || !!(el.querySelector && el.querySelector('#messagestable, tr.message_head, .spyRaport, .raportMessage'))
        || !!(el.closest && el.closest('tr.messages_body, #messagestable'));
    } catch (e) { return false; }
  }
  gz.isGzInput = isGzInput;

  /** One message row (tr.message_head + tr.messages_body, page.messages.view.tpl:34-107) -> recipe item; also from the body tr/td or an element inside. */
  function rowItem(x) {
    if (!x) return null;
    if (x.body !== undefined && x.subject !== undefined) return x;
    let head = null;
    if (x.matches && x.matches('tr.message_head')) head = x;
    else {
      const bodyTr = x.matches && x.matches('tr.messages_body') ? x : x.closest ? x.closest('tr.messages_body') : null;
      head = bodyTr && bodyTr.previousElementSibling && bodyTr.previousElementSibling.matches('tr.message_head') ? bodyTr.previousElementSibling : null;
    }
    if (!head) return x.querySelector ? { id: null, unread: false, selectable: false, date: '', wall: null, from: '', subject: '', senderId: null, body: x } : null;
    // parseList reads one table: wrap the pair in a throw-away table so a single row parses the same way
    const doc = head.ownerDocument;
    const t = doc.createElement('table');
    t.id = 'messagestable';
    const tb = doc.createElement('tbody');
    t.appendChild(tb);
    const bodyTr = head.nextElementSibling && head.nextElementSibling.matches('tr.messages_body') ? head.nextElementSibling : null;
    tb.appendChild(head.cloneNode(true));
    if (bodyTr) tb.appendChild(bodyTr.cloneNode(true));
    const wrap = doc.createElement('div');
    wrap.appendChild(t);
    const it = GZ.parseList(wrap).items[0];
    if (it) it.body = bodyTr ? bodyTr.querySelector('td') : null;   // the live body, not the clone
    if (it) { it.li = head; it.cat = catOfRow(head); }
    return it || null;
  }
  const catOfRow = (head) => {
    const form = head && head.closest && head.closest('form');
    const i = form && form.querySelector('input[name="messcat"]');
    return i ? gz.catOf(i.value) : null;
  };
  gz.item = rowItem;

  gz.categories = safe('categories', (doc = document) => GZ.parseCategories(asDoc(doc)), []);
  gz.headerUnread = safe('headerUnread', (doc = document) => GZ.parseHeaderUnread(asDoc(doc)), 0);
  /** #messagestable (page after a category click, or the mode=view fragment) -> { cat, page, pages, items } | null; raw recipe items. */
  gz.list = safe('list', (doc = document) => GZ.parseList(asDoc(doc)), null);
  /** Native GALAXYZ kind: 'spy_report', 'spy_detected', 'combat', 'combat_expedition', 'expedition', 'transport_arrival', 'recycle', 'return', ... */
  gz.classify = safe('classify', (x, cat) => { const it = rowItem(x); return it ? GZ.classify(it, gz.catOf(cat ?? it.cat)) : 'unknown'; }, 'unknown');
  gz.parseItem = safe('item', (x, cat) => { const it = rowItem(x); return it ? GZ.parseItem(it, gz.catOf(cat ?? it.cat)) : null; });
  gz.spyReport = safe('spyReport', (el) => GZ.parseSpyReport(el && el.body !== undefined && el.subject !== undefined ? el.body : asDoc(el)));
  gz.combatMessage = safe('combatMessage', (x) => GZ.parseCombatMessage(rowItem(x) || x));
  gz.combatReport = safe('combatReport', (doc) => GZ.parseCombatReport(asDoc(doc)));
  gz.battleHall = safe('battleHall', (doc) => GZ.parseBattleHall(asDoc(doc)), []);
  gz.expedition = safe('expedition', (x) => GZ.parseExpedition(rowItem(x)));
  gz.fleetText = safe('fleetText', (x, kind) => GZ.parseFleetText(rowItem(x), kind));
  gz.idOf = GZ.idOf;
  gz.parseTdDate = GZ.parseTdDate;
  gz.CATEGORIES = GZ.CATEGORIES;
  // ---------- OgameX-compatible tab/subtab aliases (modules written for OgameX filter on these) ----------
  // category of a native kind (rows of cat 100 "All" / unknown carry no category of their own)
  const CAT_BY_KIND = { spy_report: 0, spy_detected: 0, combat: 3, combat_expedition: 3, missile: 3, expedition: 15,
    transport_arrival: 5, transport_received: 5, recycle: 5, deploy_arrival: 5, return: 4, return_empty: 4, return_expedition: 4,
    return_expedition_dm: 4, colonisation: 4, system: 4, construction: 99, player: 1, alliance: 2, game: 50, outbox: 999 };
  const ALIAS_BY_CAT = { 0: ['fleets', 'espionage'], 3: ['fleets', 'combat_reports'], 15: ['fleets', 'expeditions'], 5: ['fleets', 'transport'],
    4: ['fleets', 'other'], 50: ['fleets', 'other'], 99: ['fleets', 'other'], 1: ['communication', 'messages'], 2: ['communication', 'messages'],
    999: ['communication', 'messages'] };
  /**
   * GALAXYZ (kind, messcat) -> { cat (the row's own category: messcat, or from the kind when the list is 100/unknown), catName
   * ('spy','combat',...), tab, subtab } with OgameX names: spy -> fleets/espionage, combat -> fleets/combat_reports, expedition ->
   * fleets/expeditions, transport -> fleets/transport, system/game/construction -> fleets/other, player/alliance/outbox ->
   * communication/messages. Unknown -> fleets/other.
   */
  gz.aliasOf = function (kind, cat) {
    let c = gz.catOf(cat);
    if (c === null || c === 100 || !(c in GZ.CATEGORIES)) c = kind in CAT_BY_KIND ? CAT_BY_KIND[kind] : null;
    const a = (c !== null && ALIAS_BY_CAT[c]) || ['fleets', 'other'];
    return { cat: c, catName: c !== null ? GZ.CATEGORIES[c] || null : null, tab: a[0], subtab: a[1] };
  };
  /** URL / POST body builders (no network). actionBody mirrors the REAL form (mode, ajax, messcat, side, actionTop, submitTop=Confirm). */
  // absolute on a GALAXYZ tab (page.url), relative 'game.php?..' elsewhere (fixtures, tests)
  const gzUrl = (name, q) => (OGX.page.isGz() ? OGX.page.url(name, q)
    : 'game.php?' + new URLSearchParams(Object.assign({ page: name }, q)).toString());
  gz.urls = {
    view: (cat, site) => gzUrl('messages', { mode: 'view', messcat: cat, site: site || 1, ajax: 1 }),
    page: (cat, side) => gzUrl('messages', cat !== null && cat !== undefined ? { category: cat, side: side || 1 } : {}),
    raport: (rid) => gzUrl('raport', { raport: rid }),
    actionBody: (action, ids, cat, side) => {
      const body = new URLSearchParams({ mode: 'action', ajax: '1', messcat: String(cat === null || cat === undefined ? 100 : cat), side: String(side || 1), actionTop: action, submitTop: 'Confirm' });
      (ids || []).forEach((id) => body.append('messageID[' + id + ']', '1'));
      return body;
    },
  };

  /** OgameX classify key for a GALAXYZ row / item (expedition results by outcome: expedition_gain_resources, ... expedition_unknown). */
  function gzKey(kind, data) {
    if (kind === 'expedition') return (data && EXP_KEY[data.outcome]) || 'expedition_unknown';
    return KEY_BY_KIND[kind] || kind;
  }
  gz.keyOf = gzKey;
  /** Spy report (recipe) -> the OgameX espionageFull shape (+ exact, probesDestroyed, reportDate, gz: raw). No player/debris in GALAXYZ reports. */
  function spyShape(r, it) {
    if (!r) return null;
    const res = r.resources ? Object.assign(byRes(r.resources), { energy: r.resources[911] ?? null }) : null;
    const items = (k) => Object.assign({}, r[k] || {});
    const date = it && it.date ? it.date : null;
    return {
      id: it && it.id ? it.id : null, title: r.title, date, ts: date ? gameMs(date) : null,
      target: place(r.coords, r.planetType || 1, r.targetName || null),
      attackParams: r.coords ? { galaxy: r.coords.galaxy, system: r.coords.system, position: r.coords.planet, type: r.planetType || 1 } : null,
      player: null, counterEspionage: r.discoveryChance, probesDestroyed: r.destroyed,
      resources: res, debris: null,
      ships: items('fleet'), defense: items('defense'), buildings: items('buildings'), research: items('research'),
      known: { ships: !!r.revealed.fleet, defense: !!r.revealed.defense, buildings: !!r.revealed.buildings, research: !!r.revealed.research },
      exact: r.exact, unknownNames: r.unknownNames,
      reportDate: r.reportDateText, reportWall: r.reportWall,   // probes' RETURN time in the TARGET's zone: another clock (messages.md §6.5)
      gz: r,
    };
  }
  /** Combat message in the list (recipe) -> battleShort-like shape [UPSTREAM, unverified]. */
  function battleShape(r, it) {
    if (!r) return null;
    const loot = byRes(r.loot);
    const debris = r.debris ? { metal: r.debris[901] ?? null, crystal: r.debris[902] ?? null } : null;
    const sum = (o) => (o ? Object.values(o).reduce((s, v) => s + (+v || 0), 0) : null);
    const date = it && it.date ? it.date : null;
    return {
      id: it && it.id ? it.id : null, date, ts: date ? gameMs(date) : null,
      reportId: r.reportId, detailsUrl: r.reportId ? gz.urls.raport(r.reportId) : null, expedition: r.isExpedition,
      coords: r.coordsStr, defenderPlace: place(r.coords, r.planetTypeShort === 'M' ? 3 : 1),
      attacker: { name: null, losses: r.lost.attacker, lossesApprox: r.lost.attacker, mark: null },
      defender: { name: null, losses: r.lost.defender, lossesApprox: r.lost.defender, mark: null },
      winner: r.winner, myResult: r.myResult, myRole: r.myRole,
      loot, lootSum: sum(loot), lootApprox: sum(loot), lootPct: null, lootPercent: null,
      debris, debrisSum: sum(debris), debrisTotalApprox: sum(debris), repaired: null, moonChance: null,
      unverified: true, gz: r,
    };
  }
  /** page=raport popup (recipe) -> battleFull-like shape [UPSTREAM, unverified]: units keyed by id where the name is known. */
  function battleFullShape(r) {
    if (!r) return null;
    if (r.error) return { error: r.error, unverified: true, gz: r };
    const count = (sides) => {
      const o = {};
      for (const p of sides || []) for (const [id, u] of Object.entries(p.units || {})) o[id] = (o[id] || 0) + (+u.count || 0);
      return o;
    };
    const start = r.start ? { attacker: count(r.start.attackers), defender: count(r.start.defenders) } : null;
    const end = r.end ? { attacker: count(r.end.attackers), defender: count(r.end.defenders) } : null;
    const lost = (sd) => {
      if (!start || !end) return null;
      const o = {};
      for (const [k, v] of Object.entries(start[sd])) { const d = v - (end[sd][k] || 0); if (d) o[k] = d; }
      return o;
    };
    const side = (list, won) => {
      const p = (list || [])[0] || {};
      return { name: p.name || null, coords: arr(p.coords), mark: won === null ? 'middlemark' : won ? 'undermark' : 'overmark',
        weapons: p.tech ? p.tech.weapon : null, shields: p.tech ? p.tech.shield : null, armour: p.tech ? p.tech.armour : null,
        participants: (list || []).map((x) => ({ name: x.name, coords: arr(x.coords) })) };
    };
    const aWon = r.result === 'a' ? true : r.result === 'r' ? false : null;
    const first = r.start || {};
    const def = (first.defenders || [])[0];
    return {
      id: null, date: r.time, ts: r.time ? gameMs(r.time) : null, mode: r.mode, hallOfFame: r.hallOfFame,
      winner: r.result === 'a' ? 'attacker' : r.result === 'r' ? 'defender' : r.result === 'w' ? 'draw' : null,
      defenderPlanet: { coords: def ? arr(def.coords) : null },
      loot: byRes(r.loot), debris: r.debris ? { metal: r.debris[901] ?? null, crystal: r.debris[902] ?? null } : null,
      lostUnitsValue: r.lost, recyclersNeeded: null, moonChance: r.moonChance, moonCreated: r.moonCreated,
      attacker: side(first.attackers, aWon), defender: side(first.defenders, aWon === null ? null : !aWon),
      rounds: r.roundsFought, start, end, unitsLost: { attacker: lost('attacker'), defender: lost('defender') },
      unverified: true, gz: r,
    };
  }
  /** Expedition result (recipe) -> parse.expedition shape [UPSTREAM texts en/ru, unverified]. Amounts arrive in the return message. */
  function expeditionShape(r, it) {
    if (!r) return null;
    const date = it && it.date ? it.date : null;
    const out = { id: it && it.id ? it.id : null, ts: date ? gameMs(date) : null, key: gzKey('expedition', r), outcome: r.outcome || 'unknown',
      textKey: r.key, lang: r.lang, unverified: true, gz: r };
    if (r.textSample) out.textSample = r.textSample;
    if (r.ships) out.ships = r.ships;
    if (r.shipsByName) out.shipsByName = r.shipsByName;
    return out;
  }
  /** Transport / recycle / deploy / return / missile text (recipe) -> parse.fleetMessage shape [UPSTREAM, unverified]. */
  function fleetShape(r, it, key) {
    if (!r) return null;
    const date = it && it.date ? it.date : null;
    const L = (r.links || []).map((c) => place(c));
    let from = null, to = null;
    if (r.kind === 'transport_received' || r.kind === 'missile') { from = L[0] || null; to = L[1] || null; }
    else if (r.kind === 'transport_arrival' || r.kind === 'deploy_arrival') to = L[L.length - 1] || null;
    else if (/^return/.test(r.kind)) from = L[L.length - 1] || null;   // "returns from the planet NAME [g:s:p]"
    const out = { id: it && it.id ? it.id : null, key: key || gzKey(r.kind), kind: r.kind, ts: date ? gameMs(date) : null, from, to, unverified: true, gz: r };
    if (r.resources) {
      out.resources = byRes(r.resources);
      if (r.resources[921] !== undefined) out.darkMatter = r.resources[921];
    }
    // recycle report (sys_recy_gotten: "... collect M metal and C crystal", ru «... переработал M металла и C кристалла»): the same
    // harvest object as OgameX, so botdebris' own-harvest calibration works in any UI language (its text regex is English-only)
    if (r.kind === 'recycle' && r.resources && Number.isFinite(r.resources[901]) && Number.isFinite(r.resources[902])) {
      out.harvest = { ship: null, ships: null, capacity: null, field: null, harvested: { metal: r.resources[901], crystal: r.resources[902] } };
    }
    if (r.kind === 'missile') Object.assign(out, { missiles: r.missiles, intercepted: r.intercepted, destroyed: Object.assign({}, r.destroyed || {}), unknownTitles: r.unknownTitles || [] });
    return out;
  }
  gz._shapes = { spyShape, battleShape, battleFullShape, expeditionShape, fleetShape };

  // ================================================================== public API (both engines)
  messages.classify = (li, subtab) => {
    if (isGzInput(li)) {
      const it = rowItem(li);
      if (!it) return 'unknown';
      const kind = gz.classify(it, subtab ?? it.cat);
      return gzKey(kind, kind === 'expedition' ? gz.expedition(it) : null);
    }
    return classify(li, subtab, expeditionIndex());
  };

  // rows seen in lists (fetchList / parse.list / watch) by id, so fetchDetail / full can find a message without another list request
  const rowCache = new Map();
  const ROW_CACHE_MAX = 600;
  function rememberRow(id, tr) {
    if (!id || !tr) return;
    rowCache.delete(id);
    rowCache.set(id, tr);
    while (rowCache.size > ROW_CACHE_MAX) rowCache.delete(rowCache.keys().next().value);
  }
  /** tr.message_head of message id: this page first, then rows of lists parsed in this tab. */
  function findRow(id) {
    const n = +id;
    if (!n) return null;
    const el = typeof document !== 'undefined' ? document.getElementById('message_' + n) : null;
    if (el && el.matches('tr.message_head')) return el;
    return rowCache.get(n) || null;
  }
  gz.findRow = findRow;
  /** GALAXYZ list -> parse.list items: recipe fields + key, kind, isNew, sender, li (tr.message_head), cat, ts (USER zone date -> ServerMs). */
  function gzListItems(doc) {
    const l = gz.list(doc);
    const items = [];
    if (l) {
      const form = doc.querySelector('table#messagestable, table[id="messagestable"]');
      const heads = form ? Array.from(form.querySelectorAll('tr.message_head[id^="message_"]')) : [];
      l.items.forEach((m, i) => {
        m.cat = l.cat; m.li = heads[i] || null;
        const kind = gz.classify(m, l.cat);
        const al = gz.aliasOf(kind, l.cat);
        Object.assign(m, { kind, key: gzKey(kind, kind === 'expedition' ? gz.expedition(m) : null), ts: gameMs(m.date), isNew: m.unread, sender: m.from, title: m.subject,
          tab: al.tab, subtab: al.subtab, catName: al.catName, rowCat: al.cat });
        if (m.li) rememberRow(m.id, m.li);
        items.push(m);
      });
    }
    items.page = l ? l.page : 1;
    items.totalPages = l ? l.pages : 1;
    items.cat = l ? l.cat : null;
    items.messages = items;
    return items;
  }
  gz.listItems = gzListItems;

  const parse = (messages.parse = {});
  /** List response -> array of items (recipe fields + isNew, sender, li); the array also carries .page, .totalPages and .messages. */
  parse.list = function (doc) {
    doc = asDoc(doc);
    if (isGzInput(doc)) return gzListItems(doc);
    const r = parseMessageList(doc);
    const lis = Array.from(doc.querySelectorAll('li.msg[data-msg-id]'));
    const items = r.messages.map((m, i) => Object.assign(m, { ts: m.date ? wallMs(m.date) : m.ts, isNew: m.unread, sender: m.from, li: lis[i] }));
    items.page = r.page;
    items.totalPages = r.totalPages;
    items.messages = items;
    return items;
  };
  parse.placeLink = (a) => {
    // GALAXYZ bodies: <a href="game.php?page=galaxy&galaxy=G&system=S">[g:s:p]</a> (no icon, no name inside the link)
    if (a && !a.querySelector('figure') && /page=galaxy/.test(a.getAttribute('href') || '')) return place(GZ.coords(a.textContent));
    return withCoordsStr(parsePlaceLink(a));
  };
  /** GALAXYZ: the list row holds the FULL report, so the short form is the full one with the OgameX short field names. */
  parse.espionageShort = function (li) {
    if (isGzInput(li)) {
      const r = parse.espionageFull(li);
      return r ? Object.assign(r, { resourcesApprox: r.resources, resourcesTotalInclEnergy: r.resources ? Object.values(r.resources).reduce((s, v) => s + (+v || 0), 0) : null,
        total: r.resources ? (+r.resources.metal || 0) + (+r.resources.crystal || 0) + (+r.resources.deuterium || 0) : null, detailsUrl: null }) : null;
    }
    const r = parseEspionageShort(li);
    return Object.assign(r, { target: withCoordsStr(r.target), resources: r.resourcesApprox, total: r.resourcesTotalInclEnergy });
  };
  parse.espionageFull = function (doc) {
    if (isGzInput(doc)) {
      // a row / item / body / document: the first .spyRaport inside, with the id and date of its message row
      let it = doc && doc.body !== undefined && doc.subject !== undefined ? doc : null;
      if (!it && doc && doc.matches && doc.matches('tr.message_head, tr.messages_body')) it = rowItem(doc);
      const root = it ? it.body : asDoc(doc);
      const sr = root && (root.matches && root.matches('.spyRaport') ? root : root.querySelector ? root.querySelector('.spyRaport') : null);
      if (!sr) return null;
      return safe('espionageFull', () => {
        const out = spyShape(GZ.parseSpyReport(sr), it || rowItem(sr));
        // the report's own simulator link (im[] = the raw float values of the report)
        const sim = sr.querySelector('.spyRaportFooter a[href*="page=battleSimulator"]');
        if (out) out.simHref = sim ? sim.getAttribute('href') : null;
        return out;
      })();
    }
    const r = parseEspionageFull(asDoc(doc));
    r.target = withCoordsStr(r.target);
    if (r.date) r.ts = wallMs(r.date);
    return r;
  };
  parse.battleShort = function (li) {
    if (isGzInput(li)) return safe('battleShort', () => { const it = rowItem(li); return battleShape(GZ.parseCombatMessage(it), it); })();
    const r = parseBattleShort(li);
    const date = li.querySelector('.msg_date');
    const ds = date ? date.textContent.replace(/\s+/g, ' ').trim() : null;
    return Object.assign(r, {
      date: ds, ts: ds ? wallMs(ds) : null,
      coords: r.defenderPlace ? coordsStr(r.defenderPlace.coords) : null,
      attacker: Object.assign(r.attacker, { losses: r.attacker.lossesApprox }),
      defender: Object.assign(r.defender, { losses: r.defender.lossesApprox }),
      lootSum: r.lootApprox, lootPct: r.lootPercent, debrisSum: r.debrisTotalApprox,
    });
  };
  parse.battleFull = function (doc, html) {
    const d = asDoc(doc);
    // GALAXYZ: the page=raport popup (shared.mission.raport.tpl) [UPSTREAM]; html is not needed (no combatData JSON)
    if (OGX.page.isGz() || (d && d.querySelector && !d.querySelector('.detail_msg') && (OGX.parse.gz.is(d) || d.querySelector('body.popup, #content')))) {
      return safe('battleFull', () => {
        const r = GZ.parseCombatReport(d);
        // a printMessage page (sys_raport_not_found / sys_raport_lost_contact) can hold a table too: no rounds, no result = error
        if (r && !r.error && !r.result && !(r.rounds || []).length) {
          const p = d.querySelector('#content td p, td p, .mainRS p');
          return battleFullShape({ error: p ? p.textContent.replace(/\s+/g, ' ').trim() : 'no combat report' });
        }
        return battleFullShape(r);
      })();
    }
    const r = parseBattleFull(d, html || (typeof doc === 'string' ? doc : d.documentElement ? d.documentElement.outerHTML : ''));
    if (r.date) r.ts = wallMs(r.date);
    return r;
  };
  parse.expedition = function (li) {
    if (isGzInput(li)) return safe('expedition', () => { const it = rowItem(li); return expeditionShape(GZ.parseExpedition(it), it); })();
    const r = parseExpedition(li, expeditionIndex());
    const date = li.querySelector('.msg_date');
    if (date) r.ts = wallMs(date.textContent.replace(/\s+/g, ' ').trim());
    if (r.shipsByName) {
      const ships = {};
      for (const [name, n] of Object.entries(r.shipsByName)) { const id = OGX.catalog.idFromTitle(name); if (id) ships[id] = (ships[id] || 0) + n; }
      r.ships = ships;
    }
    return r;
  };
  parse.fleetMessage = function (li, key) {
    if (isGzInput(li)) {
      return safe('fleetMessage', () => {
        const it = rowItem(li);
        const kind = GZ.classify(it, it.cat ?? null);
        return fleetShape(GZ.parseFleetText(it, kind), it, key);
      })();
    }
    const r = parseFleetMessage(li, key || messages.classify(li, 'other'));
    const date = li.querySelector('.msg_date');
    if (date) r.ts = wallMs(date.textContent.replace(/\s+/g, ' ').trim());
    r.from = withCoordsStr(r.from); r.to = withCoordsStr(r.to);
    if (r.field || r.harvested) r.harvest = { ship: r.ship, ships: r.shipAmount, capacity: r.capacity, field: r.field, harvested: r.harvested };
    return r;
  };
  parse.espionageDetected = function (li) {
    if (isGzInput(li)) {
      // "A hostile fleet of the planet NAME[g:s:p] was sighted near your planet NAME [g:s:p]": no player, no chance [UPSTREAM]
      return safe('espionageDetected', () => {
        const it = rowItem(li);
        const r = GZ.parseSpyDetected(it);
        const from = place(r.from, r.fromMoon ? 3 : 1);
        const target = place(r.target);
        return { id: it.id, ts: gameMs(it.date), from, target, to: target, attackerName: null, spyName: null, counterEspionage: null, chance: null,
          fromText: r.fromText, unverified: true };
      })();
    }
    const r = parseEspionageDetected(li);
    const date = li.querySelector('.msg_date');
    if (date) r.ts = wallMs(date.textContent.replace(/\s+/g, ' ').trim());
    return Object.assign(r, { from: withCoordsStr(r.from), target: withCoordsStr(r.target), to: withCoordsStr(r.target), spyName: r.attackerName, chance: r.counterEspionage });
  };

  // ------------------------------------------------------------------ fetching
  /**
   * GALAXYZ: tab = messcat (number, or an OgameX tab/subtab name: subtab wins when it maps, e.g. ('fleets', 'espionage') -> 0);
   * GET ?page=messages&mode=view&messcat&site&ajax=1. WARNING: the server marks every listed message read (messages.md §1).
   */
  messages.fetchList = async function (tab, subtab, page = 1, opts = {}) {
    if (OGX.page.isGz()) {
      const cat = gz.catOf(subtab) ?? gz.catOf(tab) ?? 100;
      const r = await OGX.api.messagesList(cat, null, page, opts);
      if (r.error) return r;
      const items = gzListItems(r.doc);
      return { items: items.map((m) => ({ id: m.id, li: m.li, item: m })), page: items.page, pages: items.totalPages, cat: items.cat ?? cat, doc: r.doc };
    }
    const r = await OGX.api.messagesList(tab, subtab, page, opts);
    if (r.error) return r;
    const items = parse.list(r.doc);
    return { items: items.map((m) => ({ id: m.id, li: m.li, item: m })), page: items.page, pages: items.totalPages, doc: r.doc };
  };
  /** A detached document holding only this message (head + body rows, messcat form) so every parse.* accepts it. */
  function rowDoc(tr) {
    const d = document.implementation.createHTMLDocument('message');
    const form = d.createElement('form');
    const cat = catOfRow(tr);
    const inp = d.createElement('input');
    inp.type = 'hidden'; inp.name = 'messcat'; inp.value = cat === null ? '100' : String(cat);
    form.appendChild(inp);
    const t = d.createElement('table');
    t.id = 'messagestable';
    const tb = d.createElement('tbody');
    tb.appendChild(d.importNode(tr, true));
    const bodyTr = tr.nextElementSibling && tr.nextElementSibling.matches('tr.messages_body') ? tr.nextElementSibling : null;
    if (bodyTr) tb.appendChild(d.importNode(bodyTr, true));
    t.appendChild(tb);
    form.appendChild(t);
    d.body.appendChild(form);
    return d;
  }
  /** GALAXYZ: full data of one message row. Spy reports are complete in the row; combat -> page=raport (one GET, [UPSTREAM]). */
  async function gzFull(tr, opts = {}) {
    const it = rowItem(tr);
    if (!it) return { error: 'message row not parsed', status: 0 };
    const kind = gz.classify(it, it.cat);
    const key = gzKey(kind, kind === 'expedition' ? gz.expedition(it) : null);
    const base = { id: it.id, kind, key, item: it };
    if (kind === 'spy_report') return Object.assign(base, { full: parse.espionageFull(it), source: 'row' });
    if (kind === 'combat' || kind === 'combat_expedition') {
      const short = parse.battleShort(it);
      if (!short || !short.reportId) return Object.assign(base, { full: null, short, source: 'row', error: 'combat message without a report link' });
      if (opts.raport === false) return Object.assign(base, { full: null, short, source: 'row' });
      const r = await OGX.api.raport(short.reportId, { background: opts.background });
      if (r.error) return Object.assign(base, { short, error: r.error, status: r.status, loggedOut: r.loggedOut });
      const full = parse.battleFull(r.doc);
      if (full && !full.error) { full.id = it.id; full.reportId = short.reportId; }   // the raport page carries no message id
      return Object.assign(base, { full, short, source: 'raport', doc: r.doc, html: r.html, reportId: short.reportId });
    }
    let full = null;
    if (kind === 'expedition') full = parse.expedition(it);
    else if (kind === 'spy_detected') full = parse.espionageDetected(it);
    else if (/^(transport|recycle|deploy|return|missile)/.test(kind)) full = parse.fleetMessage(it);
    else full = gz.parseItem(it);
    return Object.assign(base, { full, source: 'row' });
  }
  /**
   * OgameX: GET /ajax/messages/<id> -> { doc, html }. GALAXYZ: there is no per-message endpoint; the message must be in a list
   * already loaded in this tab (the open /messages page, fetchList, parse.list, watch). -> { doc (a document with just this row:
   * every parse.* accepts it), html, id, kind, key, item, full (parsed: espionageFull | battleFull from page=raport | expedition |
   * fleetMessage | ...), source: 'row'|'raport' } | { error, notFound: true } (not loaded: call fetchList for its category first).
   * Combat: the report itself is fetched (GET page=raport&raport=ID, background when opts.background); then doc/html = the raport page.
   */
  messages.fetchDetail = async function (id, tab, subtab, opts = {}) {
    if (OGX.page.isGz()) {
      const tr = findRow(id);
      if (!tr) return { error: 'GALAXYZ: message ' + id + ' is not in a loaded list (fetchList its category first)', status: 0, notFound: true };
      const r = await gzFull(tr, opts);
      if (r.error && !r.short) return r;
      if (!r.doc) { r.doc = rowDoc(tr); r.html = r.doc.documentElement.outerHTML; }
      return r;
    }
    const r = await OGX.api.message(id, tab, subtab, opts);
    if (r.error) return r;
    return { doc: r.doc, html: r.html };
  };
  /**
   * Full parsed message, both engines: x = MessageItem (watch / fetchList item) | li / tr.message_head | id (+ opts.tab/subtab on OgameX).
   * -> { id, kind (GALAXYZ native kind | OgameX key), key (OgameX classify key), full, source: 'row'|'raport'|'detail' } | { error }.
   * full = parse.espionageFull shape for spy reports, parse.battleFull shape for combat (GALAXYZ: page=raport [UPSTREAM]), parse.expedition /
   * fleetMessage / espionageDetected for the others. opts: { background, raport: false (GALAXYZ: no raport request) }.
   */
  messages.full = async function (x, opts = {}) {
    const id = typeof x === 'number' || typeof x === 'string' ? +x : x && x.id !== undefined && x.id !== null ? +x.id : null;
    const el = x && typeof x === 'object' ? (x.nodeType === 1 ? x : x.li || null) : null;
    if (OGX.page.isGz()) {
      const tr = el && el.matches && el.matches('tr.message_head') ? el : findRow(id);
      if (!tr) return { error: 'GALAXYZ: message ' + id + ' is not in a loaded list', notFound: true };
      const r = await gzFull(tr, opts);
      return { id: r.id ?? id, kind: r.kind, key: r.key, full: r.full ?? null, source: r.source || null, ...(r.error ? { error: r.error } : {}), ...(r.short ? { short: r.short } : {}) };
    }
    const li = el || (typeof document !== 'undefined' ? document.querySelector('li.msg[data-msg-id="' + id + '"]') : null);
    const loc = li ? locate(li) : { tab: opts.tab || null, subtab: opts.subtab || null };
    const key = li ? messages.classify(li, loc.subtab) : opts.key || null;
    if (key === 'espionage_report' || key === 'battle_report') {
      const r = await messages.fetchDetail(id, loc.tab || 'fleets', loc.subtab || (key === 'battle_report' ? 'combat_reports' : 'espionage'), opts);
      if (r.error) return Object.assign({ id, kind: key, key }, r);
      return { id, kind: key, key, full: key === 'battle_report' ? parse.battleFull(r.doc, r.html) : parse.espionageFull(r.doc), source: 'detail' };
    }
    if (!li) return { id, kind: key, key, error: 'message not on this page' };
    let full = null;
    if (/^expedition/.test(key || '')) full = parse.expedition(li);
    else if (key === 'espionage_detected') full = parse.espionageDetected(li);
    else full = parse.fleetMessage(li, key);
    return { id, kind: key, key, full, source: 'row' };
  };
  /** GALAXYZ combat report by its report id (32 hex) -> { reportId, full: parse.battleFull shape, doc, html } | { error }. */
  messages.fetchRaport = async function (reportId, opts = {}) {
    const r = await OGX.api.raport(reportId, opts);
    if (r.error) return r;
    return { reportId: r.reportId, full: parse.battleFull(r.doc), doc: r.doc, html: r.html };
  };
  messages.delete = (id, opts) => OGX.api.deleteMessage(id, opts);

  // ------------------------------------------------------------------ watcher (/messages page)
  const PANEL_SUBTAB = { 'ui-id-14': 'espionage', 'ui-id-16': 'combat_reports', 'ui-id-18': 'expeditions', 'ui-id-20': 'transport', 'ui-id-22': 'other',
    'ui-id-32': 'messages', 'ui-id-34': 'information' };
  const PANEL_TAB = { 'ui-id-2': 'fleets', 'ui-id-4': 'communication', 'ui-id-6': 'economy', 'ui-id-8': 'universe', 'ui-id-10': 'system', 'ui-id-12': 'favorites' };
  function locate(li) {
    let tab = null, subtab = null, panel = null;
    for (let el = li.parentElement; el; el = el.parentElement) {
      if (!el.id) continue;
      if (!subtab && PANEL_SUBTAB[el.id]) { subtab = PANEL_SUBTAB[el.id]; panel = panel || el; }
      if (PANEL_TAB[el.id]) { tab = PANEL_TAB[el.id]; panel = panel || el; break; }
    }
    if (!subtab && tab && tab !== 'fleets' && tab !== 'communication') subtab = tab;
    if (!tab && subtab) tab = ['messages', 'information'].includes(subtab) ? 'communication' : 'fleets';
    return { tab, subtab, panel };
  }
  messages._locate = locate;
  const watchers = new Set();
  let seen = null, watchOff = null;
  /**
   * GALAXYZ row -> MessageItem { id, tab, subtab (OgameX aliases, gz.aliasOf: 'fleets'/'espionage', 'fleets'/'combat_reports', ...,
   * 'communication'/'messages'), cat (numeric messcat of the list: 0, 3, ..., 100 for "All"), rowCat (the row's own category, also
   * in cat 100 lists), catName (GALAXYZ name: 'spy', 'combat', 'expedition', ...), kind (native: 'spy_report', 'combat', ...),
   * key (OgameX classify key: 'espionage_report', ...), engine: 'galaxyz', li: tr.message_head, isNew, panel: form, body: td }.
   */
  function gzWatchItem(tr) {
    const cat = catOfRow(tr);
    const bodyTr = tr.nextElementSibling && tr.nextElementSibling.matches('tr.messages_body') ? tr.nextElementSibling : null;
    const id = parseInt(tr.id.replace('message_', ''), 10);
    let kind = 'unknown', key = 'unknown';
    try {
      const it = rowItem(tr);
      kind = it ? gz.classify(it, cat) : 'unknown';
      key = gzKey(kind, kind === 'expedition' && it ? gz.expedition(it) : null);
    } catch (e) { log.warn('gz watch classify', id, e && e.message); }
    const al = gz.aliasOf(kind, cat);
    rememberRow(id, tr);
    return { id, tab: al.tab, subtab: al.subtab, cat, rowCat: al.cat, catName: al.catName, kind, key, engine: 'galaxyz', li: tr,
      isNew: tr.classList.contains('mes_unread'), panel: tr.closest('form'), body: bodyTr ? bodyTr.querySelector('td') : null };
  }
  const GZ_ROWS = '#messagestable tr.message_head[id^="message_"]';
  function scanGz() {
    // the list is inserted by the game's AJAX after a category click (Message.getMessages), the old table is removed
    for (const tr of document.querySelectorAll(GZ_ROWS)) {
      if (seen.has(tr)) continue;
      seen.add(tr);
      const item = gzWatchItem(tr);
      for (const fn of watchers) fn(item);
      OGX.bus.emit('messages:item', item);
    }
  }
  function scan() {
    if (OGX.page.isGz()) return scanGz();
    for (const li of document.querySelectorAll('li.msg[data-msg-id]')) {
      const id = parseInt(li.dataset.msgId, 10);
      // pagination replaces the panel: a new element with a seen id is still the same message
      if (seen.has(li)) continue;
      seen.add(li);
      const { tab, subtab, panel } = locate(li);
      const item = { id, tab, subtab, li, isNew: li.classList.contains('msg_new'), panel };
      for (const fn of watchers) fn(item);
      OGX.bus.emit('messages:item', item);
    }
  }
  /** Calls fn once per li.msg[data-msg-id] element on the /messages page (current and future). */
  messages.watch = function (fn) {
    const w = OGX.safe(fn, 'messages:watch');
    watchers.add(w);
    if (!watchOff && OGX.page.is('messages')) {
      seen = new WeakSet();
      const root = OGX.page.isGz() ? document.getElementById('content') || document.body
        : document.getElementById('messages') || document.querySelector('.js_tabs') || document.body;
      watchOff = OGX.dom.observe(root, scan, { debounce: 50 });
    }
    if (seen && OGX.page.isGz()) {
      for (const tr of document.querySelectorAll(GZ_ROWS)) if (seen.has(tr)) w(gzWatchItem(tr));
      scan();
    } else if (seen) {
      // deliver existing items to the new watcher
      for (const li of document.querySelectorAll('li.msg[data-msg-id]')) {
        if (!seen.has(li)) continue;
        const { tab, subtab, panel } = locate(li);
        w({ id: parseInt(li.dataset.msgId, 10), tab, subtab, li, isNew: li.classList.contains('msg_new'), panel });
      }
      scan();
    }
    return () => {
      watchers.delete(w);
      if (!watchers.size && watchOff) { watchOff(); watchOff = null; seen = null; }
    };
  };
  messages._log = log;
})(window.OGX);
