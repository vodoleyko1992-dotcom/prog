#!/usr/bin/env python3
"""Извлечь только обезличенные параметры модели из указанного пользовательского журнала."""
import argparse, collections, hashlib, json, re, statistics
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('log');p.add_argument('--output',required=True);a=p.parse_args()
root=Path(__file__).resolve().parents[2];source=Path(a.log);lines=source.read_text().splitlines()
alias={'Вихор':'whirlwind','Грозова буря':'thunder_storm','Дикий розмах':'wild_sweep','Атака':'attack','Звіриний рев':'howl','Провокація масова':'provoke'}
fit={x:{'train':[],'validation':[],'mpObservedNet':[],'cooldownObserved':[],'lineNumbers':[]} for x in alias.values()};cut=7000
for i,l in enumerate(lines,1):
 m=re.search(r'\[B\] скилл «([^»]+)»: (.*)',l)
 if not m or m[1] not in alias:continue
 action=alias[m[1]];row=fit[action]
 mp=re.search(r'MP [−-](\d+)',m[2]);cd=re.search(r'КД ([\d.]+) с',m[2])
 if mp:row['mpObservedNet'].append(int(mp[1]))
 if cd:row['cooldownObserved'].append(float(cd[1]))
 damage=None
 if action in ['whirlwind','thunder_storm','wild_sweep']:
  for part in l.split(' ⏎ '):
   if m[1]+': power' in part:
    hit=re.search(r'(\d+)\.?$',part)
    if hit:damage=int(hit[1]);break
 elif action=='attack':
  hit=re.search(r'урон (\d+)',m[2])
  # Удаляем явные добивания слабых целей; даже оставшаяся выборка может быть обрезана HP.
  if hit and 1000<=int(hit[1])<=30000:damage=int(hit[1])
  if hit and int(hit[1])==0 and re.search(r'(?:Ты|Ти|Вы) промахнул|Ти промахнув',l):damage=0
 if damage is not None:row['train' if i<cut else 'validation'].append(damage);row['lineNumbers'].append(i)
for k in ['attack','whirlwind','thunder_storm','wild_sweep']:
 assert len(fit[k]['train'])>=10 and len(fit[k]['validation'])>=10,(k,len(fit[k]['train']),len(fit[k]['validation']))
mobs=json.loads((root/'kb/data/game-mobs.json').read_text())['mobs']
def targets(lo,hi):
 out=[]
 for m in mobs:
  if m.get('champion') or not lo<=m['level']<=hi:continue
  # Сравниваются единицы дополнительного спойла, без выдуманного рыночного курса ресурсов.
  resources=lambda field:sum(float(x['chance'])*(float(x.get('min',1))+float(x.get('max',1)))/2 for x in m.get(field,[]) if x.get('kind')=='resource')
  out.append({'name':m['name'],'level':m['level'],'hp':m['stats']['maxHp'],'dropUnits':resources('drops'),'spoilUnits':resources('spoil')})
 return out
spoiler=json.loads((root/'docs/evidence/SUBCLASS-LIVE-2026-10-16.json').read_text())['snapshots']['baselineSpoiler'];catalog=json.loads((root/'kb/data/game-skills-spoiler-20261016.json').read_text())
files=['kb/data/game-mobs.json','kb/data/game-skills-spoiler-20261016.json','docs/evidence/SUBCLASS-LIVE-2026-10-16.json','kb/data/warlord-skills-20261016.json','modules/combat.js','modules/loot.js']
D={'schema':1,'createdDate':'2026-10-17','sourceLog':{'name':source.name,'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'chronologicalSplitBeforePhysicalLine':cut},'sources':[{'path':f,'sha256':hashlib.sha256((root/f).read_bytes()).hexdigest()} for f in files],
 'scope':'offline empirical comparative model, not the game server; no live requests','warlord':{'level':48,'maxMp':874,'actionSeconds':1.6,'damage':fit,'targets':targets(45,55)},
 'spoiler':{'level':40,'maxMp':629,'actionSeconds':1.5,'pAtkSnapshot':spoiler['pAtk'],'learnedSkillIds':[x['l2SkillId'] for x in spoiler['learnedBattleSkillsDetail']],'catalogActiveSkills':[{k:s.get(k) for k in ['battleId','l2SkillId','learned','mpCost','damagePower','hintRu']} for s in catalog['skills'] if s.get('kind')=='battle'],'targets':targets(35,45)},
 'assumptions':{'spoilerAttackDamage':'Transferred Warlord attack sample including explicit misses; small positive HP-censored finishers removed. Sample, varied ×0.8/1.0/1.3; not a measured spoiler damage distribution.','spoilerSweep':'Single target, ratio to attack median varied ×1/1.8/3, 17s hinted cooldown; not fitted to spoiler combat.','mp':'Base action costs use upper observed net MP; regen 0/4/8 MP per second, potion +500MP with 0/0.6/1.6sec overhead are sensitivity assumptions.','groups':'Provoke up to31 and Howl up to21 in these scenarios, based on observed examples; not universal server caps. Victory settlement of remaining neighbors after a finishing Whirlwind/Thunder Storm is compared with strict direct-kill-only mode; no such settlement is assumed after single-target Wild Sweep/basic attack.','excluded':'No PvP, bosses, captcha/server outages, death/HP optimization, loot prices, travel, respawn depletion, or buff/toggle alternatives. Buffs and existing equipment are held fixed.','spoil':'Solo success 0.45/0.55/0.75 are assumptions informed by old 50–60% observations, not a fitted current success rate. Festival100% only for eligible targets per native catalog. Unlearned Festival appears solely as an explicitly labelled upgrade scenario.'}}
Path(a.output).write_text(json.dumps(D,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:{s:len(fit[k][s]) for s in ['train','validation']} for k in fit},ensure_ascii=False))
