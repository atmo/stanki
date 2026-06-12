#!/usr/bin/env python3
"""Generate an importable Stanki deck of common Dutch idioms.

Translations are pulled verbatim from the kaikki.org Wiktionary extract (precise,
sourced — machine translators mangle idioms). The selection below is a curated
list of widely-used idioms; each one's English gloss comes from Wiktionary.
Card: front = the idiom, back = its meaning. One-sided (idiom -> meaning).

    python3 scripts/gen-idioms-deck.py > decks/idioms.json
"""
import json
import re
import sys
import time
import uuid

WIKT = '/tmp/wikt-nl.jsonl'

# Glosses that are pointers, not definitions — skip so we take the canonical entry.
NON_DEF = ('alternative form of', 'synonym of', 'obsolete spelling', 'uncommon form of',
           'superseded spelling', 'eggcorn of', 'used other than')

# Curated common idioms (selection by hand; translations come from Wiktionary).
SELECT = [
    'aan de tand voelen', 'aan de touwtjes trekken', 'aan het kortste eind trekken',
    'achter het net vissen', 'addertje onder het gras', 'advocaat van de duivel',
    'alle beetjes helpen', 'alle wegen leiden naar Rome', 'als puntje bij paaltje komt',
    'als een paal boven water staan', 'beter een vogel in de hand dan tien in de lucht',
    'blaffende honden bijten niet', 'boontje komt om zijn loontje', 'boter bij de vis',
    'boter op zijn hoofd hebben', 'buiten de boot vallen', 'de aap komt uit de mouw',
    'de appel valt niet ver van de boom', 'de beste stuurlui staan aan wal',
    'de bloemetjes buiten zetten', 'de boot missen', 'de dans ontspringen',
    'de handdoek in de ring werpen', 'de kip met de gouden eieren slachten',
    'de kluts kwijt', 'de knuppel in het hoenderhok gooien', 'de kool en de geit sparen',
    'de kous is af', 'de lakens uitdelen', 'de les lezen', 'de mist ingaan',
    'de mond snoeren', 'de nek omdraaien', 'de ogen openen', 'de spijker op de kop slaan',
    'de strijdbijl begraven', 'de teerling is geworpen', 'de tijd zal het leren',
    'dertien in een dozijn', 'doen alsof zijn neus bloedt', 'door het lint gaan',
    'dweilen met de kraan open', 'een boekje opendoen', 'een gegeven paard niet in de bek kijken',
    'een goed begin is het halve werk', 'een kat een kat noemen', 'een ongeluk komt nooit alleen',
    'een spaak in het wiel steken', 'een streepje voor hebben', 'een uiltje knappen',
    'een zwaluw maakt nog geen zomer', 'eendracht maakt macht', 'eerlijk duurt het langst',
    'eind goed, al goed', 'fluitje van een cent', 'gebakken lucht', 'geboren en getogen',
    'geen blad voor de mond nemen', 'haastige spoed is zelden goed', 'heet hangijzer',
    'het beestje bij zijn naam noemen', 'het bij het verkeerde eind hebben',
    'het doel heiligt de middelen', 'het gras is altijd groener aan de overkant',
    'het hazenpad kiezen', 'het heft in eigen handen nemen', 'het hek is van de dam',
    'het kaf van het koren scheiden', 'het loodje leggen', 'het onderspit delven',
    'het paard achter de wagen spannen', 'het spits afbijten', 'het zekere voor het onzekere nemen',
    'hoge bomen vangen veel wind', 'hoogmoed komt voor de val', 'hoe meer zielen, hoe meer vreugd',
    'ieder huisje heeft zijn kruisje', 'in de kiem smoren', 'in de put zitten',
    'in de steek laten', 'in de wind slaan', 'ivoren toren', 'klaar is Kees',
    'kleren maken de man', 'koek en ei', 'koekje van eigen deeg', 'kommer en kwel',
    'lood om oud ijzer', 'makkelijker gezegd dan gedaan', 'man en paard noemen',
    'met de gebakken peren zitten', 'met hand en tand', 'met het verkeerde been uit bed stappen',
    'met twee maten meten', 'met zijn neus in de boter vallen', 'mosterd na de maaltijd',
    'na regen komt zonneschijn', 'naar iemands pijpen dansen', 'neusje van de zalm',
    'nood breekt wet', 'oefening baart kunst', 'olie op het vuur gooien',
    'om de hete brij heen draaien', 'onbekend maakt onbemind', 'oost west, thuis best',
    'op de kleintjes letten', 'op zijn lauweren rusten', 'over de streep trekken',
    'over een nacht ijs gaan', 'over het hoofd zien', 'pappen en nathouden',
    'roet in het eten gooien', 'schering en inslag', 'schijn bedriegt',
    'spijkers met koppen slaan', 'stoom afblazen', 'te mooi om waar te zijn',
    'tot het gaatje gaan', 'twee handen op een buik', 'twee vliegen in een klap slaan',
    'uit de hand lopen', 'uit het oog, uit het hart', 'van alle markten thuis',
    'van een mug een olifant maken', 'vele handen maken licht werk',
    'vlinders in de buik hebben', 'voet bij stuk houden', 'voor de gek houden',
    'voor de hand liggen', 'vreemde eend in de bijt', 'waar een wil is, is een weg',
    'water bij de wijn doen', 'water naar de zee dragen', 'weten waar Abraham de mosterd haalt',
    'wie a zegt, moet ook b zeggen', 'wie het eerst komt, het eerst maalt',
    'wie niet waagt, die niet wint', 'zijn biezen pakken', 'zijn eigen boontjes doppen',
    'zijn gang gaan', 'zijn mannetje staan', 'zijn slag slaan', 'zo vader, zo zoon',
    'zoden aan de dijk zetten', 'zoete broodjes bakken', 'voor wat hoort wat',
    'kennis is macht', 'vergissen is menselijk',
]


