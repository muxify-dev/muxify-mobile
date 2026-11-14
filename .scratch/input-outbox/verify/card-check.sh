#!/bin/bash
# On-screen check of the three held/discarded card paths. Runs inside e2e/sandbox.sh.
# Usage: MUXIFY_E2E_DEVICE=<udid> bash e2e/sandbox.sh bash <this file>
set -uo pipefail
[ -n "${MUXIFY_E2E_ROOT:-}" ] || { echo "run through e2e/sandbox.sh"; exit 2; }

APP=dev.muxify.app
PANE=0:0.0
UDID=$MUXIFY_E2E_DEVICE
ROOT=$(cd "$MUXIFY_E2E_ROOT" && pwd -P)
RESULTS=0

on_host() { sh -c "$*" 2>/dev/null; }
pass() { echo "PASS: $1"; }
failc() { echo "FAIL: $1"; RESULTS=1; }
abort() { echo "ABORT: $1"; tmux_cont; sshd_cont; echo "--- screen:"; agent-device snapshot -i 2>&1 | head -40; exit 1; }

socket=$(on_host "tmux display -p '#{socket_path}'")
case "$(cd "$(dirname "$socket")" && pwd -P)/" in
  "$ROOT"/*) echo "tmux socket $socket is inside $ROOT" ;;
  *) echo "ABORT: tmux socket $socket is not inside $ROOT"; exit 1 ;;
esac
TMUX_PID=$(on_host "tmux display -p '#{pid}'")
SSHD=$(cat "$ROOT/sshd.pid")

descendants() { local c; for c in $(pgrep -P "$1"); do echo "$c"; descendants "$c"; done; }
# The listener and every per-connection process stop: the link goes silent, still open.
sshd_stop() { kill -STOP "$SSHD" $(descendants "$SSHD") 2>/dev/null; }
sshd_cont() { kill -CONT "$SSHD" 2>/dev/null; }
# The per-connection processes die: the app sees the Connection end.
sshd_cut() { kill -KILL $(descendants "$SSHD") 2>/dev/null; }
tmux_stop() { kill -STOP "$TMUX_PID"; }
tmux_cont() { kill -CONT "$TMUX_PID" 2>/dev/null; }

present() { agent-device is exists "$1" >/dev/null 2>&1; }
absent() { agent-device is absent "$1" >/dev/null 2>&1; }
waitfor() { agent-device wait "$1" "${2:-20000}" >/dev/null 2>&1; }

frame_of() {
  agent-device snapshot --json 2>/dev/null | LABEL="$1" python3 -c "
import json, os, sys
for n in json.load(sys.stdin)['data']['nodes']:
    if n['type'] in ('Key', 'Button') and (n.get('label') or '').lower() == os.environ['LABEL'].lower():
        r = n['rect']; print(round(r['x']), round(r['y']), round(r['width']), round(r['height'])); break
"
}
press_return() {
  local x y w h
  read -r x y w h <<<"$(frame_of return)"
  [ -n "${x:-}" ] || abort "no return key on screen"
  agent-device press "$((x + w / 2))" "$((y + h / 2))" >/dev/null 2>&1
}
keyboard_up() {
  for _ in 1 2 3; do
    [ -n "$(frame_of return)" ] && return 0
    agent-device press 'label="Keyboard"' >/dev/null 2>&1
    sleep 3
  done
  [ -n "$(frame_of return)" ]
}

# Keys typed on a silent link, then the link is cut and comes back.
# $1: text to type. $2: a Host command to run while the link is down (may be empty).
break_with_keys() {
  keyboard_up || abort "the keyboard did not come up"
  sshd_stop
  sleep 1
  agent-device type "$1" >/dev/null 2>&1
  press_return
  sleep 1
  [ -n "$2" ] && on_host "$2"
  sshd_cont
  sshd_cut
}

# The Options menu in the header holds Compose and Close composer.
options() {
  agent-device press 'label="Options"' >/dev/null 2>&1
  waitfor "label=\"$1\"" 5000 || abort "no $1 in Options"
  agent-device press "label=\"$1\"" >/dev/null 2>&1
}

# --- start the app against the sandbox -------------------------------------
xcrun simctl launch "$UDID" "$APP" -RCT_jsLocation localhost:8090 >/dev/null || abort "launch failed"
sleep 6
agent-device open "$APP" --platform ios --udid "$UDID" >/dev/null 2>&1
agent-device react-native dismiss-overlay >/dev/null 2>&1
waitfor 'label="Host Dev Host"' 25000 || abort "no Dev Host on the Host Screen"
agent-device press 'label="Host Dev Host"' >/dev/null 2>&1
waitfor 'label="Session 0"' 15000 || abort "no Session 0"
agent-device press 'label="Session 0"' >/dev/null 2>&1
waitfor 'id="pane-command"' 20000 || abort "the Attach never connected"
on_host "tmux send-keys -t '$PANE' 'clear; cat' Enter"
sleep 2

# --- 1. A held card shows Send only while connected -------------------------
echo "== 1  Send while not connected"
break_with_keys x ""
waitfor 'id="input-held"' 30000 && pass "a held card shows after the reconnect (x then Enter)" \
  || abort "no held card after the break"
present 'id="input-send"' && pass "the held card has Send while connected" || failc "no Send on the held card"
sshd_stop
sshd_cut
sleep 3
if absent 'id="input-held"' && absent 'id="input-send"'; then
  pass "with the Connection gone, no held card and no Send show (the Lane went adrift)"
else
  failc "a held card or Send shows while the Connection is gone"
fi
sshd_cont
waitfor 'id="input-held"' 20000 || { echo "--- screen after 20 s:"; agent-device snapshot -i 2>&1 | head -30; }
for label in "Try again" "Reconnect"; do present "label=\"$label\"" && agent-device press "label=\"$label\"" >/dev/null 2>&1 && echo "pressed $label"; done
waitfor 'id="input-held"' 30000 && pass "the held card is back after the reconnect" \
  || abort "the held card did not come back"

# --- 2. Move to Composer while the Draft is busy ----------------------------
echo "== 2  Move to Composer with a busy Draft"
options Compose
waitfor 'label="Photos"' 10000 || abort "the Composer did not open"
sleep 1
agent-device fill 'label="Message"' "draft-text" >/dev/null 2>&1
sleep 1
agent-device is exists 'label="Send" enabled=true' >/dev/null 2>&1 || abort "the Composer's Send is not enabled after filling the Message"
tmux_stop
agent-device press 'label="Send"' >/dev/null 2>&1
waitfor 'text="Sending…"' 10000 && pass "the Draft is on its way (Sending… shows)" || failc "the Draft did not show Sending…"
options "Close composer"
waitfor 'id="input-compose"' 10000 || { tmux_cont; abort "the held card did not show after the Composer closed"; }
agent-device press 'id="input-compose"' >/dev/null 2>&1
sleep 2
absent 'label="Photos"' && pass "Move to Composer with a busy Draft leaves the Composer closed" \
  || failc "the Composer opened while the Draft was busy"
present 'id="input-held"' && pass "the held keys stay on the card" || failc "the held card went away"
tmux_cont
sleep 4
on_host "tmux capture-pane -p -t '$PANE'" | grep -q 'draft-text' && pass "the Draft reached the Pane after tmux continued" \
  || failc "the Draft did not reach the Pane"
agent-device press 'id="input-compose"' >/dev/null 2>&1
waitfor 'label="Photos"' 10000 && pass "Move to Composer with an idle Draft opens the Composer" \
  || failc "the Composer did not open when the keys were moved"
present 'id="input-held"' && failc "the held card is still there after the move" || pass "the card is gone after the move"
options "Close composer"
sleep 1
present 'id="input-held"' && failc "the held card came back after the Composer closed" \
  || pass "no held card after the Composer closed (the keys are in the Draft)"

# --- 3. The discarded card and Dismiss --------------------------------------
echo "== 3  discarded card"
break_with_keys y "tmux respawn-pane -k -t '$PANE' 'cat'"
waitfor 'id="input-discarded"' 40000 && pass "a discarded card shows when the Pane was started again" \
  || failc "no discarded card"
present 'id="input-dismiss"' && pass "the discarded card has Dismiss" || failc "no Dismiss on the discarded card"
agent-device press 'id="input-dismiss"' >/dev/null 2>&1
agent-device wait absent 'id="input-discarded"' 10000 >/dev/null 2>&1
absent 'id="input-discarded"' && pass "Dismiss removes the discarded card" || failc "the discarded card stays after Dismiss"
on_host "tmux capture-pane -p -t '$PANE'" | grep -q '^y$' && failc "the discarded y reached the Pane" \
  || pass "the discarded y never reached the Pane"

agent-device close >/dev/null 2>&1
echo "RESULT: $([ $RESULTS = 0 ] && echo PASS || echo FAIL)"
exit $RESULTS
