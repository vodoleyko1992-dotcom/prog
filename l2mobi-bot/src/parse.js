/* L2Mobi Bot — разбор страниц l2mobi.pro. Чистые функции: работают и в браузере, и в Node (тесты). */
(function (root) {
  'use strict';

  function decodeEntities(s) {
    return String(s || '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); });
  }

  function stripTags(s) {
    return decodeEntities(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  }

  /** Видимый текст страницы без скриптов, стилей и PHP-предупреждений. */
  function pageText(html) {
    var s = String(html || '')
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/div>|<\/p>|<\/tr>|<\/li>/gi, '\n')
      .replace(/<[^>]*>/g, ' ');
    return decodeEntities(s).split('\n')
      .map(function (l) { return l.replace(/\s+/g, ' ').trim(); })
      .filter(function (l) { return l && !/^(Notice|Warning)\s*:/.test(l); })
      .join('\n');
  }

  function links(html) {
    var out = [];
    var re = /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, m;
    while ((m = re.exec(String(html || '')))) out.push({ href: decodeEntities(m[1]), text: stripTags(m[2]) });
    return out;
  }

  function query(href) {
    var q = {}, i = href.indexOf('?');
    if (i < 0) return q;
    href.slice(i + 1).split('&').forEach(function (p) {
      if (!p) return;
      var j = p.indexOf('=');
      var k = j < 0 ? p : p.slice(0, j);
      q[k] = j < 0 ? '' : p.slice(j + 1);
    });
    return q;
  }

  /** Мобы рядом со страницы map.php: [{href, name, level, hp, color}] */
  function parseMapMobs(html) {
    var out = [];
    var re = /<a\s+href="(battle\.php\?[^"]*tymop=mob[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, m;
    while ((m = re.exec(String(html || '')))) {
      var body = m[2];
      var nm = /<span[^>]*?(?:color:\s*([#\w]+))?[^>]*>([^<]*\[\d+\][^<]*)<\/span>/i.exec(body);
      var text = stripTags(body);
      var lv = /^(.*?)\s*\[(\d+)\]/.exec(nm ? decodeEntities(nm[2]).trim() : text);
      var hp = /HP:\s*(\d+)/.exec(text);
      if (!lv) continue;
      out.push({
        href: decodeEntities(m[1]),
        name: lv[1].trim(),
        level: +lv[2],
        hp: hp ? +hp[1] : 0,
        color: nm && nm[1] ? nm[1].toLowerCase() : ''
      });
    }
    return out;
  }

  /** Полоски CP/HP/MP/EXP со страницы боя (или любой с .l2-bar-text). */
  function parseBars(html) {
    var r = {};
    var re = /l2-bar-text">\s*(CP|HP|MP)\s+(-?\d+)\s*\/\s*(\d+)/g, m;
    while ((m = re.exec(String(html || '')))) {
      var k = m[1].toLowerCase();
      if (r[k]) continue;
      r[k] = +m[2]; r['max' + m[1][0] + m[1].slice(1).toLowerCase()] = +m[3];
    }
    var e = /l2-bar-text">\s*EXP\s+([\d.]+)%/.exec(String(html || ''));
    if (e) r.exp = +e[1];
    return r;
  }

  /** Панель умений на странице боя: {attack: href|null, skills: [{id, href, icon}]} */
  function parseHotbar(html) {
    var res = { attack: null, skills: [], items: [] };
    var seen = {};
    links(html).forEach(function (l) {
      if (l.href.indexOf('battle.php?') !== 0 && l.href.indexOf('/battle.php?') !== 0) return;
      var q = query(l.href);
      if ('attack' in q) { if (!res.attack) res.attack = l.href; return; }
      if (q.go && /^\d+$/.test(q.go) && !seen['g' + q.go]) { seen['g' + q.go] = 1; res.skills.push({ id: q.go, href: l.href }); }
      if (q.use && /^\d+$/.test(q.use) && !seen['u' + q.use]) { seen['u' + q.use] = 1; res.items.push({ id: q.use, href: l.href }); }
    });
    return res;
  }

  /** Откаты умений из панели: {skillId: unixSec} (атрибут data-cd-end в ячейке). */
  function parseCooldowns(html) {
    var r = {}, re = /<div class="l2bar-slot[^"]*">([\s\S]*?)<\/div>\s*(?=<div class="l2bar-slot|<\/div>)/g, m;
    var s = String(html || '');
    while ((m = re.exec(s))) {
      var g = /[?&](?:amp;)?go=(\d+)/.exec(m[1]), c = /data-cd-end="(\d+)"/.exec(m[1]);
      if (g && c) r[g[1]] = +c[1];
    }
    return r;
  }

  /** Время конца каста со страницы боя: window.L2B = {casting: N, PN: x} */
  function parseCasting(html) {
    var m = /window\.L2B\s*=\s*\{\s*casting:\s*(\d+)\s*,\s*PN:\s*([\d.]+)/.exec(String(html || ''));
    return m ? { casting: +m[1], PN: +m[2] } : null;
  }

  /** Строки боевого журнала со страницы боя (до чата). */
  function parseBattleLog(html) {
    var t = pageText(html).split('\n');
    var i = t.indexOf('▼'), j = t.indexOf('ALL');
    if (i < 0) return [];
    return t.slice(i + 1, j > i ? j : i + 12).filter(function (l) { return l && l !== '▲' && l !== '▼'; });
  }

  function isEditMode(html) { return /l2bar-lock-open/.test(String(html || '')) && !/battle\.php\?[^"]*&attack/.test(String(html || '')); }

  function parseTargetHud(html) {
    var m = /l2-target-hud-name">([^<]*)<[\s\S]*?title="HP:\s*(\d+)\s*\/\s*(\d+)"/.exec(String(html || ''));
    return m ? { name: decodeEntities(m[1]).trim(), hp: +m[2], maxHp: +m[3] } : null;
  }

  /** Ответ battle_ajax.php (JSON). Возвращает null, если это не JSON. */
  function parseBattleJson(text) {
    try { var d = JSON.parse(text); return d && typeof d === 'object' ? d : null; } catch (e) { return null; }
  }

  /** Итог боя со страницы конца боя. */
  function parseBattleEnd(html) {
    var t = pageText(html);
    var r = { adena: 0, exp: 0, sp: 0, loot: [], text: t };
    var m;
    if ((m = /Получено\s+([\d\s,]+)\s*Адена/i.exec(t))) r.adena = +m[1].replace(/\D/g, '');
    if ((m = /получили\s+([\d\s,]+)\s*exp\s*и\s*([\d\s,]+)\s*sp/i.exec(t))) { r.exp = +m[1].replace(/\D/g, ''); r.sp = +m[2].replace(/\D/g, ''); }
    r.levelUp = /повысили уровень/i.test(t);
    r.takeAll = links(html).some(function (l) { return /ЗАБРАТЬ ВСЕ/i.test(l.text); });
    var lootBlock = /ДОБЫЧА\s*\((\d+)\)([\s\S]*?)ЗАБРАТЬ ВСЕ/i.exec(t);
    if (lootBlock) r.loot = lootBlock[2].split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    return r;
  }

  /** Состояние героя со страницы player.php?parameters */
  function parseParameters(html) {
    var t = pageText(html), r = {};
    var m = /Ур\.\s*(\d+)/.exec(t); if (m) r.level = +m[1];
    ['HP', 'CP', 'MP'].forEach(function (k) {
      var mm = new RegExp('(?:^|\\n)' + k + '\\n(\\d+)\\s*/\\s*(\\d+)').exec(t) || new RegExp('(?:^|\\n)' + k + '\\n(\\d+)\\n(\\d+)').exec(t);
      if (mm) { r[k.toLowerCase()] = +mm[1]; r['max' + k[0] + k.slice(1).toLowerCase()] = +mm[2]; }
    });
    m = /Exp\n([\d.]+)%/.exec(t); if (m) r.exp = +m[1];
    m = /(?:^|\n)SP\n(\d+)/.exec(t); if (m) r.sp = +m[1];
    return r;
  }

  /** Шапка героя: «Kaelthys - 7 уровень» */
  function parseHeroHeader(html) {
    var m = /(?:^|\n)([^\n]+?)\s+-\s+(\d+)\s+уровень/.exec(pageText(html));
    return m ? { name: m[1].trim(), level: +m[2] } : null;
  }

  function parseAdena(html) {
    var m = /Адена\s*\(([\d,\s]+)\)/.exec(pageText(html));
    return m ? +m[1].replace(/\D/g, '') : null;
  }

  /** VIP-баффер (buffer_vip_40.php) и обычный (buffer2.php): [{id, skill, name, href}] */
  function parseBuffer(html, page) {
    var out = [], re = new RegExp('href="(' + (page || 'buffer_vip_40\\.php') + '\\?buff=(\\d+))"[\\s\\S]{0,300}?des=(\\d+)&(?:amp;)?dl=\\d+"[^>]*>([^<]+)<', 'g'), m;
    while ((m = re.exec(String(html || '')))) out.push({ href: decodeEntities(m[1]), id: +m[2], skill: +m[3], name: decodeEntities(m[4]).trim() });
    return out;
  }

  /** Ссылки Алтаря, которые можно забрать: награда за вход, задания, колесо. */
  function parseAltarClaims(html) {
    return links(html).filter(function (l) {
      return /^\/?daily_altar\.php\?(claim_streak|claim_task|spin)=/.test(l.href);
    }).map(function (l) { return l.href; });
  }

  /** Тревожные признаки: капча, бан, смерть, выход из игры. */
  function detectAlerts(html) {
    var t = pageText(html).toLowerCase();
    var a = [];
    if (/капч|captcha|проверка на бота|введите код|вы робот/.test(t)) a.push('captcha');
    if (/заблокирован|забанен|бан до|banned/.test(t)) a.push('ban');
    // «Вас убил …» бывает и в старом журнале боя, поэтому смерть — только по явному состоянию или HP 0.
    var bars = parseBars(html);
    if (/вас убили\.|index\.php\?doa=1|вы мертвы|вы погибли\.|вернуться в город после смерти/.test(t) || (bars.maxHp && bars.hp <= 0)) a.push('dead');
    if (/name="telefon"/.test(String(html || ''))) a.push('logout');
    return a;
  }

  function townTokens(html) {
    var r = {};
    links(html).forEach(function (l) {
      var q = query(l.href);
      if (/^\/?town\.php/.test(l.href) && q.go && q.tk) r[q.go] = l.href;
    });
    return r;
  }


  /** Магистр (magister.php?learnskills): {sp, list:[{id, name, level, sp, book}]} */
  function parseMagister(html) {
    var s = String(html || ''), r = { sp: null, list: [] };
    var m = /У Вас\s+(\d+)\s+Skill Points/.exec(pageText(s)); if (m) r.sp = +m[1];
    var i = s.indexOf('Доступные магии'); if (i < 0) return r;
    s.slice(i).split(/<hr\s*\/?>/i).forEach(function (chunk) {
      var g = /magister\.php\?get=(\d+)"/.exec(chunk);
      var d = /des=(\d+)&(?:amp;)?dl=(\d+)"[^>]*>([^<]+)<\/a>\s*\((\d+)\s*sp\)/.exec(chunk);
      if (!g || !d) return;
      var b = /item_profile\.php\?itemid=(\d+)/.exec(chunk);
      r.list.push({ id: g[1], level: +d[2], name: decodeEntities(d[3]).replace(/\s+\d+$/, '').trim(), sp: +d[4], book: b ? +b[1] : null });
    });
    return r;
  }

  /** Продавец книг (buy.php?nid=31417&bid=3141700, Баринель, Глудио):
      книга → { item, bid, nid, price, name }. Покупка: POST buy.php?bid=&nid=&buy=ITEM&y (count=1). */
  function parseBookShop(html) {
    var s = String(html || ''), out = {}, i = s.indexOf('Для покупки');
    if (i >= 0) s = s.slice(i);
    var re = /buy\.php\?bid=(\d+)&(?:amp;)?nid=(\d+)&(?:amp;)?buy=(\d+)&(?:amp;)?c"[\s\S]*?itemid=\d+">([^<]+)<\/a>\s*<br\s*\/?>\s*<img[^>]*>\s*([\d\s]+)/g, m;
    while ((m = re.exec(s))) out[m[3]] = { item: +m[3], bid: m[1], nid: m[2], name: decodeEntities(m[4]).trim(), price: +m[5].replace(/\D/g, '') };
    return out;
  }

  /** Вид умения по описанию: drain (бьёт и лечит), heal (лечит), attack (бьёт противника), other. */
  function skillKind(text, power) {
    text = String(text || '');
    var foe = /противник|врага|цель/i.test(text);
    // «Высасывает HP противника и восстанавливает HP персонажа» (Прикосновение Вампира) — удар с лечением
    if (/высасыва|поглоща/i.test(text) && foe) return 'drain';
    if (/восстанавлива\w*[^.]{0,25}\bhp\b|лечит|исцел/i.test(text)) return 'heal';
    if (/противник|врага|цель/i.test(text) && power) return 'attack';
    return 'other';
  }

  /** Описание умения (magister.php?&des=ID&dl=L): {name, text, power, kind: attack|heal|other} */
  function parseSkillDesc(html) {
    var t = pageText(html).split('\n');
    var i = t.findIndex(function (l) { return /уровень/.test(l) && / - \d+ уровень/.test(l); });
    var name = t[i + 1] || '', text = t[i + 2] || '';
    var pw = /Power:\s*(\d+)/i.exec(text);
    return { name: name, text: text, power: pw ? +pw[1] : 0, kind: skillKind(text, pw ? +pw[1] : 0) };
  }

  /** Ячейки панели умений со страницы actions.php: [{slot, skill: 'attack'|id|null}] */
  function parseSlots(html) {
    var out = [], re = /<a href="actions\.php\?addsc=(\d+)"[^>]*>\s*<img src="img\/(?:skills\/(attack|skill(\d+)_\d+)|(addskill))\.jpg"/g, m;
    while ((m = re.exec(String(html || '')))) out.push({ slot: +m[1], skill: m[2] === 'attack' ? 'attack' : (m[3] || null) });
    return out;
  }

  /** Список умений для ячейки (actions.php?addsc=N&skills): [{id, name, level}] */
  function parseSlotSkills(html) {
    var out = [], re = /actions\.php\?addsc=\d+&(?:amp;)?skill=(\d+)"[\s\S]*?des=\1&(?:amp;)?dl=(\d+)"[^>]*>([^<]+)</g, m, seen = {};
    while ((m = re.exec(String(html || '')))) { if (seen[m[1]]) continue; seen[m[1]] = 1; out.push({ id: m[1], level: +m[2], name: decodeEntities(m[3]).trim() }); }
    return out;
  }

  /** «Куда качаться» (help.php?top=8): живые мобы рядом [{eid, name, level, count}] */
  function parseNearby(html) {
    var by = {}, re = /droplist\.php\?eid=(\d+)"[^>]*>([\s\S]*?)<\/a>/g, m;
    while ((m = re.exec(String(html || '')))) {
      var t = stripTags(m[2]), lv = /^(.*?)\s+(\d+)$/.exec(t);
      if (!lv) continue;
      if (!by[m[1]]) by[m[1]] = { eid: +m[1], name: lv[1], level: +lv[2], count: 0 };
      by[m[1]].count++;
    }
    return Object.keys(by).map(function (k) { return by[k]; });
  }

  /** Карточка моба (droplist.php?eid=): {name, level, agro, run, tp} */
  function parseDroplist(html) {
    var t = pageText(html), r = {};
    var m = /\n([^\n]+)\nLevel:\n(\d+)/.exec(t); if (m) { r.name = m[1].trim(); r.level = +m[2]; }
    m = /Агро:\n(ДА|НЕТ)/.exec(t); if (m) r.agro = m[1] === 'ДА';
    m = /href="(map\.php\?map&(?:amp;)?move_x=(-?\d+)&(?:amp;)?move_y=(-?\d+))"/.exec(String(html || ''));
    if (m) { r.run = decodeEntities(m[1]); r.x = +m[2]; r.y = +m[3]; }
    return r;
  }

  /** Координаты героя на карте (режим карты): {x, y} */
  function parseMapCoords(html) {
    var m = /(?:^|\n)(-?\d+) : (-?\d+)(?:\n|$)/.exec(pageText(html));
    return m ? { x: +m[1], y: +m[2] } : null;
  }

  var api = {
    decodeEntities: decodeEntities, stripTags: stripTags, skillKind: skillKind, parseBookShop: parseBookShop, pageText: pageText, links: links, query: query,
    parseMapMobs: parseMapMobs, parseBars: parseBars, parseHotbar: parseHotbar, isEditMode: isEditMode, parseCooldowns: parseCooldowns, parseCasting: parseCasting, parseBattleLog: parseBattleLog,
    parseTargetHud: parseTargetHud, parseBattleJson: parseBattleJson, parseBattleEnd: parseBattleEnd,
    parseParameters: parseParameters, parseHeroHeader: parseHeroHeader, parseAdena: parseAdena,
    parseBuffer: parseBuffer, parseAltarClaims: parseAltarClaims, detectAlerts: detectAlerts, townTokens: townTokens,
    parseMagister: parseMagister, parseSkillDesc: parseSkillDesc, parseSlots: parseSlots, parseSlotSkills: parseSlotSkills,
    parseNearby: parseNearby, parseDroplist: parseDroplist, parseMapCoords: parseMapCoords
  };
  root.L2MParse = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
