# Contrato backend: marcas de APOYO (rojo) — el "mapa" de armado

## Idea
Grabar en **rojo** (capa `MARK_VECTOR`) sobre la cara interior de una pared el **rectángulo exacto** donde
se apoya y pega un piso o estante. El armado deja de ser "medir con regla y rezar" y pasa a ser un encaje
guiado. Es el mismo caso que las ranuras de encastre, pero cuando la junta **no** es una ranura física sino
un **apoyo pegado**.

## Lo que ya existe (no rehacer)
El backend ya calcula y expone la intersección placa↔placa en `/api/nesting-preview`:

```jsonc
"plate_joints": [
  { "cut_id": 14, "cutter_id": 3, "a": [x,y,z], "b": [x,y,z], "width": 0.003 }
]
```

`a→b` es el segmento de intersección en coords de mundo sobre la placa receptora (`cut_id`), y `width` es el
grosor de la placa que se apoya. Hoy el front lo dibuja como **encastre**. La única pieza nueva es distinguir
**ranura** de **apoyo** y grabar el apoyo en rojo.

## Lo que pedimos al backend
1. **Clasificar cada junta** con un campo nuevo `kind`:
   ```jsonc
   { "cut_id": 14, "cutter_id": 3, "a": [...], "b": [...], "width": 0.003, "kind": "surface" }
   ```
   - `"slot"` = encastre físico (ranura/lengüeta) — comportamiento actual, se corta.
   - `"surface"` = apoyo pegado (la placa sólo se apoya y se pega) — **no se corta**, se **graba en rojo**.
2. **Grabar las `surface`** como **footprint rectangular** (usar `a→b` engrosado por `width`, no sólo una
   línea) en la **capa `MARK_VECTOR` (rojo, ACI 1)** del DXF/PDF, sobre el panel del `cut_id`, en su **cara
   interior**. Es grabado (score), no corte: no cambia la silueta ni resta material.
3. No duplicar: donde hay `slot` no va marca de apoyo.

## Front (ya implementado, referencia)
- `PlateJoint.kind?: "slot" | "surface"` (`pipeline.ts`); llega solo por el `toCamelCase` del preview.
- `computeSupportMarks3D` (`src/core/support-marks.ts`) reusa `buildSlots` → footprint rojo; si el backend
  aún no manda `kind`, el front las muestra todas como preview.
- Instructivo de armado: toggle **"Marcas de apoyo"** que resalta los footprints en rojo sobre las piezas.

## Verificación
1. Con `kind:"surface"` en un joint → el DXF tiene ese rectángulo en la capa roja, sobre el panel `cut_id`,
   sin cortar material.
2. Con `kind:"slot"` → sin cambios (encastre como hoy).
3. El toggle del instructivo muestra los apoyos en rojo en la cara correcta.
