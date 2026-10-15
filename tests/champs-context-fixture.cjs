'use strict';
// Старые сценарии проверяют цену/цвет/отход в одном неизменном составе.
// Их числовой DPS теперь явно объявляется свежим замером этого состава,
// а каждый learn представляет отдельный бой с захватом состава на входе.
function freshChamps(factory, env) {
  env.combatContext=()=>{
    const M=env.rt.champLearn||(env.rt.champLearn={}),all=M.cohorts||(M.cohorts={}),c=all.fixture||(all.fixture={dps:M.dps,dpsH:M.dpsH,st:M.st});
    const actor=JSON.stringify([env.rt.char||'',env.rt.classCur?.slot,env.rt.classCur?.prof]);
    M.holds=M.holds||{};if(M.v)M.holds[actor]=M.v;
    c.base={dps:env.rt.rbDps||env.rt.dps?.dps||0,n:env.rt.rbDps>0?20:env.rt.dps?.n||0};
    return 'fixture';
  };
  const C=factory(env),learn=C.learn;
  C.learn=(ctx,...args)=>{const fight={...ctx};delete fight.chMeasure;delete fight.chLearnDone;C.observe(fight);return learn(fight,...args)};
  return C;
}
module.exports={freshChamps};
