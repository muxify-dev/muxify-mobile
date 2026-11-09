#!/bin/bash
#
# Makes sure a Host is saved before the .ad suites run.
#
# The suites start from Home, which is empty on a fresh install. The
# app offers a one-press way to save the Host described by .env.local, which is
# what this presses — an ordinary Host record through the ordinary store, not a
# connection path of its own.
#
# Records persist, so this is usually a no-op after the first run.

set -uo pipefail

APP=dev.muxify.app

agent-device close >/dev/null 2>&1
agent-device open "$APP" --platform ios --relaunch >/dev/null 2>&1
agent-device wait 3000 >/dev/null 2>&1

if agent-device is exists 'label="Add dev Host"' >/dev/null 2>&1; then
  agent-device press 'label="Add dev Host"' >/dev/null 2>&1
  agent-device wait text "Dev Host" 8000 >/dev/null 2>&1
  echo "seeded the dev Host from .env.local"
else
  echo "a Host is already saved"
fi

agent-device close >/dev/null 2>&1
