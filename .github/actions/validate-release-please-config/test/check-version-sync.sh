#!/bin/bash
#
# Fails when RELEASE_PLEASE_VERSION in versions.env differs from the
# release-please bundled by the release-please-action pinned in
# .github/workflows/release-please.yml.

set -euo pipefail

main() {
  local dir
  dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  local workflow="${dir}/../../workflows/release-please.yml"
  # shellcheck source-path=SCRIPTDIR/.. source=versions.env
  source "${dir}/versions.env"

  local -a pins
  mapfile -t pins < <(grep -oE 'googleapis/release-please-action@[0-9a-f]{40}' "${workflow}" | sort -u)
  if (( ${#pins[@]} != 1 )); then
    echo "::error::Expected one SHA-pinned googleapis/release-please-action in ${workflow}, found ${#pins[@]}" >&2
    return 1
  fi
  local sha="${pins[0]#*@}"

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
