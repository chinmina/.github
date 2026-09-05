---
name: renovate-onboard
description: >
  Onboard or update a repository's root renovate.json5 to extend the shared
  chinmina config at renovate/shared.json5 in this repo. Use when asked to
  onboard renovate, create/add a repo's renovate.json5, or review/migrate an
  existing renovate.json5 for rules that clash with or duplicate the shared
  config.
---

# Renovate onboarding

This repo (`chinmina/.github`) hosts a shared Renovate config at
`renovate/shared.json5`. Target repos extend it from their own root
`renovate.json5` instead of re-declaring the same rules locally.

Before doing anything else, read the current contents of
`renovate/shared.json5` in this repo (or fetch it via
`github>chinmina/.github//renovate/shared.json5` if working outside this
checkout). Do not rely on memory or on any copy of its contents written
elsewhere (including in this skill file) — it changes over time and this
file is not a mirror of it.

## Creating or replacing a repo's renovate.json5

1. Read `renovate/shared.json5` to know what it currently sets.
2. Write the target repo's root `renovate.json5` with, at minimum:
   ```json5
   {
     $schema: "https://docs.renovatebot.com/renovate-schema.json",
     extends: [
       "github>chinmina/.github//renovate/shared.json5",
     ],
   }
   ```
3. Add repo-specific config (extra `packageRules`, `regexManagers`, ignored
   deps, per-dependency overrides) only on top of the `extends` array, and
   only for things that are genuinely specific to this repo.
4. If a repo-specific rule looks broadly useful (e.g. a grouping convention
   other repos would also want), propose adding it to
   `renovate/shared.json5` instead of duplicating it locally.

## Migrating an existing hand-written renovate.json5

1. Read `renovate/shared.json5` to get its current top-level keys and
   `packageRules` (manager/dep scope + behavior of each rule).
2. Read the target repo's existing `renovate.json5` in full.
3. Add the `extends` entry for `github>chinmina/.github//renovate/shared.json5`
   if not already present.
4. For every top-level key and every `packageRules` entry in the target
   repo's local config, check it against the shared config for a clash:
   - **Same top-level key set in both** (e.g. commit message settings,
     release-age gating). `extends` is merged first and local top-level keys
     apply on top, so a locally redeclared key silently overrides the shared
     one even when the values match. Remove the local key if it matches the
     shared value.
   - **A local `packageRules` entry targets the same
     managers/deps as a shared entry** (matching or overlapping
     `matchManagers`, `matchDepNames`, `matchDepPatterns`, etc.) and sets a
     similar `groupName` or behavior. Only one rule can win for a given dep;
     keep whichever is correct and delete the redundant one, preferring the
     shared rule.
   - **A local `packageRules` entry targets the same deps as a shared entry
     but with different/incompatible behavior** (e.g. different grouping,
     conflicting `enabled`/`rangeStrategy`/`allowedVersions`). Flag this
     explicitly — it needs a decision, not a silent merge — and resolve by
     keeping one behavior (usually the shared one, unless there's a
     documented repo-specific reason not to).
   - **Post-update options or similar list-valued settings are partially
     duplicated** between local and shared config. Merge into a single list
     rather than leaving two separate declarations that depend on merge
     order.
5. Delete every local rule identified as a clash, in favor of the shared
   equivalent. Keep only local rules whose scope or behavior is genuinely
   distinct from anything in the shared config (e.g. repo-specific regex
   managers, single-dependency version pins/exceptions).
6. Re-read the resulting file end to end and confirm:
   - No two `packageRules` entries claim the same dep set with different
     `groupName`s or conflicting behavior.
   - No top-level key locally overrides a shared top-level key unless that
     override is intentional and commented with the reason.
   - Every remaining local rule has a comment explaining why it's
     repo-specific and not covered by the shared config.
