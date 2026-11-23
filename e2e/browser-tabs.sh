#!/bin/bash
#
# The Title Sheet's Browser tabs, and the Web View a tap on one opens.
#
# What this proves, against the sandbox's Session 0:
#
#   1  the Title Sheet lists the Tabs that the phone can reach: an IPv4
#      address in 100.64.0.0/10, a *.ts.net name and a public site. It lists
#      no Tab at localhost or at a private address on the Host's LAN
#   2  the Tabs are those of the Window on screen: another Window's stored
#      Tabs are not listed
#   3  a tap on a Tab loads its page in the Web View, and the page's title is
#      the screen's title
#   4  Back from the Web View goes to the Host Screen with the Session still
#      attached, and the Session opened again has the page on top again; a
#      Window pick there goes to the Terminal Screen. Each way back to the
#      Terminal Screen is also the check on a crash: the Surface is freed and
#      built again, and a layer left over from the freed one took the app down
#      on about one Back in ten (see onSurfaceFreed in the libghostty patch)
#   5  a page that does not answer shows the reason, and Try again loads it
#      once it answers
#   6  a Host with no Browser for the Window shows no Browser tabs section
#
# The Tabs are stored in the sandbox's tmux Window options as desktop Muxify
# stores them (`stored-tabs`, see e2e/sandbox.sh), and the app gets them from
# the sandbox's real `muxify server`, so no step talks to the Muxify app on this
# Mac. A stored Tab has no title yet, so each row is the Tab's address. The
# page is real: a web server on this Mac's own Tailscale address, which the
# simulator reaches as a phone on the tailnet does. No step taps the public
# site's Tab, so the run does not need the internet.
#
# Step 3 runs a second time for this Mac's *.ts.net name when Tailscale gives
# it one that resolves. That page is plain http at a name, which iOS loads only
# with NSAllowsArbitraryLoadsInWebContent, so it is the check on that setting.
#
# Requires a configured .env.local, a booted simulator and Tailscale up on this Mac.
# Usage:  bash e2e/browser-tabs.sh

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail

APP=dev.muxify.app
device=()
[ -z "${MUXIFY_E2E_DEVICE:-}" ] || device=(--udid "$MUXIFY_E2E_DEVICE")
SESSION=0
ROOT=$MUXIFY_E2E_ROOT
MARKER=browser-tabs-e2e-marker
PAGE_TITLE="E2E Tailscale page"
FAKE_NAME=e2e.tail0000.ts.net
WINDOW_NAME=browser-tabs-window

on_host() { sh -c "$*" 2>/dev/null; }

fail() { echo "FAIL: $1"; exit 1; }

SERVERS=
trap '[ -n "$SERVERS" ] && kill $SERVERS 2>/dev/null' EXIT

free_port() {
  python3 -c 'import socket, sys; s = socket.socket(); s.bind((sys.argv[1], 0)); print(s.getsockname()[1])' "$ADDRESS"
}

# Serves $ROOT/www at the Tailscale address on a port, and waits until it answers.
serve() {
  python3 -m http.server "$1" --bind "$ADDRESS" --directory "$ROOT/www" >/dev/null 2>&1 &
  SERVERS="$SERVERS $!"
  for _ in $(seq 50); do
    curl -s -o /dev/null "http://$ADDRESS:$1/" && return 0
    sleep 0.1
  done
  fail "the page is not up at the Tailscale address"
}

attach() {
  agent-device close >/dev/null 2>&1
  agent-device open "$APP" --platform ios --relaunch "${device[@]}" >/dev/null 2>&1
  agent-device wait text "Dev Host" 25000 >/dev/null 2>&1
  agent-device press 'label="Host Dev Host"' --settle >/dev/null 2>&1
  agent-device wait "label=\"Session $SESSION\"" 15000 >/dev/null 2>&1
  agent-device press "label=\"Session $SESSION\"" >/dev/null 2>&1
  agent-device wait 'id="pane-command"' 20000 >/dev/null 2>&1 \
    || fail "the header never showed a program, so the Attach never connected"
}

open_title_sheet() {
  # A press within about a second of a push or a pop can be lost.
  sleep 1.5
  agent-device press 'id="header-title"' >/dev/null 2>&1
  agent-device wait 'label="Close Choose"' 8000 >/dev/null 2>&1 || fail "the Title Sheet never opened"
}

