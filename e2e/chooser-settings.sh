#!/bin/bash
[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"
set -euo pipefail
APP=dev.muxify.app
device=()
[ -z "${MUXIFY_E2E_DEVICE:-}" ] || device=(--udid "$MUXIFY_E2E_DEVICE")
ad() { agent-device "$@"; }
DOCUMENTS="$(xcrun simctl get_app_container "${MUXIFY_E2E_DEVICE:-booted}" "$APP" data)/Documents"
python3 - "$DOCUMENTS" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1])
settings = json.loads((root / 'muxify-settings.json').read_text())
records = json.loads((root / 'muxify-records.json').read_text())
host = next(h for h in records['hosts'] if h['displayName'] == 'Dev Host')
settings['hostListPreferences'] = {'version': 1, 'byHost': {host['id']: ['sessions']}}
settings.pop('chooserListPreferences', None)
(root / 'muxify-settings.json').write_text(json.dumps(settings))
PY
ad open "$APP" --platform ios --relaunch "${device[@]}"
ad wait 'label="Host Dev Host"' 15000
ad press 'label="Host Dev Host"' --settle
ad wait 'label="Host Options"' 8000
ad press 'label="Host Options"' --settle
ad wait 'label="New Topic"' 8000
ad snapshot --json > "$MUXIFY_E2E_ROOT/menu.json"
python3 - "$MUXIFY_E2E_ROOT/menu.json" <<'PY'
import json, sys
nodes = json.load(open(sys.argv[1]))['data']['nodes']
labels = [node.get('label') for node in nodes]
assert labels.index('New Session') < labels.index('New Topic'), labels
assert 'Configure panels' in labels
print('Sessions panel puts New Session first.')
PY
ad press 'role=button label="New Topic"' --settle
ad wait 'label="Tag #work"' 15000
ad press 'label="Cancel"' --settle
ad wait 'label="Session 0"' 15000
ad press 'label="Session 0"' --settle
ad wait 'id="pane-command"' 20000
ad press 'id="header-title"' --settle
ad wait 'label="Close Choose"' 8000
ad snapshot --json > "$MUXIFY_E2E_ROOT/chooser.json"
python3 - "$MUXIFY_E2E_ROOT/chooser.json" <<'PY'
import json, sys
nodes = json.load(open(sys.argv[1]))['data']['nodes']
labels = [node.get('label') for node in nodes]
assert 'Terminal chooser' not in labels, labels
assert 'Sessions' not in labels and 'Topics' not in labels, labels
print('Windows opens directly with no list selector.')
PY
ad press 'label="Close Choose"' --settle
ad press 'label="Options"' --settle
ad press 'role=button label="Configure chooser"' --settle
ad wait 'label="Chooser Sessions"' 8000
ad snapshot --json > "$MUXIFY_E2E_ROOT/settings.json"
control=$(python3 - "$MUXIFY_E2E_ROOT/settings.json" <<'PY'
import json, sys
nodes = json.load(open(sys.argv[1]))['data']['nodes']
row = next(n for n in nodes if n.get('label') == 'Chooser Sessions' and n.get('kind') == 'switch')
control = next(n for n in nodes if n.get('parentIndex') == row['index'] and n.get('role') == 'UISwitch')
print('@' + control['ref'])
PY
)
ad press "$control" --settle
ad back --settle
ad wait 'id="pane-command"' 8000
ad press 'id="header-title"' --settle
ad wait 'label="Sessions"' 8000
ad close
python3 - "$DOCUMENTS" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1])
settings = json.loads((root / 'muxify-settings.json').read_text())
records = json.loads((root / 'muxify-records.json').read_text())
host = next(h for h in records['hosts'] if h['displayName'] == 'Dev Host')
assert settings['chooserListPreferences'][host['id']] == ['windows', 'sessions'], settings
assert settings['hostListPreferences']['byHost'][host['id']] == ['sessions'], settings
settings['hostListPreferences']['byHost'][host['id']] = ['topics', 'sessions']
settings['chooserListPreferences'][host['id']] = ['sessions', 'windows']
(root / 'muxify-settings.json').write_text(json.dumps(settings))
print('Chooser edit persists without changing Host panels.')
PY
ad open "$APP" --platform ios --relaunch "${device[@]}"
ad wait 'label="Host Dev Host"' 15000
ad press 'label="Host Dev Host"' --settle
ad wait 'label="Host Options"' 8000
ad press 'label="Host Options"' --settle
ad wait 'label="New Topic"' 8000
ad snapshot --json > "$MUXIFY_E2E_ROOT/menu.json"
python3 - "$MUXIFY_E2E_ROOT/menu.json" <<'PY'
import json, sys
labels = [n.get('label') for n in json.load(open(sys.argv[1]))['data']['nodes']]
assert labels.index('New Topic') < labels.index('New Session'), labels
print('Topics panel puts New Topic first after restart.')
PY
ad press 'role=button label="Configure panels"' --settle
ad back --settle
ad wait 'label="Session 0"' 15000
ad press 'label="Session 0"' --settle
ad wait 'id="pane-command"' 20000
ad press 'id="header-title"' --settle
ad wait 'label="Sessions"' 8000
ad snapshot --json > "$MUXIFY_E2E_ROOT/chooser.json"
python3 - "$MUXIFY_E2E_ROOT/chooser.json" <<'PY'
import json, sys
nodes = json.load(open(sys.argv[1]))['data']['nodes']
labels = [n.get('label') for n in nodes]
assert labels.index('Sessions') < labels.index('Windows'), labels
assert 'Topics' not in labels, labels
print('Saved chooser order survives restart independently of Topics panel.')
PY
ad close
