'use strict';
// 20.12 (ревизия 17.10, ревью импорта настроек): cfgImportClean пропускает только ключи DEF меню и CFG_IMPORT_EXTRA.
// Раньше rbOrder («⬇ С самых сильных», пишут кнопки тура РБ) и скрытые настройки, которые читают content.js/модули
// (mageMpPct, magisterSkip, fishRodBuy…), уходили в «Пропущено неизвестных» — после импорта на чистую установку тур
// шёл снизу вверх. Тест: каждый ключ, который пишет меню или читает код, проходит импорт со значением своего типа.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const popup = read('popup.js');
const part = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };

// 20.13 (ревизия 17.10, шаг 7, defaults/D12): DEF меню — общая таблица defaults.js (L2Defaults.CFG), та же, что у движка.
assert.match(popup, /const DEF = L2Defaults\.CFG;/);
const DEF = require(path.join(root, 'defaults.js')).CFG;
const b = { Object, JSON, Number, Array, DEF }; vm.createContext(b);
vm.runInContext(part(popup, 'const CFG_IMPORT_EXTRA', "$('cfgImport').onclick") + ';this.clean=cfgImportClean;this.EXTRA=CFG_IMPORT_EXTRA;', b);
const sample = k => {
  const d = Object.hasOwn(DEF, k) ? DEF[k] : undefined, t = d === undefined ? b.EXTRA[k] : null;
  if (k === 'autoTasks') return ['fish'];
  if (d === null) return 5;
  if (d !== undefined) return d;
  return t === 'number' ? 1 : t === 'boolean' ? true : t === 'string' ? 'x' : t === 'object' ? {} : undefined;
};
const passes = k => { const v = sample(k), r = b.clean({ [k]: v }); return Object.hasOwn(r.clean, k); };

// 1) Всё, что читает код (cfg.X / env.cfg.X / C('X')) — переносится импортом.
const code = ['content.js', 'background.js', ...fs.readdirSync(path.join(root, 'modules')).filter(f => f.endsWith('.js')).map(f => 'modules/' + f)].map(read).join('\n');
const readKeys = new Set();
for (const m of code.matchAll(/\b(?:env\.)?cfg\??\.([A-Za-z]\w*)/g)) readKeys.add(m[1]);
for (const m of code.matchAll(/\bC\('([A-Za-z]\w*)'\)/g)) readKeys.add(m[1]);
// Не настройки: newValue — объект storage.onChanged; dailyAuto/CatKillLimit — старые ключи, их читает только разовая
// миграция dailyKill2010 (17.10) и обнуляет; переносить их импортом незачем.
const IGNORE = new Set(['newValue', 'dailyAutoKillLimit', 'dailyCatKillLimit']);
const lostRead = [...readKeys].filter(k => !IGNORE.has(k) && !passes(k)).sort();
assert.deepStrictEqual(lostRead, [], 'ключи из кода, которые импорт отбрасывает: ' + lostRead.join(', '));

// 2) Всё, что пишет само меню: поля формы и cfgPatch.
const list = name => vm.runInNewContext(part(popup, 'const ' + name, ';\n').replace(/^const \w+\s*=/, ''));
const uiKeys = new Set([...list('NUM'), ...list('TXT'), ...list('BOOL')]);
for (const m of popup.matchAll(/cfgPatch: *\{([^}]*)\}/g)) for (const k of m[1].matchAll(/([A-Za-z]\w*):/g)) uiKeys.add(k[1]);
uiKeys.delete('cfgPatch');
const lostUi = [...uiKeys].filter(k => !passes(k)).sort();
assert.deepStrictEqual(lostUi, [], 'ключи меню, которые импорт отбрасывает: ' + lostUi.join(', '));

// 3) Сценарий из ревью: rbOrder 'down' переживает экспорт → импорт, неверный тип по-прежнему отбрасывается.
{ const r = b.clean({ rbOrder: 'down', rbValueTour: false, mageMpPct: 40, magisterSkip: 'Curse Weakness', fishRodBuy: false });
  assert.strictEqual(JSON.stringify(r.clean), '{"rbOrder":"down","rbValueTour":false,"mageMpPct":40,"magisterSkip":"Curse Weakness","fishRodBuy":false}');
  assert.strictEqual(r.skipped.length, 0); }
{ const r = b.clean({ rbOrder: 5, mageMpPct: 'много', rbVampHp: -1 });
  assert.strictEqual(JSON.stringify(r.skipped), '["rbOrder","mageMpPct","rbVampHp"]', 'типы проверяются и для новых ключей'); }
console.log('PASS v2012-cfg-import-keys: ' + readKeys.size + ' ключей кода и ' + uiKeys.size + ' ключей меню проходят импорт');
