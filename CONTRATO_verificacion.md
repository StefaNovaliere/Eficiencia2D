# Contrato backend → front: verificación de la maqueta

Estado del backend: implementado y con tests (`test_verificacion.py`, `test_corpus.py`).
Nada de lo que sigue rompe al front actual: todos los campos son nuevos u opcionales.

## Para qué

Hoy el instructivo muestra una lista de 160 "problemas de ensamble" que salen de un chequeo
sobre el **modelo** ("Sin apoyo A211, 15,01 m"). No es accionable y contradice al chequeo
de las piezas que se cortan.

El backend ahora entrega **un solo veredicto**, calculado sobre las piezas tal como van a la
plancha, midiendo cada unión de forma exacta. La pantalla tiene que pasar de "lista de
alertas" a:

1. Un titular: `287 de 295 piezas verificadas · 8 para revisar`.
2. Las piezas pintadas por estado en el visor 3D.
3. Una lista corta de **problemas agrupados**, cada uno con sus botones de acción.

---

## 1. Dónde llega

`POST /nesting-preview` → clave nueva `verificacion` en la respuesta.

- Es un objeto (ver §2) o `null`.
- `null` significa **"no se pudo verificar"**. No es lo mismo que "verificado": mostrarlo
  como estado gris, nunca como verde.
- Depende de la escala. Hay que volver a pedirlo cuando cambia `scale_denom`, una fusión,
  un descarte o una decisión de quién cede.

`assembly_warnings` e `interferencias` siguen viniendo por compatibilidad. **El instructivo
debe dejar de mostrarlos** y usar `verificacion`.

---

## 2. Forma de `verificacion`

```jsonc
{
  "version": 1,
  "escala": 100.0,
  "espesor_placa_mm": 3.0,
  "tolerancias_mm": { "ok": 0.2, "revisar": 0.75 },

  "veredicto": "no_arma",            // "listo" | "revisar" | "no_arma"

  "resumen": {
    "piezas": 32, "piezas_ok": 9, "piezas_revisar": 13, "piezas_no_arma": 10,
    "uniones": 80, "uniones_ok": 49, "uniones_revisar": 24, "uniones_no_arma": 7,
    "problemas": 23
  },

  "piezas":    { "A11": { ... } },   // §2.1  una entrada por pieza
  "problemas": [ { ... } ],          // §2.2  lo que se le muestra a la persona
  "uniones":   [ { ... } ]           // §2.3  todas las uniones medidas, incluidas las ok
}
```

### Estados

| Valor | Significado | Color sugerido |
|---|---|---|
| `ok` | Desvío ≤ 0.2 mm de plancha (ruido de corte) | verde |
| `revisar` | Entre 0.2 y 0.75 mm, o un defecto que arma pero se ve | amarillo |
| `no_arma` | Más de 0.75 mm: las piezas se pisan o no se tocan | rojo |

`veredicto` es el peor estado entre los problemas; `listo` si no hay ninguno.

### 2.1 `piezas`

Clave: etiqueta de la pieza (`"A11"`, `"B2"`), la misma que `panel_id` en `placements`.

```json
"A11": { "grupo": 179, "categoria": "wall", "estado": "no_arma", "uniones": 7, "problemas": 4 }
```

- `grupo` es el id de grupo: la clave de `placements` (como string) y de `groups[].id`.
  Con eso se pinta la malla correcta.
- `estado` es el peor de sus uniones.
- Un grupo que no aparece acá no tiene pieza propia a esta escala: está en
  `absorbed_groups` (se corta dentro de otra) o descartado. No pintarlo.

### 2.2 `problemas`

Ya vienen **agrupados y ordenados** (primero `no_arma`, después por cantidad). Es la lista
que se muestra, tal cual.

