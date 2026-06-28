---
missionId: ~
---

# Accurate Per-Message Token Attribution

**Author:** Josh / Claude  **Date:** 2026-06-06  **Status:** Draft

## 1. Context & Background

The token-usage tracking system (see `prd/completed/token-usage-tracking.md`) captures per-agent, per-model token cost for every mission. It works by having the `Stop` and `SubagentStop` hooks read an agent's transcript, **sum the `usage` block across all messages**, stamp the result with **the last model seen**, and POST it as one cumulative number. A downstream aggregation route groups those numbers by `(agentName, model)` and writes `MissionTokenUsage` rows that the dashboard reads.

That design rested on an assumption stated explicitly in the original PRD (§7, "Edge Cases"):

> "Multiple models in one transcript … The parser captures the last model encountered. This is a simplification — for the expected A(i)-Team usage patterns, each agent uses exactly one model throughout its session."

**That assumption no longer holds.** The orchestrator session (Hannibal) now drifts between models within a single mission: the harness launches Claude Code with no `--model` flag, so the session defaults to Opus, while `/ai-team:run` and `/ai-team:tick` frontmatter pull it toward Sonnet — the session alternates across the multi-hour tick loop. Real telemetry for mission `M-test-harness-20260531-002` shows Hannibal firing 152 cumulative `stop` events split across `claude-opus-4-8` and `claude-sonnet-4-6`.

When an agent spans two models, the current pipeline produces **wrong numbers in two independent ways**:

1. **Cross-model double-count (over-reports).** Each `stop` event carries the *whole-session cumulative* total. When the session has touched two models, the aggregator keeps the latest `stop` *per model* and then **sums those rows** — but each row is essentially the same full cumulative total sampled twice. For `M-test-harness-20260531-002`, Hannibal's two rows (`$37.18` + `$0.73` at stored rates, or two ~full snapshots of ~52–53M cache-read tokens) represent one session counted ~twice. Verified from raw `HookEvent` data: the cumulative `cacheReadTokens` counter climbs monotonically across *both* models interleaved (3.1M → 3.3M → 5.4M …  → 52.3M opus, 53.1M sonnet) — it is one shared session counter, not two accumulations.

2. **Model mis-attribution (mixes rates).** Even within one cumulative number, tokens generated under Opus and under Sonnet are summed together and stamped with whichever model appeared last. The per-model breakdown is therefore fiction whenever a session drifts.

A third, related defect compounded operator confusion: until recently `ateam.config.json` had no pricing entry for `claude-opus-4-8` / `claude-opus-4-7`, so every Opus agent silently billed at the Sonnet fallback rate — under-reporting Opus cost by ~1.67×. That config gap is already fixed; this PRD does not re-litigate it but treats correct pricing as a precondition for trustworthy output.

### Why this matters now

Cost analysis has become a primary use of this data — model selection, effort tuning, and the Murdock extended-thinking runaway were all diagnosed from it. But every Hannibal figure required manual recomputation from raw events to be trusted, and intermediate analyses repeatedly shifted as each defect surfaced. The data model, not the analyst, is the problem: **we discard clean per-message deltas and reconstruct a lossy cumulative snapshot, then spend aggregation logic trying to undo the reconstruction.**

### Ground truth is already in the transcript

Every assistant message in a Claude Code transcript carries **its own `usage` block and its own `model`**. That is exactly one correctly-attributed cost record per API call. The fix is to stop destroying that structure.

## 2. Problem Statement

The token pipeline converts clean per-message, per-model usage deltas into a single cumulative per-session sum stamped with one model. This is lossy and forces fragile reconstruction downstream. When any agent uses more than one model in a session (now routine for Hannibal), the result is both **double-counted** (cross-model summing of cumulative snapshots) and **mis-attributed** (mixed-model tokens priced as one model). The numbers cannot be read off the dashboard and trusted; they require manual reconciliation against raw events.

## 3. Goals & Success Metrics

