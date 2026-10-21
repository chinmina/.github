# Troubleshooting

Symptoms, causes, and fixes for the shared release pipeline, grouped by the stage where they appear. Each fix links to the setting it changes.

## Release PR and tag

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| `uses: chinmina/.github/...` is blocked before the run starts | The owner's Actions policy does not allow `chinmina/*` | Allow `chinmina/*` in the owner's Actions settings. See [Owner settings](repository-configuration.md#owner-settings). |
| The run fails at startup with a workflow file error | The calling job grants fewer permissions than the reusable workflow's job declares | Grant the permissions listed in [Caller workflows](repository-configuration.md#caller-workflows), on the calling job. |
| `release-please.yml` fails: `"draft": true is required` or `"force-tag-creation": true is required` | The key is missing, or a package sets it to `false` | Set it to `true` at the top level of `release-please-config.json`. See [Required keys](repository-configuration.md#required-keys). |
| `release-please.yml` fails: config `does not match the release-please schema` | A misspelt key or a wrong type in `release-please-config.json`; the log names it | Fix the key. If release-please supports a key the schema lacks, add it to `tighten-schema.jq` in [`validate-release-please-config`](../../.github/actions/validate-release-please-config/). |
| The Release PR has the wrong version and lists every commit since the repository began | The previous release has no tag, so release-please cannot find it | Set `"force-tag-creation": true`. Tag the previous release commit by hand to repair the next Release PR. |
| `Verify release tag` fails: `release-please did not create tag` | A `v*` tag ruleset rejected the tag; release-please treats any 422 as "already exists" | Add the token-minting App as a bypass actor on the ruleset. Push the tag at the release commit by hand to start `release.yml`, and close the Release PR that run opened. |
| The draft release exists but `release.yml` never runs | The tag has a component prefix such as `shed-v0.1.0` | Set `"include-component-in-tag": false`. |
| `release.yml` never runs and the tag is missing | The tag was pushed with `GITHUB_TOKEN`, which does not trigger workflows | Use `release-please.yml` from the kit unchanged. It pushes the tag with an installation token. |

## Tokens

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| *Mint installation token (GitHub App)* fails | `RELEASE_PLEASE_CLIENT_ID` or `RELEASE_PLEASE_APP_PRIVATE_KEY` is missing from the `automation` environment, the caller does not pass `secrets: inherit`, or the App is not installed on the repository | Add both secrets to `automation`, keep `secrets: inherit`, and install the App on the repository. |
| *Mint package-repo token (GitHub App)* fails | The App is not installed on `homebrew-tap` or `nixpkgs`, the repository does not exist, or the App secrets are missing from the `release` environment | Install the App on the repository, create the repository, or add both secrets to `release` and keep `secrets: inherit`. |
| *Mint installation token (octo-sts)* or *Mint release token (octo-sts)* fails | The owner has no trust policy for the requested identity, or the policy does not match the job | Ask the owner to check the policy for `release-please-<REPO>` or `release-<REPO>`. Policies are owner configuration. |
| octo-sts mint fails for the installation | The octo-sts App is not installed on the owner, or lacks access to the repository | Install the App and grant it access to the repository and both package repositories. |
| *Mint package-repo token (octo-sts)* fails | The owner's `release-tap` policy does not include the repository | Ask the owner to add the repository to the `release-tap` policy. |
| *Mint package-repo token (octo-sts)* fails, with Homebrew off | Nix is on by default, and needs the same `release-tap` token | Ask the owner to add the repository to `release-tap`, or set `disable-nix: true`. |

## Build

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| `release.yml` fails at *Validate docker login inputs* | Docker login is on by default and `DOCKERHUB_USER` is not set | Set `disable-docker-login: true`, or define `DOCKERHUB_USER` and `DOCKERHUB_TOKEN` in `release`. |
| `release.yml` fails at *Validate npm inputs* | npm is on by default, and `npm-package-name`, the main package directory, or `node` in `mise.toml` is missing | Set `disable-npm: true`, or complete the [npm setup](../guides/publishing-to-npm.md). |
| `release.yml` fails: config `must set release.draft: true and release.use_existing_draft: true` | The goreleaser config is missing one of the keys | Add both. See [Required release keys](repository-configuration.md#required-release-keys). |
| `setup-release-toolchain` fails: tool not declared | A required tool is missing from `mise.toml` | Declare it. `binstaller` needs the alias. See [mise.toml](repository-configuration.md#misetoml). |
| goreleaser nix pipe fails: `nix-hash` not found | `disable-nix: true` with a `nix:` block in the goreleaser config | Remove `disable-nix: true`, or remove the `nix:` block. |
| `binst init` fails: `failed to load goreleaser config` | `homebrew_casks[].binaries` is set | Remove `binaries`. goreleaser defaults to the build's binary. |
| `binst init` fails: `field main_program not found in type config.Nix` | `main_program` or `formatter` is set in the `nix:` block | Remove both. |
| `binst check` returns 404 locally | The release assets do not exist yet | Expected before the first release. `binst gen` producing `install.sh` is the local check. |

## Publishing

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| A second release appears next to the draft | goreleaser created its own release | Set `release.use_existing_draft: true` with `release.draft: true` and `release.mode: keep-existing`. |
| The cask or recipe is published for a prerelease tag | `skip_upload: auto` is missing | Add `skip_upload: auto` to the `homebrew_casks:` and `nix:` entries. |
| The cask or recipe push is rejected | The token's actor is not an `always` bypass actor on the package repository's ruleset | Add the release GitHub App, or the octo-sts App, as a bypass actor. |
| `brew install` prints deprecation warnings for `postflight` or `verified` | The cask uses `hooks.post.install` or `url.verified` | Replace them with the `postflight_steps` `custom_block`. See [Homebrew cask](repository-configuration.md#homebrew-cask). |
| goreleaser fails: `function "staged_path" not defined` | `{{staged_path}}` in `custom_block` is not escaped, so goreleaser treats it as a template function | Write it as `{{ "{{staged_path}}" }}`. |
| The cask or recipe URL returns 404 | The release is still a draft | Expected until the *Publish release* step runs. |
| npm publish fails with 401 or an OIDC rejection | The trusted publisher does not match `release.yml`, the `release` environment, and the consuming repository, or does not allow `npm publish` | Replace the trusted publisher. See [Publishing to npm](../guides/publishing-to-npm.md#4-register-trusted-publishers). |
| An environment's protection rules are not applied | The environment was created on first use, without rules | Add the deployment policy. See [Environments](repository-configuration.md#environments). |
