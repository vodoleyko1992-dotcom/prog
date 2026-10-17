'use strict';
// 20.13 (ревизия 17.10, шаг 5, quality/L3): умолчания ведутся вручную в двух таблицах — DEF_CFG (content.js, движок)
// и DEF (popup.js, меню). Тест сверяет: каждый ключ меню есть в DEF_CFG с тем же значением, иначе игрок видит в меню одно,
// а бот работает с другим. Скрытые настройки (раньше только `?? 30` в месте чтения) теперь в DEF_CFG с теми же значениями.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=f=>fs.readFileSync(__dirname+'/../'+f,'utf8');
function table(src,decl){const i=src.indexOf(decl);assert.ok(i>=0,decl);let j=src.indexOf('{',i),d=0,k=j;
 for(;k<src.length;k++){if(src[k]==='{')d++;else if(src[k]==='}'&&!--d)break;}return src.slice(j,k+1);}
const content=read('content.js'),popup=read('popup.js');
// Константы диапазона дневных лимитов — как в content.js (popup пишет числа напрямую).
const consts=content.slice(content.indexOf('const DAILY_RANGE ='),content.indexOf('const DEF_CFG ='));
const C=vm.runInNewContext(consts+';('+table(content,'const DEF_CFG = ')+')');
const P=vm.runInNewContext('('+table(popup,'const DEF = ')+')');
test('каждое умолчание меню совпадает с умолчанием движка',()=>{
 const missing=[],diff=[];
 for(const k of Object.keys(P)){if(!Object.hasOwn(C,k))missing.push(k);else if(JSON.stringify(C[k])!==JSON.stringify(P[k]))diff.push(`${k}: движок ${JSON.stringify(C[k])}, меню ${JSON.stringify(P[k])}`);}
 assert.deepEqual(missing,[],'ключи меню без умолчания движка');
 assert.deepEqual(diff,[],'разные умолчания');
});
test('скрытые настройки видны в DEF_CFG с прежними значениями из мест чтения',()=>{
 const want={mageEcoPct:30,mageMpPct:25,mageProbe:true,rbVampHp:60,rbDeathPenalty:0,magisterSpReserve:0,fishRodBuy:true,fishAutoSetup:true};
 for(const [k,v] of Object.entries(want))assert.equal(C[k],v,k);
 assert.equal(C.magisterSkip,vm.runInNewContext(content.match(/const MAG_SKIP_DEF = [^;]+/)[0].replace('const MAG_SKIP_DEF = ','')),'magisterSkip = MAG_SKIP_DEF');
 const combat=read('modules/combat.js');
 assert.match(combat,/mageEcoPct \?\? 30/);assert.match(combat,/mageMpPct \?\? 25/);assert.match(combat,/rbVampHp \?\? 60/);
});
test('импорт меню принимает новые ключи DEF_CFG (CFG_IMPORT_EXTRA или DEF)',()=>{
 const extra=vm.runInNewContext('('+table(popup,'const CFG_IMPORT_EXTRA = ')+')');
 for(const k of ['mageEcoPct','mageMpPct','mageProbe','rbVampHp','rbDeathPenalty','magisterSkip','magisterSpReserve','fishRodBuy','fishAutoSetup'])
  assert.ok(Object.hasOwn(extra,k)||Object.hasOwn(P,k),k);
});
