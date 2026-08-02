#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${PIPER_VENV:-$ROOT/.venv-piper}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

command -v "$PYTHON_BIN" >/dev/null 2>&1 || {
  echo "Python 3 is required." >&2
  exit 1
}

"$PYTHON_BIN" -m venv "$VENV"
"$VENV/bin/python" -m pip install --upgrade pip
"$VENV/bin/python" -m pip install piper-tts

cat <<MSG
Piper installed at:
  $VENV/bin/piper

Use it for this shell with:
  export PIPER_BIN="$VENV/bin/piper"

Voice models are separate. Extract the optional voice pack into:
  $ROOT/assets/piper
MSG
