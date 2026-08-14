# Respuesta del front — diagnóstico del instructivo de armado

Respondido leyendo el código, no de memoria. Cada afirmación lleva su `archivo:línea`.

Los bloques **A**, **B** y **D** están contestados. El **C** (volcado numérico de una
pieza) son valores de runtime: hace falta correr la app contra un backend real con un
modelo cargado. Al final está exactamente dónde se leería cada número y qué haría falta
para producirlo.

---

## A · De dónde sale el dato

### 1. Qué endpoint pide el instructivo

**`POST /api/nesting-preview`**, más un **`POST /api/recompute`** que corre por su cuenta.

No se llama a `/api/assembly-guide` ni a `/api/assembly-preview`. Las funciones existen
(`src/services/api.ts:1213` y `src/services/api.ts:1236`) pero **no tienen call sites**:
son código muerto.

El flujo real al abrir la ventana:

1. `ReviewScreen` → `loadAssemblyPreview()` (`src/components/ReviewScreen.tsx:2162`)
2. → `handleRequestAssemblyPreview` (`src/app/review/page.tsx:542`)
3. → **`POST /api/nesting-preview`** (`src/app/review/page.tsx:556`)
4. → la **lista** de piezas (tabla, elevaciones, m²) se arma **en el front** con
   `buildAssemblyGuideFromTopology` (`src/core/assembly-guide-build.ts:83`), desde la
   topología que el front ya tiene. El backend no la manda.

En paralelo, y sin relación con abrir la ventana, un efecto con debounce de 700 ms pide
**`POST /api/recompute` con `scale_denom`** cuando `needsTopologyRefresh` dice que sí
(`src/app/review/page.tsx:240-296`). De ahí salen `placements`, `placements_fieles` y
`plate_thickness_m`, y se aplican pisando sólo esos campos de la topología
(`src/app/review/page.tsx:280-287`).

### 2. Body exacto

**`/api/nesting-preview`** (`src/app/review/page.tsx:556-583`):

```jsonc
{
  "file_id": "<fileId>",              // → se serializa como proyecto_id si hay JWT
  "original_filename": "...",
  "axis": "Y",
  "min_area_m2": <minAreaM2>,
  "merges": [...],
  "splits": [{ "group_id": .., "mode": "components" | "panels" }],
  "overrides": { "<groupId>": "wall" | "floor" | "discard" },
  "wall_wall_decisions": { "<jointIdx>": <groupId> },
  "marks": [...],
  "sheet_config": { "width_m": .., "height_m": .., "gap_m": .. },
  "scale_denom": <scale>,
  "paper": "...",
  "page_mode": "one_per_sheet" | "single_page",
  "user_cuts": [...],
  "flex": [...],
  "mark_lines": [...],
  "ribs": [...],
  "columns": [...]
}
```

Los tres que preguntabas: **`scale_denom` ✔ va**, **`wall_wall_decisions` ✔ va**,
**`overrides` / `merges` / `splits` ✔ los tres van**.

**`/api/recompute`** (`buildRecomputePayload`, `src/services/api.ts:373-399`):

```jsonc
{
  "file_id": "<fileId>",
  "original_filename": "...",
  "axis": "Y",
  "min_area_m2": <minAreaM2>,
  "merges": [...],
  "splits": [...],
  "overrides": {...},
  "scale_denom": <scale>,          // ← sin esto sabemos que volvés la proyección cruda
  "wall_wall_decisions": {...}
}
```

Nota de serialización: `overrides` y `wall_wall_decisions` se mandan con **claves string**
(`toWirePipelinePayload`, `src/services/api.ts:192-204`), y los objetos/arrays vacíos se
**omiten** del body (`compactOptionalPipelineFields`, `src/services/api.ts:210`).

### 3. Qué campo usa para posicionar cada pieza

**`placements`**, pero puede venir de dos lugares distintos y **la elección es dinámica**.

`mejorFuenteDePiezas` (`src/components/AssemblyWindow.tsx:365`) elige entre:

- `placements` de **`/nesting-preview`** (parseado en `parseNestingPlacements`,
  `src/core/final-pieces.ts:105`)
- `topology.placements` de **`/recompute`**

