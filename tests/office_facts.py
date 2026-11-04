# Reads a .docx, .xlsx or .pptx written by Quire and prints facts about it as JSON, for run.js to check.
import json, sys, zipfile


def docx(path):
    import docx as D
    d = D.Document(path); s = d.sections[0]; xml = zipfile.ZipFile(path).read('word/document.xml').decode('utf8')
    footer = zipfile.ZipFile(path).read('word/footer1.xml').decode('utf8') if 'word/footer1.xml' in zipfile.ZipFile(path).namelist() else ''
    ps = [p for p in d.paragraphs if p.text.strip()]
    al = lambda p: str(p.alignment).split('.')[-1].split(' ')[0] if p.alignment is not None else 'LEFT'
    return {
        'paragraphs': len(ps),
        'justified': sum(al(p) == 'JUSTIFY' for p in ps),
        'centered': sum(al(p) == 'CENTER' for p in ps),
        'right': sum(al(p) == 'RIGHT' for p in ps),
        'firstLineIndent': sum(1 for p in ps if p.paragraph_format.first_line_indent and p.paragraph_format.first_line_indent.pt > 5),
        'rightIndent': sum(1 for p in ps if p.paragraph_format.right_indent and p.paragraph_format.right_indent.pt > 5),
        'superscript': sum(1 for p in ps for r in p.runs if r.font.superscript),
        'header': ' '.join(p.text for p in s.header.paragraphs).strip(),
        'footerPageField': ' PAGE ' in footer,
        'leftMargin': round(s.left_margin.pt) if s.left_margin else None,
        'columns': max([int(x) for x in __import__('re').findall(r'<w:cols w:num="(\d)"', xml)] or [1]),
        'fonts': sorted({r.font.name for p in ps for r in p.runs if r.font.name}),
        'headings': sum(1 for p in ps if p.style.name.startswith('Heading')),
        'text': '\n'.join(p.text for p in ps),
    }


def xlsx(path):
    import openpyxl
    ws = openpyxl.load_workbook(path).active
    return {'rows': [[('' if c.value is None else str(c.value)) for c in row] for row in ws.iter_rows()]}


def pptx(path):
    from pptx import Presentation
    from pptx.enum.shapes import MSO_SHAPE_TYPE
    p = Presentation(path); sl = list(p.slides)
    return {'slides': len(sl), 'width': p.slide_width.pt, 'height': p.slide_height.pt,
            'textBoxes': [sum(1 for sh in s.shapes if sh.has_text_frame and sh.text_frame.text.strip()) for s in sl],
            'pictures': [sum(1 for sh in s.shapes if sh.shape_type == MSO_SHAPE_TYPE.PICTURE) for s in sl],
            'centered': sum(1 for s in sl for sh in s.shapes if sh.has_text_frame for q in sh.text_frame.paragraphs if q.alignment is not None and 'CENTER' in str(q.alignment)),
            'text': '\n'.join(sh.text_frame.text for s in sl for sh in s.shapes if sh.has_text_frame)}


f = sys.argv[1]
print(json.dumps(docx(f) if f.endswith('.docx') else pptx(f) if f.endswith('.pptx') else xlsx(f), ensure_ascii=False))
