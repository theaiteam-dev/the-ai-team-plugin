---
missionId: ~
---

# Staged Stage — Closing the Rework Loop

**Author:** Josh / Claude  **Date:** 2026-08-15  **Status:** Draft

## Executive Summary

The mission tail (Frankie's DoD walk, Stockwell's Final Mission Review) can find problems, but the board offers no legal way to act on them: every item is already in terminal `done`, so ADR 0005 shipped Frankie without his promised bounce and left Stockwell's rework latently broken. This PRD adds one state — `staged`, between `probing` and `done` — so that per-item-complete work has a home the tail can send backward from, and `done` becomes a promise the board actually keeps: an item is `done` only after the mission's assembled Definition of Done has been verified. It closes ADR 0005's named follow-up ("Frankie's bounce and Stockwell's rework are the same defect; fix them together") and unlocks PRD 010's deferred DoD item 5 — an integration miss caught by Frankie and reworked in-mission, with no manual board surgery.

## Definition of Done

*(Left blank for the pipeline: Face rolls per-item acceptance criteria into this section during planning; the human blesses it at the refinement gate.)*

- [ ]
- [ ]
- [ ]

## 1. Context & Background

PRD 010 (Execution Stage) promised that when Frankie's walk fails, the offending item bounces back to B.A. **in-mission**, while B.A. still holds context. Planning verification found this impossible: all four API routes out of `done` are closed (`agentStart` stage rules, `agentStop`'s claim requirement, `TRANSITION_MATRIX`'s `done: []`, `board-claim`'s claimable-stages list). ADR 0005 shipped Frankie bounce-less — failures are reported with repro, and reopening a done item is a manual operator action. The same verification exposed that Stockwell's documented rework path was *always* broken the same way: by final-review time every item is `done`, so his "rework to either stage" claim was unreachable code in prose form.

Since then, the enforcement layer has tightened around this gap without removing it: the Stop-hook gates now parse Stockwell's `FINAL REJECTED` verdict and block with restart-at-Frankie instructions, and stale or failed evidence re-arms the Frankie gate (ADR 0004's full re-walk rule). The *loop* is enforced; the *reopen inside it* still takes a human editing the board by hand. Every mission that hits a tail failure pays that manual toll, and the first pilot mission on joshowens.dev is expected to hit it (PRD 010 §3, scope ruling).

There is also a truth problem: today the kanban board marks items `done` that the mission tail can still invalidate. "Done" currently means "Amy finished probing," not "the promise was verified."

## 2. Problem Statement

The pipeline's state machine has no state between "this item passed its per-item pipeline" and "this item is irrevocably complete," so the mission tail — which exists to invalidate items — has nothing legal to invalidate. Frankie and Stockwell can only report; a human must perform board surgery to act on their findings, defeating the in-mission-rework benefit (fresh agent context, no stale fix branches) that motivated the execution stage in the first place.

## 3. Target Users & Use Cases

**Primary users:**
- **The operator (Josh)** — runs missions, currently the only entity who can reopen a done item; wants tail failures handled by the pipeline, and wants the board's `done` column to mean what it says.
- **Hannibal (orchestrator)** — needs a legal transition to execute when the tail names failing items, without violating agent boundaries.
- **Frankie / Stockwell (mission tail)** — need their failure reports to be actionable in-mission while remaining report-only agents (they never mutate the board).
- **Downstream work items** — dependency waves need to consume upstream items the moment those items are individually complete, not at mission end.

**Key use cases:**
- Frankie's walk fails a DoD statement; the named item returns to B.A. (or Murdock) in-mission, is reworked, and Frankie re-walks the full DoD — no human board edits.
- Stockwell rejects the final review; the named items are reworked and the tail restarts at Frankie, per ADR 0004, through pipeline mechanics alone.
- A wave-2 item depends on a wave-1 item; the wave-1 item reaching `staged` unblocks it, exactly as reaching `done` does today.
- Josh glances at the board mid-tail and can distinguish "individually complete, awaiting mission verification" (`staged`) from "verified and sealed" (`done`).

## 4. Goals & Success Metrics

| Goal | Metric | Target |
|------|--------|--------|
| Tail failures are actionable in-mission | Manual board-surgery actions needed to act on a Frankie/Stockwell failure | ≥1 today → 0 |
| PRD 010 DoD item 5 becomes achievable | Planted integration miss on a pilot mission is caught by Frankie **and bounced through the pipeline** | Demonstrated once on a pilot mission |
| `done` is truthful | Items that reach `done` and are later invalidated by the same mission's tail | 0 by construction |
| No dependency regressions | Wave scheduling behavior (items unblocked when deps individually complete) | Unchanged vs. today |
| ADR 0005 invariant preserved | Legal routes out of `done` in `TRANSITION_MATRIX` | 0, unchanged |

## 5. Scope

