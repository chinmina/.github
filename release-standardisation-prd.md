# PRD: Standardised release pipeline (shared workflows + composite actions)

## Problem Statement

Four repos — `chinmina/kms-import`, `<org>/imds-broker`, `<org>/Sandy`, `<org>/relic` — sit on a spectrum from a fully-hardened release process to none at all. `kms-import` is the gold standard: release-please draft-gate, goreleaser, binstaller install script, `actions/attest` provenance, SHA-pinned actions, and a build→attest→publish gate that keeps artifacts non-downloadable until their provenance exists. The three `<org>` repos share a *different*, weaker shape (goreleaser + npm + homebrew, manual tags, no provenance, floating action pins), and `relic` has no release workflow at all.

The result is duplicated, drifting logic. The clearest example: the npm `publish.sh` in `Sandy` and `imds-broker` is the same script that has already diverged — `imds-broker`’s handles Windows/zip and per-target binary names while `Sandy`’s does not, and they use different archive-naming schemes. Provenance, binstaller, and the publish gate exist in exactly one repo. Maintenance happens N times with N-way drift.

## Solution

Extract the release pipeline into shared building blocks hosted in `chinmina/.github`, consumed by all four repos (cross-org for the three `<org>` repos). The split follows what the GitHub Actions platform allows:

- The **release-please trigger half** becomes a **reusable workflow**. It needs job-level `permissions` and `environment`, which composite actions cannot carry.
- The **build → attest → publish half** becomes a **kit of composite actions**, plus one opinionated **wrapper reusable workflow** (`goreleaser-release`) that composes the kit so consuming repos get a near-zero-config release. goreleaser builds both Go and Bun projects, so a single wrapper serves both — no separate Bun workflow.

Every repo moves to the release-please draft-gate trigger model, mise for tool resolution, all distribution channels on-by-default (opt-out per repo), npm provenance, and the existing `@verified-actions` ref convention.

## Requirements

### release-please workflow (trigger half)

1. When a commit is pushed to the default branch, the release-please workflow shall open or update a Release PR reflecting the pending conventional commits.
1. When a Release PR is merged, the release-please workflow shall create a draft GitHub Release for the new version.
1. When a draft release is created, the release-please workflow shall create the corresponding `v*` git tag using the per-org GitHub App token.
1. The release-please workflow shall authenticate as the per-org GitHub App rather than the default `GITHUB_TOKEN`, so that the tag push emits a workflow-triggering event.
1. The release-please workflow shall request only `contents:write` and `pull-requests:write` for the App token.
1. If the App token cannot be minted, then the release-please workflow shall fail before creating any tag or release.
1. If no releasable commits are present, then the release-please workflow shall complete without creating a tag or release.

### Release wrapper (`goreleaser-release`)

1. When a `v*` tag is pushed, the release wrapper shall build artifacts, attest them, and publish the draft release, in that order.
1. The release wrapper shall publish the GitHub Release only after artifact attestation has been recorded.
1. While the GitHub Release remains a draft, the release wrapper shall keep all release assets non-downloadable to the public.
1. The release wrapper shall resolve every build-tool version via mise.
1. The release wrapper shall execute every distribution channel that has not been explicitly disabled.
1. Where a channel’s disable input is set, the release wrapper shall skip that channel.
1. If an enabled distribution channel is missing a required credential, then the release wrapper shall fail before building artifacts and shall name the input that disables that channel.
1. Where a `pre-build` input is provided, the release wrapper shall run it after tool setup and before goreleaser.
1. Where homebrew publication is enabled, the release wrapper shall pass `HOMEBREW_GITHUB_TOKEN` through to goreleaser.
1. While the tag carries a semver pre-release suffix, the release wrapper shall mark the GitHub Release as a pre-release.

### setup-release-toolchain action

1. When invoked with a list of CLI tools, the setup-release-toolchain action shall install them from the repo’s mise configuration in a single cached pass.
1. The setup-release-toolchain action shall set up Go, and Bun when it is declared, via their dedicated setup actions using versions resolved from the mise configuration.
1. If a required tool (a requested CLI, or Go) is absent from the mise configuration, then the setup-release-toolchain action shall fail with an error naming the tool.

### npm-publish-binaries action

