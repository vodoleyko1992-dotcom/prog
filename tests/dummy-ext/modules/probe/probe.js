// Probe module: shows a box, counts visits in storage, reads the event box, POSTs send-fleet on click,
// counts ogx:xhr events from the page hook, and fails on purpose when the URL hash is #ogx-fail.
OGX.module({
  name: 'probe',
  async init() {
    if (location.hash === '#ogx-fail') throw new Error('намеренная ошибка');
    if (location.hash === '#ogx-throw') setTimeout(() => { throw new Error('[OGX Dummy] uncaught'); }, 0);
    const visits = (await OGX.storage.get('dummy.visits', 0)) + 1;
    await OGX.storage.set('dummy.visits', visits);
    const box = document.createElement('div');
    box.className = 'ogx-dummy-box ogx-dummy-box-' + OGX.ext;
    box.dataset.visits = String(visits);
    box.dataset.backend = OGX.storage.backend;
    box.dataset.seed = String(await OGX.storage.get('dummy.seed', ''));
    box.textContent = 'Тестовое расширение работает, визитов: ' + visits;
    const btn = document.createElement('button');
    btn.className = 'ogx-dummy-send';
    btn.textContent = 'Отправить';
    btn.addEventListener('click', async () => {
      const token = document.querySelector('meta[name="csrf-token"]').content;
      const body = new URLSearchParams({ am204: '5', galaxy: '1', system: '45', position: '6', type: '1', mission: '1', speed: '10', _token: token });
      const r = await fetch('/ajax/fleet/dispatch/send-fleet', { method: 'POST', body, headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      box.dataset.sent = String((await r.json()).success);
    });
    box.appendChild(btn);
    document.body.appendChild(box);
    let xhr = 0;
    document.addEventListener('ogx:xhr', () => { box.dataset.xhr = String(++xhr); });
    // also expose the paths seen, for the harness test
    document.addEventListener('ogx:xhr', (ev) => { box.dataset.xhrLast = new URL(JSON.parse(ev.detail).url, location.href).pathname; });
    const r = await fetch('/ajax/fleet/eventbox/fetch', { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    box.dataset.hostile = String((await r.json()).hostile);
  },
});
