"""
OBJ Parser

Parses Wavefront .obj text format -- the reliable fallback.
SketchUp exports .obj natively: File -> Export -> 3D Model -> OBJ.

This parser handles:
  - v  (vertex positions)
  - f  (faces, including n-gon faces with > 3 vertices)
  - g/o (group names -- used as labels)
  - Negative vertex indices
  - Faces with vertex/texture/normal index formats (v, v/vt, v/vt/vn, v//vn)

OBJ files have no standard unit. Coordinates are read as-is (no conversion).
The pipeline handles unit/scale detection separately.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .types import Face3D, Vec3, cross, normalize, sub

# Safety limit: cap face count to prevent OOM on large models.
# 100K faces is enough for any realistic building; beyond that it's likely
# furniture, fixtures, or over-tessellated geometry.
MAX_FACES = 100_000


@dataclass
class ObjParseResult:
    faces: list[Face3D]
    warnings: list[str] = field(default_factory=list)


def parse_obj(text: str) -> ObjParseResult:
    warnings: list[str] = []
    vertices: list[Vec3] = []
    faces: list[Face3D] = []
    total_faces_in_file = 0

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line[0] == "#":
            continue

        parts = line.split()
        keyword = parts[0]

        if keyword == "v":
            try:
                x = float(parts[1])
                y = float(parts[2])
                z = float(parts[3])
            except (IndexError, ValueError):
                continue
            if math.isfinite(x) and math.isfinite(y) and math.isfinite(z):
                vertices.append(Vec3(x, y, z))

        elif keyword == "f":
            total_faces_in_file += 1

            if len(faces) >= MAX_FACES:
                continue  # keep counting total but stop storing

            idx_list: list[int] = []
            for i in range(1, len(parts)):
                token = parts[i].split("/")[0]
                try:
                    idx = int(token)
                except ValueError:
                    continue
                # OBJ indices are 1-based; negative = relative to end.
                if idx < 0:
                    idx = len(vertices) + idx + 1
                idx_list.append(idx - 1)  # convert to 0-based

            if len(idx_list) < 3:
                continue

            face_verts: list[Vec3] = []
            valid = True
            for idx in idx_list:
                if idx < 0 or idx >= len(vertices):
                    valid = False
                    break
                face_verts.append(vertices[idx])
            if not valid or len(face_verts) < 3:
                continue

            e1 = sub(face_verts[1], face_verts[0])
            e2 = sub(face_verts[2], face_verts[0])
            normal = normalize(cross(e1, e2))

            faces.append(Face3D(vertices=face_verts, normal=normal))

    if not faces:
        warnings.append("No faces found in the .obj file.")
    elif total_faces_in_file > MAX_FACES:
        warnings.append(
            f"Modelo muy grande ({total_faces_in_file:,} caras). "
            f"Se procesaron las primeras {MAX_FACES:,} para evitar timeout. "
            "Considera simplificar el modelo en SketchUp (eliminar muebles, "
            "fixtures y detalles internos)."
        )

    return ObjParseResult(faces=faces, warnings=warnings)
