"""
Component Decomposition — Per-floor vertical & horizontal plane breakdown.

Takes Face3D[] and produces ComponentSheet[] — decomposed by floor level,
with separate sheets for vertical planes (walls) and horizontal planes (slabs).

Output example for a 2-story building:
  - "Piso 1 - Plano Horizontal"  (floor slabs at level 1)
  - "Piso 1 - Plano Vertical"    (wall panels belonging to floor 1)
  - "Piso 2 - Plano Horizontal"  (floor slabs at level 2)
  - "Piso 2 - Plano Vertical"    (wall panels belonging to floor 2)

Filtering:
  - Panels smaller than MIN_PANEL_AREA are excluded (furniture, doors, etc.)
  - Panels with any dimension smaller than MIN_PANEL_DIM are excluded

Algorithm:
  1. Auto-detect the vertical axis (Y-up vs Z-up).
  2. Classify faces as vertical (walls) or horizontal (slabs).
  3. Detect floor levels by clustering horizontal face heights.
  4. Assign faces to floors based on height ranges.
  5. For each floor, group coplanar faces into panels.
  6. Filter out small panels (furniture, doors, windows, etc.).
  7. Layout panels in a grid (like a cutting sheet).
"""

from __future__ import annotations

import math
from typing import Literal

from .types import (
    ComponentSheet,
    Face3D,
    Loop2D,
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
FLOOR_CLUSTER_TOLERANCE = 0.30  # meters — group floors within this height

# --- Filtering thresholds ---
# Panels smaller than this are excluded from decomposition.
# This removes furniture, doors, windows, small trim, etc.
MIN_PANEL_AREA = 0.4  # m² — a small wall panel is ~0.5m², furniture is < 0.3m²
MIN_PANEL_DIM = 0.25  # m  — minimum width or height of a panel


def _get_up_component(normal: Vec3, up_axis: Literal["Y", "Z"]) -> float:
    return normal.y if up_axis == "Y" else normal.z


def _get_height(v: Vec3, up_axis: Literal["Y", "Z"]) -> float:
    return v.y if up_axis == "Y" else v.z


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
# Floor level detection
# ---------------------------------------------------------------------------

def _detect_floor_levels(
    faces: list[Face3D], up_axis: Literal["Y", "Z"]
) -> list[float]:
    """Find distinct floor heights by looking at horizontal faces.

    Horizontal faces are those whose normal is mostly aligned with the up axis.
    We cluster their average heights to find distinct levels.
    """
    heights: list[float] = []

    for face in faces:
        up_comp = abs(_get_up_component(face.normal, up_axis))
        if up_comp < (1.0 - HORIZONTAL_EPSILON):
            continue  # not horizontal
        avg_h = sum(_get_height(v, up_axis) for v in face.vertices) / len(face.vertices)
        heights.append(avg_h)

    if not heights:
        return []

    # Cluster heights.
    heights.sort()
    clusters: list[list[float]] = [[heights[0]]]
    for h in heights[1:]:
        if h - clusters[-1][-1] < FLOOR_CLUSTER_TOLERANCE:
            clusters[-1].append(h)
        else:
            clusters.append([h])

    # Return the average of each cluster.
    levels = [sum(c) / len(c) for c in clusters]
    return levels


def _assign_floor(
    face: Face3D,
    floor_ranges: list[tuple[float, float, int]],
    up_axis: Literal["Y", "Z"],
) -> int:
    """Assign a face to a floor index based on its vertical position.

    floor_ranges is a list of (min_h, max_h, floor_index) tuples.
    Returns the floor index, or -1 if no match.
    """
    face_heights = [_get_height(v, up_axis) for v in face.vertices]
    face_mid = (min(face_heights) + max(face_heights)) / 2.0

    for min_h, max_h, idx in floor_ranges:
        if min_h - 0.5 <= face_mid <= max_h + 0.5:
            return idx
    return -1


def _compute_floor_ranges(
    levels: list[float],
    all_faces: list[Face3D],
    up_axis: Literal["Y", "Z"],
) -> list[tuple[float, float, int]]:
    """Compute height ranges for each floor.

    Each floor spans from one level to the next.
    The bottom floor starts at the model's minimum height.
    The top floor extends to the model's maximum height.
    """
    if not levels:
        return []

    # Find model vertical extent.
    all_h = [_get_height(v, up_axis) for f in all_faces for v in f.vertices]
    if not all_h:
        return []

    model_min = min(all_h)
    model_max = max(all_h)

    ranges: list[tuple[float, float, int]] = []

    for i, level in enumerate(levels):
        if i == 0:
            floor_min = model_min
        else:
            floor_min = (levels[i - 1] + level) / 2.0

        if i == len(levels) - 1:
            floor_max = model_max
        else:
            floor_max = (level + levels[i + 1]) / 2.0

        ranges.append((floor_min, floor_max, i))

    return ranges


# ---------------------------------------------------------------------------
# Coplanar grouping
# ---------------------------------------------------------------------------

_COPLANAR_DIST_TOL_FRAC = 0.005  # fraction of model diagonal


def _plane_key(face: Face3D, n: Vec3, model_diag: float) -> tuple[float, float, float, float]:
    """Return a hashable plane identifier (nx, ny, nz, d) for grouping."""
    d = dot(face.vertices[0], n)
    tol = max(model_diag * _COPLANAR_DIST_TOL_FRAC, 0.1)
    d_q = round(d / tol) * tol
    # Canonicalise normal direction.
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
# Grid layout
# ---------------------------------------------------------------------------

def _layout_panels_grid(
    panels: list[Loop2D],
    panel_dims: list[tuple[float, float]],
    gap: float = 0.5,
    max_cols: int = 5,
) -> tuple[list[Loop2D], float, float]:
    """Lay out panels in a grid, left-to-right then top-to-bottom.

    Returns (laid_out_panels, total_width, total_height).
    """
    if not panels:
        return [], 0.0, 0.0

    laid: list[Loop2D] = []
    row_x = 0.0
    row_y = 0.0
    row_h = 0.0
    col = 0
    total_w = 0.0

    for panel, (pw, ph) in zip(panels, panel_dims):
        if col >= max_cols and col > 0:
            row_y += row_h + gap
            row_x = 0.0
            row_h = 0.0
            col = 0

        shifted = Loop2D(vertices=[
            Vec2(v.x + row_x, v.y + row_y)
            for v in panel.vertices
        ])
        laid.append(shifted)

        row_x += pw + gap
        total_w = max(total_w, row_x - gap)
        row_h = max(row_h, ph)
        col += 1

    total_h = row_y + row_h
    return laid, total_w, total_h


# ---------------------------------------------------------------------------
# Panel creation from face groups (with size filtering)
# ---------------------------------------------------------------------------

def _make_wall_panels(
    groups: list[list[Face3D]], up_axis: Literal["Y", "Z"]
) -> tuple[list[Loop2D], list[tuple[float, float]]]:
    """Convert wall face groups into 2D rectangle panels.

    Filters out panels that are too small (furniture, doors, etc.).
    Returns (panels, panel_dimensions).
    """
    panels: list[Loop2D] = []
    dims: list[tuple[float, float]] = []

    up_vec = Vec3(0, 1, 0) if up_axis == "Y" else Vec3(0, 0, 1)

    for group in groups:
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

        # Filter small panels (furniture, doors, windows, trim).
        if w < MIN_PANEL_DIM or h < MIN_PANEL_DIM:
            continue
        if w * h < MIN_PANEL_AREA:
            continue

        rect = Loop2D(vertices=[
            Vec2(0, 0), Vec2(w, 0), Vec2(w, h), Vec2(0, h),
        ])
        panels.append(rect)
        dims.append((w, h))

    return panels, dims


def _make_slab_panels(
    groups: list[list[Face3D]], up_axis: Literal["Y", "Z"]
) -> tuple[list[Loop2D], list[tuple[float, float]]]:
    """Convert slab face groups into 2D rectangle panels.

    Filters out panels that are too small (furniture, doors, etc.).
    Returns (panels, panel_dimensions).
    """
    panels: list[Loop2D] = []
    dims: list[tuple[float, float]] = []

    for group in groups:
        all_pts = [_project_to_ground(v, up_axis) for f in group for v in f.vertices]
        if len(all_pts) < 3:
            continue

        min_x = min(p.x for p in all_pts)
        max_x = max(p.x for p in all_pts)
        min_y = min(p.y for p in all_pts)
        max_y = max(p.y for p in all_pts)
        w = max_x - min_x
        h = max_y - min_y

        # Filter small panels.
        if w < MIN_PANEL_DIM or h < MIN_PANEL_DIM:
            continue
        if w * h < MIN_PANEL_AREA:
            continue

        rect = Loop2D(vertices=[
            Vec2(0, 0), Vec2(w, 0), Vec2(w, h), Vec2(0, h),
        ])
        panels.append(rect)
        dims.append((w, h))

    return panels, dims


# ---------------------------------------------------------------------------
# Main: per-floor component decomposition
# ---------------------------------------------------------------------------

def _extract_components_with_axis(
    faces: list[Face3D], up_axis: Literal["Y", "Z"]
) -> list[ComponentSheet]:
    """Decompose the model into per-floor vertical and horizontal planes.

    For each detected floor level, creates:
      - "Piso N - Plano Horizontal" (slab panels)
      - "Piso N - Plano Vertical" (wall panels)

    Small panels (furniture, doors, windows) are filtered out.
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

    # Detect floor levels.
    levels = _detect_floor_levels(faces, up_axis)

    if not levels:
        # Fallback: single floor using model height range.
        all_h = [_get_height(v, up_axis) for f in faces for v in f.vertices]
        if all_h:
            levels = [(min(all_h) + max(all_h)) / 2.0]
        else:
            return []

    # Compute floor height ranges.
    floor_ranges = _compute_floor_ranges(levels, faces, up_axis)

    if not floor_ranges:
        return []

    num_floors = len(levels)
    sheets: list[ComponentSheet] = []

    for floor_min, floor_max, floor_idx in floor_ranges:
        if num_floors == 1:
            floor_label = "Piso 1"
        else:
            floor_label = f"Piso {floor_idx + 1}"

        # --- Horizontal planes (slabs) for this floor ---
        floor_slabs = [
            f for f in horizontal_faces
            if _assign_floor(f, [(floor_min, floor_max, floor_idx)], up_axis) == floor_idx
        ]

        if floor_slabs:
            groups = _group_coplanar(floor_slabs, model_diag)
            panels, dims = _make_slab_panels(groups, up_axis)

            if panels:
                laid, tw, th = _layout_panels_grid(panels, dims, gap=0.5, max_cols=4)
                sheets.append(ComponentSheet(
                    label=f"{floor_label} - Plano Horizontal",
                    components=laid,
                    width=tw,
                    height=th,
                ))

        # --- Vertical planes (walls) for this floor ---
        floor_walls = [
            f for f in vertical_faces
            if _assign_floor(f, [(floor_min, floor_max, floor_idx)], up_axis) == floor_idx
        ]

        if floor_walls:
            groups = _group_coplanar(floor_walls, model_diag)
            panels, dims = _make_wall_panels(groups, up_axis)

            if panels:
                laid, tw, th = _layout_panels_grid(panels, dims, gap=0.5, max_cols=4)
                sheets.append(ComponentSheet(
                    label=f"{floor_label} - Plano Vertical",
                    components=laid,
                    width=tw,
                    height=th,
                ))

    return sheets


def extract_components(faces: list[Face3D]) -> list[ComponentSheet]:
    """Extract per-floor component decomposition, auto-detecting up axis."""
    if not faces:
        return []

    sheets_z = _extract_components_with_axis(faces, "Z")
    sheets_y = _extract_components_with_axis(faces, "Y")

    count_z = sum(len(s.components) for s in sheets_z)
    count_y = sum(len(s.components) for s in sheets_y)

    if count_y > count_z:
        return sheets_y
    return sheets_z
