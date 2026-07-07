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
| 2 | **Token source** | `app` / `octo-sts` | **`app`** = a GitHub App installation token (App installed + stored `RELEASE_PLEASE_*` secrets). **`octo-sts`** = keyless OIDC, no stored key, trust policies centralised in the owner's `.github`. Choose per repo based on what the owner (org **or** user) has set up — the **chinmina** org uses `app`; another owner may use `octo-sts`. |
| 3 | **Channels** | GitHub release (always), binstaller (default on), homebrew (default on), npm (opt-in) | Disable a channel by passing `disable-<channel>: true` to `goreleaser-release.yml`. Each enabled channel that needs a credential is a prerequisite (see Step 1). |
| 4 | **Repo state** | greenfield / has existing release automation | If the repo already releases via another mechanism, you are **migrating**: the old trigger and the new one must not both run. Disable/delete the old workflow in the same change. |

Record your four answers — later steps say "if `octo-sts` …", "if homebrew on …".

---

## Step 1 — Prerequisites (these gate the FIRST run)

None of these live in code; all of them block the first release even when every
workflow file is correct. Treat this as the migration gate.

> **Owner = org *or* user.** `<OWNER>` may be a GitHub organisation or a user
> account; the pipeline works the same either way (octo-sts `scope` and the
> central `.github` repo are both keyed to the owner login). The **one** place
> account type matters is verifying the octo-sts App install and discovering the
> App id — those use org-scoped endpoints that **404 on a user account** (see
> the callout in 1d/1f). Everywhere else, "owner" covers both.

### 1a. Environments (always) — create *and gate*

Both reusable workflows name an environment. **A named environment that does not
exist is auto-created _ungated_** — the publish gate then silently does nothing.
So you must create them *with protection rules* yourself, and "create them" is
not enough: the tag/branch policy is what actually gates them.

```sh
# automation → gated to the default branch; release → gated to v* tags.
gh api --method PUT "repos/<OWNER>/<REPO>/environments/automation"
gh api --method PUT "repos/<OWNER>/<REPO>/environments/release"

# Turn on custom deployment-branch/tag policies for each, then add the policy.
gh api --method PUT "repos/<OWNER>/<REPO>/environments/automation" \
  -F 'deployment_branch_policy[protected_branches]=false' \
  -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api --method POST "repos/<OWNER>/<REPO>/environments/automation/deployment-branch-policies" \
  -f 'name=<DEFAULT_BRANCH>' -f 'type=branch'

gh api --method PUT "repos/<OWNER>/<REPO>/environments/release" \
  -F 'deployment_branch_policy[protected_branches]=false' \
  -F 'deployment_branch_policy[custom_branch_policies]=true'
# NOTE the tag policy needs BOTH name=v* AND type=tag.
gh api --method POST "repos/<OWNER>/<REPO>/environments/release/deployment-branch-policies" \
  -f 'name=v*' -f 'type=tag'
```

- [ ] Add any human protection rules you want (required reviewers) on top.
- [ ] Verify they exist and are gated:
      `gh api repos/<OWNER>/<REPO>/environments` and
      `gh api repos/<OWNER>/<REPO>/environments/release/deployment-branch-policies`

### 1b. Secrets (per token source + per channel)

Scope every secret to the environment that consumes it. On the **app** path the
caller uses `secrets: inherit`: because the secrets are environment-scoped and a
reusable-workflow *call job* cannot declare an `environment:`, only the reusable
workflow's env-targeting job can resolve them — a narrowed `secrets:` map is
evaluated in the caller (no environment) and reads empty, so `inherit` is the
required mechanism, not a shortcut. On the **octo-sts** path there are **no**
secrets, so callers omit `secrets:` entirely (and drop the
`# zizmor: ignore[secrets-inherit]` comment).

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

### 1c. Actions policy (always — easy to forget)

- [ ] The owner's **"Allowed actions and reusable workflows"** policy must
      permit `chinmina/*` (Settings → Actions → General). Without it every
      `uses: chinmina/.github/...` call is blocked before it runs.

### 1d. octo-sts only

