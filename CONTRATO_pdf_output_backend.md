# Contrato backend: opciones de salida del PDF (`paper` + `page_mode`)

## Contexto
En la pre-visualización de planchas (`/nesting`) el usuario ahora elige **tamaño de papel** y
**cómo paginar el PDF** de planchas de corte. Son opciones de **salida PDF**: no cambian el
nesting ni el preview en pantalla, sólo cómo se arma el PDF final. El front las manda en
`POST /api/generate`. (No viajan en `/api/nesting-preview`.)

> **Distinción clave:** **plancha** (`sheet_config`, material físico en metros, p.ej. 1.0×0.6 m,
> usada por el nesting) ≠ **papel** (`paper`, tamaño de hoja del PDF, A4/A3…). Son cosas
> distintas: el nesting reparte los paneles en planchas físicas; `paper`/`page_mode` sólo definen
> cómo se imprimen esas planchas en el PDF.

---

## 1. Campos en `POST /api/generate`
El body ya existente suma dos campos (snake_case):

```jsonc
{
  // … file_id, original_filename, scale_denom, sheet_config, overrides,
  //    wall_wall_decisions, merges, splits, marks, user_cuts …
  "paper": "A4",                 // "A4" | "A3" | "A2" | "A1"  (default "A4")
  "page_mode": "one_per_sheet"   // "one_per_sheet" | "single_page"  (default "one_per_sheet")
}
```

| Campo | Tipo | Default | Significado |
|-------|------|---------|-------------|
| `paper` | `"A4" \| "A3" \| "A2" \| "A1"` | `"A4"` | Tamaño de hoja del PDF (ISO). |
| `page_mode` | `"one_per_sheet" \| "single_page"` | `"one_per_sheet"` | Cómo se reparten las planchas en páginas. |

> `paper` ya se enviaba; antes no había selector y quedaba fijo en "A4". Ahora el usuario lo elige.
> `page_mode` es **nuevo**: hay que implementarlo.

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

## 3. Relación con `paper`, `scale_denom` y `sheet_config`
- `sheet_config` (metros) define el tamaño físico de cada plancha; el nesting decide cuántas
  planchas hacen falta. **No cambia** por `paper`/`page_mode`.
- `scale_denom` define a qué escala se dibuja el contenido (1:`scale_denom`).
- `paper` define el tamaño de la **hoja del PDF**.
- `page_mode` define cómo se reparten las planchas en páginas de ese tamaño:
  - En `one_per_sheet`: cada plancha entra en una hoja `paper`. Si a `scale_denom` una plancha no
    entra en la hoja `paper`, el backend decide (sugerido): auto-orientar (landscape/portrait) y,
    si aún no entra, escalar-para-encajar **sólo la presentación del PDF** o avisar — criterio del
    backend; el front ya advierte por separado si una pieza no entra en la plancha física.
  - En `single_page`: todas las planchas en una hoja `paper` única (como hoy).

---

## 4. Resumen para implementar (backend)
1. Aceptar `paper` ∈ {A4, A3, A2, A1} y respetarlo como tamaño de página del PDF.
2. Aceptar `page_mode`:
   - `one_per_sheet` → una página por `NestingSheet`.
   - `single_page` → todas las planchas de la categoría en una página (comportamiento actual).
3. Defaults si faltan: `paper="A4"`, `page_mode="one_per_sheet"`.
4. No afecta DXF ni nesting ni `/api/nesting-preview`; sólo el armado del/los PDF.

## 5. Verificación
- `paper=A3`, `page_mode=one_per_sheet`, modelo con 3 planchas de pared → PDF de pared con 3
  páginas A3, una plancha por página.
- `page_mode=single_page` → PDF de pared con 1 página, las 3 planchas en esa hoja (como hoy).
- Cambiar `paper` cambia el tamaño de hoja; el contenido se dibuja a `scale_denom`.
