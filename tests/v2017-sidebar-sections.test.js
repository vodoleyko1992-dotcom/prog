'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'popup.html'),'utf8'),js=fs.readFileSync(path.join(root,'popup.js'),'utf8');
const section=id=>html.match(new RegExp('<section id="tab-'+id+'"[^>]*>([\\s\\S]*?)</section>'))?.[1]||'';
test('Маммон, заточка, ЛС, PvP и сервис доступны напрямую, каждый контрол имеет одного владельца',()=>{
 for(const [owner,ids]of Object.entries({mammon:['mmOrders','mmTpMax','mmGoalItem','mmGoalLvl','mmPlanBox','mmUpgrade','mmMailClaim'],enchant:['enchantModeToggle','enchantPanel'],lifestone:['lsCurrent','sealAuto','sealMin','sealNow','sealBox'],pvp:['tvtOn','tsGoalItem','pvpTargetsPanel','enemyHunt'],svc:['cfgExport','memSave','recClear']})){
  assert.match(html,new RegExp('<button data-tab="'+owner+'"'));
  for(const id of ids){assert.ok(section(owner).includes('id="'+id+'"'),owner+': '+id);assert.equal(html.split('id="'+id+'"').length-1,1,id+' не дублируется')}
 }
 assert.ok(!section('fish').includes('id="mmOrders"'));assert.ok(!section('panel').includes('id="enchantPanel"'));assert.ok(!section('svc').includes('id="tvtOn"'));
 assert.match(section('hunt'),/data-goto="seals"/);assert.match(section('mammon'),/data-goto="lifestone"/);
});
function fixture(){const box={textContent:''},ctx={console,$:id=>id==='lsCurrent'?box:null};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(root,'augment.js'),'utf8'),ctx);vm.runInContext(js.slice(js.indexOf('function augLine(rt)'),js.indexOf('async function weapScan()')),ctx);return{box,ctx};}
test('ЛС показывает неизвестное состояние, отсутствие оружия и отсутствие камня отдельно',()=>{
 const {box,ctx}=fixture();ctx.renderLifeStone({});assert.match(box.textContent,/ещё не получены/);
 ctx.renderLifeStone({weaponAug:{w:0}});assert.match(box.textContent,/не надето/);
 ctx.renderLifeStone({weaponAug:{w:123,o:null}});assert.match(box.textContent,/Life Stone: нет/);
});
test('ЛС использует известный эффект и панель, не меняя настройки и память',()=>{
 const {box,ctx}=fixture(),rt={weaponAug:{w:123,e:7,o:'prominence',g:'A'},weapons:[{id:123,name:'Тестовый посох',where:'надето'}],panel:[{cdKey:'ls_prominence'}]};
 const before=JSON.stringify(rt);ctx.renderLifeStone(rt);assert.match(box.textContent,/Тестовый посох \+7/);assert.match(box.textContent,/умение на панели ✓/);assert.equal(JSON.stringify(rt),before);
 rt.panel=[];ctx.renderLifeStone(rt);assert.match(box.textContent,/поставьте умение на панель/);
});
