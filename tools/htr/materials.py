"""Fetches free period-language material for training Quire's handwriting readers and turns it into small
word lists in training/lexicon/ (the sources themselves are not committed). Runs on GitHub
(.github/workflows/training-materials.yml), because the cloud sessions cannot reach these sites.
Sources: public-domain dictionaries on the Internet Archive (Bluteau 1712-1728, Morais 1789) and,
when reachable, the Tycho Brahe and Post Scriptum corpora of historical Portuguese.
"""
import collections, json, os, re, sys, urllib.parse, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'training', 'lexicon'); os.makedirs(OUT, exist_ok=True)
UA = {'User-Agent': 'quire-training-materials'}

def get(url, timeout=300):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r: return r.read()

def ia_search(q, rows=40):
    u = 'https://archive.org/advancedsearch.php?' + urllib.parse.urlencode({'q': q, 'fl[]': ['identifier', 'title', 'date'], 'rows': rows, 'output': 'json'}, doseq=True)
    return json.loads(get(u))['response']['docs']

def ia_text(ident):
    files = json.loads(get(f'https://archive.org/metadata/{ident}'))['files']
    txt = [f['name'] for f in files if f['name'].endswith('_djvu.txt')]
    return [get(f'https://archive.org/download/{ident}/{urllib.parse.quote(n)}').decode('utf-8', 'replace') for n in txt]

WORD = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿ]+(?:-[A-Za-zÀ-ÖØ-öø-ÿ]+)?")
def count(texts):
    c = collections.Counter()
    for t in texts:
        t = re.sub(r'-\n\s*', '', t).replace('ſ', 's')
        c.update(w.lower() for w in WORD.findall(t) if len(w) > 1)
    return c

SOURCES = [
    ('bluteau', 'Rafael Bluteau, Vocabulario Portuguez e Latino (1712-1728)', 'creator:(Bluteau) AND title:(vocabulario)'),
    ('morais', 'Antonio de Morais Silva, Diccionario da Lingua Portugueza (1789)', 'title:(diccionario lingua portugueza) AND (creator:(Moraes) OR creator:(Morais) OR creator:(Bluteau)) AND date:[1789-01-01 TO 1789-12-31]'),
]
manifest = []; total = collections.Counter()
for key, name, q in SOURCES:
    try:
        docs = ia_search(q); print(key, 'found', [(d['identifier'], d.get('date')) for d in docs], file=sys.stderr)
        texts, used = [], []
        for d in docs:
            try:
                t = ia_text(d['identifier'])
                if t: texts += t; used.append(d['identifier'])
            except Exception as e: print('  skip', d['identifier'], e, file=sys.stderr)
        c = count(texts); total.update(c)
        manifest.append(dict(key=key, name=name, archive_org=used, words=sum(c.values()), distinct=len(c), licence='public domain'))
    except Exception as e:
        manifest.append(dict(key=key, name=name, error=str(e)))

# Corpora of historical Portuguese: report whether they can be reached, for a later, licence-checked import.
for key, url in [('tycho-brahe', 'https://www.tycho.iel.unicamp.br/corpus/'), ('post-scriptum', 'http://ps.clul.ul.pt/'), ('teitok-ps', 'https://teitok.clul.ul.pt/postscriptum/')]:
    try: get(url, 60); manifest.append(dict(key=key, url=url, reachable=True))
    except Exception as e: manifest.append(dict(key=key, url=url, reachable=False, error=str(e)[:200]))

keep = [(w, n) for w, n in total.most_common() if n >= 3]
with open(os.path.join(OUT, 'period-words.tsv'), 'w', encoding='utf-8') as f:
    f.write('word\tcount\n'); f.writelines(f'{w}\t{n}\n' for w, n in keep)
json.dump(dict(made_by='tools/htr/materials.py', kept_words=len(keep), min_count=3, sources=manifest),
          open(os.path.join(OUT, 'sources.json'), 'w'), ensure_ascii=False, indent=1)
print(json.dumps(manifest, ensure_ascii=False, indent=1))
