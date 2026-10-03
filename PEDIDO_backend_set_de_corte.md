# Pedido al backend — fidelidad del set de corte

Medido levantando el backend (`main` de `eficiencia2D-backend`) y el front en local, con
`demo.obj` y `Prueba app.obj`, a 1:100. Todo lo de abajo es reproducible con
`/api/upload` → `/api/recompute` (con `scale_denom`) → `/api/nesting-preview`.

## Lo que ya se verificó que está bien

- **El contorno del instructivo es el del DXF.** Para las 50 piezas de `demo.obj`, el
  `outline` de `placements` y las `edges` del panel en la plancha tienen las mismas
  aristas y el mismo perímetro (0 de 50 difieren más de 1 %).
- **El marco está en el plano medio.** `dot(origin, normal)` contra el punto medio entre
  pieles del grupo: error máximo 0,0004 mm.
- **`outline` llega en todas las piezas** de `/recompute` (con `placements_fieles: true`)
  y de `/nesting-preview`.

El front ya construye el instructivo exclusivamente desde `placements` de
`/nesting-preview`, con la placa centrada en el plano medio (el invariante de
`restricciones.py`). Lo que sigue son las dos cosas que quedan, y son del backend.

---

## 1 · Dos numeraciones para las mismas piezas

`/recompute` y `/nesting-preview` le ponen **etiquetas distintas al mismo grupo**.

| Modelo | Piezas en el corte | Misma etiqueta | Etiqueta distinta |
|---|---|---|---|
| `demo.obj` | 50 | 17 | **33** |
| `Prueba app.obj` | 403 | 207 | **196** |

La causa es que `panel_id_by_group` de la topología numera los grupos no descartados (52
en `demo.obj`), y el nesting descarta algunos (los grupos 247 y 35) y **renumera** el
resto. Desde el primer descartado, todo se corre un número:

```
grupo 26 :  topología A14  →  plancha A13
grupo 179:  topología A15  →  plancha A14
grupo 15 :  topología A16  →  plancha A15
```

**Efecto que queda hoy:** el instructivo ya usa los nombres de la plancha, pero la
pantalla de **Revisión** muestra los de la topología. El usuario ve "A14" en el visor y en
la plancha esa pieza es A13.

**Pedido:** una sola numeración. Que `panel_id_by_group` de `/recompute` (con
`scale_denom`) salga del mismo conjunto de piezas que el nesting — los grupos que el corte
va a descartar no deberían consumir número.

---

## 2 · Placas duplicadas: las dos caras de un mismo muro

Hay pares de piezas **paralelas, superpuestas y a menos de un espesor de placa** entre
sus planos medios. Físicamente no se pueden armar: son dos placas de 3 mm ocupando el
mismo material. Están en el DXF; en plano se ven como dos piezas limpias, y recién al
armar la maqueta aparecen como un muro doble.

`demo.obj`, 1:100 (placa = 30 cm de edificio):

```
A25 y A30   a 8.6 cm, superpuestas 100 %
A26 y A30   a 8.6 cm, superpuestas 100 %
A27 y A30   a 8.6 cm, superpuestas 100 %
A28 y A30   a 8.6 cm, superpuestas 100 %
A17 y A22   a 3.7 cm, superpuestas 100 %
A20 y A21   a 9.5 cm, superpuestas 100 %
A9  y A17   a 13.6 cm · A9 y A22 a 17.3 cm · A14 y A37 a 15.5 cm · A15 y A43 a 17.6 cm
```

`Prueba app.obj`: **252 pares**, muchos a **0,0 cm** (la misma superficie dos veces).

El chequeo de ensamble ya ve algunas (`Se atraviesan A25 · A30 — 0,6 mm — lo estamos
viendo`), pero las reporta como un roce de 0,6 mm cuando en realidad es una placa
entera de más.

**Pedido:** detectarlas en el pipeline. Dos opciones, de menor a mayor:

1. Un aviso propio en `assembly_warnings` (`type: "duplicada"`), con las dos piezas y la
   distancia, para que el usuario descarte una en Revisión.
2. Fusionarlas: dos pieles paralelas a menos de `espesor × scale_denom` y superpuestas
   son **una** placa, en el plano medio de las dos.

Criterio usado para la medición: `|n₁·n₂| > 0.999`, distancia entre planos medios menor
que `plate_thickness_m`, y solape del rectángulo proyectado mayor al 50 % de la menor.

---

## 3 · Bloqueos para correr en local

Para levantar el sistema en una compu sin la infraestructura de producción:

- **Subir un modelo estando logueado devuelve 503**: `/api/users/me/projects` exige R2
  (`R2_ENDPOINT_URL` y compañía) y no tiene almacenamiento local de respaldo.
- **No se puede iniciar sesión** con una cuenta nueva si no hay SMTP: queda en
  `pendiente_verificacion` y `/auth/login` devuelve 403. Hoy se destraba con
  `UPDATE usuarios SET estado='activo', email_verified_at=NOW()`.
- **`requirements.txt` trae ~3 GB que nadie importa** (`torch`, `torchvision`,
  `ultralytics`, `opencv-python`, `Flask`, `pyinstaller`) y pide `psycopg2` de fuente,
  que en Windows exige compilador. `requirements-server.txt` es el correcto.

**Pedido:** un modo desarrollo (`DEV_LOCAL=true`) que guarde los proyectos en `DATA_DIR`
y active las cuentas sin mail.
