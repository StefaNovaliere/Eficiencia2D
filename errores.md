# Errores encontrados y lecciones aprendidas

## Error 1: COPY con rutas `../` en Dockerfile
- **Fecha**: 2026-02-25
- **Problema**: El Dockerfile en `backend-selfhosted/Dockerfile` usaba `COPY ../translator-cpp/ ./translator-cpp/`. Docker no permite copiar archivos fuera del build context — `../` es inválido.
- **Solución**: Usar la raíz del proyecto como build context y ejecutar con `-f`:
  ```bash
  docker build -f backend-selfhosted/Dockerfile -t eficiencia2d-backend .
  ```
  Todos los `COPY` ahora son relativos a la raíz del proyecto.

## Error 2: Estrategia wget para SDK en Docker build
- **Fecha**: 2026-02-25
- **Problema**: El Dockerfile descargaba el SketchUp SDK con `wget` usando un `ARG SU_SDK_URL`. Esto es frágil: la URL puede cambiar, el build falla si no se pasa el arg, y agrega dependencias innecesarias (wget, ca-certificates, unzip) a la imagen builder.
- **Solución**: Estrategia "Direct Commit" — el SDK de Linux se commitea directamente en el repo bajo `SDK/` y se copia con un simple `COPY SDK/ ./translator-cpp/third_party/sketchup-sdk/`.

## Error 3: Frontend procesando .skp localmente en el browser
- **Fecha**: 2026-02-25
- **Problema**: `UploadForm.tsx` importaba `runPipeline` de `@/core/pipeline` e intentaba parsear archivos `.skp` en el browser con un parser heurístico. Esto fallaba con "Could not extract geometry" en modelos complejos porque el browser no tiene acceso al SketchUp C++ SDK.
- **Solución**: Reescribir `UploadForm.tsx` para hacer `fetch POST` al backend FastAPI (`NEXT_PUBLIC_API_URL/api/upload`) que usa el SDK real via el translator C++.

## Error 4: .gitignore bloqueaba el SDK necesario para deploy
- **Fecha**: 2026-02-25
- **Problema**: La regla `translator-cpp/third_party/sketchup-sdk/` en `.gitignore` impedía trackear los binarios del SDK de Linux, haciendo que el backend en Docker no tuviera las dependencias del SketchUp SDK.
- **Solución**: Eliminar esa regla del `.gitignore`. El SDK de Linux se commitea bajo `SDK/` en la raíz del proyecto para que esté disponible durante el `docker build`.

## Error 5: Nota de privacidad incorrecta después del refactor
- **Fecha**: 2026-02-25
- **Problema**: `page.tsx` decía "100% en el navegador — tu archivo nunca sale de tu máquina" pero después del refactor el archivo SÍ se envía al servidor backend.
- **Solución**: Actualizar el texto a "Tu archivo se envía a nuestro servidor para procesarlo y se elimina inmediatamente después."

## Error 6: Caracteres corruptos `########` en layout.tsx
- **Fecha**: 2026-02-25
- **Problema**: `src/app/layout.tsx` en `main` tenía `########` en la línea 3 (restos de un merge malo). Esto causaba `Expected ident` syntax error durante `next build` en Vercel.
- **Solución**: Eliminar la línea corrupta. El archivo ya estaba limpio en el feature branch.

## Error 7: `.dockerignore` excluía `src/` — Railway no encontraba Next.js app dir
- **Fecha**: 2026-02-25
- **Problema**: El `.dockerignore` en la raíz tenía `src/` para excluir el frontend del build del backend Docker. Pero Railpack (builder de Railway) lo usaba para el build del frontend, eliminando toda la carpeta `src/app/`. Next.js fallaba con `Couldn't find any 'pages' or 'app' directory`.
- **Solución**: Eliminar `src/` del `.dockerignore` raíz. El backend ya tiene su propio `.dockerignore` en `backend-selfhosted/`.

## Error 8: `NEXT_PUBLIC_API_URL` sin protocolo `https://` — fetch iba a ruta relativa
- **Fecha**: 2026-02-25
- **Problema**: La variable `NEXT_PUBLIC_API_URL` en Vercel estaba configurada como `eficiencia2d-production.up.railway.app` (sin `https://`). El browser interpretaba eso como ruta relativa y hacía POST a `https://vercel-domain.app/eficiencia2d-production.up.railway.app/api/upload`, retornando 405 Method Not Allowed.
- **Solución**: Agregar auto-prepend de `https://` en `UploadForm.tsx` cuando falta el protocolo. También se recomienda corregir la variable en Vercel.

