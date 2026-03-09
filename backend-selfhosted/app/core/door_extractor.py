"""
Door Extractor

Detects door components from OBJ groups and extracts their 2D floor-plan
representation: hinge point, width, swing direction, and arc angles.

Detection:
  1. Match group names containing "puerta", "door", or "porta" (case-insensitive).
  2. Analyse the 3D bounding box to determine door width and orientation.
  3. Infer swing direction from the dominant vertical-face normal.

Output: Door2D objects for rendering as architectural door symbols
(arc + leaf line) in floor-plan DXFs and PDFs.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Literal

from .types import Face3D, Vec2, Vec3, cross, length, sub

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_DOOR_NAME_RE = re.compile(r"puerta|door|porta", re.IGNORECASE)
_HINGE_RIGHT_RE = re.compile(r"_der|_right|_R\b", re.IGNORECASE)

MAX_DOOR_THICKNESS = 0.30   # metres
MIN_DOOR_WIDTH = 0.40       # metres
MAX_DOOR_WIDTH = 3.0        # metres


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class Door2D:
    """A door in a 2D floor plan with its swing-arc representation."""
    hinge: Vec2
    width: float
    start_angle: float   # degrees (DXF convention: CCW from +X)
    end_angle: float     # degrees
    leaf_end: Vec2       # endpoint of the door leaf in the open position


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def is_door_group(name: str) -> bool:
    """Check whether an OBJ group name looks like a door component."""
    return bool(_DOOR_NAME_RE.search(name))


def _get_up(v: Vec3, up: Literal["Y", "Z"]) -> float:
    return v.y if up == "Y" else v.z


def _project_top_down(v: Vec3, up: Literal["Y", "Z"]) -> Vec2:
    return Vec2(v.x, v.z) if up == "Y" else Vec2(v.x, v.y)


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


# ---------------------------------------------------------------------------
# Single-door analysis
# ---------------------------------------------------------------------------

def analyze_door_group(
    group_name: str,
    faces: list[Face3D],
    cut_elev: float,
    up: Literal["Y", "Z"],
) -> Door2D | None:
    """Analyse a group of faces representing a single door and return its
    2D plan-view representation, or ``None`` if the geometry doesn't look
    like a door."""
    if not faces:
        return None

    # Does the door span the section-cut elevation?
    all_verts = [v for f in faces for v in f.vertices]
    elevs = [_get_up(v, up) for v in all_verts]
    if min(elevs) > cut_elev or max(elevs) < cut_elev:
        return None

    # Project to 2D.
    pts = [_project_top_down(v, up) for v in all_verts]
    xs = [p.x for p in pts]
    ys = [p.y for p in pts]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    dx = max_x - min_x
    dy = max_y - min_y

    # Wall direction (longer axis) vs thickness (shorter axis).
    if dx >= dy:
        width, thickness = dx, dy
        mid_y = (min_y + max_y) / 2
        hinge_a = Vec2(min_x, mid_y)
        hinge_b = Vec2(max_x, mid_y)
    else:
        width, thickness = dy, dx
        mid_x = (min_x + max_x) / 2
        hinge_a = Vec2(mid_x, min_y)
        hinge_b = Vec2(mid_x, max_y)

    # Validate dimensions.
    if thickness > MAX_DOOR_THICKNESS:
        return None
    if width < MIN_DOOR_WIDTH or width > MAX_DOOR_WIDTH:
        return None

    # Swing direction from the largest vertical face normal.
    best_area = 0.0
    best_normal: Vec3 | None = None
    for face in faces:
        up_comp = abs(_get_up(face.normal, up))
        if up_comp > 0.5:
            continue
        area = _face_area(face)
        if area > best_area:
            best_area = area
            best_normal = face.normal

    if best_normal is None:
        return None

    raw_swing = _project_top_down(best_normal, up)
    swing_len = math.sqrt(raw_swing.x ** 2 + raw_swing.y ** 2)
    if swing_len < 0.01:
        return None
    swing_dir = Vec2(raw_swing.x / swing_len, raw_swing.y / swing_len)

    # Hinge selection.
    hinge_right = bool(_HINGE_RIGHT_RE.search(group_name))
    hinge = hinge_b if hinge_right else hinge_a
    free_end = hinge_a if hinge_right else hinge_b

    # DXF arc angles.
    to_free = Vec2(free_end.x - hinge.x, free_end.y - hinge.y)
    wall_angle = math.degrees(math.atan2(to_free.y, to_free.x))
    swing_angle = math.degrees(math.atan2(swing_dir.y, swing_dir.x))

    cross_val = to_free.x * swing_dir.y - to_free.y * swing_dir.x

    if cross_val >= 0:
        start_angle = wall_angle
        end_angle = swing_angle
    else:
        start_angle = swing_angle
        end_angle = wall_angle

    start_angle = start_angle % 360
    if start_angle < 0:
        start_angle += 360
    end_angle = end_angle % 360
    if end_angle < 0:
        end_angle += 360

    swing_rad = math.radians(swing_angle)
    leaf_end = Vec2(
        hinge.x + width * math.cos(swing_rad),
        hinge.y + width * math.sin(swing_rad),
    )

    return Door2D(
        hinge=hinge,
        width=width,
        start_angle=start_angle,
        end_angle=end_angle,
        leaf_end=leaf_end,
    )


# ---------------------------------------------------------------------------
# Batch extraction
# ---------------------------------------------------------------------------

def extract_doors_for_level(
    door_faces_by_group: dict[str, list[Face3D]],
    cut_elev: float,
    up: Literal["Y", "Z"],
) -> list[Door2D]:
    """Extract Door2D entries for a given section-cut elevation."""
    doors: list[Door2D] = []
    for name, group_faces in door_faces_by_group.items():
        door = analyze_door_group(name, group_faces, cut_elev, up)
        if door is not None:
            doors.append(door)
    return doors
