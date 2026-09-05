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

**Role**: act decisively where the answer is determinate (merge semantics,
validation, dead rules, deprecated syntax are mechanical facts — just apply
them). Escalate to the caller where the answer requires judgement (whether a
group is still justified, whether a workaround belongs upstream, whether a
rule is truly permanent). Don't guess on judgement calls; the human often has
context you don't.

Before doing anything else, read the current contents of
`renovate/shared.json5` in this repo (or fetch it via
`github>chinmina/.github//renovate/shared.json5` if working outside this
checkout). Do not rely on memory or on any prior summary of its contents,
including one written in this skill file — it changes over time and this
file is not a mirror of it.

## Renovate merge semantics (must know before touching anything)

These are facts, not judgement calls — internalize them before deciding what
counts as a clash:

- `extends` presets are merged first; local top-level keys apply on top and
  **win** outright.
- `packageRules` from `extends` are prepended; local rules evaluate after, and
  for any given dependency **the last matching rule wins per-option, not
  per-rule**. If two rules both match a dependency, their options merge —
  only the options both rules set get overridden; options only one rule sets
  survive.
- A large set of options are `mergeable: true` (includes `postUpdateOptions`,
  `ignoreDeps`, `labels`, and others) — for these, when both a shared and a
  local rule apply, the array values **concatenate** rather than the local
  one replacing the shared one. Merge order is well-defined; do not assume a
  locally-listed value needs to be re-added because a shared one "wins".
  Getting this backwards is dangerous: e.g. deleting a repo's
  `gomodUpdateImportPaths` because the shared config already sets
  `gomodTidy` in `postUpdateOptions` silently breaks major module bumps,
  since the two options address different things and both were meant to
  apply together.

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
   If the shared config isn't yet on `chinmina/.github`'s default branch
   (e.g. it's still under review in a PR), pin the preset to that branch/tag
   instead: `github>chinmina/.github//renovate/shared.json5#<branch-or-tag>`.
   Leave a `// TODO` comment next to it to switch back to the unpinned form
   once the branch merges — the unpinned form is the intended steady state
   (see "Why extends floats on main" below).
3. Add repo-specific config (extra `packageRules`, custom managers, ignored
   deps, per-dependency overrides) only on top of the `extends` array, and
   only for things genuinely specific to this repo. Order local
   `packageRules` broad → narrow: general grouping rules first, narrowing
   overrides (`pinDigests`, `enabled`, `allowedVersions`, digest/version
   exceptions for one dependency) last, with a comment noting the ordering is
   intentional.
4. If a repo-specific rule looks broadly useful (e.g. a grouping convention
   other repos would also want), propose adding it to
   `renovate/shared.json5` instead of duplicating it locally — don't add it
   there yourself without confirming with the caller; the shared file is
   used by every repo and a bad addition there is a bad addition everywhere.

### Why extends floats on `main`

Don't pin `renovate/shared.json5` to a fixed ref by default, and don't
propose doing so. Unlike executable code running with credentials (which is
why chinmina's `verified-actions` action ref is deliberately pinned/floated
that way), this is declarative config for a bot that only opens PRs, and
automerge is never inherited from the shared config (see below) — the worst
case of a bad shared-config change is unwanted or missing PRs, which is
visible and reversible. Floating also means a shared-config fix reaches
every consuming repo in one edit instead of requiring a migration across
all of them.

### Automerge is never part of this

`renovate/shared.json5` does not and should not set `automerge`. It is
opt-in per repository. If a repo wants automerge, that's a local addition
made deliberately by that repo, never something to introduce into the
shared config on the assumption it's low-risk.

## Migrating an existing hand-written renovate.json5

1. Read `renovate/shared.json5` in full: every top-level key, and every
   `packageRules` entry's manager/dep scope and behavior.
2. Read the target repo's existing `renovate.json5` in full.
3. Add the `extends` entry for `github>chinmina/.github//renovate/shared.json5`
   if not already present.
4. For every top-level key and every `packageRules` entry in the local
   config, classify it against the shared config:
   - **Exact or near-duplicate of a shared rule/key** (same
     managers/deps/behavior) → candidate for deletion. But before deleting,
     check for a **near-miss**: enumerate the shared rule's matchers
     (`matchManagers`, `matchDepTypes`, `matchDepNames`,
     `matchPackageNames`, etc.) and confirm each one actually covers what
     the local rule covers for *this repo's* dependencies. A shared rule
     that looks equivalent but has a narrower matcher is not a duplicate —
     deleting the local rule in that case silently drops coverage. (Example
     of exactly this failure mode: a shared rule unpinning digests for
     `matchPackageNames: ["chinmina/**"]` scoped to `matchDepTypes:
     ["action"]` does not cover reusable-workflow references, which
     Renovate assigns `depType: "workflow"` — a repo consuming reusable
     workflows still needs its own override until the shared rule's matcher
     is widened.)
   - **Local rule targets the same deps as a shared rule but with different
     or conflicting behavior** (different `groupName`, conflicting
     `enabled`/`rangeStrategy`/`allowedVersions`) → do not silently pick one.
     Flag it and report to the caller; this needs a decision.
   - **Local grouping rule that predates the shared config's broad groups**
     → re-derive its justification, don't trust its comment. A rule like
     "keep these three packages together" may have been correct when the
     repo extended nothing, but once a shared broad group already covers
     those managers/deps, a narrower local group **fragments** the shared
     group instead of adding cohesion — the opposite of what its comment
     claims. Re-evaluate whether the narrower grouping is still adding
     value under the shared broad group, and if it now only exists to
     re-split what the shared group already unifies, delete it (or fold its
     intent into one focused group, e.g. a single risk-based group, instead
     of several overlapping ones).
   - **List-valued option (e.g. `postUpdateOptions`) partially duplicated**
     → check whether the option is `mergeable`. If it is, do not delete the
     local values assuming the shared ones supersede them — they
     concatenate. Only remove a local value if it is a literal duplicate of
     a shared value.
5. Delete rules confirmed as true duplicates. Keep rules that are genuinely
   distinct in scope or that exist to work around a current shared-config
   gap (see step 8).
6. Check for dead rules: for every retained local rule (especially custom
   managers/regex matchers), confirm it still matches something in this
   repo. Grep the repo for the patterns it's supposed to match, and check
   `matchDepNames`/`matchPackageNames` targets are still present in the
   manifest. A rule that no longer matches anything is silent debt — delete
   it. (This happens most often when a workflow or tool config changes
   shape, e.g. a version pin moves from an inline value to a `-file`
   reference, or a linter action switches its install mode.)
7. Modernize deprecated syntax while you're in the file — Renovate
   auto-migrates these today, but the shim disappears on some future major
   release, and leaving it in place is invisible debt until then:

   | deprecated | current |
   |---|---|
   | `regexManagers` | `customManagers` with `customType: "regex"` |
   | `fileMatch` | `managerFilePatterns` |
   | `matchDepPatterns: ["^x"]` | `matchDepNames: ["/^x/"]` |
   | `excludeDepNames: ["go"]` | `matchDepNames: ["!go"]` |
   | `matchPackagePatterns` | `matchPackageNames` |

   Regex form is a string wrapped in `/.../`; inner slashes need no
   escaping. A `!`-prefixed pattern negates; a rule with only negative
   patterns matches everything except them.
8. Classify every remaining local rule and act accordingly, don't just
   comment-and-move-on:
   - **Permanent, genuinely repo-specific** (blocked on an upstream
     dependency, a fork-specific exception, a repo-specific post-update
     step) — this is settled; write a comment stating why and stop.
   - **Working around a current gap in the shared config** — this should
     move upstream eventually. Write a comment naming the gap and what
     change to `renovate/shared.json5` would let this rule be deleted, and
     **report it to the caller** so the gap gets tracked/fixed centrally
     instead of silently re-duplicating in every repo that hits it.
   - **Unclear which of the above it is** — don't guess. Report the rule and
     your best read of it to the caller and ask.
9. If the repo uses release-please (check for `release-please-config.json`
   or equivalent), confirm the semantic commit type/scope config actually
   produces the release behavior the repo wants — commit type only affects
   releases in repos wired up to consume it. If the repo doesn't use
   release-please, semantic commit type is cosmetic there and not worth
   scrutinizing further.
10. Validate the result:
    ```bash
    npx --yes --package renovate -- renovate-config-validator --strict
    ```
    Two things to get right:
    - This only checks the file's own syntax/schema. It does **not** resolve
      remote `extends` presets, so it cannot tell you if
      `github>chinmina/.github//renovate/shared.json5` is reachable/correct.
    - Run it from the repo root with **no path argument** so it validates
      the repo's own `renovate.json5` with the correct (repo) schema —
      confirm the output says `Validating renovate.json5`, not `as global
      config`. Passing the file path explicitly makes it validate as
      *global* config against the wrong schema and can report success on an
      invalid repo config.
11. Re-read the resulting file end to end and confirm:
    - No two `packageRules` entries claim the same dependency set with
      different `groupName`s or conflicting behavior.
    - No top-level key locally overrides a shared top-level key unless that
      override is intentional and commented with the reason.
    - Local `packageRules` are ordered broad → narrow, narrowing overrides
      last.
    - Every remaining local rule has been classified per step 8, not just
      commented.
