# Contrato backend v2: KERF BENDING = remoción de ranuras rectangulares (huecos)

## Corrección (lo que estaba mal)
La v1 interpretó el kerf como **líneas de corte / score** (un vector que raya el panel). **Es incorrecto.**
El kerf bending real es un **peine (comb) de RANURAS RECTANGULARES que se REMUEVEN** del panel: aparecen
**huecos** (rectángulos vacíos) y el componente cambia significativamente (se elimina material). Sin esos
huecos la pieza no flexa.

> Regla de oro: aplicar kerf **debe quitar material** → el panel resultante tiene rectángulos abiertos, no
> solo trazos. Si el DXF/preview sólo muestra líneas, está mal.

## Referencia física (`peine_kerfing_elasticidad.stl`, analizado)
Panel **80 × 40 × 3 mm**. En la banda central se cortan **ranuras verticales** finas y se **remueven**:
- **Ancho de ranura** (hueco) ≈ **1.2 mm**.
- **Pitch entre columnas** ≈ **3 mm** (⇒ diente/ligamento restante ≈ 1.8 mm).
- **Largo de ranura** ≈ **35 mm** sobre un panel de 40 mm ⇒ **puente ≈ 5 mm** en un extremo.
- Las columnas **alternan el extremo del puente** (una arriba, la siguiente abajo) → living hinge
  tipo acordeón / lattice. El sheet flexa alrededor del eje **paralelo a las ranuras**.

```
  eje de doblez  →  (las columnas avanzan en X; las ranuras corren en Y)
   ┌───────────────────────────────────────────┐   ▲ Y (largo de ranura)
   │ ▓  ░  ▓  ░  ▓  ░  ▓  ░  ▓  ░  ▓  ░  ▓       │   │ puente arriba (col par)
   │ ▓  ░  ▓  ░  ▓  ░  ▓  ░  ▓  ░  ▓  ░  ▓       │
   │ ░  ▓  ░  ▓  ░  ▓  ░  ▓  ░  ▓  ░  ▓  ░       │   puente abajo (col impar)
   └───────────────────────────────────────────┘
     ▓ = ranura REMOVIDA (hueco)   ░ = diente/ligamento (material)   →  X (pitch)
```

## 1. Parámetros (`flex[]`, por grupo) — ya viajan en el payload
`POST /api/nesting-preview` y `POST /api/generate` (snake_case), un objeto por `group_id`:

```jsonc
{
  "group_id": 12,
  "method": "kerf",
  "spacing_m": 0.003,   // DISTANCIA ENTRE COLUMNAS (variable del usuario), metros FÍSICOS de maqueta
  "ligament_m": 0.0015, // opcional: diente/puente sin cortar entre ranuras
  "kerf_width_m": 0.0015,// opcional: ancho de la hoja/corte
  "axis_deg": 0         // opcional: orientación del doblez (dirección de avance de columnas)
}
```

- **`spacing_m` = distancia entre columnas** y es **lo único que ajusta el usuario**. Interpretar en
  **metros físicos de maqueta** (el back ya escala por `scale_denom`). Rango útil 2–6 mm.
- **Semántica pedida**: al **aumentar** `spacing_m`, el **hueco (ranura) se hace más ancho** → **se remueve
  más material** (más vacío). Es decir, el ancho de ranura crece con `spacing_m` (p. ej. ranura ≈
  `spacing_m − ligament_m`, con `ligament_m` como diente mínimo). El back define la relación exacta, pero
  el efecto visible debe ser: más distancia ⇒ más vacío.
- El **largo de ranura** y el **puente** (extremo alternado) los define el back a partir del alto de la
  banda a plegar (referencia: puente ~10–15% del largo, alternando por columna). El **eje de doblez** sale
  de la curvatura (`topology.curvature.principal_dir`) o de `axis_deg`.

## 2. Salida esperada (lo que cambia respecto de v1)

### `POST /api/nesting-preview`
- El/los `NestingPanel` del grupo deben incluir las ranuras como **loops internos CERRADOS** (rectángulos)
  con **`flex: true`** en sus aristas → el front ya los dibuja como corte y se leen como huecos. Deben ser
  **contornos cerrados** (no segmentos sueltos) para que rendericen como rectángulos vacíos.
- El **área/silueta del panel refleja el material removido** (no es el panel lleno con líneas encima).

### `POST /api/generate` (DXF/PDF)
- Las ranuras se **cortan y remueven** (capa de corte `FLEX_CUT`, negro): son **aberturas reales**, no
  score. El panel queda significativamente más liviano.
- El **nesting** usa el panel resultante (con huecos); los huecos no cambian el bounding pero sí el material.

## 3. Auxéticos
Sin cambio conceptual respecto del contrato anterior, pero **misma regla**: también **remueven celdas**
(huecos), no son líneas. Ver `CONTRATO_kerf_auxetico.md` (queda vigente para el resto; esta v2 reemplaza
**sólo** la interpretación del kerf).

## 4. Front (ya hecho, referencia)
- Preview 3D esquemático: `kerfSegments` (`src/core/flex-bending.ts`) ahora dibuja **contornos de ranuras
  rectangulares** en peine interdigitado (no líneas), recortados al contorno real del componente
  (`flex-preview.ts`). Es **no autoritativo**; la geometría real la hace el back.
- UI (`FlexControls.tsx`): un solo control, **"distancia entre columnas"** (mm de maqueta), con copy
  "el patrón quita material / más distancia ⇒ ranura más ancha".
- Planchas (`NestingPreview.tsx`): dibuja las aristas `flex:true` como corte negro → los loops cerrados se
  ven como rectángulos vacíos.

## 5. Verificación de aceptación
1. `flex:[{group_id, method:"kerf", spacing_m:0.003}]` → `nesting-preview` devuelve el panel del grupo con
   **rectángulos internos cerrados** (`flex:true`) = huecos; el material del panel **disminuye**.
2. Aumentar `spacing_m` (3 → 5 mm) ⇒ ranuras **más anchas** (más vacío), menos material.
3. `generate`: el DXF tiene las ranuras como **aberturas** (no líneas de score); abrir el DXF muestra
   rectángulos vacíos en la zona del kerf.
4. Sin `flex`, nada cambia.
