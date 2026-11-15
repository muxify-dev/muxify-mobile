#!/bin/bash
#
# Checks that a New Topic whose answer is lost makes one Topic and shows no
# error (ADR 0021), against a sandboxed Muxify on this Mac, the dev Host (see
# e2e/sandbox.sh). It checks two times: e2e/request-resend.test.ts drives the
# app's Connections and Host CLI caller over real SSH, and e2e/request-resend.ad
# drives the app in the Simulator. MUXIFY_E2E_NO_APP=1 leaves out the second,
# for a Simulator whose app is not built from this checkout.
#
# The Host CLI here is a wrapper around a `muxify` that takes `--request`. It
# runs the command and then, on the first send of each Request id, sleeps past
# the app's 8 second deadline, so the answer of that send is lost. A second
# send of the id, and each command with no id, such as a read, answers at
# once. If each send slept, the second send would also get no answer, and the
# app would be right to say that the Topic may be on the Host.
#
#   MUXIFY_REQUEST_CLI=/path/to/muxify bash e2e/request-resend.sh
#
# MUXIFY_REQUEST_CLI is a `muxify` whose `environment show --json` has the
# `request` capability. Build it outside its repository, for example from a
# copy of the CLI sources:
#
#   swift build --package-path <copy> --product muxify

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail

APP=dev.muxify.app
TITLE="e2e Request Topic"
CLI=${MUXIFY_REQUEST_CLI:?Set MUXIFY_REQUEST_CLI to a muxify that takes --request}
SETTINGS="$(xcrun simctl get_app_container "${MUXIFY_E2E_DEVICE:-booted}" "$APP" data)/Documents/muxify-settings.json"
CALLS="$MUXIFY_E2E_ROOT/request-calls"

"$CLI" environment show --json | python3 -c '
import json, sys
assert "request" in json.load(sys.stdin).get("capabilities", []), "MUXIFY_REQUEST_CLI has no request capability"
' || exit 1

mkdir -p "$MUXIFY_E2E_ROOT/sent"
: >"$CALLS"
cat >"$MUXIFY_E2E_ROOT/bin/muxify" <<EOF
#!/bin/sh
# As the sandbox's stub: a browser command would talk to the Muxify app you work in.
if [ "\$1" = browser ]; then
  echo "cannot reach Muxify: Muxify does not serve the Browser of this tmux server." >&2
  exit 1
fi
id=
previous=
for word in "\$@"; do
  [ "\$previous" = --request ] && id=\$word
  previous=\$word
done
"$CLI" "\$@"
status=\$?
if [ -n "\$id" ]; then
  echo "\$id \$*" >>"$CALLS"
  if [ ! -e "$MUXIFY_E2E_ROOT/sent/\$id" ]; then
    : >"$MUXIFY_E2E_ROOT/sent/\$id"
    sleep 12
  fi
fi
exit \$status
EOF

python3 - "$SETTINGS" <<'PY'
import json, sys
settings = json.load(open(sys.argv[1]))
settings.pop("hostListPreferences", None)
settings["hostScreenLists"] = ["topics", "sessions"]
json.dump(settings, open(sys.argv[1], "w"))
PY

# The sandbox's sshd takes the keys of your account, which the app has and
# this script does not. So the jest check gets an sshd of its own, with the
# sandbox's environment and a key that lives in the sandbox.
ROOT=$MUXIFY_E2E_ROOT
ssh-keygen -q -t ed25519 -N '' -f "$ROOT/client_key" || exit 1
cp "$ROOT/client_key.pub" "$ROOT/authorized_keys"
SSH_PORT=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
sed -e "s/^Port .*/Port $SSH_PORT/" -e "s|^PidFile .*|PidFile $ROOT/sshd-jest.pid|" "$ROOT/sshd_config" >"$ROOT/sshd_jest_config"
printf 'AuthorizedKeysFile %s\nStrictModes no\n' "$ROOT/authorized_keys" >>"$ROOT/sshd_jest_config"
/usr/sbin/sshd -f "$ROOT/sshd_jest_config" -E "$ROOT/sshd-jest.log" || { cat "$ROOT/sshd-jest.log"; exit 1; }
trap '[ -f "$ROOT/sshd-jest.pid" ] && kill "$(cat "$ROOT/sshd-jest.pid")" 2>/dev/null' EXIT
for _ in $(seq 50); do
  nc -z 127.0.0.1 "$SSH_PORT" 2>/dev/null && break
  sleep 0.1
done

MUXIFY_E2E_SSH_PORT=$SSH_PORT pnpm exec jest --testPathIgnorePatterns /node_modules/ --runTestsByPath e2e/request-resend.test.ts || exit 1

if [ -n "${MUXIFY_E2E_NO_APP:-}" ]; then
  echo "left out the Simulator check"
  exit 0
fi

device=()
[ -z "${MUXIFY_E2E_DEVICE:-}" ] || device=(--udid "$MUXIFY_E2E_DEVICE")
agent-device test ./e2e/request-resend.ad "${device[@]}" || exit 1

"$CLI" environment show --json | python3 -c '
import json, sys
title, calls = sys.argv[1], [line.split() for line in open(sys.argv[2])]
snapshot = json.load(sys.stdin)
cards = snapshot["pinned"] + [card for part in ("places", "guests", "bench") for card in snapshot["unpinned"][part]]
made = [card["topic"] for card in cards if card["kind"] == "topic" and card["topic"]["label"].startswith(title)]
labels = [topic["label"] for topic in made]
assert labels == [title], f"the Host has {labels}"
sends = [call for call in calls if call[3:5] == ["topic", "new"]]
assert len(sends) == 2, f"topic new went out {len(sends)} times"
assert sends[0][0] == sends[1][0] == made[0]["id"], "the two sends and the Topic do not share one id"
print("the Host has one Topic, from two sends of one Request")
' "$TITLE" "$CALLS"
