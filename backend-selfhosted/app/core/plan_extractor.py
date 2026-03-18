"""
Component Decomposition — Walls & slabs with reference IDs.

Takes Face3D[] and produces ComponentSheet[] with PanelInfo items.
Each panel gets a unique reference ID (A1, A2... for walls; B1, B2... for slabs)
that links the cutting sheet to the facade elevation views.

Output:
  - "Descomposicion Paredes" — all wall panels with ref IDs (A1, A2...)
  - "Descomposicion Pisos"   — all slab panels with ref IDs (B1, B2...)

Side effect: tags each Face3D.panel_id so facade extraction can carry
the reference IDs through to the elevation views.

Filtering:
  - Panels smaller than MIN_PANEL_AREA are excluded (furniture, doors, etc.)
  - Panels with any dimension smaller than MIN_PANEL_DIM are excluded
"""

from __future__ import annotations

import math
from typing import Literal

from .types import (
    ComponentSheet,
    CuttingPiece,
    Face3D,
    Loop2D,
    PanelInfo,
    PieceType,
    Vec2,
    Vec3,
    cross,
    dot,
    length,
    normalize,
    sub,
)

VERTICAL_EPSILON = 0.20
HORIZONTAL_EPSILON = 0.15  # |up_component_of_normal| > (1 - this) means horizontal

# --- Filtering thresholds ---
MIN_PANEL_AREA = 0.4  # m² — panels smaller than this are excluded
MIN_PANEL_DIM = 0.25  # m  — minimum width or height of a panel

# --- Door/window group name patterns ---
import re
_OPENING_NAME_RE = re.compile(
    r"puerta|door|porta|ventana|window|janela", re.IGNORECASE
)


def _get_up_component(normal: Vec3, up_axis: Literal["Y", "Z"]) -> float:
    return normal.y if up_axis == "Y" else normal.z


def _project_to_ground(v: Vec3, up_axis: Literal["Y", "Z"]) -> Vec2:
    if up_axis == "Y":
        return Vec2(v.x, v.z)
    else:
        return Vec2(v.x, v.y)


def _face_area_3d(face: Face3D) -> float:
    """Approximate area of a 3D face using the cross-product method."""
    verts = face.vertices
    if len(verts) < 3:
        return 0.0
    total = Vec3(0.0, 0.0, 0.0)
    for i in range(1, len(verts) - 1):
        e1 = sub(verts[i], verts[0])
        e2 = sub(verts[i + 1], verts[0])
        c = cross(e1, e2)
        total = Vec3(total.x + c.x, total.y + c.y, total.z + c.z)
    return length(total) / 2.0


# ---------------------------------------------------------------------------
# Coplanar grouping
# ---------------------------------------------------------------------------

_COPLANAR_DIST_TOL_FRAC = 0.005  # fraction of model diagonal


def _plane_key(face: Face3D, n: Vec3, model_diag: float) -> tuple[float, float, float, float]:
    """Return a hashable plane identifier (nx, ny, nz, d) for grouping."""
    d = dot(face.vertices[0], n)
    tol = max(model_diag * _COPLANAR_DIST_TOL_FRAC, 0.1)
    d_q = round(d / tol) * tol
    if n.x < -0.01 or (abs(n.x) < 0.01 and n.y < -0.01) or (abs(n.x) < 0.01 and abs(n.y) < 0.01 and n.z < -0.01):
        n = Vec3(-n.x, -n.y, -n.z)
        d_q = -d_q
    nx_q = round(n.x, 2)
    ny_q = round(n.y, 2)
    nz_q = round(n.z, 2)
    return (nx_q, ny_q, nz_q, round(d_q, 3))


def _group_coplanar(
    faces: list[Face3D], model_diag: float
) -> list[list[Face3D]]:
    """Group faces that lie on the same plane."""
    buckets: dict[tuple, list[Face3D]] = {}
    for face in faces:
        n = normalize(face.normal)
        key = _plane_key(face, n, model_diag)
        buckets.setdefault(key, []).append(face)
    return list(buckets.values())


