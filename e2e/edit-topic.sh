#!/bin/bash
#
# Runs the Edit sheet suites against a throwaway Topic on this Mac, the dev
# Host, and checks after each one that the Mac has the values the phone saved.
#
# The Topic starts with a Note, #work and #e2eold, a Tag that the Config does
# not define: the script gives it that Tag through a copy of the Config that
# defines it. It is pinned, so it is at the top of the Topics list.
#
# The Topic and the app's settings file are put back when the run ends, also
# when it fails.
#
#   bash e2e/edit-topic.sh

set -uo pipefail

APP=dev.muxify.app
TITLE="e2e Edit Topic"
RENAMED="e2e Edited it's"
SETTINGS="$(xcrun simctl get_app_container booted "$APP" data)/Documents/muxify-settings.json"
SAVED=$(mktemp)
CONFIG=$(mktemp -d)/config.yaml
id=

cleanup() {
  [ -n "$id" ] && muxify topic forget --topic "$id" --json >/dev/null
  cp "$SAVED" "$SETTINGS"
  rm -f "$SAVED" "$CONFIG"
}
trap cleanup EXIT

# Asserts on the Topic as the Mac has it. $1 is a Python expression of `topic`.
mac_has() {
  muxify topic show --topic "$id" --json | python3 -c '
import json, sys
topic = json.load(sys.stdin)["topic"]
assert eval(sys.argv[1]), topic
print("the Mac has", topic["title"], topic["note"], topic["tags"])
' "$1"
}

for title in "$TITLE" "$RENAMED"; do muxify topic forget --topic "$title" --json >/dev/null 2>&1; done

cp "$SETTINGS" "$SAVED"
python3 - "$SETTINGS" <<'PY'
import json, sys
path = sys.argv[1]
settings = json.load(open(path))
settings["hostScreenLists"] = ["topics", "sessions"]
json.dump(settings, open(path, "w"))
PY

python3 - "${MUXIFY_CONFIG:-$HOME/.config/muxify/config.yaml}" "$CONFIG" <<'PY'
import sys
lines = open(sys.argv[1]).read().split("\n")
at = lines.index("  tags:") + 1
lines[at:at] = ["    e2eold:", "      color: {light: red, dark: red}"]
open(sys.argv[2], "w").write("\n".join(lines))
PY

id=$(muxify topic new "$TITLE" --tag work --json | python3 -c 'import json, sys; print(json.load(sys.stdin)["changed"]["topic_id"])') || exit 1
MUXIFY_CONFIG="$CONFIG" muxify topic tag add e2eold --topic "$id" --json >/dev/null || exit 1
muxify topic note "e2e first note" --topic "$id" --json >/dev/null || exit 1
muxify topic pin --topic "$id" --json >/dev/null || exit 1

agent-device test ./e2e/edit-topic.ad || exit 1
mac_has "topic['title'] == \"$RENAMED\" and topic['note'] == 'e2e second note' and sorted(topic['tags']) == ['personal', 'work']" || exit 1

agent-device test ./e2e/edit-topic-clear.ad || exit 1
mac_has "topic['note'] is None and topic['tags'] == ['work'] and topic['title'] == \"$RENAMED\"" || exit 1
