/* L2Mobi Bot — панель поверх страницы игры (Shadow DOM, стили игры не задевает). */
(function (root) {
  'use strict';
  var E = root.L2MEngine;

  var CSS = [
    ':host{all:initial}',
    '.fab{position:fixed;right:10px;bottom:70px;z-index:2147483646;width:44px;height:44px;border-radius:50%;border:1px solid #6b5232;',
    ' background:linear-gradient(180deg,#2e2614,#0c0a06);color:#ffd76a;font:20px/44px sans-serif;text-align:center;cursor:pointer;box-shadow:0 2px 8px #000}',
    '.fab.on{box-shadow:0 0 0 2px #7cfc00,0 2px 8px #000}',
    '.box{position:fixed;right:8px;bottom:120px;z-index:2147483647;width:min(340px,calc(100vw - 16px));max-height:70vh;overflow:auto;',
    ' background:#14110a;color:#e8dcc0;border:1px solid #6b5232;border-radius:8px;font:13px/1.4 Tahoma,Arial,sans-serif;box-shadow:0 4px 18px #000;display:none}',
    '.box.open{display:block}',
    '.hd{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid #3d3116;background:#1e180c;position:sticky;top:0}',
    '.hd b{flex:1;color:#ffd76a}',
    '.tabs{display:flex;gap:4px;padding:6px 10px 0}',
    '.tab{flex:1;padding:5px;border:1px solid #3d3116;border-bottom:none;border-radius:5px 5px 0 0;background:#0c0a06;color:#c8b88a;cursor:pointer;text-align:center}',
    '.tab.act{background:#2e2614;color:#ffd76a}',
    '.pg{padding:10px;border-top:1px solid #3d3116}',
    'button{font:inherit;padding:6px 10px;border-radius:5px;border:1px solid #6b5232;background:#2e2614;color:#ffd76a;cursor:pointer}',
    'button.go{background:#1f3b12;border-color:#4f8a2a;color:#b6ff8a}',
    'button.st{background:#3b1212;border-color:#8a2a2a;color:#ffb0b0}',
    '.row{display:flex;gap:6px;align-items:center;margin:5px 0;flex-wrap:wrap}',
    '.row label{flex:1;min-width:150px}',
    'input[type=number]{width:60px}',
    'input[type=text]{width:100%;box-sizing:border-box}',
    'input{font:inherit;background:#0c0a06;color:#e8dcc0;border:1px solid #3d3116;border-radius:4px;padding:3px 5px}',
    '.st-line{margin:3px 0}',
    '.k{color:#a89870}',
    '.bar{height:6px;background:#000;border-radius:3px;overflow:hidden;margin:2px 0 6px}',
    '.bar i{display:block;height:100%}',
    '.log{font:11px/1.35 monospace;white-space:pre-wrap;max-height:220px;overflow:auto;background:#0a0805;border:1px solid #3d3116;border-radius:4px;padding:5px;margin-top:6px}',
    '.hint{color:#8a7a5a;font-size:11px}',
    '.sk{display:inline-flex;align-items:center;gap:3px;margin:2px 6px 2px 0}',
    '.sk img{width:20px;height:20px}'
  ].join('\n');

  var BUFF_NAMES = { 1: 'Might', 2: 'Shield', 3: 'Acumen', 4: 'Agility', 6: 'Bless the Body', 7: 'Bless the Soul', 13: 'Empower', 14: 'Focus',
    15: 'Greater Might', 16: 'Greater Shield', 18: 'Haste', 19: 'Magic Barrier', 20: 'Majesty', 39: 'Death Whisper', 40: 'Berserker',
    41: 'Blessing of Seraphim', 42: 'Bless Shield', 43: 'Guidance', 44: 'Regeneration', 45: 'Mental Shield', 46: 'Wind Walk',
    50: 'Wild Magic', 8: 'Dance of Concentration', 9: 'Dance of Fury', 10: 'Dance of Inspiration', 11: 'Dance of Mystic', 12: 'Dance of Warrior',
    34: 'Dance of the Vampire', 35: 'Sirens Dance', 22: 'Song of Hunter', 23: 'Song of Vitality', 24: 'Song of Warding', 25: 'Song of Water',
    26: 'Song of Wind', 53: 'Song of Life', 36: 'Chant of Magnus', 37: 'Prophecy of Water', 38: 'Chant of Victory', 64: 'Victory of Paagrio' };

  function el(tag, attrs, html) { var e = document.createElement(tag); if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]); if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pct(a, b) { return b > 0 ? Math.max(0, Math.min(100, Math.round(a * 100 / b))) : 0; }

  function mount() {
    var host = el('div', { id: 'l2mobi-bot-host' });
    document.documentElement.appendChild(host);
    var sh = host.attachShadow({ mode: 'open' });
    sh.appendChild(el('style', null, CSS));
    var fab = el('div', { class: 'fab', title: 'L2Mobi Bot' }, '🤖');
    var box = el('div', { class: 'box' });
    sh.appendChild(fab); sh.appendChild(box);
    var openTab = 'main';
    try { if (localStorage.getItem('l2mbot_open') === '1') box.classList.add('open'); openTab = localStorage.getItem('l2mbot_tab') || 'main'; } catch (e) {}
    fab.onclick = function () { box.classList.toggle('open'); try { localStorage.setItem('l2mbot_open', box.classList.contains('open') ? '1' : '0'); } catch (e) {} };

    box.innerHTML =
      '<div class="hd"><b>L2Mobi Bot</b><button id="run"></button></div>' +
      '<div class="tabs"><div class="tab" data-t="main">Главная</div><div class="tab" data-t="fight">Бой</div><div class="tab" data-t="buff">Бафф</div><div class="tab" data-t="log">Журнал</div></div>' +
      '<div class="pg" data-p="main"></div><div class="pg" data-p="fight"></div><div class="pg" data-p="buff"></div><div class="pg" data-p="log"></div>';
    var $ = function (s) { return box.querySelector(s); };

    function showTab(t) {
      openTab = t;
      try { localStorage.setItem('l2mbot_tab', t); } catch (e) {}
      box.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('act', x.dataset.t === t); });
      box.querySelectorAll('.pg').forEach(function (x) { x.style.display = x.dataset.p === t ? 'block' : 'none'; });
    }
    box.querySelectorAll('.tab').forEach(function (x) { x.onclick = function () { showTab(x.dataset.t); }; });

    $('#run').onclick = function () { if (E.state.running) E.stop(); else E.start(); };

    function num(key, label, hint) {
      return '<div class="row"><label>' + label + (hint ? '<br><span class="hint">' + hint + '</span>' : '') + '</label><input type="number" data-k="' + key + '"></div>';
    }
    function chk(key, label) { return '<div class="row"><label><input type="checkbox" data-k="' + key + '"> ' + label + '</label></div>'; }
    function txt(key, label, hint) { return '<div class="row" style="display:block">' + label + '<input type="text" data-k="' + key + '">' + (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div>'; }

    $('[data-p=fight]').innerHTML =
      txt('skills', 'Умения по порядку (id через запятую)', 'Пусто — все умения с панели боя. Найдены: <span id="known"></span>') +
      chk('useAttack', 'Бить обычной атакой, пока умения на откате') +
      num('maxLvlAbove', 'Моб не выше героя на') +
      num('maxLvlBelow', 'Моб не ниже героя на', 'опыт даётся при разнице не больше 9') +
      chk('whiteOnly', 'Только мобы с белым именем') +
      txt('blacklist', 'Не трогать мобов (имена через запятую)') +
      chk('loot', 'Забирать добычу') +
      num('restHp', 'Отдых, если HP ниже, %') +
      num('restMp', 'Отдых, если MP ниже, %') +
      num('restUntil', 'Отдыхать до, %') +
      chk('fullRestore', 'Вместо ожидания — «Полное восстановление» у баффера') +
      num('minDelay', 'Мин. пауза между ударами, сек') +
      num('emptyWait', 'Пауза, если мобов нет, сек') +
      chk('stopOnDeath', 'Остановиться при смерти');

    var bl = Object.keys(BUFF_NAMES).map(function (id) { return '<label class="sk"><input type="checkbox" data-buff="' + id + '">' + esc(BUFF_NAMES[id]) + '</label>'; }).join('');
    $('[data-p=buff]').innerHTML =
      chk('buffVip', 'VIP-баффер (100 аден за бафф, 1 час, бесплатно до 40 ур.)') +
      num('buffEvery', 'Перебафф каждые, мин') +
      '<div class="row" style="display:block">Баффы:<div>' + bl + '</div></div>' +
      '<div class="row"><button id="buffnow">Баффнуть сейчас</button></div>' +
      chk('daily', 'Каждый день забирать награды Алтаря (вход, задания, колесо)');

    $('[data-p=log]').innerHTML = '<div class="row"><button id="clr">Сбросить счётчики</button></div><div class="log" id="log"></div>';
    $('#clr').onclick = function () { E.resetStats(); };
    $('#buffnow').onclick = function () { E.buffNow(); };

    function fillCfg() {
      var c = E.cfg;
      box.querySelectorAll('[data-k]').forEach(function (i) {
        var k = i.dataset.k;
        if (i.type === 'checkbox') i.checked = !!c[k]; else if (sh.activeElement !== i) i.value = c[k];
      });
      var chosen = String(c.buffs).split(/[\s,]+/);
      box.querySelectorAll('[data-buff]').forEach(function (i) { i.checked = chosen.indexOf(i.dataset.buff) >= 0; });
    }
    box.querySelectorAll('[data-k]').forEach(function (i) {
      i.onchange = function () {
        var k = i.dataset.k, v;
        if (i.type === 'checkbox') v = i.checked; else if (i.type === 'number') v = +i.value; else v = i.value;
        var p = {}; p[k] = v; E.setCfg(p);
      };
    });
    box.querySelectorAll('[data-buff]').forEach(function (i) {
      i.onchange = function () {
        var list = []; box.querySelectorAll('[data-buff]').forEach(function (j) { if (j.checked) list.push(j.dataset.buff); });
        E.setCfg({ buffs: list.join(',') });
      };
    });

    function render(S) {
      var run = $('#run');
      run.textContent = S.running ? '■ Стоп' : '▶ Старт';
      run.className = S.running ? 'st' : 'go';
      fab.classList.toggle('on', !!S.running);
      var me = S.me || {}, h = S.hero;
      var mins = S.running && S.startedAt ? Math.round((Date.now() - S.startedAt) / 60000) : 0;
      $('[data-p=main]').innerHTML =
        '<div class="st-line"><span class="k">Статус:</span> ' + esc(S.status) + (S.lock ? ' <span class="hint">(' + esc(S.lock) + ')</span>' : '') + '</div>' +
        (h ? '<div class="st-line"><span class="k">Герой:</span> ' + esc(h.name) + ', ' + h.level + ' ур.</div>' : '') +
        (me.maxHp ? '<div class="st-line">HP ' + me.hp + '/' + me.maxHp + '</div><div class="bar"><i style="width:' + pct(me.hp, me.maxHp) + '%;background:#c9281e"></i></div>' +
          '<div class="st-line">MP ' + me.mp + '/' + me.maxMp + '</div><div class="bar"><i style="width:' + pct(me.mp, me.maxMp) + '%;background:#2b5fc7"></i></div>' : '') +
        '<div class="st-line"><span class="k">Убито:</span> ' + S.kills + ' &nbsp; <span class="k">Адена:</span> ' + S.adena.toLocaleString('ru') + (me.exp != null ? ' &nbsp; <span class="k">EXP:</span> ' + me.exp + '%' : '') + (S.deaths ? ' &nbsp; <span class="k">Смертей:</span> ' + S.deaths : '') + '</div>' +
        (mins ? '<div class="st-line"><span class="k">Работает:</span> ' + mins + ' мин</div>' : '') +
        '<div class="log">' + esc(S.log.slice(0, 12).join('\n')) + '</div>';
      $('#log').textContent = S.log.join('\n');
      $('#known').innerHTML = S.knownSkills.length ? S.knownSkills.map(function (id) { return '<span class="sk"><img src="/img/skills/skill' + esc(id) + '_0.jpg" alt="">' + esc(id) + '</span>'; }).join('') : 'пока нет, появятся после первого боя';
    }

    fillCfg(); showTab(openTab); render(E.state);
    E.onChange(render);
    return { refreshCfg: fillCfg };
  }

  root.L2MPanel = { mount: mount };
})(typeof globalThis !== 'undefined' ? globalThis : this);
