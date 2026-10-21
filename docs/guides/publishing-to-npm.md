# Publishing to npm

This guide adds the npm channel to a repository that already uses the shared release pipeline. Each release then publishes one npm package per platform archive, plus a main package whose launcher runs the right binary. Users install the tool with `npm install -g <NPM_PACKAGE>` or run it with `npx <NPM_PACKAGE>`.

Publishing uses npm trusted publishing. The release job's OIDC token authenticates to npm, so no npm token is stored. npm attaches provenance to each package automatically.

## Before you start

- The repository releases through the pipeline. See [Adopting the release pipeline](adopting-the-release-pipeline.md).
- The tag caller is named `.github/workflows/release.yml`. npm trusted publishing matches the caller's filename.
- You can create packages in the npm scope you will publish under.

| Placeholder | Meaning | Example |
| ----------- | ------- | ------- |
| `<NPM_PACKAGE>` | npm name of the main package | `@chinmina/shed` |

Platform packages are named `<NPM_PACKAGE>-<os>-<cpu>`, for example `@chinmina/shed-linux-x64` and `@chinmina/shed-windows-arm64`.

## 1. Declare Node

The release job checks that `node` is declared in `mise.toml` before the build, and fails without it. Add it to `[tools]`:

```toml
# mise.toml
[tools]
node = "24"
```

## 2. Add the main package

Create `.github/workflows/npm/main/package.json`. It holds the metadata you own:

```json
{
  "name": "<NPM_PACKAGE>",
  "description": "<DESCRIPTION>",
  "homepage": "https://github.com/<OWNER>/<REPO>",
  "license": "Apache-2.0",
  "keywords": ["cli"]
}
```

The publish step fills in everything else. Do not add a launcher script.

| Field | Behaviour |
| ----- | --------- |
| `name` | Replaced with the `npm-package-name` input. Keep the two equal to avoid confusion. |
| `version` | Replaced with the release tag, without the leading `v`. |
| `repository` | Replaced with the GitHub repository. |
| `bin` | Replaced with one entry, mapping the command name to the hosted launcher. |
| `optionalDependencies` | Replaced with the platform packages, pinned to the release version. |
| `files` | Your entries, plus the launcher and `README.md`. |
| `engines` | Set to `{"node":">=18"}` when absent. |
| `chinmina` | Replaced with the platform map the launcher reads. |
| `description`, `homepage`, `license`, `keywords` | Kept as written. |

The command name defaults to the unscoped package name (`shed` for `@chinmina/shed`). To use another name, add `"chinmina": { "command": "<COMMAND>" }`.

To keep the package somewhere else, set the `npm-main-package-dir` input to that directory.

## 3. Turn on the channel

In `.github/workflows/release.yml`, delete `disable-npm: true` and set the package name:

```yaml
# .github/workflows/release.yml (excerpt)
    with:
      token-source: app
      disable-docker-login: true
      npm-package-name: "<NPM_PACKAGE>"
```

## 4. Register trusted publishers

npm checks trusted publishing per package. Register the main package and every platform package.

1. List the platform packages the release will publish. Each archive goreleaser builds becomes one package.

   ```sh
   mise exec -- goreleaser release --snapshot --clean --skip=nix,homebrew
   jq -r '.[] | select(.type == "Archive")
     | "<NPM_PACKAGE>-\(.goos)-\({"amd64": "x64", "arm64": "arm64", "386": "ia32", "arm": "arm"}[.goarch])"' \
     dist/artifacts.json
   ```

   Names use goreleaser's OS (`linux`, `darwin`, `windows`) and npm's CPU (`x64`, `arm64`).

2. Make sure each package exists on the registry. npm only accepts a trusted publisher for an existing package, so publish a placeholder version by hand for any new name.

3. Register the trusted publisher for each package with npm 11.15.0 or later. Your npm account needs write access to the packages and two-factor authentication.

   ```sh
   for pkg in "<NPM_PACKAGE>" "<NPM_PACKAGE>-linux-x64" "<NPM_PACKAGE>-windows-x64"; do
     npm trust github "${pkg}" --file release.yml --repo "<OWNER>/<REPO>" \
       --env release --allow-publish --yes
   done
   ```

   List every package from the previous step in the loop. `--allow-publish` is required: the kit publishes with `npm publish`, and trusted publishers created since September 2026 allow only `npm stage publish` by default.

   The same settings are available on [npmjs.com](https://www.npmjs.com/) under the package's **Settings → Trusted publishing**:

   | Field | Value |
   | ----- | ----- |
   | Organization or user | `<OWNER>` |
   | Repository | `<REPO>` |
   | Workflow filename | `release.yml` |
   | Environment name | `release` |
   | Allowed actions | `npm publish` |

4. Confirm a package's configuration.

   ```sh
   npm trust list "<NPM_PACKAGE>"
   ```

## 5. Check the next release

After the next release, confirm the main package resolves to the new version:

```sh
npm view "<NPM_PACKAGE>" version
npx -y "<NPM_PACKAGE>" --help
```

## Failure modes

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| *Validate npm inputs* fails | `npm-package-name` is empty, the main package directory or its `package.json` is missing, or `node` is not in `mise.toml` | Complete steps 1 to 3. |
| Publish fails with 401 or an OIDC error | The trusted publisher does not match `release.yml`, the `release` environment, and `<OWNER>/<REPO>`, or does not allow `npm publish` | Replace the failing package's trusted publisher. Register the caller (`release.yml`), not `goreleaser-release.yml`, and allow `npm publish`. |
| Preflight fails: no archives found | goreleaser produced no archives in `dist/artifacts.json` | Fix the goreleaser `archives` configuration. |
| Preflight fails: unknown `goos` or `goarch` | goreleaser builds a platform with no Node equivalent | Remove the target from the goreleaser build. |

## Migrating from a local launcher

Repositories that adopted npm before the launcher was hosted have a `bin/<TOOL>.js` and a full `package.json` in the main package directory.

1. Delete `bin/<TOOL>.js` and the empty `bin/` directory.
2. Remove `optionalDependencies`, `version`, `repository`, and `bin` from `package.json`. The publish step replaces them.
3. Keep `engines` only if you need a value other than `>=18`.

The publish step validates the main package before publishing anything, so a mistake fails the run with no packages published.
