# Contrato backend: corrección de herramientas de edición (corte / marcado) y limpieza de salida DXF/PDF

> **Objetivo.** Cerrar 4 defectos visibles en el **pre-visualizador de planchas** (`/nesting`) y en
> el **PDF/DXF** que genera el backend (`/api/generate`). El frontend **ya captura y envía** los
> datos correctos (`user_cuts`, `mark_lines`, `marks`); lo que falta es que el backend los
> **aplique con la semántica correcta** y **no ensucie** la salida con geometría espuria.
>
> Este documento es la **fuente de verdad** para esos cambios. Es autocontenido: incluye el formato
> exacto de los payloads y lo que debe devolver cada endpoint. Complementa (no reemplaza)
> `CONTRATO_user_cuts_backend.md`, `CONTRATO_mark_lines_backend.md` y `CONTRATO_pdf_output_backend.md`.

---

## 0. Síntomas reportados (qué se ve hoy)

| # | Síntoma observado | Dónde | Comportamiento correcto |
|---|-------------------|-------|-------------------------|
| **B1** | Los **cortes** (herramienta CORTE, rectángulo/círculo) aparecen como **vectores ROJOS** (grabado/quemado). | Preview de planchas **y** PDF/DXF | El corte debe **separar** la zona recortada en un **componente nuevo** (pieza aparte) y dejar el original con un **hueco**. Contorno en la capa de **CORTE (negro/neutro)**, no en la roja. |
| **B2** | Las **líneas de marca ROJAS** (herramienta MARCADO / "Marcas rojas") **no persisten**. | Preview de planchas **y** PDF/DXF | Deben **grabarse en rojo** (capa `MARK_VECTOR`, ACI 1) sobre el panel correcto y verse en el preview y en el PDF/DXF. |
| **B3** | Aparecen **diagonales rojas** que **conectan vértices** de ALGUNOS componentes (artefacto). | PDF/DXF | **No deben existir.** Son aristas internas de la triangulación (o cierres espurios de polígono) que se están emitiendo. El contorno debe salir **limpio** (sólo perímetro exterior + huecos reales). |
| **B4** | Aparecen **elementos VERDES** (líneas / rectángulos). | PDF/DXF | **Quitarlos** de la salida de planchas. No pertenecen a la lámina de corte del taller. |

> Los 4 se manifiestan en la **misma tubería de salida**: proyección del panel a 2D → nesting →
> escritura DXF/PDF. Por eso conviene tratarlos juntos.

---

## 1. Convención de capas — ÚNICA fuente de verdad para las planchas

La lámina de corte (cutting sheet) que consume el taller debe tener **exactamente dos roles de
trazo**, y nada más:

| Rol | Capa DXF | Color | ACI | Qué contiene |
|-----|----------|-------|-----|--------------|
| **CORTE** | `CORTE` (o `CUT`) | **negro / neutro** | 7 | Silueta exterior de cada pieza + huecos reales (aberturas que se cortan) + cortes manuales `rect/square/circle`. Es lo que el láser **corta y separa**. |
| **GRABADO** | `MARK_VECTOR` | **rojo** | 1 | Marcas de grabado que **no cortan**: aberturas marcadas (`marks`), líneas de marca (`mark_lines`), cortes de tipo `line` (score/pliegue), marcas de apoyo. Es lo que el láser **quema/marca** en superficie. |

Reglas duras:

1. **Rojo = grabado, nunca corte.** Cualquier geometría que el láser deba **cortar** (siluetas,
   huecos, `rect/square/circle`) va en la capa **CORTE (negro)**. **Root cause de B1:** hoy los
   cortes manuales caen en la capa roja / se tratan como grabado.
2. **No existe una tercera capa visible en la lámina de corte.** Cualquier otra capa (dimensiones,
   etiquetas, encastres de debug, ejes, verde) **no se dibuja** en el DXF/PDF de planchas. **Root
   cause de B4.** (Las **etiquetas de ID** de pieza, si se conservan, van en una capa de texto
   propia y NO como trazo de corte/grabado.)
3. **Sin aristas internas.** El contorno de cada pieza se obtiene por **cancelación de aristas
   internas** de la malla triangulada: toda arista compartida por dos triángulos coplanares se
   elimina. Nunca se emite la **diagonal** de un cuad triangulado. **Root cause de B3.**

> **Nota sobre `DOCUMENTACION_SISTEMA.md` (F6: "CORTE rojo").** Esa descripción histórica del PDF de
> **fachadas** entra en conflicto con la lámina de **corte**. Para las **planchas** rige la tabla de
> arriba: **CORTE = negro, GRABADO = rojo.** Unificar el `dxf_writer` de planchas a esta convención.

