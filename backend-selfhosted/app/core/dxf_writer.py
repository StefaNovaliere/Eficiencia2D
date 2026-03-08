"""
DXF Writer

Generates AutoCAD-compatible DXF files using ``ezdxf`` for facades
and component decomposition sheets.

Using ezdxf guarantees structurally valid DXF (proper header, tables,
entities section, and EOF).

Layers follow laser-cutter conventions:
  - CORTE   (color 1 / red)   — cut lines (panel/polygon outlines)
  - GRABADO (color 5 / blue)  — titles, scale text, engrave marks
  - MARCA   (color 7 / black) — reference labels (A1, B2...), dimensions
"""

from __future__ import annotations

import io

import ezdxf
from ezdxf.enums import TextEntityAlignment

from .floor_plan_extractor import FloorPlan
from .types import ComponentSheet, Facade


def _new_doc() -> ezdxf.document.Drawing:
    """Create a new DXF R2010 document with laser-cutter layers."""
    doc = ezdxf.new("R2010")
    doc.layers.add("CORTE", color=1)       # red — cut lines
    doc.layers.add("GRABADO", color=5)     # blue — engrave / titles
    doc.layers.add("MARCA", color=7)       # black — marks / labels / dimensions
    return doc


def _doc_to_string(doc: ezdxf.document.Drawing) -> str:
    """Serialize an ezdxf document to a DXF text string."""
    stream = io.StringIO()
    doc.write(stream)
    return stream.getvalue()


# ---------------------------------------------------------------------------
# Facade DXF
# ---------------------------------------------------------------------------

def generate_dxf(facade: Facade, scale_denom: int) -> str:
    """Generate a valid DXF file for a single facade elevation."""
    s = 1.0 / scale_denom
    text_h = 2.5 / 1000.0  # 2.5 mm expressed in meters (DXF model-space units)

    doc = _new_doc()
    msp = doc.modelspace()

    # Draw all polygon outlines on CORTE layer.
    for poly in facade.polygons:
        if not poly.vertices or len(poly.vertices) < 3:
            continue
        pts = [(v.x * s, v.y * s) for v in poly.vertices]
        msp.add_lwpolyline(pts, close=True, dxfattribs={"layer": "CORTE", "color": 1})

    # Panel reference IDs: one label per unique panel_id.
    # Group polygons by panel_id and compute combined bounding box.
    panel_groups: dict[str, tuple[float, float, float, float]] = {}
    for poly in facade.polygons:
        if not poly.panel_id:
            continue
        xs = [v.x for v in poly.vertices]
        ys = [v.y for v in poly.vertices]
        pid = poly.panel_id
        if pid not in panel_groups:
            panel_groups[pid] = (min(xs), min(ys), max(xs), max(ys))
        else:
            old = panel_groups[pid]
            panel_groups[pid] = (
                min(old[0], min(xs)),
                min(old[1], min(ys)),
                max(old[2], max(xs)),
                max(old[3], max(ys)),
            )

    for pid, (x0, y0, x1, y1) in panel_groups.items():
        pw = (x1 - x0) * s
        ph = (y1 - y0) * s
        if pw > 0.005 and ph > 0.005:
            cx = (x0 + x1) / 2 * s
            cy = (y0 + y1) / 2 * s
            lh = min(text_h, min(pw, ph) * 0.3)
            t = msp.add_text(
                pid, height=lh,
                dxfattribs={"layer": "MARCA", "color": 7},
            )
            t.set_placement((cx, cy), align=TextEntityAlignment.MIDDLE_CENTER)

    # Title above drawing on GRABADO.
    t = msp.add_text(
        facade.label, height=text_h * 1.5,
        dxfattribs={"layer": "GRABADO", "color": 5},
    )
    t.set_placement(
        (facade.width * 0.5 * s, (facade.height + 0.5) * s),
        align=TextEntityAlignment.BOTTOM_CENTER,
    )

    # Width dimension below on MARCA.
    t = msp.add_text(
        f"{facade.width:.2f} m", height=text_h,
        dxfattribs={"layer": "MARCA", "color": 7},
    )
    t.set_placement(
        (facade.width * 0.5 * s, -0.4 * s),
        align=TextEntityAlignment.TOP_CENTER,
    )

    # Height dimension to the right on MARCA.
    t = msp.add_text(
        f"{facade.height:.2f} m", height=text_h,
        dxfattribs={"layer": "MARCA", "color": 7},
    )
    t.set_placement(
        ((facade.width + 0.3) * s, facade.height * 0.5 * s),
        align=TextEntityAlignment.MIDDLE_LEFT,
    )

    return _doc_to_string(doc)