1. When invoked after a goreleaser build, the npm-publish-binaries action shall publish one platform package per entry in the supplied platform matrix and one wrapper package.
1. The npm-publish-binaries action shall publish every npm package with provenance enabled.
1. The npm-publish-binaries action shall derive each platform package’s archive name, OS, CPU, and binary name from its inputs rather than from hardcoded values.
1. While the version carries a pre-release suffix, the npm-publish-binaries action shall publish under the `next` dist-tag rather than `latest`.
1. If any archive named by the platform matrix is absent from the dist directory, then the npm-publish-binaries action shall fail before publishing any package.

### binstaller-install-script action

1. When invoked, the binstaller action shall generate `install.sh` from the committed binstaller spec with the current release’s checksums embedded.
1. The binstaller action shall embed checksums into the working copy of the spec only, leaving the committed spec unmodified.
1. If the binstaller spec is absent or invalid, then the binstaller action shall fail before generating an install script.

### attest-artifacts action

1. When invoked, the attest action shall produce build-provenance attestations for the goreleaser checksums file and for `install.sh`.
1. The attest action shall sign attestations keylessly via the workflow OIDC identity.
1. If `id-token:write` permission is unavailable, then the attest action shall fail with a permissions error.

### Supply chain (cross-cutting)

1. Every third-party action referenced inside `chinmina/.github` shall be pinned to a full commit SHA.
1. Each consuming repo shall reference the shared workflows and actions via the `@verified-actions` ref.
1. The release pipeline shall grant each GitHub App token only the permissions required by the step that uses it.

### Deployment environments

1. The release-please workflow shall run its release job in the `automation` environment.
1. The release wrapper shall run its build-attest-publish job in the `release` environment.
1. Each consuming repo shall provide `automation` and `release` environments with protection rules and environment-scoped release secrets.
1. If a consuming repo’s target environment lacks its protection rules, then the migration acceptance check shall fail for that repo.

## Implementation Decisions

**Hosting and reference.** All shared workflows and actions live in `chinmina/.github`: reusable workflows under `.github/workflows/`, composite actions under `.github/actions/<name>/`. The three `<org>` repos consume them cross-org, which requires `chinmina/.github` to remain public and makes `chinmina` the supply-chain root for `<org>` releases. Consumers pin to the `@verified-actions` branch (matching the existing `pr-title.yml` convention); that branch is fast-forwarded only to reviewed commits. Inner third-party actions are SHA-pinned inside the shared repo, so consumers inherit pinned actions through one ref.

**Module split.** The platform forces the shape:

- `release-please.yml` (reusable workflow) — *deep*. A one-line call hides the App-token + draft-release + force-tag sequence that makes a tag push re-trigger the build. Must be a workflow because it sets `permissions` and `environment: automation`.
- `goreleaser-release.yml` (reusable workflow) — thin wrapper: checkout + `setup-release-toolchain` (Go/Bun via their setup actions + mise CLIs), then compose the composites. Inputs: channel disable toggles, `pre-build`. One wrapper for both Go and Bun projects, since goreleaser builds both.
- `npm-publish-binaries` (composite) — *deep, highest-value extraction*. Single implementation of the archive-extract/repack/publish logic that currently drifts between `Sandy` and `imds-broker`. Interface: project name, platform matrix, binary name. Adds `--provenance` and an all-archives-present precheck.
- `setup-release-toolchain` (composite) — *moderately deep*. One upfront installer: “give me these CLIs.” Installs the requested CLIs via a single `mise-action` pass (one coherent cache, vs a per-tool overlapping cache), then sets up Go (and Bun when declared) via their setup actions with versions resolved from mise. Replaces `imds-broker`’s hand-rolled `grep '^goreleaser' .tool-versions | awk`.
- `binstaller-install-script` (composite) — embed-checksums + gen + upload.
- `attest-artifacts` (composite) — attest `checksums.txt` + `install.sh`.

**Not extracted.** `goreleaser-release` stays inlined in the two wrappers — it is a thin call over the official action and a near-empty composite would add indirection without payoff. Homebrew stays inside goreleaser (`homebrew_casks`); the wrapper only forwards `HOMEBREW_GITHUB_TOKEN`, so there is no separate homebrew composite.

**Trigger model.** release-please draft-gate everywhere. release-please creates the draft and tag; the tag triggers the wrapper; goreleaser fills the existing draft (`use_existing_draft`, `mode: keep-existing`); attestation runs; the wrapper flips `--draft=false` last. This is the build→attest→publish gate, applied to all four repos.

**Channels.** On-by-default, opt-out. The wrapper validates each enabled channel’s credentials up front and hard-fails fast (req 14) naming the disable input, because npm and homebrew need external creds (`NODE_AUTH_TOKEN`; a `homebrew-tap` repo + `HOMEBREW_GITHUB_TOKEN`) that a fresh repo may not have.

