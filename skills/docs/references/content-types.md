# Content Types and File Organization

Detailed templates for each content type and file organization conventions. The high-level Diátaxis framework and mental model are in the parent SKILL.md; this reference provides the detailed structure for creating or restructuring pages.

## How-to Guides

How-to guides help users accomplish specific tasks. They assume the reader knows what they want to achieve.

**Structure:**

- Title format: Verb-first or "How to [achieve X]"
- Open with a brief statement of what the guide accomplishes
- Follow with prerequisites, decisions, and placeholders
- Use numbered lists for steps, grouped under `##` headings when the guide has phases
- End when the task is complete—no summary needed

**Include:**

- Prerequisites (as a brief list before steps)
- Concrete actions the user must take
- Complete code snippets, each preceded by the file path or the place to run it
- Expected outcomes after key steps, with the command that confirms them

**Exclude:**

- Extended explanations of why things work
- Alternative approaches (link to them if necessary)
- Reference-style exhaustive option lists (link to the reference page)

**Example opening:**

> "This guide connects a Go CLI repository to the shared release pipeline."

### Placeholders

Define placeholders once, near the top of the guide, in a table:

```markdown
| Placeholder | Meaning                         | Example    |
| ----------- | ------------------------------- | ---------- |
| `<OWNER>`   | GitHub organisation or user     | `chinmina` |
| `<REPO>`    | Repository name                 | `shed`     |
```

Use the same placeholder spelling in prose, commands, and file contents. A worked example in `docs/reference/` shows the same files with every placeholder substituted.

### Steps that agents can follow

Each step names one action. Put the command or file content directly under the step, indented so it belongs to the list item:

````markdown
1. Create the `release` environment.

   ```sh
   gh api --method PUT "repos/<OWNER>/<REPO>/environments/release"
   ```

2. Confirm the environment exists.

   ```sh
   gh api "repos/<OWNER>/<REPO>/environments" --jq '.environments[].name'
   ```

   The output includes `release`.
````

## Reference Documentation

Reference material provides facts for lookup during active work.

**Structure:**

- Organize by the structure of what's being described (workflows, inputs, config keys)
- Use consistent patterns (tables for inputs and options, H6 for single parameters)
- Be exhaustive—list every option

**Include:**

- Every parameter, option, or field
- Default values and types
- Brief usage examples

**Exclude:**

- Step-by-step procedures (link to guides)
- Extended conceptual explanation
- Opinions or recommendations (state facts)

**Example entry:**

> ###### `disable-nix`
>
> _(boolean, default: `false`)_
>
> Skips Nix publication. When `false`, the job installs Nix and mints a token for the `nixpkgs` repository.

### Worked examples

A worked example is reference material: a complete, concrete set of files for one fictional repository. It lives in its own directory under `docs/reference/`, mirrors the real file paths of the repository it describes, and has a `README.md` that states what the example is for and lists each file.

## Conceptual Explanation

Explanation content builds understanding. Use sparingly and place thoughtfully.

**When to include explanation:**

- Introduction to a complex topic before procedures
- Background that helps users make informed decisions
- Architecture or design rationale

**Where to place it:**

- Brief context: inline at the start of a guide section
- Extended explanation: in an overview guide
- System concepts: in the overview, with diagrams

**Structure:**

- Use paragraphs, not lists
- Connect to related concepts
- Admit alternatives and trade-offs

**Concept Introduction Pattern:**

When introducing a new concept, follow this structure:

1. **Definition**: What is it?
2. **Purpose**: Why does it exist?
3. **Mechanics**: How does it work?

**Example:**

> "Audit logs provide a level of non-repudiation for the system (Purpose). These logs are written to the container's stdout, and cannot be disabled (Mechanics)."

## File Organization

### File Naming

- Use lowercase with hyphens (kebab-case)
- Use `.md` for every page
- Name a directory's landing page `README.md` so GitHub renders it when the directory is opened

### Directory Structure

```text
README.md                        # High-level map of the repository
docs/
├── README.md                    # Index of guides and reference pages
├── guides/                      # How-to guides and overviews (action-oriented)
│   ├── <topic>-overview.md      # Explanation with diagrams
│   └── <verb>-<topic>.md        # How-to guide
└── reference/                   # Reference documentation (information-oriented)
    ├── <thing>.md               # Inputs, keys, schemas
    └── <example>/               # Worked example, mirroring real file paths
        └── README.md
```

Component-level documentation (for example, a composite action's `README.md`) stays next to the component and is linked from the reference section.
