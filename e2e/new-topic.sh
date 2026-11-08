#!/bin/bash
#
# Runs e2e/new-topic.ad with the Topics list on, then checks on this Mac, the
# dev Host, that the Topic it made has its title and the Tag #work. Then runs
# e2e/plus-without-topics.ad with the Topics list off.
#
# The Topic and the app's settings file are put back when the run ends, also
# when it fails.
#
#   bash e2e/new-topic.sh

set -uo pipefail

APP=dev.muxify.app
TITLE="e2e New Topic it's"
SETTINGS="$(xcrun simctl get_app_container booted "$APP" data)/Documents/muxify-settings.json"
SAVED=$(mktemp)

forget() { muxify topic forget --topic "$TITLE" --json >/dev/null 2>&1; }

cleanup() {
  forget
  cp "$SAVED" "$SETTINGS"
  rm -f "$SAVED"
}
trap cleanup EXIT

lists() {
  python3 - "$SETTINGS" "$1" <<'PY'
import json, sys
path, lists = sys.argv[1], sys.argv[2].split(",")
settings = json.load(open(path))
settings["hostScreenLists"] = lists
json.dump(settings, open(path, "w"))
PY
}

forget
cp "$SETTINGS" "$SAVED"

lists topics,sessions
agent-device test ./e2e/new-topic.ad || exit 1

muxify topic show --topic "$TITLE" --json | python3 -c '
import json, sys
topic = json.load(sys.stdin)["topic"]
assert topic["title"] == sys.argv[1], topic
assert topic["tags"] == ["work"], topic
print("the Mac has the Topic, with #work")
' "$TITLE" || exit 1
id=$(muxify topic show --topic "$TITLE" --json | python3 -c 'import json, sys; print(json.load(sys.stdin)["topic"]["id"])')
muxify topic forget --topic "$id" --json >/dev/null || exit 1

lists sessions
agent-device test ./e2e/plus-without-topics.ad
