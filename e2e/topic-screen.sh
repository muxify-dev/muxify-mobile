#!/bin/bash
#
# Runs e2e/topic-screen.ad against two throwaway Topics on this Mac, which is
# the dev Host: a live one, with a Note, a Tag and one Session, and an Empty
# one. Both are pinned, so they are at the top of the Topics list.
#
# The suite needs the Topics list on, so the app's settings file gets it for
# the run. The Topics, their Session and the settings file are put back when
# the run ends, also when it fails.
#
#   bash e2e/topic-screen.sh

set -uo pipefail

APP=dev.muxify.app
DIR=/tmp/muxify-e2e-topic-screen
SETTINGS="$(xcrun simctl get_app_container booted "$APP" data)/Documents/muxify-settings.json"
SAVED=$(mktemp)
made=()

topic_new() {
  muxify topic new "$@" --json | python3 -c 'import json, sys; print(json.load(sys.stdin)["changed"]["topic_id"])'
}

cleanup() {
  for id in "${made[@]}"; do muxify topic forget --kill-sessions --topic "$id" --json >/dev/null; done
  cp "$SAVED" "$SETTINGS"
  rm -f "$SAVED"
}
trap cleanup EXIT

for title in "e2e Topic Screen live" "e2e Topic Screen empty"; do
  muxify topic forget --kill-sessions --topic "$title" --json >/dev/null 2>&1
done

cp "$SETTINGS" "$SAVED"
python3 - "$SETTINGS" <<'PY'
import json, sys
path = sys.argv[1]
settings = json.load(open(path))
settings["hostScreenLists"] = ["topics", "sessions"]
json.dump(settings, open(path, "w"))
PY

mkdir -p "$DIR"
live=$(topic_new "e2e Topic Screen live" --tag work) || exit 1
made+=("$live")
muxify topic add-session "$DIR" --topic "$live" --json >/dev/null || exit 1
muxify topic note "Seeded by e2e" --topic "$live" --json >/dev/null || exit 1
empty=$(topic_new "e2e Topic Screen empty") || exit 1
made+=("$empty")
muxify topic pin --topic "$empty" --json >/dev/null || exit 1
muxify topic pin --topic "$live" --json >/dev/null || exit 1

agent-device test ./e2e/topic-screen.ad
