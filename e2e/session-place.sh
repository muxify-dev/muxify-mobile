#!/bin/bash
#
# The Session Place: a Session with no Topic, opened again on the phone, is
# where it was left, a Browser Tab included, as a Topic is (e2e/topic-place.sh).
#
# What this proves, against two Sessions with no Topic in the sandbox:
#
#   1  a Tab picked in the Title Sheet of a Session opened from the Sessions
#      tab takes the Terminal Screen's place, and Back goes to the Host Screen
#      in one step, with the Session still attached
#   2  the Session opened again from the Sessions tab has its Web View on top
#      again, in the Window the phone was in, although the Mac moved tmux's
#      active Window while the phone was in the other Session
#   3  the same, opened from Go to
#   4  a Window picked in the Web View's Title Sheet goes to the Terminal
#      Screen and clears the Tab, and the Session opened again is on that
#      Window, with no page, although the Mac moved tmux's active Window
#   5  a Session picked in the Web View's Title Sheet goes to the Terminal
#      Screen of that Session
#   6  a Tab that the Host lists no more leaves the reopened Session on its
#      Pane, and the Session Place forgets the Tab
#
# The Tabs are stored in the sandbox's tmux Window options as desktop Muxify
# stores them (`stored-tabs`, see e2e/sandbox.sh), and the app gets them from
# the sandbox's real `muxify server`: no step talks to the Muxify app on this
# Mac. A stored Tab has no title yet, so its row is its address. The page is
# served at this Mac's Tailscale address, as in e2e/browser-tabs.sh.
#
# Requires a configured .env.local, a booted simulator and Tailscale up on this Mac.
# Usage:  bash e2e/session-place.sh

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail

APP=dev.muxify.app
device=()
[ -z "${MUXIFY_E2E_DEVICE:-}" ] || device=(--udid "$MUXIFY_E2E_DEVICE")
ROOT=$MUXIFY_E2E_ROOT
MARKER=session-place-e2e-marker
PAGE_TITLE="E2E Session Place page"
SESSION=e2e-place
OTHER=e2e-other
DATA=$(xcrun simctl get_app_container "${MUXIFY_E2E_DEVICE:-booted}" "$APP" data)/Documents

on_host() { sh -c "$*" 2>/dev/null; }

fail() { echo "FAIL: $1"; exit 1; }

SERVER=
trap '[ -n "$SERVER" ] && kill $SERVER 2>/dev/null' EXIT

# The Tabs stored for every Window on the Host: the page and a public site, or
# the public site only.
tabs() {
  for window in $(on_host "tmux list-windows -a -F '#{window_id}'"); do
    if [ -n "$1" ]; then
      stored-tabs "$window" 0 "$1" https://example.com/
    else
      stored-tabs "$window" 0 https://example.com/
    fi || fail "could not store the Tabs of $window"
  done
}

window_now() { on_host "tmux display-message -p -t '$SESSION' '#{window_index}'"; }
# The phone's Clients on the Session. A Listener, such as the Host Server's,
# asks for ignore-size and is no one's Client, as tmux-client.ts counts them.
clients() { on_host "tmux list-clients -t '$SESSION' -F '#{client_flags}'" | grep -vc ignore-size; }

open_title_sheet() {
  # A press within about a second of a push or a pop can be lost.
  sleep 1.5
  agent-device press "id=\"$1\"" >/dev/null 2>&1
  agent-device wait 'label="Close Choose"' 8000 >/dev/null 2>&1 || fail "the Title Sheet never opened from $1"
  # A press on a sheet that still moves lands nowhere.
  sleep 1
}

# The phone in the other Session, then on the Host Screen. While the phone is
# attached to a Session, the phone shows what tmux shows, and a move on the Mac
# is where the user is; only a move made while the phone is elsewhere must
# leave the Session Place where it was.
elsewhere() {
  back_to_host
  open_session "$OTHER"
  terminal_on "$OTHER" "$OTHER did not attach"
  back_to_host
}

# Opens a Session from a row of the Sessions tab and waits for it to attach.
open_session() {
  agent-device wait 'label="Host Options"' 15000 >/dev/null 2>&1 || fail "the Host Screen is not on top"
  agent-device wait "label=\"Session $1\"" 15000 >/dev/null 2>&1 || fail "the Sessions tab does not list $1"
  agent-device press "label=\"Session $1\"" >/dev/null 2>&1
}

