"""
PDF Writer

Generates a multi-page PDF where each page is one facade elevation.
No external dependencies -- writes raw PDF operators.

Paper sizes: A3 (420x297 mm), A1 (841x594 mm).
Facade polygons are drawn with solid strokes.
Title and dimension annotations use built-in Helvetica.
"""

from __future__ import annotations

from .types import Facade, FloorPlan

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

    # Compute scale: fit the facade into the printable area.
    avail_w = page_w - 2 * margin
    avail_h = page_h - 2 * margin - 30  # reserve space for title

    # Scale from model units to PDF points using the drawing scale.
    def m_to_pts(m: float) -> float:
        return (m / scale_denom) * 1000 * MM_TO_PT

    facade_w_pts = m_to_pts(facade.width)
    facade_h_pts = m_to_pts(facade.height)

    # If the facade doesn't fit at the requested scale, shrink to fit.
    fit_scale = 1.0
    if facade_w_pts > avail_w and facade_w_pts > 0:
        fit_scale = min(fit_scale, avail_w / facade_w_pts)
    if facade_h_pts > avail_h and facade_h_pts > 0:
        fit_scale = min(fit_scale, avail_h / facade_h_pts)

    effective_w = facade_w_pts * fit_scale
    effective_h = facade_h_pts * fit_scale

    # Center on page.
    ox = (page_w - effective_w) / 2
    oy = margin + (avail_h - effective_h) / 2

    def tx(vx: float) -> float:
        return ox + m_to_pts(vx) * fit_scale

    def ty(vy: float) -> float:
        return oy + m_to_pts(vy) * fit_scale

    cs = ""

    # Draw all facade polygons.
    cs += "0.4 w\n"
    for poly in facade.polygons:
        verts = poly.vertices
        if len(verts) < 3:
            continue
        cs += f"{tx(verts[0].x):.4f} {ty(verts[0].y):.4f} m\n"
        for i in range(1, len(verts)):
            cs += f"{tx(verts[i].x):.4f} {ty(verts[i].y):.4f} l\n"
        cs += "s\n"

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


def _build_plan_content(plan: FloorPlan, scale_denom: int, paper: str) -> str:
    """Build the PDF content stream for the floor plan page."""
    w_mm, h_mm = PAPERS.get(paper, PAPERS["A3"])
    page_w = w_mm * MM_TO_PT
    page_h = h_mm * MM_TO_PT
    margin = 40.0
    font_size = 10

    avail_w = page_w - 2 * margin
    avail_h = page_h - 2 * margin - 30

    def m_to_pts(m: float) -> float:
        return (m / scale_denom) * 1000 * MM_TO_PT

    plan_w_pts = m_to_pts(plan.width)
    plan_h_pts = m_to_pts(plan.height)

    fit_scale = 1.0
    if plan_w_pts > avail_w and plan_w_pts > 0:
        fit_scale = min(fit_scale, avail_w / plan_w_pts)
    if plan_h_pts > avail_h and plan_h_pts > 0:
        fit_scale = min(fit_scale, avail_h / plan_h_pts)

    effective_w = plan_w_pts * fit_scale
    effective_h = plan_h_pts * fit_scale

    ox = (page_w - effective_w) / 2
    oy = margin + (avail_h - effective_h) / 2

    def tx(vx: float) -> float:
        return ox + m_to_pts(vx) * fit_scale

    def ty(vy: float) -> float:
        return oy + m_to_pts(vy) * fit_scale

    cs = ""

    # Draw all wall segments as lines.
    cs += "0.6 w\n"
    for seg in plan.segments:
        cs += f"{tx(seg.a.x):.4f} {ty(seg.a.y):.4f} m\n"
        cs += f"{tx(seg.b.x):.4f} {ty(seg.b.y):.4f} l\n"
        cs += "S\n"

    # Title above the drawing.
    cs += "BT\n"
    cs += f"/F1 {font_size + 2} Tf\n"
    cs += f"{page_w / 2:.2f} {oy + effective_h + 16:.2f} Td\n"
    cs += f"({plan.label}) Tj\n"
    cs += "ET\n"

    # Width dimension below.
    cs += "BT\n"
    cs += f"/F1 {font_size} Tf\n"
    cs += f"{page_w / 2:.2f} {oy - 16:.2f} Td\n"
    cs += f"({plan.width:.2f} m) Tj\n"
    cs += "ET\n"

    # Height dimension to the right.
    cs += "BT\n"
    cs += f"/F1 {font_size} Tf\n"
    cs += f"{ox + effective_w + 8:.2f} {oy + effective_h / 2:.2f} Td\n"
    cs += f"({plan.height:.2f} m) Tj\n"
    cs += "ET\n"

    # Scale annotation.
    cs += "BT\n"
    cs += f"/F1 {font_size - 2} Tf\n"
    cs += f"{page_w - margin:.2f} {margin / 2:.2f} Td\n"
    if fit_scale < 0.999:
        cs += f"(Escala: ajustada para caber en {paper}) Tj\n"
    else:
        cs += f"(Escala: 1:{scale_denom}) Tj\n"
    cs += "ET\n"

    return cs


