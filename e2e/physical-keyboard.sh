#!/bin/bash
[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"
set -euo pipefail
: "${MUXIFY_E2E_DEVICE:?Set MUXIFY_E2E_DEVICE to a simulator UDID}"
ad() { agent-device "$@" --session muxify-keyboard-check; }
trap 'ad close >/dev/null 2>&1 || true' EXIT
ad open dev.muxify.app --platform ios --udid "$MUXIFY_E2E_DEVICE" --relaunch
ad wait 'label="Host Dev Host"' 15000
ad press 'label="Host Dev Host"' --settle
ad wait 'label="Session 0"' 15000
ad press 'label="Session 0"' --settle
ad wait 'id="pane-command"' 20000
ad snapshot --json > "$MUXIFY_E2E_ROOT/keyboard-tree.json"
ad press 'label="Options"' --settle
ad wait 'label="Copy log"' 8000
ad press 'label="Copy log"' --settle
xcrun simctl pbpaste "$MUXIFY_E2E_DEVICE" > "$MUXIFY_E2E_ROOT/keyboard-app.log"
ad wait 'label="OK"' 8000
ad press 'label="OK"' --settle
python3 - "$MUXIFY_E2E_ROOT" <<'PY'
import json,pathlib,sys
root=pathlib.Path(sys.argv[1])
nodes=json.loads((root/'keyboard-tree.json').read_text())['data']['nodes']
log=(root/'keyboard-app.log').read_text()
print('\n'.join(l for l in log.splitlines() if 'physical keyboard' in l or 'container ' in l))
states=[line for line in log.splitlines() if 'physical keyboard ' in line]
assert states, 'No native keyboard state in the Log'
connected=states[-1].endswith('physical keyboard connected')
row=any(n.get('label','').lower()=='escape' for n in nodes)
assert row != connected, (row,connected)
print('Key Row matches native physical keyboard presence.')
focused=[l for l in log.splitlines() if l.endswith('keyboard: focus')]
print('\n'.join(focused))
assert bool(focused) == connected, (focused, connected)
print('The active Pane takes the keyboard on Attach only with a physical keyboard.' if connected
      else 'Without a physical keyboard, Attach leaves the on-screen keyboard down.')
PY
ad press 'label="Options"' --settle
ad press 'label="Panes"' --settle
ad wait 'label="Close Panes"' 8000
ad press 'label="Close Panes"' --settle
ad press 'label="Options"' --settle
ad press 'label="Keyboard"' --settle
ad snapshot --json > "$MUXIFY_E2E_ROOT/keyboard-after.json"
echo "Panes and Keyboard are available through Options."
ad close
