# Repository configuration

Configuration a consuming repository must provide for the shared release pipeline. The [shed worked example](shed/) shows every item for a Go CLI.

## Caller workflows

| File | Trigger | Calls | Calling job permissions |
| ---- | ------- | ----- | ----------------------- |
| `.github/workflows/release-please.yml` | `push` to the default branch | `release-please.yml` | `contents: read`, `id-token: write` |
| `.github/workflows/release.yml` | `push` of tags matching `v*` | `goreleaser-release.yml` | `contents: write`, `id-token: write`, `attestations: write` |
| `.github/workflows/pr-title.yml` | `pull_request` | `conventional-pr-title.yml` | `pull-requests: read` |

The tag caller must be named `release.yml`. npm trusted publishing matches the caller's workflow filename, so the name is fixed even for repositories that do not publish to npm yet.

A caller passes each secret by name in a `secrets:` map. `secrets: inherit` passes nothing when the caller's owner is not `chinmina`, and the run continues with empty secrets. See [Reusable workflows](reusable-workflows.md#secrets).

## Environments

| Environment | Used by | Deployment policy |
| ----------- | ------- | ----------------- |
| `automation` | `release-please.yml` | The default branch (`type=branch`) |
| `release` | `goreleaser-release.yml` | Tags matching `v*` (`type=tag`) |

GitHub creates a missing environment on first use, with no protection rules. Each consumer creates both environments with their deployment policies before the first run.

## Owner settings

- The owner's Actions policy allows `chinmina/*` actions and reusable workflows.
- A ruleset that restricts creating `v*` tags lists the release GitHub App as an `always` bypass actor. On the `octo-sts` token source, the octo-sts App takes its place. Bypass must be on the restricting ruleset, because rulesets only add restrictions.
- `required_signatures` on the default branch is compatible. release-please commits through the API, and GitHub signs those commits.

## release-please config

### Required keys

| Key | Value | Effect when missing |
| --- | ----- | ------------------- |
| `draft` | `true` | The release is published before its artifacts are attested. The validator fails the run. |
| `force-tag-creation` | `true` | GitHub does not tag a draft release. release-please cannot find the release it created, and the next Release PR covers the entire history. The validator fails the run. |
| `include-component-in-tag` | `false` | Tags gain a component prefix (`shed-v0.1.0`) that does not match the `v*` trigger, so the release never runs. |

`draft` and `force-tag-creation` are valid at the top level or on every package. Each package's settings are laid over the top-level ones before the check.

### Standard keys

| Key | Value |
| --- | ----- |
| `$schema` | `https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json` |
| `release-type` | `simple` when the version is stamped at build time, for example by goreleaser `ldflags` |
| `pull-request-header` | `"Automated release prepared by Release Please. Changes since the previous release are listed below.\n"` |
| `pull-request-footer` | `"Generated from Conventional Commits since the previous release."` |
| `packages["."].initial-version` | Version of the first release, for example `0.1.0` |

### Validation

`release-please.yml` validates the config before release-please runs. The check uses release-please's own schema for the version bundled by the pinned release-please-action, tightened so an unknown key fails at every level. release-please ignores unknown keys, so a misspelt setting would otherwise be silently off.

### Manifest

`.release-please-manifest.json` maps each package path to its current version. A new repository starts with `0.0.0`, which release-please reads as unreleased:

```json
{
  ".": "0.0.0"
}
```

## goreleaser config

### Required release keys

| Key | Value | Purpose |
| --- | ----- | ------- |
| `release.draft` | `true` | Leaves the release as a draft. The wrapper publishes it after attestation. Checked before the build. |
| `release.use_existing_draft` | `true` | Lets goreleaser find the release-please draft. Without it, goreleaser creates a second release. Checked before the build. |
| `release.mode` | `keep-existing` | Keeps the release-please title and notes. |
| `release.prerelease` | `auto` | Marks tags such as `v1.2.3-rc.1` as prereleases. |
| `checksum.name_template` | `checksums.txt` | The wrapper attests every file listed in `dist/checksums.txt`. |

### Homebrew cask

Required when Homebrew is on.

| Key | Value |
| --- | ----- |
| `homebrew_casks[].repository` | `owner: <OWNER>`, `name: homebrew-tap`, `token: "{{ .Env.HOMEBREW_GITHUB_TOKEN }}"` |
| `homebrew_casks[].skip_upload` | `auto`, so prerelease tags do not publish the cask |
| `homebrew_casks[].custom_block` | The `postflight_steps` block that clears the macOS quarantine attribute |

