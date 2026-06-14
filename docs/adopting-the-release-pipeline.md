# Adopting the shared release pipeline (consuming-repo guide)

This is a **task-oriented onboarding guide** for wiring any repository into the
`chinmina/.github` release pipeline. It is written to be followed top-to-bottom
by an automated agent or a human: each section is a decision or a checklist, the
templates are copy-paste, and `<PLACEHOLDER>` tokens mark every value you must
substitute.

For the architecture (sequence diagram, component map, contracts) read the
[release workflows overview](release-workflows.md) first. For a fully worked
instance, see the [`relic` example](examples/relic/) (octo-sts / Go). This guide
is the generic version of that example.

---

## Step 0 — Decide the four parameters

Answer these before touching any files. Everything downstream keys off them.

| # | Parameter | Options | How to choose |
|---|-----------|---------|---------------|
| 1 | **Toolchain** | `goreleaser-release.yml` | One wrapper for both Go and Bun projects — goreleaser builds either. Declare the toolchain (`go` and/or `bun`) in mise; the wrapper sets it up automatically. |
| 2 | **Token source** | `app` / `octo-sts` | **`app`** = a GitHub App installation token (App installed + stored `RELEASE_PLEASE_*` secrets). **`octo-sts`** = keyless OIDC, no stored key, trust policies centralised in the owning organisation's `.github`. Choose per repo based on what the owning organisation has set up — the **chinmina** org uses `app`; another organisation may use `octo-sts`. |
| 3 | **Channels** | GitHub release (always), binstaller (default on), homebrew (default on), npm (opt-in) | Disable a channel by passing `disable-<channel>: true` to `goreleaser-release.yml`. Each enabled channel that needs a credential is a prerequisite (see Step 1). |
| 4 | **Repo state** | greenfield / has existing release automation | If the repo already releases via another mechanism, you are **migrating**: the old trigger and the new one must not both run. Disable/delete the old workflow in the same change. |

Record your four answers — later steps say "if `octo-sts` …", "if homebrew on …".

---

## Step 1 — Prerequisites (these gate the FIRST run)

None of these live in code; all of them block the first release even when every
workflow file is correct. Treat this as the migration gate.

### 1a. Environments (always)

Both reusable workflows name an environment. **A named environment that does not
exist is auto-created _ungated_** — the publish gate then silently does nothing.
So you must create them *with protection rules* yourself.

- [ ] Create the **`automation`** environment (runs release-please).
- [ ] Create the **`release`** environment (runs build/attest/publish).
- [ ] Add the protection rules you want (required reviewers, branch/tag
      restrictions) to each.
- [ ] Verify they exist and are gated:
      `gh api repos/<OWNER>/<REPO>/environments`

### 1b. Secrets (per token source + per channel)

Scope every secret to the environment that consumes it; `secrets: inherit` in
the caller carries them into the reusable workflow's environment-targeting job.

| Need it when… | Secret | Environment |
|---------------|--------|-------------|
| `token-source: app` | `RELEASE_PLEASE_CLIENT_ID` | `automation` |
| `token-source: app` | `RELEASE_PLEASE_APP_PRIVATE_KEY` | `automation` |
| homebrew on **and** `token-source: app` | `HOMEBREW_GITHUB_TOKEN` (write to the tap repo) | `release` |
| npm channel on (`disable-npm: false`) | *(none — OIDC trusted publishing; no stored token needed)* | — |

`token-source: octo-sts` stores **no** secret — that is the point. On that path
even the Homebrew tap write is a keyless mint (the `release-tap` identity), so
`HOMEBREW_GITHUB_TOKEN` is *not* needed. binstaller and the GitHub-release
channel never need a secret (keyless OIDC / `github.token`).

### 1c. Org policy (always — easy to forget)

- [ ] The repo's org **"Allowed actions and reusable workflows"** policy must
      permit `chinmina/*` (Settings → Actions → General). Without it every
      `uses: chinmina/.github/...` call is blocked before it runs.

### 1d. octo-sts only

