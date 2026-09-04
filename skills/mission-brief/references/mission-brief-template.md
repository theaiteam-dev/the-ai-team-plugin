# Mission Brief Template

Use this structure when an entry point (`/ai-team:review`,
`/ai-team:bug-fix`, `/ai-team:bug-stomp`) generates a mission brief and
writes it to `.mission-briefs/<slug>.md`. See `../SKILL.md` for the full
contract — the exact `## Executive Summary` and `## Definition of Done`
headings are mandatory and byte-for-byte, since `agents/frankie.md` parses
the latter literally.

---

```markdown
---
missionId: ~
entryPoint: review   # review | bug-fix | bug-stomp
---

# <Mission Title>

**Author:** <entry point name>  **Date:** <date>  **Status:** Generated

## Executive Summary

Two to four sentences: what evidence produced this mission, what it covers,
and why it matters. Written in the entry point's own voice — a review
summary reads differently from a bug-fix summary — but always a distilled
summary, not a raw dump of the evidence itself.

## Definition of Done

Observable, user- or codebase-visible outcomes derived from the evidence
below — never left blank. One checkbox per finding (`review`, `bug-stomp`)
or per reproduced symptom (`bug-fix`):

- [ ] <Finding or repro, phrased as an observable outcome — e.g. "the SQL
      injection in `search.ts` is parameterized" or "submitting the repro
      steps from issue #123 no longer 500s">
- [ ] <...>

## Scope

**Evidence source:** <what this brief was derived from — e.g. "code-review
skill run against `feat/checkout` vs. `main`", "GitHub issue #123", "bug-stomp
hunt over the uncommitted working tree", "bug-stomp hunt over
`git diff main...HEAD`">

**In scope:** <the findings/repro/hunt results this mission's work items
cover>

**Out of scope:** <anything the evidence surfaced but this mission
deliberately excludes, and why — e.g. Consider-severity findings from
`/ai-team:review`, reported only and not filed as work items>
```
