"""
Floor Plan Extractor — Horizontal section cuts.

For each detected floor level, cuts the building with a horizontal plane
at ~1 m above the slab, producing a 2D plan view that shows interior and
exterior wall layout.

Door components (OBJ groups whose name contains "puerta", "door", or "porta")
are detected automatically:
  - Their faces are excluded from the wall-segment section cut.
  - Instead they produce Door2D entries (hinge, arc, leaf).

Algorithm:
  1. Find horizontal slab faces with area > MIN_SLAB_AREA → floor levels
  2. Cluster slab elevations → distinct floors
  3. For each floor, intersect all vertical faces with the cut plane
  4. Project intersection segments onto the ground (top-down view)
  5. Detect door groups → exclude from walls, generate Door2D entries
"""

from __future__ import annotations

import math
from typing import Literal

from .types import Face3D, Vec2, Vec3, cross, length, normalize, sub
from .door_extractor import Door2D, is_door_group, extract_doors_for_level


# --- Detection thresholds ---
MIN_SLAB_AREA = 2.0       # m² — only slabs larger than this count as floors
MIN_FLOOR_GAP = 2.0       # m — minimum vertical gap between distinct floors;
                          #     slabs closer than this are on the same level
CUT_HEIGHT = 1.0          # m above each floor slab
HORIZONTAL_EPSILON = 0.15
VERTICAL_EPSILON = 0.20


# ---------------------------------------------------------------------------
# Data type for floor plans (kept here to avoid circular imports)
# ---------------------------------------------------------------------------

from dataclasses import dataclass, field


@dataclass
class FloorPlan:
    """One horizontal section-cut view at a specific floor level."""
    label: str                              # "Planta Piso 1"
    segments: list[tuple[Vec2, Vec2]]       # Wall-cut line segments (top-down)
    width: float                            # Bounding box width (model units)
    height: float                           # Bounding box height (model units)
    elevation: float                        # Floor slab elevation
    doors: list[Door2D] = field(default_factory=list)  # Detected doors


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _face_area(face: Face3D) -> float:
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


def _get_up(v: Vec3, up_axis: Literal["Y", "Z"]) -> float:
    return v.y if up_axis == "Y" else v.z


def _project_top_down(v: Vec3, up_axis: Literal["Y", "Z"]) -> Vec2:
    """Project a 3D point to a top-down 2D view (removing the up axis)."""
    if up_axis == "Y":
        return Vec2(v.x, v.z)
    else:
        return Vec2(v.x, v.y)


# ---------------------------------------------------------------------------
# Floor-level detection
# ---------------------------------------------------------------------------

def _detect_floor_levels(
    faces: list[Face3D], up_axis: Literal["Y", "Z"]
) -> list[float]:
    """Detect floor elevations from large horizontal slab faces.

    Uses gap-based grouping: all slab elevations are sorted, and wherever
    the gap between consecutive elevations exceeds MIN_FLOOR_GAP (~2 m) a
    new floor level is created.  This correctly merges the many small slab
    panels that make up a single floor (different rooms, balconies, etc.)
    while keeping actually distinct stories separate (typically 2.5-3.5 m
    apart).
    """
    elevations: list[tuple[float, float]] = []  # (elevation, area)

    for face in faces:
        up_comp = abs(_get_up(face.normal, up_axis))
        if up_comp < (1.0 - HORIZONTAL_EPSILON):
            continue  # not horizontal
        area = _face_area(face)
        if area < MIN_SLAB_AREA:
            continue
        # Average up-coordinate of the face.
        elev = sum(_get_up(v, up_axis) for v in face.vertices) / len(face.vertices)
        elevations.append((elev, area))

    if not elevations:
        return []

    # Sort by elevation.
    elevations.sort(key=lambda t: t[0])

    # Gap-based grouping: split into floors wherever consecutive gap > MIN_FLOOR_GAP.
    groups: list[list[tuple[float, float]]] = [[elevations[0]]]
    for i in range(1, len(elevations)):
        if elevations[i][0] - elevations[i - 1][0] >= MIN_FLOOR_GAP:
            groups.append([])  # start a new floor
        groups[-1].append(elevations[i])

    # Area-weighted average elevation per group.
    levels: list[float] = []
    for group in groups:
        total_area = sum(a for _, a in group)
        avg = sum(e * a for e, a in group) / total_area
        levels.append(avg)

    levels.sort()
    return levels


# ---------------------------------------------------------------------------
# Section cut — intersect vertical faces with a horizontal plane
# ---------------------------------------------------------------------------

