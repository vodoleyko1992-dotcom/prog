// R2: "... under construction" box on list pages (first #technologies). REAL only in idle state (empty .largebox).
(doc = document) => [...doc.querySelectorAll('#technologies')].filter((t) => !t.querySelector('ul.icons')).map((t) => ({
  title: t.querySelector('h3')?.textContent.trim(),
  html: (t.querySelector('.largebox')?.innerHTML || '').trim(),
  timers: [...t.querySelectorAll('[data-time]')].map((e) => +e.dataset.time),
}))