---

## 2. B1 — Cortes manuales (`user_cuts`): cortar de verdad, no grabar

### 2.1 Datos que llegan (ya se envían hoy, snake_case)
`user_cuts` viaja en `POST /api/nesting-preview` **y** `POST /api/generate`:

```jsonc
"user_cuts": [
  {
    "id": "cut-1730000000-x1y2z3",
    "group_id": 12,            // GeometryGroup.id sobre el que se dibujó
    "kind": "rect",            // "rect" | "square" | "circle" | "line"
    "u0": 0.10, "v0": 0.05,    // ancla / esquina / inicio (metros, marco del panel)
    "u1": 0.40, "v1": 0.35,    // esquina opuesta / bbox del radio / fin
    "keep_positive": true      // opcional, sólo "line"
  }
]
```

- **Marco de coordenadas:** UV **panel-local en metros**, normalizado a `(0,0)`, el **mismo** que
  produce `project_faces_to_2d` para ese `group_id` (idéntico al del visor). Ver
  `CONTRATO_user_cuts_backend.md §2`. El front ya resuelve las restricciones de Shift; el backend
  usa `u0,v0,u1,v1` tal cual.
- **Discretización del círculo:** elipse inscripta en el bbox, **64 segmentos** (el front usa
  `CUT_CIRCLE_SEGMENTS = 64`, `src/core/user-cuts.ts`) para que preview y salida coincidan.

### 2.2 Semántica correcta (POR `kind`)

**`rect` / `square` / `circle` → CORTE sustractivo (negro).** Se restan del polígono del panel
(boolean *difference*):

1. Construir el polígono del corte (§2.1) en el marco del panel; clampear a `[0,width]×[0,height]`.
   - `square`: forzar `lado = max(Δu, Δv)` desde la esquina mínima.
   - `circle`: elipse (centro y radios del bbox), 64 segmentos. Ignorar si `rx<0.02` o `ry<0.02`.
   - `rect/square`: ignorar si `Δu<0.02` o `Δv<0.02`.
2. `piezas = difference(polígono_panel, polígono_corte)`, **preservando** los huecos previos
   (aberturas). Descartar piezas degeneradas (área `< 1e-4 m²` o `< 3` aristas).
3. **Resultado esperado (el punto de B1):**
   - Si el corte queda **interior** → el panel original conserva su silueta y **gana un hueco**
     (anillo interior en capa **CORTE negro**). El **material recortado** (el interior) se emite como
     **pieza independiente nueva** en el nesting (id propio derivado del panel), también en CORTE.
   - Si el corte **cruza** el panel de lado a lado → se **parte** en varias piezas → varios
     `NestingPanel`, cada uno en CORTE.
   - **Nunca** en la capa roja. **Nunca** como grabado.

   > El frontend ya hace esta separación en el **visor 3D** (`src/core/cut-derived-groups.ts`:
   > `buildDisplayGroupsFromCuts` → piezas `resto` + `recorte`). El backend debe reproducir el
   > **mismo** resultado en la lámina para que visor, preview y PDF coincidan.

**`line` → GRABADO (rojo), NO corta.** Es marca de pliegue/score:
- No se resta del polígono; la pieza queda intacta.
- Se graba como polilínea `(u0,v0)→(u1,v1)` en capa **`MARK_VECTOR` (rojo)**.
- `keep_positive` se ignora en el comportamiento de referencia (score puro). Ver
  `CONTRATO_user_cuts_backend.md §5`.

### 2.3 Orden y propagación
Filtrar por `group_id`; aplicar los cortes **en orden**; cada corte impacta a **todas las piezas
vigentes** del panel (un corte posterior puede partir una pieza generada por otro anterior).

---

## 3. B2 — Líneas de marca (`mark_lines`): grabar y devolver para el preview

### 3.1 Datos que llegan (ya se envían hoy)
`mark_lines` viaja en `POST /api/nesting-preview` **y** `POST /api/generate`:

```jsonc
"mark_lines": [
  {
    "id": "mkl-...",
    "group_id": 12,
    "points": [[u0, v0], [u1, v1], [u2, v2]]   // polilínea UV panel-local (m). Recta = 2; libre = N; cerrada (rect/círculo) = primero==último
  }
]
```

Mismo marco UV que `user_cuts`. La polilínea **ya viene simplificada** (RDP en el front). Puede ser
**cerrada** (el front ya soporta rectángulo/círculo como marca, `src/core/mark-lines.ts`:
`rectPoints`, `circlePoints`).

