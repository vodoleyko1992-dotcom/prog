// Проверка геттеров модулей: каждое env.X в modules/<имя>.js должно иметь get X(){…} в фабрике
// L2V7Modules.<имя> = L2V7Factories.<имя>({…}) в content.js.
// 20.13 (ревизия 17.10, шаг 7, quality/L1): без аргумента берётся корень репозитория (как с «.»);
// ловит env?.X, env['X'] и const {X}=env; фабрика не найдена или пропущен геттер → код выхода 1.
'use strict';
const fs=require('fs'),path=require('path');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..','..'));

// Конец объекта фабрики: парная скобка к «({», с учётом строк, шаблонов и комментариев.
function blockEnd(src,open){
 let depth=0;
 for(let i=open;i<src.length;i++){
  const ch=src[i];
  if(ch==='"'||ch==="'"||ch==='`'){
   for(i++;i<src.length&&src[i]!==ch;i++)if(src[i]==='\\')i++;
   continue;
  }
  if(ch==='/'&&src[i+1]==='/'){i=src.indexOf('\n',i);if(i<0)return -1;continue;}
  if(ch==='/'&&src[i+1]==='*'){i=src.indexOf('*/',i+2);if(i<0)return -1;i++;continue;}
  if(ch==='{')depth++;
  else if(ch==='}'){depth--;if(depth===0)return i;}
 }
 return -1;
}

function usedNames(m){
 const used=new Set();
 for(const x of m.matchAll(/\benv\??\.([A-Za-z_$][\w$]*)/g))used.add(x[1]);
 for(const x of m.matchAll(/\benv\??\.?\[\s*(['"])([A-Za-z_$][\w$]*)\1\s*\]/g))used.add(x[2]);
 for(const x of m.matchAll(/\b(?:const|let|var)\s*\{([^{}]*)\}\s*=\s*env\b/g)){
  for(const part of x[1].split(',')){
   const key=part.trim().split(/[:=\s]/)[0];   // «...rest» — не имя геттера, пропускаем
   if(/^[A-Za-z_$][\w$]*$/.test(key))used.add(key);
  }
 }
 return used;
}

function check(dir){
 const c=fs.readFileSync(path.join(dir,'content.js'),'utf8');
 const out=[];let bad=0;
 for(const f of fs.readdirSync(path.join(dir,'modules')).filter(f=>f.endsWith('.js')).sort()){
  const n=f.replace(/\.js$/,'');
  const m=fs.readFileSync(path.join(dir,'modules',f),'utf8');
  const used=usedNames(m);
  const head=`L2V7Modules.${n} = L2V7Factories.${n}(`;
  const s=c.indexOf(head);
  if(s<0){out.push(n.padEnd(11)+' factory not found');bad++;continue;}
  const open=c.indexOf('{',s+head.length);
  const e=open<0?-1:blockEnd(c,open);
  if(e<0){out.push(n.padEnd(11)+' factory not closed');bad++;continue;}
  const block=c.slice(open,e);
  const got=new Set([...block.matchAll(/\bget ([A-Za-z_$][\w$]*)\s*\(\)/g)].map(x=>x[1]));
  const miss=[...used].filter(x=>!got.has(x));
  if(miss.length)bad++;
  out.push(n.padEnd(11)+' '+(miss.length?'MISSING: '+miss.join(', '):'ok'));
 }
 return {out,bad};
}

module.exports={check,usedNames,blockEnd};
if(require.main===module){
 const {out,bad}=check(root);
 console.log(out.join('\n'));
 if(bad){console.log('envcheck: FAIL ('+bad+')');process.exitCode=1;}
 else console.log('envcheck: PASS');
}
