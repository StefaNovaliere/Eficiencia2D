"""
Cutting Sheet Generator (Plancha de Corte)

Generates laser-cutter-ready DXF files from decomposed building components.
One DXF is produced per material group (walls, floors), each containing all
panels packed onto a 2D plane.

Layer system follows professional laser-cutter conventions with exact RGB
colors for automatic operation recognition:

  Layer order    Layer name       RGB exact      Operation
  1 (first)      CUT_INTERIOR     #00FF00        Interior cuts (holes, mortises)
  2              ENGRAVE_VECTOR   #0000FF        Vector engraving (marks, dims)
  3              ENGRAVE_RASTER   #000000        Raster engraving (piece numbers)
  4 (last)       CUT_EXTERIOR     #FF0000        Exterior contour cut

Line weights for cut layers: 0.01mm (ezdxf lineweight=1, in 1/100 mm units).

Requires ``ezdxf``.
"""

from __future__ import annotations

import io
import math
from dataclasses import dataclass, field

from .types import CuttingPiece, PanelInfo, Vec2
from .nesting import (
    CuttingLayout,
    PlacedPiece,
    bottom_left_fill,
    build_cutting_layout,
    SHEET_WIDTH_MM,
    SHEET_HEIGHT_MM,
    PIECE_GAP_MM,
)

# Re-export for backward compatibility.
__all__ = [
    "PlacedPiece",
    "CuttingLayout",
    "build_cutting_layout_legacy",
    "generate_cutting_dxf",
    "generate_cutting_dxf_legacy",
]

# ---------------------------------------------------------------------------
# Layout constants (all in mm)
# ---------------------------------------------------------------------------

PIECE_GAP_MM_LEGACY = 5.0  # Legacy gap for old PanelInfo-based pipeline


# ---------------------------------------------------------------------------
# Legacy shelf-pack (kept for backward compatibility with PanelInfo)
# ---------------------------------------------------------------------------

def _shelf_pack(
    items: list[tuple[str, float, float]],
    gap: float,
    max_row_width: float = 0.0,
) -> list[PlacedPiece]:
    """Pack rectangular items onto an unbounded 2D plane using a shelf algorithm.

    Each item is ``(ref_id, width_mm, height_mm)``.
    Legacy function kept for PanelInfo-based pipeline.
    """
    if not items:
        return []

    items_sorted = sorted(items, key=lambda t: t[2], reverse=True)

    if max_row_width <= 0:
        total_w = sum(w for _, w, _ in items_sorted)
        n = len(items_sorted)
        avg_w = total_w / n if n else 1.0
        cols = max(1, int(n ** 0.5))
        max_row_width = cols * avg_w + (cols - 1) * gap

    placed: list[PlacedPiece] = []
    cursor_x = 0.0
    cursor_y = 0.0
    shelf_h = 0.0

    for ref_id, w, h in items_sorted:
        if w < 0.1 or h < 0.1:
            continue
        if cursor_x > 0 and cursor_x + w > max_row_width:
            cursor_y += shelf_h + gap
            cursor_x = 0.0
            shelf_h = 0.0

        placed.append(PlacedPiece(
            ref_id=ref_id, x=cursor_x, y=cursor_y,
            width_mm=w, height_mm=h,
        ))
        cursor_x += w + gap
        shelf_h = max(shelf_h, h)

    return placed


def build_cutting_layout_legacy(
    panels: list[PanelInfo],
    label: str,
    scale_denom: int,
    gap_mm: float = PIECE_GAP_MM_LEGACY,
) -> CuttingLayout | None:
    """Legacy layout builder from PanelInfo (rectangular bounding boxes).

    Kept for backward compatibility — the new pipeline uses
    build_cutting_layout() from nesting.py with CuttingPiece.
    """
    if not panels:
        return None

    factor = 1000.0 / scale_denom

    items: list[tuple[str, float, float]] = []
    for p in panels:
        w_mm = p.width * factor
        h_mm = p.height * factor
        if w_mm < 1.0 or h_mm < 1.0:
            continue
        items.append((p.ref_id, w_mm, h_mm))

    if not items:
        return None

    placed = _shelf_pack(items, gap=gap_mm)
    if not placed:
        return None

    total_w = max(pc.x + pc.width_mm for pc in placed)
    total_h = max(pc.y + pc.height_mm for pc in placed)

    return CuttingLayout(
        label=label,
        pieces=placed,
        total_width=total_w,
        total_height=total_h,
    )


# ---------------------------------------------------------------------------
# DXF generation — NEW: 4 laser-cutter layers with exact RGB
# ---------------------------------------------------------------------------