### 3.2 Qué debe hacer el backend
1. **Grabar** cada polilínea en la capa **`MARK_VECTOR` (rojo, ACI 1)** sobre el panel del
   `group_id`, en el mismo marco UV. Ver `CONTRATO_mark_lines_backend.md`.
2. **Recortar al material real** del panel: los tramos que caen fuera del contorno o sobre un hueco
   se omiten. **No** modifica la silueta (es score, no corte).
3. **Persistir en ambas salidas:** DXF/PDF (B2 en el PDF) **y** en la respuesta de
   `/api/nesting-preview` (B2 en el preview) — ver §5.

---

## 4. B3 y B4 — Limpiar la salida

### 4.1 B3 — Diagonales rojas que conectan vértices
Diagnóstico: el contorno del panel se está construyendo **sin cancelar** las aristas internas de la
triangulación (o se están volcando aristas de triángulos crudos), y esas diagonales terminan en la
capa roja.

Requisito:
- El contorno de cada pieza debe ser **sólo el perímetro exterior + huecos reales**, obtenido por
  **cancelación de aristas internas** (toda arista compartida por 2 triángulos coplanares se
  elimina). Igual criterio que el front (`edgesToPolygons` / `panelPiecePolygons` en
  `src/core/user-cuts.ts`, y `Error 13` de `errores.md`).
- **Prohibido** emitir la diagonal de un cuad triangulado, o cualquier arista interna, en CORTE
  **o** en `MARK_VECTOR`.
- Verificación rápida: una pieza rectangular simple debe salir con **4 aristas**, no 5.

### 4.2 B4 — Elementos verdes
Diagnóstico: se está dibujando en la lámina una capa que no corresponde (candidatos:
encastres/`plate_joints`, cotas/dimensiones, ejes, o una capa de debug), con color verde.

Requisito:
- La lámina de corte (DXF/PDF de planchas) contiene **únicamente** las capas `CORTE` (negro) y
  `MARK_VECTOR` (rojo) según §1 (más, opcionalmente, una capa de **texto** para el ID de pieza).
- **Eliminar** cualquier trazo verde. Si esa geometría (p. ej. encastres) es necesaria en OTRO
  entregable, va en ese entregable, no en la lámina de corte del taller.

---

## 5. Qué debe DEVOLVER `/api/nesting-preview` (para que el preview coincida con el PDF)

El front no corre el nesting: dibuja lo que devuelve el backend
(`src/components/NestingPreview.tsx`). Estructura por panel (camelCase tras `toCamelCase`):

```jsonc
{
  "id": "W12",                 // id de pieza (derivado del group; único por pieza tras un split)
  "category": "wall",          // "wall" | "floor"
  "width_m": 1.20, "height_m": 0.60,
  "edges": [
    { "a": {"x":0,"y":0}, "b": {"x":1.2,"y":0} },        // silueta → CORTE (negro)
    { "a": {...}, "b": {...}, "hole": true },              // hueco/abertura cortada → CORTE (negro)
    { "a": {...}, "b": {...}, "flex": true }               // patrón de flexión → negro (ya soportado)
  ],
  "is_mark": false             // true ⇒ las aberturas (hole) de ESTE panel se graban en rojo
}
```

Reglas para que el preview refleje B1/B2:

1. **B1 (cortes):** tras aplicar `user_cuts`, devolver los `NestingPanel` **ya recortados**: el
   panel original con el hueco (`hole:true` en `edges`, `is_mark:false` ⇒ se dibuja en color de
   corte, **no rojo**) **más** el/los panel(es) nuevos de la zona recortada. Nada de esto debe venir
   con `is_mark:true`.
2. **B2 (mark_lines) — requiere un campo nuevo.** Hoy `NestingPanel.edges` sólo distingue
   `hole`/`flex`, y el front pinta rojo **sólo** si `is_mark && hole`. Las `mark_lines` (y los cortes
   `line`) **no tienen dónde viajar**. Agregar por panel un array de segmentos de grabado ya
   recortados al material y **rotados/colocados igual que la pieza**:

   ```jsonc
   "mark_segments": [
     { "a": {"x":0.10,"y":0.05}, "b": {"x":0.40,"y":0.05} },
     { "a": {"x":0.40,"y":0.05}, "b": {"x":0.40,"y":0.35} }
   ]
   ```

   - Coordenadas en el **marco local del panel** (mismos ejes que `edges`), en metros, **relativas a
     la pieza colocada** (el front les aplica el mismo offset/rotación que a `edges`).
   - Incluye tanto `mark_lines` como los `user_cuts` de tipo `line`.
   - **Coordinación frontend (necesaria, la implemento en este repo cuando el backend exponga el
     campo):** extender `NestingPanel` con `markSegments?: {a,b}[]` en
     `src/core/sheet-nester.ts`, rotarlos en `rotateEdges`, y dibujarlos en rojo (`#dc2626`) en
     `src/components/NestingPreview.tsx`. Sin este campo, el preview **no puede** mostrar B2 aunque
     el backend lo grabe en el PDF.

