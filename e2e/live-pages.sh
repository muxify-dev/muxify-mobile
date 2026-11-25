#!/bin/bash
#
# Live Pages: a page left and opened again is as the user left it, a form half
# filled in included, and no Topic sees another Topic's page.
#
# What this proves, against two Topics in the sandbox:
#
#   1  a Tab opened in Topic A loads its page, and text goes into its form
#   2  Back to the Host Screen, then Topic A again: the page is on top with the
#      text still in the form, and the page did not load again
#   3  a Window picked in the Web View's Title Sheet, then the same Tab again:
#      the same page, the text still there
#   4  the same Tab in Topic B is a page of its own, with an empty form
#   5  Topic A again has its own text, and not Topic B's
#   6  Close Page goes to the Terminal Screen, and the Tab opened again loads
#      a new page with an empty form
#   7  a Topic settled on the Mac releases its pages: the app's log says so
#
# A page that loads again gets a new load id from its script, so the same id
# means the same page. The form's text shows in a line under it, which the
# script writes, so a form that a reload or the back-forward cache filled in
# again would not show it.
#
# The Tabs are stored in the sandbox's tmux Window options (`stored-tabs`, see
# e2e/sandbox.sh), and the page is served at this Mac's Tailscale address, as in
# e2e/topic-place.sh. No step talks to the Muxify app on this Mac.
#
# Requires a configured .env.local, a booted simulator and Tailscale up on this Mac.
# Usage:  bash e2e/live-pages.sh

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail

APP=dev.muxify.app
device=()
[ -z "${MUXIFY_E2E_DEVICE:-}" ] || device=(--udid "$MUXIFY_E2E_DEVICE")
ROOT=$MUXIFY_E2E_ROOT
MARKER=live-pages-e2e-marker
TOPIC_A="e2e Live Topic A"
TOPIC_B="e2e Live Topic B"
WINDOW_NAME=live-window

on_host() { sh -c "$*" 2>/dev/null; }

fail() { echo "FAIL: $1"; exit 1; }

SERVER=
trap '[ -n "$SERVER" ] && kill $SERVER 2>/dev/null' EXIT

topic_new() {
  muxify topic new "$1" --json | python3 -c 'import json, sys; print(json.load(sys.stdin)["changed"]["topic_id"])'
}

add_session() {
  mkdir -p "$ROOT/$2"
  muxify topic add-session "$ROOT/$2" --topic "$1" --json \
    | python3 -c 'import json, sys; print(json.load(sys.stdin)["changed"]["session_name"])'
}

open_title_sheet() {
  # A press within about a second of a push or a pop can be lost.
  sleep 1.5
  agent-device press "id=\"$1\"" >/dev/null 2>&1
  agent-device wait 'label="Close Choose"' 8000 >/dev/null 2>&1 || fail "the Title Sheet never opened from $1"
  # A press on a sheet that still moves lands nowhere.
  sleep 1
}

open_topic() {
  agent-device wait 'label="Host Options"' 15000 >/dev/null 2>&1 || fail "the Host Screen is not on top"
  agent-device wait "label=\"Topic $1\"" 15000 >/dev/null 2>&1 || fail "the Host Screen does not list $1"
  agent-device press "label=\"Topic $1\"" >/dev/null 2>&1
  agent-device wait 'id="topic-title"' 20000 >/dev/null 2>&1 || fail "$1 did not attach"
}

back_to_host() {
  for _ in 1 2; do
    agent-device is exists 'label="Host Options"' >/dev/null 2>&1 && return 0
    agent-device press 'id="BackButton"' >/dev/null 2>&1
    sleep 1
  done
  agent-device wait 'label="Host Options"' 8000 >/dev/null 2>&1 || fail "Back did not reach the Host Screen"
}

# The Tab, from the Title Sheet of the Terminal Screen.
open_tab() {
  open_title_sheet header-title
  agent-device press 'label="Windows"' >/dev/null 2>&1
  agent-device wait "label=\"Tab $URL\"" 15000 >/dev/null 2>&1 || fail "the Title Sheet does not list the Tab"
  agent-device press "label=\"Tab $URL\"" >/dev/null 2>&1
  page_on_top "the Web View did not show the page"
}

page_on_top() {
  agent-device wait "text=\"$MARKER\"" 20000 >/dev/null 2>&1 || fail "$1"
  agent-device is exists 'id="web-view-title"' >/dev/null 2>&1 || fail "the Web View has no Header title"
}

