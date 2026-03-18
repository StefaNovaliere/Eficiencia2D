"""
Tests for the FastAPI upload endpoint.

Tests run against the pure-Python pipeline -- no C++ translator or
SketchUp SDK required.
"""

import io
import zipfile

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["mode"] == "python-pipeline"


def test_upload_rejects_non_skp():
    fake = io.BytesIO(b"this is not a skp file at all")
    resp = client.post(
        "/api/upload",
        files={"file": ("bad.skp", fake, "application/octet-stream")},
        data={"scale": "100", "paper": "A3", "formats": "dxf"},
    )
    assert resp.status_code == 400
    assert "does not appear" in resp.json()["detail"]


def test_upload_rejects_invalid_scale():
    header = b"\xff\xfe\xff\x0e" + b"\x00" * 100
    resp = client.post(
        "/api/upload",
        files={"file": ("model.skp", io.BytesIO(header), "application/octet-stream")},
        data={"scale": "999", "paper": "A3", "formats": "dxf"},
    )
    assert resp.status_code == 400
    assert "scale" in resp.json()["detail"].lower()


def test_upload_rejects_invalid_paper():
    header = b"\xff\xfe\xff\x0e" + b"\x00" * 100
    resp = client.post(
        "/api/upload",
        files={"file": ("model.skp", io.BytesIO(header), "application/octet-stream")},
        data={"scale": "100", "paper": "A0", "formats": "dxf"},
    )
    assert resp.status_code == 400
    assert "paper" in resp.json()["detail"].lower()


def test_upload_rejects_unsupported_format():
    fake = io.BytesIO(b"solid model\n")
    resp = client.post(
        "/api/upload",
        files={"file": ("model.stl", fake, "application/octet-stream")},
        data={"scale": "100", "paper": "A3", "formats": "dxf"},
    )
    assert resp.status_code == 400
    assert "unsupported" in resp.json()["detail"].lower()


def _make_box_y_up() -> bytes:
    """Create a simple box (4-sided building) in Y-up convention.

    4 vertical walls forming a 6m x 4m x 3m box.
    Y is up, so walls have normals in XZ plane.
    """
    lines = [
        "# Box building 6x4x3m, Y-up",
        "v 0 0 0",     # 1: front-left-bottom
        "v 6 0 0",     # 2: front-right-bottom
        "v 6 0 4",     # 3: back-right-bottom
        "v 0 0 4",     # 4: back-left-bottom
        "v 0 3 0",     # 5: front-left-top
        "v 6 3 0",     # 6: front-right-top
        "v 6 3 4",     # 7: back-right-top
        "v 0 3 4",     # 8: back-left-top
        # Front wall (normal -Z)
        "f 1 2 6 5",
        # Right wall (normal +X)
        "f 2 3 7 6",
        # Back wall (normal +Z)
        "f 3 4 8 7",
        # Left wall (normal -X)
        "f 4 1 5 8",
    ]
    return "\n".join(lines).encode("utf-8")


def _make_box_z_up() -> bytes:
    """Create a simple box in Z-up convention.

    4 vertical walls forming a 6m x 4m x 3m box.
    Z is up, so walls have normals in XY plane.
    """
    lines = [
        "# Box building 6x4x3m, Z-up",
        "v 0 0 0",     # 1
        "v 6 0 0",     # 2
        "v 6 4 0",     # 3
        "v 0 4 0",     # 4
        "v 0 0 3",     # 5
        "v 6 0 3",     # 6
        "v 6 4 3",     # 7
        "v 0 4 3",     # 8
        # Front wall (normal -Y)
        "f 1 2 6 5",
        # Right wall (normal +X)
        "f 2 3 7 6",
        # Back wall (normal +Y)
        "f 3 4 8 7",
        # Left wall (normal -X)
        "f 4 1 5 8",
    ]
    return "\n".join(lines).encode("utf-8")


