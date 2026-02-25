"""
Eficiencia2D — FastAPI backend.

Receives a .skp binary upload, invokes the C++ translator subprocess,
and returns a ZIP of the generated 2D files.
"""

import asyncio
import io
import os
import shutil
import tempfile
import uuid
import zipfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .config import (
    MAX_UPLOAD_BYTES,
    TEMP_DIR,
    TRANSLATOR_BIN,
    TRANSLATOR_TIMEOUT_S,
    VALID_FORMATS,
    VALID_PAPERS,
    VALID_SCALES,
)

app = FastAPI(
    title="Eficiencia2D",
    description="Upload a raw .skp file, get 2D architectural plans instantly.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in production
    allow_methods=["*"],
    allow_headers=["*"],
)

# SKP file magic bytes: the first 8 bytes of any valid .skp file.
_SKP_MAGIC = b"\xff\xfe\xff\x0e\x53\x6b\x65\x74"  # "ÿþÿ.Sket"


def _validate_skp_header(data: bytes) -> None:
    """Raise if the first bytes don't match the .skp magic."""
    if len(data) < 8 or not data[:8].startswith(b"\xff\xfe\xff"):
        raise HTTPException(
            status_code=400,
            detail="Invalid file: does not appear to be a .skp SketchUp file.",
        )


@app.get("/health")
async def health():
    return {"status": "ok", "translator": os.path.isfile(TRANSLATOR_BIN)}


@app.post("/api/upload")
async def upload_skp(
    file: UploadFile = File(...),
    scale: int = Form(100),
    paper: str = Form("A3"),
    formats: str = Form("dxf,pdf"),
):
    """
    Accept a .skp upload and return a ZIP of the 2D outputs.

    Parameters
    ----------
    file : .skp binary upload
    scale : 50 | 100  (denominator — 1:50 or 1:100)
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
    _validate_skp_header(contents)

    # --- Write to temp directory ---
    job_id = uuid.uuid4().hex[:12]
    job_dir = Path(TEMP_DIR) / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    input_path = job_dir / "model.skp"
    input_path.write_bytes(contents)

    outdir = job_dir / "output"
    outdir.mkdir(exist_ok=True)

    # --- Invoke the C++ translator ---
    cmd = [
        TRANSLATOR_BIN,
        "--input", str(input_path),
        "--outdir", str(outdir),
        "--scale", str(scale),
        "--paper", paper,
        "--format", ",".join(sorted(requested)),
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(),
            timeout=TRANSLATOR_TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        proc.kill()
        _cleanup(job_dir)
        raise HTTPException(504, "Translator timed out.")
    except FileNotFoundError:
        _cleanup(job_dir)
        raise HTTPException(
            503,
            "Translator binary not found. Is the server configured correctly?",
        )

    if proc.returncode != 0:
        detail = stderr.decode(errors="replace")[:500]
        _cleanup(job_dir)
        raise HTTPException(500, f"Translator failed (exit {proc.returncode}): {detail}")

    # --- Parse stdout for output file paths ---
    output_files: list[Path] = []
    for line in stdout.decode().strip().splitlines():
        if ":" in line:
            _, path_str = line.split(":", 1)
            p = Path(path_str.strip())
            if p.is_file():
                output_files.append(p)

    if not output_files:
        _cleanup(job_dir)
        raise HTTPException(500, "Translator produced no output files.")

    # --- ZIP the results and stream back ---
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for fp in output_files:
            zf.write(fp, fp.name)
    zip_buffer.seek(0)

    # Schedule cleanup after response is sent.
    async def _stream_and_cleanup():
        try:
            yield zip_buffer.read()
        finally:
            _cleanup(job_dir)

    stem = Path(file.filename or "model").stem
    return StreamingResponse(
        _stream_and_cleanup(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{stem}_plans.zip"',
        },
    )


def _cleanup(job_dir: Path) -> None:
    """Remove the temporary job directory."""
    shutil.rmtree(job_dir, ignore_errors=True)
