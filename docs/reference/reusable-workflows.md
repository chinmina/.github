# Reusable workflows

This repository publishes three reusable workflows. Consumers call each one from a workflow in their own repository, pinned to `@verified-actions`.

| Workflow | Called on | Purpose |
| -------- | --------- | ------- |
| [`release-please.yml`](#release-pleaseyml) | push to the default branch | Opens the Release PR. On merge, creates a draft release and its `v*` tag. |
| [`goreleaser-release.yml`](#goreleaser-releaseyml) | push of a `v*` tag | Builds, attests, and publishes the release and its packages. |
| [`conventional-pr-title.yml`](#conventional-pr-titleyml) | pull request events | Checks the PR title follows Conventional Commits. |

## Version pinning

Consumers reference the workflows at `@verified-actions`. The branch is fast-forwarded only to reviewed commits. Inside this repository, first-party references also use `@verified-actions` and third-party actions are pinned to a full commit SHA. [`.github/zizmor.yml`](../../.github/zizmor.yml) enforces both rules.

## Permission ceilings

A reusable workflow can only reduce the `GITHUB_TOKEN` permissions its caller grants. The calling job must grant at least the permissions in the tables below. A caller that grants less fails at startup with a workflow file error.

Callers set `permissions: {}` at the workflow level and grant permissions on the calling job only.

## `release-please.yml`

Source: [`.github/workflows/release-please.yml`](../../.github/workflows/release-please.yml)

Runs release-please with a minted installation token. A tag pushed with an installation token triggers workflows, so the tag push starts the consumer's `release.yml`. A tag pushed with `GITHUB_TOKEN` would not.

| Property | Value |
| -------- | ----- |
| Job environment | `automation` |
| Caller permissions | `contents: read`, `id-token: write` |
| Secrets | Both App secrets, by name, on the `app` token source; none on `octo-sts` |

`id-token: write` is required on both token sources, because the job declares it for both.

### Inputs

| Input | Type | Default | Description |
| ----- | ---- | ------- | ----------- |
| `token-source` | string | `app` | `app` mints from the GitHub App secrets. `octo-sts` mints a keyless token through octo-sts. |
| `config-file` | string | `release-please-config.json` | Path to the release-please config. |
| `manifest-file` | string | `.release-please-manifest.json` | Path to the release-please manifest. |
| `sts-identity` | string | `release-please-<repo>` | octo-sts identity requested. `octo-sts` only. |
| `sts-scope` | string | repository owner | octo-sts scope whose policies are consulted. `octo-sts` only. |

### Secrets

| Secret | Environment | Required when |
| ------ | ----------- | ------------- |
| `RELEASE_PLEASE_CLIENT_ID` | `automation` | `token-source: app` |
| `RELEASE_PLEASE_APP_PRIVATE_KEY` | `automation` | `token-source: app` |

The caller passes each secret by name, for example `RELEASE_PLEASE_CLIENT_ID: ${{ secrets.RELEASE_PLEASE_CLIENT_ID }}`. GitHub resolves the name in the environment of the reusable job that uses it, so a secret that exists only in `automation` arrives.

> [!WARNING]
> Do not rely on `secrets: inherit`. It passes nothing when the caller and `chinmina/.github` have different owners, such as a user-owned repository, and the run continues with empty secrets.

### Steps

1. Mint an installation token with `contents: write` and `pull-requests: write`, from the GitHub App or octo-sts.
2. Fetch the config file at the pushed commit.
3. Validate it with [`validate-release-please-config`](../../.github/actions/validate-release-please-config/). See [release-please config](repository-configuration.md#release-please-config).
4. Run `googleapis/release-please-action`.
5. When a release was created, confirm the `v*` tag exists and points at the release commit. The job fails if it does not.

## `goreleaser-release.yml`

Source: [`.github/workflows/goreleaser-release.yml`](../../.github/workflows/goreleaser-release.yml)

Builds with goreleaser, fills the release-please draft, generates `install.sh`, attests every artifact, publishes the optional npm packages, and finally publishes the release. One wrapper serves Go and Bun projects.

| Property | Value |
| -------- | ----- |
| Job environment | `release` |
| Caller permissions | `contents: write`, `id-token: write`, `attestations: write` |
| Secrets | `DOCKERHUB_TOKEN` when Docker login is on, and both App secrets on the `app` token source with Homebrew or Nix on, all by name; otherwise none |

### Inputs

| Input | Type | Default | Description |
| ----- | ---- | ------- | ----------- |
| `token-source` | string | `app` | `app` uses `github.token` for the release and mints the package-repository token from the GitHub App. `octo-sts` mints both tokens keylessly. |
| `disable-binstaller` | boolean | `false` | Skips generating and attesting `install.sh`. |
| `disable-homebrew` | boolean | `false` | Skips the Homebrew cask. Removes `homebrew-tap` from the package-repository token. |
| `disable-nix` | boolean | `false` | Skips the Nix recipe. Skips installing Nix, and removes `nixpkgs` from the package-repository token. |
| `disable-docker-login` | boolean | `false` | Skips the Docker Hub login. |
| `disable-npm` | boolean | `false` | Skips npm publication. |
| `npm-package-name` | string | `""` | npm name of the main package, for example `@<OWNER>/<TOOL>`. Required unless `disable-npm` is `true`. |
| `npm-main-package-dir` | string | `.github/workflows/npm/main` | Directory holding the main package's `package.json`. |
| `binstaller-spec` | string | `.config/binstaller.yml` | Path to the committed binstaller spec. |
| `extra-mise-tools` | string | `""` | Extra tool names to install through mise, for example `cosign`. Names only; versions come from `mise.toml`. |
| `pre-build` | string | `""` | Shell run after tool setup and before goreleaser. goreleaser `before.hooks` is preferred for build steps. |
| `sts-scope` | string | repository owner | octo-sts scope whose policies are consulted. `octo-sts` only. |
| `sts-release-identity` | string | `release-<repo>` | octo-sts identity for the release token. `octo-sts` only. |
| `sts-tap-identity` | string | `release-tap` | octo-sts identity for the package-repository token. `octo-sts` with Homebrew or Nix only. |

Every channel is on by default. A caller lists only the channels it does not ship, as `disable-<channel>: true`.

Tool versions come from the consumer's `mise.toml`. The workflow has no version inputs.

### Secrets and variables

| Name | Kind | Environment | Required when |
| ---- | ---- | ----------- | ------------- |
| `RELEASE_PLEASE_CLIENT_ID` | secret | `release` | `token-source: app` with Homebrew or Nix on |
| `RELEASE_PLEASE_APP_PRIVATE_KEY` | secret | `release` | `token-source: app` with Homebrew or Nix on |
| `DOCKERHUB_TOKEN` | secret | `release` | Docker login on |
| `DOCKERHUB_USER` | variable | `release` | Docker login on |

Variables resolve from the caller's `release` environment without being passed.

### Tokens

| Token | `app` | `octo-sts` | Used for |
| ----- | ----- | ---------- | -------- |
| Release token (`GITHUB_TOKEN` for goreleaser) | `github.token` | `release-<repo>` identity | Filling the draft and uploading assets |
| Package-repository token (`HOMEBREW_GITHUB_TOKEN`, `NIX_GITHUB_TOKEN`) | GitHub App, scoped to the enabled package repositories | `release-tap` identity | Committing the cask and the recipe |
| Publish token | `github.token` | `github.token` | Taking the release out of draft |

goreleaser receives the package-repository token as `HOMEBREW_GITHUB_TOKEN` when Homebrew is on, and as `NIX_GITHUB_TOKEN` when Nix is on. Each is empty when its channel is off.

### Steps

1. Check out the tag with full history.
2. **Docker login on.** Fail if the `DOCKERHUB_USER` variable is not set.
3. Fail unless the goreleaser config sets `release.draft: true` and `release.use_existing_draft: true`. The config is the first of `.config/goreleaser.yml`, `.config/goreleaser.yaml`, `.goreleaser.yml`, `.goreleaser.yaml`, `goreleaser.yml`, and `goreleaser.yaml` found.
4. Install the toolchain with [`setup-release-toolchain`](../../.github/actions/setup-release-toolchain/): `goreleaser`, `binstaller` when that channel is on, and any `extra-mise-tools`. Go, Bun, and Node are set up from their mise versions when declared.
5. Run `pre-build`, when set.
6. Mint the release and package-repository tokens.
7. **npm on.** Fail unless `npm-package-name` is set, `npm-main-package-dir/package.json` exists, and `node` is declared in mise.
8. **Docker login on.** Log in to Docker Hub.
9. **Nix on.** Install Nix, which goreleaser needs for `nix-hash`.
10. Run `goreleaser release --clean`.
11. **binstaller on.** Generate and upload `install.sh` with [`binstaller-install-script`](../../.github/actions/binstaller-install-script/).
12. Attest every file in `dist/checksums.txt`, and `install.sh`, with [`attest-artifacts`](../../.github/actions/attest-artifacts/).
13. **npm on.** Publish the npm packages with the `npm-publish` action.
14. Publish the release. A tag containing `-` is published as a prerelease; any other tag is marked latest.

## `conventional-pr-title.yml`

Source: [`.github/workflows/conventional-pr-title.yml`](../../.github/workflows/conventional-pr-title.yml)

Checks the pull request title with `amannn/action-semantic-pull-request`. Squash merges use the PR title as the commit message, and release-please reads commit messages to choose the next version.

| Property | Value |
| -------- | ----- |
| Inputs | none |
| Caller permissions | `pull-requests: read` |
| Secrets | none |

```yaml
# .github/workflows/pr-title.yml
name: PR title

on:
  pull_request:
    types: [opened, edited, reopened, synchronize]

permissions: {}

jobs:
  conventional-pr-title:
    permissions:
      pull-requests: read # read the PR title
    uses: chinmina/.github/.github/workflows/conventional-pr-title.yml@verified-actions
```