# The phone's Clients on the Session. A Listener, such as the Host Server's,
# asks for ignore-size and is no one's Client, as tmux-client.ts counts them.
clients() { on_host "tmux list-clients -t '$SESSION' -F '#{client_flags}'" | grep -vc ignore-size; }

# Back from the Web View to the Host Screen, then the Session again, whose
# Session Place has the page on top, then the Window in the Title Sheet, which
# goes to the Terminal Screen.
back() {
  agent-device press 'id="BackButton"' >/dev/null 2>&1
  agent-device wait 'label="Host Options"' 8000 >/dev/null 2>&1 || fail "Back from the Web View did not go to the Host Screen"
  [ "$(clients)" = 1 ] || fail "the Session is not attached under the Host Screen after Back from the Web View"
  agent-device press "label=\"Session $SESSION\"" >/dev/null 2>&1
  agent-device wait "text=\"$MARKER\"" 20000 >/dev/null 2>&1 || fail "the Session opened again did not show its page"
  sleep 1.5
  agent-device press 'id="web-view-title"' >/dev/null 2>&1
  agent-device wait 'label="Close Choose"' 8000 >/dev/null 2>&1 || fail "the Web View's Title Sheet never opened"
  sleep 1
  # The list around the rows has the first Window's name too.
  agent-device press "role=button label=\"$WINDOW_NAME\"" >/dev/null 2>&1
  agent-device wait 'id="pane-command"' 20000 >/dev/null 2>&1 || fail "the Window pick did not go to the Terminal Screen"
}

# Presses a Tab's row and waits for its page, then goes Back to the Session.
open_tab() {
  # A press on a sheet that still moves lands nowhere.
  sleep 1
  agent-device press "label=\"Tab $1\"" >/dev/null 2>&1
  agent-device wait "text=\"$MARKER\"" 20000 >/dev/null 2>&1 || fail "the Web View did not show the page of $1"
  agent-device wait "text=\"$PAGE_TITLE\"" 5000 >/dev/null 2>&1 \
    || fail "the Web View's title is not the page's title"
  back
}

echo "0/6  a page on this Mac's Tailscale address, and six Tabs stored on the Host"
ADDRESS=$(tailscale ip -4 2>/dev/null | head -1)
[ -n "$ADDRESS" ] || fail "this Mac has no Tailscale address: start Tailscale"
NAME=$(tailscale status --json 2>/dev/null \
  | python3 -c 'import json, sys; print(json.load(sys.stdin)["Self"].get("DNSName", "").rstrip("."))')
python3 -c 'import socket, sys; socket.gethostbyname(sys.argv[1])' "${NAME:-none.invalid}" 2>/dev/null || NAME=
PORT=$(free_port)
DOWN_PORT=$(free_port)
mkdir -p "$ROOT/www"
printf '<!doctype html><title>%s</title><h1>%s</h1>\n' "$PAGE_TITLE" "$MARKER" >"$ROOT/www/index.html"
serve "$PORT"

BY_ADDRESS="http://$ADDRESS:$PORT/"
BY_NAME="http://${NAME:-$FAKE_NAME}:$PORT/"
DOWN="http://$ADDRESS:$DOWN_PORT/"
PUBLIC=https://example.com/
OTHER_WINDOW_TAB=https://other-window.example.com/
on_host "tmux kill-window -a -t '$SESSION:0' 2>/dev/null; true" || fail "could not reach the dev Host"
WINDOW=$(on_host "tmux display-message -p -t '$SESSION:0' '#{window_id}'")
on_host "tmux rename-window -t '$SESSION:0' $WINDOW_NAME" || fail "could not name $WINDOW"
stored-tabs "$WINDOW" 1 http://localhost:3000/ "$BY_ADDRESS" "$BY_NAME" "$PUBLIC" "$DOWN" http://192.168.1.10:8080/ \
  || fail "could not store the Tabs of $WINDOW"
# A second Window, behind the first, whose Tab the Title Sheet must not list.
OTHER=$(on_host "tmux new-window -d -P -F '#{window_id}' -t '$SESSION:'") || fail "could not add a second Window"
stored-tabs "$OTHER" 0 "$OTHER_WINDOW_TAB" || fail "could not store the Tabs of $OTHER"
attach

echo "1/6  the Title Sheet lists the Tabs the phone can reach, and no other"
open_title_sheet
agent-device wait "label=\"Tab $BY_ADDRESS\"" 15000 >/dev/null 2>&1 \
  || fail "the Title Sheet does not list the Tab at the Tailscale address"
