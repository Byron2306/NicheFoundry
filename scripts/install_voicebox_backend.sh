#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VOICEBOX_DIR="${VOICEBOX_DIR:-$ROOT/vendor/voicebox}"
VENV="${VOICEBOX_VENV:-$ROOT/.venv-voicebox}"
PYTHON_VERSION="${VOICEBOX_PYTHON_VERSION:-3.12}"
INSTALL_MODE="${VOICEBOX_INSTALL_MODE:-minimal}"

if [[ ! -d "$VOICEBOX_DIR/backend" ]]; then
  echo "Voicebox source is missing at $VOICEBOX_DIR" >&2
  exit 1
fi

command -v uv >/dev/null 2>&1 || {
  echo "uv is required to install the Voicebox backend." >&2
  exit 1
}

if [[ -d "$VENV" ]]; then
  echo "Voicebox backend environment already exists at $VENV"
else
  uv venv --seed --python "$PYTHON_VERSION" "$VENV"
fi

"$VENV/bin/python" -m pip install --upgrade pip wheel setuptools
"$VENV/bin/python" -m pip install \
  --index-url https://download.pytorch.org/whl/cpu \
  torch==2.4.1+cpu

if [[ "$INSTALL_MODE" == "full" ]]; then
  "$VENV/bin/python" -m pip install \
    -r "$VOICEBOX_DIR/backend/requirements.txt" \
    --extra-index-url https://download.pytorch.org/whl/cpu
else
  TMP_REQUIREMENTS="$(mktemp)"
  cat >"$TMP_REQUIREMENTS" <<'REQS'
fastapi>=0.109.0
uvicorn[standard]>=0.27.0
pydantic>=2.5.0
sqlalchemy>=2.0.0
alembic>=1.13.0
transformers>=4.36.0,<=4.57.6
accelerate>=0.26.0
huggingface_hub>=0.20.0
qwen-tts>=0.0.5
httpx>=0.27.0
python-multipart>=0.0.6
Pillow>=10.0.0
librosa>=0.10.0
soundfile>=0.12.0
numpy>=1.24.0,<2.0
numba>=0.60.0,<0.61.0
pedalboard>=0.9.0
REQS
  trap 'rm -f "$TMP_REQUIREMENTS"' EXIT
  "$VENV/bin/python" -m pip install \
    -r "$TMP_REQUIREMENTS" \
    --extra-index-url https://download.pytorch.org/whl/cpu
fi

cat <<MSG
Voicebox backend environment installed.

Start the backend with:
  cd "$VOICEBOX_DIR" && "$VENV/bin/python" -m backend.main --host 127.0.0.1 --port 17493

Install mode used:
  $INSTALL_MODE

Optional full multi-engine install:
  VOICEBOX_INSTALL_MODE=full bash scripts/install_voicebox_backend.sh

Then create/sync a cloned profile:
  npm run build:voice-reference
  VOICEBOX_PROFILE="NicheFoundry Narrator" npm run voicebox:sync-profile -- "NicheFoundry Narrator"

Then use it in NicheFoundry:
  VOICEBOX_PROFILE="NicheFoundry Narrator" node scripts/build_audio_performance.js episodes/<episode-id> --provider voicebox --force
MSG
