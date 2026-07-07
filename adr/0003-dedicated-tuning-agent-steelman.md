# ADR 0003: Dedicated tuning agent with independent adversarial steelman

**Status:** Accepted
**Date:** 2026-07-03
**Deciders:** Face + Sosa (mission: Mission Learning Loop — Phase 2: Tuning Rounds)

## Context

FR-9 requires that, before a learning is promoted to a system rule (skill text, agent prompt, or hook), an independent agent argues the counter-case — a steelman of why a competent developer did the flagged thing on purpose. The question during decomposition was whether this synthesis-and-steelman role should extend the existing retro agent (`agents/retro.md`) or live in its own agent file.

## Decision

Create a new, separate `agents/tuning.md` agent that owns proposal synthesis and the adversarial steelman, and gates system-rule promotion on the two-bar criteria (objectivity + steelman + corroboration). It is not an extension of the retro agent.

## Alternatives Considered

- **Extend `agents/retro.md`** — rejected: retro's job is capture and telemetry mining (turning mission signal into RetroLearning rows). Tuning's job is synthesis and adversarial judgment over that accumulated signal. Sharing one agent context conflates the two roles and, worse, undermines the independence the steelman depends on — an agent that mined the evidence is not a neutral party to argue against acting on it.

## Consequences

Promotion-gating judgment now lives in a role distinct from capture. Phase 3's eval gate plugs into the tuning agent (which already holds the promotion-decision context), not the retro agent. A future pass should keep capture (retro) and promotion judgment (tuning) as separate agents; merging them to save a file would reintroduce the steelman-independence problem this decision resolves.
