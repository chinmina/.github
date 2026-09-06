# Rationale for the fixed policies

Read only if the caller challenges one of these, or you are tempted to
propose the opposite.

## Why the preset floats on the default branch

`renovate/shared.json5` is declarative config for a bot that only opens PRs.
Automerge is never inherited from it, so the worst case of a bad shared change
is unwanted or missing PRs — visible and reversible.

Contrast this with executable code. Third-party actions run with credentials,
so `.github/zizmor.yml` requires them to be hash-pinned to a full commit SHA.
First-party kit references deliberately track the moving `@verified-actions`
ref instead, because the kit's workflows and composites are verified and
advance together. Declarative bot config needs neither mechanism.

Floating also means a shared-config fix reaches every consuming repo in one
edit, instead of a migration across all of them.

## Why automerge is never in the shared config

Automerge changes the blast radius of every other decision in the file. It is
opt-in per repository, added deliberately by that repo — never introduced
centrally on the assumption it is low-risk.

## Why local rules get promoted rather than copied

A rule that several repos want is a shared-config change. Copying it into each
repo means every future fix is an N-repo migration. But the shared file applies
everywhere, so a bad addition there is a bad addition everywhere — propose,
don't self-merge.
