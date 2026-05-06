---
missionId: ~
---

# Mission Phase Lifecycle

**Author:** Josh Owens  **Date:** 2026-05-01  **Status:** Draft

## 1. Context & Background

The A(i)-Team has nine agents. Five of them — Hannibal, Face, Sosa, Stockwell, Tawnia — operate at the *mission* scale, not the *work-item* scale. They decompose, critique, orchestrate, do final review, and write docs for the mission as a whole.

The current API only models item-scoped work. Every agent calls `POST /api/agents/start` with an `itemId`, and the route validates that item exists. The five mission-scoped agents have been working around this by passing sentinel strings (`FINAL-REVIEW`, `DOCS`, `PLAN-DECOMP`, `PLAN`) — and the API has been silently rejecting all of them with `ITEM_NOT_FOUND` 404s since at least 2026-04-03 (`packages/kanban-viewer/prisma/data/api-errors.log`, ~4 weeks of continuous failure).

Consequences observed:
- Mission-level agents have **no claim record**, so the kanban can't show "Stockwell is doing final review."
- Mission-level agents have **no work_log entries**, so we can't see Face's decomposition pass, Sosa's critique verdict, or Tawnia's commit hash without scraping the activity feed.
- Per-phase token cost is **not attributable** — `getToolHistogram` aggregates by mission but can't isolate "what did final review cost vs. decomposition vs. docs."
- The retro UI has no concept of phases, so post-mortems lose structural information that lives only in scattered ActivityLog rows.

The companion design doc (`PAIR-ARCH.md` at the repo root) walks through how this design collapsed from "two new endpoints + a CLI verb" down to "one new table + a registry-based branch."

## 2. Problem Statement

Mission-level agents have no first-class lifecycle in the API. They are forced into an item-shaped slot that fails validation, costing us claim semantics, structured work history, and per-phase cost attribution across every mission.

## 3. Target Users & Use Cases

**Primary users:**
- **The five mission-scoped agents** (Hannibal, Face, Sosa, Stockwell, Tawnia) — need to record start/stop/outcome for the work they actually do.
- **Plugin operators** (Josh, future ai-team users) — need to see mission progress at a glance and attribute cost to specific phases.
- **Retro tooling** — needs structured phase history to build mission post-mortems.

**Key use cases:**
- Stockwell needs to claim the final-review phase so a second Stockwell can't run concurrently and so the kanban shows the phase is in flight.
- Face needs to record that decomposition completed with a verdict (e.g., "12 items created, 2nd-pass refinement applied"), queryable later as part of mission history.
- A retro reader needs to see the phase timeline of a mission — *when did orchestration end, when did final review start, what was the verdict, how much did each phase cost?*
- The kanban viewer needs a mission timeline strip showing phases as pills with status, separate from the per-item columns.

## 4. Goals & Success Metrics

| Goal | Metric | Target |
|------|--------|--------|
| Stop dropping mission-level lifecycle telemetry | `ITEM_NOT_FOUND` 404s on `agents/start` and `agents/stop` for the 5 mission agents | 0 per mission (currently 4–10 per mission) |
| Make every mission phase queryable | Distinct `MissionPhase` rows per mission | 5 (one per mission-scoped agent invocation) |
| Enable per-phase cost attribution | Token cost rollup by `(missionId, phase)` available in API | Available for every mission post-launch |
| Surface phases in the kanban UI | Mission timeline strip rendered on board page | Visible by GA |

## 5. Scope

### In Scope
- New `MissionPhase` table in the kanban-viewer Prisma schema, with `(missionId, phase, agent, status, startedAt, finishedAt, summary)` plus `rejectionTarget` for Stockwell-style rejections. `agent` is nullable for system-managed phases (e.g., `coding`).
- Registry-based branch in `POST /api/agents/start` and `POST /api/agents/stop`: agent identity selects item-flow vs. phase-flow.
- System-managed `coding` phase row, opened on first item → testing, closed on last item → done.
- Stockwell rejection writes to BOTH the `MissionPhase` row AND each named item's `rejection_count` and `work_log`.
- Mission state machine in `packages/shared` with a transition matrix mirroring the item-stage `TRANSITION_MATRIX` pattern.
- Deletion of the no-op pseudo-item-IDs (`FINAL-REVIEW`, `DOCS`, `PLAN-DECOMP`, etc.) from the five affected agent bodies.
- Update to `enforce-agent-start.js` hook so phase agents are not required to pass `--itemId`.
- Token-usage rollup endpoint (or extension) that groups by phase.
- Mission timeline strip in the kanban UI, fed by the new table — pills for each phase with status, click to expand summary and per-phase token cost.

