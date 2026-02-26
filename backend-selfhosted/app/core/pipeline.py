"""
Processing Pipeline

Orchestrates the full flow:
  File (bytes) -> Parser -> WallExtractor -> DXF/PDF Writers -> file contents

Handles auto-detection of:
  - File format (.skp vs .obj)
  - Coordinate system (Y-up vs Z-up) — done in wall_extractor
  - Unit scale — OBJ files may be in inches, cm, mm, or meters
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path

from .dxf_writer import generate_dxf
from .obj_parser import parse_obj
from .pdf_writer import generate_pdf
from .skp_parser import parse_skp
from .wall_extractor import extract_walls
from .types import Face3D, Vec3, Wall


@dataclass
class OutputFile:
    name: str
    content: str


@dataclass
class PipelineResult:
    walls: list[Wall]
    files: list[OutputFile]
    warnings: list[str] = field(default_factory=list)


def _estimate_model_height(faces: list[Face3D]) -> float:
    """Estimate the height range of the model (max - min across all axes)."""
    if not faces:
        return 0.0
    coords: list[float] = []
    for face in faces[:500]:
        for v in face.vertices:
            coords.extend([v.x, v.y, v.z])
    return max(coords) - min(coords) if coords else 0.0


def _guess_unit_scale(faces: list[Face3D]) -> float:
    """Guess a conversion factor to bring coordinates into meters.

    Heuristic based on the model's bounding-box span:
      - If span < 1 → likely already in meters (small object), scale=1
      - If span ~1-100 → likely meters, scale=1
      - If span ~100-1000 → likely centimeters, scale=0.01
      - If span ~1000-10000 → likely millimeters, scale=0.001
      - If span > 10000 → likely some tiny unit, scale down proportionally

    This is a best-effort heuristic. Architectural models are typically
    5-50m in span.
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
        # Likely meters — reasonable architectural scale.
        return 1.0
    if span <= 1000:
        # Likely centimeters.
        return 0.01
    if span <= 50000:
        # Likely millimeters.
        return 0.001
    # Very large numbers — possibly some sub-mm unit.
    return 1.0 / span * 20.0  # normalize to ~20m span


def _scale_walls(walls: list[Wall], s: float) -> list[Wall]:
    """Scale all wall dimensions by factor s."""
    if s == 1.0:
        return walls
    result: list[Wall] = []
    for w in walls:
        from .types import Loop2D, Vec2
        outer = Loop2D(vertices=[Vec2(v.x * s, v.y * s) for v in w.outer.vertices])
        openings = [
            Loop2D(vertices=[Vec2(v.x * s, v.y * s) for v in op.vertices])
            for op in w.openings
        ]
        result.append(Wall(
            label=w.label,
            normal=w.normal,
            vertices3d=[Vec3(v.x * s, v.y * s, v.z * s) for v in w.vertices3d],
            outer=outer,
            openings=openings,
            width=w.width * s,
            height=w.height * s,
        ))
    return result


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

    # --- 2. Extract walls (auto-detects up axis) ---
    walls = extract_walls(faces)

    if not walls:
        warnings.append(
            f"Found {len(faces)} face(s) but none qualified as walls. "
            "Check that the model contains vertical surfaces larger than 1.5 m\u00b2."
        )
        return PipelineResult(walls=walls, files=[], warnings=warnings)

    # --- 3. Normalize units for DXF/PDF output ---
    # The writers expect dimensions in meters.
    # For .skp files, the parser already converts inches -> meters.
    # For .obj files, we guess the unit from the coordinate scale.
    if ext == "obj":
        unit_scale = _guess_unit_scale(faces)
        if unit_scale != 1.0:
            walls = _scale_walls(walls, unit_scale)

    # --- 4. Generate outputs ---
    files: list[OutputFile] = []

    if "dxf" in formats:
        dxf_text = generate_dxf(walls, scale_denom)
        files.append(OutputFile(name=f"{stem}.dxf", content=dxf_text))

    if "pdf" in formats:
        pdf_content = generate_pdf(walls, scale_denom, paper)
        files.append(OutputFile(name=f"{stem}.pdf", content=pdf_content))

    return PipelineResult(walls=walls, files=files, warnings=warnings)
