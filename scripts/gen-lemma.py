#!/usr/bin/env python3
"""Generate shared/lemma-data.ts from a kaikki.org Wiktionary extract.

Download the data (~246 MB), then run:
    curl -s -o /tmp/wikt-nl.jsonl https://kaikki.org/dictionary/Dutch/kaikki.org-dictionary-Dutch.jsonl
    python3 scripts/gen-lemma.py /tmp/wikt-nl.jsonl

Produces a form -> lemma map (every inflected content-word form) and a noun ->
article map (de/het from grammatical gender).
"""
import collections
import json
import os
import re
import sys

POS = {'noun', 'verb', 'adj', 'adv', 'num'}
# Form entries tagged like this are conjugation-table metadata or non-standard
# spellings, not the standard inflection we want.
JUNK_TAGS = {'table-tags', 'inflection-template', 'class', 'auxiliary',
             'obsolete', 'archaic', 'dated', 'rare', 'dialectal', 'nonstandard'}
WORD_RE = re.compile(r"^[a-zà-ÿ][a-zà-ÿ'’-]*[a-zà-ÿ]$")


def is_participle(w):
    """A present (-end) or past (ge…t/d/en) participle — a deverbal adjective that
    should still reduce to its verb (opvallend -> opvallen, gemaakt -> maken)."""
    return w.endswith('end') or (w.startswith('ge') and (w[-1] in 'td' or w.endswith('en')))


def skip_entirely(entry):
    """Dead or variant-spelling entries we drop completely (headword *and* forms):
    obsolete/archaic, or pure alt-of pointers like "loopen" = obsolete spelling of
    lopen. Form-of entries are kept — a participle like "aanhoudend" (form of
    aanhouden) carries the inflected forms (aanhoudende, …) we want to harvest."""
    senses = entry.get('senses') or []
    if not senses:
        return False
    for s in senses:
        t = set(s.get('tags') or [])
        if not (t & {'obsolete', 'archaic'}) and 'alt-of' not in t:
            return False  # has a live, non-alt sense — keep it
    return True


def gender_article(entry):
    for ht in entry.get('head_templates') or []:
        if ht.get('name', '').startswith('nl-noun'):
            g = (ht.get('args') or {}).get('1', '')
            if g == 'n':
                return 'het'
            if g and g[0] in 'mfc':
                return 'de'
    return None


