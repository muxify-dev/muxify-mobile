#!/bin/bash
[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"
set -euo pipefail
: "${MUXIFY_E2E_DEVICE:?Set MUXIFY_E2E_DEVICE to a simulator UDID}"
ad() { agent-device "$@" --session muxify-direct-entry; }
trap 'ad close >/dev/null 2>&1 || true' EXIT
records="$(xcrun simctl get_app_container "$MUXIFY_E2E_DEVICE" dev.muxify.app data)/Documents/muxify-records.json"
url=$(python3 - "$records" <<'PY'
import json,sys,urllib.parse
host=next(h for h in json.load(open(sys.argv[1]))['hosts'] if h['displayName']=='Dev Host')
print('muxify://terminal?'+urllib.parse.urlencode({'hostId':host['id'],'session':'0'}))
PY
)
ad open dev.muxify.app --platform ios --udid "$MUXIFY_E2E_DEVICE" --relaunch
xcrun simctl terminate "$MUXIFY_E2E_DEVICE" dev.muxify.app
xcrun simctl openurl "$MUXIFY_E2E_DEVICE" "$url"
ad open dev.muxify.app --platform ios --udid "$MUXIFY_E2E_DEVICE"
if ad wait 'label="Open"' 1500 >/dev/null 2>&1; then
  ad press 'label="Open"' --settle
fi
ad wait 'id="pane-command"' 20000
ad back --settle
ad wait 'label="Host Options"' 8000
ad back --settle
ad wait 'label="Host Dev Host"' 8000
echo 'Cold direct entry returns through Host Screen to Hosts.'
