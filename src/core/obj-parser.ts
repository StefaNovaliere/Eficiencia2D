// ============================================================================
// OBJ Parser
//
// Parses Wavefront .obj text format — the reliable fallback.
// SketchUp exports .obj natively: File → Export → 3D Model → OBJ.
//
// This parser handles:
//   - v (vertex positions)
//   - f (faces, including n-gon faces with > 3 vertices)
//   - g/o (group names — used as labels)
//   - Negative vertex indices
//   - Faces with vertex/texture/normal index formats (v, v/vt, v/vt/vn, v//vn)
// ============================================================================

import { type Face3D, type Vec3, cross, normalize, sub } from "./types";

export interface ObjParseResult {
  faces: Face3D[];
  warnings: string[];
}

export function parseObj(text: string): ObjParseResult {
  const warnings: string[] = [];
  const vertices: Vec3[] = [];
  const faces: Face3D[] = [];
  let currentGroup = "";

  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || line[0] === "#") continue;

    const parts = line.split(/\s+/);
    const keyword = parts[0];

    if (keyword === "g" || keyword === "o") {
      // Group or object name — used as component ID for cutting sheets.
      currentGroup = parts.slice(1).join(" ") || "";
    } else if (keyword === "v") {
      // Vertex position.  OBJ coordinates are in the model's native unit.
      // SketchUp OBJ export uses inches by default; we convert to metres.
      // If the model was exported in metres, the user can adjust scale.
      const x = parseFloat(parts[1]);
      const y = parseFloat(parts[2]);
      const z = parseFloat(parts[3]);
      if (isFinite(x) && isFinite(y) && isFinite(z)) {
        vertices.push({ x, y, z });
      }
    } else if (keyword === "f") {
      // Face definition.
      const idxList: number[] = [];
      for (let i = 1; i < parts.length; i++) {
        // Format: v, v/vt, v/vt/vn, v//vn — we only need the first (vertex) index.
        const token = parts[i].split("/")[0];
        let idx = parseInt(token, 10);
        if (isNaN(idx)) continue;
        // OBJ indices are 1-based; negative = relative to end.
        if (idx < 0) idx = vertices.length + idx + 1;
        idxList.push(idx - 1); // convert to 0-based
      }

      if (idxList.length < 3) continue;

      // Gather vertices.
      const faceVerts: Vec3[] = [];
      let valid = true;
      for (const idx of idxList) {
        if (idx < 0 || idx >= vertices.length) { valid = false; break; }
        faceVerts.push(vertices[idx]);
      }
      if (!valid || faceVerts.length < 3) continue;

      // Compute normal from first 3 vertices.
      const e1 = sub(faceVerts[1], faceVerts[0]);
      const e2 = sub(faceVerts[2], faceVerts[0]);
      const normal = normalize(cross(e1, e2));

      faces.push({ vertices: faceVerts, normal, innerLoops: [], panelId: currentGroup || undefined });
    }
  }

  if (faces.length === 0) {
    warnings.push("No faces found in the .obj file.");
  }

  return { faces, warnings };
}