### Out of Scope
- Migration / backfill of historical missions. New missions only — historical activity is reconstructable from `ActivityLog` if anyone needs it later.
- Renaming or restructuring the existing per-item lifecycle endpoints. Item-flow is unchanged.
- New CLI verbs. The existing `ateam agents-start agentStart` / `ateam agents-stop agentStop` commands stay; the only behavior change is that `--itemId` is **forbidden** for the five mission/phase agents (face, sosa, hannibal, stockwell, tawnia) and **required** for the four item agents (murdock, ba, lynch, amy) — see Requirements 1–3 for the per-agent rule and Non-Functional Requirement 4 for the legacy-CLI failure mode.
- Hannibal cost-reduction work (separate concern, deferred per CLAUDE.md notes).
- Cross-mission phase queries (e.g., "show all final reviews ever"). Per-mission views only at launch.

## 6. Requirements

### Functional Requirements

1. The system shall accept `POST /api/agents/start` calls from `face`, `sosa`, `hannibal`, `stockwell`, and `tawnia` *without* an `itemId`, and shall record a row in the new `MissionPhase` table with the agent's mapped phase.
2. The system shall reject `POST /api/agents/start` calls from `face`, `sosa`, `hannibal`, `stockwell`, or `tawnia` that *do* include an `itemId`, with a clear validation error.
3. The system shall accept `POST /api/agents/start` calls from `murdock`, `ba`, `lynch`, and `amy` only when an `itemId` is provided, preserving the existing item-flow behavior.
4. The system shall map agent identity to phase using a fixed registry: `face → decomposition`, `sosa → critique`, `hannibal → orchestration`, `stockwell → final-review`, `tawnia → docs`. In addition, the system shall record a `coding` phase row for the period when the per-item pipeline is active. The `coding` phase is system-managed (no single agent claims it): it opens automatically when the first item enters `testing` and closes when the last item reaches `done` or the mission is otherwise terminated. `MissionPhase.agent` is therefore nullable for system-managed phases.
5. The system shall enforce single-claim semantics per `(missionId, phase)`: a second `phase-start` for the same `(missionId, phase)` while the first is `in_progress` shall return a conflict error.
6. The system shall accept `POST /api/agents/stop` for a phase agent and update the matching `MissionPhase` row's `status` (`completed` or `failed`), `finishedAt`, and `summary`.
7. The system shall accept `--outcome rejected` on phase-stop *only for `stockwell`*. A Stockwell rejection shall write to BOTH (a) the matching `MissionPhase` row (status, summary, and the list of rejected item IDs) AND (b) each named item — incrementing the item's `rejection_count` and recording the rejection in its `work_log`. Items that hit the rejection cap shall transition to `blocked` per the existing item rejection policy. The Stockwell rejection shall ALSO roll `Mission.state` back from `final_review_in_progress` to `coding` (re-opening the coding phase row) so that re-dispatch of the affected items is a legal forward transition under the matrix; re-entry into `final_review` requires every named item to reach `done` again, at which point Stockwell may be re-dispatched. All other phase agents may only complete or fail.
8. The system shall expose phase rows on `GET /api/missions/{id}` (or a sibling endpoint) so the kanban UI can render a mission timeline.
9. The token-usage aggregation shall expose a per-phase breakdown for the mission, joining `HookEvent` rows on `(missionId, agentName, timestamp)` against `MissionPhase.startedAt..finishedAt`.
10. The `enforce-agent-start.js` hook shall recognize the five phase agents and not require `--itemId` for their `agents-start` calls; it shall continue gating `agents-stop` and `activity` for item-scoped agents as today.
11. The system shall model mission progression as a state machine. `Mission.state` shall advance through a defined set of values keyed to phases (e.g., `decomposing` → `critiquing` → `orchestrating` → `coding` → `final_review` → `documenting` → `done`), with a transition matrix that rejects illegal moves the same way the existing item-stage `TRANSITION_MATRIX` does (see `packages/shared/src/stages.ts`). The matrix shall include exactly one backward transition: `final_review_in_progress → coding` for Stockwell rejections (Req 7); all other backward moves are illegal.
12. Each successful `phase-start` shall transition `Mission.state` to the matching `*_in_progress` value if and only if the transition is legal. Each successful `phase-stop` shall transition out of that state into the next legal state on `--outcome completed`, into the Stockwell-rollback target (`coding`) on `--outcome rejected` (Stockwell only), or into `failed` / `archived` on failure / archive.
13. The mission state machine shall be defined in shared code (consumable by the API, the hook, and the kanban viewer) so all three see a single source of truth — symmetric with how `TRANSITION_MATRIX` works for item stages today.

