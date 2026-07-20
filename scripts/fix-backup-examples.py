#!/usr/bin/env python3
"""Restore inline examples in a backup whose examples were wrongly extracted.

An earlier DB migration moved each card's inline „…” example lines out of `back`
into an `examples` array, losing which definition each belonged to. This rebuilds
the original `back` from a pre-migration backup, and *reports every card it
cannot restore* rather than guessing — so nothing is silently mangled.

A card is only restored when the reference reproduces the migration exactly:
stripping the „…” lines from the reference `back` must yield the target `back`,
and the stripped examples must equal the target `examples`. That also protects
genuine extension page-captures (which won't match) from being inlined.

    python3 scripts/fix-backup-examples.py REFERENCE TARGET OUT
    # REFERENCE = pre-migration backup (examples still inline in `back`)
    # TARGET    = backup to fix (examples in the `examples` array)
"""
import json
import re
import sys

EXAMPLE_LINE = re.compile(r'^„(.*)”$')


def split_inline(back: str) -> tuple[str, list[str]]:
    """Apply the old migration to `back` -> (back without examples, examples)."""
    kept: list[str] = []
    examples: list[str] = []
    for line in (back or '').split('\n'):
        m = EXAMPLE_LINE.match(line.strip())
        if m:
            examples.append(m.group(1))
        else:
            kept.append(line)
    return '\n'.join(kept).strip(), examples


def main(ref_path: str, target_path: str, out_path: str) -> int:
    reference = {c['id']: c for c in json.load(open(ref_path, encoding='utf-8'))['cards']}
    bundle = json.load(open(target_path, encoding='utf-8'))

    restored = 0
    failed: list[tuple[dict, str]] = []
    for card in bundle['cards']:
        examples = card.get('examples')
        if not examples:
            continue
        ref = reference.get(card['id'])
        if ref is None:
            failed.append((card, 'card is not in the reference backup'))
            continue
        ref_back, ref_examples = split_inline(ref.get('back'))
        if ref_examples != examples:
            failed.append((card, 'examples do not match the reference (edited, or a page capture)'))
            continue
        if ref_back != (card.get('back') or '').strip():
            failed.append((card, 'back was edited after the reference backup'))
            continue
        card['back'] = ref['back']
        card.pop('examples', None)
        restored += 1

    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(bundle, f, ensure_ascii=False, indent=2)

    print(f'restored inline examples for {restored} card(s) -> {out_path}')
    print(f'could NOT restore {len(failed)} card(s):')
    for card, why in failed:
        print(f'  - {card["id"]}  {card["front"]!r}: {why}')
        for e in card.get('examples', []):
            print(f'        example: {e!r}')
    return 0


if __name__ == '__main__':
    if len(sys.argv) != 4:
        print(__doc__)
        raise SystemExit(2)
    raise SystemExit(main(*sys.argv[1:4]))
