"""
Eficiencia2D -- FastAPI backend.

Receives a .skp or .obj upload, processes it with the pure-Python pipeline,
and returns a ZIP of the generated 2D plan files.

No external C++ translator or SketchUp SDK required.
"""

import io
import os
import zipfile

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .config import (
    MAX_UPLOAD_BYTES,
    VALID_FORMATS,
    VALID_PAPERS,
    VALID_SCALES,
)
from .core.pipeline import run_pipeline

app = FastAPI(
    title="Eficiencia2D",
    description="Upload a .skp or .obj file, get 2D architectural plans instantly.",
    version="0.2.0",
)

_allowed_origins = os.getenv("CORS_ORIGINS", "*").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)

# Accepted file extensions.
_VALID_EXTENSIONS = {"skp", "obj"}


@app.get("/health")
async def health():
    return {"status": "ok", "mode": "python-pipeline", "version": "0.2.0"}


@app.post("/api/upload")
async def upload_file(
    file: UploadFile = File(...),
    scale: int = Form(100),
    paper: str = Form("A3"),
    formats: str = Form("dxf,pdf"),
):
    """
    Accept a .skp or .obj upload and return a ZIP of the 2D outputs.

    Parameters
    ----------
    file : .skp or .obj binary upload
    scale : 50 | 100  (denominator -- 1:50 or 1:100)
    paper : A3 | A1
    formats : comma-separated subset of {dxf, pdf}
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

    # --- Run the Python pipeline ---
    result = run_pipeline(
        file_name=filename,
        data=contents,
        scale_denom=scale,
        paper=paper,
        formats=requested,
    )

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
