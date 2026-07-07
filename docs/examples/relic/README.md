# Adopting the release pipeline: `<org>/relic`

relic is a greenfield Go consumer on the **keyless octo-sts** token path. Copy
the files in this directory into `<org>/relic` (preserving paths), then
work the checklist. relic enables the **GitHub release + binstaller** channels
and opts out of homebrew/npm.

## Files to copy

| From here | To in `relic` |
|-----------|---------------|
| `.github/workflows/release-please.yml` | `.github/workflows/release-please.yml` |
| `.github/workflows/release.yml` | `.github/workflows/release.yml` |
| `goreleaser.snippet.yaml` | merge into `.goreleaser.yaml` |

The octo-sts trust policies are **NOT** copied into relic — they live centrally
in `<org>/.github/.github/chainguard/` so a compromised relic workflow
cannot author its own policy. `org-dotgithub/` here holds reference copies of
the three relic-relevant policies as they must exist in that org repo
(`release-please-relic`, `release-relic`, and the shared `release-tap`); they
are added via a reviewed PR to `<org>/.github`.

relic's callers carry no octo-sts scope/identity config: `release-please.yml`
defaults scope to the org and the identity to `release-please-relic`;
`release.yml` (with `token-source: octo-sts`) mints `release-relic`, and
`release-tap` when homebrew is enabled.

You also need (not shown — repo-specific): a release-please config + manifest,
a `mise.toml` declaring `go`, `goreleaser`, and `binstaller`, and a committed
binstaller spec at `.config/binstaller.yml`. `binstaller` is declared in
`mise.toml` with the `[tool_alias]` + `rename_exe = "binst"` block (`rename_exe`,
not the ubi-only `exe`) — see
[Declaring `binstaller`](../../adopting-the-release-pipeline.md#declaring-binstaller).

## Prerequisite checklist (org-admin — gates the FIRST run)

These cannot be done from code and block relic's first release regardless of
the workflows being correct:

- [ ] **octo-sts App installed + authorised on the `<org>` org.**
- [ ] **Central trust policies merged into `<org>/.github`**:
      `release-please-relic`, `release-relic`, and the shared `release-tap`
      (reference copies in `org-dotgithub/`). Without them the mints fail.
- [ ] **`<org>/.github` `main` branch protection** — required PR review,
      no bypass for the octo-sts app. This is the protection that makes
      centralised policy safe (a repo can propose a policy, not self-merge one).
- [ ] **`<org>` org "Allowed actions and reusable workflows" policy permits
      `chinmina/*`** (Settings → Actions → General). Without this the
      `uses: chinmina/.github/...` calls are blocked.
- [ ] **`automation` environment** created in relic with protection rules.
- [ ] **`release` environment** created in relic with protection rules and any
      env-scoped secrets.
- [ ] Verify with `gh api repos/<org>/relic/environments` (R36/R37).

## De-risking step (recommended before the first real release)

Prove the keyless mint in isolation before wiring a full release through it —
it's the only layer with no precedent in your repos. A throwaway job:

```yaml
jobs:
  smoke:
    runs-on: ubuntu-latest
    environment: automation
    permissions:
      id-token: write
      contents: read
    steps:
      - id: sts
        uses: octo-sts/action@a26b0c6455c7f13316f29a8766287f939e75f6c8 # v1.0.2
        with:
          scope: ${{ github.repository_owner }}   # the ORG (central policies)
          identity: release-please-relic          # release-please-<repo>
      - run: gh api user --jq .login   # confirms the minted identity
        env:
          GH_TOKEN: ${{ steps.sts.outputs.token }}
```

If this fails, it is almost always one of: (a) the org App not installed;
(b) the central `release-please-relic` policy not merged into
`<org>/.github`; (c) the policy `subject` not matching the
environment-qualified OIDC subject; or (d) `scope` pointing at the repo instead
of the org.

## Notes

- `release.yml` is the **tag** caller. The filename is deliberately `release.yml`
  so that if relic later adopts npm trusted publishing, the trusted-publisher
  config (which validates the *caller* workflow filename) already matches.
- templ codegen runs in goreleaser `before.hooks` (`just generate`), not via the
  `pre-build` input.
- The `.sts.yaml` `permissions` / `subject` / `claim_pattern` shape should be
  confirmed against the current octo-sts policy schema on first setup.
- Homebrew is off for relic today; the `release-tap` policy is pre-provisioned,
  so enabling it later is just `disable-homebrew:` off + a goreleaser
  `homebrew_casks:` block (not the deprecated `brews:`) pointing at
  `<org>/homebrew-tap`, with `skip_upload: auto` and the quarantine-xattr
  removal hook — see [Step 2d](../../adopting-the-release-pipeline.md#2d-goreleaser-config-keys-merge-into-goreleaseryaml).
- relic's own `README.md` needs the standard `## Installation` (mise + install
  script + manual download blocks — Homebrew off) and `## Verifying releases`
  sections so users can install and verify the attested artifacts the pipeline
  ships. See [Step 2e](../../adopting-the-release-pipeline.md#2e-readmemd--install--verify-sections-align-with-what-the-pipeline-ships)
  and the [`kms-import` README](https://github.com/chinmina/kms-import/blob/main/README.md)
  exemplar.
