# validate-release-please-config

Validates a consumer's `release-please-config.json` before the shared
`release-please.yml` workflow runs release-please, so a broken config stops the
run before any release, tag or Release PR is created.

release-please doesn't validate its own config. Unknown keys are ignored, so a
typo like `"force-tag-creaton"` silently turns the setting off. This action
validates the config with the [sourcemeta `jsonschema`
CLI](https://github.com/sourcemeta/jsonschema), run through `mise exec`, against
release-please's published JSON schema, fetched at run time from the pinned
release-please tag and tightened with two corrections derived from
release-please's source (`src/manifest.ts`):

- **Strict packages.** The published schema only rejects unknown keys at the
  top level; entries under `packages` accept anything. Here they don't.
- **Missing keys added.** The published schema omits keys release-please does
  read: `component`, `package-name`, `include-commit-authors` (both levels),
  `prerelease-type`, `skip-snapshot` (top level), and `label`/`release-label`
  (per package). Without these, strictness would reject valid configs.

The kit's own contract (`draft`, `force-tag-creation`) is checked separately in
`release-please.yml`; this action only checks that the config is well formed.

## Files

| File | What it is |
|------|------------|
| `versions.env` | pinned release-please (schema tag) and sourcemeta `jsonschema` versions, kept current by Renovate |
| `build-schema.sh` | fetches the schema from the release-please tag and applies `tighten-schema.jq` |
| `tighten-schema.jq` | the two corrections above |
| `test/run.sh` | builds the schema the same way and checks every fixture |
| `test/check-version-sync.sh` | checks `RELEASE_PLEASE_VERSION` matches the release-please bundled by the pinned `release-please-action` |

The fetch is schema data from a tag, not code. If it fails, the release run
fails rather than skipping validation.

## Keeping it in step

Renovate updates both versions in `versions.env`, in the same group as the
GitHub Actions updates, so a `release-please-action` bump and the matching
release-please version land in one PR. The `validate-release-please-config`
workflow runs on that PR: it fails if `RELEASE_PLEASE_VERSION` doesn't match
what the pinned action bundles, and it runs every fixture against the newly
built schema. Problems surface in that PR, not in a consumer's release.

When release-please moves, re-check the key lists in `tighten-schema.jq`
against that version's `extractReleaserConfig` and `parseConfig`. A key
release-please reads but the schema lacks will fail consumers' runs, naming the
key; add it to `tighten-schema.jq` (and a fixture) rather than loosening the
check.

## Tests

```sh
test/check-version-sync.sh
test/run.sh                                  # via mise exec, as in CI
JSONSCHEMA=/path/to/jsonschema test/run.sh   # with a local binary
```

Fixtures under `test/valid` must pass (real consumer configs: dollop,
kms-import, the relic example, plus every key the published schema omits);
fixtures under `test/invalid` must fail.
