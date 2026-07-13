# Contrato: notas de componentes (`notes`)

Prompt listo para el equipo de backend. El frontend ya implementa el modelo
cliente y la persistencia vía `PATCH /api/projects/{id}/state`.

---

## Prompt para backend

Necesitamos persistir **notas de usuario asociadas a componentes del modelo 3D**
(paredes, pisos, etc.) dentro del estado del proyecto en R2 (`estado.json`),
con el mismo patrón que `user_cuts` / `marks`.

### Contexto del dominio

- Cada componente de la topología tiene un `group_id` numérico estable (≥ 0)
  que viene del pipeline (`Phase1Result.groups[].id`).
- El frontend a veces muestra piezas derivadas de cortes con **ids negativos**;
  las notas **NUNCA** deben guardarse contra esos ids. Siempre usar el
  `group_id` padre (el del backend).
- Las notas son metadatos de trabajo del usuario (ej. “pintar de amarillo”,
  “reforzar esquina”). No afectan geometría ni nesting.

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
    }
  ]
}
```

### Contrato de cada nota

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `id` | string | sí | Id único generado por el front (o el back si crea notas). |
| `group_id` | int | sí | Id de grupo de topología (padre, ≥ 0). |
| `text` | string | sí | Contenido (1–2000 chars recomendado). Trim; no vacío. |
| `created_at` | string ISO8601 | no | Si falta, el back puede setearlo al guardar. |
| `updated_at` | string ISO8601 | no | Actualizar en cada edición. |

### Endpoints

1. **`PATCH /api/projects/{proyecto_id}/state`** (ya existe)
   - Aceptar `notes` en el body parcial (merge shallow como el resto del estado).
   - Validar: array; cada item con `group_id` int y `text` string no vacío.
   - Persistirlo en `estado.json` en R2 junto al resto.
   - Respuesta: devolver `estado` completo incluyendo `notes`.

2. **`GET /api/projects/{proyecto_id}/state`** (o el GET de detalle/open que ya
   restaura estado)
   - Incluir `notes` al devolver el estado guardado.

3. **Opcional (fase 2):** CRUD dedicado
   - `GET /api/projects/{id}/notes`
   - `POST /api/projects/{id}/notes` `{ group_id, text }`
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
- Al hacer merge/split de grupos en recompute: **no borrar notas
  automáticamente** en v1; el front decide. (Fase 2: remapear `group_id`.)

### Qué NO hacer

- No confundir con `marks` (aberturas grabadas = lista de group ids).
- No confundir con `mark_lines` (polilíneas rojas UV para grabar en DXF).
- No exigir `notes` en `/api/generate` ni nesting en v1 (opcional después si
  se quieren imprimir en el PDF).

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
- [ ] Validar y mergear `notes` en PATCH state
- [ ] Devolver `notes` en GET state / open project restore
- [ ] Tests: crear, editar (reemplazo de array), vaciar `notes: []`
- [ ] (Opcional) CRUD REST dedicado