| Goal | Metric | Target |
|---|---|---:|
| Eliminate cross-model double-count | Mission total from dashboard vs. hand-computed from raw transcript deltas | Match within 1% |
| Correct per-model attribution | For a model-drifting session, each model's tokens priced at its own rate | 100% correct (no mixed-model rows) |
| Per-agent-type rollup | Pool instances (`murdock`, `murdock-1…`) summed under base role | One consolidated figure per role |
| Stop re-analysis churn | Number of manual raw-event recomputations needed to trust a mission total | 0 |
| No regression on single-model agents | Existing single-model agent totals (ba, amy, lynch) before vs. after | Unchanged within 1% |
| Backfill historical missions | Recent archived missions re-aggregated to correct figures | All missions with token data |

## 4. Scope

### In Scope

- Capture token usage **per assistant message, keyed by that message's own model**, rather than one summed-and-relabeled cumulative number per session.
- Persist per-(agent, model) usage without relying on "latest cumulative snapshot" reconstruction.
- Simplify the aggregation route to a straight group-by-and-sum over correctly-attributed records.
- Preserve and incorporate the already-landed fixes: opus-4-7/4-8 pricing, correlationId-based stop dedup, and agent-variant (`-N`) consolidation.
- A re-aggregation / backfill path so existing archived missions show corrected numbers.
- Tests proving: model-drift attribution, no double-count, single-model parity, variant rollup, retry idempotency.

### Out of Scope

- Long-context (1M) premium pricing tiers — confirmed not applicable to the Sonnet 4.6 / Opus 4.8 generation (no above-200K surcharge), so flat per-token rates remain correct. No change needed.
- Effort/thinking *control* (separate effort-cap work in `agents/*.md`); this PRD only ensures the resulting tokens are *measured* correctly.
- Batch-discount or cache-TTL nuance modeling — list-price estimates remain the contract.
- Any change to which hooks fire or the broader observability schema beyond token attribution.

## 5. Root-Cause Summary (current vs. target)

**Current (lossy):**
```
every Stop / SubagentStop:
  read WHOLE transcript
  inputTokens  = Σ all messages' input_tokens          ← cumulative
  outputTokens = Σ all messages' output_tokens          ← cumulative
  model        = last message's model                   ← attribution lost
  → POST one number
aggregation:
  keep latest stop per (agent, model)                   ← reconstruction
  SUM across models                                     ← double-counts drifting sessions
```

**Target (faithful):**
```
capture:
  per assistant message → { model, input, output, cacheCreation, cacheRead, messageId }
  attribute each message's tokens to ITS OWN model
  PERSIST one row per message (durable per-message source of truth)
aggregation:
  GROUP BY (baseAgent, model) → SUM per-message deltas
  (no "latest snapshot", no cross-model summing)
```

The target makes the four previously-identified robustness gaps largely moot: model mis-attribution (per-message model), cross-model double-count (no snapshot summing), cumulative-vs-delta confusion (store deltas as they are), and retry dedup (key on message id).

## 6. Functional Requirements

