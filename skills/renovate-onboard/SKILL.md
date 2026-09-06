---
name: renovate-onboard
description: >
  Onboard or update a target repository's root renovate.json5 so it extends the
  shared chinmina config hosted in chinmina/.github at renovate/shared.json5.
  Use when asked to onboard renovate, create/add a repo's renovate.json5, or
  review/migrate an existing renovate.json5 for rules that clash with,
  duplicate, or have been superseded by the shared config.
compatibility: >
  Requires network access; npx (Node 20+) to run renovate-config-validator;
  and, when working outside a chinmina/.github checkout, an authenticated gh
  CLI with read access to chinmina/.github.
---

# Renovate onboarding

Target repos extend the shared config; they do not re-declare its rules.

**Decide vs escalate**: merge semantics, validation results, dead rules and
true duplicates are mechanical — apply them without asking. Whether a group is
still justified, whether a workaround belongs upstream, or whether a rule is
permanent are judgement calls — report them, don't guess.

## Before you start

1. **Read the shared config — never work from memory.** It changes over time,
   so no summary of it is trustworthy, including one written in this skill.
   - In a `chinmina/.github` checkout: read `renovate/shared.json5`.
   - Anywhere else, fetch it. Keep the `&&` — piping straight into `base64`
     hides a failed fetch behind a decode error:
     ```bash
     gh api repos/chinmina/.github/contents/renovate/shared.json5 \
       --jq '.content' > /tmp/shared.b64 && base64 -d /tmp/shared.b64
     ```
   - `github>chinmina/.github//renovate/shared.json5` is a Renovate preset
     identifier for use in `extends`. It is not a fetch command.
2. **Read `references/merge-semantics.md`.** Getting merge order backwards
   deletes working config silently.
3. **Confirm which repo you are editing.** This skill edits the *target*
   repo's root `renovate.json5`. Never edit `renovate/shared.json5` without
   the caller's explicit agreement — it applies to every consuming repo.

## Fixed policies

Apply these; don't relitigate them.

- **Float the preset on the default branch.** Never pin it to a ref and never
  propose pinning it — a shared-config fix then reaches every repo in one edit.
- **Never put `automerge` in the shared config.** It is opt-in per repo.
- **Promote, don't duplicate.** A local rule other repos would also want is a
  proposal to change `renovate/shared.json5` — raise it with the caller.

## Workflow A — new or replacement config

1. Copy `assets/renovate.json5` to the target repo root.
2. Add repo-specific config on top of `extends` only for things genuinely
   specific to this repo. Order local `packageRules` broad → narrow: grouping
   rules first, narrowing overrides (`pinDigests`, `enabled`,
   `allowedVersions`, single-dependency exceptions) last, with a comment
   noting the ordering is intentional.
3. Validate and finish (below).

## Workflow B — migrate an existing config

1. Read the shared config in full: every top-level key, and every
   `packageRules` entry's manager/dep scope and behaviour.
2. Read the target repo's `renovate.json5` in full.
3. Add the `extends` entry if absent.
4. Classify **every** `packageRules` entry exactly once, using the table in
   `references/migration.md`. Each rule gets one classification and one
   disposition: delete, keep (with a comment stating why), or escalate.
5. Apply the dispositions. Re-order the surviving local rules broad → narrow.
6. Validate and finish (below).

## Validate and finish

Run the validator via the bundled wrapper — it forces repo-config validation,
which the bare command does not. Run it **from the target repo root**, since
it autodetects the config there:

```bash
# validates the repo's own config
${CLAUDE_SKILL_DIR}/scripts/validate.sh

# validates any file as a repo config
${CLAUDE_SKILL_DIR}/scripts/validate.sh path/to/cfg.json5
```

`--strict` fails on deprecated syntax that Renovate would otherwise
auto-migrate. Apply whatever migration it reports rather than leaving the
shim in place. The validator does **not** resolve remote `extends` presets, so
it cannot confirm the shared preset is reachable or correct.

Then re-read the file end to end and confirm:

- [ ] Every overlap between `packageRules` entries is intentional: ordered
      narrow-last and commented.
- [ ] No top-level key overrides a shared top-level key unless intentional and
      commented with the reason.
- [ ] Local `packageRules` run broad → narrow, narrowing overrides last.
- [ ] Every surviving local rule was classified, not merely commented.
- [ ] Every retained `mergeable` list value is not a literal duplicate of a
      shared value.

## Report to the caller

Always close with this table, even when nothing needs a decision:

| Rule / key | Classification | Action taken | Decision needed |
| --- | --- | --- | --- |
| `packageRules[2]` grouping `aws-sdk-*` | fragmenting | deleted — shared broad group already covers it | — |
| `postUpdateOptions: gomodUpdateImportPaths` | repo-specific | kept + commented | — |
| custom manager for `.tool-versions` pins | gap-workaround | kept + commented | add an equivalent shared custom manager? |

Then list separately, as explicit asks:

- **Shared-config gaps** — each near-miss or gap-workaround, with the change to
  `renovate/shared.json5` that would let the local rule be deleted.
- **Open questions** — each conflict or unclear rule, with your best reading
  and the decision you need.