def generate_cutting_dxf(
    layout: CuttingLayout,
    pieces_by_id: dict[str, CuttingPiece] | None = None,
) -> str:
    """Generate a laser-cutter-ready DXF with 4 color-coded layers.

    If pieces_by_id is provided, draws real contours with interior holes.
    Otherwise falls back to drawing simple rectangles (legacy mode).

    Layers (in order):
      1. CUT_INTERIOR    — green  #00FF00 — interior cuts (holes)
      2. ENGRAVE_VECTOR   — blue   #0000FF — reference marks
      3. ENGRAVE_RASTER   — black  #000000 — piece numbers (text)
      4. CUT_EXTERIOR     — red    #FF0000 — exterior contour
    """
    import ezdxf
    from ezdxf.enums import TextEntityAlignment

    doc = ezdxf.new("R2010")
    msp = doc.modelspace()

    # --- True Color constants (24-bit RGB integers) ---
    COLOR_CUT_INT = ezdxf.colors.rgb2int((0, 255, 0))       # Green
    COLOR_ENGRAVE_VEC = ezdxf.colors.rgb2int((0, 0, 255))    # Blue
    COLOR_ENGRAVE_RAS = ezdxf.colors.rgb2int((0, 0, 0))      # Black
    COLOR_CUT_EXT = ezdxf.colors.rgb2int((255, 0, 0))        # Red

    # --- Create layers in correct order (green → blue → black → red) ---
    # Layer 1: CUT_INTERIOR (green) — interior cuts first
    layer_ci = doc.layers.add("CUT_INTERIOR")
    layer_ci.color = 3  # ACI green as fallback
    layer_ci.dxf.true_color = COLOR_CUT_INT
    layer_ci.dxf.lineweight = 5  # 0.05mm — thinnest DXF standard lineweight

    # Layer 2: ENGRAVE_VECTOR (blue) — vector engraving
    layer_ev = doc.layers.add("ENGRAVE_VECTOR")
    layer_ev.color = 5  # ACI blue as fallback
    layer_ev.dxf.true_color = COLOR_ENGRAVE_VEC
    layer_ev.dxf.lineweight = 5  # 0.05mm

    # Layer 3: ENGRAVE_RASTER (black) — raster engraving (text)
    layer_er = doc.layers.add("ENGRAVE_RASTER")
    layer_er.color = 7  # ACI white/black as fallback
    layer_er.dxf.true_color = COLOR_ENGRAVE_RAS

    # Layer 4: CUT_EXTERIOR (red) — exterior cut last
    layer_ce = doc.layers.add("CUT_EXTERIOR")
    layer_ce.color = 1  # ACI red as fallback
    layer_ce.dxf.true_color = COLOR_CUT_EXT
    layer_ce.dxf.lineweight = 5  # 0.05mm

    # --- Draw pieces ---
    for placed in layout.pieces:
        x_off, y_off = placed.x, placed.y

        piece = None
        if pieces_by_id:
            piece = pieces_by_id.get(placed.ref_id)

        if piece and piece.outer_kerf:
            # --- Real contour mode ---

            # Interior cuts (holes) — green, CUT_INTERIOR (drawn FIRST)
            for inner_loop in piece.inner_kerf:
                if len(inner_loop) < 3:
                    continue
                pts = [(v.x + x_off, v.y + y_off) for v in inner_loop]
                poly = msp.add_lwpolyline(
                    pts, close=True,
                    dxfattribs={"layer": "CUT_INTERIOR"},
                )
                poly.dxf.lineweight = 5
                poly.dxf.true_color = COLOR_CUT_INT

            # Orientation mark — blue, ENGRAVE_VECTOR
            # Draw a small upward arrow at the top center of the piece.
            cx = x_off + piece.width_mm / 2.0
            top_y = y_off + piece.height_mm
            arrow_len = min(piece.height_mm * 0.08, 5.0)
            # Arrow shaft
            ln = msp.add_line(
                (cx, top_y - arrow_len * 1.5),
                (cx, top_y - arrow_len * 0.3),
                dxfattribs={"layer": "ENGRAVE_VECTOR"},
            )
            ln.dxf.true_color = COLOR_ENGRAVE_VEC
            # Arrow head (two short lines)
            head_w = arrow_len * 0.3
            ln = msp.add_line(
                (cx, top_y - arrow_len * 0.3),
                (cx - head_w, top_y - arrow_len * 0.8),
                dxfattribs={"layer": "ENGRAVE_VECTOR"},
            )
            ln.dxf.true_color = COLOR_ENGRAVE_VEC
            ln = msp.add_line(
                (cx, top_y - arrow_len * 0.3),
                (cx + head_w, top_y - arrow_len * 0.8),
                dxfattribs={"layer": "ENGRAVE_VECTOR"},
            )
            ln.dxf.true_color = COLOR_ENGRAVE_VEC

            # Piece number — black, ENGRAVE_RASTER (centered, 5mm height)
            cx = x_off + piece.width_mm / 2.0
            cy = y_off + piece.height_mm / 2.0
            text_h = min(5.0, min(piece.width_mm, piece.height_mm) * 0.15)
            t = msp.add_text(
                piece.ref_id,
                height=text_h,
                dxfattribs={"layer": "ENGRAVE_RASTER"},
            )
            t.set_placement((cx, cy), align=TextEntityAlignment.MIDDLE_CENTER)
            t.dxf.true_color = COLOR_ENGRAVE_RAS

            # Exterior contour — red, CUT_EXTERIOR (drawn LAST)
            pts = [(v.x + x_off, v.y + y_off) for v in piece.outer_kerf]
            poly = msp.add_lwpolyline(
                pts, close=True,
                dxfattribs={"layer": "CUT_EXTERIOR"},
            )
            poly.dxf.lineweight = 1
            poly.dxf.true_color = COLOR_CUT_EXT

        else:
            # --- Legacy rectangle mode (fallback) ---
            w, h = placed.width_mm, placed.height_mm

            # Exterior contour on CUT_EXTERIOR (red).
            poly = msp.add_lwpolyline(
                [(x_off, y_off), (x_off + w, y_off),
                 (x_off + w, y_off + h), (x_off, y_off + h)],
                close=True,
                dxfattribs={"layer": "CUT_EXTERIOR"},
            )
            poly.dxf.lineweight = 1
            poly.dxf.true_color = COLOR_CUT_EXT

            # Piece number on ENGRAVE_RASTER (black).
            cx = x_off + w / 2.0
            cy = y_off + h / 2.0
            text_h = min(5.0, max(1.5, min(w, h) * 0.15))
            t = msp.add_text(
                placed.ref_id,
                height=text_h,
                dxfattribs={"layer": "ENGRAVE_RASTER"},
            )
            t.set_placement((cx, cy), align=TextEntityAlignment.MIDDLE_CENTER)
            t.dxf.true_color = COLOR_ENGRAVE_RAS

    # --- Title above layout on ENGRAVE_VECTOR ---
    title_h = 5.0
    title_y = layout.total_height + title_h + 2.0
    tt = msp.add_text(
        layout.label,
        height=title_h,
        dxfattribs={"layer": "ENGRAVE_VECTOR"},
    )
    tt.set_placement(
        (layout.total_width / 2.0, title_y),
        align=TextEntityAlignment.BOTTOM_CENTER,
    )
    tt.dxf.true_color = COLOR_ENGRAVE_VEC

    # --- Scale / units note below layout on ENGRAVE_VECTOR ---
    note = "Unidades: mm  |  Escala 1:1"
    sn = msp.add_text(
        note,
        height=2.5,
        dxfattribs={"layer": "ENGRAVE_VECTOR"},
    )
    sn.set_placement(
        (layout.total_width / 2.0, -6.0),
        align=TextEntityAlignment.TOP_CENTER,
    )
    sn.dxf.true_color = COLOR_ENGRAVE_VEC

    # --- Write to string ---
    stream = io.StringIO()
    doc.write(stream)
    return stream.getvalue()


