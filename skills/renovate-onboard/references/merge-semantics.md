# Renovate merge semantics

Facts, not judgement calls. Internalise these before deciding what counts as a
clash between a local rule and the shared config.

## Top-level keys

`extends` presets merge first. Local top-level keys apply on top and **win**
outright.

## packageRules

Rules from `extends` are prepended; local rules evaluate after.

Renovate applies **every** matching rule, not one rule per dependency.
Overlapping selectors are a design tool, not a defect: a narrowing override
that re-groups a subset of a broad group, ordered last, is a supported
pattern. Overlap is only a problem when it is undocumented or when the
effective option values contradict each other.

For any given dependency, **the last matching rule wins per-option, not
per-rule**. If two rules both match a dependency, their options merge: only
options that *both* rules set are overridden. Options set by only one rule
survive.

## Mergeable options

A large set of options are `mergeable: true` — including `postUpdateOptions`,
`ignoreDeps` and `labels`. When both a shared and a local rule apply, their
array values **concatenate**; the local one does not replace the shared one.

Do not assume a locally-listed value must be re-added because a shared one
"wins", and do not delete a local value on the assumption the shared value
supersedes it. Only remove a local value when it is a literal duplicate.

**Failure mode.** Deleting a repo's `gomodUpdateImportPaths` because the shared
config already sets `gomodTidy` in `postUpdateOptions` silently breaks major
module bumps. The two options do different things and were both meant to apply;
because the option is mergeable, they concatenate rather than compete.
