# ==============================================================================
# Eficiencia2D — Backend (FastAPI + C++ Translator)
# Multi-stage build: compile the C++ translator, then run the Python API.
# ==============================================================================

# ---- Stage 1: Build the C++ translator with the SketchUp SDK ----
FROM ubuntu:22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake wget ca-certificates unzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy the C++ translator source.
COPY ../translator-cpp/ ./translator-cpp/

# Download the SketchUp C SDK for Linux.
# NOTE: Replace this URL with the actual SDK download link from
# https://extensions.sketchup.com/sketchup-sdk
# The SDK is not redistributable, so it must be fetched at build time.
ARG SU_SDK_URL=""
RUN mkdir -p translator-cpp/third_party/sketchup-sdk && \
    if [ -n "$SU_SDK_URL" ]; then \
        wget -q -O /tmp/sdk.zip "$SU_SDK_URL" && \
        unzip -q /tmp/sdk.zip -d translator-cpp/third_party/sketchup-sdk && \
        rm /tmp/sdk.zip; \
    else \
        echo "WARNING: SU_SDK_URL not set. Provide the SketchUp SDK URL as a build arg." && \
        echo "Example: docker build --build-arg SU_SDK_URL=https://... ." ; \
    fi

# Build the translator.
RUN cd translator-cpp && \
    mkdir -p build && cd build && \
    cmake .. -DCMAKE_BUILD_TYPE=Release && \
    make -j$(nproc) && \
    make install DESTDIR=/install

# ---- Stage 2: Runtime image ----
FROM python:3.12-slim

ENV DEBIAN_FRONTEND=noninteractive

# Install minimal runtime libs needed by the compiled translator and SDK.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the compiled translator binary from the builder stage.
COPY --from=builder /install/usr/local/bin/skp_translator /usr/local/bin/skp_translator

# Copy the SketchUp SDK shared libraries (if present).
COPY --from=builder /build/translator-cpp/third_party/sketchup-sdk/binaries/sketchup/x64/*.so* /usr/local/lib/ 2>/dev/null || true
RUN ldconfig

# Install Python dependencies.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the FastAPI application.
COPY app/ ./app/

# Configuration via environment variables.
ENV TRANSLATOR_BIN=/usr/local/bin/skp_translator
ENV TEMP_DIR=/tmp/eficiencia2d
ENV PORT=8000

EXPOSE ${PORT}

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
