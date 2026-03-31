---
missionId: ~
---

# Peer-to-Peer Agent Handoffs

**Author:** Josh  **Date:** 2026-03-28  **Status:** Draft

## 1. Context & Background

The A(i)-Team pipeline executes work items through a fixed sequence of agents: Murdock (tests) -> B.A. (implementation) -> Lynch (review) -> Amy (probing). Each handoff between agents currently routes through Hannibal, who receives a completion message, runs `board-move`, then dispatches the next agent. In native teams mode, this creates a hub-and-spoke bottleneck.

Production data from two completed missions shows the cost:

- **Mission 1 (9 items):** 82 minutes of agent work, 68 minutes of handoff gaps. Average gap: 2.7 minutes per handoff.
- **Mission 2 (11 items):** 14 minutes of agent work, with handoff overhead dominating wall clock time.
- **Per-item example (WI-002):** 6 minutes of actual work, 12 minutes of handoff waiting. A 2:1 overhead-to-work ratio.

With 4 stages per item and ~3 minutes per handoff, each item accumulates ~12 minutes of dead time. Across a 9-item mission, this adds up to nearly an hour of idle waiting.

Why now: The structured fields work (objective, acceptance, context) improves agent output quality, but speed gains are capped as long as half the pipeline time is spent waiting for Hannibal to relay messages between agents that could talk directly.

## 2. Problem Statement

In native teams mode, all agent-to-agent handoffs route through Hannibal as a central dispatcher. When an agent completes work, the completion message queues until Hannibal's current turn ends, then Hannibal runs board-move and dispatches the next agent. This turn-based message delivery introduces 2-5 minutes of latency per handoff, accounting for roughly half of total pipeline execution time.

## 3. Target Users & Use Cases

**Primary users:**
- A(i)-Team pipeline agents (Murdock, B.A., Lynch, Amy) operating in native teams mode

**Key use cases:**
- Murdock finishes writing tests and needs B.A. to start implementing immediately, without waiting for Hannibal to relay the handoff.
- Lynch rejects an item and needs to send it directly back to Murdock or B.A. for rework, without Hannibal as intermediary.
- Hannibal needs to verify that handoffs succeeded and intervene when they fail (e.g., WIP limit rejection, agent not responding).

## 4. Goals & Success Metrics

| Goal | Metric | Current | Target |
|------|--------|---------|--------|
| Reduce handoff latency | Average time between agentStop and next agentStart | ~163 seconds | < 10 seconds (validated: idle teammate message delivery is ~5s) |
| Reduce pipeline wall clock time | Total execution time for a 9-item mission | ~63 minutes | ~35 minutes |
| Maintain reliability | Items that stall without an assigned agent | Unmeasured | 0 (Hannibal catches within 2 minutes) |

## 5. Scope

### In Scope
- `agentStop` API change: automatically advance item to next stage on successful completion
- Agent prompt updates: completing agent messages the next agent directly with work context (native teams mode only)
- Agent prompt updates: completing agent notifies Hannibal asynchronously for tracking
- Hannibal verification: async check that `assigned_agent` is set after receiving FYI notifications
- Hannibal handles WIP limit rejections when auto-advance fails
- Rejection flow: Lynch messages Murdock or B.A. directly for rework
- Native orchestration playbook update: remove Hannibal from happy-path handoff loop

### Out of Scope
- Legacy mode changes (legacy mode has no SendMessage; hub-and-spoke via TaskOutput polling continues as-is)
- Changes to the planning phase (Face/Sosa flow is unchanged)
- Changes to mission-level events (Stockwell final review, post-checks, Tawnia documentation still orchestrated by Hannibal)
- WIP limit auto-queuing (if WIP blocks a move, Hannibal handles it manually rather than building an automated queue)

## 6. Requirements

### Functional Requirements

#### API: agentStop auto-advance
1. When `agentStop` is called with `--status success`, the API shall automatically move the item to the next stage per the transition matrix.
2. The API shall return the new stage in the response so the calling agent knows the transition succeeded.
3. If the stage transition is blocked by a WIP limit, the API shall return a specific error status indicating the WIP rejection (not a generic failure).
4. If `agentStop` is called with `--status failed`, the API shall not advance the item's stage.
5. The auto-advance behavior shall be opt-in via a flag (e.g., `--advance`) so that existing callers are not affected until agent prompts are updated.

#### Agent direct handoff with ACK (native teams mode)
6. On successful completion, each pipeline agent shall send a START message directly to the next agent in the chain: Murdock -> B.A., B.A. -> Lynch, Lynch -> Amy.
7. The START message shall include the item ID and sufficient context for the next agent to begin work (item title, output paths, objective).
8. The receiving agent shall immediately reply with an ACK message confirming it is starting work on the item.
9. The completing agent shall wait for the ACK (expected within ~10 seconds based on measured roundtrip of 7.5s).
10. On receiving the ACK, the completing agent shall send a FYI notification to Hannibal confirming the handoff succeeded.
11. If no ACK is received within 20 seconds, the completing agent shall send an ALERT to Hannibal indicating the handoff failed, so Hannibal can re-dispatch.
12. When Lynch rejects an item, Lynch shall message the target agent (Murdock or B.A.) directly with the item ID and rejection reason. The target agent shall ACK the rejection.
13. Amy's completion does not trigger a peer handoff (item moves to `done`). Amy shall notify Hannibal only.