```json
{
  "id": 2,
  "tipo": "superpuestas",
  "estado": "no_arma",
  "titulo": "A11 y A22 están montadas una sobre otra (1.4 mm)",
  "detalle": "Son dos piezas paralelas que en el modelo están más cerca que el espesor de la placa: físicamente no hay lugar para las dos. En el edificio son 14 cm.",
  "cantidad": 1,
  "peor_mm": 1.45,
  "peor_cm_edificio": 14.5,
  "piezas": ["A11", "A22"],
  "pieza_comun": null,
  "punto": { "x": 1.1304, "y": 2.0932, "z": 3.1038 },
  "uniones": [50],
  "acciones": [
    { "tipo": "fusionar",  "etiqueta": "Cortarlas como una sola pieza (A11 + A22)",
      "aplicar": { "merges": [[179, 211]] } },
    { "tipo": "descartar", "etiqueta": "No cortar A22",
      "aplicar": { "overrides": { "211": "discard" } } },
    { "tipo": "escala_mas_fina", "etiqueta": "Probar una escala más fina (la placa ocupa menos edificio)", "aplicar": null },
    { "tipo": "revisar_modelo",  "etiqueta": "Corregir el modelo 3D en esta zona", "aplicar": null }
  ]
}
```

Un problema agrupado (varias uniones contra una misma pieza):

```json
{ "id": 0, "tipo": "luz", "estado": "no_arma",
  "titulo": "A7: 3 piezas no llegan a tocarla (hasta 2.2 mm)",
  "cantidad": 3, "pieza_comun": "A7", "piezas": ["A3", "A7", "A4", "A18"], "uniones": [9, 15, 33], ... }
```

| Campo | Uso |
|---|---|
| `titulo`, `detalle` | Texto listo para mostrar. No armar mensajes propios. |
| `tipo` | `choque`, `luz`, `sin_cubrir`, `superpuestas`, `pieza_fina`. Sirve para el ícono. |
| `peor_mm` | Milímetros de **plancha**: lo que se va a ver en la mano. |
| `peor_cm_edificio` | Lo mismo en centímetros de **edificio**: es la cifra para quien corrige el modelo. |
| `piezas` | Etiquetas involucradas. Al seleccionar el problema: aislar/resaltar éstas. |
| `pieza_comun` | Si no es `null`, la pieza contra la que chocan todas las demás. |
| `punto` | Dónde está, en el mismo espacio que `faces_packed` (Y arriba). **Llevar la cámara acá.** |
| `uniones` | Índices en `verificacion.uniones` para el detalle fino (§2.3). |
| `acciones` | Botones. Ver §3. |

Tipos:

| `tipo` | Qué pasa |
|---|---|
| `choque` | Dos piezas ocupan el mismo material. |
| `luz` | Se tocan en el modelo y cortadas quedan separadas. |
| `sin_cubrir` | Se tocan sólo de canto: queda un canto a la vista o medio apoyo en el aire. Nunca pasa de `revisar`. |
| `superpuestas` | Dos piezas paralelas montadas una sobre otra. |
| `pieza_fina` | La pieza mide menos que el espesor de la placa. Sin uniones (`uniones: []`). |

### 2.3 `uniones`

Todas las uniones medidas, también las que encajan (`tipo: "encaja"`, `estado: "ok"`).
Sirve para la vista por planta y para el detalle de un problema.

```json
{ "id": 50, "pieza_a": "A11", "pieza_b": "A22", "grupo_a": 179, "grupo_b": 211,
  "tipo": "superpuestas", "estado": "no_arma",
  "medida_mm": 1.45, "medida_cm_edificio": 14.5, "largo_m": 1.525,
  "prevista": false, "pieza_que_ajusta": "A22",
  "punto": { "x": 1.1304, "y": 2.0932, "z": 3.1038 },
  "segmento": [ { "x": ..., "y": ..., "z": ... }, { "x": ..., "y": ..., "z": ... } ] }
```

- `segmento`: los dos extremos del tramo donde ocurre, en coordenadas del mundo. Dibujarlo
  como una línea gruesa del color del estado es la forma más directa de mostrar la unión.
