#!/bin/bash
#
# Runs e2e/add-session.ad against a pinned, Empty Topic in a sandboxed Muxify
# on this Mac, the dev Host (see e2e/sandbox.sh), then checks that the Topic
# has the Session the suite made at a folder whose name has spaces.
#
# The folder is outside the sandbox, because the suite types its path. It is
# removed when the run ends, also when it fails.
#
#   bash e2e/add-session.sh

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail

APP=dev.muxify.app
TITLE="e2e Add Session"
DIR="/tmp/muxify e2e add"
SESSION="muxifye2eadd/e2e-add-session"
SETTINGS="$(xcrun simctl get_app_container "${MUXIFY_E2E_DEVICE:-booted}" "$APP" data)/Documents/muxify-settings.json"

trap 'rmdir "$DIR" 2>/dev/null' EXIT

python3 - "$SETTINGS" <<'PY'
import json, sys
path = sys.argv[1]
settings = json.load(open(path))
settings.pop("hostListPreferences", None)
settings["hostScreenLists"] = ["topics", "sessions"]
json.dump(settings, open(path, "w"))
PY

mkdir -p "$DIR"
id=$(muxify topic new "$TITLE" --json | python3 -c 'import json, sys; print(json.load(sys.stdin)["changed"]["topic_id"])') || exit 1
muxify topic pin --topic "$id" --json >/dev/null || exit 1

driver=./e2e/add-session.ad
if [ "${1:-}" = "old-cli" ]; then driver=./e2e/add-session-old-cli.ad; fi
device=()
[ -z "${MUXIFY_E2E_DEVICE:-}" ] || device=(--udid "$MUXIFY_E2E_DEVICE")
agent-device test "$driver" "${device[@]}" || exit 1

muxify topic show --topic "$id" --json | python3 -c '
import json, sys
topic = json.load(sys.stdin)["topic"]
names = [s["name"] for s in topic["sessions"]]
assert names == [sys.argv[1]], topic
print("the Mac has the Topic, with", names[0])
' "$SESSION" || exit 1
at=$(tmux display-message -p -t "=$SESSION:" '#{session_path}')
# /tmp is a link to /private/tmp, and tmux gives the resolved path.
[ "$at" = "$(cd "$DIR" && pwd -P)" ] || { echo "the Session is at $at, not at $DIR"; exit 1; }
echo "the Session runs at $DIR"
