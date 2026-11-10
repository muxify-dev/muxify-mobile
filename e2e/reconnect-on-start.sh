#!/bin/bash
#
# Runs the Reconnect on start suites against a sandboxed Muxify on this Mac,
# the dev Host (see e2e/sandbox.sh), in a Session named e2e-reconnect. The
# app's settings file gets the switch for each suite.
#
#   bash e2e/reconnect-on-start.sh

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail

APP=dev.muxify.app
device=()
[ -z "${MUXIFY_E2E_DEVICE:-}" ] || device=(--udid "$MUXIFY_E2E_DEVICE")
DOCUMENTS="$(xcrun simctl get_app_container "${MUXIFY_E2E_DEVICE:-booted}" "$APP" data)/Documents"
SETTINGS="$DOCUMENTS/muxify-settings.json"
RECORDS="$DOCUMENTS/muxify-records.json"
SESSION=e2e-reconnect

tmux new-session -d -s "$SESSION" || exit 1

# Sets one key of a JSON file in the app's Documents.
set_key() {
  xcrun simctl terminate "${MUXIFY_E2E_DEVICE:-booted}" "$APP" >/dev/null 2>&1
  python3 - "$1" "$2" "$3" <<'PY'
import json, sys
path, key, value = sys.argv[1:]
data = json.load(open(path))
data[key] = json.loads(value)
json.dump(data, open(path, "w"), indent=2)
PY
}

set_key "$SETTINGS" reconnectOnStart true
agent-device test ./e2e/reconnect-on-start.ad "${device[@]}" || exit 1

set_key "$SETTINGS" reconnectOnStart false
agent-device test ./e2e/reconnect-off.ad "${device[@]}" || exit 1

set_key "$SETTINGS" reconnectOnStart true
host=$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["lastPlace"]["hostId"])' "$RECORDS")
set_key "$RECORDS" lastPlace "{\"hostId\": \"$host\", \"session\": \"$SESSION-later\", \"topicId\": null}"
agent-device test ./e2e/reconnect-failed.ad "${device[@]}" || exit 1
tmux new-session -d -s "$SESSION-later" || exit 1
agent-device test ./e2e/reconnect-try-again.ad "${device[@]}" || exit 1

set_key "$RECORDS" lastPlace "{\"hostId\": \"$host\", \"session\": \"$SESSION-gone\", \"topicId\": null}"
agent-device test ./e2e/reconnect-go-home.ad "${device[@]}" || exit 1

# The suite's Disconnect must have cleared the Last Place.
python3 -c 'import json, sys; sys.exit(json.load(open(sys.argv[1])).get("lastPlace") is not None)' "$RECORDS" \
  || { echo "the Last Place survived the Disconnect"; exit 1; }
echo "Reconnect on start: all suites passed"
