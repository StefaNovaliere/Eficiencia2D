"""
Facade Extractor

Takes Face3D[] and produces Facade[] — one elevation view per building side.

Algorithm:
  1. Auto-detect the vertical axis (Y-up vs Z-up).
  2. Filter faces whose normal is roughly perpendicular to up (vertical faces).
  3. Compute each face's horizontal direction (the normal projected onto the
     ground plane).
  4. Cluster faces by horizontal direction into facade groups.
     Typical rectangular buildings yield 4 groups (N/S/E/W).
  5. For each group, project ALL face vertices onto the facade plane to
     produce a complete 2D elevation view with all geometry in position.
  6. Normalize coordinates so (0,0) is the bottom-left of each facade.
"""

from __future__ import annotations

import math
from typing import Literal

from .types import (
    Face3D,
    Facade,
    Loop2D,
    Vec2,
    Vec3,
    cross,
    dot,
    length,
    normalize,
    scale,
    sub,
)

VERTICAL_EPSILON = 0.20
DIRECTION_CLUSTER_THRESHOLD = 0.70  # dot product; ~45 degrees


def _get_up_component(normal: Vec3, up_axis: Literal["Y", "Z"]) -> float:
    return normal.y if up_axis == "Y" else normal.z


def _get_up_vec(up_axis: Literal["Y", "Z"]) -> Vec3:
    return Vec3(0.0, 1.0, 0.0) if up_axis == "Y" else Vec3(0.0, 0.0, 1.0)


def _horizontal_dir(normal: Vec3, up_axis: Literal["Y", "Z"]) -> Vec3:
    """Project the normal onto the ground plane and normalize."""
    if up_axis == "Y":
        h = Vec3(normal.x, 0.0, normal.z)
    else:
        h = Vec3(normal.x, normal.y, 0.0)
    return normalize(h)


def _compute_facade_axes(
    direction: Vec3, up_axis: Literal["Y", "Z"]
) -> tuple[Vec3, Vec3]:
    """Compute the facade's local 2D axes.

    Returns (u_axis, v_axis):
      u_axis = horizontal along the facade (left to right when looking at it)
      v_axis = vertical (world up)
    """
    world_up = _get_up_vec(up_axis)
    # u_axis is perpendicular to both the direction and up
    u_axis = normalize(cross(world_up, direction))
    # v_axis is just world up
    v_axis = world_up
    return u_axis, v_axis


def _compute_model_diagonal(faces: list[Face3D]) -> float:
    if not faces:
        return 1.0
    min_x = min_y = min_z = float("inf")
    max_x = max_y = max_z = float("-inf")
    for face in faces:
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


def _cluster_by_direction(
    faces: list[Face3D], up_axis: Literal["Y", "Z"]
) -> list[tuple[Vec3, list[Face3D]]]:
    """Cluster vertical faces by their horizontal facing direction.

    Returns list of (representative_direction, faces_in_cluster).
    """
    clusters: list[tuple[Vec3, list[Face3D]]] = []

    for face in faces:
        h_dir = _horizontal_dir(face.normal, up_axis)
        if length(h_dir) < 0.01:
            continue

        placed = False
        for i, (c_dir, c_faces) in enumerate(clusters):
            dp = dot(h_dir, c_dir)
            if dp > DIRECTION_CLUSTER_THRESHOLD:
                c_faces.append(face)
                placed = True
                break

        if not placed:
            clusters.append((h_dir, [face]))

    return clusters


def _direction_label(direction: Vec3, up_axis: Literal["Y", "Z"]) -> str:
    """Give a human-readable label based on the direction."""
    if up_axis == "Y":
        # Ground plane is XZ.  +Z = "Norte", -Z = "Sur", +X = "Este", -X = "Oeste"
        angle = math.atan2(direction.x, direction.z)
    else:
        # Ground plane is XY.  +Y = "Norte", -Y = "Sur", +X = "Este", -X = "Oeste"
        angle = math.atan2(direction.x, direction.y)

    # Normalize to degrees.
    deg = math.degrees(angle) % 360

    if deg < 45 or deg >= 315:
        return "Fachada Norte"
    elif 45 <= deg < 135:
        return "Fachada Este"
    elif 135 <= deg < 225:
        return "Fachada Sur"
    else:
        return "Fachada Oeste"


def _face_center(face: Face3D) -> Vec3:
    """Compute the centroid of a face."""
    n = len(face.vertices)
    if n == 0:
        return Vec3(0.0, 0.0, 0.0)
    sx = sum(v.x for v in face.vertices)
    sy = sum(v.y for v in face.vertices)
    sz = sum(v.z for v in face.vertices)
    return Vec3(sx / n, sy / n, sz / n)


