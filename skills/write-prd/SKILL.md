---
name: write-prd
description: Creates a new Product Requirements Document in prd/drafts/ by default. Runs a mini-discovery workshop to gather context, then produces a structured PRD scaled to the feature's complexity.
---

# Write PRD

Create a new Product Requirements Document in this project's PRD directory.

## PRD Folder Structure

This project uses a three-folder structure to track PRD lifecycle:

```
prd/drafts/     ← being written or refined, not yet ready to run
prd/ready/      ← queued and ready for /ai-team:plan and /ai-team:run
prd/completed/  ← mission shipped, archived
```

**All new PRDs go into `prd/drafts/` by default.**

Files use descriptive kebab-case slugs — no sequence numbers:
- `prd/drafts/user-onboarding.md`
- `prd/drafts/fix-social-sharing.md`
- `prd/ready/extract-plugin-api.md`

Moving a PRD from `drafts/` to `ready/` is a human decision. Hannibal moves it to `completed/` automatically when the mission finishes.

## Step 1: Find the PRD Directory

Confirm `prd/drafts/` exists in the project root. If not, create it. Do not ask the user — just create it.

## Step 2: Mini-Discovery Workshop

Before writing, run a structured discovery pass covering four areas:

1. **Problem & users** — Who struggles today, and what breaks for them?
2. **Business value** — What metric, revenue, or cost does this affect?
3. **Constraints** — Tech stack, platform, timeline, must-nots?
4. **Risks** — What's most likely to make this fail or get stuck?

### How to run:

1. **Review what the user already provided.** Read their input, any linked documents, and project context (CLAUDE.md, package.json, etc.).

2. **Identify gaps.** Skip any question whose answer is already clear:
   - Skip *Problem & users* if the user named a specific user/persona AND described a concrete pain point.
   - Skip *Business value* if the user connected the feature to a measurable business outcome.
   - Skip *Constraints* if the user stated constraints, OR this is a PRD for the current project (infer stack from CLAUDE.md/package.json).
   - Skip *Risks* if the user identified specific risks.

3. **Ask remaining gaps in ONE message.** Batch all unanswered questions into a single ask — do not ask them one at a time. If all four areas are covered: *"You've given me strong context. Let me draft the PRD."*

4. **Max one round of follow-up.** If answers are thin, fold those areas into "Open Questions" in the PRD rather than pressing further.

5. **Assess scale.** Based on the scope of the feature, determine which tier to use:

   | Tier | When | Required Sections |
   |------|------|-------------------|
   | **Quick** | Bug fix, small enhancement, 1-2 day effort | Problem Statement, Scope, Requirements |
   | **Standard** | Feature, multi-day effort | Sections 1-6 + 10 |
   | **Deep** | New product area, multi-week, cross-team | All 11 sections |

   Tell the user which tier you'll use: *"This looks like a Standard-tier PRD — I'll include sections 1 through 6 plus Risks & Open Questions. Let me know if you'd prefer a different depth."* The user can override.

## Step 3: Generate the Filename

Use 2-4 kebab-case keywords from the feature description. No numbers, no dates:

- `prd/drafts/fix-social-sharing.md`
- `prd/drafts/team-billing.md`
- `prd/drafts/migrate-auth-oauth2.md`

Confirm the filename with the user before writing.

## Step 4: Write the PRD

Use the template structure from `references/prd-template.md`. Include only the sections appropriate for the assessed tier. The PRD should be:

- **Problem-first** — Lead with why, not what
- **Measurable** — Every goal has a success metric
- **Scoped** — Explicit about what's in and what's out
- **User-centered** — Written from the user's perspective, not the developer's
- **Implementation-free** — Describe what, not how (no architecture, no code)
- **Strategy-level Solution Approach** — If included, keep Solution Approach at a level a product manager would understand. No code, no schemas, no class names.

The PRD header should use the feature name only — no PRD number. Include YAML frontmatter with `missionId` set to `~` (null) — Hannibal will populate it when the mission starts:

```markdown
---
missionId: ~
---

# Feature Name

**Author:** [name]  **Date:** [date]  **Status:** Draft
```

Consult `references/prd-best-practices.md` for good and bad examples.
Consult `references/prd-template.md` for the document structure.

## Step 5: Review and Refine

After writing the first draft, review it against this checklist:

- Does every requirement have a clear "why"?
- Are success metrics specific and measurable?
- Is scope clearly bounded (in/out)?
- Are edge cases and error states folded under Requirements?
- Are constraints and dependencies captured in Technical Considerations?
- Are risks and open questions called out?
- Does the Solution Approach (if present) stay at strategy level, free of implementation details?
- Is the tier appropriate — not over-templated (a bug fix with 11 sections) or under-specified (a new product area with 3)?

Present the draft to the user for feedback before finalizing.
