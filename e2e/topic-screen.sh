#!/bin/bash
#
# Runs e2e/topic-screen.ad against two Topics in a sandboxed Muxify on this
# Mac, the dev Host (see e2e/sandbox.sh): a live one, with a Note, a Tag and
# one Session, and an Empty one. Both are pinned, so they are at the top of the
# Topics list. The suite needs the Topics list on, so the app's settings get it
# for the run.
#
#   bash e2e/topic-screen.sh

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail

APP=dev.muxify.app
DIR="$MUXIFY_E2E_ROOT/muxify-e2e-topic-screen"
SETTINGS="$(xcrun simctl get_app_container booted "$APP" data)/Documents/muxify-settings.json"

topic_new() {
  muxify topic new "$@" --json | python3 -c 'import json, sys; print(json.load(sys.stdin)["changed"]["topic_id"])'
}

python3 - "$SETTINGS" <<'PY'
import json, sys
path = sys.argv[1]
settings = json.load(open(path))
settings["hostScreenLists"] = ["topics", "sessions"]
json.dump(settings, open(path, "w"))
PY

mkdir -p "$DIR"
live=$(topic_new "e2e Topic Screen live" --tag work) || exit 1
muxify topic add-session "$DIR" --topic "$live" --json >/dev/null || exit 1
muxify topic note "Seeded by e2e" --topic "$live" --json >/dev/null || exit 1
empty=$(topic_new "e2e Topic Screen empty") || exit 1
muxify topic pin --topic "$empty" --json >/dev/null || exit 1
muxify topic pin --topic "$live" --json >/dev/null || exit 1

agent-device test ./e2e/topic-screen.ad
