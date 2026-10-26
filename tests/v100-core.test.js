'use strict';
// 10.0 часть 4 (аудит ядра): замок вкладок, очередь записей, сторожа
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const { createPatchQueue } = require('../engine-core.js');
const content = read('content.js'), bg = read('background.js');
(async () => {
  // 1. очередь: пакет, отправленный до потери замка (clear), после ошибки обратно не встаёт
  { let fail = true, sent = []; let release;
    const q = createPatchQueue(b => new Promise(r => { sent.push(b); release = () => r({ ok: !fail }); }), () => true, () => {}, () => 0);
    const p = q.enqueue({ kills: 5 }); await Promise.resolve(); await Promise.resolve();
    q.clear(); assert.deepEqual(q.peek(), {}, 'clear empties inflight view too');
    release(); await p; assert.deepEqual(q.peek(), {}, 'stale batch from before clear() is dropped');
  }
  // без clear — прежнее поведение: неудачный пакет ждёт повтора, новее — сверху
  { let release; const q = createPatchQueue(() => new Promise(r => { release = () => r({ ok: false }); }), () => true, () => {}, () => 0);
    const p = q.enqueue({ kills: 5, exp: 1 }); await Promise.resolve(); await Promise.resolve(); q.enqueue({ kills: 6 }); release(); await p;
    assert.deepEqual(q.peek(), { kills: 6, exp: 1 });
  }
  // 2. вкладка, получившая замок, сбрасывает накопленное до чтения свежего rt
  assert.match(content, /rtWriter\.clear\(\);\n\s*const fresh = await \(globalThis\.L2EngineCore\?\.hotStore\?\.\(\(\) => chrome\.storage\.local\) \?\? chrome\.storage\.local\)\.get\(\['rt', 'cfg', 'stash'\]\);/);   // 20.62: и тайник классов (ключ stash); 20.65: rt вместе с hot
  // 3. фон сообщает прежнему хозяину, что замок ушёл; вкладка сразу перестаёт управлять
  assert.match(bg, /chrome\.tabs\.sendMessage\(lock\.tab, \{ cmd: 'lockLost' \}\)/);
  assert.match(content, /m\.cmd === 'lockLost'\) \{ if \(tabOwner\) \{ tabOwner = false; tabIdle = true; leaseEpoch = null; rtWriter\.clear\(\);/);
  // 4. капча / блок PvE — не «нет прогресса»
  assert.match(content, /progressMonitor\.tick\(sig, activeJob && !abWait\)/);
  assert.match(content, /const abWait = !!antibotState\(\) \|\| \(rt\.pveBlockUntil \|\| 0\) > Date\.now\(\);/);
  // 5. остановка гасит мигание заголовка
  // 14.10: между сменой on и миганием теперь ставится на паузу серия заточки; оба действия остаются в том же обработчике.
  const onChange = content.slice(content.indexOf("    on = !!ch.on.newValue;"), content.indexOf("    const stopMeta = ch.stopMeta?.newValue;"));
  assert.match(onChange, /if \(!on\) abBlink\(false\);/);
  assert.match(onChange, /L2V7Modules\.enchant\.command\('pause'\)/);
  // 6. фон: .then/.catch больше не внутри комментария
  assert.doesNotMatch(bg, /\/\/[^\n]*\.then\(\(\) => \{ hbPersistedAt/);
  // Реворк: успешная запись отдельно от комментария, heartbeat меняется после await.
  assert.match(bg, /await chrome\.storage\.local\.set\(\{ hbBg: \{ \.\.\.nextHb \}, wdog: \[\], wdDown: null \}\);\s+hbMem = nextHb; hbPersistedAt = Date\.now\(\);/);
  // 7. заметки Маммона/квестов — только когда память своего героя
  assert.match(content, /const meNow = !heroNick\(\) \|\| rt\.char === heroNick\(\);/);
  assert.equal((content.match(/if \(tabOwner && meNow && d\.status >= 200/g) || []).length, 2);
  console.log('PASS: 10.0 core — stale write batch dropped after lock loss, lockLost push to the old tab, captcha is not a stall, blink off on stop, heartbeat persist, own-hero net notes');
})().catch(e => { console.error(e); process.exit(1); });
