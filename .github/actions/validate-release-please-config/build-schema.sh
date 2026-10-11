#!/bin/bash
#
# Writes the schema the action validates against to the path in $1: release-
# please's published config schema, fetched from the pinned release-please tag
# and tightened by tighten-schema.jq. Fetching schema data (not code) from a
# tag is low risk; a failed fetch fails the run rather than skipping validation.

set -euo pipefail

main() {
  local out="$1"
  local dir
  dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # shellcheck source-path=SCRIPTDIR source=versions.env
  source "${dir}/versions.env"

  local url="https://raw.githubusercontent.com/googleapis/release-please/v${RELEASE_PLEASE_VERSION}/schemas/config.json"
  curl --fail --silent --show-error --location --proto '=https' --retry 3 "${url}" \
    | jq -f "${dir}/tighten-schema.jq" >"${out}"
  echo "Built schema from release-please v${RELEASE_PLEASE_VERSION}: ${url}" >&2
}

main "$@"
