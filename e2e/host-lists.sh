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
# The ref of a row's reorder handle or delete control, found beside the row's identifier.
control_of() {
  agent-device snapshot --json > "$MUXIFY_E2E_ROOT/host-lists-tree.json"
  python3 - "$MUXIFY_E2E_ROOT/host-lists-tree.json" "$1" "$2" <<'PY_CONTROL'
import json, sys
nodes = json.load(open(sys.argv[1]))['data']['nodes']
row = next(node for node in nodes if node.get('identifier') == sys.argv[2])
siblings = [node for node in nodes if node.get('parentIndex') == row['parentIndex']]
wanted = {'handle': lambda node: node.get('label', '').startswith('Reorder'),
          'delete': lambda node: node.get('identifier') == 'minus.circle.fill'}[sys.argv[3]]
print('@' + next(node for node in siblings if wanted(node))['ref'])
PY_CONTROL
}
open_lists() {
  agent-device wait "label=\"Host $1\"" 15000
  agent-device press "label=\"Host $1\"" --settle
  agent-device wait 'label="Host Options"' 8000
  agent-device press 'label="Host Options"' --settle
  agent-device press 'role=button label="Configure panels"' --settle
  agent-device wait "label=\"$1 lists\"" 8000
  agent-device wait "label=\"These settings are for $1 only. Each Host keeps its own.\"" 8000
}
agent-device open dev.muxify.app --platform ios --relaunch "${device[@]}"
open_lists 'Dev Host'
agent-device wait 'label="Sessions, must stay shown"' 8000
echo "The last list that reaches every Session shows a disabled delete control."
agent-device press 'id="host-screen-hidden-topics"' --settle
agent-device wait 'id="host-screen-shown-topics"' 8000
agent-device press 'id="host-screen-hidden-recent"' --settle
agent-device wait 'id="host-screen-shown-recent"' 8000
echo "A plus shows a hidden list at the end of the shown lists."
agent-device gesture drag "$(control_of host-screen-shown-topics handle)" "$(control_of host-screen-shown-sessions handle)" 600 600 300
agent-device press "$(control_of host-screen-shown-recent delete)" --settle
agent-device press 'role=button label="Delete"' --settle
agent-device wait 'id="host-screen-hidden-recent"' 8000
echo "A delete control hides a shown list."
agent-device back --settle
agent-device wait 'label="Host Options"' 8000
agent-device back --settle
open_lists 'Second Host'
agent-device wait 'id="host-screen-hidden-topics"' 8000
echo "Topics remains hidden on Second Host."
agent-device close
agent-device open dev.muxify.app --platform ios --relaunch "${device[@]}"
agent-device wait 'label="Host Dev Host"' 15000
agent-device close
python3 - "$DOCUMENTS" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1])
records = json.loads((root / 'muxify-records.json').read_text())
dev = next(host for host in records['hosts'] if host['displayName'] == 'Dev Host')
prefs = json.loads((root / 'muxify-settings.json').read_text())['hostListPreferences']['byHost']
assert prefs[dev['id']] == ['topics', 'sessions'], prefs
assert prefs['e2e-second'] == ['sessions'], prefs
print('Host choices, with the dragged order, remain independent after relaunch.')
PY
