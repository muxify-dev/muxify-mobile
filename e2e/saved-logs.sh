#!/bin/bash
[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"
set -euo pipefail
APP=dev.muxify.app
DEVICE="${MUXIFY_E2E_DEVICE:-booted}"
device=()
[ -z "${MUXIFY_E2E_DEVICE:-}" ] || device=(--udid "$MUXIFY_E2E_DEVICE")

open_logs() {
  agent-device open "$APP" --platform ios --relaunch "${device[@]}"
  agent-device wait 'label="Settings"' 15000
  agent-device press 'label="Settings"' --settle
  agent-device wait 'label="Logs"' 8000
  agent-device press 'label="Logs"' --settle
  agent-device wait 'label="Current launch"' 8000
}

open_logs
agent-device press 'label="Current launch"' --settle
agent-device press 'label="Copy log"' --settle
agent-device wait 'label="Log copied"' 8000
xcrun simctl pbpaste "$DEVICE" > "$MUXIFY_E2E_ROOT/current-log.txt"
python3 - "$MUXIFY_E2E_ROOT/current-log.txt" <<'PY'
import pathlib, sys
text = pathlib.Path(sys.argv[1]).read_text()
assert 'Launch started' in text, text
assert 'Saved logs unavailable' not in text, text
assert 'App: Muxify' in text, text
print('Current launch is saved and can be copied.')
PY
agent-device press 'label="OK"' --settle
agent-device close

open_logs
agent-device wait 'label="Previous launch"' 8000
agent-device press 'label="Previous launch"' --settle
agent-device press 'label="Copy log"' --settle
agent-device wait 'label="Log copied"' 8000
xcrun simctl pbpaste "$DEVICE" > "$MUXIFY_E2E_ROOT/previous-log.txt"
python3 - "$MUXIFY_E2E_ROOT/current-log.txt" "$MUXIFY_E2E_ROOT/previous-log.txt" <<'PY'
import pathlib, sys
before, after = [pathlib.Path(path).read_text() for path in sys.argv[1:]]
assert before in after, 'The previous launch lost saved events.'
print('The complete copied log survives process termination and restart.')
PY
agent-device press 'label="OK"' --settle
agent-device press 'label="All logs"' --settle
agent-device scroll down --until 'label="iOS crash reports"' --max-passes 5 --settle
agent-device wait 'label="iOS crash reports"' 8000
agent-device wait text 'No iOS reports received yet.' 8000
agent-device close
