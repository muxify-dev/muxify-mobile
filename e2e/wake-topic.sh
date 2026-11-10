#!/bin/bash
#
# Runs e2e/wake-topic.ad against three Dormant Topics in a sandboxed Muxify on
# this Mac, the dev Host (see e2e/sandbox.sh), then checks on the sandbox's
# tmux server that each one woke: Reopen and Start Fresh from a card,
# and Reopen from the long-press menu of a Topic card on the Host Screen.
#
# Reopen makes real Sessions, so this runs only through the sandbox, on its own
# tmux server. A Topic is Dormant when its Session is gone and it still
# remembers the Session, so the suite makes each Topic with a Session and then
# kills that Session.
#
#   bash e2e/wake-topic.sh

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail

APP=dev.muxify.app
SETTINGS="$(xcrun simctl get_app_container booted "$APP" data)/Documents/muxify-settings.json"

# Reopen and Start Fresh are Mac commands on the Host's tmux server. Make sure
# this one is the sandbox's before the suite stops any Session on it.
# /tmp is a link to /private/tmp, and tmux gives the resolved path.
case "$(tmux display-message -p '#{socket_path}')" in
  "$(cd "$MUXIFY_E2E_ROOT" && pwd -P)"/*) ;;
  *) echo "tmux is not the sandbox's server"; exit 1 ;;
esac

python3 - "$SETTINGS" <<'PY'
import json, sys
path = sys.argv[1]
settings = json.load(open(path))
settings["hostScreenLists"] = ["topics", "sessions"]
json.dump(settings, open(path, "w"))
PY

# One Dormant Topic: made with a Session at a folder of its own, pinned, and then
# left with no live Session.
dormant_topic() {
  local title=$1 folder="$MUXIFY_E2E_ROOT/$2" id
  mkdir -p "$folder"
  id=$(muxify topic new "$title" --json | python3 -c 'import json, sys; print(json.load(sys.stdin)["changed"]["topic_id"])') || exit 1
  muxify topic add-session "$folder" --topic "$id" --json >/dev/null || exit 1
  muxify topic pin --topic "$id" --json >/dev/null || exit 1
  tmux kill-session -t "=$2/${title// /-}" || exit 1
  echo "$id"
}

reopened=$(dormant_topic "e2e-wake-reopen" wakea) || exit 1
fresh=$(dormant_topic "e2e-wake-fresh" wakeb) || exit 1
menu=$(dormant_topic "e2e-wake-menu" wakec) || exit 1

for id in "$reopened" "$fresh" "$menu"; do
  state=$(muxify topic show --topic "$id" --json | python3 -c 'import json, sys; print(json.load(sys.stdin)["topic"]["state"])')
  [ "$state" = dormant ] || { echo "the Topic is $state before the suite, not dormant"; exit 1; }
done

agent-device test ./e2e/wake-topic.ad || exit 1

for id in "$reopened" "$fresh" "$menu"; do
  muxify topic show --topic "$id" --json | python3 -c '
import json, sys
topic = json.load(sys.stdin)["topic"]
assert topic["state"] == "live", topic
print("the Mac has", topic["label"], "live with", [s["name"] for s in topic["sessions"]])
' || exit 1
done
tmux list-sessions -F '#{session_name}'
for session in wakea/e2e-wake-reopen wakeb/e2e-wake-fresh wakec/e2e-wake-menu; do
  tmux has-session -t "=$session" || { echo "tmux has no Session $session"; exit 1; }
done
echo "the sandbox's tmux server has all three Sessions"
