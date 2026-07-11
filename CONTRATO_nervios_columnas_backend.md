# Contrato backend: refuerzos estructurales — NERVIOS (cartelas) y COLUMNAS

## Principio
El MDF/cartón fino pandea. El usuario puede **pedir** refuerzos; el FRONT manda la intención + un preview
esquemático (ámbar, no autoritativo). El **BACKEND genera la pieza física real** con sus pestañas/encastres,
calcula las **muescas** en las placas que la reciben, la **nestea** y la **cotiza**. Mismo patrón que
kerf/flex.

## Payload (en `/api/nesting-preview` y `/api/generate`)
```jsonc
"ribs": [
  // cartela/soporte SOBRE la arista de intersección de 2 placas ⊥ (p.ej. pared-piso),
  // en la posición pos_t (0..1) a lo largo de esa arista.
  { "id": "rib-...", "group_a": 12, "group_b": 3, "size_m": 0.3, "pos_t": 0.5 }
],
"columns": [
  { "id": "col-...", "position": [x, y, z], "height_m": 3.0, "size_m": 0.2 }  // pilar; position = base
]
```

| Campo | Significado |
|-------|-------------|
| `ribs[].group_a/b` | Las dos placas (grupos) perpendiculares cuya esquina refuerza la cartela. |
| `ribs[].size_m` | Cateto de la cartela (m mundo). |
| `ribs[].pos_t` | Posición a lo largo de la arista de intersección (0..1). El usuario la elige libremente (arriba/abajo/en cualquier punto). |
| `columns[].position` | Base de la columna en coords de mundo (mismo espacio que `faces`/`placements`). |
| `columns[].height_m` | Altura del pilar. |
| `columns[].size_m` | Lado de la sección cuadrada. |

## Qué genera el backend
### Nervios (cartelas)
- Un **triángulo rectángulo** (soporte) que se apoya en las dos placas de `group_a`/`group_b`, **sobre su
  arista de intersección** en la posición `pos_t`, con **2 pestañas de encastre** (una por placa). Los
  catetos van perpendiculares a la arista, hacia el interior de cada placa.
- Las **muescas** correspondientes en cada placa (ranura para la pestaña), respetando clearance con
  aberturas y otras juntas.
- La cartela entra en la **lista de piezas + nesting + precio**.

### Columnas
- Un **pilar** (caja de sección `size_m`, hueco de 4 placas encastradas, o macizo) de alto `height_m` en
  `position`, con encastres **caja-y-espiga (mortise-tenon)** contra el piso y el techo/nivel superior.
- Muescas correspondientes en piso/techo + piezas al nesting + precio.

## Devolver para el gemelo digital
Devolver las piezas generadas (cartelas/columnas) como piezas del instructivo (mismo formato
`AssemblySequencePiece`/`placements`) para que el visor 3D las muestre **con grosor** en su pose, y las
muescas aparezcan como encastres en las placas.

## Front (ya implementado, referencia)
- Modelo/serialización: `src/core/reinforcements.ts` (`Rib`, `Column`, `serializeRibs/ColumnsForApi`).
- Estado: `ProjectContext.savedRibs`/`savedColumns`; payload `ribs`/`columns` en los 3 endpoints.
- UI en Revisión: "Refuerzos estructurales" → "+ Nervio" (2 paredes ⊥ seleccionadas) / "+ Columna"
  (1 componente) + lista para quitar.
- Preview esquemático ámbar en el visor (`reinforcements-preview.ts` + `ReinforcementsOverlay`), NO
  autoritativo — la geometría real (encastres/muescas/nesting) es del backend.

## Verificación
1. Con `ribs`/`columns` en el payload → el backend agrega las piezas al nesting y las muescas a las placas,
   sin romper la silueta ni pisar aberturas.
2. Las piezas vuelven en la guía de ensamble y se ven con grosor en el gemelo digital.
3. El precio/cantidad de material reflejan las piezas nuevas.
