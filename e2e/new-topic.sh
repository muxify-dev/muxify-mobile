#!/bin/bash
#
# Runs e2e/new-topic.ad with the Topics list on, against a sandboxed Muxify on
# this Mac, the dev Host (see e2e/sandbox.sh), then checks that the Topic it
# made has its title and the Tag #work. Then runs e2e/plus-without-topics.ad
# with the Topics list off.
#
#   bash e2e/new-topic.sh

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail

APP=dev.muxify.app
TITLE="e2e New Topic it's"
SETTINGS="$(xcrun simctl get_app_container booted "$APP" data)/Documents/muxify-settings.json"

lists() {
  python3 - "$SETTINGS" "$1" <<'PY'
import json, sys
path, lists = sys.argv[1], sys.argv[2].split(",")
settings = json.load(open(path))
settings.pop("hostListPreferences", None)
settings["hostScreenLists"] = lists
json.dump(settings, open(path, "w"))
PY
}

lists topics,sessions
agent-device test ./e2e/new-topic.ad || exit 1

muxify topic show --topic "$TITLE" --json | python3 -c '
import json, sys
topic = json.load(sys.stdin)["topic"]
assert topic["title"] == sys.argv[1], topic
assert topic["tags"] == ["work"], topic
print("the Mac has the Topic, with #work")
' "$TITLE" || exit 1

lists sessions
agent-device test ./e2e/plus-without-topics.ad
