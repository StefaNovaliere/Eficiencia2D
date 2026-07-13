# Contrato backend: refuerzos estructurales — NERVIOS (cartelas) y COLUMNAS

## ⚠️ Cambio de concepto (importante, leer primero)
Un refuerzo (nervio o columna) es un **COMPONENTE NUEVO E INDEPENDIENTE**, no una modificación de las placas
existentes:
- **NO se tocan las placas existentes** en la plancha de corte (sin muescas/ranuras en la pared ni el piso).
- El refuerzo se agrega como **una pieza más** a la lista de piezas / nesting / plancha de corte / precio.
- El usuario, al armar la maqueta física, lo **pega/ubica manualmente** donde quiera. El software sólo lo
  **sugiere** en el visor 3D (referencia visual); no fuerza una posición en el corte.

Es decir: el `pos_t`, `group_a/b` y `position` que manda el front son **sólo pistas para dibujar el preview
3D**. Para generar la pieza y nestearla, el backend sólo necesita **tamaño** (y alto/sección en columnas).

## Reparto
- **FRONT**: preview esquemático (ámbar) en el visor 3D para que el usuario vea dónde iría + manda la lista.
- **BACKEND**: genera la pieza nueva (triángulo/columna) y la **agrega al nesting y al PDF/DXF** como un
  componente más. Sin encastres en las placas existentes.

## Payload (en `/api/nesting-preview` y `/api/generate`)
```jsonc
"ribs": [
  // cartela = triángulo rectángulo de material. group_a/group_b/pos_t son SÓLO
  // pista de ubicación para el preview 3D del front; para el corte alcanza size_m.
  { "id": "rib-...", "group_a": 12, "group_b": 3, "size_m": 5.0, "pos_t": 0.5 }
],
"columns": [
  // pilar independiente. position/height/size describen la columna; position es
  // sólo pista visual, no obliga una ubicación en el corte.
  { "id": "col-...", "position": [x, y, z], "height_m": 3.0, "size_m": 0.2 }
]
```

| Campo | Uso |
|-------|-----|
| `ribs[].size_m` | Cateto del triángulo en metros de MUNDO (edificio real). ⚠️ Viene de un tamaño FÍSICO modesto: **50×50 mm de maqueta × escala** (a 1:100 ⇒ 5.0 m de mundo). El backend corta la cartela al tamaño físico: `size_m / escala` — **piezas chicas para dar escuadra, NO nervios gigantes**. |
| `ribs[].group_a/b`, `pos_t` | Pista de ubicación para el preview 3D del front (no afecta el corte). |
| `columns[].height_m`, `size_m` | Alto y lado de sección de la columna. **Definen la pieza.** |
| `columns[].position` | Pista visual (dónde la sugiere el usuario); no obliga nada en el corte. |

## Qué genera el backend (piezas nuevas, NO modifica placas)
### Nervios (cartelas)
- Una pieza **triángulo rectángulo** de catetos `size_m` (× espesor del material), **plana**, lista para
  cortar. El usuario la pega en la esquina que quiera. **Sin pestañas ni muescas en las placas** (se pega).
- Se agrega al nesting + plancha + precio como un componente más.

### Columnas — ⚠️ TERMINAR ESTO (quedó pendiente)
- Una **columna** como componente(s) nuevo(s): p.ej. una tira que se pliega en caja de sección `size_m` y
  alto `height_m`, o 4 placas, **desplegada a plano** para cortar. Lista para armar y pegar por el usuario.
- Se agrega al nesting + plancha + precio. **Sin muescas en piso/techo existentes.**

## Devolver para el gemelo digital (opcional pero deseable)
Devolver las piezas nuevas en la guía de ensamble (`AssemblySequencePiece`/`placements`) para que el visor
3D las muestre con grosor. Igual el front ya dibuja un preview esquemático.

## Front (ya implementado, referencia)
- Modelo/serialización: `src/core/reinforcements.ts` (`Rib{groupA,groupB,sizeM,t}`, `Column`, serializers).
- Preview: `reinforcements-preview.ts` ubica el nervio sobre la **arista real del backend** (`PlateJoint` de
  `nesting-preview`) en la posición `pos_t`; la columna como caja parada en el componente elegido.
- UI en Revisión: "Refuerzos" → "+ Nervio" (2 placas ⊥) / "+ Columna" (1 componente) + slider de posición
  del nervio + lista para quitar.

## Verificación
1. Con `ribs`/`columns` en el payload → aparecen como **piezas nuevas** en la plancha de corte y el precio;
   **las placas existentes quedan idénticas** (sin muescas).
2. Las columnas se generan y cortan (pendiente de ayer) → **terminarlas**.
3. El 3D muestra el refuerzo en la ubicación sugerida (referencia); el usuario lo pega donde quiera.
