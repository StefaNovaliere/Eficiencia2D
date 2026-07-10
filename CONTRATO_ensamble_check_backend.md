# Contrato backend (Fase 2, futuro): chequeo automático de ensamble

> **Estado: propuesta, NO implementado.** La Fase 1 (grosor real + material en el instructivo) ya está en
> el front. Este documento define el contrato para el chequeo automático que le sigue.

## Problema
El gemelo digital del instructivo ahora muestra las piezas con **grosor real** (slab MDF/cartón), así que
un error grosero (una pared "en el aire") se ve. Pero confiar en que el usuario gire la cámara y detecte a
ojo un hueco de 5 mm es riesgoso. La confirmación **matemática** es infalible; la visual no.

Como el backend C++ ya es dueño de `topology.placements` + la joinery + el espesor, es el único lugar que
puede calcular interferencias/huecos de forma barata y exacta. El front sólo **muestra** las advertencias.

## Contrato — array `assembly_warnings`
Devolver en el **preview** (nesting-preview / assembly-preview), para que el aviso llegue **antes de pagar**:

```jsonc
"assembly_warnings": [
  {
    "pieces": ["Pared_A", "Piso_B"],   // ids que matchean los de las piezas del instructivo
    "type": "gap",                      // "gap" | "overlap" | "unsupported"
    "measure_mm": 5.0,                  // magnitud del hueco/solape
    "at": [x, y, z],                    // punto en MUNDO para resaltar/enfocar la cámara
    "tolerance_mm": 0.5                 // umbral usado (para mostrarlo)
  }
]
```

| Campo | Uso |
|-------|-----|
| `pieces` | Ids de las piezas involucradas (mismos ids que `AssemblySequencePiece.id`). |
| `type` | `gap` (huecos), `overlap` (se atraviesan), `unsupported` (sin apoyo, "en el aire"). |
| `measure_mm` | Magnitud, para ordenar por severidad y mostrar. |
| `at` | Punto 3D en mundo → el front hace *fly-to* y resalta la zona en rojo. **Imprescindible**: sólo los nombres no alcanzan para apuntar el ojo. |
| `tolerance_mm` | Umbral (configurable, propiedad del backend) usado en el chequeo; se muestra al usuario. |

## Front (a implementar en Fase 2)
- Lista clickeable de advertencias (severidad desc.) que enfoca la cámara al `at` y resalta la zona.
- Badge "✓ Ensamble verificado" cuando el array viene vacío → habilita "mandar a cortar" con confianza.
- Reusar el camino de overlays 3D que ya existe (líneas/markers rojos).

## Notas
- El chequeo corre en preview (barato) y se re-emite en `generate`.
- La **tolerancia** la define el backend (idealmente configurable por material/kerf) y la echoa en cada aviso.
- La verdad sigue viviendo en `placements`/joinery; este contrato sólo **expone** lo que el backend ya sabe.
