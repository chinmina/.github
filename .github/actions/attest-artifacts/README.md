# `attest-artifacts`

Generate keyless build-provenance attestations for a goreleaser checksums file
and, optionally, an extra file such as `install.sh` — reqs **R28/R29/R30**.

The checksums file is passed to `actions/attest-build-provenance` via
`subject-checksums`, so **each artifact listed in the file becomes its own
attested subject**. That is what makes `gh attestation verify <archive>` succeed
against the individual release archives (not just the checksums file).

## Inputs

| Input                | Required | Default              | Description |
|----------------------|----------|----------------------|-------------|
| `checksums-file`     | no       | `dist/checksums.txt` | Goreleaser checksums file (shasum format). Each listed file is attested. |
| `extra-subject-path` | no       | `""`                 | Optional additional file to attest as its own subject (e.g. `install.sh`). |

## Outputs

None directly; attestations are recorded in the GitHub attestations store.

## Required job permissions

The **calling job** must grant:

```yaml
permissions:
  id-token: write      # R29/R30: keyless OIDC signing
  attestations: write  # record the attestation
  contents: read       # (or write, per the rest of the job)
```

If `id-token: write` is absent, the underlying attest action fails with a
permissions error (**R30**).

## Usage

```yaml
- uses: chinmina/.github/.github/actions/attest-artifacts@verified-actions
  with:
    checksums-file: dist/checksums.txt
    extra-subject-path: install.sh   # omit to attest only the checksummed artifacts
```
