# Contrato: instructivo de armado — placement 3D por pieza

## Diagnóstico
El "instructivo de armado" arma un frankenstein. **Las coordenadas 3D del backend son
correctas** (el visor de `/review` renderiza el modelo bien con `faces_packed`). El
problema es del **front**, que reposiciona las piezas mal — probablemente reconstruyendo
la pose desde los paneles 2D del nesting (proyectados, espejados, recortados, reubicados)
o desde `centroid + normal`, perdiendo la pose 3D real.

Cada pieza del instructivo = un **grupo** (54 = 49 muros + 5 pisos).

## Nuevo en el backend: `topology.placements`
`POST /api/upload` y `POST /api/recompute` ahora incluyen en `topology`:

```jsonc
"placements": {
  "<group_id>": {
    "origin": { "x": .., "y": .., "z": .. },   // punto 3D que corresponde a panel (0,0)
    "u_axis": { "x": .., "y": .., "z": .. },    // base ortonormal en el plano de la pieza
    "v_axis": { "x": .., "y": .., "z": .. },
    "normal": { "x": .., "y": .., "z": .. },
    "width_m":  ..,   // ancho del panel en su marco local (metros, sin escalar)
    "height_m": ..,
    "mirrored": true
  }
}
```
- Una entrada por grupo **no descartado**. La clave es `group.id` (coincide con
  `panel_id_by_group`).
- `placements`, `faces_packed` y los grupos están en el **mismo espacio 3D** (eje Y).

## Cómo ubicar una pieza en 3D
Para un punto del panel local `(u, v)` en **metros**:
```
world = origin + u·u_axis + v·v_axis
```
`{u_axis, v_axis, normal}` es ortonormal. El plano de la pieza es el **plano medio** del
grupo.

### Dos formas de armar el instructivo
1. **Geometría original (recomendada, exacta).** Renderizar `faces_packed[group.face_indices]`
   tal cual (coordenadas del mundo, sin transformar). Es el modelo original → poses exactas,
   sin frankenstein. Para esto **no hace falta** `placements`. Es la forma más simple y la
   que ya usa el visor de review. **IMPORTANTE:** usar `faces_packed` (NO `raw_faces_packed`)
   con `group.face_indices` — los índices son a las caras post-split.
2. **Piezas de corte (con huecos/cortes) en 3D.** Tomar el contorno 2D de la pieza (los
   `edges` LOCALES del panel, en metros tras dividir por `scale_denom`):
   - deshacer la rotación de nesting si `rotated`;
   - deshacer el espejo: `u_local = width_m − u` (porque `mirrored: true`);
   - mapear cada vértice: `world = origin + u_local·u_axis + v·v_axis`.
   Así las piezas cortadas quedan ubicadas en 3D con sus huecos.

## Nuevo en el backend: `topology.assembly_steps`
`POST /api/upload` y `POST /api/recompute` ahora incluyen en `topology`:

```jsonc
"assembly_steps": [
  { "step": 1, "group_id": 5, "label": "B1", "level": 0 },   // piso base
  { "step": 2, "group_id": 1, "label": "A1", "level": 0 },   // pared norte, nivel 0
  // ...
  { "step": 8, "group_id": 6, "label": "B2", "level": 1 },   // piso nivel 1
]
```
- Orden de construcción por nivel: piso base → paredes N→E→S→O → siguiente piso → etc.
- `level` = índice del piso (0 = base). `step` = secuencial 1..N. `group_id` = `group.id`.
- El front usa `assembly_steps` para el ORDEN de revelación (NO el orden de `groups[]`).
  Camelizado: `assembly_steps → assemblySteps`, `group_id → groupId`.

## v2 — Método OBLIGATORIO: malla original + overlay de encastres 3D
Los bugs (huecos que no se ven + piso "expandido" en la 2da planta) salían de reconstruir la
pieza desde el panel 2D de corte (silueta proyectada/espejada/escalada). **NO reconstruir desde
el panel 2D.**

1. **Cuerpo + huecos + pose = malla original.** Renderizar `faces_packed[group.face_indices]` tal
   cual, por paso de `assembly_steps` (idéntico al visor de `/review`). Los huecos aparecen solos
   (son gaps reales de la malla). No hace falta `placements`.
2. **Encastres (ranuras) = overlay desde `plate_joints`** en la respuesta de
   `POST /api/nesting-preview` (ya en world coords):

```jsonc
"plate_joints": [
  { "cut_id": 12, "cutter_id": 7,
    "a": {"x":..,"y":..,"z":..}, "b": {"x":..,"y":..,"z":..}, "width": 0.018 }
]
```
   - Filtrar por `cut_id == group.id`; al revelar esa pieza, dibujar el slot.
   - slot = rectángulo `a→b` engrosado `width` sobre el plano de la cara (perp = normal × dir).
   - No requiere liftear nada. Camelizado: `plate_joints→plateJoints`, `cut_id→cutId`.

## Notas
- `mirrored: true`: el contorno de corte del backend viene espejado horizontalmente; al
  liftear a 3D, deshacer con `width_m − u`.
- El placement usa el **plano medio** del grupo; para muros de dos pieles la pieza queda
  centrada (diferencia ≤ medio-espesor, despreciable para el armado).
- Los paneles del nesting vienen **escalados** (×`1/scale_denom`) y **ubicados en planchas**
  (`x`, `y`, `rotated`). Para liftear usar el contorno **local** del panel (sus `edges`),
  NO las coordenadas de plancha.

## Qué NO hacer (causas del frankenstein)
- No reconstruir la pose desde el panel 2D del nesting (no tiene la pose 3D).
- No reconstruir una placa desde `centroid + normal` (pierde rotación en plano y posición).
- No mezclar `group.face_indices` con `raw_faces_packed`.

---

## Implementación en el front (esta app) — v2 vigente
- **Cuerpo (v2):** `applyLift` (`src/core/assembly-sequence.ts`) arma cada pieza con
  `liftFaces(faces[group.faceIndices])` (`src/core/assembly-lift.ts`): la malla original del grupo
  en coords de mundo, igual que `/review`. Los huecos salen como gaps reales. Ya **no** se
  reconstruye desde el panel 2D (`liftPiece`/`edgesToRings` quedan sin uso en el instructivo).
- **Encastres (v2):** `PlateJoint` + `NestingPreviewData.plateJoints` (`src/core/pipeline.ts`);
  `buildSlots(joints, normal)` (`assembly-lift.ts`) engrosa cada `a→b` por `width` sobre el plano de
  la cara. `AssemblyWindow` agrupa `plateJoints` por `cutId` y pasa `normalByGroupId`.
- **Orden:** `Phase1Result.assemblySteps` + `assembly-guide-build.ts` (un paso por pieza; aplicado
  en TODAS las fuentes vía `stepsFromAssemblySteps`). Fallback por orientación si no viene.
- **Visor:** `InteractiveAssemblyViewer.tsx` dibuja la malla (doble cara) + las ranuras como
  overlay ámbar, con la animación de "drop".
- **Robustez:** `applyLift` nunca tira (cae a caja), `ErrorBoundary` envuelve el visor 3D y
  `src/app/review/error.tsx` evita el "Application error" en pantalla en blanco.
