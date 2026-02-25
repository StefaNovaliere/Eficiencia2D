import os
from pathlib import Path

# Path to the compiled C++ translator binary.
TRANSLATOR_BIN = os.getenv(
    "TRANSLATOR_BIN",
    str(Path(__file__).resolve().parent.parent.parent / "translator" / "build" / "skp_translator"),
)

# Maximum upload size: 200 MB (raw .skp files are typically 5-50 MB).
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", 200 * 1024 * 1024))

# Subprocess timeout in seconds.
TRANSLATOR_TIMEOUT_S = int(os.getenv("TRANSLATOR_TIMEOUT_S", 120))

# Temp directory root.
TEMP_DIR = os.getenv("TEMP_DIR", "/tmp/eficiencia2d")

# Valid options.
VALID_SCALES = {50, 100}
VALID_PAPERS = {"A3", "A1"}
VALID_FORMATS = {"dxf", "pdf"}
