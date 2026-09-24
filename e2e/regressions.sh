#!/bin/bash
#
# Regressions (everything fixed so far that a change could quietly undo).
#
# Each check here stands for a bug that actually happened:
#
#   1  the navigation header, removed so the Surface reaches the top
#   2  tmux's status line, hidden on attach and put back on the way out
#   3  the resize, which has broken four separate ways
#   4  Enter, which for a long time only made a new line
#   5  the library's own Accessory Bar, hidden by a local patch
#   6  tmux's padding, which flashed along the bottom edge on every keyboard
#
# The resize checks are the ones worth explaining. `surface` and `window` must
# agree: that is the part this app controls, over the exec channel. The Client
# size is only reported, because the SSH library does not reliably send a
# window-change at all.
#
# So the thing that actually matters — whether the user sees tmux's padding —
# is checked by looking at the screen. Reading the pane over SSH does NOT catch
# it, since the padding is not in the pane; that mistake is how an earlier fix
# was declared working when it was not.
#
# Requires a configured .env.local and a booted simulator.
# Usage:  bash e2e/regressions.sh

set -uo pipefail

APP=dev.muxify.app
SESSION=0
MARKER=MUXIFY_ENTER_RUNS
SHOT=$(mktemp -t muxify-regression).png

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
  # The Client's size is reported, not asserted. The SSH library does not
  # reliably deliver a window-change — measured, it can ignore one entirely —
  # so it is not something this app can hold to. What the user actually sees is
  # asserted in the next step, by looking at the screen.
  echo "     $what: surface=$s window=$w client=$c"
}

attach() {
  agent-device close >/dev/null 2>&1
  agent-device open "$APP" --platform ios --relaunch >/dev/null 2>&1
  agent-device wait text "Dev Host" 25000 >/dev/null 2>&1
  # The real flow: a saved Host, its Sessions, then one of them.
  agent-device press 'label="Dev Host"' >/dev/null 2>&1
  agent-device wait "label=\"Session $SESSION\"" 15000 >/dev/null 2>&1
  agent-device press "label=\"Session $SESSION\"" >/dev/null 2>&1
  for _ in $(seq 1 20); do
    agent-device is text 'id="connection-status"' "Connected" >/dev/null 2>&1 && break
    sleep 1
  done
  agent-device is text 'id="connection-status"' "Connected" >/dev/null 2>&1 \
    || fail "never reached Connected"
  sleep 3
}

echo "0/7  putting the Session somewhere known"
vm "tmux set-option -t '$SESSION' status on; \
    tmux send-keys -t '$SESSION' C-c; tmux send-keys -t '$SESSION' 'clear' Enter" \
  || fail "could not reach the VM"
sleep 1
attach

echo "1/7  the Terminal Screen has no navigation header"
snap | grep -qE '^@e[0-9]+ \[text\] "Terminal"$' \
  && fail "a navigation title is back; the Surface no longer reaches the top"
snap | grep -qE '^@e[0-9]+ \[button\] "Muxify"$' \
  && fail "a back button is back; Home in the Dock is what leaves this screen"
echo "     no header, no back button"

echo "2/7  the library's Accessory Bar stays hidden"
snap | grep -qE '\[button\] "(Control|Escape|Tab|Command|Option)"' \
  && fail "the Accessory Bar is back; the accessoryBar prop or its patch is gone"
echo "     no ctrl/esc/tab bar"

echo "3/7  tmux's status line is hidden while attached"
[ "$(status)" = off ] || fail "status line is '$(status)', expected off"

echo "4/7  sizes agree with the keyboard down, and again with it up"
agree "keyboard down"
agent-device press 'label="Keyboard"' >/dev/null 2>&1
sleep 4
agree "keyboard up"

echo "5/7  no tmux padding on screen, in either keyboard state"
# tmux pads the gap whenever it thinks the Client is bigger than the Window,
# and those rows land past the end of the Surface's grid. The band below is
# where that shows up. The detector is checked against a deliberately broken
# state first, because one that always reports zero proves nothing.
padding() {
  agent-device screenshot "$SHOT" >/dev/null 2>&1
  magick "$SHOT" -crop 1206x600+0+900 -threshold 45% -format '%[fx:int(mean*w*h)]' info:
}
# Forcing that state now takes `window-size manual`, because Muxify puts the
# Session on `smallest` precisely so the Window cannot outgrow the Client.
# Putting it back to `smallest` snaps the Window onto the Client again.
vm "tmux set-option -t '$SESSION' window-size manual; tmux resize-window -t '$SESSION' -x 38 -y 8"
sleep 2
[ "$(padding)" -gt 1000 ] || fail "the padding detector cannot see padding; the check below would pass for the wrong reason"
vm "tmux set-option -t '$SESSION' window-size smallest; tmux refresh-client"
sleep 2
echo "     detector confirmed against a known-bad state"

agent-device press 'label="Keyboard"' >/dev/null 2>&1
sleep 3
[ "$(padding)" -eq 0 ] || fail "padding on screen after the keyboard closed"
agent-device press 'label="Keyboard"' >/dev/null 2>&1
sleep 3
[ "$(padding)" -eq 0 ] || fail "padding on screen after the keyboard opened"
echo "     none, opening or closing"

echo "6/7  Enter on the device runs the command"
# Every keystroke arrives from iOS as a bracketed paste, Enter included, which
# is why this once inserted a newline and ran nothing. See toShellInput.
agent-device type "echo $MARKER" >/dev/null 2>&1
sleep 1
agent-device type "
" >/dev/null 2>&1
sleep 3
vm "tmux capture-pane -t '$SESSION' -p" | grep -qE "^$MARKER$" \
  || fail "Enter did not run the command; the shell only saw a new line"

echo "7/7  leaving puts the Session's status line back"
agent-device press 'label="Keyboard"' >/dev/null 2>&1
sleep 2
agent-device press 'label="Home"' >/dev/null 2>&1
agent-device wait text "No Hosts yet" 8000 >/dev/null 2>&1
sleep 2
[ "$(status)" = on ] || fail "status line left as '$(status)'; Muxify changed the Host and did not put it back"

agent-device close >/dev/null 2>&1
echo
rm -f "$SHOT"
echo "PASS: no header, no Accessory Bar, status line hidden and restored,"
echo "      sizes agree in both keyboard states, no padding on screen, and"
echo "      Enter runs commands."
