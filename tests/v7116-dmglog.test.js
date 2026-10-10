// extract dmgFromLog + deps from content.js and test against real log lines
const fs=require('fs'); const src=fs.readFileSync(require('path').join(__dirname,'..','content.js'),'utf8');
const cut=(a,b)=>{const i=src.indexOf(a);return src.slice(i,src.indexOf(b,i));};
let rt={skills:{}}; const setRt=p=>Object.assign(rt,p);
const BUFF_RE=/накладено|бафф на (\d+)/i;
eval(cut('const NAME_ALIAS','for (const [a, b] of Object.entries(NAME_ALIAS))').replace(/^const /gm,'var '));
eval(cut('const splashDmg','const cdWatch').replace(/^const /gm,'var '));
const assert=require('assert');
assert.equal(dmgFromLog('Vampiric Touch',['Слуга [Kat the Cat] атакує [Tumran Bugbear] 554 урону.','HP +10 (зцілення).','Вампіризм +10 HP','Вампірний дотик 596'],false),596);
assert.equal(dmgFromLog('Blaze',['Удар полум’я 610','Полум’я 618'],false),618);
assert.equal(dmgFromLog('Flame Strike',['Полум’я 618','Удар полум’я 610','Удар полум’я: додатково'],false),610);
assert.equal(dmgFromLog('Aura Burn',['Опік аури · КРИТ 1066'],false),1066);
assert.equal(dmgFromLog('Energy Bolt',['[Tumran Bugbear] ударив тебе −10 HP.','Покликання Mew the Cat — слугу призвано.'],false),0);
assert.equal(dmgFromLog('Wind Strike',['Удар вітру 312'],true),312); assert.equal(rt.logAlias['wind strike'],'удар вітру');
assert.equal(dmgFromLog('Wind Strike',['Вампірний дотик 590','Удар вітру 300'],false),300);
console.log('PASS dmgFromLog localized names');
