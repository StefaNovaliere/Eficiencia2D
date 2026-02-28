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
    panel_id: str | None = None  # Reference ID carried from Face3D


@dataclass
class Face3D:
    vertices: list[Vec3]
    normal: Vec3
    inner_loops: list[list[Vec3]] = field(default_factory=list)
    panel_id: str | None = None  # Set by decomposition (e.g. "A1", "B2")


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
class PanelInfo:
    """A single panel in the decomposition with a reference ID."""
    ref_id: str          # "A1", "A2", "B1", etc.
    outline: Loop2D      # Positioned rectangle on the layout sheet
    width: float         # Panel width in model units
    height: float        # Panel height in model units


@dataclass
class ComponentSheet:
    """A sheet showing decomposed panels of one type laid out together.

    Used for the cutting sheet / decomposition view:
      - "Descomposicion Paredes" — all wall panels with ref IDs
      - "Descomposicion Pisos"   — all floor slab panels with ref IDs
    """
    label: str                  # "Descomposicion Paredes", etc.
    panels: list[PanelInfo]     # Each panel with ref_id, outline, dimensions
    width: float                # Overall bounding box width
    height: float               # Overall bounding box height


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