- `prevista`: `true` si la unión existe en el modelo. Un `choque` con `prevista: false` es
  entre dos piezas que el modelo no une.
- `pieza_que_ajusta`: la pieza que sobra o que queda corta, cuando se puede decir.

---

## 3. Acciones

Cada acción tiene `tipo`, `etiqueta` (texto del botón) y `aplicar`.

`aplicar` trae **las mismas claves que ya se mandan** a `/recompute`, `/nesting-preview` y
`/generate`. Aplicar una acción es fusionar ese objeto con el estado de la revisión y volver
a pedir `/nesting-preview`:

| Clave en `aplicar` | Cómo se fusiona con el estado del front |
|---|---|
| `merges: [[a, b]]` | Agregar el conjunto a `merges`. |
| `overrides: {"211": "discard"}` | Mezclar en `overrides` (las claves son ids de grupo como string). |
| `wall_wall_decisions_by_pair: [{group_a, group_b, yield_group_id}]` | Agregar a la lista; si ya hay una entrada para ese par, reemplazarla. |

Si `aplicar` es `null` la acción es informativa:

- `escala_mas_fina`: llevar al selector de escala.
- `revisar_modelo`: mostrar `titulo`, `peor_cm_edificio` y resaltar las piezas, para que
  quien modela sepa qué corregir. No se modifica nada automáticamente.

Después de aplicar, el problema desaparece del reporte nuevo o cambia de estado. No hay que
llevar la cuenta en el front: el reporte siguiente es la verdad.

---

## 4. Quién cede: nuevo campo `wall_wall_decisions_by_pair`

Aceptado en `/recompute`, `/nesting-preview` y `/generate`:

```json
"wall_wall_decisions_by_pair": [
  { "group_a": 179, "group_b": 245, "yield_group_id": 245 }
]
```

- Reemplaza a `wall_wall_decisions` (por índice de junta), que **se pierde** con cada
  fusión, división o cambio de escala porque el índice es posicional.
- `wall_wall_decisions` se sigue aceptando. Si llegan las dos para la misma unión, manda la
  del par.
- Migración: al elegir quién cede en una junta `j` de `wall_wall_joints`, guardar
  `{group_a: j.group_a, group_b: j.group_b, yield_group_id: elegido}` en vez de
  `{j.joint_index: elegido}`.
- Si un id se fundió en otro grupo a esa escala (`absorbed_groups`), el backend lo traduce.
- Una decisión que ya no corresponde a ninguna unión vuelve como texto en `warnings`.

---

## 5. Bloqueo al generar

`POST /generate` acepta dos campos nuevos, ambos `false` por defecto:

| Campo | Efecto |
|---|---|
| `bloquear_si_no_arma: true` | Si el veredicto es `no_arma`, **no** se generan archivos. |
| `forzar: true` | Genera igual aunque no arme. |

Respuesta cuando se bloquea — **HTTP 409**:

```json
{ "code": "ensamble_no_arma",
  "message": "La maqueta tiene uniones que no arman. Revisalas o generá igual enviando forzar=true.",
  "verificacion": { ... }   // el mismo objeto de §2
}
```

Flujo esperado:

1. El front manda siempre `bloquear_si_no_arma: true`.
2. Si responde 409: mostrar los problemas `no_arma` y dos salidas, "Revisar" y
   "Generar igual". La segunda reenvía el mismo pedido con `forzar: true`.
3. Con veredicto `revisar` no se bloquea: se genera, y conviene avisar cuántas uniones
   quedaron para mirar.

Mientras el front no mande `bloquear_si_no_arma`, `/generate` se comporta como siempre.

---

## 6. Probeta de calibración

`POST /probeta` — no necesita modelo ni `file_id`.

Pedido (todo opcional):

