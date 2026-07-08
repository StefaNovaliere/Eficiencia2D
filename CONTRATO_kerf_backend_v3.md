# Contrato backend v3: kerf — inclinación del panel, registro del patrón y dirección

Complementa `CONTRATO_kerf_bending_v2.md` (kerf = remoción de ranuras rectangulares).
Reporta 3 problemas observados en producción sobre la pieza **A3** y agrega el campo **dirección**.

## Problema 1 — aplicar kerf INCLINA / ROTA el panel  (BUG)
Sin kerf, A3 sale como un rectángulo recto en el nesting. Con kerf, A3 aparece **rotado/inclinado**
(silueta y ejes girados) además de las ranuras.

- **Esperado**: aplicar el patrón **NO debe cambiar la orientación ni la silueta** del panel. El
  desarrollo/proyección a plano debe ser **idéntico** con y sin kerf; el patrón se corta **dentro** del
  marco del panel ya desarrollado, sin re-rotarlo.
- Si el desarrollo alinea el panel a la dirección del kerf, hacerlo **sin** rotar el resultado final
  (o compensar la rotación para que la silueta nesteada coincida con la del panel sin kerf).

## Problema 2 — registro / márgenes: el patrón no respeta la distancia a los bordes
Hoy las ranuras se recortan al material real (bien), pero **no registran** contra los bordes: una
**columna vacía puede arrancar justo en el borde** del componente (en vez de arrancar con material), y
una ranura puede caer sobre una zona previamente vacía.

- **Arrancar y terminar SÓLIDO**: dejar un **margen de material** en los bordes del área a plegar; la
  primera y la última columna deben ser **sólidas** (diente/ligamento), nunca un hueco al ras del borde.
  Margen sugerido ≥ `ligament_m` (o ≥ ~1 diente). Idealmente centrar/registrar el patrón para que sobre
  material simétrico en ambos extremos.
- **No modificar la silueta exterior**: ninguna ranura puede tocar/atravesar el contorno exterior ni una
  abertura preexistente de modo que cambie la forma del panel. Si una ranura caería sobre una abertura o
  sin material suficiente al borde, **omitirla o correrla**, manteniendo el contorno intacto.

> Regla: el kerf agrega HUECOS internos; el **contorno exterior** (y las aberturas) del panel debe quedar
> igual que sin kerf, sólo que ahora con las ranuras internas y con material en los bordes.

## Problema 3 — dirección del kerf elegida por el usuario  (nuevo campo)
El usuario ahora elige la **dirección** (eje de plegado / orientación de las columnas). El FE ya la manda:

```jsonc
{
  "group_id": 14,
  "method": "kerf",
  "spacing_m": 0.003,
  "ligament_m": 0.0015,
  "kerf_width_m": 0.0015,
  "direction": "vertical",   // "horizontal" | "vertical"  ← elegido por el usuario
  "axis_deg": 90             // derivado: horizontal→0, vertical→90 (compat)
}
```

- **`direction`** es la fuente de verdad. `axis_deg` viaja derivado por compatibilidad (0 = horizontal,
  90 = vertical). Usar una u otra, pero **honrar la elección del usuario**; no imponer una dirección propia.
- `"vertical"` ⇒ columnas verticales (pliega alrededor de un eje vertical). `"horizontal"` ⇒ columnas
  horizontales (pliega alrededor de un eje horizontal). Se interpreta en el **marco del panel** (u/v).
- Al cambiar la dirección, cambia sólo la orientación de las ranuras; la silueta del panel no se rota
  (ver Problema 1).

## Qué hace el FRONT (ya implementado, referencia)
- UI: toggle **Vertical / Horizontal** en `FlexControls` (sólo kerf); se envía `direction` (+ `axis_deg`
  derivado) en `flex[]` de `nesting-preview` y `generate`.
- Preview 3D esquemático (`kerfSegments`): orienta las ranuras según `direction` y deja **margen sólido**
  en los bordes (para comunicar el registro correcto). Es NO autoritativo.

## Verificación de aceptación
1. Aplicar kerf a A3 con `direction:"vertical"` → en `nesting-preview`, A3 conserva **la misma silueta y
   orientación** que sin kerf (no se inclina), con ranuras verticales internas y **material en los bordes**.
2. Cambiar a `"horizontal"` → mismas ranuras pero horizontales; silueta intacta.
3. En una pieza con abertura, ninguna ranura toca el contorno ni la abertura; el contorno exterior es
   idéntico al de la pieza sin kerf.
4. La primera/última columna del patrón es sólida (no hay hueco pegado al borde).
