'use strict';
// Лог28.10 11:32: подтверждённые дополнительные убийства Flame Strike терялись при новой странице того же Rebirth-run.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../modules/fightlab.js','utf8');
const run='69c9caaf-0940-4ecf-a948-51e4101413b5',name='Rebirth · Fettered Soul',hp=13226;
const spawn=(o={})=>'rebirth_raid_'+(o.run||run)+'_'+(o.stage||1)+'_'+(o.difficulty||1)+'_'+(o.base||25170)+'_lv'+(o.level||38)+'_'+(o.role||'mob')+'_'+(o.index??1);
const plain=x=>JSON.parse(JSON.stringify(x));
function fixture(o={}){
 let now=o.now??1000000,rid=0;
 const rt=o.rt||{char:'Warlock',classCur:{prof:'human_wizard',slot:0},skills:{'flame strike':{aoe:1}}};
 const location={pathname:'/battle.html',search:'?spawnId='+encodeURIComponent(o.spawn||spawn())};
 const env={rt,cfg:o.cfg||{},routeLocation:location,mobTitle:()=>name+' · ур. 38',actName:a=>a==='l2_1181'?'Flame Strike':a,
  isChamp:()=>false,isBoss:()=>false,setRt:p=>{Object.assign(rt,p);return Promise.resolve({ok:true});}};
 const box={URLSearchParams,Date:{now:()=>now}};
 vm.runInNewContext(source,box);const L=box.L2V7Factories.fightlab(env);
 const send=(path,bt)=>L.onNet(path,{status:200,rid:++rid,req:{action:'l2_1181'},res:{},bt:{actor:rt.char,prof:rt.classCur.prof,slot:rt.classCur.slot,...bt}});
 function learn(sid=o.spawn||spawn()){
  send('/game/battle/start',{spawn:sid,name,lvl:38,kind:'dungeon',mob:hp,mobMax:hp,hp:3562,mp:1600,seq:1,rev:100,log:['Бій розпочато: ['+name+'] (ур. 38).']});
  now+=400;
  send('/game/battle/action',{spawn:sid,name,kind:'dungeon',mob:0,mobMax:hp,hp:3562,mp:1580,rev:101,end:true,win:true,
   log:['Удар полум’я: додаткові цілі — '+name+' −14851, '+name+' −14851.','\u20601181\u200bУдар полум’я · КРИТ — 14851 урона',
    'Додаткова ціль повалена: '+name+'.','EXP + 480','Додаткова ціль повалена: '+name+'.','EXP + 480','Перемога!','EXP + 480']});
  return L.groupOn('Flame Strike',hp);
 }
 return{L,rt,env,location,learn,setNow:n=>now=n};
}
test('нативный ответ AoE переносит две дополнительные добычи через reload и следующий номер моба того же run',()=>{
 const f=fixture(),learned=f.learn();assert.ok(learned);assert.equal(learned.kills,2);assert.equal(learned.targets,2);assert.equal(learned.damage,14851);
 const after=fixture({rt:f.rt,now:1005000,spawn:spawn({index:12})});
 assert.deepEqual(plain(after.L.groupOn('flame strike',hp)),plain(learned));
 assert.equal(Object.keys(f.rt.fightGroups).length,1);
});
test('реальный magePlan на следующей странице выбирает надёжный Flame Strike с подтверждённой дополнительной добычей',()=>{
 const learned=fixture();learned.learn();
 const after=fixture({rt:learned.rt,now:1005000,spawn:spawn({index:12})}),f=require('./warlock-combat-fixture.cjs').flowFixture('mage'),e=f.env;
 const flame={title:'Flame Strike',getAttribute:()=>null};f.slots.push(flame);f.hp.textContent=hp+' / '+hp;
 e.rt.skills={blaze:{dmg:26000*3,dmgN:3},'flame strike':{dmg:14851*3,dmgN:3,aoe:1}};
 e.expDmg=k=>{const p=e.rt.skills[k.toLowerCase()];return p?p.dmg/p.dmgN:0};
 e.skillMp=n=>n==='Flame Strike'?35:30;e.ilOf=()=>({c:'Маг. атака',t:'MDAM',mp:35});
 e.fightGroupOn=(n,h)=>after.L.groupOn(n,h);const ctx={block:{},rebirth:{role:'mob'}};
 for(let i=0;i<3;i++)f.combat.aoeProbe.note('Flame Strike'); // прежний лимит проб исчерпан — выбор должен опираться на реальную добычу
 assert.equal(f.combat.magePlan(ctx,{cur:1600,max:1799}).name,'Flame Strike');
 after.location.search='?spawnId='+spawn({level:39});
 assert.equal(f.combat.magePlan(ctx,{cur:1600,max:1799}).name,'Blaze','другой уровень не наследует групповое преимущество');
});
test('нативный start связывает замер с собственным spawn при ещё старом URL страницы',()=>{
 const f=fixture();f.location.search='?spawnId=dense_999';f.learn();
 assert.equal(f.L.groupOn('Flame Strike',hp),null,'старый URL не получает новый прогноз');
 const after=fixture({rt:f.rt,now:1005000,spawn:spawn({index:2})});assert.equal(after.L.groupOn('Flame Strike',hp)?.kills,2);
});
for(const [change,patch]of Object.entries({run:{run:'79c9caaf-0940-4ecf-a948-51e4101413b5'},stage:{stage:2},difficulty:{difficulty:2},base:{base:25171},level:{level:39},champion:{role:'champion'},raid:{role:'raid',index:0}}))
 test('замер не переносится в другой контекст похода: '+change,()=>{
  const f=fixture();f.learn();const after=fixture({rt:f.rt,now:1005000,spawn:spawn(patch)});assert.equal(after.L.groupOn('Flame Strike',hp),null);
 });
