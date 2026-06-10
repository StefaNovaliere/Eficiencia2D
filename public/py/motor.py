"""
motor.py — Motor geométrico de Eficiencia2D (port de src/core a Python/WASM).

Se ejecuta dentro de Pyodide (WebAssembly) en un Web Worker. Porta fielmente el
pipeline geométrico que originalmente vivía en TypeScript (src/core/*.ts):

  parse_obj -> guess_unit_scale -> detect_up_axis -> classify_into_groups
            -> peel_buried_walls -> split_wall_groups_at_floors -> polish_groups
            -> detect_joints -> compute_adjustments -> suggest_coplanar_merges
  (+ decompose_panels, nest_panels, extract_facades, extract_floor_plans)

Notas de fidelidad JS -> Python:
  * Los `Map`/`Set` de JS iteran en orden de inserción; usamos `dict` (ordenado)
    y "ordered sets" basados en dict para reproducir ese orden exacto.
  * `Math.round` de JS redondea .5 hacia +Inf -> js_round = floor(x + 0.5).
  * `Array.sort` de JS es estable; usamos sorted/.sort con cmp_to_key para
    replicar exactamente el signo del comparador (incluida la estabilidad).
  * `getVertexIndices` devuelve los índices sólo si su longitud coincide con la
    de los vértices (las caras recortadas por el splitter pierden esa relación).

La unión booleana de polígonos (panel outline) usa shapely (GEOS), por eso se
precargan numpy/scipy/shapely en el Worker.
"""

import json
import math
import re
from functools import cmp_to_key

# shapely es opcional sólo para el outline de paneles; el resto no lo necesita.
try:
    from shapely.geometry import Polygon
    from shapely.ops import unary_union
    _HAS_SHAPELY = True
except Exception:  # pragma: no cover
    _HAS_SHAPELY = False


# ===========================================================================
# Vector math (port de types.ts) — vectores como tuplas (x, y, z) / (x, y)
# ===========================================================================

INF = float("inf")


def js_round(x):
    """Replica Math.round de JS (redondeo de .5 hacia +Infinito)."""
    return math.floor(x + 0.5)


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def scale_vec(v, s):
    return (v[0] * s, v[1] * s, v[2] * s)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def vlength(v):
    return math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])


def normalize(v):
    ln = vlength(v)
    if ln < 1e-12:
        return (0.0, 0.0, 0.0)
    return (v[0] / ln, v[1] / ln, v[2] / ln)


def cmp(a, b):
    return -1 if a < b else (1 if a > b else 0)


class Face:
    __slots__ = ("vertices", "normal", "inner_loops", "panel_id", "vertex_indices")

    def __init__(self, vertices, normal, inner_loops=None, panel_id=None, vertex_indices=None):
        self.vertices = vertices
        self.normal = normal
        self.inner_loops = inner_loops if inner_loops is not None else []
        self.panel_id = panel_id
        self.vertex_indices = vertex_indices


def get_vertex_indices(face):
    vi = face.vertex_indices
    if vi is not None and len(vi) == len(face.vertices):
        return vi
    return None


class GeometryGroup:
    __slots__ = (
        "id", "label", "category", "face_indices", "total_area", "centroid",
        "orientation", "representative_normal", "thickness", "min_y", "max_y",
        "original_category",
    )

    def __init__(self, **kw):
        for k in self.__slots__:
            setattr(self, k, kw.get(k))


# ===========================================================================
# OBJ Parser (port de obj-parser.ts)
# ===========================================================================

_WS = re.compile(r"\s+")


def parse_obj(text):
    warnings = []
    vertices = []
    faces = []
    current_group = ""

    for raw_line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw_line.strip()
        if line == "" or line[0] == "#":
            continue
        parts = _WS.split(line)
        keyword = parts[0]

        if keyword == "g" or keyword == "o":
            current_group = " ".join(parts[1:]) if len(parts) > 1 else ""
        elif keyword == "v":
            try:
                x = float(parts[1]); y = float(parts[2]); z = float(parts[3])
            except (ValueError, IndexError):
                continue
            if math.isfinite(x) and math.isfinite(y) and math.isfinite(z):
                vertices.append((x, y, z))
        elif keyword == "f":
            idx_list = []
            for i in range(1, len(parts)):
                token = parts[i].split("/")[0]
                try:
                    idx = int(token)
                except ValueError:
                    continue
                if idx < 0:
                    idx = len(vertices) + idx + 1
                idx_list.append(idx - 1)
            if len(idx_list) < 3:
                continue
            face_verts = []
            valid = True
            for idx in idx_list:
                if idx < 0 or idx >= len(vertices):
                    valid = False
                    break
                face_verts.append(vertices[idx])
            if not valid or len(face_verts) < 3:
                continue
            e1 = sub(face_verts[1], face_verts[0])
            e2 = sub(face_verts[2], face_verts[0])
            normal = normalize(cross(e1, e2))
            faces.append(Face(face_verts, normal, [], current_group or None, list(idx_list)))

    if len(faces) == 0:
        warnings.append("No faces found in the .obj file.")

    return faces, vertices, warnings


# ===========================================================================
# Wall thickness (port de wall-thickness.ts)
# ===========================================================================

OPPOSITE_NORMAL_DOT = -0.985
LATERAL_OVERLAP_FACTOR = 0.5


def are_thin_twins(a, b, thickness_threshold):
    """a, b son dicts con normal, d, centroid, extent."""
    an = a["normal"]; bn = b["normal"]
    ndot = an[0] * bn[0] + an[1] * bn[1] + an[2] * bn[2]
    if ndot > OPPOSITE_NORMAL_DOT:
        return None
    bc = b["centroid"]
    distance = abs(an[0] * bc[0] + an[1] * bc[1] + an[2] * bc[2] - a["d"])
    if distance < 1e-4 or distance > thickness_threshold:
        return None
    ac = a["centroid"]
    dx = bc[0] - ac[0]; dy = bc[1] - ac[1]; dz = bc[2] - ac[2]
    nc = dx * an[0] + dy * an[1] + dz * an[2]
    lx = dx - nc * an[0]; ly = dy - nc * an[1]; lz = dz - nc * an[2]
    lateral = math.sqrt(lx * lx + ly * ly + lz * lz)
    budget = (a["extent"] + b["extent"]) * 0.5 * LATERAL_OVERLAP_FACTOR
    return distance if lateral <= budget else None


# ===========================================================================
# Slab edge detector (port de slab-edge-detector.ts)
# ===========================================================================

HORIZONTAL_NORMAL_MIN = 0.98
VERTICAL_NORMAL_MAX = 0.5
EDGE_DIR_TOL = math.sqrt(1 - HORIZONTAL_NORMAL_MIN * HORIZONTAL_NORMAL_MIN)
SE_HEIGHT_BAND = 0.05
MAX_SLAB_THICKNESS = 1.0
PLATE_RATIO = 0.15
FACE_ASPECT = 0.35


def _snap3(v):
    return js_round(v * 100) / 100


def _se_edge_key(face, i, j, vi):
    if vi is not None:
        return f"{vi[i]}|{vi[j]}" if vi[i] < vi[j] else f"{vi[j]}|{vi[i]}"
    a = face.vertices[i]; b = face.vertices[j]
    sax, say, saz = _snap3(a[0]), _snap3(a[1]), _snap3(a[2])
    sbx, sby, sbz = _snap3(b[0]), _snap3(b[1]), _snap3(b[2])
    if sax < sbx or (sax == sbx and (say < sby or (say == sby and saz < sbz))):
        return f"{sax},{say},{saz}|{sbx},{sby},{sbz}"
    return f"{sbx},{sby},{sbz}|{sax},{say},{saz}"


def _face_area_newell(f):
    v = f.vertices
    if len(v) < 3:
        return 0.0
    sx = sy = sz = 0.0
    v0 = v[0]
    for i in range(1, len(v) - 1):
        e1x = v[i][0] - v0[0]; e1y = v[i][1] - v0[1]; e1z = v[i][2] - v0[2]
        e2x = v[i + 1][0] - v0[0]; e2y = v[i + 1][1] - v0[1]; e2z = v[i + 1][2] - v0[2]
        sx += e1y * e2z - e1z * e2y
        sy += e1z * e2x - e1x * e2z
        sz += e1x * e2y - e1y * e2x
    return 0.5 * math.sqrt(sx * sx + sy * sy + sz * sz)


def _lateral_extent(f):
    minx = INF; maxx = -INF; minz = INF; maxz = -INF
    for v in f.vertices:
        if v[0] < minx: minx = v[0]
        if v[0] > maxx: maxx = v[0]
        if v[2] < minz: minz = v[2]
        if v[2] > maxz: maxz = v[2]
    return max(maxx - minx, maxz - minz)


def find_slab_rim_faces(faces):
    up = {}
    down = {}
    for f in faces:
        ny = f.normal[1]
        if abs(ny) < HORIZONTAL_NORMAL_MIN:
            continue
        area = _face_area_newell(f)
        lat = _lateral_extent(f)
        vi = get_vertex_indices(f)
        verts = f.vertices
        m = up if ny > 0 else down
        n = len(verts)
        for i in range(n):
            j = (i + 1) % n
            a = verts[i]; b = verts[j]
            dy = b[1] - a[1]
            ln = math.sqrt((b[0] - a[0]) ** 2 + dy * dy + (b[2] - a[2]) ** 2)
            if ln < 1e-9 or abs(dy) / ln > EDGE_DIR_TOL:
                continue
            key = _se_edge_key(f, i, j, vi)
            y = (a[1] + b[1]) / 2
            ex = m.get(key)
            if ex is None or area > ex["area"]:
                m[key] = {"y": y, "lat": lat, "area": area}

    rim = {}
    for fi in range(len(faces)):
        f = faces[fi]
        if abs(f.normal[1]) > VERTICAL_NORMAL_MAX:
            continue
        verts = f.vertices
        if len(verts) < 3:
            continue
        ymin = INF; ymax = -INF
        for v in verts:
            if v[1] < ymin: ymin = v[1]
            if v[1] > ymax: ymax = v[1]
        t = ymax - ymin
        if t <= 1e-3 or t > MAX_SLAB_THICKNESS:
            continue
        vi = get_vertex_indices(f)
        top_skin = None; bot_skin = None
        max_horiz_len = 0.0
        n = len(verts)
        for i in range(n):
            j = (i + 1) % n
            a = verts[i]; b = verts[j]
            dy = b[1] - a[1]
            ln = math.sqrt((b[0] - a[0]) ** 2 + dy * dy + (b[2] - a[2]) ** 2)
            if ln < 1e-9 or abs(dy) / ln > EDGE_DIR_TOL:
                continue
            if ln > max_horiz_len:
                max_horiz_len = ln
            key = _se_edge_key(f, i, j, vi)
            y = (a[1] + b[1]) / 2
            if abs(y - ymax) < SE_HEIGHT_BAND:
                e = up.get(key)
                if e and (top_skin is None or e["area"] > top_skin["area"]):
                    top_skin = e
            if abs(y - ymin) < SE_HEIGHT_BAND:
                e = down.get(key)
                if e and (bot_skin is None or e["area"] > bot_skin["area"]):
                    bot_skin = e
        if top_skin is None or bot_skin is None:
            continue
        skin_lat = min(top_skin["lat"], bot_skin["lat"])
        if skin_lat <= 1e-6:
            continue
        if t / skin_lat >= PLATE_RATIO:
            continue
        if max_horiz_len <= 1e-6 or t / max_horiz_len >= FACE_ASPECT:
            continue
        rim[fi] = t
    return rim