### Non-Functional Requirements

1. Adding `MissionPhase` shall not require changes to existing per-item endpoints' response shapes. Item-flow callers see no behavioral difference.
2. Phase records shall not block mission completion: `archiveMission` shall succeed even if a phase row is `in_progress` (with a warning logged), since orchestration crashes happen and we don't want stuck missions.
3. The new schema migration shall be additive only — no rewrites or destructive operations on existing tables (per memory `feedback_db_migrations.md`).
4. The API change is intentionally **not** silently backwards-compatible: older `ateam` CLIs that send `--itemId` for one of the five phase agents will receive a 400 with a validation error message that names the new pattern and points at the minimum CLI version. Older CLIs that omit `--itemId` for an item agent will receive the existing 400; behavior for item agents is unchanged.

### Edge Cases & Error States

- **Agent retries phase-start mid-flight.** A second `phase-start` for the same `(missionId, phase)` while one is `in_progress` returns 409 Conflict with the existing claim's `agent` and `startedAt`.
- **Phase-stop with no matching phase-start.** Returns 404 with a clear "no in-progress phase for this mission/agent" message.
- **Mission archived while a phase is in_progress.** The archive operation succeeds; the in-progress phase is auto-marked `failed` with a synthesized summary `"mission archived while phase was in progress"`.
- **Stockwell rejects with no rejection target.** The API requires either `--return-to-items <id,id,...>` or `--summary` describing the rejection scope; missing both → 400.
- **Two missions interleaved (rare but possible).** `MissionPhase.missionId` is the discriminator; nothing prevents Hannibal from claiming `orchestration` on mission A while Hannibal is also active on mission B (different rows, different claims).
- **Phase agent run outside a mission context.** No active mission → 400 with "no current mission for this project."

## 7. Design Principles

- **Don't invent new surface when the existing surface absorbs the case.** The existing `agents/start` and `agents/stop` endpoints stay as the single entry points. Routing happens by agent identity, not by URL.
- **Symmetry with the item-flow.** Phase-flow has the same conceptual shape: claim → work → release with outcome + summary. Only the destination table differs.
- **Cost attribution by join, not by snapshot.** `MissionPhase` does not duplicate token counts. Token costs come from `HookEvent` rolled up by time window — one source of truth.
- **Minimal agent-body churn.** The five agent bodies should have one mechanical change each: drop the `--itemId "FOO"` argument. No new commands, no new patterns to learn.
- **No silent failure modes.** The current pseudo-item pattern is invisible to operators because 404s are silently swallowed by agents. The new flow either succeeds visibly or fails visibly with a real error message.

## 8. Solution Approach

The mission already has a database identity (`Mission.id`). What's missing is per-phase identity *within* a mission. Add a `MissionPhase` table that records each phase's lifecycle: who's running, when it started, when it ended, what the outcome was.

The API endpoints stay where they are. When a request comes in, the route handler checks the agent name against a fixed registry. If the agent is one of the five mission-scoped agents, the request is treated as a phase claim and writes to `MissionPhase`. Otherwise, the existing item-claim flow runs unchanged.

The kanban UI grows a mission timeline component above the existing item columns. It reads `MissionPhase` rows for the current mission and renders one pill per phase, colored by status. Clicking a pill shows the phase's summary, outcome, and rolled-up token cost.

The CLI keeps its existing shape. The only behavioral shift visible to humans is that `ateam agents-start agentStart --agent stockwell` (no `--itemId`) succeeds for Stockwell where it used to require a sentinel string.

Mission progression is modeled as an explicit state machine. Today `Mission.state` is loosely tracked; with this change, missions move through a defined sequence — decomposition → critique → orchestration → coding → final review → documenting → done — and each `phase-start` / `phase-stop` advances the state through the matrix. The transition matrix lives in shared code (`packages/shared`) so the API, the kanban UI, and any future tooling all enforce the same rules. Illegal transitions (e.g., trying to enter `final_review` while still `decomposing`) fail loudly, exactly as illegal item-stage transitions do today.

