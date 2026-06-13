# `binstaller-install-script`

Generate an attestable `install.sh` from the committed binstaller spec with the
current release's checksums embedded, and upload it to the GitHub release — reqs
**R25/R26/R27**.

The committed spec is **never modified**: checksums are embedded into a working
copy (a `mktemp` file), so `git status` stays clean after a run (**R26**). If the
spec is missing or empty the action fails before generating anything (**R27**).

## Inputs

| Input            | Required | Default                | Description |
|------------------|----------|------------------------|-------------|
| `spec`           | no       | `.config/binstaller.yml` | Path to the committed binstaller spec. |
| `version`        | yes      | —                      | Release tag to embed checksums for and upload to (e.g. `v1.2.3`). |
| `checksums-file` | no       | `dist/checksums.txt`   | Goreleaser checksums file to source per-artifact checksums from. |
| `output`         | no       | `install.sh`           | Path to write the generated install script. |
| `upload`         | no       | `"true"`               | Upload the generated script to the release as an asset. |

## Requirements

- The `binst` CLI must be on `PATH`. Include `binstaller` in
  `setup-release-toolchain`'s `mise-tools` earlier in the job (the wrapper does
  this). The consumer's `mise.toml` must declare it with `exe = "binst"` so the
  shim is named `binst` — see
  [Declaring `binstaller`](../../../docs/adopting-the-release-pipeline.md#declaring-binstaller).
- `GITHUB_TOKEN` with `contents: write` (used for `gh release upload`); supplied
  automatically from the job token.

> **Canary note.** binstaller is validated by the canary release, not unit tests
> (per the PRD testing decisions). The exact `binst embed-checksums` / `binst gen`
> flags should be reconciled against the consumer's pinned binstaller version on
> first run.

## Usage

```yaml
- uses: chinmina/.github/.github/actions/setup-release-toolchain@verified-actions
  with:
    mise-tools: goreleaser binstaller
- uses: chinmina/.github/.github/actions/binstaller-install-script@verified-actions
  with:
    version: ${{ github.ref_name }}
```
