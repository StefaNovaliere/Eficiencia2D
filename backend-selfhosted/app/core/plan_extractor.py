"""
Floor Plan Extractor

Takes Face3D[] and produces a FloorPlan — a top-down view of the building
showing wall outlines as seen from above.

Algorithm:
  1. Auto-detect the vertical axis (Y-up vs Z-up).
  2. Filter vertical faces (same as facade extractor).
  3. Project each vertical face onto the ground plane.
     A vertical face projects to a line segment when viewed from above.
  4. Optionally include a horizontal cutting plane at a configurable height
     to capture interior wall segments at a specific floor level.
  5. Return all line segments with bounding box dimensions.
"""

from __future__ import annotations

import math
from typing import Literal

from .types import (
    Face3D,
    FloorPlan,
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


def _get_up_component(normal: Vec3, up_axis: Literal["Y", "Z"]) -> float:
    return normal.y if up_axis == "Y" else normal.z


def _project_to_ground(v: Vec3, up_axis: Literal["Y", "Z"]) -> Vec2:
    """Project a 3D point onto the ground plane."""
    if up_axis == "Y":
        # Ground plane is XZ
        return Vec2(v.x, v.z)
    else:
        # Ground plane is XY
        return Vec2(v.x, v.y)


def _get_height(v: Vec3, up_axis: Literal["Y", "Z"]) -> float:
    """Get the vertical coordinate of a point."""
    return v.y if up_axis == "Y" else v.z


def _face_to_ground_segment(face: Face3D, up_axis: Literal["Y", "Z"]) -> Segment2D | None:
    """Project a vertical face to a line segment on the ground plane.

    Since the face is vertical, all its vertices project onto a line
    when viewed from above. We find the two extreme points along that line.
    """
    if len(face.vertices) < 3:
        return None

    pts = [_project_to_ground(v, up_axis) for v in face.vertices]

    # Find the direction of the line (use the two most distant points).
    max_dist_sq = 0.0
    p_a = pts[0]
    p_b = pts[0]

    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            dx = pts[j].x - pts[i].x
            dy = pts[j].y - pts[i].y
            d_sq = dx * dx + dy * dy
            if d_sq > max_dist_sq:
                max_dist_sq = d_sq
                p_a = pts[i]
                p_b = pts[j]

    # Skip degenerate segments (face projects to a point from above).
    if max_dist_sq < 1e-6:
        return None

    return Segment2D(a=p_a, b=p_b)


def _deduplicate_segments(
    segments: list[Segment2D], tolerance: float = 0.05
) -> list[Segment2D]:
    """Remove near-duplicate segments.

    Two segments are duplicates if both endpoints are within tolerance
    of each other (in either order).
    """
    unique: list[Segment2D] = []

    for seg in segments:
        is_dup = False
        for u in unique:
            # Check both orientations.
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


def _extract_plan_with_axis(
    faces: list[Face3D], up_axis: Literal["Y", "Z"]
) -> FloorPlan | None:
    """Extract a floor plan assuming a specific up axis."""

    # 1. Filter vertical faces.
    vertical_faces: list[Face3D] = []
    for face in faces:
        up_comp = _get_up_component(face.normal, up_axis)
        if abs(up_comp) <= VERTICAL_EPSILON:
            vertical_faces.append(face)

    if not vertical_faces:
        return None

    # 2. Project each vertical face to a ground-plane segment.
    segments: list[Segment2D] = []
    for face in vertical_faces:
        seg = _face_to_ground_segment(face, up_axis)
        if seg is not None:
            segments.append(seg)

    if not segments:
        return None

    # 3. Deduplicate overlapping segments (e.g. both sides of a wall).
    segments = _deduplicate_segments(segments, tolerance=0.05)

    # 4. Compute bounding box.
    all_x: list[float] = []
    all_y: list[float] = []
    for seg in segments:
        all_x.extend([seg.a.x, seg.b.x])
        all_y.extend([seg.a.y, seg.b.y])

    min_x = min(all_x)
    max_x = max(all_x)
    min_y = min(all_y)
    max_y = max(all_y)

    width = max_x - min_x
    height = max_y - min_y

    if width < 0.01 or height < 0.01:
        return None

    # 5. Normalize so (0,0) = bottom-left.
    normalized: list[Segment2D] = []
    for seg in segments:
        normalized.append(Segment2D(
            a=Vec2(seg.a.x - min_x, seg.a.y - min_y),
            b=Vec2(seg.b.x - min_x, seg.b.y - min_y),
        ))

    return FloorPlan(
        label="Planta",
        segments=normalized,
        width=width,
        height=height,
    )


def extract_floor_plan(faces: list[Face3D]) -> FloorPlan | None:
    """Extract a floor plan from faces, auto-detecting up axis.

    Returns None if no floor plan can be generated.
    """
    if not faces:
        return None

    # Try both up-axis conventions.
    plan_z = _extract_plan_with_axis(faces, "Z")
    plan_y = _extract_plan_with_axis(faces, "Y")

    # Prefer the result with more line segments (more geometry).
    count_z = len(plan_z.segments) if plan_z else 0
    count_y = len(plan_y.segments) if plan_y else 0

    if count_y > count_z:
        return plan_y
    return plan_z
