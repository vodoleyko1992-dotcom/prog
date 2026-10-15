'use strict';
// Настоящее MV3/main; контракт каталога: достигнутые максимумы исчезают.
const fs=require('node:fs'),Module=require('node:module');
const file=__dirname+'/v1015-magister-mv3-browser.cjs';
let source=fs.readFileSync(file,'utf8');
source=source.slice(0,source.indexOf('(async()=>{for(const opt'));
source=source.replace('const catalog=()=>({','const rawCatalog=()=>({').replace(' const body=path=>',' const catalog=()=>{const d=rawCatalog();d.skills=d.skills.filter(s=>!s.learnedMax);return d;};\n const body=path=>');
const fixture=new Module(file,module);fixture.filename=file;fixture.paths=module.paths;
fixture._compile(source+'\nmodule.exports=scenario;',file);
(async()=>{for(const opt of [{battle:true},{stop:true},{reload:true}])await fixture.exports(opt)})().catch(e=>{console.error(e.stack);process.exitCode=1});