### In Scope
- The `staged` stage: `probing → staged` replaces `probing → done` as the per-item pipeline's terminal transition; `staged → done` (forward, promotion) and `staged → testing | implementing` (backward, rework) become legal.
- Re-keying every "all items done" trigger to "all items staged": Frankie's dispatch condition, the Stop-hook completion/evidence gates (including evidence-freshness timestamps), and mission-tail orchestration in both playbooks.
- Re-keying dependency-wave satisfaction to "dep has reached `staged` or later."
- Promotion mechanics: Stockwell's `FINAL APPROVED` verdict is the trigger; the **API** executes the batch promotion `staged → done` when the approved final review is written (Hannibal batch `board-move` is the fallback path). Reviewers never move items.
- Rework mechanics: Frankie/Stockwell remain report-only; Hannibal (or the operator) executes `staged → testing | implementing` using the earliest-flagged-stage rule that already governs Lynch and Amy. Tail-triggered rework increments `rejection_count` under the existing cap.
- Board/UI: the `staged` column in the kanban viewer; stage enums across shared, API validation, and the Go CLI; WIP semantics for the new column.
- Documentation and recovery: playbooks, CLAUDE.md, agent cards, `commands/resume.md` recovery flows and their test suite.
- Superseding-amendment notes on ADR 0005 (and the corresponding caveats in PRD 010) pointing to this design.

