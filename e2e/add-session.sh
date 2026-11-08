#!/bin/bash
#
# Runs e2e/add-session.ad against a throwaway, pinned, Empty Topic on this Mac,
# which is the dev Host, then checks on the Mac that the Topic has the Session
# the suite made at a folder whose name has spaces.
#
# The Topic is forgotten, its Session is killed with tmux kill-session and the
# app's settings file is put back when the run ends, also when it fails.
#
#   bash e2e/add-session.sh

set -uo pipefail

APP=dev.muxify.app
TITLE="e2e Add Session"
DIR="/tmp/muxify e2e add"
SESSION="muxifye2eadd/e2e-add-session"
SETTINGS="$(xcrun simctl get_app_container booted "$APP" data)/Documents/muxify-settings.json"
SAVED=$(mktemp)

cleanup() {
  muxify topic forget --topic "$TITLE" --json >/dev/null 2>&1
  tmux kill-session -t "=$SESSION" 2>/dev/null
  cp "$SAVED" "$SETTINGS"
  rm -f "$SAVED"
  rmdir "$DIR" 2>/dev/null
}
trap cleanup EXIT

muxify topic forget --topic "$TITLE" --json >/dev/null 2>&1
tmux kill-session -t "=$SESSION" 2>/dev/null

cp "$SETTINGS" "$SAVED"
python3 - "$SETTINGS" <<'PY'
import json, sys
path = sys.argv[1]
settings = json.load(open(path))
settings["hostScreenLists"] = ["topics", "sessions"]
json.dump(settings, open(path, "w"))
PY

mkdir -p "$DIR"
id=$(muxify topic new "$TITLE" --json | python3 -c 'import json, sys; print(json.load(sys.stdin)["changed"]["topic_id"])') || exit 1
muxify topic pin --topic "$id" --json >/dev/null || exit 1

agent-device test ./e2e/add-session.ad || exit 1

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
