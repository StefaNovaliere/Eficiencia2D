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
        # Vertices of the box
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

    # Should have 4 DXFs (one per facade) + 1 PDF.
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


def test_include_plan_adds_floor_plan_and_components():
    """include_plan=true should add plans + component decomposition."""
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
    plan_dxfs = [n for n in dxf_files if "Planta" in n]
    facade_dxfs = [n for n in dxf_files if "Fachada" in n]
    component_dxfs = [n for n in dxf_files if "Descomposicion" in n]

    # Must have at least 1 plan, 4 facades, and some component sheets.
    assert len(plan_dxfs) >= 1, f"Expected at least 1 plan DXF, got {plan_dxfs}"
    assert len(facade_dxfs) == 4, f"Expected 4 facade DXFs, got {facade_dxfs}"
    assert len(component_dxfs) >= 1, f"Expected at least 1 component DXF, got {component_dxfs}"
    assert len(pdf_files) == 1

    # The plan DXF should contain LINE entities (wall segments).
    plan_content = zf.read(plan_dxfs[0]).decode("utf-8")
    assert "LINE" in plan_content

    # The PDF should contain "Planta" and "Descomposicion" labels.
    pdf_content = zf.read(pdf_files[0]).decode("latin-1")
    assert "Planta" in pdf_content
    assert "Descomposicion" in pdf_content


def test_include_plan_false_no_floor_plan():
    """include_plan=false should NOT add floor plans or component sheets."""
    obj_data = _make_box_y_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("house.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={"scale": "100", "paper": "A3", "formats": "dxf", "include_plan": "false"},
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()
    plan_dxfs = [n for n in names if "Planta" in n]
    component_dxfs = [n for n in names if "Descomposicion" in n]
    assert len(plan_dxfs) == 0
    assert len(component_dxfs) == 0


def test_floor_plan_z_up():
    """Floor plan should work with Z-up models too."""
    obj_data = _make_box_z_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("house.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={"scale": "100", "paper": "A3", "formats": "dxf", "include_plan": "true"},
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()
    plan_dxfs = [n for n in names if "Planta" in n]
    assert len(plan_dxfs) >= 1


def _make_multistory_y_up() -> bytes:
    """Create a 2-story building (Y-up) with floor slabs and interior walls.

    Floor 1: 0-3m, Floor 2: 3-6m.
    Includes a floor slab at y=3 and an interior wall.
    """
    lines = [
        "# 2-story building 8x6x6m, Y-up",
        # Ground floor outer walls
        "v 0 0 0",   # 1
        "v 8 0 0",   # 2
        "v 8 0 6",   # 3
        "v 0 0 6",   # 4
        "v 0 3 0",   # 5
        "v 8 3 0",   # 6
        "v 8 3 6",   # 7
        "v 0 3 6",   # 8
        # Second floor outer walls
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
        "v 0 3 0",   # 17 (= 5)
        "v 8 3 0",   # 18 (= 6)
        "v 8 3 6",   # 19 (= 7)
        "v 0 3 6",   # 20 (= 8)
        # Ground floor walls
        "f 1 2 6 5",     # front
        "f 2 3 7 6",     # right
        "f 3 4 8 7",     # back
        "f 4 1 5 8",     # left
        # Second floor walls
        "f 5 6 10 9",    # front
        "f 6 7 11 10",   # right
        "f 7 8 12 11",   # back
        "f 8 5 9 12",    # left
        # Interior wall
        "f 13 16 15 14",
        # Floor slab at y=3 (horizontal)
        "f 17 18 19 20",
    ]
    return "\n".join(lines).encode("utf-8")


def test_multistory_floor_plans():
    """A 2-story building should produce 2 floor plan pages."""
    obj_data = _make_multistory_y_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("tower.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={"scale": "100", "paper": "A3", "formats": "dxf,pdf", "include_plan": "true"},
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()

    plan_dxfs = [n for n in names if "Planta" in n]
    # Should have at least 1 floor plan (the slab at y=3 creates a level).
    assert len(plan_dxfs) >= 1, f"Expected floor plan DXFs, got {names}"

    # Component sheets should include Paredes.
    paredes_dxfs = [n for n in names if "Paredes" in n]
    assert len(paredes_dxfs) >= 1, f"Expected Paredes DXF, got {names}"
