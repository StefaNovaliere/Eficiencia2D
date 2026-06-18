# Contrato backend: aplicación de `user_cuts` (cortes manuales)

## Principio
El **front** captura el gesto de corte sobre un panel en el visor 3D y muestra el
preview en vivo (no autoritativo). El **backend** recibe los cortes como
parámetros y los **aplica a los paneles finales** para producir la geometría
autoritativa del DXF/PDF (y del preview de planchas). Front y backend usan la
**misma definición de `UserCut`** y el **mismo marco de panel** para que el
preview coincida con la salida.

Hoy el campo `user_cuts` ya viaja en `/api/generate` (reservado) y en
`/api/nesting-preview`. Falta implementar su aplicación real (este documento).

---

## 1. Dónde llega `user_cuts`
Mismo formato en ambos endpoints (snake_case):

- **`POST /api/nesting-preview`** → para previsualizar las planchas con los
  recortes ya aplicados.
- **`POST /api/generate`** → geometría autoritativa del ZIP (DXF/PDF).

```jsonc
// dentro del body de nesting-preview / generate
"user_cuts": [
  {
    "id": "cut-1730000000-x1y2z3",
    "group_id": 12,            // GeometryGroup.id al que pertenece el corte
    "kind": "rect",            // "rect" | "circle" | "line" | "square"
    "u0": 0.10, "v0": 0.05,    // ancla / esquina / inicio  (metros, marco panel)
    "u1": 0.40, "v1": 0.35,    // esquina opuesta / radio-bbox / fin (metros)
    "keep_positive": true      // opcional, sólo para "line" (ver §5)
  }
]
```

| Campo | Tipo | Significado |
|-------|------|-------------|
| `id` | string | Identificador estable del corte. |
| `group_id` | number | `GeometryGroup.id` cuyo panel se recorta. |
| `kind` | `"rect" \| "circle" \| "line" \| "square"` | Forma del corte. |
| `u0,v0` | number (m) | Punto ancla (esquina/centro-inicio según forma). |
| `u1,v1` | number (m) | Punto opuesto (esquina / extremo del radio / fin de línea). |
| `keep_positive` | bool? | Sólo `line`: lado a conservar si se clipa medio-plano. |

> **Importante:** el front envía las coordenadas **ya resueltas** (las
> restricciones de Shift —cuadrado, círculo perfecto, línea orto— se aplican en
> el cliente al confirmar). El backend **no** necesita re-aplicar la resolución:
> usa `u0,v0,u1,v1` tal cual.

---

## 2. Marco de coordenadas del panel (CRÍTICO)
`u,v` están en el **marco local 2D del panel**, el mismo que produce
`project_faces_to_2d` para ese `group_id`, **después de normalizar a (0,0)**:

- Proyección tangente al plano del grupo (igual que en el visor): ejes
  ortonormales `uAxis = normalize(cross(worldUp, groupNormal))`,
  `vAxis = normalize(cross(groupNormal, uAxis))`, con `worldUp = +Y` o `+Z`
  según el eje aplicado.
- Se proyecta cada vértice (`dot(v, uAxis)`, `dot(v, vAxis)`), se toma el bbox y
  se **resta el mínimo** (`originU, originV`) para que el panel arranque en
  `(0,0)` y llegue a `(widthM, heightM)`.
- Unidades: **metros**. Rango: `0 ≤ u ≤ widthM`, `0 ≤ v ≤ heightM`.

Los cortes se aplican sobre el panel **en este marco**, **antes** de cualquier
rotación/colocación de nesting. La proyección del backend debe coincidir con la
del front (mismo `project_faces_to_2d`) o los recortes quedarán corridos.

---

## 3. Orden de aplicación
1. Para cada `group_id`, tomar su(s) panel(es) ya proyectados a 2D.
2. Aplicar sus cortes **en orden** (el array `user_cuts`, filtrado por `group_id`).
3. Cada corte se aplica a **todas las piezas vigentes** del panel: un corte
   posterior puede impactar una pieza generada por uno anterior.
4. Descartar piezas degeneradas (área `< 1e-4 m²` o `< 3` aristas).
5. Cada pieza resultante es un **panel independiente** para el nesting (id
   propio derivado del panel original).

---

