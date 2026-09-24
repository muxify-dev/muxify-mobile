#!/bin/bash
#
# Regressions (everything fixed so far that a change could quietly undo).
#
# Each check here stands for a bug that actually happened:
#
#   1  the navigation header, removed so the Surface reaches the top
#   2  tmux's status line, hidden on attach and put back on the way out
#   3  the resize, which has broken three separate ways
#   4  Enter, which for a long time only made a new line
#   5  the library's own Accessory Bar, hidden by a local patch
#
# The resize check is the one worth explaining. `surface`, `window` and
# `client` must all agree. tmux pads every row between the Window and the
# Client with dots, and those rows land beyond the Surface's grid, so the
# Surface scrolls to fit them and fills with debris. Checking the pane over SSH
# does NOT catch this — the padding is not in the pane, which is how an earlier
# fix was declared working when it was not. Three agreeing numbers is the
# invariant that actually holds the bug down.
#
# Requires a configured .env.local and a booted simulator.
# Usage:  bash e2e/regressions.sh

set -uo pipefail

APP=dev.muxify.app
SESSION=0
MARKER=MUXIFY_ENTER_RUNS

vm() {
  ssh -F /dev/null -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -i "$HOME/.orbstack/ssh/id_ed25519" -p 32222 default@127.0.0.1 "$@" 2>/dev/null
}

fail() { echo "FAIL: $1"; exit 1; }

snap()    { agent-device snapshot -i 2>/dev/null; }
surface() { snap | grep -oE '\[text\] "[0-9]+x[0-9]+"' | head -1 | grep -oE '[0-9]+x[0-9]+'; }
window()  { vm "tmux display-message -p -t '$SESSION' '#{window_width}x#{window_height}'"; }
client()  { vm "tmux list-clients -t '$SESSION' -F '#{client_width}x#{client_height}'" | head -1; }
status()  { vm "tmux show-options -t '$SESSION' -v status"; }

agree() {
  local what=$1 s w c
  s=$(surface); w=$(window); c=$(client)
  [ -n "$s" ] || fail "$what: the Surface never reported a grid"
  [ "$s" = "$w" ] || fail "$what: Surface is $s but tmux draws the Window at $w"
  # A Client bigger than the Window is what fills the Surface with dots.
  [ "$s" = "$c" ] || fail "$what: Surface is $s but tmux believes the Client is $c"
  echo "     $what: surface=$s window=$w client=$c"
}

attach() {
  agent-device close >/dev/null 2>&1
  agent-device open "$APP" --platform ios --relaunch >/dev/null 2>&1
  agent-device wait text "No Hosts yet" 25000 >/dev/null 2>&1
  agent-device press 'label="Open Surface smoke test"' >/dev/null 2>&1
  for _ in $(seq 1 20); do
    agent-device is text 'id="connection-status"' "Connected" >/dev/null 2>&1 && break
    sleep 1
  done
  agent-device is text 'id="connection-status"' "Connected" >/dev/null 2>&1 \
    || fail "never reached Connected"
  sleep 3
}

echo "0/6  putting the Session somewhere known"
vm "tmux set-option -t '$SESSION' status on; \
    tmux send-keys -t '$SESSION' C-c; tmux send-keys -t '$SESSION' 'clear' Enter" \
  || fail "could not reach the VM"
sleep 1
attach

echo "1/6  the Terminal Screen has no navigation header"
snap | grep -qE '^@e[0-9]+ \[text\] "Terminal"$' \
  && fail "a navigation title is back; the Surface no longer reaches the top"
snap | grep -qE '^@e[0-9]+ \[button\] "Muxify"$' \
  && fail "a back button is back; Home in the Dock is what leaves this screen"
echo "     no header, no back button"

echo "2/6  the library's Accessory Bar stays hidden"
snap | grep -qE '\[button\] "(Control|Escape|Tab|Command|Option)"' \
  && fail "the Accessory Bar is back; the accessoryBar prop or its patch is gone"
echo "     no ctrl/esc/tab bar"

echo "3/6  tmux's status line is hidden while attached"
[ "$(status)" = off ] || fail "status line is '$(status)', expected off"

echo "4/6  sizes agree with the keyboard down, and again with it up"
agree "keyboard down"
agent-device press 'label="Keyboard"' >/dev/null 2>&1
sleep 4
agree "keyboard up"

echo "5/6  Enter on the device runs the command"
# Every keystroke arrives from iOS as a bracketed paste, Enter included, which
# is why this once inserted a newline and ran nothing. See toShellInput.
agent-device type "echo $MARKER" >/dev/null 2>&1
sleep 1
agent-device type "
" >/dev/null 2>&1
sleep 3
vm "tmux capture-pane -t '$SESSION' -p" | grep -qE "^$MARKER$" \
  || fail "Enter did not run the command; the shell only saw a new line"

echo "6/6  leaving puts the Session's status line back"
agent-device press 'label="Keyboard"' >/dev/null 2>&1
sleep 2
agent-device press 'label="Home"' >/dev/null 2>&1
agent-device wait text "No Hosts yet" 8000 >/dev/null 2>&1
sleep 2
[ "$(status)" = on ] || fail "status line left as '$(status)'; Muxify changed the Host and did not put it back"

agent-device close >/dev/null 2>&1
echo
echo "PASS: no header, no Accessory Bar, status line hidden and restored,"
echo "      sizes agree in both keyboard states, and Enter runs commands."
