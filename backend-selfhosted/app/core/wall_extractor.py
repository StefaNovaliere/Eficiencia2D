"""
Wall Extractor — Python port of src/core/wall-extractor.ts.

Takes Face3D[] from either parser and produces Wall[] ready for export.

Algorithm:
  1. Filter faces whose normal is perpendicular to world Z (vertical).
  2. Filter by area > MIN_AREA_M2 (rejects trim, baseboards, noise).
  3. Compute a local 2D coordinate system on the wall plane.
  4. Project outer vertices (and inner loops / openings) to 2D.
  5. Compute bounding-box dimensions for annotation.
"""

from __future__ import annotations

import math

from .types import (
    Face3D,
    Loop2D,
    Vec2,
    Vec3,
    Wall,
    cross,
    dot,
    normalize,
    scale,
    sub,
)

MIN_AREA_M2 = 1.5
VERTICAL_EPSILON = 0.08


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


def _compute_wall_axes(normal: Vec3) -> tuple[Vec3, Vec3]:
    """Compute the wall's local 2D axes from its normal.

    Returns (u_axis, v_axis) where u_axis is horizontal along the wall
    and v_axis is vertical (world Z projected).
    """
    world_z = Vec3(0.0, 0.0, 1.0)
    d = dot(world_z, normal)
    v_axis = normalize(sub(world_z, scale(normal, d)))
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


def extract_walls(faces: list[Face3D]) -> list[Wall]:
    walls: list[Wall] = []
    counter = 0

    for face in faces:
        # 1. Verticality check.
        if abs(face.normal.z) > VERTICAL_EPSILON:
            continue

        # 2. Area check.
        area = _polygon_area_3d(face.vertices)
        if area < MIN_AREA_M2:
            continue

        # 3. Compute local coordinate system.
        u_axis, v_axis = _compute_wall_axes(face.normal)
        origin = face.vertices[0]

        # 4. Project outer loop.
        outer = _project_loop(face.vertices, origin, u_axis, v_axis)

        # 5. Project inner loops (openings).
        openings = [
            _project_loop(loop, origin, u_axis, v_axis)
            for loop in face.inner_loops
        ]

        # 6. Bounding box.
        min_x = min(v.x for v in outer.vertices)
        max_x = max(v.x for v in outer.vertices)
        min_y = min(v.y for v in outer.vertices)
        max_y = max(v.y for v in outer.vertices)

        counter += 1
        walls.append(
            Wall(
                label=f"Muro_{counter:03d}",
                normal=face.normal,
                vertices3d=face.vertices,
                outer=outer,
                openings=openings,
                width=max_x - min_x,
                height=max_y - min_y,
            )
        )

    return walls
