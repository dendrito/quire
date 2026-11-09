# Makes the test files: born-digital PDFs with fonts that are named but not embedded (as many office programs and
# reportlab write them), and synthetic scans with known text: a skewed book page, a faded page, and tables with and
# without ruling lines. Every random choice is seeded, so the files are the same on every run.
#   python3 make.py            (writes into this folder)
import io, json, os, random, sys, textwrap
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else HERE
FONTS = '/usr/share/fonts/truetype/liberation/'
TEXT = open(os.path.join(HERE, 'pt.txt'), encoding='utf8').read().split()
os.makedirs(OUT, exist_ok=True)
p = lambda name: os.path.join(OUT, name)


def save_scan(rgb, name, dpi, quality):
    b = io.BytesIO(); rgb.save(b, 'JPEG', quality=quality)
    Image.open(io.BytesIO(b.getvalue())).save(p(name + '.pdf'), resolution=dpi)


def book_scan(name, dpi, skew, size, blur):
    """Small serif print, skew, uneven light with a gutter shadow, noise, yellowed paper, JPEG."""
    random.seed(4); np.random.seed(4)
    W, H = int(5.5 * dpi), int(8.5 * dpi)
    img = Image.new('L', (W, H), 255); d = ImageDraw.Draw(img)
    f = ImageFont.truetype(FONTS + 'LiberationSerif-Regular.ttf', int(size / 72 * dpi))
    y = int(.7 * dpi); truth = []
    for ln in textwrap.wrap(' '.join(TEXT), 62):
        if y > H - .8 * dpi: break
        d.text((int(.6 * dpi), y), ln, font=f, fill=20); truth.append(ln); y += int(size * 1.3 / 72 * dpi)
    open(p(name + '.txt'), 'w', encoding='utf8').write('\n'.join(truth))
    img = img.rotate(skew, resample=Image.BICUBIC, fillcolor=255)
    a = np.asarray(img).astype(np.float32)
    xx = np.linspace(0, 1, W)[None, :]; yy = np.linspace(0, 1, H)[:, None]
    a = a * (0.82 + 0.12 * xx + 0.05 * yy - 0.35 * np.exp(-(xx / 0.06) ** 2)) + np.random.normal(0, 9, a.shape)
    a = np.clip(a, 0, 255).astype(np.uint8)
    rgb = Image.merge('RGB', [Image.fromarray(np.clip(a.astype(int) + o, 0, 255).astype(np.uint8)) for o in (8, 2, -18)])
    save_scan(rgb.filter(ImageFilter.GaussianBlur(blur)), name, dpi, 60)


def faded_scan(name, dpi, ink):
    """Low-contrast grey ink with broken strokes on stained, uneven paper."""
    np.random.seed(7)
    W, H = int(5.5 * dpi), int(8.5 * dpi)
    img = Image.new('L', (W, H), 255); d = ImageDraw.Draw(img)
    f = ImageFont.truetype(FONTS + 'LiberationSerif-Regular.ttf', int(9.5 / 72 * dpi))
    y = int(.7 * dpi); truth = []
    for ln in textwrap.wrap(' '.join(TEXT), 62):
        if y > H - .8 * dpi: break
        d.text((int(.6 * dpi), y), ln, font=f, fill=0); truth.append(ln); y += int(12.5 / 72 * dpi)
    open(p(name + '.txt'), 'w', encoding='utf8').write('\n'.join(truth))
    img = img.rotate(1.2, resample=Image.BICUBIC, fillcolor=255)
    a = np.asarray(img).astype(np.float32) / 255.
    mask = np.random.rand(*a.shape) < 0.18; a = np.where((a < 0.5) & mask, 0.7, a)
    xx = np.linspace(0, 1, W)[None, :]; yy = np.linspace(0, 1, H)[:, None]
    paper = np.ones_like(a) * 0.86 - 0.10 * yy + 0.06 * xx
    for _ in range(6):
        cx, cy, r = np.random.rand() * W, np.random.rand() * H, np.random.rand() * W * .12 + 20
        Y, X = np.ogrid[:H, :W]; paper -= 0.08 * np.exp(-((X - cx) ** 2 + (Y - cy) ** 2) / (2 * r * r))
    v = paper * a + ink / 255. * (1 - a) + np.random.normal(0, .035, a.shape)
    v = np.clip(v * 255, 0, 255).astype(np.uint8)
    rgb = Image.merge('RGB', [Image.fromarray(np.clip(v.astype(int) + o, 0, 255).astype(np.uint8)) for o in (6, 0, -22)])
    save_scan(rgb.filter(ImageFilter.GaussianBlur(.7)), name, dpi, 55)


