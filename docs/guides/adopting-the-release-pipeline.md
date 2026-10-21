# Adopting the release pipeline

This guide connects a Go command-line tool to the shared release pipeline. When you finish, merging a Release PR publishes an attested GitHub Release, an `install.sh`, a Homebrew cask, and a Nix recipe.

Read the [release pipeline overview](release-pipeline-overview.md) first if the pipeline is new to you. The [shed worked example](../reference/shed/) contains every file this guide creates, filled in for one repository.

## Before you start

### Decisions

Make these decisions first. Later steps are labelled with the choice they depend on.

| Decision | Options | Guidance |
| -------- | ------- | -------- |
| Token source | `app` or `octo-sts` | Use `app`, the chinmina standard: a release GitHub App whose credentials are stored as environment secrets. Use `octo-sts` only when the owner runs octo-sts and has published trust policies for the release identities. |
| Channels | GitHub Release, binstaller, Homebrew, Nix, npm, container image | This guide sets up the first four. For npm, also follow [Publishing to npm](publishing-to-npm.md). For images, follow [Publishing container images](publishing-container-images.md). |
| Existing release automation | none, or replace it | If the repository already releases another way, remove the old workflow in the same pull request that adds the new callers. Two triggers for one tag create two releases. |

### Placeholders

Substitute these values everywhere they appear in commands and files.

