"""
DXF Writer — Python port of src/core/dxf-writer.ts.

Generates an AutoCAD-compatible DXF file from projected Wall[] data.
Walls go on the "WALLS" layer, openings on "OPENINGS" (dashed),
and dimension annotations on "DIMENSIONS".
"""

from __future__ import annotations

from .types import Loop2D, Wall

GAP_M = 2.0


def _header() -> str:
    return "\n".join([
        "0", "SECTION", "2", "HEADER",
        "9", "$ACADVER", "1", "AC1015",
        "9", "$INSUNITS", "70", "6",
        "0", "ENDSEC",
        # Tables -- layer definitions
        "0", "SECTION", "2", "TABLES",
        "0", "TABLE", "2", "LAYER", "70", "3",
        "0", "LAYER", "2", "WALLS",      "70", "0", "62", "7",  "6", "CONTINUOUS",
        "0", "LAYER", "2", "OPENINGS",   "70", "0", "62", "1",  "6", "DASHED",
        "0", "LAYER", "2", "DIMENSIONS", "70", "0", "62", "3",  "6", "CONTINUOUS",
        "0", "ENDTAB",
        "0", "ENDSEC",
        # Begin entities
        "0", "SECTION", "2", "ENTITIES",
    ]) + "\n"


def _footer() -> str:
    return "0\nENDSEC\n0\nEOF\n"


def _polyline(loop: Loop2D, ox: float, oy: float, s: float, layer: str) -> str:
    if not loop.vertices:
        return ""
    lines = [
        "0", "LWPOLYLINE",
        "8", layer,
        "90", str(len(loop.vertices)),
        "70", "1",  # closed
    ]
    for v in loop.vertices:
        lines.append("10")
        lines.append(str((v.x + ox) * s))
        lines.append("20")
        lines.append(str((v.y + oy) * s))
    return "\n".join(lines) + "\n"


def _text_entity(x: float, y: float, h: float, text: str, layer: str) -> str:
    return "\n".join([
        "0", "TEXT",
        "8", layer,
        "10", str(x),
        "20", str(y),
        "40", str(h),
        "1", text,
        "72", "1",  # center-aligned
        "11", str(x),
        "21", str(y),
    ]) + "\n"


def generate_dxf(walls: list[Wall], scale_denom: int) -> str:
    s = 1.0 / scale_denom
    text_h = 0.15 * s
    out = _header()
    ox = 0.0

    for wall in walls:
        # Outer boundary.
        out += _polyline(wall.outer, ox, 0, s, "WALLS")

        # Openings.
        for opening in wall.openings:
            out += _polyline(opening, ox, 0, s, "OPENINGS")

        # Dimension: width below.
        out += _text_entity(
            (ox + wall.width * 0.5) * s,
            -0.4 * s,
            text_h,
            f"{wall.width:.2f} m",
            "DIMENSIONS",
        )

        # Dimension: height to the right.
        out += _text_entity(
            (ox + wall.width + 0.3) * s,
            wall.height * 0.5 * s,
            text_h,
            f"{wall.height:.2f} m",
            "DIMENSIONS",
        )

        # Wall label above.
        out += _text_entity(
            (ox + wall.width * 0.5) * s,
            (wall.height + 0.3) * s,
            text_h,
            wall.label,
            "DIMENSIONS",
        )

        ox += wall.width + GAP_M

    out += _footer()
    return out
