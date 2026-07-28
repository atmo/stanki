#!/usr/bin/env python3
"""Convert decks/knm_deck_source.json (v2) into Stanki import bundles.

Stanki has no tags/flags field, so flags and provenance are folded into the
free-text fields the importer keeps (`explanation`, and a url-only `context`
whose text is the eindterm reference). The source file
deliberately moved read-once / regional / procedural material out of the drill
deck, so we mirror that: two single-deck bundles (the importer imports only
decks[0] per file) — a drill deck and a separate reference deck — preserving
every card and section.
"""
import json
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "decks" / "knm_deck_source.json"
DRILL_OUT = ROOT / "decks" / "knm_stanki.json"
REF_OUT = ROOT / "decks" / "knm_reference.json"

src = json.loads(SRC.read_text(encoding="utf-8"))
now = int(time.time() * 1000)  # Stanki timestamps are epoch ms
meaning = src.get("flag_meanings", {})
source = src["deck"]["source"]


def uniquifier():
    """Guarantee unique fronts per deck so none is lost to import de-duplication."""
    seen = {}

    def make(front):
        key = front.strip().lower()
        n = seen.get(key, 0) + 1
        seen[key] = n
        return front if n == 1 else f"{front} ({n})"
    return make


def flags_expl(c):
    """Each flag as `code — meaning`, joined ' · ' (Review collapses newlines)."""
    return " · ".join(f"{f} — {meaning.get(f, f)}" for f in c.get("flags", [])) or None


def drill_context(c):
    # Provenance folded into a url-only context (no sentence): text = eindterm ref.
    label = f"Thema {c['theme']} ({c['theme_name']}) — eindterm {c['source_ref']}"
    if c.get("back_source"):
        label += f" · {c['back_source']}"  # regulation vs authored provenance
    return [{"text": label, "url": source["url"], "addedAt": now}]


def ref_context(source_ref, extra=None):
    label = f"eindterm {source_ref}" + (f" · {extra}" if extra else "")
    return [{"text": label, "url": source["url"], "addedAt": now}]


def bundle(deck_id, name, cards, description=None):
    deck = {"id": deck_id, "name": name, "reviewDirection": "forward",
            "createdAt": now, "updatedAt": now}
    if description:
        deck["description"] = description
    return {"app": "stanki", "schemaVersion": 1, "exportedAt": now, "decks": [deck], "cards": cards}


# Deck-level notes now live in the deck's description field (not a fake card).
drill_description = "\n".join([
    src["deck"].get("description", ""),
    "",
    f"Bron: {source['instrument']} ({source['amended_by']}), van kracht sinds {source['in_force_since']}.",
    "",
    "Bouwregels:",
    *[f"• {r}" for r in src.get("build_rules", [])],
])

# --- Drill deck: the 202 Q/A cards. ---
drill_front = uniquifier()
drill_cards = []
for c in src["cards"]:
    drill_cards.append({
        "deckId": "knm",
        "front": drill_front(c["front"]),
        "back": c["back"],
        "explanation": flags_expl(c),
        "contexts": drill_context(c),
    })

# --- Reference deck: the sections held out of the drill queue. ---
ref_front = uniquifier()
ref_cards = []
for it in src.get("read_once", []):
    ref_cards.append({
        "deckId": "knm-ref",
        "front": ref_front(f"Lees één keer — {it['fact']}"),
        "back": f"Eenmalig te lezen (eindterm {it['source_ref']}).",
        "contexts": ref_context(it["source_ref"], it.get("back_source")),
    })
for it in src.get("local", []):
    ref_cards.append({
        "deckId": "knm-ref",
        "front": ref_front(f"Regionaal (zelf opzoeken) — {it['you_must_supply']}"),
        "back": f"Zoek dit op voor je eigen regio/gemeente (eindterm {it['source_ref']}).",
        "contexts": ref_context(it["source_ref"]),
    })
for it in src.get("procedures", []):
    ref_cards.append({
        "deckId": "knm-ref",
        "front": ref_front(f"Procedure — eindterm {it['source_ref']}"),
        "back": it["checklist"],
        "contexts": ref_context(it["source_ref"]),
    })
for it in src.get("verify_before_exam", []):
    ref_cards.append({
        "deckId": "knm-ref",
        "front": ref_front(f"Controleer vóór het examen — {it['item']} (eindterm {it['source_ref']})"),
        "back": it["current"],
        "contexts": ref_context(it["source_ref"]),
    })

DRILL_OUT.write_text(json.dumps(bundle("knm", src["deck"]["name"], drill_cards, drill_description), ensure_ascii=False, indent=2), encoding="utf-8")
REF_OUT.write_text(json.dumps(bundle("knm-ref", f"{src['deck']['name']} — naslag", ref_cards,
                                     "Regionaal, procedureel en eenmalig-te-lezen materiaal, buiten de review-wachtrij gehouden."),
                   ensure_ascii=False, indent=2), encoding="utf-8")

flagged = sum(1 for c in drill_cards if c.get("explanation"))
print(f"Drill  → {DRILL_OUT.relative_to(ROOT)}: {len(drill_cards)} cards ({flagged} flagged)")
print(f"Naslag → {REF_OUT.relative_to(ROOT)}: {len(ref_cards)} cards "
      f"(read_once {len(src.get('read_once', []))}, local {len(src.get('local', []))}, "
      f"procedures {len(src.get('procedures', []))}, verify {len(src.get('verify_before_exam', []))})")
