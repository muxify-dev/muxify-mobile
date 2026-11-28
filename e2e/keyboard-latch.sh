#!/bin/bash
#
# The Key Row follows one keyboard snapshot (ADR 0043). Run it on an iPad
# simulator: the iPhone shows no bar for a physical keyboard, and the cause of
# the bug was seen on the iPad.
#
# What this proves, against the sandbox's Session 0:
#
#   1  Minimization on, with the Terminal Screen open at launch: the Key Row
#      never mounts, the Pane takes the keyboard, and the first snapshot the
#      app reads already has GameController's answer (the module listens from
#      the app's start, because a read at that moment says "not connected"
#      a few milliseconds before the connect notice)
#   2  Minimization off, so iOS shows the full software keyboard while
#      GameController says "connected": the Key Row shows
#   3  The keyboard goes down by the iPad's hide key: iOS reports a hiding
#      keyboard at its full size below the screen, and the Key Row stays
#   4  Home and back, whose GameController check agrees with the old answer:
#      the Key Row stays
#   5  The Surface's answer to the Keyboard button after the hide key (see
#      ADR 0043, Toggle)
#
# Not proven here: a key pressed on a physical keyboard clears the doubt (the
# Swift test of the rule covers it). Nothing sends a hardware key to a
# simulator without the Mac's keyboard: agent-device `type` goes through the
# software keyboard, and this suite must not type into the Mac.
#
# Each check reads the app's Log, which the app writes to its Documents, and
# the accessibility tree for the Key Row (its Escape key).
#
# Requires a configured .env.local and a booted iPad simulator.
# Usage:  MUXIFY_E2E_DEVICE=<udid> bash e2e/keyboard-latch.sh

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail
: "${MUXIFY_E2E_DEVICE:?Set MUXIFY_E2E_DEVICE to an iPad simulator UDID}"

APP=dev.muxify.app
DEVICE=$MUXIFY_E2E_DEVICE
AD_SESSION=muxify-keyboard-latch
DOCUMENTS="$(xcrun simctl get_app_container "$DEVICE" "$APP" data)/Documents"
LOGS="$DOCUMENTS/muxify-logs"
SETTINGS="$DOCUMENTS/muxify-settings.json"
# A daemon of its own: another agent-device run on this Mac that closes "its" session
# closes this one too, when they share the daemon.
AD_STATE_DIR="$MUXIFY_E2E_ROOT/agent-device"
ad() { agent-device "$@" --state-dir "$AD_STATE_DIR" --session "$AD_SESSION"; }
trap 'ad close >/dev/null 2>&1; agent-device daemon stop --state-dir "$AD_STATE_DIR" >/dev/null 2>&1; true' EXIT

# Writes the iOS setting that minimizes the software keyboard to a bar while a
# hardware keyboard is in use. The sandbox puts it back when the run ends.
minimize() { xcrun simctl spawn "$DEVICE" defaults write com.apple.keyboard.preferences AutomaticMinimizationEnabled -bool "$1"; }

# The newest launch's Log, one "tag text" line each, oldest first.
launch_log() {
  python3 - "$LOGS" <<'PY'
import json, pathlib, sys
files = sorted(pathlib.Path(sys.argv[1]).glob('*.jsonl'), key=lambda f: f.stat().st_mtime)
for line in files[-1].read_text().splitlines():
    entry = json.loads(line)
    if entry.get('kind') == 'entry':
        print(f"{entry['tag']} {entry['text']}")
PY
}

fail() {
  echo "FAIL: $1"
  echo "--- the screen"
  ad snapshot -i 2>&1 | head -25
  echo "--- keyboard lines of the Log"
  launch_log | grep -E '^(keyboard|screen Key Row|screen keyboard|holder|attach keyboard)' | tail -30
  exit 1
}

# Shown or hidden, from the Key Row's Escape key. A snapshot that failed says
# "unknown", and is read again by wait_row.
key_row() {
  ad snapshot --json 2>/dev/null | python3 -c "
import json, sys
try:
    reply = json.load(sys.stdin)
except ValueError:
    reply = {}
if not reply.get('success'):
    print('unknown')
else:
    nodes = reply.get('data', {}).get('nodes', [])
    print('shown' if any((n.get('label') or '').lower() == 'escape' for n in nodes) else 'hidden')"
}

# Waits up to $2 seconds for the Key Row to be shown or hidden.
wait_row() {
  for _ in $(seq "$2"); do
    [ "$(key_row)" = "$1" ] && return 0
    sleep 1
  done
  return 1
}

# Whether the Log has a line, as an extended regular expression, after the line number $2 (default 0).
# Not `grep -q`: it stops at the first match, and pipefail then reports the writer's broken pipe.
log_has() { launch_log | tail -n +"$((${2:-0} + 1))" | grep -E "$1" >/dev/null; }
log_count() { launch_log | wc -l | tr -d ' '; }