terminal_on() {
  agent-device wait 'id="pane-command"' 20000 >/dev/null 2>&1 || fail "$2"
  agent-device is text 'id="attached-session"' "$1" >/dev/null 2>&1 || fail "the Terminal Screen is not on $1"
  agent-device is exists "text=\"$MARKER\"" >/dev/null 2>&1 && fail "the Web View is still on top: $2"
  return 0
}

page_on_top() {
  agent-device wait "text=\"$MARKER\"" 20000 >/dev/null 2>&1 || fail "$1"
  agent-device is exists 'id="web-view-title"' >/dev/null 2>&1 || fail "the Web View has no Header title"
}

back_to_host() {
  for _ in 1 2; do
    agent-device is exists 'label="Host Options"' >/dev/null 2>&1 && return 0
    agent-device press 'id="BackButton"' >/dev/null 2>&1
    sleep 1
  done
  agent-device wait 'label="Host Options"' 8000 >/dev/null 2>&1 || fail "Back did not reach the Host Screen"
}

# The Session Place the app saved for $SESSION, as "<window index> <tab url or none>".
saved_place() {
  python3 - "$DATA/muxify-records.json" "$SESSION" <<'PY'
import json, sys
records = json.load(open(sys.argv[1]))
assert "topicPlaces" not in records, "the records still have topicPlaces"
for place in records.get("places", []):
    if place["owner"] == {"kind": "session", "session": sys.argv[2]}:
        print(place["window"]["index"], (place["tab"] or {}).get("url", "none"))
PY
}

echo "0/6  two Sessions with no Topic, the first with two Windows, and a page at this Mac's Tailscale address"
ADDRESS=$(tailscale ip -4 2>/dev/null | head -1)
[ -n "$ADDRESS" ] || fail "this Mac has no Tailscale address: start Tailscale"
PORT=$(python3 -c 'import socket, sys; s = socket.socket(); s.bind((sys.argv[1], 0)); print(s.getsockname()[1])' "$ADDRESS")
URL="http://$ADDRESS:$PORT/"
mkdir -p "$ROOT/www"
printf '<!doctype html><title>%s</title><h1>%s</h1>\n' "$PAGE_TITLE" "$MARKER" >"$ROOT/www/index.html"
python3 -m http.server "$PORT" --bind "$ADDRESS" --directory "$ROOT/www" >/dev/null 2>&1 &
SERVER=$!
for _ in $(seq 50); do curl -s -o /dev/null "$URL" && break; sleep 0.1; done
curl -s -o /dev/null "$URL" || fail "the page is not up at the Tailscale address"

python3 - "$DATA/muxify-settings.json" <<'PY'
import json, sys
path = sys.argv[1]
settings = json.load(open(path))
records = json.load(open(path.replace("muxify-settings.json", "muxify-records.json")))
settings["chooserListPreferences"] = {host["id"]: ["windows", "sessions"] for host in records["hosts"]}
json.dump(settings, open(path, "w"))
PY
on_host "tmux new-session -d -s '$SESSION' -n first -c '$ROOT'" || fail "could not make $SESSION"
on_host "tmux new-window -d -t '$SESSION:' -n second" || fail "could not add a Window to $SESSION"
on_host "tmux new-session -d -s '$OTHER' -c '$ROOT'" || fail "could not make $OTHER"
tabs "$URL"

agent-device close >/dev/null 2>&1
agent-device open "$APP" --platform ios --relaunch "${device[@]}" >/dev/null 2>&1
agent-device wait text "Dev Host" 25000 >/dev/null 2>&1
agent-device press 'label="Host Dev Host"' --settle >/dev/null 2>&1

echo "1/6  a Tab takes the Terminal Screen's place, and Back goes to the Host Screen"
open_session "$SESSION"
terminal_on "$SESSION" "$SESSION did not attach"
open_title_sheet header-title
agent-device wait "label=\"Tab $URL\"" 15000 >/dev/null 2>&1 || fail "the Title Sheet does not list the Tab"
agent-device press "label=\"Tab $URL\"" >/dev/null 2>&1
page_on_top "the Web View did not show the page"
sleep 1.5
agent-device press 'id="BackButton"' >/dev/null 2>&1
agent-device wait 'label="Host Options"' 8000 >/dev/null 2>&1 || fail "one Back from the Web View did not go to the Host Screen"
[ "$(clients)" = 1 ] || fail "$SESSION is not attached under the Host Screen"
echo "     the page, then the Host Screen in one Back, with $SESSION attached"

