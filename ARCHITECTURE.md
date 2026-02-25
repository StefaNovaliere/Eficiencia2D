# Eficiencia2D - Architecture

## Data Flow

```
[Browser]                [Server]                    [Translator]
   |                        |                            |
   |  POST /api/upload      |                            |
   |  (binary .skp stream)  |                            |
   |----------------------->|                            |
   |                        |  Save to temp file         |
   |                        |  spawn: skp_translator     |
   |                        |  --input model.skp         |
   |                        |  --format dxf,pdf          |
   |                        |  --scale 100               |
   |                        |  --paper A3                |
   |                        |--------------------------->|
   |                        |                            |
   |                        |        SUModelCreateFromFile
   |                        |        WallExtractor::run()
   |                        |        DxfWriter::write()
   |                        |        PdfWriter::write()
   |                        |                            |
   |                        |  exit 0 + output files     |
   |                        |<---------------------------|
   |                        |                            |
   |                        |  Zip outputs               |
   |  200 OK (zip stream)   |                            |
   |<-----------------------|                            |
```

## Components

### 1. Translator Engine (C++)
- **Links against**: SketchUp C API SDK (`slapi/`)
- **Entry point**: `main.cpp` - CLI argument parsing
- **Core class**: `WallExtractor` - traverses SUModel, filters vertical faces
- **Output**: `DxfWriter` and `PdfWriter` produce annotated 2D projections
- **Wall detection logic**:
  1. Iterate all entities (recursing into groups/components with transform accumulation)
  2. Filter faces whose normal is perpendicular to Z (|normal.z| < epsilon)
  3. Filter by area > 1.5 m² (eliminates trim, baseboards, noise)
  4. Preserve inner loops (openings) but skip component instances inside them
  5. Project 3D vertices onto the wall's local 2D plane

### 2. Backend (Python FastAPI)
- Receives multipart upload of `.skp` binary
- Validates file header (SKP magic bytes)
- Saves to temp directory, invokes translator subprocess
- Streams back zipped results
- No intermediate format conversion - raw binary in, 2D files out

### 3. Frontend (Next.js / React)
- Single-page upload interface
- Paper size selector (A3, A1)
- Scale selector (1:50, 1:100)
- Drag-and-drop upload with progress
- Download link for zipped results

## Key Design Decisions

1. **Binary-first**: No XML/JSON intermediate. SUModelCreateFromFile reads .skp directly.
2. **Subprocess isolation**: C++ translator runs as a child process with timeout.
   Crashes don't take down the server.
3. **Stream-oriented**: Large files are streamed, not buffered entirely in memory.
4. **Transform accumulation**: Nested groups/components are handled by composing
   transformation matrices down the hierarchy.
