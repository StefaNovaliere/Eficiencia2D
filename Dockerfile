# =============================================================================
# Multi-stage Dockerfile for Eficiencia2D
# Stage 1: Build the C++ translator
# Stage 2: Build the Next.js frontend
# Stage 3: Runtime image with Python + translator binary + static frontend
# =============================================================================

# --- Stage 1: C++ build ---
FROM ubuntu:22.04 AS cpp-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy SDK and translator source.
COPY translator/ ./translator/

# NOTE: The SketchUp SDK must be placed in translator/third_party/sketchup-sdk/
# before building.  See translator/CMakeLists.txt for layout details.

RUN cd translator && \
    mkdir -p build && cd build && \
    cmake .. -DCMAKE_BUILD_TYPE=Release && \
    cmake --build . --parallel "$(nproc)" || \
    echo "WARN: Build may fail without SketchUp SDK — binary will be missing."

# --- Stage 2: Frontend build ---
FROM node:20-alpine AS frontend-builder

WORKDIR /app
COPY frontend/package.json frontend/tsconfig.json frontend/next.config.js ./
RUN npm install --ignore-scripts
COPY frontend/src/ ./src/
COPY frontend/public/ ./public/
RUN npm run build

# --- Stage 3: Runtime ---
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libstdc++6 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python backend.
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/

# C++ translator binary (if built).
COPY --from=cpp-builder /build/translator/build/skp_translator /usr/local/bin/skp_translator
# SketchUp SDK shared libs (if present).
COPY --from=cpp-builder /build/translator/third_party/sketchup-sdk/binaries/ /usr/local/lib/ 2>/dev/null || true

ENV TRANSLATOR_BIN=/usr/local/bin/skp_translator
ENV LD_LIBRARY_PATH=/usr/local/lib

# Static frontend (served by a simple file handler or reverse proxy).
COPY --from=frontend-builder /app/.next/standalone /app/frontend/
COPY --from=frontend-builder /app/.next/static /app/frontend/.next/static
COPY --from=frontend-builder /app/public /app/frontend/public

EXPOSE 8000 3000

# Start both services.  In production, use a process manager or separate containers.
CMD ["sh", "-c", "uvicorn backend.app.main:app --host 0.0.0.0 --port 8000"]