def _intersect_face_with_plane(
    face: Face3D,
    cut_elev: float,
    up_axis: Literal["Y", "Z"],
) -> list[tuple[Vec3, Vec3]]:
    """Intersect a face polygon with a horizontal plane at cut_elev."""
    verts = face.vertices
    n = len(verts)
    if n < 3:
        return []

    dists = [_get_up(v, up_axis) - cut_elev for v in verts]

    intersections: list[Vec3] = []
    for i in range(n):
        j = (i + 1) % n
        di, dj = dists[i], dists[j]

        if abs(di) < 1e-9:
            intersections.append(verts[i])
        elif (di > 0) != (dj > 0):
            t = di / (di - dj)
            vi, vj = verts[i], verts[j]
            px = vi.x + t * (vj.x - vi.x)
            py = vi.y + t * (vj.y - vi.y)
            pz = vi.z + t * (vj.z - vi.z)
            intersections.append(Vec3(px, py, pz))

    # Deduplicate very close points.
    unique: list[Vec3] = []
    for pt in intersections:
        is_dup = False
        for u in unique:
            if abs(pt.x - u.x) < 1e-6 and abs(pt.y - u.y) < 1e-6 and abs(pt.z - u.z) < 1e-6:
                is_dup = True
                break
        if not is_dup:
            unique.append(pt)

    if len(unique) >= 2:
        return [(unique[0], unique[1])]
    return []


# ---------------------------------------------------------------------------
# Main: extract floor plans
# ---------------------------------------------------------------------------

def _extract_with_axis(
    faces: list[Face3D], up_axis: Literal["Y", "Z"]
) -> list[FloorPlan]:
    """Extract floor plans for one up-axis assumption."""
    levels = _detect_floor_levels(faces, up_axis)
    if not levels:
        return []

    # --- Identify door groups (via OBJ group_name, not panel_id) ---
    door_group_names: set[str] = set()
    for face in faces:
        if face.group_name and is_door_group(face.group_name):
            door_group_names.add(face.group_name)

    # Group ALL door-group faces by name.
    door_faces_by_group: dict[str, list[Face3D]] = {}
    for face in faces:
        if face.group_name and face.group_name in door_group_names:
            door_faces_by_group.setdefault(face.group_name, []).append(face)

    # Vertical faces EXCLUDING doors.
    vertical_faces: list[Face3D] = []
    for face in faces:
        up_comp = abs(_get_up(face.normal, up_axis))
        if up_comp <= VERTICAL_EPSILON:
            if not face.group_name or face.group_name not in door_group_names:
                vertical_faces.append(face)

    if not vertical_faces and not door_faces_by_group:
        return []

    plans: list[FloorPlan] = []

    for floor_idx, floor_elev in enumerate(levels, start=1):
        cut_elev = floor_elev + CUT_HEIGHT

        # --- Wall section-cut (doors excluded) ---
        segments_3d: list[tuple[Vec3, Vec3]] = []
        for face in vertical_faces:
            ups = [_get_up(v, up_axis) for v in face.vertices]
            if min(ups) > cut_elev or max(ups) < cut_elev:
                continue
            segs = _intersect_face_with_plane(face, cut_elev, up_axis)
            segments_3d.extend(segs)

        # Project to 2D top-down view.
        segments_2d: list[tuple[Vec2, Vec2]] = []
        for p1, p2 in segments_3d:
            a = _project_top_down(p1, up_axis)
            b = _project_top_down(p2, up_axis)
            if abs(a.x - b.x) < 1e-6 and abs(a.y - b.y) < 1e-6:
                continue
            segments_2d.append((a, b))

        # --- Doors for this level ---
        raw_doors = extract_doors_for_level(door_faces_by_group, cut_elev, up_axis)

        if not segments_2d and not raw_doors:
            continue

        # Bounding box (include door points for safety).
        all_pts = [p for seg in segments_2d for p in seg]
        for d in raw_doors:
            all_pts.extend([d.hinge, d.leaf_end])

        if not all_pts:
            continue

        min_x = min(p.x for p in all_pts)
        min_y = min(p.y for p in all_pts)
        max_x = max(p.x for p in all_pts)
        max_y = max(p.y for p in all_pts)

        # Shift to origin.
        shifted: list[tuple[Vec2, Vec2]] = []
        for a, b in segments_2d:
            shifted.append((
                Vec2(a.x - min_x, a.y - min_y),
                Vec2(b.x - min_x, b.y - min_y),
            ))

        shifted_doors: list[Door2D] = []
        for d in raw_doors:
            shifted_doors.append(Door2D(
                hinge=Vec2(d.hinge.x - min_x, d.hinge.y - min_y),
                width=d.width,
                start_angle=d.start_angle,
                end_angle=d.end_angle,
                leaf_end=Vec2(d.leaf_end.x - min_x, d.leaf_end.y - min_y),
            ))

        plans.append(FloorPlan(
            label=f"Planta Piso {floor_idx}",
            segments=shifted,
            width=max_x - min_x,
            height=max_y - min_y,
            elevation=floor_elev,
            doors=shifted_doors,
        ))

    return plans


def extract_floor_plans(
    faces: list[Face3D], up_axis: Literal["Y", "Z"] | None = None
) -> list[FloorPlan]:
    """Extract floor plans, optionally using a pre-detected up axis.

    Returns one FloorPlan per detected floor level.
    """
    if not faces:
        return []

    if up_axis is not None:
        return _extract_with_axis(faces, up_axis)

    plans_z = _extract_with_axis(faces, "Z")
    plans_y = _extract_with_axis(faces, "Y")

    # Pick the axis that produces more floor plans (more segments).
    total_z = sum(len(p.segments) for p in plans_z)
    total_y = sum(len(p.segments) for p in plans_y)

    return plans_y if total_y > total_z else plans_z
