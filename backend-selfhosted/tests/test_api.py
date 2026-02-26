"""
Tests for the FastAPI upload endpoint.

These tests run against the pure-Python pipeline -- no C++ translator or
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
    """A non-.skp file should be rejected at the header check."""
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
    """A .stl file should be rejected."""
    fake = io.BytesIO(b"solid model\n")
    resp = client.post(
        "/api/upload",
        files={"file": ("model.stl", fake, "application/octet-stream")},
        data={"scale": "100", "paper": "A3", "formats": "dxf"},
    )
    assert resp.status_code == 400
    assert "unsupported" in resp.json()["detail"].lower()


def _make_obj_wall_z_up() -> bytes:
    """Create an OBJ with a vertical wall in Z-up convention (4m x 3m).

    Wall on XZ plane, normal pointing along Y.
    Coordinates in meters.
    """
    lines = [
        "# Z-up wall: 4m wide, 3m tall",
        "v 0 0 0",
        "v 4 0 0",
        "v 4 0 3",
        "v 0 0 3",
        "f 1 2 3 4",
    ]
    return "\n".join(lines).encode("utf-8")


def _make_obj_wall_y_up() -> bytes:
    """Create an OBJ with a vertical wall in Y-up convention (4m x 3m).

    Wall on XY plane, normal pointing along Z.
    Coordinates in meters.
    """
    lines = [
        "# Y-up wall: 4m wide, 3m tall",
        "v 0 0 0",
        "v 4 0 0",
        "v 4 3 0",
        "v 0 3 0",
        "f 1 2 3 4",
    ]
    return "\n".join(lines).encode("utf-8")


def test_upload_obj_z_up_produces_zip():
    """Upload a valid Z-up .obj wall and get a ZIP back."""
    obj_data = _make_obj_wall_z_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("house.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={"scale": "100", "paper": "A3", "formats": "dxf,pdf"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()
    assert "house.dxf" in names
    assert "house.pdf" in names


def test_upload_obj_y_up_produces_zip():
    """Upload a valid Y-up .obj wall and get a ZIP back."""
    obj_data = _make_obj_wall_y_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("tower.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={"scale": "100", "paper": "A3", "formats": "dxf,pdf"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()
    assert "tower.dxf" in names
    assert "tower.pdf" in names


def test_upload_obj_dxf_only():
    """Request only DXF format."""
    obj_data = _make_obj_wall_z_up()
    resp = client.post(
        "/api/upload",
        files={"file": ("house.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={"scale": "50", "paper": "A1", "formats": "dxf"},
    )
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()
    assert "house.dxf" in names
    assert "house.pdf" not in names


def test_upload_obj_centimeters():
    """An OBJ in centimeters (wall 400cm x 300cm) should still work."""
    lines = [
        "# Y-up wall in cm: 400cm wide, 300cm tall",
        "v 0 0 0",
        "v 400 0 0",
        "v 400 300 0",
        "v 0 300 0",
        "f 1 2 3 4",
    ]
    obj_data = "\n".join(lines).encode("utf-8")
    resp = client.post(
        "/api/upload",
        files={"file": ("cm_model.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={"scale": "100", "paper": "A3", "formats": "dxf"},
    )
    assert resp.status_code == 200


def test_upload_obj_no_walls():
    """An .obj with no faces at all should return 422."""
    lines = [
        "# Only vertices, no faces",
        "v 0 0 0",
        "v 1 0 0",
        "v 1 1 0",
    ]
    obj_data = "\n".join(lines).encode("utf-8")
    resp = client.post(
        "/api/upload",
        files={"file": ("empty.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={"scale": "100", "paper": "A3", "formats": "dxf"},
    )
    assert resp.status_code == 422
