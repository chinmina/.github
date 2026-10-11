# validate-release-please-config

Validates a consumer's `release-please-config.json` before the shared
`release-please.yml` workflow runs release-please, so a broken config stops the
run before any release, tag or Release PR is created.

release-please doesn't validate its own config. Unknown keys are ignored, so a
typo like `"force-tag-creaton"` silently turns the setting off. This action
validates the config with the [sourcemeta `jsonschema`
CLI](https://github.com/sourcemeta/jsonschema), run through `mise exec`, against
release-please's published JSON schema with two corrections derived from
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
| `release-please-config.upstream.schema.json` | `schemas/config.json` from release-please **v17.6.0**, unmodified |
| `tighten-schema.jq` | the two corrections above |
| `release-please-config.schema.json` | the schema actually used, generated from the two above |
| `jsonschema-version` | the pinned sourcemeta `jsonschema` CLI version |

## Keeping it in step

**release-please.** The upstream schema must match the release-please version
bundled by the pinned `release-please-action` (v5.0.0 bundles v17.6.0). When
that pin moves, replace the upstream copy, re-check the key lists in
`tighten-schema.jq` against that version's `extractReleaserConfig` and
`parseConfig`, and regenerate:

```sh
jq -f tighten-schema.jq release-please-config.upstream.schema.json > release-please-config.schema.json
```

If a consumer uses a key the schema doesn't know, the run fails naming that
key — update the schema rather than loosening the check.

**The validator.** No Renovate manager covers `jsonschema-version`; bump it by
hand. mise's `github:` backend checks the download against GitHub's asset
digest, and against artifact attestations if sourcemeta starts publishing them.

## Tests

```sh
test/run.sh                          # via mise exec, as in CI
JSONSCHEMA=/path/to/jsonschema test/run.sh   # with a local binary
```

Fixtures under `test/valid` must pass (real consumer configs: dollop,
kms-import, the relic example, plus every key the published schema omits);
fixtures under `test/invalid` must fail.
