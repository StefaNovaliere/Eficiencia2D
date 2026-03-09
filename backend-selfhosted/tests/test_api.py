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

    # The cutting sheet DXF should have proper layers.
    dxf_content = zf.read(cutting_dxfs[0]).decode("utf-8")
    assert "CORTE" in dxf_content
    assert "GRABADO" in dxf_content


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
    """DXF output should use CORTE/MARCA/GRABADO layers."""
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
    assert "CORTE" in dxf_content
    assert "MARCA" in dxf_content
    assert "GRABADO" in dxf_content
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
    assert "CORTE" in dxf_content
    assert "GRABADO" in dxf_content


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