| Placeholder | Meaning | shed example |
| ----------- | ------- | ------------ |
| `<OWNER>` | GitHub organisation or user that owns the repository | `chinmina` |
| `<REPO>` | Repository name | `shed` |
| `<TOOL>` | Binary, archive, and package name, set as goreleaser's `project_name` | `shed` |
| `<DEFAULT_BRANCH>` | Default branch | `main` |
| `<CLIENT_ID>` | Client ID of the release GitHub App | |
| `<KEY_FILE>` | Path to the release GitHub App's private key file | |
| `<APP_ID>` | Numeric ID of the App that mints tokens: the release App, or the octo-sts App, shown on its settings page | |
| `<RULESET_ID>` | ID of the tag ruleset, found in [step 4](#4-let-the-release-tag-through) | |
| `<DESCRIPTION>` | One-line description of the tool | `Fictional CLI used as the worked example…` |
| `<LICENSE>` | nixpkgs licence attribute | `asl20` |

### Local tools

- [GitHub CLI](https://cli.github.com/) (`gh`), signed in with admin access to `<OWNER>/<REPO>`
- [mise](https://mise.jdx.dev/)
- `jq`

## 1. Prepare the owner

These settings apply to every repository of the owner. Skip any that a previous repository has already set up.

1. Confirm the repository can use actions from `chinmina/*`.

   ```sh
   gh api "repos/<OWNER>/<REPO>/actions/permissions" --jq .allowed_actions
   ```

   `all` needs no change. For `selected`, check the allowed patterns include `chinmina/*`:

   ```sh
   gh api "repos/<OWNER>/<REPO>/actions/permissions/selected-actions" --jq .patterns_allowed
   ```

   If they do not, add `chinmina/*` under the owner's **Settings → Actions → General**.

2. Create the package repositories, `<OWNER>/homebrew-tap` and `<OWNER>/nixpkgs`, by following [Setting up package repositories](setting-up-package-repositories.md).

3. **`app` only.** Install the release GitHub App on `<REPO>`, `homebrew-tap`, and `nixpkgs`, with `contents: write` and `pull_requests: write`. On an installation limited to selected repositories, add each repository explicitly.

   For an organisation, confirm the installation:

   ```sh
   gh api "orgs/<OWNER>/installations" \
     --jq '.installations[] | select(.app_id == <APP_ID>) | .repository_selection'
   ```

   The output is `all`, or `selected`. For `selected`, and for a user account, open the App's **Configure** page under the owner's **Settings → GitHub Apps** and confirm all three repositories are listed.

4. **`octo-sts` only.** Confirm with the owner that the octo-sts App can access `<REPO>`, `homebrew-tap`, and `nixpkgs`, and that trust policies exist for the identities `release-please-<REPO>`, `release-<REPO>`, and `release-tap`. Trust policies are owner configuration, documented by the owner.

## 2. Create the environments

The workflows run in the `automation` and `release` environments. GitHub creates a missing environment on first use, with no protection rules, so create both with their deployment policies first.

1. Create `automation`, limited to the default branch.

   ```sh
   gh api --method PUT "repos/<OWNER>/<REPO>/environments/automation" \
     -F 'deployment_branch_policy[protected_branches]=false' \
     -F 'deployment_branch_policy[custom_branch_policies]=true'
   gh api --method POST "repos/<OWNER>/<REPO>/environments/automation/deployment-branch-policies" \
     -f 'name=<DEFAULT_BRANCH>' -f 'type=branch'
   ```

2. Create `release`, limited to `v*` tags. The policy needs both `name=v*` and `type=tag`.

   ```sh
   gh api --method PUT "repos/<OWNER>/<REPO>/environments/release" \
     -F 'deployment_branch_policy[protected_branches]=false' \
     -F 'deployment_branch_policy[custom_branch_policies]=true'
   gh api --method POST "repos/<OWNER>/<REPO>/environments/release/deployment-branch-policies" \
     -f 'name=v*' -f 'type=tag'
   ```

3. Confirm both policies.

   ```sh
   for env in automation release; do
     gh api "repos/<OWNER>/<REPO>/environments/${env}/deployment-branch-policies" \
       --jq ".branch_policies[] | \"${env}: \(.type) \(.name)\""
   done
   ```

   Expected output:

   ```text
   automation: branch <DEFAULT_BRANCH>
   release: tag v*
   ```

Add required reviewers to either environment if your team wants a manual approval.

## 3. Store the App credentials

The release job and the release-please job both mint installation tokens from the release GitHub App. Its credentials are stored as secrets in each environment.

**`app` only.** On the `octo-sts` token source, skip to [step 4](#4-let-the-release-tag-through). The environments hold no secrets.

1. Store both credentials in both environments.

   ```sh
   for env in automation release; do
     gh secret set RELEASE_PLEASE_CLIENT_ID --repo "<OWNER>/<REPO>" --env "${env}" --body "<CLIENT_ID>"
     gh secret set RELEASE_PLEASE_APP_PRIVATE_KEY --repo "<OWNER>/<REPO>" --env "${env}" < "<KEY_FILE>"
   done
   ```

2. Confirm both secrets exist in both environments.

   ```sh
   for env in automation release; do
     gh secret list --repo "<OWNER>/<REPO>" --env "${env}" --json name --jq ".[].name | \"${env}: \(.)\""
   done
   ```

   The output lists both secret names for each environment.

## 4. Let the release tag through

release-please creates the `v*` tag with the minted token. A ruleset that restricts tag creation blocks it unless the token-minting App can bypass that ruleset.

1. List the repository's rulesets.

   ```sh
   gh api "repos/<OWNER>/<REPO>/rulesets" --jq '.[] | [.id, .target, .name] | @tsv'
   ```

   If no ruleset has target `tag`, skip to [step 5](#5-declare-the-toolchain).

2. Save the tag ruleset that restricts creation. `<RULESET_ID>` is its ID from the list.

   ```sh
   gh api "repos/<OWNER>/<REPO>/rulesets/<RULESET_ID>" > ruleset.json
   ```

3. Add the App as a bypass actor. `<APP_ID>` is the release App's numeric ID, shown on its settings page. On the octo-sts token source, use the octo-sts App's ID.

   ```sh
   jq --argjson app "<APP_ID>" \
     '{name, target, enforcement, conditions, rules,
       bypass_actors: ((.bypass_actors // []) + [{actor_type: "Integration", actor_id: $app, bypass_mode: "always"}])}' \
     ruleset.json > ruleset-updated.json
   gh api --method PUT "repos/<OWNER>/<REPO>/rulesets/<RULESET_ID>" --input ruleset-updated.json
   ```

4. Confirm the bypass.

   ```sh
   gh api "repos/<OWNER>/<REPO>/rulesets/<RULESET_ID>" --jq '.bypass_actors'
   ```

   The output includes `{"actor_id":<APP_ID>,"actor_type":"Integration","bypass_mode":"always"}`.

The bypass must be on the ruleset that imposes the restriction. Rulesets only add restrictions, so a second ruleset cannot grant an exception.

## 5. Declare the toolchain

mise is the version authority for the tools the repository and the release job use. Create or extend `mise.toml` at the repository root:

```toml
# mise.toml
[tools]
go = "1.27.3"
goreleaser = "2.18.3"

# binstaller has no mise registry short name. The alias makes it surface under
# the key `binstaller` (which setup-release-toolchain checks for), and
# rename_exe exposes the `binst` CLI that binstaller-install-script calls.
[tool_alias]
binstaller = "github:binary-install/binstaller"

[tools.binstaller]
version = "0.12.0"
rename_exe = "binst"
```

Install the tools and confirm `binst` is on the path:

```sh
mise install
mise exec -- binst --version
```

[mise.toml](../reference/repository-configuration.md#misetoml) lists the tools each channel needs.

## 6. Configure release-please

1. Create `release-please-config.json`:

   ```json
   {
     "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
     "release-type": "simple",
     "include-component-in-tag": false,
     "draft": true,
     "force-tag-creation": true,
     "pull-request-header": "Automated release prepared by Release Please. Changes since the previous release are listed below.\n",
     "pull-request-footer": "Generated from Conventional Commits since the previous release.",
     "packages": {
       ".": {
         "initial-version": "0.1.0"
       }
     }
   }
   ```

   Keep `draft`, `force-tag-creation`, and `include-component-in-tag` exactly as shown. `release-please.yml` fails the run without the first two, and the third keeps tags in the plain `v1.2.3` form the trigger matches.

2. Create `.release-please-manifest.json`. `0.0.0` marks the repository as unreleased, so the first release uses `initial-version`.

   ```json
   {
     ".": "0.0.0"
   }
   ```

   For a repository with earlier releases, set the latest released version instead and remove `initial-version`.

## 7. Configure goreleaser

Create or update `.goreleaser.yaml`. The `release` block is required. The `homebrew_casks` and `nix` blocks publish the two package channels.

```yaml
# .goreleaser.yaml
# yaml-language-server: $schema=https://goreleaser.com/static/schema.json
version: 2

# Names the archives, cask, and Nix package. Without it, goreleaser uses the
# repository name.
project_name: <TOOL>

builds:
  - id: release
    binary: <TOOL>
    main: ./cmd/<TOOL>
    flags:
      - "-trimpath"
    ldflags: "-w -X github.com/<OWNER>/<REPO>/internal/buildinfo.Version={{.Version}}"
    env:
      - CGO_ENABLED=0
    goos: [linux, darwin, windows]
    goarch: [amd64, arm64]

# The release workflow attests every file listed here.
checksum:
  name_template: "checksums.txt"

archives:
  - id: archives
    formats: [tar.gz]
    name_template: "{{ .ProjectName }}_{{ .Os }}_{{ .Arch }}"
    format_overrides:
      - goos: windows
        formats: [zip]

# Release notes come from release-please; mode: keep-existing keeps them.
release:
  draft: true # the release workflow publishes it after attestation
  use_existing_draft: true # find and fill the release-please draft
  mode: keep-existing # keep the release-please title and notes
  prerelease: auto # mark v1.2.3-rc.1 style tags as prereleases

homebrew_casks:
  - name: <TOOL>
    repository:
      owner: <OWNER>
      name: homebrew-tap
      token: "{{ .Env.HOMEBREW_GITHUB_TOKEN }}" # set by the release workflow
    skip_upload: auto # no cask for prerelease tags
    homepage: "https://github.com/<OWNER>/<REPO>"
    description: "<DESCRIPTION>"
    # Clear the macOS quarantine attribute after install. custom_block carries
    # postflight_steps until goreleaser v2.19 ships hooks.post.install_steps
    # (goreleaser/goreleaser#6873).
    custom_block: |
      postflight_steps do
        on_macos do
          run "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "{{ "{{staged_path}}" }}/<TOOL>"]
        end
      end

nix:
  - name: <TOOL>
    repository:
      owner: <OWNER>
      name: nixpkgs
      token: "{{ .Env.NIX_GITHUB_TOKEN }}" # set by the release workflow
    skip_upload: auto # no recipe for prerelease tags
    homepage: "https://github.com/<OWNER>/<REPO>"
    description: "<DESCRIPTION>"
    license: "<LICENSE>"
```

Adjust `main` and `ldflags` to where your entry point and version variable live. The version variable defaults to `dev`, so builds outside goreleaser report `dev`.

> [!IMPORTANT]
> Leave out the settings Homebrew and binstaller reject:
>
> - `hooks.post.install` produces the deprecated `postflight` stanza. Use the `postflight_steps` `custom_block` above.
> - `url.verified` is deprecated by Homebrew.
> - `binaries` in `homebrew_casks` stops `binst` 0.12.0 loading the config. goreleaser defaults to the build's binary.
> - `main_program` and `formatter` in `nix` are rejected by `binst` 0.12.0.
> - `brews:` is deprecated by goreleaser. Use `homebrew_casks:`.

Write `{{staged_path}}` exactly as `{{ "{{staged_path}}" }}`. goreleaser renders the configuration as a template, and the escape produces the literal `{{staged_path}}` that Homebrew expects.

## 8. Generate the binstaller spec

1. Generate `.config/binstaller.yml` from the goreleaser config.

   ```sh
   mise exec -- binst init --source goreleaser --file .goreleaser.yaml \
     --repo "<OWNER>/<REPO>" -o .config/binstaller.yml
   ```

2. Confirm it produces an install script.

   ```sh
   mise exec -- binst gen --config .config/binstaller.yml -o /tmp/install.sh && head -1 /tmp/install.sh
   ```

   The output ends with `#!/bin/sh`. Use `binst gen`, not `binst check`: `binst check` downloads the release assets, and returns 404 until the first release exists.

Regenerate the spec whenever archive names or platforms change in `.goreleaser.yaml`.

## 9. Add the caller workflows

Each caller sets `permissions: {}` for the workflow and grants permissions on the calling job only. A reusable workflow can only reduce the permissions it receives, so the calling job grants at least what the reusable job declares.

1. Create `.github/workflows/release-please.yml`.

   ```yaml
   # .github/workflows/release-please.yml
   name: release-please

   on:
     push:
       branches: [<DEFAULT_BRANCH>]

   permissions: {}

   jobs:
     release-please:
       permissions:
         contents: read # read the release-please config
         id-token: write # declared by the reusable job on every token source
       uses: chinmina/.github/.github/workflows/release-please.yml@verified-actions
       with:
         token-source: app
       # The App secrets live in the automation environment. GitHub resolves
       # them for the reusable job, which runs there.
       secrets:
         RELEASE_PLEASE_CLIENT_ID: ${{ secrets.RELEASE_PLEASE_CLIENT_ID }}
         RELEASE_PLEASE_APP_PRIVATE_KEY: ${{ secrets.RELEASE_PLEASE_APP_PRIVATE_KEY }}
   ```

2. Create `.github/workflows/release.yml`. Keep the filename: npm trusted publishing matches it, so adding npm later needs no rename.

   ```yaml
   # .github/workflows/release.yml
   name: release

   on:
     push:
       tags: ["v*"]

   permissions: {}

   jobs:
     release:
       permissions:
         contents: write # fill and publish the release
         id-token: write # keyless attestation
         attestations: write # record build provenance
       uses: chinmina/.github/.github/workflows/goreleaser-release.yml@verified-actions
       with:
         token-source: app
         disable-docker-login: true # no container image
         disable-npm: true # no npm package
       # Homebrew and Nix mint the package-repository token from the App
       # secrets in the release environment.
       secrets:
         RELEASE_PLEASE_CLIENT_ID: ${{ secrets.RELEASE_PLEASE_CLIENT_ID }}
         RELEASE_PLEASE_APP_PRIVATE_KEY: ${{ secrets.RELEASE_PLEASE_APP_PRIVATE_KEY }}
   ```

   Every channel is on by default. List only the channels the tool does not ship, and delete a channel's line to turn it on.

   Pass secrets by name, not with `secrets: inherit`. A named secret resolves in the environment of the reusable job that uses it, even when it exists only in that environment. `secrets: inherit` passes nothing when the caller and `chinmina/.github` have different owners, and the run still succeeds with empty secrets.

   **octo-sts only.** In both callers, set `token-source: octo-sts` and delete the `secrets:` block. The [shed example](../reference/shed/README.md#octo-sts-token-source) shows both files.

3. Create `.github/workflows/pr-title.yml`. Squash merges use the PR title as the commit message, and release-please reads commit messages to choose the version.

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

[Reusable workflows](../reference/reusable-workflows.md) lists every input.

## 10. Document installation

Add an `## Installation` and a `## Verifying releases` section to the repository's `README.md`. Include one collapsible block for each channel the tool ships, and no others. The [kms-import README][kms-readme] is a complete example.

````markdown
## Installation

Pre-built binaries for Linux, macOS, and Windows (amd64 and arm64) are published to
[GitHub Releases](https://github.com/<OWNER>/<REPO>/releases). Every artifact
carries a build provenance attestation; see [Verifying releases](#verifying-releases).

<details>
<summary><strong>mise (recommended)</strong></summary>

[mise](https://mise.jdx.dev/) installs from GitHub Releases and verifies the
artifact's checksum and build provenance attestation:

```sh
mise use -g github:<OWNER>/<REPO>
```

</details>

<details>
<summary><strong>Install script</strong></summary>

Each release includes an installer that detects your platform and checks the
download against the checksums embedded in the script:

```sh
curl -fsSL https://github.com/<OWNER>/<REPO>/releases/latest/download/install.sh | sh
```

It installs to `~/.local/bin`. Pass `-b` for another directory. To pin a
version, fetch the script from that release, so its embedded checksums match:

```sh
curl -fsSL https://github.com/<OWNER>/<REPO>/releases/download/v1.2.3/install.sh \
  | sh -s -- -b /usr/local/bin v1.2.3
```

The script has its own attestation. A verified script holds the genuine checksums
for its release and enforces them on the binary, so verifying the script covers
the binary for that release:

```sh
curl -fsSL -O https://github.com/<OWNER>/<REPO>/releases/latest/download/install.sh
gh attestation verify install.sh --repo <OWNER>/<REPO> \
  --signer-workflow chinmina/.github/.github/workflows/goreleaser-release.yml
sh install.sh
```

</details>

<details>
<summary><strong>Homebrew</strong></summary>

```sh
brew install <OWNER>/tap/<TOOL>
```

</details>

<details>
<summary><strong>Nix</strong></summary>

```sh
nix profile install github:<OWNER>/nixpkgs#<TOOL>
```

</details>

<details>
<summary><strong>Manual download</strong></summary>

Download the archive for your platform, verify its provenance, and put the binary on your `PATH`:

```sh
OS=linux ARCH=amd64   # or darwin/windows, arm64
curl -fsSLO "https://github.com/<OWNER>/<REPO>/releases/latest/download/<TOOL>_${OS}_${ARCH}.tar.gz"
gh attestation verify "<TOOL>_${OS}_${ARCH}.tar.gz" --repo <OWNER>/<REPO> \
  --signer-workflow chinmina/.github/.github/workflows/goreleaser-release.yml
tar -xzf "<TOOL>_${OS}_${ARCH}.tar.gz" <TOOL>
install -m 0755 <TOOL> ~/.local/bin/
```

Windows archives are `.zip`.

</details>

<details>
<summary><strong>go install</strong></summary>

Builds from source report the version `dev`.

```sh
go install github.com/<OWNER>/<REPO>/cmd/<TOOL>@latest
```

</details>

## Verifying releases

Release archives and `install.sh` carry a
[build provenance attestation](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds)
created with [Sigstore](https://www.sigstore.dev/) keyless signing. Each artifact
is bound, by digest, to the source commit and the workflow run that built it.
No long-lived signing key exists.

Verify a downloaded artifact with the [GitHub CLI](https://cli.github.com/) (2.49.0 or later):

```sh
gh attestation verify <TOOL>_linux_amd64.tar.gz --repo <OWNER>/<REPO> \
  --signer-workflow chinmina/.github/.github/workflows/goreleaser-release.yml
```

`--repo` checks the source repository. `--signer-workflow` is required because
the artifacts are signed by the shared release workflow in `chinmina/.github`,
not by a workflow in this repository.

`checksums.txt` lists every archive. After downloading it alongside an archive, check with
`sha256sum --check --ignore-missing checksums.txt`, or `shasum -a 256 --check --ignore-missing checksums.txt` on macOS.
````

## 11. Check before the first release

Run these checks from the repository root before you push.

1. Lint the workflows. These are one-off checks: run them at the pinned versions, and do not add them to `mise.toml`.

   ```sh
   mise exec actionlint@1.7.12 -- actionlint
   mise exec zizmor@1.25.2 -- zizmor .github/workflows
   ```

   Both report no findings.

2. Validate the goreleaser config.

   ```sh
   mise exec -- goreleaser check
   ```

3. Build a snapshot and inspect the generated cask. `--skip=nix` avoids needing Nix installed locally.

   ```sh
   HOMEBREW_GITHUB_TOKEN=unused mise exec -- goreleaser release --snapshot --clean --skip=nix
   grep -nE 'postflight_steps|staged_path|verified:|postflight do' dist/homebrew/Casks/<TOOL>.rb
   ```

   The output contains `postflight_steps` and `{{staged_path}}/<TOOL>`, and no `verified:` or `postflight do` lines.

## 12. Run the first release

1. Merge the pull request that adds the files above, with a Conventional Commit title such as `feat: publish releases`.

2. Wait for the `release-please` run, then confirm the Release PR exists.

   ```sh
   gh pr list --repo "<OWNER>/<REPO>" --label "autorelease: pending"
   ```

3. Merge the Release PR. The `release-please` run creates the draft release and the `v0.1.0` tag, and its `Verify release tag` step passes.

4. Wait for the `release` run on the tag to finish, then confirm the release is published with its assets.

   ```sh
   gh release view v0.1.0 --repo "<OWNER>/<REPO>" --json isDraft,assets \
     --jq '"draft: \(.isDraft)", (.assets[].name)'
   ```

   The output shows `draft: false`, the archives, `checksums.txt`, and `install.sh`.

5. Verify an artifact's provenance.

   ```sh
   gh release download v0.1.0 --repo "<OWNER>/<REPO>" --pattern '<TOOL>_linux_amd64.tar.gz'
   gh attestation verify <TOOL>_linux_amd64.tar.gz --repo "<OWNER>/<REPO>" \
     --signer-workflow chinmina/.github/.github/workflows/goreleaser-release.yml
   ```

   The command prints `✓ Verification succeeded!` and exits 0. `--signer-workflow` is required: the shared workflow in `chinmina/.github` signs the attestation, so `--repo` alone fails.

6. Install from each package channel.

   ```sh
   brew install <OWNER>/tap/<TOOL>
   nix build --no-link --print-out-paths github:<OWNER>/nixpkgs#<TOOL>
   ```

   `brew install` prints no deprecation warnings, and `nix build` prints a store path.

If a step fails, find the symptom in [Troubleshooting](../reference/troubleshooting.md).

[kms-readme]: https://github.com/chinmina/kms-import/blob/main/README.md
