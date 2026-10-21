# Formatting and Structure

Prose-level decisions: choosing between lists and paragraphs, sentence structure, and inline formatting conventions.

## Prose vs Bullets

### Use Paragraphs For

1. **Conceptual explanations** - describing what something is or why it matters
2. **Context-setting** before a procedure
3. **"How it works" sections** that describe system behavior

**Example:**

> "Organization profiles are a way to facilitate cross-repository access for pipelines as well as managing the permissions provided by the tokens that Chinmina Bridge creates."

### Use Numbered Lists For

1. **Sequential procedures** - when order matters
2. **Ordered prerequisites** - distinct items that must be completed

For procedures, use a plain numbered list. Indent follow-on paragraphs and code blocks by three spaces so they stay inside the list item:

````markdown
1. Create an application in your GitHub organization.

   Collect the "Application ID" of the application created.

2. Create and save a private key for the application.

   ```sh
   chmod 600 private-key.pem
   ```
````

Write every item number as written (`1.`, `2.`, `3.`), so the source reads correctly as well as the rendered page.

### Use Bullet Lists For

1. **Parallel configuration options** - when items are choices or alternatives
2. **Feature lists** - describing capabilities
3. **Field documentation** - listing available fields

**Example:**

> Three endpoints are exposed:
>
> - `/token`, which returns a token and its expiry, and
> - `/git-credentials`, which returns the token and repository metadata in the Git Credentials format.
> - `/healthcheck`, which returns 200.

### Paragraph Length

Keep paragraphs to **1-3 sentences**. Single-sentence paragraphs are acceptable and common.

A run of one-sentence paragraphs is as poor as one long paragraph. Fuse a claim with the mechanism that justifies it rather than asserting each separately.

**Bad:** (a sequence of single-thought paragraphs)

> "Those properties exist to integrate with the credential helper protocol. They are not a security boundary."
>
> "Git reads a 200 carrying no properties as a decline and moves on to the next helper."
>
> "An error instead would end the operation."

**Good:**

> "The target is not a security boundary. It exists so Chinmina Bridge works within Git's credential chain, where a 200 carrying no properties reads as a decline and Git moves on to the next configured helper for the repository."

**Good:**

> "Chinmina itself is a simple service, but it sits in the middle of an ecosystem. This means that a working installation requires a number of setup items."
>
> "Before you start, there are a few things you'll need to have:"

**Bad:** (Single long paragraph)

> "Chinmina itself is a simple service, but it sits in the middle of an ecosystem, which means that a working installation requires a number of setup items. Before you start, there are a few things you'll need to have, including a GitHub App with appropriate permissions and a Buildkite API token with the right scopes. These requirements exist because of how the system integrates with both platforms."

## Sentence Structure

### Length: Short to Medium

Aim for sentences under 20 words. Medium-length sentences are acceptable when clarity requires.

**Good:**

- "Container distribution is recommended." (3 words)
- "This is a highly sensitive credential." (6 words)
- "The token identifies the Buildkite pipeline that is executing, so the associated repository can be looked up." (17 words)

**Bad:**

- "In order to ensure that the system functions correctly and securely, you'll want to make sure that you're using container distribution, which is the recommended approach for deploying this service in production environments." (38 words)

### Instructions: Imperative Verb First

Start instructions with the action verb. Add context after the command when necessary.

**Good:**

- "Create an application in your GitHub organization."
- "Set the environment variable `GITHUB_APP_PRIVATE_KEY_ARN` to the ARN of the **alias** that has just been created."
- "Run `direnv allow` to bring the updated configuration into the environment."

**Bad:**

- "You should create an application in your GitHub organization."
- "The environment variable `GITHUB_APP_PRIVATE_KEY_ARN` needs to be set to the ARN of the alias."
- "In order to activate the configuration, run `direnv allow`."

### Parenthetical Clarifications

Use parentheses for brief inline clarifications or examples.

**Good:**

- "(due to caching it may only last for 45 minutes however)"
- "(for example, an ECS service)"
- "(see highlight below)"

## "As You Go" Collection Pattern

Multi-step guides that require collecting values (API keys, IDs, configuration parameters) across steps should use a collection convention:

1. **Introduce the convention early.** Add a short section near the top of the guide explaining that values will be marked for collection as the reader proceeds.
2. **Use a visual marker** at the point where each value is produced, so the reader knows to save it.
3. **Name markers after the configuration parameter** the value maps to, connecting the setup step directly to the deployment configuration.

**Example introduction:**

```markdown
## As you go

Values to save for required configuration are marked in the instructions below
like this: 📝 **`ENV_VAR_NAME`**.

Collect these values as you proceed so they can be provided for your
installation's configuration.
```

**Example usage in a step:**

```markdown
Create an API key with access to the REST API **only** with access to the
`read_pipelines` scope. Save as 📝 **`BUILDKITE_API_TOKEN`**.
```

Use the same marker, 📝 followed by the bold inline-code name, everywhere. It is plain text, so it renders on GitHub and is easy for an agent to search for.

This pattern keeps procedural guides self-contained: the reader finishes the guide with all the values they need, without backtracking.

## Formatting Conventions

### Headings

Reference headings are compact noun or rule phrases, one to four words. Existing pages use `## Purpose`, `## Characteristics`, `## Log format`, `## Caller-scoped repositories`, and `## Response format`.

A heading names what the section covers, or states the rule it enforces. It does not need a copula, and it does not carry rhetorical shape.

**Good:**

- `## Protocol and host required`
- `## GitHub repositories only`
- `## Git protocol support`

**Bad:**

- `## The request target is not a security boundary` — long; the claim belongs in the body
- `` ## `protocol` and `host` are required `` — the copula is dead weight
- `## Protocol integration, not authorization` — "X, not Y" is rhetorical shape
- `## Request target` — a bare category noun that does not describe the content

Keep the anchor usable, because other pages link to it. `## Only https://github.com supported` yields `#only-httpsgithubcom-supported`.

### Bold for Emphasis

Use bold to highlight:

- Critical warnings
- Specific values users need to collect or note
- Configuration keywords in prose

**Examples:**

- "Create an API key with access to the REST API **only** with access to the `read_pipelines` scope."
- "Set the environment variable to the ARN of the **alias** that has just been created."
- "It is **strongly** recommended that any production implementation uses this strategy."

### Inline Code

Use inline code for:

- Configuration parameter names: `SERVER_PORT`
- Environment variables: `GITHUB_APP_PRIVATE_KEY_ARN`
- Commands: `direnv allow`
- File paths: `.envrc`
- API endpoints: `/token`
- Values: `read_pipelines`

### Links

#### Internal Links

Use document-relative paths that include the `.md` extension. GitHub resolves these in the web view, and editors and agents can open them directly.

```markdown
[Adopting the release pipeline](../guides/adopting-the-release-pipeline.md)
[Reusable workflows](../reference/reusable-workflows.md)
```

For section anchors:

```markdown
[Homebrew cask](../reference/repository-configuration.md#homebrew-cask)
```

Link to a directory (no trailing file) when its `README.md` is the target, for example `[shed](../reference/shed/)`. Link to files outside `docs/`, such as workflows, with the same relative form.

Same-page anchors can omit the path, for example `[Response format](#response-format)`.

#### External Links

Use reference-style definitions at the document end:

```markdown
Authentication is handled via [GitHub App][github-app] with
[ephemeral tokens][github-app-tokens].

[github-app]: https://docs.github.com/en/apps
[github-app-tokens]: https://docs.github.com/en/apps/creating-github-apps/...
```

Write local development addresses as inline code, for example `http://localhost:5080`, so they are never rendered as clickable links.
