#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
LOG_DIR="$(mktemp -d -t nichefoundry-tests-XXXXXX)"
trap 'rm -rf "$LOG_DIR"' EXIT
TOTAL=0
PHASES=(0 1 2 3 4 5 6 7 8 9 10 11)
PIDS=()

# Every phase runs in its own Node process. Codec-heavy, HTTP-heavy, and
# governance suites therefore cannot leak handles or mutable globals into one
# another. Logs are printed in phase order after every process has exited.
for PHASE in "${PHASES[@]}"; do
  FILE="tests/phase${PHASE}.test.js"
  (
    set +e
    timeout --signal=TERM --kill-after=5s 120s node "$FILE" >"$LOG_DIR/phase${PHASE}.log" 2>&1
    echo $? >"$LOG_DIR/phase${PHASE}.status"
  ) &
  PIDS+=("$!")
  echo "Started ${FILE}"
done

for PID in "${PIDS[@]}"; do wait "$PID"; done

for PHASE in "${PHASES[@]}"; do
  FILE="tests/phase${PHASE}.test.js"
  echo
  echo "=== ${FILE} ==="
  cat "$LOG_DIR/phase${PHASE}.log"
  STATUS="$(cat "$LOG_DIR/phase${PHASE}.status")"
  if [[ "$STATUS" != "0" ]]; then
    echo "FAILED: ${FILE}" >&2
    exit "$STATUS"
  fi
  COUNT="$(grep -c '^test(' "$FILE" || true)"
  TOTAL=$((TOTAL + COUNT))
done

echo
echo "=== NICHEFOUNDRY PHASE 0-11 SUITE ==="
echo "Test definitions passed: ${TOTAL}"
echo "Phase files failed: 0"