**Identity.** Per-org GitHub App — the existing `chinmina` app for `kms-import`, a new `<org>` app for the other three. Secrets live in each consuming repo (reusable workflows take them from the caller): `RELEASE_PLEASE_CLIENT_ID`, `RELEASE_PLEASE_APP_PRIVATE_KEY`, plus `HOMEBREW_GITHUB_TOKEN` and `NODE_AUTH_TOKEN` where those channels are enabled.

**Environments.** The `automation` and `release` environments are *named* in the reusable workflows (job-level — composites can’t carry `environment`, and `on.workflow_call` can’t accept it from the caller), but they *resolve in the consuming repo*. So the environments, their protection rules, and their scoped secrets stay defined in each repo, not in `chinmina/.github`; the shared workflow only references the names. With `secrets: inherit` on the caller job, the consumer’s environment-scoped secrets resolve inside the reusable workflow because the job targets that environment. Two consequences drive the requirements above: (1) a referenced-but-unconfigured environment is auto-created *ungated* and the publish gate silently disappears — so environment configuration is a per-repo migration gate, not a centralised guarantee, and the runtime cred check (req 14) won’t catch it; (2) where an environment secret and a caller-inherited secret share a name, the environment-scoped value wins once the job targets the environment, so keep secret scoping consistent (prefer environment-scoped for least privilege).

**GoReleaser edition.** OSS only — none of the repos use `goreleaser-pro`. Pre-build codegen goes in global `before.hooks` (OSS: `go generate`, `just generate`, `bun run prebuild`); the wrapper `pre-build` input is the fallback for anything goreleaser can’t cover. Attestation stays a separate `actions/attest` step *after* goreleaser, never a `before_publish` hook — `before_publish` and global `after` hooks are Pro-only.

## Testing Decisions

- **`npm-publish-binaries`** carries the only non-trivial logic, so it gets real tests: `shellcheck` (Google Shell Style Guide) plus `bats` unit tests over a fixture `dist/` covering the platform-matrix loop, the `next` vs `latest` dist-tag branch (req 23), and the all-archives-present precheck failing before any publish (req 24). Publish itself is exercised in dry-run.
- **`setup-release-toolchain`** gets a light test: resolve known tools from a fixture mise config, and assert the missing-required-tool failure (req 19).
- **Wrappers, `binstaller-install-script`, `attest-artifacts`** are YAML wiring; they are validated by a live canary release in `kms-import` (closest to the target already) and a `workflow_dispatch` smoke path, not unit tests. The canary is the integration test for reqs 8–10, 25–30.
- Each EARS requirement maps to at least one of: a `bats`/`shellcheck` assertion, a `workflow_dispatch` smoke run, or an observable outcome of the canary release (tag created, draft gated, attestation recorded, install script attached).

## Out of Scope

- Docker image publishing, GitLab cross-publish, monorepo release, and macOS signing/notarization beyond keyless attestation.
- Consolidating the `pr-title.yml` pointers — `<org>` repos keep pointing at `<org>/.github` for now.
- Non-release CI workflows (`ci.yml`) and any application-code refactor.
- Hosting the shared code anywhere other than `chinmina/.github` (revisit if cross-org trust becomes a concern).

## Further Notes

**Rollout order.** Build the kit and wrappers in `chinmina/.github`, then migrate in increasing difficulty: `kms-import` first (canary — already closest, validates the gate end-to-end), then `imds-broker`, then `Sandy` (Bun wrapper + npm drift retired), then stand up `relic` from scratch last. `relic` is greenfield for releases and needs `just generate` (templ) as a `before.hook` before goreleaser — the first real exercise of the pre-build path.

**Environment provisioning.** Per-repo acceptance gate: confirm `automation` and `release` exist with protection rules and environment-scoped secrets (`gh api repos/{owner}/{repo}/environments`) before a repo’s first release through the shared workflow. Most repos are already configured this way; `relic` needs both stood up as part of its greenfield migration.

**Cross-org trust.** Because `<org>` repos execute workflows and actions from `chinmina/.github@verified-actions`, advancing that branch is a privileged operation for both orgs. Treat `verified-actions` updates as release events with review.

**Open follow-ups (not blocking v1).** A Bun consumer beyond `Sandy` would justify hardening the Bun build path (goreleaser's bun builder) further; until then it stays minimal. If cross-org trust is later unwanted, the kit can be lifted into a dedicated public repo without changing consumer call sites beyond the `uses:` owner.
