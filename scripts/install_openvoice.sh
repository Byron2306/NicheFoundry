#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${OPENVOICE_VENV:-$ROOT/.venv-openvoice}"
REPO="${OPENVOICE_REPO:-$ROOT/vendor/OpenVoice}"
PYTHON_VERSION="${OPENVOICE_PYTHON_VERSION:-3.10}"

command -v uv >/dev/null 2>&1 || {
  echo "uv is required for the OpenVoice Python 3.10 environment. Install uv or set OPENVOICE_COMMAND to an existing OpenVoice Python." >&2
  exit 1
}

mkdir -p "$(dirname "$REPO")"
if [[ ! -d "$REPO/.git" ]]; then
  git clone https://github.com/myshell-ai/OpenVoice.git "$REPO"
fi

uv venv --seed --python "$PYTHON_VERSION" "$VENV"
"$VENV/bin/python" -m pip install --upgrade pip wheel setuptools
"$VENV/bin/python" -m pip install \
  --index-url https://download.pytorch.org/whl/cpu \
  torch==2.2.2+cpu
"$VENV/bin/python" -m pip install \
  librosa==0.9.1 \
  soundfile \
  scipy \
  pydub==0.25.1 \
  wavmark==0.0.3 \
  numpy==1.22.0 \
  eng_to_ipa==0.0.2 \
  inflect==7.0.0 \
  unidecode==1.3.7 \
  pypinyin==0.50.0 \
  cn2an==0.5.22 \
  jieba==0.42.1 \
  langid==1.1.6
"$VENV/bin/python" -m pip install --no-deps -e "$REPO"

cat <<MSG
OpenVoice code installed.

Next, download/extract OpenVoice checkpoints_v2 into:
  $REPO/checkpoints_v2

Then build a reference voice:
  npm run build:voice-reference

Use the provider:
  OPENVOICE_COMMAND="$VENV/bin/python" node scripts/build_audio_performance.js episodes/<episode-id> --provider openvoice --force
MSG
