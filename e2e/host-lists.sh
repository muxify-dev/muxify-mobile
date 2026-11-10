#!/bin/bash
[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"
set -euo pipefail
DOCUMENTS="$(xcrun simctl get_app_container "${MUXIFY_E2E_DEVICE:-booted}" dev.muxify.app data)/Documents"
python3 - "$DOCUMENTS" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1])
records = json.loads((root / 'muxify-records.json').read_text())
dev = next(host for host in records['hosts'] if host['displayName'] == 'Dev Host')
records['hosts'] = [dev, {**dev, 'id': 'e2e-second', 'displayName': 'Second Host'}]
(root / 'muxify-records.json').write_text(json.dumps(records))
settings = json.loads((root / 'muxify-settings.json').read_text())
settings.pop('hostListPreferences', None)
settings['hostScreenLists'] = ['sessions']
(root / 'muxify-settings.json').write_text(json.dumps(settings))
PY
device=()
[ -z "${MUXIFY_E2E_DEVICE:-}" ] || device=(--udid "$MUXIFY_E2E_DEVICE")
topic_switch() {
  agent-device snapshot --json > "$MUXIFY_E2E_ROOT/host-lists-tree.json"
  python3 - "$MUXIFY_E2E_ROOT/host-lists-tree.json" "${1:-false}" <<'PY_SWITCH'
import json, sys
nodes = json.load(open(sys.argv[1]))['data']['nodes']
row = next(node for node in nodes if node.get('label') == 'Topics' and node.get('kind') == 'switch')
assert row.get('checked') is (sys.argv[2] == 'true'), row
control = next(node for node in nodes if node.get('parentIndex') == row['index'] and node.get('role') == 'UISwitch')
print('@' + control['ref'])
PY_SWITCH
}
agent-device open dev.muxify.app --platform ios --relaunch "${device[@]}"
agent-device wait 'label="Host Dev Host"' 15000
agent-device press 'label="Host Dev Host"' --settle
agent-device wait 'label="Host Screen lists"' 8000
agent-device press 'label="Host Screen lists"' --settle
agent-device wait 'label="Topics"' 8000
control=$(topic_switch)
agent-device press "$control" --settle
control=$(topic_switch true)
agent-device back --settle
agent-device wait 'label="New Session or Topic"' 8000
agent-device back --settle
agent-device wait 'label="Host Second Host"' 8000
agent-device press 'label="Host Second Host"' --settle
agent-device wait 'label="New Session"' 8000
agent-device press 'label="Host Screen lists"' --settle
agent-device wait 'label="Topics"' 8000
control=$(topic_switch)
echo "Topics remains off on Second Host."
agent-device close
agent-device open dev.muxify.app --platform ios --relaunch "${device[@]}"
agent-device wait 'label="Host Dev Host"' 15000
agent-device press 'label="Host Dev Host"' --settle
agent-device wait 'label="New Session or Topic"' 8000
agent-device close
python3 - "$DOCUMENTS" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1])
records = json.loads((root / 'muxify-records.json').read_text())
dev = next(host for host in records['hosts'] if host['displayName'] == 'Dev Host')
prefs = json.loads((root / 'muxify-settings.json').read_text())['hostListPreferences']['byHost']
assert prefs[dev['id']] == ['sessions', 'topics'], prefs
assert prefs['e2e-second'] == ['sessions'], prefs
print('Host choices remain independent after relaunch.')
PY
