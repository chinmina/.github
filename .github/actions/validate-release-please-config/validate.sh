#!/bin/bash
#
# Validates a release-please-config.json for the shared release workflow:
# against release-please's schema (tightened, so a misspelt key fails), then
# the kit's contract that "draft" and "force-tag-creation" are on.
#
# Usage: validate.sh <config> [<schema>]  (the schema is built if omitted)
# Set JSONSCHEMA to a local validator binary to skip mise.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly DIR
# shellcheck source-path=SCRIPTDIR source=versions.env
source "${DIR}/versions.env"

BUILT_SCHEMA=""
trap 'rm -f "${BUILT_SCHEMA}"' EXIT

err() {
  echo "::error title=validate-release-please-config::$*" >&2
}

jsonschema() {
  if [[ -n "${JSONSCHEMA:-}" ]]; then
    "${JSONSCHEMA}" "$@"
  else
    mise exec "github:sourcemeta/jsonschema@${JSONSCHEMA_VERSION}" -- jsonschema "$@"
  fi
}

# Succeeds when key $1 is true for every package in config $2, with each
# package's settings laid over the top-level ones (as release-please does).
enabled() {
  # shellcheck disable=SC2016
  jq -e --arg k "$1" '[.packages[] as $p | . + $p | .[$k] == true] | all' "$2" >/dev/null
}

main() {
  local config="$1"
  local schema="${2:-}"
  if [[ -z "${schema}" ]]; then
    BUILT_SCHEMA="$(mktemp)"
    schema="${BUILT_SCHEMA}"
    "${DIR}/build-schema.sh" "${schema}"
  fi

  if ! jsonschema validate "${schema}" "${config}"; then
    err "release-please config does not match the release-please schema (see errors above)."
    return 1
  fi

  local failed=0
  if ! enabled draft "${config}"; then
    err '"draft": true is required (top level or every package): the release must stay a draft until its artifacts are attested.'
    failed=1
  fi
  if ! enabled force-tag-creation "${config}"; then
    err '"force-tag-creation": true is required (top level or every package): without the tag, release-please cannot find the release it just created and the next Release PR covers the entire history.'
    failed=1
  fi
  return "${failed}"
}

main "$@"
