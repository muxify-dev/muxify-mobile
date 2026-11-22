#!/bin/bash
#
# Runs the Board Session cards on the Host Screen against a sandboxed Muxify on
# this Mac, the dev Host (see e2e/sandbox.sh): live and Dormant Board Session
# cards in Pinned, In Play and the Guests, their long-press menus, the move
# mode, the Fill sheet, a tap that opens a live one, a restart of the sandbox's
# tmux server, and Reopen, Start Fresh, Bench and Unpin of the Dormant cards.
# After each write it waits until the Mac, asked through the CLI, has the
# change, and then checks that the Host Screen shows the Mac's order.
#
# The Host CLI must send Dormant Board Sessions, as one built from muxify's
# master does. Give it to the sandbox with MUXIFY_E2E_MUXIFY:
#
#   MUXIFY_E2E_MUXIFY=<muxify built from master> bash e2e/board-sessions.sh

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail

APP=dev.muxify.app
SNAPSHOT="$MUXIFY_E2E_ROOT/snapshot.json"

# The suite stops and starts the Host's tmux server. Make sure this one is the
# sandbox's, before the first step and again before the restart.
# /tmp is a link to /private/tmp, and tmux gives the resolved path.
sandbox_server() {
  case "$(tmux display-message -p '#{socket_path}' 2>/dev/null)" in
    "$(cd "$MUXIFY_E2E_ROOT" && pwd -P)"/*) return 0 ;;
    *) return 1 ;;
  esac
}
sandbox_server || { echo "tmux is not the sandbox's server"; exit 1; }

# The Mac's Board as one line: pinned | places | guests | bench. A live Board
# Session by its Session's name, a Dormant card with a trailing ~, an Open Place as "open".
mac_listing() {
  muxify environment show --json | python3 -c '
import json, subprocess, sys
e = json.load(sys.stdin)
out = subprocess.run(["tmux", "list-sessions", "-F", "#{session_id} #{session_name}"], capture_output=True, text=True).stdout
names = dict(line.split(" ", 1) for line in out.splitlines() if " " in line)
def one(c):
    k = c["kind"]
    if k == "topic":
        t = c["topic"]
        return t["label"] + ("~" if t.get("state") == "dormant" else "")
    if k == "session":
        return names.get(c["sessions"][0], c["sessions"][0])
    if k == "dormant_session":
        return c["name"] + "~"
    if k == "open_place":
        return "open"
    return "?" + k
def cards(cs):
    return " ".join(one(c) for c in cs)
u = e["unpinned"]
print(" | ".join([cards(e["pinned"]), cards(u.get("places", [])), cards(u.get("guests", [])), cards(u.get("bench", []))]))'
}

fail() {
  echo "FAIL: $*"
  echo "Mac: $(mac_listing)"
  agent-device close >/dev/null 2>&1
  exit 1
}

# Stops the sandbox's tmux server and starts it again with Session 0, as a
# restart of tmux on the Host does.
restart_tmux() {
  sandbox_server || fail "tmux is not the sandbox's server"
  tmux kill-server
  sleep 1
  tmux -f /dev/null new-session -d -s 0 -c "$MUXIFY_E2E_ROOT" \
    "env PS1='\$ ' BASH_SILENCE_DEPRECATION_WARNING=1 bash --noprofile --norc" || exit 1
  sandbox_server || fail "the new tmux server is not the sandbox's"
}

# A Session at a folder of its own, made a Guest: a Board Session.
new_board_session() {
  mkdir -p "$MUXIFY_E2E_ROOT/$1"
  muxify session new "$MUXIFY_E2E_ROOT/$1" --name "$1" --json >/dev/null || exit 1
  muxify topic make-guest --session "$1" --json >/dev/null || exit 1
}

new_topic() {
  local id
  id=$(muxify topic new "$1" --json | python3 -c 'import json, sys; print(json.load(sys.stdin)["changed"]["topic_id"])') || exit 1
  mkdir -p "$MUXIFY_E2E_ROOT/$1"
  muxify topic add-session "$MUXIFY_E2E_ROOT/$1" --topic "$id" --json >/dev/null || exit 1
}

# Writes the screen's tree to $SNAPSHOT. A snapshot taken while the screen moves can fail, so it tries again.
snap() {
  for _ in $(seq 10); do
    agent-device snapshot -i --json >"$SNAPSHOT" 2>/dev/null && python3 -c 'import json, sys; json.load(open(sys.argv[1]))["data"]' "$SNAPSHOT" 2>/dev/null && return 0
    sleep 0.5
  done
  return 1
}

# The cards on screen, top to bottom: a Topic or a Board Session by its name, an Open Place as "Open Place".
cards_on_screen() {
  snap || return 1
  python3 - "$SNAPSHOT" <<'PY'
import json, sys
nodes = json.load(open(sys.argv[1]))["data"]["nodes"]
rows = set()
for n in nodes:
    label = n.get("label") or ""
    kind = n.get("type", "") + n.get("role", "")
    if "Reorder" in kind:
        continue
    if label.startswith("Topic ") or label.startswith("Session "):
        rows.add((n["rect"]["y"], label.split(" ", 1)[1]))
    elif label == "Open Place" and "cell" in kind.lower():
        rows.add((n["rect"]["y"], label))
print("\n".join(label for _, label in sorted(rows)))
PY
}

scroll_to() {
  if [ "$1" = top ]; then
    agent-device gesture pan 200 300 0 400 300 >/dev/null 2>&1
    sleep 1
  else
    agent-device scroll bottom --settle >/dev/null 2>&1
  fi
}

# Scrolls the node labelled $1 into sight.
reveal() {
  local end
  for end in "" top bottom; do
    [ -n "$end" ] && scroll_to "$end"
    snap && python3 -c 'import json, sys; sys.exit(not any(n.get("label") == sys.argv[2] for n in json.load(open(sys.argv[1]))["data"]["nodes"]))' "$SNAPSHOT" "$1" && return 0
  done
  return 1
}

# The whole list, read from its top and its bottom.
screen_order() {
  local top bottom
  scroll_to top
  top=$(cards_on_screen)
  scroll_to bottom
  bottom=$(cards_on_screen)
  python3 - "$top" "$bottom" <<'PY'
import sys
top, bottom = [c for c in sys.argv[1].split("\n") if c], [c for c in sys.argv[2].split("\n") if c]
# The bottom view goes on from the last card that the top view shows.
print(" ".join(top + bottom[bottom.index(top[-1]) + 1:] if top and top[-1] in bottom else top + bottom))
PY
}

# The Mac's listing $1 as the screen's order: no section lines, no Dormant marks.
as_screen() {
  python3 -c 'import sys; print(" ".join("Open Place" if w == "open" else w.rstrip("~") for w in sys.argv[1].split() if w != "|"))' "$1"
}

# Waits until the Mac's listing is $1, then until the screen shows its cards in that order.
expect() {
  local want=$1 have screen
  for _ in $(seq 60); do
    have=$(mac_listing)
    [ "$have" = "$want" ] && break
    sleep 0.25
  done
  [ "$have" = "$want" ] || fail "the Mac has '$have', not '$want'"
  for _ in $(seq 20); do
    screen=$(screen_order)
    [ "$screen" = "$(as_screen "$want")" ] && { echo "ok: $want"; return 0; }
    sleep 0.5
  done
  fail "the screen shows '$screen', the Mac '$(as_screen "$want")'"
}

# Relaunches the app on the Host Screen and opens the Bench.
open_host_screen() {
  agent-device open "$APP" --platform ios --relaunch >/dev/null 2>&1
  for _ in $(seq 30); do
    agent-device is exists 'label="Host Dev Host"' >/dev/null 2>&1 && break
    agent-device is exists 'label="Host Options"' >/dev/null 2>&1 && break
    agent-device is exists 'id="pane-command"' >/dev/null 2>&1 && { sleep 1.5; agent-device back >/dev/null 2>&1; }
    sleep 0.5
  done
  if agent-device is exists 'label="Host Dev Host"' >/dev/null 2>&1; then
    agent-device press 'label="Host Dev Host"' --settle >/dev/null
  fi
  agent-device wait 'label="Host Options"' 15000 >/dev/null || fail "no Host Screen"
  agent-device wait "label=\"$1\"" 15000 >/dev/null || fail "no $1 on the Host Screen"
  reveal "Bench" || fail "no Bench row"
  agent-device press 'label="Bench"' --settle >/dev/null
  sleep 1
}

# The menu items of the open long-press menu, joined by |.
menu_items() {
  snap
  python3 - "$SNAPSHOT" <<'PY'
import json, sys
words = {"Mark as Read", "Mark as Unread", "Pin", "Unpin", "Move Up", "Move Down", "Bench", "Make a Guest",
         "Reopen", "Start Fresh", "Move…", "Settle…", "Forget…", "Note", "Tags", "Edit"}
nodes = json.load(open(sys.argv[1]))["data"]["nodes"]
print("|".join(n["label"] for n in nodes if n.get("label") in words and "Button" in n.get("type", "") + n.get("role", "")))
PY
}

# Long-presses card $1, checks that its menu is exactly $2 (labels joined by |), and presses $3.
menu() {
  local items
  reveal "$1" || fail "no card $1"
  agent-device longpress "label=\"$1\"" 1000 --settle >/dev/null
  agent-device wait "role=button label=\"$3\"" 5000 >/dev/null || fail "no $3 in the menu of $1"
  items=$(menu_items)
  [ "$items" = "$2" ] || fail "the menu of $1 is '$items', not '$2'"
  echo "ok: the menu of $1 is $items"
  agent-device press "role=button label=\"$3\"" --settle >/dev/null
}

# The labels of the move targets in $SNAPSHOT, one a line.
targets_in_snapshot() {
  python3 - "$SNAPSHOT" <<'PY'
import json, sys
for n in json.load(open(sys.argv[1]))["data"]["nodes"]:
    label = n.get("label") or ""
    kind = (n.get("type", "") + n.get("role", "")).lower()
    if "button" in kind and (label.startswith(("Move above ", "Move below ", "Trade ", "Fill ")) or label in ("Bench", "Make a Guest")):
        print(label)
PY
}

# The labels of the move targets on screen, read from the top and the bottom, sorted.
move_targets() {
  local top bottom
  scroll_to top
  snap
  top=$(targets_in_snapshot)
  scroll_to bottom
  snap
  bottom=$(targets_in_snapshot)
  printf '%s\n%s\n' "$top" "$bottom" | grep -v '^$' | LC_ALL=C sort -u | paste -sd '|' -
}

# Taps card $1 and waits for the Terminal on Session $2, then goes back to the Host Screen.
attaches() {
  agent-device wait 'id="pane-command"' 20000 >/dev/null || fail "no Terminal after $1"
  agent-device is text 'id="attached-session"' "$2" >/dev/null 2>&1 || fail "$1 attached to '$(agent-device get text 'id="attached-session"' 2>/dev/null)', not $2"
  echo "ok: $1 attached to $2"
  sleep 1.5
  agent-device back >/dev/null 2>&1
  agent-device wait 'label="Host Options"' 8000 >/dev/null || fail "Back did not reach the Host Screen"
  sleep 1
}

# Taps Dormant card $1, and checks the action sheet: Reopen, Start Fresh, Cancel. Then presses $2.
wake_by_tap() {
  reveal "Session $1" || fail "no card $1"
  agent-device press "label=\"Session $1\"" --settle >/dev/null
  agent-device wait 'label="Reopen" hittable=true' 8000 >/dev/null || fail "a tap on Dormant $1 gave no Reopen"
  agent-device is exists 'label="Start Fresh" hittable=true' >/dev/null 2>&1 || fail "a tap on Dormant $1 gave no Start Fresh"
  agent-device is exists 'label="Cancel" hittable=true' >/dev/null 2>&1 || fail "a tap on Dormant $1 gave no Cancel"
  echo "ok: a tap on Dormant $1 asks Reopen, Start Fresh or Cancel"
  agent-device press "label=\"$2\" hittable=true" --settle >/dev/null || fail "no $2 in the sheet of $1"
}

windows_of() { tmux list-windows -t "=$1" -F '#{window_id}' 2>/dev/null | wc -l | tr -d ' '; }

echo "== Setup"
bash "$(dirname "$0")/topics-tab.sh" || exit 1
# Pinned: TopA, bspin. In Play: bsplace and Open Places. Guests: bsguest, bsextra. Bench: TopB.
printf 'topics:\n  in_play: 3\n  tags:\n    personal: {}\n    work: {}\n' >"$MUXIFY_CONFIG"
new_topic TopA
muxify topic pin --topic TopA --json >/dev/null || exit 1
for name in bsplace bspin bsguest; do new_board_session "$name"; done
muxify topic choose-in-play --session bsplace --json >/dev/null || exit 1
muxify topic pin --session bspin --json >/dev/null || exit 1
new_topic TopB
muxify topic bench --topic TopB --json >/dev/null || exit 1
new_board_session bsextra
expect_mac() {
  local have
  for _ in $(seq 60); do have=$(mac_listing); [ "$have" = "$1" ] && return 0; sleep 0.25; done
  fail "the Mac has '$have', not '$1'"
}
expect_mac "TopA bspin | bsplace open open | bsguest bsextra | TopB"
echo "Mac: $(mac_listing)"

echo "== The Board tab"
open_host_screen "Session bspin"
snap
python3 - "$SNAPSHOT" <<'PY' || fail "the tab control is not Board and Sessions"
import json, sys
labels = [n.get("label") for n in json.load(open(sys.argv[1]))["data"]["nodes"]]
assert "Board" in labels, "no Board tab"
assert "Topics" not in labels, "a Topics label is on the Host Screen"
assert "Sessions" in labels, "no Sessions tab"
PY
echo "ok: the Host Screen's tabs are Board and Sessions, with no Topics"
expect "TopA bspin | bsplace open open | bsguest bsextra | TopB"
scroll_to top

echo "== Live Board Sessions: menus and moves"
menu "Session bspin" "Unpin|Move Up|Move Down|Move…" "Move Up"
expect "bspin TopA | bsplace open open | bsguest bsextra | TopB"
menu "Session bsguest" "Pin|Move Up|Move Down|Bench|Move…" "Move…"
agent-device wait 'label="Cancel Move"' 5000 >/dev/null || fail "the move of bsguest did not start"
targets=$(move_targets)
[ "$targets" = "Fill Open Place|Move below bsextra|Trade TopB|Trade bsplace" ] || fail "the targets of bsguest are '$targets'"
echo "ok: the targets of Guest bsguest are $targets, none on a Pinned card"
agent-device press 'label="Cancel Move"' --settle >/dev/null || fail "no Cancel Move"
agent-device wait absent 'label="Cancel Move"' 3000 >/dev/null || fail "Cancel did not end the move"
menu "Session bsplace" "Pin|Move Up|Move Down|Bench|Move…" "Move…"
agent-device wait 'label="Cancel Move"' 5000 >/dev/null || fail "the move of bsplace did not start"
reveal "Trade bsguest" || fail "no Trade bsguest target"
agent-device press 'label="Trade bsguest"' --settle >/dev/null || fail "no Trade bsguest"
expect "bspin TopA | bsguest open open | bsplace bsextra | TopB"

echo "== Fill an Open Place with a Guest Board Session"
reveal "Open Place" || fail "no Open Place"
# Two Open Places: tap the first by its ref.
OPEN_REF=$(python3 -c 'import json, sys; print(next("@" + n["ref"] for n in json.load(open(sys.argv[1]))["data"]["nodes"] if n.get("label") == "Open Place"))' "$SNAPSHOT")
agent-device press "$OPEN_REF" --settle >/dev/null || fail "no Open Place to tap"
agent-device wait 'label="Close Fill Open Place"' 5000 >/dev/null || fail "the Fill sheet did not open"
snap
python3 - "$SNAPSHOT" <<'PY' || fail "the Fill sheet does not offer the Guest Board Sessions and TopB"
import json, sys
labels = {n.get("label") for n in json.load(open(sys.argv[1]))["data"]["nodes"]}
missing = {"Session bsplace", "Session bsextra", "Topic TopB"} - labels
assert not missing, missing
PY
echo "ok: the Fill sheet offers bsplace, bsextra and TopB"
agent-device press 'label="Session bsplace"' --settle >/dev/null || fail "no bsplace in the Fill sheet"
agent-device wait absent 'label="Close Fill Open Place"' 5000 >/dev/null || fail "the Fill sheet did not close"
for _ in $(seq 60); do
  case "$(mac_listing)" in
    "bspin TopA | bsguest bsplace open | bsextra | TopB" | "bspin TopA | bsguest open bsplace | bsextra | TopB") break ;;
  esac
  sleep 0.25
done
expect "$(mac_listing)"

echo "== A tap on a live Board Session in a place opens it"
reveal "Session bsplace" || fail "no card bsplace"
agent-device press 'label="Session bsplace"' --settle >/dev/null
attaches "bsplace" "bsplace"
BEFORE=$(mac_listing)
echo "Mac before the restart: $BEFORE"

echo "== Restart the sandbox's tmux server"
agent-device close >/dev/null 2>&1
xcrun simctl terminate "${MUXIFY_E2E_DEVICE:-booted}" "$APP" >/dev/null 2>&1
restart_tmux
DORMANT=$(python3 -c 'import sys; print(" ".join(w if w in ("|", "open") else w + "~" for w in sys.argv[1].split()))' "$BEFORE")
expect_mac "$DORMANT"
echo "Mac after the restart: $(mac_listing)"
open_host_screen "Session bspin"
expect "$DORMANT"
scroll_to top
scroll_to bottom

echo "== Dormant Board Sessions: menus and moves"
PLACES=$(python3 -c 'import sys; print(sys.argv[1].split(" | ")[1])' "$DORMANT")
menu "Session bspin" "Reopen|Start Fresh|Unpin|Move Up|Move Down|Move…" "Move…"
agent-device wait 'label="Cancel Move"' 5000 >/dev/null || fail "the move of bspin did not start"
targets=$(move_targets)
[ "$targets" = "Move below TopA" ] || fail "the targets of Pinned bspin are '$targets', not only Move below TopA"
echo "ok: Pinned bspin moves only among the Pinned cards: $targets"
agent-device press 'label="Move below TopA"' --settle >/dev/null || fail "no Move below TopA"
expect "TopA~ bspin~ | $PLACES | bsextra~ | TopB~"
reveal "Topic TopA" || fail "no card TopA"
agent-device longpress 'label="Topic TopA"' 1000 --settle >/dev/null
agent-device wait 'role=button label="Move…"' 5000 >/dev/null || fail "no Move… in the menu of TopA"
items=$(menu_items)
case "|$items|" in *"|Bench|"*) fail "the Pinned Topic TopA offers Bench: $items" ;; esac
echo "ok: the menu of Pinned Dormant TopA is $items, with no Bench"
agent-device press 'role=button label="Move…"' --settle >/dev/null
agent-device wait 'label="Cancel Move"' 5000 >/dev/null || fail "the move of TopA did not start"
reveal "Move below bspin" || fail "no Move below bspin target"
agent-device press 'label="Move below bspin"' --settle >/dev/null || fail "no Move below bspin"
expect "bspin~ TopA~ | $PLACES | bsextra~ | TopB~"

echo "== Bench a Dormant Board Session in a place: it leaves the Board"
menu "Session bsguest" "Reopen|Start Fresh|Pin|Move Up|Move Down|Bench|Move…" "Bench"
expect "bspin~ TopA~ | ${PLACES/bsguest~/open} | bsextra~ | TopB~"
tmux has-session -t '=bsguest' 2>/dev/null && fail "Bench of a Dormant Board Session made a Session"
echo "ok: bsguest is gone from the Board, and tmux has no Session bsguest"

echo "== Tap a Dormant Guest: Cancel, then Reopen"
menu "Session bsextra" "Reopen|Start Fresh|Pin|Move Up|Move Down|Bench|Move…" "Move…"
agent-device press 'label="Cancel Move"' --settle >/dev/null || fail "no Cancel Move"
agent-device wait absent 'label="Cancel Move"' 3000 >/dev/null || fail "Cancel did not end the move"
wake_by_tap bsextra Cancel
sleep 2
agent-device is exists 'id="pane-command"' >/dev/null 2>&1 && fail "Cancel opened a Terminal"
expect "bspin~ TopA~ | ${PLACES/bsguest~/open} | bsextra~ | TopB~"
echo "ok: Cancel wakes nothing"
wake_by_tap bsextra Reopen
attaches "Reopen of bsextra" "bsextra"
expect "bspin~ TopA~ | ${PLACES/bsguest~/open} | bsextra | TopB~"
tmux has-session -t '=bsextra' || fail "tmux has no Session bsextra"
echo "ok: the sandbox's tmux server has bsextra again"

echo "== Tap a Dormant Pinned card: Start Fresh"
wake_by_tap bspin "Start Fresh"
attaches "Start Fresh of bspin" "bspin"
expect "bspin TopA~ | ${PLACES/bsguest~/open} | bsextra | TopB~"
[ "$(windows_of bspin)" = 1 ] || fail "Start Fresh of bspin made $(windows_of bspin) Windows, not one"
echo "ok: Start Fresh made bspin again with one Window"

echo "== Reopen a Dormant Board Session in a place from its menu: a live one shows there"
menu "Session bsplace" "Reopen|Start Fresh|Pin|Move Up|Move Down|Bench|Move…" "Reopen"
LIVE_PLACES=$(python3 -c 'import sys; print(sys.argv[1].replace("bsguest~", "open").replace("bsplace~", "bsplace"))' "$PLACES")
expect "bspin TopA~ | $LIVE_PLACES | bsextra | TopB~"
tmux has-session -t '=bsplace' || fail "tmux has no Session bsplace"
menu "Session bsplace" "Pin|Move Up|Move Down|Bench|Move…" "Move…"
agent-device press 'label="Cancel Move"' --settle >/dev/null || fail "no Cancel Move"
agent-device wait absent 'label="Cancel Move"' 3000 >/dev/null || fail "Cancel did not end the move"
echo "ok: live bsplace shows in its place, with the menu of a live card"

echo "== Unpin puts the card at the end of the Guests"
menu "Session bspin" "Unpin|Move Up|Move Down|Move…" "Unpin"
expect "TopA~ | $LIVE_PLACES | bsextra bspin | TopB~"

echo "== Bench a live Board Session: it leaves the Board and stays a Session"
menu "Session bspin" "Pin|Move Up|Move Down|Bench|Move…" "Bench"
expect_mac "TopA~ | $LIVE_PLACES | bsextra | TopB~"
# The app is still attached to bspin, which is now in No Topic: the Bench
# shows it as the Attach's peek, above the Benched cards.
want_screen="$(as_screen "TopA~ | $LIVE_PLACES | bsextra |") bspin TopB"
for _ in $(seq 20); do
  screen=$(screen_order)
  [ "$screen" = "$want_screen" ] && break
  sleep 0.5
done
[ "$screen" = "$want_screen" ] || fail "the screen shows '$screen', not '$want_screen'"
echo "ok: TopA~ | $LIVE_PLACES | bsextra | TopB~, and the attached bspin shows as the Bench peek"
tmux has-session -t '=bspin' || fail "Bench of a live Board Session stopped its Session"
echo "ok: bspin left the Board and its Session runs"

scroll_to top
agent-device close >/dev/null 2>&1
echo "PASS"