y **gana la fuente que traiga más piezas con `outline`**. A igualdad gana el nesting.

Esto importa para tu pregunta "cuál está leyendo hoy": **depende del proyecto y de la
respuesta**. No es una constante.

`topology.placements` sólo se considera **si `placements_fieles === true`**
(`src/components/AssemblyWindow.tsx:490`). Los placements crudos sin `scale_denom` **nunca
entran al camino de dibujo**.

El orden de prioridad completo, en `applyLift` (`src/core/assembly-sequence.ts:160-280`):

| # | Fuente | Función | ¿Recortada? |
|---|---|---|---|
| 1 | `placement.outline` (de la fuente ganadora) | `liftOutline` | sí |
| 2 | `placement` + `edges` del panel de plancha | `liftPiece` | sí |
| 3 | `final_pieces` de `/nesting-preview` | `liftFinalPiece` | sí |
| 4 | `faces_packed[group.face_indices]` | `liftFaces` | **no** |
| 5 | nada de lo anterior dio ≥ 3 triángulos | caja `BoxGeometry` | **no** |

### 4. ¿Lee `placements_fieles`?

Sí: `Phase1Result.placementsFieles` (`src/core/pipeline.ts:105`). Se usa para tres cosas:

- decidir si `topology.placements` puede entrar al dibujo (`AssemblyWindow.tsx:490`);
- decidir si se vuelve a pedir la topología (`needsTopologyRefresh`, `api.ts:340`);
- decidir el cartel de la barra lateral: verde "Ensamble verificado" vs amarillo
  "Encaje sin verificar — se está mostrando el modelo, no las piezas ya recortadas"
  (`AssemblyWindow.tsx:763-783`).

**Qué valor llega hoy**: `/upload` siempre devuelve `false` (no lleva escala), y el front
dispara `/recompute` con `scale_denom` justamente para conseguir el `true`. El valor
efectivo de una corrida concreta es dato de runtime → bloque C.

### 5. ¿Lee `plate_thickness_m`?

Sí, con este orden (`src/components/AssemblyWindow.tsx:390-394`):

1. `phase1.plateThicknessM` (el `plate_thickness_m` del backend) si es > 0;
2. si no, el front lo deriva: `0.003 m × scale_denom`
   (`MATERIAL_THICKNESS_M` en `AssemblyWindow.tsx:48`, `resolveSlabThicknessM` en
   `src/core/assembly-slab.ts:33`).

**El valor global está bien** — verificado a pedido del backend. `resolveSlabThicknessM` es
`0.003 × scale_denom` (`src/core/assembly-slab.ts:33`), o sea **0,30 m de edificio a
1:100**, no 3 mm planos. La preocupación de "las placas se ven cien veces más finas y
ningún choque se ve" no aplica: el término de escala ya está.

**Lo que sí estaba mal, y ya está arreglado**: ese valor global **pisaba el `depth_m` de
todas las piezas** en el visor, incluido el `thickness_m` por pieza que `applyLift` sí lee.
O sea que el espesor por pieza no llegaba nunca a la pantalla. Ahora el por-pieza manda y
el global queda de respaldo (marca `depthFromBackend`,
`InteractiveAssemblyViewer.tsx:575-582`). Hoy no cambia nada visible porque todas las
piezas tienen el mismo espesor, pero deja de ser una trampa para cuando dejen de tenerlo.

---

## B · Cómo se dibuja cada pieza

### 6. ¿Caja o polígono extruido?

**Polígono extruido**, salvo en el último fallback.

`liftOutline` (`src/core/assembly-lift.ts:315`) encadena las aristas del `outline` en
anillos cerrados, separa contorno de huecos, triangula con
`THREE.ShapeUtils.triangulateShape` (earcut con huecos — el mismo que usa `/review`), y
mapea cada vértice con la fórmula del contrato. Después se extruye a slab
(`buildSlab` / `buildInwardSlab`, `src/core/assembly-slab.ts`).

La **caja aparece sólo** si el lift devuelve menos de 9 floats (< 1 triángulo): ahí el
visor cae a `StaticPiece` / `FallingPiece` con `<boxGeometry>`
(`InteractiveAssemblyViewer.tsx:156` y `:230`).

### 7. Si es caja, de dónde salen las medidas y la rotación

