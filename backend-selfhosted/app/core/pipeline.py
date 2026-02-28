"""
Processing Pipeline

Orchestrates the full flow:
  File (bytes) -> Parser -> Decomposition -> FacadeExtractor -> DXF/PDF Writers

Output:
  - One DXF file per facade (e.g. "model_Fachada_Norte.dxf")
  - One DXF per component sheet (e.g. "model_Descomposicion_Paredes.dxf")
  - One multi-page PDF with all views

Handles auto-detection of:
  - File format (.skp vs .obj)
  - Coordinate system (Y-up vs Z-up) -- done in facade_extractor
  - Unit scale -- OBJ files may be in inches, cm, mm, or meters
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path

from .cutting_sheet import generate_cutting_sheet_dxf, pack_panels
from .dxf_writer import generate_dxf, generate_component_dxf
from .obj_parser import parse_obj
from .pdf_writer import generate_pdf
from .plan_extractor import extract_components
from .skp_parser import parse_skp
from .facade_extractor import extract_facades
from .types import (
    ComponentSheet,
    Face3D,
    Facade,
    Loop2D,
    PanelInfo,
    Vec2,
    Vec3,
)


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
    """Guess a conversion factor to bring coordinates into meters."""
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
            Loop2D(
                vertices=[Vec2(v.x * s, v.y * s) for v in poly.vertices],
                panel_id=poly.panel_id,
            )
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


def _scale_component_sheets(sheets: list[ComponentSheet], s: float) -> list[ComponentSheet]:
    """Scale all component sheet dimensions by factor s."""
    if s == 1.0:
        return sheets
    result: list[ComponentSheet] = []
    for sh in sheets:
        scaled_panels = [
            PanelInfo(
                ref_id=p.ref_id,
                outline=Loop2D(vertices=[Vec2(v.x * s, v.y * s) for v in p.outline.vertices]),
                width=p.width * s,
                height=p.height * s,
            )
            for p in sh.panels
        ]
        result.append(ComponentSheet(
            label=sh.label,
            panels=scaled_panels,
            width=sh.width * s,
            height=sh.height * s,
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
    include_plan: bool = False,
    include_cutting_sheet: bool = False,
) -> PipelineResult:
    """Run the full processing pipeline on a file.

    Parameters
    ----------
    include_plan : bool
        If True, generate component decomposition sheets with reference IDs
        in addition to facade elevations.
    include_cutting_sheet : bool
        If True, generate cutting-sheet DXF files (plancha de corte) with
        panels packed onto 1000x600mm sheets for laser cutting.
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
        return PipelineResult(facades=[], files=[], warnings=warnings)

    if not faces:
        return PipelineResult(facades=[], files=[], warnings=warnings)

    # --- 2. Decomposition FIRST (tags Face3D.panel_id for facade labeling) ---
    component_sheets: list[ComponentSheet] = []

    if include_plan or include_cutting_sheet:
        component_sheets = extract_components(faces, gap=0.5)

    # --- 3. Extract facades (picks up panel_id from tagged faces) ---
    facades = extract_facades(faces)

    if not facades:
        warnings.append(
            f"Found {len(faces)} face(s) but could not identify any building facades. "
            "Check that the model contains vertical surfaces."
        )
        return PipelineResult(facades=facades, files=[], warnings=warnings)

    # --- 4. Normalize units ---
    if ext == "obj":
        unit_scale = _guess_unit_scale(faces)
        if unit_scale != 1.0:
            facades = _scale_facades(facades, unit_scale)
            component_sheets = _scale_component_sheets(component_sheets, unit_scale)

    # --- 5. Generate outputs ---
    files: list[OutputFile] = []

    if "dxf" in formats:
        for facade in facades:
            dxf_text = generate_dxf(facade, scale_denom)
            safe_label = _sanitize_label(facade.label)
            files.append(OutputFile(
                name=f"{stem}_{safe_label}.dxf",
                content=dxf_text,
            ))

        for sheet in component_sheets:
            comp_dxf = generate_component_dxf(sheet, scale_denom)
            safe_label = _sanitize_label(sheet.label)
            files.append(OutputFile(
                name=f"{stem}_{safe_label}.dxf",
                content=comp_dxf,
            ))

    if "pdf" in formats:
        pdf_content = generate_pdf(facades, scale_denom, paper)
        files.append(OutputFile(name=f"{stem}_planos.pdf", content=pdf_content))

    # --- 6. Cutting sheets (plancha de corte) ---
    if include_cutting_sheet and component_sheets:
        all_panels: list[PanelInfo] = []
        for sh in component_sheets:
            all_panels.extend(sh.panels)

        cutting_sheets = pack_panels(all_panels, scale_denom)
        for i, cs in enumerate(cutting_sheets, start=1):
            dxf_text = generate_cutting_sheet_dxf(cs, sheet_index=i)
            suffix = f"_{i}" if len(cutting_sheets) > 1 else ""
            files.append(OutputFile(
                name=f"{stem}_Plancha_de_Corte{suffix}.dxf",
                content=dxf_text,
            ))

    return PipelineResult(facades=facades, files=files, warnings=warnings)
