"""
Wall Extractor

Takes Face3D[] from either parser and produces Wall[] ready for export.

Algorithm:
  1. Auto-detect the vertical axis (Y-up vs Z-up) by testing both.
  2. Filter faces whose normal is perpendicular to the up axis (vertical).
  3. Group coplanar faces into wall surfaces (handles triangulated meshes).
  4. For each coplanar group, compute the merged 2D bounding rectangle.
  5. Filter groups by area > threshold.
  6. Produce Wall objects with bounding-box outlines and dimensions.
"""

from __future__ import annotations

import math
from typing import Literal

from .types import (
    Face3D,
    Loop2D,
    Vec2,
    Vec3,
    Wall,
    cross,
    dot,
    length,
    normalize,
    scale,
    sub,
)

VERTICAL_EPSILON = 0.15

# Tolerance for grouping coplanar faces: normals must be within this
# angular distance, and plane distances within this linear distance.
NORMAL_DOT_THRESHOLD = 0.985  # ~10 degrees
PLANE_DIST_TOLERANCE_FRAC = 0.002  # 0.2% of model diagonal


def _get_up_component(normal: Vec3, up_axis: Literal["Y", "Z"]) -> float:
    return normal.y if up_axis == "Y" else normal.z


def _get_up_vec(up_axis: Literal["Y", "Z"]) -> Vec3:
    return Vec3(0.0, 1.0, 0.0) if up_axis == "Y" else Vec3(0.0, 0.0, 1.0)


def _polygon_area_3d(verts: list[Vec3]) -> float:
    if len(verts) < 3:
        return 0.0
    sx = sy = sz = 0.0
    for i in range(1, len(verts) - 1):
        e1 = sub(verts[i], verts[0])
        e2 = sub(verts[i + 1], verts[0])
        c = cross(e1, e2)
        sx += c.x
        sy += c.y
        sz += c.z
    return 0.5 * math.sqrt(sx * sx + sy * sy + sz * sz)


def _compute_wall_axes(normal: Vec3, up_axis: Literal["Y", "Z"]) -> tuple[Vec3, Vec3]:
    """Compute the wall's local 2D axes from its normal.

    Returns (u_axis, v_axis) where u_axis is horizontal along the wall
    and v_axis is vertical (world up projected onto the wall plane).
    """
    world_up = _get_up_vec(up_axis)
    d = dot(world_up, normal)
    v_axis = normalize(sub(world_up, scale(normal, d)))
    u_axis = normalize(cross(v_axis, normal))
    return u_axis, v_axis


def _compute_model_diagonal(faces: list[Face3D]) -> float:
    """Estimate the model's bounding box diagonal."""
    if not faces:
        return 1.0
    min_x = min_y = min_z = float("inf")
    max_x = max_y = max_z = float("-inf")
    for face in faces[:1000]:
        for v in face.vertices:
            min_x = min(min_x, v.x)
            min_y = min(min_y, v.y)
            min_z = min(min_z, v.z)
            max_x = max(max_x, v.x)
            max_y = max(max_y, v.y)
            max_z = max(max_z, v.z)
    dx = max_x - min_x
    dy = max_y - min_y
    dz = max_z - min_z
    return math.sqrt(dx * dx + dy * dy + dz * dz)


def _plane_distance(normal: Vec3, point: Vec3) -> float:
    """Signed distance from origin to the plane defined by normal and point."""
    return dot(normal, point)


def _group_coplanar_faces(
    faces: list[Face3D], plane_dist_tol: float
) -> list[list[Face3D]]:
    """Group faces that lie on the same plane (same normal + same offset).

    Uses a greedy approach: for each face, check existing groups.
    Two faces are coplanar if:
      - Their normals point in the same direction (dot > threshold) or
        opposite direction (dot < -threshold)
      - Their plane distances (dot(normal, point)) are within tolerance
    """
    groups: list[tuple[Vec3, float, list[Face3D]]] = []
    # Each group: (representative_normal, representative_dist, faces_list)

    for face in faces:
        n = face.normal
        d = _plane_distance(n, face.vertices[0])
        placed = False

        for g_normal, g_dist, g_faces in groups:
            dp = dot(n, g_normal)
            if dp > NORMAL_DOT_THRESHOLD:
                # Same direction -- check plane distance.
                if abs(d - g_dist) < plane_dist_tol:
                    g_faces.append(face)
                    placed = True
                    break
            elif dp < -NORMAL_DOT_THRESHOLD:
                # Opposite direction (back-face) -- negate for comparison.
                if abs(-d - g_dist) < plane_dist_tol:
                    g_faces.append(face)
                    placed = True
                    break

        if not placed:
            groups.append((n, d, [face]))

    return [g[2] for g in groups]


