#!/bin/bash
#
# Writes the schema validate.sh checks against to $1: the config schema of the
# release-please bundled by the release-please-action that release-please.yml
# pins, tightened by tighten-schema.jq. The version comes from that action's
# package-lock.json, so the schema moves with the pin. Both fetches are data,
# not code; a failure fails the run rather than skipping validation.

set -euo pipefail

fetch() {
  curl --fail --silent --show-error --location --proto '=https' --retry 3 "$1"
}

main() {
  local out="$1"
  local dir
  dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # The action ships inside this repo, so the workflow it serves sits beside it.
  local workflow="${dir}/../../workflows/release-please.yml"

  local -a pins
  mapfile -t pins < <(grep -oE 'googleapis/release-please-action@[0-9a-f]{40}' "${workflow}" | sort -u)
  if (( ${#pins[@]} != 1 )); then
    echo "::error title=validate-release-please-config::Expected one SHA-pinned googleapis/release-please-action in ${workflow}, found ${#pins[@]}" >&2
    return 1
  fi
  local sha="${pins[0]#*@}"

  local version
  version="$(fetch "https://raw.githubusercontent.com/googleapis/release-please-action/${sha}/package-lock.json" \
    | jq -er '.packages["node_modules/release-please"].version')"
  echo "release-please-action@${sha} bundles release-please ${version}" >&2

  fetch "https://raw.githubusercontent.com/googleapis/release-please/v${version}/schemas/config.json" \
    | jq -f "${dir}/tighten-schema.jq" >"${out}"
}

main "$@"
