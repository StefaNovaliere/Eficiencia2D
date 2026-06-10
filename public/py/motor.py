"""
motor.py — Motor geométrico de Eficiencia2D (arranque / stub).

Este módulo se ejecuta dentro de Pyodide (WebAssembly) en un Web Worker del
navegador. Expone `process_obj(obj_string) -> str`, que recibe el contenido
crudo de un archivo .obj y devuelve un string JSON con el resultado.

Por ahora es un STUB: parsea los vértices/caras con numpy y valida la huella
(footprint) con shapely para confirmar que la cadena WASM (numpy/scipy/shapely)
funciona end-to-end. La lógica geométrica real todavía vive en TypeScript
(src/core/pipeline.ts).

TODO: portar aquí la lógica de src/core/pipeline.ts (clasificación de caras,
corte de planos, extracción de fachadas/plantas, nesting) y devolver un JSON
que el frontend mapee a `Phase1Result` (ver src/core/pipeline.ts:35).
"""

import json

import numpy as np
from shapely.geometry import MultiPoint


def _parse_obj(obj_string: str):
    """Extrae vértices (v) y conteo de caras (f) de un string .obj."""
    vertices = []
    face_count = 0
    warnings = []

    for raw_line in obj_string.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        tag = parts[0]
        if tag == "v" and len(parts) >= 4:
            try:
                vertices.append((float(parts[1]), float(parts[2]), float(parts[3])))
            except ValueError:
                warnings.append(f"Vértice inválido: {line!r}")
        elif tag == "f":
            face_count += 1

    return np.array(vertices, dtype=float) if vertices else np.empty((0, 3)), face_count, warnings


def process_obj(obj_string: str) -> str:
    """
    Punto de entrada principal invocado desde el Web Worker.

    Devuelve un string JSON (no un dict) para cruzar el puente Python<->JS de
    forma simple y predecible.
    """
    try:
        verts, face_count, warnings = _parse_obj(obj_string)

        if verts.shape[0] == 0:
            return json.dumps(
                {
                    "status": "empty",
                    "vertexCount": 0,
                    "faceCount": face_count,
                    "bbox": None,
                    "footprintArea": 0.0,
                    "warnings": warnings + ["No se encontraron vértices en el archivo."],
                }
            )

        # Bounding box con numpy.
        mins = verts.min(axis=0)
        maxs = verts.max(axis=0)
        bbox = {
            "min": mins.tolist(),
            "max": maxs.tolist(),
            "size": (maxs - mins).tolist(),
        }

        # Validación con shapely: huella (footprint) sobre el plano XY.
        # Usamos el convex hull de la proyección XY como demostración de que
        # GEOS/shapely cargaron y operan correctamente.
        xy = verts[:, :2]
        footprint_area = float(MultiPoint([tuple(p) for p in xy]).convex_hull.area)

        return json.dumps(
            {
                "status": "ok",
                "vertexCount": int(verts.shape[0]),
                "faceCount": int(face_count),
                "bbox": bbox,
                "footprintArea": footprint_area,
                "warnings": warnings,
            }
        )
    except Exception as exc:  # noqa: BLE001 - reportamos cualquier fallo como JSON
        return json.dumps(
            {
                "status": "error",
                "error": f"{type(exc).__name__}: {exc}",
            }
        )
