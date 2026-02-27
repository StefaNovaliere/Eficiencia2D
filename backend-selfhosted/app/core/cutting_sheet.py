"""
Cutting Sheet Generator (Plancha de Corte)

Takes decomposed panels and packs them onto physical cutting sheets
(1000 mm x 600 mm) using a shelf bin-packing algorithm with 2 mm gap.

Output: one DXF file per sheet with laser-cutter layers:
  - CORTE   (color 1 / red)   — exterior contours of pieces (cut lines)
  - GRABADO (color 5 / blue)  — reference IDs, dimensions, assembly marks
  - MARCO   (color 7 / black) — sheet boundary rectangle

Requires ``ezdxf`` for proper DXF generation.
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field

from .types import PanelInfo

# ---------------------------------------------------------------------------
# Physical sheet constants (all in mm)
# ---------------------------------------------------------------------------

SHEET_WIDTH_MM = 1000.0
SHEET_HEIGHT_MM = 600.0
SHEET_MARGIN_MM = 10.0        # safety margin from edges
PIECE_GAP_MM = 2.0            # laser kerf gap between pieces
LABEL_SPACE_MM = 5.0          # vertical space reserved above each piece for its label


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class PlacedPanel:
    """A panel placed at a specific position on a cutting sheet (in mm)."""
    ref_id: str
    x: float          # bottom-left X
    y: float          # bottom-left Y
    width_mm: float
    height_mm: float


@dataclass
class CuttingSheetData:
    """One physical cutting sheet with its placed panels."""
    panels: list[PlacedPanel] = field(default_factory=list)
    sheet_w: float = SHEET_WIDTH_MM
    sheet_h: float = SHEET_HEIGHT_MM


# ---------------------------------------------------------------------------
# Bin packing — Shelf First-Fit Decreasing Height
# ---------------------------------------------------------------------------

def _shelf_pack(
    items: list[tuple[str, float, float]],
    sheet_w: float,
    sheet_h: float,
    margin: float,
    gap: float,
    label_space: float,
) -> list[CuttingSheetData]:
    """Pack rectangular items onto sheets using a shelf algorithm.

    Each item is (ref_id, width_mm, height_mm).
    Returns a list of CuttingSheetData with placed panels.
    """
    usable_w = sheet_w - 2 * margin
    usable_h = sheet_h - 2 * margin

    # Sort by height descending for better shelf utilization.
    items_sorted = sorted(items, key=lambda t: t[2], reverse=True)

    sheets: list[CuttingSheetData] = []
    placed: list[PlacedPanel] = []

    cursor_x = margin
    cursor_y = margin
    shelf_h = 0.0  # tallest piece in current shelf row

    def _new_sheet() -> None:
        nonlocal placed, cursor_x, cursor_y, shelf_h
        if placed:
            sheets.append(CuttingSheetData(panels=placed))
        placed = []
        cursor_x = margin
        cursor_y = margin
        shelf_h = 0.0

    for ref_id, w, h in items_sorted:
        # Try rotation if the piece doesn't fit upright.
        fits_normal = (w <= usable_w) and (h + label_space <= usable_h)
        fits_rotated = (h <= usable_w) and (w + label_space <= usable_h)

        if not fits_normal and not fits_rotated:
            continue  # too large for any sheet — skip

        if not fits_normal and fits_rotated:
            w, h = h, w  # rotate 90°

        # Effective height including label space above.
        eff_h = h + label_space

        # Does it fit on the current shelf horizontally?
        if cursor_x + w > sheet_w - margin:
            # Move to next shelf.
            cursor_y += shelf_h + gap
            cursor_x = margin
            shelf_h = 0.0

        # Does the new shelf fit vertically on the current sheet?
        if cursor_y + eff_h > sheet_h - margin:
            _new_sheet()

        placed.append(PlacedPanel(
            ref_id=ref_id,
            x=cursor_x,
            y=cursor_y,
            width_mm=w,
            height_mm=h,
        ))

        cursor_x += w + gap
        shelf_h = max(shelf_h, eff_h)

    # Flush remaining panels.
    if placed:
        sheets.append(CuttingSheetData(panels=placed))

    return sheets


# ---------------------------------------------------------------------------
# Public API — pack panels
# ---------------------------------------------------------------------------

def pack_panels(
    all_panels: list[PanelInfo],
    scale_denom: int,
) -> list[CuttingSheetData]:
    """Convert panels from model-units to mm at the given scale,
    then pack them onto 1000 x 600 mm cutting sheets.

    Parameters
    ----------
    all_panels : list[PanelInfo]
        Panels from the decomposition step (walls + slabs combined).
    scale_denom : int
        Scale denominator (50 or 100).

    Returns
    -------
    list[CuttingSheetData]
        One entry per physical cutting sheet needed.
    """
    if not all_panels:
        return []

    # Model-units (meters) → mm at scale.
    # At 1:100, 1 m model → 10 mm sheet.
    # At 1:50,  1 m model → 20 mm sheet.
    factor = 1000.0 / scale_denom

    items: list[tuple[str, float, float]] = []
    for p in all_panels:
        w_mm = p.width * factor
        h_mm = p.height * factor
        if w_mm < 1.0 or h_mm < 1.0:
            continue  # sub-millimeter — skip
        items.append((p.ref_id, w_mm, h_mm))

    return _shelf_pack(
        items,
        sheet_w=SHEET_WIDTH_MM,
        sheet_h=SHEET_HEIGHT_MM,
        margin=SHEET_MARGIN_MM,
        gap=PIECE_GAP_MM,
        label_space=LABEL_SPACE_MM,
    )


# ---------------------------------------------------------------------------
# DXF generation with ezdxf
# ---------------------------------------------------------------------------

def generate_cutting_sheet_dxf(sheet: CuttingSheetData, sheet_index: int = 1) -> str:
    """Generate a DXF file (text) for one cutting sheet.

    Layers:
      CORTE   (red/1)   — panel outlines (cut lines)
      GRABADO (blue/5)  — ref IDs, dimensions
      MARCO   (black/7) — sheet boundary
    """
    import ezdxf
    from ezdxf.enums import TextEntityAlignment

    doc = ezdxf.new("R2010")
    msp = doc.modelspace()

    # --- Layers ---
    doc.layers.add("CORTE", color=1)       # red
    doc.layers.add("GRABADO", color=5)     # blue
    doc.layers.add("MARCO", color=7)       # black/white

    # --- Sheet boundary ---
    sw, sh = sheet.sheet_w, sheet.sheet_h
    msp.add_lwpolyline(
        [(0, 0), (sw, 0), (sw, sh), (0, sh)],
        close=True,
        dxfattribs={"layer": "MARCO"},
    )

    # --- Panels ---
    for panel in sheet.panels:
        x, y = panel.x, panel.y
        w, h = panel.width_mm, panel.height_mm

        # Panel outline on CORTE (cut).
        msp.add_lwpolyline(
            [(x, y), (x + w, y), (x + w, y + h), (x, y + h)],
            close=True,
            dxfattribs={"layer": "CORTE"},
        )

        cx = x + w / 2.0

        # Reference ID above the panel on GRABADO.
        id_h = min(3.5, max(1.5, h * 0.08))  # scale text to panel
        id_y = y + h + 1.0                    # 1mm above outline
        text = msp.add_text(
            panel.ref_id,
            height=id_h,
            dxfattribs={"layer": "GRABADO"},
        )
        text.set_placement((cx, id_y), align=TextEntityAlignment.BOTTOM_CENTER)

        # Dimensions inside the panel (centered).
        dim_text = f"{panel.width_mm:.0f}x{panel.height_mm:.0f}"
        dim_h = min(2.5, max(1.0, h * 0.06))
        dim_y = y + h / 2.0
        dt = msp.add_text(
            dim_text,
            height=dim_h,
            dxfattribs={"layer": "GRABADO"},
        )
        dt.set_placement((cx, dim_y), align=TextEntityAlignment.MIDDLE_CENTER)

    # --- Title ---
    title = f"Plancha de Corte {sheet_index}"
    tt = msp.add_text(
        title,
        height=5.0,
        dxfattribs={"layer": "GRABADO"},
    )
    tt.set_placement(
        (sw / 2.0, sh + 8.0),
        align=TextEntityAlignment.BOTTOM_CENTER,
    )

    # --- Scale note ---
    sn = msp.add_text(
        f"Unidades: mm  |  Plancha: {sw:.0f} x {sh:.0f} mm",
        height=2.5,
        dxfattribs={"layer": "GRABADO"},
    )
    sn.set_placement((sw / 2.0, -6.0), align=TextEntityAlignment.TOP_CENTER)

    # --- Write to string ---
    stream = io.StringIO()
    doc.write(stream)
    return stream.getvalue()
