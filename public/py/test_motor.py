"""
Validación del motor geométrico en Python contra el pipeline TS de referencia.

Ejecuta el pipeline completo sobre public/demo/demo.obj y verifica que los
resultados coinciden con los "golden values" capturados del pipeline original
en TypeScript (src/core). Los valores de Fase 1 (grupos/juntas/ajustes) tienen
PARIDAD EXACTA; el downstream (paneles/nesting/fachadas/plantas) coincide a la
precisión de la unión booleana (shapely/GEOS).

Uso:
    pip install numpy shapely
    python3 public/py/test_motor.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import motor  # noqa: E402

DEMO = os.path.join(os.path.dirname(__file__), "..", "demo", "demo.obj")

# Golden values capturados del pipeline TS (parsePipeline + decompose + nest).
EXPECTED = {
    "applied_axis": "Y",
    "pre_split_face_count": 4988,
    "face_count": 5164,
    "groups": 187,
    "cats": {"floor": 5, "wall": 27, "discard": 155},
    "joints": 73,
    "adjustments": 3,
    "wall_wall_joints": 30,
    "suggested_merges": 0,
    "wall_panels": 27,
    "floor_panels": 5,
    "wall_sheets": 1,
    "floor_sheets": 1,
    "facades": [("Fachada Norte", 38), ("Fachada Este", 4), ("Fachada Sur", 4), ("Fachada Oeste", 4)],
    "floor_plans": [("Piso 1", 73, 1), ("Piso 2", 78, 0), ("Piso 3", 22, 0)],
}


def main():
    text = open(DEMO).read()
    p1 = motor.parse_pipeline("demo.obj", text)

    from collections import Counter
    cats = Counter(g.category for g in p1["groups"])

    opts = {"scale_denom": 50, "paper": "A4"}
    dec = motor.decompose_panels(p1, opts)
    nest = motor.nest_decomposed_panels(dec, None, 50)
    facades = motor.extract_facades(p1["faces"], "Y")
    plans = motor.extract_floor_plans(p1["faces"], "Y")

    checks = []

    def chk(name, got, exp):
        ok = got == exp
        checks.append((name, ok, got, exp))

    chk("applied_axis", p1["applied_axis"], EXPECTED["applied_axis"])
    chk("pre_split_face_count", p1["pre_split_face_count"], EXPECTED["pre_split_face_count"])
    chk("face_count", len(p1["faces"]), EXPECTED["face_count"])
    chk("groups", len(p1["groups"]), EXPECTED["groups"])
    chk("cats", dict(cats), EXPECTED["cats"])
    chk("joints", len(p1["joints"]), EXPECTED["joints"])
    chk("adjustments", len(p1["adjustments"]), EXPECTED["adjustments"])
    chk("wall_wall_joints", len(p1["wall_wall_joints"]), EXPECTED["wall_wall_joints"])
    chk("suggested_merges", len(p1["suggested_merges"]), EXPECTED["suggested_merges"])
    chk("wall_panels", len(dec["wall_panels"]), EXPECTED["wall_panels"])
    chk("floor_panels", len(dec["floor_panels"]), EXPECTED["floor_panels"])
    chk("wall_sheets", len(nest["wall_nesting"]["sheets"]), EXPECTED["wall_sheets"])
    chk("floor_sheets", len(nest["floor_nesting"]["sheets"]), EXPECTED["floor_sheets"])
    chk("facades", [(f["label"], len(f["polygons"])) for f in facades], EXPECTED["facades"])
    chk("floor_plans", [(p["label"], len(p["segments"]), len(p["doors"] or [])) for p in plans], EXPECTED["floor_plans"])

    failed = [c for c in checks if not c[1]]
    for name, ok, got, exp in checks:
        mark = "OK " if ok else "XX "
        extra = "" if ok else f"  got={got} exp={exp}"
        print(f"  {mark}{name}{extra}")

    if failed:
        print(f"\nFAIL: {len(failed)}/{len(checks)} checks failed")
        sys.exit(1)
    print(f"\nPASS: {len(checks)}/{len(checks)} checks (paridad con el pipeline TS)")


if __name__ == "__main__":
    main()
