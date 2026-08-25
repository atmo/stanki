#!/usr/bin/env python3
"""Analyse a Stanki export bundle: collection shape, scheduling health, and —
if the bundle carries a review log — the diagnostics that explain retention.

Usage: python3 scripts/analyze-export.py <export.json> [deck-name-substring]

Several review fields were added after the first analysis and are still filling
up. The report prints their coverage so it is obvious when there is enough data
to write the analysis each one unlocks — see PENDING below.
"""
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta

DAY = 86_400_000
MATURE = 21          # Anki convention: interval >= 21d is "mature"
MIN_EASE = 1.3       # the scheduler's ease floor
TARGET = 0.90        # retention SM-2 nominally aims for

# ---------------------------------------------------------------- helpers ---
def pct(p, t):
    return f"{100*p/t:5.1f}%" if t else "    — "

def bar(frac, width=28):
    n = int(round(frac * width))
    return "█" * n + "·" * (width - n)

def day_of(ts):
    return datetime.fromtimestamp(ts / 1000).date()

def h(title):
    print(f"\n{'=' * 72}\n{title}\n{'=' * 72}")


# ------------------------------------------------------------------ load ---
path = sys.argv[1] if len(sys.argv) > 1 else "tmp/exports/stanki-export.json"
d = json.load(open(path, encoding="utf-8"))
decks = {x["id"]: x for x in d.get("decks", []) if not x.get("deleted")}
cards = [c for c in d.get("cards", []) if not c.get("deleted")]
reviews = sorted(d.get("reviews") or [], key=lambda r: r["ts"])
now = d.get("exportedAt") or max((r["ts"] for r in reviews), default=0)

print(f"file      {path}")
print(f"exported  {datetime.fromtimestamp(now/1000):%Y-%m-%d %H:%M}")

# Optional: restrict the whole report to one deck.
if len(sys.argv) > 2:
    want = sys.argv[2].lower()
    exact = {i for i, dk in decks.items() if dk.get("name", "").lower() == want}
    keep = exact or {i for i, dk in decks.items() if want in dk.get("name", "").lower()}
    if not keep:
        sys.exit(f"no deck matching {sys.argv[2]!r}; have: "
                 + ", ".join(sorted(dk.get('name', '?') for dk in decks.values())))
    decks = {i: dk for i, dk in decks.items() if i in keep}
    cards = [c for c in cards if c["deckId"] in keep]
    ids = {c["id"] for c in cards}
    # Fall back to cardId for logs predating the deckId backfill.
    reviews = [r for r in reviews
               if ((r["deckId"] in keep) if r.get("deckId") else (r["cardId"] in ids))]
    print(f"scoped to {', '.join(dk.get('name','?') for dk in decks.values())}")

print(f"decks {len(decks)}  cards {len(cards)}  reviews {len(reviews)}")

# Fields added after this script was first written. Each replaces something the
# report currently infers, or unlocks an analysis it cannot do at all yet.
PENDING = {
    "prevDue": "exact lateness (drop the timestamp chaining)",
    "prevEase": "retention vs ease — is ease predicting anything?",
    "thinkMs": "recall latency vs outcome (currently inferred from gaps)",
    "posInSession": "does accuracy decay within a sitting?",
    "overLimit": "capped vs past-the-cap study",
    "schedVer": "segment regimes instead of averaging across them",
}
if reviews:
    print("\nfields still filling up — write the analysis when the count is worth it:")
    for k, why in PENDING.items():
        n = sum(1 for r in reviews if r.get(k) is not None)
        print(f"  {k:<13}{n:>6}/{len(reviews)}  {why}")
    if d.get("settings"):
        print(f"\nsettings in bundle: {d['settings']}")
        print(f"settings changes logged: {len(d.get('settingsLog') or [])}")
    else:
        print("\n(no settings in this bundle — exported from a build before that landed)")

# Review *units*: one per active direction, matching what the app schedules.
def units(card):
    direction = decks.get(card["deckId"], {}).get("reviewDirection", "forward")
    out = [("forward", card)]
    if direction == "both":
        out.append(("reverse", card.get("reverse") or {"interval": 0, "easeFactor": 2.5, "dueDate": 0}))
    elif direction == "reverse":
        return [("reverse", card.get("reverse") or {"interval": 0, "easeFactor": 2.5, "dueDate": 0})]
    return out


