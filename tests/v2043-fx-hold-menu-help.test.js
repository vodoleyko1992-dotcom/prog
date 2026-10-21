'use strict';
// 20.43 (автономность, доводка 21.10): кнопка «i» из HELP (около 105 подписей меню) вставляется перед полем и становилась первым «labelable»
// потомком label — label.control указывал на неё: на ПК клик по тексту подписи открывал пояснение вместо переключения галки/фокуса в поле
// (для «i» из title это исправили ещё в ревью меню, HELP оставался прежним). Теперь подпись и с HELP привязана к своему полю (for).
// Мини-DOM: label.control вычисляется по правилам HTML (for → элемент по id, иначе первый labelable потомок).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'ui-v7.js'), 'utf8');
const LABELABLE = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'METER', 'OUTPUT', 'PROGRESS']);
function dom() {
  const byId = new Map(), all = [];
  class El {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null; this.attrs = {}; this.htmlFor = ''; this._id = ''; this.textContent = ''; this.type = '';
      const set = new Set(); this.classList = { add: (...c) => c.forEach(x => set.add(x)), remove: (...c) => c.forEach(x => set.delete(x)), contains: c => set.has(c), toggle: (c, on) => (on ?? !set.has(c)) ? set.add(c) : set.delete(c) };
      this._cls = set; all.push(this); }
    get id() { return this._id; } set id(v) { this._id = v; byId.set(v, this); }
    get className() { return [...this._cls].join(' '); } set className(v) { this._cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => this._cls.add(c)); }
    get isConnected() { let n = this; while (n.parentElement) n = n.parentElement; return n.tagName === 'BODY'; }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'title') this.title = String(v); } getAttribute(k) { return this.attrs[k] ?? null; }
    addEventListener() {}
    desc() { return this.children.flatMap(c => [c, ...c.desc()]); }
    is(sel) { return sel.split(',').some(s => { s = s.trim(); if (s.startsWith('.')) return this._cls.has(s.slice(1)); return this.tagName === s.toUpperCase(); }); }
    querySelector(sel) { return this.desc().find(n => n.is(sel)) || null; }
    matches(sel) { return this.is(sel); }
    closest(sel) { let n = this; while (n && !n.is(sel)) n = n.parentElement; return n; }
    detach() { const p = this.parentElement; if (p) p.children.splice(p.children.indexOf(this), 1); this.parentElement = null; return this; }   // как в DOM: вставка переносит узел
    appendChild(c) { c.detach(); c.parentElement = this; this.children.push(c); return c; }
    before(c) { c.detach(); const p = this.parentElement, i = p.children.indexOf(this); c.parentElement = p; p.children.splice(i, 0, c); }
    after(c) { c.detach(); const p = this.parentElement, i = p.children.indexOf(this); c.parentElement = p; p.children.splice(i + 1, 0, c); }
    get control() { if (this.htmlFor) { const n = byId.get(this.htmlFor); return n && LABELABLE.has(n.tagName) ? n : null; } return this.desc().find(n => LABELABLE.has(n.tagName)) || null; }
  }
  const body = new El('body'), section = body.appendChild(new El('section'));
  const make = (tag, props = {}) => Object.assign(new El(tag), props);
  const document = { createElement: t => new El(t), getElementById: id => byId.get(id) || null, querySelector: () => null,
    querySelectorAll: sel => sel === 'section label[title]' ? section.desc().filter(n => n.tagName === 'LABEL' && n.getAttribute('title')) : [] };
  return { document, section, make };
}
function label(d, text, input, title) {
  const lab = d.make('label'); if (title) lab.setAttribute('title', title); lab.textContent = text; d.section.appendChild(lab);
  lab.appendChild(input); return lab;
}

test('подписи с «i» из HELP и из title управляют своим полем, а не кнопкой «i»; «i» на месте', () => {
  const d = dom();
  const help = label(d, 'Разделывать улов и менять на Proof ', d.make('input', { id: 'fishProcess', type: 'checkbox' }));
  const sel = label(d, 'Наживка ', d.make('select', { id: 'fishBait' }));
  const auto = label(d, 'Катакомбы без FA ', d.make('input', { id: 'catNoFa', type: 'checkbox' }), 'баффы за FA не покупать');
  const noId = d.make('input', { type: 'checkbox' }), anon = label(d, 'Без id ', noId, 'пояснение из title');
  const box = { document: d.document, globalThis: null }; box.globalThis = box;
  vm.runInNewContext(src, box);
  assert.ok(box.L2V7Help.fishProcess && box.L2V7Help.fishBait, 'поля из HELP');
  for (const [lab, id] of [[help, 'fishProcess'], [sel, 'fishBait'], [auto, 'catNoFa']]) {
    assert.ok(lab.querySelector('.inline-info'), id + ': «i» вставлена');
    assert.equal(lab.control, d.document.getElementById(id), id + ': клик по тексту подписи — её поле, а не «i»');
  }
  assert.equal(anon.control, noId, 'поле без id: «i» после поля, подпись управляет полем');
  assert.equal(anon.children.indexOf(noId) < anon.children.indexOf(anon.querySelector('.inline-info')), true);
  // пояснение HELP по-прежнему сразу после подписи; у auto-info — только по нажатию
  assert.ok(d.section.children[d.section.children.indexOf(help) + 1]?.classList.contains('field-help'));
  assert.ok(!d.section.children[d.section.children.indexOf(auto) + 1]?.classList.contains('field-help'));
});
