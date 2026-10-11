#!/bin/bash
#
# Writes the schema validate.sh checks against to $1: release-please's
# published config schema from the pinned release-please tag, tightened by
# tighten-schema.jq. It's data from a tag, not code; a failed fetch fails the
# run rather than skipping validation.

set -euo pipefail

main() {
  local out="$1"
  local dir
  dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # shellcheck source-path=SCRIPTDIR source=versions.env
  source "${dir}/versions.env"

  curl --fail --silent --show-error --location --proto '=https' --retry 3 \
    "https://raw.githubusercontent.com/googleapis/release-please/v${RELEASE_PLEASE_VERSION}/schemas/config.json" \
    | jq -f "${dir}/tighten-schema.jq" >"${out}"
}

main "$@"
