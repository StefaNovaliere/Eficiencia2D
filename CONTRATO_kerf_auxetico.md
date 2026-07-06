# Contrato backend: superficies curvas — kerf bending + patrones auxéticos

> ⚠️ **KERF actualizado en `CONTRATO_kerf_bending_v2.md`**: el kerf **NO es un vector de corte / score**,
> sino la **remoción de ranuras rectangulares (huecos)** en peine interdigitado (living hinge). Para la
> parte kerf, seguir la v2; este documento queda vigente para el flujo general y los auxéticos.

## Principio
Para paredes/superficies **curvas** no alcanza con exportar un panel plano: hay que cortar un
**patrón** en la plancha para que pueda doblarse físicamente.
- **Kerf bending**: filas de ranuras paralelas interrumpidas → flexión en **un** eje. La
  **distancia entre columnas** fija el radio.
- **Patrones auxéticos** (celdas con ligamentos, Poisson negativo) → flexión en **varias**
  direcciones (cúpulas, geometrías tipo Zaha Hadid). La **distancia entre ligamentos** fija la densidad.

División de trabajo (igual que `CONTRATO_user_cuts_backend.md`):
- El **FRONT** deja elegir, por componente (grupo), el método y sus parámetros, y dibuja un
  **preview ESQUEMÁTICO no autoritativo** en el visor 3D. Envía esos specs.
- El **BACKEND** desarrolla la superficie curva a plano y genera la **geometría real** del patrón
  (ranuras/celdas) en el DXF/PDF y en el `nesting-preview`. Es la fuente de verdad.

Auth: JWT Bearer. JSON snake_case (el front ya normaliza).

---

## 1. Dónde llega `flex`
Mismo formato en ambos endpoints, un objeto **por grupo** (`GeometryGroup.id`):

- **`POST /api/nesting-preview`** → previsualizar las planchas con el patrón ya aplicado.
- **`POST /api/generate`** → geometría autoritativa del ZIP (DXF/PDF).

```jsonc
"flex": [
  {
    "group_id": 12,
    "method": "kerf",          // "kerf" | "auxetic_rotating" | "auxetic_reentrant" | "auxetic_chiral"
    "spacing_m": 0.008,        // distancia entre columnas (kerf) o entre ligamentos / pitch (auxético)
    "ligament_m": 0.003,       // opcional: ancho del puente/ligamento sin cortar
    "kerf_width_m": 0.0015,    // opcional: ancho de ranura (kerf); si falta, usar el del material
    "axis_deg": 0              // opcional: orientación del doblez (dirección de las columnas kerf)
  }
]
```

| Campo | Tipo | Significado |
|-------|------|-------------|
| `group_id` | number | `GeometryGroup.id` al que se aplica el patrón. |
| `method` | enum | `kerf` \| `auxetic_rotating` (cuadrados rotatorios) \| `auxetic_reentrant` (re-entrante/honeycomb) \| `auxetic_chiral` (quiral). |
| `spacing_m` | number (m) | Kerf: separación entre columnas de ranuras. Auxético: pitch de celda / separación de ligamentos. Rango sugerido 0.005–0.05. |
| `ligament_m` | number? (m) | Ancho del ligamento/puente que queda sin cortar. |
| `kerf_width_m` | number? (m) | Ancho de la ranura de corte (kerf). |
| `axis_deg` | number? | Orientación del doblez en el marco del panel (0 = columnas verticales). |

> Un `flex` por grupo. Si el grupo también tiene `user_cuts`/`marks`, se combinan (el patrón se aplica
> al panel resultante).

---

## 2. Qué debe hacer el backend

### 2.1 Detección/medición de curvatura (metadata para el front)
El back tiene la malla y hace el agrupado; el front no. Devolver, por grupo **no descartado**, en
`topology` de `POST /api/upload` y `/api/recompute` (camelizado en el front):

