# Plan: Standardised release pipeline (shared workflows + composite actions)

> Source PRD: `release-standardisation-prd.md` (37 EARS requirements across release-please workflow, release wrappers, four composite actions, supply chain, and deployment environments).

## Revisions folded in (2026-06-12 plan review)

This revision integrates the outcomes of a plan-vs-PRD review. Decisions confirmed with the maintainer and factual platform locks applied:

- **R1. octo-sts proving ground — `relic` stays the Phase 1 keyless canary** (as originally written). Phase 1 therefore has explicit external prerequisites (org App install, org Actions policy, relic `automation` env) — see Phase 1 *Prerequisites*.
- **R2. Phase 7 cross-org templates — premise corrected.** Org workflow templates are **org-scoped**; a public `.github` repo does **not** surface them to other orgs' "New workflow" pickers. So chinmina's templates reach **chinmina-org repos only** (`kms-import`). Self-service onboarding for the three `<org>` repos is **deferred** ("later problem") — Phase 7 no longer claims a cross-org picker.
- **R3. Phase 2–3 canaries are pre-release / throwaway tags**, never the `latest` users resolve. This removes the user-facing-`install.sh`-gap risk during Phase 2 and doubles as the R17 pre-release-marking test.
- **R4. mise is the version *authority*, `setup-go`/`setup-bun` install.** The mise config is the single source of truth for every build-tool version. `setup-release-toolchain` installs the release CLIs (goreleaser, binstaller, templ) via mise, and resolves the Go/Bun versions *from* mise to feed `setup-go`/`setup-bun` (which keep language module/build caching). Reading versions from mise — rather than the setup actions' own version-file inputs — keeps mise authoritative even when versions live in `mise.toml`. R11 is scoped to "mise is the authority for every build-tool version," not "mise is the installer for every tool."
- **L1 (lock). Attestation uses `subject-checksums` mode** — the checksums file is passed to `actions/attest-build-provenance`'s `subject-checksums` input so **each archive listed is individually attested**, which is what makes `gh attestation verify <archive>` pass. Moved from flex to locked in Phase 2.
- **L2 (lock). release-please creates the draft release *without* a git tag**; the `v*` tag is pushed by a separate step using the minted installation token, so the push triggers the wrapper (R4). Moved from flex to locked in Phase 1.
- **L3 (lock). R6 gets a negative-path acceptance test** in Phase 1 (token-mint failure → no tag, no release).
- **L4 (note). Homebrew tap auth is keyless on the octo-sts path, PAT on the App path.** Repos on the octo-sts path mint the shared `release-tap` token in the wrapper (no stored secret); App-path repos still use the long-lived `HOMEBREW_GITHUB_TOKEN` — a conscious R33 exception for v1.
- **P1 (prereq). The `<org>` org "Allowed actions and reusable workflows" policy must permit `chinmina/*`** for cross-org consumption — added to Phase 1 prerequisites.

## Architectural decisions

Durable decisions that apply across all phases:

- **Hosting layout** (all in `chinmina/.github`):
  - Reusable workflows → `.github/workflows/` (`release-please.yml`, `goreleaser-release.yml`).
  - Composite actions → `.github/actions/<name>/action.yml` (`setup-release-toolchain`, `npm-publish-binaries`, `binstaller-install-script`, `attest-artifacts`).
  - Org template workflows → `.github/workflow-templates/` (`<name>.yml` + `<name>.properties.json`). **These surface only to repositories in the `chinmina` org** (org-scoped; public visibility does *not* extend the picker cross-org). The three `<org>` repos are onboarded by other means (deferred — see Phase 7).
