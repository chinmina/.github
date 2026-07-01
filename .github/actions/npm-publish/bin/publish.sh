#!/usr/bin/env bash
#
# Orchestrate the npm publish flow: extract each platform binary, generate its
# package.json, publish it, then generate and publish the main shim last.
#
# All goreleaser->npm mapping and package.json generation lives in the tested
# Node scripts alongside this file; this script only extracts archives and
# calls `npm publish`. Extracted here (rather than inlined in action.yml) so it
# can be driven against fixtures with a stubbed `npm`.
#
# Required environment:
#   ACTION_PATH       directory containing bin/ and launcher.cjs
#   PACKAGE_NAME      base npm package name (e.g. @scope/tool)
#   ARTIFACTS_JSON    path to goreleaser artifacts.json
#   MAIN_PACKAGE_DIR  path to the consumer main package directory
#   VERSION           release version (leading v stripped here)
#   README            optional README path copied into the main package
#   GITHUB_SERVER_URL, GITHUB_REPOSITORY  used to build the repository URL

set -euo pipefail

VERSION="${VERSION#v}"
export VERSION
REPO_URL="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}"
export REPO_URL
LAUNCHER="launcher.cjs"
export LAUNCHER

TMPDIRS=()
cleanup() {
	local d
	for d in "${TMPDIRS[@]+"${TMPDIRS[@]}"}"; do rm -rf "${d}"; done
}
trap cleanup EXIT

make_tmpdir() {
	local d
	d="$(mktemp -d)"
	TMPDIRS+=("${d}")
	echo "${d}"
}

tag_args=()
if [[ "${VERSION}" == *-* ]]; then
	tag_args=(--tag next)
fi

# Publish one platform package per qualifying Archive entry.
while IFS=$'\t' read -r archive_path archive_format binary pkg_name os cpu; do
	tmpdir="$(make_tmpdir)"

	if [[ "${archive_format}" == "zip" ]]; then
		unzip -j "${archive_path}" "${binary}" -d "${tmpdir}"
	else
		tar -xzf "${archive_path}" -C "${tmpdir}" "${binary}"
	fi
	chmod +x "${tmpdir}/${binary}"

	PKG_NAME="${pkg_name}" OS="${os}" CPU="${cpu}" BINARY="${binary}" \
		node "${ACTION_PATH}/bin/platform-package.js" >"${tmpdir}/package.json"

	npm publish --access public "${tag_args[@]+"${tag_args[@]}"}" "${tmpdir}"
	echo "published ${pkg_name}@${VERSION}"
done < <(node "${ACTION_PATH}/bin/list-archives.js" "${ARTIFACTS_JSON}")

# Publish the main shim last: its optionalDependencies reference the platform
# packages published above. main-package.js is the single source of truth for
# derived fields; the generic launcher is copied in from the action.
tmpdir="$(make_tmpdir)"
cp -r "${MAIN_PACKAGE_DIR}/." "${tmpdir}/"
cp "${ACTION_PATH}/${LAUNCHER}" "${tmpdir}/${LAUNCHER}"
if [[ -n "${README:-}" && -f "${README}" ]]; then
	cp "${README}" "${tmpdir}/README.md"
fi
node "${ACTION_PATH}/bin/main-package.js" \
	"${MAIN_PACKAGE_DIR}/package.json" "${ARTIFACTS_JSON}" \
	>"${tmpdir}/package.json"
npm publish --access public "${tag_args[@]+"${tag_args[@]}"}" "${tmpdir}"
echo "published ${PACKAGE_NAME}@${VERSION}"
