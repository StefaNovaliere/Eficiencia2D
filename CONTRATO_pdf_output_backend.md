# Contrato backend: opciones de salida del PDF (`paper` + `page_mode`)

## Contexto
En la pre-visualización de planchas (`/nesting`) el usuario elige **tamaño de papel** y **cómo
paginar el PDF** de planchas de corte. Hay **dos modos** según `page_mode`:

- **`single_page` ("modo láser")**: la plancha es un **material físico** editable a mano
  (`sheet_config`, p.ej. 1.0×0.6 m). `paper`/`page_mode` sólo afectan cómo se imprime el PDF.
- **`one_per_sheet` ("modo cartón", default)**: cada plancha va en **su propia hoja**, y la
  **plancha coincide con el papel**. Aquí el backend **deriva la plancha del `paper`** (margen +
  auto-orientación) e **ignora** el `width_m`/`height_m` de `sheet_config`.

Por eso `paper` + `page_mode` ahora viajan **tanto en `POST /api/generate` como en
`POST /api/nesting-preview`**: en modo cartón cambian la plancha → cambian el preview en pantalla,
así que el preview debe usar la misma plancha derivada que el PDF final.

> **Distinción clave:** **plancha** (tamaño físico en metros que usa el nesting) ≠ **papel**
> (`paper`, tamaño de hoja del PDF, A4/A3…). En modo láser la plancha viene de `sheet_config`; en
> modo cartón la plancha = papel − margen. Una **única fuente de verdad** (el backend) para que el
> preview y el PDF coincidan siempre.

---

## 1. Campos en `POST /api/generate` **y** `POST /api/nesting-preview`
Ambos endpoints reciben (snake_case):

```jsonc
{
  // generate: … file_id, original_filename, scale_denom, sheet_config, overrides,
  //           wall_wall_decisions, merges, splits, marks, user_cuts …
  // nesting-preview: … file_id, axis, min_area_m2, merges, splits, overrides,
  //                  wall_wall_decisions, marks, sheet_config, scale_denom, user_cuts …
  "paper": "A4",                 // "A4" | "A3" | "A2" | "A1"  (default "A4")
  "page_mode": "one_per_sheet"   // "one_per_sheet" | "single_page"  (default "one_per_sheet")
}
```

| Campo | Tipo | Default | Significado |
|-------|------|---------|-------------|
| `paper` | `"A4" \| "A3" \| "A2" \| "A1"` | `"A4"` | Tamaño de hoja del PDF (ISO). En modo cartón, también define la plancha. |
| `page_mode` | `"one_per_sheet" \| "single_page"` | `"one_per_sheet"` | Modo cartón / modo láser (ver §2). |

> **Nuevo respecto del contrato anterior:** `paper` + `page_mode` ahora también se reciben en
> `/api/nesting-preview` (antes sólo en `/generate`), porque en modo cartón la plancha sale del
> papel y eso cambia el preview. El backend debe **aplicar la misma derivación de plancha en los
> dos endpoints**.

---

## 2. Semántica de `page_mode`
El nesting ya agrupa los paneles en **planchas** (`NestingSheet`); hoy hay un PDF por categoría
(uno de **pared**, otro de **piso**). `page_mode` controla cómo se vuelcan esas planchas a páginas
**dentro de cada PDF de categoría** (la separación pared/piso en PDFs distintos no cambia):

- **`one_per_sheet`** (default): **una plancha de corte por página**. Cada `NestingSheet` de la
  categoría ocupa su propia página del PDF, dimensionada al `paper` elegido. Si hay N planchas de
  pared, el PDF de pared tiene N páginas.
- **`single_page`**: **todas las planchas de la categoría en una sola página** (comportamiento
  actual). Las planchas se ubican una al lado de otra / apiladas en una única hoja grande.

---

## 3. Derivación de la plancha en modo cartón (`one_per_sheet`)
Cuando `page_mode = one_per_sheet`, el backend **calcula la plancha a partir del `paper`** y la usa
para el nesting (en preview **y** en generate):

- **Plancha = papel − margen** por lado. Margen de impresión sugerido **10 mm/lado** (criterio del
  backend; dejar configurable). Ej. A4 (210×297) → ~190×277 mm de área útil.
- **Auto-orientar**: probar la plancha **vertical y horizontal** y quedarse con la orientación que
  **minimiza piezas sin ubicar** (desempate: mayor aprovechamiento). El front no fuerza orientación.
- **Ignorar** `width_m`/`height_m` de `sheet_config` (puede seguir usando `gap_m`).
- **Devolver la plancha elegida en `config`** de la respuesta de `/api/nesting-preview` (ya existe
  el campo `config`), con `width_m`/`height_m` en metros y la orientación ya aplicada. El front la
  muestra de sólo lectura.
- Tamaños ISO nominales (mm): **A4** 210×297, **A3** 297×420, **A2** 420×594, **A1** 594×841.

En modo láser (`single_page`) se usa `sheet_config` tal cual (comportamiento actual) y `config` lo
refleja sin cambios.

- `scale_denom` define a qué escala se dibuja el contenido (1:`scale_denom`) en ambos modos.

---

## 4. Resumen para implementar (backend)
1. Aceptar `paper` ∈ {A4, A3, A2, A1} y `page_mode` en **`/generate` y `/nesting-preview`**.
   Defaults si faltan: `paper="A4"`, `page_mode="one_per_sheet"`.
2. `page_mode = one_per_sheet` (cartón):
   - Derivar plancha = papel − margen, auto-orientada (§3). Usarla en el nesting de **ambos**
     endpoints y devolverla en `config` (preview).
   - PDF: **una plancha por página**, cada hoja del tamaño `paper`.
3. `page_mode = single_page` (láser):
   - Nesting con `sheet_config` (como hoy). PDF: todas las planchas de la categoría en una hoja
     `paper` única (comportamiento actual).
4. La separación pared/piso en PDFs distintos no cambia. No afecta DXF.

## 5. Verificación
- **Cartón** `paper=A3`, `page_mode=one_per_sheet`: el preview (`/nesting-preview`) devuelve
  `config` ≈ A3 − margen (auto-orientada); el PDF de pared con 3 planchas → 3 páginas A3, una
  plancha por página. Cambiar `paper` a A4 cambia la plancha del preview y del PDF por igual.
- **Láser** `page_mode=single_page`: `config` = `sheet_config`; PDF de pared con 1 página, las
  planchas en esa hoja (como hoy).
- En ambos, el contenido se dibuja a `scale_denom`.
