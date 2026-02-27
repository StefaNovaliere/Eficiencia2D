"""
DXF Writer

Generates AutoCAD-compatible DXF files for facades and component sheets.

Layers follow laser-cutter conventions:
  - CORTE   (color 7 / black) — cut lines (panel/polygon outlines)
  - MARCA   (color 1 / red)   — reference labels (A1, B2...), dimensions
  - GRABADO (color 5 / blue)  — titles, scale text, engrave marks
"""

from __future__ import annotations

from .types import ComponentSheet, Facade, Loop2D


def _header() -> str:
    return "\n".join([
        "0", "SECTION", "2", "HEADER",
        "9", "$ACADVER", "1", "AC1015",
        "9", "$INSUNITS", "70", "6",
        "0", "ENDSEC",
        # Tables -- layer definitions
        "0", "SECTION", "2", "TABLES",
        "0", "TABLE", "2", "LAYER", "70", "3",
        "0", "LAYER", "2", "CORTE",    "70", "0", "62", "7", "6", "CONTINUOUS",
        "0", "LAYER", "2", "MARCA",    "70", "0", "62", "1", "6", "CONTINUOUS",
        "0", "LAYER", "2", "GRABADO",  "70", "0", "62", "5", "6", "CONTINUOUS",
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
    """Generate a DXF file for a single facade with panel reference IDs."""
    s = 1.0 / scale_denom
    text_h = 0.15 * s
    out = _header()

    # Draw all polygons on CORTE layer (black = cut).
    for poly in facade.polygons:
        out += _polyline(poly, s, "CORTE")

        # Panel reference ID at centroid (red = mark).
        if poly.panel_id and poly.vertices:
            cx = sum(v.x for v in poly.vertices) / len(poly.vertices)
            cy = sum(v.y for v in poly.vertices) / len(poly.vertices)
            out += _text_entity(cx * s, cy * s, text_h, poly.panel_id, "MARCA")

    # Title above (blue = engrave).
    out += _text_entity(
        facade.width * 0.5 * s,
        (facade.height + 0.5) * s,
        text_h * 1.5,
        facade.label,
        "GRABADO",
    )

    # Width dimension below (red = mark).
    out += _text_entity(
        facade.width * 0.5 * s,
        -0.4 * s,
        text_h,
        f"{facade.width:.2f} m",
        "MARCA",
    )

    # Height dimension to the right (red = mark).
    out += _text_entity(
        (facade.width + 0.3) * s,
        facade.height * 0.5 * s,
        text_h,
        f"{facade.height:.2f} m",
        "MARCA",
    )

    out += _footer()
    return out


def generate_component_dxf(sheet: ComponentSheet, scale_denom: int) -> str:
    """Generate a DXF file for a component decomposition sheet.

    Each panel has:
      - Outline on CORTE layer (black = cut)
      - Reference ID above on MARCA layer (red = mark)
      - Dimensions below on MARCA layer (red = mark)
    """
    s = 1.0 / scale_denom
    text_h = 0.15 * s
    out = _header()

    for panel in sheet.panels:
        # Panel outline (black = cut).
        out += _polyline(panel.outline, s, "CORTE")

        if panel.outline.vertices:
            cx = sum(v.x for v in panel.outline.vertices) / len(panel.outline.vertices)
            max_y = max(v.y for v in panel.outline.vertices)
            min_y = min(v.y for v in panel.outline.vertices)

            # Reference ID above panel (red = mark).
            out += _text_entity(cx * s, (max_y + 0.1) * s, text_h, panel.ref_id, "MARCA")

            # Dimensions below panel (red = mark).
            dim_text = f"{panel.width:.2f} x {panel.height:.2f}"
            out += _text_entity(cx * s, (min_y - 0.15) * s, text_h * 0.8, dim_text, "MARCA")

    # Title above (blue = engrave).
    out += _text_entity(
        sheet.width * 0.5 * s,
        (sheet.height + 0.5) * s,
        text_h * 1.5,
        sheet.label,
        "GRABADO",
    )

    out += _footer()
    return out