echo "2/6  $SESSION opened again from the Sessions tab has its page on top, in the Window the phone was in"
elsewhere
on_host "tmux select-window -t '$SESSION:1'"
open_session "$SESSION"
page_on_top "the reopened Session did not show its page"
sleep 1
[ "$(window_now)" = 0 ] || fail "the reopened Session is in Window $(window_now), not in Window 0 where the phone left it"
echo "     the page, and Window 0 under it"

echo "3/6  $SESSION opened from Go to has its page on top"
elsewhere
on_host "tmux select-window -t '$SESSION:1'"
agent-device press 'label="Go to"' >/dev/null 2>&1
agent-device wait 'role=search' 5000 >/dev/null 2>&1 || fail "Go to did not open"
agent-device type "$SESSION" >/dev/null 2>&1
sleep 1
agent-device press "label=\"Session $SESSION\"" >/dev/null 2>&1
page_on_top "the Session opened from Go to did not show its page"
sleep 1
[ "$(window_now)" = 0 ] || fail "the Session opened from Go to is in Window $(window_now), not in Window 0"
echo "     the page, and Window 0 under it"

echo "4/6  a Window picked from the page goes to the terminal, and the Session forgets the page"
open_title_sheet web-view-title
agent-device press 'label="Windows"' >/dev/null 2>&1
agent-device wait 'label="second"' 15000 >/dev/null 2>&1 || fail "the Web View's Title Sheet does not list the Windows"
sleep 1
agent-device press 'label="second"' >/dev/null 2>&1
terminal_on "$SESSION" "the Window pick did not go to the Terminal Screen"
elsewhere
on_host "tmux select-window -t '$SESSION:0'"
open_session "$SESSION"
terminal_on "$SESSION" "$SESSION did not attach again"
sleep 3
agent-device is exists "text=\"$MARKER\"" >/dev/null 2>&1 && fail "the Session opened its page again after a Window pick"
[ "$(window_now)" = 1 ] || fail "the reopened Session is in Window $(window_now), not in Window 1 that was picked"
echo "     the terminal in Window 1, and no page, although the Mac had gone to Window 0"

echo "5/6  a Session picked from the page goes to that Session's terminal"
open_title_sheet header-title
agent-device wait "label=\"Tab $URL\"" 15000 >/dev/null 2>&1 || fail "the Title Sheet does not list the Tab again"
agent-device press "label=\"Tab $URL\"" >/dev/null 2>&1
page_on_top "the Web View did not show the page again"
open_title_sheet web-view-title
agent-device press 'label="Sessions"' >/dev/null 2>&1
agent-device wait "label=\"$OTHER\"" 15000 >/dev/null 2>&1 || fail "the Web View's Title Sheet does not list $OTHER"
sleep 1
agent-device press "label=\"$OTHER\"" >/dev/null 2>&1
terminal_on "$OTHER" "the Session pick did not go to the Terminal Screen of $OTHER"
echo "     $OTHER on the Terminal Screen"

echo "6/6  a Tab the Host lists no more leaves $SESSION on its Pane, and its Place forgets the Tab"
[ "$(saved_place)" = "1 $URL" ] || fail "the Session Place of $SESSION is \"$(saved_place)\", not Window 1 with the page"
tabs ""
back_to_host
open_session "$SESSION"
terminal_on "$SESSION" "$SESSION did not attach on its Pane"
# The restore reads the Window's Tabs once; the Web View would be up by now.
sleep 4
agent-device is exists "text=\"$MARKER\"" >/dev/null 2>&1 && fail "the Web View opened a Tab the Host lists no more"
[ "$(saved_place)" = "1 none" ] || fail "the Session Place of $SESSION is \"$(saved_place)\", not Window 1 with no Tab"
echo "     the Pane, no Web View, and a Session Place with no Tab"

agent-device close >/dev/null 2>&1
echo
echo "PASS: a Session with no Topic opened again is where it was left, its page"
echo "      included, from the Sessions tab and from Go to, after Back from the"
echo "      page went to the Host Screen in one step; a Window picked from the"
echo "      page goes to the terminal and forgets the page; a Session picked from"
echo "      the page goes to its terminal; and a Tab the Host lists no more"
echo "      leaves the Pane on top."
