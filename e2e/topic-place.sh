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
#      top again, with the same page, although the Mac moved tmux's active
#      Window meanwhile; Back from it finds the Window the phone was in
#   4  a Tab that the Host lists no more leaves the reopened Topic on its Pane
#
# The sandbox's `muxify` is a stub for `browser` (see e2e/sandbox.sh): the Tabs
# are a fixture, and no step talks to the Muxify app on this Mac. The page is
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

# The Tabs the Host lists for every Window: the page, or none of it.
tabs() {
  python3 - "$ROOT/browser-tabs.json" "$1" <<'PY'
import json, sys
path, url = sys.argv[1:3]
tabs = [{"active": False, "id": "11111111-1111-1111-1111-111111111111", "title": "Public page", "url": "https://example.com/"}]
if url:
    tabs.insert(0, {"active": True, "id": "22222222-2222-2222-2222-222222222222", "title": "Place page", "url": url})
json.dump(tabs, open(path, "w"))
PY
}

open_title_sheet() {
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

# Back from the Terminal Screen, or from the Web View and then the Terminal Screen.
back_to_host() {
  for _ in 1 2; do
    agent-device is exists 'label="Host Options"' >/dev/null 2>&1 && return 0
    agent-device press 'id="BackButton"' >/dev/null 2>&1
    sleep 1
  done
  agent-device wait 'label="Host Options"' 8000 >/dev/null 2>&1 || fail "Back did not reach the Host Screen"
}

echo "0/4  two Topics, the first with two Windows, and a page at this Mac's Tailscale address"
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
tabs "$URL"

python3 - "$(xcrun simctl get_app_container "${MUXIFY_E2E_DEVICE:-booted}" "$APP" data)/Documents/muxify-settings.json" <<'PY'
import json, sys
path = sys.argv[1]
settings = json.load(open(path))
settings.pop("hostListPreferences", None)
settings["hostScreenLists"] = ["topics", "sessions"]
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

agent-device close >/dev/null 2>&1
agent-device open "$APP" --platform ios --relaunch "${device[@]}" >/dev/null 2>&1
agent-device wait text "Dev Host" 25000 >/dev/null 2>&1
agent-device press 'label="Host Dev Host"' --settle >/dev/null 2>&1

echo "1/4  a Tab of the Topic's Window opens in the Web View"
open_topic "$TOPIC"
open_title_sheet header-title
agent-device wait 'label="Tab Place page"' 15000 >/dev/null 2>&1 || fail "the Title Sheet does not list the Tab"
agent-device press 'label="Tab Place page"' >/dev/null 2>&1
page_on_top "the Web View did not show the page"
agent-device is text 'id="topic-title"' "$TOPIC" >/dev/null 2>&1 || fail "the Web View's title is not the Topic's"
echo "     the page, under the Topic's title"

echo "2/4  the Web View's title reaches the Topics list"
open_title_sheet web-view-title
agent-device press 'label="Topics"' >/dev/null 2>&1
agent-device wait "label=\"Topic $OTHER\"" 15000 >/dev/null 2>&1 || fail "the Web View's Title Sheet does not list the Topics"
sleep 1
agent-device press "label=\"Topic $OTHER\"" >/dev/null 2>&1
agent-device wait 'id="pane-command"' 20000 >/dev/null 2>&1 || fail "the Topic pick did not go to the Terminal Screen"
agent-device is text 'id="topic-title"' "$OTHER" >/dev/null 2>&1 || fail "the Topic pick did not open $OTHER"
agent-device is exists "text=\"$MARKER\"" >/dev/null 2>&1 && fail "the Web View is still on top after the Topic pick"
echo "     $OTHER on the Terminal Screen"

echo "3/4  $TOPIC opened again has its page on top, in the Window the phone was in"
on_host "tmux select-window -t '$TOPIC_SESSION:1'"
back_to_host
open_topic "$TOPIC"
page_on_top "the reopened Topic did not show its page"
agent-device press 'id="BackButton"' >/dev/null 2>&1
agent-device wait 'id="pane-command"' 8000 >/dev/null 2>&1 || fail "Back from the Web View did not find the Session"
sleep 1
WINDOW=$(on_host "tmux display-message -p -t '$TOPIC_SESSION' '#{window_index}'")
[ "$WINDOW" = 0 ] || fail "the reopened Topic is in Window $WINDOW, not in Window 0 where the phone left it"
echo "     the page, and Window 0 under it"

echo "4/4  a Tab the Host lists no more leaves the Topic on its Pane"
open_title_sheet header-title
agent-device wait 'label="Tab Place page"' 15000 >/dev/null 2>&1 || fail "the Title Sheet does not list the Tab again"
agent-device press 'label="Tab Place page"' >/dev/null 2>&1
page_on_top "the Web View did not show the page again"
open_title_sheet web-view-title
agent-device press 'label="Topics"' >/dev/null 2>&1
agent-device wait "label=\"Topic $OTHER\"" 15000 >/dev/null 2>&1 || fail "the Topics list is gone"
sleep 1
agent-device press "label=\"Topic $OTHER\"" >/dev/null 2>&1
agent-device wait 'id="pane-command"' 20000 >/dev/null 2>&1 || fail "the second Topic pick did not go to the Terminal Screen"
tabs ""
CALLS=$(wc -l <"$ROOT/browser-calls")
back_to_host
open_topic "$TOPIC"
for _ in $(seq 50); do
  [ "$(wc -l <"$ROOT/browser-calls")" -gt "$CALLS" ] && break
  sleep 0.2
done
[ "$(wc -l <"$ROOT/browser-calls")" -gt "$CALLS" ] || fail "the reopened Topic did not read its Window's Tabs"
sleep 3
agent-device is exists "text=\"$MARKER\"" >/dev/null 2>&1 && fail "the Web View opened a Tab the Host lists no more"
agent-device is text 'id="topic-title"' "$TOPIC" >/dev/null 2>&1 || fail "the Terminal Screen is not on $TOPIC"
echo "     the Pane, and no Web View"

agent-device close >/dev/null 2>&1
echo
echo "PASS: a Topic opened again is where it was left, its Web View included,"
echo "      in the Window the phone was in; the Web View's title reaches the"
echo "      Topics list; and a Tab the Host lists no more leaves the Pane on top."