# ------------------------------------------------------------ collection ---
h("COLLECTION")
per_deck = defaultdict(lambda: {"cards": 0, "new": 0, "young": 0, "mature": 0})
tot = {"new": 0, "young": 0, "mature": 0}
for c in cards:
    per_deck[c["deckId"]]["cards"] += 1
    for _, s in units(c):
        iv = s.get("interval", 0)
        k = "new" if iv == 0 else ("young" if iv < MATURE else "mature")
        per_deck[c["deckId"]][k] += 1
        tot[k] += 1

print(f"{'deck':<34}{'dir':>8}{'cards':>7}{'new':>7}{'young':>7}{'mature':>8}")
for did, st in sorted(per_deck.items(), key=lambda kv: -kv[1]["cards"]):
    dk = decks.get(did, {})
    print(f"{dk.get('name','(unknown)')[:33]:<34}{dk.get('reviewDirection','forward'):>8}"
          f"{st['cards']:>7}{st['new']:>7}{st['young']:>7}{st['mature']:>8}")
u = sum(tot.values())
print(f"\nreview units {u}   new {pct(tot['new'],u)}  young {pct(tot['young'],u)}  mature {pct(tot['mature'],u)}")

# ----------------------------------------------------------- scheduling ---
h("SCHEDULING STATE")
EDGES = [(0, 1, "new"), (1, 2, "1d"), (2, 4, "2-4d"), (4, 8, "4-8d"), (8, 16, "8-16d"),
         (16, 32, "16-32d"), (32, 64, "32-64d"), (64, 128, "64-128d"), (128, 1e9, "128d+")]
ivs = Counter()
for c in cards:
    for _, s in units(c):
        iv = s.get("interval", 0)
        for lo, hi, lbl in EDGES:
            if lo <= iv < hi:
                ivs[lbl] += 1
                break
print("interval distribution (review units)")
mx = max(ivs.values()) if ivs else 1
for _, _, lbl in EDGES:
    n = ivs.get(lbl, 0)
    print(f"  {lbl:>9} {n:>6}  {bar(n/mx)}")

eases = [s.get("easeFactor", 2.5) for c in cards for _, s in units(c) if s.get("interval", 0) > 0]
if eases:
    floored = sum(1 for e in eases if e <= MIN_EASE + 1e-9)
    print(f"\nease of studied units: min {min(eases):.2f}  median {sorted(eases)[len(eases)//2]:.2f}  max {max(eases):.2f}")
    print(f"  at the {MIN_EASE} floor (\"ease hell\"): {floored} ({pct(floored, len(eases)).strip()})")
    eb = Counter()
    for e in eases:
        eb[f"{min(2.6, max(1.3, round(e*5)/5)):.1f}"] += 1
    for k in sorted(eb):
        print(f"  ease {k}  {eb[k]:>6}  {bar(eb[k]/max(eb.values()))}")

# backlog
overdue = Counter()
due_now = 0
for c in cards:
    for _, s in units(c):
        if s.get("interval", 0) <= 0:
            continue
        late = (now - s.get("dueDate", 0)) / DAY
        if late >= 0:
            due_now += 1
            for lo, hi, lbl in [(0, 1, "today"), (1, 7, "1-7d late"), (7, 30, "7-30d late"), (30, 1e9, "30d+ late")]:
                if lo <= late < hi:
                    overdue[lbl] += 1
                    break
print(f"\ndue now: {due_now} review units")
for lbl in ["today", "1-7d late", "7-30d late", "30d+ late"]:
    if overdue.get(lbl):
        print(f"  {lbl:>12} {overdue[lbl]:>6}")

print(f"\n{'deck':<34}{'due':>6}{'>7d late':>10}{'worst':>8}")
for did, dk in sorted(decks.items(), key=lambda kv: kv[1].get("name", "")):
    dn = late7 = 0
    worst = 0.0
    for c in cards:
        if c["deckId"] != did:
            continue
        for _, s in units(c):
            if s.get("interval", 0) <= 0:
                continue
            lt = (now - s.get("dueDate", 0)) / DAY
            if lt >= 0:
                dn += 1
                late7 += lt >= 7
                worst = max(worst, lt)
    if dn:
        print(f"{dk.get('name','?')[:33]:<34}{dn:>6}{late7:>10}{worst:>7.0f}d")

if not reviews:
    print("\n(no review log in this bundle — rerun on an export that includes reviews)")
    sys.exit(0)

