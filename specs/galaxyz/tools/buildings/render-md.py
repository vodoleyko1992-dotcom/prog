# python3 -I render-md.py -> renders buildings.md.src into ../../buildings.md, inlining recipes/R*.js and _table.md
import os, re
H = os.path.dirname(os.path.abspath(__file__))
s = open(os.path.join(H, 'buildings.md.src'), encoding='utf-8').read()
rec = {m.split('-')[0]: open(os.path.join(H, 'recipes', m), encoding='utf-8').read().rstrip() for m in os.listdir(os.path.join(H, 'recipes'))}
s = re.sub(r'\{\{(R\d+)\}\}', lambda m: rec[m.group(1)], s)
s = s.replace('{{TABLE}}', open(os.path.join(H, '_table.md'), encoding='utf-8').read().rstrip())
assert '{{' not in s
open(os.path.join(H, '../../buildings.md'), 'w', encoding='utf-8').write(s)
print(len(s), 'chars')
