#!/usr/bin/env python3
"""Re-inline a backup's leftover `examples` by consulting the dictionary.

For cards that fix-backup-examples.py could not restore from a reference backup
(they were created after it), re-run the same Wiktionary lookup the app uses.
The lookup's senses are in the same order as the definition lines in `back`, so
each stored example can be placed back under its own definition — preserving any
user edits/translations in `back`. Anything that still can't be matched is
appended at the end and reported, never dropped.

    python3 scripts/fix-backup-lookup.py IN OUT
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request

ARTICLES = ('de ', 'het ', "'t ", 'een ')
NUM = re.compile(r'^\d+\.\s*')


def headword(front: str) -> str:
    w = front.strip().lower()
    for a in ARTICLES:
        if w.startswith(a):
            w = w[len(a):]
    return w.split()[0] if w else w


def collect(senses, out):
    for s in senses or []:
        if s.get('definition'):
            out.append({'definition': s['definition'], 'example': ((s.get('examples') or [None])[0])})
        collect(s.get('subsenses'), out)


def lookup(word: str):
    url = f'https://freedictionaryapi.com/api/v1/entries/nl/{urllib.parse.quote(word)}'
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.load(r)
    senses = []
    for e in data.get('entries') or []:
        collect(e.get('senses'), senses)
    return senses


def reinline(card, senses):
    """Return (new_back, placed_examples) by inserting each example after the
    matching definition line, walking senses in order."""
    want = set(card.get('examples') or [])
    out, placed, si = [], [], 0
    for line in (card.get('back') or '').split('\n'):
        out.append(line)
        definition = NUM.sub('', line.strip())
        for j in range(si, len(senses)):
            if senses[j]['definition'] == definition:
                ex = senses[j]['example']
                if ex in want:
                    out.append(f'„{ex}”')
                    placed.append(ex)
                si = j + 1
                break
    return '\n'.join(out), placed


def main(in_path: str, out_path: str) -> int:
    bundle = json.load(open(in_path, encoding='utf-8'))
    fixed = 0
    unresolved: list[tuple[dict, list[str]]] = []
    for card in bundle['cards']:
        examples = card.get('examples')
        if not examples:
            continue
        try:
            senses = lookup(headword(card['front']))
        except Exception as e:  # noqa: BLE001 — report and keep going
            unresolved.append((card, [f'(lookup failed: {e})', *examples]))
            continue
        time.sleep(0.4)  # be gentle with the API
        new_back, placed = reinline(card, senses)
        leftover = [e for e in examples if e not in placed]
        if leftover:
            # keep content: append the ones we couldn't place, and report them
            new_back = new_back + '\n' + '\n'.join(f'„{e}”' for e in leftover)
            unresolved.append((card, leftover))
        card['back'] = new_back.strip()
        card.pop('examples', None)
        fixed += 1

    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(bundle, f, ensure_ascii=False, indent=2)

    print(f're-inlined {fixed} card(s) via lookup -> {out_path}')
    if unresolved:
        print(f'{len(unresolved)} card(s) had examples appended at the end (position unknown):')
        for card, exs in unresolved:
            print(f'  - {card["id"]}  {card["front"]!r}')
            for e in exs:
                print(f'        {e!r}')
    return 0


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(__doc__)
        raise SystemExit(2)
    raise SystemExit(main(*sys.argv[1:3]))
