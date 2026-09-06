#!/bin/bash
#
# Validate a Renovate *repo* config with renovate-config-validator.
#
# The validator autodetects config by filename and location. Passing a file
# path as an argument makes it validate the file as *global* config against
# the wrong schema, which can report success for an invalid repo config. This
# script always validates a directory context, so the repo schema is used.
#
# Usage:
#   validate.sh                        # validate ./renovate.json5 (or .json)
#   validate.sh renovate/shared.json5  # validate any file as a repo config

set -euo pipefail

readonly PROGNAME="${0##*/}"

# Scratch directory for validating an explicitly named file; empty when
# validating the current directory. Cleaned up by cleanup() on exit.
TMPDIR_SCRATCH=''

# Directory the validator runs in. Set by resolve_workdir().
WORKDIR=''

# Print an error message to STDERR, prefixed with the script name.
err() {
  printf '%s: ERROR: %s\n' "${PROGNAME}" "$*" >&2
}

# Remove the scratch directory, if one was created. Registered on EXIT.
cleanup() {
  if [[ -n "${TMPDIR_SCRATCH}" ]]; then
    rm -rf "${TMPDIR_SCRATCH}"
  fi
}

# Print usage to STDOUT.
usage() {
  cat <<'EOF'
Validate a Renovate repo config with renovate-config-validator --strict.

Usage:
  validate.sh [-h] [CONFIG_FILE]

  CONFIG_FILE  Validate this file as a repo config. Defaults to the renovate
               config found in the current directory.
EOF
}

# Succeed if the given directory holds a config Renovate would autodetect.
has_repo_config() {
  local dir="$1"
  local candidate
  for candidate in "${dir}"/renovate.json* "${dir}"/.renovaterc* \
    "${dir}"/.github/renovate.json*; do
    if [[ -f "${candidate}" ]]; then
      return 0
    fi
  done
  return 1
}

# Set WORKDIR to the directory to validate in, staging CONFIG_FILE ($1) into a
# scratch directory when one is named. Sets TMPDIR_SCRATCH as a side effect.
# Must not be called in a subshell: both globals would be lost.
resolve_workdir() {
  local config="$1"

  if [[ -z "${config}" ]]; then
    if ! has_repo_config "${PWD}"; then
      err "no renovate config found in ${PWD}; pass a path explicitly"
      return 1
    fi
    WORKDIR="${PWD}"
    return 0
  fi

  if [[ ! -f "${config}" ]]; then
    err "no such file: ${config}"
    return 1
  fi

  TMPDIR_SCRATCH="$(mktemp -d)"
  cp "${config}" "${TMPDIR_SCRATCH}/renovate.json5"
  WORKDIR="${TMPDIR_SCRATCH}"
}

# Entry point. Receives the script's arguments as "$@".
main() {
  local flag
  while getopts 'h' flag; do
    case "${flag}" in
      h)
        usage
        return 0
        ;;
      *)
        usage >&2
        return 1
        ;;
    esac
  done
  shift $((OPTIND - 1))

  trap cleanup EXIT

  resolve_workdir "${1:-}" || return 1

  local -a validator=(
    npx --yes --package renovate -- renovate-config-validator --strict
  )

  local output
  local status=0
  output="$(cd "${WORKDIR}" && "${validator[@]}" 2>&1)" || status=$?

  printf '%s\n' "${output}"

  if ((status != 0)); then
    err "validation failed (exit ${status})"
    if grep -q 'Config migration necessary' <<<"${output}"; then
      err "deprecated syntax: apply the migration diff printed above"
    fi
    return "${status}"
  fi

  if grep -q 'as global config' <<<"${output}"; then
    err "validated as global config, not repo config"
    err "wrong schema was used: this result is meaningless"
    return 1
  fi

  printf '%s: OK (remote "extends" presets are NOT resolved by this check)\n' \
    "${PROGNAME}"
}

main "$@"
