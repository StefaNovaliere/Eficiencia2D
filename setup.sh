#!/usr/bin/env bash
#
# Eficiencia2D — local development setup
#
# Prerequisites:
#   - CMake >= 3.16, a C++17 compiler
#   - Python >= 3.10 with pip
#   - Node.js >= 18 with npm
#   - SketchUp C SDK extracted to translator/third_party/sketchup-sdk/
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "=== 1. Building C++ translator ==="
cd "$ROOT/translator"
mkdir -p build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
cmake --build . --parallel "$(nproc 2>/dev/null || echo 4)"
echo "   -> Binary: $ROOT/translator/build/skp_translator"

echo ""
echo "=== 2. Setting up Python backend ==="
cd "$ROOT/backend"
python3 -m venv .venv
source .venv/bin/activate
pip install -q -r requirements.txt
echo "   -> To run: cd backend && source .venv/bin/activate && uvicorn app.main:app --reload"

echo ""
echo "=== 3. Setting up Next.js frontend ==="
cd "$ROOT/frontend"
npm install
echo "   -> To run: cd frontend && npm run dev"

echo ""
echo "=== Done! ==="
echo "Start the backend:  cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --port 8000"
echo "Start the frontend: cd frontend && npm run dev"
