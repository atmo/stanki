#!/usr/bin/env python3
"""Generate an importable Stanki deck of the N most frequent de/het nouns.

Combines a Dutch frequency list (OpenSubtitles, hermitdave/FrequencyWords) with
the gender + English gloss from the kaikki.org Wiktionary extract. Each card:
front = the noun, back = its article (de/het), explanation = an English gloss.

    curl -s -o /tmp/nl_freq.txt \
      https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/nl/nl_50k.txt
    curl -s -o /tmp/wikt-nl.jsonl \
      https://kaikki.org/dictionary/Dutch/kaikki.org-dictionary-Dutch.jsonl
    python3 scripts/gen-dehet-deck.py 1000 > decks/de-het-1000.json
"""
import collections
import json
import re
import sys
import time
import uuid

WIKT = '/tmp/wikt-nl.jsonl'
FREQ = '/tmp/nl_freq.txt'
# Hand-curated removals: frequency words whose high rank comes from a non-noun
# reading (function word, verb form, numeral, nominalized adjective, demonym)
# with only an obscure/archaic noun homograph — "de niet" (staple), "de geef",
# "de zulle". Reviewed by eye from the candidate dump; legitimate verb-homograph
# nouns (werk, staat, kom, weg, dood) are deliberately kept.
EXCLUDE: set[str] = {
    # function words / pronouns / numerals / letters
    'een', 'niet', 'van', 'hij', 'voor', 'dan', 'ja', 'wel', 'nu', 'hun', 'jouw',
    'zij', 'heen', 'twee', 'vier', 'zes', 'negen', 'elf', 'plus', 'min', 'vier',
    'eerder', 'echt', 'zelf', 'waar', 'overal', 'links', 'extra', 'euh',
    # verb forms with only an obscure noun homograph
    'weet', 'doen', 'doe', 'laat', 'zit', 'geef', 'luister', 'hoor', 'praat',
    'lopen', 'zult', 'stond', 'leg', 'raak', 'dronk', 'ren', 'schoot', 'schreef',
    'voorkomen', 'vang', 'las', 'war', 'trok', 'wed', 'gewacht', 'meent', 'leest',
    'overleven', 'drink', 'hang', 'woon', 'schepen',
    # nominalized adjectives / participles / demonyms
    'wilde', 'goede', 'slechte', 'dode', 'vreemde', 'zwarte', 'rare', 'harde',
    'groene', 'rijke', 'bekende', 'blauwe', 'blanke', 'ouwe', 'gemeen', 'illegaal',
    'amerikaanse', 'amerikaan', 'duitse', 'duitser', 'franse', 'britse',
    'edelachtbare', 'vaste', 'derde', 'vierde', 'naakt', 'nat', 'zwak', 'blind',
    'gedacht', 'voldoende',
    # obscure / archaic / dialectal noun homographs of a more common other word
    'gade', 'vedel', 'zegge', 'zulle', 'want', 'bang', 'gelid', 'buiten', 'morgen',
    'lekker', 'rond', 'los', 'zeer', 'vaak', 'dicht', 'miss', 'normaal', 'pardon',
    'frank', 'lief', 'dom', 'moe', 'diep', 'rot', 'scheel', 'peter', 'let', 'belt',
    'bob', 'godsnaam', 'gevang', 'mark', 'schoon', 'dol', 'engels', 'san', 'enk',
    'leen', 'harder', 'des', 'hemelsnaam', 'kim', 'kerstmis', 'proost', 'april',
    'rui', 'amen', 'bo', 'voorde', 'rock', 'ramen', 'bot', 'pop', 'hede', 'gedag',
    'house',
    # crude slang (over-represented by the subtitle corpus) — dropped to keep the
    # deck tasteful
    'klootzak', 'lul', 'pik', 'reet', 'slet', 'stront', 'trut', 'kont', 'hoer',
    'tiet', 'oudere', 'onbekende',
}

WORD_RE = re.compile(r"^[a-zà-ÿ][a-zà-ÿ'’-]*[a-zà-ÿ]$")
JUNK_TAGS = {'table-tags', 'inflection-template', 'class', 'obsolete', 'archaic',
             'dated', 'rare', 'dialectal', 'nonstandard'}