def table_scan(name, ruled):
    random.seed(3); np.random.seed(3); dpi = 200
    W, H = int(8.5 * dpi), int(6 * dpi); img = Image.new('L', (W, H), 255); d = ImageDraw.Draw(img)
    f = ImageFont.truetype(FONTS + 'LiberationSans-Regular.ttf', int(9 / 72 * dpi)); fb = ImageFont.truetype(FONTS + 'LiberationSans-Bold.ttf', int(9 / 72 * dpi))
    head = ['Tribunal', 'Ano', 'Processos', 'Réus', 'Sentenças', 'Valor (réis)']
    names = ['Lisboa', 'Évora', 'Coimbra', 'Goa', 'Porto', 'Lamego', 'Tomar', 'Braga']
    rows = [[n, str(1540 + 7 * i), str(random.randint(12, 980)), str(random.randint(3, 400)), str(random.randint(1, 90)), f'{random.randint(1, 99)}.{random.randint(100, 999)}$500'] for i, n in enumerate(names)]
    X = [.5 * dpi + c * dpi for c in [0, 1.6, 2.5, 3.7, 4.7, 5.9, 7.4]]; y0, rh = .8 * dpi, .32 * dpi
    for r, row in enumerate([head] + rows):
        for c, t in enumerate(row): d.text((X[c] + .08 * dpi, y0 + r * rh + .07 * dpi), t, font=fb if r == 0 else f, fill=25)
    if ruled:
        for r in range(len(rows) + 2): d.line([(X[0], y0 + r * rh), (X[-1], y0 + r * rh)], fill=40, width=2)
        for x in X: d.line([(x, y0), (x, y0 + (len(rows) + 1) * rh)], fill=40, width=2)
    json.dump([head] + rows, open(p(name + '.json'), 'w'), ensure_ascii=False)
    open(p(name + '.txt'), 'w', encoding='utf8').write('\n'.join(' '.join(r) for r in [head] + rows))
    img = img.rotate(.8, resample=Image.BICUBIC, fillcolor=255)
    a = np.clip(np.asarray(img).astype(np.float32) * .9 + np.random.normal(0, 7, (H, W)), 0, 255).astype(np.uint8)
    rgb = Image.merge('RGB', [Image.fromarray(np.clip(a.astype(int) + o, 0, 255).astype(np.uint8)) for o in (5, 0, -15)])
    save_scan(rgb.filter(ImageFilter.GaussianBlur(.5)), name, dpi, 70)


def report():
    """Three pages: running head and page number, a right-aligned date, centred headings, justified paragraphs with a
    first-line indent, a footnote mark, an indented quotation. Fonts are named (Helvetica, Times), not embedded."""
    from reportlab.lib.pagesizes import A4
    from reportlab.platypus import SimpleDocTemplate, Paragraph
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_JUSTIFY, TA_CENTER, TA_RIGHT
    lorem = 'The committee reviewed the budget for the coming year and found that most departments kept within their limits, although travel and printing costs rose faster than expected. '
    def hf(c, d):
        c.saveState(); c.setFont('Helvetica', 9); c.drawCentredString(A4[0] / 2, A4[1] - 40, 'Annual Report of the Library Society')
        c.drawCentredString(A4[0] / 2, 30, str(d.page)); c.restoreState()
    doc = SimpleDocTemplate(p('report.pdf'), pagesize=A4, leftMargin=90, rightMargin=70, topMargin=80, bottomMargin=70, invariant=1)
    body = ParagraphStyle('b', fontName='Times-Roman', fontSize=11, leading=15, alignment=TA_JUSTIFY, firstLineIndent=24, spaceBefore=6)
    h = ParagraphStyle('h', fontName='Helvetica-Bold', fontSize=16, leading=20, alignment=TA_CENTER, spaceBefore=18, spaceAfter=10)
    q = ParagraphStyle('q', parent=body, leftIndent=40, rightIndent=40, firstLineIndent=0, fontSize=10, leading=13)
    st = [Paragraph('Lisbon, 4 November 2026', ParagraphStyle('r', fontName='Times-Roman', fontSize=11, leading=15, alignment=TA_RIGHT))]
    for k in range(3):
        st.append(Paragraph(f'Chapter {k + 1}', h))
        for j in range(4): st.append(Paragraph(lorem * 3 + ('This figure<super>1</super> is provisional.' if j == 1 else ''), body))
        st.append(Paragraph(lorem * 2, q))
    doc.build(st, onFirstPage=hf, onLaterPages=hf)


