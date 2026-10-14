'use strict';
// 14.10: контракт public battle-log-presentation/row-layout проверен в Chromium: в DOM имя входящего удара уже без [].
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function fixture(){const box={console,Date,Math,URLSearchParams,location:{search:'?spawnId=l2dop_rb_test'}},notes=[];vm.createContext(box);
 for(const mod of ['fightlab','raid'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../modules',mod+'.js'),'utf8'),box);
 const env={rt:{},cfg:{},logLines:()=>[],newLines:(a,b)=>b,activeBuffs:()=>[],heroLvl:()=>75,rec(){},mobHp:()=>null,setRt:async p=>Object.assign(env.rt,p),rbNote:async(id,p)=>{notes.push(p);env.rt.rbDb={...(env.rt.rbDb||{}),[id]:{...env.rt.rbDb?.[id],...p}}}};
 return {env,notes,fl:box.L2V7Factories.fightlab(env),raid:box.L2V7Factories.raid(env)};
}
const nums=x=>JSON.parse(JSON.stringify(x));
test('анализатор принимает новые явные входящие удары UA/RU и крит',()=>{const f=fixture(),r=f.fl.parseLog(['[Verfa] вдарив тебе: −250 HP.','Крит! [Verfa] завдав тобі −700 HP.','[Verfa] ударил тебя −300 HP.','Крит! [Verfa] нанёс тебе −800 HP.'],'Verfa');assert.deepEqual(nums(r.hits.map(x=>x.dmg)),[250,700,300,800]);assert.deepEqual(nums(r.hits.map(x=>x.crit)),[false,true,false,true]);assert.equal(r.own,0)});
test('краткий bracket-actor входящий удар принимается только от текущего моба',()=>{const f=fixture(),r=f.fl.parseLog(['[Verfa] −300 HP.','[Verfa] — крит! −750 HP.','[Other] −900 HP.','[Hero] −500 HP.'],'Verfa');assert.deepEqual(nums(r.hits.map(x=>x.dmg)),[300,750]);assert.equal(r.own,0)});
test('физический удар без имени цели и крит учитываются на РБ без HP fallback',()=>{const f=fixture();f.fl.onNet('/game/battle/start',{status:200,bt:{name:'Verfa',kind:'raid',spawn:'l2dop_rb_test',mob:10000,mobMax:10000,log:[],seq:1}});
 const t=f.fl.onNet('/game/battle/action',{status:200,req:{action:'attack'},bt:{mob:9800,seq:2,log:['Ти завдав 125 шкоди.','Крит! Ти завдав 75 урона.']}});assert.equal(t.own,200);assert.equal(t.crit,1)});
test('урон хозяина, кота, врага и спецудар не смешиваются',()=>{const f=fixture(),r=f.fl.parseLog(['\u20601220\u200bПолум’я — 5002 урона','Слуга [Kai the Cat] атакує [Verfa] 2 263 урону.','[Verfa] вдарив тебе: −250 HP.','Verfa · Гідроудар 1995','Coal ×5'],'Verfa');assert.equal(r.own,5002);assert.equal(r.pet,2263);assert.equal(r.hits[0]?.dmg,250);assert.equal(r.spikes[0]?.dmg,1995)});
test('РБ учит фактические удары из нового DOM без квадратных скобок',()=>{const f=fixture();f.env.logLines=()=>['Verfa ударив тебе −250 HP','Verfa ударив тебе −700 HP','Verfa ударив тебе −300 HP'];const ctx={name:'Verfa',rb:{id:'boss',lp:[]}};f.raid.rbLearn(ctx);assert.deepEqual(nums(ctx.rb.hits),[250,700,300]);assert.equal(f.env.rt.rbDb.boss.hitP90,700);assert.equal(f.env.rt.rbDb.boss.maxHit,700)});
test('новый DOM входящего урона приводит к аварийному решению настоящего rbFlee',()=>{const f=fixture();f.env.logLines=()=>['Verfa ударив тебе −700 HP'];const ctx={name:'Verfa',rb:{id:'boss',lp:[]}};const d=f.raid.rbFlee(ctx,{cur:1000,max:1500},{cur:9000,max:10000});assert.equal(d?.kind,'strong');assert.equal(d?.worst,700)});
test('РБ не учит урон хозяина, кота и чужого босса как входящий',()=>{const f=fixture();f.env.logLines=()=>['Ты нанёс [Verfa] 999 урона.','Other ударив тебе −950 HP','Слуга [Kai the Cat] атакує [Verfa] 2 263 урону.'];const ctx={name:'Verfa',rb:{id:'boss',lp:[]}};f.raid.rbLearn(ctx);assert.equal(ctx.rb.hits?.length||0,0);assert.equal(f.notes.length,0)});
function damageCore(){const src=fs.readFileSync(path.join(__dirname,'../content.js'),'utf8'),a=src.indexOf('const splashDmg ='),b=src.indexOf('const cdWatch =',a),box={};assert.ok(a>=0&&b>a);vm.runInNewContext(src.slice(a,b)+';globalThis.api={splashDmg,dmgFromLog};',box);return box.api;}
test('массовый урон учитывает всех соседей в строке и прибавляется к главной цели один раз',()=>{
 const c=damageCore(),lines=['Ты нанёс [Main] 50 урона.','Древко розсікло ворогів поруч: Alpha −111, Beta −222.'];
 assert.equal(c.splashDmg(lines),333);assert.equal(c.dmgFromLog('атака',lines),383);
 assert.equal(c.splashDmg(['Вихор вразив ворогів поруч: Alpha −111.','Землетрус вразив ворогів поруч: Beta -222.']),333);
});
test('тысячные пробелы в уроне соседей не режутся, остальные числа боя не считаются splash',()=>{
 const c=damageCore();assert.equal(c.splashDmg(['Поруч зачеплено: Alpha −1 234, Beta −2\u00a0345, Gamma -3\u202f456.']),7035);
 assert.equal(c.splashDmg(['Hurricane Assault: сила 535, −2 енергії сили 3247','[Mob] ударив тебе −250 HP.','Слуга [Kai the Cat] атакує [Mob] 900 урону.']),0);
});
