# Release pipeline overview

The shared release pipeline turns Conventional Commits on a repository's default branch into a published, attested release. A consuming repository adds two short caller workflows and its own release configuration. The build, attestation, and publishing logic lives in this repository.

This page explains how the pipeline works. To connect a repository, follow [Adopting the release pipeline](adopting-the-release-pipeline.md).

## Guarantees

- **Nothing is downloadable before its provenance exists.** The release stays a draft until every artifact has a build provenance attestation.
- **No long-lived signing key.** Attestations use Sigstore keyless signing, bound to the workflow run that built the artifacts.
- **Short-lived, scoped tokens.** Every write uses an installation token minted for the run, limited to the repositories that step writes to.
- **One configuration for every repository.** Callers differ only in their token source and the channels they disable.

## End to end

A release passes through two workflows. `release-please.yml` decides the version and creates the draft release. `goreleaser-release.yml` fills that draft, attests it, and publishes it.

```mermaid
flowchart LR
    classDef consumer fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef kit fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a
    classDef gate fill:#fef3c7,stroke:#b45309,color:#78350f
    classDef external fill:#f3e8ff,stroke:#7e22ce,color:#3b0764
    classDef optional fill:#f1f5f9,stroke:#64748b,color:#0f172a,stroke-dasharray:4 3

    commits["Conventional<br/>commits on main"]:::consumer

    subgraph rp ["release-please.yml · automation"]
        direction LR
        pr["Release PR"]:::kit
        draft["Draft release<br/>+ v* tag"]:::kit
        pr -- "merge" --> draft
    end

    subgraph gr ["goreleaser-release.yml · release"]
        direction LR
        build["Build<br/>goreleaser"]:::kit
        attest{{"Attest<br/>every artifact"}}:::gate
        publish["Publish<br/>release"]:::kit
        build --> attest --> publish
    end

    subgraph ch ["Package channels"]
        direction TB
        brew["homebrew-tap"]:::external
        nix["nixpkgs"]:::external
        npm["npm"]:::optional
        docker["container registry"]:::optional
    end

    commits --> pr
    draft -- "tag push" --> build
    publish --> gh["GitHub Release<br/>+ install.sh"]:::external
    build --> ch

    style rp fill:none,stroke:#1d4ed8,stroke-dasharray:6 4
    style gr fill:none,stroke:#1d4ed8,stroke-dasharray:6 4
    style ch fill:none,stroke:#7e22ce,stroke-dasharray:6 4
```

Grey dashed channels are the ones a typical CLI tool disables. The Homebrew cask and Nix recipe are committed during the build, but their URLs point at release assets that return 404 until the release is published.

## Release sequence

The sequence below follows one release from commit to publication. The tag push in step 6 is what connects the two workflows. It is made with an installation token, because a tag pushed with `GITHUB_TOKEN` does not trigger workflows.

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Developer
    box rgba(21,128,61,0.10) Consuming repository
        participant Main as main branch
    end
    box rgba(29,78,216,0.10) Shared kit
        participant RP as release-please.yml
        participant Rel as goreleaser-release.yml
    end
    box rgba(126,34,206,0.10) GitHub
        participant GH as Releases and tags
        participant Att as Attestations
    end

    rect rgba(21,128,61,0.08)
        Note over Dev,RP: Prepare
        Dev->>Main: merge PRs with conventional titles
        Main->>RP: push
        RP->>RP: validate release-please-config.json
        RP->>GH: open or update the Release PR
    end

    rect rgba(29,78,216,0.08)
        Note over Dev,GH: Tag
        Dev->>GH: merge the Release PR
        GH->>RP: push
        RP->>GH: create draft release and v* tag
        RP->>GH: confirm the tag is at the release commit
        RP->>GH: open the next Release PR
    end

    rect rgba(180,83,9,0.10)
        Note over GH,Att: Build and attest
        GH->>Rel: tag push
        Rel->>Rel: check goreleaser config, set up toolchain
        Rel->>GH: goreleaser fills the draft
        Rel->>GH: upload install.sh
        Rel->>Att: attest archives and install.sh
    end

    rect rgba(21,128,61,0.08)
        Note over Rel,GH: Publish
        Rel->>GH: publish the release, last
    end
```

## Release states

A release is visible only once it is published, and it is published only after attestation. A failed run anywhere before that leaves a draft that no one can download. Fix the cause and re-run the workflow: `release.replace_existing_artifacts: true` lets goreleaser replace the assets an earlier run uploaded, and `install.sh` is overwritten.

Two side effects reach outside the draft:

- goreleaser commits the Homebrew cask and Nix recipe before attestation. After a later failure, they point at a release that is not yet published, so installs fail until a re-run succeeds. The re-run commits them again.
- npm versions cannot be overwritten. If the npm step fails after publishing some packages, a re-run fails on those packages. Release a new patch version instead.

```mermaid
stateDiagram-v2
    classDef pending fill:#f1f5f9,stroke:#64748b,color:#0f172a
    classDef gate fill:#fef3c7,stroke:#b45309,color:#78350f
    classDef live fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef failed fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d

    [*] --> ReleasePR: commits on main
    ReleasePR --> Draft: Release PR merged
    Draft --> Filled: goreleaser uploads assets
    Filled --> Attested: provenance recorded
    Attested --> Published: draft flag removed
    Published --> [*]

    Draft --> Failed: build error
    Filled --> Failed: attestation error
    Failed --> Draft: re-run the workflow

    class ReleasePR, Draft, Filled pending
    class Attested gate
    class Published live
    class Failed failed
