#!/bin/bash
#
# Builds the schema exactly as the action does (fetched from the pinned
# release-please tag, then tightened) and validates every fixture under
# test/valid (must pass) and test/invalid (must fail) with the same pinned
# sourcemeta jsonschema CLI. Set JSONSCHEMA to a local binary to skip mise.

set -euo pipefail

ACTION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ACTION_DIR

# shellcheck source-path=SCRIPTDIR/.. source=versions.env
source "${ACTION_DIR}/versions.env"

jsonschema() {
  if [[ -n "${JSONSCHEMA:-}" ]]; then
    "${JSONSCHEMA}" "$@"
  else
    mise exec "github:sourcemeta/jsonschema@${JSONSCHEMA_VERSION}" -- jsonschema "$@"
  fi
}

SCHEMA_FILE="$(mktemp)"
readonly SCHEMA_FILE
trap 'rm -f "${SCHEMA_FILE}"' EXIT

main() {
  local schema="${SCHEMA_FILE}"
  "${ACTION_DIR}/build-schema.sh" "${schema}"
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
