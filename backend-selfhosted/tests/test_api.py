"""
Tests for the FastAPI upload endpoint.

These tests run against the pure-Python pipeline -- no C++ translator or
SketchUp SDK required.
"""

import io
import struct
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


def _make_obj_with_wall() -> bytes:
    """Create a minimal .obj with a vertical rectangular wall (4m x 3m)."""
    # Coordinates in inches (SketchUp default).
    # 4m = 157.48 inches, 3m = 118.11 inches
    w = 157.48
    h = 118.11
    lines = [
        "# Minimal wall for testing",
        f"v 0 0 0",
        f"v {w} 0 0",
        f"v {w} 0 {h}",
        f"v 0 0 {h}",
        "f 1 2 3 4",
    ]
    return "\n".join(lines).encode("utf-8")


def test_upload_obj_produces_zip():
    """Upload a valid .obj wall and get a ZIP back."""
    obj_data = _make_obj_with_wall()
    resp = client.post(
        "/api/upload",
        files={"file": ("house.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={"scale": "100", "paper": "A3", "formats": "dxf,pdf"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"

    # Verify the ZIP contains expected files.
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()
    assert "house.dxf" in names
    assert "house.pdf" in names


def test_upload_obj_dxf_only():
    """Request only DXF format."""
    obj_data = _make_obj_with_wall()
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


def test_upload_obj_no_walls():
    """An .obj with only a horizontal face (floor) should return 422."""
    # Horizontal square on the XY plane (normal = Z) -- not a wall.
    lines = [
        "v 0 0 0",
        "v 100 0 0",
        "v 100 100 0",
        "v 0 100 0",
        "f 1 2 3 4",
    ]
    obj_data = "\n".join(lines).encode("utf-8")
    resp = client.post(
        "/api/upload",
        files={"file": ("floor.obj", io.BytesIO(obj_data), "application/octet-stream")},
        data={"scale": "100", "paper": "A3", "formats": "dxf"},
    )
    assert resp.status_code == 422
    assert "no output" in resp.json()["detail"].lower() or "wall" in resp.json()["detail"].lower()
