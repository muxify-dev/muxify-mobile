# Checks for a Place's page opened with no Attach up, sourced by
# e2e/session-place.sh and e2e/topic-place.sh. The suite runs through
# e2e/sandbox.sh and sets ROOT (the sandbox's run directory), DATA (the app's
# Documents folder) and fail.
#
# slow_link points the Dev Host at e2e/slow-relay.py, which holds the start of
# every new Connection for MUXIFY_E2E_SLOW_LINK_SECONDS (2 by default). A
# cold start's visit then lasts longer than a Terminal Screen needs to lay out
# its ruler and report a grid, so a Terminal Screen mounted under the page would
# size the Mac's Window, and the Window-size check sees it. Call it while the
# app is stopped: the app writes its records back from memory. The relay runs
# in the run directory, and stops with the suite's EXIT trap (kill $RELAY) or,
# at the latest, when the sandbox removes the run directory.
#
# page_first reads the app's own log of the current launch: the page was
# shown, and no Terminal Screen opened, no Surface reported a grid and no
# size went to tmux. It is for a step where the Terminal Screen is never shown.

RELAY=

slow_link() {
  local sshd_port
  sshd_port=$(awk '$1 == "Port" { print $2 }' "$ROOT/sshd_config")
  [ -n "$sshd_port" ] || fail "the sandbox's sshd port is not in $ROOT/sshd_config"
  if [ ! -f "$ROOT/relay.port" ]; then
    python3 "$(dirname "${BASH_SOURCE[0]}")/slow-relay.py" "$ROOT" "$sshd_port" "${MUXIFY_E2E_SLOW_LINK_SECONDS:-2}" \
      >>"$ROOT/relay.log" 2>&1 &
    RELAY=$!
    for _ in $(seq 50); do [ -f "$ROOT/relay.port" ] && break; sleep 0.1; done
    [ -f "$ROOT/relay.port" ] || fail "the slow relay did not start"
  fi
  python3 - "$DATA/muxify-records.json" "$sshd_port" "$(cat "$ROOT/relay.port")" <<'PY' || fail "could not point the Dev Host at the slow relay"
import json, sys
path, sshd_port, relay_port = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
records = json.load(open(path))
dev = [h for h in records["hosts"] if h["address"] in ("127.0.0.1", "localhost") and h["port"] in (sshd_port, relay_port)]
assert dev, "no saved Host points at the sandbox's sshd"
for host in dev:
    host["port"] = relay_port
json.dump(records, open(path, "w"))
PY
}

page_first() {
  python3 - "$DATA/muxify-logs" <<'PY' || fail "$1"
import json, os, re, sys
folder = sys.argv[1]
names = [name for name in os.listdir(folder) if re.match(r"^\d+-[a-z0-9]+\.\d+\.jsonl$", name)]
assert names, f"no log in {folder}"
launch = max({name.split(".")[0] for name in names}, key=lambda launch: int(launch.split("-")[0]))
segments = sorted((name for name in names if name.startswith(launch + ".")), key=lambda name: int(name.split(".")[1]))
entries = []
for name in segments:
    for line in open(os.path.join(folder, name)):
        record = json.loads(line)
        if record.get("kind") == "entry":
            entries.append(record)
start = entries[0]["at"] if entries else 0
wrong = {
    "a Terminal Screen opened": lambda tag, text: tag == "screen" and text.startswith("opened for"),
    "a Surface reported a grid": lambda tag, text: tag == "screen" and text.startswith("the ruler reported"),
    "the Client asked for a size": lambda tag, text: tag == "sizing" and text.startswith("asking for"),
    "a size went to tmux": lambda tag, text: tag == "control" and text.startswith("→") and "refresh-client -C" in text,
}
found = [(why, entry) for entry in entries for why, test in wrong.items() if test(entry["tag"], entry["text"])]
for why, entry in found:
    print(f"     {why}: +{entry['at'] - start} ms {entry['tag']}: {entry['text']}")
shown = [entry for entry in entries if entry["tag"] == "attach" and entry["text"].startswith("the Web View shows")]
if not shown:
    print("     the log of this launch never says 'the Web View shows'")
sys.exit(1 if found or not shown else 0)
PY
}

# The number of Connections the slow relay has taken: one line each in relay.log.
relayed() { cat "$ROOT/relay.log" 2>/dev/null | grep -c '^relayed'; }
