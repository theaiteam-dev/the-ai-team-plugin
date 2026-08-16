# ADR 0005: `done` is terminal — no in-mission rework after all items complete

**Status:** Accepted
**Date:** 2026-08-12
**Deciders:** Face + Sosa, ratified by Josh (mission: PRD 010 — Execution Stage / Frankie)

## Context

PRD 010 §2.4 specifies that when Frankie's walk fails, he "bounce[s] the
offending item back to B.A. **in-mission**, with the repro" — the stated
benefit being that B.A. still holds full context, so there is no post-merge
rework and no stale fix branches.

Verification during planning found that **no API path exists to do this.**
All four routes out of `done` are closed:

1. **`agentStart`** → `INVALID_STAGE` 400. `api/agents/start/route.ts:133`
   requires `currentStage === 'ready'` or `currentStage === targetStage`,
   and `targetStage` can only ever be a `PIPELINE_STAGES` key
   (testing/implementing/review/probing) or the `'testing'` fallback —
   never `done`. Frankie is not a pipeline agent, so he gets the fallback
   and fails both branches.
2. **`agentStop --outcome rejected`** → requires a live claim, and
   `agentStop` deletes the claim when it moves an item to `done`, so done
   items have none → `NOT_CLAIMED` (`stop/route.ts:143-153`).
3. **`board-move`** → `isValidTransition(from, to)` at `move/route.ts:120`,
   and `TRANSITION_MATRIX` has `done: []` (`packages/shared/src/stages.ts:21`).
   `--force` skips only the WIP check (`move/route.ts:143-149`), not the
   matrix.
4. **`board-claim`** → `CLAIMABLE_STAGES` excludes `done`
   (`claim/route.ts:30`).

The stop route's `returnTo` allowlist check (`stop/route.ts:123`) does not
call `isValidTransition`, which initially read as an opening — but it is
unreachable, because a claim can never be held on a done item to invoke it.

This is not a defect introduced by this mission. CLAUDE.md documents that
"Stockwell (final review) may rework to either stage," yet at final-review
time every item is in `done`, so Stockwell hits the identical wall. The
break is pre-existing and latent.

## Decision

**Ship Frankie without a bounce.** He walks the DoD, marks each statement
pass/fail with evidence, records exact repro steps for failures in
`report.md`, and names the failing work items in his terminal message to
Hannibal. He never attempts to move, claim, or reject a board item.

Reopening a completed item is a **manual operator action outside the
pipeline**. `TRANSITION_MATRIX` is not modified by this mission.

## Alternatives Considered

- **Add `done: ['implementing', 'testing']` to `TRANSITION_MATRIX`.** The
  smallest technically correct fix, but it cascades: `commands/resume.md`
  is asserted against the matrix across three sections by
  `commands/__tests__/resume-recovery.test.js`, and the change would also
  silently grant every agent a path out of `done`.
- **Widen `agentStart` so non-pipeline agents can claim done items.** Wider
  blast radius on a check that guards claim integrity, for the benefit of
  exactly one caller.
- **Have Hannibal perform the move on Frankie's behalf.** Same matrix
  problem, and it puts a board mutation in the orchestrator on behalf of an
  agent that is explicitly forbidden from mutating the board.

## Consequences

This is a **known-incomplete implementation of PRD §2.4 and PRD DoD item
5**, shipped deliberately. The pilot mission on joshowens.dev will hit it
the first time Frankie finds a real integration miss: the miss is caught and
evidenced in-mission (which is the main prize), but closing the loop takes a
human.

The follow-up PRD should cover **Frankie's bounce and Stockwell's latent
rework break together** — they are the same defect, and fixing one without
the other leaves the matrix half-right.

Two secondary API gaps were found while verifying this and are worth issues,
though both are out of scope here:

- `agentStart` never reads `assignedAgent` and never checks for an existing
  claim; it overwrites unconditionally (`start/route.ts:213`), so a
  double-claim surfaces as a generic 500 `DATABASE_ERROR` rather than a
  clean `CLAIM_CONFLICT`.
- The rejection branch of `agentStop` performs **no WIP check** (contrast
  `stop/route.ts:211-242` with `254-268`), so any rejection bounce from any
  stage bypasses WIP limits.

## Amendment (2026-08-16)

**The `done: []` invariant in `TRANSITION_MATRIX` is unchanged — this ADR's
Decision stands as written.** What changed is upstream of it. WI-786/787
introduced a new `staged` stage as the per-item pipeline's real terminal
stage, sitting between `probing` and `done`. An item no longer lands in
`done` when its per-item pipeline finishes — it reaches `staged` instead,
and `done` is reached only later, via the mission tail's atomic promotion
(`staged` → `done`) once Stockwell's Final Mission Review is APPROVED
(WI-790).

Because Frankie and Stockwell now run against items sitting in `staged`,
not `done`, `TRANSITION_MATRIX` already permits real routes out of `staged`
— including back to `testing` or `implementing` — which WI-794 made a
first-class, rejection-cap-counted move. The in-mission bounce this ADR
shipped without is therefore now legal and automated, not a manual
operator action: Hannibal executes it via `ateam board-move moveItem`,
using the earliest-flagged-stage rule, once Frankie or Stockwell names the
failing item(s).

This does not reopen the specific gap this ADR closed: no route out of
`done` itself exists, and none is needed, since the mission tail's
decision points (Frankie's walk, Stockwell's review, any resulting rework)
all operate on `staged`, before promotion. See `prd/ready/staged-stage.md`
for the full design.