def is_real_lemma(entry):
    senses = entry.get('senses') or []
    if not senses:
        return False
    for s in senses:
        t = set(s.get('tags') or [])
        if not (t & {'obsolete', 'archaic'}) and 'alt-of' not in t and 'form-of' not in t:
            return True
    return False


def gender_article(entry):
    for ht in entry.get('head_templates') or []:
        if ht.get('name', '').startswith('nl-noun'):
            g = (ht.get('args') or {}).get('1', '')
            if g == 'n':
                return 'het'
            if g and g[0] in 'mfc':
                return 'de'
    return None


def first_gloss(entry):
    for s in entry.get('senses') or []:
        g = (s.get('glosses') or s.get('raw_glosses') or [None])[0]
        if g:
            return re.sub(r'\s+', ' ', g).strip()
    return ''


def load_wiktionary():
    genders = collections.defaultdict(collections.Counter)  # lemma -> {de/het: n}
    glosses = {}                                             # lemma -> english gloss
    form_to_lemma = {}                                       # plural/inflected -> lemma
    for line in open(WIKT, encoding='utf-8'):
        if '"noun"' not in line:
            continue
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        if e.get('lang_code') != 'nl' or e.get('pos') != 'noun' or not is_real_lemma(e):
            continue
        w = (e.get('word') or '').lower()
        if not WORD_RE.match(w):
            continue
        art = gender_article(e)
        if not art:
            continue
        genders[w][art] += 1
        glosses.setdefault(w, first_gloss(e))
        for fo in e.get('forms') or []:
            if set(fo.get('tags') or []) & JUNK_TAGS:
                continue
            f = (fo.get('form') or '').lower()
            if f != w and WORD_RE.match(f):
                form_to_lemma.setdefault(f, w)
    article = {w: ctr.most_common(1)[0][0] for w, ctr in genders.items()}
    return article, glosses, form_to_lemma


def main(limit):
    article, glosses, form_to_lemma = load_wiktionary()

    chosen = []           # [(lemma, article, gloss)]
    seen = set()
    seen_glosses = set()  # keep prompts unique: one word per English meaning
    for line in open(FREQ, encoding='utf-8'):
        word = line.split(' ', 1)[0].strip().lower()
        if not word or word in EXCLUDE:
            continue
        lemma = word if word in article else form_to_lemma.get(word)
        if not lemma or lemma not in article or lemma in seen or lemma in EXCLUDE:
            continue
        gloss = glosses.get(lemma, '').strip()
        gkey = gloss.lower()
        if not gloss or gkey in seen_glosses:
            continue  # no usable meaning, or that meaning already has a (more frequent) word
        seen.add(lemma)
        seen_glosses.add(gkey)
        chosen.append((lemma, article[lemma], gloss))
        if len(chosen) >= limit:
            break

    now = int(time.time() * 1000)
    deck_id = str(uuid.uuid4())
    cards = []
    for lemma, art, gloss in chosen:
        # One-sided: prompt with the English meaning, answer with the de/het word.
        cards.append({
            'id': str(uuid.uuid4()),
            'deckId': deck_id,
            'front': gloss,
            'back': f'{art} {lemma}',
            'interval': 0,
            'easeFactor': 2.5,
            'repetitions': 0,
            'dueDate': now,
            'createdAt': now,
            'updatedAt': now,
        })
    bundle = {
        'app': 'stanki',
        'schemaVersion': 1,
        'exportedAt': now,
        'decks': [{'id': deck_id, 'name': f'De/het — top {len(cards)}',
                   'reviewDirection': 'forward',
                   'createdAt': now, 'updatedAt': now}],
        'cards': cards,
    }
    json.dump(bundle, sys.stdout, ensure_ascii=False, indent=2)
    print(f'\n# {len(cards)} de/het cards', file=sys.stderr)
    de = sum(1 for _, a, _ in chosen if a == 'de')
    print(f'# {de} de / {len(chosen) - de} het', file=sys.stderr)


if __name__ == '__main__':
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 1000)
