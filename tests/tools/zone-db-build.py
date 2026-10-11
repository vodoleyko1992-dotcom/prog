#!/usr/bin/env python3
# 9.0 (автокач по КПД): встроенная база зон для выбора локации без пробных боёв.
# Читает kb/data/game-zones.json (90 точек телепорта: цена, полоса уровней, мобы точки) и kb/data/game-mobs.json
# (400 записей: уровень, EXP; HP/защита у мобов L2WAP зависят только от уровня) → zone-db.js (входит в zip).
# Запуск: python3 -I tests/tools/zone-db-build.py [корень-репо]
import json, os, sys
from statistics import median

root = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', '..')
kb = os.path.join(root, 'kb', 'data')
zones = json.load(open(os.path.join(kb, 'game-zones.json'), encoding='utf-8'))
gm = json.load(open(os.path.join(kb, 'game-mobs.json'), encoding='utf-8'))

mobs = {}            # имя → [уровень, EXP] (EXP 0 — цифр нет, бот оценит по уровню)
hp, md, pd = {}, {}, {}
for m in gm['mobs']:
    if m.get('champion'): continue
    lv, ex = m['level'], m.get('exp') or 0
    mobs[m['name']] = [lv, ex]
    st = m.get('stats') or {}
    if st.get('maxHp'): hp.setdefault(lv, []).append(st['maxHp'])
    if st.get('mDef'): md.setdefault(lv, []).append(st['mDef'])
    if st.get('pDef'): pd.setdefault(lv, []).append(st['pDef'])
for m in gm.get('mobsFarmGuideOnly', []):
    mobs.setdefault(m['name'], [m['level'], 0])

def fit(d):          # y = a + b·уровень по медианам уровней (у L2WAP прямая: HP 180 + 48·ур.)
    xs = sorted(d); ys = [median(d[x]) for x in xs]
    n = len(xs); mx = sum(xs) / n; my = sum(ys) / n
    b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
    return [round(my - b * mx, 1), round(b, 3)]

Z = {}
for z in zones:
    names = []
    for m in z['mobs']:
        if m.get('champion'): continue
        n = m['name']
        if n not in mobs or (not mobs[n][1] and m.get('exp')): mobs[n] = [m['level'], m.get('exp') or 0]
        if n not in names: names.append(n)
    Z[z['teleportId']] = {'n': z['labelEn'], 'p': z.get('adenaCost') or 0, 'lo': z.get('mobLevelMin') or 0, 'hi': z.get('mobLevelMax') or 0, 'm': names}

db = {'v': '2026-10-11', 'src': 'kb/data game-zones + game-mobs (живая игра 11.10)', 'hp': fit(hp), 'mdef': fit(md), 'pdef': fit(pd),
      'mobs': dict(sorted(mobs.items())), 'zones': Z}
out = os.path.join(root, 'zone-db.js')
with open(out, 'w', encoding='utf-8') as f:
    f.write('/* 9.0: база зон L2WAP для автокача по КПД. Сгенерировано tests/tools/zone-db-build.py из kb/data — не править руками.\n'
            '   mobs: имя → [уровень, EXP за моба (0 — нет цифр)]; zones: teleportId → {n имя, p цена телепорта, lo/hi уровни мобов, m мобы точки};\n'
            '   hp/mdef/pdef: [a, b] — у мобов L2WAP HP и защита зависят только от уровня (a + b·ур.) */\n')
    f.write('globalThis.L2ZONE_DB = ' + json.dumps(db, ensure_ascii=False, separators=(',', ':')) + ';\n')
print(out, len(mobs), 'mobs', len(Z), 'zones', os.path.getsize(out), 'bytes', db['hp'], db['mdef'], db['pdef'])
