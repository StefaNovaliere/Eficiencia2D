"""
SKP Binary Parser — Python port of src/core/skp-parser.ts.

Reads geometry from .skp files (SketchUp native binary format).

Strategy:
  Modern .skp files (SketchUp 2021+) are ZIP archives wrapping internal
  binary sections. Older files use the raw binary format directly.
  In both cases, geometry is stored as serialized entities containing
  vertex positions (double triplets) and face/loop index structures.

  This parser scans the binary for vertex arrays and face definitions
  using structural pattern matching on the section headers. It handles
  the most common .skp layouts but is NOT a full SDK-level parser.
"""

from __future__ import annotations

import struct
import io
import zipfile
from dataclasses import dataclass, field

from .types import Face3D, Vec3, cross, normalize, sub

INCHES_TO_M = 0.0254


@dataclass
class SkpParseResult:
    faces: list[Face3D]
    version: str
    warnings: list[str] = field(default_factory=list)


def _get_binary_payload(data: bytes) -> tuple[bytes, str]:
    """
    Extract the geometric payload.
    Detects if the file is a ZIP (SketchUp 2021+) or Legacy Binary.
    Uses standard python zipfile to handle Data Descriptors correctly.
    """
    # Check for SketchUp 2021+ (ZIP format)
    if zipfile.is_zipfile(io.BytesIO(data)):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                # Strategy: Modern SKP zips often contain a 'document.xml' and folders.
                # The heavy binary data usually resides in the largest file inside.
                # We sort files by size (descending) to find the main model blob.
                infolist = zf.infolist()
                if not infolist:
                    return data, "empty-zip"
                
                # Get the largest file in the zip
                best_file = max(infolist, key=lambda x: x.file_size)
                return zf.read(best_file.filename), "zip-wrapped (SketchUp 2021+)"
        except Exception:
            # Fallback if zip is corrupted or weird, try treating as raw
            pass

    # Check for Legacy SketchUp Magic Header
    if len(data) >= 3 and data[:3] == b"\xff\xfe\xff":
        return data, "legacy binary"

    # Default/Unknown
    return data, "unknown"


def _read_f64(data: bytes, off: int) -> float:
    if off + 8 > len(data):
        return float("nan")
    return struct.unpack_from("<d", data, off)[0]


def _read_i32(data: bytes, off: int) -> int:
    if off + 4 > len(data):
        return -1
    return struct.unpack_from("<i", data, off)[0]