def _extract_walls_with_axis(
    faces: list[Face3D],
    up_axis: Literal["Y", "Z"],
    min_area: float,
    plane_dist_tol: float,
) -> list[Wall]:
    """Extract walls assuming a specific up axis."""

    # 1. Filter vertical faces.
    vertical_faces: list[Face3D] = []
    for face in faces:
        up_comp = _get_up_component(face.normal, up_axis)
        if abs(up_comp) <= VERTICAL_EPSILON:
            vertical_faces.append(face)

    if not vertical_faces:
        return []

    # 2. Group coplanar vertical faces into wall surfaces.
    groups = _group_coplanar_faces(vertical_faces, plane_dist_tol)

    # 3. For each group, merge into a single wall.
    walls: list[Wall] = []
    counter = 0

    for group in groups:
        # Compute representative normal (average of group).
        avg_nx = sum(f.normal.x for f in group) / len(group)
        avg_ny = sum(f.normal.y for f in group) / len(group)
        avg_nz = sum(f.normal.z for f in group) / len(group)
        rep_normal = normalize(Vec3(avg_nx, avg_ny, avg_nz))

        # Compute wall axes.
        u_axis, v_axis = _compute_wall_axes(rep_normal, up_axis)

        # Collect ALL vertices from all faces in the group.
        all_verts_3d: list[Vec3] = []
        total_area = 0.0
        for face in group:
            all_verts_3d.extend(face.vertices)
            total_area += _polygon_area_3d(face.vertices)

        # Area check on the total merged area.
        if total_area < min_area:
            continue

        # Project all vertices to the wall's local 2D space.
        origin = all_verts_3d[0]
        all_2d: list[Vec2] = []
        for v in all_verts_3d:
            rel = sub(v, origin)
            all_2d.append(Vec2(dot(rel, u_axis), dot(rel, v_axis)))

        # Compute bounding box in 2D.
        min_u = min(p.x for p in all_2d)
        max_u = max(p.x for p in all_2d)
        min_v = min(p.y for p in all_2d)
        max_v = max(p.y for p in all_2d)

        width = max_u - min_u
        height = max_v - min_v

        # Skip degenerate walls (very thin or very short).
        if width < 0.01 or height < 0.01:
            continue

        # Build the outer boundary as the bounding rectangle.
        outer = Loop2D(vertices=[
            Vec2(min_u, min_v),
            Vec2(max_u, min_v),
            Vec2(max_u, max_v),
            Vec2(min_u, max_v),
        ])

        counter += 1
        walls.append(
            Wall(
                label=f"Muro_{counter:03d}",
                normal=rep_normal,
                vertices3d=all_verts_3d,
                outer=outer,
                openings=[],
                width=width,
                height=height,
            )
        )

    return walls


def extract_walls(faces: list[Face3D]) -> list[Wall]:
    """Extract walls from faces, auto-detecting up axis and scale."""
    if not faces:
        return []

    # Estimate model diagonal for adaptive thresholds.
    diag = _compute_model_diagonal(faces)

    # Adaptive area threshold: scale proportionally to model size.
    # A 10-unit diagonal model -> threshold 1.5 units^2.
    ref_diag = 10.0
    scale_factor = (diag / ref_diag) ** 2 if diag > 0 else 1.0
    min_area = 1.5 * scale_factor

    # Plane distance tolerance: fraction of model diagonal.
    plane_dist_tol = max(diag * PLANE_DIST_TOLERANCE_FRAC, 0.01)

    # Try both up-axis conventions and pick the one that yields more walls.
    walls_z = _extract_walls_with_axis(faces, "Z", min_area, plane_dist_tol)
    walls_y = _extract_walls_with_axis(faces, "Y", min_area, plane_dist_tol)

    if len(walls_y) > len(walls_z):
        return walls_y
    return walls_z
