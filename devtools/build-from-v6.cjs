'use strict';
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const fs=require('node:fs'),path=require('node:path');
const root=process.argv[2];
if (!root) throw new Error('Pass a COPY of the v6.0.0 extension directory. Never run on the v7.0.0 output.');
const file=path.join(root,'content.js'), src=fs.readFileSync(file,'utf8');
if (src.includes('const L2V7Modules =')) throw new Error('Already migrated to v7; refusing to double-extract functions.');
const prog=ts.createProgram([file],{allowJs:true,checkJs:false,noEmit:true,target:ts.ScriptTarget.ES2022});
const sf=prog.getSourceFile(file),checker=prog.getTypeChecker();
if(sf.parseDiagnostics.length)throw Error('Parse errors: '+sf.parseDiagnostics.length);
const groups={
 fishing: /^(?:fish\w*|fSlot|fOk|rodText|isFishing|goFishing)$/,
 epics: /^(?:epic\w*|isEpicPage)$/,
 raid: /^(?:rb\w*|raidList|farmRbOn|isRbPage|huntOn|huntSet|huntDone|now_|closeMobModal)$/,
 combat: /^(?:battle|chooseAction|dpsPlan|ultPick|drainPick|frenzyDive|hotbarRows3|mobHp|extraMobs|noticeText|mobTitle|mobName|victory|defeat|loadErr|potModel|slotsBy|cdBusy|cdLeft|rememberCd|ready|uiReady)$/,
 dungeons: /^(?:cat\w*|dungeon\w*|isDungeon|isCatPage)$/,
 tvt: /^(?:tvt\w*|isArena)$/,
 mobfarm: /^(?:map|mapReady|pageItems|pagerInfo|pageKey|aroundSig|markerTypes|netSpawns|parseRules|champRuleOn|chainBetter|ruleMatch|candidates|rank|chainCarries|attackSpawn|nextFight)$/,
 quests: /^(?:campaign|campaignState|campOn|campChampOpen|camp\w*|quest\w*|quests\w*|goCampaign|mailStep|applyQuestLog|trackQuest|isQuestName|isCampaignPage|isQuests)$/,
 navigation: /^(?:zone\w*|tpCitiesReady|isTeleport|toMap|toOutskirts|goOutskirts|isMap|isCity)$/ ,
 buffs: /^(?:buff\w*|activeBuffs|ownBuffLeft|hudBuffs|totem\w*|townBuff\w*|faWanted|faCatalogNote)$/ ,
 equipment: /^(?:equip|equipBy|canSwap|weaponMainSuggest|autoRoles|suggestRoles|equippedWeapon|scanInventoryWeapons|wearFromBag|invScan\w*|readWeaponsPage|rankWeapons|weaponOf|classWeaponTypes)$/ ,
 economy: /^(?:shop\w*|bagCounts|hpPotStock)$/ ,
 resources: /^(?:hpPots|hpPot\w*|mpPotSlot|potInventory|potWatch|longFightMp|keepShots|rest|meHp|meMp|bar)$/ ,
 loot: /^(?:spoil\w*|sweepStep|massSpoil\w*|festivalParse|trackLoot|resQuests|resHave)$/ ,
 survival: /^(?:onDeath|reviveStep|restoreVitals|lowHpEscape)$/
};
const declarations=[];
for(const s of sf.statements){
 if(ts.isFunctionDeclaration(s)&&s.name)declarations.push({node:s,name:s.name.text,kind:'fn'});
 if(ts.isVariableStatement(s)&&s.declarationList.declarations.length===1){const d=s.declarationList.declarations[0];if(ts.isIdentifier(d.name)&&d.initializer&&(ts.isArrowFunction(d.initializer)||ts.isFunctionExpression(d.initializer))) declarations.push({node:s,name:d.name.text,kind:'const'});}
}
const selected=[];
for(const d of declarations){let match=null;for(const [grp,re] of Object.entries(groups))if(re.test(d.name)){match=grp;break;}if(match)selected.push({...d,grp:match});}
const movedNames=new Map(selected.map(x=>[x.name,x.grp]));
const topLevel=new Set(declarations.map(x=>x.name));
for(const s of sf.statements)if(ts.isVariableStatement(s))for(const d of s.declarationList.declarations)if(ts.isIdentifier(d.name))topLevel.add(d.name.text);
const allMods={};for(const g of Object.keys(groups))allMods[g]={defs:[],ext:new Set()};
const ranges=[];
for(const d of selected){
 const ext=new Set(), edits=[];
 const visit=node=>{
   if(ts.isIdentifier(node)){
     const symbol=checker.getSymbolAtLocation(node);
     if(symbol?.declarations?.some(dec=>dec.getSourceFile()===sf && (ts.isVariableDeclaration(dec)||ts.isFunctionDeclaration(dec)) && dec.parent &&
       (ts.isFunctionDeclaration(dec)? dec.parent===sf : ts.isVariableStatement(dec.parent?.parent)&&dec.parent.parent.parent===sf))){
       const nm=node.text;
       if(!movedNames.has(nm)||movedNames.get(nm)!==d.grp){
         // The identifier's declaration site is never a free-variable occurrence.
         if(!(node.parent===d.node && ts.isFunctionDeclaration(d.node)) && !(
           ts.isVariableDeclaration(node.parent)&&node.parent.name===node)){
           const p=node.parent;
           if(ts.isShorthandPropertyAssignment(p) && p.name===node) edits.push([node.getStart(sf),node.getEnd(),`${nm}: env.${nm}`]);
           else edits.push([node.getStart(sf),node.getEnd(),`env.${nm}`]);
           ext.add(nm);
         }
       }
     }
   }
   ts.forEachChild(node,visit);
 };visit(d.node);
 const start=d.node.getStart(sf), end=d.node.getEnd();
 let code=src.slice(start,end);
 for(const [a,b,val] of edits.sort((x,y)=>y[0]-x[0]))code=code.slice(0,a-start)+val+code.slice(b-start);
 allMods[d.grp].defs.push({name:d.name,code,kind:d.kind}); for(const x of ext)allMods[d.grp].ext.add(x);
 const facade=d.kind==='fn'?`${d.node.modifiers?.some(x=>x.kind===ts.SyntaxKind.AsyncKeyword)?'async ':''}function ${d.name}(...args) { return L2V7Modules.${d.grp}.${d.name}(...args); }`:
   `${src.slice(start,start+5).startsWith('const')?'const':'var'} ${d.name} = (...args) => L2V7Modules.${d.grp}.${d.name}(...args);`;
 ranges.push([start,end,facade]);
}
let output=src;
for(const [start,end,replacement] of ranges.sort((a,b)=>b[0]-a[0]))output=output.slice(0,start)+replacement+output.slice(end);
output=output.replace('const TAG =', 'const L2V7Modules = Object.create(null);\nconst TAG =');
let init='\n// ===== v7 dependency injection: lazy bindings preserve per-character dynamic state =====\n';
for(const [grp,mod] of Object.entries(allMods)){
 if(!mod.defs.length)continue;
 const ext=[...mod.ext].sort();
 init+=`L2V7Modules.${grp} = L2V7Factories.${grp}({ ${ext.map(n=>`get ${n}() { return ${n}; }, set ${n}(value) { ${n} = value; }`).join(',\n  ')} });\n`;
}
const insert='chrome.runtime.onMessage.addListener((m, _s, reply) => {';
if(!output.includes(insert))throw Error('missing initialization target');
output=output.replace(insert,init+'\n'+insert);
fs.writeFileSync(file,output.replace(/v6\.0\.0 — content script/,'v7.0.0 — content script'));
const moduleDir=path.join(root,'modules');fs.mkdirSync(moduleDir,{recursive:true});
for(const [grp,mod] of Object.entries(allMods)){
 if(!mod.defs.length)continue;
 const content=`/* L2wap v7: isolated ${grp} feature module. Dependencies are injected lazily.\n   All game actions remain under the central lease and dispatcher in content.js. */\n(function (root) {\n 'use strict';\n root.L2V7Factories = root.L2V7Factories || Object.create(null);\n root.L2V7Factories.${grp} = function create_${grp}(env) {\n${mod.defs.map(d=>d.code).join('\n\n')}\n return { ${mod.defs.map(d=>d.name).join(', ')} };\n };\n})(globalThis);\n`;
 fs.writeFileSync(path.join(moduleDir,grp+'.js'),content);
 console.log(`${grp}: ${mod.defs.length} extracted, ${mod.ext.size} shared deps, ${Buffer.byteLength(content)} bytes`);
}
const manifestFile=path.join(root,'manifest.json'), manifest=JSON.parse(fs.readFileSync(manifestFile));
manifest.version='7.0.0'; manifest.description='L2wap Bot v7.0.0 — модульные игровые режимы и боевой движок';
const list=manifest.content_scripts.find(c=>c.js.includes('content.js')).js;
const ix=list.indexOf('content.js');list.splice(ix,0,...Object.keys(allMods).filter(k=>allMods[k].defs.length).map(n=>'modules/'+n+'.js'));
fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(path.join(root,'MODULE_MAP.json'),JSON.stringify(Object.fromEntries(Object.entries(allMods).map(([k,v])=>[k,{exports:v.defs.map(d=>d.name),dependencies:[...v.ext].sort()}])),null,2)+'\n');
console.log('Total moved',selected.length,'original bytes',src.length,'new content bytes',output.length);
