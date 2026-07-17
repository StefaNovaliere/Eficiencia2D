# Contrato: notas de componentes y cortes (`notes`)

Prompt listo para el equipo de backend. El frontend ya implementa el modelo
cliente y la persistencia vía `PATCH /api/projects/{id}/state`.

---

## Prompt para backend

Necesitamos persistir **notas de usuario** asociadas a:
1. **Componentes** del modelo 3D (paredes, pisos, etc.), o
2. **Cortes** concretos (`user_cuts`) dentro de un componente.

Mismo patrón que `user_cuts` / `marks`.

### Contexto del dominio

- Cada componente de la topología tiene un `group_id` numérico estable (≥ 0)
  que viene del pipeline (`Phase1Result.groups[].id`).
- El frontend a veces muestra piezas derivadas de cortes con **ids negativos**;
  las notas **NUNCA** deben guardarse contra esos ids. Siempre usar el
  `group_id` padre (el del backend).
- Un corte de usuario (`user_cuts[].id`, string) vive siempre sobre un
  `group_id` padre. Si la nota es del corte, se guarda `cut_id` además de
  `group_id`. Si es del componente, **no** se envía `cut_id`.
- Las notas son metadatos de trabajo del usuario (ej. “pintar de amarillo”,
  “marco de ventana”). No afectan geometría ni nesting.

### Campo en `estado.json` / PATCH state

Agregar al documento de estado del proyecto:

```json
{
  "notes": [
    {
      "id": "note-1710000000-abc123",
      "group_id": 12,
      "text": "Pintar esta pared de amarillo",
      "created_at": "2026-07-12T20:00:00.000Z",
      "updated_at": "2026-07-12T20:05:00.000Z"
    },
    {
      "id": "note-1710000000-def456",
      "group_id": 12,
      "cut_id": "cut-1710000000-xyz",
      "text": "Marco de ventana — perfil 50×50",
      "created_at": "2026-07-12T20:10:00.000Z",
      "updated_at": "2026-07-12T20:10:00.000Z"
    }
  ]
}
```

### Contrato de cada nota

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `id` | string | sí | Id único generado por el front (o el back si crea notas). |
| `group_id` | int | sí | Id de grupo de topología (padre, ≥ 0). |
| `cut_id` | string | no | Si está, la nota pertenece a ese corte (`user_cuts[].id`), no al componente. |
| `component_id` | int | no | Id del componente de display (puede ser negativo si es pieza derivada). Sin esto y sin `cut_id`, la nota es del `group_id` padre. |
| `text` | string | sí | Contenido (1–2000 chars recomendado). Trim; no vacío. |
| `created_at` | string ISO8601 | no | Si falta, el back puede setearlo al guardar. |
| `updated_at` | string ISO8601 | no | Actualizar en cada edición. |

### Endpoints

1. **`PATCH /api/projects/{proyecto_id}/state`** (ya existe)
   - Aceptar `notes` en el body parcial (merge shallow como el resto del estado).
   - Validar: array; cada item con `group_id` int y `text` string no vacío.
   - `cut_id` opcional (string). Si viene, persistirlo; si no, nota de componente.
   - Persistirlo en `estado.json` en R2 junto al resto.
   - Respuesta: devolver `estado` completo incluyendo `notes`.

2. **`GET /api/projects/{proyecto_id}/state`** (o el GET de detalle/open que ya
   restaura estado)
   - Incluir `notes` al devolver el estado guardado (con `cut_id` si aplica).

3. **Opcional (fase 2):** CRUD dedicado
   - `GET /api/projects/{id}/notes`
   - `POST /api/projects/{id}/notes` `{ group_id, text, cut_id? }`
   - `PATCH /api/projects/{id}/notes/{note_id}` `{ text }`
   - `DELETE /api/projects/{id}/notes/{note_id}`
   - Auth: dueño del proyecto o admin.
   - Por ahora **no es necesario**: el front manda el array completo en el
     PATCH de estado (igual que `user_cuts`).

### Auth

- Mismos permisos que el resto del estado del proyecto: JWT Bearer, solo el
  dueño (o admin).

### Validaciones sugeridas

- `text` max 2000 caracteres.
- `group_id` debe existir en la topología actual **o** aceptarse igual (el
  front puede tener notas huérfanas tras un recompute/merge; no fallar el
  PATCH entero — guardar igual).
- `cut_id` si viene: string no vacío; no exigir que exista en `user_cuts`
  (el front limpia notas al borrar cortes; puede haber huérfanas breves).
- Al hacer merge/split de grupos en recompute: **no borrar notas
  automáticamente** en v1; el front decide. (Fase 2: remapear `group_id`.)

### Qué NO hacer

- No confundir con `marks` (aberturas grabadas = lista de group ids).
- No confundir con `mark_lines` (polilíneas rojas UV para grabar en DXF).
- No exigir `notes` en `/api/generate` ni nesting en v1 (opcional después si
  se quieren imprimir en el PDF).
- No mezclar notas de corte y de componente: sin `cut_id` = componente;
  con `cut_id` = solo ese corte.

### Ejemplo PATCH

```http
PATCH /api/projects/{uuid}/state
Authorization: Bearer <token>
Content-Type: application/json

{
  "notes": [
    {
      "id": "note-1",
      "group_id": 5,
      "text": "Pintar de amarillo",
      "created_at": "2026-07-12T20:00:00.000Z",
      "updated_at": "2026-07-12T20:00:00.000Z"
    },
    {
      "id": "note-2",
      "group_id": 5,
      "cut_id": "cut-abc",
      "text": "Marco de ventana",
      "created_at": "2026-07-12T20:00:00.000Z",
      "updated_at": "2026-07-12T20:00:00.000Z"
    }
  ]
}
```

### Respuesta esperada (igual que hoy)

```json
{
  "proyecto_id": "...",
  "nombre": "...",
  "estado_r2": "...",
  "estado_actualizado_at": "...",
  "estado": { "...campos existentes...", "notes": [ ... ] },
  "message": "Estado actualizado"
}
```

### Checklist backend

- [ ] Extender schema / modelo de `estado.json` con `notes: list[Note]`
- [ ] Aceptar `cut_id` opcional en cada nota
- [ ] Validar y mergear `notes` en PATCH state
- [ ] Devolver `notes` (con `cut_id`) en GET state / open project restore
- [ ] Tests: crear, editar (reemplazo de array), vaciar `notes: []`, nota con/sin `cut_id`
- [ ] (Opcional) CRUD REST dedicado
