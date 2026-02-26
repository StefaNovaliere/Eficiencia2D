"""
SKP Binary Parser — Python port of src/core/skp-parser.ts.

Reads geometry from .skp files (SketchUp native binary format).

Strategy:
  Modern .skp files (SketchUp 2021+) are ZIP archives wrapping internal
  binary sections.  Older files use the raw binary format directly.
  In both cases, geometry is stored as serialized entities containing
  vertex positions (double triplets) and face/loop index structures.

  This parser scans the binary for vertex arrays and face definitions
  using structural pattern matching on the section headers.  It handles
  the most common .skp layouts but is NOT a full SDK-level parser.
  For files it cannot handle, the UI falls back to .obj upload.
"""

from __future__ import annotations

import struct
import zlib
from dataclasses import dataclass, field

from .types import Face3D, Vec3, cross, normalize, sub

INCHES_TO_M = 0.0254


@dataclass
class SkpParseResult:
    faces: list[Face3D]
    version: str
    warnings: list[str] = field(default_factory=list)


def _is_zip(data: bytes) -> bool:
    return len(data) >= 4 and data[:4] == b"PK\x03\x04"


def _is_skp_magic(data: bytes) -> bool:
    return len(data) >= 3 and data[:3] == b"\xff\xfe\xff"


def _unzip_skp_payload(data: bytes) -> bytes:
    """Extract the inner binary payload from a ZIP-wrapped .skp.

    We look for the largest embedded file (the model data).
    Supports both STORED (method 0) and DEFLATE (method 8) entries.
    """
    entries: list[tuple[int, int, int, int]] = []  # (method, comp_size, uncomp_size, data_start)
    pos = 0
    while pos + 30 < len(data):
        if data[pos:pos + 4] == b"PK\x03\x04":
            method = struct.unpack_from("<H", data, pos + 8)[0]
            comp_size = struct.unpack_from("<I", data, pos + 18)[0]
            uncomp_size = struct.unpack_from("<I", data, pos + 22)[0]
            name_len = struct.unpack_from("<H", data, pos + 26)[0]
            extra_len = struct.unpack_from("<H", data, pos + 28)[0]
            data_start = pos + 30 + name_len + extra_len
            if method in (0, 8):
                entries.append((method, comp_size, uncomp_size, data_start))
            pos = data_start + comp_size
        else:
            pos += 1

    best = max(entries, key=lambda e: e[2], default=None)
    if best is not None:
        method, comp_size, uncomp_size, data_start = best
        if data_start + comp_size <= len(data):
            if method == 0:
                return data[data_start:data_start + uncomp_size]
            # DEFLATE
            try:
                return zlib.decompress(data[data_start:data_start + comp_size], -15)
            except zlib.error:
                pass

    return data


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
    """
    arrays: list[list[Vec3]] = []
    max_val = 1e6
    off = 0
    length = len(data)

    while off + 4 < length:
        count = _read_i32(data, off)
        if count < 3 or count > 10000:
            off += 4
            continue

        block_size = count * 3 * 8
        start = off + 4
        if start + block_size > length:
            off += 4
            continue

        verts: list[Vec3] = []
        valid = True
        for i in range(count):
            x = _read_f64(data, start + i * 24)
            y = _read_f64(data, start + i * 24 + 8)
            z = _read_f64(data, start + i * 24 + 16)

            if not (
                x == x and y == y and z == z  # not NaN
                and abs(x) <= max_val and abs(y) <= max_val and abs(z) <= max_val
            ):
                valid = False
                break
            verts.append(Vec3(x * INCHES_TO_M, y * INCHES_TO_M, z * INCHES_TO_M))

        if valid and len(verts) >= 3:
            e1 = sub(verts[1], verts[0])
            e2 = sub(verts[2], verts[0])
            n = cross(e1, e2)
            n_len = (n.x * n.x + n.y * n.y + n.z * n.z) ** 0.5
            if n_len > 1e-10:
                arrays.append(verts)
                off = start + block_size
                continue

        off += 4

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
    """Parse a .skp file buffer and extract Face3D geometry.

    This is a best-effort heuristic parser.  For files it cannot read,
    ``faces`` will be empty and ``warnings`` will explain.
    """
    warnings: list[str] = []

    payload = data
    version = "unknown"

    if _is_zip(data):
        version = "zip-wrapped (SketchUp 2021+)"
        payload = _unzip_skp_payload(data)
        if payload is data:
            warnings.append("ZIP extraction found no usable entries; trying raw parse.")
    elif _is_skp_magic(data):
        version = "legacy binary"
    else:
        return SkpParseResult(
            faces=[],
            version="unrecognised",
            warnings=[
                "File does not appear to be a valid .skp file. "
                "Try exporting as .obj from SketchUp."
            ],
        )

    arrays = _scan_vertex_arrays(payload)

    if not arrays:
        warnings.append(
            "Could not extract geometry from the .skp binary. "
            "This can happen with compressed or very new format versions. "
            "Try exporting as .obj from SketchUp (File -> Export -> 3D Model -> OBJ)."
        )
        return SkpParseResult(faces=[], version=version, warnings=warnings)

    faces = _vertex_arrays_to_faces(arrays)
    return SkpParseResult(faces=faces, version=version, warnings=warnings)
