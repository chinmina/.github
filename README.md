# chinmina/.github

The `.github` repository for the [chinmina](https://github.com/chinmina) organisation. It holds shared automation that other chinmina repositories, and other owners, consume:

- **A release pipeline** of reusable GitHub Actions workflows that build, attest, and publish Go and Bun tools.
- **A shared Renovate config** that consuming repositories extend.
- **Agent skills** for onboarding repositories and writing documentation.
- **The organisation profile** shown on [github.com/chinmina](https://github.com/chinmina).

## Release pipeline

A repository adds two short caller workflows and its release configuration. The shared workflows turn Conventional Commits into a GitHub Release, with build provenance for every artifact, and publish to Homebrew, Nix, npm, and container registries. The release stays a draft until every artifact is uploaded and attested, so nothing is downloadable without provenance, and the published release can be made immutable.

```yaml
# .github/workflows/release.yml in a consuming repository
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
      disable-docker-login: true
      disable-npm: true
    secrets:
      RELEASE_PLEASE_CLIENT_ID: ${{ secrets.RELEASE_PLEASE_CLIENT_ID }}
      RELEASE_PLEASE_APP_PRIVATE_KEY: ${{ secrets.RELEASE_PLEASE_APP_PRIVATE_KEY }}
```

| Start here | For |
| ---------- | --- |
| [Release pipeline overview](docs/guides/release-pipeline-overview.md) | How the pipeline works, with diagrams |
| [Adopting the release pipeline](docs/guides/adopting-the-release-pipeline.md) | Connecting a Go CLI, step by step |
| [shed worked example](docs/reference/shed/) | Every file for one CLI tool, filled in |

## Renovate

Consuming repositories extend [`renovate/shared.json5`](renovate/shared.json5) from their own `renovate.json5`:

```json5
{
  $schema: "https://docs.renovatebot.com/renovate-schema.json",
  extends: ["github>chinmina/.github//renovate/shared.json5"],
}
```

The preset floats on the default branch, so a fix to the shared config reaches every repository without a migration. The [`renovate-onboard`](skills/renovate-onboard/SKILL.md) skill creates or migrates a repository's config.

## Skills

Agent skills in [`skills/`](skills/):

| Skill | Use |
| ----- | --- |
| [`renovate-onboard`](skills/renovate-onboard/SKILL.md) | Create or migrate a repository's `renovate.json5` to extend the shared config |
| [`docs`](skills/docs/SKILL.md) | Write and edit documentation in GitHub Flavored Markdown, in the house voice |

## Documentation

[`docs/`](docs/) is split into guides, for doing a task, and reference, for looking up facts. See the [documentation index](docs/README.md).

## Repository layout

```text
.github/
├── actions/          Composite actions used by the reusable workflows
├── workflows/        Reusable workflows, and this repository's own CI
└── zizmor.yml        Pinning policy for actions
docs/
├── guides/           How-to guides and the pipeline overview
└── reference/        Workflow inputs, configuration, troubleshooting, worked example
profile/              Organisation profile README
renovate/             Shared Renovate preset
skills/               Agent skills
mise.toml             Tool versions for this repository's checks
```

## Contributing

Consumers pin to the `verified-actions` branch, which is fast-forwarded only to reviewed commits on `main`. Third-party actions are pinned to full commit SHAs, and first-party references use `@verified-actions`; [`.github/zizmor.yml`](.github/zizmor.yml) enforces both.

Run the checks from the repository root. `mise.toml` pins the tools.

```sh
mise exec -- actionlint
mise exec -- zizmor .
.github/actions/validate-release-please-config/test/run.sh
(cd .github/actions/npm-publish && bun install && bun test && bun run typecheck)
```

Pull request titles follow [Conventional Commits](https://www.conventionalcommits.org/).