```jsonc
"curvature": {
  "<group_id>": {
    "curved": true,
    "kind": "single" | "double",       // simple (desarrollable) o doble curvatura
    "bend_radius_m": 0.45,             // radio estimado (si aplica)
    "principal_dir": { "x":.., "y":.., "z":.. }  // dirección de máxima curvatura (para orientar kerf)
  }
}
```
El front lo usa para **marcar** componentes curvos y **sugerir** método (kerf si `single`, auxético si
`double`) y un `spacing` inicial. No es obligatorio para cortar, pero mejora la UX.

### 2.2 Desarrollo de superficie (unroll / flatten)
- **Curvatura simple (desarrollable)** → desplegar la superficie a un plano (unroll) preservando
  longitudes; el patrón **kerf** se corta sobre ese plano.
- **Doble curvatura (no desarrollable)** → aplanar de forma aproximada (p. ej. ARAP/LSCM); el patrón
  **auxético** absorbe la diferencia al expandirse. Documentar el criterio elegido.

### 2.3 Geometría del patrón (autoritativa)
Sobre el panel plano desarrollado, generar el corte real parametrizado por el spec:
- **kerf**: filas de ranuras paralelas **interrumpidas** (puentes de `ligament_m`), separadas por
  `spacing_m`, orientadas por `axis_deg`, ancho `kerf_width_m` (o el del material). Patrón alternado
  (brick) para mantener integridad.
- **auxetic_rotating / reentrant / chiral**: teselar la celda correspondiente con pitch `spacing_m` y
  ligamentos `ligament_m`. **La geometría exacta de cada patrón la define el backend**; el front sólo
  nombra el método y pasa los parámetros.
- Descartar/《clampear》 valores degenerados; respetar mínimos de material.

### 2.4 Salida
- **`nesting-preview`**: el/los `NestingPanel` del grupo reflejan el panel **desarrollado + patrón**
  (contorno y ranuras/celdas en `edges`), para que el front lo dibuje. El panel puede ser mayor que el
  plano ingenuo (unroll) → **nestear** ese tamaño real.
- **`generate` (DXF/PDF)**: ranuras/celdas en la **capa de corte**; si hubiera líneas de score, en la
  capa de marca. Incluir el patrón en el plano de corte y en el conteo de planchas.

### 2.5 (Opcional) Espaciado recomendado
A partir de `bend_radius_m` + espesor de material, sugerir `spacing_m` (y devolverlo en la metadata de
curvatura) para pre-cargar el control del front.

---

## 3. Implementación en el FRONT (ya hecha, referencia)
- Tipos + specs por grupo: `src/core/flex-bending.ts` (`FlexSpec`, `serializeFlexForApi`,
  `flexPatternSegments2D` = preview esquemático).
- Preview 3D no autoritativo: `src/core/flex-preview.ts` (`computeFlexPreview3D`) dibujado en cian por
  `ModelViewer` (mismo camino que las marcas rojas).
- Selección + parámetros: `FlexControls` en la pestaña "Selección" de `ReviewScreen` (un componente
  seleccionado → método + espaciado).
- Estado: `ProjectContext.savedFlex`. Envío: campo `flex` en `nesting-preview` y `generate`
  (`flexForApi`). **Reservado/no-op** hasta que el back lo procese (como fue `user_cuts`).

---

## 4. Errores y verificación
- `flex` con `group_id` inexistente o descartado → ignorar ese ítem.
- `spacing_m` fuera de rango → clampear a límites de material.
- Verificación de aceptación:
  1. Enviar `flex:[{group_id, method:"kerf", spacing_m:0.008}]` → `nesting-preview` devuelve el panel de
     ese grupo con filas de ranuras y tamaño desarrollado; menor `spacing_m` ⇒ más ranuras.
  2. `generate` produce el DXF con las ranuras en capa de corte, en el lugar del componente.
  3. Un método auxético sobre un grupo de doble curvatura → celdas teseladas; el panel plano cierra.
  4. Sin `flex`, el comportamiento actual no cambia.