for(const change of ['char','class','slot'])test('замер не переносится к другому владельцу: '+change,()=>{
 const f=fixture();f.learn();const rt=plain(f.rt);
 if(change==='char')rt.char='Other';if(change==='class')rt.classCur.prof='human_warlock';if(change==='slot')rt.classCur.slot=1;
 assert.equal(fixture({rt,now:1005000}).L.groupOn('Flame Strike',hp),null);
});
test('срок5минут, обратный ход часов и непохожее HP не дают использовать прогноз',()=>{
 const f=fixture();f.learn();
 assert.equal(fixture({rt:f.rt,now:1300400}).L.groupOn('Flame Strike',hp),null);
 assert.equal(fixture({rt:f.rt,now:1000000}).L.groupOn('Flame Strike',hp),null);
 assert.equal(fixture({rt:f.rt,now:1005000}).L.groupOn('Flame Strike',hp*3),null);
 assert.equal(fixture({rt:f.rt,now:1300399}).L.groupOn('Flame Strike',hp)?.kills,2);
});
test('обычная карта с известной зоной и катакомбы сохраняют прежний scope',()=>{
 for(const cfg of [{},{catMode:true,catDungeon:'test-cat'}]){
  const f=fixture({spawn:'dense_1',cfg});f.rt.zone='test-zone';f.learn('dense_1');
  const expected=cfg.catMode?'cat:test-cat|flame strike':'map:test-zone|flame strike';
  assert.ok(f.rt.fightGroups[expected]);
  const after=fixture({rt:f.rt,now:1005000,spawn:'dense_2',cfg});assert.equal(after.L.groupOn('Flame Strike',hp)?.kills,2);
 }
});
test('неизвестная обычная карта и повреждённый Rebirth-ID не получают перенос после reload',()=>{
 for(const sid of ['dense_1',spawn().replace(run,'bad-run')]){
  const f=fixture({spawn:sid});f.learn(sid);assert.ok(f.L.groupOn('Flame Strike',hp));
  const after=fixture({rt:f.rt,now:1005000,spawn:sid});assert.equal(after.L.groupOn('Flame Strike',hp),null);
 }
});
test('неполный владелец и неоднозначный query не получают сохранённый Rebirth-прогноз',()=>{
 const f=fixture();f.learn();
 for(const field of ['char','prof','slot']){
  const rt=plain(f.rt);if(field==='char')delete rt.char;else delete rt.classCur[field];
  const after=fixture({rt,now:1005000});assert.equal(after.L.groupOn('Flame Strike',hp),null);
 }
 const after=fixture({rt:f.rt,now:1005000});after.location.search+='&spawnId='+spawn({index:2});
 assert.equal(after.L.groupOn('Flame Strike',hp),null);
});
