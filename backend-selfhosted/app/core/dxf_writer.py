"""
DXF Writer

Generates an AutoCAD-compatible DXF file for a single facade.
Each polygon from the facade is drawn on the "FACADE" layer.
Dimension annotations go on the "DIMENSIONS" layer.
"""

from __future__ import annotations

from .types import Facade, Loop2D


def _header() -> str:
    return "\n".join([
        "0", "SECTION", "2", "HEADER",
        "9", "$ACADVER", "1", "AC1015",
        "9", "$INSUNITS", "70", "6",
        "0", "ENDSEC",
        # Tables -- layer definitions
        "0", "SECTION", "2", "TABLES",
        "0", "TABLE", "2", "LAYER", "70", "2",
        "0", "LAYER", "2", "FACADE",     "70", "0", "62", "7",  "6", "CONTINUOUS",
        "0", "LAYER", "2", "DIMENSIONS", "70", "0", "62", "3",  "6", "CONTINUOUS",
        "0", "ENDTAB",
        "0", "ENDSEC",
        # Begin entities
        "0", "SECTION", "2", "ENTITIES",
    ]) + "\n"


def _footer() -> str:
    return "0\nENDSEC\n0\nEOF\n"


def _polyline(loop: Loop2D, s: float, layer: str) -> str:
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
        lines.append(str(v.x * s))
        lines.append("20")
        lines.append(str(v.y * s))
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


def generate_dxf(facade: Facade, scale_denom: int) -> str:
    """Generate a DXF file for a single facade."""
    s = 1.0 / scale_denom
    text_h = 0.15 * s
    out = _header()

    # Draw all polygons.
    for poly in facade.polygons:
        out += _polyline(poly, s, "FACADE")

    # Title above.
    out += _text_entity(
        facade.width * 0.5 * s,
        (facade.height + 0.5) * s,
        text_h * 1.5,
        facade.label,
        "DIMENSIONS",
    )

    # Width dimension below.
    out += _text_entity(
        facade.width * 0.5 * s,
        -0.4 * s,
        text_h,
        f"{facade.width:.2f} m",
        "DIMENSIONS",
    )

    # Height dimension to the right.
    out += _text_entity(
        (facade.width + 0.3) * s,
        facade.height * 0.5 * s,
        text_h,
        f"{facade.height:.2f} m",
        "DIMENSIONS",
    )

    out += _footer()
    return out