- **Reference convention**: consumers pin shared workflows/actions at `@verified-actions` (fast-forwarded only to reviewed commits). The `verified-actions` branch must be **created and its fast-forward discipline established as part of Phase 1** — it does not yet exist (current convention precedent is `conventional-pr-title.yml`, today on `main`). All third-party actions *inside* `chinmina/.github` are SHA-pinned.
- **Trigger model**: release-please draft-gate everywhere. release-please creates the **draft release without a git tag**; a separate step pushes the `v*` tag using a minted installation token (App for chinmina, octo-sts for another organisation — never `GITHUB_TOKEN`, so the tag push triggers a wrapper); goreleaser fills the existing draft; attestation runs; the wrapper un-drafts last. The publish gate = nothing downloadable before its provenance exists.
- **Channel model**: all distribution channels on-by-default, opt-out per repo. The wrapper validates each enabled channel's credentials up front and hard-fails fast, naming the disable input.
- **Environment model**: `automation` (release-please) and `release` (wrapper build/publish job) are *named* in the reusable workflows but *resolve in the consuming repo*. Each repo owns its environments, protection rules, and environment-scoped secrets; `secrets: inherit` carries them into the reusable workflow. A missing environment fails open (auto-created ungated) — so environment configuration is a per-repo migration gate, verified by API.
- **Identity / token source** (per-consuming-repo, via a `token-source` input on `release-please.yml`):
  - **chinmina repos → GitHub App.** Existing `chinmina` app; environment-scoped secrets `RELEASE_PLEASE_CLIENT_ID` + `RELEASE_PLEASE_APP_PRIVATE_KEY`. `kms-import` keeps this unchanged.
  - **<org> repos → octo-sts (keyless).** No stored private key; the octo-sts App installed on the `<org>` org, OIDC federation gated by **centralised trust policies in the org's `.github` repo** (`.github/chainguard/release-please-<repo>.sts.yaml` etc.) — not in the consuming repo, so a compromised consumer workflow cannot author its own policy. Both paths return a GitHub App *installation* token, so downstream-trigger behaviour (R4) and least-privilege scoping (R5) hold identically.
  - Other secrets remain per-repo, environment-scoped: `HOMEBREW_GITHUB_TOKEN` (App path only), `NODE_AUTH_TOKEN` (where those channels are token-based; see Phase 4/5 for the npm OIDC path). **On the octo-sts path the tap write is a keyless `release-tap` mint (no PAT); `HOMEBREW_GITHUB_TOKEN` remains only on the App path, a known, accepted exception to R33's "scoped App token" posture for v1.**
