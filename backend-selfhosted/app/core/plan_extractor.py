"""
Floor Plan Extractor — Per-floor section cuts + component decomposition.

Takes Face3D[] and produces:
  1. A list of FloorPlan objects — one per detected floor level.
     Each shows wall interior divisions at that height.
  2. A ComponentSheet for "all walls" and one for "all floor slabs"
     (component decomposition / exploded view).

Algorithm for floor plans:
  1. Auto-detect the vertical axis (Y-up vs Z-up).
  2. Find horizontal faces (floors/ceilings) and cluster them by height
     to identify distinct floor levels.
  3. For each level, take a horizontal section cut:
     - Find all vertical faces that span through this height.
     - Compute the intersection of each vertical face with the
       horizontal cutting plane → produces a line segment.
  4. Deduplicate and normalize segments.

Algorithm for component decomposition:
  1. Separate faces into vertical (walls) and horizontal (slabs).
  2. For horizontal slabs: project each to the ground plane as a polygon.
  3. For vertical walls: project each to its local 2D plane.
  4. Layout all components of each type side-by-side on sheets.
"""

from __future__ import annotations

import math
from typing import Literal

from .types import (
    ComponentSheet,
    Face3D,
    FloorPlan,
    Loop2D,
    Segment2D,
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
MIN_SLAB_AREA = 0.5  # m² — skip tiny horizontal fragments


def _get_up_component(normal: Vec3, up_axis: Literal["Y", "Z"]) -> float:
    return normal.y if up_axis == "Y" else normal.z


def _get_height(v: Vec3, up_axis: Literal["Y", "Z"]) -> float:
    return v.y if up_axis == "Y" else v.z


def _project_to_ground(v: Vec3, up_axis: Literal["Y", "Z"]) -> Vec2:
    if up_axis == "Y":
        return Vec2(v.x, v.z)
    else:
        return Vec2(v.x, v.y)


def _polygon_area_2d(pts: list[Vec2]) -> float:
    """Shoelace area of a 2D polygon."""
    n = len(pts)
    if n < 3:
        return 0.0
    a = 0.0
    for i in range(n):
        j = (i + 1) % n
        a += pts[i].x * pts[j].y - pts[j].x * pts[i].y
    return abs(a) / 2.0


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
        # Average height of the face.
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


# ---------------------------------------------------------------------------
# Section cut: intersect vertical faces with a horizontal plane
# ---------------------------------------------------------------------------

def _intersect_face_at_height(
    face: Face3D, cut_h: float, up_axis: Literal["Y", "Z"]
) -> Segment2D | None:
    """Intersect a vertical face with a horizontal plane at cut_h.

    Returns the 2D line segment (projected to the ground plane) or None
    if the face doesn't span through cut_h.
    """
    verts = face.vertices
    if len(verts) < 3:
        return None

    # Check if the face spans through this height.
    face_heights = [_get_height(v, up_axis) for v in verts]
    h_min = min(face_heights)
    h_max = max(face_heights)

    if cut_h < h_min - 0.01 or cut_h > h_max + 0.01:
        return None  # face doesn't reach this height

    # Find intersection points: edges that cross the cutting plane.
    intersection_pts: list[Vec2] = []
    n = len(verts)
    for i in range(n):
        j = (i + 1) % n
        h_i = face_heights[i]
        h_j = face_heights[j]

        # Does this edge cross cut_h?
        if (h_i <= cut_h <= h_j) or (h_j <= cut_h <= h_i):
            dh = h_j - h_i
            if abs(dh) < 1e-9:
                # Edge is exactly at cut_h — both vertices are on the plane.
                intersection_pts.append(_project_to_ground(verts[i], up_axis))
                intersection_pts.append(_project_to_ground(verts[j], up_axis))
            else:
                t = (cut_h - h_i) / dh
                t = max(0.0, min(1.0, t))
                ix = verts[i].x + t * (verts[j].x - verts[i].x)
                iy = verts[i].y + t * (verts[j].y - verts[i].y)
                iz = verts[i].z + t * (verts[j].z - verts[i].z)
                intersection_pts.append(_project_to_ground(Vec3(ix, iy, iz), up_axis))

    if len(intersection_pts) < 2:
        return None

    # Find the two most distant intersection points → the segment.
    max_dist_sq = 0.0
    p_a = intersection_pts[0]
    p_b = intersection_pts[0]
    for i in range(len(intersection_pts)):
        for j in range(i + 1, len(intersection_pts)):
            dx = intersection_pts[j].x - intersection_pts[i].x
            dy = intersection_pts[j].y - intersection_pts[i].y
            d_sq = dx * dx + dy * dy
            if d_sq > max_dist_sq:
                max_dist_sq = d_sq
                p_a = intersection_pts[i]
                p_b = intersection_pts[j]

    if max_dist_sq < 1e-6:
        return None

    return Segment2D(a=p_a, b=p_b)


def _deduplicate_segments(
    segments: list[Segment2D], tolerance: float = 0.05
) -> list[Segment2D]:
    """Remove near-duplicate segments."""
    unique: list[Segment2D] = []
    for seg in segments:
        is_dup = False
        for u in unique:
            d1_aa = math.hypot(seg.a.x - u.a.x, seg.a.y - u.a.y)
            d1_bb = math.hypot(seg.b.x - u.b.x, seg.b.y - u.b.y)
            d2_ab = math.hypot(seg.a.x - u.b.x, seg.a.y - u.b.y)
            d2_ba = math.hypot(seg.b.x - u.a.x, seg.b.y - u.a.y)
            if (d1_aa < tolerance and d1_bb < tolerance) or (
                d2_ab < tolerance and d2_ba < tolerance
            ):
                is_dup = True
                break
        if not is_dup:
            unique.append(seg)
    return unique


def _normalize_segments(segments: list[Segment2D]) -> tuple[list[Segment2D], float, float]:
    """Shift segments so (0,0) = bottom-left. Returns (segments, width, height)."""
    all_x: list[float] = []
    all_y: list[float] = []
    for seg in segments:
        all_x.extend([seg.a.x, seg.b.x])
        all_y.extend([seg.a.y, seg.b.y])

    if not all_x:
        return segments, 0.0, 0.0

    min_x = min(all_x)
    max_x = max(all_x)
    min_y = min(all_y)
    max_y = max(all_y)

    normalized = [
        Segment2D(
            a=Vec2(seg.a.x - min_x, seg.a.y - min_y),
            b=Vec2(seg.b.x - min_x, seg.b.y - min_y),
        )
        for seg in segments
    ]
    return normalized, max_x - min_x, max_y - min_y


# ---------------------------------------------------------------------------
# Per-floor plan extraction
# ---------------------------------------------------------------------------

def _extract_floor_plans_with_axis(
    faces: list[Face3D], up_axis: Literal["Y", "Z"]
) -> list[FloorPlan]:
    """Extract one floor plan per detected floor level."""

    # 1. Find vertical faces.
    vertical_faces: list[Face3D] = []
    for face in faces:
        up_comp = _get_up_component(face.normal, up_axis)
        if abs(up_comp) <= VERTICAL_EPSILON:
            vertical_faces.append(face)

    if not vertical_faces:
        return []

    # 2. Detect floor levels from horizontal surfaces.
    levels = _detect_floor_levels(faces, up_axis)

    if not levels:
        # Fallback: use the min height of all vertical faces + 1m as single cut.
        all_heights = [
            _get_height(v, up_axis)
            for f in vertical_faces
            for v in f.vertices
        ]
        if all_heights:
            levels = [min(all_heights) + 1.0]
        else:
            return []

    # 3. For each level, section-cut through vertical walls.
    plans: list[FloorPlan] = []

    for level_idx, cut_h in enumerate(levels):
        segments: list[Segment2D] = []
        for face in vertical_faces:
            seg = _intersect_face_at_height(face, cut_h, up_axis)
            if seg is not None:
                segments.append(seg)

        if not segments:
            continue

        segments = _deduplicate_segments(segments, tolerance=0.05)
        segments, width, height = _normalize_segments(segments)

        if width < 0.01 or height < 0.01:
            continue

        if len(levels) == 1:
            label = "Planta"
        else:
            label = f"Planta Nivel {level_idx + 1}"

        plans.append(FloorPlan(
            label=label,
            segments=segments,
            width=width,
            height=height,
        ))

    return plans


def extract_floor_plans(faces: list[Face3D]) -> list[FloorPlan]:
    """Extract floor plans from faces, auto-detecting up axis.

    Returns one FloorPlan per detected floor level.
    """
    if not faces:
        return []

    plans_z = _extract_floor_plans_with_axis(faces, "Z")
    plans_y = _extract_floor_plans_with_axis(faces, "Y")

    count_z = sum(len(p.segments) for p in plans_z)
    count_y = sum(len(p.segments) for p in plans_y)

    if count_y > count_z:
        return plans_y
    return plans_z


# ---------------------------------------------------------------------------
# Component decomposition
# ---------------------------------------------------------------------------

# Two faces are on the same plane if their normals are parallel
# AND their distance-from-origin is the same.
_COPLANAR_ANGLE_TOL = 0.15   # dot product deviation from 1.0
_COPLANAR_DIST_TOL_FRAC = 0.005  # fraction of model diagonal


def _plane_key(face: Face3D, n: Vec3, model_diag: float) -> tuple[float, float, float, float]:
    """Return a hashable plane identifier (nx, ny, nz, d) for grouping."""
    # Distance of the face plane from the origin.
    d = dot(face.vertices[0], n)
    tol = max(model_diag * _COPLANAR_DIST_TOL_FRAC, 0.1)
    # Quantize to the tolerance so that close planes hash together.
    d_q = round(d / tol) * tol
    # Canonicalise normal direction (always pick the "positive" side).
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
            # New row.
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


def _extract_components_with_axis(
    faces: list[Face3D], up_axis: Literal["Y", "Z"]
) -> list[ComponentSheet]:
    """Decompose the model into component groups.

    1. Classify faces as vertical (walls) or horizontal (slabs).
    2. Group coplanar faces into panels.
    3. For each panel, compute bounding-box rectangle in local 2D.
    4. Layout panels in a grid with gaps (like a cutting sheet).

    Returns sheets for:
      - "Descomposicion Pisos"   — each floor slab as a separate rectangle
      - "Descomposicion Paredes" — each wall panel as a separate rectangle
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

    # --- Floor slabs: group coplanar horizontal faces → panels ---
    if horizontal_faces:
        groups = _group_coplanar(horizontal_faces, model_diag)
        panels: list[Loop2D] = []
        dims: list[tuple[float, float]] = []

        for group in groups:
            # Project all vertices to the ground plane → bounding box.
            all_pts = [_project_to_ground(v, up_axis) for f in group for v in f.vertices]
            if len(all_pts) < 3:
                continue
            min_x = min(p.x for p in all_pts)
            max_x = max(p.x for p in all_pts)
            min_y = min(p.y for p in all_pts)
            max_y = max(p.y for p in all_pts)
            w = max_x - min_x
            h = max_y - min_y
            if w < 0.01 or h < 0.01:
                continue
            # Normalize to (0,0) origin and make a rectangle.
            rect = Loop2D(vertices=[
                Vec2(0, 0), Vec2(w, 0), Vec2(w, h), Vec2(0, h),
            ])
            panels.append(rect)
            dims.append((w, h))

        if panels:
            laid, tw, th = _layout_panels_grid(panels, dims, gap=0.5, max_cols=4)
            sheets.append(ComponentSheet(
                label="Descomposicion Pisos",
                components=laid,
                width=tw,
                height=th,
            ))

    # --- Walls: group coplanar vertical faces → panels ---
    if vertical_faces:
        groups = _group_coplanar(vertical_faces, model_diag)
        panels = []
        dims = []

        for group in groups:
            # Compute local 2D axes for this panel group.
            rep_normal = normalize(group[0].normal)
            up_vec = Vec3(0, 1, 0) if up_axis == "Y" else Vec3(0, 0, 1)
            u_axis = normalize(cross(up_vec, rep_normal))
            v_axis = up_vec

            if length(u_axis) < 0.01:
                continue

            # Project ALL vertices of the group to local 2D → bounding box.
            all_u: list[float] = []
            all_v: list[float] = []
            for face in group:
                for v in face.vertices:
                    all_u.append(dot(v, u_axis))
                    all_v.append(dot(v, v_axis))

            if not all_u:
                continue

            min_u = min(all_u)
            max_u = max(all_u)
            min_v = min(all_v)
            max_v = max(all_v)
            w = max_u - min_u
            h = max_v - min_v

            if w < 0.01 or h < 0.01:
                continue

            # Make a rectangle panel at (0,0).
            rect = Loop2D(vertices=[
                Vec2(0, 0), Vec2(w, 0), Vec2(w, h), Vec2(0, h),
            ])
            panels.append(rect)
            dims.append((w, h))

        if panels:
            laid, tw, th = _layout_panels_grid(panels, dims, gap=0.5, max_cols=4)
            sheets.append(ComponentSheet(
                label="Descomposicion Paredes",
                components=laid,
                width=tw,
                height=th,
            ))

    return sheets


def extract_components(faces: list[Face3D]) -> list[ComponentSheet]:
    """Extract component decomposition, auto-detecting up axis."""
    if not faces:
        return []

    sheets_z = _extract_components_with_axis(faces, "Z")
    sheets_y = _extract_components_with_axis(faces, "Y")

    count_z = sum(len(s.components) for s in sheets_z)
    count_y = sum(len(s.components) for s in sheets_y)

    if count_y > count_z:
        return sheets_y
    return sheets_z