def _compute_model_diagonal(faces: list[Face3D]) -> float:
    if not faces:
        return 1.0
    mn = [float("inf")] * 3
    mx = [float("-inf")] * 3
    for f in faces:
        for v in f.vertices:
            mn[0] = min(mn[0], v.x); mn[1] = min(mn[1], v.y); mn[2] = min(mn[2], v.z)
            mx[0] = max(mx[0], v.x); mx[1] = max(mx[1], v.y); mx[2] = max(mx[2], v.z)
    return math.sqrt(sum((mx[i] - mn[i]) ** 2 for i in range(3)))


# ---------------------------------------------------------------------------
# Panel creation from face groups (with size filtering and ref IDs)
# ---------------------------------------------------------------------------

def _make_wall_panels(
    groups: list[list[Face3D]], up_axis: Literal["Y", "Z"], prefix: str = "A"
) -> tuple[list[PanelInfo], dict[int, str]]:
    """Convert wall face groups into panels with reference IDs.

    Returns (panels, group_index_to_panel_id) for face tagging.
    """
    panels: list[PanelInfo] = []
    group_to_id: dict[int, str] = {}
    counter = 1

    up_vec = Vec3(0, 1, 0) if up_axis == "Y" else Vec3(0, 0, 1)

    for gi, group in enumerate(groups):
        rep_normal = normalize(group[0].normal)
        u_axis = normalize(cross(up_vec, rep_normal))
        v_axis = up_vec

        if length(u_axis) < 0.01:
            continue

        all_u: list[float] = []
        all_v: list[float] = []
        for face in group:
            for v in face.vertices:
                all_u.append(dot(v, u_axis))
                all_v.append(dot(v, v_axis))

        if not all_u:
            continue

        w = max(all_u) - min(all_u)
        h = max(all_v) - min(all_v)

        if w < MIN_PANEL_DIM or h < MIN_PANEL_DIM:
            continue
        if w * h < MIN_PANEL_AREA:
            continue

        ref_id = f"{prefix}{counter}"
        counter += 1
        group_to_id[gi] = ref_id

        rect = Loop2D(vertices=[
            Vec2(0, 0), Vec2(w, 0), Vec2(w, h), Vec2(0, h),
        ])
        panels.append(PanelInfo(ref_id=ref_id, outline=rect, width=w, height=h))

    return panels, group_to_id


def _make_slab_panels(
    groups: list[list[Face3D]], up_axis: Literal["Y", "Z"], prefix: str = "B"
) -> tuple[list[PanelInfo], dict[int, str]]:
    """Convert slab face groups into panels with reference IDs.

    Returns (panels, group_index_to_panel_id) for face tagging.
    """
    panels: list[PanelInfo] = []
    group_to_id: dict[int, str] = {}
    counter = 1

    for gi, group in enumerate(groups):
        all_pts = [_project_to_ground(v, up_axis) for f in group for v in f.vertices]
        if len(all_pts) < 3:
            continue

        min_x = min(p.x for p in all_pts)
        max_x = max(p.x for p in all_pts)
        min_y = min(p.y for p in all_pts)
        max_y = max(p.y for p in all_pts)
        w = max_x - min_x
        h = max_y - min_y

        if w < MIN_PANEL_DIM or h < MIN_PANEL_DIM:
            continue
        if w * h < MIN_PANEL_AREA:
            continue

        ref_id = f"{prefix}{counter}"
        counter += 1
        group_to_id[gi] = ref_id

        rect = Loop2D(vertices=[
            Vec2(0, 0), Vec2(w, 0), Vec2(w, h), Vec2(0, h),
        ])
        panels.append(PanelInfo(ref_id=ref_id, outline=rect, width=w, height=h))

    return panels, group_to_id


# ---------------------------------------------------------------------------
# Grid layout
# ---------------------------------------------------------------------------

LABEL_SPACE = 0.4  # model-units of vertical space above each panel for its label


