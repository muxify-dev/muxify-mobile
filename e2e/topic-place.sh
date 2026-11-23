#!/bin/bash
#
# The Topic Place: a Topic opened again on the phone is where it was left, a
# Browser Tab included, and the Web View reaches the Topics list.
#
# What this proves, against two Topics in the sandbox:
#
#   1  a Topic opens from the Host Screen, and a Tab picked in the Title Sheet
#      loads its page in the Web View, under the Topic's title
#   2  the Web View's title opens the Title Sheet, and its Topics list opens
#      another Topic on the Terminal Screen
#   3  the first Topic opened again from the Host Screen has its Web View on
#      top again, with the same page, in the Window the phone was in,
#      although the Mac moved tmux's active Window meanwhile
#   4  Back from the Web View goes to the Host Screen, and the same Topic
#      opened again has its page on top again
#   5  after a relaunch, the Topic opened from the Host Screen, with no Attach
#      up, has its page on top with no Terminal Screen first: one Client
#      attaches, it is in the Place's Window, and the tmux Window keeps its
#      size, because no Surface has said one
#   6  the same on a cold start with Reconnect on start
#   7  a Window picked in the Web View's Title Sheet goes to the Terminal
#      Screen, which gives the tmux Window the phone's size, and the Topic
#      opened again is on that Window, with no page
#   8  a Tab that the Host lists no more leaves the reopened Topic on its Pane
#
# Steps 5 and 6 run over a slow link (e2e/slow-launch.sh), so that a Terminal
# Screen mounted under the page would have its grid before the Attach is up,
# and they read the app's own log: no Terminal Screen opened, and no size went
# to tmux, while only the page was shown.
#
# The Tabs are stored in the sandbox's tmux Window options as desktop Muxify
# stores them (`stored-tabs`, see e2e/sandbox.sh), and the app gets them from
# the sandbox's real `muxify server`: no step talks to the Muxify app on this
# Mac. A stored Tab has no title yet, so its row is its address. The page is
# served at this Mac's Tailscale address, as in e2e/browser-tabs.sh.
#
# Requires a configured .env.local, a booted simulator and Tailscale up on this Mac.
# Usage:  bash e2e/topic-place.sh

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail

APP=dev.muxify.app
device=()
[ -z "${MUXIFY_E2E_DEVICE:-}" ] || device=(--udid "$MUXIFY_E2E_DEVICE")
ROOT=$MUXIFY_E2E_ROOT
MARKER=topic-place-e2e-marker
PAGE_TITLE="E2E Topic Place page"
TOPIC="e2e Place Topic"
OTHER="e2e Other Topic"

on_host() { sh -c "$*" 2>/dev/null; }

fail() { echo "FAIL: $1"; exit 1; }

. "$(dirname "$0")/slow-launch.sh"
SERVER=
trap '[ -n "$SERVER" ] && kill $SERVER 2>/dev/null; [ -n "$RELAY" ] && kill $RELAY 2>/dev/null' EXIT

topic_new() {
  muxify topic new "$1" --json | python3 -c 'import json, sys; print(json.load(sys.stdin)["changed"]["topic_id"])'
}

add_session() {
  mkdir -p "$ROOT/$2"
  muxify topic add-session "$ROOT/$2" --topic "$1" --json \
    | python3 -c 'import json, sys; print(json.load(sys.stdin)["changed"]["session_name"])'
}

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

open_title_sheet() {
  # A press within about a second of a push or a pop can be lost.
  sleep 1.5
  agent-device press "id=\"$1\"" >/dev/null 2>&1
  agent-device wait 'label="Close Choose"' 8000 >/dev/null 2>&1 || fail "the Title Sheet never opened from $1"
  # A press on a sheet that still moves lands nowhere.
  sleep 1
}

# Opens a Topic card on the Host Screen and waits for its Session.
open_topic() {
  agent-device wait 'label="Host Options"' 15000 >/dev/null 2>&1 || fail "the Host Screen is not on top"
  agent-device wait "label=\"Topic $1\"" 15000 >/dev/null 2>&1 || fail "the Host Screen does not list $1"
  agent-device press "label=\"Topic $1\"" >/dev/null 2>&1
  agent-device wait 'id="topic-title"' 20000 >/dev/null 2>&1 || fail "$1 did not attach"
}

