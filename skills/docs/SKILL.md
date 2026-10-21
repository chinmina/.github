---
name: docs
description: Writing guide for Markdown documentation in chinmina repositories that is rendered by GitHub. Covers voice, structure, content types, GitHub Flavored Markdown conventions, and Mermaid diagrams. Use when writing or editing a README, a guide, or a reference page under docs/.
---

# Documentation Writing Guide

Documentation in this repository is plain GitHub Flavored Markdown (GFM), read on github.com and in editors. It targets DevOps and platform engineers who are knowledgeable but unfamiliar with this specific system. Coding agents read the same pages and follow them step by step, so every guide must be executable without guessing.

There is no site generator. MDX, JSX components, frontmatter, and directive syntax (`:::note`) do not render and must not be used.

## Content Architecture: Diátaxis Framework

Documentation uses a simplified two-section structure based on the Diátaxis framework:

| Section       | Location          | Contains                                   | User Need                      |
| ------------- | ----------------- | ------------------------------------------ | ------------------------------ |
| **Guides**    | `docs/guides/`    | How-to guides, tutorials, setup procedures | "Help me do X" or "Teach me Y" |
| **Reference** | `docs/reference/` | Configuration, inputs, schemas, examples   | "Tell me the facts about X"    |

Explanation (conceptual/background content) is woven into guides where necessary, or placed in an overview guide for system-level concepts. The repository root `README.md` is a high-level map of what the repository holds, linking into both sections.

### User Mental State

The content type determines voice, structure, and level of detail. When classifying content, consider what the user is thinking:

| Section       | User is thinking...                          |
| ------------- | -------------------------------------------- |
| **Guides**    | "I need to do X" / "How do I...?"            |
| **Reference** | "What is X?" / "What are the options for Y?" |

### Quick Decision

- Does the content teach a **process**? → **Guide**
- Does the content describe a **thing** (config, input, schema, worked example)? → **Reference**

## Voice Rules

- **Register:** Technical-professional. Use terms directly without over-explanation.
- **Perspective in Guides:** Second person ("you") and imperative mood. Start instructions with the action verb.
- **Perspective in Reference:** Third person and declarative mood. Describe what things are and do.
- **No first person:** Never use "I" or "we" in any content type.
- **Directness:** State facts plainly. Make confident recommendations. State limitations without apologising.
- **No filler:** Never use "Let's dive in", "It's important to note", "As mentioned earlier", or similar padding.
- **No hedging:** Never use "You might want to consider", "It's generally a good idea", or similar softening.
- **No rhetorical questions:** State information directly instead of asking "But what does this mean?"
- **No apologetic language:** Never use "This might seem complicated, but..." or "Don't worry..."
- **Sentences:** Aim for under 20 words. Keep paragraphs to 1-3 sentences: a single-sentence paragraph is fine on its own, but a run of them is not.
- **Spelling:** Use British/Australian English spellings (e.g., "favour", "organise", "colour", "licence" as noun). Keep the spelling of identifiers, keys, and quoted UI text as they are.
- **Punctuation:** Use the Oxford comma in serial lists of three or more items.
- **No staged facts:** State a fact directly. Never introduce it with a count and a negative reveal, an "X, not Y" interpolation, or an inverted contrast.

## Guides Are Executable

Agents and humans follow guides literally. Write each guide so it can be run top to bottom:

- **State the starting point.** List prerequisites and the decisions the reader must make before step 1.
- **One action per step.** Each numbered step does one thing: run a command, create a file, or change a setting.
- **Complete snippets.** Give whole files or clearly bounded fragments, with the target path stated before the block. Never write "add the usual keys".
- **Explicit placeholders.** Mark every value to substitute as `<UPPER_SNAKE>` and define each placeholder once, near the top.
- **Checkable outcomes.** Follow a step that changes remote state with a command that confirms the result, and state the expected output.
- **Conditional steps are labelled.** Start a conditional step with its condition in bold, for example "**Homebrew only.**"

## Summary Checklist

Before finalising content, verify:

1. **Mode**: Am I writing a Guide (action) or Reference (facts)?
2. **Perspective**: Guides use "you" + imperative; Reference uses third person + declarative
3. **Structure**: Concepts follow Definition → Purpose → Mechanics
4. **Format**: Titles in sentence case and one to four words (numbered guide step headings excepted); GFM only, no MDX or directives
5. **Executable**: Every guide step has one action, a complete snippet, and a way to check it
6. **Tone**: Guides "coach"; Reference "defines"
7. **Style**: Direct, concise, honest—no filler, hedging, or rhetorical questions

When in doubt, review existing documentation in this repository and match its patterns rather than defaulting to typical AI-generated prose.

## References

Consult these for detailed guidance beyond the essentials above:

| Reference | When to consult |
| --------- | --------------- |
| `references/voice-and-anti-patterns.md` | Writing new content or substantial rewrites. Full good/bad example pairs for tone, perspective, and anti-patterns. |
| `references/content-types.md` | Creating new pages or restructuring content. Detailed templates for guides, reference docs, and conceptual explanation, plus file organisation conventions. |
| `references/formatting-and-structure.md` | Choosing between prose and lists, formatting inline elements, structuring sentences. Covers paragraph length, bold/code/link conventions. |
| `references/github-markdown.md` | Using GFM features: alerts, code blocks, collapsible sections, tables, and styled Mermaid diagrams. |