Most phases are claimed by a named agent (the five mission-scoped agents), but the `coding` phase is special: it represents the time window when items are flowing through the per-item pipeline. No single agent owns it, so the system creates the `MissionPhase` row implicitly — opened when the first item enters `testing`, closed when the last item reaches `done` or the mission is terminated. This keeps the timeline visually complete: every minute of mission wall-clock time belongs to exactly one phase.

The hook (`enforce-agent-start.js`) gains a small allowlist: phase agents skip the item-id requirement. Activity logging stays gated for item-scoped agents.

## 9. Technical Considerations

**Constraints:**
- Schema migration must be additive (no destructive ops on existing tables — see memory `feedback_db_migrations.md`).
- Hook regex changes must preserve the load-bearing block on `agents-stop` and `activity` for item-scoped agents (see memory `feedback_enforcement_hooks.md`).
- The agent identity registry must live in exactly one place that both the API route and the hook can import. Today they're in different language ecosystems (TypeScript route handler, Node hook script). A shared JSON or TS module that the hook can `require()` is acceptable.

**Dependencies:**
- Internal: kanban-viewer Prisma schema, `agents/start/route.ts`, `agents/stop/route.ts`, `enforce-agent-start.js`, the five affected agent bodies.
- External: none.
- Data: no historical backfill. New missions only.

**Integration points:**
- `GET /api/missions/{id}` (extend response or sibling endpoint) for kanban consumption.
- Token-usage rollup endpoint extension for per-phase costs.
- Observer hook events (`HookEvent` table) — no changes needed; the join with `MissionPhase` happens at query time.

## 10. Risks & Open Questions

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Hook drift between API registry and JS hook registry | Medium | Phase agents fail silently again | Single shared module; CI test that loads both and compares |
| Phase rows leak across missions if `missionId` is wrong | Low | Wrong cost attribution, wrong timeline | Validate `missionId` exists; index `(missionId, phase)` for exclusivity |
| In-progress phases accumulate after orchestrator crash | Medium | Stuck-looking missions in UI | Auto-fail in-progress phases on `archiveMission`; surface as warning, not error |
| Older `ateam` CLIs still send pseudo-IDs | Low | Validation errors visible to users | Error message names the fix; minCliVersion bump if needed |
| Token rollup join is expensive on large missions | Low | Slow timeline UI | Materialize rollup on phase-stop, cache on `MissionPhase.tokenSnapshot` |
| Mission state machine rejects a legitimate transition under a real-world edge case (e.g., orchestrator restart mid-pipeline) | Medium | Mission stuck unable to advance | Define the matrix from observed flows, not theoretical ideal; include a `force_state` admin endpoint behind a flag for recovery |
| State machine drifts between API enforcement and UI display | Low | Confusing kanban state | Single shared module in `packages/shared`, importable by both — same pattern as `TRANSITION_MATRIX` |

### Open Questions

None blocking. Implementation team decides naming for the shared registry module and the state-machine module during build-out.
- [ ] Should phase rows be deletable, or append-only? (Lean: append-only — they're mission history.)

## 11. Rollout & Measurement

**Phasing:**
- **Phase 1:** Shared mission state machine + schema migration + API registry branch + system-managed `coding` phase + Stockwell rejection writeback + hook update + agent body edits. New missions immediately stop emitting 404s for phase agents. (Critical path.)
- **Phase 2:** Token-cost-by-phase rollup endpoint + per-phase token snapshot caching.
- **Phase 3:** Kanban mission timeline strip UI, fed by the API work from Phases 1 and 2.

**Measurement plan:**
- Watch `api-errors.log` post-launch for any remaining `ITEM_NOT_FOUND` codes from the five mission agents — target zero within the first mission run.
- Verify `MissionPhase` row count ≥ 6 for every new mission (5 agent-claimed phases + 1 system-managed `coding` phase).
- Verify Stockwell rejections increment the named items' `rejection_count` AND populate the phase row's rejection target list.
- After Phase 2, sample a real mission's per-phase cost breakdown and confirm it sums (within rounding) to the existing whole-mission token total.
- After Phase 3, walk a fresh mission end-to-end and confirm the kanban timeline reflects each phase's status in real time, including the `coding` phase span.

**Rollback criteria:**
- If the API registry branch breaks item-flow for any pipeline worker (Murdock/B.A./Lynch/Amy) — revert immediately. Item-flow is the load-bearing path and cannot regress.
- If hook changes block any worker agent's legitimate `agents-start` call — revert hook, debug, retry.
