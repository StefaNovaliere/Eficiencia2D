"""
Wall Extractor

Takes Face3D[] from either parser and produces Wall[] ready for export.

Algorithm:
  1. Auto-detect the vertical axis (Y-up vs Z-up) by testing both.
  2. Filter faces whose normal is perpendicular to the up axis (vertical).
  3. Filter by area > threshold (rejects trim, baseboards, noise).
     The threshold adapts to the model's coordinate scale.
  4. Compute a local 2D coordinate system on the wall plane.
  5. Project outer vertices (and inner loops / openings) to 2D.
  6. Compute bounding-box dimensions for annotation.
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


def _project_loop(
    pts: list[Vec3], origin: Vec3, u_axis: Vec3, v_axis: Vec3
) -> Loop2D:
    vertices: list[Vec2] = []
    for p in pts:
        rel = sub(p, origin)
        vertices.append(Vec2(dot(rel, u_axis), dot(rel, v_axis)))
    return Loop2D(vertices=vertices)


def _compute_model_scale(faces: list[Face3D]) -> float:
    """Estimate the model's bounding box diagonal to adapt area threshold."""
    if not faces:
        return 1.0
    min_x = min_y = min_z = float("inf")
    max_x = max_y = max_z = float("-inf")
    # Sample up to 500 faces for speed.
    sample = faces[:500]
    for face in sample:
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


def _extract_walls_with_axis(
    faces: list[Face3D],
    up_axis: Literal["Y", "Z"],
    min_area: float,
) -> list[Wall]:
    """Extract walls assuming a specific up axis."""
    walls: list[Wall] = []
    counter = 0

    for face in faces:
        # 1. Verticality check: the face normal's component along
        #    the up axis should be near zero (wall is vertical).
        up_comp = _get_up_component(face.normal, up_axis)
        if abs(up_comp) > VERTICAL_EPSILON:
            continue

        # 2. Area check.
        area = _polygon_area_3d(face.vertices)
        if area < min_area:
            continue

        # 3. Compute local coordinate system.
        u_axis, v_axis = _compute_wall_axes(face.normal, up_axis)
        origin = face.vertices[0]

        # 4. Project outer loop.
        outer = _project_loop(face.vertices, origin, u_axis, v_axis)

        # 5. Project inner loops (openings).
        openings = [
            _project_loop(loop, origin, u_axis, v_axis)
            for loop in face.inner_loops
        ]

        # 6. Bounding box.
        min_u = min(v.x for v in outer.vertices)
        max_u = max(v.x for v in outer.vertices)
        min_v = min(v.y for v in outer.vertices)
        max_v = max(v.y for v in outer.vertices)

        counter += 1
        walls.append(
            Wall(
                label=f"Muro_{counter:03d}",
                normal=face.normal,
                vertices3d=face.vertices,
                outer=outer,
                openings=openings,
                width=max_u - min_u,
                height=max_v - min_v,
            )
        )

    return walls


def extract_walls(faces: list[Face3D]) -> list[Wall]:
    """Extract walls from faces, auto-detecting up axis and scale."""
    if not faces:
        return []

    # Estimate model scale to compute an adaptive area threshold.
    # If the model diagonal is ~10 (meters), threshold ~ 1.5 m².
    # If the diagonal is ~1000 (centimeters or inches), threshold scales up.
    diag = _compute_model_scale(faces)

    # Heuristic: assume "architectural scale" means the diagonal should be
    # roughly 5-50 meters. We scale the area threshold proportionally.
    # A 10m-diagonal model → threshold 1.5 m².
    # A 1000-unit model (cm) → threshold 1.5 * (1000/10)^2 = 15000 units².
    ref_diag = 10.0
    scale_factor = (diag / ref_diag) ** 2 if diag > 0 else 1.0
    min_area = 1.5 * scale_factor

    # Try both up-axis conventions and pick the one that yields more walls.
    walls_z = _extract_walls_with_axis(faces, "Z", min_area)
    walls_y = _extract_walls_with_axis(faces, "Y", min_area)

    if len(walls_y) > len(walls_z):
        return walls_y
    return walls_z
