#!/bin/bash
#
# Fails when RELEASE_PLEASE_VERSION in versions.env differs from the
# release-please version bundled by the release-please-action pinned in
# .github/workflows/release-please.yml. Validating against a schema from a
# different release-please would reject keys the real one accepts, or miss ones
# it doesn't.

set -euo pipefail

main() {
  local dir
  dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  local workflow="${dir}/../../workflows/release-please.yml"
  # shellcheck source-path=SCRIPTDIR/.. source=versions.env
  source "${dir}/versions.env"

  local sha
  sha="$(grep -oE 'googleapis/release-please-action@[0-9a-f]{40}' "${workflow}" | head -1 | cut -d@ -f2)"
  if [[ -z "${sha}" ]]; then
    echo "::error::No SHA-pinned googleapis/release-please-action found in ${workflow}" >&2
    return 1
  fi

  local bundled
  bundled="$(curl --fail --silent --show-error --location --proto '=https' --retry 3 \
    "https://raw.githubusercontent.com/googleapis/release-please-action/${sha}/package-lock.json" \
    | jq -r '.packages["node_modules/release-please"].version')"

  if [[ "${bundled}" != "${RELEASE_PLEASE_VERSION}" ]]; then
    echo "::error::versions.env has RELEASE_PLEASE_VERSION=${RELEASE_PLEASE_VERSION}, but release-please-action@${sha} bundles release-please ${bundled}. Set RELEASE_PLEASE_VERSION=${bundled}, then re-check tighten-schema.jq against that version's src/manifest.ts." >&2
    return 1
  fi
  echo "release-please-action@${sha} bundles release-please ${bundled}, matching versions.env."
}

main "$@"
