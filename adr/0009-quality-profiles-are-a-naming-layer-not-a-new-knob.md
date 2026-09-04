# ADR 0009: Quality profiles are a naming layer over existing enums, never a new scrutiny dimension

**Status:** Accepted
**Date:** 2026-09-03
**Deciders:** Face + Sosa (mission: M-20260903-002, Mission Entry Points & Quality Profiles)

## Context

The PRD introduces three named quality profiles — `quick`, `normal`, `deep` — bundled over the
execution contract's existing enums (`testing_level` × `review_tier`, per PRD 010). It also puts
"new quality knobs" explicitly out of scope: profiles bundle the *existing* enums and invent no
new scrutiny dimensions.

FR-8 then carves out one exception that muddies the line: `deep` additionally carries deepened
probing *guidance* for Amy, defined as part of the bundle — prompt-level text, not a new config
enum. Meanwhile probing *depth* is deliberately held constant across every profile: a cheaper
mission is a less-tested, lighter-reviewed mission, never a less-probed one (PRD Open Question 3,
decided 2026-09-02).

That is a subtle boundary and an easily-eroded one. "Deep carries extra probing guidance" reads,
at a glance, like probing is a profile dimension. It is not. Three separate work items in this
mission spend acceptance criteria defending the distinction, which is the signal that it deserves
a recorded decision rather than scattered prose.

## Decision

Quality profiles resolve only to values that already exist in the execution contract's enums,
plus optional prompt-level guidance text. Probing depth is never a profile dimension — Amy's
standard probing pass runs unchanged at every profile. The bundle definitions, both the enum
mappings and `deep`'s probing-guidance text, live solely in `scripts/hooks/lib/qa-contract.js`
and are never restated by a consumer.

## Alternatives Considered

- **Let `quick` shrink Amy's probing to a smoke pass.** Rejected explicitly in the PRD's Open
  Question 3: the cost saving is real but it trades away the one check that catches what tests
  and review both missed.
- **Add a `probing_level` enum alongside `testing_level` and `review_tier`.** Rejected as
  precisely the new knob the PRD puts out of scope.
- **Let each agent interpret its profile name in its own prompt.** Rejected: this is the
  "profile definitions drift across consumers" risk the PRD's own risk table names, with a
  single-definition source as its stated mitigation.

## Consequences

A future mission that wants a probing dial must argue against a recorded decision rather than
against scattered prose — and must reckon with the reasoning above, not rediscover it.

The `review_tier` half of a profile has no runtime consumer beyond being reported to the
operator; that is by design (PRD 010 frames it as the operator's step when the PR arrives), and
making it *observable* is not the same as adding a knob. Any later work that gives `review_tier`
teeth is changing the contract, not extending this decision.
