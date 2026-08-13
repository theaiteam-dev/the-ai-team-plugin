# ADR 0006: The `ateam.config.json` whole-config schema is deferred, not forgotten

**Status:** Accepted
**Date:** 2026-08-12
**Deciders:** Face + Sosa, ratified by Josh (mission: PRD 010 — Execution Stage / Frankie)

## Context

PRD 010 §2.1 adds seven fields to `ateam.config.json` (`surfaces`,
`qa.seed`, `qa.account.credential_env`, `qa.drive`, `testing_level`,
`evidence`, `review_tier`). Planning found the surface it is being added to
is already in poor shape:

- **No schema of any kind exists** — no JSON Schema, no TypeScript
  interface, no Zod. The only typed slice is `PricingConfig` in
  `packages/kanban-viewer/src/lib/token-cost.ts`, guarded by hand-rolled
  type guards.
- **Four divergent templates** are documented: `commands/setup.md:235-250`,
  `docs/ORCHESTRATION.md:309-324`, `README.md:694-711` (which uses `pnpm`
  where the others use `npm`), and a partial fragment at
  `agents/amy.md:166-174`.
- **None of the four** includes `ateamCliVersion` — which
  `commands/setup.md:291-297` actually greps for — or `pricing`, the only
  block with a real runtime consumer.
- **The two real config files disagree on type**: the repo root has
  `devServer` as an object; `packages/kanban-viewer/ateam.config.json` has
  it as a bare string.

ADR 0001 records this exact drift as the root cause of the kanban-viewer
container reading a pricing-less config and mispricing Opus as Sonnet.

## Decision

**Single-source the documentation; do not build a whole-config schema this
mission.**

- `commands/setup.md` holds the one canonical template. The README and
  ORCHESTRATION copies are replaced by **pointers to it**, not resynced
  duplicates. The canonical template gains the missing `ateamCliVersion`
  and `pricing` blocks.
- `scripts/hooks/lib/qa-contract.js` is the **executable definition of the
  new execution-contract fields only** — defaults, enum validation, and the
  drivability helper. It does not parse the rest of the config;
  `token-cost.ts` keeps its own reader.

## Alternatives Considered

- **A full JSON Schema or TS type covering every field, with a validator.**
  Fixes the pre-existing drift properly, but pulls in `token-cost.ts` and
  the Go CLI and turns a Frankie mission into a config-infrastructure
  mission.
- **Widen the new reader to parse the entire config.** Cheaper than a full
  schema, but oversizes one work item and collides with `token-cost.ts`'s
  own reader and cache.
- **Sync the four templates instead of single-sourcing.** Rejected outright:
  four copies that agree today are four copies that drift tomorrow, which is
  precisely how ADR 0001 happened.

## Consequences

The deferral is **only defensible while the canonical-template rule holds.**
The next mission touching this config will face the same question, and the
answer depends on one observable condition: **if a fourth copy of the
template reappears anywhere, the schema item stops being optional.**

Until then, the new fields are the best-specified part of the file — they
have defaults, enum validation, and tests — while the older fields
(`checks`, `devServer`, `precheck`, `postcheck`, `packageManager`) remain
untyped and untested. That asymmetry is intentional but should not be
mistaken for the file being in good order.
