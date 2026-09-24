#!/bin/bash
#
# Regressions (everything fixed so far that a change could quietly undo).
#
# Each check here stands for a bug that actually happened:
#
#   1  the navigation header, removed so the Surface reaches the top
#   2  the library's own Accessory Bar, hidden by a local patch
#   3  the Session's options, which Muxify used to borrow and now never touches
#   4  the resize, which has broken four separate ways
#   5  tmux's padding, which flashed along the bottom edge on every keyboard
#   6  Enter, which for a long time only made a new line
#   7  the Session left as it was found, with nothing to put back
#
# Checks 3 and 7 changed shape with control mode. They used to assert that the
# status line was hidden on attach and restored on the way out — the borrowing
# ADR 0006 removed. What they assert now is stronger and simpler: `show-options`
# on the Session says exactly the same thing before, during and after, because a
# control client sets nothing at all.
#
# The resize checks are the ones worth explaining. `surface` and `window` must
# agree: the Surface tells tmux its size with `refresh-client -C`, and under
# tmux's default `window-size latest` the Window follows it.
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
# Every option the Session carries, sorted so two readings can be compared.
options() { vm "tmux show-options -t '$SESSION'" | sort; }
hooks()   { vm "tmux show-hooks -t '$SESSION'" | sort; }

agree() {
  local what=$1 s w
  s=$(surface); w=$(window)
  [ -n "$s" ] || fail "$what: the Surface never reported a grid"
  [ "$s" = "$w" ] || fail "$what: Surface is $s but tmux draws the Window at $w"
  echo "     $what: surface=$s window=$w"
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
vm "tmux send-keys -t '$SESSION' C-c; tmux send-keys -t '$SESSION' 'clear' Enter" \
  || fail "could not reach the VM"
sleep 1
# The baseline every later reading is compared against. Taken before Muxify has
# been anywhere near this Session.
BEFORE=$(options)
BEFORE_HOOKS=$(hooks)
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

echo "3/7  attaching changes no Session option and installs no hook"
# The whole of ADR 0006. A control client renders nothing, so `status` is not
# its business; it is sized with `refresh-client -C`, so `window-size` is not
# either; and scrolling is a capture, so neither is `mouse`.
[ "$(options)" = "$BEFORE" ] || {
  diff <(echo "$BEFORE") <(options)
  fail "attaching changed a Session option"
}
[ "$(hooks)" = "$BEFORE_HOOKS" ] || fail "attaching left a hook on the Session"
echo "     show-options is byte-identical while attached"

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
# Forcing that state takes `window-size manual`, which is the test setting an
# option rather than the app — and unsetting it below is what keeps check 7
# honest.
vm "tmux set-option -t '$SESSION' window-size manual; tmux resize-window -t '$SESSION' -x 38 -y 8"
sleep 2
[ "$(padding)" -gt 1000 ] || fail "the padding detector cannot see padding; the check below would pass for the wrong reason"
# Unset rather than set back to a value: `-u` returns the option to the state
# it was in, which is what leaves nothing behind for check 7 to find.
vm "tmux set-option -u -t '$SESSION' window-size"
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

echo "7/7  leaving finds the Session exactly as it was, bar the zoom"
agent-device press 'label="Keyboard"' >/dev/null 2>&1
sleep 2
agent-device press 'label="Home"' >/dev/null 2>&1
agent-device wait text "No Hosts yet" 8000 >/dev/null 2>&1
sleep 2
[ "$(options)" = "$BEFORE" ] || {
  diff <(echo "$BEFORE") <(options)
  fail "Muxify changed the Host and did not put it back"
}
[ "$(hooks)" = "$BEFORE_HOOKS" ] || fail "Muxify left a hook on the Session"
# The one exception, named rather than hidden. Muxify zooms the active Pane on
# Attach because a phone is too narrow for two side by side — see CONTEXT.md,
# **Zoom** — and `resize-pane -Z` is a Window flag every other Client sees, not
# a Session option. It is not restored: the user can turn it off in the Panes
# picker, and undoing their choice on the way out would be its own surprise.
# Reported so a reader knows it changed, and so that anything *else* appearing
# here is a regression.
echo "     show-options and show-hooks unchanged from before the Attach"
echo "     zoom is left as Muxify set it: $(vm "tmux display-message -p -t '$SESSION' '#{window_zoomed_flag}'")"

agent-device close >/dev/null 2>&1
echo
rm -f "$SHOT"
echo "PASS: no header, no Accessory Bar, the Session's options untouched"
echo "      throughout, sizes agree in both keyboard states, no padding on"
echo "      screen, and Enter runs commands."
