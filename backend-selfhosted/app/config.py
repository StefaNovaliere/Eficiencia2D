import os

# Maximum upload size: 200 MB (raw .skp files are typically 5-50 MB).
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", 200 * 1024 * 1024))

# Temp directory root.
TEMP_DIR = os.getenv("TEMP_DIR", "/tmp/eficiencia2d")

# Valid options.
VALID_SCALES = {50, 100}
VALID_PAPERS = {"A3", "A1", "Plancha"}
VALID_FORMATS = {"dxf", "pdf"}
