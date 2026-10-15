'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./v1016-enchant-independent-fixture.cjs');
test('enchant: fresh inventory for another server actor cannot start a series',async()=>{const f=fixture();f.env.rt.char='Hero';f.snap.name='Other';assert.equal(await f.M.readItems(),null);assert.notEqual(f.env.rt.enchantScan?.ok,true);});
test('enchant: another actor cannot settle an unknown scroll attempt',async()=>{const f=fixture();f.env.rt.char='Hero';f.snap.name='Hero';await f.start();f.mode='timeout';await f.tick();assert.equal(f.posts.length,1);f.snap.name='Other';f.snap.revision++;f.snap.inventory.eq.l1.enchant=4;f.snap.inventory.eq.l1.enchantMAtkBonus=24;f.snap.inventory.stacks.find(x=>x.itemId===910527).qty--;await f.M.reconcile();assert.ok(f.env.rt.enchant.pending);assert.equal(f.env.rt.enchant.totals.successes,0);});

test('enchant: missing actor identity cannot authorize real profile scan',async()=>{const f=fixture();f.env.rt.char='Hero';assert.equal(await f.M.readItems(),null)});
