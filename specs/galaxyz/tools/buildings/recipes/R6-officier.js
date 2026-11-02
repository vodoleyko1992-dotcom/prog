// R6: page=officier list (REAL). Level text "18/20" = current/max. Dark Matter tile has data-technologys="1" (no data-technology).
(doc = document) => [...doc.querySelectorAll('#offList > li.button')].map((li) => {
  const a = li.querySelector('a.detail_button');
  const box = li.querySelector('.officers100');
  const [cur, max] = a.querySelector('.level').textContent.replace(/\s+/g, '').split('/');
  return { liId: li.id, id: a.dataset.technology ? +a.dataset.technology : null, name: a.title,
           cssKey: [...box.classList].find((c) => c !== 'officers100'), off: box.dataset.status === 'off',
           level: +cur.replace(/\D/g, ''), max: max == null ? null : +max };
})