# --------------------------------------------------------------- volume ---
h("STUDY VOLUME")
by_day = Counter(day_of(r["ts"]) for r in reviews)
days = sorted(by_day)
span = (days[-1] - days[0]).days + 1
print(f"range {days[0]} -> {days[-1]}  ({span} days, {len(days)} studied, {100*len(days)/span:.0f}% of days)")
print(f"reviews {len(reviews)}   per studied day: mean {len(reviews)/len(days):.0f}, "
      f"median {sorted(by_day.values())[len(by_day)//2]}, max {max(by_day.values())}")

streak = best = 0
prev = None
for dt in days:
    streak = streak + 1 if prev and (dt - prev).days == 1 else 1
    best = max(best, streak)
    prev = dt
cur = streak if (days[-1] - days[-1]).days == 0 else 0
print(f"longest streak {best} days   final streak {cur} days")

print("\nlast 21 days")
for i in range(20, -1, -1):
    dt = days[-1] - timedelta(days=i)
    n = by_day.get(dt, 0)
    print(f"  {dt:%a %d %b} {n:>4}  {bar(n/max(by_day.values()))}")

# How much of the daily review budget relearning eats. dailyCounts() buckets a
# review as "new" only when prevInterval === 0, so a relearning step (a sub-day
# interval) counts against maxReviewsPerDay just like a genuinely due card.
h("DAILY BUDGET PRESSURE")
per_deck_day = defaultdict(Counter)
for r in reviews:
    kind = "new" if r["prevInterval"] == 0 else ("relearn" if r["prevInterval"] < 1 else "due")
    per_deck_day[r.get("deckId")][kind] += 1
print(f"{'deck':<34}{'due':>8}{'relearn':>9}{'new':>7}{'relearn share of cap':>22}")
for did, c in sorted(per_deck_day.items(), key=lambda kv: -sum(kv[1].values())):
    cap_used = c["due"] + c["relearn"]          # both count as reviewsToday
    if cap_used < 20:
        continue
    print(f"{decks.get(did,{}).get('name','(deleted deck)')[:33]:<34}"
          f"{c['due']:>8}{c['relearn']:>9}{c['new']:>7}{pct(c['relearn'], cap_used):>22}")
nd = len(days)
print(f"\nper studied day, all decks: {sum(c['due'] for c in per_deck_day.values())/nd:.0f} due"
      f" + {sum(c['relearn'] for c in per_deck_day.values())/nd:.0f} relearn"
      f" + {sum(c['new'] for c in per_deck_day.values())/nd:.0f} new")

# Sessions, inferred from gaps between consecutive reviews. Until reviews carry
# durationMs this is the only way to see pace, and pace decides how long a card
# re-queued after "Again" actually waits before it comes back round.
h("SESSIONS & PACE")
IDLE = 600  # a gap this long ends a session
gaps = sorted((reviews[i+1]["ts"] - reviews[i]["ts"]) / 1000 for i in range(len(reviews) - 1))
gaps = [g for g in gaps if g >= 0]
if gaps:
    q = lambda f: gaps[min(len(gaps) - 1, int(f * len(gaps)))]
    print(f"seconds per card: p25 {q(.25):.1f}  median {q(.5):.1f}  p75 {q(.75):.1f}  p90 {q(.9):.1f}")
sess, cur = [], [reviews[0]]
for a, b in zip(reviews, reviews[1:]):
    if (b["ts"] - a["ts"]) / 1000 > IDLE:
        sess.append(cur); cur = [b]
    else:
        cur.append(b)
sess.append(cur)
durs = sorted((s[-1]["ts"] - s[0]["ts"]) / 60000 for s in sess)
cnts = sorted(len(s) for s in sess)
print(f"{len(sess)} sessions (idle gap > {IDLE//60} min ends one), {len(sess)/len(days):.1f} per studied day")
print(f"  reviews/session: median {cnts[len(cnts)//2]}  max {cnts[-1]}")
print(f"  minutes/session: median {durs[len(durs)//2]:.1f}  p90 {durs[int(.9*len(durs))]:.1f}  max {durs[-1]:.0f}")
for m in (5, 10, 15, 20):
    n = sum(1 for x in durs if x >= m)
    print(f"    reaching {m:>2} min: {n:>3} ({pct(n, len(durs)).strip()})")
print("  ^ a relearning card re-queued to the tail only comes back if the session")
print("    outlasts the queue ahead of it — so this caps any in-session relearn step.")

