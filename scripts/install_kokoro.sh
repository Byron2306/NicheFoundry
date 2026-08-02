#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${KOKORO_VENV:-$ROOT/.venv-kokoro}"
PYTHON_VERSION="${KOKORO_PYTHON_VERSION:-3.12}"

command -v uv >/dev/null 2>&1 || {
  echo "uv is required to install the Kokoro runtime." >&2
  exit 1
}

if [[ -d "$VENV" ]]; then
  echo "Kokoro environment already exists at $VENV"
else
  uv venv --seed --python "$PYTHON_VERSION" "$VENV"
fi

"$VENV/bin/python" -m pip install --upgrade pip wheel setuptools
"$VENV/bin/python" -m pip install \
  --index-url https://download.pytorch.org/whl/cpu \
  torch==2.4.1+cpu
"$VENV/bin/python" -m pip install \
  "kokoro>=0.9.4" \
  soundfile \
  "numpy<2" \
  --extra-index-url https://download.pytorch.org/whl/cpu

cat <<MSG
Kokoro runtime installed.

Default command:
  $VENV/bin/python

Optional .env settings:
  KOKORO_COMMAND=$VENV/bin/python
  KOKORO_VOICE=af_heart
  KOKORO_LANG_CODE=a
  KOKORO_SPEED=1.0

Test it with:
  node scripts/build_audio_performance.js episodes/<episode-id> --provider kokoro --force
MSG
