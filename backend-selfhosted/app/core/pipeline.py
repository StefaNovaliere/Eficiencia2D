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
  - Coordinate system (Y-up vs Z-up) -- detected ONCE and shared
  - Unit scale -- OBJ files may be in inches, cm, mm, or meters
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from .cutting_sheet import build_cutting_layout, generate_cutting_dxf
from .dxf_writer import generate_dxf, generate_component_dxf, generate_floor_plan_dxf
from .floor_plan_extractor import FloorPlan, extract_floor_plans
from .obj_parser import parse_obj
from .pdf_writer import generate_pdf
from .plan_extractor import extract_components
from .skp_parser import parse_skp
from .facade_extractor import extract_facades, extract_facades_with_detected_axis
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


def _scale_floor_plans(plans: list[FloorPlan], s: float) -> list[FloorPlan]:
    """Scale all floor plan dimensions by factor s."""
    if s == 1.0:
        return plans
    from .door_extractor import Door2D
    result: list[FloorPlan] = []
    for p in plans:
        scaled_segs = [
            (Vec2(a.x * s, a.y * s), Vec2(b.x * s, b.y * s))
            for a, b in p.segments
        ]
        scaled_doors = [
            Door2D(
                hinge=Vec2(d.hinge.x * s, d.hinge.y * s),
                width=d.width * s,
                start_angle=d.start_angle,
                end_angle=d.end_angle,
                leaf_end=Vec2(d.leaf_end.x * s, d.leaf_end.y * s),
            )
            for d in p.doors
        ]
        result.append(FloorPlan(
            label=p.label,
            segments=scaled_segs,
            width=p.width * s,
            height=p.height * s,
            elevation=p.elevation * s,
            doors=scaled_doors,
        ))
    return result


def detect_up_axis(faces: list[Face3D]) -> Literal["Y", "Z"]:
    """Detect whether the model uses Y-up or Z-up convention.

    Primary signal: the correct axis classifies the MOST faces as vertical
    (walls).  With the wrong axis, some walls get misclassified as
    horizontal, reducing the vertical count.

    Secondary signal (tie-break): when horizontal faces exist, prefer the
    axis whose horizontal faces cluster into fewer distinct floor levels
    (the hallmark of real floor slabs vs. misclassified walls).

    This is called ONCE in the pipeline and the result is passed to all
    extractors so they all agree on the same coordinate system.
    """
    if not faces:
        return "Z"

    def _score(up: Literal["Y", "Z"]) -> tuple[int, float]:
        """Return (n_vertical, floor_quality_bonus) — compared lexicographically."""
        n_vert = 0
        n_horiz = 0
        horiz_elevs: list[float] = []
        for f in faces:
            comp = abs(f.normal.y if up == "Y" else f.normal.z)
            if comp <= 0.20:
                n_vert += 1
            elif comp >= 0.85:
                n_horiz += 1
                avg_up = sum(
                    (v.y if up == "Y" else v.z) for v in f.vertices
                ) / max(len(f.vertices), 1)
                horiz_elevs.append(round(avg_up, 1))

        # Floor-quality bonus: fewer distinct floor levels is better.
        bonus = 0.0
        if n_horiz > 0 and horiz_elevs:
            sorted_e = sorted(set(horiz_elevs))
            n_levels = 1
            for i in range(1, len(sorted_e)):
                if sorted_e[i] - sorted_e[i - 1] >= 2.0:
                    n_levels += 1
            bonus = n_horiz / max(n_levels, 1)

        return n_vert, bonus

    vert_y, bonus_y = _score("Y")
    vert_z, bonus_z = _score("Z")

    # Primary: pick the axis with more vertical faces.
    if vert_y != vert_z:
        return "Y" if vert_y > vert_z else "Z"

    # Secondary: prefer better floor-level clustering.
    if bonus_y != bonus_z:
        return "Y" if bonus_y > bonus_z else "Z"

    return "Z"


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
    include_floor_plans: bool = False,
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
    include_floor_plans : bool
        If True, generate horizontal section-cut floor plans showing interior
        wall layout for each detected floor level.
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

    # --- 1b. Detect up axis via facade extraction (tries both Y and Z,
    #     picks the one with more geometry).  The winning axis is then
    #     shared with ALL other extractors to guarantee consistency. ---
    facades, up_axis = extract_facades_with_detected_axis(faces)

    if not facades:
        warnings.append(
            f"Found {len(faces)} face(s) but could not identify any building facades. "
            "Check that the model contains vertical surfaces."
        )
        return PipelineResult(facades=facades, files=[], warnings=warnings)

    # --- 2. Decomposition (tags Face3D.panel_id for facade labeling) ---
    component_sheets: list[ComponentSheet] = []

    if include_plan or include_cutting_sheet:
        component_sheets = extract_components(faces, gap=0.5, up_axis=up_axis)
        # Re-extract facades so they pick up the new panel_id tags.
        facades = extract_facades(faces, up_axis=up_axis)

    # --- 3. Floor plans (horizontal section cuts) ---
    floor_plans: list[FloorPlan] = []
    if include_floor_plans:
        floor_plans = extract_floor_plans(faces, up_axis=up_axis)
        if not floor_plans:
            warnings.append(
                "No se detectaron niveles de piso. El modelo necesita losas "
                "horizontales grandes (>2 m²) para detectar los pisos."
            )

    # --- 4. Normalize units ---
    if ext == "obj":
        unit_scale = _guess_unit_scale(faces)
        if unit_scale != 1.0:
            facades = _scale_facades(facades, unit_scale)
            component_sheets = _scale_component_sheets(component_sheets, unit_scale)
            floor_plans = _scale_floor_plans(floor_plans, unit_scale)

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

        for plan in floor_plans:
            plan_dxf = generate_floor_plan_dxf(plan, scale_denom)
            safe_label = _sanitize_label(plan.label)
            files.append(OutputFile(
                name=f"{stem}_{safe_label}.dxf",
                content=plan_dxf,
            ))

    if "pdf" in formats:
        pdf_content = generate_pdf(
            facades, scale_denom, paper,
            floor_plans=floor_plans if floor_plans else None,
        )
        files.append(OutputFile(name=f"{stem}_planos.pdf", content=pdf_content))

    # --- 6. Cutting sheets — one DXF per material group ---
    if include_cutting_sheet and component_sheets:
        # Map ComponentSheet labels to cutting-sheet file names / labels.
        _CUTTING_LABELS = {
            "Descomposicion Paredes": ("Corte Paredes", "corte_paredes"),
            "Descomposicion Pisos": ("Corte Pisos", "corte_pisos"),
        }

        for sheet in component_sheets:
            cut_label, file_slug = _CUTTING_LABELS.get(
                sheet.label, (sheet.label, _sanitize_label(sheet.label)),
            )
            layout = build_cutting_layout(
                sheet.panels, label=cut_label, scale_denom=scale_denom,
            )
            if layout is None:
                continue
            dxf_text = generate_cutting_dxf(layout)
            files.append(OutputFile(
                name=f"{stem}_{file_slug}.dxf",
                content=dxf_text,
            ))

    return PipelineResult(facades=facades, files=files, warnings=warnings)
