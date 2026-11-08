#!/bin/bash
#
# Runs the Reconnect on start suites against the dev Host, in a throwaway
# Session named e2e-reconnect. The app's settings file gets the switch for each
# suite, and the records file starts with no Last Place. The Session and both
# files are put back when the run ends, also when it fails.
#
#   bash e2e/reconnect-on-start.sh

set -uo pipefail

APP=dev.muxify.app
DOCUMENTS="$(xcrun simctl get_app_container booted "$APP" data)/Documents"
SETTINGS="$DOCUMENTS/muxify-settings.json"
RECORDS="$DOCUMENTS/muxify-records.json"
SAVED_SETTINGS=$(mktemp)
SAVED_RECORDS=$(mktemp)
SESSION=e2e-reconnect

cleanup() {
  xcrun simctl terminate booted "$APP" >/dev/null 2>&1
  cp "$SAVED_SETTINGS" "$SETTINGS"
  cp "$SAVED_RECORDS" "$RECORDS"
  rm -f "$SAVED_SETTINGS" "$SAVED_RECORDS"
  tmux kill-session -t "=$SESSION" 2>/dev/null
}
trap cleanup EXIT

cp "$SETTINGS" "$SAVED_SETTINGS"
cp "$RECORDS" "$SAVED_RECORDS"
tmux kill-session -t "=$SESSION" 2>/dev/null
tmux new-session -d -s "$SESSION" || exit 1

# Sets one key of a JSON file in the app's Documents, or deletes it for "-".
set_key() {
  xcrun simctl terminate booted "$APP" >/dev/null 2>&1
  python3 - "$1" "$2" "$3" <<'PY'
import json, sys
path, key, value = sys.argv[1:]
data = json.load(open(path))
if value == "-":
    data.pop(key, None)
else:
    data[key] = json.loads(value)
json.dump(data, open(path, "w"), indent=2)
PY
}

set_key "$RECORDS" lastPlace -
set_key "$SETTINGS" reconnectOnStart true
agent-device test ./e2e/reconnect-on-start.ad || exit 1

set_key "$SETTINGS" reconnectOnStart false
agent-device test ./e2e/reconnect-off.ad || exit 1

set_key "$SETTINGS" reconnectOnStart true
host=$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["lastPlace"]["hostId"])' "$RECORDS")
set_key "$RECORDS" lastPlace "{\"hostId\": \"$host\", \"session\": \"$SESSION-gone\", \"topicId\": null}"
agent-device test ./e2e/reconnect-go-home.ad || exit 1

# The suite's Disconnect must have cleared the Last Place.
python3 -c 'import json, sys; sys.exit(json.load(open(sys.argv[1])).get("lastPlace") is not None)' "$RECORDS" \
  || { echo "the Last Place survived the Disconnect"; exit 1; }
echo "Reconnect on start: all suites passed"
