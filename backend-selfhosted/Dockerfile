# ==============================================================================
# Eficiencia2D — Backend (FastAPI + C++ Translator)
# Multi-stage build: compile the C++ translator, then run the Python API.
#
# BUILD FROM PROJECT ROOT (not from backend-selfhosted/):
#   docker build -f backend-selfhosted/Dockerfile -t eficiencia2d-backend .
# ==============================================================================

# ---- Stage 1: Build the C++ translator with the SketchUp SDK ----
FROM ubuntu:22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy the C++ translator source code.
COPY translator-cpp/ ./translator-cpp/

# Copy the SketchUp SDK (committed in the repo under SDK/).
# Place it where CMakeLists.txt expects it: third_party/sketchup-sdk/
COPY SDK/ ./translator-cpp/third_party/sketchup-sdk/

# Build the translator.
RUN cd translator-cpp \
    && mkdir -p build && cd build \
    && cmake .. -DCMAKE_BUILD_TYPE=Release \
    && make -j$(nproc) \
    && make install DESTDIR=/install

# ---- Stage 2: Runtime image ----
FROM python:3.12-slim

ENV DEBIAN_FRONTEND=noninteractive

# Minimal runtime libs for the compiled translator.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the compiled translator binary.
COPY --from=builder /install/usr/local/bin/skp_translator /usr/local/bin/skp_translator

# Copy the SketchUp SDK shared libraries (.so) for runtime linking.
COPY --from=builder /build/translator-cpp/third_party/sketchup-sdk/binaries/sketchup/x64/ /usr/local/lib/sketchup/
RUN ldconfig /usr/local/lib/sketchup

# Install Python dependencies.
COPY backend-selfhosted/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the FastAPI application.
COPY backend-selfhosted/app/ ./app/

# Configuration via environment variables.
ENV TRANSLATOR_BIN=/usr/local/bin/skp_translator
ENV TEMP_DIR=/tmp/eficiencia2d
ENV PORT=8000

EXPOSE ${PORT}

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
