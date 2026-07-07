# ADR 0002: Tuning operator surface is three-part, not a single interactive CLI

**Status:** Accepted
**Date:** 2026-07-03
**Deciders:** Face + Sosa (mission: Mission Learning Loop — Phase 2: Tuning Rounds)

## Context

FR-7 of the Mission Learning Loop PRD names a single interactive command, `ateam tuning start`, that walks an operator through recurrence-ranked tuning candidates and applies verbs. During decomposition it became clear that a cobra CLI cannot host an LLM-in-the-loop walk: synthesizing proposal text and an adversarial steelman on accept/edit requires a Claude agent, which the Go binary has no way to invoke. Cramming the walk into the CLI would either drop the synthesis requirement or bolt a subprocess-to-Claude hack onto the data plane.

## Decision

Split the tuning operator surface into three cooperating pieces:

1. **CLI data plane** (`ateam tuning` cobra subcommands: `candidates`, `propose`, `apply`) — thin HTTP wrappers over the tuning endpoints, no interactivity.
2. **`/ai-team:tuning` slash command** — the resumable interactive walk that presents one card per target surface and records each verb decision immediately.
3. **Dedicated tuning agent** (`agents/tuning.md`) — invoked by the walk on accept/edit to synthesize the recommendation and adversarial steelman.

## Alternatives Considered

- **Monolithic interactive CLI (`ateam tuning start`)** — rejected: cobra cannot run an LLM in the loop, so proposal/steelman synthesis would have no home.
- **Driving the walk from the retro command** — rejected: retro and tuning have different lifecycles (telemetry capture vs. operator-in-the-loop synthesis); coupling them conflates two cadences.

## Consequences

This establishes a reusable template for any future "operator walks ranked records, applies verbs" surface: CLI for the data plane, slash command for the interactive walk, agent for LLM synthesis. Phase 3's eval-gate walk should follow the same three-part split rather than reintroducing a single interactive CLI. A future Face/Sosa pass should not re-litigate whether `ateam tuning start` could be one command — the LLM-in-cobra constraint is settled.
