"""
PDF Writer

Generates a multi-page PDF where each page is one facade elevation
with panel reference IDs (A1, A2..., B1, B2...).

Decomposition sheets are NOT included in the PDF — they live
in the DXF files and the cutting-sheet output.

No external dependencies -- writes raw PDF operators.

Paper sizes: A3 (420x297 mm), A1 (841x594 mm).
"""

from __future__ import annotations

from .types import Facade

PAPERS: dict[str, tuple[float, float]] = {
    "A3": (420, 297),
    "A1": (841, 594),
}

MM_TO_PT = 72 / 25.4


def _build_page_content(facade: Facade, scale_denom: int, paper: str) -> str:
    """Build the PDF content stream for one facade page."""
    w_mm, h_mm = PAPERS.get(paper, PAPERS["A3"])
    page_w = w_mm * MM_TO_PT
    page_h = h_mm * MM_TO_PT
    margin = 40.0
    font_size = 10

    avail_w = page_w - 2 * margin
    avail_h = page_h - 2 * margin - 30

    def m_to_pts(m: float) -> float:
        return (m / scale_denom) * 1000 * MM_TO_PT

    facade_w_pts = m_to_pts(facade.width)
    facade_h_pts = m_to_pts(facade.height)

    fit_scale = 1.0
    if facade_w_pts > avail_w and facade_w_pts > 0:
        fit_scale = min(fit_scale, avail_w / facade_w_pts)
    if facade_h_pts > avail_h and facade_h_pts > 0:
        fit_scale = min(fit_scale, avail_h / facade_h_pts)

    effective_w = facade_w_pts * fit_scale
    effective_h = facade_h_pts * fit_scale

    ox = (page_w - effective_w) / 2
    oy = margin + (avail_h - effective_h) / 2

    def tx(vx: float) -> float:
        return ox + m_to_pts(vx) * fit_scale

    def ty(vy: float) -> float:
        return oy + m_to_pts(vy) * fit_scale

    cs = ""

    # Draw all facade polygons (black outlines).
    cs += "0 0 0 RG\n"  # black stroke
    cs += "0.4 w\n"
    for poly in facade.polygons:
        verts = poly.vertices
        if len(verts) < 3:
            continue
        cs += f"{tx(verts[0].x):.4f} {ty(verts[0].y):.4f} m\n"
        for i in range(1, len(verts)):
            cs += f"{tx(verts[i].x):.4f} {ty(verts[i].y):.4f} l\n"
        cs += "s\n"

        # Panel reference ID at centroid (red).
        # Only label polygons large enough to be readable.
        if poly.panel_id:
            xs = [tx(v.x) for v in verts]
            ys = [ty(v.y) for v in verts]
            poly_w_pt = max(xs) - min(xs)
            poly_h_pt = max(ys) - min(ys)
            if poly_w_pt > 8 and poly_h_pt > 8:
                cx = sum(xs) / len(xs)
                cy = sum(ys) / len(ys)
                label_size = min(font_size - 2, max(4, poly_h_pt * 0.2))
                cs += "BT\n"
                cs += f"/F1 {label_size:.1f} Tf\n"
                cs += "1 0 0 rg\n"  # red text
                cs += f"{cx:.2f} {cy:.2f} Td\n"
                cs += f"({poly.panel_id}) Tj\n"
                cs += "0 0 0 rg\n"  # reset to black
                cs += "ET\n"

    # Title above the drawing.
    cs += "BT\n"
    cs += f"/F1 {font_size + 2} Tf\n"
    cs += f"{page_w / 2:.2f} {oy + effective_h + 16:.2f} Td\n"
    cs += f"({facade.label}) Tj\n"
    cs += "ET\n"

    # Width dimension below.
    cs += "BT\n"
    cs += f"/F1 {font_size} Tf\n"
    cs += f"{page_w / 2:.2f} {oy - 16:.2f} Td\n"
    cs += f"({facade.width:.2f} m) Tj\n"
    cs += "ET\n"

    # Height dimension to the right.
    cs += "BT\n"
    cs += f"/F1 {font_size} Tf\n"
    cs += f"{ox + effective_w + 8:.2f} {oy + effective_h / 2:.2f} Td\n"
    cs += f"({facade.height:.2f} m) Tj\n"
    cs += "ET\n"

    # Scale annotation in bottom-right corner.
    cs += "BT\n"
    cs += f"/F1 {font_size - 2} Tf\n"
    cs += f"{page_w - margin:.2f} {margin / 2:.2f} Td\n"
    if fit_scale < 0.999:
        cs += f"(Escala: ajustada para caber en {paper}) Tj\n"
    else:
        cs += f"(Escala: 1:{scale_denom}) Tj\n"
    cs += "ET\n"

    return cs


def generate_pdf(
    facades: list[Facade],
    scale_denom: int,
    paper: str,
) -> str:
    """Generate a multi-page PDF with facade elevations only.

    Each facade gets one page with panel reference IDs shown in red.
    """
    w_mm, h_mm = PAPERS.get(paper, PAPERS["A3"])
    pw = f"{w_mm * MM_TO_PT:.2f}"
    ph = f"{h_mm * MM_TO_PT:.2f}"

    page_contents: list[str] = []

    for facade in facades:
        page_contents.append(_build_page_content(facade, scale_denom, paper))

    num_pages = len(page_contents)

    parts: list[str] = []
    offsets: list[int] = []
    cursor = 0

    def emit(s: str) -> None:
        nonlocal cursor
        parts.append(s)
        cursor += len(s)

    emit("%PDF-1.4\n")

    offsets.append(cursor)
    emit("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")

    page_obj_ids = [4 + i * 2 for i in range(num_pages)]
    kids = " ".join(f"{pid} 0 R" for pid in page_obj_ids)
    offsets.append(cursor)
    emit(f"2 0 obj\n<< /Type /Pages /Kids [{kids}] /Count {num_pages} >>\nendobj\n")

    offsets.append(cursor)
    emit("3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n")

    for i in range(num_pages):
        page_id = 4 + i * 2
        stream_id = page_id + 1
        content = page_contents[i]

        offsets.append(cursor)
        emit(
            f"{page_id} 0 obj\n<< /Type /Page /Parent 2 0 R "
            f"/MediaBox [0 0 {pw} {ph}] "
            f"/Contents {stream_id} 0 R "
            f"/Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n"
        )

        offsets.append(cursor)
        emit(
            f"{stream_id} 0 obj\n<< /Length {len(content)} >>\n"
            f"stream\n{content}endstream\nendobj\n"
        )

    total_objs = len(offsets) + 1
    xref_off = cursor
    emit(f"xref\n0 {total_objs}\n")
    emit("0000000000 65535 f \n")
    for off in offsets:
        emit(f"{off:010d} 00000 n \n")

    emit(f"trailer\n<< /Size {total_objs} /Root 1 0 R >>\n")
    emit(f"startxref\n{xref_off}\n%%EOF\n")

    return "".join(parts)
