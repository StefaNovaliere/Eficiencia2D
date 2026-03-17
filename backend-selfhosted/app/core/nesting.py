"""
Nesting — Bottom-Left Fill Algorithm

Packs 2D pieces onto rectangular sheets for laser cutting.

Features:
  - Bottom-Left Fill placement (place each piece at the lowest, then
    leftmost valid position)
  - Pieces sorted by bounding box area, largest first
  - Configurable sheet dimensions, gap between pieces
  - Groups pieces by material/thickness (never mix on same sheet)
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .types import CuttingPiece, Vec2

# ---------------------------------------------------------------------------
# Constants (defaults, all in mm)
# ---------------------------------------------------------------------------

SHEET_WIDTH_MM = 2440.0   # Standard MDF/MDP sheet width
SHEET_HEIGHT_MM = 1220.0  # Standard MDF/MDP sheet height
PIECE_GAP_MM = 8.0        # Minimum gap between pieces
DEFAULT_KERF_MM = 0.5     # Default kerf compensation


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class PlacedPiece:
    """A piece positioned on the cutting sheet."""
    ref_id: str
    x: float            # Bottom-left X on sheet (mm)
    y: float            # Bottom-left Y on sheet (mm)
    width_mm: float     # Bounding box width
    height_mm: float    # Bounding box height
    piece: CuttingPiece | None = None  # Reference to full piece data


@dataclass
class CuttingLayout:
    """All placed pieces for one sheet."""
    label: str
    pieces: list[PlacedPiece] = field(default_factory=list)
    total_width: float = 0.0
    total_height: float = 0.0
    sheet_width: float = SHEET_WIDTH_MM
    sheet_height: float = SHEET_HEIGHT_MM


# ---------------------------------------------------------------------------
# Bottom-Left Fill
# ---------------------------------------------------------------------------

def _bbox(contour: list[Vec2]) -> tuple[float, float, float, float]:
    """Compute bounding box (min_x, min_y, max_x, max_y) of a contour."""
    if not contour:
        return 0.0, 0.0, 0.0, 0.0
    xs = [v.x for v in contour]
    ys = [v.y for v in contour]
    return min(xs), min(ys), max(xs), max(ys)


def _piece_bbox_size(piece: CuttingPiece) -> tuple[float, float]:
    """Get the bounding box size of a piece in mm."""
    return piece.width_mm, piece.height_mm


def bottom_left_fill(
    pieces: list[CuttingPiece],
    sheet_w: float = SHEET_WIDTH_MM,
    sheet_h: float = SHEET_HEIGHT_MM,
    gap: float = PIECE_GAP_MM,
) -> list[PlacedPiece]:
    """Place pieces on a sheet using Bottom-Left Fill algorithm.

    Sorts pieces by bounding box area (largest first), then places each
    piece at the lowest valid Y position, and for ties, the leftmost X.

    If a piece doesn't fit on the current sheet width, it starts a new
    row. The sheet height is treated as soft limit (layout extends
    vertically if needed, producing warnings about multiple sheets).

    Parameters
    ----------
    pieces : list of CuttingPiece
        Pieces to place, with contours already in mm.
    sheet_w : float
        Sheet width in mm.
    sheet_h : float
        Sheet height in mm (soft limit).
    gap : float
        Minimum gap between pieces in mm.

    Returns
    -------
    List of PlacedPiece with assigned positions.
    """
    if not pieces:
        return []

    # Sort by bounding box area, largest first.
    sorted_pieces = sorted(
        pieces,
        key=lambda p: p.width_mm * p.height_mm,
        reverse=True,
    )

    placed: list[PlacedPiece] = []

    # Track placed rectangles for collision detection.
    # Each is (x, y, w, h) including gap.
    occupied: list[tuple[float, float, float, float]] = []

    for piece in sorted_pieces:
        w, h = piece.width_mm, piece.height_mm
        if w < 0.1 or h < 0.1:
            continue

        # Find best position: lowest Y first, then leftmost X.
        best_x = 0.0
        best_y = 0.0
        best_found = False

        # Candidate Y positions: 0, and top edge of each placed piece + gap.
        candidate_ys = [0.0]
        for ox, oy, ow, oh in occupied:
            candidate_ys.append(oy + oh + gap)

        candidate_ys = sorted(set(candidate_ys))

        for cy in candidate_ys:
            # Candidate X positions: 0, and right edge of each placed piece + gap.
            candidate_xs = [0.0]
            for ox, oy, ow, oh in occupied:
                candidate_xs.append(ox + ow + gap)

            candidate_xs = sorted(set(candidate_xs))

            for cx in candidate_xs:
                # Check if piece fits at (cx, cy).
                if cx + w > sheet_w + 0.01:
                    continue  # Doesn't fit horizontally.

                # Check collision with all placed pieces.
                collision = False
                for ox, oy, ow, oh in occupied:
                    if (cx < ox + ow + gap and cx + w + gap > ox and
                            cy < oy + oh + gap and cy + h + gap > oy):
                        collision = True
                        break

                if not collision:
                    if not best_found or cy < best_y or (cy == best_y and cx < best_x):
                        best_x = cx
                        best_y = cy
                        best_found = True
                    break  # Found leftmost at this Y, move on.

            if best_found and best_y <= cy:
                break  # Can't do better at higher Y values.

        if not best_found:
            # Fallback: place below everything.
            max_y = 0.0
            for ox, oy, ow, oh in occupied:
                max_y = max(max_y, oy + oh + gap)
            best_x = 0.0
            best_y = max_y

        placed.append(PlacedPiece(
            ref_id=piece.ref_id,
            x=best_x,
            y=best_y,
            width_mm=w,
            height_mm=h,
            piece=piece,
        ))
        occupied.append((best_x, best_y, w, h))

    return placed


# ---------------------------------------------------------------------------
# Group pieces by material/thickness
# ---------------------------------------------------------------------------

def group_by_material(
    pieces: list[CuttingPiece],
) -> dict[str, list[CuttingPiece]]:
    """Group pieces by material and thickness.

    Key format: "material_thicknessmm" or just "default" if unspecified.
    """
    groups: dict[str, list[CuttingPiece]] = {}
    for piece in pieces:
        key = "default"
        if piece.material and piece.thickness_mm > 0:
            key = f"{piece.material}_{piece.thickness_mm:.1f}mm"
        elif piece.material:
            key = piece.material
        elif piece.thickness_mm > 0:
            key = f"{piece.thickness_mm:.1f}mm"
        groups.setdefault(key, []).append(piece)
    return groups


# ---------------------------------------------------------------------------
# Build layout from CuttingPieces
# ---------------------------------------------------------------------------

def build_cutting_layout(
    pieces: list[CuttingPiece],
    label: str,
    sheet_w: float = SHEET_WIDTH_MM,
    sheet_h: float = SHEET_HEIGHT_MM,
    gap: float = PIECE_GAP_MM,
) -> CuttingLayout | None:
    """Pack CuttingPieces onto a sheet and return the layout.

    Returns None if no valid pieces to pack.
    """
    valid = [p for p in pieces if p.width_mm >= 0.1 and p.height_mm >= 0.1]
    if not valid:
        return None

    placed = bottom_left_fill(valid, sheet_w, sheet_h, gap)
    if not placed:
        return None

    total_w = max(p.x + p.width_mm for p in placed)
    total_h = max(p.y + p.height_mm for p in placed)

    return CuttingLayout(
        label=label,
        pieces=placed,
        total_width=total_w,
        total_height=total_h,
        sheet_width=sheet_w,
        sheet_height=sheet_h,
    )
