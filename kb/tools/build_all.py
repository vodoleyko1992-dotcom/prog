# -*- coding: utf-8 -*-
"""Пересобрать всю базу знаний kb/data/*.json из файлов репозитория.

    python3 -I kb/tools/build_all.py           # все файлы
    python3 -I kb/tools/build_all.py zones.json raidbosses.json

После сборки: проверка, что в kb/ нет ничего похожего на пароль/токен/значение ключа auth,
и сводка числа записей по файлам.
"""
import os, sys, re, json
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kblib as K
import build_game_data
import build_code_refs


def scan_secrets():
    bad = []
    rx = re.compile(r'"(auth|password|passwd|token|jwt|cookie)"\s*:\s*"(?!\*\*\*|\(скрыто\))[^"]{4,}"', re.I)
    for root, _, files in os.walk(K.KB):
        for f in files:
            if f.endswith(('.json', '.md')):
                p = os.path.join(root, f)
                with open(p, encoding='utf-8') as fh:
                    if rx.search(fh.read()):
                        bad.append(os.path.relpath(p, K.REPO))
    return bad


def main(argv):
    names = argv or None
    counts = {}
    counts.update(build_game_data.main(names))
    counts.update(build_code_refs.main(names))
    bad = scan_secrets()
    if bad:
        print('ВНИМАНИЕ: похоже на секрет в', bad)
        sys.exit(1)
    print('секретов нет; файлов:', len(counts))


if __name__ == '__main__':
    main(sys.argv[1:])
