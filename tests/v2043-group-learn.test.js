'use strict';
// 20.43 (лог 21.10 15:47–15:51, строка 655): «Удар полум’я: додаткові цілі — Lesser Dark Horror −152620, Dryad −152620» —
// модель группы Flame Strike так и не появилась, и каждый бой шёл с пробой АОЕ. Разбор строки был верным; ответ на убивающий ход
// приходит, когда игра уже убрала панель боя, и actName отдавал «l2_1181» — модель писалась под этим ключом.
// Теперь имена слотов снимаются при отправке хода (netStart).
const fs=require('fs'),vm=require('vm'),path=require('path'),test=require('node:test'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const LOG=['Бій розпочато: [Nephilim Commander] (ур. 78).','Удар полум’я: додаткові цілі — Lesser Dark Horror −152620, Dryad −152620.','⁠1181​Удар полум’я · КРИТ — 152620 урона',
 'Додаткова ціль повалена: Lesser Dark Horror.','Animal Bone ×3','EXP + 545','SP + 44','+1070 аден','Додаткова ціль повалена: Dryad.','Animal Bone ×3','Charcoal ×5','Coal ×5','EXP + 924','SP + 72','+1804 аден',
 'Перемога!','Green Seal Stone ×105','Fast Aden ×1','EXP + 41856','SP + 1902','+14293 аден','Відважний мисливець: мисливська шкура +1'];
function lab(actName){
 let now=1792561838000;class Clock extends Date{static now(){return now;}}
 const env={cfg:{catMode:true},rt:{char:'W',classCur:{prof:'human_arcana_lord',slot:0},catIn:'catacomb_of_dark_omens'},recoveryContext:()=>'x',pvpPending:()=>false,actName,
  setRt:async p=>Object.assign(env.rt,p),setRtSoon:async p=>Object.assign(env.rt,p),rec(){}};
 const box={console,Date:Clock,Math,URLSearchParams,location:{search:'?spawnId=sdms_catacomb_of_dark_omens_056'}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'modules/fightlab.js'),'utf8'),box);const api=box.L2V7Factories.fightlab(env);
 api.onNet('/game/battle/start',{status:200,rid:16,bt:{name:'Nephilim Commander',spawn:'sdms_catacomb_of_dark_omens_056',kind:'passive',hp:21307,mp:6209,mob:3924,mobMax:3924,rev:398626,seq:1,log:LOG.slice(0,1)}});
 now+=900;
 api.onNet('/game/battle/action',{status:200,rid:17,req:{action:'l2_1181'},bt:{name:'Nephilim Commander',spawn:'sdms_catacomb_of_dark_omens_056',hp:21307,mp:6181,mob:0,mobMax:null,rev:398627,seq:null,end:true,win:true,full:true,log:LOG}});
 return {api,env};
}
test('строка 655: разбор основной цели и двух дополнительных',()=>{
 const p=lab(()=> 'flame strike').api.parseLog(LOG.slice(1),'Nephilim Commander');
 assert.equal(p.own,152620);assert.equal(p.splash.length,2);assert.deepEqual([...p.extraKills],['Lesser Dark Horror','Dryad']);
});
test('убивающий Flame Strike даёт модель группы для следующего боя',()=>{
 const g=lab(a=>a==='l2_1181'?'flame strike':a).api.groupOn('flame strike',3924);
 assert.ok(g,'модель есть');assert.equal(g.targets,2);assert.equal(g.kills,2);assert.equal(g.damage,152620);
});
test('без имени слота (l2_1181) модели под именем нет — причина пробы в каждом бою',()=>{
 assert.equal(lab(a=>a).api.groupOn('flame strike',3924),null);
});
function actNameCore(){
 const s=fs.readFileSync(path.join(root,'content.js'),'utf8');
 const ct=s.slice(s.indexOf('const cleanTitle ='),s.indexOf('function slotKind(b)'));
 const a=s.indexOf('const ACT_NAMES = new Map();'),b=s.indexOf('const gameBusy =',a);
 const c=s.indexOf('const actName = a =>'),d=s.indexOf('L2V7Modules.fightlab =',c);
 assert.ok(a>0&&b>a&&c>0&&d>c);
 let slots=[{title:'Flame Strike',getAttribute:k=>k==='data-slot-cd'?'l2_1181':null,querySelector:()=>null},{title:'Blaze — 22 MP',getAttribute:k=>k==='data-slot-cd'?'l2_1220':null,querySelector:()=>null}];
 const document={querySelectorAll:()=>slots,querySelector:sel=>{const m=sel.match(/data-slot-cd="([^"]+)"/);return m?slots.find(x=>x.getAttribute('data-slot-cd')===m[1])||null:null}};
 const box={document};vm.runInNewContext(ct+'\n'+s.slice(a,b)+'\n'+s.slice(c,d)+';globalThis.api={actName,actNameSnap};',box);
 return {api:box.api,gone:()=>{slots=[]}};
}
test('actName: панель убрана после победы — имя из снимка при отправке хода',()=>{
 const c=actNameCore();assert.equal(c.api.actName('l2_1181'),'flame strike');
 c.api.actNameSnap();c.gone();
 assert.equal(c.api.actName('l2_1181'),'flame strike');assert.equal(c.api.actName('l2_1220'),'blaze');
 assert.equal(c.api.actName('l2_9999'),'l2_9999');assert.equal(c.api.actName('attack'),'атака');
});
test('netStart хода снимает имена слотов',()=>{
 const s=fs.readFileSync(path.join(root,'content.js'),'utf8');
 assert.match(s,/if \(p === '\/game\/battle\/action'\) actNameSnap\(\);/);
});
