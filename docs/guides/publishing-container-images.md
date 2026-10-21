# Publishing container images

This guide adds a container image to a repository that already uses the shared release pipeline. goreleaser builds, signs, and pushes the image. The release workflow only logs in to Docker Hub before the build and installs the signing tools you list.

## Before you start

- The repository releases through the pipeline. See [Adopting the release pipeline](adopting-the-release-pipeline.md).
- A Docker Hub account or organisation that owns the image repository, and an access token with write access to it.

| Placeholder | Meaning | Example |
| ----------- | ------- | ------- |
| `<IMAGE>` | Docker Hub image repository | `chinmina/shed` |
| `<DOCKERHUB_USER>` | Docker Hub username for the access token | `chinminabot` |

## 1. Store the Docker Hub credentials

The login step reads the username from a variable and the token from a secret, both in the `release` environment.

```sh
gh variable set DOCKERHUB_USER --repo "<OWNER>/<REPO>" --env release --body "<DOCKERHUB_USER>"
gh secret set DOCKERHUB_TOKEN --repo "<OWNER>/<REPO>" --env release
```

`gh secret set` prompts for the token value.

## 2. Declare cosign

Declare `cosign` in `mise.toml`, so the signing step has a pinned version:

```toml
# mise.toml
[tools]
cosign = "3.1.3"
```

## 3. Turn on the channel

In `.github/workflows/release.yml`, delete `disable-docker-login: true`, list `cosign` in `extra-mise-tools`, and keep `secrets: inherit` so `DOCKERHUB_TOKEN` reaches the release job:

```yaml
# .github/workflows/release.yml (excerpt)
    uses: chinmina/.github/.github/workflows/goreleaser-release.yml@verified-actions # zizmor: ignore[secrets-inherit]
    with:
      token-source: app
      disable-npm: true
      extra-mise-tools: cosign # names only; versions come from mise.toml
    secrets: inherit
```

A tool in `extra-mise-tools` must also be declared in `mise.toml`. Declaring it alone does not install it for the release job.

## 4. Configure the image in goreleaser

The release workflow never sets the image repository. Select it in the goreleaser config, so local snapshot builds push to the ephemeral `ttl.sh` registry and CI pushes to Docker Hub. This example uses ko:

```yaml
# .goreleaser.yaml (excerpt)
kos:
  - repositories:
      - "{{ if .Env.KO_DOCKER_REPO }}{{ .Env.KO_DOCKER_REPO }}{{ else }}ttl.sh/<TOOL>{{ end }}"
    tags: ["{{ .Version }}"]
    bare: true
    platforms: ["linux/amd64", "linux/arm64"]

docker_signs:
  - cmd: cosign
    args: ["sign", "--yes", "${artifact}@${digest}"]
    artifacts: manifests
    output: true
```

Set `KO_DOCKER_REPO` for CI only, in `mise.toml`:

```toml
# mise.toml
[env]
KO_DOCKER_REPO = "{{ get_env(name='CI', default='') | replace(from='true', to='docker.io/<IMAGE>') }}"
```

With `CI=true`, which GitHub Actions sets, the value is `docker.io/<IMAGE>`. Without it, the value is empty and goreleaser falls back to `ttl.sh`.

## 5. Check the next release

After the next release, confirm the image and its signature:

```sh
docker pull "<IMAGE>:<VERSION>"
cosign verify "<IMAGE>:<VERSION>" \
  --certificate-identity-regexp "^https://github.com/chinmina/.github/" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

`<VERSION>` is the release version without the leading `v`. The signing identity is the reusable workflow in `chinmina/.github`, because cosign signs from inside it.

## Failure modes

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| *Validate docker login inputs* fails | `DOCKERHUB_USER` is not set in the `release` environment | Complete step 1. |
| Login fails with an authentication error | `DOCKERHUB_TOKEN` is missing or wrong, or the caller does not pass `secrets: inherit` | Set the secret in `release` and keep `secrets: inherit`. |
| The image is pushed to `ttl.sh` from CI | `KO_DOCKER_REPO` is empty during the release | Check the `[env]` entry, or set `KO_DOCKER_REPO` another way for CI. |
| `setup-release-toolchain` fails: `cosign` not declared | `cosign` is in `extra-mise-tools` but not in `mise.toml` | Declare it in `mise.toml`, by name and version. |
