#!/bin/bash
# Compiles the KeyboardSnapshot module's pure rule with its tests and runs them on
# this Mac. The rule has no UIKit, so no simulator is needed.
set -euo pipefail
cd "$(dirname "$0")/../modules/keyboard-snapshot"
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
swiftc -o "$out/keyboard-latch-tests" ios/KeyboardLatch.swift tests/main.swift
"$out/keyboard-latch-tests"
