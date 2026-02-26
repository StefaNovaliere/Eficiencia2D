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
