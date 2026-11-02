// MAIN world, document_start. Marks the page world and forwards whitelisted XHR loads to the isolated world.
(function () {
  if (window.__ogxDummyHook) return;
  window.__ogxDummyHook = { version: '0.0.1', world: 'main' };
  const WL = /^\/ajax\/(fleet\/eventbox\/fetch|galaxy)$/;
  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__ogx = { method: m, url: String(u) }; return open.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (body) {
    const info = this.__ogx;
    if (info) {
      let path = '';
      try { path = new URL(info.url, location.href).pathname; } catch (e) { /* ignore */ }
      if (WL.test(path)) {
        this.addEventListener('load', () => {
          if (!document.querySelector('meta[name="ogame-version"]')) return;
          document.dispatchEvent(new CustomEvent('ogx:xhr', { detail: JSON.stringify({ url: info.url, method: info.method, status: this.status, requestBody: body == null ? null : String(body), responseText: this.responseText, t: Date.now() }) }));
        });
      }
    }
    return send.apply(this, arguments);
  };
})();
