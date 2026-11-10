#!/bin/bash
#
# The Title Sheet's Browser tabs, and the Web View a tap on one opens.
#
# What this proves, against the sandbox's Session 0:
#
#   1  the Title Sheet lists the Tabs at a Tailscale address, an IPv4 address
#      in 100.64.0.0/10 and a *.ts.net name, and no Tab at localhost or at a
#      public site
#   2  the app asked the Host for the Tabs of the Window on screen, by tmux's id
#   3  a tap on a Tab loads its page in the Web View, and the page's title is
#      the screen's title
#   4  Back from the Web View finds the Session still attached. Each Back is
#      also the check on a crash: the Surface under the Web View is freed and
#      built again, and a layer left over from the freed one took the app down
#      on about one Back in ten (see onSurfaceFreed in the libghostty patch)
#   5  a page that does not answer shows the reason, and Try again loads it
#      once it answers
#   6  a Host with no Browser for the Window shows no Browser tabs section
#
# The sandbox's `muxify` is a stub for `browser` (see e2e/sandbox.sh), so no
# step talks to the Muxify app on this Mac. The Tabs are a fixture. The page is
# real: a web server on this Mac's own Tailscale address, which the simulator
# reaches as a phone on the tailnet does.
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
SESSION=0
ROOT=$MUXIFY_E2E_ROOT
MARKER=browser-tabs-e2e-marker
PAGE_TITLE="E2E Tailscale page"
FAKE_NAME=e2e.tail0000.ts.net

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
  agent-device open "$APP" --platform ios --relaunch >/dev/null 2>&1
  agent-device wait text "Dev Host" 25000 >/dev/null 2>&1
  agent-device wait "label=\"Session $SESSION\"" 15000 >/dev/null 2>&1
  agent-device press "label=\"Session $SESSION\"" >/dev/null 2>&1
  agent-device wait 'id="pane-command"' 20000 >/dev/null 2>&1 \
    || fail "the header never showed a program, so the Attach never connected"
}

open_title_sheet() {
  agent-device press 'id="header-title"' >/dev/null 2>&1
  agent-device wait 'label="Close Windows"' 8000 >/dev/null 2>&1 || fail "the Title Sheet never opened"
}

# Back from the Web View to the Session under it.
back() {
  agent-device press 'id="BackButton"' >/dev/null 2>&1
  agent-device wait 'id="pane-command"' 5000 >/dev/null 2>&1 || fail "Back did not find the Session attached"
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

echo "0/6  a page on this Mac's Tailscale address, and five Tabs on the Host"
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

# The titles are the Host's, as the desktop Browser last saw them. The second
# Tab has none, so its row is its address.
python3 - "$ROOT/browser-tabs.json" "http://$ADDRESS:$PORT/" "http://${NAME:-$FAKE_NAME}:$PORT/" "http://$ADDRESS:$DOWN_PORT/" <<'PY'
import json, sys
path, by_address, by_name, down = sys.argv[1:5]
json.dump([
    {"active": False, "id": "11111111-1111-1111-1111-111111111111", "title": "Localhost page", "url": "http://localhost:3000/"},
    {"active": True, "id": "22222222-2222-2222-2222-222222222222", "title": "By address", "url": by_address},
    {"active": False, "id": "33333333-3333-3333-3333-333333333333", "title": "", "url": by_name},
    {"active": False, "id": "44444444-4444-4444-4444-444444444444", "title": "Public page", "url": "https://example.com/"},
    {"active": False, "id": "55555555-5555-5555-5555-555555555555", "title": "Down page", "url": down},
], open(path, "w"))
PY
on_host "tmux kill-window -a -t '$SESSION:0' 2>/dev/null; true" || fail "could not reach the dev Host"
attach

echo "1/6  the Title Sheet lists the Tabs at a Tailscale address, and no other"
open_title_sheet
agent-device wait 'label="Tab By address"' 15000 >/dev/null 2>&1 \
  || fail "the Title Sheet does not list the Tab at the Tailscale address"
agent-device is exists "label=\"Tab http://${NAME:-$FAKE_NAME}:$PORT/\"" >/dev/null 2>&1 \
  || fail "the Title Sheet does not list the Tab at the *.ts.net name"
agent-device is exists 'text="Browser tabs"' >/dev/null 2>&1 || fail "the Tabs have no Browser tabs header"
agent-device is exists 'label="Tab Localhost page"' >/dev/null 2>&1 && fail "the Title Sheet lists a Tab at localhost"
agent-device is exists 'label="Tab Public page"' >/dev/null 2>&1 && fail "the Title Sheet lists a Tab at a public site"
echo "     By address and the *.ts.net Tab listed; localhost and the public site left out"

echo "2/6  the app asked for the Tabs of the Window on screen"
WINDOW=$(on_host "tmux display-message -p -t '$SESSION:' '#{window_id}'")
grep -qx "browser tabs --window $WINDOW --json" "$ROOT/browser-calls" \
  || fail "the Host was not asked for the Tabs of $WINDOW: $(cat "$ROOT/browser-calls" 2>/dev/null)"
echo "     browser tabs --window $WINDOW --json"

echo "3/6  a tap on a Tab loads its page in the Web View"
open_tab "By address"
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

echo "4/6  the Session stayed attached under the Web View"
CLIENTS=$(on_host "tmux list-clients -t '$SESSION'" | wc -l | tr -d ' ')
[ "$CLIENTS" = 1 ] || fail "the Host has $CLIENTS Client(s) on Session $SESSION after the Web View, not 1"
echo "     one Client on the Host, as before"

echo "5/6  a page that does not answer shows the reason, and Try again loads it"
open_title_sheet
agent-device wait 'label="Tab Down page"' 15000 >/dev/null 2>&1 || fail "the Title Sheet does not list the Down page"
sleep 1
agent-device press 'label="Tab Down page"' >/dev/null 2>&1
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
rm "$ROOT/browser-tabs.json"
CALLS=$(wc -l <"$ROOT/browser-calls")
open_title_sheet
for _ in $(seq 50); do
  [ "$(wc -l <"$ROOT/browser-calls")" -gt "$CALLS" ] && break
  sleep 0.2
done
[ "$(wc -l <"$ROOT/browser-calls")" -gt "$CALLS" ] || fail "the Title Sheet did not ask for the Tabs again"
sleep 2
agent-device is exists 'text="Browser tabs"' >/dev/null 2>&1 && fail "the Title Sheet still shows Browser tabs"
agent-device is exists 'label="Tab By address"' >/dev/null 2>&1 && fail "the Title Sheet still lists a Tab"
agent-device is exists 'label="Switch…"' >/dev/null 2>&1 || fail "the Title Sheet lost its other rows"
agent-device press 'label="Close Windows"' >/dev/null 2>&1

agent-device close >/dev/null 2>&1
echo
echo "PASS: the Title Sheet lists the Window's Browser Tabs at a Tailscale"
echo "      address and no other, a tap loads the page in the Web View with the"
echo "      page's title, Back finds the Session attached, a page that is down"
echo "      shows the reason and loads on Try again, and a Window with no Browser"
echo "      has no Browser tabs section."
