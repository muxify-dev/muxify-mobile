#!/bin/bash
#
# Runs the Edit sheet suites against a Topic in a sandboxed Muxify on this Mac,
# the dev Host (see e2e/sandbox.sh), and checks after each one that the Mac has
# the values the phone saved.
#
# The Topic starts with a Note, #work and #e2eold, a Tag that the Config does
# not define: the script gives it that Tag through a copy of the Config that
# defines it. It is pinned, so it is at the top of the Topics list.
#
#   bash e2e/edit-topic.sh

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail

APP=dev.muxify.app
TITLE="e2e Edit Topic"
RENAMED="e2e Edited it's"
SETTINGS="$(xcrun simctl get_app_container booted "$APP" data)/Documents/muxify-settings.json"
WITH_E2EOLD="$MUXIFY_E2E_ROOT/with-e2eold.yaml"

# Asserts on the Topic as the Mac has it. $1 is a Python expression of `topic`.
mac_has() {
  muxify topic show --topic "$id" --json | python3 -c '
import json, sys
topic = json.load(sys.stdin)["topic"]
assert eval(sys.argv[1]), topic
print("the Mac has", topic["title"], topic["note"], topic["tags"])
' "$1"
}

python3 - "$SETTINGS" <<'PY'
import json, sys
path = sys.argv[1]
settings = json.load(open(path))
settings.pop("hostListPreferences", None)
settings["hostScreenLists"] = ["topics", "sessions"]
json.dump(settings, open(path, "w"))
PY

{ cat "$MUXIFY_CONFIG"; printf '    e2eold:\n      color: {light: red, dark: red}\n'; } >"$WITH_E2EOLD"

id=$(muxify topic new "$TITLE" --tag work --json | python3 -c 'import json, sys; print(json.load(sys.stdin)["changed"]["topic_id"])') || exit 1
MUXIFY_CONFIG="$WITH_E2EOLD" muxify topic tag add e2eold --topic "$id" --json >/dev/null || exit 1
muxify topic note "e2e first note" --topic "$id" --json >/dev/null || exit 1
muxify topic pin --topic "$id" --json >/dev/null || exit 1

mkdir -p "$MUXIFY_E2E_ROOT/edit-topic"
muxify topic add-session "$MUXIFY_E2E_ROOT/edit-topic" --topic "$id" --json >/dev/null || exit 1

agent-device test ./e2e/edit-topic.ad || exit 1
mac_has "topic['title'] == \"$RENAMED\" and topic['note'] == 'e2e second note' and sorted(topic['tags']) == ['personal', 'work']" || exit 1

agent-device test ./e2e/edit-topic-clear.ad || exit 1
mac_has "topic['note'] is None and topic['tags'] == ['work'] and topic['title'] == \"$RENAMED\"" || exit 1
