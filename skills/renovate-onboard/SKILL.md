---
name: renovate-onboard
description: >
  Onboard or update a repository's root renovate.json5 to extend the shared
  chinmina config at renovate/shared.json5 in this repo. Use when asked to
  "onboard renovate", add/create a repo's renovate.json5, or when reviewing
  an existing renovate.json5 (e.g. in chinmina-bridge or kms-import) for
  rules that clash with or duplicate the shared config.
---

# Renovate onboarding

This repo (`chinmina/.github`) hosts a shared Renovate config at
[`renovate/shared.json5`](../../renovate/shared.json5). Individual chinmina
repositories should extend it from their own root `renovate.json5` rather
than re-declaring the same rules locally.

## Creating a new renovate.json5

In the target repo, create (or replace) `renovate.json5` at the root:

```json5
{
  $schema: "https://docs.renovatebot.com/renovate-schema.json",
  extends: [
    "github>chinmina/.github//renovate/shared.json5",
  ],
}
```

- Reference the shared config using Renovate's repo-preset syntax:
  `github>chinmina/.github//renovate/shared.json5`. Do not copy its contents
  into the repo — the whole point is a single source of truth.
- Only add repo-specific config on top of the `extends` array: extra
  `packageRules`, `regexManagers`, ignored deps, etc. that genuinely don't
  belong in the shared file.
- If the repo needs a rule that looks broadly useful (e.g. another Go/mise
  grouping convention), prefer proposing it as a change to
  `renovate/shared.json5` in this repo instead of duplicating it locally.

## Migrating an existing renovate.json5

Repos like `chinmina-bridge` and (historically) `kms-import` have their own
hand-written `renovate.json5` predating the shared config. When onboarding
one of these:

1. Add the `extends` entry for `github>chinmina/.github//renovate/shared.json5`.
2. Walk every existing top-level key and `packageRules` entry and check it
   against `renovate/shared.json5` for a **clash**. A clash is any local rule
   that:
   - Sets the same top-level option the shared config already sets (e.g.
     `semanticCommits`, `semanticCommitType`, `semanticCommitScope`,
     `minimumReleaseAge`) — Renovate merges `extends` config first, then
     applies the repo's own top-level keys on top, so a locally redeclared
     key silently overrides the shared one even if the values are identical.
     Remove the local key once it matches the shared value.
   - Duplicates a `packageRules` entry the shared config already provides for
     the same `matchManagers`/`matchDepNames` (e.g. a local
     `groupName: "github-actions"` rule for `matchManagers: ["github-actions"]`
     when the shared config already groups GitHub Actions the same way, or a
     local Go/mise grouping rule that overlaps the shared "Go dependencies" /
     "Mise packages" / "Go runtime" groups).
   - Produces conflicting behavior for the same deps (e.g. shared config
     groups `go` into "Go runtime" across `gomod`/`mise`, while a local rule
     also groups `go` under its own `groupName: "go"` — only one group can
     win, and Renovate will otherwise nondeterministically apply whichever
     rule matches last).
   - Sets `postUpdateOptions` that partially overlap the shared list (shared
     sets `gomodTidy`; if local config only adds `gomodUpdateImportPaths`,
     merge it into a single `postUpdateOptions` array rather than keeping two
     separate declarations that could clobber each other depending on merge
     order).
3. For each clash found, prefer **deleting the local rule** and relying on
   the shared one. Only keep the local rule if it is genuinely different in
   scope from the shared rule (e.g. `regexManagers` for Go version pins in
   workflow files, or repo-specific `allowedVersions`/`enabled: false`
   overrides for a single dependency) — these are repo-specific and should
   stay.
4. Re-read the merged result end to end and confirm:
   - No two `packageRules` entries claim the same dep set with different
     `groupName`s.
   - No top-level key locally overrides a shared top-level key unless the
     override is intentional and documented with a comment explaining why.
   - Repo-specific rules that remain are commented to explain why they exist
     (this is already the convention in `chinmina-bridge`'s file — keep it).

## Reference: what the shared config currently covers

See [`renovate/shared.json5`](../../renovate/shared.json5) for the current
source of truth. As of writing it covers:

- `config:recommended`, disabled dependency dashboard, pinned GitHub Action
  digests, and semantic commit settings (`fix(deps): ...`).
- `minimumReleaseAge: "5 days"`.
- `packageRules` grouping: Go module updates ("Go dependencies"), GitHub
  Actions ("GitHub Actions"), mise packages ("Mise packages"), and the Go
  runtime across `gomod`/`mise` ("Go runtime", `rangeStrategy: "bump"`).
- `gomodTidy` post-update option and enabling indirect Go module updates.
- An exception keeping `chinmina/**` GitHub Actions unpinned (they
  intentionally track a moving `verified-actions` ref).

Any local rule matching one of the above by manager/dep scope is a
candidate for removal.