def _layout_panels_grid(
    panels: list[PanelInfo],
    gap: float = 0.5,
    max_cols: int = 5,
) -> tuple[list[PanelInfo], float, float]:
    """Lay out panels in a grid, left-to-right then top-to-bottom.

    Reserves LABEL_SPACE above each panel row for reference IDs and
    LABEL_SPACE below for dimensions, so labels don't overlap.

    Returns (laid_out_panels, total_width, total_height).
    """
    if not panels:
        return [], 0.0, 0.0

    laid: list[PanelInfo] = []
    row_x = 0.0
    row_y = LABEL_SPACE  # start with bottom label space
    row_h = 0.0
    col = 0
    total_w = 0.0

    for panel in panels:
        pw, ph = panel.width, panel.height

        if col >= max_cols and col > 0:
            # Move to next row: current row height + top label + gap + bottom label
            row_y += row_h + LABEL_SPACE + gap + LABEL_SPACE
            row_x = 0.0
            row_h = 0.0
            col = 0

        shifted = PanelInfo(
            ref_id=panel.ref_id,
            outline=Loop2D(vertices=[
                Vec2(v.x + row_x, v.y + row_y)
                for v in panel.outline.vertices
            ]),
            width=panel.width,
            height=panel.height,
        )
        laid.append(shifted)

        row_x += pw + gap
        total_w = max(total_w, row_x - gap)
        row_h = max(row_h, ph)
        col += 1

    total_h = row_y + row_h + LABEL_SPACE  # include top label space
    return laid, total_w, total_h


# ---------------------------------------------------------------------------
# Tag faces with panel IDs
# ---------------------------------------------------------------------------

def _tag_faces(
    groups: list[list[Face3D]], group_to_id: dict[int, str]
) -> None:
    """Set panel_id on each Face3D that belongs to a valid panel."""
    for gi, group in enumerate(groups):
        ref_id = group_to_id.get(gi)
        if ref_id is None:
            continue
        for face in group:
            face.panel_id = ref_id


def _clear_panel_ids(faces: list[Face3D]) -> None:
    """Reset all panel_id tags on faces."""
    for face in faces:
        face.panel_id = None


# ---------------------------------------------------------------------------
# Main: component decomposition
# ---------------------------------------------------------------------------

def _extract_components_with_axis(
    faces: list[Face3D], up_axis: Literal["Y", "Z"], gap: float = 0.5
) -> list[ComponentSheet]:
    """Decompose the model into wall and slab panels.

    Creates two sheets:
      - "Descomposicion Paredes" (walls, IDs: A1, A2...)
      - "Descomposicion Pisos" (slabs, IDs: B1, B2...)

    Tags each Face3D.panel_id with its reference ID.
    """
    vertical_faces: list[Face3D] = []
    horizontal_faces: list[Face3D] = []

    for face in faces:
        # Skip faces belonging to door/window components.
        if face.group_name and _OPENING_NAME_RE.search(face.group_name):
            continue

        up_comp = abs(_get_up_component(face.normal, up_axis))
        if up_comp > (1.0 - HORIZONTAL_EPSILON):
            horizontal_faces.append(face)
        elif up_comp <= VERTICAL_EPSILON:
            vertical_faces.append(face)

    model_diag = _compute_model_diagonal(faces)
    sheets: list[ComponentSheet] = []

    # --- Walls ---
    wall_groups: list[list[Face3D]] = []
    if vertical_faces:
        wall_groups = _group_coplanar(vertical_faces, model_diag)
        panels, group_to_id = _make_wall_panels(wall_groups, up_axis, prefix="A")
        _tag_faces(wall_groups, group_to_id)

        if panels:
            laid, tw, th = _layout_panels_grid(panels, gap=gap, max_cols=4)
            sheets.append(ComponentSheet(
                label="Descomposicion Paredes",
                panels=laid,
                width=tw,
                height=th,
            ))

    # --- Slabs ---
    slab_groups: list[list[Face3D]] = []
    if horizontal_faces:
        slab_groups = _group_coplanar(horizontal_faces, model_diag)
        panels, group_to_id = _make_slab_panels(slab_groups, up_axis, prefix="B")
        _tag_faces(slab_groups, group_to_id)

        if panels:
            laid, tw, th = _layout_panels_grid(panels, gap=gap, max_cols=4)
            sheets.append(ComponentSheet(
                label="Descomposicion Pisos",
                panels=laid,
                width=tw,
                height=th,
            ))

    return sheets


