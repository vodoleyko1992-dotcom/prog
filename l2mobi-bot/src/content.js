/* L2Mobi Bot — запуск на страницах l2mobi.pro: панель + защита от двух ботов в разных вкладках. */
(function () {
  'use strict';
  if (window.top !== window || window.__l2mobiBot) return;
  window.__l2mobiBot = 1;
  var E = window.L2MEngine;
  var ME = Math.random().toString(36).slice(2);
  var LOCK = 'l2mobi_bot_lock';

  function getLock() { return new Promise(function (r) { chrome.storage.local.get(LOCK, function (o) { r(o[LOCK] || null); }); }); }
  function setLock(v) { var o = {}; o[LOCK] = v; chrome.storage.local.set(o); }

  // Бот один на браузер: вкладка, где он запущен, раз в 5 с подтверждает «я жив».
  setInterval(function () {
    if (E.state.running) setLock({ id: ME, t: Date.now() });
  }, 5000);
  // Сторож вкладки (как watchdog старого бота): цикл работает, но 3 мин нет ни запросов, ни пауз — перезапуск.
  setInterval(function () {
    if (E.state.running && E.state.beat && Date.now() - E.state.beat > 180000) E.kick('нет действий 3 мин');
  }, 30000);
  window.addEventListener('pagehide', function () {
    if (E.state.running) setLock({ id: ME, t: 0, resume: true });
  });

  var origStart = E.start;
  E.start = async function () {
    var l = await getLock();
    if (l && l.id !== ME && Date.now() - l.t < 15000) { E.log('Бот уже работает в другой вкладке'); return; }
    setLock({ id: ME, t: Date.now() });
    origStart();
  };

  (window.L2MJournal ? window.L2MJournal.load() : Promise.resolve()).then(function () { return E.load(); }).then(function (saved) {
    window.L2MPanel.mount();
    // Продолжить после перехода по страницам игры, если бот работал.
    if (saved && saved.running) {
      getLock().then(function (l) {
        if (!l || l.id === ME || Date.now() - l.t > 15000 || l.resume) { E.log('Продолжаю после перехода по странице'); E.start(); }
      });
    }
  });
})();
