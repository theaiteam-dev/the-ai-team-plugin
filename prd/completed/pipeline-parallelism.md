---
missionId: M-20260331-002
---

# Pipeline Parallelism: Individual-Dep Gating & Multi-Instance Agents

**Author:** Josh  **Date:** 2026-03-28  **Status:** Draft

## 1. Context & Background

The A(i)-Team pipeline processes work items sequentially through four agent stages: Murdock (testing) → B.A. (implementation) → Lynch (review) → Amy (probing). Production timing analysis reveals that **37% of pipeline wall-clock time is idle** — agents waiting for work rather than doing work.

Two architectural constraints drive this waste:

1. **Wave-gating**: All items in dependency wave N must reach `done` before any item in wave N+1 can start. In practice, each item depends on only 1-2 specific predecessors, not the entire wave. The last item in a wave holds back the entire next wave.

2. **Singleton agents**: Each agent type is a single instance processing items sequentially. If Murdock is testing WI-003, WI-004 waits in a queue — even though the WIP limit allows 2 items in the testing stage simultaneously.

Why now: The recent peer-to-peer handoff work (M-20260328-003) reduced per-handoff latency from 1.5min to 0.5min average, but exposed that **queue wait time is now the dominant bottleneck**. In the current live mission, 30 of 34 minutes of idle time is avoidable queue wait — agents sitting idle between items. P2P handoffs solved the dispatch delay; now the pipeline shape itself is the constraint.

## 2. Problem Statement

Mission wall-clock time scales linearly with item count because items within each dependency wave are processed sequentially by singleton agents, and items across waves are blocked by wave-level gating rather than individual dependency resolution. A 30-item mission that could complete in ~50 minutes takes ~92 minutes under the current architecture.

## 3. Target Users & Use Cases

**Primary users:**
- Teams running A(i)-Team missions with 10+ work items across multiple dependency waves

**Key use cases:**
- A team runs a mission with 30 items across 6 dependency waves and expects pipeline throughput to scale with available concurrency, not bottleneck on singleton agents
- A team has items in wave 2 that depend only on a single completed wave-1 item, and expects those items to start immediately rather than waiting for the entire wave to finish

## 4. Goals & Success Metrics

### Pre-Work Baseline Measurements

Captured from production database (`prod.db`) and live mission (`ateam.db`) on 2026-03-28.

**Production missions analyzed:**

| Mission | ID | Items | Wall Clock | Handoff % |
|---|---|---|---|---|
| DevTrack Claude Code Plugin | M-20260328-002 | 11 | 96 min | 41.5% |
| Peer-to-Peer Agent Handoffs | M-20260328-003 | 9 | 121 min | 35.4% |
| React Todo Client (live) | M-20260328-001 | 5 | ~20 min | 31.0% |

**Per-agent working times (production averages):**

| Agent | Avg (min) | Min | Max | Role |
|---|---|---|---|---|
| B.A. | 2.0 | 0.4 | 9.9 | Implementation (bottleneck) |
| Murdock | 1.7 | 0.4 | 3.0 | Testing |
| Amy | 1.1 | 0.4 | 2.8 | Probing |
| Lynch | 1.0 | 0.0 | 4.0 | Review |

**Per-item pipeline time:** ~7.4 min (5.8 min working + 1.6 min handoff overhead)

**Queue wait breakdown (React Todo mission, 5 items):**

| Agent | Total Queue Wait | Avoidable (>2 min) |
|---|---|---|
| Murdock | 9.5 min | 9.2 min (97%) |
| B.A. | 10.4 min | 8.8 min (85%) |
| Lynch | 8.3 min | 7.6 min (92%) |
| Amy | 5.8 min | 4.4 min (76%) |
| **Total** | **34.0 min** | **30.0 min (88%)** |

**Modeled projections (30 items, 6 waves):**

| Config | Wall Clock | Speedup | Compute Cost |
|---|---|---|---|
| 1x wave-gated (today) | 92.4 min | 1.00x | 1.0x |
| 1x individual-dep | 66.8 min | 1.38x | 1.0x |
| 2x wave-gated | 66.4 min | 1.39x | ~2.0x |
| 2x individual-dep | 50.4 min | 1.83x | ~2.0x |
| 3x individual-dep | 48.4 min | 1.91x | ~3.0x |
| 4x individual-dep | 46.4 min | 1.99x | ~4.0x |
| Theoretical min | 46.4 min | 1.99x | — |

### Success Metrics

| Goal | Metric | Baseline | Target |
|---|---|---|---|
| Reduce mission wall-clock time | Wall clock for 10+ item missions | 92 min (30 items modeled) | <55 min |
| Reduce idle/handoff ratio | Handoff % of total pipeline time | 37% | <20% |
| Eliminate avoidable queue wait | Queue wait >2 min per agent transition | 30 min / 34 min idle | <5 min |
**Negative metric:** Agent working time per item shall not increase. Parallelism improvements shall not degrade individual item quality or processing time.