# ---------------------------------------------------------------------------
# Legacy DXF generation (old 2-layer format, kept for reference)
# ---------------------------------------------------------------------------

def generate_cutting_dxf_legacy(layout: CuttingLayout) -> str:
    """Generate a legacy 2-layer cutting DXF (CORTE + GRABADO).

    Kept for backward compatibility. New code should use
    generate_cutting_dxf() which produces 4 laser-cutter layers.
    """
    import ezdxf
    from ezdxf.enums import TextEntityAlignment

    doc = ezdxf.new("R2010")
    msp = doc.modelspace()

    doc.layers.add("CORTE", color=1)
    doc.layers.add("GRABADO", color=5)

    for piece in layout.pieces:
        x, y = piece.x, piece.y
        w, h = piece.width_mm, piece.height_mm

        msp.add_lwpolyline(
            [(x, y), (x + w, y), (x + w, y + h), (x, y + h)],
            close=True,
            dxfattribs={"layer": "CORTE", "color": 1},
        )

        cx = x + w / 2.0
        cy = y + h / 2.0
        label_h = min(4.0, max(1.5, min(w, h) * 0.15))
        t = msp.add_text(
            piece.ref_id,
            height=label_h,
            dxfattribs={"layer": "GRABADO", "color": 5},
        )
        t.set_placement((cx, cy), align=TextEntityAlignment.MIDDLE_CENTER)

    title_h = 5.0
    title_y = layout.total_height + title_h + 2.0
    tt = msp.add_text(
        layout.label,
        height=title_h,
        dxfattribs={"layer": "GRABADO", "color": 5},
    )
    tt.set_placement(
        (layout.total_width / 2.0, title_y),
        align=TextEntityAlignment.BOTTOM_CENTER,
    )

    note = "Unidades: mm  |  Escala aplicada al layout"
    sn = msp.add_text(
        note,
        height=2.5,
        dxfattribs={"layer": "GRABADO", "color": 5},
    )
    sn.set_placement(
        (layout.total_width / 2.0, -6.0),
        align=TextEntityAlignment.TOP_CENTER,
    )

    stream = io.StringIO()
    doc.write(stream)
    return stream.getvalue()