page_on_top() {
  agent-device wait "text=\"$MARKER\"" 20000 >/dev/null 2>&1 || fail "$1"
  agent-device is exists 'id="web-view-title"' >/dev/null 2>&1 || fail "the Web View has no Header title"
}

# A size that no phone has, for both Windows of the Topic's Session, which a
# Client with no size leaves as it is. resize-window sets window-size to
# manual, so that is unset again.
MAC_SIZE=123x41
window_now() { on_host "tmux display-message -p -t '$TOPIC_SESSION' '#{window_index}'"; }
window_size() { on_host "tmux display-message -p -t '$TOPIC_SESSION:$1' '#{window_width}x#{window_height}'"; }
mac_sized() {
  for window in 0 1; do
    on_host "tmux resize-window -t '$TOPIC_SESSION:$window' -x 123 -y 41 && tmux set-option -w -t '$TOPIC_SESSION:$window' -u window-size" \
      || fail "could not size Window $window"
    [ "$(window_size $window)" = "$MAC_SIZE" ] || fail "Window $window is $(window_size $window), not $MAC_SIZE"
  done
}
# The phone's Clients on the Session. A Listener, such as the Host Server's,
# asks for ignore-size and is no one's Client, as tmux-client.ts counts them.
clients() { on_host "tmux list-clients -t '$TOPIC_SESSION' -F '#{client_flags}'" | grep -vc ignore-size; }

# The page is on top of a fresh Attach of the Topic, and no Terminal Screen has
# been under it: one Client, Window 0, and Window 0 at the size it had.
fresh_page() {
  page_on_top "$1"
  agent-device is exists 'id="pane-command"' >/dev/null 2>&1 && fail "a Terminal Screen is on screen under the page"
  for _ in $(seq 20); do [ "$(clients)" = 1 ] && break; sleep 0.5; done
  [ "$(clients)" = 1 ] || fail "the Topic's Session has $(clients) Clients, not 1, with the page on top"
  # The Attach restores the Place after it attaches; give it a moment.
  sleep 3
  page_first "the app's log says the phone showed a Terminal Screen or sized the Window with only the page on top"
  [ "$(window_now)" = 0 ] || fail "the Topic is in Window $(window_now), not in Window 0 of its Place"
  [ "$(window_size 0)" = "$MAC_SIZE" ] || fail "Window 0 is $(window_size 0): the phone sized it with only the page on top"
  [ "$(relayed)" -gt "$RELAYED_BEFORE" ] || fail "no Connection went through the slow relay"
}

# Back from the Terminal Screen or the Web View: both go to the Host Screen.
back_to_host() {
  for _ in 1 2; do
    agent-device is exists 'label="Host Options"' >/dev/null 2>&1 && return 0
    agent-device press 'id="BackButton"' >/dev/null 2>&1
    sleep 1
  done
  agent-device wait 'label="Host Options"' 8000 >/dev/null 2>&1 || fail "Back did not reach the Host Screen"
}

echo "0/8  two Topics, the first with two Windows, and a page at this Mac's Tailscale address"
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

python3 - "$(xcrun simctl get_app_container "${MUXIFY_E2E_DEVICE:-booted}" "$APP" data)/Documents/muxify-settings.json" <<'PY'
import json, sys
path = sys.argv[1]
settings = json.load(open(path))
settings.pop("hostScreenTabs", None)
records = json.load(open(path.replace("muxify-settings.json", "muxify-records.json")))
settings["chooserListPreferences"] = {host["id"]: ["windows", "topics"] for host in records["hosts"]}
json.dump(settings, open(path, "w"))
PY
TOPIC_ID=$(topic_new "$TOPIC") || fail "could not make $TOPIC"
TOPIC_SESSION=$(add_session "$TOPIC_ID" place-topic) || fail "could not add a Session to $TOPIC"
OTHER_ID=$(topic_new "$OTHER") || fail "could not make $OTHER"
add_session "$OTHER_ID" other-topic >/dev/null || fail "could not add a Session to $OTHER"
muxify topic pin --topic "$OTHER_ID" --json >/dev/null || fail "could not pin $OTHER"
muxify topic pin --topic "$TOPIC_ID" --json >/dev/null || fail "could not pin $TOPIC"
on_host "tmux new-window -d -t '$TOPIC_SESSION:' -n second" || fail "could not add a Window to $TOPIC_SESSION"
on_host "tmux select-window -t '$TOPIC_SESSION:0'"
tabs "$URL"