```ts
// src/components/InteractiveAssemblyViewer.tsx:134-140
function pieceSize(piece) {
  return [safeDim(piece.width_m), safeDim(piece.height_m), safeDim(piece.depth_m)];
}
// :125-132
function pieceRotation(piece) {
  const r = piece.rotation ?? { x: 0, y: 0, z: 0 };
  return [r.x, r.y, r.z];   // Euler XYZ, radianes
}
```

Y en la ruta del front, `rotation` **siempre vale (0, 0, 0)**:

```ts
// src/core/assembly-sequence.ts:344-356
function panelToPiece(panel, stepIndex) {
  return {
    position: panel.centroid,
    rotation: { x: 0, y: 0, z: 0 },   // ← nunca se calcula
    depth_m: panel.category === "floor" ? 0.04 : 0.012,   // ← hardcodeado
    ...
  };
}
```

**Esto es importante para tu tabla de síntomas**: la caja de respaldo sale alineada a los
ejes del mundo, centrada en el centroide del grupo, con espesor inventado. Una pared
diagonal dibujada por esta ruta se ve rotada y del tamaño equivocado — mismo síntoma que
"reconstruye la orientación desde `normal`", causa distinta.

### 8. ¿`u_axis`/`v_axis` o reconstrucción desde `normal`?

**`u_axis` / `v_axis`, tal cual, sin tocar.** La fórmula está literal:

```ts
// src/core/assembly-lift.ts:227-234
function liftUV(u, v, { origin, uAxis, vAxis }) {
  return new THREE.Vector3(
    origin.x + u * uAxis.x + v * vAxis.x,
    origin.y + u * uAxis.y + v * vAxis.y,
    origin.z + u * uAxis.z + v * vAxis.z,
  );
}
```

No hay `Euler`, no hay `lookAt`, no hay reconstrucción de base. `normal` se usa **sólo**
para dos cosas secundarias:

- orientar el rectángulo de una ranura de encastre (`buildSlots`, `assembly-lift.ts:446`);
- decidir hacia qué lado engrosar un muro (`orientOutwardNormal`, `assembly-slab.ts`).

### 9. ¿Qué se hace con `mirrored`?

**Se lee, se conserva en el tipo, y no se aplica nunca en el instructivo.**

- `liftOutline` no tiene término de espejo (`assembly-lift.ts:315-357`).
- La ruta panel-de-plancha lo fuerza a `false` explícitamente:
  `liftPiece({ ...nestingPlacement, mirrored: false }, nestingPanel)`
  (`src/core/assembly-sequence.ts:198`).

El razonamiento que quedó escrito en el código (`assembly-sequence.ts:192-197`) es que el
espejado ya viene **horneado en el marco**: el backend corrió el `origin` al otro extremo e
invirtió `u_axis`, y la fórmula del contrato no tiene término de espejo, así que
compensarlo otra vez daría vuelta cada pieza asimétrica sobre su propio eje.

**Pregunta abierta para vos** (`src/core/final-pieces.ts:69-76`): el contrato dice en el
texto que `mirrored` llega en `false`, pero su ejemplo JSON muestra `true`. Por eso el
front decidió no depender del valor. **Confirmanos cuál es la verdad**: si el espejo NO
está horneado en el marco, esto es exactamente la causa de "piezas espejadas" y el arreglo
es de una línea.

### 10. Unidades y escala global

**Metros de edificio (coordenadas de mundo)** — el mismo espacio que `faces_packed` y que
el visor de `/review`. Eje Y arriba.

**No hay factor de escala global sobre el grupo.** `prepareAssemblyPiecesForRender`
(`src/core/assembly-sequence.ts:386-414`) pone `scale = 1` en cuanto **alguna** pieza tiene
geometría lifteada:

```ts
const hasLift = pieces.some((p) => p.lifted);
const scale = hasLift || isOrientedBoxV1 ? 1 : detectMetreScale(pieces);
```

El autodetector mm/cm (`detectMetreScale`, `:367`) sólo actúa en la ruta de cajas sin lift.

El **único** término que depende de la escala de impresión es el **espesor**: viene de
`plate_thickness_m`, o si no llega se deriva como `3 mm × scale_denom`. Todo lo demás son
metros de edificio sin escalar.