def generate_pdf(facades: list[Facade], scale_denom: int, paper: str,
                 floor_plan: FloorPlan | None = None) -> str:
    """Generate a multi-page PDF, one page per facade + optional floor plan."""
    w_mm, h_mm = PAPERS.get(paper, PAPERS["A3"])
    pw = f"{w_mm * MM_TO_PT:.2f}"
    ph = f"{h_mm * MM_TO_PT:.2f}"

    # Build content streams for each page.
    page_contents: list[str] = []

    # Floor plan page first (if available).
    if floor_plan is not None:
        page_contents.append(_build_plan_content(floor_plan, scale_denom, paper))

    # Then one page per facade.
    for facade in facades:
        page_contents.append(_build_page_content(facade, scale_denom, paper))

    num_pages = len(page_contents)

    # Build the PDF structure.
    parts: list[str] = []
    offsets: list[int] = []
    cursor = 0

    def emit(s: str) -> None:
        nonlocal cursor
        parts.append(s)
        cursor += len(s)

    emit("%PDF-1.4\n")

    # Object 1: Catalog
    offsets.append(cursor)
    emit("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")

    # Object 2: Pages (parent of all page objects)
    # Page objects start at obj 4, each page takes 2 objects (Page + Stream).
    # Font is at obj 3.
    page_obj_ids = [4 + i * 2 for i in range(num_pages)]
    kids = " ".join(f"{pid} 0 R" for pid in page_obj_ids)
    offsets.append(cursor)
    emit(f"2 0 obj\n<< /Type /Pages /Kids [{kids}] /Count {num_pages} >>\nendobj\n")

    # Object 3: Font
    offsets.append(cursor)
    emit("3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n")

    # Page objects: each page = Page object + Content stream object.
    for i in range(num_pages):
        page_id = 4 + i * 2
        stream_id = page_id + 1
        content = page_contents[i]

        # Page object
        offsets.append(cursor)
        emit(
            f"{page_id} 0 obj\n<< /Type /Page /Parent 2 0 R "
            f"/MediaBox [0 0 {pw} {ph}] "
            f"/Contents {stream_id} 0 R "
            f"/Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n"
        )

        # Content stream
        offsets.append(cursor)
        emit(
            f"{stream_id} 0 obj\n<< /Length {len(content)} >>\n"
            f"stream\n{content}endstream\nendobj\n"
        )

    # Xref
    total_objs = len(offsets) + 1  # +1 for obj 0
    xref_off = cursor
    emit(f"xref\n0 {total_objs}\n")
    emit("0000000000 65535 f \n")
    for off in offsets:
        emit(f"{off:010d} 00000 n \n")

    # Trailer
    emit(f"trailer\n<< /Size {total_objs} /Root 1 0 R >>\n")
    emit(f"startxref\n{xref_off}\n%%EOF\n")

    return "".join(parts)
