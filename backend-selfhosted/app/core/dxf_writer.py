"""
DXF Writer

Generates AutoCAD-compatible DXF files using ``ezdxf`` for facades,
component decomposition sheets, and floor plans.

Using ezdxf guarantees structurally valid DXF (proper header, tables,
entities section, and EOF).

Layers follow professional laser-cutter conventions with exact RGB True
Color (requires DXF R2004 / AC1018 or later):

  Layer order    Layer name       RGB exact      Operation
  1 (first)      CUT_INTERIOR     #00FF00        Interior cuts (holes, mortises)
  2              ENGRAVE_VECTOR   #0000FF        Vector engraving (marks, dims)
  3              ENGRAVE_RASTER   #000000        Raster engraving (piece numbers)
  4 (last)       CUT_EXTERIOR     #FF0000        Exterior contour cut
  (extra)        ABERTURAS        ACI 8          Door arcs & leaves (dashed)

True Color is set both on the layer AND on each entity to guarantee
correct color in Autodesk Viewer, LightBurn, and RDWorks.
"""

from __future__ import annotations

import io

import ezdxf
import ezdxf.colors
from ezdxf.enums import TextEntityAlignment

from .floor_plan_extractor import FloorPlan
from .types import ComponentSheet, Facade

# ---------------------------------------------------------------------------
# True Color constants (24-bit RGB as ezdxf integer)
# ---------------------------------------------------------------------------
_COLOR_CUT_INT = ezdxf.colors.rgb2int((0, 255, 0))       # Green
_COLOR_ENGRAVE_VEC = ezdxf.colors.rgb2int((0, 0, 255))    # Blue
_COLOR_ENGRAVE_RAS = ezdxf.colors.rgb2int((0, 0, 0))      # Black
_COLOR_CUT_EXT = ezdxf.colors.rgb2int((255, 0, 0))        # Red


