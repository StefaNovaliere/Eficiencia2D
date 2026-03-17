"""
Contour Extractor

Extracts real 2D contours from a group of 3D faces after rotating them
to the XY plane. Detects exterior boundary, interior holes, and applies
kerf offset for laser cutting.

Pipeline:
  1. Rotate all face vertices to XY using the piece's weighted normal
  2. Find boundary edges (edges shared by exactly 1 face)
  3. Chain boundary edges into closed loops
  4. Classify loops: largest area = exterior, rest = interior holes
  5. Orient loops: exterior CCW, interior CW
  6. Apply kerf offset (inward for exterior, outward for interior)
"""

from __future__ import annotations

import math
from collections import defaultdict

from .types import Vec2

# ---------------------------------------------------------------------------
# Boundary edge detection
# ---------------------------------------------------------------------------

# Tolerance for snapping vertices to the same position.
_SNAP_TOL = 1e-6


def _snap_key(x: float, y: float) -> tuple[int, int]:
    """Quantize a 2D point to a grid for robust vertex matching."""
    scale = 1.0 / _SNAP_TOL
    return (round(x * scale), round(y * scale))


def extract_boundary_edges_2d(
    face_vertex_lists: list[list[tuple[float, float]]],
) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    """Find boundary edges from a set of 2D face polygons.

    A boundary edge appears in exactly one face. Internal edges are shared
    by two faces (with opposite winding).

    Parameters
    ----------
    face_vertex_lists : list of list of (x, y)
        Each inner list is one face's vertices projected to 2D.

    Returns
    -------
    List of ((x1,y1), (x2,y2)) edges that are on the boundary.
    """
    # Map snapped edge → list of original edges.
    # An edge (A, B) and (B, A) are the same undirected edge.
    edge_count: dict[tuple, list[tuple]] = defaultdict(list)

    for verts in face_vertex_lists:
        n = len(verts)
        for i in range(n):
            a = verts[i]
            b = verts[(i + 1) % n]
            ka = _snap_key(a[0], a[1])
            kb = _snap_key(b[0], b[1])
            # Canonical undirected key: smaller first.
            edge_key = (min(ka, kb), max(ka, kb))
            edge_count[edge_key].append((a, b))

    # Boundary edges: appear exactly once.
    boundary = []
    for key, edges in edge_count.items():
        if len(edges) == 1:
            boundary.append(edges[0])

    return boundary


# ---------------------------------------------------------------------------
# Edge chaining into closed loops
# ---------------------------------------------------------------------------

def chain_edges_into_loops(
    edges: list[tuple[tuple[float, float], tuple[float, float]]],
) -> list[list[tuple[float, float]]]:
    """Chain a set of edges into closed loops.

    Each edge is ((x1,y1), (x2,y2)). Returns a list of loops, where each
    loop is a list of (x, y) vertices in order.
    """
    if not edges:
        return []

    # Build adjacency: snapped_point → list of (original_point, other_end_original, edge_index)
    adj: dict[tuple[int, int], list[tuple[tuple[float, float], tuple[float, float], int]]] = defaultdict(list)
    for i, (a, b) in enumerate(edges):
        ka = _snap_key(a[0], a[1])
        kb = _snap_key(b[0], b[1])
        adj[ka].append((a, b, i))
        adj[kb].append((b, a, i))

    used = set()
    loops = []

    for start_idx, (a, b) in enumerate(edges):
        if start_idx in used:
            continue

        loop = [a]
        used.add(start_idx)
        current_key = _snap_key(b[0], b[1])
        loop.append(b)
        start_key = _snap_key(a[0], a[1])

        max_iters = len(edges) + 1
        for _ in range(max_iters):
            if current_key == start_key:
                # Loop closed.
                break

            # Find next edge from current_key.
            found = False
            for pt_self, pt_other, idx in adj[current_key]:
                if idx not in used:
                    used.add(idx)
                    loop.append(pt_other)
                    current_key = _snap_key(pt_other[0], pt_other[1])
                    found = True
                    break

            if not found:
                break  # Broken chain — skip.

        if len(loop) >= 3:
            # Remove last vertex if it matches start (the loop is implicitly closed).
            sk = _snap_key(loop[-1][0], loop[-1][1])
            if sk == start_key and len(loop) > 3:
                loop.pop()
            loops.append(loop)

    return loops


# ---------------------------------------------------------------------------
# Loop classification and orientation
# ---------------------------------------------------------------------------

def _signed_area(loop: list[tuple[float, float]]) -> float:
    """Signed area of a 2D polygon (shoelace formula).

    Positive = CCW, Negative = CW.
    """
    n = len(loop)
    area = 0.0
    for i in range(n):
        x1, y1 = loop[i]
        x2, y2 = loop[(i + 1) % n]
        area += x1 * y2 - x2 * y1
    return area / 2.0


def classify_and_orient_loops(
    loops: list[list[tuple[float, float]]],
) -> tuple[list[Vec2], list[list[Vec2]]]:
    """Classify loops into exterior (largest) and interior (holes).

    Orients exterior CCW and interiors CW (standard DXF convention for
    laser cutters — exterior path goes counter-clockwise, hole paths
    go clockwise).

    Returns (outer_contour, inner_loops) as Vec2 lists.
    """
    if not loops:
        return [], []

    # Find the loop with the largest absolute area — that's the exterior.
    areas = [_signed_area(loop) for loop in loops]
    abs_areas = [abs(a) for a in areas]
    max_idx = abs_areas.index(max(abs_areas))

    outer_raw = loops[max_idx]
    outer_area = areas[max_idx]

    # Ensure exterior is CCW (positive signed area).
    if outer_area < 0:
        outer_raw = list(reversed(outer_raw))

    outer = [Vec2(x, y) for x, y in outer_raw]

    # All other loops are interior — ensure CW (negative signed area).
    inners: list[list[Vec2]] = []
    for i, loop in enumerate(loops):
        if i == max_idx:
            continue
        if areas[i] > 0:
            # Currently CCW, need CW → reverse.
            loop = list(reversed(loop))
        inners.append([Vec2(x, y) for x, y in loop])

    return outer, inners


