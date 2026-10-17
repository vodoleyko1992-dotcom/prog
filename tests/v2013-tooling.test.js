'use strict';
// 20.13 (ревизия 17.10, шаг 7, quality/M3 + L1 + L5 + M4): инструменты проверки и чистка без смены поведения.
// run-all.cjs сам находит все tests/*.test.js|cjs, не останавливается на первом падении и печатает итог;
// envcheck.cjs работает без аргумента, ловит env?.X / env['X'] / const {X}=env и падает кодом 1 при пропуске.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');

test('run-all: каждый *.test.js/cjs на диске запускается ровно один раз, прежний порядок сохранён',()=>{
 const {listTests,ORDER,EXCLUDE}=require('./run-all.cjs');
 const {tests,missing}=listTests();
 const disk=fs.readdirSync(__dirname).filter(f=>/\.test\.c?js$/.test(f));
 assert.deepEqual(missing,[],'в ORDER нет несуществующих файлов');
 assert.equal(new Set(tests).size,tests.length,'без повторов');
 for(const f of disk)assert.ok(tests.includes(f)||EXCLUDE.has(f),f+' запускается или явно исключён');
 for(const f of ['v1005-epic-time.test.js','v1008-cancel-switch.test.js','v2013-tooling.test.js'])assert.ok(tests.includes(f),f);
 const known=tests.filter(f=>ORDER.includes(f));
 assert.deepEqual(known,ORDER.filter(f=>tests.includes(f)),'файлы из ORDER идут в прежнем порядке');
 assert.deepEqual(tests.slice(0,known.length),known,'новые файлы — после ORDER');
 const extra=tests.slice(known.length);
 assert.deepEqual(extra,[...extra].sort(),'новые файлы — по имени');
});

test('run-all: падение не останавливает прогон, итог «N PASS / M FAIL», код выхода 1',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'runall-'));
 try{
  fs.copyFileSync(path.join(__dirname,'run-all.cjs'),path.join(dir,'run-all.cjs'));
  fs.writeFileSync(path.join(dir,'a-fail.test.js'),'process.exit(3)');
  fs.writeFileSync(path.join(dir,'b-ok.test.js'),'console.log("ok b")');
  fs.writeFileSync(path.join(dir,'c-ok.test.cjs'),'console.log("ok c")');
  // ORDER копии ссылается на файлы, которых в dir нет, — они попадут в MISSING; проверяем только новые файлы
  const r=spawnSync(process.execPath,[path.join(dir,'run-all.cjs')],{encoding:'utf8'});
  assert.equal(r.status,1);
  assert.match(r.stdout,/== a-fail\.test\.js ==[\s\S]*== b-ok\.test\.js ==[\s\S]*ok b[\s\S]*== c-ok\.test\.cjs ==[\s\S]*ok c/);
  assert.match(r.stdout,/ИТОГ: 2 PASS \/ \d+ FAIL/);
  assert.match(r.stdout,/a-fail\.test\.js \(код 3\)/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('envcheck: без аргумента = корень репозитория, зелёный, код 0',()=>{
 const r=spawnSync(process.execPath,[path.join(root,'tests/tools/envcheck.cjs')],{encoding:'utf8',cwd:os.tmpdir()});
 assert.equal(r.status,0,r.stdout+r.stderr);
 assert.match(r.stdout,/envcheck: PASS/);
 assert.doesNotMatch(r.stdout,/MISSING|not found/);
});

test('envcheck: ловит env?.X, env[\'X\'], деструктуризацию; пропуск и отсутствие фабрики → код 1',()=>{
 const {usedNames}=require('./tools/envcheck.cjs');
 const u=usedNames("const {alpha, beta: b, gamma = 1, ...rest} = env; env?.delta(); env['eps']; env.zeta;");
 for(const k of ['alpha','beta','gamma','delta','eps','zeta'])assert.ok(u.has(k),k);
 assert.ok(!u.has('rest')&&!u.has('...rest'),'остаток ...rest — не геттер');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'envcheck-'));
 try{
  fs.mkdirSync(path.join(dir,'modules'));
  fs.writeFileSync(path.join(dir,'modules','good.js'),'f=function(env){return env.a+env?.b}');
  fs.writeFileSync(path.join(dir,'modules','lost.js'),'f=function(env){return env.a}');
  fs.writeFileSync(path.join(dir,'modules','gap.js'),'f=function(env){const {c}=env;return c}');
  fs.writeFileSync(path.join(dir,'content.js'),
   "L2V7Modules.good = L2V7Factories.good({ get a(){return '});'}, get b(){return 2} });\n"+
   "L2V7Modules.gap = L2V7Factories.gap({ get a(){return 1} });\n");
  const r=spawnSync(process.execPath,[path.join(root,'tests/tools/envcheck.cjs'),dir],{encoding:'utf8'});
  assert.equal(r.status,1);
  assert.match(r.stdout,/good\s+ok/);
  assert.match(r.stdout,/gap\s+MISSING: c/);
  assert.match(r.stdout,/lost\s+factory not found/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('мёртвый код убран (L5), охрана главного цикла в одном месте (M4)',()=>{
 const content=read('content.js'),popup=read('popup.js');
 assert.doesNotMatch(content,/const clickText\b/);
 assert.doesNotMatch(content,/const clockAt\b/);
 assert.doesNotMatch(popup,/function expHour\b/);
 assert.match(content,/const mainParked = \(\) => !on \|\| !tabOwner \|\| autonomyMode\(\) === 'enchant';/);
 assert.doesNotMatch(content,/if \(!on \|\| !tabOwner \|\| autonomyMode\(\) === 'enchant'\) continue;/);
 const main=content.slice(content.indexOf('async function main() {'));
 assert.ok((main.match(/if \(mainParked\(\)\) continue;/g)||[]).length>=21,'все прежние проверки на месте');
});