hours = Counter(datetime.fromtimestamp(r["ts"]/1000).hour for r in reviews)
print("\nby hour of day")
for hh in range(24):
    if hours.get(hh):
        print(f"  {hh:02d}:00 {hours[hh]:>5}  {bar(hours[hh]/max(hours.values()))}")

# ---------------------------------------------------------------- recall ---
h("RECALL")
grad = [r for r in reviews if r["prevInterval"] >= 1]      # real recall tests
learn = [r for r in reviews if r["prevInterval"] == 0]
relearn = [r for r in reviews if 0 < r["prevInterval"] < 1]
passed = lambda r: r["grade"] != "again"

g = Counter(r["grade"] for r in reviews)
print(f"answers: again {g['again']} ({pct(g['again'],len(reviews)).strip()})  "
      f"good {g['good']} ({pct(g['good'],len(reviews)).strip()})  "
      f"easy {g['easy']} ({pct(g['easy'],len(reviews)).strip()})")
print(f"introductions {len(learn)}   relearning steps {len(relearn)}   graduated reviews {len(grad)}")

pg = sum(1 for r in grad if passed(r))
print(f"\nTRUE RETENTION  {pct(pg, len(grad))}  ({pg}/{len(grad)})   target {TARGET:.0%}")
yng = [r for r in grad if r["prevInterval"] < MATURE]
mat = [r for r in grad if r["prevInterval"] >= MATURE]
print(f"  young (<{MATURE}d)  {pct(sum(1 for r in yng if passed(r)), len(yng))}  ({len(yng)} reviews)")
print(f"  mature (>={MATURE}d) {pct(sum(1 for r in mat if passed(r)), len(mat))}  ({len(mat)} reviews)")

# forgetting curve
h("FORGETTING CURVE  (retention by interval at review time)")
CURVE = [(1, 2, "1-2d"), (2, 4, "2-4d"), (4, 8, "4-8d"), (8, 16, "8-16d"),
         (16, 32, "16-32d"), (32, 64, "32-64d"), (64, 1e9, "64d+")]
print(f"{'bucket':>9}{'n':>7}{'retention':>11}")
for lo, hi, lbl in CURVE:
    b = [r for r in grad if lo <= r["prevInterval"] < hi]
    if not b:
        print(f"{lbl:>9}{0:>7}          —")
        continue
    p = sum(1 for r in b if passed(r))
    flag = "" if p/len(b) >= TARGET else ("  <-- below target" if len(b) >= 10 else "  (thin)")
    print(f"{lbl:>9}{len(b):>7}{pct(p,len(b)):>11}  {bar(p/len(b), 20)}{flag}")

# per deck
h("RETENTION BY DECK")
dk = defaultdict(lambda: [0, 0])
for r in grad:
    s = dk[r.get("deckId")]
    s[1] += 1
    s[0] += passed(r)
print(f"{'deck':<34}{'n':>7}{'retention':>11}")
for did, (p, t) in sorted(dk.items(), key=lambda kv: -kv[1][1]):
    if t < 5:
        continue
    print(f"{decks.get(did,{}).get('name','(unknown)')[:33]:<34}{t:>7}{pct(p,t):>11}  {bar(p/t, 18)}")

# ------------------------------------------------------------- lateness ---
h("LATENESS  (actual wait / scheduled interval)")
chains = defaultdict(list)
for r in reviews:
    chains[(r["cardId"], r.get("direction", "forward"))].append(r)
ratios, gaps = [], 0
for seq in chains.values():
    for a, b in zip(seq, seq[1:]):
        if b["prevInterval"] < 1:
            continue
        if abs(b["prevInterval"] - a["newInterval"]) > 1e-6:   # a review is missing
            gaps += 1
            continue
        ratios.append(((b["ts"] - a["ts"]) / DAY) / b["prevInterval"])