agent-device close >/dev/null 2>&1
agent-device open "$APP" --platform ios --relaunch "${device[@]}" >/dev/null 2>&1
agent-device wait text "Dev Host" 25000 >/dev/null 2>&1
agent-device press 'label="Host Dev Host"' --settle >/dev/null 2>&1

echo "1/8  a Tab of the Topic's Window opens in the Web View"
open_topic "$TOPIC"
open_title_sheet header-title
agent-device wait "label=\"Tab $URL\"" 15000 >/dev/null 2>&1 || fail "the Title Sheet does not list the Tab"
agent-device press "label=\"Tab $URL\"" >/dev/null 2>&1
page_on_top "the Web View did not show the page"
agent-device is text 'id="topic-title"' "$TOPIC" >/dev/null 2>&1 || fail "the Web View's title is not the Topic's"
echo "     the page, under the Topic's title"

echo "2/8  the Web View's title reaches the Topics list"
open_title_sheet web-view-title
agent-device press 'label="Topics"' >/dev/null 2>&1
agent-device wait "label=\"Topic $OTHER\"" 15000 >/dev/null 2>&1 || fail "the Web View's Title Sheet does not list the Topics"
sleep 1
agent-device press "label=\"Topic $OTHER\"" >/dev/null 2>&1
agent-device wait 'id="pane-command"' 20000 >/dev/null 2>&1 || fail "the Topic pick did not go to the Terminal Screen"
agent-device is text 'id="topic-title"' "$OTHER" >/dev/null 2>&1 || fail "the Topic pick did not open $OTHER"
agent-device is exists "text=\"$MARKER\"" >/dev/null 2>&1 && fail "the Web View is still on top after the Topic pick"
echo "     $OTHER on the Terminal Screen"

echo "3/8  $TOPIC opened again has its page on top, in the Window the phone was in"
on_host "tmux select-window -t '$TOPIC_SESSION:1'"
back_to_host
open_topic "$TOPIC"
page_on_top "the reopened Topic did not show its page"
sleep 1
WINDOW=$(on_host "tmux display-message -p -t '$TOPIC_SESSION' '#{window_index}'")
[ "$WINDOW" = 0 ] || fail "the reopened Topic is in Window $WINDOW, not in Window 0 where the phone left it"
echo "     the page, and Window 0 under it"

echo "4/8  Back from the page goes to the Host Screen, and $TOPIC opens on its page again"
agent-device press 'id="BackButton"' >/dev/null 2>&1
agent-device wait 'label="Host Options"' 8000 >/dev/null 2>&1 || fail "Back from the Web View did not go to the Host Screen"
open_topic "$TOPIC"
page_on_top "the Topic opened again after Back did not show its page"
echo "     the Host Screen, then the page again"

echo "5/8  after a relaunch, $TOPIC opens on its page with no Terminal Screen first, and does not resize the Window"
DATA=$(xcrun simctl get_app_container "${MUXIFY_E2E_DEVICE:-booted}" "$APP" data)/Documents
agent-device close >/dev/null 2>&1
xcrun simctl terminate "${MUXIFY_E2E_DEVICE:-booted}" "$APP" >/dev/null 2>&1
slow_link
RELAYED_BEFORE=$(relayed)
mac_sized
on_host "tmux select-window -t '$TOPIC_SESSION:1'"
[ "$(clients)" = 0 ] || fail "the Topic's Session still has a Client after the app was stopped"
agent-device open "$APP" --platform ios --relaunch "${device[@]}" >/dev/null 2>&1
agent-device wait text "Dev Host" 25000 >/dev/null 2>&1
agent-device press 'label="Host Dev Host"' --settle >/dev/null 2>&1
agent-device wait 'label="Host Options"' 15000 >/dev/null 2>&1 || fail "the Host Screen is not on top"
agent-device wait "label=\"Topic $TOPIC\"" 15000 >/dev/null 2>&1 || fail "the Host Screen does not list $TOPIC"
agent-device press "label=\"Topic $TOPIC\"" >/dev/null 2>&1
fresh_page "the Topic opened after a relaunch did not show its page"
echo "     the page, one Client, Window 0, and Window 0 still $MAC_SIZE"

