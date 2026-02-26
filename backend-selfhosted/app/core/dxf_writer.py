"""
DXF Writer

Generates AutoCAD-compatible DXF files for facades and floor plans.
Polygons are drawn on the "FACADE" layer, wall segments on "WALLS",
and dimension annotations on the "DIMENSIONS" layer.
"""

from __future__ import annotations

from .types import ComponentSheet, Facade, FloorPlan, Loop2D, Segment2D


def _header() -> str:
    return "\n".join([
        "0", "SECTION", "2", "HEADER",
        "9", "$ACADVER", "1", "AC1015",
        "9", "$INSUNITS", "70", "6",
        "0", "ENDSEC",
        # Tables -- layer definitions
        "0", "SECTION", "2", "TABLES",
        "0", "TABLE", "2", "LAYER", "70", "3",
        "0", "LAYER", "2", "FACADE",     "70", "0", "62", "7",  "6", "CONTINUOUS",
        "0", "LAYER", "2", "WALLS",      "70", "0", "62", "5",  "6", "CONTINUOUS",
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


def _line_entity(x1: float, y1: float, x2: float, y2: float, layer: str) -> str:
    return "\n".join([
        "0", "LINE",
        "8", layer,
        "10", str(x1),
        "20", str(y1),
        "11", str(x2),
        "21", str(y2),
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


def generate_component_dxf(sheet: ComponentSheet, scale_denom: int) -> str:
    """Generate a DXF file for a component decomposition sheet."""
    s = 1.0 / scale_denom
    text_h = 0.15 * s
    out = _header()

    # Draw all component polygons.
    for comp in sheet.components:
        out += _polyline(comp, s, "FACADE")

    # Title above.
    out += _text_entity(
        sheet.width * 0.5 * s,
        (sheet.height + 0.5) * s,
        text_h * 1.5,
        sheet.label,
        "DIMENSIONS",
    )

    # Width dimension below.
    out += _text_entity(
        sheet.width * 0.5 * s,
        -0.4 * s,
        text_h,
        f"{sheet.width:.2f} m",
        "DIMENSIONS",
    )

    # Height dimension to the right.
    out += _text_entity(
        (sheet.width + 0.3) * s,
        sheet.height * 0.5 * s,
        text_h,
        f"{sheet.height:.2f} m",
        "DIMENSIONS",
    )

    out += _footer()
    return out


def generate_plan_dxf(plan: FloorPlan, scale_denom: int) -> str:
    """Generate a DXF file for a floor plan (top-down view)."""
    s = 1.0 / scale_denom
    text_h = 0.15 * s
    out = _header()

    # Draw all wall segments.
    for seg in plan.segments:
        out += _line_entity(
            seg.a.x * s, seg.a.y * s,
            seg.b.x * s, seg.b.y * s,
            "WALLS",
        )

    # Title above.
    out += _text_entity(
        plan.width * 0.5 * s,
        (plan.height + 0.5) * s,
        text_h * 1.5,
        plan.label,
        "DIMENSIONS",
    )

    # Width dimension below.
    out += _text_entity(
        plan.width * 0.5 * s,
        -0.4 * s,
        text_h,
        f"{plan.width:.2f} m",
        "DIMENSIONS",
    )

    # Height dimension to the right.
    out += _text_entity(
        (plan.width + 0.3) * s,
        plan.height * 0.5 * s,
        text_h,
        f"{plan.height:.2f} m",
        "DIMENSIONS",
    )

    out += _footer()
    return out
