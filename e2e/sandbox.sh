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
#   with no Fingerprint, no Recent Sessions, no Last Place and no Places,
#   because the sandbox is a Host the app has never seen. Its Host Screen
#   starts on the Sessions tab, where Session 0 is. A suite about Topic cards
#   takes hostScreenTabs out of the settings, which gives the Board tab.
#   The sshd takes the keys in your ~/.ssh/authorized_keys. With
#   MUXIFY_E2E_AUTHORIZED_KEY, the path of a public key such as the one of
#   the app's Dev Host identity, it takes that key too, and the identity logs
#   in as you for the run.
#
# The app's `muxify` over SSH is a stub, first on the sshd's PATH and on the
# command's. It gives every command to the real CLI except `browser`, which would talk to the
# Muxify app you work in: it fails as the CLI does on a tmux server that
# Muxify does not show. Each `browser` call is a line of
# $MUXIFY_E2E_ROOT/browser-calls, for a suite to read. While
# $MUXIFY_E2E_ROOT/no-host-server exists, `server` fails as on a CLI that has
# no Host Server, so a Connection opened after that shows Sessions only.
#
# A Window's Browser Tabs are the ones desktop Muxify stores in the Window's
# tmux options, @muxify_tabs and @muxify_active_tab, which the real
# `muxify server` answers `browser_tabs` from. A suite stores them with
#
#   stored-tabs <window> <active tab's index> <url>...
#
# which is also first on the command's PATH. `stored-tabs <window>` with no
# Tabs removes them, as for a Window whose Browser has none.
#
# The real CLI is the Host CLI that `(cd ../muxify-shell && make host-cli)`
# builds, whose Host Server offers every capability the app uses, or
# MUXIFY_E2E_MUXIFY when set. With neither, it is the `muxify` on your PATH,
# and the app may find its Host Server too old and show Sessions only.
#
# The sshd also sets XDG_CONFIG_HOME to an empty folder, so that your login
# shell's own config does not put another `muxify` ahead of the stub on the
# app's PATH. Its PATH has tmux's folder after the stub's, and LC_CTYPE is
# UTF-8, which a tmux client needs.
#
# MUXIFY_CONFIG, not XDG_CONFIG_HOME: ~/.zshenv sets XDG_CONFIG_HOME, and the
# app's commands run through `$SHELL -c`, which reads it.
#
# The sandbox starts as a fresh Host: a Config with the Tags personal and work,
# and a tmux server with no tmux.conf and one Session, 0, running a bash whose
# prompt is `$ `. Suites address its Window as 0:0.0 and read that prompt back.
#
# The suites drive the app with agent-device 0.21 or newer: an older one has no
# --settle, no role= selectors and no long-press by selector.
#
# When the command ends, also when it fails, the sandbox's tmux server and sshd
# are stopped, its folder is removed, and the app's records and settings files
# and the simulator's keyboard setting are put back. The command's exit status
# is this script's.

set -uo pipefail

APP=dev.muxify.app

# The physical path, because tmux reports its socket under /private/tmp on
# macOS, and cleanup kills only a server whose socket is inside ROOT.
ROOT=$(cd "$(mktemp -d /tmp/muxify-e2e.XXXXXX)" && pwd -P) || exit 1
DOCUMENTS="$(xcrun simctl get_app_container "${MUXIFY_E2E_DEVICE:-booted}" "$APP" data)/Documents" || exit 1
RECORDS="$DOCUMENTS/muxify-records.json"
SETTINGS="$DOCUMENTS/muxify-settings.json"
GO_TO_CACHES=(muxify-go-to.json muxify-go-to-sections.json)

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
  for name in "${GO_TO_CACHES[@]}"; do
    if [ -f "$ROOT/saved/$name" ]; then
      mv -f "$ROOT/saved/$name" "$DOCUMENTS/$name"
    elif [ -f "$ROOT/saved/$name.absent" ]; then
      rm -f "$DOCUMENTS/$name"
    fi
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
if [ -n "${MUXIFY_E2E_AUTHORIZED_KEY:-}" ]; then
  cp "$MUXIFY_E2E_AUTHORIZED_KEY" "$ROOT/authorized_keys" || exit 1
  chmod 600 "$ROOT/authorized_keys"
fi

cat >"$ROOT/sshd_config" <<EOF
Port $PORT
ListenAddress 127.0.0.1
HostKey $ROOT/host_key
PidFile $ROOT/sshd.pid
UsePAM no
PasswordAuthentication no
KbdInteractiveAuthentication no
AuthorizedKeysFile .ssh/authorized_keys $ROOT/authorized_keys
# The sandbox's own key file is under /tmp, which StrictModes refuses.
StrictModes no
SetEnv MUXIFY_CONFIG=$ROOT/config.yaml XDG_STATE_HOME=$ROOT/state XDG_CONFIG_HOME=$ROOT/xdg-config LC_CTYPE=en_US.UTF-8 TMUX_TMPDIR=$ROOT PATH=$ROOT/bin:$(dirname "$(command -v tmux)"):/usr/bin:/bin:/usr/sbin:/sbin
EOF