## 4. Semántica por forma — `rect` / `square` / `circle`
Son **sustractivos**: se restan del polígono del panel (boolean *difference*).
Según dónde caigan, producen un **hueco interior** (ventana/puerta) o una
**muesca de borde**, y pueden **partir** el panel en varias piezas.

Polígono del corte (en el marco del panel):

- **`rect`**: rectángulo `[minU,minV] → [maxU,minV] → [maxU,maxV] → [minU,maxV]`,
  con `minU=min(u0,u1)`, `maxU=max(u0,u1)`, ídem V. Clampear a `[0,widthM]×[0,heightM]`.
- **`square`**: igual que rect pero forzando `lado = max(maxU-minU, maxV-minV)`
  desde la esquina mínima (`maxU=minU+lado`, `maxV=minV+lado`).
- **`circle`**: **elipse** inscripta en el bbox del corte. Centro
  `((minU+maxU)/2, (minV+maxV)/2)`, radios `rx=(maxU-minU)/2`, `ry=(maxV-minV)/2`.
  Discretizar a **32 segmentos** (referencia del front, para que el preview
  coincida). Si `rx < 0.02` o `ry < 0.02` → **ignorar** el corte.
- **Tamaño mínimo** (rect/square): si `maxU-minU < 0.02` o `maxV-minV < 0.02` →
  ignorar.

Operación: `pieces = difference(panel_polygon, cut_polygon)`. El panel puede
tener huecos previos (aberturas); preservarlos. Cada anillo exterior del
resultado → una pieza; los anillos interiores → huecos (`hole = true`).

---

## 5. Semántica por forma — `line`
La **línea es una marca de pliegue/score**, NO corta ni parte el panel:
- No se resta del polígono; el panel queda intacto.
- Se emite como **línea de grabado/score** (en el DXF: capa de marca/score,
  típicamente discontinua; en el PDF: línea punteada). Misma capa/color que las
  aberturas marcadas (`marks`, grabado en rojo) o una capa de score dedicada,
  según tu convención.
- Va del punto `(u0,v0)` al `(u1,v1)` en el marco del panel.
- `keep_positive`: **opcional**. La implementación de referencia trata la línea
  como score puro (sin clip). Si en el futuro querés que la línea **corte** el
  panel por un medio-plano, `keep_positive` indica qué lado conservar
  (`cross = dx*(p.v - v0) - dy*(p.u - u0)`; `keep_positive` ⇒ `cross ≥ 0`). No es
  necesario para el comportamiento actual.

---

## 6. Salida esperada

### `nesting-preview`
Los `NestingPanel` del grupo deben reflejar el resultado:
- Huecos/muescas → en `edges` con `hole: true` para los anillos interiores.
- Si un corte partió el panel → varias `NestingPanel` (una por pieza), cada una
  con su `id`.
- Líneas de score → como aristas marcadas (o un campo dedicado) para que el
  front las dibuje punteadas. Si reusás `edges`, alcanzá con marcarlas
  distinguibles de las de corte.

### `generate` (DXF/PDF)
- Huecos/muescas → líneas de **corte** (capa/color de corte).
- Líneas de score → capa de **marca/score** (discontinua), no corte.

---

## 7. Resumen para implementar (backend)
1. Filtrar `user_cuts` por `group_id`; ubicar el/los panel(es) 2D del grupo
   (mismo `project_faces_to_2d`, normalizado a (0,0), metros).
2. Para `rect/square/circle`: construir el polígono del corte (§4) y `difference`
   contra el panel; dividir en piezas; preservar huecos previos; descartar
   degenerados.
3. Para `line`: no restar; registrar como score del panel.
4. Aplicar en orden, propagando a las piezas nuevas.
5. Emitir el resultado en `nesting-preview` (preview) y en `generate` (DXF/PDF).

## 8. Verificación
- Un `rect` interior en una pared → ventana (hueco) en el panel; el preview de
  planchas y el DXF muestran el hueco en el mismo lugar que el visor.
- Un `rect` que toca un borde → muesca; si lo cruza de lado a lado → dos piezas
  → dos paneles en el nesting.
- Un `circle` → elipse/círculo (32 lados) sustraído.
- Una `line` → línea punteada de score, panel sin partir.
- Mover un corte (mismo `id`, coords nuevas) → el resultado se recalcula en su
  nueva posición.
