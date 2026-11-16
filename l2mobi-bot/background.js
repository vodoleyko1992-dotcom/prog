/* L2Mobi Bot — уведомления (капча, смерть, остановка). */
var api = typeof browser !== 'undefined' ? browser : chrome;
api.runtime.onMessage.addListener(function (msg) {
  if (!msg || msg.type !== 'l2m-notify') return;
  try {
    api.notifications.create({ type: 'basic', iconUrl: 'icons/128.png', title: 'L2Mobi Bot', message: String(msg.text || '').slice(0, 300) });
  } catch (e) {}
});