BUILT_MUXIFY="$(cd "$(dirname "$0")/../.." && pwd)/muxify-shell/build/host-cli/muxify-darwin-$(uname -m)"
if [ -n "${MUXIFY_E2E_MUXIFY:-}" ]; then
  REAL_MUXIFY=$MUXIFY_E2E_MUXIFY
elif [ -x "$BUILT_MUXIFY" ]; then
  REAL_MUXIFY=$BUILT_MUXIFY
else
  REAL_MUXIFY=$(command -v muxify) || { echo "muxify is not on the PATH"; exit 1; }
fi
echo "sandbox: muxify is $REAL_MUXIFY"
mkdir -p "$ROOT/bin"
cat >"$ROOT/bin/muxify" <<EOF
#!/bin/sh
if [ "\$1" = server ] && [ -f "$ROOT/no-host-server" ]; then
  echo "muxify: unknown command \"server\"" >&2
  exit 2
fi
if [ "\$1" = browser ]; then
  echo "\$*" >>"$ROOT/browser-calls"
  echo "cannot reach Muxify: Muxify does not serve the Browser of this tmux server." >&2
  exit 1
fi
exec "$REAL_MUXIFY" "\$@"
EOF
chmod +x "$ROOT/bin/muxify"
cat >"$ROOT/bin/stored-tabs" <<'EOF'
#!/bin/sh
# stored-tabs <window> [<active tab's index> <url>...]: the Tabs desktop Muxify stores for a Window.
window=$1
shift
if [ $# -eq 0 ]; then
  exec tmux set-option -wqu -t "$window" @muxify_tabs \; set-option -wqu -t "$window" @muxify_active_tab
fi
active=$1
shift
exec tmux set-option -wq -t "$window" @muxify_tabs "$*" \; set-option -wq -t "$window" @muxify_active_tab "$active"
EOF
chmod +x "$ROOT/bin/stored-tabs"

/usr/sbin/sshd -f "$ROOT/sshd_config" -E "$ROOT/sshd.log" || { cat "$ROOT/sshd.log"; exit 1; }
for _ in $(seq 50); do
  nc -z 127.0.0.1 "$PORT" 2>/dev/null && break
  sleep 0.1
done
nc -z 127.0.0.1 "$PORT" 2>/dev/null || { echo "the sandbox sshd did not start"; cat "$ROOT/sshd.log"; exit 1; }

stop_app
cp "$RECORDS" "$SETTINGS" "$ROOT/saved/" || exit 1
# The saved Dev Host and the sandbox use the same Host id. Give the sandbox
# empty Go to caches, then return both caches to their state before the run.
for name in "${GO_TO_CACHES[@]}"; do
  if [ -f "$DOCUMENTS/$name" ]; then
    mv "$DOCUMENTS/$name" "$ROOT/saved/$name" || exit 1
  else
    touch "$ROOT/saved/$name.absent" || exit 1
  fi
done
{ keyboard_minimization read 2>/dev/null || echo unset; } >"$ROOT/saved/keyboard-minimization"
keyboard_minimization write -bool false || exit 1
python3 - "$RECORDS" "$PORT" "$SETTINGS" "${MUXIFY_E2E_AUTHORIZED_KEY:+$(id -un)}" <<'PY' || exit 1
import json, sys
path, port, settings_path, user = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
records = json.load(open(path))
dev = [h for h in records["hosts"] if h["address"] in ("127.0.0.1", "localhost")]
if not dev:
    sys.exit("no saved Host points at this Mac: run e2e/seed-dev-host.sh first")
ids = {h["id"] for h in dev}
for host in dev:
    host["port"] = port
if user:
    identities = {h["identityId"] for h in dev}
    for identity in records.get("identities", []):
        if identity["id"] in identities:
            identity["username"] = user
records["fingerprints"] = [f for f in records["fingerprints"] if f["hostId"] not in ids]
records["recentSessions"] = [s for s in records["recentSessions"] if s["hostId"] not in ids]
if (records.get("lastPlace") or {}).get("hostId") in ids:
    del records["lastPlace"]
# topicPlaces is the name a build before Session Places gave them.
for key in ("places", "topicPlaces"):
    if key in records:
        records[key] = [p for p in records[key] if p.get("hostId") not in ids]
json.dump(records, open(path, "w"))
settings = json.load(open(settings_path))
settings["hostScreenTabs"] = {**settings.get("hostScreenTabs", {}), **{host: "sessions" for host in ids}}
json.dump(settings, open(settings_path, "w"))
PY

sandboxed() {
  MUXIFY_E2E_ROOT="$ROOT" MUXIFY_CONFIG="$ROOT/config.yaml" XDG_STATE_HOME="$ROOT/state" TMUX_TMPDIR="$ROOT" \
    PATH="$ROOT/bin:$PATH" env -u TMUX -u TMUX_PANE "$@"
}

printf 'topics:\n  tags:\n    personal: {}\n    work: {}\n' >"$ROOT/config.yaml"
sandboxed tmux -f /dev/null new-session -d -s 0 -c "$ROOT" \
  "env PS1='\$ ' BASH_SILENCE_DEPRECATION_WARNING=1 bash --noprofile --norc" || exit 1

echo "sandbox: $ROOT, sshd on 127.0.0.1:$PORT"
sandboxed "$@"