- [ ] The **octo-sts GitHub App** is installed and authorised on the org.
- [ ] The **central trust policies** exist in the **org's `.github` repo** under
      `.github/chainguard/` (NOT in the consumer repo — see Step 2c):
      `release-please-<repo>`, `release-<repo>`, and (if homebrew on) the shared
      `release-tap`. They are added via a reviewed PR to `<org>/.github`.
- [ ] The org's `.github` `main` branch is **protected** (required review, no
      bypass for the octo-sts app) — this is what makes centralised policy safe.

### 1e. Tool + spec files in the repo (always)

- [ ] **mise config** (`.tool-versions` or `mise.toml`) declares every tool the
      release flow uses — mise is the version authority. **Required:** `go` and
      `goreleaser`; add `binstaller` when that channel is on (it needs a small
      `mise.toml` block — see [Declaring `binstaller`](#declaring-binstaller));
      add `node` when the npm channel is on. **Optional:** `bun`
      (only if the build needs it — declaring it makes the toolchain set Bun up;
      omitting it skips Bun). `setup-release-toolchain` deliberately fails,
      naming the tool, if a *required* tool is not declared — the toolkit imposes
      the standard rather than guessing a version.
- [ ] **release-please config + manifest** (`release-please-config.json`,
      `.release-please-manifest.json`) — repo-specific; see release-please docs.
      **`release-please-config.json` MUST set `"draft": true`** — this is what
      makes release-please create the GitHub Release as a draft so the wrapper
      can build and attest before publishing. Without it the release would be
      published before any provenance exists; `release-please.yml` validates
      this config **before release-please runs** and **fails the run** if it is
      missing (the pinned action has no `draft` input, so the config is the only
      place to set it).
- [ ] **binstaller spec** at `.config/binstaller.yml` *(only if binstaller on)*.

#### Declaring `binstaller`

`binstaller` is the one tool that needs more than a version line, and it **must**
live in `mise.toml` — the `.tool-versions` format can't express the alias or
`exe` below. It has **no mise registry short name**, yet
`setup-release-toolchain` validates it with `mise ls --current --json` +
`jq 'has("binstaller")'`, so it must surface under the exact key `binstaller`.
At the same time `binstaller-install-script` calls the CLI as `binst` (not
`binstaller`), so that must be the binary on `PATH`. An aliased `github:`
backend gives both at once:

```toml
# binstaller has no mise registry short name; alias the github backend so the
# tool surfaces as `binstaller` (what setup-release-toolchain validates) while
# exposing the `binst` CLI the binstaller-install-script action calls.
[tool_alias]
binstaller = "github:binary-install/binstaller"

[tools]
binstaller = { version = "0.12.0", exe = "binst" }
```

| Piece | Why it's required |
|-------|-------------------|
| `[tool_alias] binstaller = "github:binary-install/binstaller"` | Surfaces the tool under the key `binstaller` so the validator's `has("binstaller")` passes. The raw backend key (`github:binary-install/binstaller`) would surface verbatim and **fail** validation. |
| `github:` backend | The non-deprecated backend (mise warns `ubi:` is removed in 2027.1.0). It auto-detects the `binst` binary inside the release archive with no extra `matching`/asset config. |
| `exe = "binst"` | The archive ships a binary named `binst`; without this, mise names the **shim** after the tool (`binstaller`) and the action's `binst` call isn't on `PATH`. |
| pinned version (`0.12.0`) | Reproducible installs, consistent with the kit's other pinned tools. |

Use `[tool_alias]`, **not** the deprecated `[alias]` (mise warns on the latter).
This replaces any brute-force `binst`-by-path workaround — no `PATH` munging or
post-install steps needed.

---

## Step 2 — Files to add

Copy these into the consuming repo, preserving paths, then substitute the
`<PLACEHOLDER>` tokens. Filenames matter where noted.

> **Caller `permissions` are a ceiling.** A reusable workflow can only
> *downgrade* the `GITHUB_TOKEN`, never elevate it ([GitHub docs][perm-docs]),
> so the caller must grant **at least** what the reusable workflow's job
> declares. `permissions: {}` caps `id-token`/`contents`/`attestations` to
> nothing, which kills the octo-sts OIDC mint on the very first step. Grant:
> - **release-please caller** → `contents: read` + `id-token: write`
> - **release (goreleaser) caller** → `contents: write` + `id-token: write` + `attestations: write`
>
> [perm-docs]: https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows#access-and-permissions

### 2a. `.github/workflows/release-please.yml` (the trigger caller)

```yaml
# <OWNER>/<REPO> — release-please trigger.
name: release-please

on:
  push:
    branches: [<DEFAULT_BRANCH>] # usually main

# Caller permissions are a CEILING — a reusable workflow can only DOWNGRADE the
# GITHUB_TOKEN, never elevate it. Grant at least what the reusable workflow's job
# declares; `permissions: {}` would starve the octo-sts OIDC mint (no id-token).
permissions:
  contents: read
  id-token: write # octo-sts OIDC token exchange (harmless on the app path)

jobs:
  release-please:
    uses: chinmina/.github/.github/workflows/release-please.yml@verified-actions # zizmor: ignore[secrets-inherit]
    with:
      token-source: <app|octo-sts> # from Step 0.2
    # secrets: inherit is intentional — environment-scoped secrets must resolve
    # inside the reusable workflow's environment-targeting job.
    secrets: inherit
```

Drop the `with:` block entirely if `token-source` is `app` (the default).

### 2b. `.github/workflows/release.yml` (the tag caller)

Keep the filename **`release.yml`** even if npm is off today: npm trusted
publishing validates the *caller* workflow filename, so matching it now avoids a
rename later.

```yaml
# <OWNER>/<REPO> — build/attest/publish on the v* tag pushed by release-please.
name: release

on:
  push:
    tags: ["v*"]

# Caller permissions are a CEILING (see 2a). Grant at least what
# goreleaser-release.yml's job declares — `permissions: {}` would starve the
# octo-sts mint and the keyless attestation.
permissions:
  contents: write # fill + publish the release, push assets
  id-token: write # octo-sts OIDC mint + keyless attestation
  attestations: write # record build attestations

jobs:
  release:
    uses: chinmina/.github/.github/workflows/goreleaser-release.yml@verified-actions # zizmor: ignore[secrets-inherit]
    with:
      token-source: <app|octo-sts>       # must match Step 0.2 / the release-please caller
      # Channels: omit a line to keep the default (binstaller + homebrew on).
      disable-binstaller: <true|false>   # default false
      disable-homebrew: <true|false>     # default false
      disable-npm: <true|false>          # default true — opt in explicitly
      # npm-package-name: "@<OWNER>/<REPO>"  # required when disable-npm: false
      # npm-main-package-dir: ".github/workflows/npm/main"  # default
      # pre-build: "<shell>"             # only if codegen is NOT in goreleaser before.hooks
    secrets: inherit
```

### 2c. Trust policies — **octo-sts only**, in the ORG's `.github` repo

These do **not** go in the consuming repo. They live in `<ORG>/.github`'s
`.github/chainguard/` (centralised so a compromised consumer workflow cannot
author its own policy), and are added by a reviewed PR. The reusable workflows
default the octo-sts `scope` to the org and auto-derive the identity names, so
the consumer's callers carry no octo-sts config.

Add up to three files (filename stem = the identity name). Each job runs in a
named environment, so its OIDC subject is environment-qualified — the `subject`
must match **exactly**, and `claim_pattern` pins the ref.

`release-please-<REPO>.sts.yaml` (always):

```yaml
issuer: https://token.actions.githubusercontent.com
subject: repo:<OWNER>/<REPO>:environment:automation
claim_pattern:
  ref: 'refs/heads/<DEFAULT_BRANCH>'
permissions:
  contents: write
  pull_requests: write
repositories: [<REPO>]
```

`release-<REPO>.sts.yaml` (always — the build job's app-repo write):

```yaml
issuer: https://token.actions.githubusercontent.com
subject: repo:<OWNER>/<REPO>:environment:release
claim_pattern:
  ref: '^refs/tags/v.*$'
permissions:
  contents: write
repositories: [<REPO>]
```

`release-tap.sts.yaml` (only if homebrew on — **shared**, one for all tap
publishers; add the repo to the alternation rather than writing a new file):

```yaml
issuer: https://token.actions.githubusercontent.com
subject_pattern: '^repo:<OWNER>/[^:]+:environment:release$'
claim_pattern:
  ref: '^refs/tags/v.*$'
  repository: '^<OWNER>/(<REPO>|<OTHER_TAP_REPOS>)$'
permissions:
  contents: write
repositories: [<TAP_REPO>]
```

Override the derived names/scope only if your policies are named differently:
`release-please.yml` takes `sts-identity` + `sts-scope`; `goreleaser-release.yml` takes
`sts-release-identity`, `sts-tap-identity` + `sts-scope`. Confirm the policy
shape against the current octo-sts schema.

### 2d. goreleaser config keys (merge into `.goreleaser.yaml`)

The wrapper requires goreleaser to **fill the existing release-please draft** and
leave it a draft, so attestation runs before the wrapper publishes it last.

```yaml
before:
  hooks:
    - <CODEGEN_COMMAND> # e.g. "just generate"; omit the whole block if none

release:
  draft: true          # leave as draft; the wrapper un-drafts after attestation
  mode: keep-existing  # fill the release-please draft, don't replace it
  prerelease: auto     # mark prerelease from a semver pre-release tag
```

Run codegen in `before.hooks` rather than the `pre-build` input when it's a
normal repo build step — keep `pre-build` for things that genuinely belong to the
release wrapper only.

### 2e. npm channel — main package and trusted publisher config

Skip this section if `disable-npm: true` (the default).

The npm channel (R31–R34) uses **OIDC trusted publishing** — no stored token.
npm exchanges the workflow's OIDC token directly; `NODE_AUTH_TOKEN` must not be
set. npm attaches provenance automatically during publish (R33). The publish
logic is bundled in `chinmina/.github`; consumers provide configuration only.

#### OIDC claim matched by npm (R34 — caller filename contract)

npm trusted publishing validates the **caller** workflow's `workflow_ref`, not
the reusable workflow's `job_workflow_ref`. This means:

- Consumers register their own `release.yml` as the trusted publisher workflow.
- Publishing from inside `goreleaser-release.yml` works because the OIDC token
  carries the caller's workflow reference.
- The caller filename **must stay `release.yml`**. Do not rename it.

#### The main shim package

Commit your main npm package at `.github/workflows/npm/main/` (or override
`npm-main-package-dir`). This directory is project-specific and stays in your
repo. It must contain:

- **`package.json`** — with `"version": "0.0.0-dev"` as the version
  placeholder. The action substitutes the release version at publish time. Include `optionalDependencies` referencing the
  platform packages at the same placeholder version.
- **`bin/<tool>.js`** — the platform-selecting launcher.

Example `package.json` for a binary with four platform packages:

```json
{
  "name": "@<OWNER>/<REPO>",
  "version": "0.0.0-dev",
  "description": "<description>",
  "license": "MIT",
  "bin": { "<tool>": "./bin/<tool>.js" },
  "files": ["bin/<tool>.js", "README.md"],
  "optionalDependencies": {
    "@<OWNER>/<REPO>-linux-x64":   "0.0.0-dev",
    "@<OWNER>/<REPO>-linux-arm64": "0.0.0-dev",
    "@<OWNER>/<REPO>-darwin-x64":  "0.0.0-dev",
    "@<OWNER>/<REPO>-darwin-arm64":"0.0.0-dev"
  },
  "engines": { "node": ">=18" }
}
```

Platform packages are generated automatically from `dist/artifacts.json` — you
do not need to create their directories or package.json files.

#### Platform packages — automatic discovery

Platform packages are discovered automatically from goreleaser's
`dist/artifacts.json`, which records every archive it produced along with its
`goos`, `goarch`, format, and binary name. The action reads this file and
publishes one npm package per archive — no repetition of goreleaser
configuration needed. Archive naming convention, platform set, and binary names
are all derived from what goreleaser actually built.

#### Trusted publisher config on npmjs.com

For **each** package (main and every platform package), add a trusted publisher
on [npmjs.com](https://www.npmjs.com/) under the package's Settings → Publishing:

| Field | Value |
|-------|-------|
| Publisher | GitHub Actions |
| Organization or user | `<OWNER>` |
| Repository | `<REPO>` |
| Workflow filename | `release.yml` |
| Environment name | `release` |

Every package in the `optionalDependencies` shim must be registered separately —
the trusted publisher check is per-package.

#### Failure mode: OIDC claim mismatch

If npm rejects the OIDC token with an authentication error, verify that:

- The registered workflow filename is `release.yml` (the caller, not
  `goreleaser-release.yml`).
- The environment name is `release` (matching the job's environment).
- The repository is the consumer repo, not `chinmina/.github`.

### 2f. `README.md` — install + verify sections (align with what the pipeline ships)

The pipeline publishes provenance-attested archives, a binstaller `install.sh`
(when that channel is on), and the GitHub Release itself. The repo's README is
the user-facing half of that contract: it must (1) tell users how to install
from the published channels and (2) tell them how to verify the provenance the
pipeline went to the trouble of producing. Standardise it so every consumer
reads the same way.

Use the **[`kms-import` README][kms-readme]** as the worked exemplar — copy its
`## Installation` and `## Verifying releases` shape and substitute the
`<PLACEHOLDER>` tokens. The conventions:

- **One collapsible `<details>` block per enabled channel**, each opened by a
  bold `<summary>`, under a single `## Installation` heading. Include only the
  channels you actually ship (Step 0.3): **mise** and **manual download** always;
  **install script** only if binstaller is on; **Homebrew** only if that channel
  is on; **go install** for a Go module. Mark the recommended one in its summary
  (e.g. `mise (recommended)`).
- **A `## Verifying releases` section** that names the attestation (SLSA
  build-provenance via Sigstore keyless signing — no long-lived key) and gives
  the `gh attestation verify` command. Every install block that downloads an
  artifact links to it.

Skeleton (`<TOOL>` = binary/command name, `<OWNER>/<REPO>` = the repo):

````markdown
## Installation

Pre-built binaries for Linux, macOS, and Windows (amd64/arm64) are published to
[GitHub Releases](https://github.com/<OWNER>/<REPO>/releases). Every artifact
carries a build-provenance attestation — see [Verifying releases](#verifying-releases).

<details>
<summary><strong>mise (recommended)</strong></summary>

[mise](https://mise.jdx.dev/) installs directly from GitHub Releases via its
[GitHub backend](https://mise.jdx.dev/dev-tools/backends/github.html); it
verifies the artifact checksum and, with `github_attestations` enabled (the
current default), its build-provenance attestation:

```sh
mise use -g github:<OWNER>/<REPO>
```

</details>

<!-- Install script — ONLY if binstaller is on. -->
<details>
<summary><strong>Install script</strong></summary>

Each release ships a self-contained installer (generated with
[binstaller](https://github.com/binary-install/binstaller)) that detects your
platform and checks the download against checksums embedded in the script — no
separate checksum file is fetched:

```sh
curl -fsSL https://github.com/<OWNER>/<REPO>/releases/latest/download/install.sh | sh
```

It installs to `~/.local/bin`; pass `-b` for another directory and a tag to pin
a version:

```sh
curl -fsSL https://github.com/<OWNER>/<REPO>/releases/latest/download/install.sh \
  | sh -s -- -b /usr/local/bin <TAG>
```

The script carries a build-provenance attestation, so you can verify it before
running it (with an authenticated [GitHub CLI](https://cli.github.com/)). This
transitively covers the binary too: a verified script is guaranteed to hold the
genuine checksums it then enforces on the download.

```sh
curl -fsSL -O https://github.com/<OWNER>/<REPO>/releases/latest/download/install.sh
gh attestation verify install.sh --repo <OWNER>/<REPO>
sh install.sh
```

</details>

<!-- Homebrew — ONLY if the homebrew channel is on. -->
<details>
<summary><strong>Homebrew (macOS)</strong></summary>

```sh
brew install <OWNER>/tap/<TOOL>
```

</details>

<details>
<summary><strong>Manual download</strong></summary>

Download the archive for your platform from the
[releases page](https://github.com/<OWNER>/<REPO>/releases), verify its
provenance, and put the binary on your `PATH`:

```sh
OS=linux ARCH=amd64   # or darwin/windows, arm64
curl -fsSLO "https://github.com/<OWNER>/<REPO>/releases/latest/download/<TOOL>_${OS}_${ARCH}.tar.gz"
gh attestation verify "<TOOL>_${OS}_${ARCH}.tar.gz" --repo <OWNER>/<REPO>
tar -xzf "<TOOL>_${OS}_${ARCH}.tar.gz" <TOOL>
install -m 0755 <TOOL> ~/.local/bin/
```

Windows archives are `.zip`. See [Verifying releases](#verifying-releases) for
what the attestation proves and for checksum-only verification.

</details>

<!-- go install — ONLY for a Go module; source builds report version `dev`. -->
<details>
<summary><strong>go install</strong></summary>

```sh
go install github.com/<OWNER>/<REPO>/cmd/<TOOL>@latest
```

</details>

## Verifying releases

Release artifacts — the binary archives and the generated `install.sh` — carry a
[build-provenance attestation](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds)
(SLSA) generated by the release workflow with [Sigstore](https://www.sigstore.dev/)
keyless signing — there is no long-lived signing key. Each artifact is bound, by
digest, to the source commit and the workflow that produced it.

To verify a downloaded artifact, install the [GitHub CLI](https://cli.github.com/)
(≥ 2.49.0) and run:

```sh
# e.g. ARTIFACT=<TOOL>_linux_amd64.tar.gz
gh attestation verify "$ARTIFACT" --repo <OWNER>/<REPO>
```

To additionally pin the signing workflow, add
`--signer-workflow <OWNER>/<REPO>/.github/workflows/release.yml`. The
attestation is a Sigstore bundle, so [`cosign`](https://docs.sigstore.dev/) can
verify it too; `checksums.txt` is still published for
`sha256sum --check checksums.txt`.
````

Drop the blocks for channels you don't ship — never document an install path the
pipeline doesn't publish. The binstaller block's transitive-trust wording (a
verified script vouches for the binary it installs) is the standard phrasing;
keep it intact when binstaller is on.

[kms-readme]: https://github.com/chinmina/kms-import/blob/main/README.md

---

## Step 3 — Contracts you must not break

- **release-please draft contract**: `release-please-config.json` must set
  `"draft": true` so release-please creates the GitHub Release as a draft. The
  pinned action exposes no `draft` input, so this is the only place to set it.
  `release-please.yml` validates this config before release-please runs and
  fails the run if it is missing, so a misconfigured repo never publishes a
  non-draft release.
- **goreleaser draft contract**: `release.draft: true` + `mode: keep-existing`.
  If goreleaser creates its own release or publishes immediately, the
  attest-before-publish gate is bypassed.
- **Tag-push contract**: the tag must be pushed by the *installation token*
  (the wrapper does this), never `GITHUB_TOKEN`. A `GITHUB_TOKEN`-pushed tag does
  not emit a workflow-triggering event, so `release.yml` never fires.
- **mise contract**: every tool the wrapper requests must be in `.tool-versions`.
- **Environment contract**: `automation` and `release` must exist and be gated
  *before* the first run (Step 1a).
- **octo-sts subject contract**: `…:environment:automation`, not the bare
  `repo:<owner>/<repo>` subject.

---

## Step 4 — Verify (in order)

1. **(octo-sts only) Smoke-test the keyless mint in isolation** before a real
   release — it's the layer with the least precedent. Throwaway job:

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
             identity: release-please-<REPO>         # release-please-<repo>
         - run: gh api user --jq .login   # confirms the minted identity
           env:
             GH_TOKEN: ${{ steps.sts.outputs.token }}
   ```

2. **Confirm the environments are gated**: `gh api repos/<OWNER>/<REPO>/environments`.
3. **Push a conventional commit** to the default branch → release-please opens a
   Release PR.
4. **Merge the Release PR** → a **draft** release appears and a `v*` tag is
   pushed (by the installation token).
5. **`release.yml` fires** on the tag → goreleaser fills the draft → `install.sh`
   is generated (if binstaller on) → artifacts + `install.sh` are attested →
   the release is published **last**.
6. **Verify provenance** on a published asset:
   - `gh attestation verify <archive> --owner <OWNER>`
   - `gh attestation verify install.sh --owner <OWNER>` *(if binstaller on)*

---

## Step 5 — Failure modes (symptom → cause → fix)

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `release.yml` never runs after the Release PR merges | tag pushed by `GITHUB_TOKEN`, or no installation token minted | use the kit's `release-please.yml` unchanged; check the mint step ran (Step 0.2 secrets / org App) |
| octo-sts mint fails | App not installed, central policy not merged, `scope` pointing at the repo instead of the org, or `subject` not environment-qualified | install the App + merge the central policy (1d); keep `scope` = org; set `subject: …:environment:<env>` (2c) |
| Homebrew step fails to auth on the octo-sts path | `release-tap` policy missing the repo, or repo not in the `claim_pattern.repository` alternation | add the repo to the shared `release-tap` policy (2c) |
| `uses: chinmina/.github/...` blocked | org policy disallows `chinmina/*` | allow `chinmina/*` in org Actions settings (1c) |
| `release-please.yml` fails: "… does not enable draft releases" | `release-please-config.json` missing `"draft": true` | add `"draft": true` to `release-please-config.json` (1e) |
| Release publishes before attestation / no gate | goreleaser not in draft+keep-existing mode | set `release.draft: true` + `mode: keep-existing` (2d) |
| `setup-release-toolchain` fails: tool not declared | required tool missing from mise config | declare `go`/`goreleaser`/`binstaller` in `.tool-versions` or `mise.toml` (1e) |
| Publish gate silently absent | `automation`/`release` auto-created ungated | create them with protection rules *before* first run (1a) |
| homebrew step fails on auth | `HOMEBREW_GITHUB_TOKEN` missing/unscoped, or channel left on | add the env-scoped token, or `disable-homebrew: true` (1b/2b) |
| npm publish fails: "401 Unauthorized" or OIDC rejection | trusted publisher not configured on npmjs.com, wrong workflow filename, wrong environment name, or wrong repo | configure trusted publisher per package with `release.yml` (caller) + `release` env (2e) |
| npm publish fails: main package dir not found | `npm-main-package-dir` wrong or directory not committed | create `.github/workflows/npm/main/` with `package.json` and bin launcher (2e) |
| npm publish fails: no archives found | `dist/artifacts.json` missing or no Archive entries | ensure goreleaser ran successfully and produced archives before the npm step |
| npm publishes to `latest` for a prerelease tag | publish script does not branch on the tag | add a `--tag next` check for tags containing `-` in the publish script (2e) |

---

## Quick reference — input cheatsheet

`release-please.yml`: `token-source` (`app`\|`octo-sts`, default `app`),
`config-file`, `manifest-file`, `sts-identity` (default `release-please-<repo>`),
`sts-scope` (default org).

`goreleaser-release.yml`: `pre-build`, `disable-binstaller`, `disable-homebrew`,
`disable-npm` (default `true`), `npm-package-name` (required when npm on),
`npm-main-package-dir` (default `.github/workflows/npm/main`),
`binstaller-spec`, `token-source` (`app`\|`octo-sts`), `sts-scope` (default org),
`sts-release-identity` (default `release-<repo>`), `sts-tap-identity` (default
`release-tap`). Tool versions (Go, goreleaser, binstaller, optional Bun) are
read from the consumer's mise config — there are no version inputs.

See the [README contracts table](../README.md#workflow-contracts) for the
authoritative inputs/secrets/permissions per workflow.
