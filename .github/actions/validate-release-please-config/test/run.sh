#!/bin/bash
#
# Validates every fixture under test/valid (must pass) and test/invalid (must
# fail) against the tightened schema, using the same pinned sourcemeta
# jsonschema CLI as the action. Set JSONSCHEMA to a local binary to skip mise.

set -euo pipefail

ACTION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ACTION_DIR

jsonschema() {
  if [[ -n "${JSONSCHEMA:-}" ]]; then
    "${JSONSCHEMA}" "$@"
  else
    mise exec "github:sourcemeta/jsonschema@$(<"${ACTION_DIR}/jsonschema-version")" -- jsonschema "$@"
  fi
}

main() {
  local schema="${ACTION_DIR}/release-please-config.schema.json"
  local failures=0
  local fixture

  for fixture in "${ACTION_DIR}"/test/valid/*.json; do
    if jsonschema validate "${schema}" "${fixture}" >/dev/null 2>&1; then
      echo "ok   valid/${fixture##*/}"
    else
      echo "FAIL valid/${fixture##*/} was rejected"
      failures=$((failures + 1))
    fi
  done

  for fixture in "${ACTION_DIR}"/test/invalid/*.json; do
    if jsonschema validate "${schema}" "${fixture}" >/dev/null 2>&1; then
      echo "FAIL invalid/${fixture##*/} was accepted"
      failures=$((failures + 1))
    else
      echo "ok   invalid/${fixture##*/}"
    fi
  done

  if (( failures > 0 )); then
    echo "${failures} fixture(s) failed" >&2
    return 1
  fi
}

main "$@"
