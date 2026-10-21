# Composite actions

The reusable workflows are built from composite actions in [`.github/actions/`](../../.github/actions/). Each action's `README.md` documents its inputs. Consumers do not call these actions directly; the reusable workflows call them at `@verified-actions`.

| Action | Called by | Purpose |
| ------ | --------- | ------- |
| [`validate-release-please-config`](../../.github/actions/validate-release-please-config/) | `release-please.yml` | Validates `release-please-config.json` against release-please's schema, rejecting unknown keys, and requires `draft` and `force-tag-creation`. |
| [`setup-release-toolchain`](../../.github/actions/setup-release-toolchain/) | `goreleaser-release.yml` | Installs the requested CLIs through mise in one cached pass, and sets up Go, Bun, and Node from their mise versions when declared. |
| [`binstaller-install-script`](../../.github/actions/binstaller-install-script/) | `goreleaser-release.yml` | Generates `install.sh` from the binstaller spec with the release's checksums embedded, and uploads it to the release. |
| [`attest-artifacts`](../../.github/actions/attest-artifacts/) | `goreleaser-release.yml` | Attests every file listed in `dist/checksums.txt`, and optionally `install.sh`, with keyless build provenance. |
| [`npm-publish`](../../.github/actions/npm-publish/) | `goreleaser-release.yml` | Publishes one npm package per archive in `dist/artifacts.json`, plus a main package with a hosted launcher, using trusted publishing. |

## Quality checks

Run the checks for this repository from its root. `mise.toml` pins the tools.

```sh
mise exec -- actionlint
mise exec -- zizmor .
```
