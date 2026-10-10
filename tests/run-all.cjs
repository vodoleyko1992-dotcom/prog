'use strict';
const {spawnSync}=require('node:child_process');
for(const test of ['stage1.test.js','stage2.test.js','stage3.test.js','v6-core.test.js','v6-menu-integration.test.js','v7-modules.test.js','v71-ui.test.js','rb-forecast.test.js','stoptrace.test.js','raid-safety.test.js','ios-fishing.test.js','v716-feature.test.js','v717-raid-integration.test.js','runtime-recovery.test.js','runtime-dispatch.test.js','start-ack.test.js','patch-and-mage.test.js','v714-mage-panel.test.js','v715-mage-quest.test.js','v716-audit-behavior.test.js','v7116-fix.test.js','v7116-dmglog.test.js','v7120-debuff.test.js','v7127-tvt.test.js','v7128-autofarm.test.js','v7131-pet.test.js','v72-spoil-farm.test.js','v721-pots.test.js','v721-chain.test.js','v721-shots.test.js','v721-rb.test.js','v721-fish.test.js','v721-owncd.test.js','v721-rbsess.test.js']){
 console.log('\n== '+test+' ==');
 const r=spawnSync(process.execPath,[require('node:path').join(__dirname,test)],{stdio:'inherit'});
 if(r.status!==0){process.exitCode=1;break;}
}
