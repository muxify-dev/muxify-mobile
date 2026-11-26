#!/bin/bash
#
# A ⌘ chord does the same from the Key Row and from a hardware keyboard: a
# Keyboard Shortcut runs, and any other chord reaches ghostty.
#
#   MUXIFY_E2E_DEVICE=<simulator UDID> bash e2e/command-keys.sh
#
# The UI half is e2e/command-keys/CommandKeysTests.swift. XCUITest's
# `typeKey` is the only way to send a hardware key to the simulator, so the
# test is compiled into a copy of agent-device's runner, whose project takes
# every Swift file in its test folder. The test hands each tmux check to this
# script through files in $MUXIFY_KEYS_DIR, and this script answers "ok" or
# what it found instead.
#
# Covered, from each keyboard: ⌘D splits once (twice would mean the chord ran
# twice), ⌘, opens Settings, the chord the user recorded for Split right runs
# and ⌘D then reaches ghostty, ⌘K clears the Pane and its Scrollback, and a
# chord no Keyboard Shortcut claims reaches ghostty's keybind for the line:
# ⌘⌫ from the Key Row, ⌘← from the hardware keyboard. The recorder gets ⌘,
# although ⌘, is Open Settings. From the hardware keyboard, ← and ↑ with no
# modifier reach the Pane: UIKit names these keys, and the name is not text
# for UIKit to type.
#
# The hardware ⌘⌫ is not checked: XCUITest's ⌘ and delete never reaches the
# app on the simulator (UIApplication.sendEvent gets no event for it), while
# on a real iPad keyboard it removes the line. ⌘← is the hardware check
# instead.
#
# The Key Row half is left out, and the script says so, when the row is
# hidden. The app hides the row while iOS reports a hardware keyboard. On the
# iOS 26 simulator, iOS reports one from the first XCUITest launch, and it
# also keeps the software keyboard down, so the Key Row half runs only where
# no hardware keyboard is reported. e2e/key-row.sh covers the same Key Row
# chords with agent-device, with the same condition.

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"
set -euo pipefail
: "${MUXIFY_E2E_DEVICE:?Set MUXIFY_E2E_DEVICE to a simulator UDID}"

HERE=$(cd "$(dirname "$0")" && pwd)
PANE=0:0.0
KEYS="$MUXIFY_E2E_ROOT/command-keys"
mkdir -p "$KEYS"
echo 0 > "$KEYS/count"

# Every chord starts at its default. The sandbox puts the settings back at
# the end, and the app is stopped while it runs this.
SETTINGS="$(xcrun simctl get_app_container "$MUXIFY_E2E_DEVICE" dev.muxify.app data)/Documents/muxify-settings.json"
[ ! -f "$SETTINGS" ] || python3 - "$SETTINGS" <<'PY'
import json, sys
path = sys.argv[1]
settings = json.load(open(path))
settings.pop('keyboardShortcuts', None)
json.dump(settings, open(path, 'w'))
PY

# The runner copy and its build outlive the sandbox, so a second run only
# rebuilds what changed. Keyed by agent-device's version.
AGENT_DEVICE="$(npm root -g)/agent-device"
VERSION=$(node -p "require('$AGENT_DEVICE/package.json').version")
RUNNER="${TMPDIR:-/tmp}/muxify-command-keys-runner-$VERSION"
if [ ! -d "$RUNNER/apple" ]; then
  mkdir -p "$RUNNER"
  cp -R "$AGENT_DEVICE/dist/apple" "$RUNNER/apple"
  cp -R "$AGENT_DEVICE/apple/snapshot-bridge" "$RUNNER/apple/snapshot-bridge"
fi
PROJECT="$RUNNER/apple/runner/AgentDeviceRunner"
cp "$HERE/command-keys/CommandKeysTests.swift" "$PROJECT/AgentDeviceRunnerUITests/"

