#!/usr/bin/env python3
"""Build an aligned, fillable MAX Cheer Music 8-count sheet."""
from pathlib import Path
import fitz

ROOT = Path(__file__).resolve().parents[1]
LOGO = ROOT / "assets" / "max-logo.png"
OUT = ROOT / "assets" / "max-count-sheets.pdf"

PAGE = fitz.paper_rect("letter")
X0, X1 = 50.4, 562.22
SECTION_X1 = 126.36
NUM_X1 = 148.78
COL_W = (X1 - NUM_X1) / 8
ROW_H = 23.04
PAD = 1.05
LINE = 0.65

BLUE = (47 / 255, 107 / 255, 1.0)
BLUE_DEEP = (22 / 255, 54 / 255, 201 / 255)
WHITE = (1, 1, 1)
BLACK = (0, 0, 0)
INK = (0.07, 0.07, 0.07)


def inset(rect, pad=PAD):
    return fitz.Rect(rect.x0 + pad, rect.y0 + pad, rect.x1 - pad, rect.y1 - pad)


def add_text(page, name, rect, size=7):
    widget = fitz.Widget()
    widget.field_name = name
    widget.field_type = fitz.PDF_WIDGET_TYPE_TEXT
    widget.rect = inset(rect)
    widget.field_value = ""
    widget.text_fontsize = size
    widget.text_color = INK
    widget.fill_color = WHITE
    widget.border_width = 0
    widget.text_font = "Helv"
    page.add_widget(widget)


def xs():
    verts = [X0, SECTION_X1, NUM_X1]
    for i in range(1, 9):
        verts.append(NUM_X1 + i * COL_W)
    return verts


def count_rect(col, top, row):
    x0 = NUM_X1 + (col - 1) * COL_W
    y0 = top + row * ROW_H
    return fitz.Rect(x0, y0, x0 + COL_W, y0 + ROW_H)


def section_rect(top, row):
    y0 = top + row * ROW_H
    return fitz.Rect(X0, y0, SECTION_X1, y0 + ROW_H)


def draw_header(page, top):
    header = fitz.Rect(X0, top, X1, top + ROW_H)
    page.draw_rect(header, color=BLUE, fill=BLUE, width=0)
    num = fitz.Rect(SECTION_X1, top, NUM_X1, top + ROW_H)
    page.draw_rect(num, color=BLUE_DEEP, fill=BLUE_DEEP, width=0)
    page.insert_textbox(
        fitz.Rect(X0, top + 2, SECTION_X1, top + ROW_H - 1),
        "ROUTINE\nSECTION",
        fontsize=6.2,
        fontname="helv",
        align=fitz.TEXT_ALIGN_CENTER,
        color=WHITE,
    )
    for col in range(1, 9):
        r = count_rect(col, top, 0)
        page.insert_textbox(
            r,
            str(col),
            fontsize=9,
            fontname="hebo",
            align=fitz.TEXT_ALIGN_CENTER,
            color=WHITE,
        )
    return top + ROW_H


def draw_grid_lines(page, top, rows):
    bottom = top + rows * ROW_H
    for y in [top + i * ROW_H for i in range(rows + 1)]:
        page.draw_line(fitz.Point(X0, y), fitz.Point(X1, y), color=BLACK, width=LINE)
    for x in xs():
        page.draw_line(fitz.Point(x, top), fitz.Point(x, bottom), color=BLACK, width=LINE)


def add_grid(page, start_eight, rows, top, skip=None):
    skip = skip or set()
    # fill columns behind the lines
    page.draw_rect(fitz.Rect(X0, top, SECTION_X1, top + rows * ROW_H), color=WHITE, fill=WHITE, width=0)
    page.draw_rect(fitz.Rect(SECTION_X1, top, NUM_X1, top + rows * ROW_H), color=BLUE_DEEP, fill=BLUE_DEEP, width=0)
    page.draw_rect(fitz.Rect(NUM_X1, top, X1, top + rows * ROW_H), color=WHITE, fill=WHITE, width=0)

    for i in range(rows):
        eight = start_eight + i
        num = fitz.Rect(SECTION_X1, top + i * ROW_H, NUM_X1, top + (i + 1) * ROW_H)
        page.insert_textbox(
            num,
            str(eight),
            fontsize=8,
            fontname="hebo",
            align=fitz.TEXT_ALIGN_CENTER,
            color=WHITE,
        )
        if eight == 1:
            page.insert_textbox(
                section_rect(top, i),
                "MUSIC STARTS",
                fontsize=6.4,
                fontname="hebo",
                align=fitz.TEXT_ALIGN_CENTER,
                color=INK,
            )
        else:
            add_text(page, f"section_{eight}", section_rect(top, i), 7)

        for col in range(1, 9):
            if (eight, col) in skip:
                continue
            add_text(page, f"r{eight}_c{col}", count_rect(col, top, i), 6)

        if eight == 47:
            end = count_rect(1, top, i)
            page.draw_rect(end, color=BLACK, fill=BLACK, width=0)
            page.insert_textbox(
                end,
                "END",
                fontsize=7,
                fontname="hebo",
                align=fitz.TEXT_ALIGN_CENTER,
                color=WHITE,
            )

    draw_grid_lines(page, top, rows)


def draw_brand(page):
    if LOGO.exists():
        page.insert_image(fitz.Rect(X0, 54, 200.5, 169), filename=str(LOGO), keep_proportion=True)
    label = fitz.Rect(199.84, 99.45, 303.82, 123.11)
    field = fitz.Rect(303.82, 100.08, X1, 123.11)
    page.draw_rect(label, color=BLUE, fill=BLUE, width=0)
    page.draw_rect(field, color=BLACK, fill=WHITE, width=LINE)
    page.draw_rect(fitz.Rect(label.x0, label.y0, field.x1, field.y1), color=BLACK, width=LINE)
    page.insert_textbox(
        label,
        "TEAM NAME",
        fontsize=8,
        fontname="hebo",
        align=fitz.TEXT_ALIGN_CENTER,
        color=WHITE,
    )
    add_text(page, "team_name", field, 10)


def main():
    doc = fitz.open()
    doc.new_page(width=PAGE.width, height=PAGE.height)
    doc.new_page(width=PAGE.width, height=PAGE.height)
    page1, page2 = doc[0], doc[1]

    draw_brand(page1)
    header_top = 168.57
    data_top = draw_header(page1, header_top)
    add_grid(page1, 1, 23, data_top)

    data_top2 = draw_header(page2, 54.0)
    add_grid(page2, 24, 24, data_top2, skip={(47, 1)})

    try:
        doc.set_need_appearances(True)
    except AttributeError:
        try:
            doc.need_appearances = True
        except Exception:
            pass

    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc.save(OUT, garbage=4, deflate=True)
    widgets = sum(1 for p in doc for _ in (p.widgets() or []))
    print(f"widgets {widgets} form {doc.is_form_pdf} -> {OUT}")
    doc.close()


if __name__ == "__main__":
    main()
