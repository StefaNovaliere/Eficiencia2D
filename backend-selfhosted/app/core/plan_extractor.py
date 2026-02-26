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

def _extract_components_with_axis(
    faces: list[Face3D], up_axis: Literal["Y", "Z"]
) -> list[ComponentSheet]:
    """Decompose the model into component groups.

    Returns sheets for:
      - "Pisos" (floor slabs) — all horizontal faces projected to ground plane
      - "Paredes" (walls) — all vertical faces projected to their own 2D plane
    """
    vertical_faces: list[Face3D] = []
    horizontal_faces: list[Face3D] = []

    for face in faces:
        up_comp = abs(_get_up_component(face.normal, up_axis))
        if up_comp > (1.0 - HORIZONTAL_EPSILON):
            if _face_area_3d(face) >= MIN_SLAB_AREA:
                horizontal_faces.append(face)
        elif up_comp <= VERTICAL_EPSILON:
            vertical_faces.append(face)

    sheets: list[ComponentSheet] = []

    # --- Floor slabs ---
    if horizontal_faces:
        components: list[Loop2D] = []
        for face in horizontal_faces:
            pts = [_project_to_ground(v, up_axis) for v in face.vertices]
            if len(pts) >= 3:
                components.append(Loop2D(vertices=pts))

        if components:
            # Compute bounding box across all components.
            all_x = [v.x for c in components for v in c.vertices]
            all_y = [v.y for c in components for v in c.vertices]
            min_x, max_x = min(all_x), max(all_x)
            min_y, max_y = min(all_y), max(all_y)

            # Normalize coordinates.
            norm_components = [
                Loop2D(vertices=[Vec2(v.x - min_x, v.y - min_y) for v in c.vertices])
                for c in components
            ]

            sheets.append(ComponentSheet(
                label="Pisos",
                components=norm_components,
                width=max_x - min_x,
                height=max_y - min_y,
            ))

    # --- Walls ---
    if vertical_faces:
        wall_components: list[Loop2D] = []

        # Group walls and project each to its own local axes.
        # Layout them side by side with a gap.
        gap = 0.5  # meters between components
        cursor_x = 0.0
        total_height = 0.0

        for face in vertical_faces:
            # Local axes for this wall face.
            up_vec = Vec3(0, 1, 0) if up_axis == "Y" else Vec3(0, 0, 1)
            u_axis = normalize(cross(up_vec, face.normal))
            v_axis = up_vec

            if length(u_axis) < 0.01:
                continue

            # Project face vertices to local 2D.
            pts_2d: list[Vec2] = []
            for v in face.vertices:
                u = dot(v, u_axis)
                vv = dot(v, v_axis)
                pts_2d.append(Vec2(u, vv))

            if len(pts_2d) < 3:
                continue

            # Normalize this single wall to its own bbox.
            min_u = min(p.x for p in pts_2d)
            max_u = max(p.x for p in pts_2d)
            min_v = min(p.y for p in pts_2d)
            max_v = max(p.y for p in pts_2d)

            w = max_u - min_u
            h = max_v - min_v

            if w < 0.01 or h < 0.01:
                continue

            # Offset to layout position.
            shifted = [Vec2(p.x - min_u + cursor_x, p.y - min_v) for p in pts_2d]
            wall_components.append(Loop2D(vertices=shifted))

            cursor_x += w + gap
            total_height = max(total_height, h)

        if wall_components:
            sheets.append(ComponentSheet(
                label="Paredes",
                components=wall_components,
                width=cursor_x - gap,  # remove trailing gap
                height=total_height,
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
