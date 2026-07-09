# Contrato backend: líneas de marca ROJAS arbitrarias (grabar en la pieza)

## Principio
El usuario dibuja **líneas rojas arbitrarias** sobre un componente (recta o a mano alzada) para que se
**graben** en la pieza física, en la **capa roja `MARK_VECTOR` (ACI 1)** del DXF/PDF — igual que las
marcas de aberturas ya existentes, pero geometría **libre**. Es **grabado (score), NO corte**: no cambia
la silueta ni resta material.

División (igual que `user_cuts`/`marks`):
- **FRONT**: dibuja y previsualiza (rojo, no autoritativo) y envía las polilíneas. Ya implementado.
- **BACKEND**: graba la geometría real en el panel del grupo, recortada al material.

## Payload — campo `mark_lines`
Mismo marco que `user_cuts`: coords **UV del panel, en metros** (panel-local, normalizado 0-based, tras
`projectFacesTo2D`). Viaja en `POST /api/nesting-preview` y `POST /api/generate`:

```jsonc
"mark_lines": [
  {
    "id": "mkl-...",
    "group_id": 12,
    "points": [[u0, v0], [u1, v1], [u2, v2], ...]   // polilínea: recta = 2 puntos; libre = N puntos
  }
]
```

| Campo | Tipo | Significado |
|-------|------|-------------|
| `group_id` | number | Componente (panel) sobre el que se dibujó la línea. |
| `points` | `[u,v][]` | Vértices de la polilínea en UV del panel (m). ≥ 2 puntos. Ya viene simplificada. |

## Qué debe hacer el backend
1. **Grabar** cada polilínea en la **capa `MARK_VECTOR` (rojo, ACI 1)** del DXF y en el PDF, ubicada en el
   panel del `group_id` (mismo frame UV que `user_cuts`).
2. **Recortar al material real** del panel: si un tramo cae fuera del contorno o sobre una abertura, se
   omite ese tramo. **No** modifica el contorno exterior ni resta material (es score, no corte).
3. **No** afecta el nesting/silueta: la pieza mantiene su forma; sólo se agregan trazos rojos.
4. Devolver las líneas grabadas en `nesting-preview` (como aristas con flag de marca, o un array
   `mark_lines` por panel) para que el front las dibuje en las **planchas**.

## Front (ya implementado, referencia)
- Modelo: `src/core/mark-lines.ts` (`MarkLine {id, groupId, points[]}`, `serializeMarkLinesForApi` →
  `mark_lines`, RDP `simplifyPolyline`, `MIN_MARK_LINE_M`).
- Herramienta: `MarkLineToolOverlay` (sub-modos **recta** y **libre**), atajo **R** (re-presionar alterna
  recta/libre; Supr borra la última). Estado en `ProjectContext.savedMarkLines`; envío en los 3 payloads.
- Preview 3D rojo: `computeMarkLines3D` (`mark-preview.ts`) → mismo material/overlay rojo que las aberturas.

## Verificación de aceptación
1. Enviar `mark_lines:[{group_id, points:[[..],[..]]}]` → el DXF tiene esos trazos en la **capa roja**,
   sobre el panel correcto, sin cortar material.
2. Un trazo que se sale del panel/abertura se recorta al material; el contorno exterior no cambia.
3. Sin `mark_lines`, el comportamiento actual no cambia.
