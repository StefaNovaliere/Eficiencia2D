"""
Shared geometry types for the Eficiencia2D processing pipeline.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field


@dataclass
class Vec3:
    x: float
    y: float
    z: float


@dataclass
class Vec2:
    x: float
    y: float


@dataclass
class Loop2D:
    vertices: list[Vec2]


@dataclass
class Face3D:
    vertices: list[Vec3]
    normal: Vec3
    inner_loops: list[list[Vec3]] = field(default_factory=list)


@dataclass
class Facade:
    """One elevation view of the building (e.g. North, South, East, West).

    Contains all projected 2D polygons visible from that direction,
    positioned in their correct relative locations.
    """
    label: str                  # "Fachada Norte", "Fachada Este", etc.
    direction: Vec3             # Outward normal of the facade plane
    polygons: list[Loop2D]      # Projected face outlines in local 2D
    width: float                # Overall bounding box width (model units)
    height: float               # Overall bounding box height (model units)


@dataclass
class Segment2D:
    """A line segment in 2D space."""
    a: Vec2
    b: Vec2


@dataclass
class FloorPlan:
    """Top-down plan view of the building showing wall outlines.

    Each vertical face in the 3D model projects to a line segment
    when viewed from above.
    """
    label: str                  # "Planta"
    segments: list[Segment2D]   # Wall outlines as line segments
    width: float                # Bounding box width (model units)
    height: float               # Bounding box height (model units)


# --- Vector math helpers ---


def sub(a: Vec3, b: Vec3) -> Vec3:
    return Vec3(a.x - b.x, a.y - b.y, a.z - b.z)


def add(a: Vec3, b: Vec3) -> Vec3:
    return Vec3(a.x + b.x, a.y + b.y, a.z + b.z)


def scale(v: Vec3, s: float) -> Vec3:
    return Vec3(v.x * s, v.y * s, v.z * s)


def dot(a: Vec3, b: Vec3) -> float:
    return a.x * b.x + a.y * b.y + a.z * b.z


def cross(a: Vec3, b: Vec3) -> Vec3:
    return Vec3(
        a.y * b.z - a.z * b.y,
        a.z * b.x - a.x * b.z,
        a.x * b.y - a.y * b.x,
    )


def length(v: Vec3) -> float:
    return math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)


def normalize(v: Vec3) -> Vec3:
    ln = length(v)
    if ln < 1e-12:
        return Vec3(0.0, 0.0, 0.0)
    return Vec3(v.x / ln, v.y / ln, v.z / ln)
