#!/bin/bash
#
# The Terminal Screen's Key Row: the pairs, the sticky modifiers, the arrows
# and the ⌘ Shortcuts.
#
# What this proves, against the sandbox's Session 0:
#
#   1  a tap on a pair key types its main symbol
#   2  a touch dragged down types the alternate symbol, and a sideways drag
#      scrolls the pairs and types nothing
#   3  ⌃ and then c on the system keyboard interrupts the program
#   4  ⌥ and then b reaches the Pane as Meta-b
#   5  the arrow key: a drag up is Up once and recalls the last command, an
#      armed ⌃ goes with the first arrow only, and a hold repeats the arrow
#   6  ⌘ and then c puts the Pane's text on the clipboard
#   7  ⌘ and then v pastes the clipboard and runs nothing, two lines too. For
#      a program that runs each line of a paste, the phone asks first
#   8  ⌘ and then k leaves the prompt and no Scrollback
#
# The Surface renders with Metal, so what it shows is never in the
# accessibility tree. Each check reads the Host instead: the Pane with
# `capture-pane`, and the clipboard for the copy.
#
# Letters go in on the software keyboard, key by key at its frame, because a
# sticky modifier is spent on what the keyboard types. See `key_at` in
# e2e/regressions.sh for why `agent-device type` is not used.
#
# Requires a configured .env.local and a booted simulator.
# Usage:  bash e2e/key-row.sh

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail

APP=dev.muxify.app
SESSION=0
PANE="$SESSION:0.0"
device=()
[ -z "${MUXIFY_E2E_DEVICE:-}" ] || device=(--udid "$MUXIFY_E2E_DEVICE")

# Runs a command on the dev Host, which is this Mac, in the sandbox.
on_host() { sh -c "$*" 2>/dev/null; }

fail() { echo "FAIL: $1"; exit 1; }

# The Pane's lines, without the empty ones under the prompt.
pane() { on_host "tmux capture-pane -p $1 -t '$PANE'" | grep -v '^[[:space:]]*$'; }
typed_line() { pane "" | tail -1; }
# A prompt with nothing typed on it, and a Pane with nothing else in it.
fresh_prompt() {
  on_host "tmux send-keys -t '$PANE' C-c; tmux send-keys -t '$PANE' C-u; tmux send-keys -t '$PANE' 'clear' Enter"
  sleep 1
}

# The frame of a button, as `x y width height`, or nothing when it is not on screen.
frame_of() {
  agent-device snapshot --json 2>/dev/null | LABEL="$1" python3 -c "
import json, os, sys
for n in json.load(sys.stdin)['data']['nodes']:
    if n['type'] in ('Key', 'Button') and (n.get('label') or '').lower() == os.environ['LABEL'].lower():
        r = n['rect']
        print(round(r['x']), round(r['y']), round(r['width']), round(r['height']))
        break
"
}

# Presses the middle of a button or of one of the software keyboard's keys.
press_at() {
  local x y w h
  read -r x y w h <<<"$(frame_of "$1")"
  [ -n "${x:-}" ] || fail "no $1 on screen"
  agent-device press "$((x + w / 2))" "$((y + h / 2))" >/dev/null 2>&1
}

# A sticky modifier from the Key Row, then one letter on the software keyboard.
chord() {
  agent-device press "label=\"$1\"" >/dev/null 2>&1
  sleep 0.5
  press_at "$2"
}

# Drags from the middle of the arrow key: `stick <dx> <dy> <milliseconds>`.
stick() {
  local x y w h
  read -r x y w h <<<"$(frame_of arrows)"
  [ -n "${x:-}" ] || fail "no arrow key on screen"
  agent-device gesture pan "$((x + w / 2))" "$((y + h / 2))" "$1" "$2" "$3" >/dev/null 2>&1
}

keyboard_up() { [ -n "$(frame_of return)" ]; }

attach() {
  agent-device close >/dev/null 2>&1
  agent-device open "$APP" --platform ios --relaunch "${device[@]}" >/dev/null 2>&1
  agent-device wait text "Dev Host" 25000 >/dev/null 2>&1
  agent-device press 'label="Host Dev Host"' >/dev/null 2>&1
  agent-device wait "label=\"Session $SESSION\"" 15000 >/dev/null 2>&1
  agent-device press "label=\"Session $SESSION\"" >/dev/null 2>&1
  agent-device wait 'id="pane-command"' 20000 >/dev/null 2>&1 \
    || fail "the header never showed a program, so the Attach never connected"
}

