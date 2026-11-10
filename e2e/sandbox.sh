#!/bin/bash
#
# Runs a command against a throwaway Muxify on this Mac, the dev Host, so that
# an e2e suite never touches the Topics, the config or the tmux server you work
# in.
#
#   bash e2e/sandbox.sh <command> [args...]
#
# A suite script runs itself through this with one line at its top:
#
#   [ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"
#
# Two paths reach the dev Host, and both land in the same sandbox:
#
# - The command itself, for seeding and checking: it gets MUXIFY_CONFIG,
#   XDG_STATE_HOME and TMUX_TMPDIR pointing into the sandbox, without TMUX and
#   TMUX_PANE, which would send tmux to your server.
# - The app, over SSH: a private sshd on a free port sets the same variables
#   with SetEnv. The app's saved Dev Host is pointed at that port for the run,
#   with no Fingerprint, no Recent Sessions and no Last Place, because the
#   sandbox is a Host the app has never seen.
#
# The app's `muxify` over SSH is a stub, first on the sshd's PATH. It gives
# every command to the real CLI except `browser`, which would talk to the
# Muxify app you work in. `browser tabs` prints $MUXIFY_E2E_ROOT/browser-tabs.json
# when a suite has written one, and else fails as the CLI does on a tmux server
# that Muxify does not show. Each `browser` call is a line of
# $MUXIFY_E2E_ROOT/browser-calls, for a suite to read.
#
# MUXIFY_CONFIG, not XDG_CONFIG_HOME: ~/.zshenv sets XDG_CONFIG_HOME, and the
# app's commands run through `$SHELL -c`, which reads it.
#
# The sandbox starts as a fresh Host: a Config with the Tags personal and work,
# and a tmux server with no tmux.conf and one Session, 0, running a bash whose
# prompt is `$ `. Suites address its Window as 0:0.0 and read that prompt back.
#
# When the command ends, also when it fails, the sandbox's tmux server and sshd
# are stopped, its folder is removed, and the app's records and settings files
# and the simulator's keyboard setting are put back. The command's exit status
# is this script's.

set -uo pipefail

APP=dev.muxify.app

ROOT=$(mktemp -d /tmp/muxify-e2e.XXXXXX) || exit 1
DOCUMENTS="$(xcrun simctl get_app_container "${MUXIFY_E2E_DEVICE:-booted}" "$APP" data)/Documents" || exit 1
RECORDS="$DOCUMENTS/muxify-records.json"
SETTINGS="$DOCUMENTS/muxify-settings.json"

# The app holds its records in memory and writes them back, so it must not run
# while the files are swapped under it.
stop_app() { xcrun simctl terminate "${MUXIFY_E2E_DEVICE:-booted}" "$APP" >/dev/null 2>&1; }

# iOS minimizes the software keyboard to a bar with no keys while it believes
# a hardware keyboard is attached, and the simulator attaches and detaches its
# virtual one on its own schedule. AutomaticMinimizationEnabled is the iOS
# setting behind that, so with it off every run gets the full keyboard that the
# suites press keys on, whatever the simulator has attached.
keyboard_minimization() {
  xcrun simctl spawn "${MUXIFY_E2E_DEVICE:-booted}" defaults "$1" com.apple.keyboard.preferences AutomaticMinimizationEnabled "${@:2}"
}

cleanup() {
  stop_app
  socket=$(TMUX_TMPDIR="$ROOT" env -u TMUX -u TMUX_PANE tmux display -p '#{socket_path}' 2>/dev/null)
  case "$socket" in
    "$ROOT"/*) TMUX_TMPDIR="$ROOT" env -u TMUX -u TMUX_PANE tmux kill-server >/dev/null 2>&1 ;;
  esac
  [ -f "$ROOT/sshd.pid" ] && kill "$(cat "$ROOT/sshd.pid")" 2>/dev/null
  for file in "$RECORDS" "$SETTINGS"; do
    [ -f "$ROOT/saved/${file##*/}" ] && cp "$ROOT/saved/${file##*/}" "$file"
  done
  case "$(cat "$ROOT/saved/keyboard-minimization" 2>/dev/null)" in
    1) keyboard_minimization write -bool true ;;
    0) keyboard_minimization write -bool false ;;
    unset) keyboard_minimization delete 2>/dev/null ;;
  esac
  rm -rf "$ROOT"
}
trap cleanup EXIT

