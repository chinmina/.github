# validate-release-please-config

Validates a consumer's `release-please-config.json` before the shared
`release-please.yml` workflow runs release-please, so a broken config stops the
run before any release, tag or Release PR is created.

release-please doesn't validate its own config. Unknown keys are ignored, so a
typo like `"force-tag-creaton"` silently turns the setting off. This action
checks the config against release-please's published JSON schema with two
corrections, both derived from release-please's source (`src/manifest.ts`):

- **Strict packages.** The published schema only rejects unknown keys at the
  top level; entries under `packages` accept anything. Here they don't.
- **Missing keys added.** The published schema omits keys release-please does
  read: `component`, `package-name`, `include-commit-authors` (both levels),
  `prerelease-type`, `skip-snapshot` (top level), and `label`/`release-label`
  (per package). Without these, strictness would reject valid configs.

The kit's own contract (`draft`, `force-tag-creation`) is checked separately in
`release-please.yml`; this action only checks that the config is well formed.

## Keeping it in step with release-please

`release-please-config.schema.json` is `schemas/config.json` from release-please
**v17.6.0**, the version bundled by the pinned `release-please-action` v5.0.0.
When the action pin moves, replace the schema with the matching release-please
version and re-check `MISSING_KEYS` in `validate.mjs` against that version's
`extractReleaserConfig` and `parseConfig`. If a consumer uses a key the
schema doesn't know, the run fails naming that key — update the schema rather
than loosening the check.

## Tests

```sh
npm ci --ignore-scripts && npm test
```

Fixtures are real consumer configs (dollop, kms-import, the relic example).
