"""
Cutting Sheet Generator (Plancha de Corte)

Generates laser-cutter-ready DXF files from decomposed building components.
One DXF is produced per material group (walls, floors), each containing all
panels of that type packed onto a 2D plane with separation gaps.

Layers (laser-cutter conventions):
  - CORTE   (color 1 / red)  — exterior contours: lines the machine will cut
  - GRABADO (color 5 / blue) — reference labels at each piece's centroid
                                (engraved, not cut through)

Requires ``ezdxf``.
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field

from .types import PanelInfo

# ---------------------------------------------------------------------------
# Layout constants (all in mm)
# ---------------------------------------------------------------------------

PIECE_GAP_MM = 5.0   # separation between pieces (prevents overlap/kerf issues)


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class PlacedPiece:
    """A piece positioned at (x, y) on the cutting layout, in mm."""
    ref_id: str
    x: float          # bottom-left X
    y: float          # bottom-left Y
    width_mm: float
    height_mm: float


@dataclass
class CuttingLayout:
    """All placed pieces for one material group, laid out on a 2D plane."""
    label: str                                    # e.g. "Corte Paredes"
    pieces: list[PlacedPiece] = field(default_factory=list)
    total_width: float = 0.0                      # bounding width of layout
    total_height: float = 0.0                     # bounding height of layout


# ---------------------------------------------------------------------------
# Shelf-based strip packing (Shelf First-Fit Decreasing Height)
# ---------------------------------------------------------------------------

def _shelf_pack(
    items: list[tuple[str, float, float]],
    gap: float,
    max_row_width: float = 0.0,
) -> list[PlacedPiece]:
    """Pack rectangular items onto an unbounded 2D plane using a shelf algorithm.

    Each item is ``(ref_id, width_mm, height_mm)``.

    If *max_row_width* is 0 the row width is auto-calculated as twice the
    sum of all item widths divided by sqrt(count), giving a roughly square
    layout.

    Returns a list of :class:`PlacedPiece` with assigned (x, y) positions.
    """
    if not items:
        return []

    # Sort tallest-first for better shelf utilisation.
    items_sorted = sorted(items, key=lambda t: t[2], reverse=True)

    # Auto row width: aim for a roughly square overall layout.
    if max_row_width <= 0:
        total_w = sum(w for _, w, _ in items_sorted)
        n = len(items_sorted)
        avg_w = total_w / n if n else 1.0
        cols = max(1, int(n ** 0.5))
        max_row_width = cols * avg_w + (cols - 1) * gap

    placed: list[PlacedPiece] = []
    cursor_x = 0.0
    cursor_y = 0.0
    shelf_h = 0.0  # tallest piece in the current row

    for ref_id, w, h in items_sorted:
        if w < 0.1 or h < 0.1:
            continue

        # If piece doesn't fit in this row, start a new shelf row.
        if cursor_x > 0 and cursor_x + w > max_row_width:
            cursor_y += shelf_h + gap
            cursor_x = 0.0
            shelf_h = 0.0

        placed.append(PlacedPiece(
            ref_id=ref_id,
            x=cursor_x,
            y=cursor_y,
            width_mm=w,
            height_mm=h,
        ))

        cursor_x += w + gap
        shelf_h = max(shelf_h, h)

    return placed


# ---------------------------------------------------------------------------
# Public API — build a CuttingLayout from PanelInfo list
# ---------------------------------------------------------------------------

def build_cutting_layout(
    panels: list[PanelInfo],
    label: str,
    scale_denom: int,
    gap_mm: float = PIECE_GAP_MM,
) -> CuttingLayout | None:
    """Convert model-unit panels to mm at the given scale and pack them.

    Parameters
    ----------
    panels : list[PanelInfo]
        Panels already classified by type (all walls or all floors).
    label : str
        Human-readable category label (e.g. "Corte Paredes").
    scale_denom : int
        Drawing scale denominator (50 → 1:50, 100 → 1:100).
    gap_mm : float
        Minimum gap between pieces in mm.

    Returns
    -------
    CuttingLayout or None
        ``None`` when there are no valid panels to pack.
    """
    if not panels:
        return None

    # Model-units (metres) → mm at drawing scale.
    # At 1:100, 1 m model → 10 mm on sheet.
    # At 1:50,  1 m model → 20 mm on sheet.
    factor = 1000.0 / scale_denom

    items: list[tuple[str, float, float]] = []
    for p in panels:
        w_mm = p.width * factor
        h_mm = p.height * factor
        if w_mm < 1.0 or h_mm < 1.0:
            continue  # sub-millimetre — skip
        items.append((p.ref_id, w_mm, h_mm))

    if not items:
        return None

    placed = _shelf_pack(items, gap=gap_mm)

    if not placed:
        return None

    # Compute bounding box of the full layout.
    total_w = max(pc.x + pc.width_mm for pc in placed)
    total_h = max(pc.y + pc.height_mm for pc in placed)

    return CuttingLayout(
        label=label,
        pieces=placed,
        total_width=total_w,
        total_height=total_h,
    )


# ---------------------------------------------------------------------------
# DXF generation
# ---------------------------------------------------------------------------

def generate_cutting_dxf(layout: CuttingLayout) -> str:
    """Generate a laser-cutter-ready DXF for one material group.

    Layers
    ------
    CORTE   (red  / ACI 1)  — piece outlines (cut lines).
    GRABADO (blue / ACI 5)  — reference IDs at each piece centroid (engraved).
    """
    import ezdxf
    from ezdxf.enums import TextEntityAlignment

    doc = ezdxf.new("R2010")
    msp = doc.modelspace()

    # --- Layers ---
    doc.layers.add("CORTE", color=1)       # red — cut lines
    doc.layers.add("GRABADO", color=5)     # blue — engrave / labels

    # --- Pieces ---
    for piece in layout.pieces:
        x, y = piece.x, piece.y
        w, h = piece.width_mm, piece.height_mm

        # Exterior contour on CORTE (red) — rectangle for each panel.
        msp.add_lwpolyline(
            [(x, y), (x + w, y), (x + w, y + h), (x, y + h)],
            close=True,
            dxfattribs={"layer": "CORTE"},
        )

        # Reference label at centroid on GRABADO (blue).
        cx = x + w / 2.0
        cy = y + h / 2.0
        label_h = min(4.0, max(1.5, min(w, h) * 0.15))

        t = msp.add_text(
            piece.ref_id,
            height=label_h,
            dxfattribs={"layer": "GRABADO"},
        )
        t.set_placement((cx, cy), align=TextEntityAlignment.MIDDLE_CENTER)

    # --- Title above layout ---
    title_h = 5.0
    title_y = layout.total_height + title_h + 2.0
    tt = msp.add_text(
        layout.label,
        height=title_h,
        dxfattribs={"layer": "GRABADO"},
    )
    tt.set_placement(
        (layout.total_width / 2.0, title_y),
        align=TextEntityAlignment.BOTTOM_CENTER,
    )

    # --- Scale / units note below layout ---
    note = f"Unidades: mm  |  Escala aplicada al layout"
    sn = msp.add_text(
        note,
        height=2.5,
        dxfattribs={"layer": "GRABADO"},
    )
    sn.set_placement(
        (layout.total_width / 2.0, -6.0),
        align=TextEntityAlignment.TOP_CENTER,
    )

    # --- Write to string ---
    stream = io.StringIO()
    doc.write(stream)
    return stream.getvalue()
