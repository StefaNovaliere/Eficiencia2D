"""
Processing Pipeline

Orchestrates the full flow:
  File (bytes) -> Parser -> FacadeExtractor -> DXF/PDF Writers

Output:
  - One DXF file per facade (e.g. "model_Fachada_Norte.dxf")
  - One multi-page PDF with all facades (one page per facade)

Handles auto-detection of:
  - File format (.skp vs .obj)
  - Coordinate system (Y-up vs Z-up) -- done in facade_extractor
  - Unit scale -- OBJ files may be in inches, cm, mm, or meters
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path

from .dxf_writer import generate_dxf
from .obj_parser import parse_obj
from .pdf_writer import generate_pdf
from .skp_parser import parse_skp
from .facade_extractor import extract_facades
from .types import Face3D, Facade, Vec2, Vec3, Loop2D


@dataclass
class OutputFile:
    name: str
    content: str


@dataclass
class PipelineResult:
    facades: list[Facade]
    files: list[OutputFile]
    warnings: list[str] = field(default_factory=list)


def _guess_unit_scale(faces: list[Face3D]) -> float:
    """Guess a conversion factor to bring coordinates into meters.

    Heuristic based on the model's bounding-box span:
      - If span <= 100  -> likely meters, scale=1
      - If span <= 1000 -> likely centimeters, scale=0.01
      - If span <= 50000 -> likely millimeters, scale=0.001
      - Larger -> normalize to ~20m span
    """
    if not faces:
        return 1.0

    min_x = min_y = min_z = float("inf")
    max_x = max_y = max_z = float("-inf")
    for face in faces[:500]:
        for v in face.vertices:
            min_x = min(min_x, v.x)
            min_y = min(min_y, v.y)
            min_z = min(min_z, v.z)
            max_x = max(max_x, v.x)
            max_y = max(max_y, v.y)
            max_z = max(max_z, v.z)

    span = max(max_x - min_x, max_y - min_y, max_z - min_z)

    if span <= 0:
        return 1.0
    if span <= 100:
        return 1.0
    if span <= 1000:
        return 0.01
    if span <= 50000:
        return 0.001
    return 1.0 / span * 20.0


def _scale_facades(facades: list[Facade], s: float) -> list[Facade]:
    """Scale all facade dimensions by factor s."""
    if s == 1.0:
        return facades
    result: list[Facade] = []
    for f in facades:
        polygons = [
            Loop2D(vertices=[Vec2(v.x * s, v.y * s) for v in poly.vertices])
            for poly in f.polygons
        ]
        result.append(Facade(
            label=f.label,
            direction=f.direction,
            polygons=polygons,
            width=f.width * s,
            height=f.height * s,
        ))
    return result


def _sanitize_label(label: str) -> str:
    """Make a label safe for filenames."""
    return label.replace(" ", "_")


def run_pipeline(
    file_name: str,
    data: bytes,
    scale_denom: int = 100,
    paper: str = "A3",
    formats: set[str] | None = None,
) -> PipelineResult:
    """Run the full processing pipeline on a file."""
    if formats is None:
        formats = {"dxf", "pdf"}

    warnings: list[str] = []
    ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
    stem = Path(file_name).stem

    # --- 1. Parse ---
    faces: list[Face3D] = []

    if ext == "skp":
        result = parse_skp(data)
        faces = result.faces
        warnings.extend(result.warnings)
    elif ext == "obj":
        text = data.decode("utf-8", errors="replace")
        result = parse_obj(text)
        faces = result.faces
        warnings.extend(result.warnings)
    else:
        warnings.append(f"Unsupported file format: .{ext}. Use .skp or .obj.")
        return PipelineResult(facades=[], files=[], warnings=warnings)

    if not faces:
        return PipelineResult(facades=[], files=[], warnings=warnings)

    # --- 2. Extract facades (auto-detects up axis) ---
    facades = extract_facades(faces)

    if not facades:
        warnings.append(
            f"Found {len(faces)} face(s) but could not identify any building facades. "
            "Check that the model contains vertical surfaces."
        )
        return PipelineResult(facades=facades, files=[], warnings=warnings)

    # --- 3. Normalize units ---
    if ext == "obj":
        unit_scale = _guess_unit_scale(faces)
        if unit_scale != 1.0:
            facades = _scale_facades(facades, unit_scale)

    # --- 4. Generate outputs ---
    files: list[OutputFile] = []

    # One DXF per facade.
    if "dxf" in formats:
        for facade in facades:
            dxf_text = generate_dxf(facade, scale_denom)
            safe_label = _sanitize_label(facade.label)
            files.append(OutputFile(
                name=f"{stem}_{safe_label}.dxf",
                content=dxf_text,
            ))

    # One multi-page PDF with all facades.
    if "pdf" in formats:
        pdf_content = generate_pdf(facades, scale_denom, paper)
        files.append(OutputFile(name=f"{stem}_fachadas.pdf", content=pdf_content))

    return PipelineResult(facades=facades, files=files, warnings=warnings)