PORT=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
mkdir -p "$ROOT/state" "$ROOT/saved"
ssh-keygen -q -t ed25519 -N '' -f "$ROOT/host_key" || exit 1

cat >"$ROOT/sshd_config" <<EOF
Port $PORT
ListenAddress 127.0.0.1
HostKey $ROOT/host_key
PidFile $ROOT/sshd.pid
UsePAM no
PasswordAuthentication no
KbdInteractiveAuthentication no
SetEnv MUXIFY_CONFIG=$ROOT/config.yaml XDG_STATE_HOME=$ROOT/state TMUX_TMPDIR=$ROOT PATH=$ROOT/bin:/usr/bin:/bin:/usr/sbin:/sbin
EOF

REAL_MUXIFY=$(command -v muxify) || { echo "muxify is not on the PATH"; exit 1; }
mkdir -p "$ROOT/bin"
cat >"$ROOT/bin/muxify" <<EOF
#!/bin/sh
if [ "\$1" = browser ]; then
  echo "\$*" >>"$ROOT/browser-calls"
  if [ "\$2" = tabs ] && [ -f "$ROOT/browser-tabs.json" ]; then
    cat "$ROOT/browser-tabs.json"
    exit 0
  fi
  echo "cannot reach Muxify: Muxify does not serve the Browser of this tmux server." >&2
  exit 1
fi
exec "$REAL_MUXIFY" "\$@"
EOF
chmod +x "$ROOT/bin/muxify"

/usr/sbin/sshd -f "$ROOT/sshd_config" -E "$ROOT/sshd.log" || { cat "$ROOT/sshd.log"; exit 1; }
for _ in $(seq 50); do
  nc -z 127.0.0.1 "$PORT" 2>/dev/null && break
  sleep 0.1
done
nc -z 127.0.0.1 "$PORT" 2>/dev/null || { echo "the sandbox sshd did not start"; cat "$ROOT/sshd.log"; exit 1; }

stop_app
cp "$RECORDS" "$SETTINGS" "$ROOT/saved/" || exit 1
{ keyboard_minimization read 2>/dev/null || echo unset; } >"$ROOT/saved/keyboard-minimization"
keyboard_minimization write -bool false || exit 1
python3 - "$RECORDS" "$PORT" <<'PY' || exit 1
import json, sys
path, port = sys.argv[1], int(sys.argv[2])
records = json.load(open(path))
dev = [h for h in records["hosts"] if h["address"] in ("127.0.0.1", "localhost")]
if not dev:
    sys.exit("no saved Host points at this Mac: run e2e/seed-dev-host.sh first")
ids = {h["id"] for h in dev}
for host in dev:
    host["port"] = port
records["fingerprints"] = [f for f in records["fingerprints"] if f["hostId"] not in ids]
records["recentSessions"] = [s for s in records["recentSessions"] if s["hostId"] not in ids]
if (records.get("lastPlace") or {}).get("hostId") in ids:
    del records["lastPlace"]
json.dump(records, open(path, "w"))
PY

sandboxed() {
  MUXIFY_E2E_ROOT="$ROOT" MUXIFY_CONFIG="$ROOT/config.yaml" XDG_STATE_HOME="$ROOT/state" TMUX_TMPDIR="$ROOT" \
    env -u TMUX -u TMUX_PANE "$@"
}

printf 'topics:\n  tags:\n    personal: {}\n    work: {}\n' >"$ROOT/config.yaml"
sandboxed tmux -f /dev/null new-session -d -s 0 -c "$ROOT" \
  "env PS1='\$ ' BASH_SILENCE_DEPRECATION_WARNING=1 bash --noprofile --norc" || exit 1

echo "sandbox: $ROOT, sshd on 127.0.0.1:$PORT"
sandboxed "$@"