- **Cross-org prerequisites**: because `<org>` repos call workflows/actions from `chinmina/.github`, the **`<org>` org's "Allowed actions and reusable workflows" policy must permit `chinmina/*`**, and the octo-sts App must be installed and authorised on the `<org>` org. Both are migration gates, not code.
- **GoReleaser edition**: OSS only. Pre-build codegen via global `before.hooks`; attestation as a separate `actions/attest` step after goreleaser (never `before_publish` — that's Pro).
- **mise as version authority**: the mise config is the single source of truth for tool versions. `setup-release-toolchain` installs the release CLIs via mise in one cached pass and feeds Go/Bun versions resolved from mise to `setup-go`/`setup-bun` (preserving language module/build caching). R11 is satisfied by mise being the *authority*, not necessarily the installer.
- **Documentation is a per-phase deliverable, not a final bolt-on**: every action/workflow ships with a contract block (inputs, outputs, required permissions, required secrets/env) in its own README, and every phase updates the two living Mermaid diagrams in the repo root README:
  - **Sequence diagram**: push → Release PR → merge → draft+tag → wrapper build → attest → publish.
  - **Component map**: which repo holds which artifact, who calls whom at `@verified-actions`, and the `automation`/`release` environment + secret boundaries annotated per consuming repo.

## Normalization notes

The PRD is already in EARS with stable numeric IDs 1–37. This plan references them as `R1`–`R37` (identity mapping: PRD requirement *N* → `R<N>`, flattened cumulatively across the PRD's per-section lists). The wrapper section contributes 10 requirements (R8–R17); any reference to "R8–R18" for the wrappers would be off by one. No re-normalization was needed.

## P0 baseline and standard quality gate

`chinmina/.github` currently holds only `conventional-pr-title.yml` (plus the org `profile/README.md`), so the gate is established as part of this work and run before Phase 1 completes. Establishing the `verified-actions` branch + fast-forward discipline is part of this baseline.

Standard commands (run from the shared repo; also the per-phase completion gate):

- [ ] `actionlint` — lint all workflow and action YAML.
- [ ] `zizmor .` — GitHub Actions security lint (unpinned actions, injection, token scope).
- [ ] `shellcheck` + `shfmt -d -i 2 -ci` — shell correctness and Google Shell Style Guide formatting for all composite-action shell.
- [ ] `bats test/` — shell unit tests (meaningful from Phase 4; no-op before).
- [ ] **Integration gate**: a live canary release in the phase's target repo produces the expected, observable GitHub Release state (draft → attested → published).

Rules: run the full gate before marking any phase complete; if the P0 baseline can't pass on the empty/scaffold repo, add stabilization (lint config, `bats` harness) before Phase 1. Do not advance while the gate is red.

-----

## Phase 1: `release-please.yml` reusable workflow (trigger half)

**EARS requirements**: R1, R2, R3, R4, R5, R6, R7, R31, R32, R33, R34

### Why this phase exists

Get the thinnest *complete* path through shared code first: a real merge to `main` produces a Release PR, and merging it produces a draft release + `v*` tag — all driven by a workflow that now lives in `chinmina/.github`. This proves cross-repo consumption, the `@verified-actions` ref, and the repo scaffold before any build complexity. It also proves **both** token sources up front, because that fork can't be deferred: `kms-import` exercises the App path; `relic` adopts the `release-please.yml` (trigger half only) to exercise the keyless octo-sts path, so the keyless identity model is de-risked before `imds-broker`/`Sandy` depend on it in Phases 4–5. (`relic`'s full build/attest/publish still lands in Phase 6.)

### Prerequisites (external / org-admin — gate Phase 1 completion)

- [ ] **octo-sts App installed and authorised on the `<org>` org** (required for relic's keyless path).
- [ ] **`<org>` org "Allowed actions and reusable workflows" policy permits `chinmina/*`** (required for any cross-org `uses:` of chinmina/.github).
- [ ] **`relic` `automation` environment provisioned** with protection rules + scoped secrets (relic needs none for the keyless path beyond the env existing and being gated; `automation` must exist so the OIDC subject is environment-qualified).
- [ ] **`verified-actions` branch created** in `chinmina/.github` with fast-forward-only discipline.

### Locked decisions (non-negotiable)

- The minted token grants `contents:write` + `pull-requests:write` only (R5); job runs in `automation` environment (R34) and requests `id-token: write` (needed for the octo-sts path; harmless for the App path).
- **release-please creates the draft release *without* creating the git tag (L2).** The `v*` tag is created by a separate step using the minted installation token (not `GITHUB_TOKEN`) so the tag push can trigger downstream (R4) — preserve kms-import's explicit `git/refs` tag-creation step. If release-please pushed the tag itself with `GITHUB_TOKEN`, the downstream trigger would silently die.
- **Token source is a per-repo `token-source` input** (`app` | `octo-sts`), default `app` so `kms-import` needs no extra input. chinmina → `app`; another organisation → `octo-sts`. Two conditional steps produce one consumed token; the token is never re-emitted to a self-defined `GITHUB_OUTPUT` (use the inline `||` expression to keep it masked).
- **octo-sts trust policy** lives **centrally in the org's `.github` repo** at `.github/chainguard/release-please-<repo>.sts.yaml` (octo-sts `scope` defaults to the org), not in the consuming repo — so a consumer cannot author the policy that elevates itself; onboarding is a reviewed PR to `<org>/.github`. Because the job runs in the `automation` environment, the OIDC `sub` is environment-qualified — the policy `subject` MUST be `repo:<org>/<repo>:environment:automation`, not the `:ref:refs/heads/main` form. Per-repo identities keep each token scoped to its own repo (`release-please.yml` auto-derives `release-please-<repo>`).
- Consumers reference `chinmina/.github/.github/workflows/release-please.yml@verified-actions` (R32); inner actions SHA-pinned (R31).

### Flex zone (implementation choice allowed)

- Input surface (e.g. `release-type`, config path) and defaults.
- Internal step ordering and naming; whether tag creation is inline `gh api` or a small helper.
- README/diagram styling.

### End-to-end behaviour to implement

`release-please.yml` exposes `workflow_call`, mints the installation token via the selected `token-source` (App or octo-sts), runs release-please to open/update the Release PR, and on `release_created` creates the `v*` tag (draft-without-tag, then explicit tag push per L2). `kms-import` replaces its inline `release-please.yml` body with a call to the shared workflow (`token-source: app`) + `secrets: inherit`. `relic` adds the same caller with `token-source: octo-sts`; its `release-please-relic` trust policy lives centrally in the org's `.github` repo (added by PR), and the octo-sts App is installed on the `<org>` org.

### Acceptance criteria

- [ ] `[observable]` A merge to `kms-import` `main` opens/updates a Release PR (App path).
- [ ] `[observable]` A merge to `relic` `main` opens/updates a Release PR with **no stored private key** — token minted via octo-sts OIDC federation (keyless path).
- [ ] `[observable]` Merging the Release PR creates a draft GitHub Release and a `v*` tag visible in the repo (both repos). **Clean up the relic draft + tag afterward** — nothing consumes them until Phase 6, so they would otherwise dangle.
- [ ] `[observable]` The created tag is attributed to the minted App/installation identity (not `github-actions[bot]`), confirming downstream-trigger capability (R4). *(Full trigger validation — the tag push actually starting a wrapper — lands in Phase 2 once a wrapper exists.)*
- [ ] `[observable]` With no releasable commits, the workflow completes creating neither tag nor release (R7).
- [ ] `[observable]` **(L3 / R6)** When token minting fails (break the octo-sts subject or App key in a branch), the workflow fails **before** creating any tag or release.
- [ ] `[structural]` Minted token grants only `contents`+`pull-requests` write (R5); job targets `automation` and requests `id-token: write` (R34); inner actions SHA-pinned (R31).
- [ ] `[structural]` `relic`'s trust policy `subject` is environment-qualified (`:environment:automation`) and scoped to `relic` only.
- [ ] `[structural]` Repo README carries the initial sequence + component diagrams and a `release-please` contract block documenting both token sources.

### Verification

Trigger a real (throwaway) conventional commit on a `kms-import` branch, merge to `main`, observe the Release PR; merge it; inspect the draft release + tag + tag author in the GitHub UI/API. Run the standard gate.

### Replan triggers

- Minted token can't be obtained from a reusable workflow — App path: `secrets: inherit`/env scoping blocks it (R6); octo-sts path: OIDC `sub` doesn't match the trust policy (most likely the environment-qualified subject), or the octo-sts App isn't installed/authorised on the `<org>` org.
- Tag created via shared workflow fails to emit a tag-push event (would undermine Phase 2's trigger) — verify separately for both token sources, since the installation-token trigger behaviour must hold for octo-sts as well as the App.

-----

## Phase 2: `setup-release-toolchain` + `goreleaser-release.yml` spine (GH release + checksum attestation)

**EARS requirements**: R8, R9, R10, R11(partial), R12(partial), R17, R18, R19, R28(checksums), R29, R30, R35

**Carry-forward / entry check**: Re-verify Phase 1 (Release PR → draft → tag) still fires end-to-end before starting. **Now that a wrapper exists, explicitly confirm the tag push actually *triggers* it for both token sources — this is the full validation of R4 that Phase 1 could only partially assert.**

### Why this phase exists

Stand up the backbone: a tag from Phase 1 triggers a wrapper that builds with goreleaser, attests the checksums, and only then publishes the draft. This is the build→attest→publish gate with the simplest channel set (GitHub release only — no binstaller/npm/homebrew yet), proven on `kms-import`.

### Locked decisions (non-negotiable)

- Order is build → attest → publish; publish (`--draft=false`) happens only after attestation is recorded (R8, R9); draft assets stay non-public until then (R10).
- Build job runs in `release` environment (R35); attestation is keyless via OIDC (R29) and requires `id-token:write` (R30).
- Tool versions resolve from the mise config via `setup-release-toolchain`: release CLIs install through mise; **the Go version is read from mise and passed to `setup-go`** (mise-authority, R11, R18).
- `actions/attest` is a separate post-goreleaser step (not a goreleaser hook).
- **(L1) Attestation subject mode is `subject-checksums`** — pass `dist/checksums.txt` to `actions/attest-build-provenance`'s `subject-checksums` input so each listed archive is an individually attested subject. This is what makes `gh attestation verify <archive>` succeed; attesting `checksums.txt` as a single blob would not.
- **(R3) Canary releases on `kms-import` use pre-release / throwaway tags** (e.g. an `-rc`/`-canary` semver suffix), never `latest`. This keeps the temporarily-missing `install.sh` (binstaller off until Phase 3) invisible to users and simultaneously exercises R17.

### Flex zone (implementation choice allowed)

- `setup-release-toolchain` internals (single `mise-action` install pass + version extraction feeding setup-go/setup-bun) behind its `mise-tools` input (R18).
- Wrapper input names for channel toggles (stubbed here, wired in Phase 4).
- Whether `goreleaser-release` stays inlined (preferred) or is a thin step.

### End-to-end behaviour to implement

`goreleaser-release.yml` (`workflow_call`, `on push tags: v*` in the consumer): checkout → `setup-release-toolchain` (mise installs goreleaser; Go set up via setup-go with its version from mise) → goreleaser `release --clean` (fills existing draft) → `attest-artifacts` over `dist/checksums.txt` via `subject-checksums` → un-draft. `setup-release-toolchain` and `attest-artifacts` (checksums subject) ship as composite actions. `kms-import` calls `goreleaser-release.yml` for the tag half (binstaller temporarily disabled).

### Acceptance criteria

- [ ] `[observable]` A `kms-import` pre-release tag drives a release that is published only after a provenance attestation exists for each archive (verify with `gh attestation verify <archive>`).
- [ ] `[observable]` Before the publish step, the release is a draft with non-downloadable assets (R10).
- [ ] `[observable]` A pre-release-suffixed tag yields a release marked pre-release (R17) — satisfied by the canary tag itself.
- [ ] `[observable]` `setup-release-toolchain` fails with a tool-naming error when a required tool is absent from mise config (R19).
- [ ] `[structural]` Build job targets `release`; attest step declares `id-token:write` (R30, R35); attest uses `subject-checksums` (L1).
- [ ] `[structural]` `setup-release-toolchain` + `attest-artifacts` READMEs document inputs/permissions; diagrams updated.

### Verification

Cut a real `kms-import` **pre-release** through the shared wrapper; watch the draft fill, the attest step record, then publish; run `gh attestation verify` against an archive. Force a bad mise tool name in a branch to observe R19. Run the standard gate.

### Regression watchpoints

- `kms-import`'s existing release notes/draft must not be overwritten (goreleaser `use_existing_draft`/`keep-existing`).
- Binstaller is temporarily off — pre-release canaries ensure no consumer resolves a `latest` without `install.sh` this phase.

### Replan triggers

- OIDC/attestation permission can't be granted through the wrapper's `release` environment job.
- goreleaser OSS can't fill the release-please draft as configured.

-----

## Phase 3: `binstaller-install-script` + extend attestation to `install.sh`

**EARS requirements**: R25, R26, R27, R28(install.sh)

**Carry-forward**: Re-verify the Phase 2 gate (attest-before-publish) on `kms-import`.

### Why this phase exists

Re-home kms-import's existing binstaller step into the kit so every repo can ship a curl-able, attested installer. Restores the `install.sh` channel that Phase 2 parked, now sourced from a shared action.

### Locked decisions (non-negotiable)

- Checksums embed into the spec's working copy only; committed spec untouched (R26).
- `install.sh` is generated from the committed binstaller spec (R25) and attested separately (R28); install.sh attestation transitively covers the archives via embedded checksums.
- Binstaller version resolves via `setup-release-toolchain` (added to its `mise-tools`).
- Phase 3 canaries on `kms-import` remain pre-release / throwaway tags (R3) until binstaller is confirmed restored.

### Flex zone (implementation choice allowed)

- Whether `attest-artifacts` takes both subjects in one invocation or install.sh is a second call.
- Action input shape (spec path, version source).

### End-to-end behaviour to implement

`binstaller-install-script` action: resolve binst via mise → `embed-checksums` (working copy) → `gen` → upload `install.sh` to the release. `attest-artifacts` extended to attest `install.sh`. `goreleaser-release.yml` calls both between goreleaser and publish, behind the (still default-on) binstaller channel.

### Acceptance criteria

- [ ] `[observable]` A `kms-import` release attaches an `install.sh` carrying its own provenance attestation (`gh attestation verify install.sh`).
- [ ] `[observable]` Running the generated `install.sh` downloads and verifies an archive against embedded checksums.
- [ ] `[observable]` A missing/invalid spec fails the action before generating a script (R27).
- [ ] `[structural]` Committed binstaller spec is unmodified after a release run (R26).
- [ ] `[structural]` `binstaller-install-script` README documents the spec contract; diagrams updated.

### Verification

Release `kms-import` (pre-release canary); download and execute `install.sh` in a clean container; verify attestation; `git status` the spec post-run. Corrupt the spec in a branch to observe R27. Run the standard gate.

### Replan triggers

- binstaller output format changes break the attest subject wiring.

-----

## Phase 4: channel toggles + credential pre-check + `npm-publish-binaries`

**EARS requirements**: R12(full), R13, R14, R16, R20, R21, R22, R23, R24

**Carry-forward**: Re-verify Phases 2–3 on `kms-import` (it stays GH+binstaller, npm/homebrew disabled).

### Why this phase exists

Bring the multi-channel path and the deepest module online, proven on `imds-broker` (Go + npm + homebrew). This retires the drifting `publish.sh` into one tested composite and adds the opt-out + fail-fast credential model.

### Locked decisions (non-negotiable)

- Every non-disabled channel executes (R12); a `disable-*` input skips its channel (R13).
- Missing credentials for an enabled channel fail *before build*, naming the disable input (R14).
- `npm-publish-binaries` derives archive name / os / cpu / binary from inputs, not hardcoded values (R22); publishes with `--provenance` (R21); uses `next` dist-tag for pre-releases (R23); validates all matrix archives present before publishing any (R24).
- **Identity-bound package fields are derived, not hardcoded.** `repository.url` (and `homepage`) in every generated `package.json` come from `${{ github.repository }}`, not per-package string literals. This is the same canonical value GitHub puts in the OIDC `repository` claim and the provenance source URL, so it cannot drift from what the attestation embeds — a hardcoded literal that diverges (wrong casing, or a stale name copied into a new repo) can fail provenance verification, which is miserable to debug. Killing the literal also deletes a drift class this whole effort targets.
- **npm publish identity**: token + `--provenance` is the *default*, because it works on a package's first publish and needs no per-package web config. Trusted publishing (OIDC, no token) is a documented *opt-in* per repo once its packages exist and are configured — not the zero-config default, because each package needs a manual first-publish + per-package trusted-publisher setup that can't be automated in CI. `Sandy` is already on trusted publishing (bootstrap done); `imds-broker` starts on the token path.
- Homebrew stays inside goreleaser; the wrapper forwards the tap write token (R16) — `HOMEBREW_GITHUB_TOKEN` on the App path (the accepted R33 PAT exception for v1), or a keyless `release-tap` octo-sts mint on the octo-sts path.

### Flex zone (implementation choice allowed)

- Input schema for the platform matrix (per-target list vs structured object).
- Where the cred pre-check lives (wrapper step vs tiny composite).
- `bats` fixture layout.

### Open questions / risk burn-down

- Trusted publishing is confirmed working on `Sandy` (provenance verified, transparency-log entry present), so OIDC provenance is proven on the Bun path. Open question is the *default* for the shared composite: token + `--provenance` (portable, works first-publish) vs trusted publishing (no token, but per-package bootstrap). Locked above as token-default / TP-opt-in.
- Spike the token-path `--provenance` from the *reusable-workflow* OIDC context for a scoped package (publish a `next`-tagged pre-release of one `imds-broker` platform package first). Note: provenance will name `chinmina/.github`'s `goreleaser-release.yml` as the builder workflow while the `repository`/source claim is `imds-broker` — that is correct and expected.
- **Trusted-publishing + `workflow_call` caveat** (applies to any repo that opts into TP through the shared wrapper): npm validates the *caller* workflow's filename, not the shared workflow that runs `npm publish`, and `id-token: write` must be on both. So a repo's trusted-publisher config must name its own `release.yml`, and the opt-in docs must say so.
- Decide hard-fail (R14, current) vs skip-with-warning — locked as hard-fail unless the spike shows it blocks legitimate first releases.

### End-to-end behaviour to implement

`npm-publish-binaries` composite implements the extract/repack/publish loop once (project name + matrix + binary name inputs), with provenance, pre-release dist-tag, and an all-archives-present precheck. `goreleaser-release.yml` gains channel toggles + the up-front cred pre-check. `imds-broker` migrates to release-please (Phase 1 workflow) + `goreleaser-release.yml` with npm+homebrew enabled.

### Acceptance criteria

- [ ] `[observable]` An `imds-broker` release publishes all platform npm packages + the wrapper package, each showing npm provenance, plus a homebrew cask update (R20, R21, R16).
- [ ] `[observable]` A pre-release tag publishes under `next`, not `latest` (R23).
- [ ] `[observable]` With npm enabled but `NODE_AUTH_TOKEN` absent, the run fails before build and names the disable input (R14).
- [ ] `[observable]` A deliberately missing platform archive fails the action before any package is published (R24).
- [ ] `[structural]` `bats` covers the matrix loop, dist-tag branch, and precheck; `shellcheck`/`shfmt` clean (Google style).
- [ ] `[structural]` Package metadata fields trace to inputs, not literals (R22); `repository.url`/`homepage` derive from `${{ github.repository }}` with no hardcoded repo name; `npm-publish-binaries` README documents the contract; diagrams updated.

### Verification

Release `imds-broker` (real patch + a pre-release) through the shared wrapper; inspect npm provenance on the registry, the homebrew tap commit, and the `next` tag; run the missing-token and missing-archive failure paths in branches; run `bats`. Run the standard gate.

### Regression watchpoints

- Windows zip vs tar.gz handling and `.exe` binary naming (imds-broker's superset behaviour must survive the extraction).
- `imds-broker` switching from manual tags to release-please must not double-release.

### Replan triggers

- npm provenance unavailable from the wrapper context → revisit R21 / npm publish identity.
- Matrix input shape can't express all six imds-broker targets cleanly.

-----

## Phase 5: Bun path via `goreleaser-release.yml` + Sandy migration

**EARS requirements**: R11(bun), R15(exercised), R36(Sandy), plus reuse of R8–R14, R20–R24

**Carry-forward**: Re-verify the npm path (Phase 4) since Sandy shares `npm-publish-binaries`.

### Why this phase exists

Prove the Bun toolchain path reuses the same kit, and retire Sandy's drifted `publish.sh`. First real exercise of `pre-build` via goreleaser `before.hooks` (`bun install` / `bun run prebuild`).

### Locked decisions (non-negotiable)

- No separate Bun workflow: Sandy uses the same `goreleaser-release.yml`. `setup-release-toolchain` auto-detects Bun from mise (runs `setup-bun`) and goreleaser builds via its bun builder; same attest/publish gate and channels as the Go path. **Bun version resolves from the mise config** (mise-authority, R11).
- Sandy's prebuild runs in goreleaser global `before.hooks`; wrapper `pre-build` input is fallback only (R15).
- Sandy reuses `npm-publish-binaries` (no Sandy-specific publish logic survives).

### Flex zone (implementation choice allowed)

- Sandy's goreleaser bun-builder config shape (the consumer owns it; the wrapper stays toolchain-agnostic).
- Sandy's homebrew cask post-install hooks remain goreleaser-owned.

### End-to-end behaviour to implement

Sandy declares `bun` in mise and adopts the existing `goreleaser-release.yml`, which sets up Bun via setup-bun, runs the goreleaser bun-builder release, attests, runs `npm-publish-binaries`, and publishes. Sandy migrates to release-please + `goreleaser-release.yml`; its `publish.sh` is deleted.

### Acceptance criteria

- [ ] `[observable]` A Sandy release publishes attested archives + npm platform packages with provenance via the shared wrapper.
- [ ] `[observable]` Sandy's prebuild runs before build with no bespoke workflow step (R15).
- [ ] `[observable]` The build→attest→publish gate holds identically to the Go path.
- [ ] `[structural]` Sandy's `publish.sh` is removed; no Sandy-local publish logic remains.
- [ ] `[structural]` `goreleaser-release` README + diagrams updated to show the Bun toolchain path.

### Verification

Release Sandy through `goreleaser-release.yml`; verify attestation + npm provenance; confirm `publish.sh` deletion and that prebuild ran via goreleaser logs. Run the standard gate.

### Regression watchpoints

- Sandy's archive naming (`sandy-<ver>-<os>-<arch>`) differs from imds-broker's scheme — the shared matrix input must express it without reintroducing per-repo script logic.
- Sandy already publishes via trusted publishing, whose config names the caller workflow `release.yml`. Keep Sandy's caller workflow filename `release.yml` (or update its npm trusted-publisher config) so the OIDC caller-name validation keeps matching; `id-token: write` must be on both Sandy's caller and `goreleaser-release.yml`.
- Sandy's generated packages currently hardcode a lowercase `repository.url` that happens to match; switching to the derived `${{ github.repository }}` value must preserve the verifying form (canonical `<org>/sandy`).

### Replan triggers

- goreleaser bun builder + OSS `before.hooks` can't cover Sandy's prebuild → fall back to wrapper `pre-build` and note the divergence.

-----

## Phase 6: `relic` greenfield release + templ pre-build + environment provisioning

**EARS requirements**: R15(real), R36, R37

**Carry-forward**: Re-verify the Go path (Phases 2–4) since relic is a fresh Go consumer.

### Why this phase exists

Stand up relic's first-ever *full* release purely by adopting the shared kit — the proof the standard works greenfield. relic's trigger half (`release-please.yml` + octo-sts trust policy + `automation` environment) already landed in Phase 1 as the octo-sts canary, so this phase adds the build half: `goreleaser-release.yml`, the `release` environment, and templ codegen as a `before.hook`.

### Locked decisions (non-negotiable)

- relic's `release-please.yml` caller + the central `release-please-relic` trust policy (in the org's `.github` repo) + `automation` environment are already in place from Phase 1; this phase adds `goreleaser-release.yml` and the `release` environment.
- relic provisions the `release` environment (and confirms `automation`) with protection rules and environment-scoped secrets before its first full release; verified via `gh api repos/{owner}/{repo}/environments` (R36, R37).
- `just generate` (templ) runs in goreleaser global `before.hooks` (R15).
- relic adopts `goreleaser-release.yml` unchanged at `@verified-actions`, `token-source: octo-sts`.

### Flex zone (implementation choice allowed)

- Which channels relic enables (likely GH + binstaller; npm/homebrew opt-out).
- relic's goreleaser config specifics (it already builds via goreleaser snapshot in CI).

### End-to-end behaviour to implement

Add `release-please.yml` + `goreleaser-release.yml` caller workflows to relic; add `before.hooks: [just generate]` to its goreleaser config; create and configure both environments; cut the first release.

### Acceptance criteria

- [ ] `[observable]` relic's first release is created, gated, attested, and published with zero release logic in the repo beyond the two caller workflows.
- [ ] `[observable]` templ files are generated during release with no bespoke workflow step (R15).
- [ ] `[observable]` The migration check fails fast for a repo whose `release`/`automation` lacks protection rules, and passes once configured (R37).
- [ ] `[structural]` `gh api .../environments` shows both environments with protection rules + scoped secrets (R36).
- [ ] `[structural]` Diagrams updated to include relic and its environment boundaries.

### Verification

Provision environments; run the migration acceptance check (pre- and post-configuration to see R37 flip); cut relic's first release; verify attestation + generated templ output. Run the standard gate.

### Replan triggers

- templ generation timing conflicts with goreleaser's build ordering.
- Environment protection rules block automated release in a way that needs a different gating model.

-----

## Phase 7: Consumer docs, integration diagrams, org template workflows

**EARS requirements**: none — explicit stakeholder deliverable (documentation + diagrams + demo templates).

**Carry-forward**: All four repos are live on the shared pipeline; freeze contracts before documenting.

### Why this phase exists

Make adoption a two-minute job and make the architecture legible. A **chinmina-org** maintainer picks a release template from the "New workflow" button and gets a working, pinned caller; the diagrams show exactly how the pieces fit and where the trust/secret boundaries are.

### Platform reality (corrected premise)

Org workflow templates are **org-scoped**: they surface in the "New workflow" picker only for repositories in the **same org** as the `.github` repo that hosts them. **Public visibility does *not* extend the picker cross-org** (it governs which repo *types* in the org can use them, and lets the reusable workflows/actions be called cross-org). Therefore:

- chinmina's templates reach **`kms-import`** (chinmina org) only.
- Self-service onboarding for the three **`<org>`** repos (`imds-broker`, `Sandy`, `relic`) is **deferred** ("later problem"). They are migrated by hand during their own phases. Revisit options later (mirror templates into `<org>/.github`, or a `docs/examples/` copy-paste set) — not committed in v1.

### Locked decisions (non-negotiable)

- Templates live in `chinmina/.github/.github/workflow-templates/` as `<name>.yml` + `<name>.properties.json`; provided set: `release-go`, `release-bun`, and the shared `release-please` caller. **Scoped to chinmina-org repos by platform design.**
- Templates reference shared workflows at `@verified-actions` and use `$default-branch` substitution.
- Each template ships documented prerequisites: required environments, secrets, and the per-org App install.

### Flex zone (implementation choice allowed)

- Template `categories`/`filePatterns`/`iconName`; whether to soft-launch behind the `preview` label first.
- Onboarding guide structure; whether standalone example copies also live in a `docs/examples/` dir for hand-copiers (would also serve the deferred other-organisation onboarding).

### End-to-end behaviour to implement

Author the three template workflows + metadata; finalise the consolidated sequence + component (with environment/secret boundary) diagrams in the repo README; write an onboarding guide ("adopt the release pipeline") listing environment + secret + App prerequisites and the opt-out inputs. The guide must cover the other-organisation (cross-org, no-picker) path explicitly, since templates don't reach those repos.

### Acceptance criteria

- [ ] `[observable]` The release templates appear in a **chinmina-org** repo's "New workflow" picker and, when selected, produce a caller wired to `@verified-actions` with `$default-branch` substituted.
- [ ] `[observable]` A template-generated caller, once secrets/environments exist, produces a successful gated+attested release (validate against `kms-import` or a chinmina scratch repo).
- [ ] `[structural]` Each template has a valid `.properties.json` (name, description, categories, filePatterns).
- [ ] `[structural]` Repo README contains final sequence + component diagrams matching the shipped architecture; onboarding guide lists all prerequisites and opt-out inputs, including the other-organisation cross-org path.
- [ ] `[structural]` Each shared action/workflow README's contract block is current.

### Verification

Open "New workflow" in a chinmina-org repo, select each template, confirm the generated file and substitutions; run one release from a template-generated caller; lint the `.properties.json`; review diagrams against actual call graph. Run the standard gate.

### Replan triggers

- Template substitution or `@verified-actions` pinning behaves unexpectedly in the picker.
- Contract drift discovered while documenting (fix the component, then document).

-----

## Follow-ups (post-v1)

- **npm trusted-publishing as the steady-state default** once each repo's packages are bootstrapped (see Phase 4) — would drop `NODE_AUTH_TOKEN` too.
- **Other-organisation self-service onboarding** (deferred from Phase 7): mirror templates into `<org>/.github/workflow-templates/` or promote a `docs/examples/` copy-paste set, so the other organisation's maintainers get a starting caller without a cross-org picker.

-----

## Requirements coverage matrix

|Requirement ID         |Phase(s)                          |Notes                                      |
|-----------------------|----------------------------------|-------------------------------------------|
|R1–R7                  |1                                 |release-please trigger half                |
|R8, R9, R10            |2                                 |build→attest→publish gate                  |
|R11                    |2 (5 bun, 6 relic)                |mise authority; per-toolchain              |
|R12                    |2 (partial) → 4 (full)            |channel execution                          |
|R13, R14               |4                                 |disable inputs + cred pre-check            |
|R15                    |5 (Sandy), 6 (relic)              |pre-build via before.hooks                 |
|R16                    |4                                 |homebrew token passthrough (App PAT / octo-sts release-tap)|
|R17                    |2                                 |pre-release marking (via canary tag)       |
|R18, R19               |2                                 |setup-release-toolchain                    |
|R20, R21, R22, R23, R24|4                                 |npm-publish-binaries (+ reused in 5)       |
|R25, R26, R27          |3                                 |binstaller install script                  |
|R28                    |2 (checksums) + 3 (install.sh)    |attestation subjects (subject-checksums)   |
|R29, R30               |2                                 |attest-artifacts (keyless OIDC)            |
|R31                    |1 (+ standing every phase)        |SHA-pin inner actions                      |
|R32                    |1                                 |@verified-actions ref                      |
|R33                    |1 (+ 2)                           |least-privilege tokens (App-path homebrew PAT exc.)|
|R34                    |1                                 |automation environment                     |
|R35                    |2                                 |release environment                        |
|R36, R37               |6 (verified per migration in 4, 5)|environment provisioning + acceptance check|
|(no ID)                |7                                 |docs, diagrams, org template workflows     |

All 37 requirements mapped; no gaps.