# Opens the app afresh. agent-device sometimes loses a session as it opens, so it is tried again.
start() {
  for _ in 1 2 3; do
    ad close >/dev/null 2>&1
    xcrun simctl terminate "$DEVICE" "$APP" >/dev/null 2>&1
    opened=$(ad open "$APP" --platform ios --udid "$DEVICE" --relaunch 2>&1) && return 0
    sleep 2
  done
  fail "agent-device could not open the app: $opened"
}

set_setting() {
  xcrun simctl terminate "$DEVICE" "$APP" >/dev/null 2>&1
  python3 - "$SETTINGS" "$1" "$2" <<'PY'
import json, sys
path, key, value = sys.argv[1:]
data = json.load(open(path))
data[key] = json.loads(value)
json.dump(data, open(path, 'w'), indent=2)
PY
}

echo "0/5  attach once, so the Last Place is the Session and a launch opens the Terminal Screen"
minimize true
start
ad wait 'label="Host Dev Host"' 20000 >/dev/null 2>&1 || fail "no Dev Host on Home"
ad press 'label="Host Dev Host"' --settle >/dev/null 2>&1
ad wait 'label="Session 0"' 15000 >/dev/null 2>&1 || fail "no Session 0"
ad press 'label="Session 0"' --settle >/dev/null 2>&1
ad wait 'id="pane-command"' 20000 >/dev/null 2>&1 || fail "the Attach never connected"
set_setting reconnectOnStart true

echo "1/5  minimization on, the Terminal Screen opens at launch: no Key Row, and the Pane has the keyboard"
start
ad wait 'id="pane-command"' 20000 >/dev/null 2>&1 || fail "the Terminal Screen did not open at launch"
sleep 3
log_has '^keyboard read → physical (inUse|absent)' || fail "the app's first snapshot did not have GameController's answer"
log_has '^keyboard physical keyboard connected' || fail "the simulator's keyboard is not in use"
log_has '^screen Key Row shown' && fail "the Key Row was mounted while a physical keyboard was in use or unknown"
log_has '^screen keyboard: focus' || fail "the Pane did not take the keyboard"
[ "$(key_row)" = hidden ] || fail "the Key Row is on screen over a connected keyboard"
echo "     ok: no Key Row, Pane focused"

echo "2/5  minimization off: iOS shows the full keyboard over a connected one, and the Key Row shows"
minimize false
set_setting reconnectOnStart true
start
ad wait 'id="pane-command"' 20000 >/dev/null 2>&1 || fail "the Terminal Screen did not open at launch"
wait_row shown 20 || fail "the Key Row did not show over the full software keyboard"
log_has 'keyboardDidShow.*staleSuspected true' || fail "the Log has no full keyboard that made GameController's word stale"
echo "     ok: Key Row shown"

echo "3/5  the iPad's hide key: iOS reports the hiding keyboard below the screen, and the Key Row stays"
before=$(log_count)
ad keyboard dismiss >/dev/null 2>&1 || fail "agent-device could not press the keyboard's hide key"
sleep 3
log_has 'software none.*staleSuspected true' "$before" || fail "the hide did not arrive as no software keyboard"
wait_row shown 8 || fail "the Key Row went when the keyboard did"
log_has '^screen Key Row hidden' "$before" && fail "the Log says the Key Row hid"
echo "     ok: Key Row shown with the keyboard down"

echo "4/5  Home and back: the GameController check agrees with the old answer, and changes nothing"
before=$(log_count)
ad home >/dev/null 2>&1
sleep 3
ad open "$APP" --platform ios --udid "$DEVICE" >/dev/null 2>&1
sleep 4
wait_row shown 8 || fail "the Key Row went with a trip to Home"
log_has '^screen Key Row hidden' "$before" && fail "the Log says the Key Row hid"
echo "     ok: Key Row shown after the return"

echo "5/5  the Keyboard button after the hide key: what the Surface says"
if wait_row shown 8; then
  # A development build's warning badge sits over the Keyboard button, and a tap on it only closes the badge.
  ad react-native dismiss-overlay >/dev/null 2>&1
  ad press 'label="Keyboard"' --settle >/dev/null 2>&1
  sleep 2
  answer=$(launch_log | grep -E '^pane %[0-9]+ keyboard: toggle, Surface' | tail -1)
  [ -n "$answer" ] || fail "the Keyboard button wrote no answer of the Surface"
  echo "     $answer"
fi

echo "SKIP a key pressed on a physical keyboard: nothing here sends a hardware key to a simulator (see the head of this file)"
echo "Key Row follows the keyboard snapshot."
ad close
