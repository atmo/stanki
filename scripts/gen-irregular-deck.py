#!/usr/bin/env python3
"""Generate an importable Stanki deck of the most frequent Dutch irregular verbs.

For each verb pulls its own principal parts from the kaikki.org Wiktionary
conjugation table (so separable/prefixed derivatives get their correct, distinct
forms), keeps only the irregular ones, and ranks by an OpenSubtitles frequency
list. Card: front = infinitive + meaning, back = preterite sg · pl / participle
(with the auxiliary for known zijn-verbs).

    python3 scripts/gen-irregular-deck.py [limit] > decks/irregular-verbs.json
"""
import json
import re
import sys
import time
import uuid

WIKT = '/tmp/wikt-nl.jsonl'
FREQ = '/tmp/nl_freq.txt'
WORD_RE = re.compile(r"^[a-zà-ÿ][a-zà-ÿ'’ -]*[a-zà-ÿ]$")

# Tags marking variants we never want as the citation form.
SKIP_TAGS = {'archaic', 'Flanders', 'colloquial', 'formal', 'majestic', 'dated',
             'obsolete', 'rare', 'dialectal', 'subordinate-clause', 'second-person'}

# Junk: a participle masquerading as an infinitive, and archaic strong verbs whose
# modern form is weak/other (reviewed by eye from the verb list).
EXCLUDE: set[str] = {'gevallen', 'plegen', 'vermogen', 'dunken'}

# Verbs taking "zijn" in the perfect. The dataset doesn't carry the auxiliary, so
# this is a curated, conservative set: unaccusative/change-of-state verbs and clear
# goal-motion compounds. Ambiguous activity-motion verbs (lopen, rijden, zwemmen…)
# are left bare (they take hebben unless a goal is expressed). Known prefix
# exceptions are handled: toenemen is zijn though nemen is hebben; aanvallen,
# ondergaan, aangaan, oplopen stay hebben.
ZIJN: set[str] = {
    # core unaccusative / change-of-state
    'zijn', 'gaan', 'komen', 'worden', 'blijven', 'beginnen', 'sterven', 'vallen',
    'gebeuren', 'vertrekken', 'verdwijnen', 'verschijnen', 'ontstaan', 'overlijden',
    'opstaan', 'schrikken', 'vergaan', 'bezwijken', 'herrijzen', 'verrijzen',
    'oprijzen', 'rijzen', 'stijgen', 'zinken', 'zwellen', 'krimpen', 'smelten',
    'bevriezen', 'invriezen', 'opzwellen', 'uiteenvallen', 'verworden', 'toenemen',
    'genezen', 'ontwaken', 'slagen', 'groeien',
    # gaan compounds
    'weggaan', 'teruggaan', 'meegaan', 'uitgaan', 'doorgaan', 'ingaan', 'opgaan',
    'overgaan', 'heengaan', 'misgaan', 'opengaan', 'voorbijgaan', 'vooruitgaan',
    'neergaan', 'voortgaan', 'samengaan', 'langsgaan', 'doodgaan',
    # komen compounds
    'aankomen', 'terugkomen', 'binnenkomen', 'opkomen', 'uitkomen', 'overkomen',
    'bijkomen', 'omkomen', 'langskomen', 'meekomen', 'thuiskomen', 'terechtkomen',
    'voortkomen', 'tussenkomen', 'samenkomen', 'bijeenkomen', 'vrijkomen',
    'tegemoetkomen', 'wegkomen',
    # vallen compounds
    'opvallen', 'invallen', 'afvallen', 'uitvallen', 'meevallen', 'tegenvallen',
    'doodvallen', 'flauwvallen', 'neervallen', 'omvallen', 'wegvallen', 'samenvallen',
    'hervallen', 'terugvallen', 'bevallen', 'vervallen',
    # blijven compounds
    'achterblijven', 'thuisblijven', 'overblijven', 'opblijven', 'aanblijven',
    'bijblijven',
    # sterven compounds
    'uitsterven', 'afsterven',
    # motion-to-goal / other clear zijn
    'opstijgen', 'afstijgen', 'opklimmen', 'opduiken', 'induiken', 'uitglijden',
    'afglijden', 'wegvliegen', 'terugvliegen', 'overvliegen', 'rondvliegen',
    'oversteken', 'inslapen', 'ontvallen', 'ontgaan', 'leeglopen', 'vollopen',
    'vastlopen',
}

