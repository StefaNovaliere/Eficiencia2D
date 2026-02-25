// ============================================================================
// SKP Binary Parser
//
// Reads geometry from .skp files (SketchUp native binary format).
//
// Strategy:
//   Modern .skp files (SketchUp 2021+) are ZIP archives wrapping internal
//   binary sections.  Older files use the raw binary format directly.
//   In both cases, geometry is stored as serialized entities containing
//   vertex positions (double triplets) and face/loop index structures.
//
//   This parser scans the binary for vertex arrays and face definitions
//   using structural pattern matching on the section headers.  It handles
//   the most common .skp layouts but is NOT a full SDK-level parser.
//   For files it cannot handle, the UI falls back to .obj upload.
// ============================================================================

import pako from "pako";
import { type Face3D, type Vec3, cross, normalize, sub } from "./types";

/** Inches to metres conversion. */
const INCHES_TO_M = 0.0254;

/** Detect if the buffer is a ZIP archive (PK header). */
function isZip(buf: ArrayBuffer): boolean {
  const u8 = new Uint8Array(buf, 0, 4);
  return u8[0] === 0x50 && u8[1] === 0x4b && u8[2] === 0x03 && u8[3] === 0x04;
}

/** Detect .skp magic: starts with FF FE FF. */
function isSkpMagic(buf: ArrayBuffer): boolean {
  const u8 = new Uint8Array(buf, 0, 4);
  return u8[0] === 0xff && u8[1] === 0xfe && u8[2] === 0xff;
}

/** Read a little-endian Float64 from a DataView (safe). */
function readF64(dv: DataView, off: number): number {
  if (off + 8 > dv.byteLength) return NaN;
  return dv.getFloat64(off, true);
}

/** Read a little-endian Int32 from a DataView (safe). */
function readI32(dv: DataView, off: number): number {
  if (off + 4 > dv.byteLength) return -1;
  return dv.getInt32(off, true);
}

/** Represents a candidate ZIP entry with its raw data and metadata. */
interface ZipEntry {
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  dataStart: number;
}

/**
 * Extract the inner binary payload from a ZIP-wrapped .skp.
 * We look for the largest embedded file (the model data).
 * Supports both STORED (method 0) and DEFLATE (method 8) entries.
 */
function unzipSkpPayload(buf: ArrayBuffer): ArrayBuffer {
  const u8 = new Uint8Array(buf);

  // Simple ZIP local-file-header scanner.
  // We find all embedded files and pick the largest (the model binary).
  const entries: ZipEntry[] = [];
  let pos = 0;

  while (pos + 30 < u8.length) {
    // Local file header signature: PK\x03\x04
    if (u8[pos] === 0x50 && u8[pos + 1] === 0x4b &&
        u8[pos + 2] === 0x03 && u8[pos + 3] === 0x04) {
      const dv = new DataView(buf, pos, 30);
      const method = dv.getUint16(8, true);
      const compressedSize = dv.getUint32(18, true);
      const uncompressedSize = dv.getUint32(22, true);
      const nameLen = dv.getUint16(26, true);
      const extraLen = dv.getUint16(28, true);
      const dataStart = pos + 30 + nameLen + extraLen;

      if (method === 0 || method === 8) {
        entries.push({ method, compressedSize, uncompressedSize, dataStart });
      }

      pos = dataStart + compressedSize;
    } else {
      pos++;
    }
  }

  // Pick the entry with the largest uncompressed size (the model binary).
  let best: ZipEntry | null = null;
  for (const entry of entries) {
    if (!best || entry.uncompressedSize > best.uncompressedSize) {
      best = entry;
    }
  }

  if (best && best.dataStart + best.compressedSize <= buf.byteLength) {
    if (best.method === 0) {
      // STORED — uncompressed data, just slice it out.
      return buf.slice(best.dataStart, best.dataStart + best.uncompressedSize);
    }

    // DEFLATE — decompress using pako.
    const compressed = new Uint8Array(buf, best.dataStart, best.compressedSize);
    try {
      const inflated = pako.inflateRaw(compressed);
      return inflated.buffer.slice(
        inflated.byteOffset,
        inflated.byteOffset + inflated.byteLength,
      );
    } catch {
      // Decompression failed — fall through to raw buffer.
    }
  }

  // If we couldn't extract, return the whole buffer and hope it's parseable.
  return buf;
}