# ---------------------------------------------------------------------------
# Component-sheet DXF (decomposition)
# ---------------------------------------------------------------------------

def generate_component_dxf(sheet: ComponentSheet, scale_denom: int) -> str:
    """Generate a valid DXF file for a component decomposition sheet."""
    s = 1.0 / scale_denom
    text_h = 2.5 / 1000.0

    doc = _new_doc()
    msp = doc.modelspace()

    for panel in sheet.panels:
        if not panel.outline.vertices:
            continue

        # Panel outline on CORTE.
        pts = [(v.x * s, v.y * s) for v in panel.outline.vertices]
        msp.add_lwpolyline(pts, close=True, dxfattribs={"layer": "CORTE", "color": 1})

        verts = panel.outline.vertices
        cx = sum(v.x for v in verts) / len(verts) * s
        max_y = max(v.y for v in verts) * s
        min_y = min(v.y for v in verts) * s
        panel_h_dxf = max_y - min_y

        lh = min(text_h, max(text_h * 0.5, panel_h_dxf * 0.12))

        # Reference ID above panel on MARCA.
        t = msp.add_text(
            panel.ref_id, height=lh,
            dxfattribs={"layer": "MARCA", "color": 7},
        )
        t.set_placement(
            (cx, max_y + 0.15 * s),
            align=TextEntityAlignment.BOTTOM_CENTER,
        )

        # Dimensions below panel on MARCA.
        dim_text = f"{panel.width:.2f} x {panel.height:.2f}"
        t = msp.add_text(
            dim_text, height=lh * 0.8,
            dxfattribs={"layer": "MARCA", "color": 7},
        )
        t.set_placement(
            (cx, min_y - 0.25 * s),
            align=TextEntityAlignment.TOP_CENTER,
        )

    # Title above on GRABADO.
    t = msp.add_text(
        sheet.label, height=text_h * 1.5,
        dxfattribs={"layer": "GRABADO", "color": 5},
    )
    t.set_placement(
        (sheet.width * 0.5 * s, (sheet.height + 0.5) * s),
        align=TextEntityAlignment.BOTTOM_CENTER,
    )

    return _doc_to_string(doc)


# ---------------------------------------------------------------------------
# Floor plan DXF (horizontal section cuts)
# ---------------------------------------------------------------------------

def generate_floor_plan_dxf(plan: FloorPlan, scale_denom: int) -> str:
    """Generate a valid DXF file for a floor plan (horizontal section cut)."""
    s = 1.0 / scale_denom
    text_h = 2.5 / 1000.0

    doc = _new_doc()
    msp = doc.modelspace()

    # Draw wall-cut line segments on CORTE layer.
    for seg_a, seg_b in plan.segments:
        msp.add_line(
            (seg_a.x * s, seg_a.y * s),
            (seg_b.x * s, seg_b.y * s),
            dxfattribs={"layer": "CORTE", "color": 1},
        )

    # Title above the drawing on GRABADO.
    t = msp.add_text(
        plan.label, height=text_h * 1.5,
        dxfattribs={"layer": "GRABADO", "color": 5},
    )
    t.set_placement(
        (plan.width * 0.5 * s, (plan.height + 0.5) * s),
        align=TextEntityAlignment.BOTTOM_CENTER,
    )

    # Width dimension below on MARCA.
    t = msp.add_text(
        f"{plan.width:.2f} m", height=text_h,
        dxfattribs={"layer": "MARCA", "color": 7},
    )
    t.set_placement(
        (plan.width * 0.5 * s, -0.4 * s),
        align=TextEntityAlignment.TOP_CENTER,
    )

    # Height dimension to the right on MARCA.
    t = msp.add_text(
        f"{plan.height:.2f} m", height=text_h,
        dxfattribs={"layer": "MARCA", "color": 7},
    )
    t.set_placement(
        ((plan.width + 0.3) * s, plan.height * 0.5 * s),
        align=TextEntityAlignment.MIDDLE_LEFT,
    )

    return _doc_to_string(doc)
