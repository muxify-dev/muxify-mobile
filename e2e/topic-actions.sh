#!/bin/bash
#
# Runs the long-press menu, the trailing swipe, the Move, the Fill of an Open
# Place and the Settle of the Topic cards on the Host Screen against a sandboxed Muxify on this Mac, the dev
# Host (see e2e/sandbox.sh). After each step it waits until the Mac, asked
# through the CLI, has the change, and then checks that the Host Screen shows
# the Mac's order.
#
# Mark as Unread sends `topic mark-unread --topic-only`, and a move inside a
# section sends `topic move --before`. Put a muxify that has both first on the PATH:
#
#   PATH=~/.local/bin:$PATH bash e2e/topic-actions.sh
#
# The sandbox has three places In Play. PinA and PinB are Pinned. P1 and B2 are
# In Play with an Open Place between them, G1 is a Guest, and AG, P3 and B1 are
# on the Bench. B1 is Unread. An Agent in AG is blocked, so AG has no swipe.

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail

APP=dev.muxify.app
SETTINGS="$(xcrun simctl get_app_container booted "$APP" data)/Documents/muxify-settings.json"
SNAPSHOT="$MUXIFY_E2E_ROOT/snapshot.json"

# Writes the screen's tree to $SNAPSHOT. A snapshot taken while the screen moves can fail, so it tries again.
snap() {
  for _ in $(seq 10); do
    agent-device snapshot -i --json >"$SNAPSHOT" 2>/dev/null && python3 -c 'import json, sys; json.load(open(sys.argv[1]))["data"]' "$SNAPSHOT" 2>/dev/null && return 0
    sleep 0.5
  done
  python3 -c "import json, sys; e = json.load(open(sys.argv[1])); print(json.dumps(e)[:900])" "$SNAPSHOT"
  return 1
}

fail() { echo "FAIL: $*"; agent-device close >/dev/null 2>&1; exit 1; }

