"""
Processing Pipeline — Python port of src/core/pipeline.ts.

Orchestrates the full flow:
  File (bytes) -> Parser -> WallExtractor -> DXF/PDF Writers -> file contents
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from .dxf_writer import generate_dxf
from .obj_parser import parse_obj
from .pdf_writer import generate_pdf
from .skp_parser import parse_skp
from .wall_extractor import extract_walls
from .types import Face3D, Wall


@dataclass
class OutputFile:
    name: str
    content: str


@dataclass
class PipelineResult:
    walls: list[Wall]
    files: list[OutputFile]
    warnings: list[str] = field(default_factory=list)


def run_pipeline(
    file_name: str,
    data: bytes,
    scale_denom: int = 100,
    paper: str = "A3",
    formats: set[str] | None = None,
) -> PipelineResult:
    """Run the full processing pipeline on a file.

    Parameters
    ----------
    file_name : Original filename (used to detect format and name outputs).
    data      : Raw file contents.
    scale_denom : 50 or 100.
    paper     : "A3" or "A1".
    formats   : Set of output formats, e.g. {"dxf", "pdf"}.
    """
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
        return PipelineResult(walls=[], files=[], warnings=warnings)

    if not faces:
        return PipelineResult(walls=[], files=[], warnings=warnings)

    # --- 2. Extract walls ---
    walls = extract_walls(faces)

    if not walls:
        warnings.append(
            f"Found {len(faces)} face(s) but none qualified as walls. "
            "Check that the model contains vertical surfaces larger than 1.5 m^2."
        )
        return PipelineResult(walls=walls, files=[], warnings=warnings)

    # --- 3. Generate outputs ---
    files: list[OutputFile] = []

    if "dxf" in formats:
        dxf_text = generate_dxf(walls, scale_denom)
        files.append(OutputFile(name=f"{stem}.dxf", content=dxf_text))

    if "pdf" in formats:
        pdf_content = generate_pdf(walls, scale_denom, paper)
        files.append(OutputFile(name=f"{stem}.pdf", content=pdf_content))

    return PipelineResult(walls=walls, files=files, warnings=warnings)
