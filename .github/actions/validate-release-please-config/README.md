# validate-release-please-config

Stops the shared release run when a consumer's `release-please-config.json` is
malformed, contains a key release-please doesn't know (it would silently ignore
it), or doesn't turn on `draft` and `force-tag-creation`. The schema is
release-please's own, fetched from the pinned release-please tag and tightened
by [`tighten-schema.jq`](tighten-schema.jq).

**When release-please moves:** re-check the key lists in `tighten-schema.jq`
against that version's `extractReleaserConfig` and `parseConfig`
(`src/manifest.ts`). If a real key is rejected, add it there with a fixture
rather than loosening the check.

```sh
test/check-version-sync.sh
test/run.sh                                  # validator via mise exec
JSONSCHEMA=/path/to/jsonschema test/run.sh   # or a local binary
```
