# Classifying local rules during migration

Classify every `packageRules` entry in the target repo's config **exactly
once**. One classification, one disposition.

Top-level keys need no classification: a local top-level key simply wins over
the preset's. The one exception is `extends` — append the shared preset to an
existing array, never replace it.

| Classification | How to detect it | Disposition |
| --- | --- | --- |
| **duplicate** | Same managers/deps/behaviour as a shared rule, and every shared matcher genuinely covers what the local rule covers *for this repo's dependencies*. | Delete. |
| **near-miss** | Looks equivalent, but enumerating the shared rule's matchers (`matchManagers`, `matchDepTypes`, `matchDepNames`, `matchPackageNames`…) shows one is narrower. | Keep. Comment naming the gap. Report as a shared-config gap. |
| **fragmenting** | A narrow local group that a shared broad group now already covers. Once the shared group unifies those deps, the local group re-splits them. | Delete the `groupName` only. Compare every other option against the shared rule and drop just the literal duplicates — a local scalar may deliberately override the shared value, and mergeable arrays concatenate. Move survivors to a rule of their own. Or fold several overlapping local groups into one focused (e.g. risk-based) group. |
| **conflict** | Targets the same deps as a shared rule and the *effective* option values are incompatible: different `groupName`, contradictory `enabled` / `rangeStrategy` / `allowedVersions`, where the local rule is not a deliberate narrowing override. | Do not silently pick a winner. Escalate. |
| **dead** | No longer matches anything in this repo. | Delete. |
| **repo-specific** | Genuinely local and permanent: blocked on an upstream dependency, a fork-specific exception, a repo-specific post-update step. | Keep. Comment stating why. Settled — no further action. |
| **gap-workaround** | Exists only because the shared config is currently missing something. | Keep. Comment naming the gap and the change to `renovate/shared.json5` that would let it be deleted. Report it. |
| **unclear** | You cannot tell which of the above it is. | Keep. Escalate with your best reading. |

## Overlap is not duplication

Overlapping selectors are normal and supported — see `merge-semantics.md` for
how the options actually combine. Compare **effective option values**, not
selectors, before deciding anything is redundant.

## Checking for near-misses

Before deleting anything as a duplicate, list the shared rule's matchers and
check each against this repo's actual dependencies. A shared rule that looks
equivalent but has a narrower matcher is not a duplicate — deleting the local
rule silently drops coverage.

**Failure mode.** Matchers compose as AND, so the *narrowest* one decides.
A shared rule scoped to both `matchManagers: ["github-actions"]` and
`matchDepTypes: ["action"]` will not apply to a dependency Renovate classifies
under a different `depType`, however exactly the package name matches. Check
every matcher on the shared rule against the dependency in front of you, not
just the most obvious one.

## Checking for dead rules

For every rule you intend to keep — especially custom managers and regex
matchers — prove it still matches something:

```bash
# does the custom manager's file pattern match anything?
rg --files | rg '<managerFilePatterns regex>'

# does the regex still match the file's current shape?
rg '<matchStrings regex>' <matched files>

# are the named deps still in the manifest?
rg '<dep name>' go.mod package.json .github/workflows
```

A rule that matches nothing is silent debt — delete it. This happens most often
when a workflow or tool config changes shape: a version pin moves from an inline
value to a `-file` reference, or a linter action switches its install mode.

## Trusting comments

Don't. Re-derive a rule's justification from the current shared config. "Keep
these three packages together" may have been correct when the repo extended
nothing, and be exactly wrong now.

## Related, but out of scope

If the repo uses release-please (`release-please-config.json` or equivalent),
the semantic commit type/scope inherited from the shared config affects its
release behaviour — confirm it produces what the repo wants. If the repo does
not use release-please, commit type is cosmetic there; don't spend time on it.
