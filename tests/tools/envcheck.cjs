const fs=require('fs'),path=require('path');const root=process.argv[2];
const c=fs.readFileSync(path.join(root,'content.js'),'utf8');
for(const f of fs.readdirSync(path.join(root,'modules'))){const n=f.replace('.js','');
 const m=fs.readFileSync(path.join(root,'modules',f),'utf8');
 const used=new Set([...m.matchAll(/env\.([A-Za-z_$][\w$]*)/g)].map(x=>x[1]));
 const s=c.indexOf(`L2V7Modules.${n} = L2V7Factories.${n}(`);const e=c.indexOf('});',s);
 const block=c.slice(s,e);const got=new Set([...block.matchAll(/get ([A-Za-z_$][\w$]*)\s*\(\)/g)].map(x=>x[1]));
 const miss=[...used].filter(x=>!got.has(x));console.log(n.padEnd(11),miss.length?'MISSING: '+miss.join(', '):'ok');}