def extract_components(
    faces: list[Face3D], gap: float = 0.5,
    up_axis: Literal["Y", "Z"] | None = None,
) -> list[ComponentSheet]:
    """Extract component decomposition.

    If *up_axis* is provided it is used directly; otherwise both Y and Z are
    tried and the one producing more panels wins.

    Side effect: sets Face3D.panel_id on each face that belongs to a panel.
    This allows the facade extractor to carry reference IDs through.
    """
    if not faces:
        return []

    if up_axis is not None:
        _clear_panel_ids(faces)
        return _extract_components_with_axis(faces, up_axis, gap)

    # Try both axes — but only tag faces for the winner.
    _clear_panel_ids(faces)
    sheets_z = _extract_components_with_axis(faces, "Z", gap)
    count_z = sum(len(s.panels) for s in sheets_z)

    # Save Z tags, then try Y.
    z_tags = {id(f): f.panel_id for f in faces}
    _clear_panel_ids(faces)
    sheets_y = _extract_components_with_axis(faces, "Y", gap)
    count_y = sum(len(s.panels) for s in sheets_y)

    if count_y > count_z:
        # Y wins — tags are already set from the Y run.
        return sheets_y
    else:
        # Z wins — restore Z tags.
        for face in faces:
            face.panel_id = z_tags.get(id(face))
        return sheets_z


# ---------------------------------------------------------------------------
# CuttingPiece extraction — real contours for laser cutting
# ---------------------------------------------------------------------------

def _make_cutting_pieces_from_groups(
    groups: list[list[Face3D]],
    group_to_id: dict[int, str],
    kerf_mm: float = 0.5,
    unit_scale: float = 1.0,
) -> list[CuttingPiece]:
    """Convert face groups into CuttingPieces with real contours.

    Uses Rodrigues rotation to align each piece's local plane with XY,
    then extracts actual boundary contours (not bounding boxes).

    Parameters
    ----------
    groups : list of list of Face3D
        Coplanar face groups.
    group_to_id : dict
        Maps group index to ref_id (e.g. "A1"). Only groups in this dict
        are processed.
    kerf_mm : float
        Kerf compensation in mm.
    unit_scale : float
        Factor to convert model units to mm (e.g. 1000.0 for meters→mm).
    """
    from .geometry_classifier import (
        classify_piece,
        compute_weighted_normal,
        rotate_vertices_to_xy,
    )
    from .contour_extractor import extract_piece_contours

    pieces: list[CuttingPiece] = []

    for gi, group in enumerate(groups):
        ref_id = group_to_id.get(gi)
        if ref_id is None:
            continue

        # 1. Classify piece geometry.
        piece_type = classify_piece(group)

        warning = ""
        if piece_type == PieceType.DOUBLE_CURVATURE:
            warning = (
                f"Pieza {ref_id}: doble curvatura detectada. "
                "El contorno es una aproximacion — verificar manualmente."
            )

        # 2. Compute area-weighted normal.
        weighted_normal = compute_weighted_normal(group)

        # 3. Rotate all face vertices to XY plane.
        face_verts_2d: list[list[tuple[float, float]]] = []
        for face in group:
            rotated = rotate_vertices_to_xy(face.vertices, weighted_normal)
            face_verts_2d.append([(x, y) for x, y, z in rotated])

        # 4. Extract contours (boundary edges → loops → classify → kerf).
        outer, inners, outer_kerf, inners_kerf = extract_piece_contours(
            face_verts_2d,
            kerf_mm=kerf_mm,
            scale_to_mm=unit_scale,
        )

        if not outer:
            continue

        # 5. Compute bounding box in mm.
        all_x = [v.x for v in outer]
        all_y = [v.y for v in outer]
        min_x, max_x = min(all_x), max(all_x)
        min_y, max_y = min(all_y), max(all_y)
        w_mm = max_x - min_x
        h_mm = max_y - min_y

        if w_mm < 0.1 or h_mm < 0.1:
            continue

        # 6. Normalize contours so (0,0) = bottom-left.
        def _shift(verts: list[Vec2]) -> list[Vec2]:
            return [Vec2(v.x - min_x, v.y - min_y) for v in verts]

        pieces.append(CuttingPiece(
            ref_id=ref_id,
            piece_type=piece_type,
            outer_contour=_shift(outer),
            inner_loops=[_shift(loop) for loop in inners],
            outer_kerf=_shift(outer_kerf),
            inner_kerf=[_shift(loop) for loop in inners_kerf],
            width_mm=w_mm,
            height_mm=h_mm,
            warning=warning,
        ))

    return pieces