# Manner-of-motion verbs that take EITHER auxiliary — zijn when a direction/goal
# is expressed ("is naar huis gelopen"), hebben otherwise ("heeft hard gelopen").
# Left bare on the back, flagged in the explanation so the possibility is visible.
MAYBE_ZIJN: set[str] = {
    'lopen', 'rijden', 'vliegen', 'zwemmen', 'varen', 'klimmen', 'springen', 'duiken',
    'kruipen', 'glijden', 'zwerven', 'drijven', 'sluipen', 'dringen', 'schuiven',
    'weglopen', 'teruglopen', 'rondlopen', 'hardlopen', 'meelopen', 'omlopen',
    'langslopen', 'vooruitlopen', 'mislopen', 'aflopen', 'uitlopen', 'inlopen',
    'binnenlopen', 'loslopen', 'wegrijden', 'terugrijden', 'rondrijden', 'inrijden',
    'omrijden', 'doorrijden', 'meerijden', 'aanrijden', 'autorijden', 'aanvliegen',
    'rondtrekken',
}


def is_real_lemma(entry):
    senses = entry.get('senses') or []
    if not senses:
        return False
    for s in senses:
        t = set(s.get('tags') or [])
        if not (t & {'obsolete', 'archaic'}) and 'alt-of' not in t and 'form-of' not in t:
            return True
    return False


def first_gloss(entry):
    for s in entry.get('senses') or []:
        g = (s.get('glosses') or s.get('raw_glosses') or [None])[0]
        if g:
            return re.sub(r'\s+', ' ', g).strip()
    return ''


def find_form(entry, require, exclude=frozenset()):
    """First non-variant form whose tags include all of `require`, none of
    `exclude` or SKIP_TAGS."""
    for f in entry.get('forms') or []:
        tags = set(f.get('tags') or [])
        if require <= tags and not (tags & (SKIP_TAGS | exclude)):
            form = (f.get('form') or '').strip()
            if form and form not in ('-', '—'):
                return form
    return ''


def is_weak(pret_sg):
    """Regular weak verbs form the preterite with -te/-de on the stem. For a
    separable form ("belde op") check the verb token, not the particle."""
    verb = pret_sg.split(' ', 1)[0]  # "kwam aan" -> "kwam"; "belde op" -> "belde"
    return verb.endswith('te') or verb.endswith('de')


def principal_parts(entry):
    pret_sg = find_form(entry, {'first-person', 'past', 'singular'})
    pret_pl = find_form(entry, {'past', 'plural'})
    part = find_form(entry, {'participle', 'past'}, exclude={'present'})
    return pret_sg, pret_pl, part


def load_verbs():
    """infinitive -> (pret_sg, pret_pl, participle, gloss) for irregular verbs."""
    verbs = {}
    for line in open(WIKT, encoding='utf-8'):
        if '"verb"' not in line:
            continue
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        if e.get('lang_code') != 'nl' or e.get('pos') != 'verb' or not is_real_lemma(e):
            continue
        inf = (e.get('word') or '').lower()
        if not WORD_RE.match(inf) or inf in verbs:
            continue
        pret_sg, pret_pl, part = principal_parts(e)
        if not (pret_sg and pret_pl and part):
            continue
        if is_weak(pret_sg):
            continue  # regular weak verb — not irregular
        gloss = first_gloss(e)
        if not gloss:
            continue
        verbs[inf] = (pret_sg, pret_pl, part, gloss)
    return verbs


def main(limit):
    verbs = load_verbs()

    chosen = []
    seen = set()
    for line in open(FREQ, encoding='utf-8'):
        w = line.split(' ', 1)[0].strip().lower()
        if w in verbs and w not in seen and w not in EXCLUDE:
            seen.add(w)
            chosen.append((w, *verbs[w]))
            if len(chosen) >= limit:
                break

    now = int(time.time() * 1000)
    deck_id = str(uuid.uuid4())
    cards = []
    for inf, pret_sg, pret_pl, part, gloss in chosen:
        perfect = f'is {part}' if inf in ZIJN else part
        explanation = (
            f'Perfect: zijn with a direction/goal (is {part}), otherwise hebben.'
            if inf in MAYBE_ZIJN else ''
        )
        cards.append({
            'id': str(uuid.uuid4()),
            'deckId': deck_id,
            'front': f'{inf}\n{gloss}',
            'back': f'{pret_sg} · {pret_pl}\n{perfect}',
            'explanation': explanation,
            'interval': 0, 'easeFactor': 2.5, 'repetitions': 0, 'dueDate': now,
            'createdAt': now, 'updatedAt': now,
        })
    bundle = {
        'app': 'stanki', 'schemaVersion': 1, 'exportedAt': now,
        'decks': [{'id': deck_id, 'name': f'Irregular verbs — top {len(cards)}',
                   'reviewDirection': 'forward', 'createdAt': now, 'updatedAt': now}],
        'cards': cards,
    }
    json.dump(bundle, sys.stdout, ensure_ascii=False, indent=2)
    print(f'\n# {len(verbs)} irregular verbs found; {len(cards)} in deck', file=sys.stderr)


if __name__ == '__main__':
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 1000)
