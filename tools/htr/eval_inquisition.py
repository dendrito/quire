"""Measures every manuscript reader on Portuguese Inquisition trials it was not shown: pages from the final
validation set of the TraPrInq ground truth (Zenodo 13986218, CC BY 4.0). Uses the expert lines (ground-truth
baselines), so it scores the reader alone. Also copies three pages into tests/fixtures/real/inq/ for the app test.
Runs on GitHub (see .github/workflows/htr-inquisition.yml); needs kraken.
"""
import io, json, os, re, shutil, subprocess, sys, urllib.request, zipfile
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
TMP = os.path.join(HERE, '.dl'); os.makedirs(TMP, exist_ok=True); WORK = os.path.join(TMP, 'inq'); shutil.rmtree(WORK, ignore_errors=True); os.makedirs(WORK)
MODELS = {'traprinq': '14538271', 'traprinq-v2': '14543904', 'geneapt': '23733764', 'mccatmus': '13788177', 'tridis': '10800223',
          'catmus-medieval': '15030337', 'frolat-expan': '7516057', 'regfiii-damage': '23313428'}
N = int(os.environ.get('PAGES', '30'))


def get(url, path):
    if os.path.exists(path): return path
    req = urllib.request.Request(url, headers={'User-Agent': 'quire-htr-eval'})
    with urllib.request.urlopen(req, timeout=1800) as r, open(path + '.part', 'wb') as f: shutil.copyfileobj(r, f, 1 << 22)
    os.rename(path + '.part', path); return path


def model(rec):
    meta = json.load(urllib.request.urlopen(f'https://zenodo.org/api/records/{rec}'))
    f = sorted([f for f in meta['files'] if f['key'].lower().endswith(('.mlmodel', '.safetensors'))], key=lambda f: ('best' not in f['key'].lower(), -f['size']))[0]
    return get(f['links']['self'], os.path.join(TMP, rec + '-' + f['key']))


z = zipfile.ZipFile(get('https://zenodo.org/api/records/13986218/files/Validation_Set_FINAL.zip/content', os.path.join(TMP, 'inq-val.zip')))
names = z.namelist(); xmls = sorted(n for n in names if n.lower().endswith('.xml') and not n.lower().endswith(('metadata.xml', 'mets.xml', 'doc.xml')) and b'TextLine' in z.read(n))
imgs = {os.path.basename(n).rsplit('.', 1)[0]: n for n in names if n.lower().endswith(('.jpg', '.jpeg', '.png', '.tif', '.tiff'))}
def nlines(n): return len(re.findall(rb'<TextLine\b.*?<Unicode>[^<]{3,}</Unicode>', z.read(n), re.S))
xmls = [n for n in xmls if nlines(n) >= 12]  # transcribed pages only (the set also has covers and blank pages)
print(len(xmls), 'transcribed pages in the validation set', file=sys.stderr)
pick = xmls[::max(1, len(xmls) // N)][:N]; files = []
for k, x in enumerate(pick):
    stem = os.path.basename(x).rsplit('.', 1)[0]; im = imgs.get(stem)
    if not im: continue
    ext = im.rsplit('.', 1)[1]; base = f'p{k:02d}'
    open(os.path.join(WORK, base + '.' + ext), 'wb').write(z.read(im))
    t = z.read(x).decode('utf-8'); t = re.sub(r'imageFilename="[^"]*"', f'imageFilename="{base}.{ext}"', t)
    open(os.path.join(WORK, base + '.xml'), 'w', encoding='utf-8').write(t); files.append(os.path.join(WORK, base + '.xml'))
print(len(files), 'pages picked:', [os.path.basename(x) for x in pick], file=sys.stderr)

res = {}
for mid, rec in MODELS.items():
    try:
        path = model(rec)
        out = subprocess.run(['ketos', 'test', '-f', 'xml', '-m', path, *files], capture_output=True, text=True, timeout=5400)
        txt = out.stdout + out.stderr; rep = txt[txt.find('=== report'):][:600] if '=== report' in txt else txt[:2500]; print('====', mid, '\n', rep, file=sys.stderr)
        acc = re.findall(r'([\d.]+)%\s+Character Accuracy\s*$', txt, re.M) or re.findall(r'([\d.]+)%\s+Accuracy', txt) or re.findall(r'[Aa]ccuracy[^\d\n]*([\d.]+)\s*%', txt); chars = re.findall(r'(\d+)\s+Characters', txt)
        res[mid] = {'cer': round(100 - float(acc[0]), 2) if acc else None, 'chars': int(chars[0]) if chars else None}
    except Exception as e:
        res[mid] = {'error': str(e)}
    print(mid, res[mid], file=sys.stderr)

# three pages for the app's own test (image as a PDF + the expert text), with the licence
dst = os.path.join(ROOT, 'tests', 'fixtures', 'real', 'inq'); os.makedirs(dst, exist_ok=True)
for k in (0, len(files) // 2, len(files) - 1):
    src = files[k][:-4]; name = f'inq-{k:02d}'
    subprocess.run([sys.executable, os.path.join(ROOT, 'tests', 'fixtures', 'page_xml.py'), src, os.path.join(dst, name)], check=True)
open(os.path.join(dst, 'README.md'), 'w').write(
    '# Portuguese Inquisition pages (TraPrInq)\n\nThree pages from the final validation set of *Portuguese Handwriting 16th-19th c.*, '
    'by Hervé Baudry, Susana Tavares Pedro, Marize Helena de Campos et al. (TraPrInq project, CHAM, 2024), '
    'https://doi.org/10.5281/zenodo.13986218, licensed CC BY 4.0. The images are shown as PDFs and the expert '
    'transcriptions as text, otherwise unchanged. Picked pages: ' + ', '.join(os.path.basename(pick[k]) for k in (0, len(files) // 2, len(files) - 1)) + '.\n\n'
    'Reader scores on ' + str(len(files)) + ' validation pages (character error rate, expert lines):\n\n' +
    '\n'.join(f'- {k}: {v.get("cer")}%' for k, v in res.items()) + '\n')
json.dump(res, open(os.path.join(dst, 'scores.json'), 'w'), indent=1)
print(json.dumps(res, indent=1))
