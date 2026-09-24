#!/bin/bash
#
# Fast device feedback loop.
#
# The slow way to test a JS change is a full rebuild and relaunch, which costs
# minutes. Almost nothing needs that: only a native change (a new pod, or an
# edit to patches/expo-libghostty.patch) requires `expo prebuild` + `run:ios`.
# For JS, Metro already has the new code — the app just has to reload.
#
#   bash scripts/dev-loop.sh reload    # push JS changes, re-attach, report sizes
#   bash scripts/dev-loop.sh sizes     # just report, change nothing
#   bash scripts/dev-loop.sh shell CMD # run CMD in the Session, report the pane
#
# Reports the three numbers that matter for the resize path in one line:
#   surface  what the Surface says its grid is
#   window   the size tmux actually draws the Window at
#   client   the size tmux believes the attached Client is
# surface and window must agree: that is the resize path working. client lags
# one resize behind and there is nothing to be done about it — the SSH
# library's window-change request is one behind, and its core ships prebuilt.
# That lag is why every resize ends with a redraw; see redrawClientCommand.

set -uo pipefail
cd "$(dirname "$0")/.."

APP=dev.muxify.app
MODE=${1:-reload}

vm() {
  ssh -F /dev/null -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -i "$HOME/.orbstack/ssh/id_ed25519" -p 32222 default@127.0.0.1 "$@" 2>/dev/null
}

snap()  { agent-device snapshot -i 2>/dev/null; }
# client = the PTY winsize (frozen by the SSH library's resize bug)
# window = what tmux actually draws at (driven by resize-window)
tsize() { vm "tmux list-clients -t 0 -F '#{client_width}x#{client_height}'"; }
wsize() { vm "tmux display-message -p -t 0 '#{window_width}x#{window_height}'"; }
asize() { snap | grep -oE '\[text\] "[0-9]+x[0-9]+"' | head -1 | grep -oE '[0-9]+x[0-9]+'; }
# Rows tmux padded and left behind. Must be 0 once a resize has settled.
dots() { vm "tmux capture-pane -t 0 -p" | grep -c '·'; }
kbref() { snap | grep -E '^@e[0-9]+ \[button\] "Keyboard"' | head -1 | awk '{print $1}'; }

report() { printf '%-18s surface=%-8s window=%-8s client=%-8s dots=%s\n' \
  "$1" "$(asize)" "$(wsize)" "$(tsize)" "$(dots)"; }

attach() {
  agent-device close >/dev/null 2>&1
  agent-device open "$APP" --platform ios --relaunch >/dev/null 2>&1
  agent-device wait text "No Hosts yet" 25000 >/dev/null 2>&1
  agent-device press 'label="Open Surface smoke test"' >/dev/null 2>&1
  # Wait for the Connection rather than sleeping a fixed guess.
  for _ in $(seq 1 20); do
    agent-device is text 'id="connection-status"' "Connected" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "WARN: never reached Connected"
}

case "$MODE" in
  sizes)
    report "now"
    ;;

  shell)
    shift
    vm "tmux send-keys -t 0 C-c; tmux send-keys -t 0 '$*' Enter"
    sleep 2
    vm "tmux capture-pane -t 0 -p" | grep -n . | head -10
    ;;

  reload)
    vm "tmux send-keys -t 0 C-c; tmux send-keys -t 0 'clear' Enter" >/dev/null 2>&1
    attach
    report "attached"

    K=$(kbref)
    [ -n "$K" ] && agent-device press "$K" >/dev/null 2>&1 && sleep 4
    report "keyboard up"

    K=$(kbref)
    [ -n "$K" ] && agent-device press "$K" >/dev/null 2>&1 && sleep 4
    report "keyboard down"
    ;;

  *)
    echo "usage: dev-loop.sh [reload|sizes|shell CMD]"
    exit 1
    ;;
esac
