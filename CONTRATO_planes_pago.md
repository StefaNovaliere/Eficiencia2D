# Contrato backend: planes de pago y suscripciones

## Principio
El **front** ya tiene toda la lógica de planes: catálogo, estado de suscripción del usuario,
selección/cambio, cancelación y el punto de entrada al checkout. Hoy funciona con **datos
inventados** (mock en `src/services/planes.ts` + `localStorage`) porque el backend todavía no
expone estos recursos. Este documento define lo que el **backend** debe implementar para que el
front deje de usar el fallback **sin cambiar la UI**.

- Auth: JWT `Authorization: Bearer <token>` (igual que `/api/users/me`).
- Todo el JSON del backend es **snake_case**; el front ya normaliza (`normalizePlan`,
  `normalizeSuscripcion`) y tolera variantes (`plan`, `recomendado`, `current_period_end`, etc.).
- El front trata cualquier `404`/no-2xx/red como "endpoint no disponible" y degrada al fallback
  local; en cuanto los endpoints respondan `200`, se conecta solo.

---

## 1. Modelo de datos

### Tabla `planes`
| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | string (uuid o slug) | Id estable; el front lo usa como clave. |
| `slug` | string | `gratis` / `pro` / `estudio` / … |
| `nombre` | string | Nombre visible. |
| `precio_mensual` | number | En la moneda dada. `0` = gratis. |
| `moneda` | string | ISO, p.ej. `ARS`. |
| `periodo` | `"mes" \| "año"` | Ciclo de facturación. |
| `descripcion` | string | Una línea. |
| `features` | string[] (jsonb) | Bullets de la tarjeta. |
| `destacado` | bool | Marca "Recomendado". |
| `activo` | bool | Sólo se listan los activos. |
| `orden` | int | Orden de aparición ascendente. |

### Suscripción por usuario (tabla `suscripciones` o campos en `usuarios`)
| Campo | Tipo | Notas |
|-------|------|-------|
| `user_id` | fk | Dueño. |
| `plan_id` | fk → `planes.id` | Plan vigente (null si ninguno). |
| `estado` | `activa \| pendiente \| cancelada` | Ver §4. El front mapea ausencia a `ninguna`. |
| `proveedor` | string | p.ej. `mercadopago`. |
| `proveedor_ref` | string | Id de la preapproval/suscripción del proveedor. |
| `periodo_inicio` | datetime | |
| `periodo_fin` | datetime | Fin del período vigente (renovación o baja). |
| `cancela_al_fin` | bool | Si true, no renueva. |

---

## 2. Endpoints

### `GET /api/planes` — catálogo público
Lista de planes `activos`, ordenados por `orden`. No requiere auth.
```jsonc
[
  { "id":"gratis","slug":"gratis","nombre":"Gratis","precio_mensual":0,"moneda":"ARS",
    "periodo":"mes","descripcion":"Para probar la herramienta.",
    "features":["1 proyecto activo","Visor 3D y revisión","Exporta con marca de agua"],
    "destacado":false,"orden":1 },
  { "id":"pro","slug":"pro","nombre":"Pro","precio_mensual":8000,"moneda":"ARS",
    "periodo":"mes","descripcion":"Para uso profesional.",
    "features":["Proyectos ilimitados","Exporta sin marca de agua","Instructivo de armado","Soporte prioritario"],
    "destacado":true,"orden":2 },
  { "id":"estudio","slug":"estudio","nombre":"Estudio","precio_mensual":20000,"moneda":"ARS",
    "periodo":"mes","descripcion":"Para equipos y estudios.",
    "features":["Todo lo de Pro","Múltiples usuarios","Prioridad de cómputo","Facturación por equipo"],
    "destacado":false,"orden":3 }
]
```
> Los valores de arriba son los que hoy usa el front como mock (`MOCK_PLANES`); sirven como semilla
> de la tabla. Se acepta también `{ "planes": [...] }` / `{ "items": [...] }` / `{ "data": [...] }`.