**Cost model note:** Idle agent instances consume only process memory — they do not burn API tokens. The only marginal cost of additional instances is the one-time prompt cache fill at spawn. This means optimizing for agent utilization is a non-goal; the only metric that matters is reducing item queue wait time (wall-clock improvement).

## 5. Scope

### ~~Phase 1: Individual-Dependency Gating~~ (Already Implemented)

Investigation confirmed that individual-dep gating is already the current behavior:
- `checkDeps` API returns per-item readiness (not wave-level)
- Both playbooks iterate `readyItems[]` individually and move items from `briefings → ready` as their specific deps resolve
- No wave-level enforcement exists — "wave" is a conceptual label only

**No work needed.** The remaining throughput bottleneck is singleton agents (Phase 2).

### Phase 2: Multi-Instance Agents with Adaptive Scaling

**In scope:**
- Spawn N instances of each pipeline agent type (e.g., `murdock-1`, `murdock-2`) within a mission team
- **Adaptive instance count** derived from two inputs:
  1. **Dep graph analysis**: After Face decomposes work items, walk the dependency graph to compute the maximum number of items that could occupy each pipeline stage simultaneously (largest independent set per stage). This is the ceiling — more instances than this are wasted.
  2. **Machine resource budget**: Query **free** system memory (not total) to determine the maximum total agent sessions the machine can sustain. Measured subagent footprint: **369–388 MB RSS** (median ~375 MB, use 400 MB as conservative estimate). Cap total sessions at 80% of free memory headroom.
  3. Instance count = `min(dep_graph_max_per_stage, floor(free_memory_80pct / 400MB / 4_agent_types))`, uniform across agent types
- Configurable override via `--concurrency N` flag (bypasses adaptive calculation)
- Instance-aware claiming: multiple instances of the same agent type can claim and work different items concurrently
- Load distribution: when an item is ready for a stage, dispatch to the least-busy instance

**Adaptive scaling examples (modeled):**

| Mission Shape | Items | Dep Graph Max/Stage | 8 GB (4 GB free) | 16 GB (10 GB free) | 32+ GB (24 GB free) |
|---|---|---|---|---|---|
| Many small waves (3×10) | 30 | 3 | 2x (8 agents) | 3x (12 agents) | 3x (12 agents) |
| Front-heavy (7,6,5,5,4,3) | 30 | 7 | 2x (8 agents) | 6x (24 agents) | 7x (28 agents) |
| 2 big waves (15,15) | 30 | 15 | 2x (8 agents) | 6x (24 agents) | 12x (48 agents) |
| Small project (2,3,2) | 7 | 3 | 2x (8 agents) | 3x (12 agents) | 3x (12 agents) |

*Assumes 400 MB per subagent, 80% of free memory, 4 agent types per instance set.*

**Measured session footprint** (2026-03-31, 91 GB / 32-core machine):

*Standalone sessions (long-running, heavy context):*
- RSS range: 363–1004 MB per session (15 sessions measured)
- Median: ~660 MB, p90: ~800 MB
- Long-running sessions with large contexts trend toward 1 GB+

*Subagents via Agent tool (pipeline workers):*
- RSS range: 369–388 MB per session (8 subagents measured across 2 parent sessions)
- Median: ~375 MB — roughly half of standalone sessions
- Stable under load: RSS did not grow after reading files, running tests, and idling
- Parent process RSS grew only ~5 MB when spawning 4 subagents

Pipeline agents are subagents, not standalone sessions. **Conservative budget estimate: 400 MB per subagent** at 80% of free memory headroom.

**Out of scope (Phase 2):**
- Dynamic re-scaling mid-mission based on queue depth (future optimization)
- Per-agent-type instance tuning (uniform is simpler; dep graph max is the same across stages in practice because items move through stages sequentially)
- Changes to the review/probing quality bar (more instances, same rigor)

## 6. Requirements

### Functional Requirements

**Phase 1 — Individual-Dependency Gating:**

1. An item shall become eligible for pipeline entry (Murdock dispatch) as soon as all items listed in its `dependencies` array have reached the `done` stage.
2. The orchestration loop shall not wait for all items in a dependency wave to complete before dispatching items from subsequent waves.
3. `ateam deps-check checkDeps` shall be the authoritative source for item readiness — orchestration playbooks shall not implement independent dependency logic.
4. Items with no dependencies shall be eligible for immediate dispatch, subject to WIP limits.
5. WIP limits shall continue to be enforced per-stage; individual-dep gating shall not bypass WIP enforcement.

**Phase 2 — Multi-Instance Agents:**

