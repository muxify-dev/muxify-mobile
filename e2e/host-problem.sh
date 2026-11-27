#!/bin/bash
#
# One fault, one Try again: a Host that the phone cannot reach is one Host
# Problem, and each screen shows it once. Runs against a sandboxed Muxify on
# this Mac (see e2e/sandbox.sh).
#
#   1  Host Screen: with the sandbox sshd stopped, Dev Host shows
#      "Could not reach Dev Host" with one Try again and no Retry. With the
#      sshd back on the same port, Try again shows Session 0. The link is
#      slow (e2e/slow-launch.sh), so the row says "Trying again…", with the
#      reason and the button off, before the Host answers.
#   2  Terminal Screen: with the sshd and its connections stopped, Session 0
#      shows the Cover card. The Title Sheet then has at most one Try again,
#      and no screen shows Retry.
#
#   bash e2e/host-problem.sh

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail

APP=dev.muxify.app
device=()
[ -z "${MUXIFY_E2E_DEVICE:-}" ] || device=(--udid "$MUXIFY_E2E_DEVICE")
ad() { agent-device "$@" "${device[@]}"; }

fail() { echo "FAIL: $1"; ad screenshot /tmp/muxify-host-problem-fail.png >/dev/null 2>&1; exit 1; }

ROOT=$MUXIFY_E2E_ROOT
. "$(dirname "$0")/slow-launch.sh"
trap '[ -n "$RELAY" ] && kill $RELAY 2>/dev/null' EXIT

# The button lines of the screen, as agent-device reads them.
buttons() { ad snapshot 2>/dev/null | grep '\[button\]'; }
count() { grep -c "\"$1\"" <<<"$2"; }

# Stops the sandbox sshd and every process under it, so open SSH sessions end
# too. The PIDs come from the sshd's own PidFile, never from a name match.
descendants() {
  local child
  for child in $(pgrep -P "$1"); do
    echo "$child"
    descendants "$child"
  done
}
stop_sshd() {
  local pid
  pid=$(cat "$MUXIFY_E2E_ROOT/sshd.pid") || fail "no sshd.pid in the sandbox"
  kill $(descendants "$pid") "$pid" 2>/dev/null
  for _ in $(seq 50); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.1
  done
  port=$(awk '/^Port /{print $2}' "$MUXIFY_E2E_ROOT/sshd_config")
  ! nc -z 127.0.0.1 "$port" 2>/dev/null || fail "the sandbox sshd still answers on $port"
}
start_sshd() {
  /usr/sbin/sshd -f "$MUXIFY_E2E_ROOT/sshd_config" -E "$MUXIFY_E2E_ROOT/sshd.log" || fail "the sandbox sshd did not start again"
  for _ in $(seq 50); do
    nc -z 127.0.0.1 "$port" 2>/dev/null && return
    sleep 0.1
  done
  fail "the sandbox sshd does not answer on $port"
}

echo "1/2  Host Screen with Dev Host unreachable"
DATA=$(xcrun simctl get_app_container "${MUXIFY_E2E_DEVICE:-booted}" "$APP" data)/Documents
ad close >/dev/null 2>&1
xcrun simctl terminate "${MUXIFY_E2E_DEVICE:-booted}" "$APP" >/dev/null 2>&1
# Each new Connection waits 4 s for the sshd's banner, so Try again takes that long.
MUXIFY_E2E_SLOW_LINK_SECONDS=4 slow_link
stop_sshd
ad open "$APP" --platform ios --relaunch >/dev/null 2>&1
ad wait 'label="Host Dev Host"' 25000 >/dev/null 2>&1 || fail "Home never showed Dev Host"
ad press 'label="Host Dev Host"' >/dev/null 2>&1
ad wait 'label="Host Options"' 15000 >/dev/null 2>&1 || fail "the Host Screen never opened"
ad wait 'label="Try again"' 20000 >/dev/null 2>&1 || fail "the Host Screen never offered Try again"
ad wait 3000 >/dev/null 2>&1
snap=$(ad snapshot 2>/dev/null)
echo "$snap" | grep -E 'Could not reach|\[button\]' | sed 's/^/     /'
grep -q 'Could not reach Dev Host' <<<"$snap" || fail "no 'Could not reach Dev Host' on the Host Screen"
on_screen=$(grep '\[button\]' <<<"$snap")
[ "$(count 'Try again' "$on_screen")" = 1 ] || fail "the Host Screen has $(count 'Try again' "$on_screen") Try again buttons"
[ "$(count Retry "$on_screen")" = 0 ] || fail "the Host Screen has a Retry button"
echo "ok: one Host Problem row with one Try again, no Retry"

start_sshd
ad press 'label="Try again"' >/dev/null 2>&1
snap=$(ad snapshot 2>/dev/null)
grep -q 'Trying again' <<<"$snap" || fail "the row did not say Trying again after the tap"
grep -q 'Could not reach Dev Host' <<<"$snap" || fail "the reason went while Try again runs"
grep -q '"Try again, in progress"' <<<"$snap" || fail "the Try again button is not off while it runs"
echo "ok: the row says Trying again at once, keeps the reason, and turns the button off"
ad wait 'label="Session 0"' 20000 >/dev/null 2>&1 || fail "Try again did not bring back Session 0"
ad is absent 'label="Try again"' >/dev/null 2>&1 || fail "Try again stayed after the Host answered"
echo "ok: Try again reads the Host again and shows Session 0"

echo "2/2  Terminal Screen and Title Sheet after the link drops"
ad press 'label="Session 0"' >/dev/null 2>&1
ad wait 'id="pane-command"' 20000 >/dev/null 2>&1 || fail "Session 0 never attached"
stop_sshd
ad wait 'id="cover-card"' 30000 >/dev/null 2>&1 || fail "no Cover card after the link dropped"
ad wait 3000 >/dev/null 2>&1
snap=$(ad snapshot 2>/dev/null)
echo "$snap" | grep -E 'Connection lost|Could not reach|\[button\]' | sed 's/^/     /'
[ "$(count Retry "$(grep '\[button\]' <<<"$snap")")" = 0 ] || fail "the Terminal Screen has a Retry button"
echo "ok: the Cover card shows, no Retry"

ad press 'id="header-title"' >/dev/null 2>&1
ad wait 'label="Close Choose"' 8000 >/dev/null 2>&1 || fail "the Title Sheet never opened"
ad wait 3000 >/dev/null 2>&1
snap=$(ad snapshot 2>/dev/null)
echo "$snap" | grep -E 'Connection lost|Could not reach|\[button\]' | sed 's/^/     /'
on_screen=$(grep '\[button\]' <<<"$snap")
[ "$(count 'Try again' "$on_screen")" -le 1 ] || fail "the Title Sheet has $(count 'Try again' "$on_screen") Try again buttons"
[ "$(count Retry "$on_screen")" = 0 ] || fail "the Title Sheet has a Retry button"
echo "ok: the Title Sheet has at most one Try again, no Retry"

ad close >/dev/null 2>&1
echo "PASS: one Host Problem, one Try again on each screen"
