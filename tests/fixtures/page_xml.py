# Turns a manuscript page from a PAGE XML ground-truth set (image + .xml) into a one-page PDF and a .txt with the
# expert transcription, line by line, for the handwriting test.   python3 page_xml.py SRC_WITHOUT_EXT OUT_WITHOUT_EXT
import sys
import xml.etree.ElementTree as ET
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
root = ET.parse(src + '.xml').getroot(); ns = root.tag.split('}')[0][1:]
lines = [u.text for tl in root.iter(f'{{{ns}}}TextLine') for u in tl.findall(f'{{{ns}}}TextEquiv/{{{ns}}}Unicode')[:1] if u.text]
Image.open(src + '.jpg').convert('RGB').save(dst + '.pdf', resolution=300)
open(dst + '.txt', 'w', encoding='utf8').write('\n'.join(lines))
print(dst, len(lines), 'lines')