/**
 * Scan the binary for arrays of 3D vertices (sequences of Float64 triplets)
 * that look like plausible geometry.
 *
 * Heuristic: a vertex array is preceded by a 32-bit count, followed by
 * count * 3 Float64 values, where the values are in a reasonable range
 * (< 1e6 inches ≈ 25 km).
 */
function scanVertexArrays(dv: DataView): Vec3[][] {
  const arrays: Vec3[][] = [];
  const maxVal = 1e6; // max coordinate in inches

  for (let off = 0; off + 4 < dv.byteLength; off += 4) {
    const count = readI32(dv, off);
    if (count < 3 || count > 10000) continue;

    const blockSize = count * 3 * 8;
    const start = off + 4;
    if (start + blockSize > dv.byteLength) continue;

    // Verify all values are plausible doubles.
    let valid = true;
    const verts: Vec3[] = [];
    for (let i = 0; i < count && valid; i++) {
      const x = readF64(dv, start + i * 24);
      const y = readF64(dv, start + i * 24 + 8);
      const z = readF64(dv, start + i * 24 + 16);

      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) { valid = false; break; }
      if (Math.abs(x) > maxVal || Math.abs(y) > maxVal || Math.abs(z) > maxVal) {
        valid = false; break;
      }
      verts.push({ x: x * INCHES_TO_M, y: y * INCHES_TO_M, z: z * INCHES_TO_M });
    }

    if (valid && verts.length >= 3) {
      // Check that the vertices form a roughly planar polygon.
      // Compute normal from first 3 vertices.
      const e1 = sub(verts[1], verts[0]);
      const e2 = sub(verts[2], verts[0]);
      const n = cross(e1, e2);
      const nLen = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
      if (nLen > 1e-10) {
        arrays.push(verts);
        // Skip past the data we just consumed.
        off = start + blockSize - 4; // -4 because the loop does +=4
      }
    }
  }

  return arrays;
}

/**
 * Convert vertex arrays into Face3D objects.
 * Each array becomes a face.  We compute the normal from the first 3 vertices.
 */
function vertexArraysToFaces(arrays: Vec3[][]): Face3D[] {
  return arrays.map((verts) => {
    const e1 = sub(verts[1], verts[0]);
    const e2 = sub(verts[2], verts[0]);
    const normal = normalize(cross(e1, e2));
    return { vertices: verts, normal, innerLoops: [] };
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SkpParseResult {
  faces: Face3D[];
  version: string;
  warnings: string[];
}

/**
 * Parse a .skp file buffer and extract Face3D geometry.
 *
 * This is a best-effort heuristic parser.  For files it cannot read,
 * `faces` will be empty and `warnings` will explain.
 */
export function parseSkp(buffer: ArrayBuffer): SkpParseResult {
  const warnings: string[] = [];

  // Determine format.
  let payload = buffer;
  let version = "unknown";

  if (isZip(buffer)) {
    version = "zip-wrapped (SketchUp 2021+)";
    payload = unzipSkpPayload(buffer);
    if (payload === buffer) {
      warnings.push("ZIP extraction found no usable entries; trying raw parse.");
    }
  } else if (isSkpMagic(buffer)) {
    version = "legacy binary";
  } else {
    return {
      faces: [],
      version: "unrecognised",
      warnings: ["File does not appear to be a valid .skp file. Try exporting as .obj from SketchUp."],
    };
  }

  // Scan for vertex arrays.
  const dv = new DataView(payload);
  const arrays = scanVertexArrays(dv);

  if (arrays.length === 0) {
    warnings.push(
      "Could not extract geometry from the .skp binary. " +
      "This can happen with compressed or very new format versions. " +
      "Try exporting as .obj from SketchUp (File → Export → 3D Model → OBJ)."
    );
    return { faces: [], version, warnings };
  }

  const faces = vertexArraysToFaces(arrays);

  return { faces, version, warnings };
}