def _filter_exterior_faces(
    cluster_faces: list[Face3D], direction: Vec3, model_diag: float,
) -> list[Face3D]:
    """Keep only the outermost faces in a cluster (exterior wall faces).

    For each direction cluster, interior wall faces sit at a different depth
    (distance along the facade direction) than the exterior walls.  We keep
    faces whose depth is within a tolerance of the maximum depth (the
    outermost/exterior position).

    Tolerance is 15% of the total depth span of the cluster, or 0.6 m,
    whichever is larger.  This accommodates wall thickness, window recesses,
    and minor offsets while filtering out interior partitions that are
    well behind the exterior wall.
    """
    if not cluster_faces:
        return cluster_faces

    depths = [dot(_face_center(f), direction) for f in cluster_faces]
    max_depth = max(depths)
    min_depth = min(depths)
    span = max_depth - min_depth

    if span < 0.01:
        # All faces at roughly the same depth — keep all.
        return cluster_faces

    # Tolerance: 15% of the cluster's depth span, min 0.6 m.
    tol = max(span * 0.15, 0.6)

    return [
        f for f, d in zip(cluster_faces, depths)
        if d >= max_depth - tol
    ]


def _extract_facades_with_axis(
    faces: list[Face3D], up_axis: Literal["Y", "Z"]
) -> list[Facade]:
    """Extract facades assuming a specific up axis."""

    # 1. Filter vertical faces.
    vertical_faces: list[Face3D] = []
    for face in faces:
        up_comp = _get_up_component(face.normal, up_axis)
        if abs(up_comp) <= VERTICAL_EPSILON:
            vertical_faces.append(face)

    if not vertical_faces:
        return []

    model_diag = _compute_model_diagonal(faces)

    # 2. Cluster by horizontal direction.
    clusters = _cluster_by_direction(vertical_faces, up_axis)

    # 3. Build one Facade per cluster.
    facades: list[Facade] = []

    for direction, cluster_faces in clusters:
        # 3a. Filter to keep only exterior (outermost) faces per cluster.
        cluster_faces = _filter_exterior_faces(cluster_faces, direction, model_diag)
        u_axis, v_axis = _compute_facade_axes(direction, up_axis)

        # Project all face vertices to the facade's 2D space.
        # Use the model origin as projection reference.
        origin = Vec3(0.0, 0.0, 0.0)

        polygons: list[Loop2D] = []
        all_u: list[float] = []
        all_v: list[float] = []

        for face in cluster_faces:
            pts_2d: list[Vec2] = []
            for v in face.vertices:
                u = dot(v, u_axis)
                vv = dot(v, v_axis)
                pts_2d.append(Vec2(u, vv))
                all_u.append(u)
                all_v.append(vv)
            if len(pts_2d) >= 3:
                polygons.append(Loop2D(vertices=pts_2d, panel_id=face.panel_id))

        if not polygons or not all_u:
            continue

        # Compute bounding box.
        min_u = min(all_u)
        max_u = max(all_u)
        min_v = min(all_v)
        max_v = max(all_v)

        width = max_u - min_u
        height = max_v - min_v

        if width < 0.01 or height < 0.01:
            continue

        # Normalize: shift so that (0,0) = bottom-left.
        normalized_polygons: list[Loop2D] = []
        for poly in polygons:
            normalized_polygons.append(
                Loop2D(
                    vertices=[Vec2(p.x - min_u, p.y - min_v) for p in poly.vertices],
                    panel_id=poly.panel_id,
                )
            )

        label = _direction_label(direction, up_axis)
        # Ensure unique labels.
        existing_labels = {f.label for f in facades}
        if label in existing_labels:
            n = 2
            while f"{label} {n}" in existing_labels:
                n += 1
            label = f"{label} {n}"

        facades.append(Facade(
            label=label,
            direction=direction,
            polygons=normalized_polygons,
            width=width,
            height=height,
        ))

    # Sort facades by label for consistent ordering.
    order = {"Norte": 0, "Este": 1, "Sur": 2, "Oeste": 3}
    facades.sort(key=lambda f: order.get(f.label.split()[-1], 99))

    return facades


def extract_facades(
    faces: list[Face3D], up_axis: Literal["Y", "Z"] | None = None
) -> list[Facade]:
    """Extract facades from faces.

    If *up_axis* is provided it is used directly; otherwise both Y and Z are
    tried and the one producing more geometry wins.
    """
    result, _ = extract_facades_with_detected_axis(faces, up_axis)
    return result


def extract_facades_with_detected_axis(
    faces: list[Face3D], up_axis: Literal["Y", "Z"] | None = None
) -> tuple[list[Facade], Literal["Y", "Z"]]:
    """Like extract_facades but also returns the up axis that was used.

    The pipeline calls this so it can re-use the same axis for floor plans
    and decomposition, ensuring all views are consistent.
    """
    if not faces:
        return [], "Z"

    if up_axis is not None:
        return _extract_facades_with_axis(faces, up_axis), up_axis

    # Try both up-axis conventions and pick the best.
    facades_z = _extract_facades_with_axis(faces, "Z")
    facades_y = _extract_facades_with_axis(faces, "Y")

    # Compare by total facade area (width × height).  Using area instead of
    # polygon count avoids false positives when slab faces get misclassified
    # as vertical under the wrong axis — their projected "facades" are small.
    area_z = sum(f.width * f.height for f in facades_z)
    area_y = sum(f.width * f.height for f in facades_y)

    if area_y > area_z:
        return facades_y, "Y"
    return facades_z, "Z"