### 11. Aberturas y ranuras

**Aberturas (puertas/ventanas)**: sí, se dibujan. Vienen como anillos con `hole: true`
dentro del `outline`; `edgesToRings` los separa (`assembly-lift.ts:59`), se pasan como
huecos a la triangulación (así el material no se rellena), y además sus bordes se dibujan
como `LineSegments` sobre la pieza (`openings`, `assembly-lift.ts:346-349`).

Hay una heurística: cuando hay varios anillos exteriores, el de mayor área es el contorno y
los que caen adentro se reclasifican como huecos (`liftOutline`,
`assembly-lift.ts:328-335`). Sirve para ranuras cerradas interiores.

**Ranuras de encastre**: **no se cortan de la malla, se pintan encima**. Overlay ámbar
desde `plate_joints` de `/nesting-preview`: cada segmento `a→b` se engrosa `width` sobre el
plano de la cara (`perp = normal × dir`) con un offset de 1,5 mm sobre la normal para
evitar z-fighting (`buildSlots`, `assembly-lift.ts:446-479`).

---

## C · Volcado numérico de una pieza

No lo puedo contestar desde el código: son valores de una corrida. Hace falta la app
levantada, un modelo cargado y un backend que responda `/api/nesting-preview` y
`/api/recompute`.

Lo que sí puedo dar es **dónde vive cada número que pedís**:

| Lo que pedís | Dónde está en el front |
|---|---|
| **C.1** objeto crudo del backend | `nestingData.nestingPlacements.get(groupId)` — parseado en `final-pieces.ts:105`. El de topología: `phase1.placements[groupId]` |
| **C.2** posición/tamaño/rotación finales | **No existen como tales en la ruta buena.** La pieza se dibuja como `BufferGeometry` con triángulos ya en coordenadas de mundo: `piece.lifted.positions` (flat `[x,y,z, …]`), con el mesh en `position=(0,0,0)` y `rotation=(0,0,0)`. Posición/tamaño/rotación sólo aplican en la ruta de caja |
| **C.2** lista de vértices en mundo | `piece.lifted.positions` — 9 floats por triángulo |
| **C.3** identificador | `piece.id` = etiqueta de panel (`A4`); el `group_id` sale de `lift.labelToGroupId.get(label)` (`assembly-sequence.ts:166`) |

### El volcado — ya está implementado

`src/core/assembly-dump.ts`. Se activa por query param, abriendo el instructivo:

- `?dumpPieza=A4` → una pieza
- `?dumpPieza=*` → todas

Imprime por consola, agrupado por pieza:

- **el reparto por fuente de TODA la corrida** (`{ outline: 24, faces: 3, box: 1, … }`),
  calculado siempre sobre todas las piezas aunque filtres una sola — es el dato que
  pediste. Si alguna cayó a `faces` o a `box`, sale además un `console.warn` explícito:
  esas no son las medidas que se cortan;
- **C.1** el placement crudo tal como llegó del backend;
- **C.2** cantidad de triángulos, espesor aplicado **y de dónde salió** (`del backend` vs
  `global del front`), y los primeros vértices en coordenadas de mundo;
- cantidad de aristas del `outline` (0 = no vino);
- **D.1** coplanaridad: los cuatro `dot(esquina, normal)` y el spread en mm;
- **D.2** área triangulada vs `area_m2`, con el ratio (≈2 = se está dibujando el
  rectángulo);
- **D.3** por cada esquina, la distancia al plano medio de las vecinas **que la
  contienen**. El filtro importa: sin él, el plano infinito de cualquier pared lejana pasa
  cerca de cualquier punto y el número no dice nada. Debería dar media placa.

Es sólo lectura: no toca la geometría ni cambia lo que se ve. La matemática está cubierta
en `src/__tests__/assembly-dump.test.ts`.

---

## D · Las tres comprobaciones

### D.1 · Coplanaridad de los cuatro vértices

**Se cumple por construcción, si el marco que mandás es ortonormal.** El front aplica la
fórmula del contrato literal, sin escalar y sin espejar (`liftUV`,
`assembly-lift.ts:227`). No hay ningún paso intermedio que pueda romper la coplanaridad.

