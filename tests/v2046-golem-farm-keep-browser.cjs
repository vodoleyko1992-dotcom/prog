'use strict';
// 20.46: настоящий Chrome MV3, фабрика набора из расширения; env и сервер локальные. Главный бот OFF, живого аккаунта нет.
const assert = require('node:assert/strict');
const { harness, until } = require('./v1014-core-lifecycle-browser.cjs');
const { hero, POLE, YAKSA, KNIGHT, CRYSTAL, server } = require('./kit-harness.cjs');
(async () => {
  const h = await harness({ withPopup: false }), ch = hero({ name: 'AuditHero', activeSummon: { key: 'mechanic_golem', hp: 10549, maxHp: 18100 } });
  ch.inventory.eq = { l1: { itemId: YAKSA, enchant: 4, enchantPAtkBonus: 16, enchantMAtkBonus: 0 }, l2: { itemId: KNIGHT } };
  ch.inventory.stacks = [{ itemId: POLE, qty: 1 }, { itemId: CRYSTAL, qty: 40 }];
  const S = server(ch), errors = [];
  try {
    await h.ctx.route('https://l2wap.com/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (path !== '/character' && !path.startsWith('/character/')) return route.fallback();
      try {
        const r = req.method() === 'GET' ? await S.get(path) : await S.post(path, req.postDataJSON());
        return route.fulfill({ status: r.status, json: await r.json() });
      } catch (e) { errors.push(e.message); return route.fulfill({ status: 500, json: { error: 'fixture' } }); }
    });
    await h.g.core(`(async()=>{
      const I=await fetch(chrome.runtime.getURL('items-il.json')).then(r=>r.json());
      const E={cfg:{crafterKit:true,petAuto:false,petResummon:false,petFullAuto:false,champRed:false},rt:{char:'AuditHero',weaponsT:1,weapons:[]},on:true,tabOwner:true,
        role:()=> 'crafter',mode:()=> 'farm',isBattle:()=>false,busy:()=>false,canAct:()=>true,gearBusy:()=>false,
        rec:()=>{},setStatus:()=>{},itemsDb:async()=>I,itemOf:id=>I[id]?{id,...I[id]}:null,GRADE_LV:{NG:0,D:20,C:40,B:52,A:61,S:76},heroLevel:()=>42,
        gameGet:p=>fetch(p),gamePost:(p,b)=>fetch(p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}),equipNote:async()=>{},petNote:()=>{},
        petHas:()=>true,weaponNow:()=>({id:${POLE},wt:'древковое',g:'C'})};
      window.__golemFarm={env:E,kit:L2V7Factories.crafterkit(E)};return true;
    })()`);
    await until(async () => {
      await h.g.core('__golemFarm.kit.step()');
      return S.h.inventory.eq.l1?.itemId === POLE && !S.h.inventory.eq.l2;
    }, 12000);
    await until(() => h.g.core('(async()=>{await __golemFarm.kit.step();const s=JSON.parse(sessionStorage.getItem("l2bot-kit"));return s.idle?.kind === "farm"})()'), 5000);
    assert.equal(S.h.activeSummon?.key, 'mechanic_golem'); assert.equal(S.h.activeSummon.hp, 10549);
    assert.deepEqual(S.posts.map(([p, b]) => [p, b.action]), [['/character/equip', 'unequip'], ['/character/equip', 'equip']]);
    assert.equal(S.h.inventory.stacks.find(x => x.itemId === CRYSTAL).qty, 40);
    const r = await h.g.core(`(()=>{
      const s=JSON.parse(sessionStorage.getItem('l2bot-kit'));s.checkT=Date.now()-11*60000;sessionStorage.setItem('l2bot-kit',JSON.stringify(s));
      const K=L2V7Factories.crafterkit(__golemFarm.env);
      return {chain:K.chainWant(),noSummon:K.noSummon(false),rows:K.shopRows([]),cfg:__golemFarm.env.cfg};
    })()`);
    assert.equal(r.chain, false); assert.equal(r.noSummon, false); assert.deepEqual(r.rows, []);
    assert.deepEqual(r.cfg, { crafterKit: true, petAuto: false, petResummon: false, petFullAuto: false, champRed: false });
    assert.deepEqual(errors, []); assert.deepEqual(h.errors, []);
    console.log('PASS actual MV3 factory: blunt+shield→pike; golem kept; 0dismiss/0summon/0shop/0buff; old chain check does not break farm; OFF settings unchanged; 0JS');
  } finally { await h.ctx.close(); }
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
