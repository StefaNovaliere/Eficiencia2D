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
