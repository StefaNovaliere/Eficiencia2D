import type { IndexedFace3D } from "./types";

// Estructura que envía el backend (encode_faces_compact, formato "packed-le-v1").
export interface PackedFaces {
  count: number;
  format: string;
  vertex_counts_b64: string;
  coords_b64: string;
  normals_b64: string;
  idx_counts_b64: string;
  indices_b64: string;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Decodifica los buffers compactos del backend a Face3D[]. */
export function decodePackedFaces(p: PackedFaces): IndexedFace3D[] {
  const counts    = new Uint32Array(b64ToBytes(p.vertex_counts_b64).buffer);
  const coords    = new Float32Array(b64ToBytes(p.coords_b64).buffer);
  const normals   = new Float32Array(b64ToBytes(p.normals_b64).buffer);
  const idxCounts = new Uint32Array(b64ToBytes(p.idx_counts_b64).buffer);
  const indices   = new Uint32Array(b64ToBytes(p.indices_b64).buffer);

  const faces: IndexedFace3D[] = new Array(p.count);
  let ci = 0; // cursor de coords
  let ii = 0; // cursor de indices
  for (let f = 0; f < p.count; f++) {
    const vc = counts[f];
    const vertices = new Array(vc);
    for (let k = 0; k < vc; k++) {
      vertices[k] = { x: coords[ci], y: coords[ci + 1], z: coords[ci + 2] };
      ci += 3;
    }
    const normal = { x: normals[f * 3], y: normals[f * 3 + 1], z: normals[f * 3 + 2] };
    const ic = idxCounts[f];
    const vertexIndices: number[] = new Array(ic);
    for (let k = 0; k < ic; k++) vertexIndices[k] = indices[ii + k];
    ii += ic;
    faces[f] = { vertices, normal, innerLoops: [], panelId: undefined, vertexIndices };
  }
  return faces;
}