def _deduplicate_pieces(
    pieces: list[CuttingPiece],
    dim_tolerance_mm: float = 5.0,
) -> list[CuttingPiece]:
    """Remove duplicate pieces that have the same dimensions.

    Walls modeled with thickness produce parallel coplanar groups (exterior,
    interior, edges) that generate near-identical cutting pieces. This keeps
    only the first occurrence of each unique (width, height) pair.
    """
    if not pieces:
        return pieces

    unique: list[CuttingPiece] = []
    seen_dims: list[tuple[float, float]] = []

    for piece in pieces:
        w, h = piece.width_mm, piece.height_mm
        # Normalize: always store (smaller, larger) to handle rotation.
        dims = (min(w, h), max(w, h))

        is_dup = False
        for sw, sh in seen_dims:
            if (abs(dims[0] - sw) < dim_tolerance_mm
                    and abs(dims[1] - sh) < dim_tolerance_mm):
                is_dup = True
                break

        if not is_dup:
            unique.append(piece)
            seen_dims.append(dims)

    return unique


def extract_cutting_pieces(
    faces: list[Face3D],
    up_axis: Literal["Y", "Z"],
    kerf_mm: float = 0.5,
    unit_scale: float = 1000.0,
) -> tuple[list[CuttingPiece], list[CuttingPiece], list[str]]:
    """Extract CuttingPieces with real contours for laser cutting.

    Must be called AFTER extract_components() so that face groups and
    panel IDs are already established.

    Parameters
    ----------
    faces : list of Face3D
        All model faces (with panel_id already set by extract_components).
    up_axis : "Y" or "Z"
        Detected up axis.
    kerf_mm : float
        Kerf compensation in mm.
    unit_scale : float
        Conversion factor from model units to mm.

    Returns
    -------
    (wall_pieces, slab_pieces, warnings)
    """
    warnings: list[str] = []

    vertical_faces: list[Face3D] = []
    horizontal_faces: list[Face3D] = []

    for face in faces:
        if face.group_name and _OPENING_NAME_RE.search(face.group_name):
            continue
        if face.panel_id is None:
            continue

        up_comp = abs(_get_up_component(face.normal, up_axis))
        if up_comp > (1.0 - HORIZONTAL_EPSILON):
            horizontal_faces.append(face)
        elif up_comp <= VERTICAL_EPSILON:
            vertical_faces.append(face)

    model_diag = _compute_model_diagonal(faces)

    # --- Walls ---
    wall_pieces: list[CuttingPiece] = []
    if vertical_faces:
        wall_groups = _group_coplanar(vertical_faces, model_diag)
        # Build group_to_id from existing panel_id tags.
        group_to_id: dict[int, str] = {}
        for gi, group in enumerate(wall_groups):
            for face in group:
                if face.panel_id:
                    group_to_id[gi] = face.panel_id
                    break
        wall_pieces = _make_cutting_pieces_from_groups(
            wall_groups, group_to_id, kerf_mm, unit_scale,
        )

    # --- Slabs ---
    slab_pieces: list[CuttingPiece] = []
    if horizontal_faces:
        slab_groups = _group_coplanar(horizontal_faces, model_diag)
        group_to_id = {}
        for gi, group in enumerate(slab_groups):
            for face in group:
                if face.panel_id:
                    group_to_id[gi] = face.panel_id
                    break
        slab_pieces = _make_cutting_pieces_from_groups(
            slab_groups, group_to_id, kerf_mm, unit_scale,
        )

    # Deduplicate pieces with near-identical dimensions (thick wall faces).
    wall_pieces = _deduplicate_pieces(wall_pieces)
    slab_pieces = _deduplicate_pieces(slab_pieces)

    # Collect warnings from pieces.
    for p in wall_pieces + slab_pieces:
        if p.warning:
            warnings.append(p.warning)

    return wall_pieces, slab_pieces, warnings
