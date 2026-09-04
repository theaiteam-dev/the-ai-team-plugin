# ADR 0008: The execution-contract resolver stays synchronous; callers supply the mission contract

**Status:** Accepted
**Date:** 2026-09-03
**Deciders:** Face + Sosa (mission: M-20260903-002, Mission Entry Points & Quality Profiles)

## Context

PRD "Mission Entry Points & Quality Profiles" FR-9 requires every consumer of the execution
contract — agents, playbooks, and hooks — to read the running mission's stored contract first
and fall back to `ateam.config.json` only when the mission has none. The PRD's Technical
Considerations section frames `scripts/hooks/lib/qa-contract.js` as becoming "the single
resolver for 'mission contract, else config'."

That framing collides with what the module actually is. `qa-contract.js` is deliberately the
only parser of the config's execution-contract block — `stop-gates.js` deleted its own second,
stricter parser precisely because two parsers gave two answers to the same question. But the
module is also fully synchronous: it does exactly one `fs.readFileSync` and has no API,
database, or CLI access. Its runtime callers are PreToolUse/Stop hooks, which have no network
available to them. A mission's contract lives in the API database, reachable only over the
network. So "read the mission's contract first" cannot literally be a fetch performed inside
the resolver without breaking every hook that calls it.

## Decision

The resolver stays a pure, synchronous merge function. The mission's contract is fetched by the
**caller** — agents and playbooks already shell out to `ateam missions-current getCurrentMission
--json` — and passed into the resolver as an argument. Bundle definitions for the `quick` /
`normal` / `deep` profiles live in this one module and nowhere else.

Hooks, which cannot fetch, fall back to `ateam.config.json` alone. That fallback is explicit and
documented at the call site, never silent.

## Alternatives Considered

- **Make the resolver async and fetch internally.** Rejected: it breaks every hook caller, all
  of which are synchronous by construction.
- **Have hooks read a mission contract cached to disk at mission start.** Rejected: a second
  source of truth for the same question, with its own staleness failure mode.
- **Add a second, mission-aware resolver module beside the existing one.** Rejected: this is
  exactly the two-parsers failure mode ADR 0006 already fixed once in this codebase.

## Consequences

Every future per-mission policy field hits this same wall — the pattern established here (pure
resolver, caller-supplied context) is the answer for those too, and should not be re-litigated
per field.

It also means a hook's answer and an agent's answer about the same mission may legitimately
differ: the agent sees the mission's stored contract, the hook sees only repo config. That is a
deliberate, bounded divergence, not a bug. Anyone debugging a discrepancy between a hook's
enforcement and an agent's behaviour should start here.
