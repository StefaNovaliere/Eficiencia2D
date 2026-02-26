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

    Tries the largest file first; if it fails, tries other entries.
    Supports both STORED (method 0) and DEFLATE (method 8) entries.
    """
    entries: list[tuple[int, int, int, int, str]] = []
    pos = 0
    while pos + 30 < len(data):
        if data[pos:pos + 4] == b"PK\x03\x04":
            method = struct.unpack_from("<H", data, pos + 8)[0]
            comp_size = struct.unpack_from("<I", data, pos + 18)[0]
            uncomp_size = struct.unpack_from("<I", data, pos + 22)[0]
            name_len = struct.unpack_from("<H", data, pos + 26)[0]
            extra_len = struct.unpack_from("<H", data, pos + 28)[0]
            name = data[pos + 30:pos + 30 + name_len].decode("utf-8", errors="replace")
            data_start = pos + 30 + name_len + extra_len
            if method in (0, 8) and comp_size > 0:
                entries.append((method, comp_size, uncomp_size, data_start, name))
            pos = data_start + comp_size
        else:
            pos += 1

    # Sort by uncompressed size, largest first.
    entries.sort(key=lambda e: e[2], reverse=True)

    for method, comp_size, uncomp_size, data_start, name in entries:
        if data_start + comp_size > len(data):
            continue
        if method == 0:
            payload = data[data_start:data_start + uncomp_size]
            if len(payload) > 100:
                return payload
        else:
            try:
                payload = zlib.decompress(data[data_start:data_start + comp_size], -15)
                if len(payload) > 100:
                    return payload
            except zlib.error:
                # Try with default wbits as well.
                try:
                    payload = zlib.decompress(data[data_start:data_start + comp_size])
                    if len(payload) > 100:
                        return payload
                except zlib.error:
                    continue

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

    Also tries 16-bit count prefix for some format variants.
    """
    arrays: list[list[Vec3]] = []
    max_val = 1e6
    data_len = len(data)

    # Pass 1: Try 32-bit count prefix.
    off = 0
    while off + 4 < data_len:
        count = _read_i32(data, off)
        if count < 3 or count > 10000:
            off += 4
            continue

        block_size = count * 3 * 8
        start = off + 4
        if start + block_size > data_len:
            off += 4
            continue

        verts: list[Vec3] = []
        valid = True
        for i in range(count):
            base = start + i * 24
            x = _read_f64(data, base)
            y = _read_f64(data, base + 8)
            z = _read_f64(data, base + 16)

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

    # Pass 2: If we found very few arrays, try scanning for bare triplets
    # that look like face data (groups of exactly 3 or 4 sequential vertices).
    if len(arrays) < 3:
        off = 0
        while off + 72 <= data_len:  # need at least 3 * 24 bytes for a triangle
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
                    if off + 96 <= data_len:
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
                "El archivo no parece ser un .skp válido. "
                "Exporta como .obj desde SketchUp (Archivo → Exportar → Modelo 3D → OBJ)."
            ],
        )

    arrays = _scan_vertex_arrays(payload)

    if not arrays:
        warnings.append(
            "No se pudo extraer geometría del archivo .skp. "
            "Esto puede ocurrir con formatos comprimidos o versiones muy nuevas. "
            "Exporta como .obj desde SketchUp (Archivo → Exportar → Modelo 3D → OBJ)."
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
