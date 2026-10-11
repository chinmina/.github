# Tighten release-please's published config schema (schemas/config.json) so a
# misspelt key fails at every level, without rejecting valid configs:
#
# - Add the keys release-please reads (extractReleaserConfig / parseConfig in
#   src/manifest.ts) but the schema omits: component, package-name and
#   include-commit-authors at both levels; prerelease-type and skip-snapshot at
#   the top level (they're only in the shared definition); label and
#   release-label per package.
# - Make each package strict. The published schema only rejects unknown keys at
#   the top level; under packages it allows anything.
#
# Applied at run time by build-schema.sh to the schema fetched from the pinned
# release-please tag.
.definitions.ReleaserConfigOptions.properties as $releaser
| {
    component: {type: "string"},
    "package-name": {type: "string"},
    "include-commit-authors": {type: "boolean"}
  } as $missing
| .properties += $missing + {
    "prerelease-type": $releaser["prerelease-type"],
    "skip-snapshot": $releaser["skip-snapshot"]
  }
| .allOf[1].properties.packages.additionalProperties = {
    type: "object",
    properties: ($releaser + $missing + {
      label: .properties.label,
      "release-label": .properties["release-label"]
    }),
    additionalProperties: false
  }
