#!/usr/bin/env python3
"""Generate shared/lemma-data.ts: a Dutch form -> lemma map of inflected content
words, from the Universal Dependencies Dutch treebanks (UD_Dutch-Alpino +
UD_Dutch-LassySmall, CC BY-SA 4.0). Uses every form encountered (all splits).

Usage:
  # download all conllu splits first, e.g. for each repo/split:
  #   curl -o /tmp/alpino.conllu https://raw.githubusercontent.com/UniversalDependencies/UD_Dutch-Alpino/master/nl_alpino-ud-train.conllu
  python3 scripts/gen-lemma.py /tmp/*.conllu
"""
import re, sys, json, collections, os, glob

POS = {'NOUN', 'VERB', 'AUX', 'ADJ'}
word_re = re.compile(r"^[a-zà-öø-ÿ]+(?:-[a-zà-öø-ÿ]+)?$")


def main(files):
    pairs = collections.defaultdict(collections.Counter)
    for fn in files:
        with open(fn, encoding='utf-8') as f:
            for line in f:
                if not line or line[0] == '#' or line == '\n':
                    continue
                c = line.rstrip('\n').split('\t')
                if len(c) < 4 or '-' in c[0] or '.' in c[0]:
                    continue
                form, lemma, upos = c[1].lower(), c[2].lower(), c[3]
                if upos not in POS or form == lemma:
                    continue
                if not word_re.match(form) or not word_re.match(lemma):
                    continue
                if len(form) < 2 or len(lemma) < 2:
                    continue
                pairs[form][lemma] += 1

    # Keep every form; resolve ambiguity to its most frequent lemma.
    data = {form: ctr.most_common(1)[0][0] for form, ctr in sorted(pairs.items())}

    out = os.path.join(os.path.dirname(__file__), '..', 'shared', 'lemma-data.ts')
    with open(out, 'w', encoding='utf-8') as f:
        f.write(f'// AUTO-GENERATED. Dutch form -> lemma map ({len(data)} inflected content\n')
        f.write('// words) from the Universal Dependencies Dutch treebanks (UD_Dutch-Alpino +\n')
        f.write('// UD_Dutch-LassySmall, all splits, CC BY-SA 4.0). Regenerate via scripts/gen-lemma.py.\n')
        f.write('export const LEMMA_MAP: Record<string, string> = {\n')
        for k, v in data.items():
            f.write(f'  {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)},\n')
        f.write('};\n')
    print(f'wrote {out}: {len(data)} entries')


if __name__ == '__main__':
    args = sys.argv[1:]
    files = [f for a in args for f in glob.glob(a)] or glob.glob('/tmp/*.conllu')
    main(files)
