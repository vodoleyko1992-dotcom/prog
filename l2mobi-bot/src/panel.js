/* L2Mobi Bot 1.2 — большое меню слева (как в старом боте): сводка, разделы с настройками, журнал и выгрузка логов. */
(function (root) {
  'use strict';
  var E = root.L2MEngine, J = root.L2MJournal;
  var W = 340;

  var CSS = `
:host{all:initial}
*{box-sizing:border-box}
.dock{position:fixed;left:0;top:0;bottom:0;width:${W}px;max-width:100vw;z-index:2147483646;display:flex;flex-direction:column;
 background:#17130b;color:#efe6d6;font:13px/1.45 Tahoma,Arial,sans-serif;border-right:1px solid #5a4526;box-shadow:2px 0 14px rgba(0,0,0,.7);
 transform:translateX(0);transition:transform .2s ease}
.dock.closed{transform:translateX(-100%)}
.tab{position:fixed;left:0;top:45%;z-index:2147483647;width:26px;height:64px;border-radius:0 8px 8px 0;border:1px solid #6b5232;border-left:none;
 background:linear-gradient(180deg,#3a2f18,#1b150a);color:#ffd76a;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:15px;box-shadow:2px 2px 8px #000}
.tab.on{box-shadow:0 0 0 2px #7cfc00,2px 2px 8px #000}
.dock:not(.closed) ~ .tab{left:${W}px}
.top{padding:10px 10px 8px;border-bottom:1px solid #3d3116;background:#1e180c}
.hl{display:flex;align-items:center;gap:6px}
.hero{flex:1;font-weight:700;color:#ffd76a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pill{font-size:11px;padding:1px 8px;border:1px solid #6b5232;border-radius:10px;color:#c8b88a;white-space:nowrap}
.pill.run{border-color:#4f8a2a;color:#b6ff8a}
.x{background:none;border:none;color:#c8b88a;font-size:18px;cursor:pointer;padding:0 4px}
.btns{display:flex;gap:6px;margin:8px 0}
button{font:inherit;padding:7px 10px;border-radius:7px;border:1px solid #6b5232;background:#2e2614;color:#ffd76a;cursor:pointer}
button:hover{filter:brightness(1.15)}
.big{flex:1;font-weight:700;font-size:14px;padding:9px}
.go{background:#1f3b12;border-color:#4f8a2a;color:#b6ff8a}
.st{background:#3b1212;border-color:#8a2a2a;color:#ffb0b0}
.task{border:1px solid #4a3a20;border-radius:7px;padding:6px 8px;background:#120e07;font-size:12px}
.task b{color:#ffd76a}
.chips{display:flex;gap:4px;margin-top:6px;flex-wrap:wrap}
.chip{font-size:11px;padding:2px 7px;border:1px solid #4a3a20;border-radius:9px;background:#120e07;white-space:nowrap}
.nav{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;padding:8px 10px;border-bottom:1px solid #3d3116}
.nav div{padding:6px 4px;text-align:center;border:1px solid #3d3116;border-radius:7px;background:#0f0c07;color:#c8b88a;cursor:pointer;font-size:12px;white-space:nowrap}
.nav div.act{background:#3a2f18;border-color:#d4a017;color:#ffd76a}
.body{flex:1;overflow:auto;padding:10px}
.card{border:1px solid #4a3a20;border-radius:9px;padding:9px 10px;margin-bottom:9px;background:#1b160d}
.card h4{margin:0 0 6px;color:#ffd76a;font-size:13px}
.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px}
.cell{border:1px solid #3d3116;border-radius:7px;padding:5px;background:#120e07}
.cell .k{font-size:10.5px;color:#a89870}.cell .v{font-size:15px;font-weight:700}.cell .s{font-size:10.5px;color:#8a7a5a}
.bar{height:7px;background:#000;border-radius:4px;overflow:hidden;margin:2px 0 5px}.bar i{display:block;height:100%}
.row{display:flex;gap:6px;align-items:center;margin:5px 0;flex-wrap:wrap}
.row label{flex:1;min-width:150px}
input[type=number]{width:62px}
input[type=text]{width:100%}
input{font:inherit;background:#0c0a06;color:#efe6d6;border:1px solid #3d3116;border-radius:5px;padding:3px 5px}
.hint{color:#8a7a5a;font-size:11px}
.log{font:11px/1.4 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;max-height:300px;overflow:auto;background:#0a0805;border:1px solid #3d3116;border-radius:6px;padding:6px}
.export{width:100%;font-weight:700;font-size:14px;padding:10px;background:linear-gradient(180deg,#5a4524,#3a2c14);border-color:#d4a017}
.sk{display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px dashed #2e2614}
.sk img{width:22px;height:22px;border-radius:3px}
.sk .n{flex:1}
.bf{display:inline-flex;align-items:center;gap:3px;margin:2px 8px 2px 0;font-size:12px}
.tk{display:flex;gap:6px;align-items:center;padding:4px 0;border-bottom:1px dashed #2e2614;font-size:12px}
.tk .n{flex:1}.tk.off{opacity:.45}.tk.held .n{color:#ffb070}.tk button{padding:2px 6px;font-size:11px}
table{width:100%;border-collapse:collapse;font-size:11.5px}td,th{padding:3px 4px;border-bottom:1px dashed #2e2614;text-align:right}td:first-child,th:first-child{text-align:left}th{color:#a89870;font-weight:400}
.foot{padding:5px 10px;border-top:1px solid #3d3116;font-size:10.5px;color:#8a7a5a}
`;

  var BUFF_NAMES = { 1: 'Might', 2: 'Shield', 3: 'Acumen', 4: 'Agility', 6: 'Bless the Body', 7: 'Bless the Soul', 13: 'Empower', 14: 'Focus',
    15: 'Greater Might', 16: 'Greater Shield', 18: 'Haste', 19: 'Magic Barrier', 20: 'Majesty', 39: 'Death Whisper', 40: 'Berserker',
    41: 'Blessing of Seraphim', 42: 'Bless Shield', 43: 'Guidance', 44: 'Regeneration', 45: 'Mental Shield', 46: 'Wind Walk',
    50: 'Wild Magic', 8: 'Dance of Concentration', 9: 'Dance of Fury', 10: 'Dance of Inspiration', 11: 'Dance of Mystic', 12: 'Dance of Warrior',
    34: 'Dance of the Vampire', 35: 'Sirens Dance', 22: 'Song of Hunter', 23: 'Song of Vitality', 24: 'Song of Warding', 25: 'Song of Water',
    26: 'Song of Wind', 53: 'Song of Life', 36: 'Chant of Magnus', 37: 'Prophecy of Water', 38: 'Chant of Victory', 64: 'Victory of Paagrio' };
  var SECTIONS = [['main', '◈ Обзор'], ['hunt', '◎ Охота'], ['skills', '✦ Умения'], ['buff', '✚ Бафф'], ['altar', '⚑ Алтарь'], ['tasks', '⚙ Задачи'], ['mobs', '☠ Мобы'], ['log', '☰ Журнал']];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pct(a, b) { return b > 0 ? Math.max(0, Math.min(100, Math.round(a * 100 / b))) : 0; }
  function fmt(n) { return (n || 0).toLocaleString('ru'); }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  function mount() {
    var host = document.createElement('div');
    host.id = 'l2mobi-bot-host';
    document.documentElement.appendChild(host);
    var sh = host.attachShadow({ mode: 'open' });
    sh.innerHTML = '<style>' + CSS + '</style><div class="dock"></div><div class="tab" title="L2Mobi Bot">🤖</div>';
    var dock = sh.querySelector('.dock'), tab = sh.querySelector('.tab');
    var sec = ls('l2mbot_sec') || 'main';
    var open = ls('l2mbot_open') !== '0';

    function layout() {
      dock.classList.toggle('closed', !open);
      tab.textContent = open ? '‹' : '🤖';
      // На широком экране сдвигаем игру вправо, чтобы меню её не закрывало.
      var push = open && window.innerWidth >= W + 420;
      document.documentElement.style.marginLeft = push ? W + 'px' : '';
    }
    tab.onclick = function () { open = !open; ls('l2mbot_open', open ? '1' : '0'); layout(); };
    window.addEventListener('resize', layout);

    dock.innerHTML =
      '<div class="top"><div class="hl"><span class="hero" id="hero">L2Mobi Bot</span><span class="pill" id="pill">○ стоит</span><button class="x" id="hide" title="Свернуть">‹</button></div>' +
      '<div class="btns"><button class="big go" id="start">▶ Старт</button><button class="big st" id="stop">■ Стоп</button></div>' +
      '<div class="task" id="task"></div><div class="chips" id="chips"></div></div>' +
      '<div class="nav">' + SECTIONS.map(function (s) { return '<div data-s="' + s[0] + '">' + s[1] + '</div>'; }).join('') + '</div>' +
      '<div class="body">' +
      '<div data-p="main"></div>' +
      '<div data-p="hunt"></div><div data-p="skills"></div><div data-p="buff"></div><div data-p="altar"></div><div data-p="tasks"></div><div data-p="mobs"></div><div data-p="log"></div>' +
      '</div><div class="foot">L2Mobi Bot ' + esc(E.VERSION) + ' · настройки сохраняются сами</div>';
    var $ = function (s) { return dock.querySelector(s); };
    $('#hide').onclick = tab.onclick;
    $('#start').onclick = function () { E.start(); };
    $('#stop').onclick = function () { E.stop(); };

    function show(s) {
      sec = s; ls('l2mbot_sec', s);
      dock.querySelectorAll('.nav div').forEach(function (x) { x.classList.toggle('act', x.dataset.s === s); });
      dock.querySelectorAll('[data-p]').forEach(function (x) { x.style.display = x.dataset.p === s ? 'block' : 'none'; });
      render(E.state);
    }
    dock.querySelectorAll('.nav div').forEach(function (x) { x.onclick = function () { show(x.dataset.s); }; });

    function num(k, label, hint) { return '<div class="row"><label>' + label + (hint ? '<br><span class="hint">' + hint + '</span>' : '') + '</label><input type="number" step="any" data-k="' + k + '"></div>'; }
    function chk(k, label, hint) { return '<div class="row"><label><input type="checkbox" data-k="' + k + '"> ' + label + (hint ? '<br><span class="hint">' + hint + '</span>' : '') + '</label></div>'; }
    function txt(k, label, hint) { return '<div class="row" style="display:block">' + label + '<input type="text" data-k="' + k + '">' + (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div>'; }

    $('[data-p=main]').innerHTML =
      '<div class="card" id="me"></div><div class="card" id="sess"></div>' +
      '<button class="export" id="exp1">📤 Логи для разбора</button><div class="hint" id="expnote" style="margin:4px 0 9px">Скачает файл с новыми событиями с прошлой выгрузки. Пришлите его в чат.</div>' +
      '<div class="card"><h4>Последнее</h4><div class="log" id="mini"></div></div>';
    $('[data-p=hunt]').innerHTML =
      '<div class="card"><h4>Какие мобы</h4>' + num('maxLvlBelow', 'Не ниже героя на, ур.') + num('maxLvlAbove', 'Не выше героя на, ур.', 'по умолчанию −5…+9') +
      chk('whiteOnly', 'Только мобы с белым именем') + txt('blacklist', 'Не трогать (имена через запятую)') + '</div>' +
      '<div class="card"><h4>Бой</h4>' + txt('skills', 'Порядок умений (id через запятую)', 'Пусто — боевые умения с панели, сильнее — раньше. Список — в разделе «Умения».') +
      chk('useAttack', 'Обычная атака, пока умения на откате') + chk('loot', 'Забирать добычу') +
      num('minDelay', 'Мин. пауза между ударами, сек', 'дальше бот ждёт только каст игры') + chk('preferBest', 'Выбирать самых выгодных мобов', 'по опыту в секунду из своих боёв и базы мобов') + '</div>' +
      '<div class="card"><h4>Выживание</h4>' + chk('stopOnDeath', 'Остановиться при смерти', 'выкл. — бот сам вернётся и уйдёт на другое место') +
      num('avoidAfterDeath', 'Не трогать моба, от которого погиб, мин') + num('healAt', 'В бою лечиться умением, если HP ниже, %', 'Самолечение и другие лечащие умения с панели') + '</div>' +
      '<div class="card"><h4>Место кача</h4>' + chk('autoMove', 'Самому менять место по уровню', 'берёт мобов из «Куда качаться», бежит к ним') +
      chk('avoidAgro', 'Не идти к агрессивным мобам') + num('emptyTries', 'Сколько раз «мобов нет», прежде чем уйти') + num('emptyWait', 'Пауза, если мобов нет, сек') + '</div>' +
      '<div class="card"><h4>Самостоятельность</h4>' + num('stuckMin', 'Нет прогресса столько минут — сменить место', 'три раза подряд — остановка с причиной') +
      num('dailyKills', 'Суточный лимит боёв (0 — без лимита)') + '</div>';
    $('[data-p=tasks]').innerHTML =
      '<div class="card"><h4>Очередь задач</h4><div class="hint" style="margin-bottom:5px">Бот каждый шаг берёт самую важную задачу, которой пора. Задача с 3 сбоями подряд отдыхает 30 мин, остальное работает.</div><div id="tklist"></div></div>' +
      '<div class="card"><h4>Настройки в файл</h4><div class="row"><button id="cfgOut">💾 Сохранить в файл</button><button id="cfgIn">📂 Загрузить</button></div>' +
      '<div class="hint">Перенос настроек между браузерами и компьютерами.</div><input type="file" id="cfgFile" accept=".json,application/json" style="display:none"></div>';
    $('[data-p=mobs]').innerHTML =
      '<div class="card"><h4>Чему бот научился</h4><div class="hint" style="margin-bottom:5px">По своим боям: средняя длина боя и опыт. Лучшие сверху — их бот выбирает чаще.</div><div id="mobtab"></div></div>';
    $('[data-p=skills]').innerHTML =
      '<div class="card"><h4>Учёба</h4>' + chk('autoLearn', 'Учить новые умения у магистра', 'после нового уровня и раз в 30 мин; умения с книгой — только если книга есть') +
      chk('autoHotbar', 'Ставить новые боевые и лечащие умения на панель боя') + chk('buyBooks', 'Покупать книги заклинаний и сразу учить', 'Баринель (Глудио), 75–1800 аден, работает с любого места') + num('bookMaxPrice', 'Книга не дороже, аден') + num('bookRetryH', 'Не купилось/не выучилось — не пробовать снова, ч') + '<div class="row"><button id="learn">Выучить сейчас</button></div></div>' +
      '<div class="card"><h4>Умения на панели</h4><div id="sklist"></div></div>';
    $('[data-p=buff]').innerHTML =
      '<div class="card"><h4>Отдых</h4>' + num('restHp', 'Отдых, если HP ниже, %') + num('restMp', 'Отдых, если MP ниже, %') + num('restUntil', 'Отдыхать до, %') +
      chk('fullRestore', '«Полное восстановление» у баффера вместо ожидания') + '</div>' +
      '<div class="card"><h4>Бафф</h4>' + chk('buffVip', 'VIP-баффер (100 аден, 1 час, бесплатно до 40 ур.)') + num('buffEvery', 'Перебафф каждые, мин') +
      '<div>' + Object.keys(BUFF_NAMES).map(function (id) { return '<label class="bf"><input type="checkbox" data-buff="' + id + '">' + esc(BUFF_NAMES[id]) + '</label>'; }).join('') + '</div>' +
      '<div class="row"><button id="buffnow">Баффнуть сейчас</button><span class="hint" id="bufinfo"></span></div></div>';
    $('[data-p=altar]').innerHTML =
      '<div class="card"><h4>Алтарь Героя</h4>' + chk('daily', 'Каждый день забирать награду за вход, задания и колесо') +
      '<div class="row"><button id="altar">Забрать сейчас</button><span class="hint" id="altinfo"></span></div></div>';
    $('[data-p=log]').innerHTML =
      '<div class="card"><h4>Выгрузка для разбора</h4><div class="hint" id="jinfo"></div>' +
      '<div class="row"><button id="exN">Новое</button><button id="exT">За сегодня</button><button id="exA">Всё</button><button id="exC" title="Очистить журнал">Очистить</button></div>' +
      '<div class="hint">Файл JSON: каждый запрос к игре, выбор моба, каждый удар с HP/MP, бафф, отдых, ошибки и текст непонятных страниц. Пароль и куки туда не попадают.</div></div>' +
      '<div class="row"><button id="clr">Сбросить счётчики</button></div><div class="log" id="full"></div>';

    function doExport(mode) {
      var n = J.exportFile(mode, E.info());
      E.log(n ? '📤 Выгружено событий: ' + n : 'Журнал: новых событий нет');
      render(E.state);
    }
    $('#exp1').onclick = function () { doExport('new'); };
    $('#exN').onclick = function () { doExport('new'); };
    $('#exT').onclick = function () { doExport('today'); };
    $('#exA').onclick = function () { doExport('all'); };
    $('#exC').onclick = function () { J.clear(); render(E.state); };
    $('#clr').onclick = function () { E.resetStats(); };
    $('#buffnow').onclick = function () { E.buffNow(); };
    $('#altar').onclick = function () { E.dailyNow(); };
    $('#learn').onclick = function () { E.learnNow(); };
    $('#tklist').onclick = function (ev) { var k = ev.target && ev.target.dataset && ev.target.dataset.rel; if (k) E.releaseTask(k); };
    $('#cfgOut').onclick = function () {
      var b = new Blob([JSON.stringify({ kind: 'l2mobi-bot-settings', version: E.VERSION, cfg: E.exportCfg() }, null, 1)], { type: 'application/json' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'l2mobi-settings.json'; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    };
    $('#cfgIn').onclick = function () { $('#cfgFile').click(); };
    $('#cfgFile').onchange = function () {
      var f = this.files && this.files[0]; if (!f) return;
      f.text().then(function (t) { var o = JSON.parse(t); var n = E.importCfg(o.cfg || o); fillCfg(); E.log('Настройки загружены из файла: ' + n); })
        .catch(function (e) { E.log('Файл настроек не прочитан: ' + e.message); });
      this.value = '';
    };

    function fillCfg() {
      var c = E.cfg;
      dock.querySelectorAll('[data-k]').forEach(function (i) {
        if (sh.activeElement === i) return;
        if (i.type === 'checkbox') i.checked = !!c[i.dataset.k]; else i.value = c[i.dataset.k];
      });
      var chosen = String(c.buffs).split(/[\s,]+/);
      dock.querySelectorAll('[data-buff]').forEach(function (i) { i.checked = chosen.indexOf(i.dataset.buff) >= 0; });
    }
    dock.querySelectorAll('[data-k]').forEach(function (i) {
      i.onchange = function () {
        var v = i.type === 'checkbox' ? i.checked : i.type === 'number' ? +i.value : i.value;
        var p = {}; p[i.dataset.k] = v; E.setCfg(p);
      };
    });
    dock.querySelectorAll('[data-buff]').forEach(function (i) {
      i.onchange = function () {
        var list = []; dock.querySelectorAll('[data-buff]').forEach(function (j) { if (j.checked) list.push(j.dataset.buff); });
        E.setCfg({ buffs: list.join(',') });
      };
    });

    var lastRender = 0, pending = null;
    function render(S) {
      var now = Date.now();
      if (now - lastRender < 250) { if (!pending) pending = setTimeout(function () { pending = null; render(E.state); }, 260); return; }
      lastRender = now;
      var h = S.hero, me = S.me || {};
      $('#hero').textContent = h ? '👤 ' + h.name + ' · ' + h.level + ' ур.' : 'L2Mobi Bot';
      var pill = $('#pill'); pill.textContent = S.running ? '● работает' : '○ стоит'; pill.className = 'pill' + (S.running ? ' run' : '');
      tab.classList.toggle('on', !!S.running);
      $('#start').disabled = S.running; $('#stop').disabled = !S.running;
      $('#task').innerHTML = '<b>' + esc(S.task || (S.running ? 'Работа' : 'Бот стоит')) + ':</b> ' + esc(S.status) + (S.lock ? ' <span class="hint">(' + esc(S.lock) + ')</span>' : '') +
        (S.running && S.place ? '<br><span class="hint">Место: ' + esc(S.place) + '</span>' : '');
      var s = S.sess;
      $('#chips').innerHTML = '<span class="chip">⚔ ' + fmt(s ? s.kills : S.kills) + '</span><span class="chip">💰 ' + fmt(s ? s.adena : S.adena) + '</span>' +
        (me.exp != null ? '<span class="chip">✨ ' + me.exp + '%</span>' : '') + ((s ? s.levels : S.levelUps) ? '<span class="chip">⬆ ' + (s ? s.levels : S.levelUps) + '</span>' : '') +
        (S.deaths ? '<span class="chip">☠ ' + S.deaths + '</span>' : '');
      if (sec === 'main') {
        $('#me').innerHTML = '<h4>Герой</h4>' + (me.maxHp ?
          'HP ' + me.hp + '/' + me.maxHp + '<div class="bar"><i style="width:' + pct(me.hp, me.maxHp) + '%;background:#c9281e"></i></div>' +
          'MP ' + me.mp + '/' + me.maxMp + '<div class="bar"><i style="width:' + pct(me.mp, me.maxMp) + '%;background:#2b5fc7"></i></div>' +
          (me.exp != null ? 'EXP ' + me.exp + '%<div class="bar"><i style="width:' + Math.min(100, me.exp) + '%;background:#c8a032"></i></div>' : '') : '<span class="hint">Нажмите «Старт» — данные появятся.</span>') +
          (S.place ? '<div class="hint">Место кача: ' + esc(S.place) + '</div>' : '');
        var mins = s ? (Date.now() - s.t0) / 60000 : 0, hrs = mins / 60;
        $('#sess').innerHTML = '<h4>Сессия' + (s ? ' · ' + Math.floor(mins) + ' мин' : '') + '</h4><div class="grid">' +
          cell('Боёв', s ? s.kills : 0, s && hrs > 0.02 ? Math.round(s.kills / hrs) + '/час' : '') +
          cell('Адена', s ? s.adena : 0, s && hrs > 0.02 ? fmt(Math.round(s.adena / hrs)) + '/час' : '') +
          cell('Бой, сек', S.lastFight ? S.lastFight.secs : '—', s && s.kills ? 'средн. ' + (s.fightMs / 1000 / s.kills).toFixed(1) : '') +
          cell('Уровней', s ? s.levels : 0, '') + cell('Смертей', s ? s.deaths : 0, '') + cell('Выучено', S.learned, 'умений') + '</div>' +
          '<div class="hint" style="margin-top:5px">Всего: ' + fmt(S.kills) + ' боёв, ' + fmt(S.adena) + ' аден</div>';
        $('#mini').textContent = S.log.slice(0, 15).join('\n');
        $('#expnote').textContent = 'Новых событий с прошлой выгрузки: ' + fmt(J.countNew()) + '. Файл пришлите в чат.';
      }
      if (sec === 'log') { $('#full').textContent = S.log.join('\n'); $('#jinfo').textContent = 'В журнале ' + fmt(J.count()) + ' событий, новых ' + fmt(J.countNew()) + '.'; }
      if (sec === 'skills') {
        var ids = S.knownSkills.slice();
        Object.keys(S.skillInfo).forEach(function (k) { if (ids.indexOf(k) < 0) ids.push(k); });
        $('#sklist').innerHTML = ids.length ? ids.map(function (id) {
          var i = S.skillInfo[id] || {};
          var kind = i.kind === 'attack' ? '⚔ атака' + (i.power ? ', сила ' + i.power : '') : i.kind === 'heal' ? '✚ лечение' : i.kind ? 'другое' : '?';
          return '<div class="sk"><img src="/img/skills/skill' + esc(id) + '_0.jpg" alt=""><span class="n">' + esc(i.name || ('умение ' + id)) + ' <span class="hint">#' + esc(id) + '</span></span><span class="hint">' + kind + '</span></div>';
        }).join('') : '<span class="hint">Появятся после первого боя.</span>';
      }
      if (sec === 'tasks') {
        $('#tklist').innerHTML = E.tasks().map(function (t) {
          var st = !t.on ? 'выкл.' : t.held ? 'пауза ' + t.held + ' мин' : t.runs ? '✓ ' + new Date(t.lastOk).toLocaleTimeString('ru') : 'ждёт';
          return '<div class="tk' + (t.on ? '' : ' off') + (t.held ? ' held' : '') + '" title="' + esc(t.holdWhy || t.lastErr) + '"><span class="n">' + esc(t.title) +
            (t.holdWhy ? '<br><span class="hint">' + esc(t.holdWhy) + '</span>' : '') + '</span><span class="hint">' + esc(st) + '</span>' +
            (t.held ? '<button data-rel="' + esc(t.key) + '">снять</button>' : '') + '</div>';
        }).join('');
      }
      if (sec === 'mobs') {
        var top = E.mobTop(30);
        $('#mobtab').innerHTML = top.length ? '<table><tr><th>Моб</th><th>боёв</th><th>сек</th><th>опыт</th><th>оп/с</th><th>☠</th></tr>' + top.map(function (m) {
          return '<tr><td>' + esc(m.name) + '</td><td>' + m.n + '</td><td>' + m.secs + '</td><td>' + fmt(m.exp) + '</td><td>' + (m.rate != null ? m.rate.toFixed(1) : '—') + '</td><td>' + (m.deaths || '') + '</td></tr>';
        }).join('') + '</table>' : '<span class="hint">Появится после первых боёв.</span>';
      }
      if (sec === 'buff') $('#bufinfo').textContent = S.lastBuff ? 'последний: ' + new Date(S.lastBuff).toLocaleTimeString('ru') : '';
      if (sec === 'altar') $('#altinfo').textContent = S.lastDaily ? 'забрано: ' + S.lastDaily : '';
    }
    function cell(k, v, s) { return '<div class="cell"><div class="k">' + k + '</div><div class="v">' + esc(typeof v === 'number' ? fmt(v) : v) + '</div><div class="s">' + esc(s) + '</div></div>'; }

    fillCfg(); layout(); show(sec);
    E.onChange(render);
    setInterval(function () { if (E.state.running) render(E.state); }, 5000);
    return { refreshCfg: fillCfg };
  }

  root.L2MPanel = { mount: mount };
})(typeof globalThis !== 'undefined' ? globalThis : this);