```

| State | Visible to users | Holds |
| ----- | ---------------- | ----- |
| `ReleasePR` | No | The proposed version and changelog |
| `Draft` | No | The release-please notes and the `v*` tag |
| `Filled` | No | Archives, `checksums.txt`, and `install.sh` |
| `Attested` | No | A build provenance attestation for every artifact |
| `Published` | Yes | Everything above; prerelease tags are marked as prereleases |

## Token sources

Each workflow needs installation tokens with write access. A repository chooses where they come from with the `token-source` input, and both callers must use the same value.

`app` is the chinmina standard. A release GitHub App is installed on the consuming repository and the package repositories, and its credentials are stored as secrets in the `automation` and `release` environments. `octo-sts` is the keyless alternative for owners that run [octo-sts](https://github.com/octo-sts/app): tokens are exchanged for the job's OIDC token, against trust policies the owner defines for each identity.

```mermaid
flowchart LR
    classDef app fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a
    classDef sts fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef target fill:#f3e8ff,stroke:#7e22ce,color:#3b0764

    subgraph stsSG ["token-source: octo-sts"]
        direction LR
        i1["release-please-#lt;REPO#gt;"]:::sts --> s1["Release PR and tag"]:::target
        i2["release-#lt;REPO#gt;"]:::sts --> s2["Fill draft,<br/>upload assets"]:::target
        i3["release-tap"]:::sts --> s3["homebrew-tap,<br/>nixpkgs"]:::target
    end

    subgraph appSG ["token-source: app"]
        direction LR
        appkey1["GitHub App<br/>automation secrets"]:::app --> a1["Release PR and tag"]:::target
        gtoken["github.token"]:::app --> a2["Fill draft,<br/>upload assets"]:::target
        appkey2["GitHub App<br/>release secrets"]:::app --> a3["homebrew-tap,<br/>nixpkgs"]:::target
    end

    style appSG fill:none,stroke:#1d4ed8,stroke-dasharray:6 4
    style stsSG fill:none,stroke:#15803d,stroke-dasharray:6 4
```

| | `app` | `octo-sts` |
| - | ----- | ---------- |
| Stored credential | App private key, in both environments | None |
| Per-repository setup | Two secrets in each environment; App installed on the repository | Owner trust policies for `release-please-<REPO>`, `release-<REPO>`, and `release-tap` |
| Caller `secrets:` | Both App secrets, by name | Omitted |

## Where configuration lives

Configuration is split across repositories. A consuming repository controls its build configuration, and the shared kit controls how it is built, attested, and published.

```mermaid
flowchart LR
    classDef consumer fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef kit fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a
    classDef external fill:#f3e8ff,stroke:#7e22ce,color:#3b0764

    subgraph repoSG ["#lt;OWNER#gt;/#lt;REPO#gt;"]
        direction TB
        callers["release-please.yml<br/>release.yml"]:::consumer
        config["release-please-config.json<br/>.goreleaser.yaml<br/>mise.toml<br/>.config/binstaller.yml"]:::consumer
        envs["automation and release<br/>environments + App secrets"]:::consumer
    end

    subgraph kitSG ["chinmina/.github"]
        direction TB
        workflows["reusable workflows"]:::kit
        actions["composite actions"]:::kit
        workflows --> actions
    end

    subgraph pkgSG ["package repositories"]
        direction TB
        tap["#lt;OWNER#gt;/homebrew-tap"]:::external
        nixpkgs["#lt;OWNER#gt;/nixpkgs"]:::external
    end

    callers -- "uses @verified-actions" --> workflows
    config -- "read by" --> workflows
    envs -- "secrets, by name" --> workflows
    workflows -- "commits cask<br/>and recipe" --> pkgSG

    style repoSG fill:none,stroke:#15803d,stroke-dasharray:6 4
    style kitSG fill:none,stroke:#1d4ed8,stroke-dasharray:6 4
    style pkgSG fill:none,stroke:#7e22ce,stroke-dasharray:6 4
```

| Repository | Holds | Changed by |
| ---------- | ----- | ---------- |
| `<OWNER>/<REPO>` | Caller workflows, build configuration, environments | The project's maintainers |
| `chinmina/.github` | Reusable workflows and composite actions | Reviewed changes, then a fast-forward of `verified-actions` |
| `<OWNER>/homebrew-tap`, `<OWNER>/nixpkgs` | Casks and recipes | The release job only |

## Channels

Every channel is on by default. A caller disables the channels its project does not ship.

| Channel | Publishes | Turn off with | Needs |
| ------- | --------- | ------------- | ----- |
| GitHub Release | Archives and `checksums.txt` | Always on | Nothing extra |
| binstaller | Attested `install.sh` | `disable-binstaller: true` | `binstaller` in `mise.toml`, `.config/binstaller.yml` |
| Homebrew | Cask in `<OWNER>/homebrew-tap` | `disable-homebrew: true` | `homebrew_casks:` in goreleaser, write access to the tap |
| Nix | Recipe in `<OWNER>/nixpkgs` | `disable-nix: true` | `nix:` in goreleaser, write access to `nixpkgs` |
| npm | One package per platform plus a launcher | `disable-npm: true` | See [Publishing to npm](publishing-to-npm.md) |
| Container image | Image built by goreleaser (ko or Docker) | `disable-docker-login: true` | See [Publishing container images](publishing-container-images.md) |

The [shed worked example](../reference/shed/) is a CLI tool that ships the first four channels.