# The load id the page's script wrote, of the page on screen.
load_id() {
  agent-device snapshot 2>/dev/null | grep -oE 'load-[a-z0-9]{8}' | head -1
}

type_draft() {
  agent-device fill 'label="Draft field"' "$1" >/dev/null 2>&1 || fail "could not type into the page's form"
  agent-device wait "text=\"typed: $1\"" 8000 >/dev/null 2>&1 || fail "the page did not take the text $1"
  # Down with the keyboard, so the Header is in reach again.
  agent-device keyboard dismiss >/dev/null 2>&1
}

has_draft() {
  agent-device wait "text=\"typed: $1\"" 8000 >/dev/null 2>&1 || fail "$2"
}

no_draft() {
  agent-device is exists "text=\"typed: $1\"" >/dev/null 2>&1 && fail "$2"
  return 0
}

echo "0/7  two Topics, and a page with a form at this Mac's Tailscale address"
ADDRESS=$(tailscale ip -4 2>/dev/null | head -1)
[ -n "$ADDRESS" ] || fail "this Mac has no Tailscale address: start Tailscale"
PORT=$(python3 -c 'import socket, sys; s = socket.socket(); s.bind((sys.argv[1], 0)); print(s.getsockname()[1])' "$ADDRESS")
URL="http://$ADDRESS:$PORT/"
mkdir -p "$ROOT/www"
cat >"$ROOT/www/index.html" <<HTML
<!doctype html><title>E2E Live page</title>
<meta name="viewport" content="width=device-width">
<h1>$MARKER</h1>
<p id="load"></p>
<input id="draft" aria-label="Draft field" autocomplete="off">
<p id="typed"></p>
<script>
  document.getElementById('load').textContent = 'load-' + Math.random().toString(36).slice(2, 10).padEnd(8, '0');
  document.getElementById('draft').addEventListener('input', (event) => {
    document.getElementById('typed').textContent = 'typed: ' + event.target.value;
  });
</script>
HTML
python3 -m http.server "$PORT" --bind "$ADDRESS" --directory "$ROOT/www" >/dev/null 2>&1 &
SERVER=$!
for _ in $(seq 50); do curl -s -o /dev/null "$URL" && break; sleep 0.1; done
curl -s -o /dev/null "$URL" || fail "the page is not up at the Tailscale address"

DATA=$(xcrun simctl get_app_container "${MUXIFY_E2E_DEVICE:-booted}" "$APP" data)
python3 - "$DATA/Documents/muxify-settings.json" <<'PY'
import json, sys
path = sys.argv[1]
settings = json.load(open(path))
settings.pop("hostScreenTabs", None)
records = json.load(open(path.replace("muxify-settings.json", "muxify-records.json")))
settings["chooserListPreferences"] = {host["id"]: ["windows", "topics"] for host in records["hosts"]}
json.dump(settings, open(path, "w"))
PY
A_ID=$(topic_new "$TOPIC_A") || fail "could not make $TOPIC_A"
A_SESSION=$(add_session "$A_ID" live-a) || fail "could not add a Session to $TOPIC_A"
B_ID=$(topic_new "$TOPIC_B") || fail "could not make $TOPIC_B"
B_SESSION=$(add_session "$B_ID" live-b) || fail "could not add a Session to $TOPIC_B"
muxify topic pin --topic "$B_ID" --json >/dev/null || fail "could not pin $TOPIC_B"
muxify topic pin --topic "$A_ID" --json >/dev/null || fail "could not pin $TOPIC_A"
for session in "$A_SESSION" "$B_SESSION"; do
  on_host "tmux rename-window -t '$session:0' $WINDOW_NAME" || fail "could not name the Window of $session"
done
for window in $(on_host "tmux list-windows -a -F '#{window_id}'"); do
  stored-tabs "$window" 0 "$URL" || fail "could not store the Tabs of $window"
done

agent-device close >/dev/null 2>&1
agent-device open "$APP" --platform ios --relaunch "${device[@]}" >/dev/null 2>&1
agent-device wait text "Dev Host" 25000 >/dev/null 2>&1
agent-device press 'label="Host Dev Host"' --settle >/dev/null 2>&1

echo "1/7  a Tab in $TOPIC_A loads its page, and text goes into its form"
open_topic "$TOPIC_A"
open_tab
LOAD_A=$(load_id)
[ -n "$LOAD_A" ] || fail "the page has no load id"
type_draft draft-a
echo "     $LOAD_A, with draft-a in the form"

