# ==============================================================================
# Eficiencia2D -- Backend (FastAPI + Pure Python Pipeline)
# Single-stage build: no C++ translator or SketchUp SDK required.
#
# BUILD FROM PROJECT ROOT (not from backend-selfhosted/):
#   docker build -f backend-selfhosted/Dockerfile -t eficiencia2d-backend .
# ==============================================================================

FROM python:3.12-slim

WORKDIR /app

# Install Python dependencies.
COPY backend-selfhosted/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the FastAPI application (includes the pure-Python processing pipeline).
COPY backend-selfhosted/app/ ./app/

# Configuration via environment variables.
ENV TEMP_DIR=/tmp/eficiencia2d
ENV PORT=8000

EXPOSE ${PORT}

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --timeout-keep-alive 300"]
