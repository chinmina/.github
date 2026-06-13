# `setup-release-toolchain`

One upfront installer for a release job, with **mise as the single version
authority** — req **R18/R19**. It installs the requested CLIs through mise in a
single cached pass, then sets up Go and/or Bun via their dedicated setup actions
with versions read from the same mise config. It serves both Go and Bun
projects: goreleaser builds both, so the kit has one toolchain installer.

This is a *prescriptive* action: every **requested CLI** MUST be declared in the
consumer's `mise.toml` / `.tool-versions`. If one is missing, the action fails
and names it — the toolkit imposes the standard rather than papering over a
missing declaration.

## How it works

1. **`jdx/mise-action` (once)** installs mise *and* the requested CLIs
   (`install_args`), with `reshim: true` + `cache: true`. One invocation → one
   coherent cache entry for the whole CLI set. (Installing tools one-at-a-time
   would produce a separate, overlapping cache per tool, because mise-action's
   cache key folds in a hash of the install args.)
2. A **bash step** reads `mise ls --current --json` (mise is now on `PATH`),
   **fails** naming any missing requested CLI, and exports the resolved Go/Bun
   versions.
3. **`actions/setup-go`** runs with the Go version from mise — **only if Go is
   declared**.
4. **`oven-sh/setup-bun`** runs with the Bun version from mise — **only if Bun
   is declared**.

Go and Bun are version-*extracted* but **not** installed through mise, so no
mise `go`/`bun` shim competes with their setup action on `PATH`.

## Tool classes

| Class | Tools | Behaviour |
|-------|-------|-----------|
| Required, mise-installed | the `mise-tools` you pass (e.g. `goreleaser`, `binstaller`) | installed via mise; **fail** if undeclared |
| Auto-detected, setup-action | Go, Bun | version from mise → `setup-go` / `setup-bun` **iff declared**; skipped if absent |

A Go project declares `go`; a Bun project declares `bun`; a project can declare
both (e.g. a Go binary whose build needs Bun for frontend assets).

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `mise-tools` | yes | — | Whitespace-separated CLI tools to install via mise, as named in the consumer's mise config (e.g. `goreleaser binstaller`). All are required. |

## Outputs

| Output | Description |
|--------|-------------|
| `go_version` | Go version resolved from mise (empty if Go is not declared). |
| `bun_version` | Bun version resolved from mise (empty if Bun is not declared). |

The mise CLIs land on `PATH` for later steps: `jdx/mise-action` writes the shims
directory to `$GITHUB_PATH` and runs `mise reshim -f`. (A bare `mise install` in
a `run:` step would not — `PATH` edits there don't carry to later steps; only
`$GITHUB_PATH` does.)

## Usage

```yaml
- uses: chinmina/.github/.github/actions/setup-release-toolchain@verified-actions
  with:
    mise-tools: goreleaser binstaller
# Go and/or Bun are set up automatically from whatever the repo declares in mise;
# an undeclared one is simply skipped.
```

> **Declaring `binstaller`.** Validation here is `jq 'has("binstaller")'`, so
> the tool must surface under the exact key `binstaller` — but it has no mise
> registry short name, and the downstream `binstaller-install-script` action
> calls the CLI as `binst`. Both needs are met by an aliased `github:` backend
> in `mise.toml` (not `.tool-versions`):
>
> ```toml
> [tool_alias]
> binstaller = "github:binary-install/binstaller"
>
> [tools]
> binstaller = { version = "0.12.0", exe = "binst" }
> ```
>
> See [Declaring `binstaller`](../../../docs/adopting-the-release-pipeline.md#declaring-binstaller)
> for why each piece is required.