case "$(tmux display-message -p '#{socket_path}')" in
  "$(cd "$MUXIFY_E2E_ROOT" && pwd -P)"/*) ;;
  *) echo "tmux is not the sandbox's server"; exit 1 ;;
esac

muxify topic mark-read --help 2>&1 | grep -q -- --topic-only \
  || { echo "this muxify has no topic mark-read --topic-only: put a newer one first on the PATH"; exit 1; }

python3 - "$SETTINGS" <<'PY'
import json, sys
path = sys.argv[1]
settings = json.load(open(path))
settings.pop("hostListPreferences", None)
settings["hostScreenLists"] = ["topics"]
json.dump(settings, open(path, "w"))
PY
printf 'topics:\n  in_play: 3\n  tags:\n    personal: {}\n    work: {}\n' >"$MUXIFY_CONFIG"

new_topic() {
  local id
  id=$(muxify topic new "$1" --json | python3 -c 'import json, sys; print(json.load(sys.stdin)["changed"]["topic_id"])') || exit 1
  mkdir -p "$MUXIFY_E2E_ROOT/$1"
  muxify topic add-session "$MUXIFY_E2E_ROOT/$1" --topic "$id" --json >/dev/null || exit 1
}

# A new Topic takes a free place, else goes to the top of the Bench.
for title in PinA PinB B2 B1 G1 P3 P1 AG; do new_topic "$title"; done
muxify topic pin --topic PinA --json >/dev/null || exit 1
muxify topic pin --topic PinB --json >/dev/null || exit 1
muxify topic fill-place 1 --topic P1 --json >/dev/null || exit 1
muxify topic make-guest --topic G1 --json >/dev/null || exit 1
muxify topic mark-unread --topic-only --topic B1 --json >/dev/null || exit 1

# The Mac shows an Agent only in a Pane whose command is the Agent's.
ln -s /bin/sleep "$MUXIFY_E2E_ROOT/claude"
agent_pane=$(tmux list-panes -a -F '#{session_name} #{pane_id}' | awk '$1 ~ /^AG\// { print $2 }')
tmux send-keys -t "$agent_pane" "exec $MUXIFY_E2E_ROOT/claude 100000" Enter
sleep 1
tmux set -p -t "$agent_pane" @muxify_agent claude
tmux set -p -t "$agent_pane" @muxify_agent_status blocked

# The Mac's Listing as one line, Open Places as "open": pinned | places | guests | bench.
mac_listing() {
  muxify environment show --json | python3 -c '
import json, sys
e = json.load(sys.stdin)
def cards(cs):
    return " ".join(c["topic"]["label"] + ("(" + c["mark"] + ")" if c.get("mark") else "") if c["kind"] == "topic" else "open" for c in cs)
u = e["unpinned"]
print(" | ".join([cards(e["pinned"]), cards(u.get("places", [])), cards(u.get("guests", [])), cards(u.get("bench", []))]))'
}

# Waits until the Mac's Listing is $1, then until the screen shows its cards in that order.
expect() {
  local want=$1 have screen mac_order
  for _ in $(seq 40); do
    have=$(mac_listing)
    [ "$have" = "$want" ] && break
    sleep 0.25
  done
  [ "$have" = "$want" ] || fail "the Mac has '$have', not '$want'"
  mac_order=$(python3 -c 'import re, sys; print(" ".join("Open Place" if w == "open" else re.sub(r"\(.*\)", "", w) for w in sys.argv[1].split() if w != "|"))' "$want")
  for _ in $(seq 20); do
    snap
    screen=$(python3 - "$SNAPSHOT" <<'PY'
import json, sys
nodes = json.load(open(sys.argv[1]))["data"]["nodes"]
rows = sorted({(n["rect"]["y"], n["label"]) for n in nodes
               if (n.get("label") or "").startswith("Topic ") and "Reorder" not in n.get("type", "")
               or n.get("label") == "Open Place" and "cell" in (n.get("type", "") + n.get("role", "")).lower()})
print(" ".join(label.removeprefix("Topic ") for _, label in rows))
PY
)
    [ "$screen" = "$mac_order" ] && { echo "ok: $want"; return 0; }
    sleep 0.5
  done
  fail "the screen shows '$screen', the Mac '$mac_order'"
}

# The vertical middle of the node labelled $1.
middle_y() {
  snap
  python3 - "$SNAPSHOT" "$1" <<'PY'
import json, sys
node = next(n for n in json.load(open(sys.argv[1]))["data"]["nodes"] if n.get("label") == sys.argv[2])
print(int(node["rect"]["y"] + node["rect"]["height"] / 2))
PY
}

# Relaunches the app on the Host Screen, waits for card $1 (P1), and opens the Bench, which shows card $2 (B1).
open_host_screen() {
  agent-device open "$APP" --platform ios --relaunch >/dev/null 2>&1
  agent-device wait 'label="Host Dev Host"' 15000 >/dev/null || fail "no Dev Host"
  agent-device press 'label="Host Dev Host"' --settle >/dev/null
  agent-device wait "label=\"Topic ${1:-P1}\"" 15000 >/dev/null || fail "no Topics on the Host Screen"
  agent-device press 'label="Bench"' --settle >/dev/null
  agent-device wait "label=\"Topic ${2:-B1}\"" 8000 >/dev/null || fail "the Bench did not open"
}

# Long-presses card $1, checks that its menu is exactly $2 (labels joined by |), and presses $3.
menu() {
  local items
  agent-device longpress "label=\"Topic $1\"" 1000 --settle >/dev/null
  agent-device wait "role=button label=\"$3\"" 5000 >/dev/null || fail "no $3 in the menu of $1"
  snap
  items=$(python3 - "$SNAPSHOT" <<'PY'
import json, sys
words = {"Mark as Read", "Mark as Unread", "Move Up", "Move Down", "Bench", "Make a Guest"}
nodes = json.load(open(sys.argv[1]))["data"]["nodes"]
print("|".join(n["label"] for n in nodes if n.get("label") in words and "Button" in n.get("type", "") + n.get("role", "")))
PY
)
  [ "$items" = "$2" ] || fail "the menu of $1 is '$items', not '$2'"
  agent-device press "role=button label=\"$3\"" --settle >/dev/null
}

# Swipes card $1 left by $2 points, in $3 ms, from near the right edge of its row.
swipe() {
  agent-device gesture pan 370 "$(middle_y "Topic $1")" "-$2" 0 "${3:-400}" >/dev/null || fail "no swipe on $1"
}

open_host_screen
expect "PinA PinB | P1 open B2 | G1 | AG(blocked) P3 B1(unread)"

echo "== Row menu"
menu B1 "Mark as Read|Move Up|Move Down|Make a Guest" "Mark as Read"
expect "PinA PinB | P1 open B2 | G1 | AG(blocked) P3 B1"
menu B1 "Mark as Unread|Move Up|Move Down|Make a Guest" "Mark as Unread"
expect "PinA PinB | P1 open B2 | G1 | AG(blocked) P3 B1(unread)"
menu P3 "Mark as Unread|Move Up|Move Down|Make a Guest" "Move Up"
expect "PinA PinB | P1 open B2 | G1 | P3 AG(blocked) B1(unread)"
menu P3 "Mark as Unread|Move Up|Move Down|Make a Guest" "Make a Guest"
expect "PinA PinB | P1 open B2 | G1 P3 | AG(blocked) B1(unread)"
menu P3 "Mark as Unread|Move Up|Move Down|Bench" "Bench"
expect "PinA PinB | P1 open B2 | G1 | P3 AG(blocked) B1(unread)"
menu AG "Move Up|Move Down|Make a Guest" "Move Down"
expect "PinA PinB | P1 open B2 | G1 | P3 B1(unread) AG(blocked)"
menu PinB "Mark as Unread|Move Up|Move Down" "Move Up"
expect "PinB PinA | P1 open B2 | G1 | P3 B1(unread) AG(blocked)"

echo "== Trailing swipe"
swipe B1 120
agent-device press 'label="Mark as Read B1"' --settle >/dev/null || fail "no Read in the swipe of B1"
expect "PinB PinA | P1 open B2 | G1 | P3 B1 AG(blocked)"
swipe B1 120
agent-device press 'label="Mark as Unread B1"' --settle >/dev/null || fail "no Unread in the swipe of B1"
expect "PinB PinA | P1 open B2 | G1 | P3 B1(unread) AG(blocked)"
swipe B1 350 200
expect "PinB PinA | P1 open B2 | G1 | P3 B1 AG(blocked)"
echo "ok: a full swipe marks B1 Read"
swipe AG 120
snap
python3 - "$SNAPSHOT" <<'PY' || fail "AG, with an Agent mark, has a swipe"
import json, sys
nodes = json.load(open(sys.argv[1]))["data"]["nodes"]
sys.exit(any((n.get("label") or "").startswith("Mark as") for n in nodes))
PY
echo "ok: AG has no swipe"
# A row with no swipe takes the drag as a tap and opens the Topic.
open_host_screen
swipe B1 120
agent-device wait 'label="Mark as Unread B1"' 3000 >/dev/null || fail "no Unread in the swipe of B1"
# As in Mail, a touch on the row while its buttons show closes them.
agent-device press 'label="Topic B1"' --settle >/dev/null
agent-device wait absent 'label="Mark as Unread B1"' 3000 >/dev/null || fail "the swipe of B1 did not close"
menu B1 "Mark as Unread|Move Up|Move Down|Make a Guest" "Move Up"
expect "PinB PinA | P1 open B2 | G1 | B1 P3 AG(blocked)"
echo "ok: a long-press after a swipe opens the menu"

echo "== Move"
# Picks card $1 with Move… in its menu, then taps the target labelled $2.
move() {
  agent-device longpress "label=\"Topic $1\"" 1000 --settle >/dev/null
  agent-device press 'role=button label="Move…"' --settle >/dev/null || fail "no Move… in the menu of $1"
  agent-device wait 'label="Cancel Move"' 5000 >/dev/null || fail "the move of $1 did not start"
  agent-device press "label=\"$2\"" --settle >/dev/null || fail "no target $2 for $1"
}
move AG "Move above B1"
expect "PinB PinA | P1 open B2 | G1 | AG(blocked) B1 P3"
move B2 "Move above Open Place"
expect "PinB PinA | P1 B2 open | G1 | AG(blocked) B1 P3"
move G1 "Trade P1"
expect "PinB PinA | G1 B2 open | P1 | AG(blocked) B1 P3"
move B1 "Fill Open Place"
expect "PinB PinA | G1 B2 B1 | P1 | AG(blocked) P3"
move PinA "Move above PinB"
expect "PinA PinB | G1 B2 B1 | P1 | AG(blocked) P3"
move P3 "Make a Guest"
expect "PinA PinB | G1 B2 B1 | P1 P3 | AG(blocked)"
move B2 "Bench"
expect "PinA PinB | G1 open B1 | P1 P3 | B2 AG(blocked)"
agent-device longpress 'label="Topic AG"' 1000 --settle >/dev/null
agent-device press 'role=button label="Move…"' --settle >/dev/null || fail "no Move… in the menu of AG"
agent-device press 'label="Cancel Move"' --settle >/dev/null || fail "no Cancel during a move"
agent-device wait absent 'label="Cancel Move"' 3000 >/dev/null || fail "Cancel did not end the move"
expect "PinA PinB | G1 open B1 | P1 P3 | B2 AG(blocked)"
echo "ok: Cancel ends a move with no change"

echo "== Fill an Open Place"
# Taps the Open Place, then the card $1 in the sheet that opens.
fill() {
  agent-device press 'label="Open Place"' --settle >/dev/null || fail "no Open Place to tap"
  agent-device wait 'label="Close Fill Open Place"' 5000 >/dev/null || fail "the Fill sheet did not open"
  agent-device press "label=\"Topic $1\"" --settle >/dev/null || fail "no $1 in the Fill sheet"
  agent-device wait absent 'label="Close Fill Open Place"' 5000 >/dev/null || fail "the Fill sheet did not close"
}
fill B2
expect "PinA PinB | G1 B2 B1 | P1 P3 | AG(blocked)"
menu B1 "Mark as Unread|Move Up|Move Down|Bench" "Bench"
expect "PinA PinB | G1 B2 open | P1 P3 | B1 AG(blocked)"
fill P3
expect "PinA PinB | G1 B2 P3 | P1 | B1 AG(blocked)"
menu P3 "Mark as Unread|Move Up|Move Down|Bench" "Bench"
expect "PinA PinB | G1 B2 open | P1 | P3 B1 AG(blocked)"
agent-device press 'label="Open Place"' --settle >/dev/null || fail "no Open Place to tap"
agent-device press 'label="Close Fill Open Place"' --settle >/dev/null || fail "no Close on the Fill sheet"
agent-device wait absent 'label="Close Fill Open Place"' 5000 >/dev/null || fail "Close did not close the Fill sheet"
expect "PinA PinB | G1 B2 open | P1 | P3 B1 AG(blocked)"
echo "ok: Close fills nothing"
# B1 has no live Session now, so it is Dormant.
tmux list-sessions -F '#{session_name}' | grep '^B1' | while read -r name; do tmux kill-session -t "=$name"; done
for _ in $(seq 40); do
  muxify environment show --json | python3 -c 'import json, sys; e = json.load(sys.stdin); sys.exit(not any(c["kind"] == "topic" and c["topic"]["label"] == "B1" and c["topic"]["state"] == "dormant" for c in e["unpinned"]["bench"]))' && break
  sleep 0.25
done
fill B1
expect "PinA PinB | G1 B2 B1 | P1 | P3 AG(blocked)"
echo "ok: a Dormant Topic fills an Open Place"

echo "== Settle"
# Long-presses card $1, picks Settle…, then presses $2 in the alert.
settle() {
  agent-device longpress "label=\"Topic $1\"" 1000 --settle >/dev/null
  agent-device press 'role=button label="Settle…"' --settle >/dev/null || fail "no Settle… in the menu of $1"
  agent-device press "role=button label=\"$2\"" --settle >/dev/null || fail "no $2 in the Settle alert of $1"
}
sessions_of() { tmux list-sessions -F '#{session_name}' | grep -c "^$1"; }
settle P3 "Settle"
expect "PinA PinB | G1 B2 B1 | P1 | AG(blocked)"
[ "$(sessions_of P3)" -gt 0 ] || fail "Settle stopped the Sessions of P3"
echo "ok: Settle keeps the Sessions"
settle P1 "Settle and Stop Sessions"
expect "PinA PinB | G1 B2 B1 |  | AG(blocked)"
[ "$(sessions_of P1)" -eq 0 ] || fail "Settle and Stop Sessions left a Session of P1"
echo "ok: Settle and Stop Sessions stops them"

echo "== Mark as Read on a done Agent"
g1_pane=$(tmux list-panes -a -F '#{session_name} #{pane_id}' | awk '$1 ~ /^G1\// { print $2 }')
tmux send-keys -t "$g1_pane" "exec $MUXIFY_E2E_ROOT/claude 100000" Enter
sleep 1
tmux set -p -t "$g1_pane" @muxify_agent claude
tmux set -p -t "$g1_pane" @muxify_agent_status done
# The whole Topic Unread, then its own mark Read: only the Agent stays Unread, and the card shows done.
muxify topic mark-unread --topic G1 --json >/dev/null || exit 1
muxify topic mark-read --topic-only --topic G1 --json >/dev/null || exit 1
open_host_screen G1 AG
expect "PinA PinB | G1(done) B2 B1 |  | AG(blocked)"
menu G1 "Mark as Read|Move Up|Move Down|Bench" "Mark as Read"
expect "PinA PinB | G1 B2 B1 |  | AG(blocked)"
echo "ok: Mark as Read reads the done Agent too"

agent-device close >/dev/null 2>&1
echo "PASS"