The quarantine block, with `<TOOL>` as the binary name:

```yaml
custom_block: |
  postflight_steps do
    on_macos do
      run "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "{{ "{{staged_path}}" }}/<TOOL>"]
    end
  end
```

goreleaser renders `{{ "{{staged_path}}" }}` as the literal `{{staged_path}}`, which Homebrew substitutes at install time.

### Nix recipe

Required when Nix is on.

| Key | Value |
| --- | ----- |
| `nix[].repository` | `owner: <OWNER>`, `name: nixpkgs`, `token: "{{ .Env.NIX_GITHUB_TOKEN }}"` |
| `nix[].skip_upload` | `auto`, so prerelease tags do not publish the recipe |
| `nix[].homepage`, `nix[].description` | Project metadata |
| `nix[].license` | A nixpkgs licence attribute, for example `mit` or `asl20` |

The recipe is written to `pkgs/<TOOL>/default.nix` in `<OWNER>/nixpkgs`.

### Deprecated and rejected settings

| Setting | Problem | Use instead |
| ------- | ------- | ----------- |
| `brews:` | Deprecated by goreleaser | `homebrew_casks:` |
| `homebrew_casks[].hooks.post.install` | Emits the `postflight` stanza, deprecated by Homebrew | `custom_block` with `postflight_steps` |
| `homebrew_casks[].url.verified` | Deprecated by Homebrew | Omit it |
| `homebrew_casks[].binaries` | `binst` 0.12.0 fails to load the goreleaser config | Omit it; goreleaser defaults to the build's binary |
| `nix[].main_program`, `nix[].formatter` | `binst` 0.12.0 rejects both | Omit them |

goreleaser does not yet emit `postflight_steps` itself. [goreleaser#6873][goreleaser-6873] tracks `hooks.post.install_steps`, which will replace the `custom_block`.

## mise.toml

mise is the version authority for the release toolchain. The kit reads `mise.toml` and does not use `.tool-versions`.

| Tool | Required when | Notes |
| ---- | ------------- | ----- |
| `goreleaser` | always | |
| `go` | Go projects | Set up with `actions/setup-go` |
| `bun` | the build uses Bun | Set up with `oven-sh/setup-bun` |
| `binstaller` | binstaller on | Needs the alias below |
| `node` | npm on | Checked before the build; set up with `actions/setup-node` |
| `cosign` | goreleaser signs images or binaries | Also listed in `extra-mise-tools` |

`setup-release-toolchain` fails, naming the tool, when a required tool is not declared.

### binstaller declaration

```toml
[tool_alias]
binstaller = "github:binary-install/binstaller"

[tools.binstaller]
version = "0.12.0"
rename_exe = "binst"
```

| Piece | Purpose |
| ----- | ------- |
| `[tool_alias]` | binstaller has no mise registry short name. The alias makes it appear under the key `binstaller`, which `setup-release-toolchain` checks for. `[alias]` is deprecated. |
| `github:` backend | The archive contains a `binst` binary, which the backend detects without extra asset configuration. The `ubi:` backend is deprecated. |
| `rename_exe = "binst"` | Names the shim `binst`, the command `binstaller-install-script` runs. `exe` applies to the `ubi:` backend only. |

## binstaller spec

`.config/binstaller.yml` describes the release assets for `install.sh`. Generate it from the goreleaser config:

```sh
binst init --source goreleaser --file .goreleaser.yaml --repo <OWNER>/<REPO> -o .config/binstaller.yml
```

Regenerate the spec when archive names or platforms change in the goreleaser config. The release workflow embeds checksums into a working copy, so the committed spec never changes during a release.

## Package repositories

| Repository | Channel | Contents |
| ---------- | ------- | -------- |
| `<OWNER>/homebrew-tap` | Homebrew | `Casks/<TOOL>.rb`, one per tool |
| `<OWNER>/nixpkgs` | Nix | `pkgs/<TOOL>/default.nix`, plus a `default.nix` and `flake.nix` that expose every package |

goreleaser pushes unsigned commits to each default branch. The token's actor must be an `always` bypass actor on any ruleset protecting that branch: the release GitHub App, or the octo-sts App on the `octo-sts` token source. [Setting up package repositories](../guides/setting-up-package-repositories.md) creates both repositories.

[goreleaser-6873]: https://github.com/goreleaser/goreleaser/issues/6873