### Out of Scope
- Any route out of `done` — `done: []` is untouched; the ADR 0005 invariant survives verbatim.
- Frankie or Stockwell claiming, moving, or rejecting board items directly (their report-only boundary, and the board-guard hooks enforcing it, are unchanged).
- A Murdock review slot in the mission tail for graduated specs (PRD 010 §2.5 deferral — separate follow-up).
- The Tawnia-commit stop-gate (issue #57) and the viewer's Sosa type gap (issue #56) — adjacent, tracked separately.
- The whole-config schema (ADR 0006 — its tripwire test stands guard).
- Changes to the per-item pipeline stages (`briefings → ready → testing → implementing → review → probing`) or to Lynch/Amy rejection routing.

## 6. Requirements

### Functional Requirements

1. The transition matrix shall define `probing → staged` as the per-item pipeline's completion transition; `probing → done` shall no longer be legal.
2. The matrix shall define `staged → done` (promotion) and `staged → testing` / `staged → implementing` (rework) as the only routes out of `staged`; `done` shall remain terminal with no outbound transitions.
3. Amy's `agentStop --advance` from `probing` shall land the item in `staged` with no change to her workflow or messaging.
4. A dependency shall count as satisfied when the depended-on item is in `staged` or `done`, so wave scheduling is unchanged relative to today's behavior.
5. Frankie's mission-tail walk shall trigger when all items have reached `staged` (today: `done`), including the NO_TEST_NEEDED task path, which is unchanged upstream.
6. On an approved final review (`VERDICT: FINAL APPROVED`), the API shall atomically promote all `staged` items to `done` as part of persisting the review; if API-side promotion is unavailable, Hannibal shall perform the batch move before post-checks. Reviewers shall never execute the promotion themselves. Post-check outcomes shall not affect item stages (see Edge Cases).
7. On a Frankie failure or Stockwell rejection, the tail agent shall name the failing items in its report (existing behavior); Hannibal shall move each named item `staged → testing` or `staged → implementing` per the earliest-flagged-stage rule. The tail shall restart at Frankie (full DoD re-walk) once the named items return to `staged`, per ADR 0004.
8. Each tail-triggered rework move shall increment the item's `rejection_count`; items at the rejection cap shall transition to `blocked` instead, exactly as with Lynch/Amy rejections.
9. The `staged` column shall be exempt from WIP limits (it is the mission's holding pen; capping it would deadlock the final items in `probing`).
10. The Stop-hook gates shall re-key to the new semantics: the Frankie-evidence gate triggers on all-staged, evidence freshness compares against the most recent `staged`-entry timestamp, and mission completion requires all items `done` (i.e., promotion has run).
11. The kanban viewer shall render the `staged` column between `probing` and `done`, with the existing card, filter, and activity behavior.
12. `commands/resume.md` recovery flows shall account for interrupted missions with items in `staged` (including a crash between approval and promotion), and the resume-recovery test suite shall be updated to the new matrix.

### Non-Functional Requirements

1. Existing missions/databases with items already in `done` shall remain valid; the change shall not require rewriting historical board state.
2. The promotion in requirement 6 shall be atomic with persisting the approved review — a crash shall never leave a mission half-promoted with an approved verdict recorded (or shall be safely resumable per requirement 12).
3. All stage-enum surfaces (shared package, API validation, Go CLI, viewer types) shall be updated in the same change; no surface may ship recognizing a different stage set than the others.

### Edge Cases & Error States

- **Crash between FINAL APPROVED and promotion:** resume must detect the approved review with items still in `staged` and complete the promotion, not re-run the tail.
- **Post-checks fail after promotion:** items are already `done` when lint/unit/e2e run. **Decided (Josh, 2026-08-15): post-check failures are mission-level, not item-level.** Hannibal calls them out and handles them (targeted fixes, or surfacing to the operator) — they never demote items, restart the tail, or fail the mission. Verified work is not tossed over a bad typecheck or a failing test or two.
- **Tail failure names an item at the rejection cap:** the item goes to `blocked`, the mission tail halts, and the operator decides — matching today's cap behavior.
- **Operator recovery:** the existing manual `probing → ready` escape hatch remains; whether `staged → ready` is also needed is an open question.
- **Mixed-wave timing:** a wave-2 item mid-pipeline while a wave-1 item is bounced out of `staged` — dependencies were satisfied at claim time and are not re-litigated; the tail's full re-walk (ADR 0004) is the net that catches any resulting inconsistency.
- **A mission with zero drivable surfaces:** the Frankie skip (qa-contract drivability) applies at the all-staged trigger exactly as it applies at all-done today; promotion then keys on Stockwell's verdict alone.

## 8. Solution Approach

One new column, three ideas:

- **`staged` = individually complete, collectively unverified.** The per-item pipeline (Murdock → B.A. → Lynch → Amy) ends at `staged`. Dependents may build on staged items immediately — individual completeness is what a dependency consumes. The mission tail is the only path from `staged` to anywhere.
- **Verdicts trigger; systems move.** Frankie and Stockwell keep their report-only boundary. Backward moves are executed by Hannibal from the tail agents' named-item reports; the forward promotion to `done` is executed by the API when the approved final review is written. No reviewer ever holds the pen, so the board-guard hooks stay exactly as strict as they are.
- **`done` becomes the seal.** Nothing leaves `done` because nothing needs to: every reason an item could regress is exhausted before promotion. ADR 0004's ordering rule ("anything that can send items backward runs before the review that reads the final diff") and ADR 0005's invariant ("no route out of done") both survive — this design is what makes them compatible with an actual rework loop.

## 9. Technical Considerations

**The known cascade** (paying deliberately what ADR 0005 declined to pay incidentally):

- `TRANSITION_MATRIX` and stage constants in `packages/shared/src/stages.ts` (+ rebuilt `dist/`), API stage validation, Go CLI stage flags/help, viewer stage types and column config.
- `commands/resume.md` is asserted against the matrix across three sections by `commands/__tests__/resume-recovery.test.js` — the exact cascade that made ADR 0005 punt; it is in-scope here by design.
- Stop-hook gates (`scripts/hooks/lib/stop-gates.js` and both consumers) re-keyed per requirement 10; their test suites (stop-gates, stop-guards, API-integration) updated to the new board shapes.
- `ateam deps-check checkDeps` wave logic re-keyed per requirement 4 — **the deepest semantic change in the design; treat it as the first item to test.**
- WIP-limit configuration and enforcement must exempt `staged` (requirement 9).
- Playbooks (both modes), CLAUDE.md pipeline/tail sections, agent cards (Hannibal's tail choreography, Amy's advance target), `skills/tdd-workflow`, `skills/teams-messaging` — the mission-tail doc test suite (`playbooks/__tests__/mission-tail-order.test.js`) already pins ordering language and will need its board-stage assertions extended rather than weakened.
- ADR hygiene: a superseding note on ADR 0005 (invariant intact, bounce now legal via `staged`) and a caveat update where PRD 010 §2.4's deferral note points at this PRD.

**Dependencies:** none external. Internal: the Frankie-branch stop-gate work (verdict parsing, evidence freshness) is the substrate being re-keyed and should merge first.

## 10. Risks & Open Questions

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Wave re-keying misses a `done`-check and deadlocks a multi-wave mission | Medium | Mission stalls mid-flight | Grep-driven inventory of every `done` comparison; a multi-wave mission fixture test on `checkDeps`; the deadlock-prone path tested first |
| Resume-recovery cascade larger than inventoried | Medium | Slow mission, churned tests | The cascade is enumerated up front (§9); Face should decompose the matrix + resume changes as one item so the test suite moves once |
| Crash window between approval and promotion leaves an ambiguous board | Low | Operator confusion, stuck mission | Atomic API-side promotion (req 6/NFR 2) plus an explicit resume flow (req 12) |
| Tail rework loops (fail → rework → fail) burn the mission | Low | Long tails | Existing rejection cap applies to tail bounces (req 8); cap sends items to `blocked` and surfaces the operator |
| Stage rename ripples into observability (hook events, token usage grouping) | Low | Mislabeled telemetry | `staged` is additive — no existing stage renamed; verify event payloads carry it through |

### Open Questions
- [x] ~~Post-check failures after promotion~~ — **resolved (Josh, 2026-08-15):** mission-level, Hannibal's work to call out and handle; promotion timing stays on `FINAL APPROVED`; items are never demoted for post-check failures. Recorded under Edge Cases.
- [ ] Does the operator need a manual `staged → ready` escape hatch (re-decompose an item the tail proved misconceived), mirroring `probing → ready`?
- [ ] Should the kanban UI visually pair `staged` and `done` (e.g., a "verification" column group) so the board reads as pipeline → tail → sealed?
- [ ] Should tail-triggered rework use a distinct work-log marker (vs. Lynch/Amy rejections) so retros can measure "found by the tail" separately from "found in per-item review"?
