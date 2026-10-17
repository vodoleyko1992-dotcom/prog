'use strict';
// 20.12 (ревизия 17.10, аудит PAY-1): ручной выход игрока «Считать оплату не прошедшей» — только из меню, через фон,
// только та оплата и тот герой, что показаны; меню показывает, что именно ждёт сверки.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const bg=read('background.js'),pop=read('popup.js');
const cut=(s,a,b)=>{const i=s.indexOf(a),j=s.indexOf(b,i+1);assert.ok(i>=0&&j>i,'нет фрагмента '+a);return s.slice(i,j)};
const pending={id:'p-1',kind:'shop',char:'Hero',at:1000,quote:{amount:500000,currency:'Adena'},evidence:{label:'A'}};
function background(rt){
 const store={rt},sets=[],buf=[];
 const box={JSON,Date,URL,buf,timer:1,flush(){},console,serializeLock:fn=>fn(),
  chrome:{runtime:{id:'ext',getURL:p=>'chrome-extension://ext/'+p},storage:{local:{get:async()=>({rt:JSON.parse(JSON.stringify(store.rt))}),set:async v=>{sets.push(v);Object.assign(store,v)}}}}};
 vm.runInNewContext(cut(bg,'function paymentDismissChange(','async function switchCharacter(')+'\nthis.dismiss=paymentDismiss;this.change=paymentDismissChange;',box);
 return {box,store,sets,buf:box.buf};
}
const popupSender={id:'ext',url:'chrome-extension://ext/popup.html'};
test('кнопка из меню: оплата уходит в историю «не прошла (решение игрока)», ожидание снято, строка в журнале',async()=>{
 const b=background({char:'Hero',actionPayments:{pending,history:[{id:'old'}]}});
 const r=await b.box.dismiss({pendingId:'p-1',expectedChar:'Hero'},popupSender);assert.equal(r.ok,true);
 const ap=b.store.rt.actionPayments;assert.equal(ap.pending,null);assert.equal(ap.history[0].id,'p-1');assert.equal(ap.history[0].phase,'dismissed');
 assert.equal(ap.history[0].confirmation.kind,'player-dismissed');assert.equal(ap.history[1].id,'old');assert.equal(b.store.rt.paymentDismissed.id,'p-1');
 assert.equal(b.buf.length,1);assert.match(b.buf[0].what,/Считать оплату не прошедшей/);assert.match(b.buf[0].what,/500000 Adena/);
});
test('другая оплата, другой герой, нет оплаты — ничего не меняется',async()=>{
 for(const [m,rt] of [[{pendingId:'p-2',expectedChar:'Hero'},{char:'Hero',actionPayments:{pending}}],[{pendingId:'p-1',expectedChar:'Other'},{char:'Hero',actionPayments:{pending}}],[{pendingId:'p-1',expectedChar:'Hero'},{char:'Hero',actionPayments:{pending:null}}],[{pendingId:'p-1'},{char:'Hero',actionPayments:{pending}}]]){
  const b=background(rt);const r=await b.box.dismiss(m,popupSender);assert.equal(r.ok,false);assert.equal(b.sets.length,0);assert.equal(b.buf.length,0);
 }
});
test('команда принимается только от меню расширения, не от страницы игры',async()=>{
 const b=background({char:'Hero',actionPayments:{pending}});
 for(const s of [{id:'ext',url:'https://l2wap.com/map.html',tab:{id:1}},{id:'other',url:'chrome-extension://ext/popup.html'},{}]){const r=await b.box.dismiss({pendingId:'p-1',expectedChar:'Hero'},s);assert.equal(r.ok,false)}
 assert.equal(b.sets.length,0);assert.ok(b.store.rt.actionPayments.pending);
});
test('фон слушает команду paymentDismiss',()=>{assert.match(bg,/m\?\.cmd === 'paymentDismiss'/)});
test('меню: видно, что ждёт сверки (вид, сумма, давность), и кнопка отправляет id оплаты и героя через фон',()=>{
 const c={Math,Number,String};vm.runInNewContext(cut(pop,'const PAY_KIND_LABELS','function workspaceState(')+'\nthis.view=paymentPendingView;',c);
 assert.equal(c.view({}),null);assert.equal(c.view({actionPayments:{pending:null}}),null);
 const v=c.view({char:'Hero',actionPayments:{pending:{...pending,kind:'raid-teleport',evidence:{name:'Gwindorr'}}}},1000+5*60000);
 assert.equal(v.id,'p-1');assert.equal(v.char,'Hero');assert.match(v.text,/телепорт к РБ/);assert.match(v.text,/Gwindorr/);assert.match(v.text,/5 мин назад/);assert.match(v.text,/Adena/);
 const m=c.view({actionPayments:{pending:{...pending,kind:'mammon',evidence:{action:'upgrade'}}}},1000);assert.match(m.text,/Маммон: улучшение/);
 assert.match(pop,/cmd: 'paymentDismiss', pendingId: id, expectedChar: char/);
 const html=read('popup.html');assert.match(html,/id="paymentDismiss"[^>]*>Считать оплату не прошедшей</);assert.match(html,/id="paymentPendingText"/);
});
console.log('PASS: v2012-pay-dismiss');