3. **B3/B4:** los `edges` que se devuelven ya deben venir **limpios** (sin diagonales internas) y
   **sin** capas verdes. El preview dibuja lo que llega; si llega sucio, se ve sucio.

---

## 6. Resumen accionable para el backend

1. **Capas (§1):** en el `dxf_writer`/`pdf_writer` de **planchas**, dejar sólo `CORTE` (negro, ACI 7)
   y `MARK_VECTOR` (rojo, ACI 1) [+ texto de ID opcional]. Quitar toda otra capa/color (verde) → **B4**.
2. **`user_cuts` (§2):** implementar de verdad en `/generate` (hoy el payload dice *"campo
   reservado"*) **y** en `/nesting-preview`. `rect/square/circle` → `difference` → hueco en CORTE +
   **pieza nueva** en CORTE. `line` → grabado rojo. **Nunca** rect/circle en rojo → **B1**.
3. **`mark_lines` (§3):** grabar en `MARK_VECTOR` recortado al material; **devolverlas** en el
   preview como `mark_segments` por panel → **B2**.
4. **Contorno limpio (§4.1):** cancelar aristas internas; jamás emitir diagonales de triangulación →
   **B3**.
5. Aplicar la **misma** lógica en `/nesting-preview` y `/generate` (una sola fuente de verdad) para
   que **visor 3D, preview y PDF coincidan**.

---

## 7. Criterios de aceptación (verificación)

1. **B1 – corte interior:** dibujar un `rect` en medio de una pared → en el visor, el preview y el
   PDF/DXF aparece (a) la pared con un **hueco** (contorno **negro**) y (b) una **pieza nueva**
   (el recorte) en el nesting, **negra**. **Nada rojo.**
2. **B1 – corte pasante:** un `rect` que cruza la pared de lado a lado → **dos piezas** (dos
   `NestingPanel`), ambas negras.
3. **B1 – línea:** un `user_cut` de `kind:"line"` → línea **roja** de score; la pieza **no** se parte.
4. **B2:** dibujar una `mark_line` (recta, libre, rectángulo o círculo) → se ve **roja** en el
   preview **y** en el PDF/DXF, sobre el panel correcto, recortada al material, sin cambiar la silueta.
5. **B3:** ninguna pieza muestra diagonales que conecten vértices; una pieza rectangular sale con
   **4 aristas**.
6. **B4:** el PDF/DXF de planchas no tiene **ningún** trazo verde; sólo negro (corte) y rojo (grabado).
7. **Coincidencia:** para el mismo modelo + ediciones, el **visor 3D**, el **preview de planchas** y
   el **PDF/DXF** muestran las mismas piezas, huecos y marcas.
8. **Regresión:** sin `user_cuts`/`mark_lines`, la salida no cambia respecto de hoy (más allá de la
   limpieza de capas de §1/§4).

---

## 8. Referencias de código (frontend, ya implementado)

| Tema | Archivo |
|------|---------|
| Modelo y serialización de cortes | `src/core/user-cuts.ts` (`serializeUserCutsForApi`, `applyUserCutsToPanel`, `cutShapePolygon`, `CUT_CIRCLE_SEGMENTS=64`) |
| Separación de piezas en el visor 3D | `src/core/cut-derived-groups.ts` (`buildDisplayGroupsFromCuts`) |
| Modelo y serialización de marcas | `src/core/mark-lines.ts` (`serializeMarkLinesForApi`, `rectPoints`, `circlePoints`, `MARK_CIRCLE_SEGMENTS=48`) |
| Envío en los payloads | `src/app/nesting/page.tsx`, `src/services/api.ts` (`NestingPreviewPayload`, `GenerateRequestPayload`) |
| Dibujo del preview (dónde entra `mark_segments`) | `src/components/NestingPreview.tsx`, `src/core/sheet-nester.ts` (`NestingPanel`, `rotateEdges`) |
| Proyección UV del panel (marco compartido) | `src/core/panel-projection.ts` (`projectFacesTo2D`) |