if ratios:
    ratios.sort()
    med = ratios[len(ratios)//2]
    print(f"pairs {len(ratios)}  (skipped {gaps} with a gap in the log)")
    print(f"median {med:.2f}x   mean {sum(ratios)/len(ratios):.2f}x   "
          f"p90 {ratios[int(.9*len(ratios))]:.2f}x")
    LB = [(0, .9, "early  <0.9x"), (.9, 1.2, "on time"), (1.2, 2, "late 1.2-2x"),
          (2, 4, "late 2-4x"), (4, 1e9, "very late 4x+")]
    for lo, hi, lbl in LB:
        n = sum(1 for x in ratios if lo <= x < hi)
        print(f"  {lbl:>14} {n:>6} {pct(n,len(ratios))}  {bar(n/len(ratios), 20)}")
    # Split by interval: on a 1-day card, an ordinary "next evening" session is
    # already 1.5x, so a headline ratio dominated by short intervals overstates
    # how far behind you actually are.
    per_b = defaultdict(list)
    for seq in chains.values():
        for a, b in zip(seq, seq[1:]):
            if b["prevInterval"] < 1 or abs(b["prevInterval"] - a["newInterval"]) > 1e-6:
                continue
            for lo, hi, lbl in CURVE:
                if lo <= b["prevInterval"] < hi:
                    per_b[lbl].append(((b["ts"] - a["ts"]) / DAY) / b["prevInterval"])
                    break
    print(f"\n{'bucket':>9}{'n':>7}{'median late':>13}")
    for _, _, lbl in CURVE:
        v = sorted(per_b.get(lbl, []))
        if v:
            print(f"{lbl:>9}{len(v):>7}{v[len(v)//2]:>12.2f}x")
else:
    print("not enough consecutive reviews to measure")

# Is the weak 1-2d bucket fresh graduations, or relearned cards cycling again?
h("THE 1-DAY STEP  (where most reviews live)")
fresh = relapsed = 0
fresh_p = relapsed_p = 0
for seq in chains.values():
    for a, b in zip(seq, seq[1:]):
        if not (1 <= b["prevInterval"] < 2):
            continue
        ok = passed(b)
        if a["prevInterval"] == 0:            # previous review introduced the card
            fresh += 1
            fresh_p += ok
        elif a["prevInterval"] < 1:           # previous review was a relearning step
            relapsed += 1
            relapsed_p += ok
print(f"first day after introduction   {pct(fresh_p, fresh)}  ({fresh} reviews)")
print(f"first day after a relearn      {pct(relapsed_p, relapsed)}  ({relapsed} reviews)")
print(f"\nAgain rate overall {pct(g['again'], len(reviews)).strip()} — every one of those adds a")
print("relearning step that also consumes the daily review cap (dailyCounts counts")
print("any prevInterval != 0 as a review), so lapses crowd out genuinely due cards.")

# ---------------------------------------------------------------- lapses ---
h("LAPSES")
lapses = Counter(r["cardId"] for r in grad if not passed(r))
total_l = sum(lapses.values())
print(f"{total_l} lapses across {len(lapses)} distinct cards "
      f"({pct(len(lapses), len(cards)).strip()} of the collection)")
if lapses:
    ranked = sorted(lapses.values(), reverse=True)
    for share in (0.1, 0.2, 0.5):
        k = max(1, int(len(ranked) * share))
        print(f"  top {share:.0%} of lapsing cards ({k}) account for "
              f"{pct(sum(ranked[:k]), total_l).strip()} of all lapses")
    front = {c["id"]: c.get("front", "?") for c in cards}
    ease = {c["id"]: min(c.get("easeFactor", 2.5),
                         (c.get("reverse") or {}).get("easeFactor", 9)) for c in cards}
    print("\nworst offenders")
    print(f"  {'lapses':>6} {'ease':>5}  front")
    for cid, n in lapses.most_common(15):
        print(f"  {n:>6} {ease.get(cid, float('nan')):>5.2f}  {front.get(cid,'(deleted)')[:52]}")

# ------------------------------------------------------------ suggestion ---
h("DERIVED SUGGESTION")
import math
if len(mat) >= 30 or len(grad) >= 100:
    R = pg / len(grad)
    if 0 < R < 1:
        # Exponential forgetting R = exp(-t/S): to move observed R to TARGET,
        # scale intervals by ln(target)/ln(observed).
        mult = math.log(TARGET) / math.log(R)
        print(f"observed retention {R:.1%} over {len(grad)} graduated reviews")
        print(f"to reach {TARGET:.0%} under an exponential forgetting model, scale intervals by "
              f"~{mult:.2f}x")
        if ratios:
            print(f"but you review at a median {med:.2f}x the scheduled interval — "
                  f"the effective wait is already longer than the setting says.")
            print(f"  closing that gap alone would move retention without touching the scheduler.")
print("\n(reviews carry no prevEase/duration yet — ease-vs-retention and answer-time")
print(" analysis unlock once reviews logged after the enrichment accumulate.)")
