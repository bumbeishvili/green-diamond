#!/usr/bin/env python3
"""The English practice words: merge the band files (b1*.txt ... b6*.txt, one word a line:
word|part of speech|topic|Georgian|example sentence|emoji) and check them the way the game uses them.

usage: python3 tools/words/build.py                          (check only)
       python3 tools/words/build.py --out data/words.json    (check, then write the game's list)
"""
import glob, json, os, re, sys, collections, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
P_OK = {'n', 'v', 'adj', 'adv', 'prep', 'pron', 'conj', 'det', 'num', 'int'}
T_OK = set('people family body health food home city travel transport nature weather animals time numbers '
           'colours clothes work money shopping school feelings communication actions qualities places sport '
           'technology law society abstract grammar'.split())
PROPER = {'I', 'English', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
          'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
          'November', 'December'}
KA_RE = re.compile(r'^[ა-ჿᲐ-Ჿ ,()\-]+$')
TARGET = {1: 300, 2: 400, 3: 500, 4: 400, 5: 250, 6: 150}


def files():
    fs = sorted(glob.glob(os.path.join(HERE, 'b[1-6]*.txt')))
    return fs


def parse():
    out, errs = [], []
    for f in files():
        band = int(os.path.basename(f)[1])
        for ln, line in enumerate(open(f, encoding='utf-8'), 1):
            line = line.rstrip('\n')
            if not line.strip() or line.lstrip().startswith('#'):
                continue
            parts = line.split('|')
            if len(parts) == 5:
                parts.append('')
            if len(parts) != 6:
                errs.append(f'{os.path.basename(f)}:{ln}: expected 6 fields, got {len(parts)}: {line}')
                continue
            w, p, t, ka, ex, e = [x.strip() for x in parts]
            d = {'w': w, 'p': p, 'ka': ka, 'b': band, 't': t, 'ex': ex}
            if e:
                d['e'] = e
            d['_src'] = f'{os.path.basename(f)}:{ln}'
            out.append(d)
    return out, errs


def occurrences(w, ex):
    rx = re.compile(r'\b' + re.escape(w) + r'\b', re.I | re.A)   # what the game uses (JS \b is ASCII)
    return list(rx.finditer(ex))


def validate(words):
    errs, warns = [], []
    seen, seen_ci = {}, {}
    for d in words:
        src, w = d['_src'], d['w']
        for k, typ in (('w', str), ('p', str), ('ka', str), ('b', int), ('t', str), ('ex', str)):
            if not isinstance(d.get(k), typ) or (typ is str and not d[k]):
                errs.append(f'{src}: bad/missing {k}')
        if d['p'] not in P_OK:
            errs.append(f'{src}: {w}: bad p {d["p"]!r}')
        if d['t'] not in T_OK:
            errs.append(f'{src}: {w}: bad t {d["t"]!r}')
        if w != w.lower() and w not in PROPER:
            errs.append(f'{src}: {w}: not lowercase')
        if not re.fullmatch(r"[A-Za-z][A-Za-z'\-]*", w):
            errs.append(f'{src}: {w}: odd characters in headword')
        if w in seen:
            errs.append(f'{src}: duplicate headword {w!r} (also {seen[w]})')
        seen.setdefault(w, src)
        if w.lower() in seen_ci and seen_ci[w.lower()] != w:
            warns.append(f'{src}: case-variant headword {w!r} vs {seen_ci[w.lower()]!r}')
        seen_ci.setdefault(w.lower(), w)
        ms = occurrences(w, d['ex'])
        if len(ms) != 1:
            errs.append(f'{src}: {w}: headword occurs {len(ms)}x in ex: {d["ex"]}')
        for m in ms:
            a = d['ex'][m.start() - 1] if m.start() > 0 else ' '
            b = d['ex'][m.end()] if m.end() < len(d['ex']) else ' '
            if a in "'’-" or b in "'’-":
                errs.append(f'{src}: {w}: match touches apostrophe/hyphen: {d["ex"]}')
            if re.match(r'[^\x00-\x7f]', a) or re.match(r'[^\x00-\x7f]', b):
                errs.append(f'{src}: {w}: match touches non-ascii letter: {d["ex"]}')
        nw = len(d['ex'].split())
        if not 4 <= nw <= 12:
            errs.append(f'{src}: {w}: ex has {nw} words: {d["ex"]}')
        if not re.search(r'[.!?]$', d['ex']):
            warns.append(f'{src}: {w}: ex lacks final punctuation: {d["ex"]}')
        if d['ex'][0].islower():
            warns.append(f'{src}: {w}: ex starts lowercase: {d["ex"]}')
        if not KA_RE.match(d['ka']):
            errs.append(f'{src}: {w}: ka has non-Georgian chars: {d["ka"]!r}')
        kaw = len(re.sub(r'\([^)]*\)', '', d['ka']).replace(',', ' ').split())
        if kaw > 3:
            warns.append(f'{src}: {w}: ka has {kaw} words: {d["ka"]}')
        if '  ' in d['ex'] or '  ' in d['ka']:
            warns.append(f'{src}: {w}: double space')
        if 'e' in d and (not d['e'] or any(c.isascii() and c.isalnum() for c in d['e'].replace('️', ''))):
            if not re.fullmatch(r'[0-9]️⃣', d['e']):
                errs.append(f'{src}: {w}: odd emoji {d["e"]!r}')
    return errs, warns


