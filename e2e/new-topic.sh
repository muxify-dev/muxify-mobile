#!/bin/bash
#
# Runs e2e/new-topic.ad on the Board tab, against a sandboxed Muxify on this
# Mac, the dev Host (see e2e/sandbox.sh), then checks that the Topic it made
# has its title and the Tag #work: New Topic is in the ＋ menu of the Go to
# bar, which the Host Server serves. Then turns the Host Server off and runs
# e2e/plus-without-topics.ad: in Sessions only, New Session is in the Options
# menu.
#
#   bash e2e/new-topic.sh

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail

APP=dev.muxify.app
TITLE="e2e New Topic it's"

bash "$(dirname "$0")/topics-tab.sh" || exit 1

agent-device test ./e2e/new-topic.ad || exit 1

muxify topic show --topic "$TITLE" --json | python3 -c '
import json, sys
topic = json.load(sys.stdin)["topic"]
assert topic["title"] == sys.argv[1], topic
assert topic["tags"] == ["work"], topic
print("the Mac has the Topic, with #work")
' "$TITLE" || exit 1

touch "$MUXIFY_E2E_ROOT/no-host-server"
agent-device test ./e2e/plus-without-topics.ad
