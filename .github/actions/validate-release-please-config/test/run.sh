#!/bin/bash
#
# Runs validate.sh over every fixture: test/valid must pass, test/invalid must
# fail. Set JSONSCHEMA to a local validator binary to skip mise.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly DIR
SCHEMA="$(mktemp)"
readonly SCHEMA
trap 'rm -f "${SCHEMA}"' EXIT

# check <expect: pass|fail> <fixture>
check() {
  local expect="$1" fixture="$2" got=fail
  if "${DIR}/validate.sh" "${fixture}" "${SCHEMA}" >/dev/null 2>&1; then
    got=pass
  fi
  if [[ "${got}" == "${expect}" ]]; then
    echo "ok   ${fixture#"${DIR}/test/"}"
  else
    echo "FAIL ${fixture#"${DIR}/test/"}: expected ${expect}, got ${got}"
    return 1
  fi
}

main() {
  "${DIR}/build-schema.sh" "${SCHEMA}"
  local failures=0 fixture
  for fixture in "${DIR}"/test/valid/*.json; do
    check pass "${fixture}" || failures=$((failures + 1))
  done
  for fixture in "${DIR}"/test/invalid/*.json; do
    check fail "${fixture}" || failures=$((failures + 1))
  done
  if (( failures > 0 )); then
    echo "${failures} fixture(s) failed" >&2
    return 1
  fi
}

main "$@"
