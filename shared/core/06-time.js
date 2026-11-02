/* shared/core/06-time.js — server clock and timezone calibration. Owner: core.
 * All stored times are ServerMs = true UTC epoch ms. The layout string `var serverTime = new Date('Y-m-d H:i:s')` is the
 * server WALL clock (APP_TIMEZONE, UTC by default); tzOffsetMs = wall - UTC is auto-calibrated from the first JSON
 * serverTime (unix seconds) and stored in the server-scope key 'server' (field tzOffsetMs).
 * GALAXYZ (specs/galaxyz/layout.md §6): `var serverTime = new Date(Y, M0, D, h, m, s)` is the server wall clock (parse
 * normalizes it to 'Y-m-d H:i:s'); the exact render instant comes from any fleet countdown (data-fleet-end-time -
 * data-fleet-time, snap.renderUnix), so tzOffsetMs is recalibrated on every page that shows an event (DST-safe).
 * `var ServerTimezoneOffset` (seconds) = user zone - server zone: dates printed in the game text are user wall clock. */
(function (OGX) {
  'use strict';
  const time = (OGX.time = OGX.time || {});
  const Q = 15 * 60 * 1000;

  time.offsetMs = 0;          // serverEpochMs - Date.now()
  time.renderMs = Date.now(); // server epoch when the page was rendered
  time.tzOffsetMs = 0;        // server wall clock - UTC
  time.calibrated = false;    // tz offset known (stored, manual, or calibrated now)
  time.ready = Promise.resolve();
  time.userOffsetMs = 0;      // GALAXYZ ServerTimezoneOffset: user wall clock - server wall clock
  let wallRenderMs = null;    // layout string parsed as if UTC
  let parsedAtMs = Date.now();

  function wallToUtcGuess(s) {
    s = String(s || '').trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    m = /(\d{2})\.(\d{2})\.(\d{4})(?:\s|<br\s*\/?>)*(\d{2}):(\d{2}):(\d{2})/.exec(s);
    if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]);
    m = /(\d{2})\.(\d{2})\.(\d{2})(?:\s|<br\s*\/?>)+(\d{2}):(\d{2}):(\d{2})/.exec(s); // "30.10.26 01:36:17" (fleet briefing)
    if (m) return Date.UTC(2000 + +m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]);
    return OGX.util && OGX.util.parseGzDate ? OGX.util.parseGzDate(s) : null; // GALAXYZ "30. Oct 2026, 10:20:01"

  }
  time._wallToUtcGuess = wallToUtcGuess;

  function manualTz() {
    let v = 'auto';
    try { v = OGX.settings.get('core.tzOffsetMinutes'); } catch (e) { v = 'auto'; }
    if (v === undefined || v === null || String(v).trim() === '' || String(v).trim().toLowerCase() === 'auto') return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n * 60000 : null;
  }
  /** Uncalibrated (fresh install, first page without a fleet countdown, nothing stored): the zone from the local clock,
   * wall - Date.now() rounded to 15 min, instead of 0. Treating the wall clock as UTC would put renderMs and every stored
   * T hours into the future on ogamex.eu, and the newer() guards would then reject real data. A guess is neither stored
   * nor `calibrated`: the first countdown or JSON serverTime still calibrates and stores the true offset. */
  function guessTz() {
    const tz = Math.round((wallRenderMs - parsedAtMs) / Q) * Q;
    return Number.isFinite(tz) && Math.abs(tz) <= 14 * 3600000 ? tz : 0;
  }
  function recompute() {
    if (wallRenderMs != null) {
      time.renderMs = wallRenderMs - time.tzOffsetMs;
      time.offsetMs = time.renderMs - parsedAtMs;
    }
  }

  time.init = function (snap) {
    parsedAtMs = (snap && snap.parsedAtMs) || Date.now();
    wallRenderMs = snap && snap.serverTimeString ? wallToUtcGuess(snap.serverTimeString) : null;
    time.userOffsetMs = snap && Number.isFinite(+snap.userOffsetSec) ? +snap.userOffsetSec * 1000 : 0;
    const manual = manualTz();
    if (manual != null) { time.tzOffsetMs = manual; time.calibrated = true; }
    else if (!time.calibrated && wallRenderMs != null) time.tzOffsetMs = guessTz();
    recompute();
    if (wallRenderMs == null) { time.renderMs = parsedAtMs; time.offsetMs = 0; }
    // GALAXYZ: exact render instant from a fleet countdown on this page -> calibrate now (and store, see calibrateRender)
    const anchored = manual == null && snap && Number.isFinite(+snap.renderUnix) && +snap.renderUnix > 0 && wallRenderMs != null;
    if (anchored) time.calibrateRender(+snap.renderUnix);
    time.ready = (async () => {
      if (anchored || manual != null || !OGX.storage || !OGX.storage.ns) return;
      try {
        const srv = await OGX.storage.get('server', null, { scope: 'server' });
        if (srv && Number.isFinite(+srv.tzOffsetMs) && !time.calibrated) {
          time.tzOffsetMs = +srv.tzOffsetMs; time.calibrated = true; recompute();
        }
      } catch (e) { /* storage not ready */ }
    })();
    if (!time._watch && OGX.settings && OGX.settings.onChange) {
      time._watch = OGX.settings.onChange('core.tzOffsetMinutes', () => {
        const m = manualTz();
        if (m != null) { time.tzOffsetMs = m; time.calibrated = true; } else { time.calibrated = false; }
        recompute();
      });
    }
  };
  time.serverNow = () => Date.now() + time.offsetMs;
  time.toLocalMs = (serverMs) => serverMs - time.offsetMs;
  time.fromUnix = (sec) => +sec * 1000;

  /** Called with any JSON serverTime/server_time (unix seconds). The first call fixes the timezone (15-min rounding). */
  time.calibrate = function (unixSeconds) {
    const trueMs = +unixSeconds * 1000;
    if (!Number.isFinite(trueMs) || trueMs <= 0) return;
    if (!time.calibrated && manualTz() == null && wallRenderMs != null) {
      const wallNow = wallRenderMs + (Date.now() - parsedAtMs);
      const tz = Math.round((wallNow - trueMs) / Q) * Q;
      time.tzOffsetMs = tz;
      time.calibrated = true;
      recompute();
      try {
        if (OGX.storage && OGX.storage.ns) {
          OGX.storage.update('server', (o) => Object.assign({}, o || {}, { tzOffsetMs: tz }), {}, { scope: 'server' });
        }
      } catch (e) { /* ignore */ }
      if (OGX.bus) OGX.bus.emit('time:calibrated', { tzOffsetMs: tz });
    } else if (!time.calibrated && wallRenderMs == null) {
      time.calibrated = true;
    }
    // JSON time is the truer clock: adopt it when the layout-based offset is more than 2 s off.
    const off = trueMs - Date.now();
    if (Math.abs(off - time.offsetMs) > 2000) time.offsetMs = off;
  };

  /**
   * GALAXYZ: the render instant is known exactly (event countdown end - rest): tzOffsetMs = wall - unix (15-min rounding),
   * renderMs = unix. Stores the offset when it changed and emits time:calibrated. Manual core.tzOffsetMinutes wins.
   */
  time.calibrateRender = function (renderUnix) {
    const trueMs = +renderUnix * 1000;
    if (!Number.isFinite(trueMs) || trueMs <= 0 || wallRenderMs == null || manualTz() != null) return;
    const tz = Math.round((wallRenderMs - trueMs) / Q) * Q;
    const changed = !time.calibrated || tz !== time.tzOffsetMs;
    time.tzOffsetMs = tz;
    time.calibrated = true;
    time.renderMs = trueMs;
    time.offsetMs = trueMs - parsedAtMs;
    if (!changed) return;
    try {
      if (OGX.storage && OGX.storage.ns) {
        OGX.storage.update('server', (o) => (o && o.tzOffsetMs === tz ? o : Object.assign({}, o || {}, { tzOffsetMs: tz })), {}, { scope: 'server' });
      }
    } catch (e) { /* ignore */ }
    if (OGX.bus) OGX.bus.emit('time:calibrated', { tzOffsetMs: tz });
  };

  /** Server wall-clock text -> ServerMs. Accepts "2026-10-30 00:57:17", "30.10.2026 01:36:17", "30.10.2026<br>01:30:37",
   * "30. Oct 2026, 10:20:01" (GALAXYZ, server zone). */
  time.parseServerWall = function (s) {
    const w = wallToUtcGuess(s);
    return w == null ? null : w - time.tzOffsetMs;
  };
  /** GALAXYZ date printed in game text (fleetTable, fleetStep3, messages: user zone, "30. Oct 2026, 10:20:01") -> ServerMs. */
  time.parseGameDate = function (s) {
    const w = wallToUtcGuess(s);
    return w == null ? null : w - time.tzOffsetMs - time.userOffsetMs;
  };
})(window.OGX);
