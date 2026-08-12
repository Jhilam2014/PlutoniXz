from pathlib import Path
from xml.sax.saxutils import escape
from docx import Document
from docx.table import Table as DocxTable
from docx.text.paragraph import Paragraph as DocxParagraph
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, PageBreak,
    Table, TableStyle, KeepTogether, ListFlowable, ListItem
)

ROOT = Path(__file__).resolve().parent
NAVY = colors.HexColor("#12233F")
BLUE = colors.HexColor("#2563EB")
TEAL = colors.HexColor("#0F766E")
INK = colors.HexColor("#172033")
MUTED = colors.HexColor("#64748B")
LIGHT = colors.HexColor("#F8FAFC")


def iter_blocks(doc):
    for child in doc.element.body.iterchildren():
        if child.tag.endswith("}p"):
            yield DocxParagraph(child, doc)
        elif child.tag.endswith("}tbl"):
            yield DocxTable(child, doc)


def has_page_break(paragraph):
    return bool(paragraph._p.xpath('.//w:br[@w:type="page"]'))


def rich_text(paragraph):
    parts = []
    for run in paragraph.runs:
        text = escape(run.text).replace("\n", "<br/>")
        if not text:
            continue
        if run.bold:
            text = f"<b>{text}</b>"
        if run.italic:
            text = f"<i>{text}</i>"
        parts.append(text)
    return "".join(parts) or escape(paragraph.text)


def build_styles():
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="BXBody", fontName="Helvetica", fontSize=9.7, leading=13.1, textColor=INK, spaceAfter=6))
    styles.add(ParagraphStyle(name="BXTitle", fontName="Helvetica-Bold", fontSize=27, leading=31, textColor=NAVY, spaceAfter=8))
    styles.add(ParagraphStyle(name="BXSubtitle", fontName="Helvetica", fontSize=12.5, leading=17, textColor=MUTED, spaceAfter=16))
    styles.add(ParagraphStyle(name="BXH1", fontName="Helvetica-Bold", fontSize=16, leading=20, textColor=NAVY, spaceBefore=12, spaceAfter=7, keepWithNext=True))
    styles.add(ParagraphStyle(name="BXH2", fontName="Helvetica-Bold", fontSize=12.5, leading=16, textColor=BLUE, spaceBefore=9, spaceAfter=5, keepWithNext=True))
    styles.add(ParagraphStyle(name="BXH3", fontName="Helvetica-Bold", fontSize=10.5, leading=14, textColor=TEAL, spaceBefore=7, spaceAfter=4, keepWithNext=True))
    styles.add(ParagraphStyle(name="BXBullet", parent=styles["BXBody"], leftIndent=16, firstLineIndent=0, spaceAfter=3))
    styles.add(ParagraphStyle(name="BXCell", fontName="Helvetica", fontSize=8.2, leading=10.6, textColor=INK))
    styles.add(ParagraphStyle(name="BXCellBold", fontName="Helvetica-Bold", fontSize=8.2, leading=10.6, textColor=INK))
    styles.add(ParagraphStyle(name="BXCellHead", fontName="Helvetica-Bold", fontSize=8.2, leading=10.4, textColor=colors.white))
    return styles


def draw_header_footer(canvas, doc):
    canvas.saveState()
    width, height = letter
    canvas.setStrokeColor(colors.HexColor("#D9E2EF"))
    canvas.setLineWidth(0.5)
    canvas.line(0.78 * inch, height - 0.48 * inch, width - 0.78 * inch, height - 0.48 * inch)
    canvas.setFont("Helvetica-Bold", 7.8)
    canvas.setFillColor(BLUE)
    canvas.drawString(0.82 * inch, height - 0.38 * inch, "PLUTONIX")
    canvas.setFont("Helvetica", 7.6)
    canvas.setFillColor(MUTED)
    canvas.drawRightString(width - 0.82 * inch, 0.38 * inch, f"Prepared 5 July 2026  |  Page {doc.page}")
    canvas.restoreState()


def table_from_docx(table, styles, available_width):
    raw = []
    for r_idx, row in enumerate(table.rows):
        values = []
        for c_idx, cell in enumerate(row.cells):
            style = styles["BXCellHead"] if r_idx == 0 else styles["BXCellBold"] if c_idx == 0 else styles["BXCell"]
            values.append(Paragraph(escape(cell.text).replace("\n", "<br/>"), style))
        raw.append(values)
    cols = len(raw[0]) if raw else 1
    if cols == 2:
        widths = [available_width * 0.26, available_width * 0.74]
    elif cols == 3:
        widths = [available_width * 0.24, available_width * 0.25, available_width * 0.51]
    else:
        widths = [available_width / cols] * cols
    t = Table(raw, colWidths=widths, repeatRows=1, hAlign="LEFT", splitByRow=True)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.45, colors.HexColor("#CBD5E1")),
        ("BACKGROUND", (0, 1), (-1, -1), colors.white),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return [t, Spacer(1, 7)]


def convert(source, target):
    source_doc = Document(source)
    styles = build_styles()
    pdf = BaseDocTemplate(
        str(target), pagesize=letter,
        leftMargin=0.82 * inch, rightMargin=0.82 * inch,
        topMargin=0.68 * inch, bottomMargin=0.62 * inch,
        title=source.stem, author="PlutoniX",
    )
    frame = Frame(pdf.leftMargin, pdf.bottomMargin, pdf.width, pdf.height, id="main")
    pdf.addPageTemplates([PageTemplate(id="plutonix", frames=[frame], onPage=draw_header_footer)])
    story = []
    pending_bullets = []
    pending_numbers = []

    def flush_lists():
        nonlocal pending_bullets, pending_numbers
        if pending_bullets:
            items = [ListItem(Paragraph(text, styles["BXBody"]), leftIndent=10) for text in pending_bullets]
            story.append(ListFlowable(items, bulletType="bullet", start="circle", leftIndent=18, bulletFontName="Helvetica", bulletFontSize=7, spaceAfter=5))
            pending_bullets = []
        if pending_numbers:
            items = [ListItem(Paragraph(text, styles["BXBody"]), leftIndent=10) for text in pending_numbers]
            story.append(ListFlowable(items, bulletType="1", leftIndent=20, bulletFontName="Helvetica-Bold", bulletFontSize=8.5, spaceAfter=5))
            pending_numbers = []

    for block in iter_blocks(source_doc):
        if isinstance(block, DocxTable):
            flush_lists()
            story.extend(table_from_docx(block, styles, pdf.width))
            continue
        if has_page_break(block):
            flush_lists()
            story.append(PageBreak())
            continue
        text = rich_text(block).strip()
        if not text:
            continue
        style_name = block.style.name if block.style else "Normal"
        if style_name == "List Bullet":
            pending_bullets.append(text)
            continue
        if style_name == "List Number":
            pending_numbers.append(text)
            continue
        flush_lists()
        style = {
            "Title": "BXTitle", "Subtitle": "BXSubtitle",
            "Heading 1": "BXH1", "Heading 2": "BXH2", "Heading 3": "BXH3"
        }.get(style_name, "BXBody")
        story.append(Paragraph(text, styles[style]))
    flush_lists()
    pdf.build(story)


if __name__ == "__main__":
    pairs = [
        (ROOT / "PlutoniX-Cloud-Hosting-Budget-Estimate.docx", ROOT / "PlutoniX-Cloud-Hosting-Budget-Estimate.pdf"),
        (ROOT / "How-PlutoniX-Builds-Applications.docx", ROOT / "How-PlutoniX-Builds-Applications.pdf"),
    ]
    for source, target in pairs:
        convert(source, target)
        print(target)