def validate_slab_candidates(rim_faces, faces):
    if len(rim_faces) == 0:
        return rim_faces
    candidates = {}
    for fi, thickness in rim_faces.items():
        f = faces[fi]
        ymin = INF; ymax = -INF
        for v in f.vertices:
            if v[1] < ymin: ymin = v[1]
            if v[1] > ymax: ymax = v[1]
        band_min = js_round(ymin / SE_HEIGHT_BAND) * SE_HEIGHT_BAND
        band_max = js_round(ymax / SE_HEIGHT_BAND) * SE_HEIGHT_BAND
        key = f"{band_min}|{band_max}"
        c = candidates.get(key)
        if c:
            c["indices"].append(fi); c["thick"].append(thickness)
        else:
            candidates[key] = {"indices": [fi], "thick": [thickness]}
    validated = {}
    for c in candidates.values():
        maxt = max(c["thick"]); mint = min(c["thick"])
        if maxt > MAX_SLAB_THICKNESS:
            continue
        if maxt - mint > SE_HEIGHT_BAND * 2:
            continue
        for i in range(len(c["indices"])):
            validated[c["indices"][i]] = c["thick"][i]
    return validated


def detect_slab_edges(subgroups, faces, rim_faces):
    if len(rim_faces) == 0:
        return []
    floor_idxs = []
    rim_idxs = []
    for i in range(len(subgroups)):
        sg = subgroups[i]
        if abs(sg["normal"][1]) >= HORIZONTAL_NORMAL_MIN:
            floor_idxs.append(i)
        elif all(fi["index"] in rim_faces for fi in sg["face_infos"]):
            rim_idxs.append(i)
    if len(floor_idxs) == 0 or len(rim_idxs) == 0:
        return []
    floor_edge = {}
    for f_idx in floor_idxs:
        for fi in subgroups[f_idx]["face_infos"]:
            face = faces[fi["index"]]
            vi = get_vertex_indices(face)
            verts = face.vertices
            n = len(verts)
            for i in range(n):
                j = (i + 1) % n
                floor_edge[_se_edge_key(face, i, j, vi)] = f_idx
    links = []
    for r_idx in rim_idxs:
        thickness = 0.0
        linked = {}  # ordered set
        for fi in subgroups[r_idx]["face_infos"]:
            thickness = max(thickness, rim_faces.get(fi["index"], 0))
            face = faces[fi["index"]]
            vi = get_vertex_indices(face)
            verts = face.vertices
            n = len(verts)
            for i in range(n):
                j = (i + 1) % n
                f = floor_edge.get(_se_edge_key(face, i, j, vi))
                if f is not None:
                    linked[f] = True
        if thickness <= 0:
            continue
        for f in linked.keys():
            links.append({"floor": f, "rim": r_idx, "thickness": thickness})
    return links


# ===========================================================================
# Group classifier (port de group-classifier.ts)
# ===========================================================================

HORIZONTAL_THRESHOLD = 0.98
VERTICAL_THRESHOLD = 0.5
MIN_AREA = 1e-6
HEIGHT_BAND = 0.05
THIN_WALL_THRESHOLD = 0.40
DEFAULT_MIN_REAL_AREA = 1.0
WALL_PEEL_MIN_HEIGHT = 1.0
NORMAL_CLUSTER_DOT = 0.985
D_TOLERANCE = 0.15

CATEGORY_LABELS = {"floor": "Piso", "wall": "Pared", "discard": "Descartado"}
CAT_ORDER = {"floor": 0, "wall": 1, "discard": 2}


def _face_area(f):
    return _face_area_newell(f)


def _face_centroid(f):
    verts = f.vertices
    sx = sy = sz = 0.0
    for v in verts:
        sx += v[0]; sy += v[1]; sz += v[2]
    n = len(verts)
    return (sx / n, sy / n, sz / n)


def _orientation_of(absY):
    if absY >= HORIZONTAL_THRESHOLD:
        return "horizontal"
    if absY <= VERTICAL_THRESHOLD:
        return "vertical"
    return "inclined"


def _classify_all_faces(faces):
    infos = []
    for i in range(len(faces)):
        face = faces[i]
        area = _face_area(face)
        if area < MIN_AREA:
            continue
        orientation = _orientation_of(abs(face.normal[1]))
        infos.append({
            "index": i, "area": area, "centroid": _face_centroid(face),
            "orientation": orientation, "category": "discard",
        })

    minx = INF; maxx = -INF; minz = INF; maxz = -INF
    for fi in infos:
        for v in faces[fi["index"]].vertices:
            if v[0] < minx: minx = v[0]
            if v[0] > maxx: maxx = v[0]
            if v[2] < minz: minz = v[2]
            if v[2] > maxz: maxz = v[2]
    range_x = maxx - minx
    range_z = maxz - minz

    if range_x < 1.0 or range_z < 1.0:
        for fi in infos:
            o = fi["orientation"]
            fi["category"] = "floor" if o == "horizontal" else ("wall" if o == "vertical" else "discard")
        return infos

    horizontals = [fi for fi in infos if fi["orientation"] == "horizontal"]
    level_groups = {}  # key -> list
    for fi in horizontals:
        h = fi["centroid"][1]
        found = None
        for key in level_groups.keys():
            if abs(key - h) < HEIGHT_BAND:
                found = key
                break
        key = found if found is not None else h
        level_groups.setdefault(key, []).append(fi)

    band_area = {}
    for key, group in level_groups.items():
        band_area[key] = sum(fi["area"] for fi in group)

    max_band = 0.0
    for a in band_area.values():
        if a > max_band:
            max_band = a
    level_threshold = max(1.0, 0.03 * max_band)
    real_keys = set(k for k, a in band_area.items() if a >= level_threshold)

    for key, group in level_groups.items():
        is_real = (key in real_keys) or (len(real_keys) == 0)
        for fi in group:
            fi["category"] = "floor" if is_real else "discard"

    for fi in infos:
        if fi["orientation"] == "vertical":
            fi["category"] = "wall"
    for fi in infos:
        if fi["orientation"] == "inclined":
            fi["category"] = "floor"

    return infos


def _cluster_coplanar(infos, faces):
    clusters = []
    for fi in infos:
        face = faces[fi["index"]]
        n = face.normal
        if vlength(n) < 0.01:
            continue
        d = dot(n, face.vertices[0])
        placed = False
        for cl in clusters:
            if dot(n, cl["normal"]) > NORMAL_CLUSTER_DOT and abs(d - cl["d"]) < D_TOLERANCE:
                cl["face_infos"].append(fi)
                placed = True
                break
        if not placed:
            clusters.append({"normal": normalize(n), "d": d, "face_infos": [fi]})
    return clusters


