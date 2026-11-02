// Minimal service worker: answers pings; its presence lets the harness reach chrome.storage.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg && msg.type === 'ogx:ping') { reply({ ok: true, ext: 'dummy' }); return false; }
  return false;
});