def test_box_y_up_produces_4_facades():
    """A 4-sided box should produce 4 facade DXFs + 1 multi-page PDF."""
    obj_data = _make_box_y_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("house.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={"scale": "100", "paper": "A3", "formats": "dxf,pdf"},
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()

    dxf_files = [n for n in names if n.endswith(".dxf")]
    pdf_files = [n for n in names if n.endswith(".pdf")]
    assert len(dxf_files) == 4, f"Expected 4 DXFs, got {dxf_files}"
    assert len(pdf_files) == 1, f"Expected 1 PDF, got {pdf_files}"

    # PDF should contain "Fachada" labels.
    pdf_content = zf.read(pdf_files[0]).decode("latin-1")
    assert "Fachada" in pdf_content


def test_box_z_up_produces_4_facades():
    """Z-up box also produces 4 facades."""
    obj_data = _make_box_z_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("house.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={"scale": "100", "paper": "A3", "formats": "dxf,pdf"},
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()

    dxf_files = [n for n in names if n.endswith(".dxf")]
    assert len(dxf_files) == 4, f"Expected 4 DXFs, got {dxf_files}"


def test_dxf_only():
    """Request only DXF format -- no PDF in output."""
    obj_data = _make_box_y_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("house.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={"scale": "50", "paper": "A1", "formats": "dxf"},
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()
    assert all(n.endswith(".dxf") for n in names)


def test_pdf_only():
    """Request only PDF format -- no DXF in output."""
    obj_data = _make_box_y_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("house.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={"scale": "100", "paper": "A3", "formats": "pdf"},
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()
    assert len(names) == 1
    assert names[0].endswith(".pdf")


def test_upload_obj_no_faces():
    """An .obj with no faces should return 422."""
    lines = ["v 0 0 0", "v 1 0 0", "v 1 1 0"]
    obj_data = "\n".join(lines).encode("utf-8")
    resp = client.post(
        "/api/upload",
        files={"file": ("empty.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={"scale": "100", "paper": "A3", "formats": "dxf"},
    )
    assert resp.status_code == 422


def test_centimeter_model():
    """An OBJ in centimeters should work (unit auto-detection)."""
    lines = [
        "# Y-up box in cm (600x400x300 cm)",
        "v 0 0 0", "v 600 0 0", "v 600 0 400", "v 0 0 400",
        "v 0 300 0", "v 600 300 0", "v 600 300 400", "v 0 300 400",
        "f 1 2 6 5",
        "f 2 3 7 6",
        "f 3 4 8 7",
        "f 4 1 5 8",
    ]
    obj_data = "\n".join(lines).encode("utf-8")
    resp = client.post(
        "/api/upload",
        files={"file": ("cm_model.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={"scale": "100", "paper": "A3", "formats": "dxf"},
    )
    assert resp.status_code == 200


def test_include_plan_adds_decomposition():
    """include_plan=true should add component decomposition with ref IDs."""
    obj_data = _make_box_y_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("house.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={"scale": "100", "paper": "A3", "formats": "dxf,pdf", "include_plan": "true"},
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()

    dxf_files = [n for n in names if n.endswith(".dxf")]
    pdf_files = [n for n in names if n.endswith(".pdf")]
    facade_dxfs = [n for n in dxf_files if "Fachada" in n]
    component_dxfs = [n for n in dxf_files if "Descomposicion" in n]

    assert len(facade_dxfs) == 4, f"Expected 4 facade DXFs, got {facade_dxfs}"
    assert len(pdf_files) == 1

    # Should have at least walls decomposition.
    paredes_dxfs = [n for n in component_dxfs if "Paredes" in n]
    assert len(paredes_dxfs) >= 1, f"Expected Descomposicion Paredes DXF, got {component_dxfs}"


def test_include_plan_false_no_decomposition():
    """include_plan=false should NOT add component decomposition sheets."""
    obj_data = _make_box_y_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("house.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={"scale": "100", "paper": "A3", "formats": "dxf", "include_plan": "false"},
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()
    component_dxfs = [n for n in names if "Descomposicion" in n]
    assert len(component_dxfs) == 0


def test_decomposition_z_up():
    """Component decomposition should work with Z-up models too."""
    obj_data = _make_box_z_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("house.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={"scale": "100", "paper": "A3", "formats": "dxf", "include_plan": "true"},
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()
    facade_dxfs = [n for n in names if "Fachada" in n]
    assert len(facade_dxfs) == 4


def _make_multistory_y_up() -> bytes:
    """Create a 2-story building (Y-up) with floor slabs and interior walls."""
    lines = [
        "# 2-story building 8x6x6m, Y-up",
        "v 0 0 0",   # 1
        "v 8 0 0",   # 2
        "v 8 0 6",   # 3
        "v 0 0 6",   # 4
        "v 0 3 0",   # 5
        "v 8 3 0",   # 6
        "v 8 3 6",   # 7
        "v 0 3 6",   # 8
        "v 0 6 0",   # 9
        "v 8 6 0",   # 10
        "v 8 6 6",   # 11
        "v 0 6 6",   # 12
        # Interior wall at x=4 (ground floor only)
        "v 4 0 0",   # 13
        "v 4 3 0",   # 14
        "v 4 3 6",   # 15
        "v 4 0 6",   # 16
        # Floor slab at y=3
        "v 0 3 0",   # 17
        "v 8 3 0",   # 18
        "v 8 3 6",   # 19
        "v 0 3 6",   # 20
        # Ground floor walls
        "f 1 2 6 5",
        "f 2 3 7 6",
        "f 3 4 8 7",
        "f 4 1 5 8",
        # Second floor walls
        "f 5 6 10 9",
        "f 6 7 11 10",
        "f 7 8 12 11",
        "f 8 5 9 12",
        # Interior wall
        "f 13 16 15 14",
        # Floor slab at y=3 (horizontal)
        "f 17 18 19 20",
    ]
    return "\n".join(lines).encode("utf-8")


def test_multistory_decomposition():
    """A 2-story building should produce decomposition DXFs (not in PDF)."""
    obj_data = _make_multistory_y_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("tower.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={"scale": "100", "paper": "A3", "formats": "dxf,pdf", "include_plan": "true"},
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()

    facade_dxfs = [n for n in names if "Fachada" in n]
    assert len(facade_dxfs) >= 4, f"Expected 4+ facade DXFs, got {facade_dxfs}"

    # Should have "Descomposicion_Paredes" DXF.
    paredes_dxfs = [n for n in names if "Descomposicion_Paredes" in n]
    assert len(paredes_dxfs) >= 1, f"Expected Paredes DXF, got {names}"

    # PDF should contain facades only (no Descomposicion pages).
    pdf_files = [n for n in names if n.endswith(".pdf")]
    assert len(pdf_files) == 1
    pdf_content = zf.read(pdf_files[0]).decode("latin-1")
    assert "Fachada" in pdf_content
    assert "Descomposicion" not in pdf_content


def test_plancha_paper_rejected():
    """Plancha is no longer a valid paper size (it's a separate output)."""
    obj_data = _make_box_y_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("house.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={"scale": "100", "paper": "Plancha", "formats": "pdf"},
    )
    assert resp.status_code == 400


def test_cutting_sheet_generated():
    """include_cutting_sheet=true should produce per-material cutting DXFs."""
    obj_data = _make_box_y_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("house.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={
            "scale": "100",
            "paper": "A3",
            "formats": "dxf",
            "include_cutting_sheet": "true",
        },
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()

    cutting_dxfs = [n for n in names if "corte_paredes" in n or "corte_pisos" in n]
    assert len(cutting_dxfs) >= 1, f"Expected cutting sheet DXF, got {names}"

    # The cutting sheet DXF should have laser-cutter layers.
    dxf_content = zf.read(cutting_dxfs[0]).decode("utf-8")
    assert "CUT_EXTERIOR" in dxf_content
    assert "ENGRAVE_RASTER" in dxf_content


def test_cutting_sheet_has_panel_ids():
    """Cutting sheet DXF should contain panel reference IDs."""
    obj_data = _make_box_y_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("house.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={
            "scale": "100",
            "paper": "A3",
            "formats": "dxf",
            "include_cutting_sheet": "true",
        },
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()
    cutting_dxfs = [n for n in names if "corte_paredes" in n or "corte_pisos" in n]
    assert len(cutting_dxfs) >= 1

    dxf_content = zf.read(cutting_dxfs[0]).decode("utf-8")
    # Should contain at least A1 (wall panel) or B1 (floor panel).
    has_id = "A1" in dxf_content or "B1" in dxf_content
    assert has_id, "Expected panel reference ID (A1 or B1) in cutting sheet"


def test_cutting_sheet_not_generated_by_default():
    """Without include_cutting_sheet, no cutting sheet should appear."""
    obj_data = _make_box_y_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("house.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={"scale": "100", "paper": "A3", "formats": "dxf"},
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()
    cutting_dxfs = [n for n in names if "corte_paredes" in n or "corte_pisos" in n]
    assert len(cutting_dxfs) == 0


def test_dxf_has_laser_layers():
    """DXF output should use 4-layer laser-cutter protocol."""
    obj_data = _make_box_y_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("house.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={"scale": "100", "paper": "A3", "formats": "dxf"},
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()
    dxf_files = [n for n in names if n.endswith(".dxf")]
    assert len(dxf_files) > 0

    dxf_content = zf.read(dxf_files[0]).decode("utf-8")
    assert "CUT_EXTERIOR" in dxf_content
    assert "ENGRAVE_RASTER" in dxf_content
    assert "ENGRAVE_VECTOR" in dxf_content
    # Old layers should NOT be present.
    assert "FACADE" not in dxf_content
    assert "DIMENSIONS" not in dxf_content


def test_panel_reference_ids_in_component_dxf():
    """Component decomposition DXF should contain panel reference IDs."""
    obj_data = _make_box_y_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("house.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={"scale": "100", "paper": "A3", "formats": "dxf", "include_plan": "true"},
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()
    component_dxfs = [n for n in names if "Descomposicion" in n]

    if component_dxfs:
        dxf_content = zf.read(component_dxfs[0]).decode("utf-8")
        # Should contain at least one reference ID (A1 for walls or B1 for slabs).
        assert "A1" in dxf_content or "B1" in dxf_content, \
            f"Expected panel reference IDs in component DXF"


def _make_multistory_with_slabs_y_up() -> bytes:
    """Create a 2-story building (Y-up) with large floor slabs for detection.

    The floor slab must be > 2 m² (MIN_SLAB_AREA) for floor detection.
    Building: 8x6m footprint, 2 floors each 3m tall.
    Ground slab at y=0, mid slab at y=3, roof slab at y=6.
    Interior wall at x=4 (ground floor only).
    """
    lines = [
        "# 2-story building 8x6x6m, Y-up with slabs",
        # Outer vertices
        "v 0 0 0",   # 1
        "v 8 0 0",   # 2
        "v 8 0 6",   # 3
        "v 0 0 6",   # 4
        "v 0 3 0",   # 5
        "v 8 3 0",   # 6
        "v 8 3 6",   # 7
        "v 0 3 6",   # 8
        "v 0 6 0",   # 9
        "v 8 6 0",   # 10
        "v 8 6 6",   # 11
        "v 0 6 6",   # 12
        # Interior wall at x=4 (ground floor)
        "v 4 0 0",   # 13
        "v 4 3 0",   # 14
        "v 4 3 6",   # 15
        "v 4 0 6",   # 16
        # Ground slab at y=0 (8x6 = 48 m²)
        "v 0 0 0",   # 17
        "v 8 0 0",   # 18
        "v 8 0 6",   # 19
        "v 0 0 6",   # 20
        # Mid slab at y=3 (8x6 = 48 m²)
        "v 0 3 0",   # 21
        "v 8 3 0",   # 22
        "v 8 3 6",   # 23
        "v 0 3 6",   # 24
        # Roof slab at y=6 (8x6 = 48 m²)
        "v 0 6 0",   # 25
        "v 8 6 0",   # 26
        "v 8 6 6",   # 27
        "v 0 6 6",   # 28
        # Ground floor walls
        "f 1 2 6 5",
        "f 2 3 7 6",
        "f 3 4 8 7",
        "f 4 1 5 8",
        # Second floor walls
        "f 5 6 10 9",
        "f 6 7 11 10",
        "f 7 8 12 11",
        "f 8 5 9 12",
        # Interior wall
        "f 13 16 15 14",
        # Ground slab (horizontal, normal up)
        "f 17 18 19 20",
        # Mid-floor slab (horizontal, normal up)
        "f 21 22 23 24",
        # Roof slab (horizontal, normal up)
        "f 25 26 27 28",
    ]
    return "\n".join(lines).encode("utf-8")


def test_floor_plans_generated():
    """include_floor_plans=true should produce floor plan DXFs and PDF pages."""
    obj_data = _make_multistory_with_slabs_y_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("building.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={
            "scale": "100",
            "paper": "A3",
            "formats": "dxf,pdf",
            "include_floor_plans": "true",
        },
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()

    # Should have floor plan DXFs with "Planta_Piso" in name.
    floor_dxfs = [n for n in names if "Planta_Piso" in n]
    assert len(floor_dxfs) >= 1, f"Expected floor plan DXFs, got {names}"

    # PDF should contain "Planta Piso" label.
    pdf_files = [n for n in names if n.endswith(".pdf")]
    assert len(pdf_files) == 1
    pdf_content = zf.read(pdf_files[0]).decode("latin-1")
    assert "Planta Piso" in pdf_content


def test_floor_plans_not_generated_by_default():
    """Without include_floor_plans, no floor plans should appear."""
    obj_data = _make_multistory_with_slabs_y_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("building.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={"scale": "100", "paper": "A3", "formats": "dxf,pdf"},
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()
    floor_dxfs = [n for n in names if "Planta_Piso" in n]
    assert len(floor_dxfs) == 0


def test_floor_plan_dxf_has_laser_layers():
    """Floor plan DXFs should use CORTE/MARCA/GRABADO layers."""
    obj_data = _make_multistory_with_slabs_y_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("building.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={
            "scale": "100",
            "paper": "A3",
            "formats": "dxf",
            "include_floor_plans": "true",
        },
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()
    floor_dxfs = [n for n in names if "Planta_Piso" in n]
    assert len(floor_dxfs) >= 1

    dxf_content = zf.read(floor_dxfs[0]).decode("utf-8")
    assert "CUT_EXTERIOR" in dxf_content
    assert "ENGRAVE_VECTOR" in dxf_content


def test_floor_plans_with_simple_box():
    """A simple 4-wall box with floor plans enabled should still succeed."""
    obj_data = _make_box_y_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("house.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={
            "scale": "100",
            "paper": "A3",
            "formats": "dxf",
            "include_floor_plans": "true",
        },
    )
    # Should succeed regardless of whether floor plans are detected.
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()
    # At minimum, facades should be present.
    facade_dxfs = [n for n in names if "Fachada" in n]
    assert len(facade_dxfs) >= 1


def _make_multistory_multi_slab_y_up() -> bytes:
    """4-story building where each floor has MULTIPLE slab panels.

    This tests that the gap-based grouping correctly merges several slabs
    at the same (or nearly same) elevation into one floor level, instead
    of counting each slab as a separate floor.

    Floors at y=0, y=3, y=6, y=9.  Each floor has 2 side-by-side slabs
    (left half 0-5 in X, right half 5-10 in X), plus exterior walls.
    """
    lines = [
        "# 4-story building, 10x8m footprint, 3m per floor, Y-up",
        # Outer vertices for walls (only the ground and top)
        "v 0 0 0",    # 1
        "v 10 0 0",   # 2
        "v 10 0 8",   # 3
        "v 0 0 8",    # 4
        "v 0 12 0",   # 5
        "v 10 12 0",  # 6
        "v 10 12 8",  # 7
        "v 0 12 8",   # 8
        # Interior wall at x=5 (full height)
        "v 5 0 0",    # 9
        "v 5 12 0",   # 10
        "v 5 12 8",   # 11
        "v 5 0 8",    # 12
        # -- Slab vertices for 4 floors, 2 slabs each --
        # Floor 0 (y=0): left slab
        "v 0 0 0",    # 13
        "v 5 0 0",    # 14
        "v 5 0 8",    # 15
        "v 0 0 8",    # 16
        # Floor 0 (y=0): right slab
        "v 5 0 0",    # 17
        "v 10 0 0",   # 18
        "v 10 0 8",   # 19
        "v 5 0 8",    # 20
        # Floor 1 (y=3): left slab
        "v 0 3 0",    # 21
        "v 5 3 0",    # 22
        "v 5 3 8",    # 23
        "v 0 3 8",    # 24
        # Floor 1 (y=3): right slab
        "v 5 3 0",    # 25
        "v 10 3 0",   # 26
        "v 10 3 8",   # 27
        "v 5 3 8",    # 28
        # Floor 2 (y=6): left slab
        "v 0 6 0",    # 29
        "v 5 6 0",    # 30
        "v 5 6 8",    # 31
        "v 0 6 8",    # 32
        # Floor 2 (y=6): right slab
        "v 5 6 0",    # 33
        "v 10 6 0",   # 34
        "v 10 6 8",   # 35
        "v 5 6 8",    # 36
        # Floor 3 (y=9): left slab
        "v 0 9 0",    # 37
        "v 5 9 0",    # 38
        "v 5 9 8",    # 39
        "v 0 9 8",    # 40
        # Floor 3 (y=9): right slab
        "v 5 9 0",    # 41
        "v 10 9 0",   # 42
        "v 10 9 8",   # 43
        "v 5 9 8",    # 44
        # Roof (y=12): left slab
        "v 0 12 0",   # 45
        "v 5 12 0",   # 46
        "v 5 12 8",   # 47
        "v 0 12 8",   # 48
        # Roof (y=12): right slab
        "v 5 12 0",   # 49
        "v 10 12 0",  # 50
        "v 10 12 8",  # 51
        "v 5 12 8",   # 52
        # Exterior walls
        "f 1 2 6 5",
        "f 2 3 7 6",
        "f 3 4 8 7",
        "f 4 1 5 8",
        # Interior wall
        "f 9 12 11 10",
        # All slabs (2 per floor x 5 levels = 10 horizontal faces)
        "f 13 14 15 16",
        "f 17 18 19 20",
        "f 21 22 23 24",
        "f 25 26 27 28",
        "f 29 30 31 32",
        "f 33 34 35 36",
        "f 37 38 39 40",
        "f 41 42 43 44",
        "f 45 46 47 48",
        "f 49 50 51 52",
    ]
    return "\n".join(lines).encode("utf-8")


def test_floor_detection_merges_slabs_same_level():
    """Multiple slabs at the same elevation should merge into one floor.

    The building has 5 slab levels (y=0,3,6,9,12), each with 2 slabs.
    Gap-based detection should produce exactly 5 floors, NOT 10.
    """
    obj_data = _make_multistory_multi_slab_y_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("building.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={
            "scale": "100",
            "paper": "A3",
            "formats": "dxf",
            "include_floor_plans": "true",
        },
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()

    floor_dxfs = [n for n in names if "Planta_Piso" in n]
    # 5 slab levels detected (y=0,3,6,9,12), but the roof at y=12
    # produces no floor plan (no walls above it), so 4 useful plans.
    # The key test: NOT 10 (one per slab panel).
    assert len(floor_dxfs) == 4, (
        f"Expected 4 floor plans (roof has no walls above), got {len(floor_dxfs)}: {floor_dxfs}"
    )


# ---------------------------------------------------------------------------
# Door detection tests
# ---------------------------------------------------------------------------


def _make_box_with_door_y_up() -> bytes:
    """Create a box building (Y-up) with a door component.

    Building: 6x4x3m (exterior walls).
    Door: 0.8m wide, 2.1m tall, 4cm thick, placed in the front wall
    at x=2..2.8, z=0 (front face at z=0, back at z=0.04).
    The door group is named "Puerta_principal".

    A floor slab at y=0 (>2 m²) is needed for floor-level detection.
    """
    lines = [
        "# Box 6x4x3m Y-up with door",
        # Outer vertices
        "v 0 0 0",     # 1
        "v 6 0 0",     # 2
        "v 6 0 4",     # 3
        "v 0 0 4",     # 4
        "v 0 3 0",     # 5
        "v 6 3 0",     # 6
        "v 6 3 4",     # 7
        "v 0 3 4",     # 8
        # Floor slab at y=0 (8 vertices reused, horizontal face)
        "v 0 0 0",     # 9
        "v 6 0 0",     # 10
        "v 6 0 4",     # 11
        "v 0 0 4",     # 12
        # Front wall LEFT of door opening (x=0..2, z=0)
        "v 0 0 0",     # 13
        "v 2 0 0",     # 14
        "v 2 3 0",     # 15
        "v 0 3 0",     # 16
        # Front wall RIGHT of door opening (x=2.8..6, z=0)
        "v 2.8 0 0",   # 17
        "v 6 0 0",     # 18
        "v 6 3 0",     # 19
        "v 2.8 3 0",   # 20
        # Door leaf: thin vertical rectangle at z=0..0.04, x=2..2.8, y=0..2.1
        "v 2.0 0.0 0.0",    # 21  front-left-bottom
        "v 2.8 0.0 0.0",    # 22  front-right-bottom
        "v 2.8 2.1 0.0",    # 23  front-right-top
        "v 2.0 2.1 0.0",    # 24  front-left-top
        "v 2.0 0.0 0.04",   # 25  back-left-bottom
        "v 2.8 0.0 0.04",   # 26  back-right-bottom
        "v 2.8 2.1 0.04",   # 27  back-right-top
        "v 2.0 2.1 0.04",   # 28  back-left-top
        # Exterior walls (sides and back)
        "f 2 3 7 6",    # right wall
        "f 3 4 8 7",    # back wall
        "f 4 1 5 8",    # left wall
        # Floor slab (horizontal, needed for floor detection)
        "f 9 10 11 12",
        # Front wall (split around door opening)
        "f 13 14 15 16",   # left of door
        "f 17 18 19 20",   # right of door
        # Door component
        "g Puerta_principal",
        "f 21 22 23 24",   # front face (normal -Z)
        "f 28 27 26 25",   # back face (normal +Z)
        "f 21 25 26 22",   # bottom
        "f 24 23 27 28",   # top
        "f 21 24 28 25",   # left side (hinge)
        "f 22 26 27 23",   # right side
    ]
    return "\n".join(lines).encode("utf-8")


def test_door_detected_in_floor_plan():
    """A building with a named door group should produce a floor plan
    with the ABERTURAS layer and ARC entities in the DXF."""
    obj_data = _make_box_with_door_y_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("house_door.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={
            "scale": "100",
            "paper": "A3",
            "formats": "dxf",
            "include_floor_plans": "true",
        },
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()

    floor_dxfs = [n for n in names if "Planta_Piso" in n]
    assert len(floor_dxfs) >= 1, f"Expected floor plan DXFs, got {names}"

    # The floor plan DXF should contain the ABERTURAS layer.
    dxf_content = zf.read(floor_dxfs[0]).decode("utf-8")
    assert "ABERTURAS" in dxf_content, "Expected ABERTURAS layer in floor plan DXF"


def test_door_arc_entity_present():
    """The floor plan DXF should contain an ARC entity for the door swing."""
    obj_data = _make_box_with_door_y_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("house_door.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={
            "scale": "100",
            "paper": "A3",
            "formats": "dxf",
            "include_floor_plans": "true",
        },
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()

    floor_dxfs = [n for n in names if "Planta_Piso" in n]
    assert len(floor_dxfs) >= 1

    dxf_content = zf.read(floor_dxfs[0]).decode("utf-8")
    # ezdxf writes ARC entities
    assert "ARC" in dxf_content, "Expected ARC entity in floor plan DXF for door swing"


def test_door_excluded_from_wall_segments():
    """Door faces should NOT appear as wall segments in the floor plan.
    The floor plan should have fewer segments than a model without the
    door group (the door leaf is excluded from the section cut)."""
    obj_data = _make_box_with_door_y_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("house_door.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={
            "scale": "100",
            "paper": "A3",
            "formats": "dxf,pdf",
            "include_floor_plans": "true",
        },
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()

    # Should still have facades + floor plans + pdf.
    facade_dxfs = [n for n in names if "Fachada" in n]
    floor_dxfs = [n for n in names if "Planta_Piso" in n]
    pdf_files = [n for n in names if n.endswith(".pdf")]
    assert len(facade_dxfs) >= 1, f"Expected facade DXFs, got {names}"
    assert len(floor_dxfs) >= 1, f"Expected floor plan DXFs, got {names}"
    assert len(pdf_files) == 1


def test_no_door_group_no_aberturas_entities():
    """A model WITHOUT door groups should still produce valid floor plans
    (just no door entities on ABERTURAS layer)."""
    obj_data = _make_multistory_with_slabs_y_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("building.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={
            "scale": "100",
            "paper": "A3",
            "formats": "dxf",
            "include_floor_plans": "true",
        },
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()
    floor_dxfs = [n for n in names if "Planta_Piso" in n]
    assert len(floor_dxfs) >= 1

    # ABERTURAS layer is defined in the header (harmless) but there should
    # be no ARC entities since there are no doors.
    dxf_content = zf.read(floor_dxfs[0]).decode("utf-8")
    # The layer definition will contain "ABERTURAS" but there should be
    # no ARC entity in the ENTITIES section.
    # Count occurrences: "ARC" should only appear in layer/linetype definitions,
    # not as an entity type.
    entities_section = dxf_content.split("ENTITIES")[1] if "ENTITIES" in dxf_content else ""
    # In ezdxf output, ARC as entity type appears as "\nARC\n"
    arc_count = entities_section.count("\nARC\n")
    assert arc_count == 0, f"Expected no ARC entities without doors, found {arc_count}"


# ---------------------------------------------------------------------------
# New laser-cutting pipeline tests
# ---------------------------------------------------------------------------


def _make_box_with_hole_z_up() -> bytes:
    """Create a box with a hole in the front wall (Z-up).

    The front wall has a rectangular hole (window) modeled as two quads
    on either side of the hole, plus top and bottom strips.
    """
    lines = [
        "# Box 6x4x3m Z-up with hole in front wall",
        # Outer vertices of front wall
        "v 0 0 0",     # 1: bottom-left
        "v 6 0 0",     # 2: bottom-right
        "v 6 0 3",     # 3: top-right
        "v 0 0 3",     # 4: top-left
        # Hole vertices (1m x 1m hole centered at x=3, z=1.5)
        "v 2 0 1",     # 5: hole bottom-left
        "v 4 0 1",     # 6: hole bottom-right
        "v 4 0 2",     # 7: hole top-right
        "v 2 0 2",     # 8: hole top-left
        # Front wall faces around the hole:
        "f 1 2 6 5",   # Bottom strip
        "f 5 8 4 1",   # Left strip
        "f 6 2 3 7",   # Right strip
        "f 8 7 3 4",   # Top strip
        # Right wall (solid)
        "v 6 4 0",     # 9
        "v 6 4 3",     # 10
        "f 2 9 10 3",
        # Back wall (solid)
        "v 0 4 0",     # 11
        "v 0 4 3",     # 12
        "f 9 11 12 10",
        # Left wall (solid)
        "f 11 1 4 12",
    ]
    return "\n".join(lines).encode("utf-8")


def _make_inclined_wall() -> bytes:
    """Create a wall inclined 30 degrees from vertical (Z-up).

    A flat quad tilted 30° — its real dimensions are 4m wide x 3m tall,
    but a naive XY projection would show it shorter.
    """
    import math
    # Wall normal is tilted 30° from Z-axis toward Y
    # Wall plane: 4m wide (along X), 3m tall (along tilted direction)
    # Bottom edge at y=0, z=0; top edge at y=3*sin(30°), z=3*cos(30°)
    tilt = math.radians(30)
    dy = 3.0 * math.sin(tilt)  # 1.5
    dz = 3.0 * math.cos(tilt)  # 2.598

    lines = [
        "# Inclined wall 4x3m, tilted 30° from vertical, Z-up",
        f"v 0 0 0",
        f"v 4 0 0",
        f"v 4 {dy} {dz}",
        f"v 0 {dy} {dz}",
        "f 1 2 3 4",
    ]
    return "\n".join(lines).encode("utf-8")


def test_cutting_dxf_has_4_layers():
    """Cutting sheet DXF should have all 4 laser-cutter layers."""
    obj_data = _make_box_z_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("house.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={
            "scale": "100", "paper": "A3", "formats": "dxf",
            "include_cutting_sheet": "true",
        },
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()
    cutting_dxfs = [n for n in names if "corte_paredes" in n]
    assert len(cutting_dxfs) >= 1, f"Expected cutting DXF, got {names}"

    dxf_content = zf.read(cutting_dxfs[0]).decode("utf-8")
    assert "CUT_INTERIOR" in dxf_content, "Missing CUT_INTERIOR layer"
    assert "ENGRAVE_VECTOR" in dxf_content, "Missing ENGRAVE_VECTOR layer"
    assert "ENGRAVE_RASTER" in dxf_content, "Missing ENGRAVE_RASTER layer"
    assert "CUT_EXTERIOR" in dxf_content, "Missing CUT_EXTERIOR layer"


def test_cutting_dxf_layer_colors():
    """Cutting sheet layers should have exact RGB true colors."""
    obj_data = _make_box_z_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("house.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={
            "scale": "100", "paper": "A3", "formats": "dxf",
            "include_cutting_sheet": "true",
        },
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()
    cutting_dxfs = [n for n in names if "corte_paredes" in n]
    assert len(cutting_dxfs) >= 1

    import ezdxf
    dxf_text = zf.read(cutting_dxfs[0]).decode("utf-8")
    doc = ezdxf.read(io.StringIO(dxf_text))

    # Verify true colors on each layer (group code 420 = RGB integer).
    layer_ci = doc.layers.get("CUT_INTERIOR")
    assert layer_ci is not None
    ci_rgb = ezdxf.colors.int2rgb(layer_ci.dxf.true_color)
    assert ci_rgb == ezdxf.colors.RGB(0, 255, 0), \
        f"CUT_INTERIOR color should be green, got {ci_rgb}"

    layer_ce = doc.layers.get("CUT_EXTERIOR")
    assert layer_ce is not None
    ce_rgb = ezdxf.colors.int2rgb(layer_ce.dxf.true_color)
    assert ce_rgb == ezdxf.colors.RGB(255, 0, 0), \
        f"CUT_EXTERIOR color should be red, got {ce_rgb}"

    layer_ev = doc.layers.get("ENGRAVE_VECTOR")
    assert layer_ev is not None
    ev_rgb = ezdxf.colors.int2rgb(layer_ev.dxf.true_color)
    assert ev_rgb == ezdxf.colors.RGB(0, 0, 255), \
        f"ENGRAVE_VECTOR color should be blue, got {ev_rgb}"

    layer_er = doc.layers.get("ENGRAVE_RASTER")
    assert layer_er is not None
    er_rgb = ezdxf.colors.int2rgb(layer_er.dxf.true_color)
    assert er_rgb == ezdxf.colors.RGB(0, 0, 0), \
        f"ENGRAVE_RASTER color should be black, got {er_rgb}"


def test_cutting_dxf_lineweight():
    """Cut layers should have 0.01mm lineweight."""
    obj_data = _make_box_z_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("house.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={
            "scale": "100", "paper": "A3", "formats": "dxf",
            "include_cutting_sheet": "true",
        },
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    cutting_dxfs = [n for n in zf.namelist() if "corte_paredes" in n]
    assert len(cutting_dxfs) >= 1

    import ezdxf
    doc = ezdxf.read(io.StringIO(zf.read(cutting_dxfs[0]).decode("utf-8")))

    # ezdxf lineweight is in 1/100 mm units; 5 = 0.05mm (thinnest standard)
    for layer_name in ["CUT_INTERIOR", "CUT_EXTERIOR", "ENGRAVE_VECTOR"]:
        layer = doc.layers.get(layer_name)
        assert layer is not None, f"Layer {layer_name} missing"
        assert layer.dxf.lineweight == 5, \
            f"{layer_name} lineweight should be 5 (0.05mm), got {layer.dxf.lineweight}"


def test_inclined_wall_real_dimensions():
    """An inclined wall should produce a cutting piece with real dimensions.

    A 4m x 3m wall tilted 30° from vertical should produce a cutting piece
    with dimensions close to 4000mm x 3000mm, NOT the projected dimensions.
    """
    from app.core.obj_parser import parse_obj
    from app.core.plan_extractor import extract_components, extract_cutting_pieces
    from app.core.pipeline import detect_up_axis

    obj_text = _make_inclined_wall().decode("utf-8")
    result = parse_obj(obj_text)
    faces = result.faces
    assert len(faces) >= 1

    up_axis = detect_up_axis(faces)

    # Run decomposition to tag faces.
    sheets = extract_components(faces, gap=0.5, up_axis=up_axis)

    # Extract cutting pieces.
    wall_pieces, slab_pieces, warnings = extract_cutting_pieces(
        faces, up_axis=up_axis, kerf_mm=0.0, unit_scale=1000.0,
    )

    # The inclined wall should produce at least one cutting piece.
    all_pieces = wall_pieces + slab_pieces
    assert len(all_pieces) >= 1, f"Expected cutting pieces, got {len(all_pieces)}"

    piece = all_pieces[0]
    # Real dimensions: 4m wide, 3m tall → 4000mm x 3000mm
    # Allow 5% tolerance for floating point.
    assert abs(piece.width_mm - 4000.0) < 200.0, \
        f"Width should be ~4000mm, got {piece.width_mm}"
    assert abs(piece.height_mm - 3000.0) < 200.0, \
        f"Height should be ~3000mm, got {piece.height_mm}"


def test_contour_extraction_nonrectangular():
    """An L-shaped piece made of two triangles should produce a non-rectangular contour.

    Uses two triangles sharing an edge to form a quadrilateral that isn't
    a rectangle — proving the system extracts real contours, not bounding boxes.
    """
    from app.core.geometry_classifier import compute_weighted_normal, rotate_vertices_to_xy
    from app.core.contour_extractor import extract_piece_contours
    from app.core.types import Face3D, Vec3

    # Two triangles sharing edge (0,0,0)-(4,0,0), forming a non-rectangular
    # quadrilateral in the Y=0 plane.
    faces = [
        Face3D(
            vertices=[Vec3(0, 0, 0), Vec3(4, 0, 0), Vec3(2, 0, 3)],
            normal=Vec3(0, -1, 0),
        ),
        Face3D(
            vertices=[Vec3(0, 0, 0), Vec3(4, 0, 0), Vec3(3, 0, -1)],
            normal=Vec3(0, -1, 0),
        ),
    ]

    normal = compute_weighted_normal(faces)
    face_verts_2d = []
    for face in faces:
        rotated = rotate_vertices_to_xy(face.vertices, normal)
        face_verts_2d.append([(x, y) for x, y, z in rotated])

    outer, inners, outer_kerf, inners_kerf = extract_piece_contours(
        face_verts_2d, kerf_mm=0.0, scale_to_mm=1.0,
    )

    # The two-triangle shape should have 4 boundary vertices (not 3, since
    # the shared edge is internal and gets eliminated).
    assert len(outer) >= 4, \
        f"Two-triangle shape should have >= 4 boundary vertices, got {len(outer)}"
    # The contour should NOT be a rectangle — verify it's not axis-aligned.
    # A bounding box approach would give a rectangle; real contour gives the diamond.
    xs = [v.x for v in outer]
    ys = [v.y for v in outer]
    bbox_area = (max(xs) - min(xs)) * (max(ys) - min(ys))
    # Compute actual polygon area via shoelace.
    n = len(outer)
    poly_area = abs(sum(
        outer[i].x * outer[(i + 1) % n].y - outer[(i + 1) % n].x * outer[i].y
        for i in range(n)
    )) / 2.0
    # Real contour area should be less than bounding box area.
    assert poly_area < bbox_area * 0.99, \
        f"Real contour area ({poly_area:.2f}) should be < bbox area ({bbox_area:.2f})"


def test_wall_with_hole_has_inner_loop():
    """A wall with a window hole should produce inner loops in CUT_INTERIOR."""
    from app.core.geometry_classifier import compute_weighted_normal, rotate_vertices_to_xy
    from app.core.contour_extractor import extract_piece_contours
    from app.core.types import Face3D, Vec3

    # Front wall with hole (from _make_box_with_hole_z_up, front wall faces only)
    faces = [
        Face3D(
            vertices=[Vec3(0, 0, 0), Vec3(6, 0, 0), Vec3(4, 0, 1), Vec3(2, 0, 1)],
            normal=Vec3(0, -1, 0),
        ),
        Face3D(
            vertices=[Vec3(2, 0, 1), Vec3(2, 0, 2), Vec3(0, 0, 3), Vec3(0, 0, 0)],
            normal=Vec3(0, -1, 0),
        ),
        Face3D(
            vertices=[Vec3(4, 0, 1), Vec3(6, 0, 0), Vec3(6, 0, 3), Vec3(4, 0, 2)],
            normal=Vec3(0, -1, 0),
        ),
        Face3D(
            vertices=[Vec3(2, 0, 2), Vec3(4, 0, 2), Vec3(6, 0, 3), Vec3(0, 0, 3)],
            normal=Vec3(0, -1, 0),
        ),
    ]

    normal = compute_weighted_normal(faces)
    face_verts_2d = []
    for face in faces:
        rotated = rotate_vertices_to_xy(face.vertices, normal)
        face_verts_2d.append([(x, y) for x, y, z in rotated])

    outer, inners, _, _ = extract_piece_contours(
        face_verts_2d, kerf_mm=0.0, scale_to_mm=1.0,
    )

    assert len(outer) >= 4, f"Should have outer contour, got {len(outer)} vertices"
    assert len(inners) >= 1, f"Should have at least 1 inner loop (hole), got {len(inners)}"


def test_geometry_classifier_flat_panel():
    """A single flat quad should be classified as FLAT_PANEL."""
    from app.core.geometry_classifier import classify_piece
    from app.core.types import Face3D, PieceType, Vec3

    face = Face3D(
        vertices=[Vec3(0, 0, 0), Vec3(4, 0, 0), Vec3(4, 0, 3), Vec3(0, 0, 3)],
        normal=Vec3(0, -1, 0),
    )
    result = classify_piece([face])
    assert result == PieceType.FLAT_PANEL


def test_rodrigues_rotation_identity():
    """A normal already pointing up should produce identity rotation."""
    from app.core.geometry_classifier import rotation_matrix_to_z
    from app.core.types import Vec3
    import numpy as np

    R = rotation_matrix_to_z(Vec3(0, 0, 1))
    assert np.allclose(R, np.eye(3)), f"Should be identity, got {R}"


def test_rodrigues_rotation_horizontal():
    """A horizontal normal should rotate to Z correctly."""
    from app.core.geometry_classifier import rotation_matrix_to_z
    from app.core.types import Vec3
    import numpy as np

    # Normal pointing in Y direction
    R = rotation_matrix_to_z(Vec3(0, 1, 0))
    n = np.array([0, 1, 0], dtype=np.float64)
    rotated = R @ n
    assert np.allclose(rotated, [0, 0, 1], atol=1e-10), \
        f"Y normal should rotate to Z, got {rotated}"


# ---------------------------------------------------------------------------
# Bug-fix tests
# ---------------------------------------------------------------------------


def test_cutting_dxf_entity_true_colors():
    """Every entity in the cutting DXF should have true_color set directly."""
    obj_data = _make_box_z_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("house.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={
            "scale": "100", "paper": "A3", "formats": "dxf",
            "include_cutting_sheet": "true",
        },
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    cutting_dxfs = [n for n in zf.namelist() if "corte_" in n]
    assert len(cutting_dxfs) >= 1

    import ezdxf
    dxf_text = zf.read(cutting_dxfs[0]).decode("utf-8")
    doc = ezdxf.read(io.StringIO(dxf_text))
    msp = doc.modelspace()

    # Expected true_color integers by layer.
    expected_colors = {
        "CUT_INTERIOR": ezdxf.colors.rgb2int((0, 255, 0)),
        "ENGRAVE_VECTOR": ezdxf.colors.rgb2int((0, 0, 255)),
        "ENGRAVE_RASTER": ezdxf.colors.rgb2int((0, 0, 0)),
        "CUT_EXTERIOR": ezdxf.colors.rgb2int((255, 0, 0)),
    }

    entities_without_color = 0
    entities_wrong_color = 0
    for entity in msp:
        layer = entity.dxf.layer
        if layer not in expected_colors:
            continue
        if not entity.dxf.hasattr("true_color"):
            entities_without_color += 1
            continue
        if entity.dxf.true_color != expected_colors[layer]:
            entities_wrong_color += 1

    assert entities_without_color == 0, \
        f"{entities_without_color} entities missing true_color"
    assert entities_wrong_color == 0, \
        f"{entities_wrong_color} entities have wrong true_color"


def test_boundary_edges_no_internal_triangulation():
    """Boundary edge extraction should not include internal triangulation edges."""
    from app.core.contour_extractor import extract_boundary_edges_2d, chain_edges_into_loops

    # A 4x3 rectangle made of 2 triangles sharing the diagonal edge (0,0)-(4,3).
    # The diagonal is internal (shared by both faces) and should NOT appear.
    tri1 = [(0.0, 0.0), (4.0, 0.0), (4.0, 3.0)]
    tri2 = [(0.0, 0.0), (4.0, 3.0), (0.0, 3.0)]

    boundary = extract_boundary_edges_2d([tri1, tri2])
    loops = chain_edges_into_loops(boundary)

    # Should produce exactly 1 loop with 4 vertices (the rectangle outline).
    assert len(loops) == 1, f"Expected 1 loop, got {len(loops)}"
    assert len(loops[0]) == 4, \
        f"Rectangle should have 4 boundary vertices, got {len(loops[0])}"

    # No edge should be the internal diagonal (0,0)-(4,3).
    for (a, b) in boundary:
        is_diagonal = (
            (abs(a[0]) < 0.01 and abs(a[1]) < 0.01 and abs(b[0] - 4) < 0.01 and abs(b[1] - 3) < 0.01)
            or (abs(b[0]) < 0.01 and abs(b[1]) < 0.01 and abs(a[0] - 4) < 0.01 and abs(a[1] - 3) < 0.01)
        )
        assert not is_diagonal, "Internal diagonal edge should have been removed"


def test_boundary_edges_with_floating_point_drift():
    """Boundary edges should handle small floating-point differences from rotation."""
    from app.core.contour_extractor import extract_boundary_edges_2d, chain_edges_into_loops

    # Same rectangle as above, but the shared edge has tiny floating-point drift
    # simulating what happens after Rodrigues rotation.
    tri1 = [(0.0, 0.0), (4.0, 0.0), (4.0 + 1e-7, 3.0 - 2e-7)]
    tri2 = [(0.0 + 5e-8, 0.0 - 1e-8), (4.0, 3.0), (0.0, 3.0)]

    boundary = extract_boundary_edges_2d([tri1, tri2])
    loops = chain_edges_into_loops(boundary)

    # Should still produce 1 loop with 4 vertices despite the drift.
    assert len(loops) == 1, \
        f"Expected 1 loop despite float drift, got {len(loops)}"
    assert len(loops[0]) == 4, \
        f"Rectangle should have 4 vertices despite drift, got {len(loops[0])}"


def test_deduplicate_wall_pieces():
    """Pieces with identical dimensions should be deduplicated."""
    from app.core.plan_extractor import _deduplicate_pieces
    from app.core.types import CuttingPiece, PieceType, Vec2

    # Create 3 pieces: two with identical dims, one different.
    p1 = CuttingPiece(
        ref_id="A1", piece_type=PieceType.FLAT_PANEL,
        outer_contour=[Vec2(0, 0), Vec2(100, 0), Vec2(100, 200), Vec2(0, 200)],
        inner_loops=[], outer_kerf=[], inner_kerf=[],
        width_mm=100.0, height_mm=200.0,
    )
    p2 = CuttingPiece(
        ref_id="A2", piece_type=PieceType.FLAT_PANEL,
        outer_contour=[Vec2(0, 0), Vec2(100, 0), Vec2(100, 200), Vec2(0, 200)],
        inner_loops=[], outer_kerf=[], inner_kerf=[],
        width_mm=100.5, height_mm=199.8,  # Within 5mm tolerance
    )
    p3 = CuttingPiece(
        ref_id="A3", piece_type=PieceType.FLAT_PANEL,
        outer_contour=[Vec2(0, 0), Vec2(300, 0), Vec2(300, 400), Vec2(0, 400)],
        inner_loops=[], outer_kerf=[], inner_kerf=[],
        width_mm=300.0, height_mm=400.0,
    )

    result = _deduplicate_pieces([p1, p2, p3])
    assert len(result) == 2, f"Expected 2 unique pieces, got {len(result)}"
    assert result[0].ref_id == "A1"
    assert result[1].ref_id == "A3"


def test_facade_dxf_entity_true_colors():
    """Facade DXF entities should have entity-level true_color set."""
    obj_data = _make_box_y_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("house.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={"scale": "100", "paper": "A3", "formats": "dxf"},
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    # Get a facade DXF (not decomposition, not cutting sheet).
    facade_dxfs = [n for n in zf.namelist()
                   if n.endswith(".dxf") and "Fachada" in n]
    assert len(facade_dxfs) >= 1

    import ezdxf
    dxf_text = zf.read(facade_dxfs[0]).decode("utf-8")
    doc = ezdxf.read(io.StringIO(dxf_text))
    msp = doc.modelspace()

    expected_colors = {
        "CUT_EXTERIOR": ezdxf.colors.rgb2int((255, 0, 0)),
        "ENGRAVE_VECTOR": ezdxf.colors.rgb2int((0, 0, 255)),
        "ENGRAVE_RASTER": ezdxf.colors.rgb2int((0, 0, 0)),
    }

    entities_without_color = 0
    for entity in msp:
        layer = entity.dxf.layer
        if layer not in expected_colors:
            continue
        if not entity.dxf.hasattr("true_color"):
            entities_without_color += 1

    assert entities_without_color == 0, \
        f"{entities_without_color} facade entities missing true_color"


def test_component_dxf_entity_true_colors():
    """Component decomposition DXF entities should have entity-level true_color."""
    obj_data = _make_box_y_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("house.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={
            "scale": "100", "paper": "A3", "formats": "dxf",
            "include_plan": "true",
        },
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    comp_dxfs = [n for n in zf.namelist()
                 if n.endswith(".dxf") and "Descomposicion" in n]
    assert len(comp_dxfs) >= 1

    import ezdxf
    dxf_text = zf.read(comp_dxfs[0]).decode("utf-8")
    doc = ezdxf.read(io.StringIO(dxf_text))
    msp = doc.modelspace()

    expected_colors = {
        "CUT_EXTERIOR": ezdxf.colors.rgb2int((255, 0, 0)),
        "ENGRAVE_VECTOR": ezdxf.colors.rgb2int((0, 0, 255)),
        "ENGRAVE_RASTER": ezdxf.colors.rgb2int((0, 0, 0)),
    }

    entities_without_color = 0
    for entity in msp:
        layer = entity.dxf.layer
        if layer not in expected_colors:
            continue
        if not entity.dxf.hasattr("true_color"):
            entities_without_color += 1

    assert entities_without_color == 0, \
        f"{entities_without_color} component entities missing true_color"


def test_no_old_layer_names_in_dxf():
    """No DXF output should contain old layer names CORTE, GRABADO, MARCA."""
    obj_data = _make_box_z_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("house.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={
            "scale": "100", "paper": "A3", "formats": "dxf",
            "include_plan": "true",
            "include_cutting_sheet": "true",
        },
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))

    import ezdxf
    for name in zf.namelist():
        if not name.endswith(".dxf"):
            continue
        dxf_text = zf.read(name).decode("utf-8")
        doc = ezdxf.read(io.StringIO(dxf_text))
        layer_names = [l.dxf.name for l in doc.layers]
        for old_name in ["CORTE", "GRABADO", "MARCA"]:
            assert old_name not in layer_names, \
                f"Old layer '{old_name}' found in {name}"