def _split_connected(face_infos, faces):
    if len(face_infos) <= 1:
        return [face_infos]
    vert_to_idx = {}
    for i in range(len(face_infos)):
        face = faces[face_infos[i]["index"]]
        indices = get_vertex_indices(face)
        if indices is not None:
            for vi in indices:
                vert_to_idx.setdefault(vi, []).append(i)
        else:
            for v in face.vertices:
                key = f"{_snap3(v[0])},{_snap3(v[1])},{_snap3(v[2])}"
                vert_to_idx.setdefault(key, []).append(i)

    parent = list(range(len(face_infos)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra = find(a); rb = find(b)
        if ra != rb:
            parent[ra] = rb

    for indices in vert_to_idx.values():
        for i in range(1, len(indices)):
            union(indices[0], indices[i])

    out = {}
    for i in range(len(face_infos)):
        root = find(i)
        out.setdefault(root, []).append(face_infos[i])
    return list(out.values())


def _orientation_label(normal, orientation):
    if orientation == "horizontal":
        return "Horizontal"
    angle = math.atan2(normal[0], normal[2])
    deg = ((angle * 180 / math.pi) % 360 + 360) % 360
    if deg < 45 or deg >= 315:
        return "Vertical - Norte"
    if deg < 135:
        return "Vertical - Este"
    if deg < 225:
        return "Vertical - Sur"
    return "Vertical - Oeste"


def _build_subgroup(category, cluster, comp, faces):
    total_area = sum(fi["area"] for fi in comp)
    if total_area < 0.01:
        return None
    cx = cy = cz = 0.0
    for fi in comp:
        c = fi["centroid"]
        cx += c[0] * fi["area"]; cy += c[1] * fi["area"]; cz += c[2] * fi["area"]
    cx /= total_area; cy /= total_area; cz /= total_area
    minx = miny = minz = INF
    maxx = maxy = maxz = -INF
    for fi in comp:
        for v in faces[fi["index"]].vertices:
            if v[0] < minx: minx = v[0]
            if v[1] < miny: miny = v[1]
            if v[2] < minz: minz = v[2]
            if v[0] > maxx: maxx = v[0]
            if v[1] > maxy: maxy = v[1]
            if v[2] > maxz: maxz = v[2]
    extent = max(maxx - minx, maxy - miny, maxz - minz)
    return {
        "category": category, "face_infos": comp, "normal": cluster["normal"],
        "d": cluster["d"], "centroid": (cx, cy, cz), "extent": extent,
        "total_area": total_area,
    }


def classify_into_groups(faces, min_real_area=DEFAULT_MIN_REAL_AREA, out_warnings=None):
    if len(faces) == 0:
        return []
    all_infos = _classify_all_faces(faces)

    raw_rim = find_slab_rim_faces(faces)
    rim_faces = validate_slab_candidates(raw_rim, faces)
    if len(rim_faces) == 0 and len(raw_rim) > 0 and out_warnings is not None:
        out_warnings.append("Detección de losa desactivada: resultados no pasaron validación")
    if len(rim_faces) > 0:
        for fi in all_infos:
            if fi["index"] in rim_faces:
                fi["category"] = "floor"

    by_category = {}
    for fi in all_infos:
        by_category.setdefault(fi["category"], []).append(fi)

    subgroups = []
    for category, infos in by_category.items():
        clusters = _cluster_coplanar(infos, faces)
        for cluster in clusters:
            for comp in _split_connected(cluster["face_infos"], faces):
                sg = _build_subgroup(category, cluster, comp, faces)
                if sg:
                    subgroups.append(sg)

    parent = list(range(len(subgroups)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra = find(a); rb = find(b)
        if ra != rb:
            parent[ra] = rb

    twin_contrib = []
    slab_contrib = []

    is_rim_subgroup = [
        len(sg["face_infos"]) > 0 and all(fi["index"] in rim_faces for fi in sg["face_infos"])
        for sg in subgroups
    ]

    for i in range(len(subgroups)):
        if subgroups[i]["category"] == "discard" or is_rim_subgroup[i]:
            continue
        for j in range(i + 1, len(subgroups)):
            if subgroups[j]["category"] == "discard" or is_rim_subgroup[j]:
                continue
            thickness = are_thin_twins(subgroups[i], subgroups[j], THIN_WALL_THRESHOLD)
            if thickness is not None:
                union(i, j)
                twin_contrib.append((i, thickness))

    for link in detect_slab_edges(subgroups, faces, rim_faces):
        union(link["floor"], link["rim"])
        slab_contrib.append((link["floor"], link["thickness"]))

    WIDE_SLAB_MAX_GAP = 0.5
    FOOTPRINT_TOL = 0.05

    sg_bounds = []
    for sg in subgroups:
        minx = INF; maxx = -INF; miny = INF; maxy = -INF; minz = INF; maxz = -INF
        for fi in sg["face_infos"]:
            for v in faces[fi["index"]].vertices:
                if v[0] < minx: minx = v[0]
                if v[0] > maxx: maxx = v[0]
                if v[1] < miny: miny = v[1]
                if v[1] > maxy: maxy = v[1]
                if v[2] < minz: minz = v[2]
                if v[2] > maxz: maxz = v[2]
        sg_bounds.append((minx, maxx, miny, maxy, minz, maxz))

    def is_floor_horiz(i):
        return subgroups[i]["category"] == "floor" and abs(subgroups[i]["normal"][1]) >= HORIZONTAL_THRESHOLD

    for i in range(len(subgroups)):
        if not is_floor_horiz(i):
            continue
        ib = sg_bounds[i]
        for j in range(i + 1, len(subgroups)):
            if not is_floor_horiz(j):
                continue
            if find(i) == find(j):
                continue
            jb = sg_bounds[j]
            overlap_x = min(ib[1], jb[1]) - max(ib[0], jb[0])
            overlap_z = min(ib[5], jb[5]) - max(ib[4], jb[4])
            if overlap_x < -FOOTPRINT_TOL or overlap_z < -FOOTPRINT_TOL:
                continue
            gap = max(ib[2], jb[2]) - min(ib[3], jb[3])
            if gap >= WIDE_SLAB_MAX_GAP:
                continue
            union(i, j)

    slab_thickness = {}
    for idx, thickness in slab_contrib:
        root = find(idx)
        ex = slab_thickness.get(root)
        if ex is None or thickness > ex:
            slab_thickness[root] = thickness
    twin_thickness = {}
    for idx, thickness in twin_contrib:
        root = find(idx)
        ex = twin_thickness.get(root)
        if ex is None or thickness < ex:
            twin_thickness[root] = thickness

    union_map = {}
    for i in range(len(subgroups)):
        union_map.setdefault(find(i), []).append(subgroups[i])

    groups = []
    next_id = 1
    counters = {}

    for root_idx, merged in union_map.items():
        all_face_indices = []
        total_area = 0.0
        cx = cy = cz = 0.0
        gmin_y = INF; gmax_y = -INF
        biggest = merged[0]
        biggest_orient = merged[0]["face_infos"][0]["orientation"]
        for sg in merged:
            for fi in sg["face_infos"]:
                all_face_indices.append(fi["index"])
                for v in faces[fi["index"]].vertices:
                    if v[1] < gmin_y: gmin_y = v[1]
                    if v[1] > gmax_y: gmax_y = v[1]
            total_area += sg["total_area"]
            cx += sg["centroid"][0] * sg["total_area"]
            cy += sg["centroid"][1] * sg["total_area"]
            cz += sg["centroid"][2] * sg["total_area"]
            if sg["total_area"] > biggest["total_area"]:
                biggest = sg
                biggest_orient = sg["face_infos"][0]["orientation"]
        cx /= total_area; cy /= total_area; cz /= total_area

        dominant = biggest["category"]
        orient = _orientation_label(biggest["normal"], biggest_orient)
        cat_label = CATEGORY_LABELS[dominant]
        key = f"{cat_label}_{orient}"
        counters[key] = counters.get(key, 0) + 1
        detected_thickness = slab_thickness.get(root_idx, twin_thickness.get(root_idx))

        groups.append(GeometryGroup(
            id=next_id, label=f"{cat_label} {orient} #{counters[key]}",
            category=dominant, face_indices=all_face_indices, total_area=total_area,
            centroid=(cx, cy, cz), orientation=orient, representative_normal=biggest["normal"],
            thickness=detected_thickness,
            min_y=None if gmin_y == INF else gmin_y,
            max_y=None if gmax_y == -INF else gmax_y,
            original_category=dominant,
        ))
        next_id += 1

    for g in groups:
        if g.total_area < min_real_area and g.category != "discard":
            g.category = "discard"
            g.label = f"{CATEGORY_LABELS['discard']} {g.orientation} #{g.id}"

    groups.sort(key=cmp_to_key(lambda a, b: (CAT_ORDER[a.category] - CAT_ORDER[b.category]) or cmp(b.total_area, a.total_area)))
    return groups


def polish_groups(groups, min_real_area):
    for g in groups:
        if g.category == "discard":
            continue
        is_horizontal = g.orientation == "Horizontal"
        if is_horizontal and g.category == "wall":
            g.category = "floor"; g.original_category = "floor"
            g.label = re.sub(r"^Pared", CATEGORY_LABELS["floor"], g.label)
        elif not is_horizontal and g.category == "floor":
            g.category = "wall"; g.original_category = "wall"
            g.label = re.sub(r"^Piso", CATEGORY_LABELS["wall"], g.label)
    for g in groups:
        if g.total_area < min_real_area and g.category != "discard":
            g.category = "discard"
            g.label = re.sub(r"^(Piso|Pared)", CATEGORY_LABELS["discard"], g.label)
    groups.sort(key=cmp_to_key(lambda a, b: (CAT_ORDER[a.category] - CAT_ORDER[b.category]) or cmp(b.total_area, a.total_area)))


_PARED_RE = re.compile(r"^Pared (.+) #(\d+)$")


def peel_buried_walls(faces, groups):
    next_id = max((g.id for g in groups), default=0) + 1
    wall_counters = {}
    for g in groups:
        m = _PARED_RE.match(g.label)
        if m:
            key = m.group(1)
            wall_counters[key] = max(wall_counters.get(key, 0), int(m.group(2)))

    def info_for(idx):
        f = faces[idx]
        orientation = _orientation_of(abs(f.normal[1]))
        return {"index": idx, "area": _face_area(f), "centroid": _face_centroid(f),
                "orientation": orientation, "category": "floor"}

    out = []
    for g in groups:
        if g.category != "floor":
            out.append(g)
            continue
        infos = [info_for(idx) for idx in g.face_indices]
        vertical_infos = [fi for fi in infos if fi["orientation"] == "vertical"]
        if len(vertical_infos) == 0:
            out.append(g)
            continue
        clusters = _split_connected(vertical_infos, faces)
        peel_clusters = []
        keep_vertical = []
        for cluster in clusters:
            miny = INF; maxy = -INF
            for fi in cluster:
                for v in faces[fi["index"]].vertices:
                    if v[1] < miny: miny = v[1]
                    if v[1] > maxy: maxy = v[1]
            if maxy - miny > WALL_PEEL_MIN_HEIGHT:
                peel_clusters.append(cluster)
            else:
                keep_vertical.extend(cluster)
        if len(peel_clusters) == 0:
            out.append(g)
            continue
        rest_infos = [fi for fi in infos if fi["orientation"] != "vertical"]
        new_walls = []
        reabsorbed = []
        for cluster in peel_clusters:
            biggest = cluster[0]
            for fi in cluster:
                if fi["area"] > biggest["area"]:
                    biggest = fi
            normal = normalize(faces[biggest["index"]].normal)
            pseudo = {"normal": normal, "d": 0, "face_infos": cluster}
            sg = _build_subgroup("wall", pseudo, cluster, faces)
            if sg is None:
                reabsorbed.extend(cluster)
                continue
            miny = INF; maxy = -INF
            for fi in cluster:
                for v in faces[fi["index"]].vertices:
                    if v[1] < miny: miny = v[1]
                    if v[1] > maxy: maxy = v[1]
            orient = _orientation_label(normal, "vertical")
            wall_counters[orient] = wall_counters.get(orient, 0) + 1
            new_walls.append(GeometryGroup(
                id=next_id, label=f"Pared {orient} #{wall_counters[orient]}",
                category="wall", face_indices=[fi["index"] for fi in cluster],
                total_area=sg["total_area"], centroid=sg["centroid"], orientation=orient,
                representative_normal=normal, thickness=None, min_y=miny, max_y=maxy,
                original_category="wall",
            ))
            next_id += 1
        remaining = rest_infos + keep_vertical + reabsorbed
        if len(remaining) > 0:
            total_area = 0.0; cx = cy = cz = 0.0
            miny = INF; maxy = -INF
            for fi in remaining:
                total_area += fi["area"]
                cx += fi["centroid"][0] * fi["area"]
                cy += fi["centroid"][1] * fi["area"]
                cz += fi["centroid"][2] * fi["area"]
                for v in faces[fi["index"]].vertices:
                    if v[1] < miny: miny = v[1]
                    if v[1] > maxy: maxy = v[1]
            if total_area > 0:
                cx /= total_area; cy /= total_area; cz /= total_area
            out.append(GeometryGroup(
                id=g.id, label=g.label, category=g.category,
                face_indices=[fi["index"] for fi in remaining], total_area=total_area,
                centroid=(cx, cy, cz), orientation=g.orientation,
                representative_normal=g.representative_normal, thickness=g.thickness,
                min_y=miny, max_y=maxy, original_category=g.original_category,
            ))
        out.extend(new_walls)

    out.sort(key=cmp_to_key(lambda a, b: (CAT_ORDER[a.category] - CAT_ORDER[b.category]) or cmp(b.total_area, a.total_area)))
    return out


# ===========================================================================
# Mesh splitter (port de mesh-splitter.ts)
# ===========================================================================

MIN_SPLIT_AREA = 0.01
UP_HORIZ = {"Y": (0, 2), "Z": (0, 1)}


def _get_up_val(v, up):
    return v[1] if up == "Y" else v[2]


def _lerp3(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)


def _clip_polygon(verts, elevation, up, keep_above, tol):
    result = []
    n = len(verts)
    for i in range(n):
        current = verts[i]
        nxt = verts[(i + 1) % n]
        d_curr = _get_up_val(current, up) - elevation
        d_next = _get_up_val(nxt, up) - elevation
        curr_inside = (d_curr >= -tol) if keep_above else (d_curr <= tol)
        if curr_inside:
            result.append(current)
        if (d_curr > tol and d_next < -tol) or (d_curr < -tol and d_next > tol):
            t = d_curr / (d_curr - d_next)
            result.append(_lerp3(current, nxt, t))
    return result


def _split_faces_at_plane(faces, elevation, up="Y", tol=0.01):
    above = []
    below = []
    for face in faces:
        dists = [_get_up_val(v, up) - elevation for v in face.vertices]
        all_above = all(d >= -tol for d in dists)
        all_below = all(d <= tol for d in dists)
        if all_above and not all_below:
            above.append(face)
        elif all_below and not all_above:
            below.append(face)
        elif all_above and all_below:
            above.append(face)
            below.append(face)
        else:
            av = _clip_polygon(face.vertices, elevation, up, True, tol)
            bv = _clip_polygon(face.vertices, elevation, up, False, tol)
            # Mirror la semántica de TS: el spread `{...rest}` conserva los
            # vertexIndices ORIGINALES en la cara recortada. get_vertex_indices
            # sólo los devuelve si la longitud coincide con la de los vértices
            # recortados (misma comprobación que el código TS), de modo que un
            # recorte que mantiene el mismo nº de vértices reusa los índices.
            if len(av) >= 3:
                above.append(Face(av, face.normal, [], face.panel_id, face.vertex_indices))
            if len(bv) >= 3:
                below.append(Face(bv, face.normal, [], face.panel_id, face.vertex_indices))
    return above, below


def _split_wall_at_floors(faces, floor_elevations, up="Y", tol=0.01):
    if len(floor_elevations) == 0:
        return [faces]
    wmin = INF; wmax = -INF
    for f in faces:
        for v in f.vertices:
            h = _get_up_val(v, up)
            if h < wmin: wmin = h
            if h > wmax: wmax = h
    relevant = [e for e in floor_elevations if e > wmin + tol and e < wmax - tol]
    if len(relevant) == 0:
        return [faces]
    sorted_elev = sorted(relevant)
    segments = []
    remaining = faces
    for elev in sorted_elev:
        above, below = _split_faces_at_plane(remaining, elev, up, tol)
        if len(below) > 0:
            segments.append(below)
        remaining = above
    if len(remaining) > 0:
        segments.append(remaining)
    return segments


def _subgroup_area(faces):
    return sum(_face_area_newell(f) for f in faces)


def _merge_thin_segments(segments, min_area):
    if len(segments) <= 1:
        return segments
    lst = [{"faces": fs, "area": _subgroup_area(fs)} for fs in segments]
    while True:
        if len(lst) <= 1:
            break
        idx = next((i for i in range(len(lst)) if lst[i]["area"] < min_area), -1)
        if idx == -1:
            break
        if idx == 0:
            target = 1
        elif idx == len(lst) - 1:
            target = idx - 1
        else:
            target = idx - 1 if lst[idx - 1]["area"] >= lst[idx + 1]["area"] else idx + 1
        lst[target]["faces"] = lst[target]["faces"] + lst[idx]["faces"]
        lst[target]["area"] = _subgroup_area(lst[target]["faces"])
        lst.pop(idx)
    return [e["faces"] for e in lst]


def _collect_slab_planes(groups, override_map, faces, up):
    ax_a, ax_b = UP_HORIZ[up]
    planes = []
    for group in groups:
        eff = override_map.get(group.id, group.category)
        ny = abs(_get_up_val(group.representative_normal, up))
        if ny < 0.75:
            continue
        is_floor = eff == "floor"
        is_demoted = eff == "discard" and group.original_category == "floor"
        if not is_floor and not is_demoted:
            continue
        s = 0.0; count = 0
        min_a = INF; max_a = -INF; min_b = INF; max_b = -INF
        for fi in group.face_indices:
            face = faces[fi] if fi < len(faces) else None
            if face is None:
                continue
            for v in face.vertices:
                s += _get_up_val(v, up); count += 1
                a = v[ax_a]; b = v[ax_b]
                if a < min_a: min_a = a
                if a > max_a: max_a = a
                if b < min_b: min_b = b
                if b > max_b: max_b = b
        if count == 0:
            continue
        planes.append({"elevation": s / count, "minA": min_a, "maxA": max_a, "minB": min_b, "maxB": max_b})
    return planes


def split_wall_groups_at_floors(faces, groups, override_map, up="Y", min_real_area=DEFAULT_MIN_REAL_AREA):
    slab_planes = _collect_slab_planes(groups, override_map, faces, up)
    if len(slab_planes) == 0:
        return faces, groups
    ax_a, ax_b = UP_HORIZ[up]
    FOOTPRINT_TOL = 0.10
    DEDUP_TOL = 0.10
    new_faces = list(faces)
    new_groups = []
    next_id = 0
    for g in groups:
        if g.id >= next_id:
            next_id = g.id + 1

    for group in groups:
        eff = override_map.get(group.id, group.category)
        if eff != "wall":
            new_groups.append(group)
            continue
        group_faces = [faces[fi] for fi in group.face_indices if fi < len(faces)]
        w_min_a = INF; w_max_a = -INF; w_min_b = INF; w_max_b = -INF
        for f in group_faces:
            for v in f.vertices:
                a = v[ax_a]; b = v[ax_b]
                if a < w_min_a: w_min_a = a
                if a > w_max_a: w_max_a = a
                if b < w_min_b: w_min_b = b
                if b > w_max_b: w_max_b = b
        tol = max(group.thickness or 0, FOOTPRINT_TOL)
        candidate = []
        for sp in slab_planes:
            overlap_a = min(w_max_a, sp["maxA"]) - max(w_min_a, sp["minA"])
            overlap_b = min(w_max_b, sp["maxB"]) - max(w_min_b, sp["minB"])
            if overlap_a < -tol or overlap_b < -tol:
                continue
            candidate.append(sp["elevation"])
        candidate.sort()
        elevations = []
        for e in candidate:
            if len(elevations) == 0 or abs(e - elevations[-1]) > DEDUP_TOL:
                elevations.append(e)
        segments = _split_wall_at_floors(group_faces, elevations, up)
        merged = _merge_thin_segments(segments, min_real_area)
        if len(merged) <= 1:
            new_groups.append(group)
            continue
        for k in range(len(merged)):
            seg = merged[k]
            if len(seg) == 0:
                continue
            area = _subgroup_area(seg)
            if area < MIN_SPLIT_AREA:
                continue
            face_indices = []
            for face in seg:
                face_indices.append(len(new_faces))
                new_faces.append(face)
            miny = INF; maxy = -INF
            cx = cy = cz = 0.0; count = 0
            for f in seg:
                for v in f.vertices:
                    h = _get_up_val(v, up)
                    if h < miny: miny = h
                    if h > maxy: maxy = h
                    cx += v[0]; cy += v[1]; cz += v[2]; count += 1
            centroid = (cx / count, cy / count, cz / count) if count > 0 else group.centroid
            new_groups.append(GeometryGroup(
                id=group.id if k == 0 else next_id,
                label=f"{group.label} ({k + 1}/{len(merged)})",
                category=group.category, original_category=group.original_category,
                face_indices=face_indices, total_area=area, centroid=centroid,
                orientation=group.orientation, representative_normal=group.representative_normal,
                thickness=group.thickness,
                min_y=None if miny == INF else miny,
                max_y=None if maxy == -INF else maxy,
            ))
            if k != 0:
                next_id += 1

    return new_faces, new_groups


# ===========================================================================
# Joint topology (port de joint-topology.ts)
# ===========================================================================

END_FRAC = 0.2
CRITICAL_RATIO = 0.6


def running_axis(normal):
    return normalize((-normal[2], 0, normal[0]))


def _proj_onto(p, axis):
    return p[0] * axis[0] + p[1] * axis[1] + p[2] * axis[2]


def span_along(faces, face_indices, axis):
    mn = INF; mx = -INF
    for fi in face_indices:
        if fi >= len(faces):
            continue
        face = faces[fi]
        for v in face.vertices:
            t = _proj_onto(v, axis)
            if t < mn: mn = t
            if t > mx: mx = t
    return mn, mx


def wall_run_length(group, faces):
    axis = running_axis(group.representative_normal)
    mn, mx = span_along(faces, group.face_indices, axis)
    d = mx - mn
    return d if math.isfinite(d) else 0


def _edge_at_end(joint, group, faces):
    axis = running_axis(group.representative_normal)
    mn, mx = span_along(faces, group.face_indices, axis)
    ln = mx - mn
    if not math.isfinite(ln) or ln < 1e-6:
        return None
    t = (_proj_onto(joint["edge_mid"], axis) - mn) / ln
    return t < END_FRAC or t > 1 - END_FRAC


def classify_joint_topology(joint, gA, gB, faces):
    a_end = _edge_at_end(joint, gA, faces)
    b_end = _edge_at_end(joint, gB, faces)
    if a_end is None or b_end is None:
        return {"topology": "unknown", "a_at_end": a_end or False, "b_at_end": b_end or False}
    if a_end and b_end:
        topo = "L"
    elif a_end or b_end:
        topo = "T"
    else:
        topo = "X"
    return {"topology": topo, "a_at_end": a_end, "b_at_end": b_end}


def is_critical_joint(topology, tA, tB):
    if topology == "L":
        return True
    lo = min(tA, tB); hi = max(tA, tB)
    if hi > 0.001 and lo / hi < CRITICAL_RATIO:
        return True
    return False


# ===========================================================================
# Joint detector (port de joint-detector.ts)
# ===========================================================================

HORIZ_DIR_TOL = 0.3


def _edge_key_3d(ax, ay, az, bx, by, bz):
    sax, say, saz = _snap3(ax), _snap3(ay), _snap3(az)
    sbx, sby, sbz = _snap3(bx), _snap3(by), _snap3(bz)
    if sax < sbx or (sax == sbx and (say < sby or (say == sby and saz < sbz))):
        return f"{sax},{say},{saz}|{sbx},{sby},{sbz}"
    return f"{sbx},{sby},{sbz}|{sax},{say},{saz}"


def _edge_length(a, b):
    dx = b[0] - a[0]; dy = b[1] - a[1]; dz = b[2] - a[2]
    return math.sqrt(dx * dx + dy * dy + dz * dz)


def _pair_key(a, b):
    return f"{a}|{b}" if a < b else f"{b}|{a}"


def detect_joints(faces, groups):
    edge_to_groups = {}
    edge_lengths = {}
    edge_verts = {}

    for group in groups:
        if group.category == "discard":
            continue
        for fi in group.face_indices:
            if fi >= len(faces):
                continue
            face = faces[fi]
            verts = face.vertices
            vi = get_vertex_indices(face)
            n = len(verts)
            for i in range(n):
                j = (i + 1) % n
                if vi is not None:
                    key = f"{vi[i]}|{vi[j]}" if vi[i] < vi[j] else f"{vi[j]}|{vi[i]}"
                else:
                    key = _edge_key_3d(verts[i][0], verts[i][1], verts[i][2],
                                       verts[j][0], verts[j][1], verts[j][2])
                g4 = edge_to_groups.get(key)
                if g4 is not None:
                    g4[group.id] = True
                else:
                    edge_to_groups[key] = {group.id: True}
                    edge_lengths[key] = _edge_length(verts[i], verts[j])
                    edge_verts[key] = (verts[i], verts[j])

    pair_data = {}
    for key, group_ids in edge_to_groups.items():
        if len(group_ids) < 2:
            continue
        ids = list(group_ids.keys())
        ln = edge_lengths.get(key, 0)
        vpair = edge_verts.get(key)
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                pk = _pair_key(ids[i], ids[j])
                pd = pair_data.get(pk)
                if pd is None:
                    pd = {"groups": (ids[i], ids[j]), "total_length": 0.0, "edges": []}
                    pair_data[pk] = pd
                pd["total_length"] += ln
                if vpair:
                    pd["edges"].append({"a": vpair[0], "b": vpair[1], "len": ln})

    group_normals = {g.id: g.representative_normal for g in groups}

    joints = []
    for pd in pair_data.values():
        if pd["total_length"] < 0.01:
            continue
        gA, gB = pd["groups"]
        nA = group_normals.get(gA); nB = group_normals.get(gB)
        dihedral = 90.0
        if nA and nB:
            abs_dot = abs(dot(nA, nB))
            dihedral = math.acos(min(1, abs_dot)) * 180 / math.pi
        mx = my = mz = 0.0
        horiz_len = 0.0
        longest = pd["edges"][0] if pd["edges"] else None
        for e in pd["edges"]:
            w = e["len"]
            mx += (e["a"][0] + e["b"][0]) * 0.5 * w
            my += (e["a"][1] + e["b"][1]) * 0.5 * w
            mz += (e["a"][2] + e["b"][2]) * 0.5 * w
            dirv = sub(e["b"], e["a"])
            dir_len = vlength(dirv)
            if dir_len > 1e-9:
                if abs(dirv[1]) / dir_len <= HORIZ_DIR_TOL:
                    horiz_len += e["len"]
            if longest is None or e["len"] > longest["len"]:
                longest = e
        tl = pd["total_length"]
        edge_mid = (mx / tl, my / tl, mz / tl) if tl > 0 else (0, 0, 0)
        edge_dir = normalize(sub(longest["b"], longest["a"])) if longest else (1, 0, 0)
        horizontal_frac = horiz_len / tl if tl > 0 else 0
        joints.append({
            "group_a": gA, "group_b": gB, "total_length": tl, "dihedral_angle": dihedral,
            "edge_mid": edge_mid, "edge_dir": edge_dir, "horizontal_frac": horizontal_frac,
        })

    joints.sort(key=cmp_to_key(lambda a, b: cmp(b["total_length"], a["total_length"])))
    return joints


# ===========================================================================
# Assembly adjuster (port de assembly-adjuster.ts)
# ===========================================================================

def _choose_wall_wall_yielder(gA, gB, tA, tB, topo_info, faces):
    if tA <= 0.001 and tB <= 0.001:
        return None
    if tA > 0.001 and tB <= 0.001:
        return gB.id
    if tB > 0.001 and tA <= 0.001:
        return gA.id
    lo = min(tA, tB); hi = max(tA, tB)
    if lo / hi < 0.9:
        return gA.id if tA <= tB else gB.id
    if faces is not None:
        len_a = wall_run_length(gA, faces)
        len_b = wall_run_length(gB, faces)
        lo_len = min(len_a, len_b); hi_len = max(len_a, len_b)
        if hi_len > 0.5 and lo_len / hi_len < 0.6 and (hi_len - lo_len) > 2.0:
            return gA.id if len_a <= len_b else gB.id
    if topo_info and topo_info["topology"] == "T":
        if topo_info["a_at_end"] and not topo_info["b_at_end"]:
            return gA.id
        if topo_info["b_at_end"] and not topo_info["a_at_end"]:
            return gB.id
    a_is_ew = abs(gA.representative_normal[2]) >= abs(gA.representative_normal[0])
    b_is_ew = abs(gB.representative_normal[2]) >= abs(gB.representative_normal[0])
    if a_is_ew and not b_is_ew:
        return gA.id
    if b_is_ew and not a_is_ew:
        return gB.id
    return gA.id if gA.id <= gB.id else gB.id


def _is_wall_on_top(wall, floor, joint):
    if wall.min_y is None or floor.max_y is None:
        return False
    tol = max(floor.thickness or 0, 0.05)
    if wall.min_y < floor.max_y - tol:
        return False
    if joint["horizontal_frac"] < 0.5:
        return False
    return True


def _to_fixed(x, n):
    return f"{x:.{n}f}"


def compute_adjustments(joints, groups, wall_wall_decisions=None, faces=None):
    group_by_id = {g.id: g for g in groups}
    adjustments = []
    wall_wall_joints = []

    for ji in range(len(joints)):
        joint = joints[ji]
        if joint["dihedral_angle"] < 75 or joint["dihedral_angle"] > 95:
            continue
        gA = group_by_id.get(joint["group_a"])
        gB = group_by_id.get(joint["group_b"])
        if not gA or not gB:
            continue
        if gA.category == "discard" or gB.category == "discard":
            continue
        abs_ya = abs(gA.representative_normal[1])
        abs_yb = abs(gB.representative_normal[1])
        a_is_floor = gA.category == "floor" and abs_ya > 0.5
        b_is_floor = gB.category == "floor" and abs_yb > 0.5

        if a_is_floor != b_is_floor:
            floor = gA if a_is_floor else gB
            wall = gB if a_is_floor else gA
            if not floor.thickness or floor.thickness < 0.001:
                continue
            if not _is_wall_on_top(wall, floor, joint):
                continue
            delta = -floor.thickness
            label = floor.label or f"Grupo {floor.id}"
            adjustments.append({
                "group_id": wall.id, "delta": delta, "axis": "height",
                "reason": f"Junta con {label} (grosor {_to_fixed(floor.thickness * 100, 1)}cm)",
                "joint_index": ji,
            })
        elif not a_is_floor and not b_is_floor:
            tA = gA.thickness or 0
            tB = gB.thickness or 0
            topo_info = classify_joint_topology(joint, gA, gB, faces) if faces is not None else None
            topology = topo_info["topology"] if topo_info else "unknown"
            suggested = _choose_wall_wall_yielder(gA, gB, tA, tB, topo_info, faces)
            critical = is_critical_joint(topology, tA, tB)
            ww = {
                "joint_index": ji, "group_a": gA.id, "group_b": gB.id,
                "suggested_yield_group_id": suggested, "topology": topology,
                "critical": critical, "yield_group_id": None,
            }
            wall_wall_joints.append(ww)
            decision = wall_wall_decisions.get(ji) if wall_wall_decisions else None
            if decision is not None:
                yield_group = group_by_id.get(decision)
                other_group = group_by_id.get(gB.id if decision == gA.id else gA.id)
                if yield_group and other_group:
                    if other_group.thickness and other_group.thickness > 0.001:
                        trim = other_group.thickness
                    elif yield_group.thickness and yield_group.thickness > 0.001:
                        trim = yield_group.thickness
                    else:
                        trim = 0
                    if trim > 0.001:
                        ww["yield_group_id"] = decision
                        adjustments.append({
                            "group_id": decision, "delta": -trim, "axis": "width",
                            "reason": f"Junta con {other_group.label} (grosor {_to_fixed(trim * 100, 1)}cm)",
                            "joint_index": ji,
                        })

    seen_height = {}
    kept_width = []
    for adj in adjustments:
        if adj["axis"] == "height":
            ex = seen_height.get(adj["group_id"])
            if ex is None or adj["delta"] < ex["delta"]:
                seen_height[adj["group_id"]] = adj
        else:
            kept_width.append(adj)
    return list(seen_height.values()) + kept_width, wall_wall_joints


# ===========================================================================
# Coplanar merge suggestions (port de pipeline.ts suggestCoplanarMerges)
# ===========================================================================

class _UnionFind:
    def __init__(self, n):
        self.parent = list(range(n))
        self.rank = [0] * n

    def find(self, x):
        if self.parent[x] != x:
            self.parent[x] = self.find(self.parent[x])
        return self.parent[x]

    def union(self, a, b):
        ra = self.find(a); rb = self.find(b)
        if ra == rb:
            return
        if self.rank[ra] < self.rank[rb]:
            self.parent[ra] = rb
        elif self.rank[ra] > self.rank[rb]:
            self.parent[rb] = ra
        else:
            self.parent[rb] = ra
            self.rank[ra] += 1


def _floor_elevations_from_groups(groups):
    out = []
    for g in groups:
        if g.category != "floor":
            continue
        if abs(g.representative_normal[1]) < 0.75:
            continue
        if g.min_y is not None and g.max_y is not None:
            out.append((g.min_y + g.max_y) / 2)
    return out


def _is_floor_between(gA, gB, floor_elevations):
    if gA.min_y is None or gA.max_y is None or gB.min_y is None or gB.max_y is None:
        return False
    if len(floor_elevations) == 0:
        return False
    mid_a = (gA.min_y + gA.max_y) / 2
    mid_b = (gB.min_y + gB.max_y) / 2
    lo = min(mid_a, mid_b); hi = max(mid_a, mid_b)
    if hi - lo < 0.05:
        return False
    for elev in floor_elevations:
        if lo <= elev <= hi:
            return True
    return False


def suggest_coplanar_merges(groups, joints):
    idx_by_id = {groups[i].id: i for i in range(len(groups))}
    floor_elevs = _floor_elevations_from_groups(groups)
    uf = _UnionFind(len(groups))
    for joint in joints:
        iA = idx_by_id.get(joint["group_a"]); iB = idx_by_id.get(joint["group_b"])
        if iA is None or iB is None:
            continue
        gA = groups[iA]; gB = groups[iB]
        if gA.category != "wall" or gB.category != "wall":
            continue
        if joint["dihedral_angle"] > 10:
            continue
        area_a = gA.total_area; area_b = gB.total_area
        min_area = min(area_a, area_b); max_area = max(area_a, area_b)
        if max_area < 0.001:
            continue
        if min_area / max_area >= 0.15:
            continue
        if _is_floor_between(gA, gB, floor_elevs):
            continue
        uf.union(iA, iB)
    components = {}
    for i in range(len(groups)):
        root = uf.find(i)
        components.setdefault(root, []).append(groups[i].id)
    return [ids for ids in components.values() if len(ids) >= 2]


# ===========================================================================
# Up-axis detection (port de facade-extractor.ts detectUpAxis)
# ===========================================================================

def detect_up_axis(faces):
    if len(faces) == 0:
        return "Z"
    y_area = 0.0; z_area = 0.0
    for face in faces:
        verts = face.vertices
        if len(verts) < 3:
            continue
        e1 = sub(verts[1], verts[0]); e2 = sub(verts[2], verts[0])
        area = vlength(cross(e1, e2)) * 0.5
        if area < 1e-10:
            continue
        if abs(face.normal[1]) > 0.9:
            y_area += area
        if abs(face.normal[2]) > 0.9:
            z_area += area
    total = y_area + z_area
    if total > 0:
        diff = abs(y_area - z_area) / total
        if diff > 0.3:
            return "Y" if y_area > z_area else "Z"
    miny = INF; maxy = -INF; minz = INF; maxz = -INF
    limit = min(len(faces), 500)
    for i in range(limit):
        for v in faces[i].vertices:
            if v[1] < miny: miny = v[1]
            if v[1] > maxy: maxy = v[1]
            if v[2] < minz: minz = v[2]
            if v[2] > maxz: maxz = v[2]
    range_y = maxy - miny; range_z = maxz - minz
    if range_z > 0 and range_y / range_z > 2.0:
        return "Z"
    if range_y > 0 and range_z / range_y > 2.0:
        return "Y"
    return "Z"


def _guess_unit_scale(faces):
    if len(faces) == 0:
        return 1.0
    minx = miny = minz = INF
    maxx = maxy = maxz = -INF
    limit = min(len(faces), 500)
    for i in range(limit):
        for v in faces[i].vertices:
            if v[0] < minx: minx = v[0]
            if v[1] < miny: miny = v[1]
            if v[2] < minz: minz = v[2]
            if v[0] > maxx: maxx = v[0]
            if v[1] > maxy: maxy = v[1]
            if v[2] > maxz: maxz = v[2]
    span = max(maxx - minx, maxy - miny, maxz - minz)
    if span <= 0:
        return 1.0
    if span <= 100:
        return 1.0
    if span <= 1000:
        return 0.01
    if span <= 50000:
        return 0.001
    return (1.0 / span) * 20.0


def _rotate_z_to_y(faces):
    out = []
    for f in faces:
        verts = [(v[0], v[2], -v[1]) for v in f.vertices]
        normal = (f.normal[0], f.normal[2], -f.normal[1])
        inner = [[(v[0], v[2], -v[1]) for v in loop] for loop in f.inner_loops]
        out.append(Face(verts, normal, inner, f.panel_id, f.vertex_indices))
    return out


# ===========================================================================
# Door extractor (port de door-extractor.ts)
# ===========================================================================

DOOR_NAME_PATTERN = re.compile(r"puerta|door|porta", re.I)
HINGE_RIGHT_PATTERN = re.compile(r"_der|_right|_R\b", re.I)
MAX_DOOR_THICKNESS = 0.30
MIN_DOOR_WIDTH = 0.40
MAX_DOOR_WIDTH = 3.0


def is_door_group(name):
    return DOOR_NAME_PATTERN.search(name) is not None


def _get_up2(v, up):
    return v[1] if up == "Y" else v[2]


def _project_top_down(v, up):
    return (v[0], v[2]) if up == "Y" else (v[0], v[1])


def analyze_door_group(group_name, faces, cut_elev, up):
    if len(faces) == 0:
        return None
    all_verts = [v for f in faces for v in f.vertices]
    elevs = [_get_up2(v, up) for v in all_verts]
    min_elev = min(elevs); max_elev = max(elevs)
    if min_elev > cut_elev or max_elev < cut_elev:
        return None
    pts2d = [_project_top_down(v, up) for v in all_verts]
    xs = [p[0] for p in pts2d]; ys = [p[1] for p in pts2d]
    min_x = min(xs); max_x = max(xs); min_y = min(ys); max_y = max(ys)
    dx = max_x - min_x; dy = max_y - min_y
    if dx >= dy:
        width = dx; thickness = dy; mid_y = (min_y + max_y) / 2
        hinge_a = (min_x, mid_y); hinge_b = (max_x, mid_y)
    else:
        width = dy; thickness = dx; mid_x = (min_x + max_x) / 2
        hinge_a = (mid_x, min_y); hinge_b = (mid_x, max_y)
    if thickness > MAX_DOOR_THICKNESS:
        return None
    if width < MIN_DOOR_WIDTH or width > MAX_DOOR_WIDTH:
        return None
    best_area = 0.0; best_normal = None
    for face in faces:
        if abs(_get_up2(face.normal, up)) > 0.5:
            continue
        area = _face_area_newell(face)
        if area > best_area:
            best_area = area; best_normal = face.normal
    if best_normal is None:
        return None
    raw_swing = _project_top_down(best_normal, up)
    swing_len = math.sqrt(raw_swing[0] ** 2 + raw_swing[1] ** 2)
    if swing_len < 0.01:
        return None
    swing_dir = (raw_swing[0] / swing_len, raw_swing[1] / swing_len)
    hinge_right = HINGE_RIGHT_PATTERN.search(group_name) is not None
    hinge = hinge_b if hinge_right else hinge_a
    free_end = hinge_a if hinge_right else hinge_b
    to_free = (free_end[0] - hinge[0], free_end[1] - hinge[1])
    wall_angle = math.atan2(to_free[1], to_free[0]) * (180 / math.pi)
    swing_angle = math.atan2(swing_dir[1], swing_dir[0]) * (180 / math.pi)
    cross_val = to_free[0] * swing_dir[1] - to_free[1] * swing_dir[0]
    if cross_val >= 0:
        start_angle = wall_angle; end_angle = swing_angle
    else:
        start_angle = swing_angle; end_angle = wall_angle
    start_angle = ((start_angle % 360) + 360) % 360
    end_angle = ((end_angle % 360) + 360) % 360
    swing_rad = swing_angle * (math.pi / 180)
    leaf_end = (hinge[0] + width * math.cos(swing_rad), hinge[1] + width * math.sin(swing_rad))
    return {"hinge": hinge, "width": width, "start_angle": start_angle,
            "end_angle": end_angle, "leaf_end": leaf_end}


def extract_doors_for_level(door_faces_by_group, cut_elev, up):
    doors = []
    for name, group_faces in door_faces_by_group.items():
        door = analyze_door_group(name, group_faces, cut_elev, up)
        if door:
            doors.append(door)
    return doors


# ===========================================================================
# Floor plan extractor (port de floor-plan-extractor.ts)
# ===========================================================================

CUT_HEIGHT = 1.0
FP_HORIZONTAL_EPSILON = 0.25
FP_VERTICAL_EPSILON = 0.20
BIN_SIZE = 0.3
MIN_FLOOR_GAP = 2.0
PEAK_AREA_RATIO = 0.08


def detect_floor_levels(faces, up):
    elevations = []
    for face in faces:
        up_comp = abs(_get_up2(face.normal, up))
        if up_comp < 1.0 - FP_HORIZONTAL_EPSILON:
            continue
        area = _face_area_newell(face)
        if area < 0.01:
            continue
        elev = sum(_get_up2(v, up) for v in face.vertices) / len(face.vertices)
        elevations.append((elev, area))
    if len(elevations) == 0:
        return []
    min_elev = min(e[0] for e in elevations)
    max_elev = max(e[0] for e in elevations)
    num_bins = max(1, math.ceil((max_elev - min_elev) / BIN_SIZE) + 1)
    bins = [0.0] * num_bins
    for elev, area in elevations:
        idx = min(math.floor((elev - min_elev) / BIN_SIZE), num_bins - 1)
        bins[idx] += area
    max_bin = max(bins)
    threshold = max_bin * PEAK_AREA_RATIO
    peaks = []
    for i in range(num_bins):
        if bins[i] < threshold:
            continue
        is_local_max = (i == 0 or bins[i] >= bins[i - 1]) and (i == num_bins - 1 or bins[i] >= bins[i + 1])
        if not is_local_max:
            continue
        bin_low = min_elev + i * BIN_SIZE
        bin_high = bin_low + BIN_SIZE
        sum_area = 0.0; sum_weighted = 0.0
        for elev, area in elevations:
            if bin_low <= elev < bin_high:
                sum_area += area; sum_weighted += elev * area
        peaks.append((sum_weighted / sum_area, sum_area))
    peaks.sort(key=lambda p: p[0])
    levels = []
    for elev, area in peaks:
        if len(levels) > 0 and elev - levels[-1] < MIN_FLOOR_GAP:
            prev_idx = len(levels) - 1
            prev_peak = next((p for p in peaks if abs(p[0] - levels[prev_idx]) < 1e-9), None)
            if prev_peak and area > prev_peak[1]:
                levels[prev_idx] = elev
        else:
            levels.append(elev)
    return levels


def _intersect_face_with_plane(face, cut_elev, up):
    verts = face.vertices
    n = len(verts)
    if n < 3:
        return []
    dists = [_get_up2(v, up) - cut_elev for v in verts]
    intersections = []
    for i in range(n):
        j = (i + 1) % n
        di = dists[i]; dj = dists[j]
        if abs(di) < 1e-9:
            intersections.append(verts[i])
        elif (di > 0) != (dj > 0):
            t = di / (di - dj)
            vi = verts[i]; vj = verts[j]
            intersections.append((vi[0] + t * (vj[0] - vi[0]), vi[1] + t * (vj[1] - vi[1]), vi[2] + t * (vj[2] - vi[2])))
    unique = []
    for pt in intersections:
        dup = False
        for u in unique:
            if abs(pt[0] - u[0]) < 1e-6 and abs(pt[1] - u[1]) < 1e-6 and abs(pt[2] - u[2]) < 1e-6:
                dup = True
                break
        if not dup:
            unique.append(pt)
    if len(unique) >= 2:
        return [(unique[0], unique[1])]
    return []


def _extract_floor_plans_axis(faces, up):
    levels = detect_floor_levels(faces, up)
    if len(levels) == 0:
        return []
    door_group_names = {}
    for face in faces:
        if face.panel_id and is_door_group(face.panel_id):
            door_group_names[face.panel_id] = True
    door_faces_by_group = {}
    for face in faces:
        if face.panel_id and face.panel_id in door_group_names:
            door_faces_by_group.setdefault(face.panel_id, []).append(face)
    vertical_faces = [
        f for f in faces
        if abs(_get_up2(f.normal, up)) <= FP_VERTICAL_EPSILON
        and (not f.panel_id or f.panel_id not in door_group_names)
    ]
    if len(vertical_faces) == 0 and len(door_faces_by_group) == 0:
        return []
    plans = []
    for idx in range(len(levels)):
        floor_elev = levels[idx]
        cut_elev = floor_elev + CUT_HEIGHT
        raw_segments = []
        for face in vertical_faces:
            ups = [_get_up2(v, up) for v in face.vertices]
            if min(ups) > cut_elev or max(ups) < cut_elev:
                continue
            for p1p, p2p in _intersect_face_with_plane(face, cut_elev, up):
                a = _project_top_down(p1p, up)
                b = _project_top_down(p2p, up)
                if abs(a[0] - b[0]) < 1e-6 and abs(a[1] - b[1]) < 1e-6:
                    continue
                raw_segments.append((a, b))
        raw_doors = extract_doors_for_level(door_faces_by_group, cut_elev, up)
        if len(raw_segments) == 0 and len(raw_doors) == 0:
            continue
        all_pts = []
        for s in raw_segments:
            all_pts.append(s[0]); all_pts.append(s[1])
        for d in raw_doors:
            all_pts.append(d["hinge"]); all_pts.append(d["leaf_end"])
        if len(all_pts) == 0:
            continue
        min_x = min(p[0] for p in all_pts); min_y = min(p[1] for p in all_pts)
        max_x = max(p[0] for p in all_pts); max_y = max(p[1] for p in all_pts)
        shifted = [((s[0][0] - min_x, s[0][1] - min_y), (s[1][0] - min_x, s[1][1] - min_y)) for s in raw_segments]
        shifted_doors = []
        for d in raw_doors:
            nd = dict(d)
            nd["hinge"] = (d["hinge"][0] - min_x, d["hinge"][1] - min_y)
            nd["leaf_end"] = (d["leaf_end"][0] - min_x, d["leaf_end"][1] - min_y)
            shifted_doors.append(nd)
        plans.append({
            "label": f"Piso {idx + 1}",
            "segments": [{"a": s[0], "b": s[1], "is_interior": False} for s in shifted],
            "width": max_x - min_x, "height": max_y - min_y, "elevation": floor_elev,
            "doors": shifted_doors if len(shifted_doors) > 0 else None,
        })
    return plans


def extract_floor_plans(faces, up_axis=None):
    if len(faces) == 0:
        return []
    if up_axis:
        return _extract_floor_plans_axis(faces, up_axis)
    plans_z = _extract_floor_plans_axis(faces, "Z")
    plans_y = _extract_floor_plans_axis(faces, "Y")
    total_z = sum(len(p["segments"]) for p in plans_z)
    total_y = sum(len(p["segments"]) for p in plans_y)
    return plans_y if total_y > total_z else plans_z


# ===========================================================================
# Facade extractor (port de facade-extractor.ts)
# ===========================================================================

VERTICAL_EPSILON = 0.20
DIRECTION_CLUSTER_THRESHOLD = 0.70


def _get_up_vec(up):
    return (0, 1, 0) if up == "Y" else (0, 0, 1)


def _horizontal_dir(normal, up):
    h = (normal[0], 0, normal[2]) if up == "Y" else (normal[0], normal[1], 0)
    return normalize(h)


def _cluster_by_direction(faces, up):
    clusters = []
    for face in faces:
        h_dir = _horizontal_dir(face.normal, up)
        if vlength(h_dir) < 0.01:
            continue
        placed = False
        for cluster in clusters:
            if dot(h_dir, cluster["dir"]) > DIRECTION_CLUSTER_THRESHOLD:
                cluster["faces"].append(face)
                placed = True
                break
        if not placed:
            clusters.append({"dir": h_dir, "faces": [face]})
    return clusters


def _direction_label(direction, up):
    angle = math.atan2(direction[0], direction[2]) if up == "Y" else math.atan2(direction[0], direction[1])
    deg = (math.atan2(math.sin(angle), math.cos(angle)) * 180 / math.pi + 360) % 360
    if deg < 45 or deg >= 315:
        return "Fachada Norte"
    if deg < 135:
        return "Fachada Este"
    if deg < 225:
        return "Fachada Sur"
    return "Fachada Oeste"


def _round_coord(v):
    return js_round(v * 10000) / 10000


def _facade_edge_key(ax, ay, bx, by):
    a = f"{_round_coord(ax)},{_round_coord(ay)}"
    b = f"{_round_coord(bx)},{_round_coord(by)}"
    return f"{a}|{b}" if a < b else f"{b}|{a}"


_FACADE_ORDER = {"Norte": 0, "Este": 1, "Sur": 2, "Oeste": 3}


def _extract_facades_axis(faces, up):
    vertical_faces = [f for f in faces if abs(_get_up2(f.normal, up)) <= VERTICAL_EPSILON]
    if len(vertical_faces) == 0:
        return []
    clusters = _cluster_by_direction(vertical_faces, up)
    facades = []
    for cluster in clusters:
        dirv = cluster["dir"]; cluster_faces = cluster["faces"]
        depths = []
        for face in cluster_faces:
            sum_depth = sum(dot(v, dirv) for v in face.vertices)
            depths.append((sum_depth / len(face.vertices), face))
        max_depth = max(d[0] for d in depths)
        min_depth = min(d[0] for d in depths)
        rng = max_depth - min_depth
        depth_cutoff = min_depth if rng < 0.5 else max_depth - 0.5
        front_faces = [d[1] for d in depths if d[0] >= depth_cutoff]
        if len(front_faces) == 0:
            continue
        world_up = _get_up_vec(up)
        u_axis = normalize(cross(world_up, dirv))
        v_axis = world_up
        edge_counts = {}
        for face in front_faces:
            pts = [(dot(v, u_axis), dot(v, v_axis)) for v in face.vertices]
            n = len(pts)
            for i in range(n):
                j = (i + 1) % n
                key = _facade_edge_key(pts[i][0], pts[i][1], pts[j][0], pts[j][1])
                if key in edge_counts:
                    del edge_counts[key]
                else:
                    edge_counts[key] = (pts[i][0], pts[i][1], pts[j][0], pts[j][1])
        if len(edge_counts) == 0:
            continue
        min_u = INF; max_u = -INF; min_v = INF; max_v = -INF
        edges = []
        for e in edge_counts.values():
            edges.append(e)
            min_u = min(min_u, e[0], e[2]); max_u = max(max_u, e[0], e[2])
            min_v = min(min_v, e[1], e[3]); max_v = max(max_v, e[1], e[3])
        width = max_u - min_u; height = max_v - min_v
        if width < 0.01 or height < 0.01:
            continue
        polygons = [{"vertices": [(e[0] - min_u, e[1] - min_v), (e[2] - min_u, e[3] - min_v)]} for e in edges]
        label = _direction_label(dirv, up)
        existing = set(f["label"] for f in facades)
        if label in existing:
            n2 = 2
            while f"{label} {n2}" in existing:
                n2 += 1
            label = f"{label} {n2}"
        facades.append({"label": label, "direction": dirv, "polygons": polygons, "width": width, "height": height})
    facades.sort(key=cmp_to_key(lambda a, b: cmp(_FACADE_ORDER.get(a["label"].split(" ")[-1], 99), _FACADE_ORDER.get(b["label"].split(" ")[-1], 99))))
    return facades


def extract_facades(faces, up_axis=None):
    if len(faces) == 0:
        return []
    up = up_axis if up_axis else detect_up_axis(faces)
    return _extract_facades_axis(faces, up)


# ===========================================================================
# Cutting sheet projection (port de cutting-sheet.ts; unión con shapely)
# ===========================================================================

NEAR_PARALLEL_EPS = 0.01
MIN_HOLE_AREA = 0.0025
UNION_SNAP = 1e4


def _snap_union(v):
    return js_round(v * UNION_SNAP) / UNION_SNAP


def _ring_2d_area(ring):
    a = 0.0
    for i in range(len(ring) - 1):
        a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    return a / 2


def _union_outline(faces, u_axis, v_axis):
    """Unión booleana de polígonos proyectados, usando shapely (GEOS)."""
    if not _HAS_SHAPELY:
        return None
    polys = []
    for face in faces:
        ring = [(_snap_union(dot(v, u_axis)), _snap_union(dot(v, v_axis))) for v in face.vertices]
        if len(ring) < 3:
            continue
        if abs(_ring_2d_area(ring)) < 1e-7:
            continue
        try:
            p = Polygon(ring)
            if not p.is_valid:
                p = p.buffer(0)
            if not p.is_empty:
                polys.append(p)
        except Exception:
            continue
    if len(polys) == 0:
        return None
    try:
        merged = unary_union(polys)
    except Exception:
        return None
    geoms = []
    if merged.geom_type == "Polygon":
        geoms = [merged]
    elif merged.geom_type == "MultiPolygon":
        geoms = list(merged.geoms)
    else:
        return None
    out = []
    for poly in geoms:
        rings = [list(poly.exterior.coords)] + [list(r.coords) for r in poly.interiors]
        for ri in range(len(rings)):
            ring = rings[ri]
            if ri >= 1 and abs(_ring_2d_area(ring)) < MIN_HOLE_AREA:
                continue
            for i in range(len(ring) - 1):
                out.append((ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1]))
    return out if len(out) > 0 else None


def project_faces_to_2d(faces, group_normal, up):
    if len(faces) == 0:
        return None
    world_up = _get_up_vec(up)
    u_axis = normalize(cross(world_up, group_normal))
    if vlength(u_axis) < NEAR_PARALLEL_EPS:
        u_axis = (1, 0, 0)
        v_axis = normalize(cross(group_normal, u_axis))
        if vlength(v_axis) < NEAR_PARALLEL_EPS:
            v_axis = (0, 0, 1) if up == "Y" else (0, 1, 0)
    else:
        v_axis = normalize(cross(group_normal, u_axis))
    contoured = _union_outline(faces, u_axis, v_axis)
    if not contoured or len(contoured) == 0:
        return None
    min_u = INF; max_u = -INF; min_v = INF; max_v = -INF
    for e in contoured:
        min_u = min(min_u, e[0], e[2]); max_u = max(max_u, e[0], e[2])
        min_v = min(min_v, e[1], e[3]); max_v = max(max_v, e[1], e[3])
    w = max_u - min_u; h = max_v - min_v
    if w < 0.01 or h < 0.01:
        return None
    edges = [{"a": (e[0] - min_u, e[1] - min_v), "b": (e[2] - min_u, e[3] - min_v)} for e in contoured]
    return {"width_m": w, "height_m": h, "edges": edges, "v_up": dot(v_axis, world_up),
            "u_axis": u_axis, "v_axis": v_axis, "origin_u": min_u, "origin_v": min_v}


def clip_panel_at_v(edges, cut, keep_above):
    def in_side(y):
        return y >= cut - 1e-9 if keep_above else y <= cut + 1e-9
    out = []
    crossings = []
    for e in edges:
        a_in = in_side(e["a"][1]); b_in = in_side(e["b"][1])
        if a_in and b_in:
            out.append(e)
        elif not a_in and not b_in:
            continue
        else:
            t = (cut - e["a"][1]) / (e["b"][1] - e["a"][1])
            ix = e["a"][0] + t * (e["b"][0] - e["a"][0])
            cut_pt = (ix, cut)
            keep = e["a"] if a_in else e["b"]
            out.append({"a": keep, "b": cut_pt} if a_in else {"a": cut_pt, "b": keep})
            crossings.append(ix)
    crossings.sort()
    for i in range(0, len(crossings) - 1, 2):
        out.append({"a": (crossings[i], cut), "b": (crossings[i + 1], cut)})
    if len(out) < 3:
        return None
    return _normalize_clip(out)


def clip_panel_at_u(edges, cut, keep_right):
    def in_side(x):
        return x >= cut - 1e-9 if keep_right else x <= cut + 1e-9
    out = []
    crossings = []
    for e in edges:
        a_in = in_side(e["a"][0]); b_in = in_side(e["b"][0])
        if a_in and b_in:
            out.append(e)
        elif not a_in and not b_in:
            continue
        else:
            t = (cut - e["a"][0]) / (e["b"][0] - e["a"][0])
            iy = e["a"][1] + t * (e["b"][1] - e["a"][1])
            cut_pt = (cut, iy)
            keep = e["a"] if a_in else e["b"]
            out.append({"a": keep, "b": cut_pt} if a_in else {"a": cut_pt, "b": keep})
            crossings.append(iy)
    crossings.sort()
    for i in range(0, len(crossings) - 1, 2):
        out.append({"a": (cut, crossings[i]), "b": (cut, crossings[i + 1])})
    if len(out) < 3:
        return None
    return _normalize_clip(out)


def _normalize_clip(out):
    min_u = INF; max_u = -INF; min_v = INF; max_v = -INF
    for e in out:
        min_u = min(min_u, e["a"][0], e["b"][0]); max_u = max(max_u, e["a"][0], e["b"][0])
        min_v = min(min_v, e["a"][1], e["b"][1]); max_v = max(max_v, e["a"][1], e["b"][1])
    w = max_u - min_u; h = max_v - min_v
    if w < 0.01 or h < 0.01:
        return None
    normalized = [{"a": (e["a"][0] - min_u, e["a"][1] - min_v), "b": (e["b"][0] - min_u, e["b"][1] - min_v)} for e in out]
    return {"width_m": w, "height_m": h, "edges": normalized}


def mirror_edges_horizontal(edges, width_m):
    return [{"a": (width_m - e["a"][0], e["a"][1]), "b": (width_m - e["b"][0], e["b"][1])} for e in edges]


# ===========================================================================
# Sheet nester (port de sheet-nester.ts) — MAXRECTS / Best Short Side Fit
# ===========================================================================

DEFAULT_SHEET = {"width_m": 1.0, "height_m": 0.6, "gap_m": 0.003}
NEST_EPS = 0.0005


def _find_best_rect(free_rects, pw, ph):
    best = None
    for rect in free_rects:
        if pw <= rect["w"] + NEST_EPS and ph <= rect["h"] + NEST_EPS:
            left_h = rect["w"] - pw; left_v = rect["h"] - ph
            short = min(left_h, left_v); lng = max(left_h, left_v)
            score = short * 1000 + lng
            if best is None or score < best["score"]:
                best = {"x": rect["x"], "y": rect["y"], "score": score}
    return best


def _prune_contained(rects):
    out = []
    for i in range(len(rects)):
        ri = rects[i]; contained = False
        for j in range(len(rects)):
            if i == j:
                continue
            rj = rects[j]
            if (ri["x"] >= rj["x"] - NEST_EPS and ri["y"] >= rj["y"] - NEST_EPS
                    and ri["x"] + ri["w"] <= rj["x"] + rj["w"] + NEST_EPS
                    and ri["y"] + ri["h"] <= rj["y"] + rj["h"] + NEST_EPS):
                contained = True
                break
        if not contained:
            out.append(ri)
    return out


def _commit_placement(sheet, panel, px, py, rotated, pw, ph, gap):
    sheet["panels"].append({"panel": panel, "x": px, "y": py, "rotated": rotated,
                            "effective_w": pw, "effective_h": ph})
    bx2 = px + pw + gap; by2 = py + ph + gap
    nxt = []
    for rect in sheet["free_rects"]:
        rx2 = rect["x"] + rect["w"]; ry2 = rect["y"] + rect["h"]
        if bx2 <= rect["x"] or px >= rx2 or by2 <= rect["y"] or py >= ry2:
            nxt.append(rect)
            continue
        if px > rect["x"]:
            nxt.append({"x": rect["x"], "y": rect["y"], "w": px - rect["x"], "h": rect["h"]})
        if bx2 < rx2:
            nxt.append({"x": bx2, "y": rect["y"], "w": rx2 - bx2, "h": rect["h"]})
        if py > rect["y"]:
            nxt.append({"x": rect["x"], "y": rect["y"], "w": rect["w"], "h": py - rect["y"]})
        if by2 < ry2:
            nxt.append({"x": rect["x"], "y": by2, "w": rect["w"], "h": ry2 - by2})
    cleaned = [r for r in nxt if r["w"] > 0.001 and r["h"] > 0.001]
    sheet["free_rects"] = _prune_contained(cleaned)


def nest_panels(panels, config, scale_denom=1):
    width_m = config["width_m"]; height_m = config["height_m"]; gap_m = config["gap_m"]
    sheet_area = width_m * height_m
    sorted_panels = sorted(panels, key=cmp_to_key(
        lambda a, b: cmp(b["width_m"] * b["height_m"], a["width_m"] * a["height_m"])))
    states = []
    unplaced = []
    for panel in sorted_panels:
        pw = panel["width_m"]; ph = panel["height_m"]
        fits_n = pw <= width_m + NEST_EPS and ph <= height_m + NEST_EPS
        fits_r = ph <= width_m + NEST_EPS and pw <= height_m + NEST_EPS
        can_rotate = fits_r and abs(pw - ph) > 0.001
        if not fits_n and not fits_r:
            unplaced.append(panel)
            continue
        best_sheet = -1; best_x = 0; best_y = 0; best_pw = 0; best_ph = 0
        best_rot = False; best_score = INF
        for si in range(len(states)):
            if fits_n:
                r = _find_best_rect(states[si]["free_rects"], pw, ph)
                if r and r["score"] < best_score:
                    best_score = r["score"]; best_sheet = si; best_x = r["x"]; best_y = r["y"]
                    best_pw = pw; best_ph = ph; best_rot = False
            if can_rotate:
                r = _find_best_rect(states[si]["free_rects"], ph, pw)
                if r and r["score"] < best_score:
                    best_score = r["score"]; best_sheet = si; best_x = r["x"]; best_y = r["y"]
                    best_pw = ph; best_ph = pw; best_rot = True
        if best_sheet >= 0:
            _commit_placement(states[best_sheet], panel, best_x, best_y, best_rot, best_pw, best_ph, gap_m)
            continue
        new_sheet = {"free_rects": [{"x": 0, "y": 0, "w": width_m, "h": height_m}], "panels": []}
        placed = False
        if fits_n:
            r = _find_best_rect(new_sheet["free_rects"], pw, ph)
            if r:
                _commit_placement(new_sheet, panel, r["x"], r["y"], False, pw, ph, gap_m)
                placed = True
        if not placed and can_rotate:
            r = _find_best_rect(new_sheet["free_rects"], ph, pw)
            if r:
                _commit_placement(new_sheet, panel, r["x"], r["y"], True, ph, pw, gap_m)
                placed = True
        if placed:
            states.append(new_sheet)
        else:
            unplaced.append(panel)
    sheets = []
    for i in range(len(states)):
        s = states[i]
        used = sum(p["effective_w"] * p["effective_h"] for p in s["panels"])
        sheets.append({"index": i, "panels": s["panels"], "utilization": used / sheet_area})
    return {"sheets": sheets, "config": config, "scale_denom": scale_denom, "unplaced": unplaced}


# ===========================================================================
# Decompose panels (port de pipeline.ts decomposePanels)
# ===========================================================================

def decompose_panels(phase1, opts, overrides=None, wall_wall_decisions=None):
    override_map = {}
    if overrides:
        for o in overrides:
            override_map[o["group_id"]] = o["new_category"]
    effective_decisions = {}
    for ww in phase1["wall_wall_joints"]:
        if ww["suggested_yield_group_id"] is not None:
            effective_decisions[ww["joint_index"]] = ww["suggested_yield_group_id"]
    if wall_wall_decisions:
        for ji, yg in wall_wall_decisions.items():
            effective_decisions[ji] = yg
    adjustments, _ = compute_adjustments(phase1["joints"], phase1["groups"], effective_decisions, phase1["faces"])
    height_adj = {}
    width_adjs = {}
    for adj in adjustments:
        if adj["axis"] == "height":
            height_adj[adj["group_id"]] = height_adj.get(adj["group_id"], 0) + adj["delta"]
        else:
            width_adjs.setdefault(adj["group_id"], []).append(adj)
    wall_panels = []
    floor_panels = []
    wall_count = 0
    floor_count = 0
    min_area = opts.get("min_area_m2", 0.01)
    faces = phase1["faces"]
    for group in phase1["groups"]:
        eff = override_map.get(group.id, group.category)
        if eff == "discard":
            continue
        is_floor = eff == "floor"
        group_faces = [faces[fi] for fi in group.face_indices if fi < len(faces)]
        if len(group_faces) == 0:
            continue
        height_delta = height_adj.get(group.id, 0)
        w_adjs = width_adjs.get(group.id, [])
        result = project_faces_to_2d(group_faces, group.representative_normal, "Y")
        if not result:
            continue
        width_m = result["width_m"]; height_m = result["height_m"]; edges = result["edges"]
        if width_m * height_m < min_area:
            continue
        if height_delta < 0 and not is_floor:
            strip = min(-height_delta, height_m - 0.01)
            if strip > 0.001:
                base_at_min_v = result["v_up"] >= 0
                clipped = clip_panel_at_v(edges, strip, True) if base_at_min_v else clip_panel_at_v(edges, height_m - strip, False)
                if clipped:
                    width_m = clipped["width_m"]; height_m = clipped["height_m"]; edges = clipped["edges"]
        for w_adj in w_adjs:
            if w_adj["delta"] >= 0 or is_floor:
                continue
            strip = min(-w_adj["delta"], width_m - 0.01)
            if strip <= 0.001:
                continue
            joint = phase1["joints"][w_adj["joint_index"]] if w_adj["joint_index"] < len(phase1["joints"]) else None
            u = (dot(joint["edge_mid"], result["u_axis"]) - result["origin_u"]) if joint else 0
            joint_on_left = u < width_m / 2
            clipped = clip_panel_at_u(edges, width_m - strip, False) if joint_on_left else clip_panel_at_u(edges, strip, True)
            if clipped:
                width_m = clipped["width_m"]; height_m = clipped["height_m"]; edges = clipped["edges"]
        edges = mirror_edges_horizontal(edges, width_m)
        if is_floor:
            floor_count += 1
            floor_panels.append({"id": f"B{floor_count}", "group_name": f"floor_{floor_count}",
                                 "category": "floor", "floor_index": 0, "width_m": width_m,
                                 "height_m": height_m, "edges": edges, "source_group_id": group.id})
        else:
            wall_count += 1
            wall_panels.append({"id": f"A{wall_count}", "group_name": f"wall_{wall_count}",
                                "category": "wall", "floor_index": 0, "width_m": width_m,
                                "height_m": height_m, "edges": edges, "source_group_id": group.id})
    return {"wall_panels": wall_panels, "floor_panels": floor_panels}


def _panels_to_nesting(panels, scale_denom):
    s = 1 / scale_denom
    return [{"id": p["id"], "category": p["category"], "width_m": p["width_m"] * s,
             "height_m": p["height_m"] * s,
             "edges": [{"a": (e["a"][0] * s, e["a"][1] * s), "b": (e["b"][0] * s, e["b"][1] * s)} for e in p["edges"]]}
            for p in panels]


def nest_decomposed_panels(decomposed, config=None, scale_denom=1):
    cfg = config or DEFAULT_SHEET
    return {
        "wall_nesting": nest_panels(_panels_to_nesting(decomposed["wall_panels"], scale_denom), cfg, scale_denom),
        "floor_nesting": nest_panels(_panels_to_nesting(decomposed["floor_panels"], scale_denom), cfg, scale_denom),
        "config": cfg,
    }


# ===========================================================================
# parsePipeline (port de pipeline.ts) -> Phase1Result
# ===========================================================================

def parse_pipeline(file_name, text):
    warnings = []
    ext = file_name.lower().split(".")[-1] if "." in file_name else ""
    stem = re.sub(r"\.[^.]+$", "", file_name)

    if ext != "obj":
        warnings.append(f"Formato no soportado: .{ext}. Usa .obj.")
        return _empty_phase1(stem, warnings)

    faces, _verts, parse_warnings = parse_obj(text)
    warnings.extend(parse_warnings)

    if len(faces) == 0:
        warnings.append("No se encontraron caras en el archivo.")
        return _empty_phase1(stem, warnings)

    unit_scale = _guess_unit_scale(faces)
    if unit_scale != 1.0:
        scaled = []
        for f in faces:
            verts = [(v[0] * unit_scale, v[1] * unit_scale, v[2] * unit_scale) for v in f.vertices]
            inner = [[(v[0] * unit_scale, v[1] * unit_scale, v[2] * unit_scale) for v in loop] for loop in f.inner_loops]
            scaled.append(Face(verts, f.normal, inner, f.panel_id, f.vertex_indices))
        faces = scaled

    detected_up = detect_up_axis(faces)
    raw_faces = faces
    if detected_up == "Z":
        faces = _rotate_z_to_y(faces)

    groups = peel_buried_walls(faces, classify_into_groups(faces, DEFAULT_MIN_REAL_AREA, warnings))

    pre_split = len(faces)
    split_faces, split_groups = split_wall_groups_at_floors(faces, groups, {}, "Y", DEFAULT_MIN_REAL_AREA)
    polish_groups(split_groups, DEFAULT_MIN_REAL_AREA)

    joints = detect_joints(split_faces, split_groups)
    adjustments, wall_wall_joints = compute_adjustments(joints, split_groups, None, split_faces)
    suggested = suggest_coplanar_merges(split_groups, joints)

    return {
        "faces": split_faces, "raw_faces": raw_faces, "applied_axis": detected_up,
        "groups": split_groups, "joints": joints, "adjustments": adjustments,
        "wall_wall_joints": wall_wall_joints, "stem": stem, "warnings": warnings,
        "pre_split_face_count": pre_split, "suggested_merges": suggested,
    }


def _empty_phase1(stem, warnings):
    return {
        "faces": [], "raw_faces": [], "applied_axis": "Y", "groups": [], "joints": [],
        "adjustments": [], "wall_wall_joints": [], "stem": stem, "warnings": warnings,
        "pre_split_face_count": 0, "suggested_merges": [],
    }


# ===========================================================================
# Serialization to Phase1Result JSON (camelCase, matching TS interfaces)
# ===========================================================================

def _v3(t):
    return {"x": t[0], "y": t[1], "z": t[2]}


def _serialize_face(f):
    return {
        "vertices": [_v3(v) for v in f.vertices],
        "normal": _v3(f.normal),
        "innerLoops": [[_v3(v) for v in loop] for loop in f.inner_loops],
        "panelId": f.panel_id,
        "vertexIndices": list(f.vertex_indices) if f.vertex_indices is not None else None,
    }


def _serialize_group(g):
    out = {
        "id": g.id, "label": g.label, "category": g.category,
        "faceIndices": list(g.face_indices), "totalArea": g.total_area,
        "centroid": _v3(g.centroid), "orientation": g.orientation,
        "representativeNormal": _v3(g.representative_normal),
    }
    if g.thickness is not None:
        out["thickness"] = g.thickness
    if g.min_y is not None:
        out["minY"] = g.min_y
    if g.max_y is not None:
        out["maxY"] = g.max_y
    if g.original_category is not None:
        out["originalCategory"] = g.original_category
    return out


def _serialize_joint(j):
    return {
        "groupA": j["group_a"], "groupB": j["group_b"], "totalLength": j["total_length"],
        "dihedralAngle": j["dihedral_angle"], "edgeMid": _v3(j["edge_mid"]),
        "edgeDir": _v3(j["edge_dir"]), "horizontalFrac": j["horizontal_frac"],
    }


def _serialize_adjustment(a):
    return {"groupId": a["group_id"], "delta": a["delta"], "axis": a["axis"],
            "reason": a["reason"], "jointIndex": a["joint_index"]}


def _serialize_ww(w):
    out = {"jointIndex": w["joint_index"], "groupA": w["group_a"], "groupB": w["group_b"]}
    if w["suggested_yield_group_id"] is not None:
        out["suggestedYieldGroupId"] = w["suggested_yield_group_id"]
    if w["yield_group_id"] is not None:
        out["yieldGroupId"] = w["yield_group_id"]
    if w["topology"] is not None:
        out["topology"] = w["topology"]
    if w["critical"] is not None:
        out["critical"] = w["critical"]
    return out


def serialize_phase1(p1):
    return {
        "faces": [_serialize_face(f) for f in p1["faces"]],
        "rawFaces": [_serialize_face(f) for f in p1["raw_faces"]],
        "appliedAxis": p1["applied_axis"],
        "groups": [_serialize_group(g) for g in p1["groups"]],
        "joints": [_serialize_joint(j) for j in p1["joints"]],
        "adjustments": [_serialize_adjustment(a) for a in p1["adjustments"]],
        "wallWallJoints": [_serialize_ww(w) for w in p1["wall_wall_joints"]],
        "stem": p1["stem"],
        "warnings": p1["warnings"],
        "preSplitFaceCount": p1["pre_split_face_count"],
        "suggestedMerges": p1["suggested_merges"],
    }


# ===========================================================================
# Public entry point invoked from the Web Worker
# ===========================================================================

def process_obj(obj_string, scale_denom=50):
    """Recibe el .obj crudo y devuelve un string JSON con el Phase1Result."""
    try:
        p1 = parse_pipeline("model.obj", obj_string)
        return json.dumps({"ok": True, "phase1": serialize_phase1(p1)})
    except Exception as exc:  # noqa: BLE001
        import traceback
        return json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}",
                           "trace": traceback.format_exc()})
