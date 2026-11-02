/* GALAXYZ / 2Moons messages recipes (spec companion of messages.md). THE canonical messages recipe file: port this one
 * into core 19-messages.js. (messages-recipes-b.js / GZMessagesB is an independent second implementation kept only as a
 * cross-check; messages-gzmessages.md is merged into messages.md.)
 * Plain browser JS, no dependencies. Works on a live document, a DOMParser document, or an AJAX fragment.
 *   GZMessages.parseCategories(doc)         page=messages: the 11 category cells with unread/total
 *   GZMessages.parseHeaderUnread(doc)       topnav badge .messages-section .new-msg-count (every page; 0 when absent)
 *   GZMessages.parseList(root)              #messagestable (full page after the click, or the mode=view AJAX fragment)
 *   GZMessages.classify(item, cat)          -> kind ('spy_report', 'combat', 'expedition', 'transport_arrival', 'return', ...)
 *   GZMessages.parseSpyReport(el)           .spyRaport (shared.mission.spyReport.tpl)
 *   GZMessages.parseSpyDetected(item)       "A hostile fleet of the planet ..." (category 0)
 *   GZMessages.parseCombatMessage(item)     .raportMessage (MissionCaseAttack / MissionCaseExpedition heredoc)
 *   GZMessages.parseCombatReport(doc)       page=raport popup (shared.mission.raport.tpl), also mode=battlehall
 *   GZMessages.parseBattleHall(doc)         page=battleHall top-100 list
 *   GZMessages.parseExpedition(item, texts) expedition result (outcome needs fixtures/messages-texts.json)
 *   GZMessages.parseFleetText(item, kind)   transport / recycle / stay / return numbers and coordinates
 *   GZMessages.parseItem(item, cat, texts)  classify + the matching parser
 *   GZMessages.urls.*                       URL / POST body builders (no network): page, view, actionBody, raport
 *   GZMessages.api.*                        fetch helpers (categories, list, action/delete, raport)
 * Verified by tools/messages/check_messages.js on the REAL pages (fixtures/messages-real-*.html) and the UPSTREAM fixtures.
 */
(function (root) {
  'use strict';

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
      if (e) for (const [key, v] of Object.entries(e)) idx.push({ key, lang, outcome: v.outcome, text: norm(v.text).toLowerCase() });
    }
    Object.defineProperty(texts, '__idx', { value: idx, enumerable: false });
    return idx;
  }
  function parseExpedition(item, texts) {
    texts = texts || TEXTS;
    const b = item.body;
    const parts = b.innerHTML.split(/<br\s*\/?>/i);
    const flavor = norm(parts[0]).toLowerCase();
    const hit = expeditionIndex(texts).find((x) => x.text === flavor) || expeditionIndex(texts).find((x) => x.text && (flavor.startsWith(x.text) || x.text.startsWith(flavor)));
    const out = { outcome: hit ? hit.outcome : null, key: hit ? hit.key : null, lang: hit ? hit.lang : null, wall: item.wall, ships: null, shipsByName: null };
    // ships found: "<br>NAME: N" lines; nothing repairable: "<br><br>No ships could be found." (Expedition:194-213)
    const lines = parts.slice(1).map(norm).filter(Boolean);
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

  // ---------- fetch helpers ----------
  const base = () => (typeof location !== 'undefined' && /\/game\.php$/.test(location.pathname) ? location.origin + location.pathname : 'game.php');
  async function getDoc(url) {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return new DOMParser().parseFromString(await r.text(), 'text/html');
  }
  // URL / POST body builders. The action body mirrors the REAL form: mode, ajax, messcat, side + actionTop/submitTop
  // (the server ignores the action unless submitTop or submitBottom is present, ShowMessagesPage.class.php:163-174).
  const urls = {
    page: (category, side) => 'game.php?page=messages' + (category != null ? '&category=' + category + '&side=' + (side || 1) : ''),
    view: (cat, site) => 'game.php?page=messages&mode=view&messcat=' + cat + '&site=' + (site || 1) + '&ajax=1',
    actionBody: (action, ids, cat, side) => {
      const body = new URLSearchParams({ mode: 'action', ajax: '1', messcat: String(cat == null ? 100 : cat), side: String(side || 1),
        actionTop: action, submitTop: 'Confirm' });
      (ids || []).forEach((id) => body.append('messageID[' + id + ']', '1'));
      return body;
    },
    raport: (rid) => 'game.php?page=raport&raport=' + encodeURIComponent(rid),
  };

  const api = {
    // full page: categories + server unread counters. Upstream renders NO list here (the list only comes from the view
    // below), so this does not mark anything read; with &category=N it would auto-load (and mark) that category.
    categories: async () => parseCategories(await getDoc(base() + '?page=messages')),
    // AJAX list, 10 per page upstream (MESSAGES_PER_PAGE). WARNING: marks the returned messages as read (ShowMessagesPage:130-135).
    list: async (cat = 100, site = 1) => parseList(await getDoc(base() + '?page=messages&mode=view&messcat=' + cat + '&site=' + site + '&ajax=1')),
    // POST form action (ShowMessagesPage::action): the server answers with a redirect to page=messages&category=..; no CSRF token exists.
    action: async (action, ids = [], cat = 100) => {
      if (/marked$/.test(action) && !ids.length) throw new Error('refusing ' + action + ' without ids');   // deleteunmarked + [] == deletetypeall/deleteall!
      const body = urls.actionBody(action, ids, cat);
      const r = await fetch(base() + '?page=messages', { method: 'POST', credentials: 'same-origin', body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } });
      return r.ok;
    },
    delete: (ids, cat = 100) => api.action('deletemarked', [].concat(ids), cat),
    markRead: (ids, cat = 100) => api.action('readmarked', [].concat(ids), cat),
    raport: async (rid) => parseCombatReport(await getDoc(base() + '?' + urls.raport(rid).split('?')[1])),
    battleHall: async (order = 'units', sort = 'desc') => parseBattleHall(await getDoc(base() + '?page=battleHall&order=' + order + '&sort=' + sort)),
  };

  const GZMessages = { CATEGORIES, NAMES, idOf, num, nums, coords, parseTdDate, setTexts, parseCategories, parseHeaderUnread, parseList, classify, parseSpyReport,
    parseSpyDetected, parseCombatMessage, parseCombatReport, parseBattleHall, parseExpedition, parseFleetText, parseItem, urls, api };
  root.GZMessages = GZMessages;
  if (typeof module !== 'undefined' && module.exports) module.exports = GZMessages;
})(typeof window !== 'undefined' ? window : globalThis);