- [ ] The **octo-sts GitHub App** is installed and authorised on the owner.
- [ ] The **central trust policies** exist in the **owner's `.github` repo**
      under `.github/chainguard/` (NOT in the consumer repo — see Step 2c):
      `release-please-<repo>`, `release-<repo>`, and (if homebrew on) the shared
      `release-tap`. They are added via a reviewed PR to `<OWNER>/.github`.
- [ ] The owner's `.github` `main` branch is **protected** (required review, no
      bypass for the octo-sts app) — this is what makes centralised policy safe.

> **User accounts can't verify the App install.** Listing/enumerating an App
> installation uses org-scoped endpoints (`/orgs/...`, `admin:org` scope) that
> **404 on a user account**. So on a user account, treat "the App is installed"
> as an **assumption to confirm out of band** before the Step 4 smoke test
> (which is the real proof — it mints against the live policy). Repo-level
> environment/ruleset APIs are unaffected by account type.

### 1e. Tool + spec files in the repo (always)

- [ ] **mise config** (`.tool-versions` or `mise.toml`) declares every tool the
      release flow uses — mise is the version authority. **Required:** `go` and
      `goreleaser`; add `binstaller` when that channel is on (it needs a small
      `mise.toml` block — see [Declaring `binstaller`](#declaring-binstaller)).
      The npm channel needs **no** extra tool: the `npm-publish` action pins its
      own Node 24 + Bun for generation and publishing, independent of your build
      toolchain. **Optional:** `bun`
      (only if the *build* needs it — declaring it makes the toolchain set Bun up;
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
      place to set it). **It MUST also set `"include-component-in-tag": false`**
      so tags are plain `v<semver>` — the default (`true`) prefixes the component
      (e.g. `boxed-v0.1.0`), which matches neither `release.yml`'s `v*` trigger
      nor the `v[0-9]*` ruleset, and `release-please.yml` derives its draft
      lookup as `v<semver>`. Get this wrong and the release never fires.
- [ ] **binstaller spec** at `.config/binstaller.yml` *(only if binstaller on)*.

#### Declaring `binstaller`

`binstaller` is the one tool that needs more than a version line, and it **must**
live in `mise.toml` — the `.tool-versions` format can't express the `[tool_alias]`
table or the `rename_exe` option below. It has **no mise registry short name**, yet
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
binstaller = { version = "0.12.0", rename_exe = "binst" }
```

| Piece | Why it's required |
|-------|-------------------|
| `[tool_alias] binstaller = "github:binary-install/binstaller"` | Surfaces the tool under the key `binstaller` so the validator's `has("binstaller")` passes. The raw backend key (`github:binary-install/binstaller`) would surface verbatim and **fail** validation. |
| `github:` backend | The non-deprecated backend (mise warns `ubi:` is removed in 2027.1.0). It auto-detects the `binst` binary inside the release archive with no extra `matching`/asset config. |
| `rename_exe = "binst"` | The archive ships a binary named `binst`; without this, mise names the **shim** after the tool key (`binstaller`) and the action's `binst` call isn't on `PATH`. **Use `rename_exe`, not `exe`** — `exe` is a **ubi-only** option; for the `github:` backend the archive-executable rename field is `rename_exe` (and `bin` is for bare, non-archive binaries). |
| pinned version (`0.12.0`) | Reproducible installs, consistent with the kit's other pinned tools. |

Use `[tool_alias]`, **not** the deprecated `[alias]` (mise warns on the latter).
This replaces any brute-force `binst`-by-path workaround — no `PATH` munging or
post-install steps needed.

### 1f. Repository rulesets & branch protection (confirm on first run)

- [ ] **A `tag creation` ruleset with no bypass actor is a hard blocker.** If a
      ruleset restricts creating `v*` tags, the minted installation token can't
      push the tag and the pipeline stalls at "draft, no tag." Add the
      token-minting **App** as a bypass actor on that **restricting** ruleset
      (`actor_type: Integration`, `bypass_mode: always`) — the octo-sts App on
      the octo-sts path, or the chinmina release App on the app path.

      *(GitHub rulesets are additive-only: a second, permissive ruleset can't
      grant an exception to a restrictive one — bypass must sit on the ruleset
      that imposes the rule. Verified empirically.)*

      ```sh
      # Find the restricting ruleset id, then GET-then-PUT the FULL representation
      # (name/target/enforcement/conditions/rules + the new bypass_actors) — a
      # partial PUT returns 422.
      gh api "repos/<OWNER>/<REPO>/rulesets" --jq '.[] | {id,name,target}'
      gh api "repos/<OWNER>/<REPO>/rulesets/<ID>" > ruleset.json
      # edit ruleset.json: add
      #   {"actor_type":"Integration","actor_id":<APP_ID>,"bypass_mode":"always"}
      # to bypass_actors, then:
      gh api --method PUT "repos/<OWNER>/<REPO>/rulesets/<ID>" --input ruleset.json
      ```

      `<APP_ID>` is the App's numeric id. On an **org** you can look it up via
      `gh api /orgs/<OWNER>/installations` (needs `admin:org`); on a **user
      account** that 404s, so supply the id from the App's settings page (a
      human-confirmed input).
- [ ] **`required_signatures` on `main`** is compatible (release-please's API
      commits are GitHub-signed) — flag it as a *confirm on first run* item, not
      a blocker.

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
    # app path only: keep the `# zizmor: ignore[secrets-inherit]` trailing
    # comment (inherit is required — see below). octo-sts: delete both the
    # comment and the `secrets:` line.
    uses: chinmina/.github/.github/workflows/release-please.yml@verified-actions # zizmor: ignore[secrets-inherit]
    with:
      token-source: <app|octo-sts> # from Step 0.2
    # SECRETS — pass them per token-source:
    #  * app:      keep `secrets: inherit` below. The RELEASE_PLEASE_* secrets are
    #              ENVIRONMENT-scoped (Step 1b), and a reusable-workflow CALL job
    #              cannot declare an `environment:`, so they can only resolve
    #              inside the reusable workflow's env-targeting job — which is what
    #              `inherit` enables. A narrowed `secrets:` map is evaluated in the
    #              caller (no environment) and would read EMPTY, so inherit is
    #              required here; it is not laziness.
    #  * octo-sts: keyless — DELETE the whole `secrets:` line (nothing to pass).
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
    # SECRETS (see 2a for the environment-scoping rationale):
    #  * app + homebrew: keep `secrets: inherit` (HOMEBREW_GITHUB_TOKEN is
    #    environment-scoped, so inherit is required).
    #  * octo-sts, OR app without homebrew: DELETE the `secrets:` line and the
    #    `# zizmor: ignore[secrets-inherit]` comment above — nothing to pass.
    secrets: inherit
```

### 2c. Trust policies — **octo-sts only**, in the OWNER's `.github` repo

These do **not** go in the consuming repo. They live in `<OWNER>/.github`'s
`.github/chainguard/` (centralised so a compromised consumer workflow cannot
author its own policy), and are added by a reviewed PR. The reusable workflows
default the octo-sts `scope` to the owner and auto-derive the identity names, so
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
publishers). This file is very likely to **already exist** from a sibling repo:
**edit it if present** — add this repo to the `claim_pattern.repository`
alternation — rather than writing a new file. Only create it if no tap policy
exists yet.

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
  draft: true              # leave as draft; the wrapper un-drafts after attestation
  mode: keep-existing      # fill the release-please draft, don't replace it
  use_existing_draft: true # REQUIRED: without it goreleaser's GetReleaseByTag
                           # can't see the release-please draft and creates a
                           # SECOND release. goreleaser-release.yml preflights
                           # this and fails the run if it is missing.
  prerelease: auto         # mark prerelease from a semver pre-release tag
```

All three of `draft: true`, `mode: keep-existing`, **and**
`use_existing_draft: true` are required. `mode: keep-existing` tells goreleaser
not to replace the release; `use_existing_draft: true` is what lets its
`GetReleaseByTag` lookup *find* a release that is still a draft. Omit the latter
and goreleaser silently publishes a duplicate release alongside release-please's
draft — so the reusable wrapper refuses to run without it.

Run codegen in `before.hooks` rather than the `pre-build` input when it's a
normal repo build step — keep `pre-build` for things that genuinely belong to the
release wrapper only.

#### Homebrew — `homebrew_casks:` *(only if the homebrew channel is on)*

Use **`homebrew_casks:`**, not the deprecated `brews:`. The cask needs the
macOS quarantine-xattr removal hook, the tap token from the environment, and
`skip_upload: auto` so it is **not** pushed on prerelease tags:

```yaml
homebrew_casks:
  - name: <TOOL>
    repository:
      owner: <OWNER>
      name: homebrew-tap
      token: "{{ .Env.HOMEBREW_GITHUB_TOKEN }}" # app path: PAT; octo-sts: minted tap token
    # skip publishing the cask on a prerelease. release.prerelease: auto only
    # marks the RELEASE as prerelease — it does NOT gate the cask push, so
    # without this an RC tag would publish the cask.
    skip_upload: auto
    # remove the macOS quarantine xattr so the binary runs without a Gatekeeper
    # prompt after `brew install`.
    hooks:
      post:
        install: |
          if OS.mac?
            system "xattr", "-dr", "com.apple.quarantine", "#{staged_path}/<TOOL>"
          end
```

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

#### The main package — consumer contract

Commit your main npm package at `.github/workflows/npm/main/` (or override
`npm-main-package-dir`). This directory is project-specific and stays in your
repo. Its **only required file is a single `package.json` carrying your
consumer-owned metadata**. You do **not** ship a launcher, and you do **not**
need to declare `version`, `repository`, `engines`, or `optionalDependencies` —
the action is the single source of truth for all of those.

The action derives fields as follows when it publishes:

| Field | Behaviour |
|-------|-----------|
| `version` | **Overwritten** with the release tag (leading `v` stripped). |
| `repository` | **Overwritten** from the GitHub repository. |
| `bin` | **Overwritten** to a single entry mapping the command name to the hosted launcher. |
| `optionalDependencies` | **Overwritten** to exactly the discovered platform packages, pinned to the release version. Any value you supply is ignored. |
| `files` | **Union** of the default set (launcher + `README.md`) and your entries. |
| `engines` | Set to `{"node":">=18"}` **only when absent**; left as-is when present. |
| `chinmina` | **Overwritten** with the runtime `platforms` map that drives the launcher. |
| `name` | **Overwritten** with the `npm-package-name` input, so the main package always matches the platform family it references. Your `package.json` must still carry a (non-empty) `name` to be a valid manifest, but its value is ignored. |
| `description`, `homepage`, `license`, `keywords` | **Left untouched** — yours. |

`name` is derived from the `npm-package-name` workflow input — the single source
of truth for the whole package family (main + platform packages). Keep the
`name` in your `package.json` consistent with it to avoid confusion, but the
action overrides it regardless so a stale value cannot publish a mismatched
package.

The command name defaults to the package's **unscoped** name (e.g. `tool` for
`@<OWNER>/tool`). To use a different command name, set `chinmina.command` in
your source `package.json`.

Minimal `package.json` the action accepts:

```json
{
  "name": "@<OWNER>/<REPO>",
  "description": "<description>",
  "homepage": "https://github.com/<OWNER>/<REPO>",
  "license": "MIT",
  "keywords": ["cli"]
}
```

That is enough: the action fills in `version`, `repository`, `bin`,
`optionalDependencies`, `files`, `engines`, and the launcher itself.

#### The launcher is hosted — you no longer ship one

The platform-selecting launcher is a single generic file hosted in
`chinmina/.github` and copied into your published package at release time. It is
fully data-driven: it reads the `chinmina.platforms` map the action writes into
your package's `package.json`, resolves the correct platform package for the
current `process.platform`/`process.arch`, execs the binary with all arguments
and stdio forwarded, and exits with the binary's exit code. It contains no
hard-coded package names and no `.exe` special-casing.

Because the map is generated from `dist/artifacts.json` at publish time, the
launcher can never drift out of sync with the published platform-package names
(the class of bug that produced `-win32-` launcher references against
`-windows-` packages).

#### Migrating an existing consumer

If your repo predates the hosted launcher (it has a `bin/<tool>.js` and a
fully-specified `package.json`), migrate the `main/` directory as follows:

1. **Delete the local launcher**: remove `bin/<tool>.js` (and the now-empty
   `bin/` directory). The hosted launcher replaces it.
2. **Clear `optionalDependencies`** (recommended): the action overwrites it
   from `dist/artifacts.json`, so any local copy only drifts. Remove the block.
3. **Drop derived fields** (optional but tidy): you may delete `version`,
   `repository`, and `bin`; the action overwrites them regardless. Keep
   `engines` only if you need a value other than the `>=18` default.
4. **Keep your metadata**: `name`, `description`, `homepage`, `license`,
   `keywords`, and any custom `files` entries are preserved.
5. **Optional command-name override**: if your command name differs from the
   unscoped package name, add `"chinmina": { "command": "<name>" }`.

After migration the directory typically contains just a `package.json` matching
the minimal shape above. The action's preflight step validates this before any
package is published, so a bad `main/package.json` fails fast with zero
`npm publish` calls.

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
- **Plain-`v` tag contract**: `release-please-config.json` must set
  `"include-component-in-tag": false`. The default (`true`) prefixes the tag
  with the package component (e.g. `boxed-v0.1.0`), which matches neither
  `release.yml`'s `tags: ["v*"]` trigger nor the `refs/tags/v[0-9]*` ruleset, so
  the release never fires. `release-please.yml` also derives the draft-lookup
  tag as `v<semver>` (from the PR title), making the plain `v` tag a hard
  requirement.
- **goreleaser draft contract**: `release.draft: true` + `mode: keep-existing` +
  `use_existing_draft: true` (all three — see Step 2d). Without
  `use_existing_draft: true` goreleaser can't see release-please's draft and
  creates a duplicate release, bypassing the attest-before-publish gate;
  `goreleaser-release.yml` preflights this and fails without it.
- **Tag-push contract**: the tag must be pushed by the *installation token*
  (the wrapper does this), never `GITHUB_TOKEN`. A `GITHUB_TOKEN`-pushed tag does
  not emit a workflow-triggering event, so `release.yml` never fires.
- **mise contract**: every tool the wrapper requests must be in the mise config
  (`.tool-versions` or `mise.toml`; `binstaller` requires `mise.toml`).
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
             scope: ${{ github.repository_owner }}   # the OWNER (central policies)
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

### Local pre-flight before the first push *(recommended)*

These catch config errors without burning a real release. None are installed by
assumption; run them via the pinned invocations below.

- **Workflow lint**: run both via `mise exec <tool>@<version> -- …`, which
  installs the pinned tool on demand — no prior mise declaration or global
  install required:

  ```sh
  mise exec actionlint@1.7.12 -- actionlint
  mise exec zizmor@1.25.2 -- zizmor .
  ```

  Run **both**. zizmor (Actions security lint) is the one that's easy to skip,
  and not running it locally is the most common verification gap — the caller
  templates carry `# zizmor: ignore[secrets-inherit]` precisely so they pass, so
  zizmor confirms they still do.
- **binstaller** *(if on)*: the local acceptance criterion is that
  **`binst gen` produces `install.sh`** from the committed spec. **`binst check`
  is expected to 404 before the first release** — it probes for release assets
  that do not exist yet, so that 404 is *not* a spec error and must not be read
  as a failure.
- **binstaller vs `homebrew_casks`** *(if both on)*: `binst` 0.12.0 can't parse
  `homebrew_casks.binaries` (older embedded goreleaser schema; goreleaser itself
  accepts it). Workaround for local `binst gen`: run it against a temporary copy
  of the goreleaser config with the `homebrew_casks:` block stripped, then
  re-add `repo`/`default_version`/`binaries` to the generated spec and trim it
  to unix targets (`install.sh` is POSIX-only). The committed config keeps the
  cask block — this workaround is local-generation only.

---

## Step 5 — Failure modes (symptom → cause → fix)

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `release.yml` never runs after the Release PR merges | tag pushed by `GITHUB_TOKEN`, or no installation token minted | use the kit's `release-please.yml` unchanged; check the mint step ran (Step 0.2 secrets / owner App) |
| octo-sts mint fails | App not installed, central policy not merged, `scope` pointing at the repo instead of the owner, or `subject` not environment-qualified | install the App + merge the central policy (1d); keep `scope` = owner; set `subject: …:environment:<env>` (2c) |
| `release.yml` never fires; the draft's tag is component-prefixed (e.g. `boxed-v0.1.0`) | `release-please-config.json` missing `"include-component-in-tag": false` | set `"include-component-in-tag": false` so the tag is plain `v<semver>` (1e) |
| The minted token can't push the `v*` tag; pipeline stalls at "draft, no tag" | a `tag creation` ruleset restricts the ref with no bypass for the App | add the App as an `Integration`/`bypass_mode: always` bypass actor on the *restricting* ruleset (1f) |
| Homebrew step fails to auth on the octo-sts path | `release-tap` policy missing the repo, or repo not in the `claim_pattern.repository` alternation | add the repo to the shared `release-tap` policy (2c) |
| `uses: chinmina/.github/...` blocked | owner policy disallows `chinmina/*` | allow `chinmina/*` in the owner's Actions settings (1c) |
| `release-please.yml` fails: "… does not enable draft releases" | `release-please-config.json` missing `"draft": true` | add `"draft": true` to `release-please-config.json` (1e) |
| Release publishes before attestation / no gate, or a duplicate release appears | goreleaser missing `use_existing_draft: true` (or not in draft+keep-existing mode) | set `release.draft: true` + `mode: keep-existing` + `use_existing_draft: true` (2d) |
| Homebrew cask published on a prerelease/RC tag | cask block missing `skip_upload: auto` | add `skip_upload: auto` to the `homebrew_casks:` entry (2d) |
| `setup-release-toolchain` fails: tool not declared | required tool missing from mise config | declare `go`/`goreleaser`/`binstaller` in `.tool-versions` or `mise.toml` (1e) |
| Publish gate silently absent | `automation`/`release` auto-created ungated | create them with protection rules *before* first run (1a) |
| homebrew step fails on auth | `HOMEBREW_GITHUB_TOKEN` missing/unscoped, or channel left on | add the env-scoped token, or `disable-homebrew: true` (1b/2b) |
| npm publish fails: "401 Unauthorized" or OIDC rejection | trusted publisher not configured on npmjs.com, wrong workflow filename, wrong environment name, or wrong repo | configure trusted publisher per package with `release.yml` (caller) + `release` env (2e) |
| npm preflight fails: main package.json missing/nameless | `npm-main-package-dir` wrong, directory not committed, or `package.json` lacks a `name` | commit `.github/workflows/npm/main/package.json` with consumer metadata (2e); no launcher needed |
| npm preflight fails: no archives found | `dist/artifacts.json` missing or no qualifying Archive entries | ensure goreleaser ran successfully and produced archives before the npm step |
| npm publish fails: unknown goos/goarch | goreleaser targets a platform with no Node mapping | preflight fails before any publish; remove the target or extend the mapping in the `npm-publish` action |

---

## Quick reference — input cheatsheet

`release-please.yml`: `token-source` (`app`\|`octo-sts`, default `app`),
`config-file`, `manifest-file`, `sts-identity` (default `release-please-<repo>`),
`sts-scope` (default owner).

`goreleaser-release.yml`: `pre-build`, `disable-binstaller`, `disable-homebrew`,
`disable-npm` (default `true`), `npm-package-name` (required when npm on),
`npm-main-package-dir` (default `.github/workflows/npm/main`),
`binstaller-spec`, `token-source` (`app`\|`octo-sts`), `sts-scope` (default owner),
`sts-release-identity` (default `release-<repo>`), `sts-tap-identity` (default
`release-tap`). Tool versions (Go, goreleaser, binstaller, optional Bun) are
read from the consumer's mise config — there are no version inputs.

See the [README contracts table](../README.md#workflow-contracts) for the
authoritative inputs/secrets/permissions per workflow.
