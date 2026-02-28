"""
Eficiencia2D -- FastAPI backend.

Receives a .skp or .obj upload, processes it with the pure-Python pipeline,
and returns a ZIP of the generated 2D plan files.

No external C++ translator or SketchUp SDK required.
"""

import asyncio
import io
import logging
import os
import traceback
import zipfile
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from .config import (
    MAX_UPLOAD_BYTES,
    VALID_FORMATS,
    VALID_PAPERS,
    VALID_SCALES,
)
from .core.pipeline import run_pipeline

logger = logging.getLogger("eficiencia2d")

# Thread pool for CPU-bound pipeline work.  Running the geometry pipeline
# in a thread keeps uvicorn's async event loop free so it can still respond
# to Railway health-checks and keep the H2 connection alive.
_executor = ThreadPoolExecutor(max_workers=2)

app = FastAPI(
    title="Eficiencia2D",
    description="Upload a .skp or .obj file, get 2D architectural plans instantly.",
    version="0.4.0",
)

_allowed_origins = os.getenv("CORS_ORIGINS", "*").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch unhandled exceptions so CORS headers are still sent."""
    logger.error("Unhandled error: %s\n%s", exc, traceback.format_exc())
    return JSONResponse(
        status_code=500,
        content={"detail": f"Error interno del servidor: {exc}"},
    )

# Accepted file extensions.
_VALID_EXTENSIONS = {"skp", "obj"}


@app.get("/health")
async def health():
    return {"status": "ok", "mode": "python-pipeline", "version": "0.4.0"}


@app.post("/api/upload")
async def upload_file(
    file: UploadFile = File(...),
    scale: int = Form(100),
    paper: str = Form("A3"),
    formats: str = Form("dxf,pdf"),
    include_plan: str = Form("false"),
    include_cutting_sheet: str = Form("false"),
    include_floor_plans: str = Form("false"),
):
    """
    Accept a .skp or .obj upload and return a ZIP of the 2D outputs.

    Parameters
    ----------
    file : .skp or .obj binary upload
    scale : 50 | 100  (denominator -- 1:50 or 1:100)
    paper : A3 | A1
    formats : comma-separated subset of {dxf, pdf}
    include_plan : "true" | "false" -- include component decomposition sheets
    include_cutting_sheet : "true" | "false" -- include plancha de corte DXF
    include_floor_plans : "true" | "false" -- include horizontal section-cut floor plans
    """

    # --- Validate parameters ---
    if scale not in VALID_SCALES:
        raise HTTPException(400, f"Invalid scale. Choose from {VALID_SCALES}.")
    if paper not in VALID_PAPERS:
        raise HTTPException(400, f"Invalid paper. Choose from {VALID_PAPERS}.")

    requested = {f.strip() for f in formats.split(",")}
    if not requested.issubset(VALID_FORMATS):
        raise HTTPException(400, f"Invalid formats. Choose from {VALID_FORMATS}.")

    # --- Read and validate the upload ---
    contents = await file.read()
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File too large.")

    filename = file.filename or "model.skp"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if ext not in _VALID_EXTENSIONS:
        raise HTTPException(
            400,
            f"Unsupported file format: .{ext}. Upload a .skp or .obj file.",
        )

    # Basic header validation for .skp files.
    if ext == "skp" and not contents[:3].startswith(b"\xff\xfe\xff"):
        # Could also be a ZIP-wrapped .skp -- check PK header.
        if not contents[:4] == b"PK\x03\x04":
            raise HTTPException(
                400,
                "Invalid file: does not appear to be a valid .skp SketchUp file.",
            )

    logger.info(
        "Processing %s (%s, %.1f MB, scale=1:%d, plan=%s, cutting=%s, floors=%s)",
        filename, ext, len(contents) / 1e6, scale,
        include_plan, include_cutting_sheet, include_floor_plans,
    )

    # --- Run the pipeline in a thread so we don't block the event loop ---
    want_plan = include_plan.lower() in ("true", "1", "yes")
    want_cutting = include_cutting_sheet.lower() in ("true", "1", "yes")
    want_floors = include_floor_plans.lower() in ("true", "1", "yes")

    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(
            _executor,
            lambda: run_pipeline(
                file_name=filename,
                data=contents,
                scale_denom=scale,
                paper=paper,
                formats=requested,
                include_plan=want_plan,
                include_cutting_sheet=want_cutting,
                include_floor_plans=want_floors,
            ),
        )
    except Exception as exc:
        logger.error("Pipeline error for %s: %s", filename, exc, exc_info=True)
        raise HTTPException(
            500,
            f"Error procesando el archivo: {exc}. "
            "Si es un .skp, intenta exportar como .obj desde SketchUp.",
        )

    if result.warnings:
        logger.warning("Pipeline warnings for %s: %s", filename, result.warnings)

    if not result.files:
        detail = "No output files generated."
        if result.warnings:
            detail += " " + " ".join(result.warnings)
        raise HTTPException(422, detail)

    # --- ZIP the results and stream back ---
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for out_file in result.files:
            zf.writestr(out_file.name, out_file.content)
    zip_buffer.seek(0)

    stem = filename.rsplit(".", 1)[0] if "." in filename else filename
    return StreamingResponse(
        iter([zip_buffer.read()]),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{stem}_plans.zip"',
        },
    )
