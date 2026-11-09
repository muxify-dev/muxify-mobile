#!/bin/bash
#
# Home with three Hosts, and the Host order in Settings, against a sandboxed
# Muxify on this Mac (see e2e/sandbox.sh). Besides the dev Host, it saves a
# Second Host that reaches the same sandbox, and a Down Host on a closed port.
#
# Proves, on the simulator: Home has a section for each Host in the order of
# the records; the Down Host shows its reason and Retry while the other
# sections still read; a drag in Settings → Hosts changes the order in the
# records and on Home; a long press on a Host offers Copy log; ＋ Add opens the
# Host form.
#
#   bash e2e/hosts.sh

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail

APP=dev.muxify.app
RECORDS="$(xcrun simctl get_app_container booted "$APP" data)/Documents/muxify-records.json"

fail() { echo "FAIL: $1"; exit 1; }

# The Host names in the order the records hold them.
saved_order() {
  python3 -c 'import json, sys; print(" ".join(h["displayName"] for h in json.load(open(sys.argv[1]))["hosts"]))' "$RECORDS"
}

# The Host names in the order Home draws them, top to bottom, by where each
# one's All button is. A snapshot leaves the first section's name out, so the
# buttons are asked for one by one.
home_order() {
  for name in "Dev Host" "Second Host" "Down Host"; do
    y=$(agent-device get attrs "label=\"All of $name\"" 2>/dev/null | python3 -c 'import json, sys; print(json.load(sys.stdin)["rect"]["y"])')
    echo "$y $name"
  done | sort -n | cut -d' ' -f2- | paste -sd, - | sed 's/,/, /g'
}

open_settings() {
  agent-device press 'role=button label="Settings"' >/dev/null 2>&1
  agent-device wait 'label="Add Host"' 8000 >/dev/null 2>&1 || fail "Settings did not open"
  agent-device wait 1500 >/dev/null 2>&1
}

xcrun simctl terminate booted "$APP" >/dev/null 2>&1
python3 - "$RECORDS" <<'PY' || exit 1
import json, sys
path = sys.argv[1]
records = json.load(open(path))
dev = records["hosts"][0]
records["hosts"] = [dev] + [
    {**dev, "id": "e2e-second", "displayName": "Second Host"},
    {**dev, "id": "e2e-down", "displayName": "Down Host", "port": 9},
]
json.dump(records, open(path, "w"))
PY

agent-device close >/dev/null 2>&1
agent-device open "$APP" --platform ios --relaunch >/dev/null 2>&1
agent-device wait text "Down Host" 25000 >/dev/null 2>&1
agent-device wait 'label="Retry"' 25000 >/dev/null 2>&1

[ "$(home_order)" = "Dev Host, Second Host, Down Host" ] || fail "Home order is '$(home_order)'"
agent-device is visible 'label="Retry"' >/dev/null 2>&1 || fail "the Down Host has no Retry"
agent-device snapshot -i | grep -q '"Unreachable"' || fail "the Down Host has no red dot"
agent-device wait 'label="Session 0"' 15000 >/dev/null 2>&1 || fail "the other Hosts did not read"
echo "ok: Home shows the Hosts in order, the Down Host refused, the others read"

open_settings

# The first Host's handle, dragged onto the last one's. A drag that the list
# did not take up is tried again: the first one can land while the list is
# still settling after it opened.
for _ in 1 2 3; do
  snap=$(agent-device snapshot -i)
  first=$(echo "$snap" | grep '\[button\] "Reorder' | sed -n 1p | grep -o '@e[0-9]*')
  last=$(echo "$snap" | grep '\[button\] "Reorder' | sed -n 3p | grep -o '@e[0-9]*')
  [ -n "$first" ] && [ -n "$last" ] || fail "no drag handles in Settings → Hosts"
  agent-device gesture drag "$first" "$last" 200 1500 300 >/dev/null 2>&1
  agent-device wait 1000 >/dev/null 2>&1
  [ "$(saved_order)" != "Dev Host Second Host Down Host" ] && break
done
[ "$(saved_order)" = "Second Host Down Host Dev Host" ] || fail "the records order is '$(saved_order)'"
echo "ok: the drag wrote the order to the records"

agent-device longpress 'label="Second Host"' >/dev/null 2>&1
agent-device wait 'label="Copy log"' 5000 >/dev/null 2>&1 || fail "no Copy log on a long press"
echo "ok: a long press offers Copy log"
agent-device close >/dev/null 2>&1

agent-device open "$APP" --platform ios --relaunch >/dev/null 2>&1
agent-device wait text "Down Host" 25000 >/dev/null 2>&1
agent-device wait 'label="Retry"' 25000 >/dev/null 2>&1
[ "$(home_order)" = "Second Host, Down Host, Dev Host" ] || fail "Home order after the drag is '$(home_order)'"
echo "ok: Home follows the new order"

open_settings
agent-device press 'label="Add Host"' >/dev/null 2>&1
agent-device wait text "New Host" 8000 >/dev/null 2>&1 || fail "＋ Add did not open the Host form"
echo "ok: ＋ Add opens the Host form"
agent-device close >/dev/null 2>&1
