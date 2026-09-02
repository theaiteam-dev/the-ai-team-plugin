---
name: prd-reading
description: Complete-coverage reading protocol and structural map for mission PRD files. Consult this skill before reading a mission PRD — a single Read silently truncates near ~25k tokens, and analyzing a partially-read PRD produces confidently wrong conclusions.
---

# PRD Reading & Parsing

## Why this skill exists

The Read tool truncates a single call near **~25k tokens** — roughly 40–50KB of markdown depending on density — and the truncation is easy to miss: you get a clean-looking document that simply stops, with the tail silently gone. A truncated PRD read loses exactly the sections that live at the end (edge cases, non-goals, risks, open questions, launch plan) — the sections where critique and review find their issues. Analysis built on a partial read isn't just incomplete; it is confidently wrong, because nothing signals what's missing.

## Complete-Coverage Protocol (MANDATORY)

Never analyze a PRD you haven't read to its last line. Before reading:

1. **Measure first.** Get the ground-truth line count:
   ```bash
   wc -l <prdPath>
   ```
2. **Read, then verify.** Read the file. The result is line-numbered — compare the **last line number returned** against the `wc -l` count. If they match, you have the whole document.
3. **Paginate if short.** If the Read stopped early, continue with offset/limit slices until you reach the final line:
   ```
   Read(prdPath, offset=<last line returned + 1>, limit=1000)
   ```
   Repeat until the last line number returned equals the `wc -l` count.
4. **Only then analyze.** If you report on a PRD, your coverage claim is implicit — a section-by-section review, a DoD walk, or a requirements cross-reference performed on a partial read is a silent false negative for everything in the unread tail.

This protocol is self-contained: it needs no size stamp from the dispatcher. The `wc -l` count is your ground truth even when the spawn prompt says nothing about the PRD's size.

## PRD Anatomy — the reader's map

The canonical structure is authored by the `write-prd` skill; its template at `skills/write-prd/references/prd-template.md` is the authority. This section is a consumer's map, not a substitute — when they disagree, the template wins.

What to expect, in order:

- **Frontmatter** — `missionId: ~` on a fresh PRD; Hannibal stamps the real mission ID at mission start.
- **Title + byline** — `# Feature Name`, then author/date/status.
- **`## Executive Summary`** — top-matter, 2–4 sentences. Present in every tier.
- **`## Definition of Done`** — directly beneath the executive summary, before any numbered section. Observable user-visible statements as `- [ ]` checkboxes. On a freshly scaffolded PRD this section is **blank** — Face fills it during planning (first pass), and the human blesses it at the Sosa gate. Present in every tier.
- **Numbered sections 1–11** — tiered: a Quick PRD legitimately has only Problem Statement, Scope, and Requirements; only Deep PRDs carry all eleven. Missing higher-numbered sections on a small PRD is normal, not an omission to flag.

## Where each role looks

| Agent | Primary sections | Failure mode if the read truncated |
|-------|-----------------|-------------------------------------|
| Face | Whole document → work items; writes the DoD rollup under the exec summary | Items never created for tail-section requirements |
| Sosa | Section-by-section cross-reference against work items | "Nothing was dropped" verdict that never saw the dropped sections |
| Frankie | `## Definition of Done` checklist (plus context for flows) | Walks a DoD missing its later statements |
| Stockwell | Requirements vs. delivered diff, holistic | FINAL APPROVED against a fraction of the contract |