def _new_doc() -> ezdxf.document.Drawing:
    """Create a new DXF R2010 document with 4-layer laser-cutter protocol."""
    doc = ezdxf.new("R2010")

    # Add DASHED linetype (if not already present).
    if "DASHED" not in doc.linetypes:
        doc.linetypes.add("DASHED", pattern=[0.005, 0.003, -0.002],
                          description="Dashed __ __ __")

    # Layer 1: CUT_INTERIOR (green) — interior cuts first
    layer_ci = doc.layers.add("CUT_INTERIOR")
    layer_ci.color = 3
    layer_ci.dxf.true_color = _COLOR_CUT_INT
    layer_ci.dxf.lineweight = 5

    # Layer 2: ENGRAVE_VECTOR (blue) — vector engraving
    layer_ev = doc.layers.add("ENGRAVE_VECTOR")
    layer_ev.color = 5
    layer_ev.dxf.true_color = _COLOR_ENGRAVE_VEC
    layer_ev.dxf.lineweight = 5

    # Layer 3: ENGRAVE_RASTER (black) — raster engraving (text)
    layer_er = doc.layers.add("ENGRAVE_RASTER")
    layer_er.color = 7
    layer_er.dxf.true_color = _COLOR_ENGRAVE_RAS

    # Layer 4: CUT_EXTERIOR (red) — exterior cut last
    layer_ce = doc.layers.add("CUT_EXTERIOR")
    layer_ce.color = 1
    layer_ce.dxf.true_color = _COLOR_CUT_EXT
    layer_ce.dxf.lineweight = 5

    # Extra: ABERTURAS — door symbols (kept for floor plans)
    doc.layers.add("ABERTURAS", color=8, linetype="DASHED")

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

    # Draw all polygon outlines on CUT_EXTERIOR (red).
    for poly in facade.polygons:
        if not poly.vertices or len(poly.vertices) < 3:
            continue
        pts = [(v.x * s, v.y * s) for v in poly.vertices]
        e = msp.add_lwpolyline(pts, close=True,
                               dxfattribs={"layer": "CUT_EXTERIOR"})
        e.dxf.true_color = _COLOR_CUT_EXT

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
                dxfattribs={"layer": "ENGRAVE_RASTER"},
            )
            t.set_placement((cx, cy), align=TextEntityAlignment.MIDDLE_CENTER)
            t.dxf.true_color = _COLOR_ENGRAVE_RAS

    # Title above drawing on ENGRAVE_VECTOR (blue).
    t = msp.add_text(
        facade.label, height=text_h * 1.5,
        dxfattribs={"layer": "ENGRAVE_VECTOR"},
    )
    t.set_placement(
        (facade.width * 0.5 * s, (facade.height + 0.5) * s),
        align=TextEntityAlignment.BOTTOM_CENTER,
    )
    t.dxf.true_color = _COLOR_ENGRAVE_VEC

    # Width dimension below on ENGRAVE_VECTOR (blue).
    t = msp.add_text(
        f"{facade.width:.2f} m", height=text_h,
        dxfattribs={"layer": "ENGRAVE_VECTOR"},
    )
    t.set_placement(
        (facade.width * 0.5 * s, -0.4 * s),
        align=TextEntityAlignment.TOP_CENTER,
    )
    t.dxf.true_color = _COLOR_ENGRAVE_VEC

    # Height dimension to the right on ENGRAVE_VECTOR (blue).
    t = msp.add_text(
        f"{facade.height:.2f} m", height=text_h,
        dxfattribs={"layer": "ENGRAVE_VECTOR"},
    )
    t.set_placement(
        ((facade.width + 0.3) * s, facade.height * 0.5 * s),
        align=TextEntityAlignment.MIDDLE_LEFT,
    )
    t.dxf.true_color = _COLOR_ENGRAVE_VEC

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

        # Panel outline on CUT_EXTERIOR (red).
        pts = [(v.x * s, v.y * s) for v in panel.outline.vertices]
        e = msp.add_lwpolyline(pts, close=True,
                               dxfattribs={"layer": "CUT_EXTERIOR"})
        e.dxf.true_color = _COLOR_CUT_EXT

        verts = panel.outline.vertices
        cx = sum(v.x for v in verts) / len(verts) * s
        max_y = max(v.y for v in verts) * s
        min_y = min(v.y for v in verts) * s
        panel_h_dxf = max_y - min_y

        lh = min(text_h, max(text_h * 0.5, panel_h_dxf * 0.12))

        # Reference ID above panel on ENGRAVE_RASTER (black).
        t = msp.add_text(
            panel.ref_id, height=lh,
            dxfattribs={"layer": "ENGRAVE_RASTER"},
        )
        t.set_placement(
            (cx, max_y + 0.15 * s),
            align=TextEntityAlignment.BOTTOM_CENTER,
        )
        t.dxf.true_color = _COLOR_ENGRAVE_RAS

        # Dimensions below panel on ENGRAVE_VECTOR (blue).
        dim_text = f"{panel.width:.2f} x {panel.height:.2f}"
        t = msp.add_text(
            dim_text, height=lh * 0.8,
            dxfattribs={"layer": "ENGRAVE_VECTOR"},
        )
        t.set_placement(
            (cx, min_y - 0.25 * s),
            align=TextEntityAlignment.TOP_CENTER,
        )
        t.dxf.true_color = _COLOR_ENGRAVE_VEC

    # Title above on ENGRAVE_VECTOR (blue).
    t = msp.add_text(
        sheet.label, height=text_h * 1.5,
        dxfattribs={"layer": "ENGRAVE_VECTOR"},
    )
    t.set_placement(
        (sheet.width * 0.5 * s, (sheet.height + 0.5) * s),
        align=TextEntityAlignment.BOTTOM_CENTER,
    )
    t.dxf.true_color = _COLOR_ENGRAVE_VEC

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

    # Draw wall-cut line segments on CUT_EXTERIOR (red).
    for seg_a, seg_b in plan.segments:
        ln = msp.add_line(
            (seg_a.x * s, seg_a.y * s),
            (seg_b.x * s, seg_b.y * s),
            dxfattribs={"layer": "CUT_EXTERIOR"},
        )
        ln.dxf.true_color = _COLOR_CUT_EXT

    # --- Door symbols on ABERTURAS layer ---
    for door in plan.doors:
        # Door leaf line (solid — from hinge to open position).
        msp.add_line(
            (door.hinge.x * s, door.hinge.y * s),
            (door.leaf_end.x * s, door.leaf_end.y * s),
            dxfattribs={"layer": "ABERTURAS", "color": 8, "linetype": "CONTINUOUS"},
        )

        # Swing arc (dashed quarter-circle).
        msp.add_arc(
            center=(door.hinge.x * s, door.hinge.y * s),
            radius=door.width * s,
            start_angle=door.start_angle,
            end_angle=door.end_angle,
            dxfattribs={"layer": "ABERTURAS", "color": 8, "linetype": "DASHED"},
        )

    # Title above the drawing on ENGRAVE_VECTOR (blue).
    t = msp.add_text(
        plan.label, height=text_h * 1.5,
        dxfattribs={"layer": "ENGRAVE_VECTOR"},
    )
    t.set_placement(
        (plan.width * 0.5 * s, (plan.height + 0.5) * s),
        align=TextEntityAlignment.BOTTOM_CENTER,
    )
    t.dxf.true_color = _COLOR_ENGRAVE_VEC

    # Width dimension below on ENGRAVE_VECTOR (blue).
    t = msp.add_text(
        f"{plan.width:.2f} m", height=text_h,
        dxfattribs={"layer": "ENGRAVE_VECTOR"},
    )
    t.set_placement(
        (plan.width * 0.5 * s, -0.4 * s),
        align=TextEntityAlignment.TOP_CENTER,
    )
    t.dxf.true_color = _COLOR_ENGRAVE_VEC

    # Height dimension to the right on ENGRAVE_VECTOR (blue).
    t = msp.add_text(
        f"{plan.height:.2f} m", height=text_h,
        dxfattribs={"layer": "ENGRAVE_VECTOR"},
    )
    t.set_placement(
        ((plan.width + 0.3) * s, plan.height * 0.5 * s),
        align=TextEntityAlignment.MIDDLE_LEFT,
    )
    t.dxf.true_color = _COLOR_ENGRAVE_VEC

    return _doc_to_string(doc)
