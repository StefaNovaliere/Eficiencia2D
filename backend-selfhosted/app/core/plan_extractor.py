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
    Face3D,
    Loop2D,
    PanelInfo,
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

def _layout_panels_grid(
    panels: list[PanelInfo],
    gap: float = 0.5,
    max_cols: int = 5,
) -> tuple[list[PanelInfo], float, float]:
    """Lay out panels in a grid, left-to-right then top-to-bottom.

    Returns (laid_out_panels, total_width, total_height).
    """
    if not panels:
        return [], 0.0, 0.0

    laid: list[PanelInfo] = []
    row_x = 0.0
    row_y = 0.0
    row_h = 0.0
    col = 0
    total_w = 0.0

    for panel in panels:
        pw, ph = panel.width, panel.height

        if col >= max_cols and col > 0:
            row_y += row_h + gap
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

    total_h = row_y + row_h
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


def extract_components(faces: list[Face3D], gap: float = 0.5) -> list[ComponentSheet]:
    """Extract component decomposition, auto-detecting up axis.

    Side effect: sets Face3D.panel_id on each face that belongs to a panel.
    This allows the facade extractor to carry reference IDs through.
    """
    if not faces:
        return []

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
