#!/bin/bash
#
# The Session and Window Actions and Mark All as Read, against a sandboxed
# Muxify on this Mac, the dev Host (see e2e/sandbox.sh). After each step it
# waits until tmux or the Mac, asked through the CLI, has the change, and then
# until the screen shows it from the Host Server's push.
#
# - The Sessions tab: Rename Session…, Move to Topic…, Remove from Topic and
#   Kill Session… in a Session row's long-press menu. Remove from Topic is
#   offered only for the Session in a Topic, and Kill asks first.
# - The Title Sheet's Windows: Rename Window… and Close Window… in a Window
#   row's long-press menu. Close asks first.
# - Host Options: Mark All as Read. The Topic card's menu then offers Mark as
#   Unread in place of Mark as Read.
#
#   bash e2e/session-window-actions.sh

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail

APP=dev.muxify.app
SNAPSHOT="$MUXIFY_E2E_ROOT/snapshot.json"

fail() { echo "FAIL: $*"; agent-device close >/dev/null 2>&1; exit 1; }

case "$(tmux display-message -p '#{socket_path}')" in
  "$(cd "$MUXIFY_E2E_ROOT" && pwd -P)"/*) ;;
  *) echo "tmux is not the sandbox's server"; exit 1 ;;
esac

# Writes the screen's tree to $SNAPSHOT. A snapshot taken while the screen moves can fail, so it tries again.
snap() {
  for _ in $(seq 10); do
    agent-device snapshot -i --json >"$SNAPSHOT" 2>/dev/null && python3 -c 'import json, sys; json.load(open(sys.argv[1]))["data"]' "$SNAPSHOT" 2>/dev/null && return 0
    sleep 0.5
  done
  return 1
}

# The labels of the menu items in $1 (joined by |) that are on screen now, in their order.
menu_items() {
  snap || return 1
  python3 - "$SNAPSHOT" "$1" <<'PY'
import json, sys
words = sys.argv[2].split("|")
nodes = json.load(open(sys.argv[1]))["data"]["nodes"]
print("|".join(n["label"] for n in nodes if n.get("label") in words and "Button" in n.get("type", "") + n.get("role", "")))
PY
}

# Waits up to 10 s for the shell test $1 to hold.
until_true() {
  for _ in $(seq 40); do
    eval "$1" && return 0
    sleep 0.25
  done
  return 1
}

has_session() { tmux has-session -t "=$1" 2>/dev/null; }
window_names() { tmux list-windows -t '=0' -F '#{window_name}' | tr '\n' ' '; }
# The Topic of the Session with tmux id $1, or none.
topic_of() {
  muxify environment show --json | python3 -c '
import json, sys
e = json.load(sys.stdin)
print(next((s["topic"] or "none") for s in e["sessions"] if s["id"] == sys.argv[1]))' "$1"
}
unread_topics() {
  muxify environment show --json | python3 -c '
import json, sys
e = json.load(sys.stdin)
u = e["unpinned"]
print(sum(1 for c in e["pinned"] + u.get("places", []) + u.get("guests", []) + u.get("bench", []) if c.get("mark") == "unread"))'
}

# A Topic with one Session, which is Unread; a Session in no Topic; and a second Window in Session 0.
topic=$(muxify topic new Ship --json | python3 -c 'import json, sys; print(json.load(sys.stdin)["changed"]["topic_id"])') || exit 1
mkdir -p "$MUXIFY_E2E_ROOT/ship"
muxify topic add-session "$MUXIFY_E2E_ROOT/ship" --topic "$topic" --json >/dev/null || exit 1
muxify topic mark-unread --topic-only --topic "$topic" --json >/dev/null || exit 1
in_topic_id=$(tmux list-sessions -F '#{session_id} #{session_name}' | awk '$2 != "0" { print $1; exit }')
[ -n "$in_topic_id" ] || fail "no Session in the Topic"
in_topic=$(tmux display-message -p -t "$in_topic_id" '#{session_name}')
tmux new-session -d -s scratch -c "$MUXIFY_E2E_ROOT" || exit 1
tmux new-window -d -t '=0:' -n logs 'exec bash' || exit 1
[ "$(unread_topics)" = 1 ] || fail "the Topic is not Unread on the Mac"

# Long-presses the row labelled $1, checks that its menu is exactly $2, and presses $3.
menu() {
  local items
  agent-device wait "label=\"$1\"" 15000 >/dev/null || fail "no $1"
  agent-device longpress "label=\"$1\"" 1000 --settle >/dev/null
  agent-device wait "role=button label=\"$3\"" 5000 >/dev/null || fail "no $3 in the menu of $1"
  items=$(menu_items "Rename Session…|Move to Topic…|Remove from Topic|Kill Session…|Rename Window…|Close Window…|Mark as Read|Mark as Unread")
  [ "$items" = "$2" ] || fail "the menu of $1 is '$items', not '$2'"
  agent-device press "role=button label=\"$3\"" --settle >/dev/null
}

# Types $2 into the name sheet's field $1 and saves.
rename_to() {
  agent-device wait "label=\"$1\"" 8000 >/dev/null || fail "the name sheet did not open"
  agent-device fill "label=\"$1\"" "$2" >/dev/null || fail "could not type into $1"
  agent-device press 'label="Save"' --settle >/dev/null || fail "no Save on the name sheet"
  agent-device wait absent "label=\"$1\"" 8000 >/dev/null || fail "the name sheet did not close"
}

agent-device open "$APP" --platform ios --relaunch >/dev/null 2>&1
agent-device wait 'label="Host Dev Host"' 25000 >/dev/null || fail "no Dev Host"
agent-device press 'label="Host Dev Host"' >/dev/null 2>&1
agent-device wait 'label="Host Options"' 15000 >/dev/null || fail "no Host Screen"
agent-device wait 1500 >/dev/null 2>&1

echo "== Sessions tab"
menu "Session scratch" "Rename Session…|Move to Topic…|Kill Session…" "Rename Session…"
rename_to "Session name" "renamed"
until_true 'has_session renamed' || fail "tmux has no Session renamed"
agent-device wait 'label="Session renamed"' 10000 >/dev/null || fail "the Sessions tab does not show renamed"
echo "ok: Rename Session"

menu "Session $in_topic" "Rename Session…|Move to Topic…|Remove from Topic|Kill Session…" "Remove from Topic"
until_true '[ "$(topic_of "$in_topic_id")" = none ]' || fail "the Mac still has $in_topic in the Topic"
# The Host may give the Session its name with no Topic; its row no longer offers Remove from Topic.
removed=$(tmux display-message -p -t "$in_topic_id" '#{session_name}')
sleep 1
menu "Session $removed" "Rename Session…|Move to Topic…|Kill Session…" "Rename Session…"
agent-device press 'label="Cancel"' --settle >/dev/null || fail "no Cancel on the name sheet"
agent-device wait absent 'label="Session name"' 8000 >/dev/null || fail "Cancel did not close the name sheet"
echo "ok: Remove from Topic"

menu "Session renamed" "Rename Session…|Move to Topic…|Kill Session…" "Kill Session…"
agent-device wait 'role=button label="Kill Session"' 5000 >/dev/null || fail "Kill Session… did not ask first"
has_session renamed || fail "tmux stopped the Session before the confirm"
agent-device press 'role=button label="Kill Session"' --settle >/dev/null
until_true '! has_session renamed' || fail "tmux still has the Session renamed"
agent-device wait absent 'label="Session renamed"' 10000 >/dev/null || fail "the Sessions tab still shows renamed"
echo "ok: Kill Session"

echo "== Mark All as Read"
agent-device press 'label="Host Options"' --settle >/dev/null
agent-device press 'label="Mark All as Read"' --settle >/dev/null || fail "no Mark All as Read in Host Options"
until_true '[ "$(unread_topics)" = 0 ]' || fail "the Mac still has an Unread Topic"
agent-device press 'label="Board"' --settle >/dev/null || fail "no Board tab"
menu "Topic Ship" "Mark as Unread" "Mark as Unread"
until_true '[ "$(unread_topics)" = 1 ]' || fail "Mark as Unread did not reach the Mac"
echo "ok: Mark All as Read, and the card's menu follows"

echo "== Title Sheet Windows"
agent-device press 'label="Sessions"' --settle >/dev/null || fail "no Sessions tab"
agent-device press 'label="Session 0"' >/dev/null 2>&1
agent-device wait 'id="pane-command"' 20000 >/dev/null || fail "never reached Connected"
agent-device wait 1500 >/dev/null 2>&1
open_title_sheet() {
  for _ in 1 2 3; do
    agent-device press 'id="header-title"' >/dev/null 2>&1
    agent-device wait 'label="Close Choose"' 8000 >/dev/null 2>&1 && return 0
  done
  fail "the Title Sheet never opened"
}
open_title_sheet
menu "logs" "Rename Window…|Close Window…" "Rename Window…"
rename_to "Window name" "tail"
until_true '[[ " $(window_names)" == *" tail "* ]]' || fail "tmux has no Window tail: $(window_names)"
open_title_sheet
agent-device wait 'label="tail"' 10000 >/dev/null || fail "the Title Sheet does not show tail"
echo "ok: Rename Window"

menu "tail" "Rename Window…|Close Window…" "Close Window…"
agent-device wait 'role=button label="Close Window"' 5000 >/dev/null || fail "Close Window… did not ask first"
agent-device press 'role=button label="Close Window"' --settle >/dev/null
until_true '[[ " $(window_names)" != *" tail "* ]]' || fail "tmux still has the Window tail"
agent-device wait absent 'label="tail"' 10000 >/dev/null || fail "the Title Sheet still shows tail"
echo "ok: Close Window"

agent-device close >/dev/null 2>&1
echo "PASS"