agent-device is exists "label=\"Tab $BY_NAME\"" >/dev/null 2>&1 \
  || fail "the Title Sheet does not list the Tab at the *.ts.net name"
agent-device is exists 'text="Browser tabs"' >/dev/null 2>&1 || fail "the Tabs have no Browser tabs header"
agent-device is exists "label=\"Tab $PUBLIC\"" >/dev/null 2>&1 \
  || fail "the Title Sheet does not list the Tab at a public site"
agent-device is exists 'label="Tab http://localhost:3000/"' >/dev/null 2>&1 && fail "the Title Sheet lists a Tab at localhost"
agent-device is exists 'label="Tab http://192.168.1.10:8080/"' >/dev/null 2>&1 && fail "the Title Sheet lists a Tab at a LAN address"
echo "     the Tailscale address, the *.ts.net Tab and the public site listed; localhost and the LAN address left out"

echo "2/6  the Tabs are those of the Window on screen"
agent-device is exists "label=\"Tab $OTHER_WINDOW_TAB\"" >/dev/null 2>&1 \
  && fail "the Title Sheet lists a Tab of $OTHER, which is not on screen"
grep -q "^browser tabs" "$ROOT/browser-calls" 2>/dev/null && fail "the app ran \`muxify browser tabs\`"
echo "     the Tabs of $WINDOW, from the Host Server, and none of $OTHER"

echo "3/6  a tap on a Tab loads its page in the Web View"
open_tab "$BY_ADDRESS"
echo "     http://<Tailscale address>:$PORT/ loaded, with its title"
if [ -n "$NAME" ]; then
  open_title_sheet
  agent-device wait "label=\"Tab http://$NAME:$PORT/\"" 15000 >/dev/null 2>&1 \
    || fail "the Title Sheet does not list the Tab at the *.ts.net name the second time"
  open_tab "http://$NAME:$PORT/"
  echo "     http://<this Mac>.ts.net:$PORT/ loaded too: plain http at a name"
else
  echo "     SKIP: this Mac has no *.ts.net name that resolves, so plain http at a name is not checked"
fi

echo "4/6  Back went to the Host Screen, and the Session stayed attached"
CLIENTS=$(clients)
[ "$CLIENTS" = 1 ] || fail "the Host has $CLIENTS Client(s) on Session $SESSION after the Web View, not 1"
echo "     one Client on the Host, as before"

echo "5/6  a page that does not answer shows the reason, and Try again loads it"
open_title_sheet
agent-device wait "label=\"Tab $DOWN\"" 15000 >/dev/null 2>&1 || fail "the Title Sheet does not list the page that is down"
sleep 1
agent-device press "label=\"Tab $DOWN\"" >/dev/null 2>&1
agent-device wait 'label="Try again"' 20000 >/dev/null 2>&1 || fail "the Web View did not say that the page is down"
agent-device is exists 'label="Could not connect to the server."' >/dev/null 2>&1 \
  || fail "the Web View does not give the reason"
serve "$DOWN_PORT"
agent-device press 'label="Try again"' >/dev/null 2>&1
agent-device wait "text=\"$MARKER\"" 20000 >/dev/null 2>&1 || fail "Try again did not load the page"
agent-device is exists 'label="Try again"' >/dev/null 2>&1 && fail "the reason is still over the loaded page"
back
echo "     Could not connect to the server, then the page"

echo "6/6  a Window with no Browser shows no Browser tabs"
stored-tabs "$WINDOW" || fail "could not remove the Tabs of $WINDOW"
open_title_sheet
sleep 3
agent-device is exists 'text="Browser tabs"' >/dev/null 2>&1 && fail "the Title Sheet still shows Browser tabs"
agent-device is exists "label=\"Tab $BY_ADDRESS\"" >/dev/null 2>&1 && fail "the Title Sheet still lists a Tab"
agent-device is exists 'label="Close Choose"' >/dev/null 2>&1 || fail "the Title Sheet closed"
agent-device press 'label="Close Choose"' >/dev/null 2>&1

agent-device close >/dev/null 2>&1
echo
echo "PASS: the Title Sheet lists the Window's Browser Tabs that the phone can"
echo "      reach and no other, a tap loads the page in the Web View with the"
echo "      page's title, Back goes to the Host Screen with the Session attached"
echo "      and the Session opened again shows the page again, a page that is down"
echo "      shows the reason and loads on Try again, and a Window with no Browser"
echo "      has no Browser tabs section."