echo "0/8  a Session with one Window, the Pane at a prompt, the keyboard up"
on_host "tmux kill-window -a -t '$SESSION:0' 2>/dev/null; true"
fresh_prompt
attach
for _ in 1 2 3; do
  keyboard_up && break
  agent-device press 'label="Keyboard"' >/dev/null 2>&1
  sleep 3
done
keyboard_up || fail "the Keyboard button did not raise the keyboard"

echo "1/8  a tap on a pair types its main symbol"
agent-device press 'label="minus underscore"' >/dev/null 2>&1
sleep 1
[ "$(typed_line)" = '$ -' ] || fail "a tap on - _ typed: $(typed_line)"
echo "     - is on the prompt"

echo "2/8  a drag down types the alternate symbol, and a sideways drag scrolls"
read -r X Y W H <<<"$(frame_of 'minus underscore')"
[ -n "${X:-}" ] || fail "no - _ pair on screen"
agent-device gesture pan "$((X + W / 2))" "$((Y + H / 2))" 0 30 600 >/dev/null 2>&1
sleep 1
[ "$(typed_line)" = '$ -_' ] || fail "a drag down on - _ typed: $(typed_line)"
echo "     _ follows it"
agent-device gesture pan "$((X + W / 2))" "$((Y + H / 2))" -120 0 400 >/dev/null 2>&1
sleep 2
# The pairs snap, so the pair that was past the edge is now whole and on screen.
read -r _ _ SHOWN _ <<<"$(frame_of 'tilde quote')"
[ "${SHOWN:-0}" -gt 20 ] || fail "a sideways drag on the pairs did not scroll them"
[ "$(typed_line)" = '$ -_' ] || fail "a sideways drag on the pairs typed: $(typed_line)"
echo "     the pairs scrolled, and nothing was typed"

echo "3/8  ⌃ then c interrupts the program"
fresh_prompt
on_host "tmux send-keys -t '$PANE' 'sleep 30' Enter"
sleep 1
chord control c
sleep 2
[ "$(on_host "tmux display-message -p -t '$PANE' '#{pane_current_command}'")" = bash ] \
  || fail "⌃c did not interrupt sleep"
[ "$(typed_line)" = '$' ] || fail "no new prompt after ⌃c: $(typed_line)"
echo "     sleep is gone, and the prompt is back"

echo "4/8  ⌥ then b reaches the Pane as Meta-b"
fresh_prompt
on_host "tmux send-keys -t '$PANE' 'cat -v' Enter"
sleep 1
chord option b
sleep 2
typed_line | grep -qi '^\^\[b$' || fail "⌥b reached cat as: $(typed_line)"
echo "     cat -v read $(typed_line)"

echo "5/8  the arrow key sends the arrow it is dragged towards"
fresh_prompt
on_host "tmux send-keys -t '$PANE' 'true key-row-recall' Enter; tmux send-keys -t '$PANE' 'clear' Enter"
sleep 1
# Lifted before the arrow repeats, so each drag is one Up.
stick 0 -30 250
sleep 1
stick 0 -30 250
sleep 1
[ "$(typed_line)" = '$ true key-row-recall' ] || fail "two drags up put this on the prompt: $(typed_line)"
echo "     two drags up recalled the command before clear"
fresh_prompt
on_host "tmux send-keys -t '$PANE' 'cat -v' Enter"
sleep 1
agent-device press 'label="control"' >/dev/null 2>&1
sleep 0.5
stick 0 -30 250
sleep 1
stick 0 -30 250
sleep 1
[ "$(typed_line)" = '^[[1;5A^[[A' ] || fail "⌃ and two drags up reached cat as: $(typed_line)"
echo "     ⌃ went with the first Up only: cat -v read $(typed_line)"
fresh_prompt
on_host "tmux send-keys -t '$PANE' 'cat -v' Enter"
sleep 1
stick -30 0 1500
sleep 1
LEFTS=$(typed_line | grep -o '\^\[\[D' | wc -l | tr -d ' ')
[ "$LEFTS" -ge 3 ] || fail "a held drag left sent $LEFTS arrows: $(typed_line)"
[ "$(typed_line | tr -d '^[D')" = '' ] || fail "a held drag left sent more than Left: $(typed_line)"
echo "     a held drag left repeated Left $LEFTS times"