### `GET /api/users/me/suscripcion` — estado del usuario
```jsonc
{ "plan_id":"pro", "estado":"activa", "periodo_fin":"2026-08-01T00:00:00Z", "cancela_al_fin":false }
```
- Sin suscripción: `{ "plan_id": null, "estado": "ninguna", "periodo_fin": null }` (o `404`, que el
  front interpreta como "sin plan").

### `POST /api/users/me/suscripcion` — elegir / cambiar plan
Request: `{ "plan_id": "pro" }`

Dos respuestas posibles según el plan:
- **Plan gratis (o cambio inmediato sin cobro):** activar y devolver la suscripción.
  ```jsonc
  { "plan_id":"gratis","estado":"activa","periodo_fin":null }
  ```
- **Plan pago:** crear el checkout recurrente en el proveedor y devolver la URL para pagar.
  ```jsonc
  { "checkout_url":"https://www.mercadopago.com/.../checkout/..." }
  ```
  (También se acepta `init_point` o `preference_id`; con `checkout_url`/`init_point` el front
  redirige solo.) La suscripción queda en `pendiente` hasta que el webhook confirme el pago (§3).

### `DELETE /api/users/me/suscripcion` — cancelar
Cancela al **fin del período** (no corta el acceso ya pagado). Devuelve la suscripción resultante:
```jsonc
{ "plan_id":"pro","estado":"activa","periodo_fin":"2026-08-01T00:00:00Z","cancela_al_fin":true }
```

---

## 3. Pago (MercadoPago) — suscripción recurrente
Reutilizar el patrón server-side de `src/app/api/mp/*` (hoy `preference` para pago único), pero para
suscripciones conviene **preapproval** (débito recurrente):

1. En `POST /api/users/me/suscripcion` con plan pago, crear una **preapproval** con el monto/período
   del plan y `back_url` → `${origin}/payment-callback?sub=1`. Guardar `proveedor_ref` y dejar la
   suscripción en `estado:"pendiente"`. Devolver `{ "checkout_url": <init_point> }`.
2. **Webhook** de MercadoPago (fuente de verdad): al aprobarse/renovarse, pasar a `activa` y setear
   `periodo_inicio/periodo_fin`; ante `cancelled`/`paused`/impago, pasar a `cancelada` (o `pendiente`).
   El webhook —no el front— define el estado final.
3. Al volver del checkout, el front sólo **re-consulta** `GET /api/users/me/suscripcion`
   (`SubscriptionContext.refresh()`); no confía en query params.

> El flujo de pago **por proyecto** actual (`/api/mp/preference` + `/api/mp/verify` +
> `/payment-callback`) es independiente y no se toca.

---

## 4. Estados y transiciones
- `ninguna` — sin suscripción (o sólo plan gratis, a criterio del backend).
- `pendiente` — checkout creado, esperando confirmación del proveedor.
- `activa` — pago confirmado; `periodo_fin` marca la próxima renovación.
- `cancelada` — dada de baja; si `cancela_al_fin` sigue `activa` hasta `periodo_fin` y luego pasa a
  `cancelada`/`ninguna`.

## 5. Errores
- `401` — token inválido/ausente.
- `404` — endpoint aún no implementado (el front degrada a local) o plan inexistente.
- `409` — ya suscripto al mismo plan / operación no válida para el estado actual.
- Cuerpo de error: `{ "detail": "..." }` o `{ "message": "..." }` (el front ya lo parsea).

## 6. Verificación de aceptación
1. `GET /api/planes` devuelve los planes activos ordenados → el front los muestra en
   `/settings` (debajo de "Mi cuenta") sin el aviso de "guardado en este dispositivo".
2. Elegir el plan **gratis** → `POST` responde la suscripción `activa`; recargar mantiene el plan
   (vía `GET`), sin usar `localStorage`.
3. Elegir un plan **pago** → `POST` responde `checkout_url`; el front redirige; tras pagar y volver,
   `GET` refleja `activa` con `periodo_fin`.
4. Cancelar → `DELETE` responde `cancela_al_fin:true`; el front muestra "finaliza el …".
5. Con el backend caído, el front sigue funcionando con mock + `localStorage` (degradación sin romper).