# ---------------------------------------------------------------------------
# Kerf offset
# ---------------------------------------------------------------------------

def offset_polygon(
    polygon: list[Vec2], distance: float
) -> list[Vec2]:
    """Offset a polygon inward (positive distance) or outward (negative).

    Uses vertex bisector method: at each vertex, compute the bisector of
    the two adjacent edge normals and shift the vertex along it.

    Parameters
    ----------
    polygon : list of Vec2
        Vertices in order (CCW for exterior, CW for interior).
    distance : float
        Positive = shrink (inward), negative = grow (outward).

    Returns
    -------
    Offset polygon as list of Vec2.
    """
    n = len(polygon)
    if n < 3:
        return polygon

    result: list[Vec2] = []

    for i in range(n):
        p_prev = polygon[(i - 1) % n]
        p_curr = polygon[i]
        p_next = polygon[(i + 1) % n]

        # Edge vectors.
        e1x = p_curr.x - p_prev.x
        e1y = p_curr.y - p_prev.y
        e2x = p_next.x - p_curr.x
        e2y = p_next.y - p_curr.y

        # Inward normals (left-side normals for CCW polygon).
        n1x, n1y = -e1y, e1x
        n2x, n2y = -e2y, e2x

        # Normalize.
        len1 = math.sqrt(n1x * n1x + n1y * n1y)
        len2 = math.sqrt(n2x * n2x + n2y * n2y)

        if len1 < 1e-12 or len2 < 1e-12:
            result.append(p_curr)
            continue

        n1x /= len1
        n1y /= len1
        n2x /= len2
        n2y /= len2

        # Bisector direction.
        bx = n1x + n2x
        by = n1y + n2y
        b_len = math.sqrt(bx * bx + by * by)

        if b_len < 1e-12:
            # Degenerate (parallel edges) — use single normal.
            result.append(Vec2(p_curr.x + n1x * distance, p_curr.y + n1y * distance))
            continue

        bx /= b_len
        by /= b_len

        # The offset distance along the bisector is distance / cos(half_angle).
        cos_half = n1x * bx + n1y * by
        if abs(cos_half) < 1e-6:
            cos_half = 1e-6  # Prevent division by near-zero.

        offset_dist = distance / cos_half

        # Clamp to prevent extreme offsets at very sharp angles.
        max_offset = abs(distance) * 4.0
        offset_dist = max(-max_offset, min(max_offset, offset_dist))

        result.append(Vec2(
            p_curr.x + bx * offset_dist,
            p_curr.y + by * offset_dist,
        ))

    return result


# ---------------------------------------------------------------------------
# High-level: extract piece contours from rotated faces
# ---------------------------------------------------------------------------

def extract_piece_contours(
    face_vertices_2d: list[list[tuple[float, float]]],
    kerf_mm: float = 0.0,
    scale_to_mm: float = 1.0,
) -> tuple[list[Vec2], list[list[Vec2]], list[Vec2], list[list[Vec2]]]:
    """Extract exterior and interior contours from rotated face polygons.

    Parameters
    ----------
    face_vertices_2d : list of list of (x, y)
        Each face's vertices already rotated to XY plane (in model units).
    kerf_mm : float
        Kerf compensation in mm. Applied as inward offset on exterior,
        outward offset on interior loops.
    scale_to_mm : float
        Factor to convert model units to mm.

    Returns
    -------
    (outer, inners, outer_kerf, inners_kerf)
        outer: exterior contour (Vec2, in mm)
        inners: interior loops (Vec2, in mm)
        outer_kerf: exterior with kerf offset applied
        inners_kerf: interior loops with kerf offset applied
    """
    # 1. Find boundary edges.
    boundary_edges = extract_boundary_edges_2d(face_vertices_2d)

    if not boundary_edges:
        return [], [], [], []

    # 2. Chain into loops.
    loops = chain_edges_into_loops(boundary_edges)

    if not loops:
        return [], [], [], []

    # 3. Classify and orient.
    outer, inners = classify_and_orient_loops(loops)

    if not outer:
        return [], [], [], []

    # 4. Scale to mm.
    outer_mm = [Vec2(v.x * scale_to_mm, v.y * scale_to_mm) for v in outer]
    inners_mm = [
        [Vec2(v.x * scale_to_mm, v.y * scale_to_mm) for v in loop]
        for loop in inners
    ]

    # 5. Apply kerf offset.
    if kerf_mm > 0:
        outer_kerf = offset_polygon(outer_mm, kerf_mm)       # Shrink exterior.
        inners_kerf = [
            offset_polygon(loop, -kerf_mm)                    # Grow interior holes.
            for loop in inners_mm
        ]
    else:
        outer_kerf = list(outer_mm)
        inners_kerf = [list(loop) for loop in inners_mm]

    return outer_mm, inners_mm, outer_kerf, inners_kerf