echo "6/8  ⌘ then c copies the Pane's text"
fresh_prompt
on_host "tmux send-keys -t '$PANE' 'echo key-row-copy' Enter"
sleep 1
chord command c
agent-device wait 'label="OK"' 8000 >/dev/null 2>&1 || fail "⌘c showed no alert"
agent-device press 'label="OK"' >/dev/null 2>&1
sleep 1
xcrun simctl pbpaste "${MUXIFY_E2E_DEVICE:-booted}" | grep -q '^key-row-copy$' || fail "the clipboard does not hold the Pane's text"
echo "     the Pane's text is on the clipboard"

echo "7/8  ⌘ then v pastes the clipboard and runs nothing"
fresh_prompt
agent-device clipboard write 'echo key-row-paste' >/dev/null 2>&1
chord command v
# iOS asks before an app reads a clipboard that another app wrote.
for _ in 1 2 3 4 5; do
  [ "$(typed_line)" = '$ echo key-row-paste' ] && break
  agent-device press 'label="Allow Paste"' >/dev/null 2>&1
  sleep 1
done
[ "$(typed_line)" = '$ echo key-row-paste' ] || fail "⌘v left this on the prompt: $(typed_line)"
pane "" | grep -q '^key-row-paste$' && fail "⌘v ran what it pasted"
echo "     the text is on the prompt, and it did not run"
fresh_prompt
agent-device clipboard write "$(printf 'echo key-row-one\necho key-row-two')" >/dev/null 2>&1
chord command v
for _ in 1 2 3 4 5; do
  pane "" | grep -q '^echo key-row-two$' && break
  agent-device press 'label="Allow Paste"' >/dev/null 2>&1
  sleep 1
done
[ "$(pane "")" = "$(printf '$ echo key-row-one\necho key-row-two')" ] \
  || fail "⌘v of two lines left this in the Pane: $(pane "")"
echo "     two lines are on the prompt, and neither ran"
# A bash that takes a paste as typing: each line break is an Enter.
fresh_prompt
on_host "tmux send-keys -t '$PANE' \"bind 'set enable-bracketed-paste off'\" Enter; tmux send-keys -t '$PANE' 'clear' Enter"
sleep 1
chord command v
agent-device wait 'label="Paste more than one line?"' 8000 >/dev/null 2>&1 \
  || fail "⌘v of two lines did not ask before a program that runs each line"
agent-device press 'label="Cancel"' >/dev/null 2>&1
sleep 2
[ "$(pane "")" = '$' ] || fail "a cancelled ⌘v left this in the Pane: $(pane "")"
on_host "tmux send-keys -t '$PANE' \"bind 'set enable-bracketed-paste on'\" Enter"
echo "     with bracketed paste off the phone asked, and Cancel pasted nothing"

echo "8/8  ⌘ then k leaves the prompt and no Scrollback"
fresh_prompt
on_host "tmux send-keys -t '$PANE' 'seq 1 200' Enter"
sleep 1
[ "$(pane '-S -' | wc -l | tr -d ' ')" -gt 200 ] || fail "the Pane has no Scrollback to clear"
chord command k
sleep 3
[ "$(pane '-S -')" = '$' ] || fail "after ⌘k the Pane and its Scrollback hold: $(pane '-S -' | head -5)"
echo "     the prompt, and nothing above it"

agent-device close >/dev/null 2>&1
fresh_prompt
echo
echo "PASS: a pair types its main symbol on a tap and its alternate one on a drag"
echo "      down, the pairs scroll sideways, ⌃ and ⌥ apply to the next key of"
echo "      the system keyboard, the arrow key sends the arrow it is dragged"
echo "      towards and repeats it while held, and ⌘ c, v and k copy, paste"
echo "      without running, one line or two, and clear."
