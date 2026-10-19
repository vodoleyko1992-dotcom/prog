'use strict';
// 19.10: снимки обеих ветвей очищают вложенные поля, не меняя рабочее дерево страницы.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(require('node:path').join(__dirname,'../content.js'),'utf8');
const start=src.indexOf('function domSnapshot() {'),end=src.indexOf('// проверка панели:',start);
assert.ok(start>=0&&end>start);
const escape=s=>String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
class Element {
 constructor(tag,attrs={},children=[],text=''){this.tagName=tag.toUpperCase();this.attrs={...attrs};this.children=children;this.text=text;for(const child of children)child.parent=this;}
 get className(){return this.attrs.class||'';}
 get outerHTML(){const tag=this.tagName.toLowerCase();return '<'+tag+Object.entries(this.attrs).map(([k,v])=>' '+k+'="'+escape(v)+'"').join('')+'>'+escape(this.text)+this.children.map(c=>c.outerHTML).join('')+'</'+tag+'>';}
 cloneNode(deep){return new Element(this.tagName,this.attrs,deep?this.children.map(c=>c.cloneNode(true)):[],this.text);}
 querySelectorAll(selector){const tags=selector.split(',').map(t=>t.toUpperCase()),out=[];const walk=n=>{for(const child of n.children){if(tags.includes(child.tagName))out.push(child);walk(child);}};walk(this);return out;}
 remove(){this.parent.children=this.parent.children.filter(c=>c!==this);}
 removeAttribute(k){delete this.attrs[k];}
 set textContent(v){this.text=String(v);this.children=[];}
}
const el=(tag,attrs,children,text)=>new Element(tag,attrs,children,text);
const privateBlock=()=>el('section',{id:'panel'},[el('div',{},[
 el('input',{type:'password',value:'FAKE_PASSWORD'}),el('input',{type:'hidden',name:'csrf',value:'FAKE_CSRF'}),
 el('textarea',{value:'FAKE_TEXTAREA_ATTRIBUTE'},[],'FAKE_TEXTAREA_TEXT'),el('script',{},[],'FAKE_SCRIPT_TOKEN'),
 el('iframe',{src:'FAKE_FRAME'}),el('style',{},[],'FAKE_STYLE'),el('noscript',{},[],'FAKE_NOSCRIPT'),el('span',{id:'status'},[],'Рыбалка готова')])]);
function snapshot(body,search=''){
 const count=n=>1+n.children.reduce((sum,c)=>sum+count(c),0);
 const c={Date,URLSearchParams,document:{body,getElementsByTagName:()=>({length:count(body)+2})},location:{pathname:'/map.html',search}};
 vm.createContext(c);vm.runInContext(src.slice(start,end),c);return c.domSnapshot();
}
function cleanResult(body){const original=body.outerHTML,html=snapshot(body);assert.doesNotMatch(html,/FAKE_|<(script|style|noscript|iframe)\b/i);assert.match(html,/Рыбалка готова/);assert.match(html,/id="status"/);assert.equal(body.outerHTML,original,'рабочий DOM не изменён');return html;}
test('обычная страница: вложенные поля очищены, видимая структура сохранена',()=>{
 const html=cleanResult(el('body',{},[privateBlock()]));assert.match(html,/<input type="password">/);assert.match(html,/<textarea>/);assert.doesNotMatch(html,/крупная страница/);
});
test('более3500узлов: короткое поддерево проходит полную очистку',()=>{
 const body=el('body',{},[privateBlock(),...Array.from({length:3500},()=>el('i'))]);assert.match(cleanResult(body),/крупная страница/);
});
test('большой контейнер более60000знаков: очистка действует на вложенные короткие блоки',()=>{
 const container=el('main',{},[privateBlock(),...Array.from({length:3500},()=>el('i',{},[],'строка'.repeat(10)))]);
 assert.ok(container.outerHTML.length>60000);assert.match(cleanResult(el('body',{},[container])),/<main/);
});
for(const large of [false,true])test('секретные query значения вырезаны, обычные параметры сохранены: '+large,()=>{
 const body=el('body',{},large?Array.from({length:3500},()=>el('i')):[]);
 const html=snapshot(body,'?spawnId=boss&page=2&token=FAKE_ONE&token=FAKE_TWO&password=FAKE_PASS&sid=FAKE_SID&csrf=FAKE_CSRF&passed=1&userId=42');
 assert.doesNotMatch(html,/FAKE_/);assert.match(html,/spawnId=boss&page=2/);assert.match(html,/token=\*\*\*/);assert.match(html,/passed=1&userId=42/);
});
test('большой снимок сохраняет ограничение объёма и экранирует class обёрток',()=>{
 const body=el('body',{class:'x" data-injected="bad'},Array.from({length:8000},()=>el('div',{},[],'x'.repeat(100))));
 const html=snapshot(body);assert.ok(html.length<400300,'прежний предел400000+заголовок/обёртка');assert.match(html,/class="x&quot; data-injected=&quot;bad"/);
});
