#!/bin/bash
#
# Full input/output round trip through a real Session (tickets 04 and 05).
#
#   type "ls" and press Enter on the device -> SSH -> tmux -> bash -> bytes
#   back -> rendered
#
# Why this is a shell script rather than an .ad suite: the Surface renders with
# Metal, so tmux's output never reaches the accessibility tree and no selector
# can assert on it. Reading the pane over SSH is the only way to check what was
# actually drawn. The .ad suites cover everything that IS visible to selectors.
#
# Enter is pressed on the device, like everything else here. That was not
# always possible: every keystroke arrives from iOS as a bracketed paste, Enter
# included, so the shell inserted a newline and ran nothing. See toShellInput.
#
# Requires a configured .env.local and a booted simulator running the app.
# Usage:  bash e2e/ls-round-trip.sh

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail

APP=dev.muxify.app
DIR=muxify-e2e
MARKER=PROOF_ls_WORKS.txt

# Runs a command on the dev Host, which is this Mac, in the sandbox.
on_host() { sh -c "$*" 2>/dev/null; }

fail() { echo "FAIL: $1"; exit 1; }

echo "1/5  seeding the Session with a directory containing only $MARKER"
on_host "mkdir -p '$MUXIFY_E2E_ROOT/$DIR'; touch '$MUXIFY_E2E_ROOT/$DIR/$MARKER'; \
    tmux send-keys -t 0 C-c; tmux send-keys -t 0 'cd \"$MUXIFY_E2E_ROOT/$DIR\"; clear' Enter" \
  || fail "could not reach the dev Host"
sleep 2

echo "2/5  opening the app and attaching"
agent-device close >/dev/null 2>&1
agent-device open "$APP" --platform ios --relaunch >/dev/null 2>&1 || fail "could not open the app"
agent-device wait text "Dev Host" 25000 >/dev/null 2>&1
agent-device press 'label="All of Dev Host"' >/dev/null 2>&1
agent-device wait 'label="Edit Host"' 15000 >/dev/null 2>&1
agent-device wait 1500 >/dev/null 2>&1  # Home is under the Host Screen until the push settles
agent-device wait 'label="Session 0"' 15000 >/dev/null 2>&1
agent-device press 'label="Session 0"' >/dev/null 2>&1
agent-device wait 10000 >/dev/null 2>&1
agent-device is text 'id="connection-status"' "Connected" >/dev/null 2>&1 \
  || fail "never reached Connected"

echo "3/5  raising the keyboard from the Dock"
KB=$(agent-device snapshot -i 2>/dev/null | grep -E '^@e[0-9]+ \[button\] "Keyboard"' | head -1 | awk '{print $1}')
[ -n "$KB" ] || fail "no Keyboard button in the Dock"
agent-device press "$KB" >/dev/null 2>&1
sleep 4
LETTERS=$(agent-device snapshot -i 2>/dev/null | grep -cE '\[key\] "[a-z]"')
[ "$LETTERS" -ge 20 ] || fail "software keyboard did not appear (letter keys=$LETTERS). \
Run it through e2e/sandbox.sh, which keeps iOS from minimizing the keyboard."

echo "4/5  typing 'ls' on the device"
agent-device type "ls" >/dev/null 2>&1
sleep 2
# Wrap-tolerant on purpose. This used to require `$ ls` at the end of a line,
# which assumed the prompt and the command shared a rendered row — and they do
# not: the prompt is `evgeny@ubuntu:~/muxify-e2e$ `, 28 columns, in a Pane 27
# wide, so it wraps and the `ls` lands at the start of the next row. The check
# then failed while saying the characters never arrived, which was false and
# sent more than one reader hunting for an input bug that was not there.
# (Verified against the pre-control-mode commit: it failed there too.)
#
# What is actually being asserted is that the shell has `ls` on its input line,
# so the rows are joined before looking.
on_host "tmux capture-pane -t 0 -p -J" | tr -d '\n' | grep -q '\$ ls' \
  || fail "characters typed on the device did not reach the remote shell"

echo "5/5  submitting on the device, then checking what the Session rendered"
agent-device type "
" >/dev/null 2>&1
sleep 3
PANE=$(on_host "tmux capture-pane -t 0 -p -J")

echo "$PANE" | grep -q "$MARKER" || fail "command produced no output in the Session"
echo "$PANE" | grep -qE '\$ *$' || fail "shell did not return to a prompt"

echo
echo "$PANE" | grep -n . | head -4
echo
echo "PASS: typed on the device, executed on the Host, rendered back in the Surface."