echo "6/8  a cold start with Reconnect on start opens $TOPIC on its page, the same way"
agent-device close >/dev/null 2>&1
xcrun simctl terminate "${MUXIFY_E2E_DEVICE:-booted}" "$APP" >/dev/null 2>&1
python3 - "$DATA/muxify-settings.json" "$DATA/muxify-records.json" "$TOPIC_ID" <<'PY'
import json, sys
settings_path, records_path, topic = sys.argv[1:]
settings = json.load(open(settings_path))
settings["reconnectOnStart"] = True
json.dump(settings, open(settings_path, "w"))
last = json.load(open(records_path)).get("lastPlace") or {}
assert last.get("topicId") == topic, f"the Last Place is {last}"
PY
[ $? = 0 ] || fail "the Last Place is not $TOPIC"
slow_link
RELAYED_BEFORE=$(relayed)
mac_sized
on_host "tmux select-window -t '$TOPIC_SESSION:1'"
agent-device open "$APP" --platform ios --relaunch "${device[@]}" >/dev/null 2>&1
fresh_page "the cold start did not show the page of $TOPIC"
echo "     the page, one Client, Window 0, and Window 0 still $MAC_SIZE"

echo "7/8  a Window picked from the page goes to the terminal, which sizes the Window, and the Topic forgets the page"
open_title_sheet web-view-title
agent-device press 'label="Windows"' >/dev/null 2>&1
agent-device wait 'label="second"' 15000 >/dev/null 2>&1 || fail "the Web View's Title Sheet does not list the Windows"
sleep 1
agent-device press 'label="second"' >/dev/null 2>&1
agent-device wait 'id="pane-command"' 20000 >/dev/null 2>&1 || fail "the Window pick did not go to the Terminal Screen"
agent-device is exists "text=\"$MARKER\"" >/dev/null 2>&1 && fail "the Web View is still on top after the Window pick"
sleep 2
[ "$(window_size 1)" != "$MAC_SIZE" ] || fail "Window 1 is still $MAC_SIZE with the Terminal Screen shown"
back_to_host
open_topic "$TOPIC"
sleep 3
agent-device is exists "text=\"$MARKER\"" >/dev/null 2>&1 && fail "the Topic opened its page again after a Window pick"
WINDOW=$(on_host "tmux display-message -p -t '$TOPIC_SESSION' '#{window_index}'")
[ "$WINDOW" = 1 ] || fail "the reopened Topic is in Window $WINDOW, not in Window 1 that was picked"
echo "     the terminal in Window 1, and no page"

echo "8/8  a Tab the Host lists no more leaves the Topic on its Pane"
open_title_sheet header-title
agent-device wait "label=\"Tab $URL\"" 15000 >/dev/null 2>&1 || fail "the Title Sheet does not list the Tab again"
agent-device press "label=\"Tab $URL\"" >/dev/null 2>&1
page_on_top "the Web View did not show the page again"
tabs ""
back_to_host
open_topic "$TOPIC"
# The restore reads the Window's Tabs once; the Web View would be up by now.
sleep 4
agent-device is exists "text=\"$MARKER\"" >/dev/null 2>&1 && fail "the Web View opened a Tab the Host lists no more"
agent-device is text 'id="topic-title"' "$TOPIC" >/dev/null 2>&1 || fail "the Terminal Screen is not on $TOPIC"
echo "     the Pane, and no Web View"

agent-device close >/dev/null 2>&1
echo
echo "PASS: a Topic opened again is where it was left, its page included, also"
echo "      after Back from the page to the Host Screen; with no Attach up, after"
echo "      a relaunch and on a cold start, the page shows with no Terminal"
echo "      Screen first and does not resize the Mac's Window; a Window picked from"
echo "      the page goes to the terminal and forgets the page; and a Tab the"
echo "      Host lists no more leaves the Pane on top."
