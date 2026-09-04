---
name: mission-brief
description: Defines the one canonical mission-brief document every planning entry point (plan, review, bug-fix, bug-stomp) emits and sets as the mission's prdPath, so Frankie's DoD walk and Stockwell's PRD+diff review work unmodified regardless of which entry point started the mission.
---

# Mission Brief

`/ai-team:plan` has always had a human-authored PRD to point the mission's
`prdPath` at. The evidence-derived entry points — `/ai-team:review`,
`/ai-team:bug-fix`, `/ai-team:bug-stomp` — have no PRD; each must synthesize
an equivalent document from whatever evidence it gathered (a code review
report, a reported repro, a bug hunt) and set *that* as `prdPath`.

This skill is the single, shared definition of that document — the
**mission brief**. Every entry point that isn't `/ai-team:plan` follows it
instead of inventing its own brief format, the same single-definition
discipline `adr/0006-ateam-config-schema-deferred.md` already enforces for
`ateam.config.json`. `/ai-team:plan`'s PRD (see the `write-prd` skill)
already satisfies this contract — a PRD is a mission brief with a human
author instead of an entry point synthesizing it from evidence.

## Why This Exists

The mission tail — Frankie's Definition-of-Done walk and Stockwell's
PRD-and-diff Final Mission Review — reads whatever file `prdPath` points
at, unconditionally, no matter which entry point created the mission.
Frankie parses the mission PRD by literally searching for a
`## Definition of Done` heading (see `agents/frankie.md`) and treats a
missing or empty one as a **BLOCKED walk** — never a "draft your own"
fallback. If an evidence-derived entry point emitted a thinner document
that skipped or emptied that section, the tail breaks for every mission
that didn't start with `/ai-team:plan`. Mandating the sections below, and
mandating that the Definition of Done is never left empty, is how this
skill prevents that.

## Mandatory Sections

Every mission brief — regardless of which entry point authored it — MUST
contain these sections. They are not optional scaffolding; each one is
depended on by a specific downstream tail agent:

1. **Title** — an H1 heading naming the mission.
2. **Executive Summary** (`## Executive Summary`, that exact heading) — a
   few sentences a human skimming the kanban board can use to understand
   what the mission is about and why it exists, in the entry point's own
   words (a review's summary reads differently from a bug-fix's, but both
   must be a summary, not a raw evidence dump).
3. **Definition of Done** (`## Definition of Done`, that exact heading) —
   written as observable checkbox statements (`- [ ] ...`), never empty.
   Use this *exact* heading string, byte-for-byte, not a paraphrase like
   "Done Criteria" or "Success Criteria" — `agents/frankie.md` parses for
   this literal string and a differently-named heading is invisible to it.
4. **Scope** (`## Scope`, or a heading naming "Scope") — states what
   evidence the brief was derived from: the code-review report, the issue
   number or free-text description, the bug-hunt's diff range. This is
   what lets a human (or Stockwell) trace a DoD item back to the evidence
   that produced it.

See `references/mission-brief-template.md` for the fenced skeleton every
entry point fills in.

## Populating the Definition of Done Per Entry Point

Unlike `/ai-team:plan`, where Face rolls per-item acceptance criteria up
into a DoD that a human blesses at the refinement gate, the evidence-derived
entry points have no human refinement pass before the mission starts —
so **each entry point is responsible for deriving DoD statements from its
own evidence at brief-generation time**, not leaving the section blank for
someone else to fill in later:

- **`/ai-team:review`** derives Definition of Done statements from the
  Must Fix / Should Fix **finding descriptions** the `code-review` skill
  reported — each finding becomes one observable "fixed" statement (e.g.
  "the SQL injection in `search.ts` is parameterized").
- **`/ai-team:bug-stomp`** derives Definition of Done statements from the
  **finding descriptions** of each confirmed defect the hunt filed — the
  same finding-to-checkbox mapping `/ai-team:review` uses, since both
  entry points work from a list of discovered issues.
- **`/ai-team:bug-fix`** derives Definition of Done statements from the
  **reported repro** — the issue body or the free-text description that
  triggered the fix — turned into an observable "no longer reproduces"
  statement.

**The Definition of Done is never emitted empty for these entry points.**
An evidence-derived entry point with zero findings or an unreproducible
report does not create a mission with a blank DoD — see each entry point's
own FR-6 "clean outcome" handling (a clean hunt, an unreproducible bug) for
what happens instead. A brief only reaches the mission-creation step once
it has at least one DoD statement to give the tail agents something to
verify against.

## Where the Brief Is Written and How It Becomes `prdPath`

Each entry point writes its generated mission brief to
`.mission-briefs/<slug>.md` at the repo root (the dotfile convention
mirrors `.qa-evidence/` — generated tail-agent artifacts, not
human-authored content that belongs under `prd/`). `<slug>` is a short
kebab-case identifier for the mission (derived from the review's branch
name, the bug's issue number or description, or the bug-stomp's date and
scope).

The entry point then passes that file's path as `prdPath` when it calls
`ateam missions createMission`. From that point on, the mission behaves
exactly like a `/ai-team:plan` mission: **Frankie's DoD walk and
Stockwell's PRD-and-diff Final Mission Review consume `prdPath` unchanged**
— neither agent needs to know or care which entry point produced the file
at the other end of that path, because every mission brief satisfies the
same contract this skill defines.

## Adapting the `write-prd` Precedent

This skill deliberately mirrors `skills/write-prd/`'s two-file shape
(guidance in `SKILL.md`, a fenced template in `references/`) and its exact
`## Executive Summary` / `## Definition of Done` heading convention — do
not reinvent either. The difference: a PRD's Definition of Done is
scaffolded **blank** for Face to fill in during planning; a mission
brief's Definition of Done is filled in by the entry point itself, before
the mission is ever created, because there is no Face/Sosa refinement pass
for evidence-derived entry points.
