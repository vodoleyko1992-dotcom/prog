// Tiny stand-in for the shared core: namespace, detection, storage (chrome.storage.local or localStorage), boot.
(function () {
  const OGX = (window.OGX = window.OGX || {});
  OGX.modules = OGX.modules || {};
  OGX.module = (def) => { OGX.modules[def.name] = def; };
  OGX.isOgx = () => {
    if (/(^|\.)ogame\.gameforge\.com$/i.test(location.hostname)) return false;
    if (!document.querySelector('meta[name="csrf-token"]') || !document.querySelector('meta[name="ogame-version"]')) return false;
    if (!document.getElementById('planetList')) return false;
    const head = document.head ? [...document.head.childNodes].some((n) => n.nodeType === 8 && /OGameX/.test(n.nodeValue)) : false;
    return head || !!document.querySelector('#siteFooter a.homeLink[href*="github.com/lanedirt/ogamex" i]');
  };
  const api = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) ? chrome.storage.local : null;
  OGX.storage = {
    backend: api ? 'chrome' : 'localStorage',
    prefix: '',
    async get(key, def = null) {
      const k = this.prefix + key;
      if (api) { const r = await api.get(k); return k in r ? r[k] : def; }
      const v = localStorage.getItem('ogx.dummy.' + k); return v == null ? def : JSON.parse(v);
    },
    async set(key, value) {
      const k = this.prefix + key;
      if (api) return api.set({ [k]: value });
      localStorage.setItem('ogx.dummy.' + k, JSON.stringify(value));
    },
  };
  OGX.boot = async ({ ext, modules }) => {
    if (!OGX.isOgx()) return;
    OGX.ext = ext;
    const root = document.documentElement;
    const attr = 'ogx' + ext[0].toUpperCase() + ext.slice(1); // data-ogx-<ext>
    root.dataset[attr] = 'boot';
    const pid = document.querySelector('meta[name="ogame-player-id"]').content;
    OGX.storage.prefix = location.host.toLowerCase() + '|' + pid + '|';
    for (const name of modules) {
      try { await OGX.modules[name].init(); } catch (e) { console.error('[OGX ' + ext + '/' + name + ']', e && e.message); }
    }
    root.dataset[attr] = 'ready';
  };
})();
