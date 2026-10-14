'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {mk,docOf}=require('./epic-harness.cjs');
function fixture(opt={}){
 const count=197,total=14,clicks=[];let current=1;
 function page(p,rowsPage=p){
  const first=Math.floor((p-1)/5)*5+1,last=Math.min(total,first+4),buttons=[];
  if(first>1)buttons.push('<button>&lt;&lt;</button>');
  for(let i=first;i<=last;i++)buttons.push(`<button${i===p?' disabled aria-current="page"':''}>${i}</button>`);
  if(last<total)buttons.push('<button>&gt;&gt;</button>');
  const rows=[];for(let i=(rowsPage-1)*15;i<Math.min(rowsPage*15,count);i++)rows.push(`<div class="l2-rb-row"><span class="l2-rb-row__label">Boss ${i}</span><span class="l2-rb-row__level">${i===100?50:80}</span><span class="l2-rb-row__status l2-rb-row__status--alive">Жив</span><span class="l2-rb-row__price">100000 аден</span><button class="l2-rb-row__tp" data-spawn-id="boss${i}">Телепорт</button></div>`);
  return docOf(`<div id="rb-pager-ind">${buttons.join('')}</div><div id="rb-list">${rows.join('')}</div><button id="rb-pager-next" hidden>Старая стрелка</button>`);
 }
 const m=mk({hero:55,path:'/rb-bosses.html',search:'?page=1',doc:page(1),cfg:{epicMode:false,rbHuntMode:true,rbMode:true,rbOrder:'up',rbProbe:false,rbMaxBelow:15,rbMaxAbove:5},rt:{rbDb:{},rbList:{},rbStats:{boss100:{hp:10000,patk:10,matk:10,mdef:10,pdef:10,src:'api'}},rbDps:2000},meHp:()=>({cur:10000,max:10000,pct:100}),env:{rnd:()=>0,RB_WIN:15,RB_TRY_MS:600000,RB_RETRY_MS:120000,storyRbIds:()=>[]}});
 m.env.fire=b=>{const label=b.textContent.trim();clicks.push(label);if(opt.deny)return false;
  const p=label==='>>'?Math.floor((current-1)/5)*5+6:Number(label);assert.equal(p,current+1,'не пропускаем страницы');
  if(opt.stop){m.env.on=false;return true;}if(opt.lease){m.env.tabOwner=false;return true;}
  m.setDoc(page(p,opt.stale?current:p));current=p;m.loc.search='?page='+p;return true;};
 return {...m,clicks,page};
}
test('полные14 страниц/197 РБ: цифры панели не меняются на1→2, группы5→6 и10→11, последняя14',async()=>{
 const m=fixture();const first=m.env.$q('#rb-pager-ind').textContent;assert.equal(first,m.page(2).querySelector('#rb-pager-ind').textContent);
 await m.R.rbListScan();assert.equal(Object.keys(m.env.rt.rbList).length,197);
 assert.deepEqual(m.clicks,['2','3','4','5','>>','7','8','9','10','>>','12','13','14']);
 assert.equal(m.env.rt.rbList.boss100.page,7);assert.equal(m.env.rt.rbList.boss196.page,14);
 assert.ok(m.logs.some(x=>x.includes('список игры: 197 РБ')));
 assert.equal(m.R.rbListPick().id,'boss100','подходящий босс с7-й страницы доступен реальному планировщику');
});
for(const kind of ['deny','stale'])test('неуспешный переход '+kind+' не выдаёт список за полный',async()=>{
 const m=fixture({[kind]:true});await m.R.rbListScan();assert.equal(m.clicks.length,1);assert.equal(Object.keys(m.env.rt.rbList).length,15);assert.ok(m.logs.some(x=>x.includes('частично')));
});
for(const kind of ['stop','lease'])test(kind+' во время перехода прекращает сканирование без публикации кэша',async()=>{
 const m=fixture({[kind]:true});await m.R.rbListScan();assert.equal(m.clicks.length,1);assert.equal(Object.keys(m.env.rt.rbList).length,0);assert.equal(m.loc.href,'');
});
