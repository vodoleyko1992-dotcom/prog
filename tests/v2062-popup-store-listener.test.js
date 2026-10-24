// 20.62 (вопрос John 24.10): слушатели хранилища меню через onStore — без chrome.storage меню не падает,
// исключение в одном слушателе не становится необработанной ошибкой.
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
const m = src.match(/function onStore\(fn\) \{[\s\S]*?\n\}\n/); assert(m, 'onStore есть');
assert(!/chrome\.storage\.onChanged\.addListener/.test(src), 'слушатели меню без ?. идут через onStore');
const mk = chrome => new Function('chrome', 'console', m[0] + 'return onStore;')(chrome, { warn() {} });
assert.doesNotThrow(() => mk(undefined)(() => {}));
assert.doesNotThrow(() => mk({})(() => {}));
let cb = null, got = null;
mk({ storage: { onChanged: { addListener: f => { cb = f; } } } })(ch => { got = ch.farmDb.newValue; throw new Error('x'); });
assert.doesNotThrow(() => cb({ farmDb: { newValue: 7 } }, 'local')); assert.strictEqual(got, 7);
assert.doesNotThrow(() => cb(undefined, 'local'));
console.log('v2062-popup-store-listener PASS');