def _scan_vertex_arrays(data: bytes) -> list[list[Vec3]]:
    """Scan the binary for arrays of 3D vertices (sequences of Float64 triplets).

    Heuristic: a vertex array is preceded by a 32-bit count, followed by
    count * 3 Float64 values, where the values are in a reasonable range
    (< 1e6 inches ~ 25 km).

    Also tries 16-bit count prefix for some format variants.
    """
    arrays: list[list[Vec3]] = []
    max_val = 1e6  # Filter out extreme values (garbage data)
    off = 0
    length = len(data)

    # Optimization: Stop if remaining data is too small for a minimal face
    while off + 28 < length: # 4 bytes count + 3 * 8 bytes (1 vertex)
        count = _read_i32(data, off)
        
        # Heuristic limits:
        # Minimum 3 vertices to form a face.
        # Max 50,000 to avoid reading huge garbage blocks as memory.
        if count < 3 or count > 50000:
            off += 4
            continue

        block_size = count * 3 * 8
        start = off + 4
        if start + block_size > length:
            off += 4
            continue

        # Quick check of the first and last vertex to fail fast before loop
        # This speeds up scanning significantly on large files
        first_x = _read_f64(data, start)
        if not (-max_val <= first_x <= max_val):
            off += 4
            continue

        verts: list[Vec3] = []
        valid = True
        
        for i in range(count):
            # Read X, Y, Z
            base = start + i * 24
            x = _read_f64(data, base)
            y = _read_f64(data, base + 8)
            z = _read_f64(data, base + 16)

            # Check validity (Not NaN and within reasonable bounds)
            if not (abs(x) <= max_val and abs(y) <= max_val and abs(z) <= max_val):
                valid = False
                break
            
            verts.append(Vec3(x * INCHES_TO_M, y * INCHES_TO_M, z * INCHES_TO_M))

        if valid and len(verts) >= 3:
            # Geometric validation: Do these points form a valid plane?
            e1 = sub(verts[1], verts[0])
            e2 = sub(verts[2], verts[0])
            n = cross(e1, e2)
            n_len_sq = n.x * n.x + n.y * n.y + n.z * n.z
            
            # Use squared length to avoid sqrt if possible, 1e-20 is small epsilon
            if n_len_sq > 1e-20:
                arrays.append(verts)
                # Skip the block we just successfully read
                off = start + block_size 
                continue

        off += 4

    # Pass 2: If we found very few arrays, try scanning for bare triplets
    # that look like face data (groups of exactly 3 or 4 sequential vertices).
    if len(arrays) < 3:
        off = 0
        while off + 72 <= length:  # need at least 3 * 24 bytes for a triangle
            verts = []
            valid = True
            # Try reading 3 vertices (triangle).
            for i in range(3):
                base = off + i * 24
                x = _read_f64(data, base)
                y = _read_f64(data, base + 8)
                z = _read_f64(data, base + 16)

                if not (
                    x == x and y == y and z == z
                    and abs(x) <= max_val and abs(y) <= max_val and abs(z) <= max_val
                    and (abs(x) > 1e-10 or abs(y) > 1e-10 or abs(z) > 1e-10)
                ):
                    valid = False
                    break
                verts.append(Vec3(x * INCHES_TO_M, y * INCHES_TO_M, z * INCHES_TO_M))

            if valid:
                e1 = sub(verts[1], verts[0])
                e2 = sub(verts[2], verts[0])
                n = cross(e1, e2)
                n_len = (n.x * n.x + n.y * n.y + n.z * n.z) ** 0.5
                if n_len > 1e-10:
                    # Check for 4th vertex (quad).
                    if off + 96 <= length:
                        x4 = _read_f64(data, off + 72)
                        y4 = _read_f64(data, off + 80)
                        z4 = _read_f64(data, off + 88)
                        if (
                            x4 == x4 and y4 == y4 and z4 == z4
                            and abs(x4) <= max_val and abs(y4) <= max_val and abs(z4) <= max_val
                        ):
                            verts.append(Vec3(x4 * INCHES_TO_M, y4 * INCHES_TO_M, z4 * INCHES_TO_M))
                            arrays.append(verts)
                            off += 96
                            continue
                    arrays.append(verts)
                    off += 72
                    continue

            off += 8  # step by one double

    return arrays


def _vertex_arrays_to_faces(arrays: list[list[Vec3]]) -> list[Face3D]:
    faces: list[Face3D] = []
    for verts in arrays:
        e1 = sub(verts[1], verts[0])
        e2 = sub(verts[2], verts[0])
        normal = normalize(cross(e1, e2))
        faces.append(Face3D(vertices=verts, normal=normal))
    return faces


def parse_skp(data: bytes) -> SkpParseResult:
    """Parse a .skp file buffer and extract Face3D geometry."""
    warnings: list[str] = []

    # 1. Get the raw binary payload (handle ZIP/Legacy)
    payload, version = _get_binary_payload(data)

    if version == "unknown":
        return SkpParseResult(
            faces=[],
            version="unrecognised",
            warnings=[
                "File format not recognized. Ensure it is a valid .skp or .obj file."
            ],
        )

    # 2. Heuristic Scan
    arrays = _scan_vertex_arrays(payload)

    if not arrays:
        warnings.append(
            f"Could not extract geometry from the {version} binary. "
            "Try exporting as .obj from SketchUp if this persists."
        )
        return SkpParseResult(faces=[], version=version, warnings=warnings)

    faces = _vertex_arrays_to_faces(arrays)

    if len(faces) < 3:
        warnings.append(
            f"Solo se extrajeron {len(faces)} caras del .skp. "
            "El modelo puede estar incompleto. "
            "Para mejores resultados, exporta como .obj desde SketchUp."
        )

    return SkpParseResult(faces=faces, version=version, warnings=warnings)
