#!/bin/bash
#
# Puts the Host Screen on the Board tab for a suite about Topic cards. The
# sandbox starts it on Sessions, and puts the settings back at the end.
#
#   bash e2e/topics-tab.sh

set -euo pipefail

SETTINGS="$(xcrun simctl get_app_container "${MUXIFY_E2E_DEVICE:-booted}" dev.muxify.app data)/Documents/muxify-settings.json"
python3 - "$SETTINGS" <<'PY'
import json, sys
settings = json.load(open(sys.argv[1]))
settings.pop("hostScreenTabs", None)
json.dump(settings, open(sys.argv[1], "w"))
PY