#### Hannibal role in handoffs
14. Hannibal receives FYI (success) or ALERT (failure) from completing agents. FYI requires no action. ALERT triggers re-dispatch.
15. Hannibal shall handle WIP rejection notifications by queuing the item for retry when space opens in the target stage.
16. As a backup, Hannibal may periodically check for items stuck without an `assigned_agent`, but the ACK mechanism is the primary reliability layer.

#### Backward compatibility
14. Legacy mode (without `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`) shall continue to use the existing hub-and-spoke flow with no behavioral changes.
15. The `--advance` flag on `agentStop` shall default to off, preserving current behavior for any callers that do not opt in.

### Non-Functional Requirements
1. The auto-advance on `agentStop` shall complete within the same request (no additional API round-trip required by the agent).
2. The handoff message format shall be simple enough that agents do not need to construct complex payloads (item ID + brief context).

### Edge Cases & Error States
- WIP limit blocks auto-advance: agent receives WIP rejection, notifies Hannibal with "BLOCKED: WI-002 can't advance, WIP limit on implementing." Hannibal retries when space opens.
- Next agent is not running (crashed or not spawned): no ACK received within 20 seconds. Completing agent sends ALERT to Hannibal, who re-spawns or re-dispatches.
- Agent receives a START message for an item it already completed: agent should ignore duplicate start messages.
- Two agents complete simultaneously and both try to advance to the same WIP-limited stage: the transition matrix and WIP enforcement in the API handle this — second advance is rejected, that agent's Hannibal FYI triggers intervention.
- Rejection during peer handoff: Lynch rejects and messages Murdock directly. If Murdock is busy with another item, the message queues until Murdock's turn ends (same latency as current Hannibal relay, but only for the rejection path which is less common).

## 10. Risks & Open Questions

**Validated assumption:** Native teams message delivery to idle teammates takes ~4-5 seconds (measured via ping-pong test between two haiku teammates on 2026-03-28). Full roundtrip (send + receive + reply + receive reply) was 7.5 seconds. The current 2-5 minute handoff gaps are caused by routing through Hannibal mid-turn, not by message infrastructure.

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Message delivery to busy agent is slow | Medium | Handoff latency degraded when agent is mid-turn on another item | Pipeline agents should complete items before starting new ones; WIP limits prevent overload |
| Agents get out of sync with board state | Low | Item stuck in wrong stage | Hannibal verification catches this; agentStart validates stage |
| WIP rejections create orphaned items | Low | Items never advance | Hannibal monitors FYI messages and retries blocked advances |

### Open Questions
- [x] ~~Does Claude Code's native teams deliver messages to idle teammates instantly?~~ **Answered:** ~4-5 seconds one-way delivery to idle teammates (measured 2026-03-28).
- [ ] Should `agentStart` also validate that the item is in the expected stage for that agent, or trust the auto-advance?
- [ ] For the `--advance` flag: should this eventually become the default behavior, or remain opt-in permanently?
- [ ] Should the handoff message include the full renderItem output, or just the item ID (letting the next agent call renderItem itself)?

## Appendix: Handoff Latency Instrumentation

To measure actual handoff latency in production missions, add high-resolution timestamping to the existing observer hooks.

### What to instrument
- **`observe-stop.js`**: When an agent's Stop event fires, log a nanosecond timestamp with the agent name and item ID.
- **`observe-pre-tool-use.js`**: On the next agent's first tool call for a new item, log a nanosecond timestamp with the agent name and item ID.
- The delta between these two timestamps across agents on the same item is the true handoff latency.

### Storage
Write timestamped entries to the HookEvent table (already used by observer hooks) with a new event type (e.g., `handoff-stop`, `handoff-start`). This keeps the data queryable alongside existing telemetry.

### Analysis
After a mission, query handoff pairs:
```sql
SELECT
  stop.agentName as from_agent,
  start.agentName as to_agent,
  stop.itemId,
  (start.timestamp - stop.timestamp) as handoff_ms
FROM HookEvent stop
JOIN HookEvent start ON stop.itemId = start.itemId
WHERE stop.eventType = 'handoff-stop'
  AND start.eventType = 'handoff-start'
  AND start.timestamp > stop.timestamp
ORDER BY handoff_ms DESC;
```

This data validates whether peer-to-peer handoffs actually reduce latency compared to hub-and-spoke, and establishes a baseline for future optimization.