1. **Per-message extraction.** The transcript parser shall return, for a transcript, one usage record **per assistant message** — `{ messageId, model, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens }` — attributing each message's tokens to that message's own `model`. It shall no longer collapse to a single cumulative tuple with a single `model` field.
2. **Per-message persistence (durable source of truth).** Each per-message usage record shall be persisted as its own row, keyed by `messageId` for idempotency. The store, not the transcript, becomes the durable per-message record — turn-level cost analysis must be answerable from the DB alone, without reading transcripts. Re-emitting the same message (retry, or a later stop re-reading the same transcript) shall upsert on `messageId`, never insert a duplicate.
3. **Delta semantics, never cumulative snapshots.** Because storage is per-message deltas keyed by message id, the aggregator shall never sum two snapshots of the same session. Mission/agent totals are a `SUM` over distinct per-message rows.
4. **Correct per-model pricing.** Each (agent, model) pair shall be priced at that model's configured rate; cache-creation at input rate, cache-read at the discounted rate (unchanged pricing math, correct inputs).
5. **Agent-variant consolidation.** `murdock`, `murdock-1`, `murdock-2`, … shall roll up to base role `murdock` in the reported breakdown, summing genuinely-independent instance totals without double-counting (preserving the already-landed `baseAgentName` logic).
6. **Re-aggregation.** A re-aggregation entry point shall recompute `MissionTokenUsage` for a given mission from the stored per-message rows, so a re-run or post-check-extended mission reflects current data. Per OQ1 (resolved: forward-only) this is NOT swept across archived missions; old missions captured under the legacy cumulative scheme are left as-is, with an optional one-off script for the recent `M-test-harness-20260531-*` set.
7. **Per-turn queryability.** It shall be possible to answer "which messages/turns in this agent-session consumed the most tokens" from stored data (the capability that diagnosed the Murdock thinking spike), without reading transcripts.
8. **Dashboard — dual views (per OQ3).** The token-usage surface shall present both: (a) a **per-agent rollup** (summed across that agent's models) as the default decision view, and (b) a **per-model view** — per-agent-per-model and a mission-wide per-model total. Both derive from the `MissionTokenUsage` `(agentName, model)` rows; the per-agent rollup is a sum across an agent's model rows. An agent spanning >1 model shall be visually flagged as a model-drift indicator.

## 7. Non-Functional Requirements

- **No new agent latency / no blocking.** Capture stays synchronous in the hook and within the existing fire-and-forget contract; parsing a multi-hundred-line transcript stays well under ~100ms.
- **Backward compatible storage.** Prefer additive schema changes; never recreate live tables (per `docs/PLUGIN-DEV.md` migration rules and the "never replace the live DB" constraint).
- **Test-first.** All behavior covered by the existing vitest suites (`scripts/hooks/__tests__`, `packages/kanban-viewer/src/__tests__/token-aggregation.test.ts`) extended; no net reduction in coverage.

## 8. Data Model

Per the resolved storage decision (OQ2: per-message rows retained), the design adds a **new per-message usage table** as the durable source of truth, and keeps `MissionTokenUsage` as a derived rollup over it.

### 8.1 New: per-message usage table (source of truth)

The current `HookEvent` carries a single `(model, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens)` tuple per event — insufficient to represent a multi-model session and lossy by construction. Rather than overload `HookEvent`, introduce a dedicated table (illustrative shape; final naming/columns are the decomposition's call):

```
MessageTokenUsage (new):
  id                  Auto
  messageId           String   Assistant message id (e.g. "msg_01FK…") — UNIQUE, idempotency key
  projectId           String   → Project
  missionId           String?  → Mission (nullable; same orphan caveat as HookEvent)
  agentName           String   Raw agent/instance name (e.g. "murdock-1")
  model               String   THIS message's model
  inputTokens         Int
  outputTokens        Int
  cacheCreationTokens Int
  cacheReadTokens     Int
  timestamp           DateTime Message timestamp (enables per-turn / time-bucket analysis)

  @@unique([messageId])           // upsert target — retries & re-reads never duplicate
  @@index([missionId])
  @@index([missionId, agentName])
```

- **Idempotency** is structural: re-emitting a message upserts on `messageId`. This subsumes the stop-event correlationId dedup concern for token data specifically — every message is its own dedup key.
- **Volume**: ~150–400 rows per agent-session. Acceptable for SQLite at dogfood scale; `@@index([missionId, agentName])` keeps rollup queries fast. If volume becomes a concern at larger scale, a retention/prune policy on archived missions can follow (out of scope here).
- Token fields currently on `HookEvent` may remain for backward compatibility / legacy missions but are **no longer the basis** for new aggregation. (Decomposition decides whether to stop populating them or keep them as a redundant per-session denormalization.)

### 8.2 Derived: MissionTokenUsage (unchanged shape)

`MissionTokenUsage` keeps its existing shape and `@@unique([missionId, agentName, model])` — the change is purely in derivation: it is now `SUM` over `MessageTokenUsage` grouped by `(baseAgentName(agentName), model)`, instead of the latest-cumulative-stop reconstruction. No client-side dashboard change required.

### 8.3 Capture path change

`parseTranscriptUsage` (in `scripts/hooks/lib/parse-transcript.js`) changes from "sum-all + last-model" to returning the per-message records of §6 FR-1. The Stop/SubagentStop hooks POST those records; the `POST /api/hooks/events` route (or a sibling endpoint) upserts them into `MessageTokenUsage` keyed by `messageId`. Because a stop fires every turn and re-reads the full transcript, most messages will be re-sent many times — upsert-on-messageId makes that idempotent and is the mechanism that finally kills the cumulative double-count at the source.

## 9. Edge Cases & Error States

- **Single-model session (the common case):** must produce identical results to today (minus the pricing correction). Regression-tested.
- **Model drift mid-session (Hannibal):** each model's tokens attributed and priced separately; mission total equals the true cumulative, not 2×.
- **Pre-change historical missions:** left under the legacy cumulative scheme (forward-only, per OQ1). Their dashboard figures retain the known double-count/mis-attribution; not recomputed except by the optional one-off script for the recent test-harness set. The new per-message table only backs missions run after the change.
- **Transcript missing/unreadable:** unchanged behavior — skip token emission rather than fail the hook; the message rows simply aren't written.
- **Empty / no-assistant-message transcript:** no `MessageTokenUsage` rows written; agent contributes zero, no row inflation.
- **Same message re-sent across many stops (normal case):** upsert on `messageId` — one row regardless of how many stops re-read it. This is the primary mechanism preventing cumulative double-count.
- **Message with no `id` in transcript:** cannot be deduped by key; define fallback (skip, or synthesize a stable key from session+index) in the technical approach so it neither duplicates nor silently drops.
- **Pool instances completing in parallel:** each message carries its own raw `agentName` (e.g. `murdock-1`); rollup sums under base role without collapsing distinct sessions.

## 10. Dependencies

### Internal
- `scripts/hooks/lib/parse-transcript.js` — `parseTranscriptUsage` rewrite (per-message records, not sum + last-model).
- `scripts/hooks/observe-stop.js`, `observe-subagent.js` — emit per-message records.
- `packages/kanban-viewer/src/app/api/hooks/events/route.ts` (or sibling endpoint) — accept + upsert per-message records on `messageId`.
- `packages/kanban-viewer/prisma/schema.prisma` + migration — new `MessageTokenUsage` table (additive; `ALTER`/`CREATE TABLE`, never recreate live tables).
- `packages/kanban-viewer/src/app/api/missions/[missionId]/token-usage/route.ts` — aggregation reads/sums `MessageTokenUsage`; re-aggregation entry point.
- `packages/kanban-viewer/src/lib/agent-name.ts` — base-role consolidation (already landed).

### External
- Already-landed, uncommitted working-tree changes this builds on: opus-4-7/4-8 pricing, correlationId stop dedup + failure logging, agent-variant consolidation. This PRD assumes those are committed first (or that the mission branches from the current working tree).

## 11. Risks & Decisions

- **Interaction with in-flight fixes.** Three related fixes already sit uncommitted in the working tree (opus pricing, correlationId dedup + failure logging, agent-variant consolidation). Risk of conflicting edits to the same files. *Mitigation:* commit those first; this work branches from that baseline. Note the per-message `messageId` upsert (§8.3) largely subsumes the stop correlationId dedup for token data — decomposition should reconcile the two so they don't fight.
- **New-table volume.** ~150–400 rows/agent/mission. Fine at dogfood scale; a prune/retention policy for archived missions is a possible follow-up if it grows.
- **Messages lacking a stable id.** Dedup keys on `messageId`; the rare id-less message needs a defined fallback (see §9) to avoid duplicate or dropped rows.

### Resolved Decisions
1. **Backfill: forward-only (DECIDED 2026-06-16).** No general in-place backfill of archived missions. Historical events were captured cumulatively with last-model-wins, so a true per-model split is unrecoverable for them; a full backfill would run fragile code over old data only to produce authoritative-looking-but-approximate splits — recreating the trust problem this PRD exists to kill. Instead: the re-aggregation entry point (FR-6) remains (needed to re-aggregate a live/re-run mission), but it is NOT swept across all archived missions. A small one-off corrective script may write the hand-verified figures for the recent `M-test-harness-20260531-*` missions if needed. The deliverable is "new runs are correct," not "rewrite history."

2. **Storage grain: per-message rows retained (DECIDED 2026-06-16).** Persist each assistant message's usage + its own model individually, rather than only a per-(session, model) rollup. Rationale: the per-message grain is what made the Murdock extended-thinking spike diagnosable (25K thinking tokens per trivial ACK turn), and we do not want that capability to depend on Claude Code transcripts remaining on disk — transcripts are not a guaranteed-durable record (temp dirs, rotation, cleanup). The DB becomes the durable per-message source of truth; `MissionTokenUsage` is a derived rollup over it. Cost: a new high-volume table (~150–400 rows/agent/mission) and aggregation that groups over the larger set. This makes per-turn cost analysis a first-class, queryable capability instead of a manual transcript dig. See §8 for the resulting data-model shape.

3. **Dashboard views: both per-agent and per-model, first-class (DECIDED 2026-06-16).** Surface a per-agent rollup (default decision view) AND a per-model view (per-agent-per-model + mission-wide per-model totals). Pure presentation over the `(agentName, model)` rows; no extra data-model cost. An agent appearing under >1 model is surfaced as a model-drift indicator. See FR-8.

3. **Dashboard views: both per-agent and per-model, first-class (DECIDED 2026-06-16).** Surface two complementary views: (a) a **per-agent rollup** (sum across that agent's models) as the decision-useful default — "Murdock cost $245," "Hannibal cost $62"; and (b) a **per-model view** — both per-agent-per-model (Hannibal's opus portion vs sonnet portion when it drifts) and a mission-wide per-model total (how much opus vs sonnet vs haiku did this whole mission burn). Both are pure presentations over the `MissionTokenUsage` `(agentName, model)` rows that OQ2's per-message store already produces, so this is a UI/route concern, not a data-model one. Emergent benefit: an agent appearing under >1 model in the per-agent view is an at-a-glance **model-drift indicator** (a config-bug signal worth flagging visually), not just an accounting detail.

## 12. Validation Plan

The canonical regression fixture is mission `M-test-harness-20260531-002`, whose correct breakdown has been hand-computed from raw transcript deltas:

| Agent | Model | Output | Cache-read | Cost (correct) |
|---|---|---:|---:|---:|
| murdock | opus-4-8 | 5,995,002 | 46,433,147 | $245.23 |
| hannibal | opus-4-8 | 265,579 | 102,877,448 | $61.97 (single cumulative, **not** ×2) |
| ba | sonnet-4-6 | 609,037 | 70,024,718 | $33.67 |
| amy | sonnet-4-6 | 194,111 | 17,582,666 | $11.72 |
| lynch | sonnet-4-6 | 107,649 | 8,647,998 | $6.59 |
| face | opus-4-8 | 12,606 | 2,142,433 | $2.79 |
| sosa | opus-4-8 | 5,030 | 896,421 | $2.10 |
| **TOTAL** | | | | **~$364** |

Success = the corrected aggregation reproduces this table from stored events (hannibal as a single cumulative figure, all opus priced at opus rates), and the dashboard shows it without manual recomputation.

## 13. Success Criteria

- Dashboard mission total matches hand-computed raw-delta total within 1% for `M-test-harness-20260531-002` and the next live run.
- Hannibal appears as a single correctly-priced figure (no cross-model double-count).
- Single-model agents unchanged within 1%.
- Pool variants rolled into base role.
- No manual raw-event recomputation needed to trust a mission's numbers.
- Existing token + hooks test suites green; new tests cover model-drift, no-double-count, variant rollup, and single-model parity.
