'use strict';
// 20.41 (лог 20.10 21:09, Bounty Hunter): урон native Whirlwind/Wild Sweep из DOM-журнала (украинские имена «Вихор»/«Дикий розмах»,
// основная строка «(головна + 3 поруч) N» не отбрасывается как соседи) и разовая миграция nativeDmg2041 испорченных средних.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),src=fs.readFileSync(path.join(root,'content.js'),'utf8');
function damageCore(){
 const s=src,a=s.indexOf('const splashDmg ='),b=s.indexOf('const cdWatch =',a),box={rt:{},setRt(p){box.learned=p;}};
 const na=s.indexOf('const NAME_ALIAS ='),nb=s.indexOf('for (const [a, b] of Object.entries(NAME_ALIAS))',na),ba=s.indexOf('const BUFF_RE ='),bb=s.indexOf('\n',ba);
 assert.ok(a>=0&&b>a&&na>=0&&nb>na&&ba>=0&&bb>ba);
 vm.runInNewContext(s.slice(na,nb)+s.slice(ba,bb)+'\n'+s.slice(a,b)+';globalThis.api={splashDmg,dmgFromLog};',box);return {...box.api,box};
}
test('Wild Sweep: «Дикий розмах: power 326 · КРИТ 14635» читается без запасного пути',()=>{
 const c=damageCore();
 assert.equal(c.dmgFromLog('Wild Sweep',['Дикий розмах: power 326 · КРИТ 14635'],false),14635);
 assert.equal(c.dmgFromLog('Wild Sweep',['Дикий розмах: power 326 7120'],false),7120);
 assert.equal(c.box.learned,undefined,'алиас не учится — он встроен');
});
test('Whirlwind: основная строка с «(головна + 3 поруч)» даёт урон главной цели',()=>{
 const c=damageCore(),main='Вихор: power 2033; до 4 цілей (головна + 3 поруч) 9893';
 assert.equal(c.dmgFromLog('Whirlwind',[main],false),9893);
 assert.equal(c.dmgFromLog('Whirlwind',['Вихор вразив ворогів поруч: A −111, B −222.',main],false),9893);
 assert.equal(c.splashDmg(['Вихор вразив ворогів поруч: A −111, B −222.',main]),333);
});
test('строки соседей без двоеточия и «додаткові цілі» по-прежнему не основной урон',()=>{
 const c=damageCore();
 for(const allowAlt of [false,true]){
  assert.equal(c.dmgFromLog('Whirlwind',['Вихор вразив ворогів поруч −123.'],allowAlt),0);
  assert.equal(c.dmgFromLog('Flame Strike',['Удар полум’я: додаткові цілі — A −700, B −900.'],allowAlt),0);
 }
});
function migration(rt){
 const a=src.indexOf("once('nativeDmg2041'"),b=src.indexOf("once('rbKill30_20261018'",a);assert.ok(a>0&&b>a);
 const box={rt,rf:{},cf:{},cfg:{},S:{...(rt.skills||{})},sk:false};
 vm.runInNewContext("const once=(flag,fn)=>{if(!rt[flag]&&!rf[flag]&&!cfg[flag]&&!cf[flag]){rf[flag]=1;cf[flag]=1;fn();}};"+src.slice(a,b)+';globalThis.out={S,sk};',box);
 return {rf:box.rf,S:box.out.S,sk:box.out.sk};
}
const bad=()=>({whirlwind:{name:'Whirlwind',cd:3,mp:40,dmg:5,dmgN:1,damageEvidence:{v:1,dmg:44000,dmgN:10,uses:10,unknown:0,spl:0,splN:0}},
 'wild sweep':{name:'Wild Sweep',cd:2,damageEvidence:{v:1,dmg:400000,dmgN:10,uses:10,unknown:0,spl:9,splN:1}},
 'атака':{dmg:4937,dmgN:1,damageEvidence:{v:1,dmg:4937,dmgN:1,uses:1,unknown:0,spl:0,splN:0}}});
const mem=()=>({'Mob A':{nm:'Mob A',n:3,a:{whirlwind:{n:3,s:[4400],z:0,rolls:[4400,4300],legacyRolls:[1],evidence:2,context:'x'},'атака':{n:2,s:[4900],rolls:[4900]}}},
 'Mob B':{nm:'Mob B',a:{'атака':{n:1,s:[1],rolls:[1]}}}});
test('nativeDmg2041 стирает испорченные средние в активной памяти, classStash и fightMem',()=>{
 const rt={skills:bad(),fightMem:mem(),classStash:{'Warlock':{skills:{blaze:{dmg:900,dmgN:1}},fightMem:mem()},'Bounty Hunter':{skills:bad(),fightMem:mem(),rbDps:5}}};
 const {rf,S,sk}=migration(rt);
 assert.equal(rf.nativeDmg2041,1);assert.equal(sk,true);
 for(const k of ['whirlwind','wild sweep']){assert.equal(S[k].damageEvidence,undefined);assert.equal(S[k].dmgN,0);assert.equal(S[k].splN,0);}
 assert.equal(S.whirlwind.cd,3);assert.equal(S.whirlwind.mp,40);
 assert.equal(S['атака'],rt.skills['атака']);
 const wa=rf.fightMem['Mob A'].a;assert.equal(wa.whirlwind.rolls,undefined);assert.equal(wa.whirlwind.legacyRolls,undefined);assert.equal(wa.whirlwind.s.length,0);assert.equal(wa.whirlwind.n,3);
 assert.equal(wa['атака'],rt.fightMem['Mob A'].a['атака']);
 assert.equal(rf.fightMem['Mob B'],rt.fightMem['Mob B']);
 const bh=rf.classStash['Bounty Hunter'];assert.equal(bh.rbDps,5);assert.equal(bh.skills.whirlwind.damageEvidence,undefined);assert.equal(bh.skills['wild sweep'].dmgN,0);
 assert.equal(bh.fightMem['Mob A'].a.whirlwind.rolls,undefined);
 assert.equal(rf.classStash.Warlock.skills,rt.classStash.Warlock.skills);
 assert.equal(rf.classStash.Warlock.fightMem['Mob A'].a.whirlwind.rolls,undefined);
 assert.equal(rt.skills.whirlwind.damageEvidence.dmgN,10,'исходное rt не мутируется');
});
test('nativeDmg2041 без native-умений ничего не пишет, кроме флага; повторно не выполняется',()=>{
 const {rf,sk}=migration({skills:{blaze:{dmg:1,dmgN:1}},fightMem:{},classStash:{W:{skills:{}}}});
 assert.equal(sk,false);assert.equal(Object.keys(rf).join(),'nativeDmg2041');
 const r2=migration({nativeDmg2041:1,skills:bad()});assert.equal(r2.sk,false);assert.equal(r2.S.whirlwind.damageEvidence.dmgN,10);
});
test('миграция учитывает classStash, уже изменённый rbDpsClass2041 в том же проходе',()=>{
 const a=src.indexOf("once('rbDpsClass2041'"),b=src.indexOf("once('nativeDmg2041'");assert.ok(a>0&&b>a,'nativeDmg2041 идёт после rbDpsClass2041');
 assert.match(src.slice(b,b+3000),/rf\.classStash \|\| rt\.classStash/);
});
