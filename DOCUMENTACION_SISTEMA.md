# Eficiencia2D — Documentacion del Sistema

**Version:** 0.4.0
**Fecha:** Marzo 2026
**Tipo de sistema:** Aplicacion web para generacion automatica de planos arquitectonicos 2D a partir de modelos 3D.

---

## TABLA DE CONTENIDOS

1. [Introduccion](#1-introduccion)
2. [Alcance del Sistema](#2-alcance-del-sistema)
3. [Arquitectura General](#3-arquitectura-general)
4. [Componentes del Sistema](#4-componentes-del-sistema)
5. [Modelo de Datos](#5-modelo-de-datos)
6. [Flujo de Procesamiento (Pipeline)](#6-flujo-de-procesamiento-pipeline)
7. [Modulos del Frontend (TypeScript)](#7-modulos-del-frontend-typescript)
8. [Modulos del Backend (Python)](#8-modulos-del-backend-python)
9. [Formatos de Salida](#9-formatos-de-salida)
10. [Interfaz de Usuario](#10-interfaz-de-usuario)
11. [API REST (Backend)](#11-api-rest-backend)
12. [Infraestructura y Despliegue](#12-infraestructura-y-despliegue)
13. [Dependencias y Tecnologias](#13-dependencias-y-tecnologias)
14. [Estructura de Archivos](#14-estructura-de-archivos)
15. [Configuracion del Entorno](#15-configuracion-del-entorno)
16. [Pruebas](#16-pruebas)
17. [Glosario Tecnico](#17-glosario-tecnico)

---

## 1. INTRODUCCION

### 1.1 Proposito

Eficiencia2D es una herramienta web que convierte modelos 3D arquitectonicos (formato `.obj` exportado desde SketchUp u otros programas de modelado) en planos tecnicos 2D listos para fabricacion.

### 1.2 Problema que Resuelve

En el flujo de trabajo de construccion con paneles prefabricados (madera, steel frame, etc.), el arquitecto disena en 3D pero la fabrica necesita:
- **Planos de fachada** (elevaciones N/S/E/W) para visualizar el exterior.
- **Planos de planta** (cortes horizontales) para ver la distribucion interna.
- **Planchas de corte** (DXF para laser/CNC) para fabricar cada pieza individual.

Eficiencia2D automatiza toda esta conversion: sube un `.obj`, descarga un ZIP con todos los planos.

### 1.3 Usuarios Objetivo

| Rol | Uso |
|-----|-----|
| Arquitecto / Disenador | Genera planos 2D desde su modelo SketchUp |
| Taller de fabricacion | Recibe DXFs listos para corte laser/CNC |
| Ingeniero estructural | Verifica dimensiones y descomposicion de paneles |

---

## 2. ALCANCE DEL SISTEMA

### 2.1 Funcionalidades Implementadas

| # | Funcionalidad | Estado |
|---|--------------|--------|
| F1 | Carga de archivos `.obj` (drag & drop o selector) | Implementado |
| F2 | Extraccion de fachadas (N/S/E/W) con deteccion automatica de ejes | Implementado |
| F3 | Extraccion de planos de planta por nivel (corte horizontal) | Implementado |
| F4 | Descomposicion en paneles con IDs de referencia (A1, A2... B1, B2...) | Implementado |
| F5 | Generacion de planchas de corte separadas por material (paredes/pisos) | Implementado |
| F6 | Exportacion DXF con capas laser (CORTE rojo, ETIQUETAS azul, COTAS negro) | Implementado |
| F7 | Exportacion PDF multi-pagina con todas las vistas | Implementado |
| F8 | Descarga automatica como archivo ZIP | Implementado |
| F9 | Procesamiento 100% client-side (sin subir archivos al servidor) | Implementado |
| F10 | Escalas configurables (1:20 a 1:500) | Implementado |
| F11 | Tamanos de papel (A4, A3, A1) | Implementado |

### 2.2 Limitaciones Conocidas

- Solo procesa archivos `.obj` (no `.skp` directo en frontend).
- No soporta aberturas (ventanas/puertas) como huecos separados en las planchas de corte.
- El nesting de piezas es basico (shelf-packing), no es un optimizador de material avanzado.

---

## 3. ARQUITECTURA GENERAL

### 3.1 Diagrama de Arquitectura

```
+------------------------------------------------------------------+
|                        NAVEGADOR WEB                              |
|                                                                   |
|  +-------------------+     +----------------------------------+   |
|  |   UI (React/Next) |---->|   Pipeline TypeScript (client)   |   |
|  |   UploadForm.tsx   |     |                                  |   |
|  |   page.tsx         |     |  obj-parser.ts                   |   |
|  +-------------------+     |  facade-extractor.ts              |   |
|                             |  floor-plan-extractor.ts          |   |
|                             |  cutting-sheet.ts                 |   |
|                             |  dxf-writer.ts                    |   |
|                             |  pdf-writer.ts                    |   |
|                             +----------------------------------+   |
|                                           |                        |
|                                           v                        |
|                                  +----------------+                |
|                                  | ZIP (JSZip)    |                |
|                                  | -> Descarga    |                |
|                                  +----------------+                |
+------------------------------------------------------------------+

+------------------------------------------------------------------+
|                   BACKEND ALTERNATIVO (FastAPI)                    |
|                   (backend-selfhosted/)                            |
|                                                                   |
|  Docker / Railway         API REST: POST /api/upload              |
|  Python 3.12              Respuesta: ZIP con DXF + PDF            |
|  ezdxf, reportlab         Soporta .skp y .obj                     |
+------------------------------------------------------------------+
```

### 3.2 Modos de Operacion

El sistema tiene **dos modos de ejecucion independientes**:

| Modo | Tecnologia | Donde corre | Formato entrada | Despliegue |
|------|-----------|-------------|----------------|-----------|
| **Frontend (produccion)** | TypeScript + Next.js | Navegador del usuario | `.obj` | Railway (Nixpacks) |
| **Backend (self-hosted)** | Python + FastAPI | Servidor Docker | `.obj`, `.skp` | Docker / Railway |

**En produccion se usa el modo Frontend**: todo el procesamiento ocurre en el navegador. El servidor solo sirve archivos estaticos (HTML/JS/CSS). Esto significa:
- Sin limites de tamano de archivo del servidor.
- Sin latencia de red para el procesamiento.
- Privacidad total: el archivo nunca sale de la maquina del usuario.

---

## 4. COMPONENTES DEL SISTEMA

### 4.1 Mapa de Componentes

```
Eficiencia2D/
|
|-- src/                          # Frontend (TypeScript, Next.js)
|   |-- app/                      #   Paginas y rutas de Next.js
|   |   |-- page.tsx              #     Pagina principal
|   |   |-- layout.tsx            #     Layout raiz (HTML, metadata)
|   |   +-- api/health/route.ts   #     Health-check endpoint
|   |-- components/
|   |   +-- UploadForm.tsx        #   Componente principal de la UI
|   |-- core/                     #   Logica de procesamiento
|   |   |-- types.ts              #     Tipos compartidos y algebra vectorial
|   |   |-- obj-parser.ts         #     Parser de archivos .obj
|   |   |-- pipeline.ts           #     Orquestador del flujo completo
|   |   |-- facade-extractor.ts   #     Extractor de fachadas (elevaciones)
|   |   |-- floor-plan-extractor.ts #   Extractor de planos de planta
|   |   |-- cutting-sheet.ts      #     Generador de planchas de corte
|   |   |-- dxf-writer.ts         #     Escritor de archivos DXF
|   |   +-- pdf-writer.ts         #     Escritor de archivos PDF
|   +-- styles/
|       +-- globals.css           #   Estilos globales
|
|-- backend-selfhosted/           # Backend alternativo (Python)
|   |-- app/
|   |   |-- main.py               #   API FastAPI
|   |   |-- config.py             #   Configuracion
|   |   +-- core/                 #   Pipeline Python (equivalente a src/core/)
|   |       |-- types.py
|   |       |-- obj_parser.py
|   |       |-- skp_parser.py     #   Parser de .skp (usa SketchUp SDK)
|   |       |-- pipeline.py
|   |       |-- facade_extractor.py
|   |       |-- floor_plan_extractor.py
|   |       |-- plan_extractor.py #   Descomposicion de componentes
|   |       |-- cutting_sheet.py
|   |       |-- dxf_writer.py
|   |       |-- pdf_writer.py
|   |       +-- wall_extractor.py
|   |-- tests/
|   |   +-- test_api.py           #   Suite de pruebas (26 tests)
|   +-- Dockerfile
|
|-- SDK/                          #   SketchUp C SDK (legacy, solo para backend)
|-- package.json                  #   Dependencias Node.js
|-- tsconfig.json                 #   Configuracion TypeScript
|-- nixpacks.toml                 #   Build config para Railway (frontend)
|-- railway.toml                  #   Deploy config para Railway (backend)
+-- vercel.json                   #   Config alternativa para Vercel
```

---

## 5. MODELO DE DATOS

### 5.1 Tipos Geometricos Fundamentales

```
Vec3 { x, y, z }                    Punto o vector en espacio 3D
Vec2 { x, y }                       Punto en espacio 2D

Face3D {                             Cara triangular/poligonal del modelo 3D
  vertices: Vec3[]                     Vertices de la cara
  normal: Vec3                         Vector normal (perpendicular a la cara)
  innerLoops: Vec3[][]                 Huecos internos (ventanas, etc.)
  panelId?: string                     ID de grupo OBJ (nombre del componente)
}

Loop2D {                             Poligono 2D cerrado
  vertices: Vec2[]                     Vertices del contorno
  panelId?: string                     ID de panel heredado
}
```

### 5.2 Tipos de Salida

```
Facade {                             Vista de elevacion (fachada)
  label: string                        "Fachada Norte", "Fachada Sur", etc.
  direction: Vec3                      Direccion de la vista
  polygons: Loop2D[]                   Contornos proyectados en 2D
  width, height: number                Dimensiones del bounding box
}

FloorPlan {                          Plano de planta (corte horizontal)
  label: string                        "Piso 1", "Piso 2", etc.
  segments: FloorPlanSegment[]         Segmentos de linea del corte
  width, height: number                Dimensiones del bounding box
  elevation: number                    Altura del nivel de piso
}

Panel {                              Pieza individual para corte
  id: string                           "A1", "A2" (paredes), "B1", "B2" (pisos)
  category: "wall" | "floor"           Tipo de material
  widthM, heightM: number              Dimensiones reales en metros
  edges: { a: Vec2, b: Vec2 }[]       Contorno de la pieza en 2D
}

OutputFile {                         Archivo generado para descarga
  name: string                         Nombre del archivo (ej: "casa_Fachada_Norte.dxf")
  blob: Blob                           Contenido binario
}
```

### 5.3 Opciones del Pipeline

```
PipelineOptions {
  scaleDenom: number          Denominador de escala (50 = 1:50, 100 = 1:100)
  paper: string               Tamano de papel ("A4", "A3", "A1")
  includeCuttingSheet: bool   Generar planchas de corte
}
```

---

## 6. FLUJO DE PROCESAMIENTO (PIPELINE)

### 6.1 Diagrama de Flujo

```
     Archivo .obj (ArrayBuffer)
              |
              v
    +-------------------+
    |   1. OBJ Parser   |  Parsea vertices (v), caras (f), grupos (g/o)
    |   obj-parser.ts   |  Produce: Face3D[]
    +-------------------+
              |
              v
    +-------------------+
    |  2. Normalizar    |  Detecta unidades (pulgadas, cm, mm, m)
    |     Unidades      |  Escala todo a metros
    +-------------------+
              |
              v
    +-------------------+
    |  3. Detectar Eje  |  Prueba Y-up y Z-up, elige el que produce
    |     Vertical      |  mas geometria valida
    +-------------------+
              |
     +--------+--------+--------+
     |                  |        |
     v                  v        v
+-----------+   +-----------+  +----------------+
| 4. Facade |   | 5. Floor  |  | 6. Cutting     |
| Extractor |   |    Plan   |  |    Sheet       |
|           |   | Extractor |  |                |
| Filtra    |   |           |  | Agrupa por     |
| caras     |   | Detecta   |  | grupo OBJ,     |
| verticales|   | niveles   |  | clasifica      |
| Agrupa    |   | via       |  | wall/floor,    |
| por       |   | histograma|  | proyecta cara  |
| direccion |   | Corta con |  | dominante a 2D |
| N/S/E/W   |   | plano a   |  | Layout en      |
| Proyecta  |   | 1m sobre  |  | grilla         |
| a 2D      |   | cada losa |  |                |
+-----------+   +-----------+  +----------------+
     |                  |              |
     v                  v              v
+-----------+   +-----------+  +----------------+
| DXF por   |   | DXF por   |  | DXF por tipo:  |
| fachada   |   | piso      |  | - paredes.dxf  |
+-----------+   +-----------+  | - pisos.dxf    |
     |                  |      +----------------+
     +--------+---------+--------+
              |
              v
     +-------------------+
     |   PDF multi-pag   |  Una pagina por fachada + una por piso
     +-------------------+
              |
              v
     +-------------------+
     |   ZIP (JSZip)     |  Empaqueta todos los archivos
     +-------------------+
              |
              v
        Descarga .zip
```

### 6.2 Descripcion Detallada de Cada Etapa

#### Etapa 1: Parseo OBJ (`obj-parser.ts`)

Lee el archivo `.obj` linea por linea:
- `v x y z` — almacena vertices 3D.
- `f i j k ...` — construye caras poligonales con sus vertices y calcula la normal.
- `g nombre` / `o nombre` — asigna nombres de grupo (usados como `panelId` para identificar componentes individuales en las planchas de corte).

Soporta indices negativos, formatos `v/vt/vn`, y caras de N vertices (no solo triangulos).

#### Etapa 2: Normalizacion de Unidades (`pipeline.ts`)

SketchUp exporta en pulgadas por defecto. El sistema estima la unidad midiendo el bounding box:
- Span <= 100 → metros (sin conversion)
- Span <= 1000 → centimetros (x 0.01)
- Span <= 50000 → milimetros (x 0.001)
- Mayor → normaliza a ~20m de diagonal

#### Etapa 3: Deteccion del Eje Vertical (`facade-extractor.ts`)

Algunos modelos usan Y como eje vertical (SketchUp, Blender) y otros Z (AutoCAD, Revit). El sistema:
1. Intenta extraer fachadas asumiendo Y-up.
2. Intenta con Z-up.
3. Elige la convencion que produce mas poligonos proyectados.

#### Etapa 4: Extraccion de Fachadas (`facade-extractor.ts`)

**Algoritmo:**
1. Filtra caras **verticales** (componente vertical de la normal < 0.20).
2. Calcula la **direccion horizontal** de cada cara (normal proyectada al plano del suelo).
3. **Agrupa** caras con direccion similar (dot product > 0.70) → clusters N/S/E/W.
4. Para cada cluster, proyecta vertices a 2D usando ejes locales de la fachada.
5. **Cancela aristas compartidas** (edge cancellation): si dos caras trianguladas comparten una arista interna, se elimina, dejando solo el contorno exterior limpio.
6. Normaliza coordenadas a origen (0,0) = esquina inferior izquierda.

**Resultado:** 4 fachadas tipicas (Norte, Sur, Este, Oeste) con contornos limpios.

#### Etapa 5: Extraccion de Planos de Planta (`floor-plan-extractor.ts`)

**Algoritmo:**
1. **Detecta niveles de piso** usando un histograma de areas horizontales:
   - Recopila todas las caras horizontales (|componente vertical de normal| > 0.75).
   - Crea un histograma de elevaciones ponderado por area.
   - Identifica picos locales como niveles de piso.
   - Fusiona picos a menos de 2m de distancia.
2. Para cada nivel, corta el modelo con un **plano horizontal a 1m** sobre la losa.
3. Intersecta cada cara vertical con el plano de corte → genera segmentos de linea.
4. Proyecta segmentos a vista superior (top-down).

**Resultado:** un plano de planta por cada nivel detectado.

#### Etapa 6: Planchas de Corte (`cutting-sheet.ts`)

**Algoritmo:**
1. **Agrupa caras por grupo OBJ** (cada componente de SketchUp exporta como un grupo separado).
2. Dentro de cada grupo, **clusteriza por normal** para encontrar la cara dominante (mayor area).
3. **Clasifica** como pared (normal vertical) o piso (normal horizontal).
4. **Proyecta a 2D** solo las caras del cluster dominante (la cara mas grande = la cara de corte).
5. **Extrae contorno** via cancelacion de aristas internas.
6. **Asigna IDs**: `A1, A2...` para paredes, `B1, B2...` para pisos.
7. **Layout**: ordena por altura descendente, ubica en filas con gap de 0.5m.
8. **Genera DXF separado** por tipo de material.

---

## 7. MODULOS DEL FRONTEND (TypeScript)

### 7.1 Tabla de Modulos

| Archivo | Responsabilidad | Entrada | Salida |
|---------|----------------|---------|--------|
| `obj-parser.ts` | Parsear Wavefront OBJ | `string` (texto OBJ) | `Face3D[]` |
| `pipeline.ts` | Orquestar flujo completo | `ArrayBuffer` + opciones | `OutputFile[]` |
| `facade-extractor.ts` | Extraer vistas de elevacion | `Face3D[]` | `Facade[]` |
| `floor-plan-extractor.ts` | Extraer planos de planta | `Face3D[]` | `FloorPlan[]` |
| `cutting-sheet.ts` | Descomponer y layoutear piezas | `Face3D[]` | DXF strings |
| `dxf-writer.ts` | Generar DXF para fachadas/plantas | `Facade` o `FloorPlan` | DXF string |
| `pdf-writer.ts` | Generar PDF multi-pagina | `Facade[]` + `FloorPlan[]` | PDF string |
| `types.ts` | Tipos compartidos + algebra vectorial | — | Interfaces + funciones |

### 7.2 Dependencias entre Modulos

```
UploadForm.tsx
    |
    v
pipeline.ts
    |
    +---> obj-parser.ts
    +---> facade-extractor.ts ---> types.ts
    +---> floor-plan-extractor.ts ---> types.ts
    +---> cutting-sheet.ts ---> floor-plan-extractor.ts (detectFloorLevels)
    +---> dxf-writer.ts
    +---> pdf-writer.ts
```

---

## 8. MODULOS DEL BACKEND (Python)

### 8.1 Tabla de Modulos

| Archivo | Responsabilidad | Equivalente TS |
|---------|----------------|---------------|
| `main.py` | API REST FastAPI | `UploadForm.tsx` |
| `config.py` | Variables de entorno | — |
| `pipeline.py` | Orquestador | `pipeline.ts` |
| `obj_parser.py` | Parser OBJ | `obj-parser.ts` |
| `skp_parser.py` | Parser SKP (usa SDK) | No tiene equivalente |
| `facade_extractor.py` | Fachadas | `facade-extractor.ts` |
| `floor_plan_extractor.py` | Planos de planta | `floor-plan-extractor.ts` |
| `plan_extractor.py` | Descomposicion de componentes | `cutting-sheet.ts` (parcial) |
| `cutting_sheet.py` | Planchas de corte DXF | `cutting-sheet.ts` (parcial) |
| `wall_extractor.py` | Extractor de paredes | Integrado en `facade-extractor.ts` |
| `dxf_writer.py` | Escritor DXF (via ezdxf) | `dxf-writer.ts` |
| `pdf_writer.py` | Escritor PDF (via reportlab) | `pdf-writer.ts` |
| `types.py` | Tipos y vectores | `types.ts` |

### 8.2 Diferencias Clave entre Frontend y Backend

| Aspecto | Frontend (TS) | Backend (Python) |
|---------|--------------|-----------------|
| DXF | Generacion manual (raw strings AC1009) | Libreria `ezdxf` (R2010) |
| PDF | Operadores PDF raw | Libreria `reportlab` |
| SKP | No soportado | Soportado via `skp_parser.py` |
| Planchas de corte | Basado en grupos OBJ (1:1 real) | Basado en plan_extractor (escalado) |
| Ejecucion | Browser, sin limites de servidor | Servidor, limite 200MB upload |

---

## 9. FORMATOS DE SALIDA

### 9.1 Archivos Generados

Para un archivo de entrada `casa.obj` con plancha de corte activada:

```
casa_planos.zip
|-- casa_Fachada_Norte.dxf
|-- casa_Fachada_Sur.dxf
|-- casa_Fachada_Este.dxf
|-- casa_Fachada_Oeste.dxf
|-- casa_Piso_1.dxf
|-- casa_Piso_2.dxf               (si tiene 2 pisos)
|-- casa_Descomposicion_Paredes.dxf
|-- casa_Descomposicion_Pisos.dxf
+-- casa_planos.pdf                (multi-pagina)
```

### 9.2 Especificacion DXF — Capas para Corte Laser

Todos los archivos DXF siguen convenciones de corte laser/CNC:

| Capa | Color ACI | Color Visual | Proposito |
|------|----------|-------------|-----------|
| **CORTE** | 1 | Rojo | Lineas de corte (la maquina corta aqui) |
| **ETIQUETAS** | 5 | Azul | IDs de referencia (A1, B2...) — grabado, no corte |
| **COTAS** | 7 | Negro | Dimensiones (1.93 x 0.05 m) — grabado, no corte |
| **TITULO** | 5 | Azul | Titulo de la vista (solo en fachadas y plantas) |

**Nota tecnica:** Cada entidad DXF incluye `group code 62` (color explicito) ademas del color de capa, para compatibilidad con viewers como Autodesk Viewer que ignoran BYLAYER.

### 9.3 Formato DXF — Estructura

Los DXF se generan en formato **AC1009 (AutoCAD R12)** por maxima compatibilidad:

```
SECTION HEADER    $ACADVER = AC1009, $INSUNITS = 6 (metros)
SECTION TABLES    Definicion de capas con colores
SECTION ENTITIES  LINE y TEXT con capa y color explicito
EOF
```

### 9.4 Formato PDF

PDF 1.4 generado sin dependencias externas:
- Fuente: Helvetica (Type1, nativa de PDF).
- Una pagina por vista (fachada o planta).
- Escala aplicada con ajuste automatico al tamano de papel.
- Titulo, dimensiones y anotacion de escala en cada pagina.

---

## 10. INTERFAZ DE USUARIO

### 10.1 Pantalla Principal

La interfaz es una single-page application con un unico componente `UploadForm`:

```
+------------------------------------------+
|          [2D] Eficiencia2D               |
|  Convierte modelos 3D en planos 2D      |
|                                          |
|  +------------------------------------+  |
|  |                                    |  |
|  |   Arrastra tu archivo aqui o      |  |
|  |   [buscalo]                        |  |
|  |            .obj                    |  |
|  +------------------------------------+  |
|                                          |
|  Escala: [1:100 v]   Papel: [A4 v]      |
|  Formato: DXF + PDF                     |
|  [ ] Plancha de Corte                   |
|                                          |
|  [       Generar Planos        ]         |
|                                          |
|  Formato soportado: .obj                |
|  Tu archivo se procesa localmente       |
+------------------------------------------+
```

### 10.2 Estados de la UI

| Estado | Visual |
|--------|--------|
| `idle` | Zona de drop activa, boton habilitado |
| `processing` | Spinner + barra de progreso indeterminada |
| `done` | Mensaje de exito, boton "Procesar otro archivo" |
| `error` | Mensaje de error en rojo |

### 10.3 Parametros Configurables

| Parametro | Opciones | Default |
|-----------|---------|---------|
| Escala | 1:20, 1:25, 1:50, 1:75, 1:100, 1:125, 1:150, 1:200, 1:250, 1:500 | 1:100 |
| Papel | A4, A3, A1 | A4 |
| Formato | DXF + PDF (fijo) | DXF + PDF |
| Plancha de corte | checkbox | desactivado |

---

## 11. API REST (Backend)

### 11.1 Endpoints

#### `GET /health`

Health-check para Railway/Docker.

**Respuesta:**
```json
{
  "status": "ok",
  "mode": "python-pipeline",
  "version": "0.4.0"
}
```

#### `POST /api/upload`

Procesa un archivo 3D y retorna un ZIP con los planos.

**Request (multipart/form-data):**

| Campo | Tipo | Requerido | Descripcion |
|-------|------|----------|-------------|
| `file` | binary | Si | Archivo `.obj` o `.skp` |
| `scale` | int | No (default: 100) | Denominador de escala |
| `paper` | string | No (default: "A3") | Tamano de papel |
| `formats` | string | No (default: "dxf,pdf") | Formatos separados por coma |
| `include_plan` | string | No (default: "false") | Incluir descomposicion |
| `include_cutting_sheet` | string | No (default: "false") | Incluir planchas de corte |
| `include_floor_plans` | string | No (default: "false") | Incluir planos de planta |

**Respuesta exitosa:** `200 OK`, `application/zip`

**Errores:**

| Codigo | Causa |
|--------|-------|
| 400 | Extension invalida, escala invalida, papel invalido |
| 413 | Archivo excede 200MB |
| 422 | No se generaron archivos de salida |
| 500 | Error interno del pipeline |

---

## 12. INFRAESTRUCTURA Y DESPLIEGUE

### 12.1 Ambiente de Produccion (Frontend en Railway)

```
Railway (Nixpacks)
|-- Node.js 18
|-- npm ci && npm run build
|-- next start (port $PORT)
|-- Health-check: GET /api/health
```

**Archivo de configuracion:** `nixpacks.toml`

El frontend se despliega como una app Next.js estatica. Todo el procesamiento es client-side. Railway solo sirve HTML/JS/CSS.

### 12.2 Ambiente Alternativo (Backend en Docker)

```
Docker (python:3.12-slim)
|-- pip install -r requirements.txt
|-- uvicorn app.main:app --port 8000
|-- Health-check: GET /health
|-- Restart: on_failure (max 3)
```

**Archivo de configuracion:** `railway.toml` + `backend-selfhosted/Dockerfile`

### 12.3 Despliegue Alternativo (Vercel)

Configurado en `vercel.json` como fallback:
- Framework: Next.js
- Build: `npm run build`
- Output: `.next`

### 12.4 Diagrama de Despliegue

```
+------------------+       +------------------+
|   Usuario        |       |   Railway        |
|   (Navegador)    |<----->|   (Next.js)      |
|                  |       |   Solo sirve     |
|   Procesamiento  |       |   HTML/JS/CSS    |
|   ocurre AQUI    |       |                  |
+------------------+       +------------------+

         (alternativa self-hosted)

+------------------+       +------------------+
|   Usuario        |       |   Docker/Railway |
|   (Navegador)    |------>|   (FastAPI)      |
|                  |       |   Procesamiento  |
|   Solo sube el   |<------|   en servidor    |
|   archivo        |  ZIP  |                  |
+------------------+       +------------------+
```

---

## 13. DEPENDENCIAS Y TECNOLOGIAS

### 13.1 Frontend

| Tecnologia | Version | Proposito |
|-----------|---------|-----------|
| Next.js | 14.2 | Framework web (SSR/SSG) |
| React | 18.3 | Libreria de UI |
| TypeScript | 5.x | Tipado estatico |
| JSZip | 3.10 | Creacion de archivos ZIP en browser |
| pako | 2.1 | Compresion (dependencia de JSZip) |

### 13.2 Backend

| Tecnologia | Version | Proposito |
|-----------|---------|-----------|
| Python | 3.12 | Runtime |
| FastAPI | — | Framework de API REST |
| uvicorn | — | Servidor ASGI |
| ezdxf | — | Generacion de DXF validos |
| reportlab | — | Generacion de PDF |

### 13.3 Infraestructura

| Servicio | Uso |
|---------|-----|
| Railway | Hosting del frontend (Next.js) |
| Git/GitHub | Control de versiones |
| Docker | Contenedorizacion del backend |

---

## 14. ESTRUCTURA DE ARCHIVOS

```
Eficiencia2D/
|
|-- src/                              # Codigo fuente del frontend
|   |-- app/                          # Paginas Next.js (App Router)
|   |   |-- page.tsx                  # Pagina principal
|   |   |-- layout.tsx                # Layout raiz
|   |   +-- api/health/route.ts       # Health-check
|   |-- components/
|   |   +-- UploadForm.tsx            # Formulario de carga
|   |-- core/                         # Logica de procesamiento (client-side)
|   |   |-- types.ts                  # 107 lineas — Tipos + algebra vectorial
|   |   |-- obj-parser.ts             # 89 lineas — Parser OBJ
|   |   |-- pipeline.ts               # 163 lineas — Orquestador
|   |   |-- facade-extractor.ts       # 213 lineas — Extractor de fachadas
|   |   |-- floor-plan-extractor.ts   # 247 lineas — Extractor de plantas
|   |   |-- cutting-sheet.ts          # 519 lineas — Planchas de corte
|   |   |-- dxf-writer.ts             # 162 lineas — Escritor DXF
|   |   +-- pdf-writer.ts             # 273 lineas — Escritor PDF
|   +-- styles/
|       +-- globals.css               # Estilos CSS
|
|-- backend-selfhosted/               # Backend Python alternativo
|   |-- app/
|   |   |-- main.py                   # 186 lineas — API FastAPI
|   |   |-- config.py                 # 13 lineas — Configuracion
|   |   +-- core/                     # Pipeline Python
|   |       |-- types.py              # 111 lineas
|   |       |-- obj_parser.py
|   |       |-- skp_parser.py
|   |       |-- pipeline.py           # 299 lineas
|   |       |-- facade_extractor.py   # 252 lineas
|   |       |-- floor_plan_extractor.py
|   |       |-- plan_extractor.py     # 384 lineas
|   |       |-- cutting_sheet.py      # ~250 lineas
|   |       |-- dxf_writer.py         # 240 lineas
|   |       |-- pdf_writer.py
|   |       +-- wall_extractor.py     # 256 lineas
|   |-- tests/
|   |   +-- test_api.py               # 26 pruebas automatizadas
|   |-- Dockerfile
|   +-- .env.example
|
|-- SDK/                              # SketchUp C SDK (legacy)
|-- package.json                      # Dependencias npm
|-- tsconfig.json                     # Config TypeScript
|-- nixpacks.toml                     # Config build Railway (frontend)
|-- railway.toml                      # Config deploy Railway (backend)
|-- vercel.json                       # Config Vercel (alternativa)
+-- .env.example                      # Variables de entorno ejemplo
```

---

## 15. CONFIGURACION DEL ENTORNO

### 15.1 Desarrollo Local (Frontend)

```bash
# Instalar dependencias
npm ci

# Iniciar servidor de desarrollo
npm run dev

# Abrir http://localhost:3000
```

### 15.2 Desarrollo Local (Backend)

```bash
cd backend-selfhosted

# Crear entorno virtual
python -m venv venv
source venv/bin/activate  # Linux/Mac
# o: venv\Scripts\activate  # Windows

# Instalar dependencias
pip install -r requirements.txt

# Ejecutar servidor
uvicorn app.main:app --reload --port 8000

# Ejecutar tests
python -m pytest tests/ -v
```

### 15.3 Variables de Entorno

**Frontend (.env.local):**

| Variable | Descripcion | Ejemplo |
|---------|-------------|---------|
| `NEXT_PUBLIC_API_URL` | URL del backend (no usado en modo client-side) | `https://api.ejemplo.com` |

**Backend (.env):**

| Variable | Descripcion | Default |
|---------|-------------|---------|
| `CORS_ORIGINS` | Origenes CORS permitidos | `*` |
| `MAX_UPLOAD_BYTES` | Tamano maximo de upload | `209715200` (200MB) |
| `TEMP_DIR` | Directorio temporal | `/tmp/eficiencia2d` |
| `PORT` | Puerto del servidor | `8000` |

---

## 16. PRUEBAS

### 16.1 Suite de Tests (Backend)

Ubicacion: `backend-selfhosted/tests/test_api.py`

| # | Test | Verifica |
|---|------|----------|
| 1 | `test_health` | Endpoint /health responde OK |
| 2 | `test_upload_rejects_non_skp` | Rechaza formatos invalidos |
| 3 | `test_upload_rejects_invalid_scale` | Rechaza escalas invalidas |
| 4 | `test_upload_rejects_invalid_paper` | Rechaza papeles invalidos |
| 5 | `test_upload_rejects_unsupported_format` | Rechaza formatos no soportados |
| 6 | `test_box_y_up_produces_4_facades` | Modelo Y-up genera 4 fachadas |
| 7 | `test_box_z_up_produces_4_facades` | Modelo Z-up genera 4 fachadas |
| 8 | `test_dxf_only` | Genera solo DXF si se pide |
| 9 | `test_pdf_only` | Genera solo PDF si se pide |
| 10 | `test_upload_obj_no_faces` | Maneja OBJ vacio correctamente |
| 11 | `test_centimeter_model` | Detecta y normaliza centimetros |
| 12 | `test_include_plan_adds_decomposition` | Descomposicion incluye paneles |
| 13 | `test_include_plan_false_no_decomposition` | Sin flag no genera descomposicion |
| 14 | `test_decomposition_z_up` | Descomposicion funciona con Z-up |
| 15 | `test_multistory_decomposition` | Multiples pisos se descomponen |
| 16 | `test_plancha_paper_rejected` | "Plancha" no es papel valido |
| 17 | `test_cutting_sheet_generated` | Plancha de corte genera DXF |
| 18 | `test_cutting_sheet_has_panel_ids` | DXF contiene IDs A1/B1 |
| 19 | `test_cutting_sheet_not_generated_by_default` | Sin flag no genera plancha |
| 20 | `test_dxf_has_laser_layers` | DXF tiene capas CORTE/GRABADO |
| 21 | `test_panel_reference_ids_in_component_dxf` | IDs en descomposicion |
| 22 | `test_floor_plans_generated` | Genera planos de planta |
| 23 | `test_floor_plans_not_generated_by_default` | Sin flag no genera plantas |
| 24 | `test_floor_plan_dxf_has_laser_layers` | Planta tiene capas laser |
| 25 | `test_floor_plans_with_simple_box` | Funciona con caja simple |
| 26 | `test_floor_detection_merges_slabs_same_level` | Fusiona losas del mismo nivel |

### 16.2 Ejecucion

```bash
cd backend-selfhosted
python -m pytest tests/ -v
# Resultado esperado: 26 passed
```

---

## 17. GLOSARIO TECNICO

| Termino | Definicion |
|---------|-----------|
| **ACI** | AutoCAD Color Index. Escala de 256 colores usada en DXF. 1=rojo, 5=azul, 7=negro. |
| **Bounding box** | Rectangulo minimo que contiene toda la geometria. |
| **BYLAYER** | Modo DXF donde la entidad hereda el color de su capa. |
| **Componente** | Grupo de caras 3D que forman una pieza estructural (pared, piso). |
| **DXF** | Drawing Exchange Format. Formato vectorial de Autodesk para CAD. |
| **Edge cancellation** | Tecnica que elimina aristas compartidas entre triangulos adyacentes para obtener solo el contorno exterior. |
| **Fachada** | Vista de elevacion del edificio desde una de las 4 direcciones cardinales. |
| **Face3D** | Poligono 3D definido por vertices y una normal. Unidad basica de geometria. |
| **Group code** | Par clave-valor en formato DXF. Ej: `8` = capa, `62` = color, `10` = coordenada X. |
| **Nesting** | Proceso de ubicar piezas 2D en un plano minimizando desperdicio de material. |
| **Normal** | Vector unitario perpendicular a una cara, indica su orientacion. |
| **OBJ** | Wavefront OBJ. Formato de texto plano para geometria 3D. |
| **Panel** | Pieza individual extraida del modelo, lista para fabricacion. |
| **Pipeline** | Flujo secuencial de procesamiento desde archivo de entrada hasta archivos de salida. |
| **Plancha de corte** | Layout 2D de todas las piezas de un tipo, listo para enviar a maquina laser/CNC. |
| **Plano de planta** | Vista horizontal del edificio cortado a 1m sobre el nivel de piso. |
| **Shelf-packing** | Algoritmo de empaquetado que ubica rectangulos en filas de izquierda a derecha. |
| **SKP** | Formato nativo de SketchUp. |
| **Up axis** | Eje que apunta hacia arriba en el modelo 3D (Y en SketchUp, Z en AutoCAD). |

---

*Documento generado como parte del proyecto Eficiencia2D. Ultima actualizacion: Marzo 2026.*
