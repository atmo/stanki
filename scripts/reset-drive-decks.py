#!/usr/bin/env python3
"""Delete the deck snapshots from Stanki's Google Drive appDataFolder.

Needed to apply a *corrected* backup: sync merges (last-write-wins + array union)
resurrect fields you removed, so a fix can't merge in — the shared state must be
replaced. This wipes the per-deck snapshot files so the next sync rebuilds them
from your (corrected) local cards. Backups and the review log are kept by default.

Reset procedure (single browser):
  1. In the app: Settings -> Import your corrected backup (e.g. tmp/final.json).
  2. Run this script with --delete to clear the Drive deck snapshots.
  3. In the app: Sync. It recreates the snapshots from the imported cards.
  For extra devices, also clear their site data before they next sync, or they
  push their un-corrected copies back.

Get an access token from the running PWA's devtools console:
    JSON.parse(localStorage.getItem('stanki.googleToken')).accessToken
(or the extension's chrome.storage 'googleToken'). Pass via --token or the
STANKI_DRIVE_TOKEN env var. The token needs the drive.appdata scope and lasts ~1h.

    python3 scripts/reset-drive-decks.py            # dry run (lists only)
    python3 scripts/reset-drive-decks.py --delete   # actually delete deck snapshots
    python3 scripts/reset-drive-decks.py --delete --reviews  # also delete reviews.json
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

FILES = 'https://www.googleapis.com/drive/v3/files'


def api(token: str, method: str, url: str):
    req = urllib.request.Request(url, method=method, headers={'Authorization': f'Bearer {token}'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        raise SystemExit(f'Drive API {method} {url} -> {e.code}: {e.read().decode()[:300]}')


def classify(f: dict) -> str:
    props = f.get('appProperties') or {}
    if props.get('deckId'):
        return 'deck'
    return props.get('kind', 'other')  # 'reviews' | 'backup' | 'other'


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--token', default=os.environ.get('STANKI_DRIVE_TOKEN'))
    ap.add_argument('--delete', action='store_true', help='actually delete (default: dry run)')
    ap.add_argument('--reviews', action='store_true', help='also delete the reviews.json log')
    args = ap.parse_args()
    if not args.token:
        ap.error('no token: pass --token or set STANKI_DRIVE_TOKEN (see --help)')

    params = 'spaces=appDataFolder&pageSize=1000&fields=files(id,name,modifiedTime,appProperties)'
    files = (api(args.token, 'GET', f'{FILES}?{params}') or {}).get('files', [])
    kinds = {'deck': [], 'reviews': [], 'backup': [], 'other': []}
    for f in files:
        kinds[classify(f) if classify(f) in kinds else 'other'].append(f)

    targets = list(kinds['deck']) + (kinds['reviews'] if args.reviews else [])
    print(f'appDataFolder: {len(files)} file(s) — '
          f"{len(kinds['deck'])} deck, {len(kinds['reviews'])} reviews, "
          f"{len(kinds['backup'])} backup, {len(kinds['other'])} other")
    print(f'\nTo delete ({len(targets)}):')
    for f in targets:
        print(f'  {f["id"]}  {f.get("name")}  ({classify(f)})')
    kept = kinds['backup'] + (kinds['reviews'] if not args.reviews else []) + kinds['other']
    print(f'Keeping {len(kept)} file(s): all backups' + ('' if args.reviews else ' + reviews.json'))

    if not args.delete:
        print('\nDry run — nothing deleted. Re-run with --delete to proceed.')
        return 0
    if not targets:
        print('\nNothing to delete.')
        return 0

    print('\nDeleting…')
    for f in targets:
        api(args.token, 'DELETE', f'{FILES}/{f["id"]}')
        print(f'  deleted {f.get("name")}')
    print(f'Done. Deleted {len(targets)} file(s). Now open the app and Sync to rebuild snapshots.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