echo "2/7  Back, then $TOPIC_A again: the same page, the text still there"
back_to_host
open_topic "$TOPIC_A"
page_on_top "$TOPIC_A opened again did not have its page on top"
has_draft draft-a "the form lost its text after Back and the Topic opened again"
[ "$(load_id)" = "$LOAD_A" ] || fail "the page loaded again after Back: $(load_id), not $LOAD_A"
echo "     $LOAD_A, draft-a"

echo "3/7  a Window pick, then the Tab again: the same page"
open_title_sheet web-view-title
agent-device press 'label="Windows"' >/dev/null 2>&1
agent-device wait "role=button label=\"$WINDOW_NAME\"" 15000 >/dev/null 2>&1 || fail "the Web View's Title Sheet does not list the Window"
agent-device press "role=button label=\"$WINDOW_NAME\"" >/dev/null 2>&1
agent-device wait 'id="pane-command"' 20000 >/dev/null 2>&1 || fail "the Window pick did not go to the Terminal Screen"
open_tab
has_draft draft-a "the form lost its text after a Window pick"
[ "$(load_id)" = "$LOAD_A" ] || fail "the page loaded again after a Window pick: $(load_id), not $LOAD_A"
echo "     $LOAD_A, draft-a"

echo "4/7  the same Tab in $TOPIC_B is a page of its own"
back_to_host
open_topic "$TOPIC_B"
open_tab
no_draft draft-a "$TOPIC_B shows the text typed in $TOPIC_A"
LOAD_B=$(load_id)
[ -n "$LOAD_B" ] && [ "$LOAD_B" != "$LOAD_A" ] || fail "$TOPIC_B shows the page of $TOPIC_A ($LOAD_B)"
type_draft draft-b
echo "     $LOAD_B, with draft-b in the form"

echo "5/7  $TOPIC_A again has its own text"
back_to_host
open_topic "$TOPIC_A"
page_on_top "$TOPIC_A opened again did not have its page on top"
has_draft draft-a "$TOPIC_A lost its text after $TOPIC_B"
no_draft draft-b "$TOPIC_A shows the text typed in $TOPIC_B"
[ "$(load_id)" = "$LOAD_A" ] || fail "$TOPIC_A's page loaded again: $(load_id), not $LOAD_A"
echo "     $LOAD_A, draft-a, and no draft-b"

echo "6/7  Close Page goes to the terminal, and the Tab opens a new page"
sleep 1
agent-device press 'label="Close Page"' >/dev/null 2>&1
agent-device wait 'id="pane-command"' 20000 >/dev/null 2>&1 || fail "Close Page did not go to the Terminal Screen"
agent-device is exists "text=\"$MARKER\"" >/dev/null 2>&1 && fail "the page is still on screen after Close Page"
open_tab
no_draft draft-a "the Tab opened after Close Page still has the text"
LOAD_NEW=$(load_id)
[ -n "$LOAD_NEW" ] && [ "$LOAD_NEW" != "$LOAD_A" ] || fail "the Tab opened after Close Page is the closed page ($LOAD_NEW)"
echo "     $LOAD_NEW, an empty form"

echo "7/7  $TOPIC_B settled on the Mac releases its page"
back_to_host
muxify topic settle --topic "$B_ID" --json >/dev/null || fail "could not settle $TOPIC_B"
agent-device wait absent "label=\"Topic $TOPIC_B\"" 20000 >/dev/null 2>&1 || fail "the Host Screen still lists $TOPIC_B"
released=
for _ in $(seq 20); do
  if grep -rqsF "releasing the page of $URL (its owner is gone from the Host)" "$DATA/muxify-logs"; then released=1; break; fi
  sleep 0.5
done
[ -n "$released" ] || fail "the app's log does not say that $TOPIC_B's page was released"
open_topic "$TOPIC_A"
page_on_top "$TOPIC_A lost its page when $TOPIC_B was settled"
no_draft draft-a "$TOPIC_A's page is the closed one"
[ "$(load_id)" = "$LOAD_NEW" ] || fail "$TOPIC_A's page loaded again when $TOPIC_B was settled"
echo "     released; $TOPIC_A keeps $LOAD_NEW"

agent-device close >/dev/null 2>&1
echo
echo "PASS: a page left by Back or a Window pick comes back as it was, form"
echo "      text and all, with no reload; each Topic has its own page of a Tab;"
echo "      Close Page releases the page; a settled Topic releases its pages."
