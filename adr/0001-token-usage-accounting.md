# ADR 0001: Token Usage Accounting

**Status:** Accepted
**Date:** 2026-06-28
**Deciders:** Josh + Claude

## Context

The A(i)-Team reports per-agent, per-model token cost for every mission (the
kanban-viewer dashboard, `MissionTokenUsage`). Getting this number *right* turned
out to be subtle: across one long debugging session we found **five distinct
ways the pipeline mis-counted tokens**, several of which masked or inverted each
other so the dashboard total was confidently wrong. This ADR records how token
accounting is supposed to work and every trap we hit, so we don't re-learn them.

The single hardest lesson: **every counting bug here was found by checking raw
data, and every bug we "diagnosed by reasoning" without checking was wrong at
least once.** Verify against transcripts/DB, never infer.

## The pipeline

```
Claude Code transcript (.jsonl)          ← ground truth: per-message usage deltas
        │  observer hooks (Stop / SubagentStop)
        ▼  scripts/hooks/lib/parse-transcript.js   ← parse + dedup per message
HookEvent rows (per stop/subagent_stop)  ← captured token totals per agent event
        │  POST /api/missions/:id/token-usage
        ▼  packages/kanban-viewer/.../token-usage/route.ts   ← aggregate
MissionTokenUsage rows (per agent+model) ← derived rollup the dashboard reads
        │  calculateTokenCost (token-cost.ts + ateam.config.json pricing)
        ▼
$ per agent, $ per mission
```

## How token usage is calculated (the rules)

### 1. Transcript usage is a per-message DELTA, not a cumulative total
Each assistant message's `usage` block is that message's own consumption. To get
a session total you **sum across messages**. (Verified empirically: cache-creation
fluctuates per message — 30500 → 12089 → 5259 → … — it does not monotonically
grow, so it is not cumulative.)

### 2. Claude Code writes each message to the transcript MULTIPLE times
As a message streams and then finalizes, the same `message.id` is written 2–3×,
each emission carrying the same final usage. **You must dedup by `message.id`**
before summing, or you over-count by the duplication factor (measured **2.6×–3.4×**
across real transcripts). `parse-transcript.js` keys usage by `message.id`
(last-write-wins per id) and sums the deduped values. Lines with no `message.id`
cannot be deduped and are summed as-is (assumed distinct).

### 3. `stop` vs `subagent_stop` events mean different things
- **`subagent_stop`** — fired when a subagent (spawned via `Agent`/Task) finishes.
  One per subagent process. Its token total is that subagent's whole run.
  **SUM across events**, because distinct subagent processes (incl. pool
  instances murdock-1, murdock-2 …) are independent.
- **`stop`** — fired by a top-level session every turn, carrying the session's
  **cumulative** total. **Take only the latest per (agent, model)** — summing
  multiple stop events massively over-counts (each is a growing snapshot).

### 4. Only genuine top-level sessions own `stop` events
`hannibal` (the orchestrator) and native teammates that emit *only* `stop` are
real session owners. Subagents that run inside the main context (`face`, `sosa`,
`stockwell`, `retro`, `tawnia`) report real work via `subagent_stop` **and** emit
a *phantom* `stop` carrying the main session's cumulative total tagged with their
name (often on a different model than their real work). **If a base role appears
in `subagent_stop` at all, drop ALL its `stop` events.**

### 5. Pool instances roll up to their base role
`murdock-1`, `murdock-2`, … are instances of one logical agent. Group by
`baseAgentName()` (strip a trailing `-<digits>`). Sum independent instances; do
not collapse cumulative snapshots of one instance (handled by rule 3).

### 6. Pricing
`calculateTokenCost` (token-cost.ts) prices each (agent, model) at its model's
rate: input and **cache-creation** at the input rate, **cache-read** at the
discounted rate. Pricing comes from `ateam.config.json` `pricing` block, falling
back to `DEFAULT_PRICING` in token-cost.ts. **Both must list every current model**
— a missing model silently falls back to the Sonnet rate.

### 7. Re-aggregation is idempotent
POST deletes the mission's existing `MissionTokenUsage` rows before writing, so
re-running after a logic change never leaves stale rows.

## Trials we hit (the bugs, in the order found)

| # | Bug | Symptom | Root cause | Fix |
|---|-----|---------|-----------|-----|
| 1 | **Opus priced as Sonnet** | opus agents ~1.67× under-reported | opus-4-7/4-8 missing from pricing config *and* `DEFAULT_PRICING`; container reads kanban-viewer's own minimal `ateam.config.json` (no pricing block) | add opus-4-7/4-8 to `DEFAULT_PRICING` |
| 2 | **Cross-model `stop` double-count** | hannibal ~2× (two rows summed) | aggregation kept latest stop *per (agent, model)* then summed across models; one drifting session became two near-full snapshots | take single latest stop per agent for session owners |
| 3 | **Agent-variant fragmentation** | murdock split across murdock-1..N | grouped by exact name | `baseAgentName()` rollup |
| 4 | **Phantom main-session bleed-through** | retro/tawnia/stockwell each +~$18 (a copy of hannibal's total) | subagents emit a `stop` carrying the main-session cumulative on a different model; per-(role,model) skip missed it | drop ALL stop events for any role seen in `subagent_stop` |
| 5 | **Duplicate-message summing** | every agent inflated 2.6–3.4×; e.g. one Face pass showed 12.4M cache-creation | `parse-transcript.js` summed every transcript line; Claude Code writes each message 2–3× | dedup by `message.id` |

### Confounds that made this hard
- Bugs **canceled out**: opus under-pricing (#1, too low) partly masked the
  stop double-count (#2, too high), so a wrong total looked plausible.
- The fixes were **committed to main but not live** for weeks because the
  kanban-viewer **Docker container was never rebuilt** — and when rebuilt, it
  failed (relative `DATABASE_URL` + Prisma 7/libSQL → empty DB → seed crash;
  fixed with an absolute build-time `DATABASE_URL`).
- Two different `ateam.config.json` files exist (plugin root vs kanban-viewer);
  the container reads the latter, so a pricing fix to the former did nothing.

## Decision

Adopt rules 1–7 above as the canonical token-accounting model. Encode each in a
regression test. The medium-term target (see
`prd/drafts/accurate-token-attribution.md`) is a per-message `MessageTokenUsage`
store keyed by `message.id`, which makes rules 2–5 structural rather than
heuristic — at that point much of the aggregation special-casing can be deleted.

## Validation

Canonical fixture: mission `M-test-harness-20260628-002`. Hand-computed from raw
events = **$35.51**; dashboard after fixes #1–4 = **$35.53** (rounding). Fix #5
(message dedup) is verified by `parse-transcript.test.ts` and reduces raw
transcript token counts by the measured 2.6–3.4× duplication factor; it affects
runs captured *after* the fix (historical HookEvent rows were captured pre-dedup
and cannot be retroactively corrected without re-parsing transcripts, which may
no longer exist — see "forward-only" in the attribution PRD).

## Consequences

- Historical `MissionTokenUsage` for runs captured before fix #5 remains inflated
  ~2.6–3.4× on cache tokens; do not compare pre- and post-fix runs on absolute
  cost. Re-aggregation (POST) re-derives from HookEvent rows but cannot undo
  capture-time over-counting.
- Every rule above has a test; changing aggregation requires updating tests.
- The dashboard is now authoritative for runs captured after these fixes; we no
  longer hand-compute from raw events to trust a number.