Corolario: **si esa comprobación falla, el problema está en el marco que manda el backend**,
no en el mapeo del front.

(La única ruta que escala es `liftPiece` con el panel de plancha, y el factor se deriva de
los propios datos: `scale = placement.widthM / panel.widthM`, `assembly-lift.ts:133-137`.
Es un escalar único, así que tampoco rompe coplanaridad.)

### D.2 · Superficie dibujada contra `area_m2`

**El caso del faldón triangular al doble ya no aplica** cuando llega `outline`: el front
dibuja el contorno, no el rectángulo. Eso se cambió en el commit `b60a06f`
(*"dibujar el contorno de corte, no la caja que lo contiene"*).

Sin `outline` sí aplica, y de tres formas distintas según a qué fallback caiga (fuentes 2,
4 y 5 de la tabla del punto A.3).

Aparte, un detalle sobre el `area_m2` **de la tabla lateral** (no del dibujo): sale de
`nestingPlacement.areaM2` cuando está, y si no de `group.totalArea`, que suma las caras de
la malla y por lo tanto **cuenta las dos pieles de un sólido**
(`assembly-guide-build.ts:110`). Si comparás áreas contra esa tabla, tenelo en cuenta.

### D.3 · Dos piezas vecinas en una esquina

**El front no calcula ese offset.** Extruye cada pieza por el espesor global
`slabThicknessM`, y en muros lo hace **hacia adentro** (`buildInwardSlab`), dejando fija la
fachada exterior (`assembly-sequence.ts:271`, `assembly-lift.ts:30-34`).

Lo único que puede acortar una pieza en el front son los *yield clips* de los encuentros
pared-pared (`applyYieldClipsToPositions`, `src/core/wall-yield-clip.ts`), y **sólo se
aplican cuando la pieza NO viene ya recortada** (`yaRecortada`, `assembly-sequence.ts:230`).
Con `outline` del backend, el front no toca nada.

Conclusión: **la distancia entre vecinas es la que dan tus marcos**. Si esa medición da 0 o
da el espesor entero, no hay nada en el visor que la esté corrigiendo ni ensuciando.

---

## Contra tu tabla de síntomas

| Síntoma | Tu causa candidata | Qué dice el código |
|---|---|---|
| piezas más grandes que las reales | lee el crudo sin `scale_denom` | **Descartado como tal**: `topology.placements` sólo entra si `placements_fieles === true` (`AssemblyWindow.tsx:490`). **Pero hay un equivalente**: si `/nesting-preview` falla y la topología no vino fiel, cae a `liftFaces` = malla original del modelo **sin recortar** (`assembly-sequence.ts:216-222`). Mismo síntoma, otra fuente |
| formas distintas (faldones, muescas, aberturas) | dibuja cajas en vez de `outline` | **Sólo si el lift devuelve < 1 triángulo.** Con `outline` presente se dibuja el contorno con huecos. Sin `outline` en el placement, la pieza sale como su rectángulo por la ruta 2 |
| piezas rotadas o mal posicionadas | reconstruye desde `normal` | **Descartado**: usa `u_axis`/`v_axis` literal. **Pero** la caja de respaldo tiene `rotation = (0,0,0)` fija y se centra en el centroide (`assembly-sequence.ts:349`) → produce exactamente ese síntoma por otra vía |
| piezas espejadas | compensa `mirrored` cuando ya viene horneado | **Descartado**: el front **no compensa nunca**. Si se ven espejadas, entonces el espejo **no** está horneado en el marco y hay que aplicarlo. **Necesitamos que confirmes esto** (ver punto 9) |

### Lo que más nos serviría de vuelta

1. **`mirrored`**: ¿el espejo está horneado en el marco (origen corrido + `u_axis`
   invertido) o hay que aplicar `width_m − u`? El contrato se contradice entre texto y
   ejemplo.
2. **`outline`**: ¿en qué respuestas viaja y en cuáles no? La fuente de dibujo del front se
   elige por *cuál trae más `outline`*, así que si viene intermitente, el visor cambia de
   fuente solo.
3. **`thickness_m` por pieza**: ¿mandás espesores distintos por pieza? Hoy los pisa el
   espesor global; si los usás, lo cambiamos.
