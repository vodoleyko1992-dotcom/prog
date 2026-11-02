/* shared/core/02-bus.js — synchronous event bus with error-isolated handlers. Owner: core.
 * Core events: ready, tick, settings:changed, storage:changed, state:updated, flights:updated, galaxy:system,
 * galaxy:render, messages:item, xhr, fleet:sent, fleet:ajax (GALAXYZ), fleet:recalled, techdetails:open, time:calibrated,
 * learn:alert. Payloads: specs/CORE_API.md §3 (fleet:sent from the game on GALAXYZ carries via 'fleetStep3' | 'fleetAjax',
 * fleetId, arrival, back; galaxy:system/render on GALAXYZ fire at boot: subscribe with OGX.galaxy.onSystem/onRender).
 * Modules emit '<module>:<what>'. */
(function (OGX) {
  'use strict';
  const handlers = new Map(); // event -> [{fn, wrapped}]
  const bus = (OGX.bus = OGX.bus || {});

  bus.on = function (event, fn) {
    if (typeof fn !== 'function') return () => {};
    const entry = { fn, wrapped: OGX.safe(fn, 'bus:' + event) };
    if (!handlers.has(event)) handlers.set(event, []);
    handlers.get(event).push(entry);
    return () => bus.off(event, fn, entry);
  };
  bus.once = function (event, fn) {
    let off = null;
    const once = function (payload) { if (off) off(); return fn(payload); };
    off = bus.on(event, once);
    return off;
  };
  bus.off = function (event, fn, entry) {
    const list = handlers.get(event);
    if (!list) return;
    const i = entry ? list.indexOf(entry) : list.findIndex((e) => e.fn === fn);
    if (i >= 0) list.splice(i, 1);
  };
  bus.emit = function (event, payload) {
    const list = handlers.get(event);
    if (!list || !list.length) return;
    for (const e of list.slice()) e.wrapped(payload);
  };
  bus.count = (event) => (handlers.get(event) || []).length;
})(window.OGX);
