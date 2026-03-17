"""
Geometry Classifier

Classifies groups of 3D faces by geometric type and provides
rotation utilities for flattening pieces to their local 2D plane.

Classification types:
  - FLAT_PANEL: all vertices coplanar (tolerance < 0.001 units)
  - SINGLE_CURVATURE: developable surface (cylinder, arc)
  - DOUBLE_CURVATURE: non-developable (dome, NURBS approx) — emits warning
  - SOLID_3D: faces on multiple unrelated planes — decompose individually
"""

from __future__ import annotations

import math

import numpy as np

from .types import Face3D, PieceType, Vec3, cross, dot, length, normalize, sub


# ---------------------------------------------------------------------------
# Area-weighted average normal
# ---------------------------------------------------------------------------

def _face_area_and_normal(face: Face3D) -> tuple[float, Vec3]:
    """Return (area, normal) for a face using cross-product method."""
    verts = face.vertices
    if len(verts) < 3:
        return 0.0, Vec3(0.0, 0.0, 0.0)
    total = Vec3(0.0, 0.0, 0.0)
    for i in range(1, len(verts) - 1):
        e1 = sub(verts[i], verts[0])
        e2 = sub(verts[i + 1], verts[0])
        c = cross(e1, e2)
        total = Vec3(total.x + c.x, total.y + c.y, total.z + c.z)
    area = length(total) / 2.0
    n = normalize(total)
    return area, n


def compute_weighted_normal(faces: list[Face3D]) -> Vec3:
    """Compute area-weighted average normal of a group of faces."""
    wx = wy = wz = 0.0
    for face in faces:
        area, n = _face_area_and_normal(face)
        wx += n.x * area
        wy += n.y * area
        wz += n.z * area
    return normalize(Vec3(wx, wy, wz))


# ---------------------------------------------------------------------------
# Best-fit plane via covariance (numpy)
# ---------------------------------------------------------------------------

def fit_plane(vertices: list[Vec3]) -> tuple[Vec3, float]:
    """Fit a plane to vertices using SVD on the covariance matrix.

    Returns (normal, max_distance) where max_distance is the maximum
    distance of any vertex to the best-fit plane.
    """
    if len(vertices) < 3:
        return Vec3(0.0, 0.0, 1.0), 0.0

    pts = np.array([[v.x, v.y, v.z] for v in vertices], dtype=np.float64)
    centroid = pts.mean(axis=0)
    centered = pts - centroid

    # SVD of centered points — the normal is the singular vector
    # corresponding to the smallest singular value.
    _, s, vh = np.linalg.svd(centered, full_matrices=False)
    normal_np = vh[2]  # last row = smallest singular value direction

    # Ensure consistent orientation.
    if normal_np[2] < 0:
        normal_np = -normal_np

    normal = Vec3(float(normal_np[0]), float(normal_np[1]), float(normal_np[2]))

    # Max distance from any vertex to the plane.
    d = float(np.dot(centroid, normal_np))
    distances = np.abs(pts @ normal_np - d)
    max_dist = float(distances.max())

    return normal, max_dist


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------

PLANARITY_TOLERANCE = 0.001  # units — max distance to best-fit plane for flat


def classify_piece(faces: list[Face3D]) -> PieceType:
    """Classify a group of faces by geometric type.

    Uses two signals:
      1. Planarity: are all vertices coplanar?
      2. Normal variance: how much do face normals vary?
    """
    if not faces:
        return PieceType.FLAT_PANEL

    # Collect all vertices.
    all_verts: list[Vec3] = []
    for face in faces:
        all_verts.extend(face.vertices)

    if len(all_verts) < 3:
        return PieceType.FLAT_PANEL

    # Check planarity.
    _, max_dist = fit_plane(all_verts)
    if max_dist < PLANARITY_TOLERANCE:
        return PieceType.FLAT_PANEL

    # Analyze normal variance to distinguish curvature types.
    normals = []
    for face in faces:
        _, n = _face_area_and_normal(face)
        if length(n) > 0.5:
            normals.append(n)

    if len(normals) < 2:
        return PieceType.FLAT_PANEL

    # Compute covariance of normals to check spread.
    n_arr = np.array([[n.x, n.y, n.z] for n in normals], dtype=np.float64)
    n_mean = n_arr.mean(axis=0)
    centered = n_arr - n_mean
    cov = (centered.T @ centered) / len(normals)
    eigenvalues = np.linalg.eigvalsh(cov)
    eigenvalues = np.sort(eigenvalues)[::-1]  # descending

    # If normals vary significantly in 2+ directions → double curvature.
    # If normals vary in mainly 1 direction → single curvature.
    # If multiple distinct planes → solid 3D.

    total_var = eigenvalues.sum()
    if total_var < 1e-6:
        return PieceType.FLAT_PANEL

    # Check if faces form multiple distinct planes (solid).
    # A solid has faces pointing in very different directions.
    min_dot = 1.0
    avg_normal = compute_weighted_normal(faces)
    for n in normals:
        d = abs(dot(n, avg_normal))
        min_dot = min(min_dot, d)

    if min_dot < 0.3:
        # Faces point in very different directions — likely a solid.
        return PieceType.SOLID_3D

    # Ratio of second eigenvalue to first distinguishes single vs double curvature.
    ratio = eigenvalues[1] / eigenvalues[0] if eigenvalues[0] > 1e-8 else 0.0

    if ratio < 0.1:
        return PieceType.SINGLE_CURVATURE
    else:
        return PieceType.DOUBLE_CURVATURE


# ---------------------------------------------------------------------------
# Rodrigues rotation matrix (numpy)
# ---------------------------------------------------------------------------

def rotation_matrix_to_z(normal: Vec3) -> np.ndarray:
    """Compute 3x3 rotation matrix that aligns `normal` with the Z axis.

    Uses Rodrigues' rotation formula.
    """
    n = np.array([normal.x, normal.y, normal.z], dtype=np.float64)
    n_len = np.linalg.norm(n)
    if n_len < 1e-12:
        return np.eye(3)
    n = n / n_len

    z = np.array([0.0, 0.0, 1.0])

    if np.allclose(n, z):
        return np.eye(3)
    if np.allclose(n, -z):
        return np.diag([1.0, -1.0, -1.0])

    axis = np.cross(n, z)
    axis = axis / np.linalg.norm(axis)
    angle = np.arccos(np.clip(np.dot(n, z), -1.0, 1.0))

    K = np.array([
        [0, -axis[2], axis[1]],
        [axis[2], 0, -axis[0]],
        [-axis[1], axis[0], 0],
    ])

    return np.eye(3) + np.sin(angle) * K + (1 - np.cos(angle)) * (K @ K)


def rotate_vertices_to_xy(
    vertices: list[Vec3], normal: Vec3
) -> list[tuple[float, float, float]]:
    """Rotate vertices so that the piece's local plane becomes the XY plane.

    Returns list of (x, y, z) tuples after rotation. The z values should
    be near-zero for flat panels.
    """
    R = rotation_matrix_to_z(normal)
    pts = np.array([[v.x, v.y, v.z] for v in vertices], dtype=np.float64)
    rotated = (R @ pts.T).T
    return [(float(r[0]), float(r[1]), float(r[2])) for r in rotated]
