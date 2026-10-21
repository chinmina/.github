# Documentation

Documentation for the shared automation in `chinmina/.github`. Guides walk through a task from start to finish. Reference pages describe inputs, configuration, and behaviour for lookup.

Pages are written for people and for coding agents. Guides are ordered steps with complete snippets and a check after each change. The [`docs` skill](../skills/docs/SKILL.md) defines the conventions.

## Guides

| Guide | Covers |
| ----- | ------ |
| [Release pipeline overview](guides/release-pipeline-overview.md) | How a release moves from commit to publication, token sources, and channels |
| [Adopting the release pipeline](guides/adopting-the-release-pipeline.md) | Connecting a Go CLI to the pipeline, through to its first release |
| [Setting up package repositories](guides/setting-up-package-repositories.md) | Creating the owner's `homebrew-tap` and `nixpkgs` repositories |
| [Publishing to npm](guides/publishing-to-npm.md) | Adding the npm channel with trusted publishing |
| [Publishing container images](guides/publishing-container-images.md) | Adding a signed container image built by goreleaser |

## Reference

| Page | Describes |
| ---- | --------- |
| [Reusable workflows](reference/reusable-workflows.md) | Inputs, secrets, permissions, and steps of each reusable workflow |
| [Repository configuration](reference/repository-configuration.md) | What a consuming repository must provide: callers, environments, release-please, goreleaser, mise, and binstaller |
| [Composite actions](reference/composite-actions.md) | The actions behind the workflows |
| [Troubleshooting](reference/troubleshooting.md) | Symptoms, causes, and fixes |
| [shed worked example](reference/shed/) | The reference implementation for a CLI tool |