## Error 9: Railway devuelve 404 — buildea frontend en vez de backend Docker
- **Fecha**: 2026-02-25
- **Problema**: Railway estaba configurado con builder "Railpack" (default) y detectaba el proyecto como Next.js frontend. El backend FastAPI nunca se buildeaba ni ejecutaba, así que `POST /api/upload` devolvía 404 desde railway-edge. Esto también causaba error de CORS porque railway-edge no envía headers `Access-Control-Allow-Origin`.
- **Solución**: Agregar `railway.toml` en la raíz del proyecto con `builder = "dockerfile"` y `dockerfilePath = "backend-selfhosted/Dockerfile"` para que Railway use el Dockerfile del backend.

## Error 10: Include incorrecto `SketchUpAPI/model/transformation.h` — no existe en el SDK
- **Fecha**: 2026-02-25
- **Problema**: `translator-cpp/include/transform.h` incluía `<SketchUpAPI/model/transformation.h>`, pero ese header no existe en el SketchUp SDK. La struct `SUTransformation` está definida en `<SketchUpAPI/geometry.h>`. Esto causaba `fatal error: SketchUpAPI/model/transformation.h: No such file or directory` durante la compilación en Docker/Railway.
- **Solución**: Cambiar el include a `<SketchUpAPI/geometry.h>`.

## Error 11 (RESUELTO): SDK de SketchUp no tiene binarios para Linux — solo Windows/macOS
- **Fecha**: 2026-02-25
- **Problema**: El directorio `SDK/binaries/sketchup/x64/` contiene solo archivos Windows (`.dll`, `.lib`). El SketchUp C SDK **no se distribuye oficialmente para Linux** — solo existe para Windows y macOS. El Dockerfile buildea sobre Ubuntu (Linux), así que CMake no encuentra `libSketchUpAPI.so` y el linker falla. Esto hace que sea **imposible** compilar y ejecutar el translator C++ en un contenedor Docker Linux.
- **Impacto**: El backend completo no puede funcionar en Railway (ni en ningún host Linux) con la arquitectura actual.
- **Solución aplicada** (2026-02-26): **Opción 1 — Pipeline Python puro**. Se eliminó completamente el translator C++ y la dependencia del SketchUp SDK. Se portó toda la lógica de procesamiento de TypeScript (`src/core/`) a Python puro en `backend-selfhosted/app/core/`:
  - `types.py` — Tipos geométricos compartidos (Vec3, Vec2, Face3D, Wall) y utilidades vectoriales.
  - `skp_parser.py` — Parser heurístico de binarios `.skp` (escaneo de arrays de vértices Float64). Soporta formato ZIP-wrapped (SketchUp 2021+) y legacy binary.
  - `obj_parser.py` — Parser de `.obj` Wavefront (formato texto, soporte completo de caras n-gon, índices negativos, formatos v/vt/vn).
  - `wall_extractor.py` — Extractor de muros: filtra caras verticales (|normal.z| < 0.08), valida área > 1.5 m², proyecta a 2D con ejes locales del muro.
  - `dxf_writer.py` — Generador DXF (AutoCAD 2000, capas WALLS/OPENINGS/DIMENSIONS).
  - `pdf_writer.py` — Generador PDF minimal (sin dependencias, Helvetica built-in, tamaños A3/A1).
  - `pipeline.py` — Orquestación: archivo → parser → extractor → writers → archivos de salida.
  - `main.py` reescrito: ya no invoca subproceso C++, ejecuta el pipeline Python directamente en memoria.
  - `config.py` simplificado: eliminadas las variables `TRANSLATOR_BIN` y `TRANSLATOR_TIMEOUT_S`.
  - `Dockerfile` simplificado: single-stage `python:3.12-slim`, sin compilación C++, sin SDK, sin `libstdc++6`.
  - El backend ahora acepta tanto `.skp` como `.obj`.
  - **Limitación**: El parser `.skp` es heurístico (no tiene acceso al SDK oficial). Para modelos complejos que el parser no pueda leer, el usuario debe exportar como `.obj` desde SketchUp (File → Export → 3D Model → OBJ).
