# Eficiencia2D - Architecture

## Deployment Modes

### Mode A: Vercel (Free Tier) — Client-Side Processing
Everything runs in the browser. Zero server cost. Vercel serves static assets only.

```
[Browser]
   |
   |  User drops .skp or .obj file
   |
   |  ┌─────────────────────────────────────┐
   |  │  File.arrayBuffer()                 │
   |  │  SkpParser.parse() / ObjParser()    │
   |  │  WallExtractor.extract()            │
   |  │  DxfWriter.generate()               │
   |  │  PdfWriter.generate()               │
   |  └─────────────────────────────────────┘
   |
   |  Blob download (DXF + PDF)
   ▼
```

### Mode B: Self-Hosted — Server-Side C++ Processing
For maximum .skp compatibility using the SketchUp C API SDK.
See `translator-cpp/` and `backend-selfhosted/`.

```
[Browser]                [FastAPI]                   [C++ Translator]
   |                        |                            |
   |  POST /api/upload      |                            |
   |  (binary .skp stream)  |                            |
   |----------------------->|  spawn: skp_translator     |
   |                        |--------------------------->|
   |                        |        SUModelCreateFromFile
   |                        |        WallExtractor::run()
   |                        |  exit 0 + output files     |
   |                        |<---------------------------|
   |  200 OK (zip stream)   |                            |
   |<-----------------------|                            |
```

## Client-Side Processing Pipeline (Mode A)

### Parser Layer
- **`skp-parser.ts`**: Reads .skp binary format (ZIP-wrapped modern or legacy).
  Scans binary for vertex arrays using structural pattern matching.
  Best-effort — may not handle all .skp versions.
- **`obj-parser.ts`**: Parses Wavefront .obj (text). Reliable fallback.
  SketchUp exports .obj natively: File → Export → 3D Model → OBJ.

### Wall Extraction (`wall-extractor.ts`)
Same algorithm as the C++ version:
1. Filter faces where |normal.z| < 0.08 (vertical)
2. Filter faces with area > 1.5 m² (no noise)
3. Compute wall-local 2D coordinate system (u = horizontal, v = up)
4. Project outer loop + inner loops (openings) to 2D
5. Compute bounding-box dimensions

### Output Writers
- **`dxf-writer.ts`**: DXF with WALLS / OPENINGS / DIMENSIONS layers
- **`pdf-writer.ts`**: Raw PDF operators, Helvetica font, no dependencies

## Self-Hosted Components (Mode B)

### C++ Translator (`translator-cpp/`)
- Links against SketchUp C API SDK
- `WallExtractor` class with recursive entity traversal + transform accumulation
- Full .skp support including inner loops (opening preservation)

### Python Backend (`backend-selfhosted/`)
- FastAPI endpoint receives .skp binary
- Spawns C++ translator as subprocess with timeout
- Returns zipped DXF + PDF

## Key Design Decisions

1. **Client-first for Vercel**: No server processing needed for the free tier.
   The file never leaves the user's machine. No upload size limits.
2. **Dual-mode**: Same wall extraction algorithm in both TypeScript and C++.
   The C++ path gives full SDK-level .skp support for self-hosted deployments.
3. **Zero dependencies for output**: Both DXF and PDF writers generate raw
   format bytes — no external libraries needed.
4. **OBJ as reliable fallback**: When .skp binary parsing hits edge cases,
   the user can export .obj from SketchUp (free, one click) for perfect results.
