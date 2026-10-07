#!/usr/bin/env python3
"""Overlay fillable fields on the MAX Cheer Music 8-count sheet."""
from pathlib import Path
import fitz

ROOT = Path(__file__).resolve().parents[1]
BASE = Path(__file__).resolve().parent / "count-sheet-base.pdf"
OUT = ROOT / "assets" / "max-count-sheets.pdf"
PAD = 1.2


def box(x0, y0, x1, y1):
    return fitz.Rect(x0 + PAD, y0 + PAD, x1 - PAD, y1 - PAD)


def add_text(page, name, rect, size=7):
    widget = fitz.Widget()
    widget.field_name = name
    widget.field_type = fitz.PDF_WIDGET_TYPE_TEXT
    widget.rect = rect
    widget.field_value = ""
    widget.text_fontsize = size
    widget.text_color = (0, 0, 0)
    widget.fill_color = (1, 1, 1)
    widget.border_width = 0
    widget.text_font = "Helv"
    page.add_widget(widget)


def add_grid(page, start_eight, rows, top, bottom, skip=None):
    skip = skip or set()
    section_x0, section_x1 = 50.4, 126.36
    counts_x0, counts_x1 = 148.78, 562.22
    row_h = (bottom - top) / rows
    col_w = (counts_x1 - counts_x0) / 8
    for i in range(rows):
        eight = start_eight + i
        y0 = top + i * row_h
        y1 = y0 + row_h
        if eight != 1:
            add_text(page, f"section_{eight}", box(section_x0, y0, section_x1, y1), 7)
        for col in range(1, 9):
            if (eight, col) in skip:
                continue
            x0 = counts_x0 + (col - 1) * col_w
            x1 = x0 + col_w
            add_text(page, f"r{eight}_c{col}", box(x0, y0, x1, y1), 6)


def main():
    doc = fitz.open(BASE)
    page1, page2 = doc[0], doc[1]

    add_text(page1, "team_name", box(303.82, 100.08, 562.22, 123.11), 10)
    add_grid(page1, 1, 23, 192.23, 722.11)
    add_grid(page2, 24, 24, 54.0, 606.92, skip={(47, 1)})

    try:
        doc.set_need_appearances(True)
    except AttributeError:
        try:
            doc.need_appearances = True
        except Exception:
            pass
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc.save(OUT, garbage=4, deflate=True)
    print(f"widgets {sum(1 for p in doc for _ in (p.widgets() or []))}")
    print(f"form {doc.is_form_pdf} -> {OUT}")
    doc.close()


if __name__ == "__main__":
    main()