def report(words, quiet=False):
    bc = collections.Counter(d['b'] for d in words)
    pc = collections.Counter(d['p'] for d in words)
    tc = collections.Counter(d['t'] for d in words)
    n = len(words)
    print(f'entries: {n}')
    print('bands:', ' '.join(f'{b}:{bc[b]}(~{TARGET[b]})' for b in range(1, 7)))
    print('pos:', ' '.join(f'{p}:{c}({100*c/n:.1f}%)' for p, c in pc.most_common()))
    if not quiet:
        print('topics:', ' '.join(f'{t}:{c}' for t, c in tc.most_common()))
        for b in range(1, 7):
            bp = collections.Counter(d['p'] for d in words if d['b'] == b)
            print(f'  band {b} pos:', ' '.join(f'{p}:{c}' for p, c in bp.most_common()))
    kac = collections.Counter(d['ka'] for d in words)
    dup = {k: v for k, v in kac.items() if v > 1}
    print(f'identical ka values shared by >1 word: {len(dup)} ({sum(dup.values())} entries)')
    exc = collections.Counter(d['ex'] for d in words)
    dex = [k for k, v in exc.items() if v > 1]
    if dex:
        print('duplicate example sentences:', dex)
    print('with emoji:', sum(1 for d in words if 'e' in d))


def main():
    out = None
    quiet = '--quiet' in sys.argv
    if '--out' in sys.argv:
        out = sys.argv[sys.argv.index('--out') + 1]
    words, perr = parse()
    errs, warns = validate(words)
    errs = perr + errs
    for e in errs:
        print('ERROR', e)
    for w in warns:
        print('warn ', w)
    report(words, quiet)
    if '--dupka' in sys.argv:
        kac = collections.defaultdict(list)
        for d in words:
            kac[d['ka']].append(d['w'])
        for k, v in sorted(kac.items(), key=lambda x: -len(x[1])):
            if len(v) > 1:
                print('  ', k, '<-', ', '.join(v))
    print(f'{len(errs)} errors, {len(warns)} warnings')
    if out and not errs:
        clean = [{k: v for k, v in d.items() if not k.startswith('_')} for d in words]
        with open(out, 'w', encoding='utf-8') as fh:
            fh.write('[\n' + ',\n'.join(json.dumps(d, ensure_ascii=False) for d in clean) + '\n]\n')
        print('wrote', out)
    return 1 if errs else 0


if __name__ == '__main__':
    sys.exit(main())
