"""
PDF Writer — Python port of src/core/pdf-writer.ts.

Generates a minimal, self-contained PDF from projected Wall[] data.
No external dependencies -- writes raw PDF operators.

Paper sizes: A3 (420x297 mm), A1 (841x594 mm).
Walls are drawn with solid strokes; openings with dashes.
Dimension annotations use built-in Helvetica.
"""

from __future__ import annotations

from .types import Wall

PAPERS: dict[str, tuple[float, float]] = {
    "A3": (420, 297),
    "A1": (841, 594),
}

MM_TO_PT = 72 / 25.4


def _m_to_pts(m: float, scale_denom: int) -> float:
    return (m / scale_denom) * 1000 * MM_TO_PT


def _build_content(walls: list[Wall], scale_denom: int, paper: str) -> str:
    w_mm, h_mm = PAPERS.get(paper, PAPERS["A3"])
    page_h = h_mm * MM_TO_PT
    margin = 30.0
    gap = _m_to_pts(1.5, scale_denom)

    cs = ""
    cursor_x = margin
    font_size = 8

    for wall in walls:
        w_pts = _m_to_pts(wall.width, scale_denom)
        h_pts = _m_to_pts(wall.height, scale_denom)
        base_y = (page_h - h_pts) / 2

        def tx(vx: float) -> float:
            return cursor_x + _m_to_pts(vx, scale_denom)

        def ty(vy: float) -> float:
            return base_y + _m_to_pts(vy, scale_denom)

        # Outer boundary (solid).
        cs += "0.3 w\n"
        ov = wall.outer.vertices
        if ov:
            cs += f"{tx(ov[0].x):.4f} {ty(ov[0].y):.4f} m\n"
            for i in range(1, len(ov)):
                cs += f"{tx(ov[i].x):.4f} {ty(ov[i].y):.4f} l\n"
            cs += "s\n"

        # Openings (dashed).
        cs += "[4 2] 0 d\n"
        for opening in wall.openings:
            iv = opening.vertices
            if not iv:
                continue
            cs += f"{tx(iv[0].x):.4f} {ty(iv[0].y):.4f} m\n"
            for i in range(1, len(iv)):
                cs += f"{tx(iv[i].x):.4f} {ty(iv[i].y):.4f} l\n"
            cs += "s\n"
        cs += "[] 0 d\n"

        # Wall label.
        cs += "BT\n"
        cs += f"/F1 {font_size} Tf\n"
        cs += f"{cursor_x + w_pts / 2:.2f} {base_y + h_pts + 12:.2f} Td\n"
        cs += f"({wall.label}) Tj\n"
        cs += "ET\n"

        # Width dimension.
        cs += "BT\n"
        cs += f"/F1 {font_size} Tf\n"
        cs += f"{cursor_x + w_pts / 2:.2f} {base_y - 14:.2f} Td\n"
        cs += f"({wall.width:.2f} m) Tj\n"
        cs += "ET\n"

        # Height dimension.
        cs += "BT\n"
        cs += f"/F1 {font_size} Tf\n"
        cs += f"{cursor_x + w_pts + 6:.2f} {base_y + h_pts / 2:.2f} Td\n"
        cs += f"({wall.height:.2f} m) Tj\n"
        cs += "ET\n"

        cursor_x += w_pts + gap

    return cs


def generate_pdf(walls: list[Wall], scale_denom: int, paper: str) -> str:
    w_mm, h_mm = PAPERS.get(paper, PAPERS["A3"])
    pw = f"{w_mm * MM_TO_PT:.2f}"
    ph = f"{h_mm * MM_TO_PT:.2f}"

    content = _build_content(walls, scale_denom, paper)

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

    # Object 2: Pages
    offsets.append(cursor)
    emit("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n")

    # Object 3: Page
    offsets.append(cursor)
    emit(
        f"3 0 obj\n<< /Type /Page /Parent 2 0 R "
        f"/MediaBox [0 0 {pw} {ph}] "
        f"/Contents 4 0 R "
        f"/Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n"
    )

    # Object 4: Content stream
    offsets.append(cursor)
    emit(
        f"4 0 obj\n<< /Length {len(content)} >>\n"
        f"stream\n{content}endstream\nendobj\n"
    )

    # Object 5: Font
    offsets.append(cursor)
    emit("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n")

    # Xref
    xref_off = cursor
    emit(f"xref\n0 {len(offsets) + 1}\n")
    emit("0000000000 65535 f \n")
    for off in offsets:
        emit(f"{off:010d} 00000 n \n")

    # Trailer
    emit(f"trailer\n<< /Size {len(offsets) + 1} /Root 1 0 R >>\n")
    emit(f"startxref\n{xref_off}\n%%EOF\n")

    return "".join(parts)