```json
{ "sheet_config": { "width_m": 0.12, "height_m": 0.08, "gap_m": 0.003 }, "paper": "A4" }
```

Respuesta:

```jsonc
{
  "generated_files": ["probeta_calibracion.dxf", "probeta_calibracion.pdf"],
  "zip_base64": "...",                 // mismo formato que /generate
  "zip_filename": "probeta_calibracion.zip",
  "nesting": { "sheets": [ ... ] },    // misma forma que wall_nesting: se dibuja igual
  "instrucciones": {
    "espesor_nominal_mm": 3.0,
    "anchos_mm": [2.8, 2.9, 3.0, 3.1, 3.2, 3.3, 3.4],
    "pasos": ["Cortá la probeta en la MISMA placa...", "..."],
    "lectura": "El sistema calcula hoy con placa de 3.0 mm y ranuras de 3.1 mm. ..."
  }
}
```

Son tres piezas en una plancha de 12 × 8 cm: un peine con siete muescas de 2.8 a 3.4 mm,
las mismas siete como ranuras cerradas, y un testigo de 40 mm con lengüeta.

Dónde ofrecerla: en el paso de generación, antes del botón de descarga de la maqueta
("¿Primera vez con esta placa o esta máquina? Cortá primero la probeta"). Mostrar `pasos`
y `lectura` tal cual.

**Límite actual:** el resultado de la probeta todavía no se puede cargar. El espesor y la
holgura son constantes del backend, no parámetros del pedido. Si la muesca que entra justa
no es la de 3.1 mm, hoy hay que avisar al equipo; no hay campo para mandarlo.

---

## 7. Otros campos que ya llegan y hay que usar

Agregados en esta misma tanda de cambios:

| Campo | Dónde | Qué es |
|---|---|---|
| `absorbed_groups` | `/nesting-preview`, y en `topology` de `/recompute` cuando se manda `scale_denom` | `{ "id absorbido": id del grupo que lo incluye }`. Ese grupo no tiene pieza propia a esta escala. **No dibujarlo aparte ni caer a la malla cruda**: ya está dentro del `placement` del otro. |
| `warnings` | `/nesting-preview` | Avisos de la generación a esa escala (fusiones automáticas, piezas más finas que la placa, decisiones que no se pudieron aplicar). Antes sólo llegaban los de la subida. |
| `panel_id_by_group` | `/recompute` | Ahora se calcula a la escala pedida. Las etiquetas `A#`/`B#` **cambian con la escala** porque cambia la cantidad de piezas. |

---

## 8. Qué construir, en orden

1. **Titular con el veredicto** (`resumen`) en el instructivo y en el paso de generación.
2. **Reemplazar la lista** de `assembly_warnings` por `problemas`: título, medida, y los
   botones de `acciones`.
3. **Pintar las piezas** por `piezas[etiqueta].estado`.
4. **Al tocar un problema**: cámara a `punto`, aislar `piezas`, dibujar los `segmento` de
   sus uniones.
5. **Bloqueo** en `/generate` con el flujo de §5.
6. **Probeta** en el paso de generación.
7. **Vista por planta** (opcional, la de más valor para leer rápido): un corte horizontal
   por nivel con las placas en su espesor real y cada `segmento` coloreado por estado.
   Todos los datos están en `placements` (contorno y `thickness_m`) y en `uniones`.

---

## 9. Lo que el veredicto no cubre

Para no prometer de más en la interfaz:

- Mide con el espesor **nominal** de la placa. Si el MDF real es otro, lo dice la probeta,
  no el veredicto.
- Los umbrales (0.2 y 0.75 mm) están puestos a criterio, sin calibrar contra maquetas
  cortadas.
- `sin_cubrir` aparece mucho en modelos reales. Es un aviso de terminación, no de que la
  maqueta no arme; por eso nunca pasa de amarillo.
- Un `listo` dice que las piezas encajan entre sí. No dice que el modelo 3D represente bien
  el edificio.