def columns():
    """A heading across the page, then two columns of text."""
    from reportlab.lib.pagesizes import A4
    from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate, Paragraph, FrameBreak
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_JUSTIFY
    W, H = A4; m = 60; g = 20; cw = (W - 2 * m - g) / 2
    frames = [Frame(m, H - 140, W - 2 * m, 80, id='top'), Frame(m, m, cw, H - 200 - m, id='c1'), Frame(m + cw + g, m, cw, H - 200 - m, id='c2')]
    doc = BaseDocTemplate(p('columns.pdf'), pagesize=A4, pageTemplates=[PageTemplate(frames=frames)], invariant=1)
    body = ParagraphStyle('b', fontName='Times-Roman', fontSize=10, leading=13, alignment=TA_JUSTIFY, spaceBefore=5)
    words = ' '.join(TEXT)
    st = [Paragraph('Os arquivos da Inquisição', ParagraphStyle('h', fontName='Helvetica-Bold', fontSize=20, leading=24)), FrameBreak()]
    for k in range(6): st.append(Paragraph(words[k * 120: k * 120 + 700], body))
    doc.build(st)


def magazine():
    """A magazine spread: a tinted banner with a headline, a picture with a caption, three columns of different widths,
    a shaded sidebar box with its own text, and a large pull quote. The kind of page ABBYY keeps with text boxes."""
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas as rc
    from reportlab.lib.utils import ImageReader
    from reportlab.platypus import Paragraph, Frame
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_JUSTIFY, TA_CENTER
    W, H = A4; c = rc.Canvas(p('magazine.pdf'), pagesize=A4, invariant=1)
    c.setFillColorRGB(.85, .9, .97); c.rect(0, H - 150, W, 150, fill=1, stroke=0)
    c.setFillColorRGB(.1, .15, .35); c.setFont('Helvetica-Bold', 30); c.drawString(40, H - 80, 'Os arquivos da Torre do Tombo')
    c.setFont('Helvetica', 13); c.drawString(40, H - 110, 'Quatro séculos de processos, agora digitalizados')
    g = np.zeros((200, 300, 3), np.uint8); yy, xx = np.mgrid[0:200, 0:300]; g[..., 0] = 120 + xx * .4; g[..., 1] = 90 + yy * .5; g[..., 2] = 60
    c.drawImage(ImageReader(Image.fromarray(g)), 40, H - 400, 300, 200)
    c.setFillColorRGB(.3, .3, .3); c.setFont('Helvetica-Oblique', 8.5); c.drawString(40, H - 414, 'Sala de leitura, Lisboa. Fotografia de arquivo.')
    words = (' '.join(TEXT) + ' ') * 4; body = ParagraphStyle('b', fontName='Times-Roman', fontSize=9.5, leading=12, alignment=TA_JUSTIFY, spaceBefore=4)
    c.setFillColorRGB(.98, .94, .78); c.rect(360, H - 400, W - 400, 230, fill=1, stroke=0)
    side = ParagraphStyle('s', fontName='Helvetica', fontSize=9, leading=11.5)
    Frame(368, H - 395, W - 416, 215, showBoundary=0).addFromList([Paragraph('<b>Em números</b>', ParagraphStyle('sh', fontName='Helvetica-Bold', fontSize=11, leading=14)), Paragraph(words[2000:2400], side)], c)
    cols = [(40, 170, 40, 0, 950), (225, 150, 185, 950, 1400), (390, W - 430, 40, 1400, 2300)]
    for x, w, b, a, z in cols:
        Frame(x, b, w, H - 430 - b, showBoundary=0).addFromList([Paragraph(words[a:z].strip(), body)], c)
    c.setFillColorRGB(.85, .2, .1); c.rect(225, 170, 150, 2, fill=1, stroke=0)
    Frame(225, 100, 150, 70, showBoundary=0).addFromList([Paragraph('«Cada processo conta uma vida inteira»', ParagraphStyle('q', fontName='Times-Italic', fontSize=15, leading=18, alignment=TA_CENTER))], c)
    c.showPage(); c.save()


report(); columns(); magazine()
book_scan('book', 150, 3.5, 8, .8)
faded_scan('faded', 150, 165)
table_scan('table-ruled', True); table_scan('table-free', False)
print('fixtures written to', OUT)
