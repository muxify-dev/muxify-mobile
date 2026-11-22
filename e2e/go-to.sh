#!/bin/bash
#
# Runs Go to and the bar at the bottom of the Host Screen against a sandboxed
# Muxify on this Mac, the dev Host (see e2e/sandbox.sh).
#
# The tab control shows below the navigation bar and takes a tap, also after
# Go to opened and closed: the rows come back right under it. While Go to has
# the keys, the navigation bar hides and the Go to list starts at the top.
#
# The bar shows only on the Host Screen, and only while no Topic card moves.
# It takes a tap again after the Terminal and a Topic Screen were on top of
# it. A pick of a Session Path makes a Session in no Topic there and opens it,
# and a second pick of the same path goes to that Session.
#
# Go to needs a muxify with the session-paths capability. Put one first on
# the PATH:
#
#   PATH=<muxify checkout>/.build/debug:$PATH bash e2e/go-to.sh

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail

APP=dev.muxify.app

fail() { echo "FAIL: $*"; agent-device close >/dev/null 2>&1; exit 1; }

case "$(tmux display-message -p '#{socket_path}')" in
  "$(cd "$MUXIFY_E2E_ROOT" && pwd -P)"/*) ;;
  *) echo "tmux is not the sandbox's server"; exit 1 ;;
esac

muxify session-paths --help >/dev/null 2>&1 \
  || { echo "this muxify has no session-paths: put a newer one first on the PATH"; exit 1; }

bash "$(dirname "$0")/topics-tab.sh" || exit 1
PROJECTS="$(cd "$MUXIFY_E2E_ROOT" && pwd -P)/projects"
mkdir -p "$PROJECTS/alpha" "$PROJECTS/gamma"
printf 'topics:\n  tags:\n    personal: {}\n    work: {}\nsessions:\n  paths:\n    - path: %s/*\n' "$PROJECTS" >"$MUXIFY_CONFIG"
muxify session-paths refresh >/dev/null || exit 1
id=$(muxify topic new One --json | python3 -c 'import json, sys; print(json.load(sys.stdin)["changed"]["topic_id"])') || exit 1
muxify topic add-session "$PROJECTS/alpha" --topic "$id" --json >/dev/null || exit 1
muxify topic choose-in-play --topic "$id" --json >/dev/null || exit 1

# Whether the screen has a node labelled $1.
on_screen() { agent-device snapshot -i 2>/dev/null | grep -qF "\"$1\""; }
bar_on_screen() { on_screen "Go to" || on_screen "New"; }

# A tap on the Go to field gives it the keys. A tap within about a second of a
# push or a pop can be lost, so it waits that out first.
open_go_to() {
  sleep 1.5
  # A debug build's warning toast lies over the bar and takes the tap.
  agent-device react-native dismiss-overlay >/dev/null 2>&1
  agent-device press 'label="Go to"' >/dev/null 2>&1
  agent-device wait 'role=search' 3000 >/dev/null
  agent-device snapshot -i 2>/dev/null | grep -q 'search.*\[focused\]' || fail "a tap on Go to did not give it the keys ($1)"
}

back_to_host_screen() {
  agent-device press 'id="BackButton"' --settle >/dev/null
  agent-device wait 'label="Host Options"' 8000 >/dev/null || fail "Back did not return to the Host Screen"
}

agent-device open "$APP" --platform ios --relaunch >/dev/null 2>&1
agent-device wait 'label="Host Dev Host"' 15000 >/dev/null || fail "no Dev Host"
agent-device press 'label="Host Dev Host"' --settle >/dev/null
agent-device wait 'label="Topic One"' 15000 >/dev/null || fail "no Topics on the Host Screen"

echo "== The bar"
agent-device wait 'label="Go to"' 8000 >/dev/null || fail "no Go to field on the Host Screen"
on_screen "New" || fail "no ＋ on the Host Screen"
echo "ok: the Host Screen has Go to and ＋"

agent-device press 'label="Topic One"' --settle >/dev/null
agent-device wait absent 'label="Host Options"' 8000 >/dev/null || fail "the Topic Screen did not open"
sleep 1
bar_on_screen && fail "the bar shows on the Topic Screen"
back_to_host_screen
open_go_to "after the Topic Screen"
agent-device press 'label="close"' --settle >/dev/null
echo "ok: the bar is not on the Topic Screen, and takes a tap after it"

echo "== The tab control and Go to"
# The top and the bottom of the first node labelled $1, $2…, as "label=top,bottom" lines.
rects() {
  agent-device snapshot --json 2>/dev/null | python3 -c '
import json, sys
wanted, seen = sys.argv[1:], set()
for n in json.load(sys.stdin)["data"]["nodes"]:
    label, r = n.get("label"), n.get("rect")
    if label in wanted and label not in seen and r:
        seen.add(label)
        print("%s=%d,%d" % (label, round(r["y"]), round(r["y"] + r["height"])))
' "$@"
}
# The top or the bottom ($2) of the node labelled $3 in the rects $1.
edge() { awk -F'[=,]' -v label="$3" -v which="$2" '$1 == label { print (which == "top" ? $2 : $3) }' <<<"$1"; }
LAYOUT=(Back "Host Screen view" "In Play" "Topic One")
first=$(rects "${LAYOUT[@]}")
bar=$(edge "$first" bottom Back)
control=$(edge "$first" top "Host Screen view")
under_control=$(edge "$first" bottom "Host Screen view")
first_row=$(edge "$first" top "In Play")
[ -n "$bar" ] && [ -n "$control" ] && [ -n "$first_row" ] || fail "no bar, tab control or In Play on the Host Screen: $first"
[ "$control" -ge "$bar" ] || fail "the tab control (top $control) is under the navigation bar (bottom $bar)"
[ "$first_row" -ge "$under_control" ] && [ "$((first_row - under_control))" -le 16 ] \
  || fail "In Play (top $first_row) is not right under the tab control (bottom $under_control)"
for k in 1 2 3; do
  open_go_to "time $k"
  on_screen "Back" && fail "the navigation bar shows while Go to has the keys (time $k)"
  go_to_top=$(edge "$(rects "Session 0" "Session alpha/one")" top "Session 0")
  alpha_top=$(edge "$(rects "Session 0" "Session alpha/one")" top "Session alpha/one")
  [ -n "$go_to_top" ] && [ -n "$alpha_top" ] || fail "no running Sessions in the Go to list (time $k)"
  [ "$alpha_top" -lt "$go_to_top" ] && go_to_top=$alpha_top
  [ "$go_to_top" -le "$bar" ] || fail "the Go to list does not start at the top: its first row is at $go_to_top (time $k)"
  agent-device press 'label="close"' --settle >/dev/null
  agent-device wait 'label="Host Screen view"' 5000 >/dev/null || fail "no tab control after Go to closed (time $k)"
  sleep 1
  now=$(rects "${LAYOUT[@]}")
  [ "$now" = "$first" ] || fail "after Go to closed (time $k), the layout is $(echo $now), not $(echo $first)"
done
agent-device press 'label="Sessions"' --settle >/dev/null
agent-device wait 'label="Session 0"' 5000 >/dev/null || fail "a tap on Sessions did not change the tab"
on_screen "Topic One" && fail "Topic One shows on the Sessions tab"
agent-device press 'label="Board"' --settle >/dev/null
agent-device wait 'label="Topic One"' 5000 >/dev/null || fail "a tap on Board did not change the tab"
echo "ok: the rows come back right under the tab control after Go to, and a tap changes the tab"

agent-device press 'label="Sessions"' --settle >/dev/null
agent-device wait 'label="Session 0"' 8000 >/dev/null || fail "no Session 0 on the Sessions tab"
agent-device press 'label="Session 0"' --settle >/dev/null
agent-device wait 'id="pane-command"' 20000 >/dev/null || fail "Session 0 did not open"
sleep 1
bar_on_screen && fail "the bar shows on the Terminal"
back_to_host_screen
open_go_to "after the Terminal"
agent-device press 'label="close"' --settle >/dev/null
echo "ok: the bar is not on the Terminal, and takes a tap after it"

agent-device press 'label="Board"' --settle >/dev/null
agent-device longpress 'label="Topic One"' 1000 --settle >/dev/null
agent-device press 'role=button label="Move…"' --settle >/dev/null || fail "no Move… in the menu of One"
agent-device wait 'label="Cancel Move"' 5000 >/dev/null || fail "the move of One did not start"
bar_on_screen && fail "the bar shows while One moves"
agent-device press 'label="Cancel Move"' --settle >/dev/null
agent-device wait 'label="Go to"' 5000 >/dev/null || fail "the bar did not come back after Cancel"
echo "ok: the bar goes away while a Topic card moves"

agent-device press 'id="BackButton"' --settle >/dev/null
agent-device wait 'label="Host Dev Host"' 8000 >/dev/null || fail "Back did not return to the Hosts"
sleep 1
bar_on_screen && fail "the bar shows on the Hosts"
echo "ok: the bar is not on the Hosts"

echo "== Go to"
agent-device press 'label="Host Dev Host"' --settle >/dev/null
agent-device wait 'label="Host Options"' 15000 >/dev/null || fail "no Host Screen"
open_go_to "on the Host Screen"
agent-device wait "label=\"Folder $PROJECTS/gamma\"" 8000 >/dev/null || fail "no gamma in the Go to list"
on_screen "Folder $PROJECTS/alpha" || fail "no alpha in the Go to list"
on_screen "Session alpha/one" || fail "no running Session alpha/one in the Go to list"
on_screen "Host Screen view" && fail "the tab shows under the Go to list"
echo "ok: the Go to list stands in place of the tab"

agent-device type gam >/dev/null 2>&1
agent-device wait absent "label=\"Folder $PROJECTS/alpha\"" 5000 >/dev/null || fail "gam did not filter out alpha"
on_screen "Folder $PROJECTS/gamma" || fail "gam filtered out gamma"
echo "ok: the text filters the list"

sessions_at_gamma() { tmux list-sessions -F '#{session_name} #{session_path}' | awk -v dir="$PROJECTS/gamma" '$2 == dir { print $1 }'; }
agent-device press "label=\"Folder $PROJECTS/gamma\"" --settle >/dev/null
agent-device wait 'id="pane-command"' 20000 >/dev/null || fail "the pick of gamma opened no Session"
[ "$(sessions_at_gamma)" = gamma ] || fail "the Sessions at gamma are '$(sessions_at_gamma)', not 'gamma'"
muxify environment show --json | python3 -c 'import json, sys; e = json.load(sys.stdin); sys.exit(not any(s["name"] == "gamma" and s["topic"] is None for s in e["sessions"]))' \
  || fail "gamma is in a Topic"
agent-device wait 'label="gamma"' 5000 >/dev/null || fail "the Terminal does not show gamma"
echo "ok: a pick of a path makes a Session in no Topic there and opens it"

back_to_host_screen
open_go_to "after the pick"
agent-device type gam >/dev/null 2>&1
agent-device wait "label=\"Folder $PROJECTS/gamma\"" 5000 >/dev/null || fail "no gamma in the Go to list the second time"
agent-device press "label=\"Folder $PROJECTS/gamma\"" --settle >/dev/null
agent-device wait 'id="pane-command"' 20000 >/dev/null || fail "the second pick of gamma opened no Session"
agent-device wait 'label="gamma"' 5000 >/dev/null || fail "the second pick of gamma did not go to gamma"
[ "$(sessions_at_gamma)" = gamma ] || fail "the second pick made a Session: '$(sessions_at_gamma)'"
echo "ok: a second pick of the path goes to its Session and makes none"

agent-device close >/dev/null 2>&1
echo "PASS"
