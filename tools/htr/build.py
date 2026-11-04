"""Downloads the free manuscript-reading models from Zenodo, converts them with convert.py and writes
models/htr/: blla.onnx (kraken's line finder), one ONNX + JSON per reader, and index.json for the app.
Runs on GitHub (see .github/workflows/htr-models.yml); needs kraken, onnx and onnxruntime.
"""
import json, os, subprocess, sys, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, 'models', 'htr'); os.makedirs(OUT, exist_ok=True); TMP = os.path.join(HERE, '.dl'); os.makedirs(TMP, exist_ok=True)

READERS = [
    dict(id='mccatmus', zenodo='13788177', name='Early modern and modern hands, 16th–21st century (McCATMuS)',
         langs='Portuguese, Spanish, French, Latin, Italian, English, German, Dutch', era='1500–2000',
         about='Trained on handwritten, printed and typewritten documents from the 16th to the 21st century. The best free choice for Inquisition records, notarial deeds and letters.'),
    dict(id='catmus-medieval', zenodo='15030337', name='Medieval book hands, 8th–16th century (CATMuS Medieval)',
         langs='Latin, French, Spanish, Italian, Catalan, Occitan, Dutch, Venetian', era='800–1550',
         about='Trained on over 200 medieval manuscripts: caroline, gothic textualis, cursiva, hybrida and humanistic scripts. Keeps abbreviations as written (MUFI characters).'),
    dict(id='tridis', zenodo='10800223', name='Medieval and early modern documents, charters and registers (TRIDIS)',
         langs='Latin, French, Spanish, German, Czech', era='1100–1600',
         about='Trained on documentary manuscripts (charters, registers, accounts) and expands abbreviations into full words.'),
    dict(id='traprinq', zenodo='14538271', name='Portuguese Inquisition records, 16th–19th century (TraPrInq)',
         langs='Portuguese', era='1500–1900',
         about='Trained on over 6,400 pages of Portuguese Inquisition trials (Lisbon, Coimbra, Évora) transcribed by the TraPrInq project. Made for Inquisition records.'),
    dict(id='geneapt', zenodo='23733764', name='Portuguese parish registers, 18th–19th century (GeneaPT)',
         langs='Portuguese', era='1700–1900',
         about='Trained on baptism, marriage and burial registers from Portuguese parishes. Made for genealogy.'),
    dict(id='catmus-print', zenodo='10592716', name='Printed books, 15th–20th century (CATMuS-Print)', langs='Latin, French, Spanish, Italian, English, German and more', era='1450–1900',
         about='For old printed books, pamphlets and newspapers, from incunabula to the 19th century.'),
    dict(id='catmus-gothic', zenodo='10599911', name='Gothic (blackletter) print (CATMuS Gothic Print)', langs='Latin, German, French, Spanish', era='1450–1600',
         about='For early books printed in gothic type: incunabula and 16th-century prints.'),
    dict(id='frolat-expan', zenodo='7516057', name='Medieval Latin and French, abbreviations expanded', langs='Latin, French', era='1100–1500',
         about='Reads medieval Latin and French book and document hands and writes abbreviations out in full.'),
    dict(id='regfiii-damage', zenodo='23313428', name='Damaged documents (Regg. F. III)', langs='Latin, German', era='1400–1500',
         about='Trained on damaged, stained and faded pages. Try it when the parchment or paper is worn.'),
    dict(id='lectaurep', zenodo='6542744', name='19th–20th century French administrative hands (LECTAUREP)', langs='French', era='1800–1950',
         about='Notarial and administrative registers of the 19th and 20th centuries.'),
    dict(id='hooker', zenodo='8038689', name='19th-century English handwriting (Joseph Hooker letters)', langs='English', era='1830–1910',
         about='Letters and notes in 19th-century English handwriting.'),
    dict(id='sephardi', zenodo='5468665', name='Medieval Hebrew, Sephardi bookhand', langs='Hebrew', era='1200–1500',
         about='Hebrew manuscripts in Sephardi (Iberian) bookhand. Right-to-left.'),
    dict(id='muharaf', zenodo='14295489', name='Arabic handwriting (Muharaf)', langs='Arabic', era='1800–1950',
         about='Handwritten Arabic documents: letters, legal and administrative papers. Right-to-left.'),
    dict(id='fraktur', zenodo='7089018', name='German Fraktur print', langs='German', era='1600–1940',
         about='Books and newspapers printed in Fraktur.'),
]


def get(url, path=None):
    req = urllib.request.Request(url, headers={'User-Agent': 'quire-htr-build'})
    with urllib.request.urlopen(req, timeout=300) as r:
        data = r.read()
    if path: open(path, 'wb').write(data)
    return data


def zenodo(rec):
    meta = json.loads(get(f'https://zenodo.org/api/records/{rec}'))
    files = [f for f in meta['files'] if f['key'].endswith(('.mlmodel', '.safetensors'))]
    if not files: raise RuntimeError(f'no kraken model in Zenodo record {rec}: ' + ', '.join(f['key'] for f in meta['files']))
    # prefer the "best" model when a record holds several
    files.sort(key=lambda f: (('best' not in f['key'].lower()), -f['size']))
    f = files[0]; path = os.path.join(TMP, f['key'])
    if not os.path.exists(path): get(f['links']['self'], path)
    m = meta['metadata']
    lic = (m.get('license') or {}).get('id', '') if isinstance(m.get('license'), dict) else str(m.get('license', ''))
    authors = ', '.join(c['name'] for c in m.get('creators', [])[:4]) + (' et al.' if len(m.get('creators', [])) > 4 else '')
    cite = f"{authors} ({m.get('publication_date', '')[:4]}). {m.get('title', '')}. Zenodo. https://doi.org/{meta.get('doi', '')}"
    return path, f['key'], lic, cite, meta.get('doi', '')


def convert(src, dst, **kw):
    args = [sys.executable, os.path.join(HERE, 'convert.py'), src, dst]
    for k, v in kw.items(): args += ['--' + k, v]
    subprocess.run(args, check=True)


import kraken
convert(os.path.join(os.path.dirname(kraken.__file__), 'blla.mlmodel'), os.path.join(OUT, 'blla'), name='kraken line finder (blla)',
        source='https://github.com/mittagessen/kraken', licence='Apache-2.0')
index = {'segmenter': 'blla', 'readers': []}
for r in READERS:
    try:
        path, key, lic, cite, doi = zenodo(r['zenodo'])
        convert(path, os.path.join(OUT, r['id']), name=r['name'], source='https://doi.org/' + doi, licence=lic, about=r['about'])
        meta = json.load(open(os.path.join(OUT, r['id'] + '.json')))
        index['readers'].append(dict(id=r['id'], name=r['name'], langs=r['langs'], era=r['era'], about=r['about'], file=key,
                                     licence=lic, cite=cite, doi=doi, accuracy=meta.get('accuracy'),
                                     bytes=os.path.getsize(os.path.join(OUT, r['id'] + '.onnx'))))
        print('converted', r['id'], key, file=sys.stderr)
    except Exception as e:
        print('SKIPPED', r['id'], e, file=sys.stderr)
json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'), ensure_ascii=False, indent=1)
print(json.dumps(index, ensure_ascii=False, indent=1))