def main(path):
    pairs = collections.defaultdict(collections.Counter)   # form -> {lemma: n}
    genders = collections.defaultdict(collections.Counter)  # noun lemma -> {de/het: n}
    verb_inf = set()     # true infinitives: offer verb-vs-noun choice, default verb
    protect = set()  # noun/adjective/adverb headwords: don't reduce (brief, vrij)
    adjectives = set()  # base adjectives/adverbs (to flag noun∩adjective homographs)

    with open(path, encoding='utf-8') as f:
        for line in f:
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            if e.get('lang_code') != 'nl' or e.get('pos') not in POS:
                continue
            lemma = (e.get('word') or '').lower()
            if not WORD_RE.match(lemma) or skip_entirely(e):
                continue

            heads = {h.get('name') for h in (e.get('head_templates') or [])}
            # Only true infinitives (head `nl-verb`), not Wiktionary's form-of verb
            # entries (loopt, werkten) or participles.
            if e['pos'] == 'verb' and 'nl-verb' in heads:
                verb_inf.add(lemma)
            elif e['pos'] == 'noun':
                if 'nl-noun' in heads:
                    protect.add(lemma)
                art = gender_article(e)
                if art:
                    genders[lemma][art] += 1
            # Base adjectives/adverbs are headwords; don't reduce them to a
            # coincidental verb (vrij -> vrijen). Participles are excluded so they
            # still reduce (opvallend -> opvallen, gemaakt -> maken).
            elif e['pos'] in ('adj', 'adv') and (heads & {'nl-adj', 'nl-adv'}) and not is_participle(lemma):
                protect.add(lemma)
                adjectives.add(lemma)

            for fo in e.get('forms') or []:
                tags = set(fo.get('tags') or [])
                if tags & JUNK_TAGS:
                    continue
                form = (fo.get('form') or '').lower()
                if form == lemma or not WORD_RE.match(form):
                    continue
                pairs[form][lemma] += 1

    # A true infinitive (lopen, huizen, …) is ambiguous: verb OR noun plural.
    # Default to the verb, offer the noun reading(s) as alternatives. Noun
    # headwords (brief) are protected from reduction (so brieven -> brief stops,
    # not -> briefen). Everything else reduces; offer a choice on real ambiguity.
    data = {}   # form -> primary lemma (used by lemmatize)
    alts = {}   # form -> [candidate lemmas] when there's a genuine choice
    for form, ctr in sorted(pairs.items()):
        reductions = [lemma for lemma, _ in ctr.most_common()]
        if form in verb_inf:
            cands = [form] + [r for r in reductions if r != form]
        elif form in protect:
            # Protected headword stays the default (no LEMMA_MAP entry, so lemmatize
            # leaves it), but still offer any reduction as a pickable alternative —
            # e.g. "wens" -> [de wens, wensen], "gemaakte" -> [gemaakte, gemaakt].
            cands = [form] + [r for r in reductions if r != form]
        else:
            data[form] = reductions[0]
            cands = reductions
        seen = set()
        cands = [c for c in cands if not (c in seen or seen.add(c))]
        if len(cands) > 1:
            alts[form] = cands

    # Exclude verb infinitives (gerund nouns like "het lopen") so their candidate
    # shows as the bare verb, not "het lopen".
    articles = {
        lemma: ctr.most_common(1)[0][0]
        for lemma, ctr in sorted(genders.items())
        if lemma not in verb_inf
    }

    # Nouns that are also a base adjective ("scheef" = de scheef / scheef): the UI
    # offers both the article-noun and the bare-adjective reading.
    noun_adj = sorted(w for w in articles if w in adjectives)

    out = os.path.join(os.path.dirname(__file__), '..', 'shared', 'lemma-data.ts')
    with open(out, 'w', encoding='utf-8') as f:
        f.write(f'// AUTO-GENERATED. Dutch form -> lemma map ({len(data)} forms), ambiguous\n')
        f.write(f'// form -> [candidate lemmas] map ({len(alts)} forms), and noun -> article map\n')
        f.write(f'// ({len(articles)} nouns), built from English Wiktionary via kaikki.org\n')
        f.write('// (CC BY-SA 3.0/4.0). Regenerate via scripts/gen-lemma.py.\n')
        f.write('export const LEMMA_MAP: Record<string, string> = {\n')
        for k, v in data.items():
            f.write(f'  {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)},\n')
        f.write('};\n\n')
        f.write('// Forms with more than one base-form reading (e.g. noun plural vs. verb\n')
        f.write('// infinitive); the first is the default. The UI offers these as a choice.\n')
        f.write('export const ALT_MAP: Record<string, string[]> = {\n')
        for k, v in alts.items():
            f.write(f'  {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)},\n')
        f.write('};\n\n')
        f.write('// Definite article (de/het) by noun lemma, from grammatical gender.\n')
        f.write('export const ARTICLE_MAP: Record<string, string> = {\n')
        for k, v in articles.items():
            f.write(f'  {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)},\n')
        f.write('};\n\n')
        f.write('// Noun lemmas that are also a base adjective; the UI offers both the\n')
        f.write('// article-noun and the bare-adjective reading (e.g. "de scheef" / "scheef").\n')
        f.write('export const NOUN_ADJ: string[] = [\n')
        for w in noun_adj:
            f.write(f'  {json.dumps(w, ensure_ascii=False)},\n')
        f.write('];\n')
    print(f'wrote {out}: {len(data)} forms, {len(alts)} ambiguous, {len(articles)} nouns, {len(noun_adj)} noun∩adj')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '/tmp/wikt-nl.jsonl')
