# ADR 0004: Frankie runs before Stockwell in the mission tail

**Status:** Accepted
**Date:** 2026-08-12
**Deciders:** Face + Sosa, ratified by Josh (mission: PRD 010 — Execution Stage / Frankie)

## Context

PRD 010 §2 places Frankie's walk after "ALL items done" and before Tawnia's
final commit, but its timeline never mentions Stockwell's Final Mission
Review. That left the relative order of the two mission-tail gates
undetermined, and both orderings carry an invalidation risk:

- If Stockwell runs first, Frankie's evidence bundle and graduated FlowSpec
  files ship in the PR having never been reviewed, and any failure Frankie
  finds invalidates a final review that has already completed.
- If Frankie runs first, a Stockwell rejection that sends items back for
  rework leaves the committed evidence describing code that no longer
  exists.

## Decision

The mission tail runs: **all items done → Frankie → Stockwell's Final
Mission Review → post-checks → Tawnia's final commit.**

Additionally, **a Stockwell rejection restarts the tail at Frankie**, not at
post-checks. After any rework that returns items to `done`, Frankie re-walks
the **full** Definition of Done rather than only the previously-failing
statements.

## Alternatives Considered

- **Stockwell first.** Cheaper — no re-review of evidence, no restart loop —
  but Frankie's evidence and specs would ship unreviewed, and his failures
  would invalidate a completed final review.
- **Frankie first with no restart loop.** Fastest, and simplest to wire, but
  it accepts stale evidence in the PR whenever Stockwell rejects. Rejected:
  the entire point of the evidence bundle is that a reviewer can trust it
  without re-driving the feature.
- **Partial re-walk** (only previously-failing statements) on restart.
  Rejected: a fix that breaks a neighbouring statement is exactly the
  failure class Frankie exists to catch.

## Consequences

The ordering rule this establishes is general, and the next person adding a
mission-tail stage should apply it rather than re-deriving it: **anything
that can send items backward runs before the review that reads the final
diff.**

The restart loop means a Stockwell rejection costs a full Frankie re-walk.
That is a deliberate cost, paid to keep "the PR is born with evidence" true
rather than approximately true.

Because `done` is terminal (see ADR 0005), the "rework" that triggers a
restart is currently a manual operator action, not an automatic bounce.