6. The orchestration layer shall support spawning N instances of each pipeline agent type within a single mission team.
7. Each agent instance shall be independently addressable (e.g., `murdock-1`, `murdock-2`) for `SendMessage` dispatch.
8. Agent instances of the same type shall not claim the same item; the claiming mechanism shall prevent conflicts.
9. When multiple instances of an agent type are idle, the next ready item shall be dispatched to an available instance.
10. After work item decomposition, the orchestrator shall compute the adaptive instance count by: (a) walking the dependency graph to find the maximum items that could occupy any single stage concurrently, and (b) querying **free** system memory to cap total sessions at 80% of free memory headroom (~400 MB per subagent). The instance count shall be `min(dep_graph_max, floor(free_memory_80pct / 400MB / 4_agent_types))`, applied uniformly across agent types.
11. The adaptive count shall be overridable via a `--concurrency N` mission parameter.
12. Agent lifecycle commands (`agentStart`, `agentStop`) shall work identically for named instances — the agent name in work logs shall include the instance identifier.
13. The computed instance count and the scaling rationale (dep graph max, available memory, resulting session count) shall be persisted to the mission record in the database at mission start.
14. The Kanban UI shall display the scaling rationale for the active mission (instance count, dep graph max, memory budget, and which was the binding constraint).

### Non-Functional Requirements

1. Individual-dep gating shall not require API or CLI changes — it shall be a playbook-level change only.
2. Multi-instance agent support shall not require changes to individual agent prompts (agents are already stateless and item-scoped).
3. Mission observability (activity log, work log, kanban UI) shall correctly reflect concurrent agent activity — multiple agents active simultaneously shall be visible.

### Edge Cases & Error States

- **All deps done simultaneously:** Multiple items from different waves become eligible at the same time. Dispatch shall round-robin across available agent instances.
- **Agent instance failure mid-item:** If an instance crashes or times out, the item's claim shall be released and the item shall be eligible for pickup by another instance (or the same instance after restart).
- **Uneven instance load:** One instance finishes fast, another is working a complex item. The idle instance shall pick up the next queued item immediately, not wait for the busy instance.
- **All items in a wave have the same single dependency:** That dependency becomes a bottleneck; all waiting items unlock simultaneously and compete for agent instances. Instance count is the natural throttle here.

## 10. Risks & Open Questions

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Race conditions in concurrent claiming | Medium | Items processed twice or skipped | Atomic claim transactions already exist in API; verify they hold under concurrent access |
| Memory pressure from idle instances | Low | System slowdown on constrained machines | Subagents measured at ~375 MB (not 750 MB); adaptive scaling uses free memory, not total; 80% headroom rule |
| Adaptive scaling miscalculates | Low | Too many or too few instances | Log the computation; allow `--concurrency N` override; machine heuristic is conservative |
| Prompt cache thrashing with multiple instances | Low | Higher token costs per agent | Instances share the same agent prompt; Claude Code prompt caching should handle this |
| Orchestration complexity increase | Medium | Harder to debug stuck missions | Phase 1 (dep gating) is simple; Phase 2 adds complexity — invest in observability first |
| Dependency graph cycles | Low | Items deadlocked waiting for each other | `checkDeps` already validates acyclic deps at item creation; no new risk |

### Resolved Questions

- [x] **Pool-based handoffs, not instance affinity.** Multi-instance agents use pool-based peer-to-peer handoffs — any B.A. instance hands off to any available Lynch instance. No instance affinity. This is simpler and avoids idle instances when load is uneven.
- [x] **Agent instance naming does not affect hooks/telemetry.** Multiple instances of the same agent type share the same `subagent_type` (e.g., `ai-team:murdock`). Hook resolution via `resolveAgent()` strips the prefix and returns `murdock` regardless of instance number. No changes needed to `KNOWN_AGENTS`, enforcement hooks, or telemetry attribution.
- [x] **Scaling rationale in a modal.** The Kanban UI displays scaling info (instance count, dep graph max, memory budget, binding constraint) behind a button click in a modal, not cluttering the main board view.
- [x] **Memory budget uses free memory, not total.** The adaptive formula queries available/free system memory, not total RAM. On a machine running other workloads, total RAM is misleading. Cap sessions at 80% of free memory headroom.

### Open Questions

- [x] **Subagent RSS is ~375 MB, roughly half of standalone sessions (~660 MB).** Measured 2026-03-31 across 8 subagents spawned from 2 different parent sessions. Subagents are stable under load (no RSS growth after file reads, test runs, and idle). Parent process grows only ~5 MB per subagent spawned. Budget estimate updated from 750 MB to 400 MB (conservative).
- [x] **Individual-dep gating is already implemented.** Investigation confirmed that `checkDeps` returns per-item readiness, playbooks iterate `readyItems[]` individually, and no wave-level enforcement exists. The word "wave" in docs is conceptual grouping only. Phase 1 of this PRD is already the current behavior — the real value is Phase 2 (multi-instance agents).
