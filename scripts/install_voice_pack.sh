#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="${1:-}"
TARGET="${PIPER_MODEL_TARGET:-$ROOT/assets/piper}"

if [[ -z "$SOURCE" ]]; then
  echo "Usage: scripts/install_voice_pack.sh <voice-pack-directory-or-zip>" >&2
  exit 1
fi

mkdir -p "$TARGET"
TMP=""
cleanup() {
  [[ -n "$TMP" ]] && rm -rf "$TMP"
}
trap cleanup EXIT

if [[ -d "$SOURCE" ]]; then
  SOURCE_DIR="$SOURCE"
elif [[ -f "$SOURCE" && "$SOURCE" == *.zip ]]; then
  command -v unzip >/dev/null 2>&1 || {
    echo "unzip is required to install a ZIP voice pack." >&2
    exit 1
  }
  TMP="$(mktemp -d)"
  unzip -q "$SOURCE" -d "$TMP"
  SOURCE_DIR="$TMP"
else
  echo "Voice pack not found: $SOURCE" >&2
  exit 1
fi

mapfile -t MODELS < <(find "$SOURCE_DIR" -type f -name '*.onnx' -print)
if [[ ${#MODELS[@]} -eq 0 ]]; then
  echo "No .onnx voice models were found in $SOURCE." >&2
  exit 1
fi

for MODEL in "${MODELS[@]}"; do
  CONFIG="$MODEL.json"
  if [[ ! -f "$CONFIG" ]]; then
    echo "Missing model config: $CONFIG" >&2
    exit 1
  fi
  NAME="$(basename "$MODEL" .onnx)"
  DEST="$TARGET/$NAME"
  mkdir -p "$DEST"
  cp "$MODEL" "$DEST/$NAME.onnx"
  cp "$CONFIG" "$DEST/$NAME.onnx.json"
  echo "Installed voice model: $NAME"
done

if [[ -f "$SOURCE_DIR/VOICE_PACK_SHA256SUMS" ]]; then
  cp "$SOURCE_DIR/VOICE_PACK_SHA256SUMS" "$TARGET/VOICE_PACK_SHA256SUMS"
fi

echo "Voice models installed under $TARGET"
