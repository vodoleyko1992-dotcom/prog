// Автоперевод браузера (Google Translate в Chrome/Comet) меняет текст страницы: «Teddy» → «Тедди», «502: Bad gateway» → «Неверный шлюз»,
// украинские строки лога → русские. Бот читает этот текст, поэтому перевод страниц игры запрещаем до загрузки страницы.
(() => {
  const h = document.documentElement;
  if (!h) return;
  h.setAttribute('translate', 'no');
  h.classList.add('notranslate');
  const m = document.createElement('meta');
  m.name = 'google'; m.content = 'notranslate';
  (document.head || h).appendChild(m);
})();
