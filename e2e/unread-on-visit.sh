#!/bin/bash
#
# Unread on visit, against a sandboxed Muxify on this Mac, the dev Host (see
# e2e/sandbox.sh). Two Topics, Ship and Dock, each have a Session with a done
# Agent that is Unread. Dock is Unread too, and so is Bay, an Empty Topic.
#
# - Opening Ship's card shows its Session's Pane on the Terminal Screen, which
#   sends `mark_read` for the Pane: the Mac makes the Agent read, and back on
#   the Host Screen Ship's card has no mark. Dock's stays.
# - Picking Dock in the Title Sheet switches the Attach to Dock's Session,
#   which makes its Agent read the same way. Dock's own Unread stays: a visit
#   does not clear a Topic's Unread.
# - A tap on Bay's card opens Add a Session, the phone's Empty Topic page,
#   which clears Bay's Unread.
#
#   bash e2e/unread-on-visit.sh

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail

APP=dev.muxify.app
SNAPSHOT="$MUXIFY_E2E_ROOT/snapshot.json"

fail() { echo "FAIL: $*"; agent-device close >/dev/null 2>&1; exit 1; }

case "$(tmux display-message -p '#{socket_path}')" in
  "$(cd "$MUXIFY_E2E_ROOT" && pwd -P)"/*) ;;
  *) echo "tmux is not the sandbox's server"; exit 1 ;;
esac

# Writes the whole screen's tree to $SNAPSHOT: the marks of a card are not interactive. A snapshot taken while the
# screen moves can fail, so it tries again.
snap() {
  for _ in $(seq 10); do
    agent-device snapshot --json >"$SNAPSHOT" 2>/dev/null && python3 -c 'import json, sys; json.load(open(sys.argv[1]))["data"]' "$SNAPSHOT" 2>/dev/null && return 0
    sleep 0.5
  done
  return 1
}

# The mark the card of Topic $1 shows, by its symbol: "unread", "done", another mark, or "none".
card_mark() {
  snap || return 1
  python3 - "$SNAPSHOT" "$1" <<'PY'
import json, sys
nodes = json.load(open(sys.argv[1]))["data"]["nodes"]
card = next((n["rect"] for n in nodes if n.get("label") == "Topic " + sys.argv[2]), None)
if card is None:
    sys.exit(1)
inside = lambda r: card["y"] <= r["y"] + r["height"] / 2 <= card["y"] + card["height"]
marks = {"circle.fill": "unread", "checkmark.circle.fill": "done", "xmark.octagon.fill": "failed",
         "hand.raised.fill": "blocked", "arrow.triangle.2.circlepath": "working"}
print(next((marks[n["identifier"]] for n in nodes if n.get("identifier") in marks and inside(n["rect"])), "none"))
PY
}

# The Mac's mark of Topic $1, or none.
mac_mark() {
  muxify environment show --json | python3 -c '
import json, sys
e = json.load(sys.stdin)
u = e["unpinned"]
cards = e["pinned"] + u.get("places", []) + u.get("guests", []) + u.get("bench", [])
print(next((c.get("mark") or "none") for c in cards if c["kind"] == "topic" and c["topic"]["label"] == sys.argv[1]))' "$1"
}

# The Mac's Agent mark of the Session of Topic $1, or none.
agent_mark() {
  muxify environment show --json | python3 -c '
import json, sys
e = json.load(sys.stdin)
u = e["unpinned"]
cards = e["pinned"] + u.get("places", []) + u.get("guests", []) + u.get("bench", [])
card = next(c for c in cards if c["kind"] == "topic" and c["topic"]["label"] == sys.argv[1])
print(next((s.get("mark") or "none") for s in e["sessions"] if s["id"] == card["sessions"][0]))' "$1"
}

# Waits up to 10 s for the shell test $1 to hold.
until_true() {
  for _ in $(seq 40); do
    eval "$1" && return 0
    sleep 0.25
  done
  return 1
}

# Back from the Terminal Screen to the Host Screen.
back_to_host() {
  for _ in 1 2 3; do
    agent-device is exists 'label="Host Options"' >/dev/null 2>&1 && return 0
    agent-device press 'id="BackButton"' >/dev/null 2>&1
    sleep 1
  done
  agent-device wait 'label="Host Options"' 8000 >/dev/null 2>&1 || fail "Back did not reach the Host Screen"
}

# The Host Screen on the Board tab, and a Title Sheet with the Topics, as in e2e/topic-place.sh.
python3 - "$(xcrun simctl get_app_container "${MUXIFY_E2E_DEVICE:-booted}" "$APP" data)/Documents/muxify-settings.json" <<'PY'
import json, sys
path = sys.argv[1]
settings = json.load(open(path))
settings.pop("hostScreenTabs", None)
records = json.load(open(path.replace("muxify-settings.json", "muxify-records.json")))
settings["chooserListPreferences"] = {host["id"]: ["windows", "topics"] for host in records["hosts"]}
json.dump(settings, open(path, "w"))
PY

# The Mac finds an Agent by its Pane's command, so the fake Agent is sleep under the name claude.
ln -s /bin/sleep "$MUXIFY_E2E_ROOT/claude"
for title in Ship Dock; do
  id=$(muxify topic new "$title" --json | python3 -c 'import json, sys; print(json.load(sys.stdin)["changed"]["topic_id"])') || exit 1
  mkdir -p "$MUXIFY_E2E_ROOT/$title"
  muxify topic add-session "$MUXIFY_E2E_ROOT/$title" --topic "$id" --json >/dev/null || exit 1
  pane=$(tmux list-panes -a -F '#{session_name} #{pane_id}' | awk -v t="$title" 'tolower($1) ~ "^" tolower(t) "/" { print $2 }')
  [ -n "$pane" ] || fail "no Pane in the Session of $title"
  tmux send-keys -t "$pane" "exec $MUXIFY_E2E_ROOT/claude 100000" Enter
  sleep 1
  tmux set -p -t "$pane" @muxify_agent claude
  tmux set -p -t "$pane" @muxify_agent_status done
  # Make the Topic and its Agent Unread. Ship then clears only its Topic mark, so only its Agent stays Unread.
  muxify topic mark-unread --topic "$id" --json >/dev/null || exit 1
  [ "$title" = Dock ] || muxify topic mark-read --topic-only --topic "$id" --json >/dev/null || exit 1
done
bay=$(muxify topic new Bay --json | python3 -c 'import json, sys; print(json.load(sys.stdin)["changed"]["topic_id"])') || exit 1
muxify topic mark-unread --topic-only --topic "$bay" --json >/dev/null || exit 1
[ "$(mac_mark Ship)" = done ] && [ "$(agent_mark Dock)" = done ] && [ "$(mac_mark Dock)" = unread ] && [ "$(mac_mark Bay)" = unread ] \
  || fail "the Mac has Ship $(mac_mark Ship), Dock $(mac_mark Dock) with its Agent $(agent_mark Dock), Bay $(mac_mark Bay)"

agent-device open "$APP" --platform ios --relaunch >/dev/null 2>&1
agent-device wait 'label="Host Dev Host"' 25000 >/dev/null || fail "no Dev Host"
agent-device press 'label="Host Dev Host"' >/dev/null 2>&1
agent-device wait 'label="Topic Ship"' 15000 >/dev/null || fail "no Topics on the Host Screen"
until_true '[ "$(card_mark Ship)" = done ] && [ "$(card_mark Dock)" = unread ]' \
  || fail "the cards do not show the marks: Ship $(card_mark Ship), Dock $(card_mark Dock)"
echo "ok: Ship shows its done Agent, and Dock its Unread"

echo "== the Terminal Screen shows Ship's Pane"
agent-device press 'label="Topic Ship"' >/dev/null 2>&1
agent-device wait 'id="topic-title"' 20000 >/dev/null 2>&1 || fail "Ship did not attach"
until_true '[ "$(mac_mark Ship)" = none ]' || fail "the Mac still has Ship $(mac_mark Ship)"
[ "$(agent_mark Dock)" = done ] || fail "the visit of Ship changed Dock's Agent to $(agent_mark Dock)"
back_to_host
until_true '[ "$(card_mark Ship)" = none ]' || fail "Ship's card still shows $(card_mark Ship)"
[ "$(card_mark Dock)" = unread ] || fail "Dock's card shows $(card_mark Dock) with no visit"
echo "ok: Ship's Agent is read, and its card has no mark"

echo "== the Attach switches to Dock's Session"
agent-device press 'label="Topic Ship"' >/dev/null 2>&1
agent-device wait 'id="topic-title"' 20000 >/dev/null 2>&1 || fail "Ship did not attach again"
sleep 1.5
opened=
for _ in 1 2 3; do
  agent-device press 'id="header-title"' >/dev/null 2>&1
  agent-device wait 'label="Close Choose"' 8000 >/dev/null 2>&1 && { opened=1; break; }
done
[ -n "$opened" ] || fail "the Title Sheet never opened"
sleep 1
agent-device press 'label="Topics"' >/dev/null 2>&1
agent-device wait 'label="Topic Dock"' 15000 >/dev/null 2>&1 || fail "the Title Sheet does not list Dock"
sleep 1
agent-device press 'label="Topic Dock"' >/dev/null 2>&1
until_true '[ "$(agent_mark Dock)" = none ]' || fail "the Mac still has Dock's Agent $(agent_mark Dock)"
agent-device wait 'id="topic-title"' 20000 >/dev/null 2>&1 || fail "Dock did not attach"
[ "$(mac_mark Dock)" = unread ] || fail "the visit of Dock cleared its own Unread: the Mac has $(mac_mark Dock)"
back_to_host
until_true '[ "$(card_mark Dock)" = unread ]' || fail "Dock's card shows $(card_mark Dock), not its Unread"
echo "ok: Dock's Agent is read, and Dock stays Unread"

echo "== a tap on the Empty Topic Bay"
until_true '[ "$(card_mark Bay)" = unread ]' || fail "Bay's card shows $(card_mark Bay), not its Unread"
agent-device press 'label="Topic Bay"' >/dev/null 2>&1
agent-device wait 'label="Search folders"' 15000 >/dev/null 2>&1 || fail "a tap on Bay did not open Add a Session"
until_true '[ "$(mac_mark Bay)" = none ]' || fail "the Mac still has Bay $(mac_mark Bay)"
agent-device press 'label="Cancel"' >/dev/null 2>&1
until_true '[ "$(card_mark Bay)" = none ]' || fail "Bay's card still shows $(card_mark Bay)"
echo "ok: opening Bay's page cleared its Unread"

agent-device close >/dev/null 2>&1
echo "PASS"