pane() { tmux capture-pane -p "$@" -t "$PANE" | grep -v '^[[:space:]]*$' || true; }
typed_line() { pane | tail -1; }
pane_count() { tmux list-panes -t 0:0 | wc -l | tr -d ' '; }
fresh() {
  tmux kill-pane -a -t "$PANE" 2>/dev/null || true
  tmux send-keys -t "$PANE" C-c
  tmux send-keys -t "$PANE" C-u
  tmux send-keys -t "$PANE" clear Enter
  sleep 1
  tmux clear-history -t "$PANE"
}
panes_reach() { for _ in $(seq 30); do [ "$(pane_count)" = "$1" ] && return; sleep 0.2; done; }
expect() { [ "$2" = "$3" ] && echo ok || echo "$1: wanted [$3], found [$2]"; }

check() {
  case "$1" in
    fresh) fresh; expect panes "$(pane_count)" 1 ;;
    one-pane) sleep 3; expect panes "$(pane_count)" 1 ;;
    two-panes) panes_reach 2; sleep 2; expect panes "$(pane_count)" 2 ;;
    fresh-with-scrollback)
      fresh
      tmux send-keys -t "$PANE" 'seq 1 200' Enter
      sleep 1
      [ "$(pane -S - | wc -l | tr -d ' ')" -gt 200 ] && echo ok || echo "no Scrollback to clear"
      ;;
    cleared) sleep 3; expect "Pane and Scrollback" "$(pane -S -)" '$' ;;
    typed)
      fresh
      tmux send-keys -t "$PANE" -l 'echo one two'
      sleep 1
      expect line "$(typed_line)" '$ echo one two'
      ;;
    line-removed) sleep 1; expect line "$(typed_line)" '$' ;;
    x-at-line-start) sleep 1; expect line "$(typed_line)" '$ Xecho one two' ;;
    x-before-last) sleep 1; expect line "$(typed_line)" '$ echo one twXo' ;;
    # fresh ran `clear` last.
    history-recalled) sleep 1; expect line "$(typed_line)" '$ clear' ;;
    *) echo "no check named $1" ;;
  esac
}

# Answers each step the test writes, until xcodebuild exits.
answer() {
  local last=0 number name verdict
  while kill -0 "$1" 2>/dev/null; do
    number=0
    # The test writes no newline, so read reports end of file and still sets both.
    [ -f "$KEYS/step" ] && { read -r number name < "$KEYS/step" || true; }
    if [ "${number:-0}" -gt "$last" ]; then
      verdict=$(check "$name")
      echo "  $number $name: $verdict"
      printf '%s' "$verdict" > "$KEYS/ack-$number"
      last=$number
    fi
    sleep 0.2
  done
}

echo "Building the runner with the command-keys test"
xcodebuild build-for-testing -project "$PROJECT/AgentDeviceRunner.xcodeproj" -scheme AgentDeviceRunner \
  -destination "id=$MUXIFY_E2E_DEVICE" -derivedDataPath "$RUNNER/dd" > "$KEYS/build.log" 2>&1 \
  || { grep -E "error:" "$KEYS/build.log" | head -20; exit 1; }

echo "Pressing the chords"
TEST_RUNNER_MUXIFY_KEYS_DIR="$KEYS" xcodebuild test-without-building \
  -project "$PROJECT/AgentDeviceRunner.xcodeproj" -scheme AgentDeviceRunner \
  -destination "id=$MUXIFY_E2E_DEVICE" -derivedDataPath "$RUNNER/dd" \
  -only-testing AgentDeviceRunnerUITests/CommandKeysTests > "$KEYS/test.log" 2>&1 &
TEST=$!
answer "$TEST"
if wait "$TEST"; then
  [ ! -f "$KEYS/no-key-row" ] \
    || echo "NOT CHECKED: the Key Row half. The app reported a hardware keyboard and hid the row."
  echo "PASS: every chord that ran did what its Keyboard Shortcut or ghostty does"
else
  grep -E "error|failed|XCTAssert|Skipped" "$KEYS/test.log" | grep -v "^Test Suite" | head -20
  [ -f "$KEYS/screen.txt" ] && cp "$KEYS/screen.txt" "${TMPDIR:-/tmp}/muxify-command-keys-screen.txt" \
    && echo "The screen at the failure: ${TMPDIR:-/tmp}/muxify-command-keys-screen.txt"
  echo "FAIL: see the lines above"
  exit 1
fi
