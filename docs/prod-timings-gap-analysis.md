# Production Agent Timing Gap Analysis

**Date:** 2026-03-28
**Source:** `data/prod.db` and `packages/kanban-viewer/prisma/data/ateam.db` — WorkLog tables

## Missions Analyzed

| Mission | ID | Items | Duration | Mode |
|---|---|---|---|---|
| DevTrack Claude Code Plugin | M-20260328-002 | 11 | ~1h 36m | Legacy |
| Peer-to-Peer Agent Handoffs | M-20260328-003 | 9 | ~2h 1m | Native teams (P2P v1) |
| React Todo Client | M-20260328-001 | 7 | ~49m | Native teams (P2P v2) |

## Time Split: Working vs Handoff

| | Handoff (idle) | Working (active) | Handoff % |
|---|---|---|---|
| **DevTrack** (legacy) | 17.9 min | 25.2 min | 41.5% |
| **P2P Handoffs** (native teams) | 31.1 min | 56.7 min | 35.4% |
| **React Todo** (native teams) | 16.6 min | 26.4 min | 38.6% |
| **Prod combined** | 49.0 min | 81.9 min | 37.4% |

~37% of pipeline time is spent in handoffs — agents idle between one completing and the next starting.

## Bottlenecks by Transition Type

### Handoffs (agent completed → next agent started)

| Transition | Count | Avg (min) | Min | Max | Total (min) |
|---|---|---|---|---|---|
| Murdock → B.A. | 5 | 2.7 | 1.3 | 4.7 | 13.7 |
| B.A. → Lynch | 19 | 1.3 | 0.2 | 4.2 | 25.4 |
| Lynch → Amy | 9 | 0.8 | 0.6 | 1.4 | 7.6 |
| Lynch → B.A. (rejection) | 1 | 1.2 | 1.2 | 1.2 | 1.2 |
| B.A. → Amy (skip review?) | 2 | 0.6 | 0.4 | 0.7 | 1.1 |

### Working Time (agent started → agent completed)

| Agent | Count | Avg (min) | Min | Max | Total (min) |
|---|---|---|---|---|---|
| B.A. | 21 | 2.1 | 0.4 | 9.9 | 44.2 |
| Murdock | 5 | 1.8 | 0.8 | 2.9 | 9.1 |
| Amy | 11 | 1.0 | 0.5 | 2.1 | 11.1 |
| Lynch | 19 | 0.9 | 0.0 | 1.8 | 17.5 |

## Top 10 Longest Individual Gaps

| Item | From | To | Gap (min) |
|---|---|---|---|
| WI-028 | B.A. started | B.A. completed | 9.9 |
| WI-021 | B.A. started | B.A. completed | 9.1 |
| WI-028 | Murdock completed | B.A. started | 4.7 |
| WI-012 | B.A. completed | Lynch started | 4.2 |
| WI-011 | B.A. completed | Lynch started | 3.9 |
| WI-018 | Murdock completed | B.A. started | 3.4 |
| WI-026 | B.A. started | B.A. completed | 3.3 |
| WI-028 | Murdock started | Murdock completed | 2.9 |
| WI-010 | B.A. started | B.A. completed | 2.6 |
| WI-022 | Murdock started | Murdock completed | 2.6 |

## Handoff Progression Across Missions

Average handoff time by transition, showing improvement from legacy → P2P v1 → P2P v2:

| Transition | Legacy (DevTrack) | P2P v1 (Handoffs) | P2P v2 (React Todo) | Δ Legacy→Latest |
|---|---|---|---|---|
| **Murdock → B.A.** | 3.39 min | 2.56 min | **0.94 min** | **-72%** |
| **B.A. → Lynch** | 1.50 min | 1.20 min | **0.31 min** | **-79%** |
| **Lynch → Amy** | — | 0.85 min | **0.53 min** | -38% (vs P2P v1) |

P2P handoffs dramatically reduced dispatch latency. B.A.→Lynch is now near-instant (0.31 min avg). Max values remain spiky (Murdock→B.A. hits ~4.2 min worst case across all missions), likely from first-of-wave dispatches or WIP stalls.

## Queue Wait: The Remaining Bottleneck

With handoff latency largely solved, the dominant cost is now **queue wait** — agents idle between finishing one item and starting the next, because only one instance of each agent type processes items sequentially.

React Todo mission (7 items):

| Agent | Queue Wait (between items) | Avoidable (>2 min) |
|---|---|---|
| Lynch | 24.5 min | 23.8 min |
| Murdock | 23.1 min | 22.9 min |
| B.A. | 20.4 min | 18.9 min |
| Amy | 19.7 min | 18.3 min |
| **Total** | **87.7 min** | **83.9 min (96%)** |

Agents spent 87.7 min total idle between items vs 26.4 min actually working — a 3.3:1 idle-to-work ratio. With singleton agents, items queue behind each other even when the stage WIP limit would allow concurrency.

## Key Takeaways

1. **P2P handoffs delivered.** Per-handoff latency dropped 72-79% from legacy to the latest native teams mission. The dispatch loop is no longer the bottleneck.

2. **Queue wait is now the dominant cost.** With 7 items, agents accumulated 87.7 min of idle time waiting between items — 3.3x more than actual working time (26.4 min).

3. **B.A. has the widest variance** (0.4–9.9 min working time), which tracks with implementation complexity varying significantly across items.

4. **Lynch is the fastest worker** (avg 0.8 min), suggesting reviews are lightweight relative to implementation and testing.

5. **Next opportunity: pipeline parallelism.** Individual-dependency gating (instead of wave-gating) and multi-instance agents would address queue wait. See `prd/ready/pipeline-parallelism.md` for modeled projections — 1.83x speedup with 2x instances + individual-dep gating.

## Other Findings

**Structured field adoption (React Todo mission):** Face created all 7 work items with well-structured objective/acceptance/context content, but dumped it all into the `description` field as markdown instead of using the dedicated `--objective`, `--acceptance`, and `--context` CLI flags. The structured database columns were empty for all items. Fixed by making `objective`, `acceptance`, and `context` required in both the API and CLI. `description` is now repurposed as a human-readable executive summary that synthesizes objective + context into prose for the kanban board.