# Trim the curated pool to ~100 idiomatic *phrases*: drop full-sentence proverbs
# (a distinct category) and a few less-everyday idioms.
DROP = {
    'beter een vogel in de hand dan tien in de lucht', 'blaffende honden bijten niet',
    'boontje komt om zijn loontje', 'de appel valt niet ver van de boom',
    'de beste stuurlui staan aan wal', 'een gegeven paard niet in de bek kijken',
    'een goed begin is het halve werk', 'een ongeluk komt nooit alleen',
    'een zwaluw maakt nog geen zomer', 'eendracht maakt macht', 'eerlijk duurt het langst',
    'haastige spoed is zelden goed', 'het gras is altijd groener aan de overkant',
    'hoge bomen vangen veel wind', 'hoogmoed komt voor de val', 'hoe meer zielen, hoe meer vreugd',
    'ieder huisje heeft zijn kruisje', 'kleren maken de man', 'na regen komt zonneschijn',
    'nood breekt wet', 'oefening baart kunst', 'onbekend maakt onbemind', 'oost west, thuis best',
    'schijn bedriegt', 'vele handen maken licht werk', 'waar een wil is, is een weg',
    'wie a zegt, moet ook b zeggen', 'wie het eerst komt, het eerst maalt',
    'wie niet waagt, die niet wint', 'zo vader, zo zoon', 'voor wat hoort wat', 'kennis is macht',
    'vergissen is menselijk', 'alle wegen leiden naar Rome', 'het doel heiligt de middelen',
    'de tijd zal het leren', 'alle beetjes helpen', 'dertien in een dozijn',
    'schering en inslag', 'over een nacht ijs gaan', 'pappen en nathouden',
    'de kool en de geit sparen', 'water naar de zee dragen', 'de knuppel in het hoenderhok gooien',
    'het hazenpad kiezen', 'weten waar Abraham de mosterd haalt', 'zoete broodjes bakken',
    'olie op het vuur gooien',
    # standalone sentences / sayings, not phrase idioms used within a sentence
    'de aap komt uit de mouw', 'de kous is af', 'de teerling is geworpen',
    'het hek is van de dam', 'klaar is Kees', 'eind goed, al goed', 'uit het oog, uit het hart',
}


def load_idiom_glosses():
    glosses = {}
    for line in open(WIKT, encoding='utf-8'):
        if 'idiomatic' not in line and '"proverb"' not in line:
            continue
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        if e.get('lang_code') != 'nl':
            continue
        w = e.get('word', '')
        if ' ' not in w or w in glosses:
            continue
        senses = e.get('senses') or []
        if not (e.get('pos') == 'proverb'
                or any('idiomatic' in (s.get('tags') or []) for s in senses)):
            continue
        for s in senses:
            g = (s.get('glosses') or [None])[0]
            if g and not g.lower().startswith(NON_DEF):
                glosses[w] = re.sub(r'\s+', ' ', g).strip()
                break
    return glosses


def main():
    glosses = load_idiom_glosses()
    missing = [k for k in SELECT if k not in glosses]
    if missing:
        print('# MISSING from Wiktionary:', file=sys.stderr)
        for m in missing:
            print('  -', m, file=sys.stderr)

    now = int(time.time() * 1000)
    deck_id = str(uuid.uuid4())
    cards = []
    for idiom in SELECT:
        if idiom in DROP:
            continue
        g = glosses.get(idiom)
        if not g:
            continue
        # Trim a trailing period; keep sentence-form proverb glosses readable.
        back = g[:1].upper() + g[1:] if g[:1].isalpha() else g
        cards.append({
            'id': str(uuid.uuid4()), 'deckId': deck_id,
            'front': idiom, 'back': back,
            'interval': 0, 'easeFactor': 2.5, 'repetitions': 0, 'dueDate': now,
            'createdAt': now, 'updatedAt': now,
        })
    bundle = {
        'app': 'stanki', 'schemaVersion': 1, 'exportedAt': now,
        'decks': [{'id': deck_id, 'name': f'Dutch idioms — {len(cards)}',
                   'reviewDirection': 'forward', 'createdAt': now, 'updatedAt': now}],
        'cards': cards,
    }
    json.dump(bundle, sys.stdout, ensure_ascii=False, indent=2)
    print(f'\n# {len(cards)} idiom cards ({len(missing)} selected keys missing)', file=sys.stderr)


if __name__ == '__main__':
    main()
